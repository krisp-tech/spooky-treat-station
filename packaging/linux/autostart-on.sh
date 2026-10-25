#!/usr/bin/env bash
# Starts the show automatically when you log in (desktop autostart).
source "$(dirname "$(readlink -f "$0")")/common.sh"
write_desktop "${XDG_CONFIG_HOME:-$HOME/.config}/autostart/spooky-treat-station.desktop" "Spooky Treat Station" "$HERE/start.sh" "Halloween show" || exit 1
echo "Done! Spooky Treat Station will start automatically when you log in."
echo "Tip: also turn on automatic login (Settings -> Users) so it starts after a power cut."
