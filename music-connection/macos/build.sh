#!/bin/zsh
set -euo pipefail
TASK_DIR="${0:A:h}"
TASK_ROOT="${TASK_DIR:h}"
TASK_APP="$TASK_DIR/音乐连接验证器.app"
TASK_VENDOR="$TASK_ROOT/vendor/mediaremote-adapter"
TASK_RES="$TASK_APP/Contents/Resources"
mkdir -p "$TASK_RES/MediaRemoteAdapter.framework/Resources" "$TASK_APP/Contents/MacOS"
/usr/bin/python3 - "$TASK_APP" <<'PY'
import plistlib,sys,pathlib
p=pathlib.Path(sys.argv[1])
(p/'Contents/Info.plist').write_bytes(plistlib.dumps({'CFBundleIdentifier':'local.seasons.music-connection','CFBundleExecutable':'MusicConnection','CFBundleName':'音乐连接验证器','CFBundleDisplayName':'音乐连接验证器','CFBundlePackageType':'APPL','CFBundleShortVersionString':'0.1.0','CFBundleVersion':'1','LSMinimumSystemVersion':'13.0','NSHighResolutionCapable':True}))
(p/'Contents/Resources/MediaRemoteAdapter.framework/Resources/Info.plist').write_bytes(plistlib.dumps({'CFBundleIdentifier':'local.seasons.mediaadapter','CFBundleExecutable':'MediaRemoteAdapter','CFBundlePackageType':'FMWK','CFBundleVersion':'1','CFBundleName':'MediaRemoteAdapter'}))
PY
TASK_SOURCES=( "$TASK_VENDOR"/src/adapter/*.m "$TASK_VENDOR"/src/private/*.m "$TASK_VENDOR"/src/utility/*.m )
/usr/bin/xcrun clang -dynamiclib -fobjc-arc -fvisibility=default -O2 -arch arm64 -arch x86_64 -mmacosx-version-min=13.0 -I"$TASK_VENDOR/include" -I"$TASK_VENDOR/src" "${TASK_SOURCES[@]}" -framework Foundation -framework AppKit -framework UniformTypeIdentifiers -install_name @rpath/MediaRemoteAdapter.framework/MediaRemoteAdapter -o "$TASK_RES/MediaRemoteAdapter.framework/MediaRemoteAdapter"
cp "$TASK_VENDOR/bin/mediaremote-adapter.pl" "$TASK_RES/"
cp "$TASK_VENDOR/LICENSE" "$TASK_RES/MediaRemoteAdapter-LICENSE.txt"
for TASK_ARCH in arm64 x86_64; do
  /usr/bin/xcrun swiftc -swift-version 5 -O -target "$TASK_ARCH-apple-macos13.0" -framework AppKit "$TASK_DIR/MusicBridge.swift" "$TASK_DIR/main.swift" -o "$TASK_APP/Contents/MacOS/MusicConnection.$TASK_ARCH"
done
/usr/bin/lipo -create "$TASK_APP/Contents/MacOS/MusicConnection.arm64" "$TASK_APP/Contents/MacOS/MusicConnection.x86_64" -output "$TASK_APP/Contents/MacOS/MusicConnection"
rm "$TASK_APP/Contents/MacOS/MusicConnection.arm64" "$TASK_APP/Contents/MacOS/MusicConnection.x86_64"
/usr/bin/codesign --force --sign - "$TASK_RES/MediaRemoteAdapter.framework"
/usr/bin/codesign --force --sign - "$TASK_APP"
printf '%s\n' "$TASK_APP"
