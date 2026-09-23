// Fertige KI-Prompts für Inserat und Preisanalyse.

import { costOf, fmtMoney } from './shared.js';
import { $, $$, esc, copyText } from './ui.js';

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

const photoNote = (a, text) => (a.images?.length ? `\n${text}\n` : '');

function listingPrompt(a) {
  return `Du bist erfahrener Reseller und schreibst Inserate für Second-Hand-Plattformen im deutschsprachigen Raum (Vinted, eBay, Kleinanzeigen, willhaben).

Erstelle ein verkaufsstarkes Inserat auf Deutsch für diesen Artikel:
${itemFacts(a)}
${photoNote(a, 'Ich hänge Fotos an. Nutze sie für Details wie Material, Schnitt, Muster, Logos und sichtbare Mängel.')}
Liefere:
1. eBay-Titel (max. 80 Zeichen, suchoptimiert: Marke, Modell, Größe, Farbe, wichtigste Merkmale)
2. Kurzer Titel für Vinted / Kleinanzeigen / willhaben (max. 50 Zeichen)
3. Beschreibung (80–150 Wörter): ehrlich, konkret, gut lesbar, mit Zustand, Besonderheiten, Größe/Passform und Hinweis auf Versand
4. Stichpunkte der wichtigsten Fakten zum schnellen Scannen
5. 8–12 Hashtags / Suchbegriffe für Vinted und Depop
6. Welche Maße oder Angaben ich noch ergänzen sollte, damit das Inserat besser verkauft

Wichtig: Erfinde keine Angaben (Material, Maße, Modellnummer, Echtheit), die nicht aus meinen Daten oder den Fotos hervorgehen. Fehlendes als [bitte ergänzen] markieren. Mängel nicht verschweigen, aber sachlich formulieren.`;
}

function pricePrompt(a) {
  const platforms = PRICE_PLATFORMS[a.category] || DEFAULT_PLATFORMS;
  return `Mach eine Preisanalyse für einen Artikel, den ich weiterverkaufen will. Markt: Deutschland und Österreich.

Artikel:
${itemFacts(a)}
- Mein Einkaufspreis inkl. Versand: ${fmtMoney(costOf(a))}${a.listed_price !== null ? `\n- Aktuell angeboten für: ${fmtMoney(a.listed_price)}` : ''}
${photoNote(a, 'Fotos sind angehängt, nutze sie, um Modell und Zustand genauer einzuordnen.')}
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

export function promptBlocks(a) {
  const blocks = [
    ['Titel & Verkaufsbeschreibung', listingPrompt(a)],
    ['Preisanalyse über Plattformen', pricePrompt(a)],
  ];
  return blocks.map(([label, text]) => `
    <div class="prompt">
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

export function wirePrompts(root) {
  $$('.prompt', root).forEach((p) => {
    $('[data-copy]', p).addEventListener('click', () => copyText($('textarea', p).value, 'Prompt kopiert'));
  });
}
