# Kladde

Handschriftliche Notizen auf iPad, Android, Windows, Linux und macOS, synchronisiert über die eigene Nextcloud. Kladde öffnet Goodnotes-6-Dateien (`.goodnotes`), damit bestehende Notizen mitkommen.

Kladde ist eine eigenständige App. Sie enthält keinen Code und keine Gestaltung von Goodnotes; das Dateiformat wurde nur aus eigenen exportierten Dokumenten erschlossen (siehe [docs/goodnotes-format.md](docs/goodnotes-format.md)).

## Funktionen

Kladde ist so aufgebaut, dass man von Goodnotes ohne Umgewöhnung weiterarbeiten kann: dieselbe Anordnung (Bibliothek mit Deckblättern, Werkzeugleiste oben, Farben und Stärken rechts, Seitenübersicht links) und dieselben Gesten. Icons und Gestaltung sind eigene. Ein Vergleich mit Goodnotes 6 steht in [docs/goodnotes-vergleich.md](docs/goodnotes-vergleich.md).

**Schreiben**
- Stift mit Druckempfindlichkeit (Apple Pencil, S Pen, Grafiktabletts) als Füller, Kugelschreiber oder Pinsel; Textmarker, Radierer, Formen, Lasso, Bild, Text, Laserpointer
- Drei Lieblingsfarben und drei Strichstärken pro Werkzeug; nochmal tippen ändert Farbe oder Stärke
- Strich am Ende kurz halten: wird zur geraden Linie, zum Rechteck oder zur Ellipse (Form-Werkzeug begradigt immer)
- Textmarker liegt unter Schrift und Tinte
- Wegkritzeln radiert, was darunter geschrieben steht
- Lineal: mit einem Finger verschieben, mit zwei drehen (rastet bei 0°, 45°, 90° ein); Striche an der Kante werden gerade
- Zoom-Fenster: groß schreiben, klein auf der Seite; rückt am rechten Rand weiter, springt in die nächste Zeile und auf die nächste Seite
- Radierer in drei Größen: ganze Striche, teilweise oder nur Textmarker
- Lasso: verschieben, Größe ändern (Eckgriff), drehen (Kreisgriff, auch Text und Bilder), kopieren, ausschneiden, einfügen, duplizieren, umfärben, löschen
- Textfelder direkt auf der Seite tippen und bearbeiten
- Bilder einfügen; ein neues Bild ist gleich ausgewählt

**Gesten**
- Mit zwei Fingern tippen: rückgängig; mit drei Fingern: wiederholen (auch Strg+Z / Strg+Y)
- Apple Pencil doppelt antippen: Radierer, vorheriges Werkzeug oder Farbe, wie in den iPad-Einstellungen
- Handballenerkennung; „Nur Stift zeichnet“ (automatisch, sobald ein Stift benutzt wurde, oder fest), Finger scrollen mit Schwung
- Zwei-Finger-Pinch zoomt, Strg+Mausrad am Rechner

**Notizbücher**
- Seiten untereinander scrollen oder nebeneinander blättern
- Seitenübersicht mit Miniaturen: Seiten einfügen (davor/danach), duplizieren, verschieben (ziehen oder Menü), löschen, Papier ändern
- Neue Seiten übernehmen Papier und Format der aktuellen Seite
- Lesezeichen und Gliederung
- Mehrere Notizbücher als Tabs
- Bibliothek mit Deckblättern, Ordnern, „Zuletzt“, Favoriten, Papierkorb und Suche
- Suche in Handschrift (iPad-App, Texterkennung von Apple direkt auf dem Gerät), in PDF-Text und getipptem Text; Treffer werden auf der Seite markiert, auch aus der Bibliothek heraus
- Audioaufnahme pro Notizbuch (Mikrofon-Knopf oben), Liste mit Abspielen, Teilen, Löschen und Sprung zur Seite; wird mitsynchronisiert
- Auf die Seitenzahl tippen springt zu einer Seite
- Beim Hineinzoomen wird die Seite schärfer gerendert
- Papier liniert, liniert weit, kariert, kariert klein, gepunktet, Cornell, blanko; Papierfarbe weiß, creme oder dunkel; A4 hoch oder quer
- Deckblätter in sechs Farben oder die erste Seite als Deckblatt

**Import, Export, Sync**
- Import von Goodnotes-6-Dateien (Handschrift, Formen, Textmarker, getippter Text, Textfelder, PDF-Hintergründe), auch viele auf einmal oder als ZIP mit Ordnern; PDFs werden zu Notizbüchern
- Export als echte PDF-Datei über das Teilen-Menü (auf dem iPad über das System-Teilen-Blatt: Dateien, AirDrop, Mail …)
- Datensicherung: alle Notizbücher mit PDFs, Bildern und Aufnahmen als eine ZIP-Datei (Einstellungen); einzelne Notizbücher als .kladde.zip weitergeben. Einspielen über „Importieren“, dabei gehen neuere Änderungen nicht verloren
- Erinnerung an eine Sicherung, wenn ohne Nextcloud zwei Wochen lang keine gemacht wurde
- Nextcloud-Sync über WebDAV mit App-Passwort; Notizbücher und PDF-Anhänge. Synchronisiert beim Start, 20 Sekunden nach der letzten Änderung und beim Wechsel in den Hintergrund
- Offline nutzbar; Daten liegen lokal auf dem Gerät. Gespeichert wird seitenweise kurz nach jeder Pause, auch große Notizbücher bremsen den Stift nicht

## Installation

| Plattform | Paket | Bauen |
| --- | --- | --- |
| Windows | `Kladde Setup <version>.exe` oder portable `Kladde <version>.exe` | `npm run dist:win` |
| Linux | `Kladde-<version>.AppImage`, `kladde-<version>.tar.gz` | `npm run dist:linux` (AppImage unter Linux oder in Docker) |
| macOS | `Kladde-<version>.dmg` | `npm run dist:mac` (nur auf einem Mac) |
| Android | `app-debug.apk` | `npx vite build && npx cap sync android`, dann `android/gradlew assembleDebug` (JDK 21, Android SDK 36) |
| iPad | `Kladde-<version>.ipa` | auf einem Mac: `npm run ios:ipa`, Anleitung in [docs/ios-ipa.md](docs/ios-ipa.md) |
| iPad über AltStore | AltStore-Quelle `…/releases/latest/download/altstore.json` | Git-Tag `v<version>` pushen, Anleitung in [docs/altstore.md](docs/altstore.md) |
| iPad ohne Mac | Web-App | `dist/` auf einen Webserver legen, in Safari öffnen, „Zum Home-Bildschirm“ |

Der Workflow [.github/workflows/build.yml](.github/workflows/build.yml) baut alle Pakete auf GitHub, auch macOS und iOS auf Mac-Runnern.

Die Pakete sind nicht signiert. Windows SmartScreen und macOS Gatekeeper warnen deshalb beim ersten Start. Auf dem iPad läuft eine mit kostenloser Apple-ID signierte App 7 Tage; für dauerhafte Installation oder TestFlight braucht es das Apple Developer Program.

## Nextcloud einrichten

1. In Nextcloud unter **Einstellungen → Sicherheit → Geräte & Sitzungen** ein App-Passwort für Kladde erzeugen.
2. In Kladde **Nextcloud-Konto** öffnen: Server-URL (z. B. `https://cloud.example.org`), Benutzername, App-Passwort und Ordner (Standard `Kladde`) eintragen.
3. **Mit Nextcloud synchronisieren** tippen; danach synchronisiert Kladde automatisch. Jedes Notizbuch liegt als `<id>.kladde.json` im Ordner, PDFs als `<id>.attachment`.

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

Ehrlich gesagt deckt Kladde nicht alles ab, was Goodnotes 6 kann:

- **Nicht vorhanden:** KI-Funktionen (Goodnotes nutzt dafür eigene Cloud-Modelle), Umwandeln von Handschrift in Text, Live-Zusammenarbeit, Marketplace, Sticker, Präsentationsmodus mit externem Bildschirm, Deckblatt-Bilder und Papiervorlagen aus einem Marketplace.
- **Handschriftsuche** gibt es nur in der iPad-App (sie nutzt Apples Texterkennung); auf Windows, Linux, Android und im Browser werden PDF-Text und getippter Text durchsucht.
- **Audio:** Aufnahmen laufen nur, solange Kladde im Vordergrund ist; beim Wechsel in eine andere App wird die Aufnahme beendet und gespeichert. Die Schrift wird beim Abspielen nicht mitgezeigt.
- **Goodnotes-Import:** Formatwechsel innerhalb eines Absatzes werden vereinfacht, Zeilenumbrüche können leicht abweichen; Bilder und andere Elementarten waren in den Beispieldateien nicht enthalten und werden noch nicht übernommen. Es gibt keinen Export zurück ins Goodnotes-Format.
- **Sync:** gleichzeitige Bearbeitung derselben Seite auf zwei Geräten wird nicht zusammengeführt; die zuletzt geänderte Fassung gewinnt.
