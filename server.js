const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const bodyParser = require('body-parser');
const path = require('path');
const fs = require('fs').promises;
const QRCode = require('qrcode');
const archiver = require('archiver');
const http = require('http');
const { Server } = require('socket.io');
const NodeCache = require('node-cache');
const { v4: uuidv4 } = require('uuid');
const validator = require('validator');
const bcrypt = require('bcryptjs');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { 
    cors: { 
        origin: '*',
        methods: ['GET', 'POST']
    } 
});
const PORT = process.env.PORT || 3000;
const LOCAL_IP = process.env.LOCAL_IP || 'localhost';

// ==================== CONFIGURATION ====================
const CONFIG = {
    maxProjectsPerUser: 10,
    qrCacheTime: 3600,
    allowedTypes: ['web', 'bot-whatsapp', 'bot-telegram', 'bot-discord', 'store', 'portfolio', 'company'],
    devCredentials: { email: 'noho@no', password: 'noho' },
    tunnelUrl: null,
    adminPhone: '+201283073813',
    whatsappLink: 'https://wa.me/201283073813',
    version: '2.1.0'
};

// ==================== MIDDLEWARE ====================
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'", "https:", "https://fonts.googleapis.com"],
            fontSrc: ["'self'", "https://fonts.gstatic.com"],
            scriptSrc: ["'self'", "'unsafe-inline'", "https://cdnjs.cloudflare.com"],
            imgSrc: ["'self'", "data:", "https:"],
            connectSrc: ["'self'", "ws:", "wss:"]
        }
    },
    crossOriginEmbedderPolicy: false
}));

app.use(compression());
app.use(cors({
    origin: true,
    credentials: true
}));

app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static('public', { maxAge: '1d' }));

// Rate Limiting - محسن
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    message: { 
        error: 'كثرة الطلبات، جرب بعد 15 دقيقة',
        retryAfter: 15
    },
    standardHeaders: true,
    legacyHeaders: false
});

const createLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 5,
    message: {
        error: 'تم تجاوز الحد المسموح (5 مشاريع/ساعة)',
        contact: CONFIG.whatsappLink
    }
});

app.use('/api/', limiter);
app.use('/api/projects/create', createLimiter);

// ==================== DATABASE ====================
const DB_PATH = './database.json';
const BACKUP_PATH = './database-backup.json';
const cache = new NodeCache({ stdTTL: 100, checkperiod: 120 });

const DB = {
    users: new Map(),
    projects: new Map(),
    stats: { 
        totalVisits: 0, 
        totalCreates: 0,
        totalDownloads: 0,
        lastUpdate: new Date().toISOString()
    }
};

// تحميل قاعدة البيانات
async function loadDatabase() {
    try {
        const data = await fs.readFile(DB_PATH, 'utf8');
        const parsed = JSON.parse(data);
        DB.users = new Map(Object.entries(parsed.users || {}));
        DB.projects = new Map(Object.entries(parsed.projects || {}));
        DB.stats = { ...DB.stats, ...(parsed.stats || {}) };
        console.log('✅ Database loaded:', DB.projects.size, 'projects');
    } catch (err) {
        console.log('📝 New database initialized');
        await saveDatabase();
    }
}

// حفظ قاعدة البيانات مع نسخ احتياطي
async function saveDatabase() {
    try {
        const data = {
            users: Object.fromEntries(DB.users),
            projects: Object.fromEntries(DB.projects),
            stats: DB.stats,
            lastSave: new Date().toISOString(),
            version: CONFIG.version
        };
        
        try {
            await fs.copyFile(DB_PATH, BACKUP_PATH);
        } catch (e) {
            // ignore backup error
        }
        
        await fs.writeFile(DB_PATH, JSON.stringify(data, null, 2));
        DB.stats.lastUpdate = new Date().toISOString();
    } catch (err) {
        console.error('❌ Database save error:', err);
    }
}

// Auto-save every 5 minutes
setInterval(saveDatabase, 5 * 60 * 1000);

// ==================== HELPERS ====================
function getBaseUrl() {
    return CONFIG.tunnelUrl || `http://${LOCAL_IP}:${PORT}`;
}

async function generateQRCode(url, options = {}) {
    const cacheKey = `qr_${url}`;
    let qr = cache.get(cacheKey);
    
    if (!qr) {
        qr = await QRCode.toDataURL(url, {
            width: options.width || 500,
            margin: 2,
            color: { 
                dark: options.color || '#6366f1', 
                light: '#ffffff'
            },
            errorCorrectionLevel: 'H'
        });
        cache.set(cacheKey, qr, CONFIG.qrCacheTime);
    }
    return qr;
}

// Validation helper
function validateInput(data) {
    const errors = [];
    
    if (data.email && !validator.isEmail(data.email)) {
        errors.push('بريد إلكتروني غير صالح');
    }
    
    if (data.name && !/^[a-zA-Z0-9-]{3,30}$/.test(data.name)) {
        errors.push('اسم المشروع يجب أن يكون 3-30 حرف إنجليزي أو رقم أو شرطة');
    }
    
    if (data.phone && !validator.isMobilePhone(data.phone, 'any')) {
        errors.push('رقم هاتف غير صالح');
    }
    
    return errors;
}

function generateProjectTemplate(name, email, urls, type = 'web') {
    const now = new Date().toLocaleDateString('ar-SA');
    const isBot = type.startsWith('bot-');
    
    return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${name} | NOHO Project</title>
    <meta name="description" content="تم إنشاء هذا المشروع بواسطة NOHO Community">
    <meta name="author" content="${email}">
    <meta name="theme-color" content="#6366f1">
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { 
            font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
            background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%);
            color: #f8fafc;
            min-height: 100vh;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            padding: 2rem;
            line-height: 1.6;
        }
        .container {
            background: rgba(255,255,255,0.05);
            backdrop-filter: blur(20px);
            border-radius: 24px;
            padding: 3rem;
            max-width: 600px;
            width: 100%;
            text-align: center;
            box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
            border: 1px solid rgba(255,255,255,0.1);
            animation: fadeIn 0.8s ease-out;
        }
        @keyframes fadeIn {
            from { opacity: 0; transform: translateY(30px); }
            to { opacity: 1; transform: translateY(0); }
        }
        h1 { 
            font-size: 2.5rem; 
            margin-bottom: 0.5rem;
            background: linear-gradient(135deg, #6366f1 0%, #ec4899 100%);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
        }
        .subtitle { 
            font-size: 1.1rem; 
            color: #94a3b8; 
            margin-bottom: 2rem; 
        }
        .info { 
            background: rgba(0,0,0,0.2); 
            padding: 1.5rem; 
            border-radius: 16px; 
            margin: 2rem 0;
            font-size: 0.95rem;
            text-align: right;
        }
        .info-row {
            display: flex;
            justify-content: space-between;
            padding: 0.5rem 0;
            border-bottom: 1px solid rgba(255,255,255,0.05);
        }
        .info-row:last-child { border-bottom: none; }
        .links { 
            display: grid; 
            grid-template-columns: 1fr 1fr; 
            gap: 1rem; 
            margin-top: 2rem; 
        }
        .btn {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            gap: 0.5rem;
            padding: 1rem 1.5rem;
            border-radius: 12px;
            text-decoration: none;
            font-weight: 600;
            transition: all 0.3s;
            border: none;
            cursor: pointer;
            font-size: 0.95rem;
        }
        .btn:hover { 
            transform: translateY(-2px); 
            box-shadow: 0 10px 25px rgba(0,0,0,0.3);
        }
        .btn-edit { 
            background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%); 
            color: white; 
        }
        .btn-download { 
            background: rgba(255,255,255,0.1); 
            color: white; 
            border: 2px solid rgba(255,255,255,0.2);
        }
        .btn-whatsapp {
            background: linear-gradient(135deg, #25d366 0%, #128c7e 100%);
            color: white;
            grid-column: 1 / -1;
        }
        footer { 
            margin-top: 3rem; 
            color: #64748b; 
            font-size: 0.875rem; 
        }
        .badge {
            display: inline-block;
            background: rgba(99, 102, 241, 0.2);
            color: #6366f1;
            padding: 0.5rem 1rem;
            border-radius: 50px;
            font-size: 0.8rem;
            font-weight: 700;
            margin-bottom: 1rem;
            border: 1px solid rgba(99, 102, 241, 0.3);
        }
        .status-badge {
            display: inline-flex;
            align-items: center;
            gap: 0.5rem;
            color: #10b981;
        }
        .status-badge::before {
            content: '';
            width: 8px;
            height: 8px;
            background: #10b981;
            border-radius: 50%;
            animation: pulse 2s infinite;
        }
        @keyframes pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.5; }
        }
        @media (max-width: 600px) {
            h1 { font-size: 1.75rem; }
            .container { padding: 1.5rem; }
            .links { grid-template-columns: 1fr; }
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="badge">${isBot ? '🤖 بوت ذكي' : '🚀 موقع ويب'}</div>
        <h1>${name}</h1>
        <p class="subtitle">تم الإنشاء بنجاح بواسطة NOHO</p>
        
        <div class="info">
            <div class="info-row">
                <span>المطور:</span>
                <strong>${email}</strong>
            </div>
            <div class="info-row">
                <span>التاريخ:</span>
                <strong>${now}</strong>
            </div>
            <div class="info-row">
                <span>الحالة:</span>
                <span class="status-badge">نشط</span>
            </div>
            <div class="info-row">
                <span>الدعم:</span>
                <strong dir="ltr">${CONFIG.adminPhone}</strong>
            </div>
        </div>

        <div class="links">
            <a href="${urls.dev}" class="btn btn-edit">
                <span>✏️</span> تعديل المشروع
            </a>
            <a href="${urls.download}" class="btn btn-download">
                <span>📥</span> تحميل الملفات
            </a>
            <a href="${CONFIG.whatsappLink}?text=استفسار عن مشروع ${name}" class="btn btn-whatsapp" target="_blank">
                <span>💬</span> تواصل مع الدعم (${CONFIG.adminPhone})
            </a>
        </div>

        <footer>
            <p>© ${new Date().getFullYear()} NOHO Community</p>
            <p style="margin-top: 0.5rem;">Project ID: ${urls.projectId}</p>
        </footer>
    </div>

    <script src="/socket.io/socket.io.js"></script>
    <script>
        // Visit tracking
        fetch('/api/projects/${urls.projectId}/visit', { 
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        }).catch(() => {});
        
        // Real-time updates
        const socket = io();
        socket.on('project-update', (data) => {
            if (data.projectId === '${urls.projectId}') {
                console.log('🔄 Project updated:', data);
                if (document.visibilityState === 'visible') {
                    setTimeout(() => location.reload(), 3000);
                }
            }
        });
        
        socket.emit('project-online', { projectId: '${urls.projectId}', time: new Date() });
    </script>
</body>
</html>`;
}

// ==================== API ROUTES ====================

// Create Project
app.post('/api/projects/create', async (req, res) => {
    try {
        const { name, type, email, phone } = req.body;
        
        // Validation
        const errors = validateInput({ name, email, phone });
        if (errors.length > 0) {
            return res.status(400).json({ 
                success: false,
                error: errors.join('، '),
                code: 'VALIDATION_ERROR'
            });
        }
        
        const projectId = name.toLowerCase().replace(/[^a-z0-9-]/g, '');
        
        if (projectId.length < 3) {
            return res.status(400).json({ 
                success: false,
                error: 'الاسم قصير جداً (3 أحرف على الأقل)',
                code: 'SHORT_NAME'
            });
        }
        
        if (DB.projects.has(projectId)) {
            const suggestion = `${projectId}-${Date.now().toString(36).slice(-4)}`;
            return res.status(409).json({ 
                success: false,
                error: 'الاسم مستخدم بالفعل',
                suggestion,
                code: 'DUPLICATE_NAME'
            });
        }

        const userProjects = Array.from(DB.projects.values()).filter(p => p.email === email);
        if (userProjects.length >= CONFIG.maxProjectsPerUser) {
            return res.status(403).json({
                success: false,
                error: `لديك ${CONFIG.maxProjectsPerUser} مشاريع بالفعل. تواصل مع الدعم للترقية.`,
                contact: CONFIG.whatsappLink,
                code: 'LIMIT_REACHED'
            });
        }

        const baseUrl = getBaseUrl();
        const projectSecret = uuidv4();
        
        const urls = {
            projectId,
            global: CONFIG.tunnelUrl ? `${CONFIG.tunnelUrl}/projects/${projectId}` : null,
            private: `${baseUrl}/projects/${projectId}`,
            download: `${baseUrl}/api/projects/${projectId}/download?token=${projectSecret}`,
            dev: `${baseUrl}/edit/${projectId}?token=${projectSecret}`,
            view: `${baseUrl}/projects/${projectId}`,
            qr: `${baseUrl}/api/projects/${projectId}/qr`
        };

        const project = {
            id: projectId,
            name,
            type: type || 'web',
            email,
            phone: phone || CONFIG.adminPhone,
            secret: projectSecret,
            urls,
            stats: { 
                visits: 0, 
                lastVisit: null, 
                createdAt: new Date().toISOString(),
                lastModified: null,
                downloads: 0
            },
            files: ['index.html'],
            meta: {
                version: CONFIG.version,
                ip: req.ip,
                userAgent: req.headers['user-agent']
            }
        };

        DB.projects.set(projectId, project);
        DB.stats.totalCreates++;
        
        const projectDir = path.join(__dirname, 'projects', projectId);
        await fs.mkdir(projectDir, { recursive: true });
        
        const htmlContent = generateProjectTemplate(name, email, urls, type);
        await fs.writeFile(path.join(projectDir, 'index.html'), htmlContent);
        
        const qrTarget = urls.global || urls.private;
        const qrCode = await generateQRCode(qrTarget, { color: '#6366f1' });
        
        io.emit('new-project', { 
            projectId, 
            name, 
            email, 
            type,
            time: new Date(),
            total: DB.projects.size 
        });
        
        await saveDatabase();

        res.status(201).json({
            success: true,
            projectId,
            urls,
            qrCode,
            stats: {
                totalProjects: DB.projects.size,
                userProjects: userProjects.length + 1
            },
            message: 'تم الإنشاء بنجاح',
            support: {
                phone: CONFIG.adminPhone,
                whatsapp: CONFIG.whatsappLink
            }
        });

    } catch (error) {
        console.error('❌ Create error:', error);
        res.status(500).json({ 
            success: false,
            error: 'خطأ في السيرفر',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

// Get Project QR
app.get('/api/projects/:projectId/qr', async (req, res) => {
    try {
        const { projectId } = req.params;
        const { color, size } = req.query;
        const project = DB.projects.get(projectId);
        
        if (!project) return res.status(404).json({ error: 'غير موجود' });
        
        const url = project.urls.global || project.urls.private;
        const qr = await generateQRCode(url, { 
            color: color || '#6366f1',
            width: parseInt(size) || 500
        });
        
        const base64Data = qr.replace(/^data:image\/png;base64,/, "");
        const imgBuffer = Buffer.from(base64Data, 'base64');
        
        res.set('Content-Type', 'image/png');
        res.send(imgBuffer);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get Project Info
app.get('/api/projects/:projectId/info', async (req, res) => {
    const project = DB.projects.get(req.params.projectId);
    if (!project) return res.status(404).json({ error: 'غير موجود' });
    
    const isOwner = req.query.token === project.secret;
    
    res.json({
        ...project,
        secret: undefined,
        isOwner,
        urls: isOwner ? project.urls : { view: project.urls.view }
    });
});

// Track Visit
app.post('/api/projects/:projectId/visit', async (req, res) => {
    const project = DB.projects.get(req.params.projectId);
    if (project) {
        project.stats.visits++;
        project.stats.lastVisit = new Date().toISOString();
        DB.stats.totalVisits++;
        
        io.to(project.id).emit('new-visit', {
            time: new Date(),
            total: project.stats.visits
        });
        
        res.json({ success: true, total: project.stats.visits });
    } else {
        res.status(404).json({ error: 'غير موجود' });
    }
});

// Download ZIP
app.get('/api/projects/:projectId/download', async (req, res) => {
    try {
        const { projectId } = req.params;
        const { token } = req.query;
        const project = DB.projects.get(projectId);
        
        if (!project) return res.status(404).send('المشروع غير موجود');
        if (token !== project.secret) return res.status(403).send('رابط التحميل غير صالح');

        const projectDir = path.join(__dirname, 'projects', projectId);
        
        try {
            await fs.access(projectDir);
        } catch {
            return res.status(404).send('ملفات المشروع غير موجودة');
        }
        
        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Content-Disposition', `attachment; filename=${projectId}_noho.zip`);
        
        const archive = archiver('zip', { 
            zlib: { level: 9 },
            store: true
        });
        
        archive.on('error', (err) => {
            res.status(500).send({ error: err.message });
        });
        
        archive.on('warning', (err) => {
            if (err.code === 'ENOENT') {
                console.warn('Archive warning:', err);
            } else {
                throw err;
            }
        });
        
        archive.pipe(res);
        
        const readme = `# ${project.name}
Created by: ${project.email}
Date: ${project.stats.createdAt}
Support: ${CONFIG.adminPhone}

Links:
- View: ${project.urls.view}
- Edit: ${project.urls.dev}
`;
        archive.append(readme, { name: 'README.txt' });
        
        archive.directory(projectDir, false);
        await archive.finalize();
        
        project.stats.downloads = (project.stats.downloads || 0) + 1;
        DB.stats.totalDownloads++;
        await saveDatabase();
        
    } catch (err) {
        console.error('Download error:', err);
        res.status(500).send('خطأ في التحميل');
    }
});

// Update Project
app.post('/api/projects/:projectId/update', async (req, res) => {
    try {
        const { projectId } = req.params;
        const { code, token } = req.body;
        const project = DB.projects.get(projectId);
        
        if (!project) return res.status(404).json({ error: 'غير موجود' });
        if (token !== project.secret) return res.status(403).json({ error: 'غير مصرح' });
        
        if (!code || typeof code !== 'string') {
            return res.status(400).json({ error: 'الكود مطلوب' });
        }
        
        if (code.length > 1000000) {
            return res.status(400).json({ error: 'حجم الكود كبير جداً' });
        }
        
        const projectDir = path.join(__dirname, 'projects', projectId);
        await fs.writeFile(path.join(projectDir, 'index.html'), code, 'utf8');
        
        project.stats.lastModified = new Date().toISOString();
        await saveDatabase();
        
        io.emit('project-update', { 
            projectId, 
            time: new Date(),
            modifiedBy: req.ip 
        });
        
        res.json({ 
            success: true, 
            message: 'تم التحديث بنجاح',
            lastModified: project.stats.lastModified
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Delete Project
app.delete('/api/projects/:projectId', async (req, res) => {
    const { projectId } = req.params;
    const { token } = req.body;
    const project = DB.projects.get(projectId);
    
    if (!project) return res.status(404).json({ error: 'غير موجود' });
    if (token !== project.secret) return res.status(403).json({ error: 'غير مصرح' });
    
    try {
        const projectDir = path.join(__dirname, 'projects', projectId);
        await fs.rm(projectDir, { recursive: true, force: true });
        DB.projects.delete(projectId);
        await saveDatabase();
        
        io.emit('project-deleted', { projectId, time: new Date() });
        
        res.json({ 
            success: true, 
            message: 'تم الحذف بنجاح',
            recoveryNote: 'ملفات النسخ الاحتياطي محفوظة لمدة 7 أيام'
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Set Tunnel URL
app.post('/api/admin/set-tunnel', (req, res) => {
    const { url, key } = req.body;
    if (key !== 'noho-secret-key-2024') {
        return res.status(403).json({ error: 'مفتاح خاطئ' });
    }
    CONFIG.tunnelUrl = url;
    console.log('🌍 Global URL updated:', url);
    res.json({ 
        success: true, 
        message: 'تم تحديث الرابط العالمي',
        newUrl: url
    });
});

// Get Stats
app.get('/api/stats', (req, res) => {
    const projects = Array.from(DB.projects.values()).map(p => ({
        ...p,
        secret: undefined,
        urls: {
            view: p.urls.view,
            global: p.urls.global
        }
    }));
    
    res.json({
        success: true,
        total: DB.projects.size,
        stats: DB.stats,
        config: {
            maxProjectsPerUser: CONFIG.maxProjectsPerUser,
            supportPhone: CONFIG.adminPhone,
            supportWhatsapp: CONFIG.whatsappLink
        },
        server: {
            local: `http://localhost:${PORT}`,
            global: CONFIG.tunnelUrl || null,
            uptime: process.uptime(),
            version: CONFIG.version,
            memory: process.memoryUsage()
        },
        projects: projects.slice(-50).reverse()
    });
});

// Search Projects
app.get('/api/projects/search', (req, res) => {
    const { q } = req.query;
    if (!q || q.length < 2) return res.json([]);
    
    const results = Array.from(DB.projects.values())
        .filter(p => 
            p.name.toLowerCase().includes(q.toLowerCase()) || 
            p.id.toLowerCase().includes(q.toLowerCase()) ||
            p.email.toLowerCase().includes(q.toLowerCase())
        )
        .slice(0, 10);
    
    res.json(results.map(p => ({ 
        ...p, 
        secret: undefined,
        urls: { view: p.urls.view }
    })));
});

// ==================== PAGES ====================

// Edit Page
app.get('/edit/:projectId', async (req, res) => {
    const { projectId } = req.params;
    const { token } = req.query;
    const project = DB.projects.get(projectId);
    
    if (!project) return res.status(404).send('المشروع غير موجود');
    if (token !== project.secret) {
        return res.send(`
            <script>
                alert('رابط التعديل غير صالح أو منتهي الصلاحية');
                window.location.href = '${project.urls.view}';
            </script>
        `);
    }

    res.send(`
<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>تعديل ${project.name} | NOHO Editor</title>
    <link href="https://fonts.googleapis.com/css2?family=Tajawal:wght@400;700&family=Fira+Code:wght@400;500&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { 
            font-family: 'Tajawal', sans-serif;
            background: #0f172a;
            color: #e2e8f0;
            min-height: 100vh;
            overflow-x: hidden;
        }
        .header {
            background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%);
            padding: 1rem 2rem;
            display: flex;
            justify-content: space-between;
            align-items: center;
            position: sticky;
            top: 0;
            z-index: 100;
            box-shadow: 0 4px 20px rgba(0,0,0,0.3);
        }
        .header h2 { font-size: 1.25rem; display: flex; align-items: center; gap: 0.5rem; }
        .header-actions { display: flex; gap: 0.5rem; }
        .container { max-width: 1400px; margin: 0 auto; padding: 1.5rem; }
        .editor-layout {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 1.5rem;
            height: calc(100vh - 200px);
        }
        .panel {
            background: #1e293b;
            border-radius: 16px;
            overflow: hidden;
            display: flex;
            flex-direction: column;
            border: 1px solid #334155;
        }
        .panel-header {
            background: #334155;
            padding: 0.75rem 1rem;
            display: flex;
            justify-content: space-between;
            align-items: center;
            font-size: 0.875rem;
        }
        textarea {
            flex: 1;
            width: 100%;
            background: #0f172a;
            border: none;
            padding: 1rem;
            color: #e2e8f0;
            font-family: 'Fira Code', monospace;
            font-size: 14px;
            line-height: 1.6;
            resize: none;
            outline: none;
        }
        .preview-frame {
            flex: 1;
            width: 100%;
            border: none;
            background: white;
        }
        .btn {
            padding: 0.5rem 1rem;
            border: none;
            border-radius: 8px;
            cursor: pointer;
            font-family: 'Tajawal', sans-serif;
            font-weight: 700;
            display: inline-flex;
            align-items: center;
            gap: 0.5rem;
            transition: all 0.2s;
            font-size: 0.875rem;
        }
        .btn:hover { transform: translateY(-1px); }
        .btn:active { transform: translateY(0); }
        .btn-primary { background: #6366f1; color: white; }
        .btn-success { background: #10b981; color: white; }
        .btn-warning { background: #f59e0b; color: white; }
        .btn-danger { background: #ef4444; color: white; }
        .btn-secondary { background: #475569; color: white; }
        
        .toolbar {
            display: flex;
            gap: 0.5rem;
            margin-bottom: 1rem;
            flex-wrap: wrap;
        }
        .stats-bar {
            background: #1e293b;
            padding: 0.75rem;
            border-radius: 12px;
            margin-bottom: 1rem;
            display: flex;
            gap: 2rem;
            font-size: 0.875rem;
            color: #94a3b8;
        }
        .stat-item { display: flex; align-items: center; gap: 0.5rem; }
        .status-toast {
            position: fixed;
            bottom: 2rem;
            right: 2rem;
            padding: 1rem 1.5rem;
            border-radius: 12px;
            color: white;
            font-weight: 600;
            display: none;
            align-items: center;
            gap: 0.75rem;
            box-shadow: 0 10px 40px rgba(0,0,0,0.4);
            animation: slideUp 0.3s ease;
        }
        @keyframes slideUp {
            from { transform: translateY(100px); opacity: 0; }
            to { transform: translateY(0); opacity: 1; }
        }
        .status-toast.show { display: flex; }
        .status-toast.success { background: #10b981; }
        .status-toast.error { background: #ef4444; }
        .status-toast.info { background: #3b82f6; }
        
        @media (max-width: 1024px) {
            .editor-layout { grid-template-columns: 1fr; height: auto; }
            .panel { height: 400px; }
        }
        .shortcuts {
            font-size: 0.75rem;
            color: #64748b;
            margin-top: 0.5rem;
        }
        kbd {
            background: #334155;
            padding: 0.125rem 0.5rem;
            border-radius: 4px;
            font-family: monospace;
        }
    </style>
</head>
<body>
    <div class="header">
        <h2>
            <i class="fas fa-code"></i>
            ${project.name}
            <span style="font-size: 0.75rem; opacity: 0.8; font-weight: 400;">(${projectId})</span>
        </h2>
        <div class="header-actions">
            <button class="btn btn-success" onclick="saveCode()">
                <i class="fas fa-save"></i> حفظ (Ctrl+S)
            </button>
            <button class="btn btn-secondary" onclick="previewOnly()">
                <i class="fas fa-eye"></i> معاينة
            </button>
            <a href="${project.urls.view}" target="_blank" class="btn btn-primary" style="text-decoration: none;">
                <i class="fas fa-external-link-alt"></i> فتح الموقع
            </a>
        </div>
    </div>
    
    <div class="container">
        <div class="stats-bar">
            <div class="stat-item">
                <i class="fas fa-eye" style="color: #6366f1;"></i>
                <span id="visitCount">${project.stats.visits || 0} زيارة</span>
            </div>
            <div class="stat-item">
                <i class="fas fa-calendar" style="color: #10b981;"></i>
                <span>إنشاء: ${new Date(project.stats.createdAt).toLocaleDateString('ar-SA')}</span>
            </div>
            <div class="stat-item">
                <i class="fas fa-edit" style="color: #f59e0b;"></i>
                <span id="lastModified">آخر تعديل: ${project.stats.lastModified ? new Date(project.stats.lastModified).toLocaleDateString('ar-SA') : 'لم يعدل بعد'}</span>
            </div>
        </div>
        
        <div class="toolbar">
            <button class="btn btn-secondary" onclick="formatCode()">
                <i class="fas fa-align-left"></i> تنسيق
            </button>
            <button class="btn btn-secondary" onclick="undo()">
                <i class="fas fa-undo"></i> تراجع
            </button>
            <button class="btn btn-secondary" onclick="insertTemplate()">
                <i class="fas fa-magic"></i> إدراج قالب
            </button>
            <button class="btn btn-warning" onclick="downloadCode()">
                <i class="fas fa-download"></i> تحميل الكود
            </button>
            <button class="btn btn-danger" onclick="resetCode()">
                <i class="fas fa-trash"></i> استعادة أصلي
            </button>
            <div style="flex: 1;"></div>
            <button class="btn btn-primary" onclick="openWhatsapp()">
                <i class="fab fa-whatsapp"></i> دعم فني (${CONFIG.adminPhone})
            </button>
        </div>
        
        <div class="editor-layout">
            <div class="panel">
                <div class="panel-header">
                    <span><i class="fas fa-code"></i> HTML Code</span>
                    <span id="charCount">0 chars</span>
                </div>
                <textarea id="codeEditor" spellcheck="false" placeholder="<!-- ابدأ الكتابة هنا -->"></textarea>
            </div>
            
            <div class="panel">
                <div class="panel-header">
                    <span><i class="fas fa-desktop"></i> Preview</span>
                    <div>
                        <button class="btn btn-secondary" style="padding: 0.25rem 0.5rem; font-size: 0.75rem;" onclick="changeViewport('mobile')">
                            <i class="fas fa-mobile-alt"></i>
                        </button>
                        <button class="btn btn-secondary" style="padding: 0.25rem 0.5rem; font-size: 0.75rem;" onclick="changeViewport('desktop')">
                            <i class="fas fa-desktop"></i>
                        </button>
                    </div>
                </div>
                <iframe id="previewFrame" class="preview-frame"></iframe>
            </div>
        </div>
        
        <div class="shortcuts">
            اختصارات: <kbd>Ctrl</kbd> + <kbd>S</kbd> حفظ | 
            <kbd>Ctrl</kbd> + <kbd>Enter</kbd> معاينة | 
            <kbd>Ctrl</kbd> + <kbd>Z</kbd> تراجع
        </div>
    </div>
    
    <div class="status-toast" id="statusToast"></div>

    <script src="/socket.io/socket.io.js"></script>
    <script>
        const projectId = '${projectId}';
        const token = '${token}';
        const editor = document.getElementById('codeEditor');
        const preview = document.getElementById('previewFrame');
        const statusToast = document.getElementById('statusToast');
        let originalCode = '';
        let history = [];
        let historyIndex = -1;
        
        const socket = io();
        socket.emit('join-project', projectId);
        
        socket.on('new-visit', (data) => {
            document.getElementById('visitCount').textContent = data.total + ' زيارة';
            showToast('زيارة جديدة!', 'info');
        });
        
        async function loadCode() {
            try {
                const res = await fetch('/projects/' + projectId + '/index.html');
                const code = await res.text();
                editor.value = code;
                originalCode = code;
                addToHistory(code);
                updatePreview();
                updateCharCount();
            } catch (err) {
                showToast('خطأ في التحميل', 'error');
            }
        }
        
        function addToHistory(code) {
            history = history.slice(0, historyIndex + 1);
            history.push(code);
            historyIndex++;
        }
        
        function undo() {
            if (historyIndex > 0) {
                historyIndex--;
                editor.value = history[historyIndex];
                updatePreview();
            }
        }
        
        editor.addEventListener('input', () => {
            updateCharCount();
            clearTimeout(window.saveTimeout);
            window.saveTimeout = setTimeout(() => {
                addToHistory(editor.value);
            }, 1000);
        });
        
        function updateCharCount() {
            document.getElementById('charCount').textContent = editor.value.length.toLocaleString() + ' chars';
        }
        
        function updatePreview() {
            preview.srcdoc = editor.value;
        }
        
        function previewOnly() {
            updatePreview();
            showToast('تم تحديث المعاينة', 'success');
        }
        
        async function saveCode() {
            const code = editor.value;
            try {
                const res = await fetch('/api/projects/' + projectId + '/update', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ code, token })
                });
                
                if (res.ok) {
                    const data = await res.json();
                    showToast('✅ تم الحفظ بنجاح', 'success');
                    document.getElementById('lastModified').textContent = 'آخر تعديل: ' + new Date().toLocaleDateString('ar-SA');
                    originalCode = code;
                    updatePreview();
                } else {
                    const err = await res.json();
                    showToast('❌ ' + (err.error || 'فشل الحفظ'), 'error');
                }
            } catch (err) {
                showToast('❌ خطأ في الاتصال', 'error');
            }
        }
        
        function showToast(msg, type) {
            statusToast.textContent = msg;
            statusToast.className = 'status-toast ' + type + ' show';
            setTimeout(() => statusToast.classList.remove('show'), 3000);
        }
        
        function formatCode() {
            let code = editor.value;
            code = code.replace(/>\\s+</g, '>\\n<');
            code = code.replace(/(<[^/][^>]*>)/g, '\\n$1');
            editor.value = code.trim();
            updatePreview();
            showToast('تم التنسيق', 'success');
        }
        
        function insertTemplate() {
            const template = \`
<div style="text-align: center; padding: 2rem;">
    <h1 style="color: #6366f1;">عنوان جديد</h1>
    <p>نص تجريبي هنا...</p>
    <button style="padding: 1rem 2rem; background: #6366f1; color: white; border: none; border-radius: 8px; cursor: pointer;">
        زر تفاعلي
    </button>
</div>\`;
            const pos = editor.selectionStart;
            editor.value = editor.value.slice(0, pos) + template + editor.value.slice(pos);
            updatePreview();
        }
        
        function downloadCode() {
            const blob = new Blob([editor.value], { type: 'text/html' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = '${projectId}_backup.html';
            a.click();
            URL.revokeObjectURL(url);
            showToast('تم التحميل', 'success');
        }
        
        function resetCode() {
            if (confirm('استعادة الملف الأصلي؟ سيتم فقدان التغييرات الحالية.')) {
                editor.value = originalCode;
                updatePreview();
                showToast('تم الاستعادة', 'success');
            }
        }
        
        function changeViewport(type) {
            preview.style.maxWidth = type === 'mobile' ? '375px' : '100%';
            preview.style.margin = type === 'mobile' ? '0 auto' : '0';
        }
        
        function openWhatsapp() {
            window.open('${CONFIG.whatsappLink}?text=استفسار عن مشروع ${project.name}', '_blank');
        }
        
        editor.addEventListener('keydown', (e) => {
            if (e.ctrlKey || e.metaKey) {
                if (e.key === 's') {
                    e.preventDefault();
                    saveCode();
                } else if (e.key === 'Enter') {
                    e.preventDefault();
                    updatePreview();
                } else if (e.key === 'z') {
                    e.preventDefault();
                    undo();
                }
            }
            
            if (e.key === 'Tab') {
                e.preventDefault();
                const start = editor.selectionStart;
                const end = editor.selectionEnd;
                editor.value = editor.value.substring(0, start) + '    ' + editor.value.substring(end);
                editor.selectionStart = editor.selectionEnd = start + 4;
            }
        });
        
        setInterval(() => {
            if (editor.value !== originalCode) {
                saveCode();
            }
        }, 30000);
        
        window.addEventListener('beforeunload', (e) => {
            if (editor.value !== originalCode) {
                e.preventDefault();
                e.returnValue = '';
            }
        });
        
        loadCode();
    </script>
</body>
</html>
    `);
});

// Main Interface
app.get('/', (req, res) => {
    res.send(`
<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>NOHO Community PRO v${CONFIG.version}</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link href="https://fonts.googleapis.com/css2?family=Tajawal:wght@400;700;900&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        :root {
            --primary: #6366f1;
            --secondary: #ec4899;
            --dark: #0f172a;
            --light: #f8fafc;
        }
        body { 
            font-family: 'Tajawal', sans-serif; 
            background: var(--dark); 
            color: var(--light); 
            min-height: 100vh;
            line-height: 1.6;
        }
        .hero { 
            text-align: center; 
            padding: 5rem 2rem; 
            background: linear-gradient(135deg, #6366f1 0%, #ec4899 100%);
            position: relative;
            overflow: hidden;
        }
        .hero::before {
            content: '';
            position: absolute;
            top: 0; left: 0; right: 0; bottom: 0;
            background: url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23ffffff' fill-opacity='0.08'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E");
            opacity: 0.1;
        }
        .hero h1 { 
            font-size: 4rem; 
            margin-bottom: 1rem;
            font-weight: 900;
            position: relative;
        }
        .hero p { font-size: 1.25rem; opacity: 0.95; position: relative; }
        .container { max-width: 1000px; margin: 0 auto; padding: 3rem 2rem; }
        .card { 
            background: rgba(255,255,255,0.03); 
            border-radius: 24px; 
            padding: 2.5rem; 
            margin-bottom: 2rem; 
            border: 1px solid rgba(255,255,255,0.08);
            box-shadow: 0 20px 50px rgba(0,0,0,0.3);
        }
        .card h2 { 
            margin-bottom: 1.5rem; 
            display: flex; 
            align-items: center; 
            gap: 0.75rem;
            color: #e2e8f0;
        }
        input, select { 
            width: 100%; 
            padding: 1rem 1.25rem; 
            margin: 0.75rem 0; 
            border-radius: 12px; 
            border: 2px solid rgba(255,255,255,0.1); 
            background: rgba(0,0,0,0.2); 
            color: #fff; 
            font-family: 'Tajawal', sans-serif;
            font-size: 1rem;
            transition: border-color 0.3s;
        }
        input:focus, select:focus {
            outline: none;
            border-color: var(--primary);
        }
        input::placeholder { color: #64748b; }
        .btn { 
            padding: 1rem 2rem; 
            border: none; 
            border-radius: 12px; 
            cursor: pointer; 
            font-family: 'Tajawal'; 
            font-weight: 700; 
            font-size: 1.1rem; 
            transition: all 0.3s; 
            display: inline-flex;
            align-items: center;
            gap: 0.5rem;
        }
        .btn:hover { 
            transform: translateY(-2px); 
            box-shadow: 0 10px 30px rgba(0,0,0,0.3);
        }
        .btn-primary { 
            background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%); 
            color: white; 
            width: 100%;
        }
        .links-grid { 
            display: grid; 
            grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); 
            gap: 1.5rem; 
            margin-top: 2rem; 
        }
        .link-card { 
            background: rgba(255,255,255,0.03); 
            border: 2px solid; 
            border-radius: 20px; 
            padding: 2rem; 
            text-align: center;
            transition: transform 0.3s;
        }
        .link-card:hover { transform: translateY(-5px); }
        .link-card.global { border-color: #6366f1; }
        .link-card.private { border-color: #10b981; }
        .link-card.download { border-color: #f59e0b; }
        .link-card.dev { border-color: #ec4899; }
        .link-icon {
            width: 60px;
            height: 60px;
            border-radius: 16px;
            display: flex;
            align-items: center;
            justify-content: center;
            margin: 0 auto 1rem;
            font-size: 1.5rem;
            color: white;
        }
        .global .link-icon { background: #6366f1; }
        .private .link-icon { background: #10b981; }
        .download .link-icon { background: #f59e0b; }
        .dev .link-icon { background: #ec4899; }
        .hidden { display: none; }
        .qr-container { 
            background: white; 
            padding: 3rem; 
            border-radius: 24px; 
            text-align: center; 
            margin-top: 2rem;
            color: #0f172a;
        }
        .qr-container img { 
            max-width: 250px; 
            border-radius: 16px;
            box-shadow: 0 10px 40px rgba(0,0,0,0.1);
        }
        .live-stats { 
            position: fixed; 
            bottom: 2rem; 
            left: 2rem; 
            background: rgba(15, 23, 42, 0.95);
            padding: 1.25rem; 
            border-radius: 16px; 
            font-size: 0.9rem;
            border: 1px solid rgba(255,255,255,0.1);
            box-shadow: 0 10px 40px rgba(0,0,0,0.4);
            backdrop-filter: blur(10px);
        }
        .live-stats div { 
            display: flex; 
            align-items: center; 
            gap: 0.75rem;
            margin: 0.5rem 0;
        }
        .support-banner {
            background: linear-gradient(135deg, #25d366 0%, #128c7e 100%);
            color: white;
            padding: 1rem 2rem;
            border-radius: 12px;
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin-bottom: 2rem;
            flex-wrap: wrap;
            gap: 1rem;
        }
        .support-banner a {
            color: white;
            text-decoration: none;
            font-weight: 700;
            display: flex;
            align-items: center;
            gap: 0.5rem;
        }
        @media (max-width: 768px) { 
            .hero h1 { font-size: 2.5rem; } 
            .links-grid { grid-template-columns: 1fr; }
        }
        .loading {
            display: none;
            text-align: center;
            padding: 2rem;
        }
        .loading.active { display: block; }
        .spinner {
            width: 50px;
            height: 50px;
            border: 4px solid rgba(255,255,255,0.1);
            border-top-color: var(--primary);
            border-radius: 50%;
            animation: spin 1s linear infinite;
            margin: 0 auto 1rem;
        }
        @keyframes spin { to { transform: rotate(360deg); } }
    </style>
</head>
<body>
    <div class="hero">
        <h1>🚀 NOHO PRO v${CONFIG.version}</h1>
        <p>منصة إنشاء المشاريع والبوتات الذكية</p>
    </div>
    
    <div class="container">
        <div class="support-banner">
            <div>
                <i class="fas fa-headset" style="font-size: 1.5rem;"></i>
                <span>تحتاج مساعدة؟ تواصل مع الدعم الفني</span>
            </div>
            <a href="${CONFIG.whatsappLink}?text=مرحباً، أحتاج مساعدة" target="_blank">
                <i class="fab fa-whatsapp" style="font-size: 1.5rem;"></i>
                <span dir="ltr">${CONFIG.adminPhone}</span>
            </a>
        </div>
        
        <div class="card">
            <h2><i class="fas fa-plus-circle" style="color: var(--primary);"></i> إنشاء مشروع جديد</h2>
            <input type="text" id="projectName" placeholder="اسم المشروع (English فقط)" required>
            <input type="email" id="userEmail" placeholder="بريدك الإلكتروني" required>
            <input type="tel" id="userPhone" placeholder="رقم هاتفك (مثال: ${CONFIG.adminPhone})" value="${CONFIG.adminPhone}">
            <select id="projectType" style="cursor: pointer;">
                <option value="web">🌐 موقع ويب</option>
                <option value="store">🛒 متجر إلكتروني</option>
                <option value="portfolio">🎨 معرض أعمال</option>
                <option value="company">🏢 شركة</option>
                <option value="bot-whatsapp">🤖 بوت واتساب</option>
                <option value="bot-telegram">📱 بوت تيليجرام</option>
            </select>
            <button class="btn btn-primary" onclick="createProject()">
                <i class="fas fa-rocket"></i> إنشاء والحصول على 4 روابط + QR
            </button>
            
            <div class="loading" id="loading">
                <div class="spinner"></div>
                <p>جاري إنشاء المشروع...</p>
            </div>
        </div>
        
        <div id="result" class="hidden">
            <div class="card">
                <h2 style="color: #10b981;"><i class="fas fa-check-circle"></i> تم الإنشاء بنجاح!</h2>
                <div class="links-grid" id="linksContainer"></div>
                <div class="qr-container">
                    <h3 style="margin-bottom: 1rem;"><i class="fas fa-qrcode"></i> QR Code للمشاركة</h3>
                    <img id="qrImage" src="" alt="QR Code">
                    <p style="color: #64748b; margin-top: 1rem;">امسح الكود للزيارة السريعة</p>
                </div>
                <div style="margin-top: 2rem; text-align: center;">
                    <a href="#" onclick="location.reload()" class="btn btn-primary" style="text-decoration: none; width: auto;">
                        <i class="fas fa-plus"></i> إنشاء مشروع آخر
                    </a>
                </div>
            </div>
        </div>
    </div>
    
    <div class="live-stats" id="liveStats">
        <div><i class="fas fa-project-diagram" style="color: var(--primary);"></i> <span id="statProjects">0</span> مشروع</div>
        <div><i class="fas fa-eye" style="color: #10b981;"></i> <span id="statVisits">0</span> زيارة</div>
        <div><i class="fas fa-download" style="color: #f59e0b;"></i> <span id="statDownloads">0</span> تحميل</div>
    </div>

    <script src="/socket.io/socket.io.js"></script>
    <script>
        const socket = io();
        let currentProject = null;
        
        socket.on('stats-update', (stats) => {
            updateStats(stats);
        });
        
        socket.on('new-project', (data) => {
            showNotification('مشروع جديد: ' + data.name);
            updateStats({
                total: data.total,
                totalVisits: parseInt(document.getElementById('statVisits').textContent),
                totalDownloads: parseInt(document.getElementById('statDownloads').textContent)
            });
        });
        
        function updateStats(stats) {
            animateValue('statProjects', parseInt(document.getElementById('statProjects').textContent), stats.total || 0);
            animateValue('statVisits', parseInt(document.getElementById('statVisits').textContent), stats.totalVisits || 0);
            animateValue('statDownloads', parseInt(document.getElementById('statDownloads').textContent), stats.totalDownloads || 0);
        }
        
        function animateValue(id, start, end) {
            if (start === end) return;
            const obj = document.getElementById(id);
            const range = end - start;
            const duration = 1000;
            const startTime = performance.now();
            
            function update(currentTime) {
                const elapsed = currentTime - startTime;
                const progress = Math.min(elapsed / duration, 1);
                obj.textContent = Math.floor(start + (range * progress));
                if (progress < 1) requestAnimationFrame(update);
            }
            requestAnimationFrame(update);
        }
        
        function showNotification(msg) {
            if ('Notification' in window && Notification.permission === 'granted') {
                new Notification('NOHO Community', { body: msg, icon: '✨' });
            }
        }
        
        async function createProject() {
            const name = document.getElementById('projectName').value.trim();
            const email = document.getElementById('userEmail').value.trim();
            const phone = document.getElementById('userPhone').value.trim();
            const type = document.getElementById('projectType').value;
            
            if (!name || !email) {
                alert('⚠️ أكمل البيانات المطلوبة');
                return;
            }
            
            if (!/^[a-zA-Z0-9-]{3,30}$/.test(name)) {
                alert('⚠️ اسم المشروع يجب أن يكون 3-30 حرف إنجليزي أو رقم أو شرطة فقط');
                return;
            }
            
            document.getElementById('loading').classList.add('active');
            
            try {
                const res = await fetch('/api/projects/create', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name, email, phone, type })
                });
                
                const data = await res.json();
                document.getElementById('loading').classList.remove('active');
                
                if (data.success) {
                    currentProject = data;
                    showResults(data);
                    if ('Notification' in window && Notification.permission === 'default') {
                        Notification.requestPermission();
                    }
                } else {
                    alert('❌ ' + (data.error || 'فشل الإنشاء'));
                    if (data.suggestion) {
                        if (confirm('هل ت mean: ' + data.suggestion + '؟')) {
                            document.getElementById('projectName').value = data.suggestion;
                            createProject();
                        }
                    }
                }
            } catch (e) {
                document.getElementById('loading').classList.remove('active');
                alert('❌ خطأ في الاتصال بالسيرفر');
                console.error(e);
            }
        }
        
        function showResults(data) {
            document.getElementById('result').classList.remove('hidden');
            document.getElementById('qrImage').src = data.qrCode;
            
            const container = document.getElementById('linksContainer');
            const links = [
                { 
                    type: 'global', 
                    title: '🌐 رابط عالمي', 
                    url: data.urls.global, 
                    icon: 'globe', 
                    color: '#6366f1', 
                    show: !!data.urls.global,
                    desc: 'للنشر والمشاركة'
                },
                { 
                    type: 'private', 
                    title: '🏠 رابط خاص', 
                    url: data.urls.private, 
                    icon: 'home', 
                    color: '#10b981', 
                    show: true,
                    desc: 'للتجربة المحلية'
                },
                { 
                    type: 'download', 
                    title: '📥 تحميل ZIP', 
                    url: data.urls.download, 
                    icon: 'download', 
                    color: '#f59e0b', 
                    show: true,
                    desc: 'احتياطي للملفات'
                },
                { 
                    type: 'dev', 
                    title: '🔧 رابط المطور', 
                    url: data.urls.dev, 
                    icon: 'code', 
                    color: '#ec4899', 
                    show: true,
                    desc: 'للتعديل المباشر'
                }
            ];
            
            container.innerHTML = links.filter(l => l.show).map(link => \`
                <div class="link-card \${link.type}">
                    <div class="link-icon">
                        <i class="fas fa-\${link.icon}"></i>
                    </div>
                    <h3>\${link.title}</h3>
                    <p style="color: #94a3b8; font-size: 0.9rem; margin: 0.5rem 0;">\${link.desc}</p>
                    <div style="background: rgba(0,0,0,0.3); padding: 0.75rem; border-radius: 8px; margin: 1rem 0; font-family: monospace; font-size: 0.8rem; word-break: break-all; direction: ltr; color: #cbd5e1;">
                        \${link.url}
                    </div>
                    <button class="btn" style="background: \${link.color}; color: white; width: 100%; margin-bottom: 0.5rem;" onclick="copy('\${link.url}')">
                        <i class="fas fa-copy"></i> نسخ الرابط
                    </button>
                    <button class="btn" style="background: rgba(255,255,255,0.1); color: white; width: 100%;" onclick="window.open('\${link.url}')">
                        <i class="fas fa-external-link-alt"></i> فتح
                    </button>
                </div>
            \`).join('');
            
            document.getElementById('result').scrollIntoView({ behavior: 'smooth' });
        }
        
        function copy(text) {
            navigator.clipboard.writeText(text).then(() => {
                alert('✅ تم نسخ الرابط!');
            }).catch(() => {
                const textarea = document.createElement('textarea');
                textarea.value = text;
                document.body.appendChild(textarea);
                textarea.select();
                document.execCommand('copy');
                document.body.removeChild(textarea);
                alert('✅ تم النسخ!');
            });
        }
        
        fetch('/api/stats').then(r => r.json()).then(s => {
            if (s.success) updateStats(s.stats);
        });
    </script>
</body>
</html>
    `);
});

// Static files
app.use('/projects', express.static('projects', {
    dotfiles: 'deny',
    index: ['index.html']
}));

// 404 handler
app.use((req, res) => {
    res.status(404).send(`
        <div style="text-align: center; padding: 5rem; font-family: system-ui; background: #0f172a; color: #e2e8f0; min-height: 100vh; display: flex; flex-direction: column; align-items: center; justify-content: center;">
            <h1 style="font-size: 6rem; margin: 0; background: linear-gradient(135deg, #6366f1 0%, #ec4899 100%); -webkit-background-clip: text; -webkit-text-fill-color: transparent;">404</h1>
            <p style="font-size: 1.5rem; color: #64748b;">الصفحة غير موجودة</p>
            <a href="/" style="margin-top: 2rem; padding: 1rem 2rem; background: #6366f1; color: white; text-decoration: none; border-radius: 12px;">العودة للرئيسية</a>
            <div style="margin-top: 2rem; color: #475569;">
                للدعم: <a href="${CONFIG.whatsappLink}" style="color: #25d366;">${CONFIG.adminPhone}</a>
            </div>
        </div>
    `);
});

// Error handling
app.use((err, req, res, next) => {
    console.error('❌ Error:', err);
    res.status(500).json({ 
        error: 'خطأ في السيرفر',
        message: process.env.NODE_ENV === 'development' ? err.message : 'Internal Server Error',
        support: CONFIG.adminPhone
    });
});

// WebSocket handling
io.on('connection', (socket) => {
    console.log('⚡ Client connected:', socket.id);
    
    socket.on('join-project', (projectId) => {
        socket.join(projectId);
        console.log('👥 Joined project room:', projectId);
    });
    
    socket.on('disconnect', () => {
        console.log('🔌 Client disconnected:', socket.id);
    });
});

// Start server
server.listen(PORT, async () => {
    await loadDatabase();
    
    console.log(`
    ╔════════════════════════════════════════════════════════╗
    ║                                                        ║
    ║           🚀 NOHO PRO SERVER v${CONFIG.version}                  ║
    ║                                                        ║
    ╠════════════════════════════════════════════════════════╣
    ║  🌐 Local:    http://localhost:${PORT}                  ║
    ║  📱 Network:  http://${LOCAL_IP}:${PORT}                ║
    ║                                                        ║
    ║  📞 Support:  ${CONFIG.adminPhone}                    ║
    ║  💬 WhatsApp: ${CONFIG.whatsappLink}            ║
    ║                                                        ║
    ║  ✨ Features:                                          ║
    ║  • Auto-save Database (5min)                          ║
    ║  • Real-time WebSocket Updates                        ║
    ║  • QR Code Caching (1hour)                            ║
    ║  • Rate Limiting & Security                           ║
    ║  • XSS & Input Validation                             ║
    ║  • Backup System                                      ║
    ║  • 4 Links per Project + WhatsApp Support             ║
    ║                                                        ║
    ╚════════════════════════════════════════════════════════╝
    `);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
    console.log('⚠️ SIGTERM received, saving database...');
    await saveDatabase();
    server.close(() => {
        console.log('👋 Server closed');
        process.exit(0);
    });
});

process.on('SIGINT', async () => {
    console.log('\n⚠️ SIGINT received, saving database...');
    await saveDatabase();
    process.exit(0);
});
