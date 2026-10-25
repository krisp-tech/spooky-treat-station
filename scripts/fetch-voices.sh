#!/usr/bin/env bash
# Downloads Piper (offline natural voices) and the default voice model into .cache/piper/
# and unpacks them. Checksums are pinned, so a changed or corrupted download is rejected.
#
#   scripts/fetch-voices.sh windows   -> .cache/piper/windows/piper/piper.exe  + .cache/piper/voices/
#   scripts/fetch-voices.sh linux     -> .cache/piper/linux/piper/piper        + .cache/piper/voices/  (for tests)
set -euo pipefail
cd "$(dirname "$0")/.."
TARGET="${1:-windows}"
C=.cache/piper
mkdir -p "$C"

PIPER_REL=https://github.com/rhasspy/piper/releases/download
fetch() { # url file sha256
  local url=$1 file=$2 sum=$3
  if [ ! -f "$C/$file" ] || ! echo "$sum  $C/$file" | sha256sum -c --quiet - 2>/dev/null; then
    echo "downloading $file ..."
    curl -fsSL --retry 3 -o "$C/$file.part" "$url"
    mv "$C/$file.part" "$C/$file"
  fi
  echo "$sum  $C/$file" | sha256sum -c --quiet - || { echo "CHECKSUM MISMATCH for $file"; rm -f "$C/$file"; exit 1; }
}

case "$TARGET" in
  windows)
    fetch "$PIPER_REL/2023.11.14-2/piper_windows_amd64.zip" piper_windows_amd64.zip f3c58906402b24f3a96d92145f58acba6d86c9b5db896d207f78dc80811efcea
    [ -f "$C/windows/piper/piper.exe" ] || { rm -rf "$C/windows"; mkdir -p "$C/windows"; (cd "$C/windows" && unzip -q ../piper_windows_amd64.zip); } ;;
  linux)
    fetch "$PIPER_REL/2023.11.14-2/piper_linux_x86_64.tar.gz" piper_linux_x86_64.tar.gz a50cb45f355b7af1f6d758c1b360717877ba0a398cc8cbe6d2a7a3a26e225992
    [ -x "$C/linux/piper/piper" ] || { rm -rf "$C/linux"; mkdir -p "$C/linux"; tar xzf "$C/piper_linux_x86_64.tar.gz" -C "$C/linux"; } ;;
  *) echo "usage: $0 windows|linux"; exit 2 ;;
esac

# Default voice: LibriTTS (904 speakers, CC BY 4.0) - one model gives every character its own voice.
fetch "$PIPER_REL/v0.0.2/voice-en-us-libritts-high.tar.gz" voice-en-us-libritts-high.tar.gz 328e3e9cb573a43a6c5e1aeca386e971232bdb1418a74d4674cf726c973a0ea8
if [ ! -f "$C/voices/en-us-libritts-high.onnx" ]; then
  mkdir -p "$C/voices"
  tar xzf "$C/voice-en-us-libritts-high.tar.gz" -C "$C/voices"
  mv "$C/voices/MODEL_CARD" "$C/voices/en-us-libritts-high.MODEL_CARD.txt"
fi
echo "Piper ($TARGET) and voices ready in $C"
