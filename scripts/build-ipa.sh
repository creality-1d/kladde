#!/usr/bin/env bash
# Builds an Inknotes .ipa on a Mac. See docs/ios-ipa.md.
#
#   npm run ios:ipa                          unsigned .ipa; Sideloadly or AltStore sign it with your Apple ID
#   TEAM_ID=ABCDE12345 npm run ios:ipa       signed by Xcode with your Apple ID or developer team
#
# Optional:
#   METHOD=debugging|release-testing|app-store-connect   export method for signed builds (default debugging)
#   BUNDLE_ID=de.example.inknotes            bundle id if org.inknotes.app is taken for your team
#   BUILD_NUMBER=42                          CFBundleVersion (default: number of git commits)
set -euo pipefail
cd "$(dirname "$0")/.."

fail() { echo "Fehler: $*" >&2; exit 1; }
[[ "$(uname)" == "Darwin" ]] || fail "Eine .ipa lässt sich nur auf macOS mit Xcode bauen."
command -v xcodebuild >/dev/null || fail "xcodebuild fehlt. Xcode aus dem App Store installieren und einmal öffnen."
xcode-select -p | grep -q "Xcode" || fail "Die Kommandozeilentools zeigen nicht auf Xcode: sudo xcode-select -s /Applications/Xcode.app"
command -v node >/dev/null || fail "Node.js fehlt (siehe docs/ios-ipa.md)."

VERSION=$(node -p "require('./package.json').version")
BUILD_NUMBER=${BUILD_NUMBER:-$(git rev-list --count HEAD 2>/dev/null || echo 1)}
WORK=release/ios-build
PROJECT=ios/App/App.xcodeproj
mkdir -p "$WORK" release

if [[ -n "${BUNDLE_ID:-}" ]]; then
  # Only the app target carries a bundle id in this project; a global override would also rename packages.
  sed -i '' "s/PRODUCT_BUNDLE_IDENTIFIER = [^;]*;/PRODUCT_BUNDLE_IDENTIFIER = $BUNDLE_ID;/" "$PROJECT/project.pbxproj"
  echo "Bundle-ID im Xcode-Projekt auf $BUNDLE_ID gesetzt (lokale Änderung an $PROJECT/project.pbxproj)."
fi

[[ -d node_modules ]] || npm ci
npx vite build
npx cap sync ios

BUILD_SETTINGS=(MARKETING_VERSION="$VERSION" CURRENT_PROJECT_VERSION="$BUILD_NUMBER")

if [[ -z "${TEAM_ID:-}" ]]; then
  echo "Baue unsignierte .ipa …"
  xcodebuild -project "$PROJECT" -scheme App -configuration Release -destination generic/platform=iOS \
    -derivedDataPath "$WORK/derived" "${BUILD_SETTINGS[@]}" \
    CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO CODE_SIGN_IDENTITY="" build
  rm -rf "$WORK/Payload"
  mkdir "$WORK/Payload"
  cp -R "$WORK/derived/Build/Products/Release-iphoneos/App.app" "$WORK/Payload/"
  IPA="release/Inknotes-$VERSION-unsigned.ipa"
  rm -f "$IPA"
  (cd "$WORK" && zip -qry "../$(basename "$IPA")" Payload)
  echo "Fertig: $IPA"
  echo "Mit Sideloadly oder AltStore auf das iPad bringen; sie signieren mit deiner Apple-ID."
  exit 0
fi

METHOD=${METHOD:-debugging}
ARCHIVE="$WORK/Inknotes.xcarchive"
echo "Baue signierte .ipa für Team $TEAM_ID (Methode $METHOD) …"
rm -rf "$ARCHIVE" "$WORK/export"
xcodebuild -project "$PROJECT" -scheme App -configuration Release -destination generic/platform=iOS \
  -archivePath "$ARCHIVE" -allowProvisioningUpdates "${BUILD_SETTINGS[@]}" \
  DEVELOPMENT_TEAM="$TEAM_ID" CODE_SIGN_STYLE=Automatic archive

cat > "$WORK/ExportOptions.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>method</key><string>$METHOD</string>
  <key>teamID</key><string>$TEAM_ID</string>
  <key>signingStyle</key><string>automatic</string>
  <key>stripSwiftSymbols</key><true/>
</dict>
</plist>
PLIST

xcodebuild -exportArchive -archivePath "$ARCHIVE" -exportPath "$WORK/export" \
  -exportOptionsPlist "$WORK/ExportOptions.plist" -allowProvisioningUpdates
IPA="release/Inknotes-$VERSION.ipa"
cp "$WORK/export/"*.ipa "$IPA"
echo "Fertig: $IPA"
