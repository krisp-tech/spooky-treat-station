#!/usr/bin/env bash
# Starts Spooky Treat Station (full screen). Extra options are passed on, e.g.  ./start.sh -windowed
source "$(dirname "$(readlink -f "$0")")/common.sh"
cd "$HERE"
if ! ensure_browser; then
  echo "  Starting anyway: open the address shown below in a browser."
  # started from the menu (no terminal): show the message in a window
  if [ ! -t 1 ]; then
    msg="Spooky Treat Station needs Google Chrome, Chromium or Microsoft Edge. Run ./install.sh in the Spooky Treat Station folder (in a terminal) - it can install Google Chrome for you."
    command -v zenity >/dev/null && zenity --error --title="Spooky Treat Station" --text="$msg" 2>/dev/null &
    command -v zenity >/dev/null || { command -v notify-send >/dev/null && notify-send "Spooky Treat Station" "$msg"; }
  fi
fi
exec ./SpookyTreatStation "$@"
