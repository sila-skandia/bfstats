#!/usr/bin/env bash
# Build lowfd.so (see lowfd.c) into the lab install, beside the recorder.
# lab.py runs this itself when lowfd.so is missing or older than lowfd.c.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
lab="${BF42_LAB:-$HOME/bf1942-lab}/server"
mkdir -p "$lab"
# A new inode, renamed into place: a running server keeps what it mapped.
gcc -m32 -O2 -Wall -Wextra -fPIC -shared -o "$lab/lowfd.so.new" "$here/lowfd.c" -ldl -lpthread
mv -f "$lab/lowfd.so.new" "$lab/lowfd.so"
echo "installed $lab/lowfd.so"
