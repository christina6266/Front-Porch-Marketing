// Trimlight Edge light controller — standalone app, no dependencies.
// Environment variables:
//   TRIMLIGHT_CLIENT_ID, TRIMLIGHT_CLIENT_SECRET  (from https://trimlight.ledhue.com)
//   APP_PASSWORD   password for this control page (required)
//   PORT           (optional, default 3000)

const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const TRIMLIGHT_BASE = process.env.TRIMLIGHT_BASE_URL || 'https://trimlight.ledhue.com/trimlight';
const PORT = process.env.PORT || 3000;
const sessions = new Map(); // token -> expiry ms

// ─── Trimlight API ─────────────────────────────────────────────────────────────

// Credentials typed by hand (or copied from a screenshot) can pick up spaces or
// look-alike Cyrillic/Greek letters (e.g. "с" instead of "c"). Trimlight
// credentials are plain letters and digits, so map those back to ASCII.
const LOOKALIKES = {
  'а': 'a', 'с': 'c', 'е': 'e', 'о': 'o', 'р': 'p', 'х': 'x', 'у': 'y', 'і': 'i', 'ј': 'j', 'ѕ': 's',
  'ԁ': 'd', 'ԛ': 'q', 'ԝ': 'w', 'һ': 'h', 'ӏ': 'l', 'ν': 'v', 'ο': 'o', 'α': 'a', 'ι': 'i',
  'А': 'A', 'В': 'B', 'С': 'C', 'Е': 'E', 'Н': 'H', 'І': 'I', 'Ј': 'J', 'К': 'K', 'М': 'M',
  'О': 'O', 'Р': 'P', 'Ѕ': 'S', 'Т': 'T', 'Х': 'X', 'У': 'Y', 'Ζ': 'Z', 'Ν': 'N', 'Β': 'B',
  'Ε': 'E', 'Η': 'H', 'Ι': 'I', 'Κ': 'K', 'Μ': 'M', 'Ο': 'O', 'Ρ': 'P', 'Τ': 'T', 'Χ': 'X', 'Υ': 'Y', 'Α': 'A',
  '０': '0', '１': '1', '２': '2', '３': '3', '４': '4', '５': '5', '６': '6', '７': '7', '８': '8', '９': '9',
};

function cleanCredential(name) {
  const raw = process.env[name] || '';
  const cleaned = raw.normalize('NFKC').replace(/\s+/g, '').replace(/./gu, ch => LOOKALIKES[ch] || ch);
  if (/[^\x21-\x7e]/.test(cleaned)) {
    throw new HttpError(500, `${name} contains an unusual character. Re-paste it in your host's variables using the Copy button on trimlight.ledhue.com.`);
  }
  return cleaned;
}

const configured = () => !!(process.env.TRIMLIGHT_CLIENT_ID && process.env.TRIMLIGHT_CLIENT_SECRET);

class HttpError extends Error {
  constructor(status, message, details) { super(message); this.status = status; this.details = details; }
}

async function trimlight(method, apiPath, body) {
  if (!configured()) throw new HttpError(503, 'Set TRIMLIGHT_CLIENT_ID and TRIMLIGHT_CLIENT_SECRET.');
  const clientId = cleanCredential('TRIMLIGHT_CLIENT_ID');
  const clientSecret = cleanCredential('TRIMLIGHT_CLIENT_SECRET');
  const ts = Date.now().toString();
  const signature = crypto.createHmac('sha256', clientSecret)
    .update(`Trimlight|${clientId}|${ts}`).digest('base64');
  const resp = await fetch(TRIMLIGHT_BASE + apiPath, {
    method,
    headers: { authorization: signature, 'S-ClientId': clientId, 'S-Timestamp': ts, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await resp.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  // Trimlight returns { code: 0, desc: 'success', payload: ... } on success
  if (!resp.ok || (json.code !== undefined && json.code !== 0)) {
    throw new HttpError(resp.ok ? 502 : resp.status, json.desc || json.message || `Trimlight error (HTTP ${resp.status})`, json);
  }
  return json.payload !== undefined ? json.payload : json;
}

function now() {
  const d = new Date();
  return {
    year: d.getFullYear() - 2000, month: d.getMonth() + 1, day: d.getDate(),
    weekday: d.getDay() === 0 ? 7 : d.getDay(),
    hours: d.getHours(), minutes: d.getMinutes(), seconds: d.getSeconds(),
  };
}

const hexToInt = hex => parseInt(String(hex || '#ffffff').replace('#', ''), 16) || 0;
const clamp = (v, lo, hi, dflt) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, Math.round(n))) : dflt;
};

// ─── Routes ────────────────────────────────────────────────────────────────────

const routes = [
  ['GET', /^\/api\/status$/, () => ({ configured: configured() })],

  ['GET', /^\/api\/devices$/, () => trimlight('GET', '/v1/oauth/resources/devices', { page: 0 })],

  ['GET', /^\/api\/devices\/([^/]+)$/, ([id]) =>
    trimlight('POST', '/v1/oauth/resources/device/get', { deviceId: id, currentDate: now() })],

  // state: "on" | "off" | "timer"  →  1 manual on, 0 off, 2 follow schedule
  ['POST', /^\/api\/devices\/([^/]+)\/switch$/, ([id], b) => {
    const switchState = { off: 0, on: 1, timer: 2 }[String(b.state).toLowerCase()];
    if (switchState === undefined) throw new HttpError(400, 'state must be "on", "off" or "timer"');
    return trimlight('POST', '/v1/oauth/resources/device/update', { deviceId: id, payload: { switchState } });
  }],

  ['POST', /^\/api\/devices\/([^/]+)\/effects\/(\d+)\/run$/, ([id, effectId]) =>
    trimlight('POST', '/v1/oauth/resources/device/effect/view', { deviceId: id, payload: { id: Number(effectId) } })],

  // Built-in animation: { mode 0-179, speed 0-255, brightness 0-255, pixelLen 1-90, reverse }
  ['POST', /^\/api\/devices\/([^/]+)\/builtin$/, ([id], b) =>
    trimlight('POST', '/v1/oauth/resources/device/effect/preview', {
      deviceId: id,
      payload: {
        category: 0,
        mode: clamp(b.mode, 0, 179, 0), speed: clamp(b.speed, 0, 255, 100),
        brightness: clamp(b.brightness, 0, 255, 200), pixelLen: clamp(b.pixelLen, 1, 90, 30),
        reverse: !!b.reverse,
      },
    })],

  // Custom colors: { colors: ["#ff0000", ...], mode 0-16 (0 = static), speed, brightness, ledsPerColor }
  ['POST', /^\/api\/devices\/([^/]+)\/custom$/, ([id], b) => {
    const colors = (Array.isArray(b.colors) && b.colors.length ? b.colors : ['#ffffff']).slice(0, 30);
    const count = clamp(b.ledsPerColor, 1, 60, 1);
    return trimlight('POST', '/v1/oauth/resources/device/effect/preview', {
      deviceId: id,
      payload: {
        category: 1,
        mode: clamp(b.mode, 0, 16, 0), speed: clamp(b.speed, 0, 255, 100),
        brightness: clamp(b.brightness, 0, 255, 200),
        pixels: colors.map((c, index) => ({ index, count, color: hexToInt(c), disable: false })),
      },
    });
  }],
];

// ─── HTTP server ───────────────────────────────────────────────────────────────

function send(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise(resolve => {
    let s = '';
    req.on('data', c => { s += c; if (s.length > 1e5) req.destroy(); });
    req.on('end', () => { try { resolve(s ? JSON.parse(s) : {}); } catch { resolve({}); } });
  });
}

function authed(req) {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  const exp = sessions.get(token);
  return exp && exp > Date.now();
}

function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = decodeURIComponent(url.pathname);

  if (!p.startsWith('/api/')) {
    const file = p === '/' ? 'index.html' : p.slice(1);
    const full = path.join(__dirname, 'public', path.normalize(file));
    if (!full.startsWith(path.join(__dirname, 'public'))) return send(res, 404, { error: 'Not found' });
    return fs.readFile(full, (err, data) => {
      if (err) return send(res, 404, { error: 'Not found' });
      res.writeHead(200, { 'Content-Type': full.endsWith('.html') ? 'text/html; charset=utf-8' : 'application/octet-stream' });
      res.end(data);
    });
  }

  try {
    const body = req.method === 'POST' ? await readBody(req) : {};

    if (req.method === 'POST' && p === '/api/login') {
      if (!process.env.APP_PASSWORD) throw new HttpError(503, 'Set APP_PASSWORD on the server first.');
      if (!safeEqual(body.password || '', process.env.APP_PASSWORD)) throw new HttpError(401, 'Wrong password');
      const token = crypto.randomBytes(24).toString('hex');
      sessions.set(token, Date.now() + 30 * 86400000);
      return send(res, 200, { token });
    }

    if (!authed(req)) throw new HttpError(401, 'Please sign in');

    for (const [method, re, handler] of routes) {
      const m = req.method === method && p.match(re);
      if (m) return send(res, 200, await handler(m.slice(1), body));
    }
    throw new HttpError(404, 'Not found');
  } catch (e) {
    if (!(e instanceof HttpError)) console.error(e);
    else if (e.details) console.error('Trimlight:', e.message, e.details);
    send(res, e.status || 500, { error: e.message, details: e.details });
  }
});

server.listen(PORT, () => console.log(`💡 Trimlight control running at http://localhost:${PORT}`));
