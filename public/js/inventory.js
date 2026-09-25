// Inventar: Kennzahlen, Filter und Artikelliste.

import { CATEGORIES, STATUSES, profitOf, costOf, fmtMoney, fmtArticleNo, ageDays, ageLevel, isSold } from './shared.js';
import { state, haulById, hydrateImages } from './store.js';
import { $, $$, esc, profitClass, statusOptions, options } from './ui.js';
import { articleDetail, articleForm } from './article.js';
import { haulForm } from './haul.js';
import { labelPicker } from './labels.js';

export const filter = { q: '', status: '', category: '', special: '', sort: 'neu' };

export function computeStats(list) {
  const s = { count: list.length, stock: 0, stockValue: 0, sold: 0, revenue: 0, profit: 0, soldCost: 0, invested: 0, net: 0, stale: 0, staleValue: 0 };
  for (const a of list) {
    const cost = costOf(a);
    s.invested += cost;
    if (isSold(a)) {
      s.sold++;
      s.revenue += a.sale_price || 0;
      s.profit += profitOf(a) || 0;
      s.soldCost += cost;
      s.net += (a.sale_price || 0) - (a.sale_fees || 0) - (a.shipping_out || 0);
    } else {
      s.stock++;
      s.stockValue += cost;
      if (ageDays(a) >= 60) { s.stale++; s.staleValue += cost; }
    }
  }
  s.net -= s.invested;
  return s;
}

// Verkaufte Artikel, die noch auf anderen Plattformen online stehen.
export const needsDelisting = (a) => isSold(a) && a.listings?.length > 0;

function statsHtml(s) {
  const roi = s.soldCost > 0 ? Math.round((s.profit / s.soldCost) * 100) : null;
  return `
  <section class="stats">
    <div class="stat"><span>Auf Lager</span><strong>${s.stock}</strong><small>Warenwert ${fmtMoney(s.stockValue)}</small></div>
    <div class="stat"><span>Verkauft</span><strong>${s.sold}</strong><small>Umsatz ${fmtMoney(s.revenue)}</small></div>
    <div class="stat"><span>Gewinn realisiert</span><strong class="${profitClass(s.profit)}">${fmtMoney(s.profit)}</strong>
      <small>${s.sold === 0 ? 'noch nichts verkauft' : `${roi === null ? '' : `ROI ${roi} % · `}Ø ${fmtMoney(Math.round(s.profit / s.sold))}/Artikel`}</small></div>
    <button class="stat stat-btn" data-special="ladenhueter" ${s.stale ? '' : 'disabled'}>
      <span>Ladenhüter (60+ Tage)</span><strong>${s.stale}</strong><small>${s.stale ? `${fmtMoney(s.staleValue)} gebunden · anzeigen` : 'alles frisch'}</small>
    </button>
  </section>`;
}

export function renderInventory(main) {
  const f = filter;
  const delist = state.articles.filter(needsDelisting);
  const toShip = state.articles.filter((a) => a.status === 'verkauft');
  main.innerHTML = `
    ${statsHtml(computeStats(state.articles))}
    ${delist.length ? `<button class="banner warn" data-special="loeschen"><b>⚠ ${delist.length} verkaufte${delist.length === 1 ? 'r Artikel ist' : ' Artikel sind'} noch auf anderen Plattformen online.</b>
      <span>Dort löschen, sonst verkaufst du doppelt. Anzeigen →</span></button>` : ''}
    ${toShip.length ? `<button class="banner info" data-special="versenden"><b>📦 ${toShip.length} verkaufte${toShip.length === 1 ? 'r Artikel wartet' : ' Artikel warten'} auf den Versand.</b>
      <span>Anzeigen →</span></button>` : ''}
    <section class="toolbar">
      <input type="search" id="f-q" placeholder="Suchen: Titel, Marke, Nr, Käufer, Sendungsnr …" value="${esc(f.q)}">
      <select id="f-status"><option value="">Alle Status</option>${statusOptions(f.status)}</select>
      <select id="f-category">${options(CATEGORIES, f.category, 'Alle Kategorien')}</select>
      <select id="f-special">
        ${[['', 'Kein Sonderfilter'], ['versenden', 'Noch versenden'], ['unterwegs', 'Unterwegs (versendet)'], ['ladenhueter', 'Ladenhüter (60+ Tage)'], ['loeschen', 'Noch woanders löschen'], ['ohne-bild', 'Ohne Foto'], ['ohne-preis', 'Ohne Angebotspreis']]
          .map(([k, v]) => `<option value="${k}"${k === f.special ? ' selected' : ''}>${v}</option>`).join('')}
      </select>
      <select id="f-sort">
        ${[['neu', 'Neueste zuerst'], ['alt', 'Älteste zuerst'], ['lagerdauer', 'Längste Lagerdauer'], ['gewinn', 'Höchster Gewinn'], ['ek', 'Höchster Einkauf'], ['titel', 'Titel A–Z']]
          .map(([k, v]) => `<option value="${k}"${k === f.sort ? ' selected' : ''}>${v}</option>`).join('')}
      </select>
      <button class="btn" id="labels">QR-Etiketten</button>
    </section>
    <p class="muted small" id="list-count"></p>
    <section id="list" class="list"></section>`;
  const bind = (id, key, ev = 'change') => $(id).addEventListener(ev, (e) => { f[key] = e.target.value; renderList(); });
  bind('#f-q', 'q', 'input');
  bind('#f-status', 'status');
  bind('#f-category', 'category');
  bind('#f-special', 'special');
  bind('#f-sort', 'sort');
  $$('[data-special]', main).forEach((b) => b.addEventListener('click', () => {
    f.special = b.dataset.special;
    f.status = '';
    if (f.special === 'ladenhueter') f.sort = 'lagerdauer';
    renderInventory(main);
  }));
  $('#labels').addEventListener('click', () => labelPicker());
  renderList();
}

function filteredArticles() {
  const f = filter;
  const q = f.q.trim().toLowerCase().replace(/^#0*/, '');
  const special = {
    '': () => true,
    ladenhueter: (a) => !isSold(a) && ageDays(a) >= 60,
    loeschen: needsDelisting,
    versenden: (a) => a.status === 'verkauft',
    unterwegs: (a) => a.status === 'versendet',
    'ohne-bild': (a) => !a.images?.length,
    'ohne-preis': (a) => !isSold(a) && a.listed_price === null,
  }[f.special] || (() => true);
  const list = state.articles.filter((a) =>
    (!f.status || a.status === f.status) &&
    (!f.category || a.category === f.category) &&
    special(a) &&
    (!q || `${a.title} ${a.brand} ${a.size} ${a.color} ${a.notes} ${a.location} ${a.buyer} ${a.tracking_number} ${a.article_no}`.toLowerCase().includes(q)));
  const age = (a) => (isSold(a) ? -1 : ageDays(a));
  const by = {
    neu: (a, b) => b.article_no - a.article_no,
    alt: (a, b) => a.article_no - b.article_no,
    lagerdauer: (a, b) => age(b) - age(a),
    gewinn: (a, b) => (profitOf(b) ?? -Infinity) - (profitOf(a) ?? -Infinity),
    ek: (a, b) => costOf(b) - costOf(a),
    titel: (a, b) => a.title.localeCompare(b.title, 'de'),
  }[f.sort];
  return list.sort(by);
}

export function thumb(a, cls = 'thumb') {
  return a.images?.length
    ? `<img class="${cls}" data-img="${esc(a.images[0])}" data-thumb alt="" loading="lazy">`
    : `<div class="${cls} placeholder">${esc(a.category.slice(0, 2))}</div>`;
}

const AGE_LABEL = ['', 'seit', 'Ladenhüter', 'Ladenhüter'];

export function ageChip(a) {
  if (isSold(a)) return '';
  const d = ageDays(a);
  const lvl = ageLevel(d);
  if (lvl === 0) return `<span class="age">${d} T.</span>`;
  return `<span class="age lvl${lvl}" title="${d} Tage auf Lager">${lvl >= 2 ? '⏳ ' : ''}${AGE_LABEL[lvl]} ${d} T.</span>`;
}

export function articleRow(a) {
  const p = profitOf(a);
  const haul = a.haul_id ? haulById(a.haul_id) : null;
  const meta = [a.category, a.brand, a.size && `Gr. ${a.size}`, a.location && `📦 ${a.location}`, haul && `Haul: ${haul.name}`]
    .filter(Boolean).map(esc).join(' · ');
  const online = !isSold(a) && a.listings?.length ? `<span class="chips-mini">${a.listings.map((l) => `<i>${esc(l)}</i>`).join('')}</span>` : '';
  const delist = needsDelisting(a) ? `<span class="age lvl3">⚠ noch auf ${a.listings.map(esc).join(', ')} löschen</span>` : '';
  const ship = a.status === 'verkauft' ? `<span class="age ship">📦 noch versenden${a.buyer ? ` an ${esc(a.buyer)}` : ''}</span>`
    : a.status === 'versendet' ? `<span class="age">unterwegs${a.buyer ? ` zu ${esc(a.buyer)}` : ''}</span>` : '';
  return `
  <button class="row" data-id="${a.id}">
    ${thumb(a)}
    <div class="row-main">
      <div class="row-title"><span class="no">${fmtArticleNo(a.article_no)}</span>${esc(a.title)}</div>
      <div class="row-meta">${meta}</div>
      <div class="row-tags">${ageChip(a)}${online}${ship}${delist}</div>
    </div>
    <div class="row-nums">
      <div><span>EK</span>${fmtMoney(costOf(a))}</div>
      <div><span>${isSold(a) ? 'VK' : 'Preis'}</span>${fmtMoney(isSold(a) ? a.sale_price : a.listed_price)}</div>
      <div><span>Gewinn</span><b class="${profitClass(p)}">${fmtMoney(p)}</b></div>
    </div>
    <span class="badge ${a.status}">${STATUSES[a.status]}</span>
  </button>`;
}

function renderList() {
  const el = $('#list');
  if (!el) return;
  if (state.articles.length === 0) {
    $('#list-count').textContent = '';
    el.innerHTML = `<div class="empty"><h3>Noch keine Artikel</h3>
      <p>Mehrere Teile auf einmal gekauft? Dann nimm <b>„+ Haul hinzufügen“</b>. Dort verteilst du Gesamtpreis und Versand automatisch auf alle Teile.</p>
      <div class="empty-actions"><button class="btn primary" data-empty="haul">+ Haul hinzufügen</button><button class="btn" data-empty="article">+ Einzelnen Artikel</button></div></div>`;
    $('[data-empty=haul]', el).addEventListener('click', () => haulForm());
    $('[data-empty=article]', el).addEventListener('click', () => articleForm());
    return;
  }
  const list = filteredArticles();
  const filtered = list.length !== state.articles.length;
  $('#list-count').innerHTML = filtered
    ? `${list.length} von ${state.articles.length} Artikeln · <button class="linkish" id="reset-filter">Filter zurücksetzen</button>`
    : `${list.length} Artikel`;
  $('#reset-filter')?.addEventListener('click', () => {
    Object.assign(filter, { q: '', status: '', category: '', special: '', sort: 'neu' });
    renderInventory($('#main'));
  });
  el.innerHTML = list.length ? list.map(articleRow).join('') : '<p class="muted center">Keine Artikel für diesen Filter.</p>';
  $$('.row', el).forEach((r) => r.addEventListener('click', () => articleDetail(Number(r.dataset.id))));
  hydrateImages(el);
}
