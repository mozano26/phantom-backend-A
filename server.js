/**
 * Phantom Antidetect — Backend Server
 * 
 * Real browser automation using Playwright:
 * - Cookie injection auto-login
 * - Username/password auto-login with 2FA/TOTP
 * - Fingerprint spoofing (canvas, WebGL, UA, timezone, language)
 * - Proxy routing per profile
 * - Session isolation (separate browser contexts)
 * - Scheduled auto-login via node-cron
 * - Data persistence via lowdb (JSON file)
 * 
 * API:
 *   POST /api/login          → launch a single profile login
 *   POST /api/login/all      → launch all profiles
 *   POST /api/login/schedule → run a scheduled login batch
 *   GET  /api/profiles       → list all profiles
 *   POST /api/profiles      → create a profile
 *   DELETE /api/profiles/:id→ delete a profile
 *   GET  /api/proxies        → list proxies
 *   POST /api/proxies        → add a proxy
 *   GET  /api/schedules      → list schedules
 *   POST /api/schedules      → create a schedule
 *   GET  /api/totp/:profileId → generate live TOTP code
 *   GET  /api/health         → health check
 */

import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import cron from 'node-cron';
import { authenticator } from 'otplib';
import { JSONFilePreset } from 'lowdb/node';
import { v4 as uuidv4 } from 'uuid';
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(morgan('dev'));

// Serve dashboard from public directory
import { fileURLToPath as __ftu } from 'url';
const __basedir = path.dirname(fileURLToPath(import.meta.url));
app.use(express.static(path.join(__basedir, 'public')));

// Dashboard route
app.get('/', (req, res) => {
  res.sendFile(path.join(__basedir, 'public', 'index.html'));
});

// ─── DATABASE ─────────────────────────────────────────────────────────────
const defaultData = { profiles: [], proxies: [], schedules: [], totpKeys: [], logs: [] };
const db = await JSONFilePreset(path.join(__dirname, 'data', 'db.json'), defaultData);
await db.read();

// ─── COOKIE PARSER ─────────────────────────────────────────────────────────
function parseCookies(raw) {
  if (!raw) return [];
  const trimmed = raw.trim();

  // JSON array
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    try {
      let data = JSON.parse(trimmed);
      if (!Array.isArray(data)) data = [data];
      return data.map(c => ({
        name: c.name || '',
        value: c.value || '',
        domain: c.domain || '',
        path: c.path || '/',
        secure: !!c.secure,
        httpOnly: !!c.httpOnly,
        expiry: c.expirationDate || c.expires || -1,
      }));
    } catch { return []; }
  }

  // Netscape format (tab-separated)
  if (trimmed.includes('\t') && trimmed.split('\n').some(l => l.split('\t').length >= 7)) {
    return trimmed.split('\n')
      .filter(l => l && !l.startsWith('#'))
      .map(l => {
        const parts = l.split('\t');
        if (parts.length < 7) return null;
        return {
          domain: parts[0],
          path: parts[2],
          secure: parts[3] === 'TRUE',
          expiry: parseInt(parts[4]) || -1,
          name: parts[5],
          value: parts[6],
          httpOnly: false,
        };
      }).filter(Boolean);
  }

  // Cookie header string
  if (!trimmed.includes('\n') && trimmed.includes('=') && trimmed.includes(';')) {
    return trimmed.split(';').map(p => {
      const [name, ...rest] = p.split('=');
      return name ? { name: name.trim(), value: rest.join('=').trim(), domain: '', path: '/', secure: false, httpOnly: false, expiry: -1 } : null;
    }).filter(Boolean);
  }

  return [];
}

// ─── FINGERPRINT INJECTION ─────────────────────────────────────────────────
function generateFingerprint() {
  const screens = ['1920,1080', '1440,900', '2560,1440', '1366,768', '1280,800'];
  const langs = ['en-US', 'en-GB', 'fr-FR', 'de-DE', 'es-ES', 'pt-BR'];
  const tzs = ['America/New_York', 'America/Chicago', 'America/Los_Angeles', 'Europe/London', 'Europe/Paris'];
  const platforms = ['Win32', 'MacIntel', 'Linux x86_64'];
  const gpus = ['NVIDIA GeForce GTX 1060', 'NVIDIA GeForce RTX 3060', 'NVIDIA GeForce RTX 2070', 'Intel Iris Xe', 'AMD Radeon RX 580'];
  return {
    screen: screens[Math.floor(Math.random() * screens.length)],
    language: langs[Math.floor(Math.random() * langs.length)],
    timezone: tzs[Math.floor(Math.random() * tzs.length)],
    platform: platforms[Math.floor(Math.random() * platforms.length)],
    webgl: gpus[Math.floor(Math.random() * gpus.length)],
    canvasNoise: Math.random().toString(36).slice(2, 12),
    hardwareConcurrency: [2, 4, 6, 8, 12, 16][Math.floor(Math.random() * 6)],
    deviceMemory: [2, 4, 8, 16][Math.floor(Math.random() * 4)],
  };
}

async function injectFingerprint(context, fp) {
  // Inject fingerprint spoofing scripts
  await context.addInitScript((fingerprint) => {
    const fp = JSON.parse(fingerprint);
    const [w, h] = fp.screen.split(',');

    // Screen
    Object.defineProperty(screen, 'width', { get: () => parseInt(w) });
    Object.defineProperty(screen, 'height', { get: () => parseInt(h) });
    Object.defineProperty(screen, 'availWidth', { get: () => parseInt(w) });
    Object.defineProperty(screen, 'availHeight', { get: () => parseInt(h) });
    Object.defineProperty(screen, 'colorDepth', { get: () => 24 });

    // Platform
    Object.defineProperty(navigator, 'platform', { get: () => fp.platform });
    Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => fp.hardwareConcurrency });
    Object.defineProperty(navigator, 'deviceMemory', { get: () => fp.deviceMemory });
    Object.defineProperty(navigator, 'language', { get: () => fp.language });
    Object.defineProperty(navigator, 'languages', { get: () => [fp.language, 'en'] });

    // WebGL spoofing
    const getParameter = WebGLRenderingContext.prototype.getParameter;
    WebGLRenderingContext.prototype.getParameter = function (param) {
      if (param === 37445) return 'Google Inc. (Intel)'; // UNMASKED_VENDOR_WEBGL
      if (param === 37446) return fp.webgl; // UNMASKED_RENDERER_WEBGL
      return getParameter.call(this, param);
    };

    // Canvas noise
    const origToDataURL = HTMLCanvasElement.prototype.toDataURL;
    HTMLCanvasElement.prototype.toDataURL = function (...args) {
      const ctx = this.getContext('2d');
      if (ctx) {
        const imageData = ctx.getImageData(0, 0, this.width, this.height);
        for (let i = 0; i < imageData.data.length; i += 4) {
          imageData.data[i] ^= 1; // Subtle noise
        }
        ctx.putImageData(imageData, 0, 0);
      }
      return origToDataURL.apply(this, args);
    };

    // Timezone (Playwright handles via context options, but add fallback)
    try {
      const origDateTimeFormat = Intl.DateTimeFormat;
      Intl.DateTimeFormat = function (...args) {
        if (args[1] && args[1].timeZone) args[1].timeZone = fp.timezone;
        else if (args.length === 0) return new origDateTimeFormat(fp.language, { timeZone: fp.timezone });
        return new origDateTimeFormat(...args);
      };
    } catch {}
  }, JSON.stringify(fp));
}

// ─── PROXY CONFIG ──────────────────────────────────────────────────────────
function buildProxyConfig(profile, proxies) {
  if (!profile.proxy) return undefined;
  const proxy = proxies.find(p => p.addr === profile.proxy);
  if (!proxy) return undefined;

  const [host, port] = proxy.addr.split(':');
  const config = { server: `${proxy.type.toLowerCase()}://${host}:${port || 8080}` };
  if (proxy.user) { config.username = proxy.user; config.password = proxy.pass; }
  return config;
}

// ─── BROWSER LAUNCH ────────────────────────────────────────────────────────
const activeSessions = new Map();

async function launchProfileLogin(profileId) {
  const profile = db.data.profiles.find(p => p.id === profileId);
  if (!profile) throw new Error('Profile not found');

  const fp = profile.fingerprint || generateFingerprint();
  const proxyConfig = buildProxyConfig(profile, db.data.proxies);
  const cookies = parseCookies(profile.cookies);

  const launchOptions = {
    headless: process.env.HEADLESS !== 'false',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      '--disable-extensions',
      '--disable-images',
      '--disable-plugins',
      '--disable-notifications',
      '--no-first-run',
      '--disable-background-networking',
      '--disable-sync',
      '--disable-translate',
      '--disable-default-apps',
      '--disable-popup-blocking',
      '--metrics-recording-only',
      '--disable-component-extensions-with-background-pages',
    ],
  };
  if (proxyConfig) launchOptions.proxy = proxyConfig;

  const browser = await chromium.launch(launchOptions);
  const context = await browser.newContext({
    userAgent: profile.userAgent || undefined,
    viewport: { width: parseInt(fp.screen?.split(',')[0] || 1920), height: parseInt(fp.screen?.split(',')[1] || 1080) },
    locale: fp.language || 'en-US',
    timezoneId: fp.timezone || 'America/New_York',
    ignoreHTTPSErrors: true,
  });

  // Inject fingerprint spoofing
  await injectFingerprint(context, fp);

  // Inject cookies before navigation
  if (cookies.length > 0) {
    const playwrightCookies = cookies.map(c => ({
      name: c.name,
      value: c.value,
      domain: c.domain || undefined,
      path: c.path || '/',
      secure: c.secure,
      httpOnly: c.httpOnly,
      expires: c.expiry > 0 ? c.expiry : undefined,
    })).filter(c => c.name);
    if (playwrightCookies.length) await context.addCookies(playwrightCookies);
  }

  const page = await context.newPage();

  // Block unnecessary resources for faster page loads
  await page.route('**/*', (route) => {
    const type = route.request().resourceType();
    if (type === 'image' || type === 'media' || type === 'font') {
      route.abort();
    } else {
      route.continue();
    }
  });

  // Navigate to target URL
  await page.goto(profile.url, { waitUntil: 'domcontentloaded', timeout: 20000 });

  let loginSuccess = false;

  // If cookies were injected, check if we're already logged in
  if (cookies.length > 0) {
    await page.waitForTimeout(800);
    // Heuristic: if no login form visible, cookies worked
    const hasLoginForm = await page.locator('input[type="password"]').count();
    loginSuccess = hasLoginForm === 0;
    logEvent('info', `Profile "${profile.name}" — cookie login ${loginSuccess ? 'SUCCESS' : 'FAILED (login form detected)'}`);
  }

  // Fallback to username/password if cookies failed
  if (!loginSuccess && profile.username && profile.password) {
    logEvent('info', `Profile "${profile.name}" — attempting password login...`);
    try {
      // Wait for the page to actually load form elements
      const userSelectors = ['input[type="email"]', 'input[name="email"]', 'input[name="username"]', 'input[name="user"]', 'input[autocomplete="username"]', '#username', '#email'];
      const passSelectors = ['input[type="password"]', 'input[name="password"]', '#password'];

      // Wait up to 10 seconds for any username field to appear
      let userFilled = false;
      for (const sel of userSelectors) {
        try {
          await page.waitForSelector(sel, { timeout: 3000 });
          const el = page.locator(sel).first();
          await el.fill(profile.username);
          userFilled = true;
          logEvent('info', `Profile "${profile.name}" — found username field: ${sel}`);
          break;
        } catch { /* try next selector */ }
      }

      if (!userFilled) {
        logEvent('err', `Profile "${profile.name}" — could not find any username field on page`);
      }

      if (userFilled) {
        for (const sel of passSelectors) {
          try {
            await page.waitForSelector(sel, { timeout: 3000 });
            const el = page.locator(sel).first();
            await el.fill(profile.password);
            logEvent('info', `Profile "${profile.name}" — found password field: ${sel}`);
            break;
          } catch { /* try next selector */ }
        }

        // Submit
        const submitSelectors = ['button[type="submit"]', 'input[type="submit"]', 'button:has-text("Sign in")', 'button:has-text("Log in")', 'button:has-text("Login")'];
        for (const sel of submitSelectors) {
          const el = page.locator(sel).first();
          if (await el.count() > 0) { await el.click(); break; }
        }

        await page.waitForTimeout(1000);

        // Handle 2FA/TOTP if needed
        if (profile.totpSecret) {
          const totpInput = page.locator('input[name="otp"], input[name="code"], input[name="totp"], input[autocomplete="one-time-code"]').first();
          if (await totpInput.count() > 0) {
            const code = authenticator.generate(profile.totpSecret);
            logEvent('info', `Profile "${profile.name}" — entering TOTP code: ${code}`);
            await totpInput.fill(code);
            const verifyBtn = page.locator('button[type="submit"], button:has-text("Verify"), button:has-text("Continue")').first();
            if (await verifyBtn.count() > 0) await verifyBtn.click();
            await page.waitForTimeout(1000);
          }
        }

        // Check if login succeeded (no more password field)
        const stillHasPassword = await page.locator('input[type="password"]').count();
        loginSuccess = stillHasPassword === 0;
        logEvent(loginSuccess ? 'ok' : 'err', `Profile "${profile.name}" — password login ${loginSuccess ? 'SUCCESS' : 'FAILED'}`);
      }
    } catch (e) {
      logEvent('err', `Profile "${profile.name}" — login error: ${e.message}`);
      console.error('Full login error:', e.stack || e);
    }
  }

  // Update profile status
  profile.status = loginSuccess ? 'active' : 'error';
  profile.lastLogin = new Date().toLocaleString();
  profile.loginCount = (profile.loginCount || 0) + 1;
  await db.write();

  // Keep session alive
  if (loginSuccess) {
    activeSessions.set(profileId, { browser, context, page, startedAt: new Date() });
    logEvent('ok', `Profile "${profile.name}" — session active`);
  } else {
    await browser.close();
  }

  return { success: loginSuccess, profile: profile.name, url: profile.url };
}

// ─── LOGGING ───────────────────────────────────────────────────────────────
function logEvent(type, msg) {
  const entry = { id: uuidv4(), type, msg, time: new Date().toISOString() };
  db.data.logs.unshift(entry);
  if (db.data.logs.length > 500) db.data.logs = db.data.logs.slice(0, 500);
  db.write();
  console.log(`[${type.toUpperCase()}] ${msg}`);
}

// ─── SCHEDULE RUNNER ───────────────────────────────────────────────────────
function runScheduledLogins(scheduleId) {
  const schedule = db.data.schedules.find(s => s.id === scheduleId);
  if (!schedule || schedule.status !== 'active') return;

  logEvent('info', `⏰ Schedule "${schedule.name}" firing`);
  schedule.lastRun = new Date().toLocaleString();
  schedule.runCount = (schedule.runCount || 0) + 1;
  db.write();

  schedule.profiles.forEach((pid, i) => {
    setTimeout(async () => {
      try { await launchProfileLogin(pid); }
      catch (e) { logEvent('err', `Schedule login error: ${e.message}`); }
    }, i * 1000);
  });
}

// Register cron schedules on startup
function registerSchedules() {
  db.data.schedules.forEach(s => {
    if (s.status !== 'active') return;
    let cronExpr = '';
    if (s.repeat === 'daily') {
      const [h, m] = s.time.split(':');
      cronExpr = `${m} ${h} * * *`;
    } else if (s.repeat === 'weekdays') {
      const [h, m] = s.time.split(':');
      cronExpr = `${m} ${h} * * 1-5`;
    } else if (s.repeat === 'hourly') {
      cronExpr = `0 */${s.interval || 1} * * *`;
    } else if (s.repeat === 'interval') {
      cronExpr = `*/${s.interval || 60} * * * *`;
    }
    if (cronExpr) {
      cron.schedule(cronExpr, () => runScheduledLogins(s.id));
      console.log(`✓ Schedule "${s.name}" registered: ${cronExpr}`);
    }
  });
}

// ─── API ROUTES ────────────────────────────────────────────────────────────

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', sessions: activeSessions.size, profiles: db.data.profiles.length });
});

// Profiles CRUD
app.get('/api/profiles', (req, res) => {
  res.json(db.data.profiles);
});

app.post('/api/profiles', async (req, res) => {
  const profile = { id: uuidv4(), ...req.body, fingerprint: req.body.fingerprint || generateFingerprint(), status: 'idle', lastLogin: null, loginCount: 0 };
  db.data.profiles.push(profile);
  await db.write();
  logEvent('info', `Profile "${profile.name}" created`);
  res.json(profile);
});

app.delete('/api/profiles/:id', async (req, res) => {
  const idx = db.data.profiles.findIndex(p => p.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  const name = db.data.profiles[idx].name;
  db.data.profiles.splice(idx, 1);
  await db.write();
  logEvent('warn', `Profile "${name}" deleted`);
  res.json({ ok: true });
});

// Login endpoints
app.post('/api/login', async (req, res) => {
  const { profileId } = req.body;
  try {
    const result = await launchProfileLogin(profileId);
    res.json(result);
  } catch (e) {
    logEvent('err', `Login API error: ${e.message}`);
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/login/all', async (req, res) => {
  const delay = req.body.delay || 1000;
  const concurrency = Math.min(req.body.concurrency || 3, 5); // Max 5 parallel logins
  const profiles = [...db.data.profiles];
  const results = [];
  
  // Process in batches for concurrency
  for (let i = 0; i < profiles.length; i += concurrency) {
    const batch = profiles.slice(i, i + concurrency);
    const batchResults = await Promise.allSettled(
      batch.map(async (p) => {
        try { return await launchProfileLogin(p.id); }
        catch (e) { return { success: false, profile: p.name, error: e.message }; }
      })
    );
    results.push(...batchResults.map(r => r.value || r.reason));
    if (i + concurrency < profiles.length) {
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  res.json(results);
});

app.post('/api/login/schedule/:id', async (req, res) => {
  runScheduledLogins(req.params.id);
  res.json({ ok: true, message: 'Schedule triggered' });
});

// Proxy CRUD
app.get('/api/proxies', (req, res) => { res.json(db.data.proxies); });

app.post('/api/proxies', async (req, res) => {
  const proxy = { id: uuidv4(), ...req.body, status: 'untested' };
  db.data.proxies.push(proxy);
  await db.write();
  res.json(proxy);
});

app.delete('/api/proxies/:id', async (req, res) => {
  const idx = db.data.proxies.findIndex(p => p.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  db.data.proxies.splice(idx, 1);
  await db.write();
  res.json({ ok: true });
});

// Schedule CRUD
app.get('/api/schedules', (req, res) => { res.json(db.data.schedules); });

app.post('/api/schedules', async (req, res) => {
  const schedule = { id: uuidv4(), ...req.body, lastRun: null, runCount: 0 };
  db.data.schedules.push(schedule);
  await db.write();

  // Register cron job
  if (schedule.status === 'active') {
    let cronExpr = '';
    if (schedule.repeat === 'daily') {
      const [h, m] = schedule.time.split(':');
      cronExpr = `${m} ${h} * * *`;
    } else if (schedule.repeat === 'weekdays') {
      const [h, m] = schedule.time.split(':');
      cronExpr = `${m} ${h} * * 1-5`;
    } else if (schedule.repeat === 'hourly') {
      cronExpr = `0 */${schedule.interval || 1} * * *`;
    } else if (schedule.repeat === 'interval') {
      cronExpr = `*/${schedule.interval || 60} * * * *`;
    }
    if (cronExpr) {
      cron.schedule(cronExpr, () => runScheduledLogins(schedule.id));
    }
  }
  logEvent('info', `Schedule "${schedule.name}" created`);
  res.json(schedule);
});

app.delete('/api/schedules/:id', async (req, res) => {
  const idx = db.data.schedules.findIndex(s => s.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  db.data.schedules.splice(idx, 1);
  await db.write();
  res.json({ ok: true });
});

// TOTP
app.get('/api/totp/:profileId', (req, res) => {
  const profile = db.data.profiles.find(p => p.id === req.params.profileId);
  if (!profile || !profile.totpSecret) return res.status(404).json({ error: 'No TOTP secret' });
  const token = authenticator.generate(profile.totpSecret);
  const remaining = 30 - (Math.floor(Date.now() / 1000) % 30);
  res.json({ code: token, remaining });
});

// Active sessions
app.get('/api/sessions', (req, res) => {
  const sessions = [];
  for (const [id, s] of activeSessions) {
    sessions.push({ profileId: id, startedAt: s.startedAt });
  }
  res.json(sessions);
});

app.post('/api/sessions/:id/close', async (req, res) => {
  const session = activeSessions.get(req.params.id);
  if (!session) return res.status(404).json({ error: 'No active session' });
  await session.browser.close();
  activeSessions.delete(req.params.id);
  res.json({ ok: true });
});

// Logs
app.get('/api/logs', (req, res) => { res.json(db.data.logs.slice(0, 200)); });

// Export/Import
app.get('/api/export', (req, res) => {
  res.json({ profiles: db.data.profiles, proxies: db.data.proxies, schedules: db.data.schedules, totpKeys: db.data.totpKeys });
});

app.post('/api/import', async (req, res) => {
  const { profiles, proxies, schedules, totpKeys } = req.body;
  if (profiles) db.data.profiles.push(...profiles);
  if (proxies) db.data.proxies.push(...proxies);
  if (schedules) db.data.schedules.push(...schedules);
  if (totpKeys) db.data.totpKeys.push(...totpKeys);
  await db.write();
  res.json({ ok: true, imported: { profiles: profiles?.length || 0, proxies: proxies?.length || 0, schedules: schedules?.length || 0, totpKeys: totpKeys?.length || 0 } });
});

// ─── START ─────────────────────────────────────────────────────────────────
// Ensure data directory exists
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

registerSchedules();

app.listen(PORT, () => {
  console.log(`
  ╔══════════════════════════════════════════════╗
  ║  👤 Phantom Antidetect Backend v2.1 (Fast)   ║
  ║  Running on http://localhost:${PORT}          ║
  ║                                              ║
  ║  • Playwright browser automation ✓           ║
  ║  • Cookie injection ✓                        ║
  ║  • Fingerprint spoofing ✓                    ║
  ║  • Proxy routing ✓                           ║
  ║  • 2FA/TOTP ✓                                ║
  ║  • Cron scheduler ✓                          ║
  ║  • Session isolation ✓                       ║
  ╚══════════════════════════════════════════════╝
  `);
});
