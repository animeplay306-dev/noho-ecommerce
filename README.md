# 🚀 NOHO Community
## منصة البوتات والمواقع الذكية

![Version](https://img.shields.io/badge/version-2.0.0-blue.svg)
![License](https://img.shields.io/badge/license-MIT-green.svg)
![Node](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen.svg)

<div align="center">

![NOHO Logo](https://img.shields.io/badge/NOHO-Community-6366f1?style=for-the-badge&logo=node.js&logoColor=white)

**منصة متكاملة لإنشاء البوتات الذكية وصفحات الويب الاحترافية**

[🌐 الموقع](https://animeplay306-dev.github.io/noho-website) • 
[📦 NPM](https://www.npmjs.com/~nohojs) • 
[💻 GitHub](https://github.com/animeplay306)

</div>

---

## 📋 نظرة عامة

NOHO Community هي منصة تجارية متكاملة تتيح للمستخدمين إنشاء:

- **🌐 صفحات الويب** - مجاناً حتى 500 ريال
- **🤖 البوتات الذكية** - من 5 ريال إلى 1500 ريال شهرياً

### المميزات الرئيسية

| الميزة | الوصف |
|--------|--------|
| 🔗 روابط مميزة | `https://اسمك.no.ho` |
| 📱 QR Code | توليد تلقائي للبوتات |
| 💰 نظام كوينز | عملة افتراضية داخلية |
| 📊 إحصائيات | تتبع الزيارات والأرباح |
| 🔐 أمان | مصادقة JWT |
| 💳 دفع | Orange Cash + InstaPay |

---

## 🛠️ التقنيات المستخدمة

### Frontend
- HTML5 / CSS3 / JavaScript (Vanilla)
- تصميم Glassmorphism
- Responsive Design
- Animations & Particles

### Backend
- Node.js + Express
- UUID للمعرفات الفريدة
- QRCode Generator
- File System Operations

---

## 🚀 التثبيت والتشغيل

### المتطلبات
- Node.js >= 18.0.0
- npm أو yarn

### خطوات التثبيت

```bash
# 1. استنساخ المستودع
git clone https://github.com/animeplay306/noho-server.git
cd noho-server

# 2. تثبيت التبعيات
npm install

# 3. إنشاء المجلدات المطلوبة
mkdir -p projects public

# 4. وضع ملفات Frontend في مجلد public/
# - index.html (الصفحة الرئيسية)
# - style.css (إن وجد)
# - script.js (إن وجد)

# 5. تشغيل السيرفر
npm start

# أو للتطوير
npm run dev
