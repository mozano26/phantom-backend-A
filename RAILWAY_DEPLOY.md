# Railway Deployment — 5 Minute Guide

## What You Get
- Permanent public URL (e.g., `phantom-backend-production.up.railway.app`)
- Auto-restarts on crash
- Playwright pre-installed
- Free $5 credit (covers ~1 month of light usage)

## Step 1: Create Railway Account
1. Go to https://railway.app
2. Click **Login** → sign in with GitHub (creates account automatically)
3. You get **$5 free credit** — no card required

## Step 2: Push to GitHub
If you don't have a repo yet:
```bash
cd phantom-backend
git init
git add .
git commit -m "Phantom Antidetect Backend"
git branch -M main
git remote add origin https://github.com/YOURUSERNAME/phantom-backend.git
git push -u origin main
```

Or download the files and create the repo manually on GitHub.

## Step 3: Deploy on Railway
1. Go to https://railway.app/new
2. Click **Deploy from GitHub repo**
3. Select your `phantom-backend` repo
4. Railway auto-detects the Dockerfile and builds it
5. Wait ~2-3 min for build (installs Playwright + Chromium)
6. Go to **Settings → Networking → Generate Domain**
7. You now have a permanent URL like: `phantom-backend-production.up.railway.app`

## Step 4: Verify
```bash
curl https://YOUR-RAILWAY-URL/api/health
# Should return: {"status":"ok","sessions":0,"profiles":0}
```

## Step 5: Connect Dashboard
1. Open your Phantom dashboard
2. Go to **Settings**
3. Paste your Railway URL: `https://phantom-backend-production.up.railway.app`
4. Click **Test Connection**
5. ✅ Live!

## Environment Variables (Optional)
Set these in Railway → Variables tab:
| Variable | Default | Description |
|---|---|---|
| `PORT` | auto | Railway sets this automatically |
| `HEADLESS` | `true` | `false` for debugging (won't work on Railway) |

## Cost Estimate
- Free tier: $5 credit ≈ 500 hours of running
- If you only need it during work hours: ~$2-3/month
- 24/7: ~$5-7/month
- Upgrade to Developer plan ($20/mo) for more resources

## Troubleshooting
- **Build fails on Playwright:** Make sure Dockerfile has the apt-get deps (already included)
- **Memory limit:** Railway free tier = 512MB. If Chromium crashes, upgrade to $5/mo plan (8GB RAM)
- **Cold starts:** Railway sleeps after inactivity on free tier. First request takes ~10s to wake
