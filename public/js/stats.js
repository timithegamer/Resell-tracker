// Auswertung: Kennzahlen, Gewinn pro Monat, Aufschlüsselungen, DAC7 und Nebenkosten.

import { EXPENSE_CATEGORIES, ONLINE_PLATFORMS, DAC7, profitOf, costOf, fmtMoney, ageDays } from './shared.js';
import { state, haulById, createExpense, deleteExpense } from './store.js';
import { $, $$, esc, toast, parseMoney, today, fmtDate, options, profitClass, guard, confirmDialog } from './ui.js';
import { refresh } from './app.js';

const MONTHS = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];
const MONTHS_LONG = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];

let period = String(new Date().getFullYear()); // Jahr oder 'alle'
let showTable = false;

const saleDate = (a) => a.sale_date || a.updated_at?.slice(0, 10) || '';
const inPeriod = (d) => period === 'alle' || (d || '').startsWith(period);

export function renderStats(main) {
  const years = new Set([String(new Date().getFullYear())]);
  state.articles.forEach((a) => { if (a.status === 'verkauft' && saleDate(a)) years.add(saleDate(a).slice(0, 4)); });
  state.expenses.forEach((e) => years.add(e.date.slice(0, 4)));
  if (period !== 'alle' && !years.has(period)) period = String(new Date().getFullYear());

  const sold = state.articles.filter((a) => a.status === 'verkauft' && inPeriod(saleDate(a)));
  const expenses = state.expenses.filter((e) => inPeriod(e.date));
  const revenue = sum(sold, (a) => a.sale_price);
  const profit = sum(sold, profitOf);
  const extra = sum(expenses, (e) => e.amount);
  const net = profit - extra;
  const avgDays = sold.length ? Math.round(sum(sold, (a) => ageDays(a)) / sold.length) : null;

  main.innerHTML = `
    <section class="stats-head">
      <h2>Auswertung</h2>
      <div class="seg small-seg" role="tablist">
        ${[...years].sort().reverse().map((y) => `<button data-period="${y}" class="${period === y ? 'active' : ''}">${y}</button>`).join('')}
        <button data-period="alle" class="${period === 'alle' ? 'active' : ''}">Alle</button>
      </div>
    </section>
    <section class="hero">
      <span>Gewinn nach Nebenkosten ${period === 'alle' ? 'gesamt' : period}</span>
      <strong class="${profitClass(net)}">${fmtMoney(net)}</strong>
      <small>${fmtMoney(profit)} Gewinn aus Verkäufen − ${fmtMoney(extra)} Nebenkosten</small>
    </section>
    <section class="stats">
      <div class="stat"><span>Verkäufe</span><strong>${sold.length}</strong><small>Umsatz ${fmtMoney(revenue)}</small></div>
      <div class="stat"><span>Gewinn aus Verkäufen</span><strong class="${profitClass(profit)}">${fmtMoney(profit)}</strong>
        <small>${sold.length ? `Ø ${fmtMoney(Math.round(profit / sold.length))} pro Artikel` : '–'}</small></div>
      <div class="stat"><span>Nebenkosten</span><strong>${fmtMoney(extra)}</strong><small>${expenses.length} ${expenses.length === 1 ? 'Eintrag' : 'Einträge'}</small></div>
      <div class="stat"><span>Ø Tage bis Verkauf</span><strong>${avgDays ?? '–'}</strong><small>ab Einkauf</small></div>
    </section>

    <section class="panel">
      <div class="panel-head">
        <div><h3>Gewinn pro Monat</h3><p class="muted small">${period === 'alle' ? 'Letzte 12 Monate' : period} · nach Verkaufsdatum · rot = Minus-Monat</p></div>
        <button class="btn small ghost" id="toggle-table">${showTable ? 'Diagramm' : 'Tabelle'}</button>
      </div>
      <div id="month-chart" class="chart"></div>
    </section>

    <div class="breakdowns">
      ${breakdownPanel('Nach Einkaufsquelle', 'Wo sich das Einkaufen lohnt', group(sold, sourceOf))}
      ${breakdownPanel('Nach Plattform', 'Wo du am besten verkaufst', group(sold, (a) => a.sale_platform || 'ohne Angabe'))}
      ${breakdownPanel('Nach Kategorie', 'Was am meisten bringt', group(sold, (a) => a.category))}
    </div>

    ${dac7Panel()}
    ${expensesPanel(expenses)}`;

  $$('[data-period]', main).forEach((b) => b.addEventListener('click', () => { period = b.dataset.period; renderStats(main); }));
  $('#toggle-table', main).addEventListener('click', () => { showTable = !showTable; renderStats(main); });
  renderMonthChart($('#month-chart', main), monthly());
  wireExpenses(main);
}

const sum = (list, fn) => list.reduce((s, x) => s + (fn(x) || 0), 0);

function sourceOf(a) {
  const h = a.haul_id ? haulById(a.haul_id) : null;
  if (!h) return 'Einzelkäufe';
  return h.source || 'Hauls ohne Quelle';
}

function group(sold, keyFn) {
  const map = new Map();
  for (const a of sold) {
    const k = keyFn(a);
    const g = map.get(k) || { key: k, count: 0, profit: 0, cost: 0 };
    g.count++;
    g.profit += profitOf(a);
    g.cost += costOf(a);
    map.set(k, g);
  }
  return [...map.values()].sort((a, b) => b.profit - a.profit);
}

function breakdownPanel(title, sub, rows) {
  const max = Math.max(1, ...rows.map((r) => Math.abs(r.profit)));
  return `<section class="panel">
    <h3>${title}</h3><p class="muted small">${sub} · Gewinn und Rendite (ROI) der verkauften Artikel</p>
    ${rows.length ? `<div class="barlist">${rows.map((r) => `
      <div class="bl-row">
        <span class="bl-label">${esc(r.key)}</span>
        <span class="bl-track"><i class="${r.profit < 0 ? 'neg' : ''}" style="width:${Math.max(1, (Math.abs(r.profit) / max) * 100)}%"></i></span>
        <span class="bl-value"><b>${fmtMoney(r.profit)}</b><small>${r.count}× · ROI ${r.cost ? Math.round((r.profit / r.cost) * 100) + ' %' : '–'}</small></span>
      </div>`).join('')}</div>` : '<p class="muted">Noch keine Verkäufe in diesem Zeitraum.</p>'}
  </section>`;
}

// ---------------------------------------------------------------- Monatsdiagramm

function monthly() {
  const now = new Date();
  const keys = period === 'alle'
    ? Array.from({ length: 12 }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() - 11 + i, 1);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    })
    : Array.from({ length: 12 }, (_, i) => `${period}-${String(i + 1).padStart(2, '0')}`);
  const data = keys.map((k) => ({ key: k, profit: 0, revenue: 0, count: 0, extra: 0 }));
  const idx = new Map(keys.map((k, i) => [k, i]));
  for (const a of state.articles) {
    if (a.status !== 'verkauft') continue;
    const i = idx.get(saleDate(a).slice(0, 7));
    if (i === undefined) continue;
    data[i].profit += profitOf(a);
    data[i].revenue += a.sale_price;
    data[i].count++;
  }
  for (const e of state.expenses) {
    const i = idx.get(e.date.slice(0, 7));
    if (i !== undefined) data[i].extra += e.amount;
  }
  return data;
}

const monthName = (key, long = false) => {
  const [y, m] = key.split('-');
  return `${(long ? MONTHS_LONG : MONTHS)[Number(m) - 1]}${long || period === 'alle' ? ' ' + y : ''}`;
};

function renderMonthChart(el, data) {
  if (showTable) {
    el.innerHTML = `<div class="table-wrap"><table class="data-table"><thead><tr><th>Monat</th><th>Verkäufe</th><th>Umsatz</th><th>Gewinn</th><th>Nebenkosten</th></tr></thead>
      <tbody>${data.map((d) => `<tr><td>${monthName(d.key, true)}</td><td>${d.count}</td><td>${fmtMoney(d.revenue)}</td>
        <td class="${profitClass(d.profit)}">${fmtMoney(d.profit)}</td><td>${fmtMoney(d.extra)}</td></tr>`).join('')}</tbody></table></div>`;
    return;
  }
  if (!data.some((d) => d.count)) {
    el.innerHTML = '<p class="muted chart-empty">Noch keine Verkäufe in diesem Zeitraum.</p>';
    return;
  }
  const W = Math.max(260, el.clientWidth || 600);
  const H = 220;
  const pad = { l: 56, r: 8, t: 22, b: 26 };
  const vals = data.map((d) => d.profit);
  let hi = Math.max(0, ...vals);
  let lo = Math.min(0, ...vals);
  if (hi === lo) hi = 100;
  const step = niceStep((hi - lo) / 4);
  hi = Math.ceil(hi / step) * step;
  lo = Math.floor(lo / step) * step;
  const y = (v) => pad.t + ((hi - v) / (hi - lo)) * (H - pad.t - pad.b);
  const band = (W - pad.l - pad.r) / data.length;
  const bw = Math.min(24, band * 0.6);
  const ticks = [];
  for (let v = lo; v <= hi + 1; v += step) ticks.push(v);
  const best = vals.indexOf(Math.max(...vals));

  const bars = data.map((d, i) => {
    const x = pad.l + band * i + (band - bw) / 2;
    const y0 = y(0);
    const y1 = y(d.profit);
    const h = Math.abs(y1 - y0);
    const r = Math.min(4, h, bw / 2);
    const path = d.profit >= 0
      ? `M${x},${y0} V${y1 + r} Q${x},${y1} ${x + r},${y1} H${x + bw - r} Q${x + bw},${y1} ${x + bw},${y1 + r} V${y0} Z`
      : `M${x},${y0} V${y1 - r} Q${x},${y1} ${x + r},${y1} H${x + bw - r} Q${x + bw},${y1} ${x + bw},${y1 - r} V${y0} Z`;
    return `${h > 0.5 ? `<path d="${path}" class="${d.profit < 0 ? 'bar-neg' : 'bar-pos'}"/>` : ''}
      ${i === best && d.profit > 0 ? `<text x="${x + bw / 2}" y="${y1 - 6}" class="v-label" text-anchor="middle">${shortMoney(d.profit)}</text>` : ''}
      <text x="${pad.l + band * i + band / 2}" y="${H - 8}" class="x-label" text-anchor="middle">${band < 34 ? MONTHS[Number(d.key.slice(5)) - 1][0] : MONTHS[Number(d.key.slice(5)) - 1]}</text>
      <rect x="${pad.l + band * i}" y="${pad.t}" width="${band}" height="${H - pad.t - pad.b}" class="hit" data-i="${i}"/>`;
  }).join('');

  el.innerHTML = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Gewinn pro Monat">
    ${ticks.map((v) => `<line x1="${pad.l}" x2="${W - pad.r}" y1="${y(v)}" y2="${y(v)}" class="${v === 0 ? 'axis0' : 'grid'}"/>
      <text x="${pad.l - 8}" y="${y(v) + 4}" class="y-label" text-anchor="end">${shortMoney(v)}</text>`).join('')}
    ${bars}
  </svg><div class="tip" hidden></div>`;

  const tip = $('.tip', el);
  $$('.hit', el).forEach((r) => {
    const show = () => {
      const d = data[Number(r.dataset.i)];
      tip.innerHTML = `<b>${monthName(d.key, true)}</b><br>Gewinn <b>${fmtMoney(d.profit)}</b><br>${d.count} ${d.count === 1 ? 'Verkauf' : 'Verkäufe'} · Umsatz ${fmtMoney(d.revenue)}${d.extra ? `<br>Nebenkosten ${fmtMoney(d.extra)}` : ''}`;
      tip.hidden = false;
      const bx = Number(r.getAttribute('x')) + Number(r.getAttribute('width')) / 2;
      tip.style.left = `${Math.min(Math.max(bx, 80), W - 80)}px`;
      $$('.hit', el).forEach((x) => x.classList.toggle('active', x === r));
    };
    r.addEventListener('mouseenter', show);
    r.addEventListener('click', show);
  });
  $('svg', el).addEventListener('mouseleave', () => { tip.hidden = true; $$('.hit', el).forEach((x) => x.classList.remove('active')); });

  // Bei Größenänderung (Handy drehen) neu zeichnen.
  if (!el.dataset.ro) {
    el.dataset.ro = '1';
    let last = el.clientWidth;
    new ResizeObserver(() => {
      if (Math.abs(el.clientWidth - last) > 20 && el.isConnected) { last = el.clientWidth; renderMonthChart(el, data); }
    }).observe(el);
  }
}

function niceStep(raw) {
  const p = 10 ** Math.floor(Math.log10(Math.max(raw, 1)));
  return [1, 2, 2.5, 5, 10].map((m) => m * p).find((s) => s >= raw) || p * 10;
}

function shortMoney(c) {
  const e = c / 100;
  if (Math.abs(e) >= 1000) return `${(e / 1000).toLocaleString('de-DE', { maximumFractionDigits: 1 })}k €`;
  return `${Math.round(e).toLocaleString('de-DE')} €`;
}

// ---------------------------------------------------------------- DAC7

function dac7Panel() {
  const year = period === 'alle' ? String(new Date().getFullYear()) : period;
  const rows = ONLINE_PLATFORMS.map((p) => {
    const list = state.articles.filter((a) => a.status === 'verkauft' && a.sale_platform === p && saleDate(a).startsWith(year));
    const count = list.length;
    const revenue = sum(list, (a) => a.sale_price);
    const pct = Math.max(count / DAC7.sales, revenue / DAC7.revenue);
    return { p, count, revenue, pct };
  }).filter((r) => r.count > 0).sort((a, b) => b.pct - a.pct);
  const status = (pct) => (pct >= 1 ? ['serious', '●', 'Wird gemeldet'] : pct >= 0.8 ? ['warning', '▲', 'Bald erreicht'] : ['good', '✓', 'Unter der Grenze']);
  return `<section class="panel">
    <h3>DAC7-Meldegrenze ${year}</h3>
    <p class="muted small">Plattformen melden Verkäufer ans Finanzamt, sobald sie <b>pro Plattform und Jahr</b> 30 Verkäufe
      <b>oder</b> 2.000 € Umsatz erreichen. Gemeldet heißt nicht automatisch steuerpflichtig. Wer regelmäßig einkauft, um weiterzuverkaufen,
      ist aber schnell gewerblich. Im Zweifel mit Steuerberater oder Finanzamt klären.</p>
    ${rows.length ? `<div class="dac7">${rows.map((r) => {
      const [cls, icon, label] = status(r.pct);
      return `<div class="dac7-row">
        <b>${esc(r.p)}</b>
        <div class="meter"><i class="${cls}" style="width:${Math.min(100, r.pct * 100)}%"></i></div>
        <span class="small">${r.count}/${DAC7.sales} Verkäufe · ${fmtMoney(r.revenue)}/${fmtMoney(DAC7.revenue)}</span>
        <span class="status ${cls}">${icon} ${label}</span>
      </div>`;
    }).join('')}</div>` : `<p class="muted">Noch keine Online-Verkäufe in ${year}.</p>`}
  </section>`;
}

// ---------------------------------------------------------------- Nebenkosten

function expensesPanel(expenses) {
  return `<section class="panel" id="expenses">
    <h3>Nebenkosten</h3>
    <p class="muted small">Kartons, Klebeband, Sprit zum Flohmarkt, Plattform-Abos … Alles, was nicht zu einem einzelnen Artikel gehört.</p>
    <form class="exp-form" id="exp-form">
      <label>Datum<input name="date" type="date" value="${today()}" required></label>
      <label>Kategorie<select name="category">${options(EXPENSE_CATEGORIES, 'Versandmaterial')}</select></label>
      <label class="grow">Beschreibung<input name="description" maxlength="200" placeholder="z. B. 50 Versandkartons"></label>
      <label>Betrag<input name="amount" inputmode="decimal" placeholder="0,00" required></label>
      <button class="btn primary" type="submit">Hinzufügen</button>
    </form>
    ${expenses.length ? `<div class="table-wrap"><table class="data-table">
      <thead><tr><th>Datum</th><th class="hide-sm">Kategorie</th><th>Beschreibung</th><th class="num">Betrag</th><th></th></tr></thead>
      <tbody>${expenses.map((e) => `<tr><td>${fmtDate(e.date)}</td><td class="hide-sm">${esc(e.category)}</td><td>${esc(e.description)}</td>
        <td class="num">${fmtMoney(e.amount)}</td><td><button class="icon-btn" data-exp-del="${e.id}" aria-label="Löschen">✕</button></td></tr>`).join('')}</tbody>
    </table></div>` : '<p class="muted">Keine Nebenkosten in diesem Zeitraum.</p>'}
  </section>`;
}

function wireExpenses(main) {
  $('#exp-form', main).addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    await guard(async () => {
      const amount = parseMoney(f.amount, 'Betrag');
      if (!amount) throw new Error('Bitte einen Betrag eintragen');
      await createExpense({ date: f.date, category: f.category, description: f.description.trim(), amount });
      if (!inPeriod(f.date)) period = f.date.slice(0, 4);
      await refresh();
      toast('Nebenkosten gespeichert');
    });
  });
  $$('[data-exp-del]', main).forEach((b) => b.addEventListener('click', async () => {
    const ok = await confirmDialog('Eintrag löschen?', 'Die Nebenkosten werden entfernt.', [{ label: 'Abbrechen', value: false }, { label: 'Löschen', value: true, kind: 'danger' }]);
    if (!ok) return;
    await guard(async () => { await deleteExpense(Number(b.dataset.expDel)); await refresh(); toast('Gelöscht'); });
  }));
}
