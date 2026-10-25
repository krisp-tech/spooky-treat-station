#!/usr/bin/env bash
# One-time setup: checks for a browser (offers to install Google Chrome) and adds
# "Spooky Treat Station" + "Spooky Treat Station Setup" to your applications menu (and desktop).
#   ./install.sh            install
#   ./install.sh --remove   remove the menu/desktop icons and autostart again
source "$(dirname "$(readlink -f "$0")")/common.sh"
APPS="${XDG_DATA_HOME:-$HOME/.local/share}/applications"
DESKTOP="$(command -v xdg-user-dir >/dev/null && xdg-user-dir DESKTOP 2>/dev/null || echo "$HOME/Desktop")"

if [ "${1:-}" = "--remove" ]; then
  rm -f "$APPS/spooky-treat-station.desktop" "$APPS/spooky-treat-station-setup.desktop" \
        "$DESKTOP/spooky-treat-station.desktop" "$DESKTOP/spooky-treat-station-setup.desktop" \
        "${XDG_CONFIG_HOME:-$HOME/.config}/autostart/spooky-treat-station.desktop"
  echo "Removed the Spooky Treat Station icons and autostart. (This folder itself was not touched.)"
  exit 0
fi

echo "Spooky Treat Station - one-time setup"
chmod +x "$HERE"/*.sh "$HERE/SpookyTreatStation" "$HERE/piper/piper" 2>/dev/null
if b=$(find_browser); then echo "  Browser: $b"; else ensure_browser || echo "  (You can install a browser later and run ./install.sh again.)"; fi

write_desktop "$APPS/spooky-treat-station.desktop" "Spooky Treat Station" "$HERE/start.sh" "Halloween show (full screen)" || exit 1
write_desktop "$APPS/spooky-treat-station-setup.desktop" "Spooky Treat Station Setup" "$HERE/setup-mode.sh" "Set up camera, zones and voices"
ON_DESKTOP=""
if [ -d "$DESKTOP" ]; then
  ON_DESKTOP=" and desktop"
  cp "$APPS/spooky-treat-station.desktop" "$APPS/spooky-treat-station-setup.desktop" "$DESKTOP/"
  # GNOME: allow launching the desktop icons without the "untrusted" question
  command -v gio >/dev/null && for f in "$DESKTOP"/spooky-treat-station*.desktop; do gio set "$f" metadata::trusted true 2>/dev/null; done
fi
echo "  Added \"Spooky Treat Station\" and \"Spooky Treat Station Setup\" to your applications menu$ON_DESKTOP."
echo
echo "Next: open \"Spooky Treat Station Setup\" (or run ./setup-mode.sh) and follow the Start here tab."
