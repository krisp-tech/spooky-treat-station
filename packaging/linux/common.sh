# Shared helpers for the Linux scripts (sourced, not run directly).

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Prints the browser that will be used, or nothing. Same order as the program: Edge, Chrome, Chromium.
find_browser() {
  for b in microsoft-edge microsoft-edge-stable google-chrome google-chrome-stable chromium chromium-browser; do
    command -v "$b" 2>/dev/null && return 0
  done
  [ -x /snap/bin/chromium ] && echo /snap/bin/chromium && return 0
  return 1
}

chrome_help() {
  cat <<'TXT'

  Spooky Treat Station needs Google Chrome, Chromium or Microsoft Edge (it shows the show in it).
  Install Google Chrome (Ubuntu / Linux Mint / Debian, 64-bit PC):
      wget https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb
      sudo apt install ./google-chrome-stable_current_amd64.deb
  Fedora:
      sudo dnf install https://dl.google.com/linux/direct/google-chrome-stable_current_x86_64.rpm
  Or install "Chromium" from your software center.

TXT
}

# If no browser is found: explain, and on a terminal offer to install Google Chrome.
ensure_browser() {
  find_browser >/dev/null && return 0
  chrome_help
  [ -t 0 ] || return 1                      # not interactive (e.g. autostart): just explain
  [ "$(uname -m)" = x86_64 ] || return 1    # Google Chrome is only made for 64-bit PCs
  local cmd=""
  if command -v apt-get >/dev/null; then cmd=apt; elif command -v dnf >/dev/null; then cmd=dnf; else return 1; fi
  read -r -p "  Install Google Chrome now? It needs your password. [y/N] " yn
  case "$yn" in y|Y|yes|YES) ;; *) return 1 ;; esac
  local tmp; tmp="$(mktemp -d)"
  if [ "$cmd" = apt ]; then
    local deb="$tmp/google-chrome-stable_current_amd64.deb"
    if command -v wget >/dev/null; then wget -q --show-progress -O "$deb" https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb
    else curl -fL -o "$deb" https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb; fi
    sudo apt-get install -y "$deb"
  else
    sudo dnf install -y https://dl.google.com/linux/direct/google-chrome-stable_current_x86_64.rpm
  fi
  rm -rf "$tmp"
  find_browser >/dev/null && echo "  Google Chrome installed." && return 0
  echo "  Installation did not work - please install Google Chrome by hand (see above)."
  return 1
}

# Writes a .desktop launcher file. $1 = file, $2 = name, $3 = script to run (absolute path), $4 = comment
write_desktop() {
  case "$3" in *'"'*|*'$'*|*'`'*|*'\'*) echo "  The folder path contains \" \$ \` or \\ - please move the folder (e.g. to ~/SpookyTreatStation)."; return 1 ;; esac
  mkdir -p "$(dirname "$1")"
  cat > "$1" <<DESK
[Desktop Entry]
Type=Application
Name=$2
Comment=$4
Exec="$3"
Path=$HERE
Icon=$HERE/icon.png
Terminal=false
Categories=Game;Video;
DESK
  chmod +x "$1"
}
