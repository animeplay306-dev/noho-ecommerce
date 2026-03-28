#!/data/data/com.termux/files/usr/bin/bash

echo "🚀 NOHO Server Deploy"

TOKEN_FILE="$HOME/.noho-railway-token"
PROJECT_DIR="$HOME/noho-server"

# ========== حفظ Railway Token ==========
save_token() {
    echo ""
    echo "📝 جيب Railway Token:"
    echo "   1. افتح: https://railway.app/dashboard"
    echo "   2. Account → Tokens → New Token"
    echo ""
    read -s -p "📋 حط Railway Token: " TOKEN
    echo ""
    echo "$TOKEN" > "$TOKEN_FILE"
    chmod 600 "$TOKEN_FILE"
    echo "✅ تم الحفظ"
}

# ========== التحقق ==========
if [ ! -f "$TOKEN_FILE" ]; then
    save_token
fi

TOKEN=$(cat "$TOKEN_FILE")

# ========== تثبيت ==========
if ! command -v railway &> /dev/null; then
    npm install -g @railway/cli 2>&1 | tail -3
fi

# ========== تسجيل الدخول ==========
export RAILWAY_TOKEN="$TOKEN"
export RAILWAY_NO_TELEMETRY=1

echo "🔐 جاري الاتصال..."
if ! railway whoami &>/dev/null; then
    echo "❌ Token غلط"
    rm "$TOKEN_FILE"
    save_token
    exit 1
fi

echo "✅ متصل: $(railway whoami 2>/dev/null)"

# ========== Deploy ==========
cd "$PROJECT_DIR" || exit 1

if ! railway status &>/dev/null; then
    echo "🏗️ إنشاء مشروع..."
    railway init --name "noho-server"
fi

echo "⬆️ جاري الرفع..."
railway up

echo ""
railway status
