// Schreibt public/js/config.js aus den Umgebungsvariablen.
// Netlify ruft das beim Deploy auf (siehe netlify.toml), lokal liest es auch .env.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const envFile = path.join(root, '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

// Nimmt auch Adressen mit Pfad (z. B. .../rest/v1/) oder den Dashboard-Link
// und macht daraus die reine Projektadresse https://<ref>.supabase.co
function normalizeUrl(raw) {
  const s = (raw || '').trim().replace(/^["']|["']$/g, '');
  if (!s) return '';
  let u;
  try { u = new URL(/^https?:\/\//.test(s) ? s : `https://${s}`); } catch { return s; }
  const dash = u.pathname.match(/\/project\/([a-z0-9]{10,})/);
  if (/(^|\.)supabase\.com$/.test(u.hostname) && dash) return `https://${dash[1]}.supabase.co`;
  return u.origin;
}

const rawUrl = process.env.SUPABASE_URL || '';
const url = normalizeUrl(rawUrl);
if (url && url !== rawUrl.trim().replace(/\/+$/, '')) console.log(`ℹ SUPABASE_URL korrigiert: "${rawUrl.trim()}" -> "${url}"`);
const key = (process.env.SUPABASE_KEY || process.env.SUPABASE_ANON_KEY || '').trim();

if (!url || !key) {
  console.warn('⚠ SUPABASE_URL oder SUPABASE_KEY fehlt. Die App zeigt einen Hinweis statt der Anmeldung.');
} else if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(url)) {
  console.warn(`⚠ SUPABASE_URL sieht ungewöhnlich aus: "${url}" (erwartet: https://xxxx.supabase.co). Baue trotzdem.`);
}
if (url && !/^https?:\/\//.test(url)) {
  console.error(`✗ SUPABASE_URL sieht falsch aus: "${url}" (erwartet: https://xxxx.supabase.co)`);
  process.exit(1);
}
if (/service_role|sb_secret_/.test(key) || (key.startsWith('eyJ') && JSON.parse(Buffer.from(key.split('.')[1], 'base64url')).role === 'service_role')) {
  console.error('✗ Das ist der geheime service_role/secret-Schlüssel. Der darf NIE in die App! Nimm den "anon" oder "publishable" Schlüssel.');
  process.exit(1);
}

fs.writeFileSync(path.join(root, 'public/js/config.js'),
  `// Automatisch erzeugt von scripts/build-config.mjs. Nicht von Hand bearbeiten.\n` +
  `export const SUPABASE_URL = ${JSON.stringify(url)};\nexport const SUPABASE_KEY = ${JSON.stringify(key)};\n`);
console.log(`✓ config.js geschrieben${url ? ` für ${url}` : ' (leer)'}`);
