// Rechenlogik der App. Die Kostenverteilung existiert zusätzlich in der
// Datenbank (supabase/schema.sql), damit die Vorschau im Haul-Formular
// exakt dasselbe zeigt, was danach gespeichert wird.
// Alle Geldbeträge sind ganze Cent-Beträge.

export const CATEGORIES = [
  'Kleidung', 'Schuhe', 'Sneaker', 'Taschen & Accessoires', 'Schmuck & Uhren',
  'Elektronik', 'Konsolen & Games', 'Sammelkarten', 'Spielzeug & LEGO',
  'Bücher & Medien', 'Möbel & Deko', 'Sport & Outdoor', 'Vintage', 'Sonstiges',
];

export const CONDITIONS = [
  'Neu mit Etikett', 'Neu ohne Etikett', 'Sehr gut', 'Gut', 'Zufriedenstellend', 'Defekt / Bastler',
];

export const STATUSES = {
  lager: 'Auf Lager',
  gelistet: 'Online gelistet',
  verkauft: 'Verkauft',
};

export const PLATFORMS = [
  'Vinted', 'eBay', 'Kleinanzeigen', 'willhaben', 'Shpock', 'Depop',
  'Vestiaire Collective', 'Grailed', 'StockX', 'Cardmarket', 'Flohmarkt', 'Privat', 'Sonstiges',
];

// Plattformen, auf denen man inserieren kann (für den Crosslisting-Tracker).
export const ONLINE_PLATFORMS = [
  'Vinted', 'eBay', 'Kleinanzeigen', 'willhaben', 'Shpock', 'Depop',
  'Vestiaire Collective', 'Grailed', 'StockX', 'Cardmarket',
];

export const EXPENSE_CATEGORIES = [
  'Versandmaterial', 'Fahrtkosten', 'Plattform-Abos & Werbung', 'Zubehör & Lager', 'Sonstiges',
];

// DAC7: Plattformen melden Verkäufer ab 30 Verkäufen ODER 2.000 € pro Jahr.
export const DAC7 = { sales: 30, revenue: 200000 };

// Lagerdauer in Tagen (ab Einkaufsdatum, sonst ab Anlage).
export function ageDays(a, now = new Date()) {
  const start = a.purchase_date ? new Date(a.purchase_date + 'T00:00:00') : new Date(a.created_at);
  const end = a.status === 'verkauft' && a.sale_date ? new Date(a.sale_date + 'T00:00:00') : now;
  return Math.max(0, Math.floor((end - start) / 86400000));
}

// Stufen für Ladenhüter: 0 = frisch, 1 = ab 30, 2 = ab 60, 3 = ab 90 Tagen.
export function ageLevel(days) {
  return days >= 90 ? 3 : days >= 60 ? 2 : days >= 30 ? 1 : 0;
}

// Verteilt `total` Cent auf die Gewichte, sodass die Summe exakt stimmt
// (Methode der größten Reste, bei Gleichstand gewinnt der vordere).
// Sind alle Gewichte 0, wird gleichmäßig verteilt. Rechnet nur mit ganzen
// Zahlen, damit das Ergebnis exakt dem von public.distribute() in der
// Datenbank entspricht (Beträge sind dort auf 100.000 € begrenzt).
export function distribute(total, weights) {
  const n = weights.length;
  if (n === 0) return [];
  let w = weights.map((x) => Math.max(0, x || 0));
  let sum = w.reduce((a, b) => a + b, 0);
  if (sum === 0) { w = w.map(() => 1); sum = n; }
  const out = [];
  const rems = [];
  w.forEach((x, i) => {
    const r = (total * x) % sum;
    out.push((total * x - r) / sum);
    rems.push([r, i]);
  });
  let rest = total - out.reduce((a, b) => a + b, 0);
  rems.sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  for (let k = 0; k < rest; k++) out[rems[k][1]]++;
  return out;
}

// Rechnet Einkaufspreis und Versandanteil jedes Artikels eines Hauls aus.
//   haul.total_price   Gesamtpreis der Ware (Cent) oder null
//   haul.shipping_cost Versand für den ganzen Haul (Cent)
//   items[i].input     vom Nutzer eingetragener Einzelpreis (Cent) oder null
// Regeln:
//   - Kein Gesamtpreis: jeder Artikel kostet seinen Einzelpreis (leer = 0).
//   - Gesamtpreis, manche Artikel ohne Preis: Artikel mit Preis behalten ihn,
//     der Rest vom Gesamtpreis wird gleichmäßig auf die ohne Preis verteilt.
//   - Gesamtpreis, alle mit Preis (oder Summe > Gesamtpreis): die Einzelpreise
//     werden anteilig so skaliert, dass sie genau den Gesamtpreis ergeben.
//   - Der Versand wird anteilig nach Einkaufspreis verteilt (alle 0: gleichmäßig).
export function allocateHaul(haul, items) {
  const n = items.length;
  const inputs = items.map((it) => (Number.isInteger(it.input) ? it.input : null));
  const given = inputs.filter((x) => x !== null);
  const sumGiven = given.reduce((a, b) => a + b, 0);
  const missing = n - given.length;
  const total = Number.isInteger(haul.total_price) ? haul.total_price : null;
  let purchase;
  let note = '';

  if (total === null) {
    purchase = inputs.map((x) => x ?? 0);
    if (missing > 0 && n > 0) note = `Kein Gesamtpreis: ${missing} Artikel ohne Einzelpreis zählen mit 0 €.`;
  } else if (missing > 0 && sumGiven <= total) {
    const shares = distribute(total - sumGiven, new Array(missing).fill(1));
    let k = 0;
    purchase = inputs.map((x) => (x === null ? shares[k++] : x));
    if (given.length) note = `${missing} Artikel ohne Preis teilen sich den Rest.`;
  } else {
    purchase = distribute(total, inputs.map((x) => x ?? 0));
    if (sumGiven !== total) {
      note = `Einzelpreise ergeben ${fmtMoney(sumGiven)}, werden anteilig auf ${fmtMoney(total)} angepasst.`;
    }
  }

  const shipping = distribute(haul.shipping_cost || 0, purchase);
  return {
    items: purchase.map((p, i) => ({ purchase_price: p, shipping_in: shipping[i] })),
    goods: purchase.reduce((a, b) => a + b, 0),
    note,
  };
}

// Gewinn eines verkauften Artikels, sonst null.
export function profitOf(a) {
  if (a.status !== 'verkauft' || !Number.isInteger(a.sale_price)) return null;
  return a.sale_price - costOf(a) - (a.sale_fees || 0) - (a.shipping_out || 0);
}

// Summe der Zusatzkosten eines Artikels (Reinigung, Reparatur …).
export function extraOf(a) {
  return (a.extra_costs || []).reduce((s, x) => s + (Number(x.amount) || 0), 0);
}

// Gesamtkosten: Einkaufspreis + Versand beim Einkauf + Zusatzkosten.
export function costOf(a) {
  return (a.purchase_price || 0) + (a.shipping_in || 0) + extraOf(a);
}

const euro = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' });
export function fmtMoney(cents) {
  if (cents === null || cents === undefined || Number.isNaN(cents)) return '–';
  return euro.format(cents / 100);
}

export function fmtArticleNo(n) {
  return '#' + String(n).padStart(4, '0');
}
