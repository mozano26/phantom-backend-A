# Phantom Antidetect — Deployment Guide

## Option A: One-Command Deploy (Easiest)

### Prerequisites
- A VPS (DigitalOcean, Hetzner, AWS EC2, Linode — any $5/mo plan)
- SSH access
- Node.js 18+ installed

```bash
# SSH into your server
ssh root@your-server-ip

# Clone or upload the phantom-backend folder
git clone <your-repo> phantom
cd phantom/phantom-backend

# Install everything
npm install
npx playwright install --with-deps chromium

# Start with PM2 (keeps it running forever)
npm i -g pm2
pm2 start server.js --name phantom
pm2 save
pm2 startup  # follow the instructions it prints

# Done! Backend is live on port 3000
```

---

## Option B: Docker Deploy

### 1. Create Dockerfile
```dockerfile
FROM node:20-slim

# Install Playwright deps
RUN npx playwright install --with-deps chromium

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --production
COPY . .

# Create data directory
RUN mkdir -p data

EXPOSE 3000
CMD ["node", "server.js"]
```

### 2. Create docker-compose.yml
```yaml
version: '3.8'
services:
  phantom:
    build: .
    ports:
      - "3000:3000"
    volumes:
      - ./data:/app/data
    environment:
      - HEADLESS=true
    restart: unless-stopped
```

### 3. Run
```bash
docker-compose up -d
```

---

## Option C: Railway / Render / Fly.io (Managed)

### Railway
```bash
npm i -g @railway/cli
railway login
railway init
railway up
```

### Render
1. Push to GitHub
2. Create new Web Service on Render
3. Connect repo
4. Build command: `npm install && npx playwright install --with-deps chromium`
5. Start command: `node server.js`

---

## Connecting the Frontend

The dashboard HTML automatically detects the backend. Just set the API URL:

1. Open the dashboard on your phone
2. Go to Settings
3. Enter your backend URL (e.g., `http://YOUR-VPS-IP:3000`)
4. Done — profiles, proxies, schedules, and logins now run through the real backend

### Nginx Reverse Proxy (recommended for production)

```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        root /var/www/phantom;
        try_files $uri $uri /index.html;
    }

    location /api/ {
        proxy_pass http://localhost:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

This serves both the frontend and backend from one domain.

---

## SSL (Let's Encrypt)

```bash
# After setting up Nginx
apt install certbot python3-certbot-nginx
certbot --nginx -d your-domain.com
```

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | Backend port |
| `HEADLESS` | `true` | `false` = show browser windows (debug) |
| `API_URL` | auto | Override API base URL in frontend |

---

## Quick Health Check

```bash
curl http://your-server-ip:3000/api/health
# Should return: {"status":"ok","sessions":0,"profiles":0}
```

---

## Troubleshooting

**Playwright won't install on server:**
```bash
npx playwright install --with-deps chromium
# Or manually install deps:
apt-get update && apt-get install -y \
  libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 \
  libcups2 libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 \
  libxfixes3 libxrandr2 libgbm1 libpango-1.0-0 libcairo2 libasound2
```

**Port already in use:**
```bash
PORT=3001 npm start
```

**Browser crashes:**
```bash
# Add to launch args in server.js
'--disable-dev-shm-usage'
'--disable-gpu'
```
