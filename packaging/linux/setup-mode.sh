#!/usr/bin/env bash
# Opens Spooky Treat Station in a normal window with the setup screen open.
exec "$(dirname "$(readlink -f "$0")")/start.sh" -setup "$@"
