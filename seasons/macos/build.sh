#!/bin/zsh
set -euo pipefail
TASK_MAC_DIR="${0:A:h}"
TASK_WEB_DIR="${TASK_MAC_DIR:h}"
TASK_APP="$TASK_MAC_DIR/Seasonote.app"
mkdir -p "$TASK_APP/Contents/MacOS" "$TASK_APP/Contents/Resources"
# Standard macOS icon representations, generated from the turntable artwork.
TASK_ICONSET=$(mktemp -d "${TMPDIR:-/tmp}/seasonote-icons.XXXXXX")
trap 'rm -rf "$TASK_ICONSET"' EXIT
mkdir -p "$TASK_ICONSET/Seasonote.iconset"
for TASK_SIZE in 16 32 128 256 512; do
  /usr/bin/sips -z "$TASK_SIZE" "$TASK_SIZE" "$TASK_WEB_DIR/assets/seasonote-icon.png" --out "$TASK_ICONSET/Seasonote.iconset/icon_${TASK_SIZE}x${TASK_SIZE}.png" >/dev/null
  TASK_DOUBLE=$((TASK_SIZE * 2))
  /usr/bin/sips -z "$TASK_DOUBLE" "$TASK_DOUBLE" "$TASK_WEB_DIR/assets/seasonote-icon.png" --out "$TASK_ICONSET/Seasonote.iconset/icon_${TASK_SIZE}x${TASK_SIZE}@2x.png" >/dev/null
done
/usr/bin/iconutil -c icns "$TASK_ICONSET/Seasonote.iconset" -o "$TASK_APP/Contents/Resources/Seasonote.icns"
TASK_MUSIC_DIR="$TASK_WEB_DIR/../music-connection/macos"
if [[ ! -f "$TASK_MUSIC_DIR/音乐连接验证器.app/Contents/Resources/mediaremote-adapter.pl" ]]; then
  zsh "$TASK_MUSIC_DIR/build.sh"
fi
for TASK_ARCH in arm64 x86_64; do
  /usr/bin/swiftc -swift-version 5 -O -target "$TASK_ARCH-apple-macos13.0" -framework AppKit -framework WebKit -framework Network "$TASK_MAC_DIR/SeasonDesktop.swift" "$TASK_MUSIC_DIR/MusicBridge.swift" -o "$TASK_APP/Contents/MacOS/SeasonDesktop.$TASK_ARCH"
done
/usr/bin/lipo -create "$TASK_APP/Contents/MacOS/SeasonDesktop.arm64" "$TASK_APP/Contents/MacOS/SeasonDesktop.x86_64" -output "$TASK_APP/Contents/MacOS/SeasonDesktop"
rm "$TASK_APP/Contents/MacOS/SeasonDesktop.arm64" "$TASK_APP/Contents/MacOS/SeasonDesktop.x86_64"
/usr/bin/ditto "$TASK_MUSIC_DIR/音乐连接验证器.app/Contents/Resources/MediaRemoteAdapter.framework" "$TASK_APP/Contents/Resources/MediaRemoteAdapter.framework"
cp "$TASK_MUSIC_DIR/音乐连接验证器.app/Contents/Resources/mediaremote-adapter.pl" "$TASK_APP/Contents/Resources/"
cp "$TASK_MUSIC_DIR/音乐连接验证器.app/Contents/Resources/MediaRemoteAdapter-LICENSE.txt" "$TASK_APP/Contents/Resources/"
cat > "$TASK_APP/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleName</key><string>Seasonote</string>
<key>CFBundleDisplayName</key><string>Seasonote</string>
<key>CFBundleIconFile</key><string>Seasonote.icns</string>
<key>CFBundleIdentifier</key><string>local.seasons.desktop.preview</string>
<key>CFBundleExecutable</key><string>SeasonDesktop</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleShortVersionString</key><string>0.4.0</string>
<key>CFBundleVersion</key><string>7</string>
<key>LSUIElement</key><false/>
<key>LSMinimumSystemVersion</key><string>13.0</string>
<key>NSHighResolutionCapable</key><true/>
<key>NSAppTransportSecurity</key><dict><key>NSAllowsLocalNetworking</key><true/></dict>
</dict></plist>
PLIST
# Bundle a self-contained snapshot when the web implementation is available.
if [[ -f "$TASK_WEB_DIR/index.html" ]]; then
  mkdir -p "$TASK_APP/Contents/Resources/web"
  for TASK_ASSET in "$TASK_WEB_DIR"/*; do
    [[ -f "$TASK_ASSET" && ( "$TASK_ASSET" == *.html || "$TASK_ASSET" == *.js || "$TASK_ASSET" == *.css || "$TASK_ASSET" == *.json ) ]] && cp "$TASK_ASSET" "$TASK_APP/Contents/Resources/web/"
  done
  # Explicit allowlist: local textures and Three.js modules only. Private
  # review/reference.mp4 and work/ are intentionally outside the app bundle.
  for TASK_ASSET_DIR in assets vendor; do
    if [[ -d "$TASK_WEB_DIR/$TASK_ASSET_DIR" ]]; then
      /usr/bin/ditto "$TASK_WEB_DIR/$TASK_ASSET_DIR" "$TASK_APP/Contents/Resources/web/$TASK_ASSET_DIR"
    fi
  done
fi
/usr/bin/codesign --force --sign - "$TASK_APP"
printf '%s\n' "$TASK_APP"
