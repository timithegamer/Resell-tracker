// Datenzugriff über Supabase und der geladene Zustand der App.

import { SUPABASE_URL, SUPABASE_KEY } from './config.js';
import { resizeImage } from './ui.js';

export const configured = Boolean(SUPABASE_URL && SUPABASE_KEY && !SUPABASE_URL.includes('DEIN-PROJEKT'));

export const sb = configured
  ? window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: true, autoRefreshToken: true } })
  : null;

export const state = {
  user: null,
  articles: [],
  hauls: [],
  expenses: [],
};

export const haulById = (id) => state.hauls.find((h) => h.id === id);
export const articleById = (id) => state.articles.find((a) => a.id === id);

function check({ data, error }) {
  if (error) throw new Error(translate(error.message));
  return data;
}

function translate(msg) {
  if (/Invalid login credentials/i.test(msg)) return 'E-Mail oder Passwort falsch';
  if (/violates row-level security/i.test(msg)) return 'Keine Berechtigung';
  if (/articles_check/i.test(msg)) return 'Verkaufte Artikel brauchen einen Verkaufspreis';
  if (/Failed to fetch|NetworkError|Load failed/i.test(msg)) return 'Keine Verbindung. Bist du online?';
  if (/JWT expired/i.test(msg)) return 'Sitzung abgelaufen, bitte neu anmelden';
  return msg;
}

// Supabase liefert bigint als Zahl. Zur Sicherheit alles Geldige als Number.
const MONEY = ['purchase_input', 'purchase_price', 'shipping_in', 'listed_price', 'sale_price', 'sale_fees', 'shipping_out', 'total_price', 'shipping_cost', 'amount'];
function normalize(row) {
  for (const k of MONEY) if (row[k] !== null && row[k] !== undefined) row[k] = Number(row[k]);
  return row;
}

async function fetchAll(table, order) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const page = check(await sb.from(table).select('*').order(order, { ascending: false }).range(from, from + 999));
    rows.push(...page.map(normalize));
    if (page.length < 1000) return rows;
  }
}

export async function loadAll() {
  const [articles, hauls, expenses] = await Promise.all([
    fetchAll('articles', 'article_no'),
    fetchAll('hauls', 'id'),
    fetchAll('expenses', 'date'),
  ]);
  state.articles = articles;
  state.hauls = hauls.sort((a, b) => (b.date || b.created_at).localeCompare(a.date || a.created_at) || b.id - a.id);
  state.expenses = expenses;
}

// ---------------------------------------------------------------- Artikel

export const ARTICLE_FIELDS = ['title', 'category', 'brand', 'size', 'color', 'condition', 'notes', 'location',
  'purchase_input', 'shipping_in', 'purchase_date', 'status', 'listed_price', 'listings', 'sale_price', 'sale_date',
  'sale_platform', 'sale_fees', 'shipping_out', 'images'];

export function articlePayload(a) {
  return Object.fromEntries(ARTICLE_FIELDS.map((k) => [k, a[k]]));
}

function cleanArticle(body) {
  const b = { ...body };
  if (b.status !== 'verkauft') Object.assign(b, { sale_price: null, sale_date: null, sale_platform: '', sale_fees: 0, shipping_out: 0 });
  return b;
}

export async function createArticle(body) {
  return normalize(check(await sb.from('articles').insert(cleanArticle(body)).select().single()));
}

export async function updateArticle(id, body) {
  return normalize(check(await sb.from('articles').update(cleanArticle(body)).eq('id', id).select().single()));
}

export async function deleteArticle(a) {
  check(await sb.from('articles').delete().eq('id', a.id));
  await removeImages(a.images);
}

// ---------------------------------------------------------------- Hauls

export async function createHaul(haul, items) {
  return check(await sb.rpc('create_haul', { haul, items }));
}

export async function updateHaul(id, body) {
  check(await sb.from('hauls').update(body).eq('id', id));
}

export async function dissolveHaul(id) {
  check(await sb.rpc('dissolve_haul', { p_haul: id }));
}

export async function deleteHaul(id) {
  const images = check(await sb.rpc('delete_haul', { p_haul: id }));
  await removeImages(images || []);
}

// ---------------------------------------------------------------- Nebenkosten

export async function createExpense(body) {
  check(await sb.from('expenses').insert(body));
}

export async function deleteExpense(id) {
  check(await sb.from('expenses').delete().eq('id', id));
}

// ---------------------------------------------------------------- Bilder
// Jedes Bild liegt zweimal im Speicher: <user>/<id>.jpg (groß) und
// <user>/<id>_t.jpg (Vorschau), damit die Liste am Handy schnell lädt.

const thumbPath = (p) => p.replace(/\.jpg$/, '_t.jpg');
const urlCache = new Map();

export async function uploadImage(file) {
  const [full, thumb] = await Promise.all([resizeImage(file, 1600), resizeImage(file, 400)]);
  const path = `${state.user.id}/${crypto.randomUUID()}.jpg`;
  const bucket = sb.storage.from('images');
  check(await bucket.upload(path, full, { contentType: 'image/jpeg', cacheControl: '31536000' }));
  const t = await bucket.upload(thumbPath(path), thumb, { contentType: 'image/jpeg', cacheControl: '31536000' });
  if (t.error) {
    await bucket.remove([path]);
    throw new Error(t.error.message);
  }
  return path;
}

export async function removeImages(paths) {
  if (!paths?.length) return;
  const all = paths.flatMap((p) => [p, thumbPath(p)]);
  all.forEach((p) => urlCache.delete(p));
  await sb.storage.from('images').remove(all); // Fehler hier nicht kritisch
}

// Holt signierte Adressen für private Bilder, gebündelt und zwischengespeichert.
export async function signImages(paths, { thumb = false } = {}) {
  const wanted = [...new Set(paths.filter(Boolean).map((p) => (thumb ? thumbPath(p) : p)))];
  const now = Date.now();
  const missing = wanted.filter((p) => !(urlCache.get(p)?.exp > now));
  for (let i = 0; i < missing.length; i += 500) {
    const chunk = missing.slice(i, i + 500);
    const { data, error } = await sb.storage.from('images').createSignedUrls(chunk, 6 * 3600);
    if (error) { console.warn(error); continue; }
    for (const d of data) if (d.signedUrl) urlCache.set(d.path, { url: d.signedUrl, exp: now + 5 * 3600_000 });
  }
}

export function imageUrl(path, { thumb = false } = {}) {
  if (!path) return '';
  return urlCache.get(thumb ? thumbPath(path) : path)?.url || '';
}

// Setzt die Bildadressen für alle <img data-img="pfad" data-thumb> in `root`.
export async function hydrateImages(root) {
  const imgs = [...root.querySelectorAll('img[data-img]')];
  if (!imgs.length) return;
  await signImages(imgs.filter((i) => 'thumb' in i.dataset).map((i) => i.dataset.img), { thumb: true });
  await signImages(imgs.filter((i) => !('thumb' in i.dataset)).map((i) => i.dataset.img));
  for (const i of imgs) {
    const url = imageUrl(i.dataset.img, { thumb: 'thumb' in i.dataset });
    if (url && i.src !== url) i.src = url;
  }
}
