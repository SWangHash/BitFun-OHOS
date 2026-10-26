#!/bin/sh
# One-click: assemble BitFun.app from this payload folder and create
# BitFun.dmg. Run inside the extracted payload folder:  sh make-dmg.sh
#
# Formal distribution signing (optional): set
#   BITFUN_SIGN_IDENTITY   "Developer ID Application: <name> (<TEAMID>)"
#   BITFUN_NOTARY_PROFILE  notarytool keychain profile (see README.txt)
# to sign with a Developer ID certificate and notarize + staple both the app
# and the dmg, so other users can open the dmg directly. Without them the
# script falls back to an ad-hoc signature (right-click -> Open on first run).
set -eu
cd "$(dirname "$0")"

for f in bitfun-desktop frontend resources mobile-web; do
  if [ ! -e "$f" ]; then
    echo "[X] missing payload item: $f (run this script inside the extracted payload folder)" >&2
    exit 1
  fi
done

APP=BitFun.app
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
# Copy instead of move so the payload survives and the script is re-runnable
# after a partial failure.
cp -R bitfun-desktop frontend resources mobile-web "$APP/Contents/MacOS/"
for sidecar in flashgrep*; do
  if [ -e "$sidecar" ]; then cp -R "$sidecar" "$APP/Contents/MacOS/"; fi
done
# App icon (staged by the package pipeline); without it Finder and the Dock
# show the generic application icon.
ICON=bitfun-app-icon.icns
if [ -f "$ICON" ]; then
  cp "$ICON" "$APP/Contents/Resources/"
else
  echo "[!] $ICON missing: BitFun.app will show the generic macOS icon" >&2
fi

cat > "$APP/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>BitFun</string>
  <key>CFBundleDisplayName</key><string>BitFun</string>
  <key>CFBundleIdentifier</key><string>com.bitfun.desktop</string>
  <key>CFBundleExecutable</key><string>bitfun-desktop</string>
  <key>CFBundleIconFile</key><string>bitfun-app-icon.icns</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>2.0.0</string>
  <key>CFBundleVersion</key><string>2.0.0</string>
  <key>LSMinimumSystemVersion</key><string>11.0</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>NSPrincipalClass</key><string>NSApplication</string>
</dict>
</plist>
PLIST

IDENTITY="${BITFUN_SIGN_IDENTITY:-}"
NOTARY_PROFILE="${BITFUN_NOTARY_PROFILE:-}"

if [ -n "$IDENTITY" ]; then
  # Hardened runtime + secure timestamp are required for notarization.
  codesign --force --deep --options runtime --timestamp -s "$IDENTITY" "$APP"
  echo "[OK] $APP signed with Developer ID: $IDENTITY"
else
  codesign --force --deep -s - "$APP"
  echo "[OK] $APP assembled and ad-hoc signed (set BITFUN_SIGN_IDENTITY + BITFUN_NOTARY_PROFILE for Developer ID signing)."
fi

if [ -n "$IDENTITY" ] && [ -n "$NOTARY_PROFILE" ]; then
  # Notarize the app itself (zipped) so the ticket stays with the app after
  # users drag it out of the mounted image. --wait blocks until Apple
  # accepts or rejects; a rejection fails the script loudly.
  rm -rf notary-stage
  mkdir -p notary-stage
  ditto -c -k --keepParent "$APP" notary-stage/BitFun-app.zip
  xcrun notarytool submit notary-stage/BitFun-app.zip --keychain-profile "$NOTARY_PROFILE" --wait
  xcrun stapler staple "$APP"
  rm -rf notary-stage
fi

rm -rf dmg-stage
mkdir -p dmg-stage
cp -R "$APP" dmg-stage/
ln -sf /Applications dmg-stage/Applications
rm -f BitFun.dmg
hdiutil create -volname BitFun -srcfolder dmg-stage -ov -format UDZO BitFun.dmg
rm -rf dmg-stage

if [ -n "$IDENTITY" ]; then
  codesign --sign "$IDENTITY" --timestamp BitFun.dmg
fi
if [ -n "$IDENTITY" ] && [ -n "$NOTARY_PROFILE" ]; then
  xcrun notarytool submit BitFun.dmg --keychain-profile "$NOTARY_PROFILE" --wait
  xcrun stapler staple BitFun.dmg
  echo "[OK] BitFun.dmg Developer ID signed, notarized and stapled; users can open it directly."
else
  echo "[OK] BitFun.dmg created."
fi
