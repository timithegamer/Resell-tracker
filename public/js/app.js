// Einstieg: Anmeldung, Grundgerüst und Navigation.

import { sb, configured, state, loadAll } from './store.js';
import { $, $$, toast, openModal, closeModal, modalHead, guard } from './ui.js';
import { renderInventory } from './inventory.js';
import { renderHauls, haulForm, haulDetail } from './haul.js';
import { renderStats } from './stats.js';
import { renderAccount } from './account.js';
import { articleDetail, articleForm } from './article.js';

const app = $('#app');

const VIEWS = {
  inventar: { label: 'Inventar', render: renderInventory },
  hauls: { label: 'Hauls', render: renderHauls },
  auswertung: { label: 'Auswertung', render: renderStats },
  konto: { label: 'Konto', render: renderAccount },
};

let view = 'inventar';
let pendingHash = location.hash; // z. B. #/a/12 aus einem QR-Code, auch über den Login hinweg

// ================================================================ Start

async function boot() {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});

  if (!configured) {
    app.innerHTML = `<div class="auth"><div class="auth-card">
      <div class="auth-brand"><img src="icon.svg" alt=""><h1>Resell Tracker</h1></div>
      <p>Die App ist noch nicht mit Supabase verbunden.</p>
      <p class="muted small">Trag bei Netlify unter <b>Site configuration → Environment variables</b> die Werte
      <code>SUPABASE_URL</code> und <code>SUPABASE_KEY</code> ein und starte danach einen neuen Deploy. Details stehen in der README.</p>
    </div></div>`;
    return;
  }

  sb.auth.onAuthStateChange((event, session) => {
    if (event === 'PASSWORD_RECOVERY') setTimeout(newPasswordDialog, 0);
    if (event === 'SIGNED_OUT') { state.user = null; renderAuth(); }
    if (session?.user) state.user = session.user;
  });

  const { data } = await sb.auth.getSession();
  if (data.session) {
    state.user = data.session.user;
    await start();
  } else {
    renderAuth();
  }
}

async function start() {
  app.innerHTML = '<p class="boot">Lädt deine Daten …</p>';
  const ok = await guard(async () => { await loadAll(); return true; });
  if (!ok) {
    app.innerHTML = `<div class="auth"><div class="auth-card"><h2>Laden fehlgeschlagen</h2>
      <p class="muted">Keine Verbindung zu Supabase. Wenn das Projekt länger nicht benutzt wurde, ist es eventuell pausiert:
      im Supabase-Dashboard auf „Restore project“ tippen.</p>
      <button class="btn primary" id="retry">Nochmal versuchen</button></div></div>`;
    $('#retry').addEventListener('click', start);
    return;
  }
  renderShell();
  handleHash(pendingHash);
  pendingHash = '';
}

// ================================================================ Anmeldung

function renderAuth() {
  closeModal();
  app.innerHTML = `
  <div class="auth">
    <div class="auth-card">
      <div class="auth-brand"><img src="icon.svg" alt=""><h1>Resell Tracker</h1></div>
      <p class="muted">Einkauf, Verkauf und Gewinn deiner Resells an einem Ort.</p>
      <form id="auth-form" novalidate>
        <label>E-Mail<input name="email" type="email" autocomplete="username" required></label>
        <label>Passwort<input name="password" type="password" autocomplete="current-password" required></label>
        <p class="error" id="auth-error"></p>
        <button class="btn primary block" type="submit">Anmelden</button>
        <button class="linkish" type="button" id="forgot">Passwort vergessen?</button>
      </form>
    </div>
  </div>`;
  $('#auth-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    const err = $('#auth-error');
    const btn = $('button[type=submit]', e.target);
    err.textContent = '';
    btn.disabled = true;
    const { data, error } = await sb.auth.signInWithPassword({ email: f.email.trim(), password: f.password });
    if (error) {
      err.textContent = /Invalid login/i.test(error.message) ? 'E-Mail oder Passwort falsch' : error.message;
      btn.disabled = false;
      return;
    }
    state.user = data.user;
    await start();
  });
  $('#forgot').addEventListener('click', async () => {
    const email = $('[name=email]').value.trim();
    const err = $('#auth-error');
    if (!email) { err.textContent = 'Trag oben deine E-Mail ein, dann nochmal tippen.'; return; }
    const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
    err.textContent = '';
    if (error) toast(error.message, 'err');
    else toast('Falls es das Konto gibt, ist jetzt eine E-Mail mit Link unterwegs.');
  });
}

function newPasswordDialog() {
  const m = openModal(`${modalHead('Neues Passwort festlegen')}
    <form class="modal-body form" id="np-form">
      <label>Neues Passwort (min. 8 Zeichen)<input name="pw" type="password" autocomplete="new-password" minlength="8" required></label>
      <p class="error" id="np-error"></p>
      <button class="btn primary" type="submit">Speichern</button>
    </form>`);
  $('#np-form', m).addEventListener('submit', async (e) => {
    e.preventDefault();
    const pw = e.target.pw.value;
    if (pw.length < 8) { $('#np-error', m).textContent = 'Mindestens 8 Zeichen'; return; }
    const { error } = await sb.auth.updateUser({ password: pw });
    if (error) { $('#np-error', m).textContent = error.message; return; }
    closeModal();
    toast('Passwort geändert');
  });
}

// ================================================================ Gerüst & Navigation

function renderShell() {
  app.innerHTML = `
  <header class="topbar">
    <div class="brand"><img src="icon.svg" alt=""><span>Resell Tracker</span></div>
    <nav class="tabs" aria-label="Bereiche">
      ${Object.entries(VIEWS).map(([k, v]) => `<a href="#/${k}" data-view="${k}">${v.label}</a>`).join('')}
    </nav>
    <div class="actions">
      <button class="btn" id="add-article">+ Artikel</button>
      <button class="btn primary" id="add-haul">+ Haul hinzufügen</button>
    </div>
  </header>
  <main id="main"></main>`;
  $('#add-article').addEventListener('click', () => articleForm());
  $('#add-haul').addEventListener('click', () => haulForm());
  renderView();
}

export function renderView() {
  const main = $('#main');
  if (!main) return;
  $$('[data-view]').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
  VIEWS[view].render(main);
}

// Lädt alle Daten neu und zeichnet die aktuelle Ansicht.
export async function refresh() {
  await loadAll();
  renderView();
}

function handleHash(hash) {
  const [, kind, id] = (hash || '').match(/^#\/([a-z]+)(?:\/(\d+))?/) || [];
  if (kind === 'a' && id) {
    history.replaceState(null, '', '#/inventar');
    view = 'inventar';
    renderView();
    articleDetail(Number(id));
    return;
  }
  if (kind === 'h' && id) {
    history.replaceState(null, '', '#/hauls');
    view = 'hauls';
    renderView();
    haulDetail(Number(id));
    return;
  }
  const next = VIEWS[kind] ? kind : 'inventar';
  if (next !== view || !$('#main')?.children.length) {
    view = next;
    renderView();
  }
}

window.addEventListener('hashchange', () => {
  if (!state.user || !$('#main')) { pendingHash = location.hash; return; }
  closeModal();
  handleHash(location.hash);
});

export async function logout() {
  await sb.auth.signOut();
  state.user = null;
  state.articles = [];
  state.hauls = [];
  state.expenses = [];
  history.replaceState(null, '', '#/inventar');
  renderAuth();
}

boot();
