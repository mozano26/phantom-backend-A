#!/bin/bash
# Phantom Antidetect — Quick Deploy Script
# Usage: chmod +x deploy.sh && ./deploy.sh

set -e

echo ""
echo "  ╔══════════════════════════════════════════════╗"
echo "  ║  👤 Phantom Antidetect — Deploy Script       ║"
echo "  ╚══════════════════════════════════════════════╝"
echo ""

# Check Node.js
if ! command -v node &> /dev/null; then
    echo "❌ Node.js not found. Installing Node.js 20..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y nodejs
fi

echo "✓ Node.js $(node -v)"

# Install PM2
if ! command -v pm2 &> /dev/null; then
    echo "📦 Installing PM2..."
    npm install -g pm2
fi
echo "✓ PM2 ready"

# Install dependencies
echo "📦 Installing backend dependencies..."
npm install

# Install Playwright
echo "🎭 Installing Playwright browser..."
npx playwright install --with-deps chromium

# Create data directory
mkdir -p data

# Start with PM2
echo "🚀 Starting Phantom backend..."
pm2 delete phantom 2>/dev/null || true
pm2 start server.js --name phantom
pm2 save

# Setup startup
pm2 startup 2>/dev/null || true

echo ""
echo "  ╔══════════════════════════════════════════════╗"
echo "  ║  ✅ Phantom Antidetect is running!            ║"
echo "  ║                                              ║"
echo "  ║  Backend: http://localhost:3000               ║"
echo "  ║  Health:  curl localhost:3000/api/health      ║"
echo "  ║                                              ║"
echo "  ║  Logs:    pm2 logs phantom                   ║"
echo "  ║  Stop:    pm2 stop phantom                   ║"
echo "  ║  Restart: pm2 restart phantom               ║"
echo "  ╚══════════════════════════════════════════════╝"
echo ""
