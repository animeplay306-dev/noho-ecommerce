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

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });
const PORT = process.env.PORT || 3000;
const LOCAL_IP = process.env.LOCAL_IP || 'localhost';

// ==================== CONFIGURATION ====================
const CONFIG = {
    maxProjectsPerUser: 10,
    qrCacheTime: 3600, // 1 hour
    allowedTypes: ['web', 'bot-whatsapp', 'bot-telegram', 'bot-discord', 'store', 'portfolio'],
    devCredentials: { email: 'noho@no', password: 'noho' },
    tunnelUrl: null
};

// ==================== MIDDLEWARE ====================
app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false
}));
app.use(compression());
app.use(cors());
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static('public', { maxAge: '1d' }));

// Rate Limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // limit each IP to 100 requests per windowMs
    message: { error: 'كثرة الطلبات، جرب بعد 15 دقيقة' }
});
app.use('/api/', limiter);

// ==================== DATABASE (Persistent) ====================
const DB_PATH = './database.json';
const cache = new NodeCache({ stdTTL: 100, checkperiod: 120 });

const DB = {
    users: new Map(),
    projects: new Map(),
    stats: { totalVisits: 0, totalCreates: 0 }
};

async function loadDatabase() {
    try {
        const data = await fs.readFile(DB_PATH, 'utf8');
        const parsed = JSON.parse(data);
        DB.users = new Map(Object.entries(parsed.users || {}));
        DB.projects = new Map(Object.entries(parsed.projects || {}));
        DB.stats = parsed.stats || { totalVisits: 0, totalCreates: 0 };
        console.log('✅ Database loaded:', DB.projects.size, 'projects');
    } catch (err) {
        console.log('📝 New database initialized');
    }
}

async function saveDatabase() {
    const data = {
        users: Object.fromEntries(DB.users),
        projects: Object.fromEntries(DB.projects),
        stats: DB.stats,
        lastSave: new Date().toISOString()
    };
    await fs.writeFile(DB_PATH, JSON.stringify(data, null, 2));
}

// Auto-save every 5 minutes
setInterval(saveDatabase, 5 * 60 * 1000);

// ==================== HELPERS ====================
function getBaseUrl() {
    return CONFIG.tunnelUrl || `http://${LOCAL_IP}:${PORT}`;
}

async function generateQRCode(url) {
    const cacheKey = `qr_${url}`;
    let qr = cache.get(cacheKey);
    
    if (!qr) {
        qr = await QRCode.toDataURL(url, {
            width: 500,
            margin: 2,
            color: { 
                dark: '#6366f1', 
                light: '#ffffff'
            },
            errorCorrectionLevel: 'H'
        });
        cache.set(cacheKey, qr, CONFIG.qrCacheTime);
    }
    return qr;
}

function generateProjectTemplate(name, email, urls) {
    const now = new Date().toLocaleDateString('ar-SA');
    return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${name} | NOHO Project</title>
    <meta name="description" content="تم إنشاء هذا المشروع بواسطة NOHO Community">
    <meta name="author" content="${email}">
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { 
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            min-height: 100vh;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            padding: 2rem;
        }
        .container {
            background: rgba(255,255,255,0.1);
            backdrop-filter: blur(10px);
            border-radius: 30px;
            padding: 3rem;
            max-width: 600px;
            width: 100%;
            text-align: center;
            box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
            border: 1px solid rgba(255,255,255,0.2);
        }
        h1 { font-size: 3rem; margin-bottom: 1rem; text-shadow: 2px 2px 4px rgba(0,0,0,0.2); }
        .subtitle { font-size: 1.2rem; opacity: 0.9; margin-bottom: 2rem; }
        .info { 
            background: rgba(0,0,0,0.2); 
            padding: 1.5rem; 
            border-radius: 15px; 
            margin: 2rem 0;
            font-size: 0.9rem;
        }
        .links { display: grid; gap: 1rem; margin-top: 2rem; }
        .btn {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            gap: 0.5rem;
            padding: 1rem 2rem;
            border-radius: 12px;
            text-decoration: none;
            font-weight: 600;
            transition: transform 0.3s;
        }
        .btn:hover { transform: translateY(-2px); }
        .btn-edit { background: white; color: #764ba2; }
        .btn-download { background: rgba(255,255,255,0.2); color: white; border: 2px solid white; }
        footer { margin-top: 3rem; opacity: 0.7; font-size: 0.9rem; }
        .badge {
            display: inline-block;
            background: rgba(255,255,255,0.2);
            padding: 0.5rem 1rem;
            border-radius: 50px;
            font-size: 0.8rem;
            margin-bottom: 1rem;
        }
        @media (max-width: 600px) {
            h1 { font-size: 2rem; }
            .container { padding: 2rem; }
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="badge">🚀 NOHO Project</div>
        <h1>${name}</h1>
        <p class="subtitle">تم الإنشاء بنجاح</p>
        
        <div class="info">
            <p><strong>المطور:</strong> ${email}</p>
            <p><strong>التاريخ:</strong> ${now}</p>
            <p><strong>الحالة:</strong> <span style="color: #4ade80">● نشط</span></p>
        </div>

        <div class="links">
            <a href="${urls.dev}" class="btn btn-edit">
                <span>✏️</span> تعديل المشروع
            </a>
            <a href="${urls.download}" class="btn btn-download">
                <span>📥</span> تحميل الملفات
            </a>
        </div>

        <footer>
            <p>© ${new Date().getFullYear()} NOHO Community</p>
            <p style="margin-top: 0.5rem; font-size: 0.8rem;">Project ID: ${urls.projectId}</p>
        </footer>
    </div>

    <script>
        // Visit tracking
        fetch('/api/projects/${urls.projectId}/visit', { method: 'POST' }).catch(() => {});
        
        // Socket.io real-time updates
        const socket = io();
        socket.on('project-update', (data) => {
            if (data.projectId === '${urls.projectId}') {
                console.log('Project updated:', data);
            }
        });
    </script>
</body>
</html>`;
}

// ==================== API ROUTES ====================

// Create Project (الرابط الأساسي)
app.post('/api/projects/create', async (req, res) => {
    try {
        const { name, type, email } = req.body;
        
        // Validation
        if (!name || !email) {
            return res.status(400).json({ error: 'البيانات غير مكتملة' });
        }
        
        const projectId = name.toLowerCase().replace(/[^a-z0-9-]/g, '');
        
        if (projectId.length < 3) {
            return res.status(400).json({ error: 'الاسم قصير جداً (3 أحرف على الأقل)' });
        }
        
        if (DB.projects.has(projectId)) {
            return res.status(409).json({ error: 'الاسم مستخدم بالفعل', suggestion: `${projectId}-${Date.now().toString(36).substr(-4)}` });
        }

        const baseUrl = getBaseUrl();
        const projectSecret = uuidv4(); // للتعديلات المستقبلية
        
        // الـ 4 روابط
        const urls = {
            projectId,
            global: CONFIG.tunnelUrl ? `${CONFIG.tunnelUrl}/projects/${projectId}` : null,
            private: `${baseUrl}/projects/${projectId}`,
            download: `${baseUrl}/api/projects/${projectId}/download?token=${projectSecret}`,
            dev: `${baseUrl}/edit/${projectId}?token=${projectSecret}`,
            view: `${baseUrl}/projects/${projectId}`
        };

        const project = {
            id: projectId,
            name,
            type: type || 'web',
            email,
            secret: projectSecret,
            urls,
            stats: { visits: 0, lastVisit: null, createdAt: new Date().toISOString() },
            files: ['index.html']
        };

        DB.projects.set(projectId, project);
        DB.stats.totalCreates++;
        
        // إنشاء الملفات
        const projectDir = path.join(__dirname, 'projects', projectId);
        await fs.mkdir(projectDir, { recursive: true });
        
        const htmlContent = generateProjectTemplate(name, email, urls);
        await fs.writeFile(path.join(projectDir, 'index.html'), htmlContent);
        
        // QR Code للرابط العالمي أو الخاص
        const qrTarget = urls.global || urls.private;
        const qrCode = await generateQRCode(qrTarget);
        
        // Notify via WebSocket
        io.emit('new-project', { projectId, name, email, time: new Date() });
        
        // Save to disk
        await saveDatabase();

        res.status(201).json({
            success: true,
            projectId,
            urls,
            qrCode,
            message: 'تم الإنشاء بنجاح'
        });

    } catch (error) {
        console.error('Create error:', error);
        res.status(500).json({ error: 'خطأ في السيرفر', details: error.message });
    }
});

// Get Project Info
app.get('/api/projects/:projectId/info', async (req, res) => {
    const project = DB.projects.get(req.params.projectId);
    if (!project) return res.status(404).json({ error: 'غير موجود' });
    
    res.json({
        ...project,
        secret: undefined // Hide secret
    });
});

// Track Visit
app.post('/api/projects/:projectId/visit', async (req, res) => {
    const project = DB.projects.get(req.params.projectId);
    if (project) {
        project.stats.visits++;
        project.stats.lastVisit = new Date().toISOString();
        DB.stats.totalVisits++;
        res.json({ success: true });
    } else {
        res.status(404).json({ error: 'غير موجود' });
    }
});

// Download ZIP with token verification
app.get('/api/projects/:projectId/download', async (req, res) => {
    try {
        const { projectId } = req.params;
        const { token } = req.query;
        const project = DB.projects.get(projectId);
        
        if (!project) return res.status(404).send('المشروع غير موجود');
        if (token !== project.secret) return res.status(403).send('رابط التحميل غير صالح');

        const projectDir = path.join(__dirname, 'projects', projectId);
        
        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Content-Disposition', `attachment; filename=${projectId}_noho.zip`);
        
        const archive = archiver('zip', { zlib: { level: 9 } });
        
        archive.on('error', (err) => {
            res.status(500).send({ error: err.message });
        });
        
        archive.pipe(res);
        archive.directory(projectDir, false);
        await archive.finalize();
        
    } catch (err) {
        res.status(500).send('خطأ في التحميل');
    }
});

// Update Project (Edit)
app.post('/api/projects/:projectId/update', async (req, res) => {
    try {
        const { projectId } = req.params;
        const { code, token } = req.body;
        const project = DB.projects.get(projectId);
        
        if (!project) return res.status(404).json({ error: 'غير موجود' });
        if (token !== project.secret) return res.status(403).json({ error: 'غير مصرح' });
        
        const projectDir = path.join(__dirname, 'projects', projectId);
        await fs.writeFile(path.join(projectDir, 'index.html'), code);
        
        // Update timestamp
        project.stats.lastModified = new Date().toISOString();
        await saveDatabase();
        
        // Notify clients
        io.emit('project-update', { projectId, time: new Date() });
        
        res.json({ success: true, message: 'تم التحديث' });
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
        await fs.rmdir(projectDir, { recursive: true });
        DB.projects.delete(projectId);
        await saveDatabase();
        res.json({ success: true, message: 'تم الحذف' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Set Tunnel URL (Global)
app.post('/api/admin/set-tunnel', (req, res) => {
    const { url, key } = req.body;
    if (key !== 'noho-secret-key') {
        return res.status(403).json({ error: 'مفتاح خاطئ' });
    }
    CONFIG.tunnelUrl = url;
    console.log('🌍 Global URL updated:', url);
    res.json({ success: true, message: 'تم تحديث الرابط العالمي' });
});

// Stats
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
        total: DB.projects.size,
        stats: DB.stats,
        server: {
            local: `http://localhost:${PORT}`,
            global: CONFIG.tunnelUrl || null,
            uptime: process.uptime()
        },
        projects: projects.slice(-50).reverse() // آخر 50 مشروع فقط
    });
});

// Search Projects
app.get('/api/projects/search', (req, res) => {
    const { q } = req.query;
    if (!q) return res.json([]);
    
    const results = Array.from(DB.projects.values())
        .filter(p => p.name.includes(q) || p.id.includes(q))
        .slice(0, 10);
    
    res.json(results.map(p => ({ ...p, secret: undefined })));
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
            <script>alert('رابط التعديل غير صالح'); window.location.href = '${project.urls.view}';</script>
        `);
    }

    res.send(`
<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
    <meta charset="UTF-8">
    <title>تعديل ${project.name}</title>
    <link href="https://fonts.googleapis.com/css2?family=Tajawal:wght@400;700&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { 
            font-family: 'Tajawal', sans-serif;
            background: #0f172a;
            color: #fff;
            min-height: 100vh;
        }
        .header {
            background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%);
            padding: 1.5rem;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        .container { max-width: 1200px; margin: 0 auto; padding: 2rem; }
        .editor-container {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 2rem;
            height: 70vh;
        }
        textarea {
            width: 100%;
            height: 100%;
            background: #1e293b;
            border: 2px solid #334155;
            border-radius: 12px;
            padding: 1rem;
            color: #e2e8f0;
            font-family: 'Fira Code', monospace;
            font-size: 14px;
            resize: none;
            direction: ltr;
        }
        .preview {
            background: white;
            border-radius: 12px;
            height: 100%;
            overflow: hidden;
        }
        .preview iframe {
            width: 100%;
            height: 100%;
            border: none;
        }
        .btn {
            padding: 0.75rem 1.5rem;
            border: none;
            border-radius: 8px;
            cursor: pointer;
            font-family: 'Tajawal', sans-serif;
            font-weight: 700;
            margin: 0.5rem;
        }
        .btn-save { background: #10b981; color: white; }
        .btn-preview { background: #3b82f6; color: white; }
        .btn-undo { background: #f59e0b; color: white; }
        .actions { margin-top: 1rem; text-align: center; }
        .status {
            position: fixed;
            bottom: 2rem;
            right: 2rem;
            padding: 1rem 2rem;
            border-radius: 8px;
            display: none;
        }
        .status.show { display: block; animation: slideIn 0.3s; }
        .status.success { background: #10b981; }
        .status.error { background: #ef4444; }
        @keyframes slideIn { from { transform: translateX(100px); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
        
        @media (max-width: 768px) {
            .editor-container { grid-template-columns: 1fr; height: auto; }
            textarea { height: 300px; }
            .preview { height: 300px; }
        }
    </style>
</head>
<body>
    <div class="header">
        <h2><i class="fas fa-code"></i> محرر NOHO - ${project.name}</h2>
        <div>
            <button class="btn btn-save" onclick="saveCode()"><i class="fas fa-save"></i> حفظ</button>
            <button class="btn btn-preview" onclick="updatePreview()"><i class="fas fa-eye"></i> تحديث المعاينة</button>
        </div>
    </div>
    
    <div class="container">
        <div class="editor-container">
            <textarea id="code" placeholder="اكتب كود HTML هنا..."></textarea>
            <div class="preview">
                <iframe id="previewFrame"></iframe>
            </div>
        </div>
        
        <div class="actions">
            <button class="btn btn-undo" onclick="loadOriginal()"><i class="fas fa-undo"></i> استعادة الأصلي</button>
            <a href="${project.urls.view}" target="_blank" class="btn" style="background: #6366f1; color: white; text-decoration: none;">
                <i class="fas fa-external-link-alt"></i> فتح الموقع
            </a>
        </div>
    </div>
    
    <div class="status" id="status"></div>

    <script>
        const projectId = '${projectId}';
        const token = '${token}';
        let originalCode = '';
        
        async function loadCode() {
            try {
                const res = await fetch('/projects/' + projectId + '/index.html');
                const code = await res.text();
                document.getElementById('code').value = code;
                originalCode = code;
                updatePreview();
            } catch (err) {
                showStatus('خطأ في التحميل', 'error');
            }
        }
        
        function updatePreview() {
            const code = document.getElementById('code').value;
            const frame = document.getElementById('previewFrame');
            frame.srcdoc = code;
        }
        
        async function saveCode() {
            const code = document.getElementById('code').value;
            try {
                const res = await fetch('/api/projects/' + projectId + '/update', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ code, token })
                });
                
                if (res.ok) {
                    showStatus('✅ تم الحفظ بنجاح', 'success');
                    updatePreview();
                } else {
                    showStatus('❌ فشل الحفظ', 'error');
                }
            } catch (err) {
                showStatus('❌ خطأ في الاتصال', 'error');
            }
        }
        
        function loadOriginal() {
            if (confirm('استعادة الملف الأصلي؟')) {
                document.getElementById('code').value = originalCode;
                updatePreview();
            }
        }
        
        function showStatus(msg, type) {
            const status = document.getElementById('status');
            status.textContent = msg;
            status.className = 'status ' + type + ' show';
            setTimeout(() => status.classList.remove('show'), 3000);
        }
        
        // Auto-save every 30 seconds
        setInterval(() => {
            if (document.getElementById('code').value !== originalCode) {
                saveCode();
            }
        }, 30000);
        
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
    <title>NOHO Community PRO</title>
    <link href="https://fonts.googleapis.com/css2?family=Tajawal:wght@400;700;900&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
    <style>
        /* CSS محسن هنا - ممكن نضعه في ملف منفصل */
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: 'Tajawal', sans-serif; background: #0f172a; color: #fff; min-height: 100vh; }
        .hero { text-align: center; padding: 4rem 2rem; background: linear-gradient(135deg, #6366f1 0%, #ec4899 100%); }
        .hero h1 { font-size: 3.5rem; margin-bottom: 1rem; }
        .container { max-width: 1000px; margin: 0 auto; padding: 2rem; }
        .card { background: rgba(255,255,255,0.05); border-radius: 20px; padding: 2rem; margin-bottom: 2rem; border: 1px solid rgba(255,255,255,0.1); }
        input, select { width: 100%; padding: 1rem; margin: 0.5rem 0; border-radius: 10px; border: 2px solid rgba(255,255,255,0.1); background: rgba(0,0,0,0.2); color: #fff; font-family: 'Tajawal'; }
        .btn { padding: 1rem 2rem; border: none; border-radius: 10px; cursor: pointer; font-family: 'Tajawal'; font-weight: 700; font-size: 1.1rem; transition: transform 0.3s; }
        .btn:hover { transform: translateY(-2px); }
        .btn-primary { background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%); color: white; width: 100%; }
        .links-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 1rem; margin-top: 2rem; }
        .link-card { background: rgba(255,255,255,0.03); border: 2px solid; border-radius: 15px; padding: 1.5rem; text-align: center; }
        .link-card.global { border-color: #6366f1; }
        .link-card.private { border-color: #10b981; }
        .link-card.download { border-color: #f59e0b; }
        .link-card.dev { border-color: #ec4899; }
        .hidden { display: none; }
        .qr-container { background: white; padding: 2rem; border-radius: 20px; text-align: center; margin-top: 2rem; }
        .qr-container img { max-width: 250px; }
        .live-stats { position: fixed; bottom: 2rem; left: 2rem; background: rgba(0,0,0,0.8); padding: 1rem; border-radius: 10px; font-size: 0.9rem; }
        @media (max-width: 768px) { .hero h1 { font-size: 2rem; } }
    </style>
</head>
<body>
    <div class="hero">
        <h1>🚀 NOHO PRO</h1>
        <p>أحسن نسخة منصة إنشاء المشاريع</p>
    </div>
    
    <div class="container">
        <div class="card">
            <h2 style="margin-bottom: 1.5rem;"><i class="fas fa-plus-circle"></i> مشروع جديد</h2>
            <input type="text" id="projectName" placeholder="اسم المشروع (English)">
            <input type="email" id="userEmail" placeholder="بريدك الإلكتروني">
            <select id="projectType">
                <option value="web">موقع ويب</option>
                <option value="store">متجر</option>
                <option value="portfolio">معرض أعمال</option>
                <option value="bot-whatsapp">بوت واتساب</option>
            </select>
            <button class="btn btn-primary" onclick="createProject()">
                <i class="fas fa-rocket"></i> إنشاء والحصول على 4 روابط + QR
            </button>
        </div>
        
        <div id="result" class="hidden">
            <h2 style="color: #10b981; margin-bottom: 1rem;">✅ تم بنجاح!</h2>
            <div class="links-grid" id="linksContainer"></div>
            <div class="qr-container">
                <h3 style="color: #0f172a; margin-bottom: 1rem;">QR Code</h3>
                <img id="qrImage" src="" alt="QR">
            </div>
        </div>
    </div>
    
    <div class="live-stats" id="liveStats">
        <div><i class="fas fa-project-diagram"></i> <span id="statProjects">0</span> مشروع</div>
        <div><i class="fas fa-eye"></i> <span id="statVisits">0</span> زيارة</div>
    </div>

    <script src="/socket.io/socket.io.js"></script>
    <script>
        const socket = io();
        let currentProject = null;
        
        socket.on('stats-update', (stats) => {
            document.getElementById('statProjects').textContent = stats.total;
            document.getElementById('statVisits').textContent = stats.totalVisits;
        });
        
        async function createProject() {
            const name = document.getElementById('projectName').value;
            const email = document.getElementById('userEmail').value;
            const type = document.getElementById('projectType').value;
            
            if (!name || !email) return alert('أكمل البيانات');
            
            try {
                const res = await fetch('/api/projects/create', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name, email, type })
                });
                
                const data = await res.json();
                if (data.success) {
                    currentProject = data;
                    showResults(data);
                } else {
                    alert(data.error);
                }
            } catch (e) {
                alert('خطأ في الاتصال');
            }
        }
        
        function showResults(data) {
            document.getElementById('result').classList.remove('hidden');
            document.getElementById('qrImage').src = data.qrCode;
            
            const container = document.getElementById('linksContainer');
            const links = [
                { type: 'global', title: 'رابط عالمي', url: data.urls.global, icon: 'globe', color: '#6366f1', show: !!data.urls.global },
                { type: 'private', title: 'رابط خاص', url: data.urls.private, icon: 'home', color: '#10b981', show: true },
                { type: 'download', title: 'تحميل ZIP', url: data.urls.download, icon: 'download', color: '#f59e0b', show: true },
                { type: 'dev', title: 'رابط المطور', url: data.urls.dev, icon: 'code', color: '#ec4899', show: true }
            ];
            
            container.innerHTML = links.filter(l => l.show).map(link => \`
                <div class="link-card \${link.type}">
                    <i class="fas fa-\${link.icon}" style="font-size: 2rem; color: \${link.color}; margin-bottom: 1rem;"></i>
                    <h3>\${link.title}</h3>
                    <div style="background: rgba(0,0,0,0.3); padding: 0.5rem; border-radius: 8px; margin: 1rem 0; font-family: monospace; font-size: 0.8rem; word-break: break-all;">
                        \${link.url}
                    </div>
                    <button class="btn" style="background: \${link.color}; color: white; width: 100%; margin-bottom: 0.5rem;" onclick="copy('\${link.url}')">نسخ</button>
                    <button class="btn" style="background: rgba(255,255,255,0.1); color: white; width: 100%;" onclick="window.open('\${link.url}')">فتح</button>
                </div>
            \`).join('');
            
            document.getElementById('result').scrollIntoView({ behavior: 'smooth' });
        }
        
        function copy(text) {
            navigator.clipboard.writeText(text).then(() => alert('تم النسخ!'));
        }
        
        // Load initial stats
        fetch('/api/stats').then(r => r.json()).then(s => {
            document.getElementById('statProjects').textContent = s.total;
            document.getElementById('statVisits').textContent = s.stats.totalVisits;
        });
    </script>
</body>
</html>
    `);
});

// Static files
app.use('/projects', express.static('projects'));

// Error handling
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ error: 'خطأ في السيرفر' });
});

// Start server
server.listen(PORT, async () => {
    await loadDatabase();
    console.log(`
    ╔══════════════════════════════════════════════════╗
    ║                                                  ║
    ║           🚀 NOHO PRO SERVER v2.0               ║
    ║                                                  ║
    ╠══════════════════════════════════════════════════╣
    ║  🌐 Local:    http://localhost:${PORT}            ║
    ║  📱 Network:  http://${LOCAL_IP}:${PORT}          ║
    ║                                                  ║
    ║  💡 Features:                                    ║
    ║  • Auto-save Database                           ║
    ║  • Real-time WebSocket                          ║
    ║  • QR Code Caching                              ║
    ║  • Rate Limiting                                ║
    ║  • Security Headers                             ║
    ║  • 4 Links per Project                          ║
    ║                                                  ║
    ╚══════════════════════════════════════════════════╝
    `);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
    console.log('⚠️ Shutting down...');
    await saveDatabase();
    process.exit(0);
});
