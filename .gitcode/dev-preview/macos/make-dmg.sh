#!/bin/sh
# One-click: assemble BitFun.app from this payload folder and create
# BitFun.dmg. Run inside the extracted payload folder:  sh make-dmg.sh
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
mv bitfun-desktop frontend resources mobile-web "$APP/Contents/MacOS/"
for sidecar in flashgrep*; do
  if [ -e "$sidecar" ]; then mv "$sidecar" "$APP/Contents/MacOS/"; fi
done

cat > "$APP/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>BitFun</string>
  <key>CFBundleDisplayName</key><string>BitFun</string>
  <key>CFBundleIdentifier</key><string>com.bitfun.desktop</string>
  <key>CFBundleExecutable</key><string>bitfun-desktop</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>2.0.0</string>
  <key>CFBundleVersion</key><string>2.0.0</string>
  <key>LSMinimumSystemVersion</key><string>11.0</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>NSPrincipalClass</key><string>NSApplication</string>
</dict>
</plist>
PLIST

codesign --force --deep -s - "$APP"
echo "[OK] $APP assembled and ad-hoc signed."

rm -rf dmg-stage
mkdir -p dmg-stage
cp -R "$APP" dmg-stage/
ln -sf /Applications dmg-stage/Applications
rm -f BitFun.dmg
hdiutil create -volname BitFun -srcfolder dmg-stage -ov -format UDZO BitFun.dmg
rm -rf dmg-stage
echo "[OK] BitFun.dmg created."
