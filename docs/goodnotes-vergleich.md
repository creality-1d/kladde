# Kladde und Goodnotes 6 im Vergleich

Ziel von Kladde: Wer von Goodnotes kommt, soll ohne Umgewöhnung weiterschreiben können. Übernommen sind deshalb Anordnung und Gesten, nicht die Gestaltung: Icons, Farben und Texte sind eigene.

Stand: Kladde 0.5.0 mit den Ergänzungen aus dem Abgleich mit den Oberflächentexten der iPad-App (Goodnotes 6.5.20). „Getestet“ heißt, dass der Ablauf in den automatischen Oberflächentests (Electron mit echten Stift-, Finger- und Mauseingaben) oder Unit-Tests geprüft wurde. Die Spalte zu Goodnotes beschreibt Goodnotes 6 auf dem iPad.

## Gewohnheiten, die gleich funktionieren

| Gewohnheit | Goodnotes 6 | Kladde | Geprüft |
| --- | --- | --- | --- |
| Drei Dokumentarten: Notizbuch, Whiteboard, Textdokument | ja | ja | getestet |
| Werkzeug nochmal antippen: Einstellungen mit Schiebereglern (Spitzenschärfe, Druckempfindlichkeit, Strichstabilisierung) | ja | ja, Feld frei verschiebbar | getestet |
| Seiten nebeneinander: eine Seite pro Bildschirm | ja | ja | getestet |
| Mit zwei Fingern tippen = rückgängig, drei = wiederholen | ja | ja, abschaltbar | getestet |
| Apple Pencil doppelt antippen | Systemeinstellung (Radierer, vorheriges Werkzeug, Farbe) | folgt der Systemeinstellung, in Kladde überschreibbar | Ereignis getestet; native Anbindung nur auf dem iPad prüfbar |
| Strich am Ende halten → Form | ja | ja (Linie, Rechteck, Ellipse) | getestet |
| Nur Stift zeichnet, Finger scrollen | ja | automatisch nach dem ersten Stiftstrich oder fest | getestet |
| Seiten untereinander scrollen / nebeneinander blättern | ja | ja | getestet |
| Pinch-Zoom | ja | ja (50–500 %) | getestet |
| Werkzeugreihenfolge Stift, Radierer, Marker, Formen, Lasso, Bild, Text | ja | ja | – |
| Drei Farben und drei Stärken je Werkzeug in der Leiste | ja (Favoriten in der Leiste) | ja, nochmal tippen ändert | getestet |
| Radierer: ganze Striche / teilweise / nur Marker | ja | ja, drei Größen | getestet |
| Textmarker unter der Schrift | ja | ja | – |
| Lasso: verschieben, Größe, drehen, kopieren, ausschneiden, duplizieren, umfärben, löschen | ja | ja | getestet (Auswahl, Duplizieren); Logik unit-getestet |
| Stiftarten Füller, Kugelschreiber, Pinsel, Bleistift | ja (Bleistift in Härtegraden) | ja, ein Bleistift mit Körnung, Deckkraft folgt dem Druck | getestet |
| Strichart durchgezogen, gestrichelt, gepunktet (Stift und Formen) | ja | ja | getestet |
| Formen farbig ausfüllen | ja | ja (Rechteck, Ellipse) | getestet |
| Lasso: Freihand- oder rechteckige Auswahl | ja | ja | getestet |
| Radierer „Automatisch abwählen“ | ja | ja, zurück zum vorigen Werkzeug | getestet |
| Werkzeugposition oben/unten, Rückgängig links/rechts | ja | ja | getestet |
| Seitenzahl beim Blättern anzeigen | ja | ja, abschaltbar | getestet |
| Tastenkürzel für Werkzeuge und Zoom | ja | ja (P, E, H, S, L, T, K, R, I, Strg/⌘ +/−) | getestet |
| Wegkritzeln radiert | ja | ja, abschaltbar | getestet |
| Lineal (verschieben, drehen, Kante zieht Striche gerade) | ja | ja, rastet bei 0°/45°/90° | getestet |
| Zoom-Fenster mit Weiterrücken und Zeilenumbruch | ja | ja, Vergrößerung 1,5–5× | getestet |
| Laserpointer | ja | ja (Spur verblasst, wird nicht gespeichert) | getestet |
| Deckblätter, Papierfarben, mehr Vorlagen (Cornell, kariert klein, liniert weit) | ja (größere Auswahl) | sechs Farben, drei Papierfarben, sieben Vorlagen | getestet |
| „+“-Menü: Seite davor, danach, am Ende | ja | ja | getestet |
| Textfeld auf der Seite tippen | ja | ja | getestet |
| Seitenübersicht mit Miniaturen, Seiten verschieben/duplizieren/löschen | ja | ja | getestet |
| Neue Seite übernimmt Papier | ja | ja | getestet |
| Lesezeichen und Gliederung | ja | ja | getestet (Lesezeichen) |
| Tabs für mehrere Dokumente | ja | ja | getestet |
| Bibliothek mit Deckblättern, Ordnern, Favoriten, Zuletzt, Suche | ja | ja | getestet |
| Papierkorb mit Wiederherstellen | ja | ja | getestet |
| Suche in Handschrift | ja | ja, in der iPad-App (Apple-Texterkennung auf dem Gerät) | Ablauf getestet mit Ersatz-Erkennung; echte Erkennung nur auf dem iPad |
| Suche in PDF-Text, Treffer auf der Seite markiert | ja | ja | getestet |
| Audioaufnahme | ja, mit Wiedergabe der Schrift im Takt, Geschwindigkeit wählbar | ja, Geschwindigkeit 0,75–2×, ohne mitlaufende Schrift | Aufnahme getestet |
| Zu Seite springen | ja | ja (Seitenzahl antippen) | – |
| PDF öffnen und beschreiben | ja | ja | getestet |
| Als PDF teilen | ja | ja (iPad: System-Teilen-Blatt) | getestet (Download); Teilen-Blatt nur auf dem iPad |
| Sicherung aller Notizbücher | über iCloud | ZIP-Datei oder Nextcloud | getestet |

## Umzug von Goodnotes

| | Goodnotes 6 | Kladde |
| --- | --- | --- |
| Goodnotes-Dateien öffnen | – | ja: Handschrift, Formen, Marker, Text, Textfelder, PDF-Hintergründe |
| Viele Dateien auf einmal | – | ja, auch ZIP; Ordnerstruktur bleibt erhalten |
| Zurück nach Goodnotes | – | nein (nur PDF) |

## Was Kladde nicht hat

- KI-Funktionen, Umwandeln von Handschrift in Text, Rechtschreibprüfung und Wortvervollständigung für Handschrift
- Tape zum Abdecken und Aufdecken (Lernen), Notizzettel und Kommentare
- Präzisions- und Pixelradierer als eigene Arten (Kladde: ganze Striche, teilweise, nur Textmarker)
- Gespeicherte Stile (Schnellzugriff) und Bleistift-Härtegrade
- Links auf Seiten oder Webadressen, Präsentationsmodus, Handballenerkennung mit Schreibhaltung
- Live-Zusammenarbeit, Marketplace, Sticker
- Mitlaufende Schrift beim Abspielen von Aufnahmen
- Deckblatt-Bilder und Vorlagen aus dem Marketplace, Präsentation auf externem Bildschirm
- Bilder aus Goodnotes-Dateien (kamen in den Beispieldateien nicht vor)

## Was Kladde anders macht

- Synchronisation über die eigene Nextcloud statt iCloud oder Goodnotes-Konto
- Läuft zusätzlich auf Windows, Linux, macOS und Android
- Quelloffen, Daten als lesbares JSON
