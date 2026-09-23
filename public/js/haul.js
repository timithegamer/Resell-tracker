// Hauls: mehrere Teile auf einmal erfassen, Übersicht und Detail.

import { CATEGORIES, CONDITIONS, allocateHaul, fmtMoney } from './shared.js';
import { state, haulById, createHaul, updateHaul, dissolveHaul, deleteHaul, uploadImage, removeImages, hydrateImages } from './store.js';
import { $, $$, esc, toast, parseMoney, moneyValue, today, fmtDate, options, profitClass, openModal, modalHead, confirmDialog, guard } from './ui.js';
import { refresh } from './app.js';
import { computeStats, articleRow, thumb } from './inventory.js';
import { articleDetail, articleForm } from './article.js';

const SOURCES = ['Vinted-Bundle', 'eBay-Lot', 'Flohmarkt', 'Kleinanzeigen', 'willhaben', 'Second-Hand-Laden',
  'Großhandel / Ballenware', 'Outlet', 'Haushaltsauflösung'];

// ================================================================ Haul hinzufügen

export function haulForm() {
  const rowFiles = new Map(); // Zeile -> [{ file, preview }]
  const m = openModal(`
    ${modalHead('Haul hinzufügen', 'Mehrere Teile auf einmal einkaufen. Gesamtpreis und Versand werden auf die Artikel verteilt.')}
    <form class="modal-body form" id="haul-form" novalidate>
      <div class="grid3">
        <label>Name des Hauls *<input name="name" required maxlength="120" placeholder="z. B. Flohmarkt Naschmarkt"></label>
        <label>Quelle<input name="source" list="sources" maxlength="120" placeholder="Wo gekauft?"></label>
        <label>Datum<input name="date" type="date" value="${today()}"></label>
        <label>Gesamtpreis der Ware<input name="total_price" inputmode="decimal" placeholder="0,00"></label>
        <label>Versand für alles<input name="shipping_cost" inputmode="decimal" placeholder="0,00"></label>
        <label>Lagerort für alle<input name="location" maxlength="60" placeholder="z. B. Box 3" list="locations"></label>
      </div>
      <datalist id="sources">${[...new Set([...state.hauls.map((h) => h.source).filter(Boolean), ...SOURCES])].map((s) => `<option value="${esc(s)}">`).join('')}</datalist>
      <datalist id="locations">${[...new Set(state.articles.map((x) => x.location).filter(Boolean))].map((l) => `<option value="${esc(l)}">`).join('')}</datalist>
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
      <label>Notizen zum Haul<input name="notes" maxlength="4000" placeholder="optional"></label>
      <p class="error" id="haul-error"></p>
    </form>
    <div class="modal-foot">
      <button class="btn" data-close>Abbrechen</button>
      <button class="btn primary" id="haul-save">Haul speichern</button>
    </div>`, { wide: true });

  const form = $('#haul-form', m);
  const rows = $('#haul-rows', m);

  const addRow = (focus = true, source = null) => {
    const prev = source || rows.lastElementChild;
    const row = document.createElement('div');
    row.className = 'haul-row';
    row.innerHTML = `
      <label class="img-mini" title="Fotos hinzufügen"><span>＋ Foto</span><b></b><input type="file" accept="image/*" multiple hidden></label>
      <label class="span2">Titel *<input data-k="title" maxlength="160" placeholder="z. B. Levi's 501 Jeans"></label>
      <label>Kategorie<select data-k="category">${options(CATEGORIES, prev ? $('[data-k=category]', prev).value : 'Kleidung')}</select></label>
      <label>Marke<input data-k="brand" maxlength="80"></label>
      <label>Größe<input data-k="size" maxlength="40"></label>
      <label>Zustand<select data-k="condition">${options(CONDITIONS, prev ? $('[data-k=condition]', prev).value : '', '–')}</select></label>
      <label>Einzelpreis<input data-k="price" inputmode="decimal" placeholder="optional"></label>
      <label class="qty">Anzahl<input data-k="qty" type="number" inputmode="numeric" min="1" max="99" value="1"></label>
      <div class="row-cost"><span class="muted small">Kosten je Stück</span><b data-cost>–</b><span class="muted small" data-ship></span></div>
      <div class="row-btns">
        <button type="button" class="icon-btn" data-copy title="Zeile kopieren" aria-label="Zeile kopieren">⧉</button>
        <button type="button" class="icon-btn" data-remove aria-label="Zeile entfernen">✕</button>
      </div>`;
    if (source) source.after(row); else rows.append(row);
    if (source) {
      for (const k of ['title', 'category', 'brand', 'size', 'condition', 'price', 'qty']) $(`[data-k=${k}]`, row).value = $(`[data-k=${k}]`, source).value;
      const files = (rowFiles.get(source) || []).map((f) => ({ file: f.file, preview: URL.createObjectURL(f.file) }));
      if (files.length) { rowFiles.set(row, files); showFiles(row); }
    }
    $('[data-copy]', row).addEventListener('click', () => { addRow(false, row); toast('Zeile kopiert. Größe oder Farbe anpassen, falls sie sich unterscheiden.'); });
    $('[data-remove]', row).addEventListener('click', () => {
      if (rows.children.length === 1) { toast('Ein Haul braucht mindestens einen Artikel'); return; }
      (rowFiles.get(row) || []).forEach((f) => URL.revokeObjectURL(f.preview));
      rowFiles.delete(row);
      row.remove();
      update();
    });
    $('input[type=file]', row).addEventListener('change', (e) => {
      const list = [...(rowFiles.get(row) || []), ...[...e.target.files].map((file) => ({ file, preview: URL.createObjectURL(file) }))].slice(0, 12);
      rowFiles.set(row, list);
      showFiles(row);
      e.target.value = '';
    });
    if (focus) $('[data-k=title]', row).focus();
    update();
  };

  function showFiles(row) {
    const list = rowFiles.get(row) || [];
    const lbl = $('.img-mini', row);
    if (!list.length) return;
    lbl.style.backgroundImage = `url("${list[0].preview}")`;
    lbl.classList.add('has-img');
    $('b', lbl).textContent = list.length > 1 ? list.length : '';
  }

  const isFilled = (it) => Boolean(it.title || it.purchase_input !== null || rowFiles.get(it.row)?.length);

  const readQty = (row) => Math.min(99, Math.max(1, Math.floor(Number($('[data-k=qty]', row).value)) || 1));

  const readHaul = (strict) => {
    const f = Object.fromEntries(new FormData(form));
    const safe = (v, label) => { try { return parseMoney(v, label); } catch (e) { if (strict) throw e; return null; } };
    return {
      name: f.name.trim(), source: f.source.trim(), date: f.date || null, notes: f.notes, location: f.location.trim(),
      total_price: safe(f.total_price, 'Gesamtpreis'),
      shipping_cost: safe(f.shipping_cost, 'Versand') || 0,
      items: [...rows.children].map((row, i) => {
        const g = (k) => $(`[data-k=${k}]`, row).value;
        return {
          row, title: g('title').trim(), category: g('category'), brand: g('brand').trim(), size: g('size').trim(), condition: g('condition'),
          purchase_input: safe(g('price'), `Einzelpreis in Zeile ${i + 1}`),
          qty: readQty(row),
        };
      }),
    };
  };

  function update() {
    const h = readHaul(false);
    // Leere Zeilen werden beim Speichern ignoriert, also auch hier nicht mitrechnen.
    h.items.filter((it) => !isFilled(it)).forEach((it) => {
      $('[data-cost]', it.row).textContent = '–';
      $('[data-ship]', it.row).textContent = '';
    });
    h.items = h.items.filter(isFilled);
    const expanded = h.items.flatMap((it) => Array(it.qty).fill({ input: it.purchase_input }));
    const alloc = allocateHaul(h, expanded);
    let k = 0;
    h.items.forEach((it) => {
      const x = alloc.items[k];
      const rowTotal = alloc.items.slice(k, k + it.qty).reduce((s, y) => s + y.purchase_price + y.shipping_in, 0);
      k += it.qty;
      $('[data-cost]', it.row).textContent = fmtMoney(x.purchase_price + x.shipping_in);
      $('[data-ship]', it.row).textContent = [
        x.shipping_in ? `inkl. ${fmtMoney(x.shipping_in)} Versand` : '',
        it.qty > 1 ? `${it.qty} Stück = ${fmtMoney(rowTotal)}` : '',
      ].filter(Boolean).join(' · ');
    });
    const n = expanded.length;
    $('#haul-count', m).textContent = `${n} Artikel`;
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
    const btn = $('#haul-save', m);
    err.textContent = '';
    const uploaded = [];
    try {
      const h = readHaul(true);
      if (!h.name) throw new Error('Bitte gib dem Haul einen Namen');
      const items = h.items.filter(isFilled);
      const untitled = items.find((it) => !it.title);
      if (untitled) throw new Error(`Zeile ${h.items.indexOf(untitled) + 1}: Titel fehlt`);
      if (!items.length) throw new Error('Trag mindestens einen Artikel ein');
      const pieces = items.reduce((s, it) => s + it.qty, 0);
      if (pieces > 200) throw new Error(`Maximal 200 Artikel pro Haul (gerade ${pieces})`);
      btn.disabled = true;
      const totalFiles = items.reduce((n, it) => n + (rowFiles.get(it.row)?.length || 0), 0);
      let done = 0;
      const payload = [];
      for (const { row, qty, ...it } of items) {
        const images = [];
        for (const f of rowFiles.get(row) || []) {
          btn.textContent = `Foto ${++done}/${totalFiles} …`;
          const path = await uploadImage(f.file);
          uploaded.push(path);
          images.push(path);
        }
        for (let q = 0; q < qty; q++) payload.push({ ...it, location: h.location, images });
      }
      btn.textContent = 'Speichert …';
      const haulId = await createHaul(
        { name: h.name, source: h.source, date: h.date, notes: h.notes, total_price: h.total_price, shipping_cost: h.shipping_cost },
        payload,
      );
      for (const list of rowFiles.values()) list.forEach((f) => URL.revokeObjectURL(f.preview));
      await refresh();
      haulDetail(haulId);
      toast(`Haul mit ${payload.length} Artikeln angelegt`);
    } catch (ex) {
      await removeImages(uploaded).catch(() => {});
      err.textContent = ex.message;
      btn.disabled = false;
      btn.textContent = 'Haul speichern';
    }
  });
}

// ================================================================ Übersicht

export function haulStats(h) {
  const items = state.articles.filter((a) => a.haul_id === h.id);
  const s = computeStats(items);
  s.items = items;
  s.cost = s.invested;
  s.back = s.net + s.invested; // Netto-Erlöse
  return s;
}

export function renderHauls(main) {
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
      <div class="haul-thumbs">${s.items.slice(0, 5).map((a) => thumb(a, 'mini')).join('')}</div>
      <h3>${esc(h.name)}</h3>
      <p class="muted small">${[fmtDate(h.date), h.source].filter(Boolean).map(esc).join(' · ')}</p>
      <div class="haul-nums">
        <div><span>Artikel</span><b>${s.sold}/${s.count} verkauft</b></div>
        <div><span>Kosten</span><b>${fmtMoney(s.cost)}</b></div>
        <div><span>Ergebnis</span><b class="${profitClass(s.net)}">${fmtMoney(s.net)}</b></div>
      </div>
      <div class="bar" role="img" aria-label="${pct} % der Kosten wieder eingespielt"><i style="width:${pct}%"></i></div>
      <p class="muted small">${pct >= 100 ? '✓ Kosten wieder drin' : `${pct} % der Kosten wieder eingespielt`}</p>
    </button>`;
  }).join('')}</section>`;
  $$('.haul-card', main).forEach((c) => c.addEventListener('click', () => haulDetail(Number(c.dataset.id))));
  hydrateImages(main);
}

// ================================================================ Detail

export function haulDetail(id) {
  const h = haulById(id);
  if (!h) { toast('Haul nicht gefunden', 'err'); return; }
  const s = haulStats(h);
  const m = openModal(`
    ${modalHead(`Haul: ${esc(h.name)}`, [fmtDate(h.date), h.source, `${s.count} Artikel`].filter(Boolean).map(esc).join(' · '))}
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

  hydrateImages(m);
  $$('.row', m).forEach((r) => r.addEventListener('click', () => articleDetail(Number(r.dataset.id))));
  $('#h-add', m).addEventListener('click', () => articleForm(null, h.id));
  $('#h-form', m).addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    try {
      if (!f.name.trim()) throw new Error('Name fehlt');
      await updateHaul(h.id, {
        name: f.name.trim(), source: f.source.trim(), date: f.date || null, notes: f.notes,
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
    await guard(async () => { await dissolveHaul(h.id); await refresh(); toast('Haul aufgelöst'); });
  });
  $('#h-delete', m).addEventListener('click', async () => {
    const ok = await confirmDialog('Haul löschen?', `Der Haul „${esc(h.name)}“ und <b>alle ${s.count} Artikel</b> darin werden endgültig gelöscht, auch schon verkaufte, samt Fotos.`,
      [{ label: 'Abbrechen', value: false }, { label: 'Endgültig löschen', value: true, kind: 'danger' }]);
    if (!ok) return haulDetail(h.id);
    await guard(async () => { await deleteHaul(h.id); await refresh(); toast('Haul gelöscht'); });
  });
}
