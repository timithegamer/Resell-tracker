import {
  CATEGORIES, CONDITIONS, STATUSES, PLATFORMS,
  allocateHaul, profitOf, costOf, fmtMoney, fmtArticleNo,
} from './shared.js';

const state = {
  user: null,
  articles: [],
  hauls: [],
  view: 'inventar',
  filter: { q: '', status: '', category: '', sort: 'neu' },
};

// ================================================================ Helfer

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const app = $('#app');

async function api(method, url, body) {
  const opts = { method, credentials: 'same-origin', headers: {} };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(url, opts);
  let data = null;
  try { data = await res.json(); } catch { /* leer */ }
  if (res.status === 401 && url !== '/api/login' && state.user) {
    state.user = null;
    closeModal();
    renderAuth();
  }
  if (!res.ok) throw new Error(data?.error || `Fehler ${res.status}`);
  return data;
}

function toast(msg, kind = '') {
  const t = $('#toast');
  t.textContent = msg;
  t.className = `show ${kind}`;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { t.className = ''; }, 3200);
}

// "12,50" / "12.50" / "1.250,00 €" -> Cent. Leer -> null.
function parseMoney(v, label = 'Betrag') {
  let s = String(v ?? '').replace(/[\s€]/g, '');
  if (!s) return null;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0) throw new Error(`${label}: "${v}" ist kein gültiger Betrag`);
  return Math.round(n * 100);
}
const moneyValue = (c) => (c === null || c === undefined ? '' : (c / 100).toFixed(2).replace('.', ','));

function today() {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
}
const fmtDate = (d) => (d ? d.split('-').reverse().join('.') : '–');

const options = (list, selected, empty) =>
  (empty !== undefined ? `<option value="">${esc(empty)}</option>` : '') +
  list.map((v) => `<option value="${esc(v)}"${v === selected ? ' selected' : ''}>${esc(v)}</option>`).join('');

const statusOptions = (selected) =>
  Object.entries(STATUSES).map(([k, v]) => `<option value="${k}"${k === selected ? ' selected' : ''}>${v}</option>`).join('');

const imgUrl = (name) => `/api/images/${encodeURIComponent(name)}`;
const haulById = (id) => state.hauls.find((h) => h.id === id);
const articleById = (id) => state.articles.find((a) => a.id === id);

function profitClass(c) {
  if (c === null) return '';
  return c > 0 ? 'pos' : c < 0 ? 'neg' : '';
}

async function resizeImage(file, max = 1600) {
  if (!file.type.startsWith('image/') && !/\.(heic|heif)$/i.test(file.name)) throw new Error('Bitte eine Bilddatei auswählen');
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('Bild konnte nicht gelesen werden. HEIC-Fotos bitte als JPG exportieren.'));
      i.src = url;
    });
    const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.85);
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function copyText(text) {
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
  toast('Prompt kopiert');
}

// ================================================================ Modal

function openModal(html, { wide = false } = {}) {
  const root = $('#modal-root');
  root.innerHTML = `<div class="backdrop"><div class="modal${wide ? ' wide' : ''}" role="dialog" aria-modal="true">${html}</div></div>`;
  document.body.classList.add('modal-open');
  const backdrop = $('.backdrop', root);
  backdrop.addEventListener('mousedown', (e) => { if (e.target === backdrop) closeModal(); });
  $$('[data-close]', root).forEach((b) => b.addEventListener('click', closeModal));
  const first = $('input:not([type=hidden]):not([disabled]), select, textarea', root);
  if (first && !first.readOnly) setTimeout(() => first.focus(), 30);
  return $('.modal', root);
}

function closeModal() {
  $('#modal-root').innerHTML = '';
  document.body.classList.remove('modal-open');
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && $('#modal-root').innerHTML) closeModal();
});

function modalHead(title, sub = '') {
  return `<div class="modal-head"><div><h2>${title}</h2>${sub ? `<p class="muted">${sub}</p>` : ''}</div>
    <button class="icon-btn" data-close aria-label="Schließen">✕</button></div>`;
}

function confirmDialog(title, text, buttons) {
  return new Promise((resolve) => {
    const m = openModal(`${modalHead(esc(title))}<div class="modal-body"><p>${text}</p></div>
      <div class="modal-foot">${buttons.map((b, i) => `<button class="btn ${b.kind || ''}" data-i="${i}">${esc(b.label)}</button>`).join('')}</div>`);
    $$('[data-i]', m).forEach((b) => b.addEventListener('click', () => { closeModal(); resolve(buttons[b.dataset.i].value); }));
    $$('[data-close]', m).forEach((b) => b.addEventListener('click', () => resolve(null)));
  });
}

// ================================================================ Start

async function boot() {
  try {
    const { user } = await api('GET', '/api/me');
    state.user = user;
    await loadData();
    renderApp();
  } catch {
    renderAuth();
  }
}

async function loadData() {
  const d = await api('GET', '/api/data');
  state.articles = d.articles;
  state.hauls = d.hauls;
}

async function refresh() {
  await loadData();
  renderView();
}

// ================================================================ Anmeldung

function renderAuth(mode = 'login') {
  const reg = mode === 'register';
  app.innerHTML = `
  <div class="auth">
    <div class="auth-card">
      <div class="auth-brand"><img src="icon.svg" alt=""><h1>Resell Tracker</h1></div>
      <p class="muted">Einkauf, Verkauf und Gewinn deiner Resells an einem Ort.</p>
      <div class="seg">
        <button type="button" data-mode="login" class="${reg ? '' : 'active'}">Anmelden</button>
        <button type="button" data-mode="register" class="${reg ? 'active' : ''}">Konto erstellen</button>
      </div>
      <form id="auth-form" novalidate>
        ${reg ? '<label>Name<input name="name" autocomplete="name" maxlength="80"></label>' : ''}
        <label>E-Mail<input name="email" type="email" autocomplete="email" required></label>
        <label>Passwort<input name="password" type="password" autocomplete="${reg ? 'new-password' : 'current-password'}" required minlength="8"></label>
        ${reg ? '<label>Passwort wiederholen<input name="password2" type="password" autocomplete="new-password" required></label>' : ''}
        <p class="error" id="auth-error"></p>
        <button class="btn primary block" type="submit">${reg ? 'Konto erstellen' : 'Anmelden'}</button>
      </form>
    </div>
  </div>`;
  $$('[data-mode]').forEach((b) => b.addEventListener('click', () => renderAuth(b.dataset.mode)));
  $('#auth-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    const err = $('#auth-error');
    err.textContent = '';
    if (reg && f.password !== f.password2) { err.textContent = 'Die Passwörter stimmen nicht überein.'; return; }
    if (reg && f.password.length < 8) { err.textContent = 'Passwort muss mindestens 8 Zeichen haben.'; return; }
    const btn = $('button[type=submit]', e.target);
    btn.disabled = true;
    try {
      const { user } = await api('POST', reg ? '/api/register' : '/api/login', { name: f.name, email: f.email, password: f.password });
      state.user = user;
      state.view = 'inventar';
      await loadData();
      renderApp();
      if (reg) toast(`Willkommen${user.name ? ', ' + user.name : ''}! Leg mit „+ Haul“ oder „+ Artikel“ los.`);
    } catch (ex) {
      err.textContent = ex.message;
      btn.disabled = false;
    }
  });
}

// ================================================================ Grundgerüst

function renderApp() {
  app.innerHTML = `
  <header class="topbar">
    <div class="brand"><img src="icon.svg" alt=""><span>Resell Tracker</span></div>
    <nav class="tabs" aria-label="Bereiche">
      <button data-view="inventar">Inventar</button>
      <button data-view="hauls">Hauls</button>
      <button data-view="konto">Konto</button>
    </nav>
    <div class="actions">
      <button class="btn" id="add-article">+ Artikel</button>
      <button class="btn primary" id="add-haul">+ Haul hinzufügen</button>
    </div>
  </header>
  <main id="main"></main>`;
  $$('[data-view]').forEach((b) => b.addEventListener('click', () => { state.view = b.dataset.view; renderView(); }));
  $('#add-article').addEventListener('click', () => articleForm());
  $('#add-haul').addEventListener('click', () => haulForm());
  renderView();
}

function renderView() {
  $$('[data-view]').forEach((b) => b.classList.toggle('active', b.dataset.view === state.view));
  const main = $('#main');
  if (!main) return;
  if (state.view === 'hauls') renderHauls(main);
  else if (state.view === 'konto') renderAccount(main);
  else renderInventory(main);
}

// ================================================================ Inventar

function computeStats(list) {
  const s = { count: list.length, stock: 0, stockValue: 0, sold: 0, revenue: 0, profit: 0, soldCost: 0, invested: 0, net: 0 };
  for (const a of list) {
    const cost = costOf(a);
    s.invested += cost;
    if (a.status === 'verkauft') {
      s.sold++;
      s.revenue += a.sale_price || 0;
      s.profit += profitOf(a) || 0;
      s.soldCost += cost;
      s.net += (a.sale_price || 0) - (a.sale_fees || 0) - (a.shipping_out || 0);
    } else {
      s.stock++;
      s.stockValue += cost;
    }
  }
  s.net -= s.invested;
  return s;
}

function statsHtml(s) {
  const roi = s.soldCost > 0 ? Math.round((s.profit / s.soldCost) * 100) : null;
  return `
  <section class="stats">
    <div class="stat"><span>Auf Lager</span><strong>${s.stock}</strong><small>Warenwert ${fmtMoney(s.stockValue)}</small></div>
    <div class="stat"><span>Verkauft</span><strong>${s.sold}</strong><small>Umsatz ${fmtMoney(s.revenue)}</small></div>
    <div class="stat"><span>Gewinn realisiert</span><strong class="${profitClass(s.profit)}">${fmtMoney(s.profit)}</strong>
      <small>${s.sold === 0 ? 'noch nichts verkauft' : `${roi === null ? '' : `ROI ${roi} % · `}Ø ${fmtMoney(Math.round(s.profit / s.sold))}/Artikel`}</small></div>
    <div class="stat"><span>Cash bisher</span><strong class="${profitClass(s.net)}">${fmtMoney(s.net)}</strong>
      <small>Erlöse minus alles Investierte</small></div>
  </section>`;
}

function renderInventory(main) {
  const f = state.filter;
  main.innerHTML = `
    ${statsHtml(computeStats(state.articles))}
    <section class="toolbar">
      <input type="search" id="f-q" placeholder="Suchen: Titel, Marke, Nr …" value="${esc(f.q)}">
      <select id="f-status">${`<option value="">Alle Status</option>` + statusOptions(f.status)}</select>
      <select id="f-category">${options(CATEGORIES, f.category, 'Alle Kategorien')}</select>
      <select id="f-sort">
        ${[['neu', 'Neueste zuerst'], ['alt', 'Älteste zuerst'], ['gewinn', 'Höchster Gewinn'], ['ek', 'Höchster Einkauf'], ['titel', 'Titel A–Z']]
          .map(([k, v]) => `<option value="${k}"${k === f.sort ? ' selected' : ''}>${v}</option>`).join('')}
      </select>
    </section>
    <section id="list" class="list"></section>`;
  const bind = (id, key, ev = 'change') => $(id).addEventListener(ev, (e) => { f[key] = e.target.value; renderList(); });
  bind('#f-q', 'q', 'input');
  bind('#f-status', 'status');
  bind('#f-category', 'category');
  bind('#f-sort', 'sort');
  renderList();
}

function filteredArticles() {
  const f = state.filter;
  const q = f.q.trim().toLowerCase().replace(/^#0*/, '');
  let list = state.articles.filter((a) =>
    (!f.status || a.status === f.status) &&
    (!f.category || a.category === f.category) &&
    (!q || `${a.title} ${a.brand} ${a.size} ${a.color} ${a.notes} ${a.article_no}`.toLowerCase().includes(q)));
  const by = {
    neu: (a, b) => b.article_no - a.article_no,
    alt: (a, b) => a.article_no - b.article_no,
    gewinn: (a, b) => (profitOf(b) ?? -Infinity) - (profitOf(a) ?? -Infinity),
    ek: (a, b) => costOf(b) - costOf(a),
    titel: (a, b) => a.title.localeCompare(b.title, 'de'),
  }[f.sort];
  return list.sort(by);
}

function thumb(a, cls = 'thumb') {
  return a.image
    ? `<img class="${cls}" src="${imgUrl(a.image)}" alt="" loading="lazy">`
    : `<div class="${cls} placeholder">${esc(a.category.slice(0, 2))}</div>`;
}

function articleRow(a) {
  const p = profitOf(a);
  const haul = a.haul_id ? haulById(a.haul_id) : null;
  const meta = [a.category, a.brand, a.size && `Gr. ${a.size}`, haul && `Haul: ${haul.name}`].filter(Boolean).map(esc).join(' · ');
  return `
  <button class="row" data-id="${a.id}">
    ${thumb(a)}
    <div class="row-main">
      <div class="row-title"><span class="no">${fmtArticleNo(a.article_no)}</span>${esc(a.title)}</div>
      <div class="row-meta">${meta}</div>
    </div>
    <div class="row-nums">
      <div><span>EK</span>${fmtMoney(costOf(a))}</div>
      <div><span>${a.status === 'verkauft' ? 'VK' : 'Preis'}</span>${fmtMoney(a.status === 'verkauft' ? a.sale_price : a.listed_price)}</div>
      <div><span>Gewinn</span><b class="${profitClass(p)}">${fmtMoney(p)}</b></div>
    </div>
    <span class="badge ${a.status}">${STATUSES[a.status]}</span>
  </button>`;
}

function renderList() {
  const el = $('#list');
  if (!el) return;
  const list = filteredArticles();
  if (state.articles.length === 0) {
    el.innerHTML = `<div class="empty"><h3>Noch keine Artikel</h3>
      <p>Hast du mehrere Teile auf einmal gekauft? Dann nimm <b>„+ Haul hinzufügen“</b>, dort verteilst du Gesamtpreis und Versand automatisch auf alle Teile.</p>
      <div class="empty-actions"><button class="btn primary" data-empty="haul">+ Haul hinzufügen</button><button class="btn" data-empty="article">+ Einzelnen Artikel</button></div></div>`;
    $('[data-empty=haul]', el).addEventListener('click', () => haulForm());
    $('[data-empty=article]', el).addEventListener('click', () => articleForm());
    return;
  }
  el.innerHTML = list.length ? list.map(articleRow).join('') : '<p class="muted center">Keine Artikel für diesen Filter.</p>';
  $$('.row', el).forEach((r) => r.addEventListener('click', () => articleDetail(Number(r.dataset.id))));
}

// ================================================================ Artikel-Detail

function articleDetail(id) {
  const a = articleById(id);
  if (!a) return;
  const haul = a.haul_id ? haulById(a.haul_id) : null;
  const p = profitOf(a);
  const cost = costOf(a);
  const margin = p !== null && a.sale_price ? Math.round((p / a.sale_price) * 100) : null;
  const info = [
    ['Kategorie', a.category], ['Marke', a.brand], ['Größe', a.size], ['Farbe', a.color],
    ['Zustand', a.condition], ['Eingekauft am', fmtDate(a.purchase_date)],
  ].filter(([, v]) => v && v !== '–').map(([k, v]) => `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join('');

  const moneyRows = [
    ['Einkaufspreis', fmtMoney(a.purchase_price), haul && a.purchase_input === null ? 'anteilig aus Haul' : ''],
    ['Versand Einkauf', fmtMoney(a.shipping_in), haul ? 'anteilig aus Haul' : ''],
    ['Kosten gesamt', `<b>${fmtMoney(cost)}</b>`, ''],
  ];
  if (a.status === 'verkauft') {
    moneyRows.push(
      ['Verkaufspreis', fmtMoney(a.sale_price), [a.sale_platform, fmtDate(a.sale_date)].filter((x) => x && x !== '–').join(' · ')],
      ...(a.sale_fees ? [['Gebühren', '−' + fmtMoney(a.sale_fees), '']] : []),
      ...(a.shipping_out ? [['Versand Verkauf', '−' + fmtMoney(a.shipping_out), '']] : []),
      ['Gewinn', `<b class="${profitClass(p)}">${fmtMoney(p)}</b>`, margin !== null ? `Marge ${margin} %` : ''],
    );
  } else if (a.listed_price !== null) {
    moneyRows.push(['Angebotspreis', fmtMoney(a.listed_price), `möglicher Gewinn ${fmtMoney(a.listed_price - cost)} (vor Gebühren)`]);
  }

  const m = openModal(`
    ${modalHead(`<span class="no">${fmtArticleNo(a.article_no)}</span> ${esc(a.title)}`,
      `<span class="badge ${a.status}">${STATUSES[a.status]}</span>${haul ? ` · Haul <a href="#" data-haul="${haul.id}">${esc(haul.name)}</a>` : ''}`)}
    <div class="modal-body">
      <div class="detail">
        <div class="detail-img">
          ${a.image ? `<img src="${imgUrl(a.image)}" alt="${esc(a.title)}">` : `<label class="img-drop">Bild hinzufügen<input type="file" accept="image/*" id="quick-img" hidden></label>`}
        </div>
        <div>
          <dl class="info">${info || '<p class="muted">Keine weiteren Angaben.</p>'}</dl>
          <table class="money">${moneyRows.map(([k, v, n]) => `<tr><th>${k}</th><td>${v}</td><td class="muted">${esc(n)}</td></tr>`).join('')}</table>
          ${a.notes ? `<p class="notes">${esc(a.notes)}</p>` : ''}
        </div>
      </div>
      <div class="detail-actions">
        ${a.status !== 'verkauft' ? '<button class="btn primary" id="d-sell">Als verkauft markieren</button>' : '<button class="btn" id="d-sell">Verkauf bearbeiten</button>'}
        ${a.status === 'lager' ? '<button class="btn" id="d-listed">Als online gelistet markieren</button>' : ''}
        <button class="btn" id="d-edit">Bearbeiten</button>
        <button class="btn danger ghost" id="d-del">Löschen</button>
      </div>
      <h3 class="section-title">KI-Prompts</h3>
      <p class="muted small">Kopieren und in ChatGPT, Claude oder Gemini einfügen. Für bessere Ergebnisse das Foto mit anhängen${a.image ? ` (<a href="${imgUrl(a.image)}" download="${esc(fmtArticleNo(a.article_no).slice(1))}.jpg">Bild herunterladen</a>)` : ''}.
      Für die Preisanalyse eine KI mit Websuche nehmen, sonst sind die Zahlen geraten.</p>
      ${promptBlocks(a)}
    </div>`, { wide: true });

  $('[data-haul]', m)?.addEventListener('click', (e) => { e.preventDefault(); haulDetail(haul.id); });
  $('#d-sell', m).addEventListener('click', () => sellForm(a));
  $('#d-listed', m)?.addEventListener('click', () => quickUpdate(a, { status: 'gelistet' }, 'Als gelistet markiert'));
  $('#d-edit', m).addEventListener('click', () => articleForm(a));
  $('#d-del', m).addEventListener('click', () => deleteArticle(a));
  $('#quick-img', m)?.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const image = await resizeImage(file);
      await api('PUT', `/api/articles/${a.id}`, { ...articlePayload(a), image });
      await refresh();
      articleDetail(a.id);
      toast('Bild gespeichert');
    } catch (ex) { toast(ex.message, 'err'); }
  });
  wirePrompts(m);
}

function articlePayload(a) {
  const keys = ['title', 'category', 'brand', 'size', 'color', 'condition', 'notes', 'purchase_input', 'shipping_in', 'purchase_date',
    'status', 'listed_price', 'sale_price', 'sale_date', 'sale_platform', 'sale_fees', 'shipping_out'];
  return Object.fromEntries(keys.map((k) => [k, a[k]]));
}

async function quickUpdate(a, changes, msg) {
  try {
    await api('PUT', `/api/articles/${a.id}`, { ...articlePayload(a), ...changes });
    await refresh();
    articleDetail(a.id);
    toast(msg);
  } catch (ex) { toast(ex.message, 'err'); }
}

async function deleteArticle(a) {
  const extra = a.haul_id ? '<br><br>Der Artikel gehört zu einem Haul. Dessen Gesamtpreis wird danach auf die übrigen Teile verteilt.' : '';
  const ok = await confirmDialog('Artikel löschen?', `${esc(fmtArticleNo(a.article_no))} „${esc(a.title)}“ wird endgültig gelöscht. Die Artikelnummer wird nicht neu vergeben.${extra}`,
    [{ label: 'Abbrechen', value: false }, { label: 'Löschen', value: true, kind: 'danger' }]);
  if (!ok) return;
  try {
    await api('DELETE', `/api/articles/${a.id}`);
    await refresh();
    toast('Artikel gelöscht');
  } catch (ex) { toast(ex.message, 'err'); }
}

// ================================================================ Verkauf

function sellForm(a) {
  const m = openModal(`
    ${modalHead('Verkauf eintragen', `${esc(fmtArticleNo(a.article_no))} ${esc(a.title)} · Kosten ${fmtMoney(costOf(a))}`)}
    <form class="modal-body form" id="sell-form">
      <div class="grid2">
        <label>Verkaufspreis *<input name="sale_price" inputmode="decimal" required value="${moneyValue(a.sale_price ?? a.listed_price)}" placeholder="0,00"></label>
        <label>Verkauft am<input name="sale_date" type="date" value="${esc(a.sale_date || today())}"></label>
        <label>Plattform<select name="sale_platform">${options(PLATFORMS, a.sale_platform, '–')}</select></label>
        <label>Gebühren<input name="sale_fees" inputmode="decimal" value="${moneyValue(a.sale_fees || null)}" placeholder="0,00"></label>
        <label>Versand (von dir bezahlt)<input name="shipping_out" inputmode="decimal" value="${moneyValue(a.shipping_out || null)}" placeholder="0,00"></label>
      </div>
      <p class="preview" id="sell-preview"></p>
      <p class="error" id="sell-error"></p>
    </form>
    <div class="modal-foot">
      ${a.status === 'verkauft' ? '<button class="btn ghost" id="unsell">Verkauf zurücknehmen</button>' : ''}
      <button class="btn" data-close>Abbrechen</button>
      <button class="btn primary" id="sell-save">Speichern</button>
    </div>`);
  const form = $('#sell-form', m);
  const read = () => {
    const f = Object.fromEntries(new FormData(form));
    return {
      sale_price: parseMoney(f.sale_price, 'Verkaufspreis'),
      sale_date: f.sale_date || null,
      sale_platform: f.sale_platform,
      sale_fees: parseMoney(f.sale_fees, 'Gebühren') || 0,
      shipping_out: parseMoney(f.shipping_out, 'Versand') || 0,
    };
  };
  const preview = () => {
    try {
      const v = read();
      if (v.sale_price === null) { $('#sell-preview', m).textContent = ''; return; }
      const p = v.sale_price - costOf(a) - v.sale_fees - v.shipping_out;
      $('#sell-preview', m).innerHTML = `Gewinn: <b class="${profitClass(p)}">${fmtMoney(p)}</b>`;
    } catch { $('#sell-preview', m).textContent = ''; }
  };
  form.addEventListener('input', preview);
  preview();
  const save = async () => {
    try {
      const v = read();
      if (v.sale_price === null) throw new Error('Bitte einen Verkaufspreis eintragen');
      await api('PUT', `/api/articles/${a.id}`, { ...articlePayload(a), ...v, status: 'verkauft' });
      await refresh();
      articleDetail(a.id);
      toast('Verkauf gespeichert');
    } catch (ex) { $('#sell-error', m).textContent = ex.message; }
  };
  form.addEventListener('submit', (e) => { e.preventDefault(); save(); });
  $('#sell-save', m).addEventListener('click', save);
  $('#unsell', m)?.addEventListener('click', () => quickUpdate(a, { status: 'gelistet' }, 'Verkauf zurückgenommen'));
}

// ================================================================ Artikel-Formular

function articleForm(a = null, presetHaulId = null) {
  const haulId = a ? a.haul_id : presetHaulId;
  const haul = haulId ? haulById(haulId) : null;
  const v = a || { category: 'Kleidung', status: 'lager', purchase_date: haul?.date || today() };
  let image; // undefined = unverändert, null = entfernen, string = neues Bild
  const m = openModal(`
    ${modalHead(a ? `Artikel ${fmtArticleNo(a.article_no)} bearbeiten` : 'Neuer Artikel', haul ? `Teil von Haul „${esc(haul.name)}“` : 'Die Artikelnummer wird automatisch vergeben.')}
    <form class="modal-body form" id="art-form">
      <label>Titel / Bezeichnung *<input name="title" required maxlength="160" value="${esc(v.title)}" placeholder="z. B. Nike Air Max 90 weiß"></label>
      <div class="grid3">
        <label>Kategorie<select name="category">${options(CATEGORIES, v.category)}</select></label>
        <label>Marke<input name="brand" maxlength="80" value="${esc(v.brand)}"></label>
        <label>Größe<input name="size" maxlength="40" value="${esc(v.size)}"></label>
        <label>Farbe<input name="color" maxlength="40" value="${esc(v.color)}"></label>
        <label>Zustand<select name="condition">${options(CONDITIONS, v.condition, '–')}</select></label>
        <label>Status<select name="status">${statusOptions(v.status)}</select></label>
      </div>
      <fieldset>
        <legend>Einkauf</legend>
        <div class="grid3">
          <label>${haul ? 'Einzelpreis (optional)' : 'Einkaufspreis'}<input name="purchase_input" inputmode="decimal" value="${moneyValue(v.purchase_input)}" placeholder="${haul ? 'leer = anteilig' : '0,00'}"></label>
          ${haul
            ? `<label>Versand Einkauf<input disabled value="${a ? moneyValue(a.shipping_in) : ''}" placeholder="anteilig aus Haul"></label>`
            : `<label>Versand Einkauf<input name="shipping_in" inputmode="decimal" value="${moneyValue(v.shipping_in || null)}" placeholder="0,00"></label>`}
          <label>Eingekauft am<input name="purchase_date" type="date" value="${esc(v.purchase_date || '')}"></label>
        </div>
        ${haul ? '<p class="muted small">Ohne Einzelpreis bekommt der Artikel seinen Anteil vom Gesamtpreis des Hauls. Der Versand wird immer anteilig verteilt.</p>' : ''}
      </fieldset>
      <fieldset>
        <legend>Verkauf</legend>
        <div class="grid3">
          <label>Angebotspreis<input name="listed_price" inputmode="decimal" value="${moneyValue(v.listed_price)}" placeholder="0,00"></label>
        </div>
        <div class="grid3 sold-only">
          <label>Verkaufspreis *<input name="sale_price" inputmode="decimal" value="${moneyValue(v.sale_price)}" placeholder="0,00"></label>
          <label>Verkauft am<input name="sale_date" type="date" value="${esc(v.sale_date || today())}"></label>
          <label>Plattform<select name="sale_platform">${options(PLATFORMS, v.sale_platform, '–')}</select></label>
          <label>Gebühren<input name="sale_fees" inputmode="decimal" value="${moneyValue(v.sale_fees || null)}" placeholder="0,00"></label>
          <label>Versand (von dir bezahlt)<input name="shipping_out" inputmode="decimal" value="${moneyValue(v.shipping_out || null)}" placeholder="0,00"></label>
        </div>
      </fieldset>
      <label>Notizen<textarea name="notes" rows="3" maxlength="4000" placeholder="Mängel, Maße, Material, Lagerort …">${esc(v.notes)}</textarea></label>
      <div class="img-field">
        <div id="img-preview">${v.image ? `<img src="${imgUrl(v.image)}" alt="">` : ''}</div>
        <label class="btn small">Bild wählen<input type="file" accept="image/*" id="img-input" hidden></label>
        <button type="button" class="btn small ghost" id="img-remove"${v.image ? '' : ' hidden'}>Bild entfernen</button>
      </div>
      <p class="error" id="art-error"></p>
    </form>
    <div class="modal-foot">
      <button class="btn" data-close>Abbrechen</button>
      <button class="btn primary" id="art-save">${a ? 'Speichern' : 'Artikel anlegen'}</button>
    </div>`, { wide: true });

  const form = $('#art-form', m);
  const toggleSold = () => form.classList.toggle('is-sold', form.status.value === 'verkauft');
  form.status.addEventListener('change', toggleSold);
  toggleSold();

  $('#img-input', m).addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      image = await resizeImage(file);
      $('#img-preview', m).innerHTML = `<img src="${image}" alt="">`;
      $('#img-remove', m).hidden = false;
    } catch (ex) { toast(ex.message, 'err'); }
  });
  $('#img-remove', m).addEventListener('click', () => {
    image = null;
    $('#img-preview', m).innerHTML = '';
    $('#img-remove', m).hidden = true;
  });

  const save = async () => {
    const err = $('#art-error', m);
    err.textContent = '';
    try {
      const f = Object.fromEntries(new FormData(form));
      if (!f.title.trim()) throw new Error('Bitte einen Titel eingeben');
      const body = {
        title: f.title, category: f.category, brand: f.brand, size: f.size, color: f.color,
        condition: f.condition, status: f.status, notes: f.notes,
        purchase_input: parseMoney(f.purchase_input, 'Einkaufspreis'),
        shipping_in: haul ? 0 : parseMoney(f.shipping_in, 'Versand') || 0,
        purchase_date: f.purchase_date || null,
        listed_price: parseMoney(f.listed_price, 'Angebotspreis'),
        sale_price: parseMoney(f.sale_price, 'Verkaufspreis'),
        sale_date: f.sale_date || null,
        sale_platform: f.sale_platform,
        sale_fees: parseMoney(f.sale_fees, 'Gebühren') || 0,
        shipping_out: parseMoney(f.shipping_out, 'Versand') || 0,
      };
      if (!haul && body.purchase_input === null) body.purchase_input = 0;
      if (body.status === 'verkauft' && body.sale_price === null) throw new Error('Bitte einen Verkaufspreis eintragen');
      if (image !== undefined) body.image = image;
      $('#art-save', m).disabled = true;
      let saved;
      if (a) saved = (await api('PUT', `/api/articles/${a.id}`, body)).article;
      else saved = (await api('POST', '/api/articles', { ...body, haul_id: haulId })).article;
      await refresh();
      articleDetail(saved.id);
      toast(a ? 'Gespeichert' : `Artikel ${fmtArticleNo(saved.article_no)} angelegt`);
    } catch (ex) {
      err.textContent = ex.message;
      $('#art-save', m).disabled = false;
    }
  };
  form.addEventListener('submit', (e) => { e.preventDefault(); save(); });
  $('#art-save', m).addEventListener('click', save);
}

// ================================================================ Haul hinzufügen

const SOURCES = ['Vinted-Bundle', 'eBay-Lot', 'Flohmarkt', 'Kleinanzeigen', 'willhaben', 'Second-Hand-Laden', 'Großhandel / Ballenware', 'Outlet', 'Haushaltsauflösung'];

function haulForm() {
  const rowImages = new Map();
  const m = openModal(`
    ${modalHead('Haul hinzufügen', 'Mehrere Teile auf einmal einkaufen. Gesamtpreis und Versand werden auf die Artikel verteilt.')}
    <form class="modal-body form" id="haul-form" novalidate>
      <div class="grid3">
        <label>Name des Hauls *<input name="name" required maxlength="120" placeholder="z. B. Flohmarkt Naschmarkt"></label>
        <label>Quelle<input name="source" list="sources" maxlength="120" placeholder="Wo gekauft?"></label>
        <label>Datum<input name="date" type="date" value="${today()}"></label>
        <label>Gesamtpreis der Ware<input name="total_price" inputmode="decimal" placeholder="0,00"></label>
        <label>Versand für alles<input name="shipping_cost" inputmode="decimal" placeholder="0,00"></label>
        <label>Notizen<input name="notes" maxlength="4000" placeholder="optional"></label>
      </div>
      <datalist id="sources">${SOURCES.map((s) => `<option value="${esc(s)}">`).join('')}</datalist>
      <details class="help"><summary>Wie wird verteilt?</summary>
        <ul>
          <li>Nur Gesamtpreis: wird gleichmäßig auf alle Teile verteilt.</li>
          <li>Gesamtpreis + einzelne Preise: Teile mit Preis behalten ihn, der Rest wird auf die ohne Preis verteilt.</li>
          <li>Alle Teile mit Preis: die Preise werden anteilig auf den Gesamtpreis angepasst (gut für „teure Jacke, billige Shirts“).</li>
          <li>Kein Gesamtpreis: jedes Teil kostet seinen Einzelpreis.</li>
          <li>Versand wird immer anteilig zum Einkaufspreis verteilt.</li>
        </ul>
      </details>
      <div class="haul-items-head"><h3>Artikel</h3><span class="muted small" id="haul-count"></span></div>
      <div id="haul-rows"></div>
      <div class="haul-add">
        <button type="button" class="btn" id="row-add">+ Artikel-Zeile</button>
        <button type="button" class="btn ghost" id="row-add5">+ 5 Zeilen</button>
      </div>
      <div class="haul-summary" id="haul-summary"></div>
      <p class="error" id="haul-error"></p>
    </form>
    <div class="modal-foot">
      <button class="btn" data-close>Abbrechen</button>
      <button class="btn primary" id="haul-save">Haul speichern</button>
    </div>`, { wide: true });

  const form = $('#haul-form', m);
  const rows = $('#haul-rows', m);

  const addRow = (focus = true) => {
    const prev = rows.lastElementChild;
    const row = document.createElement('div');
    row.className = 'haul-row';
    row.innerHTML = `
      <label class="img-mini" title="Bild hinzufügen"><span>＋ Bild</span><input type="file" accept="image/*" hidden></label>
      <label class="span2">Titel *<input data-k="title" maxlength="160" placeholder="z. B. Levi's 501 Jeans"></label>
      <label>Kategorie<select data-k="category">${options(CATEGORIES, prev ? $('[data-k=category]', prev).value : 'Kleidung')}</select></label>
      <label>Marke<input data-k="brand" maxlength="80"></label>
      <label>Größe<input data-k="size" maxlength="40"></label>
      <label>Zustand<select data-k="condition">${options(CONDITIONS, prev ? $('[data-k=condition]', prev).value : '', '–')}</select></label>
      <label>Einzelpreis<input data-k="price" inputmode="decimal" placeholder="optional"></label>
      <div class="row-cost"><span class="muted small">Kosten</span><b data-cost>–</b><span class="muted small" data-ship></span></div>
      <button type="button" class="icon-btn" data-remove aria-label="Zeile entfernen">✕</button>`;
    rows.append(row);
    $('[data-remove]', row).addEventListener('click', () => {
      if (rows.children.length === 1) { toast('Ein Haul braucht mindestens einen Artikel'); return; }
      rowImages.delete(row);
      row.remove();
      update();
    });
    $('input[type=file]', row).addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const data = await resizeImage(file, 1400);
        rowImages.set(row, data);
        const lbl = $('.img-mini', row);
        lbl.style.backgroundImage = `url("${data}")`;
        lbl.classList.add('has-img');
      } catch (ex) { toast(ex.message, 'err'); }
    });
    if (focus) $('[data-k=title]', row).focus();
    update();
  };

  const readHaul = (strict) => {
    const f = Object.fromEntries(new FormData(form));
    const safe = (v, label) => { try { return parseMoney(v, label); } catch (e) { if (strict) throw e; return null; } };
    return {
      name: f.name.trim(), source: f.source, date: f.date || null, notes: f.notes,
      total_price: safe(f.total_price, 'Gesamtpreis'),
      shipping_cost: safe(f.shipping_cost, 'Versand') || 0,
      items: [...rows.children].map((row, i) => {
        const g = (k) => $(`[data-k=${k}]`, row).value;
        return {
          row, title: g('title').trim(), category: g('category'), brand: g('brand'), size: g('size'), condition: g('condition'),
          purchase_input: safe(g('price'), `Einzelpreis in Zeile ${i + 1}`),
        };
      }),
    };
  };

  function update() {
    const h = readHaul(false);
    const alloc = allocateHaul(h, h.items.map((it) => ({ input: it.purchase_input })));
    h.items.forEach((it, i) => {
      const x = alloc.items[i];
      $('[data-cost]', it.row).textContent = fmtMoney(x.purchase_price + x.shipping_in);
      $('[data-ship]', it.row).textContent = x.shipping_in ? `inkl. ${fmtMoney(x.shipping_in)} Versand` : '';
    });
    const n = h.items.length;
    $('#haul-count', m).textContent = `${n} ${n === 1 ? 'Artikel' : 'Artikel'}`;
    const total = alloc.goods + h.shipping_cost;
    $('#haul-summary', m).innerHTML = `
      <div><span>Ware</span><b>${fmtMoney(alloc.goods)}</b></div>
      <div><span>Versand</span><b>${fmtMoney(h.shipping_cost)}</b></div>
      <div><span>Gesamt</span><b>${fmtMoney(total)}</b></div>
      <div><span>Ø pro Teil</span><b>${n ? fmtMoney(Math.round(total / n)) : '–'}</b></div>
      ${alloc.note ? `<p class="note">${esc(alloc.note)}</p>` : ''}`;
  }

  form.addEventListener('input', update);
  form.addEventListener('change', update);
  $('#row-add', m).addEventListener('click', () => addRow());
  $('#row-add5', m).addEventListener('click', () => { for (let i = 0; i < 5; i++) addRow(false); });
  // Enter im letzten Titelfeld legt eine neue Zeile an, statt abzuschicken.
  form.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.target.tagName !== 'INPUT') return;
    e.preventDefault();
    if (e.target.dataset.k === 'title' && e.target.closest('.haul-row') === rows.lastElementChild) addRow();
  });
  for (let i = 0; i < 3; i++) addRow(false);

  $('#haul-save', m).addEventListener('click', async () => {
    const err = $('#haul-error', m);
    err.textContent = '';
    try {
      const h = readHaul(true);
      if (!h.name) throw new Error('Bitte gib dem Haul einen Namen');
      const items = h.items.filter((it) => it.title || it.purchase_input !== null || rowImages.has(it.row));
      const untitled = items.findIndex((it) => !it.title);
      if (untitled >= 0) throw new Error(`Zeile ${h.items.indexOf(items[untitled]) + 1}: Titel fehlt`);
      if (!items.length) throw new Error('Trag mindestens einen Artikel ein');
      $('#haul-save', m).disabled = true;
      $('#haul-save', m).textContent = 'Speichert …';
      const { haul } = await api('POST', '/api/hauls', {
        name: h.name, source: h.source, date: h.date, notes: h.notes, total_price: h.total_price, shipping_cost: h.shipping_cost,
        items: items.map(({ row, ...it }) => ({ ...it, status: 'lager', image: rowImages.get(row) || null })),
      });
      await refresh();
      haulDetail(haul.id);
      toast(`Haul mit ${items.length} Artikeln angelegt`);
    } catch (ex) {
      err.textContent = ex.message;
      $('#haul-save', m).disabled = false;
      $('#haul-save', m).textContent = 'Haul speichern';
    }
  });
}

// ================================================================ Hauls

function haulStats(h) {
  const items = state.articles.filter((a) => a.haul_id === h.id);
  const s = computeStats(items);
  s.items = items;
  s.cost = s.invested;
  s.back = s.net + s.invested; // Netto-Erlöse
  return s;
}

function renderHauls(main) {
  if (!state.hauls.length) {
    main.innerHTML = `<div class="empty"><h3>Noch keine Hauls</h3><p>Ein Haul ist ein Einkauf mit mehreren Teilen, z. B. ein Vinted-Bundle oder ein Flohmarkt-Tag.</p>
      <div class="empty-actions"><button class="btn primary" id="e-haul">+ Haul hinzufügen</button></div></div>`;
    $('#e-haul').addEventListener('click', () => haulForm());
    return;
  }
  main.innerHTML = `<section class="haul-grid">${state.hauls.map((h) => {
    const s = haulStats(h);
    const pct = s.cost > 0 ? Math.min(100, Math.round((s.back / s.cost) * 100)) : 0;
    return `
    <button class="haul-card" data-id="${h.id}">
      <div class="haul-thumbs">${s.items.slice(0, 4).map((a) => thumb(a, 'mini')).join('')}</div>
      <h3>${esc(h.name)}</h3>
      <p class="muted small">${[fmtDate(h.date), h.source].filter((x) => x && x !== '–').map(esc).join(' · ')}</p>
      <div class="haul-nums">
        <div><span>Artikel</span><b>${s.sold}/${s.count} verkauft</b></div>
        <div><span>Kosten</span><b>${fmtMoney(s.cost)}</b></div>
        <div><span>Ergebnis</span><b class="${profitClass(s.net)}">${fmtMoney(s.net)}</b></div>
      </div>
      <div class="bar" title="${pct} % der Kosten wieder eingespielt"><i style="width:${pct}%"></i></div>
      <p class="muted small">${pct >= 100 ? 'Kosten wieder drin' : `${pct} % der Kosten wieder eingespielt`}</p>
    </button>`;
  }).join('')}</section>`;
  $$('.haul-card', main).forEach((c) => c.addEventListener('click', () => haulDetail(Number(c.dataset.id))));
}

function haulDetail(id) {
  const h = haulById(id);
  if (!h) return;
  const s = haulStats(h);
  const m = openModal(`
    ${modalHead(`Haul: ${esc(h.name)}`, [fmtDate(h.date), h.source, `${s.count} Artikel`].filter((x) => x && x !== '–').map(esc).join(' · '))}
    <div class="modal-body">
      <section class="stats compact">
        <div class="stat"><span>Kosten gesamt</span><strong>${fmtMoney(s.cost)}</strong><small>Ware ${fmtMoney(s.cost - h.shipping_cost)} · Versand ${fmtMoney(h.shipping_cost)}</small></div>
        <div class="stat"><span>Verkauft</span><strong>${s.sold}/${s.count}</strong><small>Umsatz ${fmtMoney(s.revenue)}</small></div>
        <div class="stat"><span>Gewinn realisiert</span><strong class="${profitClass(s.profit)}">${fmtMoney(s.profit)}</strong><small>nur verkaufte Teile</small></div>
        <div class="stat"><span>Ergebnis</span><strong class="${profitClass(s.net)}">${fmtMoney(s.net)}</strong><small>Erlöse minus Haul-Kosten</small></div>
      </section>
      <div class="haul-items-head"><h3>Artikel</h3><button class="btn small" id="h-add">+ Artikel zu diesem Haul</button></div>
      <div class="list">${s.items.length ? s.items.sort((a, b) => a.article_no - b.article_no).map(articleRow).join('') : '<p class="muted">Keine Artikel mehr in diesem Haul.</p>'}</div>
      <details class="edit-haul">
        <summary>Haul bearbeiten</summary>
        <form class="form" id="h-form">
          <div class="grid3">
            <label>Name *<input name="name" required maxlength="120" value="${esc(h.name)}"></label>
            <label>Quelle<input name="source" maxlength="120" value="${esc(h.source)}"></label>
            <label>Datum<input name="date" type="date" value="${esc(h.date || '')}"></label>
            <label>Gesamtpreis der Ware<input name="total_price" inputmode="decimal" value="${moneyValue(h.total_price)}" placeholder="leer = Summe der Einzelpreise"></label>
            <label>Versand für alles<input name="shipping_cost" inputmode="decimal" value="${moneyValue(h.shipping_cost || null)}" placeholder="0,00"></label>
            <label>Notizen<input name="notes" maxlength="4000" value="${esc(h.notes)}"></label>
          </div>
          <p class="error" id="h-error"></p>
          <div class="row-actions">
            <button class="btn primary" type="submit">Änderungen speichern</button>
            <span class="spacer"></span>
            <button class="btn ghost" type="button" id="h-dissolve">Haul auflösen</button>
            <button class="btn danger ghost" type="button" id="h-delete">Haul mit Artikeln löschen</button>
          </div>
        </form>
      </details>
    </div>`, { wide: true });

  $$('.row', m).forEach((r) => r.addEventListener('click', () => articleDetail(Number(r.dataset.id))));
  $('#h-add', m).addEventListener('click', () => articleForm(null, h.id));
  $('#h-form', m).addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    try {
      await api('PUT', `/api/hauls/${h.id}`, {
        name: f.name, source: f.source, date: f.date || null, notes: f.notes,
        total_price: parseMoney(f.total_price, 'Gesamtpreis'), shipping_cost: parseMoney(f.shipping_cost, 'Versand') || 0,
      });
      await refresh();
      haulDetail(h.id);
      toast('Haul gespeichert, Kosten neu verteilt');
    } catch (ex) { $('#h-error', m).textContent = ex.message; }
  });
  $('#h-dissolve', m).addEventListener('click', async () => {
    const ok = await confirmDialog('Haul auflösen?', `Der Haul „${esc(h.name)}“ wird entfernt. Die ${s.count} Artikel bleiben mit ihren aktuellen Kosten als Einzelartikel erhalten.`,
      [{ label: 'Abbrechen', value: false }, { label: 'Auflösen', value: true, kind: 'primary' }]);
    if (!ok) return haulDetail(h.id);
    await api('DELETE', `/api/hauls/${h.id}?mode=dissolve`);
    await refresh();
    toast('Haul aufgelöst');
  });
  $('#h-delete', m).addEventListener('click', async () => {
    const ok = await confirmDialog('Haul löschen?', `Der Haul „${esc(h.name)}“ und <b>alle ${s.count} Artikel</b> darin werden endgültig gelöscht, auch schon verkaufte.`,
      [{ label: 'Abbrechen', value: false }, { label: 'Endgültig löschen', value: true, kind: 'danger' }]);
    if (!ok) return haulDetail(h.id);
    await api('DELETE', `/api/hauls/${h.id}`);
    await refresh();
    toast('Haul gelöscht');
  });
}

// ================================================================ Konto

function renderAccount(main) {
  const u = state.user;
  main.innerHTML = `
  <section class="panel">
    <h2>Dein Konto</h2>
    <dl class="info"><div><dt>Name</dt><dd>${esc(u.name || '–')}</dd></div><div><dt>E-Mail</dt><dd>${esc(u.email)}</dd></div>
      <div><dt>Artikel</dt><dd>${state.articles.length}</dd></div><div><dt>Hauls</dt><dd>${state.hauls.length}</dd></div></dl>
    <div class="row-actions">
      <a class="btn" href="/api/export.csv">Alle Artikel als CSV exportieren</a>
      <button class="btn ghost" id="logout">Abmelden</button>
    </div>
  </section>
  <section class="panel">
    <h2>Passwort ändern</h2>
    <form class="form narrow" id="pw-form">
      <label>Aktuelles Passwort<input name="current" type="password" autocomplete="current-password" required></label>
      <label>Neues Passwort (min. 8 Zeichen)<input name="next" type="password" autocomplete="new-password" minlength="8" required></label>
      <p class="error" id="pw-error"></p>
      <button class="btn primary" type="submit">Passwort ändern</button>
    </form>
  </section>`;
  $('#logout').addEventListener('click', async () => {
    await api('POST', '/api/logout').catch(() => {});
    state.user = null;
    renderAuth();
  });
  $('#pw-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    try {
      await api('POST', '/api/password', f);
      e.target.reset();
      $('#pw-error').textContent = '';
      toast('Passwort geändert. Andere Geräte wurden abgemeldet.');
    } catch (ex) { $('#pw-error').textContent = ex.message; }
  });
}

// ================================================================ KI-Prompts

const PRICE_PLATFORMS = {
  'Kleidung': ['Vinted', 'eBay (verkaufte Artikel)', 'Kleinanzeigen', 'willhaben', 'Depop'],
  'Schuhe': ['Vinted', 'eBay (verkaufte Artikel)', 'Kleinanzeigen', 'willhaben'],
  'Sneaker': ['StockX', 'eBay (verkaufte Artikel)', 'Vinted', 'Kleinanzeigen', 'willhaben', 'Grailed'],
  'Taschen & Accessoires': ['Vestiaire Collective', 'Vinted', 'eBay (verkaufte Artikel)', 'Kleinanzeigen', 'willhaben'],
  'Schmuck & Uhren': ['Chrono24 (bei Uhren)', 'eBay (verkaufte Artikel)', 'Vestiaire Collective', 'Kleinanzeigen', 'willhaben'],
  'Elektronik': ['eBay (verkaufte Artikel)', 'Kleinanzeigen', 'willhaben', 'Shpock', 'Back Market / Rebuy (Ankaufspreis als Untergrenze)'],
  'Konsolen & Games': ['eBay (verkaufte Artikel)', 'Kleinanzeigen', 'willhaben', 'Rebuy / momox (Ankaufspreis als Untergrenze)', 'PriceCharting (Richtwert)'],
  'Sammelkarten': ['Cardmarket', 'eBay (verkaufte Artikel)', 'Kleinanzeigen', 'willhaben'],
  'Spielzeug & LEGO': ['eBay (verkaufte Artikel)', 'Kleinanzeigen', 'willhaben', 'BrickLink (bei LEGO)', 'Vinted'],
  'Bücher & Medien': ['eBay (verkaufte Artikel)', 'momox / Rebuy (Ankaufspreis als Untergrenze)', 'Kleinanzeigen', 'willhaben', 'Vinted'],
  'Möbel & Deko': ['Kleinanzeigen', 'willhaben', 'eBay (verkaufte Artikel)', 'Pamono / Etsy (bei Designklassikern)'],
  'Sport & Outdoor': ['eBay (verkaufte Artikel)', 'Kleinanzeigen', 'willhaben', 'Vinted'],
  'Vintage': ['Vinted', 'Depop', 'eBay (verkaufte Artikel)', 'Etsy', 'willhaben'],
};
const DEFAULT_PLATFORMS = ['eBay (verkaufte Artikel)', 'Kleinanzeigen', 'willhaben', 'Vinted', 'Shpock'];

function itemFacts(a) {
  return [
    ['Bezeichnung', a.title], ['Kategorie', a.category], ['Marke', a.brand], ['Größe', a.size],
    ['Farbe', a.color], ['Zustand', a.condition], ['Meine Notizen', a.notes],
  ].filter(([, v]) => v).map(([k, v]) => `- ${k}: ${v}`).join('\n');
}

function listingPrompt(a) {
  return `Du bist erfahrener Reseller und schreibst Inserate für Second-Hand-Plattformen im deutschsprachigen Raum (Vinted, eBay, Kleinanzeigen, willhaben).

Erstelle ein verkaufsstarkes Inserat auf Deutsch für diesen Artikel:
${itemFacts(a)}
${a.image ? '\nIch hänge ein Foto an. Nutze es für Details wie Material, Schnitt, Muster, Logos und sichtbare Mängel.\n' : ''}
Liefere:
1. eBay-Titel (max. 80 Zeichen, suchoptimiert: Marke, Modell, Größe, Farbe, wichtigste Merkmale)
2. Kurzer Titel für Vinted / Kleinanzeigen / willhaben (max. 50 Zeichen)
3. Beschreibung (80–150 Wörter): ehrlich, konkret, gut lesbar, mit Zustand, Besonderheiten, Größe/Passform und Hinweis auf Versand
4. Stichpunkte der wichtigsten Fakten zum schnellen Scannen
5. 8–12 Hashtags / Suchbegriffe für Vinted und Depop
6. Welche Maße oder Angaben ich noch ergänzen sollte, damit das Inserat besser verkauft

Wichtig: Erfinde keine Angaben (Material, Maße, Modellnummer, Echtheit), die nicht aus meinen Daten oder dem Foto hervorgehen. Fehlendes als [bitte ergänzen] markieren. Mängel nicht verschweigen, aber sachlich formulieren.`;
}

function pricePrompt(a) {
  const platforms = PRICE_PLATFORMS[a.category] || DEFAULT_PLATFORMS;
  const cost = costOf(a);
  return `Mach eine Preisanalyse für einen Artikel, den ich weiterverkaufen will. Markt: Deutschland und Österreich.

Artikel:
${itemFacts(a)}
- Mein Einkaufspreis inkl. Versand: ${fmtMoney(cost)}${a.listed_price !== null ? `\n- Aktuell angeboten für: ${fmtMoney(a.listed_price)}` : ''}
${a.image ? '\nFoto ist angehängt, nutze es, um Modell und Zustand genauer einzuordnen.\n' : ''}
Vorgehen:
- Recherchiere aktuelle Preise auf: ${platforms.join(', ')}.
- Nutze die Websuche, falls du sie hast. Unterscheide klar zwischen tatsächlich VERKAUFTEN Preisen und nur angebotenen Preisen.
- Berücksichtige Zustand und Größe beim Vergleich.
- Wenn du keinen Internetzugriff hast, sag das am Anfang deutlich und kennzeichne alle Zahlen als Schätzung. Erfinde keine konkreten Angebote oder Links.

Ergebnis:
1. Tabelle: Plattform | Preisspanne | typischer Verkaufspreis | Verkäufergebühren | Netto-Erlös für mich | Gewinn nach meinem Einkaufspreis
2. Welche Plattform für diesen Artikel am besten ist und warum
3. Drei Preise: Angebotspreis (Startpreis mit Verhandlungsspielraum), Mindestpreis (darunter nicht verkaufen), Schnellverkaufspreis
4. Wie schnell sich so ein Artikel ungefähr verkauft
5. 2–3 konkrete Tipps, um mehr rauszuholen (Fotos, Timing, Bundle, Saison)`;
}

function promptBlocks(a) {
  const blocks = [
    ['listing', 'Titel & Verkaufsbeschreibung', listingPrompt(a)],
    ['price', 'Preisanalyse über Plattformen', pricePrompt(a)],
  ];
  return blocks.map(([key, label, text]) => `
    <div class="prompt" data-prompt="${key}">
      <div class="prompt-head">
        <b>${label}</b>
        <div class="prompt-btns">
          <button class="btn small primary" data-copy>Kopieren</button>
          <a class="btn small" target="_blank" rel="noopener" href="https://chatgpt.com/?q=${encodeURIComponent(text)}">ChatGPT</a>
          <a class="btn small" target="_blank" rel="noopener" href="https://claude.ai/new?q=${encodeURIComponent(text)}">Claude</a>
        </div>
      </div>
      <textarea readonly rows="7">${esc(text)}</textarea>
    </div>`).join('');
}

function wirePrompts(root) {
  $$('.prompt', root).forEach((p) => {
    $('[data-copy]', p).addEventListener('click', () => copyText($('textarea', p).value));
  });
}

boot();
