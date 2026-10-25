#!/usr/bin/env bash
# Tests the Linux release package as a user gets it: build -> unpack (into a folder with a space)
# -> install.sh -> start.sh / setup-mode.sh -> autostart -> natural voices -> the show (e2e).
#   bash test/linux-package.sh
set -uo pipefail
cd "$(dirname "$0")/.."
ROOT=$(pwd)
WORK=$(mktemp -d)
trap 'pkill -f "$WORK/" 2>/dev/null; rm -rf "$WORK"' EXIT
PASS=0; FAIL=0; FAILED=()
ok()   { echo "PASS $1"; PASS=$((PASS+1)); }
bad()  { echo "FAIL $1"; echo "     $2" | head -20; FAIL=$((FAIL+1)); FAILED+=("${1%% *}"); }
check() { if eval "$2"; then ok "$1"; else bad "$1" "${3:-}"; fi; }

echo "== building the Linux package"
if ! DIST="$WORK/dist" scripts/build.sh 9.9.9 linux > "$WORK/build.log" 2>&1; then cat "$WORK/build.log"; echo "SUMMARY linux-package: 0 passed, 1 failed (build)"; exit 1; fi
TGZ="$WORK/dist/SpookyTreatStation-v9.9.9-linux-x64.tar.gz"
APP_PARENT="$WORK/my apps"; mkdir -p "$APP_PARENT"
tar -xzf "$TGZ" -C "$APP_PARENT"
APP="$APP_PARENT/SpookyTreatStation"
export HOME="$WORK/home"; mkdir -p "$HOME/Desktop"
export XDG_CONFIG_HOME="$HOME/.config" XDG_DATA_HOME="$HOME/.local/share"
NOBROWSER_PATH="/usr/bin:/bin"   # no chrome/chromium/edge on this PATH (checked below)

check "LP-01 package unpacks with the program, Piper, voice, scripts and licenses (executable bits kept)" \
  '[ -x "$APP/SpookyTreatStation" ] && [ -x "$APP/piper/piper" ] && [ -f "$APP/voices/en-us-libritts-high.onnx" ] && [ -x "$APP/start.sh" ] && [ -x "$APP/install.sh" ] && [ -f "$APP/README-LINUX.txt" ] && [ -f "$APP/licenses/GPL-3.0-espeak-ng.txt" ] && [ -f "$APP/icon.png" ] && [ ! -d "$APP/piper/pkgconfig" ]' \
  "$(ls -la "$APP")"
check "LP-02 Linux text files have Unix line endings (no CRLF)" '! grep -l $'"'"'\r'"'"' "$APP"/*.sh "$APP"/README-LINUX.txt "$APP"/LICENSE.txt >/dev/null 2>&1'
check "LP-03 the program is a static Linux x86-64 binary (runs on any distro)" 'file "$APP/SpookyTreatStation" | grep -q "ELF 64-bit.*x86-64.*statically linked"' "$(file "$APP/SpookyTreatStation")"

# --- install.sh without any browser
OUT=$(cd "$APP" && PATH="$NOBROWSER_PATH" ./install.sh < /dev/null 2>&1)
check "LP-04 install.sh without a browser explains how to install Google Chrome (and keeps going)" \
  'grep -q "needs Google Chrome" <<<"$OUT" && grep -q "google-chrome-stable_current_amd64.deb" <<<"$OUT" && grep -q "Added" <<<"$OUT"' "$OUT"
D="$XDG_DATA_HOME/applications/spooky-treat-station.desktop"
check "LP-05 install.sh adds menu + desktop icons with the right (quoted) path, icon and working folder" \
  'grep -qx "Exec=\"$APP/start.sh\"" "$D" && grep -qx "Icon=$APP/icon.png" "$D" && grep -qx "Path=$APP" "$D" && grep -q "Exec=\"$APP/setup-mode.sh\"" "$XDG_DATA_HOME/applications/spooky-treat-station-setup.desktop" && [ -f "$HOME/Desktop/spooky-treat-station.desktop" ]' \
  "$(cat "$D" 2>&1)"
if command -v desktop-file-validate >/dev/null; then
  check "LP-06 desktop files are valid" 'desktop-file-validate "$D"' "$(desktop-file-validate "$D" 2>&1)"
fi

# --- install.sh offers to install Google Chrome (interactive terminal; sudo/apt-get/wget are fakes that
#     record what they were asked to do and "install" a google-chrome)
if command -v script >/dev/null; then
  FAKEAPT="$WORK/fakeapt"; mkdir -p "$FAKEAPT"
  printf '#!/bin/sh\necho "sudo $*" >> "%s/apt-calls"; exec "$@"\n' "$WORK" > "$FAKEAPT/sudo"
  printf '#!/bin/sh\necho "apt-get $*" >> "%s/apt-calls"; printf "#!/bin/sh\\n" > "%s/google-chrome"; chmod +x "%s/google-chrome"\n' "$WORK" "$FAKEAPT" "$FAKEAPT" > "$FAKEAPT/apt-get"
  printf '#!/bin/sh\nwhile [ $# -gt 0 ]; do [ "$1" = -O ] && { shift; echo deb > "$1"; }; shift; done\necho "wget" >> "%s/apt-calls"\n' "$WORK" > "$FAKEAPT/wget"
  chmod +x "$FAKEAPT"/*
  OUT=$(cd "$APP" && printf 'y\n' | PATH="$FAKEAPT:$NOBROWSER_PATH" script -qec "./install.sh" /dev/null 2>&1)
  check "LP-19 install.sh offers to install Google Chrome and does it (download + sudo apt-get install the .deb)" \
    'grep -q "Install Google Chrome now" <<<"$OUT" && grep -q "Google Chrome installed" <<<"$OUT" && grep -q "^wget" "$WORK/apt-calls" && grep -q "sudo apt-get install -y .*google-chrome-stable_current_amd64.deb" "$WORK/apt-calls"' \
    "$OUT $(cat "$WORK/apt-calls" 2>&1)"
  rm -f "$WORK/apt-calls"
  OUT=$(cd "$APP" && printf 'n\n' | PATH="$WORK/fakeapt-none:$NOBROWSER_PATH" script -qec "./install.sh" /dev/null 2>&1)
  check "LP-20 answering No installs nothing" '[ ! -f "$WORK/apt-calls" ] && grep -q "install a browser later" <<<"$OUT"' "$OUT"
fi

# --- a fake browser that records how it was started
FAKEBIN="$WORK/fakebin"; mkdir -p "$FAKEBIN"
printf '#!/bin/sh\necho "$@" >> "%s/browser-calls"\n' "$WORK" > "$FAKEBIN/google-chrome"; chmod +x "$FAKEBIN/google-chrome"
OUT=$(cd "$APP" && PATH="$FAKEBIN:$NOBROWSER_PATH" ./install.sh < /dev/null 2>&1)
check "LP-07 install.sh finds an installed browser" 'grep -q "Browser: $FAKEBIN/google-chrome" <<<"$OUT"' "$OUT"

# --- start.sh: server + browser in kiosk mode, natural voices from the package
PORT=8895
(cd "$APP" && PATH="$FAKEBIN:$NOBROWSER_PATH" ./start.sh -port $PORT > "$WORK/start.log" 2>&1 &)
for i in $(seq 1 50); do curl -s "http://127.0.0.1:$PORT/api/info" >/dev/null && break; sleep 0.1; done
sleep 1
check "LP-08 start.sh starts the show and opens the browser full screen (kiosk) with its private profile" \
  'grep -q -- "--kiosk" "$WORK/browser-calls" && grep -q "http://127.0.0.1:$PORT/" "$WORK/browser-calls" && grep -q -- "--user-data-dir=$APP/browser-profile" "$WORK/browser-calls"' \
  "$(cat "$WORK/browser-calls" "$WORK/start.log" 2>&1)"
check "LP-09 camera pre-allowed for the show in the private browser profile" \
  'grep -q "http://127.0.0.1:$PORT,\*" "$APP/browser-profile/Default/Preferences"'
ST=$(curl -s "http://127.0.0.1:$PORT/api/tts/status")
check "LP-10 the bundled Piper + voice are found next to the program" 'grep -q "\"available\":true" <<<"$ST" && grep -q "Voices      : natural" "$WORK/start.log"' "$ST $(cat "$WORK/start.log")"
CODE=$(curl -s -o "$WORK/v.wav" -w "%{http_code}" -X POST "http://127.0.0.1:$PORT/api/tts" -d '{"text":"Happy Halloween!","voice":"en-us-libritts-high","speaker":624,"lengthScale":1.06}')
check "LP-11 the packaged Piper generates speech on Linux" '[ "$CODE" = 200 ] && head -c 4 "$WORK/v.wav" | grep -q RIFF && [ -f "$APP/voice-cache/"*.wav ]' "HTTP $CODE $(head -c 200 "$WORK/v.wav")"

# --- setup-mode.sh while it is running (no show page connected -> opens a setup window)
: > "$WORK/browser-calls"
OUT=$(cd "$APP" && PATH="$FAKEBIN:$NOBROWSER_PATH" timeout 10 ./setup-mode.sh -port $PORT 2>&1)
check "LP-12 setup-mode.sh while running reuses the running program and opens the setup window" \
  'grep -q "already running" <<<"$OUT" && grep -q -- "--app=http://127.0.0.1:$PORT/?setup=1" "$WORK/browser-calls"' "$OUT $(cat "$WORK/browser-calls")"
curl -s -X POST "http://127.0.0.1:$PORT/api/quit" >/dev/null; sleep 0.7
check "LP-13 Exit app stops the program and its Piper voice processes" '! pgrep -f "$APP/SpookyTreatStation" >/dev/null && ! pgrep -f "$APP/piper/piper" >/dev/null' "$(pgrep -af "$APP")"

# --- start.sh without a browser: still starts the server and prints help
(cd "$APP" && PATH="$NOBROWSER_PATH" timeout 4 ./start.sh -port $((PORT+1)) < /dev/null > "$WORK/start2.log" 2>&1)
check "LP-14 start.sh without a browser: explains Chrome install and still serves the show address" \
  'grep -q "needs Google Chrome" "$WORK/start2.log" && grep -q "http://127.0.0.1:$((PORT+1))/" "$WORK/start2.log"' "$(cat "$WORK/start2.log")"

# --- autostart + remove
(cd "$APP" && ./autostart-on.sh > /dev/null)
A="$XDG_CONFIG_HOME/autostart/spooky-treat-station.desktop"
check "LP-15 autostart-on.sh adds a login autostart entry" 'grep -qx "Exec=\"$APP/start.sh\"" "$A"'
(cd "$APP" && ./autostart-off.sh > /dev/null)
check "LP-16 autostart-off.sh removes it" '[ ! -f "$A" ]'
(cd "$APP" && ./autostart-on.sh > /dev/null && ./install.sh --remove > /dev/null)
check "LP-17 install.sh --remove removes menu, desktop and autostart entries (and nothing else)" \
  '[ ! -f "$D" ] && [ ! -f "$HOME/Desktop/spooky-treat-station.desktop" ] && [ ! -f "$A" ] && [ -x "$APP/SpookyTreatStation" ]'

# --- the whole show with the packaged binary (headless Chromium + fake camera)
if [ -f test/approach.y4m ]; then
  if timeout 300 node test/e2e.mjs "$APP/SpookyTreatStation" test/approach.y4m "$WORK/e2e" --expect adults --port $((PORT+2)) > "$WORK/e2e.log" 2>&1; then ok "LP-18 the packaged Linux program runs the full show (adult walk-up e2e)"
  else bad "LP-18 the packaged Linux program runs the full show (adult walk-up e2e)" "$(grep -E '^(FAIL|E2E)' "$WORK/e2e.log")"; fi
fi

echo
echo "SUMMARY linux-package: $PASS passed, $FAIL failed${FAILED:+ (${FAILED[*]})}"
[ "$FAIL" = 0 ]
