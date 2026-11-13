# Inknotes

Handschriftliche Notizen auf iPad, Android, Windows, Linux und macOS, synchronisiert über die eigene Nextcloud. Inknotes öffnet Goodnotes-6-Dateien (`.goodnotes`), damit bestehende Notizen mitkommen.

Inknotes ist eine eigenständige App. Sie enthält keinen Code und keine Gestaltung von Goodnotes; das Dateiformat wurde nur aus eigenen exportierten Dokumenten erschlossen (siehe [docs/goodnotes-format.md](docs/goodnotes-format.md)).

## Funktionen

- Notizbücher mit Seitenvorlagen (liniert, kariert, gepunktet, blanko) und beliebigen Seitengrößen
- Stift mit Druckempfindlichkeit (Apple Pencil, S Pen, Grafiktabletts), Textmarker, Radierer
- Form-Werkzeug: gezeichnete Linien, Rechtecke und Ellipsen werden begradigt
- Lasso: Striche, Texte und Bilder auswählen, verschieben, löschen und über den Eckgriff vergrößern oder verkleinern
- Rückgängig/Wiederholen (Strg+Z / Strg+Y), Zoom (Knöpfe, Strg+Mausrad, Zwei-Finger-Pinch)
- Bilder einfügen
- Ordner und Suche (Titel, Ordner, getippter Text)
- Handballenerkennung: Während der Stift schreibt, werden Fingerberührungen ignoriert. Sobald einmal mit dem Stift geschrieben wurde, scrollt ein Finger, statt zu zeichnen
- Textfelder
- PDF als Seitenhintergrund (importierte Goodnotes-Arbeitsblätter, Papiervorlagen)
- Export als PDF über den Druckdialog
- Import von Goodnotes-6-Dateien: Handschrift, Formen, Textmarker, getippter Text, Textfelder, PDF-Hintergründe
- Nextcloud-Sync über WebDAV mit App-Passwort; Notizbücher und PDF-Anhänge. Synchronisiert beim Start, 20 Sekunden nach der letzten Änderung und beim Wechsel in den Hintergrund
- Offline nutzbar; Daten liegen lokal auf dem Gerät

## Installation

| Plattform | Paket | Bauen |
| --- | --- | --- |
| Windows | `Inknotes Setup <version>.exe` oder portable `Inknotes <version>.exe` | `npm run dist:win` |
| Linux | `Inknotes-<version>.AppImage`, `inknotes-<version>.tar.gz` | `npm run dist:linux` (AppImage unter Linux oder in Docker) |
| macOS | `Inknotes-<version>.dmg` | `npm run dist:mac` (nur auf einem Mac) |
| Android | `app-debug.apk` | `npx vite build && npx cap sync android`, dann `android/gradlew assembleDebug` (JDK 21, Android SDK 36) |
| iPad | `Inknotes-<version>.ipa` | auf einem Mac: `npm run ios:ipa`, Anleitung in [docs/ios-ipa.md](docs/ios-ipa.md) |
| iPad über AltStore | AltStore-Quelle `…/releases/latest/download/altstore.json` | Git-Tag `v<version>` pushen, Anleitung in [docs/altstore.md](docs/altstore.md) |
| iPad ohne Mac | Web-App | `dist/` auf einen Webserver legen, in Safari öffnen, „Zum Home-Bildschirm“ |

Der Workflow [.github/workflows/build.yml](.github/workflows/build.yml) baut alle Pakete auf GitHub, auch macOS und iOS auf Mac-Runnern.

Die Pakete sind nicht signiert. Windows SmartScreen und macOS Gatekeeper warnen deshalb beim ersten Start. Auf dem iPad läuft eine mit kostenloser Apple-ID signierte App 7 Tage; für dauerhafte Installation oder TestFlight braucht es das Apple Developer Program.

## Nextcloud einrichten

1. In Nextcloud unter **Einstellungen → Sicherheit → Geräte & Sitzungen** ein App-Passwort für Inknotes erzeugen.
2. In Inknotes **Nextcloud-Konto** öffnen: Server-URL (z. B. `https://cloud.example.org`), Benutzername, App-Passwort und Ordner (Standard `Inknotes`) eintragen.
3. **Mit Nextcloud synchronisieren** tippen; danach synchronisiert Inknotes automatisch. Jedes Notizbuch liegt als `<id>.inknote.json` im Ordner, PDFs als `<id>.attachment`.

Änderungen an verschiedenen Seiten auf verschiedenen Geräten werden zusammengeführt. Wird dieselbe Seite auf zwei Geräten zwischen zwei Syncs bearbeitet, gewinnt die zuletzt geänderte Fassung dieser Seite.

**Web-App:** Browser erlauben Anfragen an eine andere Domain nur, wenn der Server das per CORS freigibt. Die Desktop-, Android- und iOS-Apps umgehen das. Für die Web-App entweder `dist/` unter derselben Domain wie die Nextcloud ausliefern oder im Webserver der Nextcloud CORS für die Domain der Web-App erlauben (inklusive `PROPFIND`, `MKCOL`, `PUT`, `Authorization`).

## Entwicklung

```sh
npm ci
npm run dev          # Browser
npm run desktop      # Electron
npm test             # Unit-Tests
GOODNOTES_SAMPLES=test-samples npm test   # zusätzlich eigene .goodnotes-Dateien
```

`test-samples/` ist von Git ausgeschlossen und landet nie in einem App-Build.

## Grenzen

Ehrlich gesagt deckt Inknotes nicht alles ab, was Goodnotes 6 kann:

- **Nicht vorhanden:** KI-Funktionen (Goodnotes nutzt dafür eigene Cloud-Modelle), Handschrifterkennung und Suche in Handschrift, Live-Zusammenarbeit, Marketplace, Audioaufnahmen, Sticker, Lesezeichen, Präsentationsmodus, Drehen einer Auswahl.
- **Goodnotes-Import:** Formatwechsel innerhalb eines Absatzes werden vereinfacht, Zeilenumbrüche können leicht abweichen; Bilder und andere Elementarten waren in den Beispieldateien nicht enthalten und werden noch nicht übernommen. Es gibt keinen Export zurück ins Goodnotes-Format.
- **Sync:** gleichzeitige Bearbeitung derselben Seite auf zwei Geräten wird nicht zusammengeführt; die zuletzt geänderte Fassung gewinnt.
