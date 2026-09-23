# Resell Tracker

Web-App, um Resells zu tracken: Einkauf, Verkauf, Gewinn, Hauls und fertige KI-Prompts für Inserate und Preisanalysen.

## Funktionen

- **Konten**: Registrieren, Anmelden, Passwort ändern. Jeder sieht nur seine eigenen Daten.
- **Artikel** mit fortlaufender Artikelnummer pro Konto (`#0001`, `#0002`, …). Gelöschte Nummern werden nicht neu vergeben.
- Pro Artikel: Titel, Kategorie, Marke, Größe, Farbe, Zustand, Notizen, Bild, Einkaufspreis, Versand beim Einkauf,
  Angebotspreis, Verkaufspreis, Plattform, Gebühren, Versand beim Verkauf und daraus berechneter **Gewinn** und Marge.
- **„+ Haul hinzufügen“**: mehrere Artikel auf einmal anlegen, mit **Gesamtpreis** und **Versand für alles**.
  Die Kosten werden automatisch auf die Artikel verteilt (Vorschau live im Formular):
  - nur Gesamtpreis: gleichmäßig auf alle Teile
  - Gesamtpreis + manche Einzelpreise: die Teile mit Preis behalten ihn, der Rest geht auf die ohne Preis
  - alle Teile mit Preis: anteilig auf den Gesamtpreis skaliert
  - Versand: immer anteilig zum Einkaufspreis
- Haul-Übersicht: Kosten, verkauft x/y, Ergebnis und wie viel der Kosten schon wieder drin sind.
- **KI-Prompts** bei jedem Artikel: „Titel & Verkaufsbeschreibung“ und „Preisanalyse über Plattformen“
  (Plattformen passend zur Kategorie, z. B. Cardmarket für Sammelkarten, StockX für Sneaker).
  Kopieren oder direkt in ChatGPT / Claude öffnen.
- Kennzahlen: Lagerbestand, Warenwert, Umsatz, realisierter Gewinn, ROI, Cash-Position.
- CSV-Export (für Excel, Semikolon-getrennt).

## Starten

Braucht **Node.js 22.5 oder neuer**. Keine weiteren Abhängigkeiten, kein `npm install` nötig.

```bash
cd resell-tracker
npm start
# -> http://localhost:3000
```

Umgebungsvariablen:

| Variable        | Standard          | Zweck                                                      |
|-----------------|-------------------|------------------------------------------------------------|
| `PORT`          | `3000`            | Port des Servers                                           |
| `DATA_DIR`      | `./data`          | Ort für Datenbank (`resell.db`) und hochgeladene Bilder     |
| `COOKIE_SECURE` | aus               | Auf `1` setzen, sobald die App über HTTPS läuft             |

## Online stellen

Die App braucht einen Server mit dauerhaftem Speicher (SQLite-Datei + Bilder).
**Netlify geht dafür nicht**, dort laufen nur statische Seiten und kurzlebige Funktionen.
Passend sind z. B. Render, Railway, Fly.io oder ein kleiner VPS:

- Startbefehl: `npm start` im Ordner `resell-tracker`
- ein **persistentes Volume** einhängen und `DATA_DIR` darauf zeigen lassen, sonst sind Daten nach jedem Deploy weg
- HTTPS aktivieren und `COOKIE_SECURE=1` setzen
- Backup: einfach den `DATA_DIR`-Ordner sichern

## Aufbau

```
resell-tracker/
  server.js          HTTP-Server, API, Anmeldung, SQLite (node:sqlite)
  public/
    index.html       Einstieg
    app.js           Oberfläche (Vanilla JS)
    shared.js        Kostenverteilung & Formatierung, von Server und Browser genutzt
    styles.css       Styling, Hell/Dunkel, mobil
  data/              (nicht im Git) Datenbank und Bilder
```

Geldbeträge werden intern als ganze Cent gespeichert, damit keine Rundungsfehler entstehen.
Passwörter werden mit scrypt gehasht, Sitzungen laufen über ein HttpOnly-Cookie.
