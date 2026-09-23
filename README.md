# Resell Tracker

Web-App, um Resells zu tracken: Einkauf, Verkauf, Gewinn, Hauls, Crosslisting, Ladenhüter, Auswertung und fertige KI-Prompts.
Läuft kostenlos mit **Supabase** (Konto, Datenbank, Fotos) und **Netlify** (Oberfläche). Kein eigener Server nötig.

## Funktionen

- **Artikel** mit fortlaufender Nummer (`#0001`, `#0002`, …), Einkauf, Verkauf, Gewinn, Marge, Lagerort und bis zu 12 Fotos
- **„+ Haul hinzufügen“**: viele Teile auf einmal, Gesamtpreis und Versand werden automatisch verteilt (Vorschau live):
  - nur Gesamtpreis → gleichmäßig
  - Gesamtpreis + manche Einzelpreise → die mit Preis behalten ihn, der Rest geht auf die ohne
  - alle mit Preis → anteilig auf den Gesamtpreis skaliert
  - Versand immer anteilig zum Einkaufspreis
- **Crosslisting-Tracker**: abhaken, wo ein Artikel online ist. Nach dem Verkauf warnt die App, wo du ihn noch löschen musst.
- **Ladenhüter-Warnung**: Lagerdauer pro Artikel, Markierung ab 30/60/90 Tagen, Vorschlag zur Preissenkung mit einem Tipp
- **Auswertung**: Gewinn pro Monat, beste Einkaufsquelle, Plattform und Kategorie (mit ROI), Ø Tage bis Verkauf
- **DAC7-Zähler**: Verkäufe und Umsatz pro Plattform und Jahr, Warnung vor 30 Verkäufen / 2.000 €
- **Nebenkosten** (Kartons, Sprit, Abos …), werden vom Gewinn abgezogen
- **QR-Etiketten** zum Ausdrucken. Scannen mit der Handykamera öffnet direkt den Artikel.
- **KI-Prompts** für Inserat und Preisanalyse, kopieren oder direkt in ChatGPT/Claude öffnen
- **Als App aufs Handy** (PWA), CSV-Export für Excel, Hell/Dunkel-Modus

## Einrichten (geht komplett am Handy, ca. 15 Minuten)

### 1. Supabase-Projekt anlegen
1. Auf [supabase.com](https://supabase.com) mit GitHub anmelden → **New project**.
2. Name z. B. `resell-tracker`, ein Datenbank-Passwort vergeben (notieren, brauchst du für die App aber nicht),
   Region **Central EU (Frankfurt)**. Plan: **Free**.
3. Warten, bis das Projekt fertig ist (1–2 Minuten).

### 2. Datenbank einrichten
1. Links **SQL Editor** → **New query**.
2. Den kompletten Inhalt von [`supabase/schema.sql`](supabase/schema.sql) hineinkopieren
   (auf GitHub die Datei öffnen → Knopf „Copy raw file“).
3. **Run** drücken. Es muss „Success. No rows returned“ kommen. Falls Supabase vor „destructive operations“ warnt:
   bestätigen, das Skript löscht keine Daten (nur alte Regeln, bevor es sie neu anlegt).

### 3. Dein Konto anlegen und Registrierung sperren
1. Links **Authentication** → **Users** → **Add user** → **Create new user**.
2. E-Mail und Passwort eintragen, **Auto Confirm User** anhaken → **Create user**.
3. Links **Authentication** → **Sign In / Providers** (bei älteren Oberflächen: *Settings*):
   **Allow new users to sign up** ausschalten und speichern. Damit kann sich niemand sonst ein Konto machen.

### 4. Schlüssel kopieren
**Project Settings** → **API Keys** (bzw. **Data API**):
- **Project URL**, sieht aus wie `https://abcdefgh.supabase.co`
- **publishable** Key (`sb_publishable_…`) oder, bei älteren Projekten, der **anon public** Key (`eyJ…`)

⚠ Niemals den **secret** / **service_role** Key verwenden. Der Build bricht ab, falls du es doch versuchst.

### 5. Netlify verbinden
1. Auf [app.netlify.com](https://app.netlify.com) → **Add new site** → **Import an existing project** → GitHub → `resell-tracker`.
2. Build-Einstellungen kommen aus `netlify.toml`, einfach **Deploy** drücken.
3. **Site configuration** → **Environment variables** → zwei Variablen anlegen:
   - `SUPABASE_URL` = Project URL aus Schritt 4
   - `SUPABASE_KEY` = publishable/anon Key aus Schritt 4
4. **Deploys** → **Trigger deploy** → **Deploy site**, damit die Werte übernommen werden.

### 6. Passwort-vergessen-Link aktivieren
In Supabase: **Authentication** → **URL Configuration** → **Site URL** = deine Netlify-Adresse
(z. B. `https://resell-timo.netlify.app`). Sonst führt der Link in der E-Mail ins Leere.

Der eingebaute E-Mail-Versand von Supabase schickt nur wenige Mails pro Stunde und nur an Adressen
aus deinem Supabase-Team. Für ein Konto nur für dich reicht das, solange du dieselbe E-Mail benutzt.

### 7. Als App aufs Handy
Netlify-Adresse im Handy öffnen, anmelden, dann:
- **iPhone (Safari):** Teilen → „Zum Home-Bildschirm“
- **Android (Chrome):** Menü ⋮ → „App installieren“

## Gut zu wissen

- **Pausieren:** Im Gratis-Plan pausiert Supabase ein Projekt nach ca. einer Woche ohne Zugriff. Die Daten bleiben erhalten,
  im Supabase-Dashboard auf „Restore project“ tippen. Wer die App regelmäßig nutzt, merkt davon nichts.
- **Speicher:** Gratis sind 500 MB Datenbank und 1 GB Dateien. Fotos werden vor dem Hochladen verkleinert
  (groß + Vorschau zusammen ca. 200–400 KB), das reicht für einige Tausend Fotos.
- **Backup:** Unter *Konto* → „Alle Artikel als CSV“. Fotos sind nicht in der CSV.
- **Sicherheit:** Jede Tabelle und jeder Foto-Ordner ist per Row Level Security auf das eigene Konto beschränkt.
  Der publishable/anon Key darf öffentlich sein, ohne Anmeldung gibt er keinen Zugriff auf irgendwas.
- **Offline:** Die Oberfläche startet auch ohne Netz, Daten laden und speichern braucht aber Internet.

## Lokal ausprobieren

Braucht Node.js 20+:

```bash
cp .env.example .env   # Werte eintragen
npm run dev            # -> http://localhost:5173
```

## Aufbau

```
supabase/schema.sql   Tabellen, Kostenverteilung, Trigger, Sicherheitsregeln, Foto-Speicher
public/
  index.html, styles.css, sw.js, manifest.webmanifest, icons/
  js/app.js          Start, Anmeldung, Navigation
  js/store.js        Datenzugriff (Supabase), Fotos
  js/shared.js       Rechenlogik (Kostenverteilung, Gewinn, Lagerdauer)
  js/inventory.js    Inventar
  js/article.js      Artikel: Detail, Formular, Verkauf, Crosslisting
  js/haul.js         Hauls
  js/stats.js        Auswertung, DAC7, Nebenkosten
  js/labels.js       QR-Etiketten
  js/prompts.js      KI-Prompts
  js/account.js      Konto, Export, App installieren
  vendor/            supabase-js und qrcode-generator (MIT), fest eingebunden
scripts/
  build-config.mjs   schreibt public/js/config.js aus SUPABASE_URL/SUPABASE_KEY (Netlify-Build)
  dev.mjs            lokaler Testserver
```

Geldbeträge werden als ganze Cent gespeichert. Die Kostenverteilung eines Hauls rechnet die Datenbank selbst
(`reallocate_haul`), der Browser zeigt mit identischer Logik vorher die Vorschau.
