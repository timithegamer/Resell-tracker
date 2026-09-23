// QR-Etiketten: Auswahl und Druckansicht. Der QR-Code enthält einen Link
// direkt zum Artikel, die normale Handykamera reicht zum Scannen.

import qrcode from '../vendor/qrcode-2.0.4.mjs';
import { fmtArticleNo, STATUSES } from './shared.js';
import { state } from './store.js';
import { $, $$, esc, openModal, modalHead, toast } from './ui.js';

export const articleLink = (a) => `${location.origin}${location.pathname}#/a/${a.id}`;

function qrSvg(text) {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  return qr.createSvgTag({ cellSize: 2, margin: 0, scalable: true });
}

export function labelPicker() {
  const list = state.articles.filter((a) => a.status !== 'verkauft').sort((a, b) => b.article_no - a.article_no);
  if (!list.length) { toast('Keine Artikel auf Lager'); return; }
  const m = openModal(`
    ${modalHead('QR-Etiketten drucken', 'Etikett auf die Tüte oder Box kleben. Scannen mit der Handykamera öffnet direkt den Artikel.')}
    <div class="modal-body">
      <div class="row-actions">
        <button class="btn small" id="sel-all">Alle</button>
        <button class="btn small" id="sel-none">Keine</button>
        <button class="btn small" id="sel-new">Neueste 24</button>
      </div>
      <div class="pick-list">
        ${list.map((a) => `<label class="pick"><input type="checkbox" value="${a.id}">
          <span class="no">${fmtArticleNo(a.article_no)}</span><span class="pick-title">${esc(a.title)}</span>
          <span class="muted small">${esc(a.location || STATUSES[a.status])}</span></label>`).join('')}
      </div>
      <p class="muted small">Passt auf Etikettenbögen mit 3 × 8 Etiketten (70 × 37 mm, z. B. Avery Zweckform 3475) oder normales Papier zum Ausschneiden.</p>
    </div>
    <div class="modal-foot">
      <span class="muted small" id="sel-count">0 ausgewählt</span>
      <button class="btn" data-close>Abbrechen</button>
      <button class="btn primary" id="print">Drucken</button>
    </div>`, { wide: true });
  const boxes = $$('input[type=checkbox]', m);
  const count = () => { $('#sel-count', m).textContent = `${boxes.filter((b) => b.checked).length} ausgewählt`; };
  boxes.forEach((b) => b.addEventListener('change', count));
  $('#sel-all', m).addEventListener('click', () => { boxes.forEach((b) => { b.checked = true; }); count(); });
  $('#sel-none', m).addEventListener('click', () => { boxes.forEach((b) => { b.checked = false; }); count(); });
  $('#sel-new', m).addEventListener('click', () => { boxes.forEach((b, i) => { b.checked = i < 24; }); count(); });
  $('#print', m).addEventListener('click', () => {
    const ids = new Set(boxes.filter((b) => b.checked).map((b) => Number(b.value)));
    if (!ids.size) { toast('Erst Artikel auswählen'); return; }
    printLabels(list.filter((a) => ids.has(a.id)).sort((a, b) => a.article_no - b.article_no));
  });
}

export function printLabels(articles) {
  const root = $('#print-root');
  root.innerHTML = `<div class="labels">${articles.map((a) => `
    <div class="label">
      <div class="label-qr">${qrSvg(articleLink(a))}</div>
      <div class="label-text">
        <b>${fmtArticleNo(a.article_no)}</b>
        <span class="label-title">${esc(a.title)}</span>
        <span>${esc([a.size && `Gr. ${a.size}`, a.location].filter(Boolean).join(' · '))}</span>
      </div>
    </div>`).join('')}</div>`;
  document.body.classList.add('printing');
  const done = () => {
    document.body.classList.remove('printing');
    root.innerHTML = '';
    window.removeEventListener('afterprint', done);
  };
  window.addEventListener('afterprint', done);
  setTimeout(() => window.print(), 50);
}
