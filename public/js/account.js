// Konto: Passwort, Export, Abmelden, App installieren.

import { STATUSES, costOf, profitOf, fmtArticleNo } from './shared.js';
import { sb, state, haulById } from './store.js';
import { $, esc, toast, download, today } from './ui.js';
import { logout } from './app.js';

let installPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installPrompt = e; });

export function renderAccount(main) {
  const u = state.user;
  const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  main.innerHTML = `
  <section class="panel">
    <h2>Dein Konto</h2>
    <dl class="info"><div><dt>E-Mail</dt><dd>${esc(u.email)}</dd></div>
      <div><dt>Artikel</dt><dd>${state.articles.length}</dd></div><div><dt>Hauls</dt><dd>${state.hauls.length}</dd></div></dl>
    <div class="row-actions">
      <button class="btn" id="export">Alle Artikel als CSV (Excel)</button>
      <button class="btn ghost" id="logout">Abmelden</button>
    </div>
  </section>
  ${standalone ? '' : `<section class="panel">
    <h2>Als App aufs Handy</h2>
    ${installPrompt ? '<button class="btn primary" id="install">App installieren</button>' : ios
      ? '<p>In Safari unten auf <b>Teilen</b> (Quadrat mit Pfeil) tippen, dann <b>„Zum Home-Bildschirm“</b>.</p>'
      : '<p>Im Browser-Menü (⋮) auf <b>„App installieren“</b> oder <b>„Zum Startbildschirm hinzufügen“</b> tippen.</p>'}
    <p class="muted small">Danach startet der Resell Tracker wie eine normale App, ohne Browserleiste.</p>
  </section>`}
  <section class="panel">
    <h2>Passwort ändern</h2>
    <form class="form narrow" id="pw-form">
      <label>Aktuelles Passwort<input name="current" type="password" autocomplete="current-password" required></label>
      <label>Neues Passwort (min. 8 Zeichen)<input name="next" type="password" autocomplete="new-password" minlength="8" required></label>
      <p class="error" id="pw-error"></p>
      <button class="btn primary" type="submit">Passwort ändern</button>
    </form>
  </section>`;
  $('#logout').addEventListener('click', logout);
  $('#export').addEventListener('click', exportCsv);
  $('#install')?.addEventListener('click', async () => {
    installPrompt.prompt();
    await installPrompt.userChoice;
    installPrompt = null;
    renderAccount(main);
  });
  $('#pw-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    const err = $('#pw-error');
    err.textContent = '';
    if (f.next.length < 8) { err.textContent = 'Neues Passwort braucht mindestens 8 Zeichen'; return; }
    const check = await sb.auth.signInWithPassword({ email: u.email, password: f.current });
    if (check.error) { err.textContent = 'Aktuelles Passwort ist falsch'; return; }
    const { error } = await sb.auth.updateUser({ password: f.next });
    if (error) { err.textContent = error.message; return; }
    e.target.reset();
    toast('Passwort geändert');
  });
}

function csvCell(v) {
  const s = v === null || v === undefined ? '' : String(v);
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s; // Formel-Injection in Excel verhindern
  return /[;"\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}
const csvMoney = (c) => (c === null || c === undefined ? '' : (c / 100).toFixed(2).replace('.', ','));

function exportCsv() {
  const head = ['Nr', 'Titel', 'Kategorie', 'Marke', 'Größe', 'Farbe', 'Zustand', 'Lagerort', 'Haul', 'Einkaufsdatum', 'Einkaufspreis',
    'Versand Einkauf', 'Kosten gesamt', 'Status', 'Online auf', 'Angebotspreis', 'Verkaufspreis', 'Verkaufsdatum', 'Plattform',
    'Gebühren', 'Versand Verkauf', 'Gewinn', 'Notizen'];
  const rows = [...state.articles].sort((a, b) => a.article_no - b.article_no).map((a) => [
    fmtArticleNo(a.article_no), a.title, a.category, a.brand, a.size, a.color, a.condition, a.location,
    a.haul_id ? haulById(a.haul_id)?.name : '', a.purchase_date || '', csvMoney(a.purchase_price), csvMoney(a.shipping_in),
    csvMoney(costOf(a)), STATUSES[a.status], (a.listings || []).join(', '), csvMoney(a.listed_price), csvMoney(a.sale_price),
    a.sale_date || '', a.sale_platform, csvMoney(a.status === 'verkauft' ? a.sale_fees : null),
    csvMoney(a.status === 'verkauft' ? a.shipping_out : null), csvMoney(profitOf(a)), a.notes,
  ].map(csvCell).join(';'));
  download(`resell-export-${today()}.csv`, '﻿' + [head.join(';'), ...rows].join('\r\n'), 'text/csv;charset=utf-8');
}
