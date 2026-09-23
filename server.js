// Resell Tracker: kleiner Server ohne externe Abhängigkeiten.
// Braucht Node.js >= 22.5 (eingebautes node:sqlite).

import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { allocateHaul, CATEGORIES, CONDITIONS, STATUSES, PLATFORMS, fmtArticleNo, costOf, profitOf } from './public/shared.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(ROOT, 'public');
const DATA = process.env.DATA_DIR || path.join(ROOT, 'data');
const UPLOADS = path.join(DATA, 'uploads');
const PORT = Number(process.env.PORT) || 3000;
const SECURE_COOKIE = process.env.COOKIE_SECURE === '1';
const SESSION_DAYS = 30;
const COOKIE = 'rt_session';

fs.mkdirSync(UPLOADS, { recursive: true });

// ---------------------------------------------------------------- Datenbank

const db = new DatabaseSync(path.join(DATA, 'resell.db'));
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    name TEXT NOT NULL DEFAULT '',
    password_hash TEXT NOT NULL,
    next_article_no INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS hauls (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT '',
    date TEXT,
    total_price INTEGER,
    shipping_cost INTEGER NOT NULL DEFAULT 0,
    notes TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS articles (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    article_no INTEGER NOT NULL,
    haul_id INTEGER REFERENCES hauls(id) ON DELETE SET NULL,
    title TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'Sonstiges',
    brand TEXT NOT NULL DEFAULT '',
    size TEXT NOT NULL DEFAULT '',
    color TEXT NOT NULL DEFAULT '',
    condition TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    purchase_input INTEGER,
    purchase_price INTEGER NOT NULL DEFAULT 0,
    shipping_in INTEGER NOT NULL DEFAULT 0,
    purchase_date TEXT,
    status TEXT NOT NULL DEFAULT 'lager',
    listed_price INTEGER,
    sale_price INTEGER,
    sale_date TEXT,
    sale_platform TEXT NOT NULL DEFAULT '',
    sale_fees INTEGER NOT NULL DEFAULT 0,
    shipping_out INTEGER NOT NULL DEFAULT 0,
    image TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (user_id, article_no)
  );

  CREATE INDEX IF NOT EXISTS idx_articles_user ON articles(user_id);
  CREATE INDEX IF NOT EXISTS idx_articles_haul ON articles(haul_id);
  CREATE INDEX IF NOT EXISTS idx_hauls_user ON hauls(user_id);
`);

function tx(fn) {
  db.exec('BEGIN');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

// ---------------------------------------------------------------- Helfer

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const bad = (msg) => new HttpError(400, msg);

function send(res, status, body, headers = {}) {
  const isBuf = Buffer.isBuffer(body);
  const payload = isBuf || typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': isBuf || typeof body === 'string' ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(payload);
}

async function readJson(req, limit) {
  const type = req.headers['content-type'] || '';
  if (!type.startsWith('application/json')) throw new HttpError(415, 'JSON erwartet');
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > limit) throw new HttpError(413, 'Anfrage zu groß (Bilder zu groß?)');
    chunks.push(c);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    throw bad('Ungültiges JSON');
  }
}

function parseCookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i <= 0) continue;
    try { out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim()); } catch { /* kaputtes Cookie ignorieren */ }
  }
  return out;
}

const str = (v, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const oneOf = (v, list, fallback) => (list.includes(v) ? v : fallback);

function cents(v, { nullable = true } = {}) {
  if (v === null || v === undefined || v === '') {
    if (nullable) return null;
    return 0;
  }
  if (!Number.isInteger(v) || v < 0 || v > 100_000_000) throw bad('Ungültiger Betrag');
  return v;
}

function dateOrNull(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw bad('Ungültiges Datum');
  return v;
}

// ---------------------------------------------------------------- Passwörter & Sitzungen

function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(pw, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

function verifyPassword(pw, stored) {
  const [alg, salt, hash] = stored.split('$');
  if (alg !== 'scrypt') return false;
  const expected = Buffer.from(hash, 'base64');
  const actual = crypto.scryptSync(pw, Buffer.from(salt, 'base64'), expected.length, { N: 16384, r: 8, p: 1 });
  return crypto.timingSafeEqual(expected, actual);
}

// Wird beim Login mit unbekannter E-Mail benutzt, damit die Antwortzeit
// nicht verrät, ob ein Konto existiert.
const DUMMY_HASH = hashPassword(crypto.randomBytes(16).toString('hex'));

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

function createSession(res, userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  const expires = Date.now() + SESSION_DAYS * 86400_000;
  db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)').run(sha256(token), userId, expires);
  res.setHeader('Set-Cookie', cookieHeader(token, SESSION_DAYS * 86400));
}

function cookieHeader(value, maxAge) {
  return `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${SECURE_COOKIE ? '; Secure' : ''}`;
}

function currentUser(req) {
  const token = parseCookies(req)[COOKIE];
  if (!token) return null;
  const row = db.prepare(`
    SELECT u.id, u.email, u.name, s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ?`).get(sha256(token));
  if (!row) return null;
  if (row.expires_at < Date.now()) {
    db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
    return null;
  }
  return { id: row.id, email: row.email, name: row.name };
}

// Einfache Bremse gegen Passwort-Raten: 10 Fehlversuche pro 15 Minuten.
const attempts = new Map();
function checkRate(key) {
  const now = Date.now();
  const a = attempts.get(key);
  if (a && a.until > now && a.count >= 10) throw new HttpError(429, 'Zu viele Versuche. Bitte in 15 Minuten nochmal.');
}
function failRate(key) {
  const now = Date.now();
  const a = attempts.get(key);
  if (!a || a.until < now) attempts.set(key, { count: 1, until: now + 15 * 60_000 });
  else a.count++;
}

// ---------------------------------------------------------------- Bilder

const IMAGE_TYPES = { jpeg: 'jpg', png: 'png', webp: 'webp' };
const MIME = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };

function saveImage(userId, dataUrl) {
  const m = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl || '');
  if (!m) throw bad('Bild muss JPG, PNG oder WebP sein');
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > 6 * 1024 * 1024) throw bad('Bild ist zu groß (max. 6 MB)');
  const magicOk =
    (m[1] === 'jpeg' && buf[0] === 0xff && buf[1] === 0xd8) ||
    (m[1] === 'png' && buf.subarray(0, 4).toString('hex') === '89504e47') ||
    (m[1] === 'webp' && buf.subarray(8, 12).toString('ascii') === 'WEBP');
  if (!magicOk) throw bad('Datei ist kein gültiges Bild');
  const name = `${userId}_${crypto.randomBytes(12).toString('hex')}.${IMAGE_TYPES[m[1]]}`;
  fs.writeFileSync(path.join(UPLOADS, name), buf);
  return name;
}

function removeImage(name) {
  if (name && /^\d+_[a-f0-9]{24}\.(jpg|png|webp)$/.test(name)) {
    fs.rm(path.join(UPLOADS, name), { force: true }, () => {});
  }
}

// ---------------------------------------------------------------- Artikel & Hauls

// Übernimmt die Stammdaten eines Artikels aus dem Request. Preise für Hauls
// werden danach von reallocate() gesetzt.
function articleFields(b) {
  const title = str(b.title, 160);
  if (!title) throw bad('Titel fehlt');
  const status = oneOf(b.status, Object.keys(STATUSES), 'lager');
  const f = {
    title,
    category: oneOf(b.category, CATEGORIES, 'Sonstiges'),
    brand: str(b.brand, 80),
    size: str(b.size, 40),
    color: str(b.color, 40),
    condition: oneOf(b.condition, CONDITIONS, ''),
    notes: str(b.notes, 4000),
    purchase_input: cents(b.purchase_input),
    shipping_in: cents(b.shipping_in, { nullable: false }),
    purchase_date: dateOrNull(b.purchase_date),
    status,
    listed_price: cents(b.listed_price),
    sale_price: cents(b.sale_price),
    sale_date: dateOrNull(b.sale_date),
    sale_platform: oneOf(b.sale_platform, PLATFORMS, ''),
    sale_fees: cents(b.sale_fees, { nullable: false }),
    shipping_out: cents(b.shipping_out, { nullable: false }),
  };
  if (status === 'verkauft' && f.sale_price === null) throw bad('Verkaufspreis fehlt');
  if (status !== 'verkauft') {
    Object.assign(f, { sale_price: null, sale_date: null, sale_platform: '', sale_fees: 0, shipping_out: 0 });
  }
  return f;
}

function nextArticleNo(userId) {
  const { next_article_no: no } = db.prepare('SELECT next_article_no FROM users WHERE id = ?').get(userId);
  db.prepare('UPDATE users SET next_article_no = next_article_no + 1 WHERE id = ?').run(userId);
  return no;
}

function insertArticle(userId, f, haulId, image) {
  const no = nextArticleNo(userId);
  const r = db.prepare(`
    INSERT INTO articles (user_id, article_no, haul_id, title, category, brand, size, color, condition, notes,
      purchase_input, purchase_price, shipping_in, purchase_date, status, listed_price, sale_price, sale_date,
      sale_platform, sale_fees, shipping_out, image)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    userId, no, haulId, f.title, f.category, f.brand, f.size, f.color, f.condition, f.notes,
    f.purchase_input, f.purchase_input ?? 0, f.shipping_in, f.purchase_date, f.status, f.listed_price,
    f.sale_price, f.sale_date, f.sale_platform, f.sale_fees, f.shipping_out, image);
  return Number(r.lastInsertRowid);
}

// Verteilt Gesamtpreis und Versand eines Hauls neu auf seine Artikel.
function reallocate(haulId) {
  const haul = db.prepare('SELECT * FROM hauls WHERE id = ?').get(haulId);
  if (!haul) return;
  const items = db.prepare('SELECT id, purchase_input FROM articles WHERE haul_id = ? ORDER BY article_no').all(haulId);
  const { items: alloc } = allocateHaul(haul, items.map((it) => ({ input: it.purchase_input })));
  const upd = db.prepare('UPDATE articles SET purchase_price = ?, shipping_in = ? WHERE id = ?');
  items.forEach((it, i) => upd.run(alloc[i].purchase_price, alloc[i].shipping_in, it.id));
}

function haulFields(b) {
  const name = str(b.name, 120);
  if (!name) throw bad('Name des Hauls fehlt');
  return {
    name,
    source: str(b.source, 120),
    date: dateOrNull(b.date),
    total_price: cents(b.total_price),
    shipping_cost: cents(b.shipping_cost, { nullable: false }),
    notes: str(b.notes, 4000),
  };
}

function getArticle(userId, id) {
  const a = db.prepare('SELECT * FROM articles WHERE id = ? AND user_id = ?').get(id, userId);
  if (!a) throw new HttpError(404, 'Artikel nicht gefunden');
  return a;
}

function getHaul(userId, id) {
  const h = db.prepare('SELECT * FROM hauls WHERE id = ? AND user_id = ?').get(id, userId);
  if (!h) throw new HttpError(404, 'Haul nicht gefunden');
  return h;
}

function csvCell(v) {
  const s = v === null || v === undefined ? '' : String(v);
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s; // Formel-Injection in Excel verhindern
  return /[;"\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}
const csvMoney = (c) => (c === null || c === undefined ? '' : (c / 100).toFixed(2).replace('.', ','));

// ---------------------------------------------------------------- API

const routes = [];
const route = (method, pattern, handler, opts = {}) =>
  routes.push({ method, re: new RegExp(`^${pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)')}$`), handler, ...opts });

route('POST', '/api/register', async (req, res) => {
  const b = await readJson(req, 10_000);
  const email = str(b.email, 200).toLowerCase();
  const name = str(b.name, 80);
  const password = typeof b.password === 'string' ? b.password : '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw bad('Bitte eine gültige E-Mail-Adresse angeben');
  if (password.length < 8) throw bad('Passwort muss mindestens 8 Zeichen haben');
  if (password.length > 200) throw bad('Passwort ist zu lang');
  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) throw new HttpError(409, 'Für diese E-Mail gibt es schon ein Konto');
  const r = db.prepare('INSERT INTO users (email, name, password_hash) VALUES (?, ?, ?)').run(email, name, hashPassword(password));
  createSession(res, Number(r.lastInsertRowid));
  send(res, 201, { user: { id: Number(r.lastInsertRowid), email, name } });
}, { public: true });

route('POST', '/api/login', async (req, res) => {
  const b = await readJson(req, 10_000);
  const email = str(b.email, 200).toLowerCase();
  const password = typeof b.password === 'string' ? b.password.slice(0, 200) : '';
  const key = `${req.socket.remoteAddress}|${email}`;
  checkRate(key);
  const u = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  const ok = verifyPassword(password, u ? u.password_hash : DUMMY_HASH) && !!u;
  if (!ok) {
    failRate(key);
    throw new HttpError(401, 'E-Mail oder Passwort falsch');
  }
  attempts.delete(key);
  createSession(res, u.id);
  send(res, 200, { user: { id: u.id, email: u.email, name: u.name } });
}, { public: true });

route('POST', '/api/logout', async (req, res) => {
  const token = parseCookies(req)[COOKIE];
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
  send(res, 200, { ok: true }, { 'Set-Cookie': cookieHeader('', 0) });
}, { public: true });

route('GET', '/api/me', async (req, res, { user }) => {
  send(res, 200, { user });
});

route('POST', '/api/password', async (req, res, { user }) => {
  const b = await readJson(req, 10_000);
  const u = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(user.id);
  if (!verifyPassword(String(b.current || '').slice(0, 200), u.password_hash)) throw bad('Aktuelles Passwort ist falsch');
  const next = typeof b.next === 'string' ? b.next : '';
  if (next.length < 8 || next.length > 200) throw bad('Neues Passwort muss mindestens 8 Zeichen haben');
  tx(() => {
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(next), user.id);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id);
    createSession(res, user.id);
  });
  send(res, 200, { ok: true });
});

route('GET', '/api/data', async (req, res, { user }) => {
  const articles = db.prepare('SELECT * FROM articles WHERE user_id = ? ORDER BY article_no DESC').all(user.id);
  const hauls = db.prepare('SELECT * FROM hauls WHERE user_id = ? ORDER BY COALESCE(date, created_at) DESC, id DESC').all(user.id);
  send(res, 200, { articles, hauls });
});

route('POST', '/api/articles', async (req, res, { user }) => {
  const b = await readJson(req, 12_000_000);
  const f = articleFields(b);
  let haulId = null;
  if (b.haul_id) haulId = getHaul(user.id, Number(b.haul_id)).id;
  const image = b.image ? saveImage(user.id, b.image) : null;
  const id = tx(() => {
    const id = insertArticle(user.id, f, haulId, image);
    if (haulId) reallocate(haulId);
    return id;
  });
  send(res, 201, { article: getArticle(user.id, id) });
});

route('PUT', '/api/articles/:id', async (req, res, { user, params }) => {
  const b = await readJson(req, 12_000_000);
  const a = getArticle(user.id, Number(params.id));
  const f = articleFields(b);
  let image = a.image;
  if (b.image === null) image = null;
  else if (typeof b.image === 'string' && b.image.startsWith('data:')) image = saveImage(user.id, b.image);
  tx(() => {
    db.prepare(`
      UPDATE articles SET title = ?, category = ?, brand = ?, size = ?, color = ?, condition = ?, notes = ?,
        purchase_input = ?, purchase_price = ?, shipping_in = ?, purchase_date = ?, status = ?, listed_price = ?,
        sale_price = ?, sale_date = ?, sale_platform = ?, sale_fees = ?, shipping_out = ?, image = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?`).run(
      f.title, f.category, f.brand, f.size, f.color, f.condition, f.notes,
      f.purchase_input, f.purchase_input ?? 0, a.haul_id ? a.shipping_in : f.shipping_in, f.purchase_date, f.status,
      f.listed_price, f.sale_price, f.sale_date, f.sale_platform, f.sale_fees, f.shipping_out, image, a.id);
    if (a.haul_id) reallocate(a.haul_id);
  });
  if (image !== a.image) removeImage(a.image);
  send(res, 200, { article: getArticle(user.id, a.id) });
});

route('DELETE', '/api/articles/:id', async (req, res, { user, params }) => {
  const a = getArticle(user.id, Number(params.id));
  tx(() => {
    db.prepare('DELETE FROM articles WHERE id = ?').run(a.id);
    if (a.haul_id) reallocate(a.haul_id);
  });
  removeImage(a.image);
  send(res, 200, { ok: true });
});

route('POST', '/api/hauls', async (req, res, { user }) => {
  const b = await readJson(req, 80_000_000);
  const h = haulFields(b);
  const rawItems = Array.isArray(b.items) ? b.items : [];
  if (rawItems.length === 0) throw bad('Ein Haul braucht mindestens einen Artikel');
  if (rawItems.length > 200) throw bad('Maximal 200 Artikel pro Haul');
  const items = rawItems.map((it) => ({ f: articleFields({ ...it, purchase_date: it.purchase_date || h.date }), img: it.image }));
  const images = [];
  try {
    for (const it of items) images.push(it.img ? saveImage(user.id, it.img) : null);
    const haulId = tx(() => {
      const r = db.prepare('INSERT INTO hauls (user_id, name, source, date, total_price, shipping_cost, notes) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(user.id, h.name, h.source, h.date, h.total_price, h.shipping_cost, h.notes);
      const haulId = Number(r.lastInsertRowid);
      items.forEach((it, i) => insertArticle(user.id, { ...it.f, shipping_in: 0 }, haulId, images[i]));
      reallocate(haulId);
      return haulId;
    });
    send(res, 201, { haul: getHaul(user.id, haulId) });
  } catch (e) {
    images.forEach(removeImage);
    throw e;
  }
});

route('PUT', '/api/hauls/:id', async (req, res, { user, params }) => {
  const b = await readJson(req, 20_000);
  const haul = getHaul(user.id, Number(params.id));
  const h = haulFields(b);
  tx(() => {
    db.prepare('UPDATE hauls SET name = ?, source = ?, date = ?, total_price = ?, shipping_cost = ?, notes = ? WHERE id = ?')
      .run(h.name, h.source, h.date, h.total_price, h.shipping_cost, h.notes, haul.id);
    reallocate(haul.id);
  });
  send(res, 200, { haul: getHaul(user.id, haul.id) });
});

// ?mode=dissolve behält die Artikel (mit ihren aktuellen Kosten), sonst werden sie mitgelöscht.
route('DELETE', '/api/hauls/:id', async (req, res, { user, params, url }) => {
  const haul = getHaul(user.id, Number(params.id));
  const keep = url.searchParams.get('mode') === 'dissolve';
  const images = db.prepare('SELECT image FROM articles WHERE haul_id = ?').all(haul.id).map((r) => r.image);
  tx(() => {
    if (keep) {
      db.prepare('UPDATE articles SET purchase_input = purchase_price, haul_id = NULL WHERE haul_id = ?').run(haul.id);
    } else {
      db.prepare('DELETE FROM articles WHERE haul_id = ?').run(haul.id);
    }
    db.prepare('DELETE FROM hauls WHERE id = ?').run(haul.id);
  });
  if (!keep) images.forEach(removeImage);
  send(res, 200, { ok: true });
});

route('GET', '/api/images/:name', async (req, res, { user, params }) => {
  const name = params.name;
  if (!/^\d+_[a-f0-9]{24}\.(jpg|png|webp)$/.test(name) || !name.startsWith(`${user.id}_`)) throw new HttpError(404, 'Nicht gefunden');
  const file = path.join(UPLOADS, name);
  if (!fs.existsSync(file)) throw new HttpError(404, 'Nicht gefunden');
  res.writeHead(200, { 'Content-Type': MIME[name.split('.').pop()], 'Cache-Control': 'private, max-age=31536000, immutable' });
  fs.createReadStream(file).pipe(res);
});

route('GET', '/api/export.csv', async (req, res, { user }) => {
  const rows = db.prepare(`
    SELECT a.*, h.name AS haul_name FROM articles a LEFT JOIN hauls h ON h.id = a.haul_id
    WHERE a.user_id = ? ORDER BY a.article_no`).all(user.id);
  const head = ['Nr', 'Titel', 'Kategorie', 'Marke', 'Größe', 'Farbe', 'Zustand', 'Haul', 'Einkaufsdatum', 'Einkaufspreis',
    'Versand Einkauf', 'Kosten gesamt', 'Status', 'Listenpreis', 'Verkaufspreis', 'Verkaufsdatum', 'Plattform',
    'Gebühren', 'Versand Verkauf', 'Gewinn', 'Notizen'];
  const lines = rows.map((a) => [
    fmtArticleNo(a.article_no), a.title, a.category, a.brand, a.size, a.color, a.condition, a.haul_name || '',
    a.purchase_date || '', csvMoney(a.purchase_price), csvMoney(a.shipping_in), csvMoney(costOf(a)), STATUSES[a.status],
    csvMoney(a.listed_price), csvMoney(a.sale_price), a.sale_date || '', a.sale_platform, csvMoney(a.status === 'verkauft' ? a.sale_fees : null),
    csvMoney(a.status === 'verkauft' ? a.shipping_out : null), csvMoney(profitOf(a)), a.notes,
  ].map(csvCell).join(';'));
  const csv = '﻿' + [head.join(';'), ...lines].join('\r\n');
  send(res, 200, csv, {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="resell-export-${new Date().toISOString().slice(0, 10)}.csv"`,
  });
});

// ---------------------------------------------------------------- Statische Dateien

const STATIC_TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json',
};

function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel === '/' || !path.extname(rel)) rel = '/index.html';
  const file = path.join(PUBLIC, path.normalize(rel));
  if (!file.startsWith(PUBLIC + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    return send(res, 404, 'Nicht gefunden');
  }
  res.writeHead(200, {
    'Content-Type': STATIC_TYPES[path.extname(file)] || 'application/octet-stream',
    'Cache-Control': 'no-cache',
  });
  fs.createReadStream(file).pipe(res);
}

// ---------------------------------------------------------------- Server

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
};

const server = http.createServer(async (req, res) => {
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);
  const url = new URL(req.url, 'http://localhost');
  try {
    if (!url.pathname.startsWith('/api/')) {
      if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Methode nicht erlaubt');
      return serveStatic(req, res, url.pathname);
    }

    // Schreibende Anfragen nur von der eigenen Seite (Schutz vor CSRF).
    if (req.method !== 'GET') {
      const origin = req.headers.origin;
      if (origin && new URL(origin).host !== req.headers.host) throw new HttpError(403, 'Fremde Herkunft');
    }

    for (const r of routes) {
      if (r.method !== req.method) continue;
      const m = r.re.exec(url.pathname);
      if (!m) continue;
      const user = r.public ? null : currentUser(req);
      if (!r.public && !user) throw new HttpError(401, 'Bitte anmelden');
      return await r.handler(req, res, { user, params: m.groups || {}, url });
    }
    throw new HttpError(404, 'Unbekannte Adresse');
  } catch (e) {
    if (!(e instanceof HttpError)) console.error(e);
    if (res.headersSent) return res.end();
    const status = e instanceof HttpError ? e.status : 500;
    send(res, status, { error: e instanceof HttpError ? e.message : 'Interner Fehler' });
  }
});

// Abgelaufene Sitzungen einmal pro Stunde aufräumen.
setInterval(() => db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now()), 3600_000).unref();

server.listen(PORT, () => console.log(`Resell Tracker läuft auf http://localhost:${PORT}`));
