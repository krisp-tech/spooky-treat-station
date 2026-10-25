#!/usr/bin/env bash
# Builds the ready-to-run packages:
#   dist/SpookyTreatStation-v<version>-windows.zip      (Windows 10/11, 64-bit)
#   dist/SpookyTreatStation-v<version>-linux-x64.tar.gz (Linux, 64-bit PC)
# Usage: scripts/build.sh [version] [windows|linux|all]     (needs Go 1.22+, zip, curl)
set -euo pipefail
cd "$(dirname "$0")/.."
VERSION="${1:-1.0.0}"
WHICH="${2:-all}"
DIST="${DIST:-dist}"   # output folder (tests build into a temp folder)
rm -rf "$DIST" && mkdir -p "$DIST"

common_files() { # $1 = output folder, $2 = crlf|lf
  local out=$1 conv=cat
  [ "$2" = crlf ] && conv="sed s/\r\{0,1\}$/\r/"
  $conv LICENSE > "$out/LICENSE.txt"
  $conv THIRD_PARTY_NOTICES.md > "$out/THIRD_PARTY_NOTICES.txt"
  mkdir -p "$out/licenses"
  for f in packaging/licenses/*; do $conv "$f" > "$out/licenses/$(basename "$f")"; done
  # Natural voices: the default voice model (downloaded once into .cache/, checksums pinned)
  mkdir -p "$out/voices"
  cp .cache/piper/voices/en-us-libritts-high.onnx .cache/piper/voices/en-us-libritts-high.onnx.json .cache/piper/voices/en-us-libritts-high.MODEL_CARD.txt "$out/voices/"
}

if [ "$WHICH" = all ] || [ "$WHICH" = windows ]; then
  OUT="$DIST/windows/SpookyTreatStation"
  mkdir -p "$OUT"
  echo "Building SpookyTreatStation.exe v$VERSION (Windows) ..."
  GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go build -trimpath -ldflags "-s -w -X main.version=v$VERSION" -o "$OUT/SpookyTreatStation.exe" .
  scripts/fetch-voices.sh windows
  cp -r .cache/piper/windows/piper "$OUT/piper"
  rm -rf "$OUT/piper/pkgconfig"
  # Windows text files need CRLF line endings
  for f in packaging/windows/*; do sed 's/\r\{0,1\}$/\r/' "$f" > "$OUT/$(basename "$f")"; done
  common_files "$OUT" crlf
  (cd "$DIST/windows" && zip -qr "../SpookyTreatStation-v$VERSION-windows.zip" SpookyTreatStation)
fi

if [ "$WHICH" = all ] || [ "$WHICH" = linux ]; then
  OUT="$DIST/linux/SpookyTreatStation"
  mkdir -p "$OUT"
  echo "Building SpookyTreatStation v$VERSION (Linux x64) ..."
  GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build -trimpath -ldflags "-s -w -X main.version=v$VERSION" -o "$OUT/SpookyTreatStation" .
  scripts/fetch-voices.sh linux
  cp -r .cache/piper/linux/piper "$OUT/piper"
  rm -rf "$OUT/piper/pkgconfig"
  cp packaging/linux/* "$OUT/"
  cp assets/icon.png "$OUT/icon.png"
  chmod 755 "$OUT/SpookyTreatStation" "$OUT/piper/piper" "$OUT"/*.sh
  chmod 644 "$OUT/common.sh"
  common_files "$OUT" lf
  tar -C "$DIST/linux" -czf "$DIST/SpookyTreatStation-v$VERSION-linux-x64.tar.gz" SpookyTreatStation
fi

echo "Done:"
ls -la "$DIST"/*.zip "$DIST"/*.tar.gz 2>/dev/null || true
