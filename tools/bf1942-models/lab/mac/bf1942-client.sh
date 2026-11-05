#!/usr/bin/env bash
# The lab's client on a Mac: BF1942 in its CrossOver bottle, given the
# arguments of lab.py's join line (+joinServer <address:port> +isInternet 0).
# lab.py names this script as the client (BF42_MONITOR) on macOS.
set -euo pipefail
wine="${BF42_CROSSOVER:-/Applications/CrossOver.app}/Contents/SharedSupport/CrossOver/bin/wine"
exec "$wine" --bottle "${BF42_CX_BOTTLE:-BF1942}" --workdir 'C:\EA Games\Battlefield 1942' \
  'C:\EA Games\Battlefield 1942\BF1942.exe' +restart 1 "$@"
