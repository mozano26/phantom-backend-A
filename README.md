# 👤 Phantom Antidetect — Backend

Real browser automation backend using **Playwright**. Handles cookie injection, password login with 2FA, fingerprint spoofing, proxy routing, scheduled logins, and session isolation.

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Install Playwright browser
npm run install-browser

# 3. Start the server
npm start
```

Server runs on `http://localhost:3000`

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | Server port |
| `HEADLESS` | `true` | Set to `false` to see browser windows |

## API Endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/health` | Health check |
| `GET` | `/api/profiles` | List all profiles |
| `POST` | `/api/profiles` | Create a profile |
| `DELETE` | `/api/profiles/:id` | Delete a profile |
| `POST` | `/api/login` | Launch single profile login `{ "profileId": "..." }` |
| `POST` | `/api/login/all` | Launch all profiles `{ "delay": 2000 }` |
| `POST` | `/api/login/schedule/:id` | Trigger a schedule manually |
| `GET` | `/api/proxies` | List proxies |
| `POST` | `/api/proxies` | Add a proxy |
| `GET` | `/api/schedules` | List schedules |
| `POST` | `/api/schedules` | Create a schedule |
| `GET` | `/api/totp/:profileId` | Generate live TOTP code |
| `GET` | `/api/sessions` | List active browser sessions |
| `POST` | `/api/sessions/:id/close` | Close a session |
| `GET` | `/api/logs` | Get activity logs |
| `GET` | `/api/export` | Export all data |
| `POST` | `/api/import` | Import data |

## How Login Works

1. **Cookie login** (preferred) — Parses cookies from JSON/Netscape/header format, injects into browser context via `context.addCookies()`, navigates to URL, checks if login form is gone
2. **Password fallback** — Finds username/password fields by common selectors, fills, submits, handles 2FA/TOTP if configured
3. **2FA** — Uses `otplib` to generate TOTP codes from the profile's secret, enters into OTP field automatically

## Fingerprint Spoofing

Injected via `context.addInitScript()`:
- Screen dimensions
- `navigator.platform`, `hardwareConcurrency`, `deviceMemory`, `language`
- WebGL renderer (vendor + renderer strings)
- Canvas noise (pixel manipulation)
- Timezone (via Playwright context + Intl override)

## Deployment

### VPS (DigitalOcean / Hetzner / AWS)
```bash
git clone <repo> && cd phantom-backend
npm install
npx playwright install --with-deps chromium
npm start
```

### With PM2 (process manager)
```bash
npm i -g pm2
pm2 start server.js --name phantom
pm2 save
pm2 startup
```

### Docker
```dockerfile
FROM node:20-slim
RUN npx playwright install --with-deps chromium
WORKDIR /app
COPY package.json . && npm install
COPY . .
EXPOSE 3000
CMD ["node", "server.js"]
```

## Data Storage

All data is stored in `data/db.json` (lowdb). No external database needed.

## Connecting to the Frontend Dashboard

Point the frontend to this backend by adding an API base URL. The dashboard's localStorage data can be exported and imported via the Settings tab, then synced to the backend's database.
