// Kleine Helfer für Oberfläche, Formatierung und Dialoge.

import { STATUSES } from './shared.js';

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function toast(msg, kind = '') {
  const t = $('#toast');
  t.textContent = msg;
  t.className = `show ${kind}`;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { t.className = ''; }, kind === 'err' ? 5000 : 3200);
}

// "12,50" / "12.50" / "1.250,00 €" -> Cent. Leer -> null.
export function parseMoney(v, label = 'Betrag') {
  let s = String(v ?? '').replace(/[\s€]/g, '');
  if (!s) return null;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0) throw new Error(`${label}: "${v}" ist kein gültiger Betrag`);
  if (n > 100000) throw new Error(`${label}: maximal 100.000 €`);
  return Math.round(n * 100);
}
export const moneyValue = (c) => (c === null || c === undefined ? '' : (c / 100).toFixed(2).replace('.', ','));

export function today() {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
}
export const fmtDate = (d) => (d ? d.slice(0, 10).split('-').reverse().join('.') : '');

export const options = (list, selected, empty) =>
  (empty !== undefined ? `<option value="">${esc(empty)}</option>` : '') +
  list.map((v) => `<option value="${esc(v)}"${v === selected ? ' selected' : ''}>${esc(v)}</option>`).join('');

export const statusOptions = (selected) =>
  Object.entries(STATUSES).map(([k, v]) => `<option value="${k}"${k === selected ? ' selected' : ''}>${v}</option>`).join('');

export function profitClass(c) {
  if (c === null || c === undefined) return '';
  return c > 0 ? 'pos' : c < 0 ? 'neg' : '';
}

// Verkleinert ein Foto im Browser, bevor es hochgeladen wird.
export async function resizeImage(file, max) {
  if (!file.type.startsWith('image/') && !/\.(heic|heif)$/i.test(file.name)) throw new Error('Bitte eine Bilddatei auswählen');
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('Bild konnte nicht gelesen werden. HEIC-Fotos bitte als JPG exportieren.'));
      i.src = url;
    });
    return await drawScaled(img, max);
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function drawScaled(img, max) {
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
  const scale = Math.min(1, max / Math.max(w, h));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
}

export async function copyText(text, msg = 'Kopiert') {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.append(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
  toast(msg);
}

export function download(filename, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---------------------------------------------------------------- Modal

export function openModal(html, { wide = false } = {}) {
  const root = $('#modal-root');
  root.innerHTML = `<div class="backdrop"><div class="modal${wide ? ' wide' : ''}" role="dialog" aria-modal="true">${html}</div></div>`;
  document.body.classList.add('modal-open');
  const backdrop = $('.backdrop', root);
  backdrop.addEventListener('mousedown', (e) => { if (e.target === backdrop) closeModal(); });
  $$('[data-close]', root).forEach((b) => b.addEventListener('click', closeModal));
  const first = $('input:not([type=hidden]):not([type=file]):not([disabled]), select, textarea:not([readonly])', root);
  if (first && window.matchMedia('(pointer: fine)').matches) setTimeout(() => first.focus(), 30);
  return $('.modal', root);
}

export function closeModal() {
  $('#modal-root').innerHTML = '';
  document.body.classList.remove('modal-open');
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && $('#modal-root').innerHTML) closeModal();
});

export function modalHead(title, sub = '') {
  return `<div class="modal-head"><div><h2>${title}</h2>${sub ? `<p class="muted">${sub}</p>` : ''}</div>
    <button class="icon-btn" data-close aria-label="Schließen">✕</button></div>`;
}

export function confirmDialog(title, text, buttons) {
  return new Promise((resolve) => {
    const m = openModal(`${modalHead(esc(title))}<div class="modal-body"><p>${text}</p></div>
      <div class="modal-foot">${buttons.map((b, i) => `<button class="btn ${b.kind || ''}" data-i="${i}">${esc(b.label)}</button>`).join('')}</div>`);
    $$('[data-i]', m).forEach((b) => b.addEventListener('click', () => { closeModal(); resolve(buttons[b.dataset.i].value); }));
    $$('[data-close]', m).forEach((b) => b.addEventListener('click', () => resolve(null)));
  });
}

// Führt eine Aktion aus und zeigt Fehler als Toast.
export async function guard(fn) {
  try {
    return await fn();
  } catch (e) {
    console.error(e);
    toast(e.message || 'Da ist was schiefgegangen', 'err');
    return undefined;
  }
}
