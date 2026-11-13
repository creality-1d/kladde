# iPad-App als .ipa auf einem Mac bauen

Eine `.ipa` ist das Installationspaket einer iOS-App. Bauen lässt sie sich nur auf macOS mit Xcode. Das Skript [scripts/build-ipa.sh](../scripts/build-ipa.sh) erledigt alle Schritte; dieses Dokument erklärt, was du vorher einrichtest und welchen der zwei Wege du nimmst.

## Einmalig einrichten

1. **Xcode** aus dem Mac App Store installieren, einmal öffnen und die Zusatzkomponenten installieren lassen. Im Terminal prüfen:
   ```sh
   xcode-select -p        # muss auf /Applications/Xcode.app/... zeigen
   ```
   Falls nicht: `sudo xcode-select -s /Applications/Xcode.app`.
2. **Node.js 24** installieren, z. B. über den Installer von nodejs.org.
3. Den Projektordner `inknotes` auf den Mac bringen (Git-Clone, USB-Stick oder Cloud) und darin einmal `npm ci` ausführen.

## Weg A: Unsignierte .ipa (ohne Apple-Entwicklerkonto)

```sh
npm run ios:ipa
```

Ergebnis: `release/Inknotes-<version>-unsigned.ipa`.

Diese Datei läuft nicht direkt auf dem iPad, weil iOS nur signierte Apps startet. [Sideloadly](https://sideloadly.io) oder [AltStore](https://altstore.io) signieren sie beim Installieren mit deiner normalen Apple-ID:

1. Sideloadly auf dem Mac (oder Windows-PC) installieren, iPad per Kabel verbinden.
2. Die `.ipa` hineinziehen, Apple-ID eintragen, **Start**.
3. Auf dem iPad unter **Einstellungen → Allgemein → VPN & Geräteverwaltung** dem Entwicklerzertifikat vertrauen.
4. Ab iPadOS 16: **Einstellungen → Datenschutz & Sicherheit → Entwicklermodus** einschalten (das iPad startet neu).

Mit einer kostenlosen Apple-ID läuft die App 7 Tage, danach erneut installieren oder in AltStore „Refresh“. Die Notizen bleiben erhalten, solange die App nicht gelöscht wird; mit Nextcloud-Sync sind sie ohnehin gesichert.

Den gleichen Build erzeugt auch der GitHub-Workflow (Job `ios`, Artefakt `ios-ipa`), sobald das Projekt auf GitHub liegt. Dafür ist dann kein eigener Mac nötig.

Bequemer ist eine AltStore-Quelle: Dann installiert und aktualisiert AltStore die App direkt aus dem Netz, ohne dass du die `.ipa` von Hand kopierst. Siehe [altstore.md](altstore.md).

## Weg B: Von Xcode signierte .ipa

1. In Xcode unter **Xcode → Settings → Accounts** deine Apple-ID hinzufügen.
2. Die Team-ID ablesen: dort das Team auswählen, oder im Terminal
   ```sh
   security find-identity -v -p codesigning   # die Kennung in Klammern, z. B. (ABCDE12345)
   ```
   Fehlt dort noch ein Zertifikat, in Xcode beim Team **Manage Certificates → + → Apple Development** wählen.
3. Bei einer kostenlosen Apple-ID: das iPad einmal per Kabel verbinden und in Xcode unter **Window → Devices and Simulators** erscheinen lassen. Nur so registrierte Geräte dürfen die App installieren.
4. Bauen:
   ```sh
   TEAM_ID=ABCDE12345 npm run ios:ipa
   ```

Ergebnis: `release/Inknotes-<version>.ipa`. Installieren über den Finder (iPad in der Seitenleiste wählen, `.ipa` in das Fenster ziehen) oder in Xcode über **Devices and Simulators → +**.

| Konto | `METHOD` | Was entsteht |
| --- | --- | --- |
| Kostenlose Apple-ID | `debugging` (Standard) | läuft 7 Tage auf registrierten Geräten |
| Apple Developer Program (99 €/Jahr) | `debugging` | läuft 1 Jahr auf registrierten Geräten |
| Apple Developer Program | `release-testing` | Ad-hoc-Verteilung an registrierte Geräte |
| Apple Developer Program | `app-store-connect` | Upload zu TestFlight oder in den App Store |

Meldet Xcode, die Bundle-ID `org.inknotes.app` sei vergeben, eine eigene wählen:

```sh
TEAM_ID=ABCDE12345 BUNDLE_ID=de.deinname.inknotes npm run ios:ipa
```

Das Skript trägt sie dann ins Xcode-Projekt ein (eine lokale Änderung an `ios/App/App.xcodeproj/project.pbxproj`, die du committen oder verwerfen kannst).

## Ohne .ipa direkt aufs iPad

Für den eigenen Gebrauch ist der kürzeste Weg: iPad anschließen, `npx vite build && npx cap sync ios`, `ios/App/App.xcodeproj` in Xcode öffnen, unter **Signing & Capabilities** dein Team wählen, oben das iPad als Ziel wählen und **Run** (▶) drücken.

## Versionsnummer

Das Skript übernimmt die Version aus `package.json` (`CFBundleShortVersionString`) und die Anzahl der Git-Commits als Build-Nummer (`CFBundleVersion`). Für den App Store muss die Build-Nummer bei jedem Upload steigen; mit `BUILD_NUMBER=…` lässt sie sich festlegen.

## Häufige Fehler

- **„No Account for Team“ / „No profiles for 'org.inknotes.app' were found“:** Apple-ID fehlt in Xcode (Schritt B1) oder das iPad ist nicht registriert (Schritt B3).
- **„xcodebuild requires Xcode“:** `sudo xcode-select -s /Applications/Xcode.app`.
- **Paket `capacitor-swift-pm` lässt sich nicht laden:** Xcode lädt Capacitor beim ersten Build von GitHub; dafür braucht der Mac Internet.
- **App startet auf dem iPad nicht („Nicht vertrauenswürdiger Entwickler“):** Schritt A3 und A4.
