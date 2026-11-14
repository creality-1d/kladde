# Kladde und Goodnotes 6 im Vergleich

Ziel von Kladde: Wer von Goodnotes kommt, soll ohne Umgewöhnung weiterschreiben können. Übernommen sind deshalb Anordnung und Gesten, nicht die Gestaltung: Icons, Farben und Texte sind eigene.

Stand: Kladde 0.3.0. „Getestet“ heißt, dass der Ablauf in den automatischen Oberflächentests (Electron mit echten Stift-, Finger- und Mauseingaben) oder Unit-Tests geprüft wurde. Die Spalte zu Goodnotes beschreibt Goodnotes 6 auf dem iPad.

## Gewohnheiten, die gleich funktionieren

| Gewohnheit | Goodnotes 6 | Kladde | Geprüft |
| --- | --- | --- | --- |
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
| Stiftarten Füller, Kugelschreiber, Pinsel | ja | ja | getestet |
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
| PDF öffnen und beschreiben | ja | ja | getestet |
| Als PDF teilen | ja | ja (Teilen-Menü, sonst Download oder Druckdialog) | getestet (Download) |

## Umzug von Goodnotes

| | Goodnotes 6 | Kladde |
| --- | --- | --- |
| Goodnotes-Dateien öffnen | – | ja: Handschrift, Formen, Marker, Text, Textfelder, PDF-Hintergründe |
| Viele Dateien auf einmal | – | ja, auch ZIP; Ordnerstruktur bleibt erhalten |
| Zurück nach Goodnotes | – | nein (nur PDF) |

## Was Kladde nicht hat

- KI-Funktionen, Handschrifterkennung, Suche in Handschrift
- Live-Zusammenarbeit, Marketplace, Sticker, Audioaufnahmen, Präsentationsmodus/Laserpointer
- Deckblatt-Bilder und Vorlagen aus dem Marketplace, Präsentation auf externem Bildschirm
- Bilder aus Goodnotes-Dateien (kamen in den Beispieldateien nicht vor)

## Was Kladde anders macht

- Synchronisation über die eigene Nextcloud statt iCloud oder Goodnotes-Konto
- Läuft zusätzlich auf Windows, Linux, macOS und Android
- Quelloffen, Daten als lesbares JSON
