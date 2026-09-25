// Artikel: Detailansicht, Formular, Verkauf, Crosslisting und Fotos.

import {
  CATEGORIES, CONDITIONS, STATUSES, PLATFORMS, ONLINE_PLATFORMS,
  profitOf, costOf, extraOf, fmtMoney, fmtArticleNo, ageDays, ageLevel, isSold, SOLD_STATUSES,
} from './shared.js';
import {
  state, articleById, haulById, articlePayload, createArticle, updateArticle, deleteArticle as removeArticle,
  uploadImage, removeImages, unusedImages, hydrateImages, imageUrl,
} from './store.js';
import {
  $, $$, esc, toast, parseMoney, moneyValue, today, fmtDate, options, statusOptions, profitClass,
  openModal, modalHead, confirmDialog, guard, copyText,
} from './ui.js';
import { refresh } from './app.js';
import { haulDetail } from './haul.js';
import { promptBlocks, wirePrompts } from './prompts.js';
import { printLabels } from './labels.js';

const MAX_IMAGES = 12;

// ================================================================ Detail

export function articleDetail(id) {
  const a = articleById(id);
  if (!a) { toast('Artikel nicht gefunden', 'err'); return; }
  const haul = a.haul_id ? haulById(a.haul_id) : null;
  const days = ageDays(a);
  const info = [
    ['Kategorie', a.category], ['Marke', a.brand], ['Größe', a.size], ['Farbe', a.color], ['Zustand', a.condition],
    ['Lagerort', a.location], ['Eingekauft am', fmtDate(a.purchase_date)],
    [isSold(a) ? 'Verkauft nach' : 'Auf Lager seit', `${days} Tagen`],
  ].filter(([, v]) => v).map(([k, v]) => `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join('');

  const imgs = a.images || [];
  const m = openModal(`
    ${modalHead(`<span class="no">${fmtArticleNo(a.article_no)}</span> ${esc(a.title)}`,
      `<span class="badge ${a.status}">${STATUSES[a.status]}</span>${haul ? ` · Haul <a href="#" data-haul="${haul.id}">${esc(haul.name)}</a>` : ''}`)}
    <div class="modal-body">
      <div class="detail">
        <div class="detail-img">
          ${imgs.length ? `<img id="main-img" data-img="${esc(imgs[0])}" alt="${esc(a.title)}">` : '<div class="img-empty">Noch kein Foto</div>'}
          <div class="strip">
            ${imgs.map((path, i) => `<button class="strip-btn${i === 0 ? ' active' : ''}" data-path="${esc(path)}"><img data-img="${esc(path)}" data-thumb alt=""></button>`).join('')}
            ${imgs.length < MAX_IMAGES ? `<label class="strip-add" title="Foto hinzufügen">＋<input type="file" accept="image/*" multiple hidden id="quick-img"></label>` : ''}
          </div>
        </div>
        <div>
          <dl class="info">${info}</dl>
          ${calcTable(a, haul)}
          <div class="extras">
            <button class="btn small" id="x-toggle" type="button">+ Zusatzkosten</button>
            <form class="x-form" id="x-form" hidden>
              <label>Betrag<input name="amount" inputmode="decimal" placeholder="0,00" required></label>
              <label class="grow">Info<input name="note" maxlength="120" placeholder="z. B. Reinigung, neuer Reißverschluss"></label>
              <button class="btn small primary" type="submit">Hinzufügen</button>
            </form>
          </div>
          ${a.notes ? `<p class="notes">${esc(a.notes)}</p>` : ''}
        </div>
      </div>
      ${staleAdvice(a)}
      ${trackSection(a)}
      ${listingSection(a)}
      <div class="detail-actions">
        ${!isSold(a) ? '<button class="btn primary" id="d-sell">Als verkauft markieren</button>' : '<button class="btn" id="d-sell">Verkauf bearbeiten</button>'}
        <button class="btn" id="d-edit">Bearbeiten</button>
        <button class="btn" id="d-copy">Kopieren</button>
        <button class="btn" id="d-label">QR-Etikett</button>
        <button class="btn danger ghost" id="d-del">Löschen</button>
      </div>
      <h3 class="section-title">KI-Prompts</h3>
      <p class="muted small">Kopieren und in ChatGPT, Claude oder Gemini einfügen. Fotos am besten mit anhängen${imgs.length ? ' (Foto antippen, dann lange drücken zum Sichern)' : ''}.
      Für die Preisanalyse eine KI mit Websuche nehmen, sonst sind die Zahlen geraten.</p>
      ${promptBlocks(a)}
    </div>`, { wide: true });

  hydrateImages(m);
  $$('.strip-btn', m).forEach((b) => b.addEventListener('click', () => {
    const img = $('#main-img', m);
    img.dataset.img = b.dataset.path;
    img.src = imageUrl(b.dataset.path) || '';
    hydrateImages(m);
    $$('.strip-btn', m).forEach((x) => x.classList.toggle('active', x === b));
  }));
  $('#main-img', m)?.addEventListener('click', (e) => { if (e.target.src) window.open(e.target.src, '_blank', 'noopener'); });
  $('[data-haul]', m)?.addEventListener('click', (e) => { e.preventDefault(); haulDetail(haul.id); });
  $('#d-sell', m).addEventListener('click', () => sellForm(a));
  $('#t-ship', m)?.addEventListener('click', () => shipForm(a));
  $('#t-done', m)?.addEventListener('click', () => quickUpdate(a, { status: 'abgeschlossen', completed_at: today() }, 'Abgeschlossen: angekommen und akzeptiert'));
  $('#t-back', m)?.addEventListener('click', () => {
    const prev = a.status === 'abgeschlossen' ? 'versendet' : 'verkauft';
    quickUpdate(a, { status: prev }, `Zurück auf „${STATUSES[prev]}“`);
  });
  $('#t-copy', m)?.addEventListener('click', () => copyText(a.tracking_number, 'Sendungsnummer kopiert'));
  $('#d-edit', m).addEventListener('click', () => articleForm(a));
  $('#d-copy', m).addEventListener('click', () => articleForm(null, null, a));
  $('#d-label', m).addEventListener('click', () => printLabels([a]));
  $('#d-del', m).addEventListener('click', () => deleteArticle(a));
  $('#quick-img', m)?.addEventListener('change', (e) => addPhotos(a, [...e.target.files]));
  $$('[data-listing]', m).forEach((b) => b.addEventListener('click', () => toggleListing(a, b.dataset.listing)));
  $$('[data-delisted]', m).forEach((b) => b.addEventListener('click', () => markDelisted(a, b.dataset.delisted)));
  $('#x-toggle', m).addEventListener('click', () => {
    const f = $('#x-form', m);
    f.hidden = !f.hidden;
    if (!f.hidden) f.amount.focus();
  });
  $('#x-form', m).addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    let amount;
    try { amount = parseMoney(f.amount.value, 'Betrag'); } catch (ex) { toast(ex.message, 'err'); return; }
    if (!amount) { toast('Bitte einen Betrag eintragen', 'err'); return; }
    await quickUpdate(a, { extra_costs: [...(a.extra_costs || []), { amount, note: f.note.value.trim().slice(0, 120) }] }, 'Zusatzkosten hinzugefügt');
  });
  $$('[data-x-del]', m).forEach((b) => b.addEventListener('click', () => {
    const i = Number(b.dataset.xDel);
    const x = a.extra_costs[i];
    quickUpdate(a, { extra_costs: a.extra_costs.filter((_, j) => j !== i) }, `${fmtMoney(x.amount)} ${x.note || 'Zusatzkosten'} entfernt`);
  }));
  $('#stale-price', m)?.addEventListener('click', (e) => quickUpdate(a, { listed_price: Number(e.target.dataset.price) }, 'Preis gesenkt'));
  wirePrompts(m);
}

// Die Rechnung des Artikels: Kosten, und falls verkauft, was davon übrig bleibt.
function calcTable(a, haul) {
  const cost = costOf(a);
  const row = (op, label, value, note = '', cls = '') =>
    `<tr class="${cls}"><td class="op">${op}</td><th>${label}</th><td class="val">${value}</td><td class="note">${note}</td></tr>`;
  const extras = a.extra_costs || [];
  let html = row('', 'Einkaufspreis', fmtMoney(a.purchase_price), haul && a.purchase_input === null ? 'anteilig aus Haul' : '');
  html += row('+', 'Versand Einkauf', fmtMoney(a.shipping_in), haul ? 'anteilig aus Haul' : '');
  extras.forEach((x, i) => {
    html += row('+', esc(x.note || 'Zusatzkosten'), fmtMoney(x.amount),
      `<button class="icon-btn small-x" data-x-del="${i}" aria-label="${esc(x.note || 'Zusatzkosten')} entfernen" title="Entfernen">✕</button>`, 'extra');
  });
  html += row('=', 'Kosten gesamt', `<b>${fmtMoney(cost)}</b>`, extras.length ? `davon ${fmtMoney(extraOf(a))} Zusatzkosten` : '', 'sum');
  if (isSold(a)) {
    const p = profitOf(a);
    const margin = a.sale_price ? Math.round((p / a.sale_price) * 100) : null;
    html += row('', 'Verkaufspreis', fmtMoney(a.sale_price), esc([a.sale_platform, fmtDate(a.sale_date)].filter(Boolean).join(' · ')), 'gap');
    if (a.sale_fees) html += row('−', 'Gebühren', fmtMoney(a.sale_fees));
    if (a.shipping_out) html += row('−', 'Versand Verkauf', fmtMoney(a.shipping_out));
    html += row('−', 'Kosten gesamt', fmtMoney(cost));
    html += row('=', 'Gewinn', `<b class="${profitClass(p)}">${fmtMoney(p)}</b>`, margin !== null ? `Marge ${margin} %` : '', 'sum');
  } else if (a.listed_price !== null) {
    html += row('', 'Angebotspreis', fmtMoney(a.listed_price), `möglicher Gewinn ${fmtMoney(a.listed_price - cost)} vor Gebühren`, 'gap');
  }
  return `<table class="money calc">${html}</table>`;
}

// Verlauf nach dem Verkauf: Verkauft → Versendet → Angekommen & akzeptiert.
function trackSection(a) {
  if (!isSold(a)) return '';
  const step = SOLD_STATUSES.indexOf(a.status);
  const cls = (i) => (i < step ? 'done' : i === step ? 'done current' : '');
  const sold = [fmtDate(a.sale_date), a.buyer && `an ${esc(a.buyer)}`].filter(Boolean).join(' · ');
  const shipped = step >= 1 ? [fmtDate(a.shipped_at), a.tracking_number && `<span class="mono">${esc(a.tracking_number)}</span>
      <button class="linkish" id="t-copy" type="button">kopieren</button>`].filter(Boolean).join(' · ') : 'noch nicht';
  const done = step >= 2 ? fmtDate(a.completed_at) || 'ja' : 'noch nicht';
  const next = [
    '<button class="btn primary" id="t-ship">Als versendet markieren</button>',
    '<button class="btn primary" id="t-done">Angekommen &amp; akzeptiert</button><button class="btn" id="t-ship">Versand bearbeiten</button>',
    '<button class="btn" id="t-ship">Versand bearbeiten</button>',
  ][step];
  return `<div class="track">
    <ol class="track-steps">
      <li class="${cls(0)}"><b>Verkauft</b><small>${sold || '&nbsp;'}</small></li>
      <li class="${cls(1)}"><b>Versendet</b><small>${shipped}</small></li>
      <li class="${cls(2)}"><b>Angekommen &amp; akzeptiert</b><small>${done}</small></li>
    </ol>
    <div class="row-actions">${next}${step > 0 ? '<button class="btn ghost small" id="t-back">Schritt zurück</button>' : ''}</div>
  </div>`;
}

function shipForm(a) {
  const m = openModal(`
    ${modalHead(a.status === 'verkauft' ? 'Als versendet markieren' : 'Versand bearbeiten', `${esc(fmtArticleNo(a.article_no))} ${esc(a.title)}${a.buyer ? ` · an ${esc(a.buyer)}` : ''}`)}
    <form class="modal-body form" id="ship-form">
      <div class="grid2">
        <label>Versendet am<input name="shipped_at" type="date" value="${esc(a.shipped_at || today())}"></label>
        <label>Sendungsnummer (optional)<input name="tracking_number" maxlength="80" value="${esc(a.tracking_number)}" placeholder="z. B. RR123456789AT" autocomplete="off" autocapitalize="characters"></label>
        ${a.buyer ? '' : '<label>Käufer (optional)<input name="buyer" maxlength="120" placeholder="Name oder Nutzername" autocomplete="off"></label>'}
      </div>
      <p class="error" id="ship-error"></p>
    </form>
    <div class="modal-foot">
      <button class="btn" data-close>Abbrechen</button>
      <button class="btn primary" id="ship-save">Speichern</button>
    </div>`);
  const form = $('#ship-form', m);
  const save = async () => {
    const f = Object.fromEntries(new FormData(form));
    await quickUpdate(a, {
      status: a.status === 'verkauft' ? 'versendet' : a.status,
      shipped_at: f.shipped_at || today(),
      tracking_number: f.tracking_number.trim(),
      ...(f.buyer !== undefined ? { buyer: f.buyer.trim() } : {}),
    }, a.status === 'verkauft' ? 'Als versendet markiert' : 'Versand gespeichert');
  };
  form.addEventListener('submit', (e) => { e.preventDefault(); save(); });
  $('#ship-save', m).addEventListener('click', save);
}

function staleAdvice(a) {
  if (isSold(a)) return '';
  const days = ageDays(a);
  const lvl = ageLevel(days);
  if (lvl === 0) return '';
  const cost = costOf(a);
  let text;
  let action = '';
  if (lvl === 1) {
    text = `Seit ${days} Tagen auf Lager. Frische das Inserat auf: neue Fotos, Titel überarbeiten oder neu einstellen, damit es wieder oben landet.`;
  } else {
    const pct = lvl === 2 ? 10 : 20;
    text = `Seit ${days} Tagen auf Lager, das ist ein Ladenhüter.${lvl === 3 ? ' Überleg dir auch ein Bundle oder eine andere Plattform.' : ''}`;
    if (a.listed_price) {
      const next = Math.round((a.listed_price * (100 - pct)) / 100 / 50) * 50; // auf 50 Cent runden
      const below = next < cost;
      text += ` Vorschlag: Preis um ${pct} % auf ${fmtMoney(next)} senken.${below ? ` Achtung, das ist unter deinen Kosten von ${fmtMoney(cost)}. Verlust, aber das Geld ist nicht mehr gebunden.` : ''}`;
      action = `<button class="btn small" id="stale-price" data-price="${next}">Preis auf ${fmtMoney(next)} senken</button>`;
    } else {
      text += ' Trag einen Angebotspreis ein, dann gibt es hier einen Vorschlag zur Preissenkung.';
    }
  }
  return `<div class="advice lvl${lvl}"><p>${lvl >= 2 ? '⏳ ' : ''}${esc(text)}</p>${action}</div>`;
}

function listingSection(a) {
  if (isSold(a)) {
    if (!a.listings?.length) return '';
    return `<div class="listings warn"><b>⚠ Noch online auf:</b> Dort löschen und hier abhaken.
      <div class="chips">${a.listings.map((l) => `<button class="chip" data-delisted="${esc(l)}">${esc(l)} ✓ gelöscht</button>`).join('')}</div></div>`;
  }
  const on = new Set(a.listings || []);
  return `<div class="listings"><b>Online auf:</b> <span class="muted small">antippen, wo der Artikel inseriert ist</span>
    <div class="chips">${ONLINE_PLATFORMS.map((p) => `<button class="chip${on.has(p) ? ' on' : ''}" data-listing="${esc(p)}" aria-pressed="${on.has(p)}">${esc(p)}</button>`).join('')}</div></div>`;
}

async function toggleListing(a, platform) {
  const set = new Set(a.listings || []);
  if (set.has(platform)) set.delete(platform); else set.add(platform);
  const listings = ONLINE_PLATFORMS.filter((p) => set.has(p));
  let status = a.status;
  if (status === 'lager' && listings.length) status = 'gelistet';
  if (status === 'gelistet' && !listings.length) status = 'lager';
  await quickUpdate(a, { listings, status });
}

async function markDelisted(a, platform) {
  await quickUpdate(a, { listings: a.listings.filter((l) => l !== platform) }, `Auf ${platform} als gelöscht markiert`);
}

async function quickUpdate(a, changes, msg) {
  await guard(async () => {
    await updateArticle(a.id, { ...articlePayload(a), ...changes });
    await refresh();
    articleDetail(a.id);
    if (msg) toast(msg);
  });
}

async function addPhotos(a, files) {
  const room = MAX_IMAGES - (a.images?.length || 0);
  if (files.length > room) toast(`Maximal ${MAX_IMAGES} Fotos, ${files.length - room} ignoriert`);
  const added = [];
  await guard(async () => {
    toast('Lädt Fotos hoch …');
    for (const f of files.slice(0, room)) added.push(await uploadImage(f));
    await updateArticle(a.id, { ...articlePayload(a), images: [...(a.images || []), ...added] });
    await refresh();
    articleDetail(a.id);
    toast(added.length === 1 ? 'Foto gespeichert' : `${added.length} Fotos gespeichert`);
    return true;
  }) ?? (await removeImages(added));
}

async function deleteArticle(a) {
  const extra = a.haul_id ? '<br><br>Der Artikel gehört zu einem Haul. Dessen Gesamtpreis wird danach auf die übrigen Teile verteilt.' : '';
  const ok = await confirmDialog('Artikel löschen?', `${esc(fmtArticleNo(a.article_no))} „${esc(a.title)}“ wird endgültig gelöscht, samt Fotos. Die Nummer wird nicht neu vergeben.${extra}`,
    [{ label: 'Abbrechen', value: false }, { label: 'Löschen', value: true, kind: 'danger' }]);
  if (!ok) return articleDetail(a.id);
  await guard(async () => {
    await removeArticle(a);
    await refresh();
    toast('Artikel gelöscht');
  });
}

// ================================================================ Verkauf

function sellForm(a) {
  const m = openModal(`
    ${modalHead('Verkauf eintragen', `${esc(fmtArticleNo(a.article_no))} ${esc(a.title)} · Kosten ${fmtMoney(costOf(a))}`)}
    <form class="modal-body form" id="sell-form">
      <div class="grid2">
        <label>Verkaufspreis *<input name="sale_price" inputmode="decimal" required value="${moneyValue(a.sale_price ?? a.listed_price)}" placeholder="0,00"></label>
        <label>Verkauft am<input name="sale_date" type="date" value="${esc(a.sale_date || today())}"></label>
        <label>Plattform<select name="sale_platform">${options(PLATFORMS, a.sale_platform || (a.listings?.length === 1 ? a.listings[0] : ''), '–')}</select></label>
        <label>Käufer (optional)<input name="buyer" maxlength="120" value="${esc(a.buyer)}" placeholder="Name oder Nutzername" autocomplete="off"></label>
        <label>Gebühren<input name="sale_fees" inputmode="decimal" value="${moneyValue(a.sale_fees || null)}" placeholder="0,00"></label>
        <label>Versand (von dir bezahlt)<input name="shipping_out" inputmode="decimal" value="${moneyValue(a.shipping_out || null)}" placeholder="0,00"></label>
      </div>
      <p class="preview" id="sell-preview"></p>
      <p class="error" id="sell-error"></p>
    </form>
    <div class="modal-foot">
      ${isSold(a) ? '<button class="btn ghost" id="unsell">Verkauf zurücknehmen</button>' : ''}
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
      buyer: f.buyer.trim(),
    };
  };
  const preview = () => {
    try {
      const v = read();
      const others = (a.listings || []).filter((l) => l !== v.sale_platform);
      const pr = v.sale_price === null ? '' : `Gewinn: <b class="${profitClass(v.sale_price - costOf(a) - v.sale_fees - v.shipping_out)}">${fmtMoney(v.sale_price - costOf(a) - v.sale_fees - v.shipping_out)}</b>`;
      $('#sell-preview', m).innerHTML = pr + (others.length && !isSold(a) ? `<br><span class="small">Danach noch löschen auf: <b>${others.map(esc).join(', ')}</b></span>` : '');
    } catch { $('#sell-preview', m).textContent = ''; }
  };
  form.addEventListener('input', preview);
  form.addEventListener('change', preview);
  preview();
  const save = async () => {
    try {
      const v = read();
      if (v.sale_price === null) throw new Error('Bitte einen Verkaufspreis eintragen');
      const listings = (a.listings || []).filter((l) => l !== v.sale_platform);
      await updateArticle(a.id, { ...articlePayload(a), ...v, listings, status: isSold(a) ? a.status : 'verkauft' });
      await refresh();
      articleDetail(a.id);
      toast(listings.length ? `Gespeichert. Jetzt noch auf ${listings.join(', ')} löschen!` : 'Verkauf gespeichert');
    } catch (ex) { $('#sell-error', m).textContent = ex.message; }
  };
  form.addEventListener('submit', (e) => { e.preventDefault(); save(); });
  $('#sell-save', m).addEventListener('click', save);
  $('#unsell', m)?.addEventListener('click', () => quickUpdate(a, { status: a.listings?.length ? 'gelistet' : 'lager' }, 'Verkauf zurückgenommen'));
}

// ================================================================ Formular

// a = bestehender Artikel (bearbeiten), template = Artikel als Vorlage (kopieren)
export function articleForm(a = null, presetHaulId = null, template = null) {
  const haulId = a ? a.haul_id : template ? template.haul_id : presetHaulId;
  const haul = haulId ? haulById(haulId) : null;
  const v = a || (template
    ? { ...template, status: 'lager', listings: [], sale_price: null, sale_date: null, sale_platform: '', sale_fees: 0, shipping_out: 0 }
    : { category: 'Kleidung', status: 'lager', purchase_date: haul?.date || today(), images: [], listings: [] });
  const gallery = (v.images || []).map((path) => ({ path }));
  const removed = [];

  const m = openModal(`
    ${modalHead(a ? `Artikel ${fmtArticleNo(a.article_no)} bearbeiten` : template ? `Kopie von ${fmtArticleNo(template.article_no)}` : 'Neuer Artikel',
      [haul && `Teil von Haul „${esc(haul.name)}“`, !a && 'Jede Kopie bekommt eine eigene Artikelnummer.'].filter(Boolean).join(' · '))}
    <form class="modal-body form" id="art-form">
      <label>Titel / Bezeichnung *<input name="title" required maxlength="160" value="${esc(v.title)}" placeholder="z. B. Nike Air Max 90 weiß"></label>
      <div class="grid3">
        <label>Kategorie<select name="category">${options(CATEGORIES, v.category)}</select></label>
        <label>Marke<input name="brand" maxlength="80" value="${esc(v.brand)}"></label>
        <label>Größe<input name="size" maxlength="40" value="${esc(v.size)}"></label>
        <label>Farbe<input name="color" maxlength="40" value="${esc(v.color)}"></label>
        <label>Zustand<select name="condition">${options(CONDITIONS, v.condition, '–')}</select></label>
        <label>Lagerort<input name="location" maxlength="60" value="${esc(v.location)}" placeholder="z. B. Box 3" list="locations"></label>
      </div>
      <datalist id="locations">${[...new Set(state.articles.map((x) => x.location).filter(Boolean))].map((l) => `<option value="${esc(l)}">`).join('')}</datalist>
      <fieldset>
        <legend>Fotos</legend>
        <div class="gallery" id="gallery"></div>
        <p class="muted small">Das erste Foto ist das Titelbild. Mit ★ machst du ein anderes zum Titelbild.</p>
      </fieldset>
      <fieldset>
        <legend>Einkauf</legend>
        <div class="grid3">
          <label>${haul ? 'Einzelpreis (optional)' : 'Einkaufspreis'}<input name="purchase_input" inputmode="decimal" value="${moneyValue(v.purchase_input)}" placeholder="${haul ? 'leer = anteilig' : '0,00'}"></label>
          ${haul
            ? `<label>Versand Einkauf<input disabled value="${a ? moneyValue(a.shipping_in) : ''}" placeholder="anteilig aus Haul"></label>`
            : `<label>Versand Einkauf<input name="shipping_in" inputmode="decimal" value="${moneyValue(v.shipping_in || null)}" placeholder="0,00"></label>`}
          <label>Eingekauft am<input name="purchase_date" type="date" value="${esc(v.purchase_date || '')}"></label>
          ${a ? '' : `<label>Anzahl (gleiche Artikel)<input name="qty" type="number" inputmode="numeric" min="1" max="50" value="1"></label>`}
        </div>
        ${haul ? '<p class="muted small">Ohne Einzelpreis bekommt der Artikel seinen Anteil vom Gesamtpreis des Hauls. Der Versand wird immer anteilig verteilt.</p>' : ''}
      </fieldset>
      <fieldset>
        <legend>Zusatzkosten</legend>
        <div class="x-rows" id="x-rows"></div>
        <button type="button" class="btn small" id="x-row-add">+ Zusatzkosten</button>
        <p class="muted small">Alles, was nach dem Einkauf noch für diesen Artikel anfällt, z. B. Reinigung, Reparatur, Ersatzteile. Zählt zu den Kosten.</p>
      </fieldset>
      <fieldset>
        <legend>Verkauf</legend>
        <div class="grid3">
          <label>Status<select name="status">${statusOptions(v.status)}</select></label>
          <label>Angebotspreis<input name="listed_price" inputmode="decimal" value="${moneyValue(v.listed_price)}" placeholder="0,00"></label>
        </div>
        <div class="grid3 sold-only">
          <label>Verkaufspreis *<input name="sale_price" inputmode="decimal" value="${moneyValue(v.sale_price)}" placeholder="0,00"></label>
          <label>Verkauft am<input name="sale_date" type="date" value="${esc(v.sale_date || today())}"></label>
          <label>Plattform<select name="sale_platform">${options(PLATFORMS, v.sale_platform, '–')}</select></label>
          <label>Gebühren<input name="sale_fees" inputmode="decimal" value="${moneyValue(v.sale_fees || null)}" placeholder="0,00"></label>
          <label>Versand (von dir bezahlt)<input name="shipping_out" inputmode="decimal" value="${moneyValue(v.shipping_out || null)}" placeholder="0,00"></label>
          <label>Käufer<input name="buyer" maxlength="120" value="${esc(v.buyer)}" placeholder="optional" autocomplete="off"></label>
        </div>
        <div class="grid3 shipped-only">
          <label>Versendet am<input name="shipped_at" type="date" value="${esc(v.shipped_at || today())}"></label>
          <label>Sendungsnummer<input name="tracking_number" maxlength="80" value="${esc(v.tracking_number)}" placeholder="optional" autocomplete="off"></label>
          <label class="done-only">Angekommen am<input name="completed_at" type="date" value="${esc(v.completed_at || today())}"></label>
        </div>
      </fieldset>
      <label>Notizen<textarea name="notes" rows="3" maxlength="4000" placeholder="Mängel, Maße, Material …">${esc(v.notes)}</textarea></label>
      <p class="error" id="art-error"></p>
    </form>
    <div class="modal-foot">
      <button class="btn" data-close>Abbrechen</button>
      <button class="btn primary" id="art-save">${a ? 'Speichern' : 'Artikel anlegen'}</button>
    </div>`, { wide: true });

  const form = $('#art-form', m);
  const toggleSold = () => {
    const st = form.status.value;
    form.classList.toggle('is-sold', SOLD_STATUSES.includes(st));
    form.classList.toggle('is-shipped', st === 'versendet' || st === 'abgeschlossen');
    form.classList.toggle('is-done', st === 'abgeschlossen');
  };
  form.status.addEventListener('change', toggleSold);
  toggleSold();

  const xRows = $('#x-rows', m);
  const addXRow = (x = { amount: null, note: '' }) => {
    const r = document.createElement('div');
    r.className = 'x-row';
    r.innerHTML = `<input data-x="amount" inputmode="decimal" placeholder="Betrag" value="${moneyValue(x.amount)}" aria-label="Betrag">
      <input data-x="note" maxlength="120" placeholder="Info, z. B. Reinigung" value="${esc(x.note)}" aria-label="Info">
      <button type="button" class="icon-btn" aria-label="Entfernen">✕</button>`;
    $('button', r).addEventListener('click', () => r.remove());
    xRows.append(r);
    return r;
  };
  (v.extra_costs || []).forEach((x) => addXRow(x));
  $('#x-row-add', m).addEventListener('click', () => $('[data-x=amount]', addXRow()).focus());

  const renderGallery = () => {
    const g = $('#gallery', m);
    g.innerHTML = gallery.map((it, i) => `
      <div class="g-item">
        <img ${it.preview ? `src="${it.preview}"` : `data-img="${esc(it.path)}" data-thumb`} alt="">
        ${i > 0 ? `<button type="button" class="g-btn star" data-star="${i}" title="Als Titelbild">★</button>` : '<span class="g-cover">Titel</span>'}
        <button type="button" class="g-btn del" data-del="${i}" title="Entfernen">✕</button>
      </div>`).join('') +
      (gallery.length < MAX_IMAGES ? '<label class="g-add">＋ Foto<input type="file" accept="image/*" multiple hidden></label>' : '');
    hydrateImages(g);
    $$('[data-star]', g).forEach((b) => b.addEventListener('click', () => {
      gallery.unshift(...gallery.splice(Number(b.dataset.star), 1));
      renderGallery();
    }));
    $$('[data-del]', g).forEach((b) => b.addEventListener('click', () => {
      const [it] = gallery.splice(Number(b.dataset.del), 1);
      if (it.path) removed.push(it.path);
      if (it.preview) URL.revokeObjectURL(it.preview);
      renderGallery();
    }));
    $('input[type=file]', g)?.addEventListener('change', (e) => {
      const files = [...e.target.files].slice(0, MAX_IMAGES - gallery.length);
      for (const file of files) gallery.push({ file, preview: URL.createObjectURL(file) });
      renderGallery();
    });
  };
  renderGallery();

  const save = async () => {
    const err = $('#art-error', m);
    const btn = $('#art-save', m);
    err.textContent = '';
    const uploaded = [];
    try {
      const f = Object.fromEntries(new FormData(form));
      if (!f.title.trim()) throw new Error('Bitte einen Titel eingeben');
      const body = {
        title: f.title.trim(), category: f.category, brand: f.brand.trim(), size: f.size.trim(), color: f.color.trim(),
        condition: f.condition, location: f.location.trim(), status: f.status, notes: f.notes,
        purchase_input: parseMoney(f.purchase_input, 'Einkaufspreis'),
        shipping_in: haul ? (a?.shipping_in ?? 0) : parseMoney(f.shipping_in, 'Versand') || 0,
        purchase_date: f.purchase_date || null,
        listed_price: parseMoney(f.listed_price, 'Angebotspreis'),
        sale_price: parseMoney(f.sale_price, 'Verkaufspreis'),
        sale_date: f.sale_date || null,
        sale_platform: f.sale_platform,
        sale_fees: parseMoney(f.sale_fees, 'Gebühren') || 0,
        shipping_out: parseMoney(f.shipping_out, 'Versand') || 0,
        buyer: f.buyer.trim(),
        tracking_number: f.tracking_number.trim(),
        shipped_at: f.shipped_at || null,
        completed_at: f.completed_at || null,
        listings: v.listings || [],
        extra_costs: $$('.x-row', xRows).map((r, i) => ({
          amount: parseMoney($('[data-x=amount]', r).value, `Zusatzkosten Zeile ${i + 1}`),
          note: $('[data-x=note]', r).value.trim().slice(0, 120),
        })).filter((x) => x.amount !== null || x.note).map((x, i) => {
          if (x.amount === null) throw new Error(`Zusatzkosten „${x.note}“: Betrag fehlt`);
          return x;
        }),
      };
      if (!haul && body.purchase_input === null) body.purchase_input = 0;
      if (SOLD_STATUSES.includes(body.status) && body.sale_price === null) throw new Error('Bitte einen Verkaufspreis eintragen');
      btn.disabled = true;
      const pending = gallery.filter((it) => it.file).length;
      if (pending) btn.textContent = `Lädt ${pending} Foto${pending > 1 ? 's' : ''} …`;
      for (const it of gallery) {
        if (it.file && !it.path) { it.path = await uploadImage(it.file); uploaded.push(it.path); }
      }
      body.images = gallery.map((it) => it.path);
      const qty = a ? 1 : Math.min(50, Math.max(1, Math.floor(Number(f.qty)) || 1));
      let saved;
      let first;
      if (a) saved = await updateArticle(a.id, body);
      else {
        for (let i = 0; i < qty; i++) {
          btn.textContent = qty > 1 ? `Legt an ${i + 1}/${qty} …` : 'Speichert …';
          saved = await createArticle({ ...body, haul_id: haulId });
          first ??= saved;
        }
      }
      await removeImages(unusedImages(removed, (x) => x.id !== a?.id));
      await refresh();
      articleDetail((first || saved).id);
      toast(a ? 'Gespeichert' : qty > 1
        ? `${qty} Artikel angelegt: ${fmtArticleNo(first.article_no)} bis ${fmtArticleNo(saved.article_no)}`
        : `Artikel ${fmtArticleNo(saved.article_no)} angelegt`);
    } catch (ex) {
      await removeImages(uploaded).catch(() => {});
      gallery.forEach((it) => { if (it.file) delete it.path; });
      err.textContent = ex.message;
      btn.disabled = false;
      btn.textContent = a ? 'Speichern' : 'Artikel anlegen';
    }
  };
  form.addEventListener('submit', (e) => { e.preventDefault(); save(); });
  $('#art-save', m).addEventListener('click', save);
}

