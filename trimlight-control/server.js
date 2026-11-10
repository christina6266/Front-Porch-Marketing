// Trimlight Edge light controller — standalone app, no dependencies.
// Environment variables:
//   TRIMLIGHT_CLIENT_ID, TRIMLIGHT_CLIENT_SECRET  (from https://trimlight.ledhue.com)
//   APP_PASSWORD   password for this control page (required)
//   PORT           (optional, default 3000)
//   DATA_DIR       (optional) folder where timers are saved, default ./data.
//                  On Railway, attach a Volume and set DATA_DIR to its mount path
//                  (e.g. /data) so timers survive redeploys.

const http = require('http');
const https = require('https');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { GROUPS, findTheme } = require('./public/shared.js');

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

// Trimlight's device list is a GET request with a JSON body. fetch() refuses
// that ("Request with GET/HEAD method cannot have body"), so use https directly.
function httpsRequest(url, { method, headers }, payload) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, {
      method,
      headers: payload ? { ...headers, 'Content-Length': Buffer.byteLength(payload) } : headers,
      timeout: 15000,
    }, res => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', c => { text += c; });
      res.on('end', () => resolve({
        status: res.statusCode, ok: res.statusCode >= 200 && res.statusCode < 300, text,
      }));
    });
    req.on('timeout', () => req.destroy(new HttpError(504, 'Trimlight did not respond in time')));
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

// Trimlight's cloud rejects bursts of requests (error 20000), so keep ~300 ms between calls.
let nextSlot = 0;
async function throttle() {
  const wait = nextSlot - Date.now();
  nextSlot = Math.max(Date.now(), nextSlot) + 300;
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
}

// Recent Trimlight calls for the Diagnostics page (request bodies and replies, no credentials).
const callLog = [];
function recordCall(method, apiPath, body, status, json) {
  const short = v => { const t = JSON.stringify(v); return t && t.length > 1500 ? t.slice(0, 1500) + '…' : t; };
  callLog.push({
    at: new Date().toISOString(), method, path: apiPath.replace('/v1/oauth/resources/', ''),
    sent: short(body), status, code: json.code, desc: json.desc,
    reply: apiPath.endsWith('/device/get') ? '(device details)' : short(json.payload),
  });
  if (callLog.length > 40) callLog.shift();
}

async function trimlight(method, apiPath, body) {
  await throttle();
  if (!configured()) throw new HttpError(503, 'Set TRIMLIGHT_CLIENT_ID and TRIMLIGHT_CLIENT_SECRET.');
  const clientId = cleanCredential('TRIMLIGHT_CLIENT_ID');
  const clientSecret = cleanCredential('TRIMLIGHT_CLIENT_SECRET');
  const ts = Date.now().toString();
  const signature = crypto.createHmac('sha256', clientSecret)
    .update(`Trimlight|${clientId}|${ts}`).digest('base64');
  const resp = await httpsRequest(TRIMLIGHT_BASE + apiPath, {
    method,
    headers: { authorization: signature, 'S-ClientId': clientId, 'S-Timestamp': ts, 'Content-Type': 'application/json' },
  }, body ? JSON.stringify(body) : undefined);
  const text = resp.text;
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  recordCall(method, apiPath, body, resp.status, json);
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

// Turn { zones: [{ color, count }] } (up to 30 zones, each its own LED count) or the simpler
// { colors: [...], ledsPerColor } into Trimlight's 30 pixel entries (unused entries have count 0).
// The controller repeats the lit entries along the strip.
function toPixels(b) {
  let zones = Array.isArray(b.zones) && b.zones.length
    ? b.zones.map(z => ({ color: z.color, count: clamp(z.count, 0, 60, 1) })).filter(z => z.count > 0)
    : (Array.isArray(b.colors) && b.colors.length ? b.colors : ['#ffffff'])
        .map(color => ({ color, count: clamp(b.ledsPerColor, 1, 60, 1) }));
  zones = zones.slice(0, 30);
  if (!zones.length) zones = [{ color: '#ffffff', count: 1 }];
  return Array.from({ length: 30 }, (_, index) => zones[index]
    ? { index, count: zones[index].count, color: hexToInt(zones[index].color), disable: false }
    : { index, count: 0, color: 0, disable: false });
}

// ─── Showing effects ───────────────────────────────────────────────────────────
// Trimlight's "preview" endpoint is broken on current firmware (1.17.x): it shows the colors but
// ignores the animation. Instead we save the effect into one reusable slot per controller and then
// play it (effect/save + effect/view). Slots: "Lights App" (custom patterns) and "Lights App FX"
// (built-in animations). They also appear in Trimlight's own app.
const SLOT_NAMES = { 1: 'Lights App', 0: 'Lights App FX' };
const slotIds = new Map();      // `${deviceId}|${category}` → effect id on the controller
const deviceQueues = new Map(); // deviceId → promise chain, so one change at a time per controller

function withDeviceLock(deviceId, fn) {
  const prev = deviceQueues.get(deviceId) || Promise.resolve();
  const run = prev.catch(() => {}).then(fn);
  deviceQueues.set(deviceId, run.catch(() => {}));
  return run;
}

async function findSlot(deviceId, category) {
  const key = `${deviceId}|${category}`;
  if (slotIds.has(key)) return slotIds.get(key);
  // Never create a slot blind: if the controller's effect list can't be read, a second copy could
  // end up on the controller, so let the error surface instead.
  const detail = await trimlight('POST', '/v1/oauth/resources/device/get', { deviceId, currentDate: now() });
  const existing = (detail.effects || []).find(e => e.name === SLOT_NAMES[category]);
  if (existing && existing.id !== undefined) slotIds.set(key, existing.id);
  return existing ? existing.id : -1;
}

async function saveAndPlay(deviceId, category, effect) {
  return withDeviceLock(deviceId, async () => {
    const key = `${deviceId}|${category}`;
    const save = id => trimlight('POST', '/v1/oauth/resources/device/effect/save', {
      deviceId, payload: { id, name: SLOT_NAMES[category], category, ...effect },
    });
    let id = await findSlot(deviceId, category);
    let saved;
    try {
      saved = await save(id);
    } catch (e) {
      // A cached slot may have been deleted in Trimlight's app: look it up again once.
      if (id === -1 || !(e.details && e.details.code !== undefined)) throw e;
      slotIds.delete(key);
      id = await findSlot(deviceId, category);
      saved = await save(id);
    }
    if (saved && saved.id !== undefined) id = saved.id;
    if (id === -1) {                       // saved but no id returned: find it by name
      slotIds.delete(key);
      id = await findSlot(deviceId, category);
      if (id === -1) throw new HttpError(502, 'Trimlight saved the pattern but did not return it');
    }
    slotIds.set(key, id);
    await trimlight('POST', '/v1/oauth/resources/device/effect/view', { deviceId, payload: { id } });
    return { ok: true, slot: id };
  });
}

function showCustom(deviceId, b) {
  return saveAndPlay(deviceId, 1, {
    mode: clamp(b.mode, 0, 16, 0), speed: clamp(b.speed, 0, 255, 100),
    brightness: clamp(b.brightness, 0, 255, 255),
    pixels: toPixels(b),
  });
}

function showBuiltin(deviceId, b) {
  return saveAndPlay(deviceId, 0, {
    mode: clamp(b.mode, 0, 179, 0), speed: clamp(b.speed, 0, 255, 100),
    brightness: clamp(b.brightness, 0, 255, 255), pixelLen: clamp(b.pixelLen, 1, 90, 30),
    reverse: !!b.reverse,
  });
}

const setSwitch = (deviceId, switchState) =>
  trimlight('POST', '/v1/oauth/resources/device/update', { deviceId, payload: { switchState } });

// ─── Timers ────────────────────────────────────────────────────────────────────
// A timer: { id, enabled, name, when: { type: 'time'|'sunset'|'sunrise', time: 'HH:MM', offset: minutes },
//            days: [0-6] (0 = Sunday; empty = every day), target: 'group:all' | 'group:backyard' | deviceId,
//            action: { type: 'on'|'off'|'theme', holiday, theme, still } }

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DATA_PERSISTENT = !!process.env.DATA_DIR;
const TIMERS_FILE = path.join(DATA_DIR, 'timers.json');

// Home location and time zone for sunrise/sunset. Defaults to Austin, TX (Central Time);
// override with HOME_LAT / HOME_LON / HOME_NAME / HOME_TIMEZONE, or the page's 📍 button.
const HOME_TIMEZONE = process.env.HOME_TIMEZONE || 'America/Chicago';
const DEFAULT_LOCATION = {
  lat: Number(process.env.HOME_LAT) || 30.267,
  lon: Number(process.env.HOME_LON) || -97.743,
  name: process.env.HOME_NAME || 'Austin, TX',
};

let timerData = { timezone: HOME_TIMEZONE, location: DEFAULT_LOCATION, timers: [], lastRuns: {} };
try { timerData = { ...timerData, ...JSON.parse(fs.readFileSync(TIMERS_FILE, 'utf8')) }; } catch {}
if (!timerData.location) timerData.location = DEFAULT_LOCATION;
timerData.timezone = HOME_TIMEZONE;

function writeTimerData() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = TIMERS_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(timerData, null, 2));
  fs.renameSync(tmp, TIMERS_FILE);
}

// ─── Saved patterns (made in the Pattern Builder) ─────────────────────────────
const PATTERNS_FILE = path.join(DATA_DIR, 'patterns.json');
let patterns = [];
try { patterns = JSON.parse(fs.readFileSync(PATTERNS_FILE, 'utf8')); } catch {}

const isHex = c => /^#[0-9a-f]{6}$/i.test(c);
function cleanPattern(x) {
  const zones = (Array.isArray(x.zones) ? x.zones : []).slice(0, 30)
    .map(z => ({ color: isHex(z.color) ? z.color.toLowerCase() : '#ffffff', count: clamp(z.count, 0, 60, 1) }))
    .filter(z => z.count > 0);
  if (!zones.length) throw new HttpError(400, 'A pattern needs at least one zone with LEDs');
  return {
    id: String(x.id || crypto.randomBytes(6).toString('hex')).slice(0, 40),
    name: String(x.name || 'My pattern').slice(0, 40),
    zones,
    mode: clamp(x.mode, 0, 16, 0), speed: clamp(x.speed, 0, 255, 100), brightness: clamp(x.brightness, 0, 255, 255),
  };
}

function savePatterns(b) {
  if (!Array.isArray(b.patterns) || b.patterns.length > 200) throw new HttpError(400, 'patterns must be a list (max 200)');
  patterns = b.patterns.map(cleanPattern);
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(PATTERNS_FILE + '.tmp', JSON.stringify(patterns, null, 2));
  fs.renameSync(PATTERNS_FILE + '.tmp', PATTERNS_FILE);
  return { ok: true, persistent: DATA_PERSISTENT };
}

function cleanTimer(t) {
  const type = ['time', 'sunset', 'sunrise'].includes(t?.when?.type) ? t.when.type : 'time';
  const time = /^([01]\d|2[0-3]):[0-5]\d$/.test(t?.when?.time) ? t.when.time : '17:00';
  const actionType = ['on', 'off', 'theme', 'pattern'].includes(t?.action?.type) ? t.action.type : 'on';
  if (actionType === 'theme' && !findTheme(t.action.holiday, t.action.theme)) throw new HttpError(400, `Unknown theme: ${t.action.theme}`);
  if (actionType === 'pattern' && !patterns.some(x => x.id === t.action.patternId)) throw new HttpError(400, 'Unknown saved pattern');
  return {
    id: String(t.id || crypto.randomBytes(6).toString('hex')).slice(0, 40),
    enabled: t.enabled !== false,
    name: String(t.name || '').slice(0, 60),
    when: { type, time, offset: clamp(t?.when?.offset, -240, 240, 0) },
    days: [...new Set((Array.isArray(t.days) ? t.days : []).map(Number).filter(d => d >= 0 && d <= 6))].sort(),
    target: String(t.target || 'group:all').slice(0, 80),
    action: actionType === 'theme'
      ? { type: 'theme', holiday: t.action.holiday, theme: t.action.theme, still: !!t.action.still }
      : actionType === 'pattern'
        ? { type: 'pattern', patternId: t.action.patternId, still: !!t.action.still }
        : { type: actionType },
  };
}

function saveTimerData(b) {
  if (!Array.isArray(b.timers) || b.timers.length > 100) throw new HttpError(400, 'timers must be a list (max 100)');
  let loc = timerData.location;
  if (b.location === 'default') loc = DEFAULT_LOCATION;
  else if (b.location && Number.isFinite(+b.location.lat) && Number.isFinite(+b.location.lon)) {
    loc = { lat: +(+b.location.lat).toFixed(3), lon: +(+b.location.lon).toFixed(3), name: String(b.location.name || 'Custom location').slice(0, 60) };
  }
  timerData = {
    timezone: HOME_TIMEZONE,
    location: loc,
    timers: b.timers.map(cleanTimer),
    lastRuns: timerData.lastRuns,
  };
  writeTimerData();
  return { ok: true, persistent: DATA_PERSISTENT, sun: sunPreview() };
}

// Local date/time parts in the saved time zone.
function localParts(date = new Date(), tz = timerData.timezone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', weekday: 'short',
  }).formatToParts(date).map(p => [p.type, p.value]));
  return {
    y: +parts.year, m: +parts.month, d: +parts.day,
    minutes: +parts.hour * 60 + +parts.minute,
    weekday: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday),
    dateKey: `${parts.year}-${parts.month}-${parts.day}`,
  };
}

// Sunrise/sunset (NOAA approximation) as minutes after local midnight, or null (polar day/night).
function sunMinutes(y, m, d, rising) {
  const loc = timerData.location;
  if (!loc) return null;
  const rad = Math.PI / 180, deg = 180 / Math.PI;
  const N = Math.floor((Date.UTC(y, m - 1, d) - Date.UTC(y, 0, 0)) / 86400000);
  const lngHour = loc.lon / 15;
  const t = N + ((rising ? 6 : 18) - lngHour) / 24;
  const M = 0.9856 * t - 3.289;
  const L = (M + 1.916 * Math.sin(M * rad) + 0.020 * Math.sin(2 * M * rad) + 282.634 + 360) % 360;
  let RA = (Math.atan(0.91764 * Math.tan(L * rad)) * deg + 360) % 360;
  RA = (RA + Math.floor(L / 90) * 90 - Math.floor(RA / 90) * 90) / 15;
  const sinDec = 0.39782 * Math.sin(L * rad), cosDec = Math.cos(Math.asin(sinDec));
  const cosH = (Math.cos(90.833 * rad) - sinDec * Math.sin(loc.lat * rad)) / (cosDec * Math.cos(loc.lat * rad));
  if (cosH > 1 || cosH < -1) return null;
  const H = (rising ? 360 - Math.acos(cosH) * deg : Math.acos(cosH) * deg) / 15;
  const UT = ((H + RA - 0.06571 * t - 6.622 - lngHour) % 24 + 24) % 24;
  // Convert UT on this date to local clock minutes; pick the instant that falls on the same local date.
  for (const shift of [0, -1, 1]) {
    const lp = localParts(new Date(Date.UTC(y, m - 1, d + shift) + UT * 3600000));
    if (lp.y === y && lp.m === m && lp.d === d) return lp.minutes;
  }
  return null;
}

function timerMinute(t, lp) {
  if (t.when.type === 'time') {
    const [h, mm] = t.when.time.split(':').map(Number);
    return h * 60 + mm;
  }
  const base = sunMinutes(lp.y, lp.m, lp.d, t.when.type === 'sunrise');
  return base === null ? null : base + t.when.offset;
}

const fmt = mins => mins === null ? null : `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
function sunPreview() {
  const lp = localParts();
  const tm = localParts(new Date(Date.now() + 86400000));
  return {
    place: timerData.location && timerData.location.name, timezone: timerData.timezone,
    sunrise: fmt(sunMinutes(lp.y, lp.m, lp.d, true)), sunset: fmt(sunMinutes(lp.y, lp.m, lp.d, false)),
    tomorrowSunrise: fmt(sunMinutes(tm.y, tm.m, tm.d, true)), tomorrowSunset: fmt(sunMinutes(tm.y, tm.m, tm.d, false)),
  };
}

async function targetDevices(target) {
  const res = await trimlight('GET', '/v1/oauth/resources/devices', { page: 0 });
  const devices = res.data || res.devices || (Array.isArray(res) ? res : []);
  const online = devices.filter(d => d.connectivity !== 0);
  if (!target.startsWith('group:')) return online.filter(d => d.deviceId === target);
  const g = GROUPS.find(x => 'group:' + x.id === target);
  if (!g) return [];
  const wanted = g.names && g.names.map(n => n.toLowerCase());
  return online.filter(d => !wanted || wanted.includes(String(d.name || '').toLowerCase()));
}

async function runTimer(t) {
  const devices = await targetDevices(t.target);
  const theme = t.action.type === 'theme' ? findTheme(t.action.holiday, t.action.theme)
    : t.action.type === 'pattern' ? patterns.find(x => x.id === t.action.patternId) : null;
  if (t.action.type === 'pattern' && !theme) throw new HttpError(404, 'That saved pattern was deleted');
  const results = await Promise.allSettled(devices.map(async d => {
    if (t.action.type === 'off') return setSwitch(d.deviceId, 0);
    await setSwitch(d.deviceId, 1);
    if (theme) await showCustom(d.deviceId, t.action.still ? { ...theme, mode: 0 } : theme);
  }));
  const failed = results.map((r, i) => r.status === 'rejected' ? `${devices[i].name}: ${r.reason.message}` : null).filter(Boolean);
  const summary = { ran: devices.length, failed };
  console.log(`⏰ Timer "${t.name || t.id}" → ${devices.length} controller(s)${failed.length ? ', failed: ' + failed.join('; ') : ''}`);
  return summary;
}

// Every 30s: run each enabled timer whose minute has arrived (once per day per timer).
async function tick() {
  if (!configured() || !timerData.timers.length) return;
  const lp = localParts();
  for (const t of timerData.timers) {
    if (!t.enabled || (t.days.length && !t.days.includes(lp.weekday))) continue;
    const at = timerMinute(t, lp);
    // Run within a 5-minute window so a brief restart doesn't skip it.
    if (at === null || lp.minutes < at || lp.minutes > at + 5) continue;
    const key = `${t.id}@${lp.dateKey}`;
    if (timerData.lastRuns[t.id] === key) continue;
    timerData.lastRuns[t.id] = key;
    try { writeTimerData(); } catch (e) { console.error('Could not save timers:', e.message); }
    runTimer(t).catch(e => console.error(`⏰ Timer "${t.name || t.id}" failed:`, e.message));
  }
}
setInterval(tick, 30000);
setTimeout(tick, 5000);

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
  ['POST', /^\/api\/devices\/([^/]+)\/builtin$/, ([id], b) => showBuiltin(id, b)],

  // Custom colors: { colors: ["#ff0000", ...], mode 0-16 (0 = static), speed, brightness, ledsPerColor }
  ['POST', /^\/api\/devices\/([^/]+)\/custom$/, ([id], b) => showCustom(id, b)],

  // Diagnostics: ask the controller to report fresh data, then return its full details.
  ['GET', /^\/api\/debug\/device\/([^/]+)$/, async ([id]) => {
    let shadow = 'ok';
    try { await trimlight('GET', '/v1/oauth/resources/device/notify-update-shadow', { deviceId: id, currentDate: now() }); }
    catch (e) { shadow = e.message; }
    await new Promise(r => setTimeout(r, 2500));
    const detail = await trimlight('POST', '/v1/oauth/resources/device/get', { deviceId: id, currentDate: now() });
    return { shadow, detail };
  }],
  ['GET', /^\/api\/debug\/log$/, () => ({ calls: callLog })],

  ['GET', /^\/api\/patterns$/, () => ({ patterns, persistent: DATA_PERSISTENT })],
  ['POST', /^\/api\/patterns$/, (_, b) => savePatterns(b)],

  ['GET', /^\/api\/timers$/, () => ({ ...timerData, lastRuns: undefined, persistent: DATA_PERSISTENT, sun: sunPreview() })],
  ['POST', /^\/api\/timers$/, (_, b) => saveTimerData(b)],
  ['POST', /^\/api\/timers\/([^/]+)\/run$/, async ([id]) => {
    const t = timerData.timers.find(x => x.id === id);
    if (!t) throw new HttpError(404, 'Timer not found');
    return runTimer(t);
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
      const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css' };
      res.writeHead(200, { 'Content-Type': types[path.extname(full)] || 'application/octet-stream' });
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
