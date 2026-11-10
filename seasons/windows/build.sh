#!/bin/zsh
set -euo pipefail
TASK_WINDOWS_DIR="${0:A:h}"
TASK_WEB_DIR="${TASK_WINDOWS_DIR:h}"
TASK_ROOT="${TASK_WINDOWS_DIR:h:h}"
TASK_DOTNET="${DOTNET_BIN:-$(command -v dotnet)}"
if [[ ! -x "$TASK_DOTNET" ]]; then TASK_DOTNET="$(command -v dotnet)"; fi
mkdir -p "$TASK_ROOT/artifacts"
for TASK_RID in win-x64 win-arm64; do
 TASK_DIST="$TASK_WINDOWS_DIR/dist/$TASK_RID"
 "$TASK_DOTNET" publish "$TASK_WINDOWS_DIR/Seasonote.csproj" -c Release -r "$TASK_RID" --self-contained true -p:PublishSingleFile=false -o "$TASK_DIST"
 mkdir -p "$TASK_DIST/web"
 for TASK_FILE in "$TASK_WEB_DIR"/*; do
  [[ -f "$TASK_FILE" && ( "$TASK_FILE" == *.html || "$TASK_FILE" == *.js || "$TASK_FILE" == *.css || "$TASK_FILE" == *.json ) ]] && cp "$TASK_FILE" "$TASK_DIST/web/"
 done
 for TASK_ASSET in assets vendor; do cp -R "$TASK_WEB_DIR/$TASK_ASSET/." "$TASK_DIST/web/$TASK_ASSET/"; done
 cp -R "$TASK_WINDOWS_DIR/licenses/." "$TASK_DIST/licenses/"
 cp "$TASK_WINDOWS_DIR/README.txt" "$TASK_DIST/使用方法.txt"
 cp "$TASK_WINDOWS_DIR/Diagnostics.ps1" "$TASK_DIST/Diagnostics.ps1"
 cp "$TASK_WINDOWS_DIR/Diagnostics.cmd" "$TASK_DIST/导出诊断.cmd"
 python3 - "$TASK_DIST" "$TASK_ROOT/artifacts/Seasonote-Windows-${TASK_RID#win-}.zip" <<'ZIP_PY'
from pathlib import Path
import sys, zipfile
root=Path(sys.argv[1])
with zipfile.ZipFile(sys.argv[2], 'w', zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
 for file in sorted(root.rglob('*')):
  if file.is_file() and not file.name.startswith('._') and file.name not in {'.DS_Store', '导出诊断.ps1'}:
   archive.write(file, file.relative_to(root).as_posix())
ZIP_PY
 printf '%s\n' "$TASK_DIST"
done
