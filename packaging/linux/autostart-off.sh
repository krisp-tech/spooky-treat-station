#!/usr/bin/env bash
# Stops the show from starting automatically at login.
rm -f "${XDG_CONFIG_HOME:-$HOME/.config}/autostart/spooky-treat-station.desktop"
echo "Spooky Treat Station will no longer start automatically."
