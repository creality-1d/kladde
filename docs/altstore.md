# Inknotes über AltStore installieren und aktualisieren

AltStore installiert Apps außerhalb des App Stores und signiert sie mit deiner Apple-ID. Inknotes veröffentlicht dafür eine **AltStore-Quelle**: eine Datei `altstore.json`, die AltStore liest, um die App zu finden, herunterzuladen und über neue Versionen zu informieren. SideStore liest das gleiche Format.

## So entsteht eine Quelle

Der Workflow [.github/workflows/altstore.yml](../.github/workflows/altstore.yml) läuft bei jedem Git-Tag `v*` auf einem Mac-Runner von GitHub:

1. Er prüft, dass der Tag zur Version in `package.json` passt (`v0.2.0` ↔ `"version": "0.2.0"`).
2. Er baut mit `npm run ios:ipa` eine unsignierte `.ipa`. Das Build-Skript schreibt daneben eine `.ipa.json` mit der `Info.plist` der gebauten App, Größe und SHA-256.
3. [scripts/altstore-source.mjs](../scripts/altstore-source.mjs) erzeugt daraus `altstore.json`. Version, Build-Nummer, Bundle-ID und Mindest-iPadOS stammen aus der gebauten App, ältere Versionen aus der bisher veröffentlichten Quelle.
4. Er legt ein GitHub-Release mit `.ipa`, `altstore.json` und `icon.png` an. Die Änderungsnotizen sind die Commit-Betreffzeilen seit dem letzten Tag.

Die Quelle liegt dann immer unter derselben Adresse:

```
https://github.com/<besitzer>/<repo>/releases/latest/download/altstore.json
```

Das Repository muss **öffentlich** sein, weil AltStore die Dateien ohne Anmeldung lädt.

## Eine neue Version veröffentlichen

```sh
npm version 0.2.0 --no-git-tag-version   # Version in package.json erhöhen
git commit -am "chore: release 0.2.0"
git tag v0.2.0
git push && git push --tags
```

Nach etwa 10 Minuten ist das Release fertig (Reiter **Actions** zeigt den Fortschritt). AltStore zeigt die neue Version beim nächsten Aktualisieren der Quelle an.

## Auf dem iPad einrichten

Einmalig:

1. **AltServer** auf dem Windows-PC oder Mac installieren: [altstore.io](https://altstore.io). Unter Windows braucht AltServer zusätzlich iTunes und iCloud von Apple (nicht die Microsoft-Store-Versionen; die Download-Links stehen auf altstore.io).
2. iPad per Kabel verbinden, im AltServer-Menü (Taskleiste bzw. Menüleiste) **Install AltStore → iPad** wählen und mit der Apple-ID anmelden.
3. Auf dem iPad: **Einstellungen → Allgemein → VPN & Geräteverwaltung**, dem Zertifikat deiner Apple-ID vertrauen. Ab iPadOS 16 zusätzlich **Einstellungen → Datenschutz & Sicherheit → Entwicklermodus** einschalten.

Inknotes hinzufügen:

1. AltStore öffnen, **Quellen** (Sources) → **+**.
2. Die Adresse der Quelle eintragen (siehe oben), bestätigen.
3. Inknotes in der Quelle öffnen, **Free** bzw. **Installieren** tippen.

## Was du wissen musst

- **7 Tage:** Mit einer kostenlosen Apple-ID signierte Apps laufen 7 Tage. AltStore erneuert sie automatisch, wenn der PC mit AltServer im selben WLAN läuft, oder per Kabel über **Meine Apps → Aktualisieren**. Läuft die Signatur ab, startet die App nicht mehr, die Notizen bleiben aber auf dem iPad.
- **3 Apps:** Eine kostenlose Apple-ID darf höchstens 3 selbst signierte Apps gleichzeitig aktiv haben; AltStore zählt mit.
- **Updates:** Eine neue Version lässt sich nur installieren, wenn ihre Build-Nummer höher ist. Der Workflow nimmt dafür die Anzahl der Git-Commits; deshalb nie die Historie von `main` umschreiben.
- **Mindestens iPadOS 16.4**, weil der PDF-Renderer neuere Safari-Funktionen braucht. AltStore lehnt ältere Geräte direkt ab.
- **Ohne GitHub:** Jeder HTTPS-Server geht, auch ein öffentlich geteilter Nextcloud-Ordner. Auf einem Mac `npm run ios:ipa` ausführen, `.ipa` und `icon.png` hochladen und die Quelle mit deren öffentlichen Adressen erzeugen:
  ```sh
  node scripts/altstore-source.mjs --meta release/Inknotes-0.2.0-unsigned.ipa.json \
    --download-url https://…/Inknotes-0.2.0-unsigned.ipa --icon-url https://…/icon.png \
    --source-url https://…/altstore.json --previous altstore.json --out altstore.json
  ```
  `--previous` beim ersten Mal weglassen. Danach `altstore.json` hochladen und deren Adresse in AltStore eintragen.
