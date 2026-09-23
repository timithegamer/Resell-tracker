// Wird von Browser und Server gemeinsam benutzt, damit die Vorschau im
// Haul-Formular exakt dasselbe rechnet wie der Server beim Speichern.
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

// Verteilt `total` Cent auf die Gewichte, sodass die Summe exakt stimmt
// (Methode der größten Reste). Sind alle Gewichte 0, wird gleichmäßig verteilt.
export function distribute(total, weights) {
  const n = weights.length;
  if (n === 0) return [];
  let w = weights.map((x) => Math.max(0, x || 0));
  let sum = w.reduce((a, b) => a + b, 0);
  if (sum === 0) { w = w.map(() => 1); sum = n; }
  const raw = w.map((x) => (total * x) / sum);
  const out = raw.map(Math.floor);
  let rest = total - out.reduce((a, b) => a + b, 0);
  const order = raw.map((x, i) => [x - Math.floor(x), i]).sort((a, b) => b[0] - a[0]);
  for (let k = 0; rest > 0; k = (k + 1) % n, rest--) out[order[k][1]]++;
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

export function costOf(a) {
  return (a.purchase_price || 0) + (a.shipping_in || 0);
}

const euro = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' });
export function fmtMoney(cents) {
  if (cents === null || cents === undefined || Number.isNaN(cents)) return '–';
  return euro.format(cents / 100);
}

export function fmtArticleNo(n) {
  return '#' + String(n).padStart(4, '0');
}
