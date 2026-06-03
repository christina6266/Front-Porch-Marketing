// FrontPorch Backend Server
// Run: npm install && node server.js
// Then open dashboard.html and canvasser-app.html in a browser

const express = require('express');
const Database = require('better-sqlite3');
const { WebSocketServer } = require('ws');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const { v4: uuid } = require('uuid');
const http = require('http');
const path = require('path');
const fs = require('fs');
const nodemailer = require('nodemailer');

// ── EMAIL TEMPLATE ────────────────────────────────────────────────────────────

function emailTemplate({ preheader, title, body, cta_url, cta_text, footer }) {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head>
<body style="margin:0;padding:0;background:#f7f8fa;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
<div style="display:none;max-height:0;overflow:hidden;">${preheader}</div>
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f7f8fa;padding:40px 20px;">
<tr><td align="center">
<table width="580" cellpadding="0" cellspacing="0" style="max-width:580px;width:100%;">
  <tr><td style="padding:0 0 24px;text-align:center;">
    <span style="font-size:22px;font-weight:900;color:#2A2215;letter-spacing:-0.5px;">Front<span style="color:#C07830;font-style:italic;">Porch</span> <span style="font-weight:400;font-size:16px;color:#6b7280;">Marketing</span></span>
  </td></tr>
  <tr><td style="background:#fff;border-radius:16px;padding:36px 40px;border:1px solid #e5e7eb;">
    <h1 style="margin:0 0 16px;font-size:22px;font-weight:800;color:#111827;">${title}</h1>
    <div style="font-size:15px;color:#374151;line-height:1.7;">${body}</div>
    ${cta_url ? `<div style="text-align:center;margin:28px 0 8px;">
      <a href="${cta_url}" style="display:inline-block;background:#0ea5e9;color:#fff;text-decoration:none;padding:14px 32px;border-radius:10px;font-size:15px;font-weight:700;">${cta_text}</a>
    </div>` : ''}
  </td></tr>
  <tr><td style="padding:20px 0;text-align:center;font-size:12px;color:#9ca3af;">${footer}</td></tr>
</table>
</td></tr></table>
</body></html>`;
}

// ── EMAIL SETUP ───────────────────────────────────────────────────────────────
// Set these environment variables to enable real email sending:
//   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM, SERVER_URL
// Without them, emails are logged to the console instead.

const EMAIL_CONFIGURED = !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
const SERVER_URL = process.env.SERVER_URL || 'http://localhost:3000';

let mailer = null;
if (EMAIL_CONFIGURED) {
  mailer = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: process.env.SMTP_PORT === '465',
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
}

async function sendEmail({ to, subject, html }) {
  if (!to) return;
  if (!EMAIL_CONFIGURED) {
    console.log(`\n📧 [EMAIL - not sent, configure SMTP to enable]`);
    console.log(`   To: ${to}`);
    console.log(`   Subject: ${subject}\n`);
    return;
  }
  try {
    await mailer.sendMail({ from: process.env.SMTP_FROM || process.env.SMTP_USER, to, subject, html });
  } catch(e) { console.error('Email error:', e.message); }
}

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// Ensure photos directory exists
const PHOTOS_DIR = path.join(__dirname, 'photos');
if (!fs.existsSync(PHOTOS_DIR)) fs.mkdirSync(PHOTOS_DIR);

app.use(cors());
app.use(express.json({ limit: '10mb' })); // allow base64 photo payloads
app.use('/photos', express.static(PHOTOS_DIR));

// Serve static files (dashboard + canvasser app)
app.use(express.static(path.join(__dirname)));

// ─── DATABASE SETUP ───────────────────────────────────────────────────────────

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'canvashq.db');
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS businesses (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    owner_name TEXT,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at INTEGER DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS canvassers (
    id TEXT PRIMARY KEY,
    business_id TEXT REFERENCES businesses(id),
    name TEXT NOT NULL,
    phone TEXT,
    location TEXT,
    pin_hash TEXT NOT NULL,
    status TEXT DEFAULT 'offline',
    lat REAL,
    lng REAL,
    last_seen INTEGER,
    shift_started INTEGER,
    accountability_score REAL DEFAULT 100,
    created_at INTEGER DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS canvasses (
    id TEXT PRIMARY KEY,
    business_id TEXT REFERENCES businesses(id),
    title TEXT NOT NULL,
    type TEXT DEFAULT 'Door Hangers',
    status TEXT DEFAULT 'draft',
    location TEXT,
    date_start TEXT,
    date_end TEXT,
    customer_name TEXT,
    customer_email TEXT,
    customer_token TEXT UNIQUE,
    created_at INTEGER DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS zones (
    id TEXT PRIMARY KEY,
    canvass_id TEXT REFERENCES canvasses(id),
    name TEXT,
    color TEXT DEFAULT '#22c55e',
    coords TEXT,
    assigned_canvasser_id TEXT REFERENCES canvassers(id)
  );

  CREATE TABLE IF NOT EXISTS door_knocks (
    id TEXT PRIMARY KEY,
    canvasser_id TEXT REFERENCES canvassers(id),
    business_id TEXT REFERENCES businesses(id),
    canvass_id TEXT REFERENCES canvasses(id),
    lat REAL NOT NULL,
    lng REAL NOT NULL,
    outcome TEXT NOT NULL CHECK(outcome IN ('converted','interested','not_home','no_thanks')),
    notes TEXT,
    address TEXT,
    knocked_at INTEGER DEFAULT (unixepoch()),
    verified INTEGER DEFAULT 0,
    photo_url TEXT
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    user_type TEXT NOT NULL,
    business_id TEXT,
    expires_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    business_id TEXT REFERENCES businesses(id),
    canvasser_id TEXT REFERENCES canvassers(id),
    from_type TEXT NOT NULL,
    text TEXT NOT NULL,
    sent_at INTEGER DEFAULT (unixepoch()),
    read INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS customer_messages (
    id TEXT PRIMARY KEY,
    canvass_id TEXT REFERENCES canvasses(id),
    canvasser_id TEXT REFERENCES canvassers(id),
    from_type TEXT NOT NULL,
    text TEXT NOT NULL,
    sent_at INTEGER DEFAULT (unixepoch()),
    read INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS flyered_homes (
    id TEXT PRIMARY KEY,
    zone_id TEXT REFERENCES zones(id),
    canvass_id TEXT,
    business_id TEXT REFERENCES businesses(id),
    canvasser_id TEXT REFERENCES canvassers(id),
    lat REAL NOT NULL,
    lng REAL NOT NULL,
    address TEXT,
    photo_url TEXT NOT NULL,
    logged_at INTEGER DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS shifts (
    id TEXT PRIMARY KEY,
    business_id TEXT REFERENCES businesses(id),
    canvasser_id TEXT REFERENCES canvassers(id),
    shift_date TEXT NOT NULL,
    shift_type TEXT NOT NULL CHECK(shift_type IN ('morning','afternoon','full')),
    created_at INTEGER DEFAULT (unixepoch()),
    UNIQUE(business_id, canvasser_id, shift_date)
  );

  CREATE TABLE IF NOT EXISTS payouts (
    id TEXT PRIMARY KEY,
    business_id TEXT REFERENCES businesses(id),
    canvasser_id TEXT REFERENCES canvassers(id),
    week_start INTEGER NOT NULL,
    status TEXT DEFAULT 'pending',
    paid_at INTEGER,
    UNIQUE(business_id, canvasser_id, week_start)
  );

  CREATE TABLE IF NOT EXISTS canvasser_daily_snapshots (
    id TEXT PRIMARY KEY,
    business_id TEXT REFERENCES businesses(id),
    canvasser_id TEXT REFERENCES canvassers(id),
    snap_date TEXT NOT NULL,         -- YYYY-MM-DD
    doors INTEGER DEFAULT 0,
    shift_minutes INTEGER DEFAULT 0,
    doors_per_hour REAL DEFAULT 0,
    accountability_score REAL DEFAULT 0,
    UNIQUE(canvasser_id, snap_date)
  );
`);

// Migrations for existing databases
try { db.exec('ALTER TABLE door_knocks ADD COLUMN photo_url TEXT'); } catch {}
try { db.exec("ALTER TABLE zones ADD COLUMN status TEXT DEFAULT 'available'"); } catch {}
try { db.exec('ALTER TABLE zones ADD COLUMN claimed_by TEXT'); } catch {}
try { db.exec('ALTER TABLE zones ADD COLUMN claimed_at INTEGER'); } catch {}
try { db.exec('ALTER TABLE canvasses ADD COLUMN customer_name TEXT'); } catch {}
try { db.exec('ALTER TABLE canvasses ADD COLUMN customer_email TEXT'); } catch {}
try { db.exec('ALTER TABLE canvasses ADD COLUMN customer_token TEXT'); } catch {}
try { db.exec('ALTER TABLE zones ADD COLUMN target_homes INTEGER DEFAULT 0'); } catch {}
try { db.exec('ALTER TABLE zones ADD COLUMN completed_at INTEGER'); } catch {}
try { db.exec('ALTER TABLE zones ADD COLUMN completed_by TEXT'); } catch {}
try { db.exec('ALTER TABLE zones ADD COLUMN customer_confirmed INTEGER DEFAULT 0'); } catch {}
try { db.exec('ALTER TABLE zones ADD COLUMN customer_confirmed_at INTEGER'); } catch {}


// ─── DAILY SNAPSHOT HELPER ───────────────────────────────────────────────────
// Call this whenever a shift ends, or from the shift-end endpoint.
// Also called by a midnight cron to capture any canvassers who didn't end shift.

function snapshotCanvasserDay(canvasserId, snapDate) {
  const cv = db.prepare('SELECT * FROM canvassers WHERE id = ?').get(canvasserId);
  if (!cv) return;

  // Count flyered homes for this date
  const dayStart = Math.floor(new Date(snapDate + 'T00:00:00').getTime() / 1000);
  const dayEnd   = dayStart + 86400;
  const doors = db.prepare(
    'SELECT COUNT(*) as cnt FROM flyered_homes WHERE canvasser_id = ? AND logged_at >= ? AND logged_at < ?'
  ).get(canvasserId, dayStart, dayEnd).cnt;

  // Use first→last flyer log as proxy for shift duration
  const firstLog = db.prepare(
    'SELECT MIN(logged_at) as t FROM flyered_homes WHERE canvasser_id = ? AND logged_at >= ? AND logged_at < ?'
  ).get(canvasserId, dayStart, dayEnd);
  const lastLog = db.prepare(
    'SELECT MAX(logged_at) as t FROM flyered_homes WHERE canvasser_id = ? AND logged_at >= ? AND logged_at < ?'
  ).get(canvasserId, dayStart, dayEnd);

  const shiftMins = (firstLog.t && lastLog.t && lastLog.t > firstLog.t)
    ? Math.round((lastLog.t - firstLog.t) / 60)
    : 0;
  const dph = shiftMins > 0 ? Math.round((doors / shiftMins) * 60 * 10) / 10 : 0;

  db.prepare(`
    INSERT INTO canvasser_daily_snapshots (id, business_id, canvasser_id, snap_date, doors, shift_minutes, doors_per_hour, accountability_score)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(canvasser_id, snap_date) DO UPDATE SET
      doors = excluded.doors,
      shift_minutes = excluded.shift_minutes,
      doors_per_hour = excluded.doors_per_hour,
      accountability_score = excluded.accountability_score
  `).run(uuid(), cv.business_id, canvasserId, snapDate, doors, shiftMins, dph, cv.accountability_score);
}

// Seed historical demo snapshots for existing canvassers (called once after seed)
function seedDemoSnapshots(bizId) {
  const cvs = db.prepare('SELECT id FROM canvassers WHERE business_id = ?').all(bizId);
  const today = new Date();
  cvs.forEach(cv => {
    for (let i = 29; i >= 1; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const dow = d.getDay(); // 0=Sun, 6=Sat
      if (dow === 0) continue; // skip Sundays
      const snapDate = d.toISOString().slice(0, 10);
      const existing = db.prepare('SELECT id FROM canvasser_daily_snapshots WHERE canvasser_id = ? AND snap_date = ?').get(cv.id, snapDate);
      if (existing) continue;

      // Randomise realistic-ish numbers with some variance per canvasser
      const seed = cv.id.charCodeAt(0) + i;
      const baseAcc = 50 + (seed % 50);
      const worked = Math.random() > 0.25; // 75% chance worked that day
      if (!worked) continue;
      const doors = worked ? Math.floor(20 + Math.random() * 80) : 0;
      const mins  = worked ? Math.floor(180 + Math.random() * 180) : 0;
      const dph   = mins > 0 ? Math.round((doors / mins) * 60 * 10) / 10 : 0;
      const acc   = Math.max(20, Math.min(100, baseAcc + Math.floor((Math.random() - 0.4) * 20)));
      db.prepare(`
        INSERT OR IGNORE INTO canvasser_daily_snapshots (id, business_id, canvasser_id, snap_date, doors, shift_minutes, doors_per_hour, accountability_score)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(uuid(), bizId, cv.id, snapDate, doors, mins, dph, acc);
    }
  });
}

// Midnight cron: snapshot all active canvassers for yesterday
function midnightSnapshot() {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const snapDate = yesterday.toISOString().slice(0, 10);
  const cvs = db.prepare('SELECT id FROM canvassers').all();
  cvs.forEach(cv => snapshotCanvasserDay(cv.id, snapDate));
}

// Schedule midnight cron
const now = new Date();
const msTillMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 1).getTime() - now.getTime();
setTimeout(() => { midnightSnapshot(); setInterval(midnightSnapshot, 86400000); }, msTillMidnight);

// ─── SEED DEMO DATA ───────────────────────────────────────────────────────────

function seedDemo() {
  const existing = db.prepare('SELECT id FROM businesses WHERE email = ?').get('christina@heliogrowth.com');
  if (existing) return;

  const bizId = uuid();
  db.prepare(`INSERT INTO businesses (id, name, owner_name, email, password_hash)
    VALUES (?, ?, ?, ?, ?)`).run(bizId, 'FrontPorch Marketing', 'Christina Dixon', 'christina@heliogrowth.com', bcrypt.hashSync('demo123', 10));

  const cvData = [
    { name:'Marcus T.', phone:'512-555-0101', location:'Pflugerville, TX', pin:'1111', status:'active', lat:30.5083, lng:-97.6789, acc:94 },
    { name:'Priya K.', phone:'512-555-0102', location:'Round Rock, TX', pin:'2222', status:'active', lat:30.5140, lng:-97.6650, acc:88 },
    { name:'DeShawn R.', phone:'512-555-0103', location:'Pflugerville, TX', pin:'3333', status:'active', lat:30.5020, lng:-97.6920, acc:97 },
    { name:'Sofia L.', phone:'512-555-0104', location:'Georgetown, TX', pin:'4444', status:'idle', lat:30.5060, lng:-97.6820, acc:61 },
    { name:'James W.', phone:'512-555-0105', location:'Cedar Park, TX', pin:'5555', status:'offline', lat:30.5200, lng:-97.6480, acc:42 },
    { name:'Aisha B.', phone:'512-555-0106', location:'Austin, TX', pin:'6666', status:'offline', lat:30.4980, lng:-97.6560, acc:55 },
  ];

  const cvIds = {};
  cvData.forEach(c => {
    const id = uuid();
    cvIds[c.name] = id;
    db.prepare(`INSERT INTO canvassers (id, business_id, name, phone, location, pin_hash, status, lat, lng, last_seen, accountability_score)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, bizId, c.name, c.phone, c.location, bcrypt.hashSync(c.pin, 10), c.status, c.lat, c.lng, Date.now()/1000, c.acc);
  });

  const canvassData = [
    { title:'Summer Push', type:'Door Hangers', status:'active', location:'Williamson County, TX', date_start:'2026-05-20' },
    { title:'Local Promo Blitz', type:'Door Hangers', status:'active', location:'Williamson County, TX', date_start:'2026-05-28', date_end:'2026-06-02' },
    { title:'Spring Awareness', type:'Flyers', status:'completed', location:'Travis County, TX', date_start:'2026-04-01', date_end:'2026-04-30' },
  ];
  const canvassIds = [];
  canvassData.forEach(c => {
    const id = uuid();
    canvassIds.push(id);
    db.prepare(`INSERT INTO canvasses (id, business_id, title, type, status, location, date_start, date_end)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(id, bizId, c.title, c.type, c.status, c.location, c.date_start||null, c.date_end||null);
  });

  // Seed zones for active canvasses
  const zoneData = [
    { idx:0, name:'Oak Creek — North Block', color:'#22c55e', coords:JSON.stringify([[30.518,-97.700],[30.518,-97.680],[30.508,-97.680],[30.508,-97.700]]) },
    { idx:0, name:'Oak Creek — South Block', color:'#0ea5e9', coords:JSON.stringify([[30.508,-97.700],[30.508,-97.680],[30.498,-97.680],[30.498,-97.700]]) },
    { idx:1, name:'Heritage Hills',          color:'#f59e0b', coords:JSON.stringify([[30.525,-97.680],[30.525,-97.655],[30.510,-97.655],[30.510,-97.680]]) },
    { idx:1, name:'Windermere Estates',      color:'#7c3aed', coords:JSON.stringify([[30.510,-97.680],[30.510,-97.655],[30.496,-97.655],[30.496,-97.680]]) },
  ];
  zoneData.forEach(z => {
    db.prepare(`INSERT INTO zones (id, canvass_id, name, color, coords, status) VALUES (?, ?, ?, ?, ?, 'available')`)
      .run(uuid(), canvassIds[z.idx], z.name, z.color, z.coords);
  });

  // Seed door knocks
  const outcomes = ['converted','interested','not_home','no_thanks'];
  const activeCvs = cvData.filter(c => c.status !== 'offline');
  const doorCounts = [68, 54, 71, 54];
  activeCvs.forEach((c, ci) => {
    const cvId = cvIds[c.name];
    const count = doorCounts[ci];
    const convRate = ci === 0 ? 0.16 : ci === 1 ? 0.15 : ci === 2 ? 0.13 : 0.06;
    for (let i = 0; i < count; i++) {
      const r = 0.004 + Math.random()*0.01, a = Math.random()*2*Math.PI;
      const rand = Math.random();
      const outcome = rand < convRate ? 'converted' : rand < convRate+0.23 ? 'interested' : rand < convRate+0.23+0.45 ? 'not_home' : 'no_thanks';
      const hoursAgo = Math.random() * 6;
      db.prepare(`INSERT INTO door_knocks (id, canvasser_id, business_id, canvass_id, lat, lng, outcome, knocked_at, verified)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`).run(
        uuid(), cvId, bizId, canvassIds[0],
        c.lat + Math.cos(a)*r, c.lng + Math.sin(a)*r,
        outcome, Math.floor(Date.now()/1000 - hoursAgo*3600)
      );
    }
  });

  // Seed messages
  const msgData = [
    { name:'Erica A. Lopez', cvId: cvIds['Sofia L.'], texts: [
      {from:'canvasser', text:'Hey Christina! What is the update with flyering this week?', ago: 86400},
      {from:'business', text:'Hi! We\'re back on for Thursday and Friday. Same zones as before.', ago: 83000},
    ]},
  ];
  msgData.forEach(m => {
    m.texts.forEach(t => {
      db.prepare(`INSERT INTO messages (id, business_id, canvasser_id, from_type, text, sent_at)
        VALUES (?, ?, ?, ?, ?, ?)`).run(uuid(), bizId, m.cvId, t.from, t.text, Math.floor(Date.now()/1000 - t.ago));
    });
  });

  console.log('✅ Demo data seeded. Business login: christina@heliogrowth.com / demo123');
  console.log('   Canvasser PINs: Marcus=1111, Priya=2222, DeShawn=3333, Sofia=4444, James=5555, Aisha=6666');
}

seedDemo();

// Seed demo historical snapshots (safe to call every boot — uses INSERT OR IGNORE)
{
  const biz = db.prepare("SELECT id FROM businesses WHERE email = 'christina@heliogrowth.com'").get();
  if (biz) seedDemoSnapshots(biz.id);
}

// ─── AUTH HELPERS ─────────────────────────────────────────────────────────────

function createSession(userId, userType, businessId) {
  const token = uuid();
  db.prepare(`INSERT INTO sessions (token, user_id, user_type, business_id, expires_at)
    VALUES (?, ?, ?, ?, ?)`).run(token, userId, userType, businessId, Math.floor(Date.now()/1000) + 86400*30);
  return token;
}

function getSession(req) {
  const auth = req.headers.authorization;
  if (!auth) return null;
  const token = auth.replace('Bearer ', '');
  return db.prepare('SELECT * FROM sessions WHERE token = ? AND expires_at > ?').get(token, Math.floor(Date.now()/1000));
}

function requireBusiness(req, res, next) {
  const session = getSession(req);
  if (!session || session.user_type !== 'business') return res.status(401).json({ error: 'Unauthorized' });
  req.session = session;
  next();
}

function requireCanvasser(req, res, next) {
  const session = getSession(req);
  if (!session || session.user_type !== 'canvasser') return res.status(401).json({ error: 'Unauthorized' });
  req.session = session;
  next();
}

// ─── ADMIN API ───────────────────────────────────────────────────────────────
// All admin routes reuse business auth (requireBusiness) for now.
// The admin panel logs in via the same business credentials.

// Stats overview
app.get('/api/admin/stats', requireBusiness, (req, res) => {
  const totalCampaigns    = db.prepare('SELECT COUNT(*) as c FROM canvasses').get().c;
  const activeCampaigns   = db.prepare("SELECT COUNT(*) as c FROM canvasses WHERE status='active'").get().c;
  const totalHomes        = db.prepare('SELECT COUNT(*) as c FROM flyered_homes').get().c;
  const totalPros         = db.prepare('SELECT COUNT(*) as c FROM canvassers').get().c;
  const onlinePros        = db.prepare("SELECT COUNT(*) as c FROM canvassers WHERE status='active'").get().c;
  let pendingLeads = 0, pendingApplicants = 0;
  try { pendingLeads      = db.prepare("SELECT COUNT(*) as c FROM intake_leads WHERE status='pending' OR status IS NULL").get().c; } catch {}
  try { pendingApplicants = db.prepare("SELECT COUNT(*) as c FROM canvasser_applicants WHERE status='pending'").get().c; } catch {}
  res.json({ totalCampaigns, activeCampaigns, totalHomes, totalPros, onlinePros, pendingLeads, pendingApplicants });
});

// All businesses
app.get('/api/admin/businesses', requireBusiness, (req, res) => {
  res.json(db.prepare('SELECT id, name, owner_name, email, created_at FROM businesses ORDER BY created_at DESC').all());
});

// Leads (intake submissions)
app.get('/api/admin/leads', requireBusiness, (req, res) => {
  const limit = parseInt(req.query.limit) || 200;
  try {
    const rows = db.prepare(`
      SELECT il.*, c.title, c.location, c.status as camp_status, c.customer_token
      FROM intake_leads il
      LEFT JOIN canvasses c ON il.canvass_id = c.id
      ORDER BY il.created_at DESC LIMIT ?
    `).all(limit);
    res.json(rows);
  } catch { res.json([]); }
});

app.patch('/api/admin/leads/:id', requireBusiness, (req, res) => {
  const { status } = req.body;
  try { db.prepare('UPDATE intake_leads SET status=? WHERE id=?').run(status, req.params.id); } catch {}
  res.json({ ok: true });
});

app.post('/api/admin/leads/:id/convert', requireBusiness, (req, res) => {
  const { title, location, business_id, date_start } = req.body;
  try {
    // Update the campaign draft to active and assign business
    const lead = db.prepare('SELECT * FROM intake_leads WHERE id=?').get(req.params.id);
    if (!lead) return res.status(404).json({ error: 'Lead not found' });
    db.prepare(`UPDATE canvasses SET status='active', business_id=?, title=?, location=?, date_start=? WHERE id=?`)
      .run(business_id, title, location, date_start||null, lead.canvass_id);
    db.prepare("UPDATE intake_leads SET status='converted' WHERE id=?").run(req.params.id);
    const camp = db.prepare('SELECT * FROM canvasses WHERE id=?').get(lead.canvass_id);
    const portalUrl = `${SERVER_URL}/customer-portal.html?token=${camp.customer_token}`;
    broadcast({ type:'campaign_activated', campaignId:lead.canvass_id, title });
    res.json({ ok:true, portal_url:portalUrl });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Applicants
app.get('/api/admin/applicants', requireBusiness, (req, res) => {
  const limit = parseInt(req.query.limit) || 200;
  try {
    res.json(db.prepare('SELECT * FROM canvasser_applicants ORDER BY created_at DESC LIMIT ?').all(limit));
  } catch { res.json([]); }
});

app.patch('/api/admin/applicants/:id', requireBusiness, (req, res) => {
  const { status } = req.body;
  try { db.prepare('UPDATE canvasser_applicants SET status=? WHERE id=?').run(status, req.params.id); } catch {}
  res.json({ ok: true });
});

// All campaigns (admin view — across all businesses)
app.get('/api/admin/campaigns', requireBusiness, (req, res) => {
  const rows = db.prepare(`
    SELECT c.*,
      (SELECT COUNT(*) FROM flyered_homes fh WHERE fh.canvass_id=c.id) as homes_flyered
    FROM canvasses c ORDER BY c.created_at DESC
  `).all();
  res.json(rows);
});

// Analytics
app.get('/api/admin/analytics', requireBusiness, (req, res) => {
  const totalHomes    = db.prepare('SELECT COUNT(*) as c FROM flyered_homes').get().c;
  const totalCampaigns= db.prepare('SELECT COUNT(*) as c FROM canvasses').get().c;
  const activeCampaigns=db.prepare("SELECT COUNT(*) as c FROM canvasses WHERE status='active'").get().c;

  // avg homes per hour (from canvasser daily snapshots if available, else estimate)
  let avgHph = null;
  try {
    const r = db.prepare('SELECT AVG(doors_per_hour) as avg FROM canvasser_daily_snapshots WHERE doors_per_hour > 0').get();
    avgHph = r?.avg || null;
  } catch {}

  const topPros = db.prepare(`
    SELECT c.name, COUNT(*) as homes
    FROM flyered_homes fh JOIN canvassers c ON fh.canvasser_id=c.id
    GROUP BY c.id ORDER BY homes DESC LIMIT 8
  `).all();

  const topCampaigns = db.prepare(`
    SELECT cv.title, COUNT(*) as homes
    FROM flyered_homes fh JOIN canvasses cv ON fh.canvass_id=cv.id
    GROUP BY cv.id ORDER BY homes DESC LIMIT 8
  `).all();

  res.json({ totalHomes, totalCampaigns, activeCampaigns, avgHph, topPros, topCampaigns });
});

// Change password
app.post('/api/admin/change-password', requireBusiness, (req, res) => {
  const { current, password } = req.body;
  const biz = db.prepare('SELECT * FROM businesses WHERE id=?').get(req.session.business_id);
  if (!biz || !bcrypt.compareSync(current, biz.password_hash)) {
    return res.status(401).json({ error: 'Current password incorrect' });
  }
  const hash = bcrypt.hashSync(password, 10);
  db.prepare('UPDATE businesses SET password_hash=? WHERE id=?').run(hash, biz.id);
  res.json({ ok: true });
});

// ─── AUTH ROUTES ─────────────────────────────────────────────────────────────

// Business login
app.post('/api/auth/business/login', (req, res) => {
  const { email, password } = req.body;
  const biz = db.prepare('SELECT * FROM businesses WHERE email = ?').get(email);
  if (!biz || !bcrypt.compareSync(password, biz.password_hash)) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }
  const token = createSession(biz.id, 'business', biz.id);
  res.json({ token, business: { id: biz.id, name: biz.name, owner_name: biz.owner_name, email: biz.email } });
});

// Canvasser login (by name + PIN, within a business)
app.post('/api/auth/canvasser/login', (req, res) => {
  const { name, pin, business_id } = req.body;
  // Find business by any means (allow name-only lookup for demo)
  const biz = business_id
    ? db.prepare('SELECT id FROM businesses WHERE id = ?').get(business_id)
    : db.prepare('SELECT id FROM businesses LIMIT 1').get();
  if (!biz) return res.status(404).json({ error: 'Business not found' });

  const cv = db.prepare('SELECT * FROM canvassers WHERE business_id = ? AND name LIKE ?').get(biz.id, `${name}%`);
  if (!cv || !bcrypt.compareSync(pin, cv.pin_hash)) {
    return res.status(401).json({ error: 'Invalid name or PIN' });
  }
  const token = createSession(cv.id, 'canvasser', biz.id);
  res.json({ token, canvasser: { id: cv.id, name: cv.name, phone: cv.phone, status: cv.status } });
});

// ─── BUSINESS API ─────────────────────────────────────────────────────────────

// Get dashboard summary
app.get('/api/dashboard', requireBusiness, (req, res) => {
  const bizId = req.session.business_id;
  const today = Math.floor(new Date().setHours(0,0,0,0)/1000);

  const doorsToday = db.prepare('SELECT COUNT(*) as c FROM door_knocks WHERE business_id = ? AND knocked_at >= ?').get(bizId, today).c;
  const conversionsToday = db.prepare('SELECT COUNT(*) as c FROM door_knocks WHERE business_id = ? AND knocked_at >= ? AND outcome = ?').get(bizId, today, 'converted').c;
  const activeCanvassers = db.prepare('SELECT COUNT(*) as c FROM canvassers WHERE business_id = ? AND status = ?').get(bizId, 'active').c;
  const totalCanvassers = db.prepare('SELECT COUNT(*) as c FROM canvassers WHERE business_id = ?').get(bizId).c;

  res.json({ doorsToday, conversionsToday, activeCanvassers, totalCanvassers, conversionRate: doorsToday > 0 ? (conversionsToday/doorsToday*100).toFixed(1) : 0 });
});

// Get canvassers
// Create canvasser
app.post('/api/canvassers', requireBusiness, (req, res) => {
  const bizId = req.session.business_id;
  const { name, phone, location } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'Name required' });

  // Generate a random 4-digit PIN
  const pin = String(Math.floor(1000 + Math.random() * 9000));
  const id = uuid();
  db.prepare(`INSERT INTO canvassers (id, business_id, name, phone, location, pin_hash, status, accountability_score)
    VALUES (?, ?, ?, ?, ?, ?, 'offline', 100)`)
    .run(id, bizId, name.trim(), phone || null, location || null, bcrypt.hashSync(pin, 10));

  broadcast({ type: 'canvasser_added', canvasserId: id, name: name.trim() });
  res.json({ id, name: name.trim(), phone, location, pin, status: 'offline' });
});

// Update canvasser
app.put('/api/canvassers/:id', requireBusiness, (req, res) => {
  const bizId = req.session.business_id;
  const { name, phone, location } = req.body;
  const cv = db.prepare('SELECT id FROM canvassers WHERE id = ? AND business_id = ?').get(req.params.id, bizId);
  if (!cv) return res.status(404).json({ error: 'Not found' });
  db.prepare('UPDATE canvassers SET name = ?, phone = ?, location = ? WHERE id = ?')
    .run(name, phone || null, location || null, req.params.id);
  res.json({ success: true });
});

// Delete canvasser
app.delete('/api/canvassers/:id', requireBusiness, (req, res) => {
  const bizId = req.session.business_id;
  const cv = db.prepare('SELECT id FROM canvassers WHERE id = ? AND business_id = ?').get(req.params.id, bizId);
  if (!cv) return res.status(404).json({ error: 'Not found' });
  db.prepare('DELETE FROM door_knocks WHERE canvasser_id = ?').run(req.params.id);
  db.prepare('DELETE FROM messages WHERE canvasser_id = ?').run(req.params.id);
  db.prepare('DELETE FROM canvassers WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// Performance history for a single canvasser — last 30 days of daily snapshots
app.get('/api/canvassers/:id/history', requireBusiness, (req, res) => {
  const bizId = req.session.business_id;
  const cv = db.prepare('SELECT id FROM canvassers WHERE id = ? AND business_id = ?').get(req.params.id, bizId);
  if (!cv) return res.status(404).json({ error: 'Not found' });

  const rows = db.prepare(`
    SELECT snap_date, doors, shift_minutes, doors_per_hour, accountability_score
    FROM canvasser_daily_snapshots
    WHERE canvasser_id = ?
    ORDER BY snap_date DESC
    LIMIT 30
  `).all(req.params.id);

  // Also compute trend: compare avg of last 7 days vs prior 7 days
  const recent = rows.slice(0, 7);
  const prior  = rows.slice(7, 14);
  const avgDoors = arr => arr.length ? arr.reduce((s,r) => s + r.doors, 0) / arr.length : 0;
  const recentAvg = avgDoors(recent);
  const priorAvg  = avgDoors(prior);
  let trend = 'steady';
  if (priorAvg > 0) {
    const pct = (recentAvg - priorAvg) / priorAvg;
    if (pct > 0.1) trend = 'up';
    else if (pct < -0.1) trend = 'down';
  } else if (recentAvg > 0) {
    trend = 'up';
  }

  res.json({ history: rows.reverse(), trend, recentAvg: Math.round(recentAvg), priorAvg: Math.round(priorAvg) });
});

app.get('/api/canvassers', requireBusiness, (req, res) => {
  const bizId = req.session.business_id;
  const today = Math.floor(new Date().setHours(0,0,0,0)/1000);
  const cvs = db.prepare('SELECT * FROM canvassers WHERE business_id = ? ORDER BY created_at ASC').all(bizId);

  const result = cvs.map(cv => {
    const doorsToday = db.prepare('SELECT COUNT(*) as c FROM door_knocks WHERE canvasser_id = ? AND knocked_at >= ?').get(cv.id, today).c;
    const conversions = db.prepare('SELECT COUNT(*) as c FROM door_knocks WHERE canvasser_id = ? AND knocked_at >= ? AND outcome = ?').get(cv.id, today, 'converted').c;
    const shiftSecs = cv.shift_started ? Math.floor(Date.now()/1000) - cv.shift_started : 0;
    const dph = shiftSecs > 0 ? (doorsToday / (shiftSecs/3600)).toFixed(1) : 0;
    return { ...cv, doorsToday, conversions, dph: parseFloat(dph) };
  });

  res.json(result);
});

// Get door knocks (for map)
app.get('/api/doors', requireBusiness, (req, res) => {
  const bizId = req.session.business_id;
  const since = req.query.since || Math.floor(new Date().setHours(0,0,0,0)/1000);
  const doors = db.prepare(`
    SELECT dk.*, c.name as canvasser_name
    FROM door_knocks dk
    JOIN canvassers c ON dk.canvasser_id = c.id
    WHERE dk.business_id = ? AND dk.knocked_at >= ?
    ORDER BY dk.knocked_at DESC
    LIMIT 2000
  `).all(bizId, since);
  res.json(doors);
});

// Get canvasses
app.get('/api/canvasses', requireBusiness, (req, res) => {
  const bizId = req.session.business_id;
  const canvasses = db.prepare('SELECT * FROM canvasses WHERE business_id = ? ORDER BY created_at DESC').all(bizId);
  res.json(canvasses);
});

// Create canvass
app.post('/api/canvasses', requireBusiness, async (req, res) => {
  const bizId = req.session.business_id;
  const { title, type, location, date_start, date_end, customer_name, customer_email } = req.body;
  const id = uuid();
  const customerToken = customer_email ? uuid() : null;
  db.prepare(`INSERT INTO canvasses (id, business_id, title, type, location, date_start, date_end, status, customer_name, customer_email, customer_token)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)`).run(id, bizId, title, type||'Door Hangers', location, date_start||null, date_end||null, customer_name||null, customer_email||null, customerToken);

  // Send welcome email to customer
  if (customer_email && customerToken) {
    const biz = db.prepare('SELECT name FROM businesses WHERE id = ?').get(bizId);
    const portalUrl = `${SERVER_URL}/customer-portal.html?token=${customerToken}`;
    await sendEmail({
      to: customer_email,
      subject: `Your canvassing campaign is live — ${title}`,
      html: emailTemplate({
        preheader: `Your campaign "${title}" has started!`,
        title: `Hi ${customer_name || 'there'} 👋`,
        body: `
          <p>Your canvassing campaign <strong>${title}</strong> is now live with <strong>${biz?.name || 'FrontPorch Marketing'}</strong>.</p>
          <p>You can track real-time progress — every home that gets flyered shows up on your live map with photo proof.</p>
        `,
        cta_url: portalUrl,
        cta_text: 'View Your Live Progress →',
        footer: `Campaign: ${title} · ${location || ''}`
      })
    });
  }
  res.json({ id, customer_token: customerToken });
});

// ── ZONE MANAGEMENT (dashboard) ───────────────────────────────────────────────

// Get zones for a canvass
app.get('/api/canvasses/:id/zones', requireBusiness, (req, res) => {
  const zones = db.prepare(`
    SELECT z.*, (SELECT COUNT(*) FROM flyered_homes WHERE zone_id = z.id) as homes_flyered
    FROM zones z WHERE z.canvass_id = ? ORDER BY z.name
  `).all(req.params.id);
  res.json(zones);
});

// Create zone
app.post('/api/canvasses/:id/zones', requireBusiness, (req, res) => {
  const { name, color, coords, target_homes } = req.body;
  const id = uuid();
  db.prepare(`INSERT INTO zones (id, canvass_id, name, color, coords, status, target_homes) VALUES (?, ?, ?, ?, ?, 'available', ?)`)
    .run(id, req.params.id, name, color || '#22c55e', coords || '[]', parseInt(target_homes) || 0);
  res.json({ id });
});

// Update zone target_homes
app.put('/api/zones/:id', requireBusiness, (req, res) => {
  const { target_homes, name, color } = req.body;
  if (target_homes !== undefined) db.prepare('UPDATE zones SET target_homes = ? WHERE id = ?').run(parseInt(target_homes) || 0, req.params.id);
  if (name !== undefined) db.prepare('UPDATE zones SET name = ? WHERE id = ?').run(name, req.params.id);
  if (color !== undefined) db.prepare('UPDATE zones SET color = ? WHERE id = ?').run(color, req.params.id);
  res.json({ success: true });
});

// Get messages
app.get('/api/messages', requireBusiness, (req, res) => {
  const bizId = req.session.business_id;
  const threads = db.prepare(`
    SELECT c.id as canvasser_id, c.name, c.status,
      (SELECT text FROM messages WHERE canvasser_id = c.id AND business_id = ? ORDER BY sent_at DESC LIMIT 1) as last_message,
      (SELECT sent_at FROM messages WHERE canvasser_id = c.id AND business_id = ? ORDER BY sent_at DESC LIMIT 1) as last_sent,
      (SELECT COUNT(*) FROM messages WHERE canvasser_id = c.id AND business_id = ? AND from_type = 'canvasser' AND read = 0) as unread
    FROM canvassers c
    WHERE c.business_id = ? AND EXISTS (SELECT 1 FROM messages WHERE canvasser_id = c.id AND business_id = ?)
    ORDER BY last_sent DESC
  `).all(bizId, bizId, bizId, bizId, bizId);
  res.json(threads);
});

// Get thread messages
app.get('/api/messages/:canvasserId', requireBusiness, (req, res) => {
  const bizId = req.session.business_id;
  const msgs = db.prepare(`
    SELECT * FROM messages WHERE business_id = ? AND canvasser_id = ? ORDER BY sent_at ASC
  `).all(bizId, req.params.canvasserId);
  // Mark as read
  db.prepare('UPDATE messages SET read = 1 WHERE business_id = ? AND canvasser_id = ? AND from_type = ?').run(bizId, req.params.canvasserId, 'canvasser');
  res.json(msgs);
});

// Send message (business -> canvasser)
app.post('/api/messages/:canvasserId', requireBusiness, (req, res) => {
  const bizId = req.session.business_id;
  const { text } = req.body;
  const id = uuid();
  db.prepare(`INSERT INTO messages (id, business_id, canvasser_id, from_type, text) VALUES (?, ?, ?, 'business', ?)`).run(id, bizId, req.params.canvasserId, text);
  broadcast({ type: 'new_message', canvasserId: req.params.canvasserId, text, from: 'business' });
  res.json({ id });
});

// ─── PAYOUTS API ─────────────────────────────────────────────────────────────

// Helper: get Monday 00:00 UTC of the current week (or a given week offset)
// Week runs Sunday → Saturday. Tiers reset every Sunday.
function getWeekStart(offsetWeeks = 0) {
  const now = new Date();
  const day = now.getUTCDay(); // 0=Sun
  const sunday = new Date(now);
  sunday.setUTCDate(now.getUTCDate() - day + offsetWeeks * 7);
  sunday.setUTCHours(0, 0, 0, 0);
  return Math.floor(sunday.getTime() / 1000);
}

// Tiers are based on homes flyered THIS week (Sun–Sat) and reset every Sunday.
// Days shown to FlyerPros are a recommended pace — not a hard requirement.
const TIERS = [
  { name: 'Starter', minDoors: 0,    rate: 0.10, maxZones: 1 },
  { name: 'Pro',     minDoors: 1000, rate: 0.18, maxZones: 2 },
  { name: 'Elite',   minDoors: 1500, rate: 0.25, maxZones: 5 },
];
const CASHOUT_THRESHOLD = 500;

// weeklyDoors = homes flyered since last Sunday
function calcTier(weeklyDoors) {
  if (weeklyDoors >= 1500) return TIERS[2];
  if (weeklyDoors >= 1000) return TIERS[1];
  return TIERS[0];
}

// Helper: get this week's door count for a canvasser
function getWeeklyDoors(canvasserId) {
  const ws = getWeekStart();
  return db.prepare('SELECT COUNT(*) as c FROM flyered_homes WHERE canvasser_id=? AND logged_at>=?').get(canvasserId, ws).c;
}

// GET /api/payouts — current week's payout data for all canvassers
app.get('/api/payouts', requireBusiness, (req, res) => {
  const bizId = req.session.business_id;
  const weekStart = getWeekStart();
  const weekEnd = weekStart + 7 * 86400;

  const cvs = db.prepare('SELECT * FROM canvassers WHERE business_id = ?').all(bizId);

  const result = cvs.map(cv => {
    // Weekly flyered homes
    const weeklyDoors = db.prepare(
      `SELECT COUNT(*) as c FROM flyered_homes WHERE canvasser_id = ? AND logged_at >= ? AND logged_at < ?`
    ).get(cv.id, weekStart, weekEnd).c;

    const tier = calcTier(weeklyDoors); // tier based on this week's homes
    const amount = weeklyDoors * tier.rate;
    const canCashOut = weeklyDoors >= CASHOUT_THRESHOLD;

    // Check if already approved/paid this week
    const payout = db.prepare(
      `SELECT * FROM payouts WHERE business_id = ? AND canvasser_id = ? AND week_start = ?`
    ).get(bizId, cv.id, weekStart);

    return {
      canvasser_id: cv.id,
      name: cv.name,
      phone: cv.phone,
      location: cv.location,
      status: cv.status,
      weeklyDoors,
      daysWorked,
      tier: tier.name,
      rate: tier.rate,
      amount,
      canCashOut,
      paid: payout?.status === 'paid',
      paid_at: payout?.paid_at || null,
    };
  }).filter(c => c.weeklyDoors > 0 || c.paid); // only show active or paid

  res.json({ weekStart, canvassers: result });
});

// POST /api/payouts/:canvasserId/approve
app.post('/api/payouts/:canvasserId/approve', requireBusiness, (req, res) => {
  const bizId = req.session.business_id;
  const weekStart = getWeekStart();
  const now = Math.floor(Date.now() / 1000);
  db.prepare(`
    INSERT INTO payouts (id, business_id, canvasser_id, week_start, status, paid_at)
    VALUES (?, ?, ?, ?, 'paid', ?)
    ON CONFLICT(business_id, canvasser_id, week_start) DO UPDATE SET status='paid', paid_at=excluded.paid_at
  `).run(uuid(), bizId, req.params.canvasserId, weekStart, now);
  res.json({ success: true });
});

// POST /api/payouts/approve-all
app.post('/api/payouts/approve-all', requireBusiness, (req, res) => {
  const bizId = req.session.business_id;
  const weekStart = getWeekStart();
  const now = Math.floor(Date.now() / 1000);
  const cvs = db.prepare('SELECT id FROM canvassers WHERE business_id = ?').all(bizId);
  const stmt = db.prepare(`
    INSERT INTO payouts (id, business_id, canvasser_id, week_start, status, paid_at)
    VALUES (?, ?, ?, ?, 'paid', ?)
    ON CONFLICT(business_id, canvasser_id, week_start) DO UPDATE SET status='paid', paid_at=excluded.paid_at
  `);
  const run = db.transaction(() => cvs.forEach(cv => stmt.run(uuid(), bizId, cv.id, weekStart, now)));
  run();
  res.json({ success: true });
});

// ─── SCHEDULE API ─────────────────────────────────────────────────────────────

// GET /api/schedule?week_start=YYYY-MM-DD
app.get('/api/schedule', requireBusiness, (req, res) => {
  const bizId = req.session.business_id;
  const weekStart = req.query.week_start; // e.g. "2026-06-01"
  if (!weekStart) return res.status(400).json({ error: 'week_start required' });
  // Get all 7 days of the week
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 7);
  const weekEndStr = weekEnd.toISOString().slice(0, 10);
  const shifts = db.prepare(`
    SELECT s.*, c.name as canvasser_name
    FROM shifts s JOIN canvassers c ON s.canvasser_id = c.id
    WHERE s.business_id = ? AND s.shift_date >= ? AND s.shift_date < ?
    ORDER BY s.shift_date, c.name
  `).all(bizId, weekStart, weekEndStr);
  res.json(shifts);
});

// POST /api/schedule — upsert a shift
app.post('/api/schedule', requireBusiness, (req, res) => {
  const bizId = req.session.business_id;
  const { canvasser_id, shift_date, shift_type } = req.body;
  if (!canvasser_id || !shift_date || !shift_type) return res.status(400).json({ error: 'Missing fields' });
  const id = uuid();
  db.prepare(`
    INSERT INTO shifts (id, business_id, canvasser_id, shift_date, shift_type)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(business_id, canvasser_id, shift_date) DO UPDATE SET shift_type = excluded.shift_type
  `).run(id, bizId, canvasser_id, shift_date, shift_type);
  const row = db.prepare('SELECT * FROM shifts WHERE business_id = ? AND canvasser_id = ? AND shift_date = ?').get(bizId, canvasser_id, shift_date);
  res.json(row);
});

// DELETE /api/schedule/:id
app.delete('/api/schedule/:id', requireBusiness, (req, res) => {
  const bizId = req.session.business_id;
  db.prepare('DELETE FROM shifts WHERE id = ? AND business_id = ?').run(req.params.id, bizId);
  res.json({ success: true });
});

// ─── CANVASSER API ────────────────────────────────────────────────────────────

// Get my info + today's stats
app.get('/api/canvasser/me', requireCanvasser, (req, res) => {
  const cv = db.prepare('SELECT * FROM canvassers WHERE id = ?').get(req.session.user_id);
  const today = Math.floor(new Date().setHours(0,0,0,0)/1000);
  const todayStr = new Date().toISOString().slice(0,10);

  // Flyered homes today
  const homesFlYeredToday = db.prepare('SELECT COUNT(*) as c FROM flyered_homes WHERE canvasser_id = ? AND logged_at >= ?').get(cv.id, today).c;
  const recentHomes = db.prepare('SELECT * FROM flyered_homes WHERE canvasser_id = ? AND logged_at >= ? ORDER BY logged_at DESC LIMIT 10').all(cv.id, today);

  // Current claimed zone
  const currentZone = db.prepare(`
    SELECT z.*, c.title as canvass_title,
      (SELECT COUNT(*) FROM flyered_homes fh WHERE fh.zone_id = z.id) as homes_flyered
    FROM zones z JOIN canvasses c ON z.canvass_id = c.id
    WHERE z.claimed_by = ?
  `).get(cv.id) || null;

  const shiftSecs = cv.shift_started ? Math.floor(Date.now()/1000) - cv.shift_started : 0;
  const hph = shiftSecs > 0 ? (homesFlYeredToday / (shiftSecs/3600)).toFixed(1) : 0;

  // Tier info
  const weekStart   = getWeekStart();
  const weeklyDoors = db.prepare('SELECT COUNT(*) as c FROM flyered_homes WHERE canvasser_id = ? AND logged_at >= ?').get(cv.id, weekStart).c;
  const daysWorked  = db.prepare(`SELECT COUNT(DISTINCT date(logged_at,'unixepoch')) as d FROM flyered_homes WHERE canvasser_id = ? AND logged_at >= ?`).get(cv.id, weekStart).d;
  const tier        = calcTier(weeklyDoors, daysWorked);

  // All claimed zones (multi-zone support)
  const claimedZones = db.prepare(`
    SELECT z.*, c.title as canvass_title,
      (SELECT COUNT(*) FROM flyered_homes fh WHERE fh.zone_id = z.id) as homes_flyered
    FROM zones z JOIN canvasses c ON z.canvass_id = c.id
    WHERE z.claimed_by = ?
  `).all(cv.id);

  res.json({ ...cv, homesFlYeredToday, recentHomes, currentZone, claimedZones, shiftSecs, hph: parseFloat(hph), tier: tier.name, maxZones: tier.maxZones });
});

// Start shift
app.post('/api/canvasser/shift/start', requireCanvasser, (req, res) => {
  const { lat, lng } = req.body;
  db.prepare('UPDATE canvassers SET status = ?, shift_started = ?, lat = ?, lng = ?, last_seen = ? WHERE id = ?').run('active', Math.floor(Date.now()/1000), lat, lng, Math.floor(Date.now()/1000), req.session.user_id);
  broadcast({ type: 'canvasser_update', canvasserId: req.session.user_id, status: 'active', lat, lng });
  res.json({ success: true });
});

// End shift
app.post('/api/canvasser/shift/end', requireCanvasser, (req, res) => {
  db.prepare('UPDATE canvassers SET status = ?, shift_started = NULL, last_seen = ? WHERE id = ?').run('offline', Math.floor(Date.now()/1000), req.session.user_id);
  broadcast({ type: 'canvasser_update', canvasserId: req.session.user_id, status: 'offline' });
  // Snapshot today's performance
  const today = new Date().toISOString().slice(0, 10);
  try { snapshotCanvasserDay(req.session.user_id, today); } catch(e) { console.warn('Snapshot error:', e.message); }
  res.json({ success: true });
});

// Update GPS location
app.post('/api/canvasser/location', requireCanvasser, (req, res) => {
  const { lat, lng } = req.body;
  const now = Math.floor(Date.now()/1000);

  // Accountability: check if idle too long
  const cv = db.prepare('SELECT * FROM canvassers WHERE id = ?').get(req.session.user_id);
  const timeSinceLastKnock = db.prepare('SELECT MAX(knocked_at) as t FROM door_knocks WHERE canvasser_id = ?').get(cv.id)?.t;
  const idleMins = timeSinceLastKnock ? (now - timeSinceLastKnock) / 60 : 0;
  const newStatus = cv.status === 'offline' ? 'offline' : idleMins > 15 ? 'idle' : 'active';

  db.prepare('UPDATE canvassers SET lat = ?, lng = ?, last_seen = ?, status = ? WHERE id = ?').run(lat, lng, now, newStatus, cv.id);
  broadcast({ type: 'location_update', canvasserId: cv.id, lat, lng, status: newStatus });
  res.json({ success: true });
});

// Log a door knock
app.post('/api/canvasser/door', requireCanvasser, (req, res) => {
  const { lat, lng, outcome, notes, address, photo_base64 } = req.body;
  if (!['converted','interested','not_home','no_thanks'].includes(outcome)) {
    return res.status(400).json({ error: 'Invalid outcome' });
  }

  // Save photo to disk if provided
  let photoUrl = null;
  if (photo_base64) {
    try {
      const base64Data = photo_base64.replace(/^data:image\/\w+;base64,/, '');
      const photoId = uuid();
      const photoPath = path.join(PHOTOS_DIR, `${photoId}.jpg`);
      fs.writeFileSync(photoPath, Buffer.from(base64Data, 'base64'));
      photoUrl = `/photos/${photoId}.jpg`;
    } catch(e) { console.error('Photo save error:', e.message); }
  }

  const cv = db.prepare('SELECT * FROM canvassers WHERE id = ?').get(req.session.user_id);
  const id = uuid();
  db.prepare(`INSERT INTO door_knocks (id, canvasser_id, business_id, lat, lng, outcome, notes, address, verified, photo_url)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`).run(id, cv.id, cv.business_id, lat, lng, outcome, notes||null, address||null, photoUrl);

  // Update GPS
  const now = Math.floor(Date.now()/1000);
  db.prepare('UPDATE canvassers SET lat = ?, lng = ?, last_seen = ?, status = ? WHERE id = ?').run(lat, lng, now, 'active', cv.id);

  // Recalculate accountability (based on doors/hr and idle time)
  const today = Math.floor(new Date().setHours(0,0,0,0)/1000);
  const doorsToday = db.prepare('SELECT COUNT(*) as c FROM door_knocks WHERE canvasser_id = ? AND knocked_at >= ?').get(cv.id, today).c;
  const shiftSecs = cv.shift_started ? (now - cv.shift_started) : 0;
  const dph = shiftSecs > 0 ? doorsToday / (shiftSecs/3600) : 0;
  const accScore = Math.min(100, Math.max(0, Math.round(Math.min(dph/15, 1) * 70 + 30)));
  db.prepare('UPDATE canvassers SET accountability_score = ? WHERE id = ?').run(accScore, cv.id);

  broadcast({ type: 'door_knock', canvasserId: cv.id, lat, lng, outcome, doorId: id, businessId: cv.business_id, photo_url: photoUrl });
  res.json({ id, accountability_score: accScore });
});

// ── ZONE & FLYER ENDPOINTS ──────────────────────────────────────────────────

// Get available zones + my claimed zone
app.get('/api/canvasser/zones', requireCanvasser, (req, res) => {
  const cv = db.prepare('SELECT * FROM canvassers WHERE id = ?').get(req.session.user_id);
  const zones = db.prepare(`
    SELECT z.*, c.title as canvass_title, c.location as canvass_location,
      (SELECT COUNT(*) FROM flyered_homes fh WHERE fh.zone_id = z.id) as homes_flyered
    FROM zones z
    JOIN canvasses c ON z.canvass_id = c.id
    WHERE c.business_id = ? AND c.status != 'draft'
      AND (z.status IN ('available','claimed') OR z.claimed_by = ?)
    ORDER BY z.status DESC, c.title
  `).all(cv.business_id, cv.id);
  res.json(zones);
});

// Claim a zone
app.post('/api/canvasser/zones/:id/claim', requireCanvasser, (req, res) => {
  const cv = db.prepare('SELECT * FROM canvassers WHERE id = ?').get(req.session.user_id);
  const zone = db.prepare('SELECT * FROM zones WHERE id = ?').get(req.params.id);
  if (!zone) return res.status(404).json({ error: 'Zone not found' });
  if (zone.status === 'claimed' && zone.claimed_by !== cv.id) {
    return res.status(409).json({ error: 'Zone already claimed by another canvasser' });
  }
  // Already claimed by this canvasser — no-op
  if (zone.claimed_by === cv.id) return res.json({ success: true });

  // Determine tier and zone limit
  const weekStart = getWeekStart();
  const weeklyDoors = db.prepare('SELECT COUNT(*) as c FROM flyered_homes WHERE canvasser_id = ? AND logged_at >= ?').get(cv.id, weekStart).c;
  const daysWorked  = db.prepare('SELECT COUNT(DISTINCT date(logged_at,\'unixepoch\')) as d FROM flyered_homes WHERE canvasser_id = ? AND logged_at >= ?').get(cv.id, weekStart).d;
  const tier = calcTier(weeklyDoors, daysWorked);
  const heldCount = db.prepare(`SELECT COUNT(*) as c FROM zones WHERE claimed_by = ?`).get(cv.id).c;

  if (heldCount >= tier.maxZones) {
    return res.status(403).json({
      error: `Zone limit reached`,
      tier: tier.name,
      maxZones: tier.maxZones,
      held: heldCount
    });
  }

  // Claim the zone
  db.prepare(`UPDATE zones SET status='claimed', claimed_by=?, claimed_at=? WHERE id=?`)
    .run(cv.id, Math.floor(Date.now()/1000), req.params.id);
  broadcast({ type:'zone_claimed', zoneId:req.params.id, canvasserId:cv.id, canvasserName:cv.name });
  res.json({ success:true, tier: tier.name, maxZones: tier.maxZones, held: heldCount + 1 });
});

// Release a zone
app.delete('/api/canvasser/zones/:id/claim', requireCanvasser, (req, res) => {
  const cv = db.prepare('SELECT * FROM canvassers WHERE id = ?').get(req.session.user_id);
  db.prepare(`UPDATE zones SET status='available', claimed_by=NULL, claimed_at=NULL WHERE id=? AND claimed_by=?`)
    .run(req.params.id, cv.id);
  res.json({ success:true });
});

// Mark zone complete (requires 90% of target_homes flyered)
app.post('/api/canvasser/zones/:id/complete', requireCanvasser, (req, res) => {
  const cv = db.prepare('SELECT * FROM canvassers WHERE id = ?').get(req.session.user_id);
  const zone = db.prepare(`
    SELECT z.*, (SELECT COUNT(*) FROM flyered_homes WHERE zone_id = z.id) as homes_flyered
    FROM zones z WHERE z.id = ?
  `).get(req.params.id);

  if (!zone) return res.status(404).json({ error: 'Zone not found' });
  if (zone.claimed_by !== cv.id) return res.status(403).json({ error: 'You do not own this zone' });
  if (zone.completed_at) return res.status(409).json({ error: 'Zone already marked complete' });

  const target  = zone.target_homes || 0;
  const flyered = zone.homes_flyered || 0;
  const pct     = target > 0 ? flyered / target : 0;

  if (target > 0 && pct < 0.9) {
    return res.status(422).json({
      error: 'Not enough homes flyered',
      flyered, target,
      pct: Math.round(pct * 100),
      needed: Math.ceil(target * 0.9) - flyered
    });
  }

  db.prepare(`UPDATE zones SET status='complete', completed_at=?, completed_by=?, claimed_by=NULL, claimed_at=NULL WHERE id=?`)
    .run(Math.floor(Date.now()/1000), cv.id, zone.id);

  broadcast({ type:'zone_complete', zoneId:zone.id, canvasserId:cv.id, canvasserName:cv.name, flyered, target });
  res.json({ success:true, flyered, target, pct: Math.round(pct * 100) });
});

// Get flyered homes for a zone (for map display)
app.get('/api/canvasser/zones/:id/homes', requireCanvasser, (req, res) => {
  const homes = db.prepare('SELECT * FROM flyered_homes WHERE zone_id = ? ORDER BY logged_at DESC').all(req.params.id);
  res.json(homes);
});

// Log a flyered home
// ── GPS distance helper ───────────────────────────────────────────────────────
function haversineMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const dLat = (lat2-lat1)*Math.PI/180;
  const dLng = (lng2-lng1)*Math.PI/180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

// ── CANVASSER CASHOUT REQUEST ─────────────────────────────────────────────────
app.post('/api/canvasser/cashout', requireCanvasser, (req, res) => {
  const cv   = db.prepare('SELECT * FROM canvassers WHERE id=?').get(req.session.user_id);
  const ws   = getWeekStart();
  const weekHomes = getWeeklyDoors(cv.id);

  if (weekHomes < CASHOUT_THRESHOLD) {
    return res.status(400).json({ error: `Need ${CASHOUT_THRESHOLD - weekHomes} more flyers to cash out.` });
  }
  const existing = db.prepare(`SELECT id FROM payouts WHERE canvasser_id=? AND week_start=?`).get(cv.id, ws);
  if (existing) return res.status(409).json({ error: 'Already cashed out this week.' });

  const tier   = calcTier(weekHomes);
  const amount = (weekHomes * tier.rate).toFixed(2);
  db.prepare(`INSERT OR IGNORE INTO payouts (id, business_id, canvasser_id, week_start, status, paid_at)
    VALUES (?, ?, ?, ?, 'pending', NULL)`)
    .run(uuid(), cv.business_id, cv.id, ws);

  // Notify dashboard
  broadcast({ type:'cashout_request', canvasserId:cv.id, name:cv.name, amount, homes:weekHomes });

  // Notify canvasser via message
  const msgId = uuid();
  db.prepare(`INSERT INTO messages (id, business_id, canvasser_id, from_type, text) VALUES (?, ?, ?, 'business', ?)`)
    .run(msgId, cv.business_id, cv.id, `💸 Cash out request received for $${amount} (${weekHomes} homes @ $${tier.rate}/home). You'll receive payment shortly!`);

  res.json({ ok: true, amount, homes: weekHomes, rate: tier.rate });
});

// ── CANVASSER EARNINGS HISTORY ────────────────────────────────────────────────
app.get('/api/canvasser/earnings', requireCanvasser, (req, res) => {
  const cv = db.prepare('SELECT * FROM canvassers WHERE id = ?').get(req.session.user_id);
  const period = req.query.period || 'week'; // week | month | year

  let groupFmt, since;
  const now = Math.floor(Date.now()/1000);
  if (period === 'week') {
    since = now - 7*86400;
    groupFmt = "strftime('%Y-%m-%d', datetime(logged_at, 'unixepoch'))";
  } else if (period === 'month') {
    since = now - 30*86400;
    groupFmt = "strftime('%Y-%m-%d', datetime(logged_at, 'unixepoch'))";
  } else {
    since = now - 365*86400;
    groupFmt = "strftime('%Y-%m', datetime(logged_at, 'unixepoch'))";
  }

  const rows = db.prepare(`
    SELECT ${groupFmt} as period, COUNT(*) as homes
    FROM flyered_homes
    WHERE canvasser_id = ? AND logged_at >= ?
    GROUP BY period ORDER BY period ASC
  `).all(cv.id, since);

  const allTime = db.prepare('SELECT COUNT(*) as c FROM flyered_homes WHERE canvasser_id=?').get(cv.id).c;
  const thisWeek = db.prepare('SELECT COUNT(*) as c FROM flyered_homes WHERE canvasser_id=? AND logged_at>=?').get(cv.id, now-7*86400).c;
  const thisMonth = db.prepare('SELECT COUNT(*) as c FROM flyered_homes WHERE canvasser_id=? AND logged_at>=?').get(cv.id, now-30*86400).c;

  // Tier resets every Sunday — based on THIS week's homes
  const weeklyForTier = getWeeklyDoors(cv.id);
  const tier = calcTier(weeklyForTier);

  // Check if already cashed out this week
  const ws = getWeekStart();
  const alreadyCashedOut = !!db.prepare(
    `SELECT id FROM payouts WHERE canvasser_id=? AND week_start=? AND status='paid'`
  ).get(cv.id, ws);

  res.json({ rows, allTime, thisWeek, thisMonth, rate: tier.rate, tier: tier.name, alreadyCashedOut });
});

app.post('/api/canvasser/flyer', requireCanvasser, (req, res) => {
  const { zone_id, lat, lng, address, photo_base64 } = req.body;
  if (!zone_id || !lat || !lng || !photo_base64) {
    return res.status(400).json({ error: 'zone_id, lat, lng, photo_base64 required' });
  }
  const cv = db.prepare('SELECT * FROM canvassers WHERE id = ?').get(req.session.user_id);
  const zone = db.prepare('SELECT * FROM zones WHERE id = ? AND claimed_by = ?').get(zone_id, cv.id);
  if (!zone) return res.status(403).json({ error: 'You have not claimed this zone' });

  // ── GPS VERIFICATION ──────────────────────────────────────────────────────
  // Cross-check submitted GPS against canvasser's last known position.
  // Reject if more than 500m away (likely spoofed location).
  const MAX_DISTANCE_METERS = 500;
  if (cv.lat && cv.lng) {
    const dist = haversineMeters(lat, lng, cv.lat, cv.lng);
    if (dist > MAX_DISTANCE_METERS) {
      return res.status(400).json({
        error: `Location mismatch — photo GPS is ${Math.round(dist)}m from your current position. Please take the photo at the home.`,
        code: 'GPS_MISMATCH',
        distance: Math.round(dist),
      });
    }
  }

  let photoUrl = null;
  try {
    const base64Data = photo_base64.replace(/^data:image\/\w+;base64,/, '');
    const photoId = uuid();
    fs.writeFileSync(path.join(PHOTOS_DIR, `${photoId}.jpg`), Buffer.from(base64Data, 'base64'));
    photoUrl = `/photos/${photoId}.jpg`;
  } catch(e) { return res.status(500).json({ error: 'Failed to save photo' }); }

  const id = uuid();
  db.prepare(`INSERT INTO flyered_homes (id, zone_id, canvass_id, business_id, canvasser_id, lat, lng, address, photo_url)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, zone_id, zone.canvass_id, cv.business_id, cv.id, lat, lng, address||null, photoUrl);

  const count = db.prepare('SELECT COUNT(*) as c FROM flyered_homes WHERE zone_id=?').get(zone_id).c;
  const totalToday = db.prepare(`SELECT COUNT(*) as c FROM flyered_homes WHERE canvasser_id=? AND logged_at>=?`).get(cv.id, Math.floor(new Date().setHours(0,0,0,0)/1000)).c;

  broadcast({ type:'home_flyered', zoneId:zone_id, canvasserId:cv.id, lat, lng, photoUrl, count });

  // Canvasser milestone motivational messages
  const cvMilestones = {
    10:  `🔥 10 homes flyered today, ${cv.name.split(' ')[0]}! You're warming up — keep that pace!`,
    25:  `💪 25 homes! You're crushing it out there. Stay hydrated and keep going!`,
    50:  `🎉 50 homes flyered! Incredible work — that's serious hustle. Keep pushing!`,
    100: `🏆 100 homes today!! You're an absolute machine. The neighborhood is covered!`,
    250: `🚀 250 homes — WOW. You're in elite territory. Finish strong!`,
    500: `👑 500 homes flyered — legendary. You've unlocked cashout. Go collect your reward! 💰`,
  };
  if (cvMilestones[totalToday]) {
    const msgId = uuid();
    db.prepare(`INSERT INTO messages (id, business_id, canvasser_id, from_type, text) VALUES (?, ?, ?, 'business', ?)`)
      .run(msgId, cv.business_id, cv.id, cvMilestones[totalToday]);
    broadcast({ type:'new_message', canvasserId:cv.id, text:cvMilestones[totalToday], from:'business' });
  }

  // Customer milestone emails
  const canvass = db.prepare('SELECT * FROM canvasses WHERE id = ?').get(zone.canvass_id);
  const customerMilestones = {
    10:  { subject:`First update: 10 homes flyered in ${zone.name}!`, emoji:'🏁', msg:`Things are getting started! 10 homes have been flyered so far in your area.` },
    25:  { subject:`25 homes flyered in ${zone.name}`, emoji:'📈', msg:`Great progress — 25 homes reached! Your canvassers are covering good ground.` },
    50:  { subject:`Milestone: 50 homes flyered in ${zone.name} 🎉`, emoji:'🎉', msg:`50 homes flyered in your area! That's a significant portion of your neighborhood covered.` },
    100: { subject:`100 homes flyered in ${zone.name} 🏆`, emoji:'🏆', msg:`100 homes! Your campaign is really taking shape. Check your portal for photo proof of every home.` },
    250: { subject:`250 homes flyered — your campaign is going strong!`, emoji:'🚀', msg:`250 homes flyered across your zone. Your canvassers are doing incredible work out there.` },
    500: { subject:`500 homes flyered — campaign complete! 👑`, emoji:'👑', msg:`500 homes flyered — your entire neighborhood has been covered! Check your portal to see every verified home with photo proof.` },
  };
  if (canvass?.customer_email && customerMilestones[count]) {
    const m = customerMilestones[count];
    const portalUrl = `${SERVER_URL}/customer-portal.html?token=${canvass.customer_token}`;
    sendEmail({
      to: canvass.customer_email,
      subject: m.subject,
      html: emailTemplate({
        preheader: m.msg,
        title: `${m.emoji} ${m.msg}`,
        body: `
          <p>Your canvassing campaign <strong>${canvass.title}</strong> just hit a new milestone.</p>
          <p>Zone: <strong>${zone.name}</strong><br>Homes flyered: <strong>${count}</strong></p>
          <p>Every verified home includes a photo taken on-site. Click below to see your live progress map and browse all the proof photos.</p>
        `,
        cta_url: portalUrl,
        cta_text: 'View Live Progress Map →',
        footer: `Campaign: ${canvass.title} · Powered by FrontPorch Marketing`
      })
    });
  }

  res.json({ id, photo_url: photoUrl, count, totalToday });
});

// ─── PUBLIC INTAKE FORM ───────────────────────────────────────────────────────
// POST /api/intake — creates a campaign draft + notifies the business via WS

app.post('/api/intake', (req, res) => {
  const {
    first_name, last_name, business_name, phone, email,
    campaign_name, location, target_homes, start_date, instructions,
    flyer_type, artwork_ready, printing, flyer_notes,
    budget, referral, other_notes,
  } = req.body;

  if (!first_name || !last_name || !email || !campaign_name || !location) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const intakeId   = uuid();
  const campaignId = uuid();
  const token      = uuid().replace(/-/g, '');
  const now        = Math.floor(Date.now() / 1000);

  // Store intake lead in canvasses table using existing schema
  // business_id = null (no account yet) — dashboard shows unassigned drafts
  db.prepare(`
    INSERT INTO canvasses
      (id, business_id, title, type, status, location, date_start,
       customer_name, customer_email, customer_token, created_at)
    VALUES (?, NULL, ?, ?, 'intake', ?, ?, ?, ?, ?, ?)
  `).run(
    campaignId,
    campaign_name,
    flyer_type || 'Door Hangers',
    location,
    start_date || null,
    `${first_name} ${last_name} — ${business_name}`,
    email,
    token,
    now,
  );

  // Store extra intake metadata as JSON note (use notes field or separate table if needed)
  // For now we store in a simple intake_leads table (auto-created)
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS intake_leads (
      id TEXT PRIMARY KEY,
      canvass_id TEXT,
      first_name TEXT, last_name TEXT, business_name TEXT, phone TEXT, email TEXT,
      target_homes INTEGER, instructions TEXT,
      artwork_ready TEXT, printing TEXT, flyer_notes TEXT,
      budget TEXT, referral TEXT, other_notes TEXT,
      created_at INTEGER DEFAULT (unixepoch())
    )`);
  } catch {}

  db.prepare(`
    INSERT INTO intake_leads
      (id, canvass_id, first_name, last_name, business_name, phone, email,
       target_homes, instructions, artwork_ready, printing, flyer_notes,
       budget, referral, other_notes, created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    intakeId, campaignId,
    first_name, last_name, business_name, phone || null, email,
    target_homes || 0, instructions || null,
    artwork_ready || null, printing || null, flyer_notes || null,
    budget || null, referral || null, other_notes || null,
    now,
  );

  // Notify all connected dashboard clients
  broadcast({ type: 'new_intake', campaignId, name: `${first_name} ${last_name}`, business: business_name, email, campaign: campaign_name });

  // Send confirmation email to customer
  const portalUrl = `${SERVER_URL}/customer-portal.html?token=${token}`;
  sendEmail({
    to: email,
    subject: `Campaign Request Received — ${campaign_name}`,
    html: emailTemplate({
      preheader: `We got your request for "${campaign_name}" and will be in touch within one business day.`,
      title: `Thanks, ${first_name}! We received your request.`,
      body: `<p>We've received your campaign request for <strong>${campaign_name}</strong> in <strong>${location}</strong>.</p>
             <p>One of our team members will reach out to <strong>${email}</strong> within one business day to confirm details and get you started.</p>
             <p>In the meantime, you can bookmark your campaign portal link below — it will update live once your campaign is activated.</p>`,
      cta_url: portalUrl,
      cta_text: 'View Your Campaign Portal',
      footer: 'FrontPorch Marketing · You received this because you submitted a campaign request.',
    }),
  });

  res.json({ success: true, campaign_id: campaignId, portal_url: portalUrl });
});

// ─── FLYERPRO SIGN-UP ─────────────────────────────────────────────────────────

app.post('/api/flyerpro-signup', (req, res) => {
  const { first_name, last_name, phone, email, city, age_range,
          days, shift, hours_per_week, start_when, transport } = req.body;

  if (!first_name || !last_name || !phone || !email) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  // Create applicant table if not exists
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS canvasser_applicants (
      id TEXT PRIMARY KEY,
      first_name TEXT, last_name TEXT, phone TEXT, email TEXT UNIQUE,
      city TEXT, age_range TEXT,
      days TEXT, shift TEXT, hours_per_week TEXT, start_when TEXT, transport TEXT,
      status TEXT DEFAULT 'pending',
      created_at INTEGER DEFAULT (unixepoch())
    )`);
  } catch {}

  const id  = uuid();
  const now = Math.floor(Date.now() / 1000);

  try {
    db.prepare(`
      INSERT INTO canvasser_applicants
        (id, first_name, last_name, phone, email, city, age_range,
         days, shift, hours_per_week, start_when, transport, created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(id, first_name, last_name, phone, email || null, city || null,
           age_range || null, days || null, shift || null,
           hours_per_week || null, start_when || null, transport || null, now);
  } catch(e) {
    if (e.message.includes('UNIQUE')) {
      return res.status(409).json({ error: 'An application with this email already exists.' });
    }
    throw e;
  }

  // Notify dashboard
  broadcast({ type: 'new_applicant', id, name: `${first_name} ${last_name}`, city, shift });

  // Confirmation email to applicant
  sendEmail({
    to: email,
    subject: `Application Received — FrontPorch Marketing`,
    html: emailTemplate({
      preheader: `We got your Porch Pro application and will be in touch within one business day.`,
      title: `Thanks ${first_name}, we got your application!`,
      body: `<p>We've received your Porch Pro application for the <strong>${city}</strong> area.</p>
             <p>We'll review it and reach out to <strong>${phone}</strong> within one business day with your PIN to get started in the app.</p>
             <p>In the meantime, if you have any questions just reply to this email.</p>`,
      cta_url: null, cta_text: null,
      footer: 'FrontPorch Marketing · You received this because you submitted a Porch Pro application.',
    }),
  });

  res.json({ success: true, id });
});

// ─── PDF PROOF REPORT ────────────────────────────────────────────────────────
// GET /api/customer/:token/pdf  — returns an HTML page formatted for printing/saving as PDF
// The customer portal triggers window.print() on this page for a clean PDF save.

app.get('/api/customer/:token/pdf', (req, res) => {
  const canvass = db.prepare('SELECT * FROM canvasses WHERE customer_token = ?').get(req.params.token);
  if (!canvass) return res.status(404).send('Campaign not found');

  const homes = db.prepare(`
    SELECT fh.*, c.name as canvasser_name
    FROM flyered_homes fh JOIN canvassers c ON fh.canvasser_id = c.id
    WHERE fh.canvass_id = ? ORDER BY fh.logged_at DESC
  `).all(canvass.id);

  const zones = db.prepare(`
    SELECT z.*, (SELECT COUNT(*) FROM flyered_homes fh WHERE fh.zone_id = z.id) as homes_flyered
    FROM zones z WHERE z.canvass_id = ?
  `).all(canvass.id);

  const generated = new Date().toLocaleDateString('en-US', { year:'numeric', month:'long', day:'numeric' });

  const photoRows = homes.map((h, i) => {
    const time = new Date(h.logged_at*1000).toLocaleString('en-US', { dateStyle:'medium', timeStyle:'short' });
    const photoCell = h.photo_url
      ? `<img src="${SERVER_URL}${h.photo_url}" style="width:80px;height:60px;object-fit:cover;border-radius:6px;" />`
      : '<div style="width:80px;height:60px;background:#f3f4f6;border-radius:6px;display:flex;align-items:center;justify-content:center;font-size:20px;">📬</div>';
    return `<tr style="border-bottom:1px solid #f3f4f6;">
      <td style="padding:8px 12px;font-size:13px;">${i+1}</td>
      <td style="padding:8px 12px;">${photoCell}</td>
      <td style="padding:8px 12px;font-size:13px;">${h.address||`${h.lat.toFixed(4)}, ${h.lng.toFixed(4)}`}</td>
      <td style="padding:8px 12px;font-size:13px;">${h.canvasser_name||'—'}</td>
      <td style="padding:8px 12px;font-size:13px;">${time}</td>
      <td style="padding:8px 12px;font-size:13px;color:#15803d;font-weight:700;">✓ Verified</td>
    </tr>`;
  }).join('');

  const zoneRows = zones.map(z => `<tr style="border-bottom:1px solid #f3f4f6;">
    <td style="padding:8px 12px;font-size:13px;">${z.name}</td>
    <td style="padding:8px 12px;font-size:13px;font-weight:700;">${z.homes_flyered||0}</td>
    <td style="padding:8px 12px;font-size:13px;">${z.target_homes||'—'}</td>
    <td style="padding:8px 12px;font-size:13px;">${z.target_homes ? Math.round((z.homes_flyered||0)/z.target_homes*100)+'%' : '—'}</td>
    <td style="padding:8px 12px;font-size:13px;"><span style="color:${z.status==='complete'?'#15803d':'#f59e0b'};font-weight:700;">${z.status==='complete'?'✅ Complete':'🔄 Active'}</span></td>
  </tr>`).join('');

  const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>Proof Report — ${canvass.title}</title>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family: 'Helvetica Neue', Arial, sans-serif; color:#111827; background:#fff; padding:40px; }
  @media print { body { padding:20px; } .no-print { display:none; } }
  h1 { font-size:24px; font-weight:900; color:#2A2215; }
  h2 { font-size:16px; font-weight:800; margin:28px 0 12px; color:#374151; border-bottom:2px solid #e5e7eb; padding-bottom:6px; }
  .header { display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:28px; border-bottom:3px solid #C07830; padding-bottom:20px; }
  .brand { font-size:20px; font-weight:900; color:#2A2215; }
  .brand span { color:#C07830; font-style:italic; }
  .stats { display:grid; grid-template-columns:repeat(4,1fr); gap:16px; margin-bottom:28px; }
  .stat { background:#f9fafb; border:1px solid #e5e7eb; border-radius:10px; padding:14px 16px; }
  .stat-label { font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:.5px; color:#6b7280; margin-bottom:4px; }
  .stat-value { font-size:24px; font-weight:900; }
  table { width:100%; border-collapse:collapse; }
  th { padding:10px 12px; text-align:left; font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:.4px; color:#6b7280; background:#f9fafb; border-bottom:2px solid #e5e7eb; }
  .print-btn { background:#C07830; color:#fff; border:none; border-radius:10px; padding:12px 24px; font-size:14px; font-weight:700; cursor:pointer; margin-bottom:24px; }
</style></head><body>
<button class="print-btn no-print" onclick="window.print()">🖨 Save as PDF</button>
<div class="header">
  <div>
    <div class="brand">Front<span>Porch</span> Marketing</div>
    <div style="font-size:13px;color:#6b7280;margin-top:4px;">Photo Proof Report</div>
  </div>
  <div style="text-align:right;">
    <div style="font-size:18px;font-weight:900;">${canvass.title}</div>
    <div style="font-size:13px;color:#6b7280;">${canvass.customer_name||''} · Generated ${generated}</div>
    <div style="font-size:13px;color:#6b7280;">${canvass.location||''}</div>
  </div>
</div>
<div class="stats">
  <div class="stat"><div class="stat-label">Total Homes Flyered</div><div class="stat-value">${homes.length.toLocaleString()}</div></div>
  <div class="stat"><div class="stat-label">Zones</div><div class="stat-value">${zones.length}</div></div>
  <div class="stat"><div class="stat-label">Photo Proof Rate</div><div class="stat-value">100%</div></div>
  <div class="stat"><div class="stat-label">Campaign Status</div><div class="stat-value" style="font-size:16px;margin-top:4px;">${canvass.status}</div></div>
</div>
<h2>Zone Breakdown</h2>
<table style="margin-bottom:28px;"><thead><tr><th>Zone</th><th>Homes Flyered</th><th>Target</th><th>Progress</th><th>Status</th></tr></thead><tbody>${zoneRows}</tbody></table>
<h2>All Flyered Homes (${homes.length} verified)</h2>
<table><thead><tr><th>#</th><th>Photo</th><th>Address</th><th>Porch Pro</th><th>Date & Time</th><th>Verification</th></tr></thead><tbody>${photoRows}</tbody></table>
<div style="margin-top:40px;padding-top:20px;border-top:1px solid #e5e7eb;font-size:12px;color:#9ca3af;text-align:center;">
  FrontPorch Marketing · Photo Proof Report · Generated ${generated} · Every home verified with GPS-tagged photo
</div>
</body></html>`;

  res.setHeader('Content-Type', 'text/html');
  res.send(html);
});

// ─── CUSTOMER PORTAL API (token-based, no login) ─────────────────────────────

app.get('/api/customer/:token', (req, res) => {
  const canvass = db.prepare('SELECT * FROM canvasses WHERE customer_token = ?').get(req.params.token);
  if (!canvass) return res.status(404).json({ error: 'Not found' });
  const zones = db.prepare(`
    SELECT z.*,
      (SELECT COUNT(*) FROM flyered_homes fh WHERE fh.zone_id = z.id) as homes_flyered,
      (SELECT MAX(fh.logged_at) FROM flyered_homes fh WHERE fh.zone_id = z.id) as last_activity
    FROM zones z WHERE z.canvass_id = ?
  `).all(canvass.id);
  const totalHomes = zones.reduce((s, z) => s + (z.homes_flyered || 0), 0);
  const activeCanvassers = db.prepare(`
    SELECT COUNT(DISTINCT canvasser_id) as c FROM flyered_homes
    WHERE canvass_id = ? AND logged_at >= ?
  `).get(canvass.id, Math.floor(Date.now()/1000) - 3600).c;
  res.json({ canvass, zones, totalHomes, activeCanvassers });
});

app.get('/api/customer/:token/homes', (req, res) => {
  const canvass = db.prepare('SELECT * FROM canvasses WHERE customer_token = ?').get(req.params.token);
  if (!canvass) return res.status(404).json({ error: 'Not found' });
  const homes = db.prepare(`
    SELECT fh.*, c.name as canvasser_name
    FROM flyered_homes fh JOIN canvassers c ON fh.canvasser_id = c.id
    WHERE fh.canvass_id = ? ORDER BY fh.logged_at DESC
  `).all(canvass.id);
  res.json(homes);
});

// Business: view flyered homes for a zone
app.get('/api/zones/:id/homes', requireBusiness, (req, res) => {
  const bizId = req.session.business_id;
  const homes = db.prepare(`
    SELECT fh.*, c.name as canvasser_name
    FROM flyered_homes fh JOIN canvassers c ON fh.canvasser_id = c.id
    WHERE fh.zone_id = ? AND fh.business_id = ? ORDER BY fh.logged_at DESC
  `).all(req.params.id, bizId);
  res.json(homes);
});

// Get my schedule (next 14 days)
app.get('/api/canvasser/schedule', requireCanvasser, (req, res) => {
  const cv = db.prepare('SELECT * FROM canvassers WHERE id = ?').get(req.session.user_id);
  const today = new Date().toISOString().slice(0, 10);
  const twoWeeks = new Date(); twoWeeks.setDate(twoWeeks.getDate() + 14);
  const future = twoWeeks.toISOString().slice(0, 10);
  const shifts = db.prepare(`
    SELECT * FROM shifts WHERE canvasser_id = ? AND shift_date >= ? AND shift_date <= ? ORDER BY shift_date
  `).all(cv.id, today, future);
  res.json(shifts);
});

// Get my messages
app.get('/api/canvasser/messages', requireCanvasser, (req, res) => {
  const cv = db.prepare('SELECT * FROM canvassers WHERE id = ?').get(req.session.user_id);
  const msgs = db.prepare(`SELECT * FROM messages WHERE canvasser_id = ? AND business_id = ? ORDER BY sent_at ASC`).all(cv.id, cv.business_id);
  db.prepare('UPDATE messages SET read = 1 WHERE canvasser_id = ? AND from_type = ?').run(cv.id, 'business');
  res.json(msgs);
});

// Send message (canvasser -> business)
app.post('/api/canvasser/messages', requireCanvasser, (req, res) => {
  const cv = db.prepare('SELECT * FROM canvassers WHERE id = ?').get(req.session.user_id);
  const { text } = req.body;
  const id = uuid();
  db.prepare(`INSERT INTO messages (id, business_id, canvasser_id, from_type, text) VALUES (?, ?, ?, 'canvasser', ?)`).run(id, cv.business_id, cv.id, text);
  broadcast({ type: 'new_message', canvasserId: cv.id, text, from: 'canvasser' });
  res.json({ id });
});

// ─── CANVASSER ↔ CUSTOMER MESSAGING ──────────────────────────────────────────

// Get all customer threads for canvasser's currently claimed zones
app.get('/api/canvasser/customer-messages', requireCanvasser, (req, res) => {
  const cv = db.prepare('SELECT * FROM canvassers WHERE id = ?').get(req.session.user_id);
  // Only canvasses where this canvasser holds at least one zone
  const threads = db.prepare(`
    SELECT DISTINCT ca.id as canvass_id, ca.title, ca.customer_name, ca.customer_email,
      (SELECT text FROM customer_messages WHERE canvass_id = ca.id AND canvasser_id = ? ORDER BY sent_at DESC LIMIT 1) as last_message,
      (SELECT sent_at FROM customer_messages WHERE canvass_id = ca.id AND canvasser_id = ? ORDER BY sent_at DESC LIMIT 1) as last_sent,
      (SELECT COUNT(*) FROM customer_messages WHERE canvass_id = ca.id AND canvasser_id = ? AND from_type = 'customer' AND read = 0) as unread
    FROM zones z
    JOIN canvasses ca ON z.canvass_id = ca.id
    WHERE z.claimed_by = ? AND ca.business_id = ?
  `).all(cv.id, cv.id, cv.id, cv.id, cv.business_id);
  res.json(threads);
});

// Get messages in a specific canvasser↔customer thread
app.get('/api/canvasser/customer-messages/:canvassId', requireCanvasser, (req, res) => {
  const cv = db.prepare('SELECT * FROM canvassers WHERE id = ?').get(req.session.user_id);
  // Verify canvasser still holds a zone in this canvass
  const hasZone = db.prepare(`SELECT 1 FROM zones WHERE claimed_by = ? AND canvass_id = ?`).get(cv.id, req.params.canvassId);
  if (!hasZone) return res.status(403).json({ error: 'You no longer have an active zone in this canvass.' });
  const msgs = db.prepare(`SELECT * FROM customer_messages WHERE canvass_id = ? AND canvasser_id = ? ORDER BY sent_at ASC`).all(req.params.canvassId, cv.id);
  db.prepare(`UPDATE customer_messages SET read = 1 WHERE canvass_id = ? AND canvasser_id = ? AND from_type = 'customer'`).run(req.params.canvassId, cv.id);
  res.json(msgs);
});

// Send message: canvasser -> customer (zone must be claimed)
app.post('/api/canvasser/customer-messages/:canvassId', requireCanvasser, (req, res) => {
  const cv = db.prepare('SELECT * FROM canvassers WHERE id = ?').get(req.session.user_id);
  const hasZone = db.prepare(`SELECT 1 FROM zones WHERE claimed_by = ? AND canvass_id = ?`).get(cv.id, req.params.canvassId);
  if (!hasZone) return res.status(403).json({ error: 'You no longer have an active zone in this canvass.' });
  const { text } = req.body;
  const id = uuid();
  db.prepare(`INSERT INTO customer_messages (id, canvass_id, canvasser_id, from_type, text) VALUES (?, ?, ?, 'canvasser', ?)`).run(id, req.params.canvassId, cv.id, text);
  broadcast({ type: 'customer_message', canvassId: req.params.canvassId, canvasserId: cv.id, text, from: 'canvasser' });
  res.json({ id });
});

// ─── CUSTOMER PORTAL MESSAGING ────────────────────────────────────────────────

function requirePortal(req, res, next) {
  const token = req.query.token || req.headers['x-portal-token'];
  if (!token) return res.status(401).json({ error: 'No token' });
  const canvass = db.prepare(`SELECT * FROM canvasses WHERE customer_token = ?`).get(token);
  if (!canvass) return res.status(401).json({ error: 'Invalid token' });
  req.canvass = canvass;
  next();
}

// Get all message threads for this customer (one per canvasser assigned to their zones)
app.get('/api/portal/messages', requirePortal, (req, res) => {
  const canvassId = req.canvass.id;
  const threads = db.prepare(`
    SELECT DISTINCT cv.id as canvasser_id, cv.name as canvasser_name,
      (SELECT text FROM customer_messages WHERE canvass_id = ? AND canvasser_id = cv.id ORDER BY sent_at DESC LIMIT 1) as last_message,
      (SELECT sent_at FROM customer_messages WHERE canvass_id = ? AND canvasser_id = cv.id ORDER BY sent_at DESC LIMIT 1) as last_sent,
      (SELECT COUNT(*) FROM customer_messages WHERE canvass_id = ? AND canvasser_id = cv.id AND from_type = 'canvasser' AND read = 0) as unread,
      (SELECT COUNT(*) FROM zones WHERE claimed_by = cv.id AND canvass_id = ?) as zone_active
    FROM customer_messages cm
    JOIN canvassers cv ON cm.canvasser_id = cv.id
    WHERE cm.canvass_id = ?
  `).all(canvassId, canvassId, canvassId, canvassId, canvassId);
  res.json(threads);
});

// Get messages between this customer and a specific canvasser
app.get('/api/portal/messages/:canvasserId', requirePortal, (req, res) => {
  const canvassId = req.canvass.id;
  const msgs = db.prepare(`SELECT * FROM customer_messages WHERE canvass_id = ? AND canvasser_id = ? ORDER BY sent_at ASC`).all(canvassId, req.params.canvasserId);
  db.prepare(`UPDATE customer_messages SET read = 1 WHERE canvass_id = ? AND canvasser_id = ? AND from_type = 'canvasser'`).run(canvassId, req.params.canvasserId);
  res.json(msgs);
});

// Send message: customer -> canvasser (only if canvasser still holds a zone)
app.post('/api/portal/messages/:canvasserId', requirePortal, (req, res) => {
  const canvassId = req.canvass.id;
  const hasZone = db.prepare(`SELECT 1 FROM zones WHERE claimed_by = ? AND canvass_id = ?`).get(req.params.canvasserId, canvassId);
  if (!hasZone) return res.status(403).json({ error: 'This canvasser is no longer active in your area.' });
  const { text } = req.body;
  const id = uuid();
  db.prepare(`INSERT INTO customer_messages (id, canvass_id, canvasser_id, from_type, text) VALUES (?, ?, ?, 'customer', ?)`).run(id, canvassId, req.params.canvasserId, text);
  broadcast({ type: 'customer_message', canvassId, canvasserId: req.params.canvasserId, text, from: 'customer' });
  res.json({ id });
});

// Customer confirms zone complete (overrides the 90% check)
app.post('/api/portal/zones/:zoneId/confirm-complete', requirePortal, (req, res) => {
  const canvassId = req.canvass.id;
  const zone = db.prepare(`
    SELECT z.*, (SELECT COUNT(*) FROM flyered_homes WHERE zone_id = z.id) as homes_flyered
    FROM zones z WHERE z.id = ? AND z.canvass_id = ?
  `).get(req.params.zoneId, canvassId);

  if (!zone) return res.status(404).json({ error: 'Zone not found' });
  if (zone.completed_at) return res.status(409).json({ error: 'Zone already marked complete' });

  const now = Math.floor(Date.now()/1000);
  db.prepare(`UPDATE zones SET status='complete', completed_at=?, completed_by=?, customer_confirmed=1, customer_confirmed_at=?, claimed_by=NULL, claimed_at=NULL WHERE id=?`)
    .run(now, 'customer', now, zone.id);

  broadcast({
    type: 'zone_complete',
    zoneId: zone.id,
    canvasserId: zone.claimed_by,
    customerConfirmed: true,
    flyered: zone.homes_flyered
  });
  res.json({ success: true, flyered: zone.homes_flyered });
});

// Get zones for customer portal (with completion status)
app.get('/api/portal/zones', requirePortal, (req, res) => {
  const zones = db.prepare(`
    SELECT z.id, z.name, z.color, z.status, z.target_homes, z.completed_at, z.customer_confirmed,
      (SELECT COUNT(*) FROM flyered_homes WHERE zone_id = z.id) as homes_flyered,
      (SELECT name FROM canvassers WHERE id = z.claimed_by) as canvasser_name
    FROM zones z WHERE z.canvass_id = ? ORDER BY z.name
  `).all(req.canvass.id);
  res.json(zones);
});

// ─── WEBSOCKET ────────────────────────────────────────────────────────────────

const clients = new Set();

wss.on('connection', (ws) => {
  clients.add(ws);
  ws.on('close', () => clients.delete(ws));
  ws.on('error', () => clients.delete(ws));
});

function broadcast(data) {
  const msg = JSON.stringify(data);
  clients.forEach(client => {
    if (client.readyState === 1) client.send(msg);
  });
}

// ─── START ────────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n🚀 FrontPorch server running at http://localhost:${PORT}`);
  console.log(`   Dashboard: http://localhost:${PORT}/dashboard.html`);
  console.log(`   Canvasser App: http://localhost:${PORT}/canvasser-app.html`);
  console.log(`\n   Business login: christina@heliogrowth.com / demo123`);
  console.log(`   Canvasser PINs: Marcus=1111, Priya=2222, DeShawn=3333\n`);
});
