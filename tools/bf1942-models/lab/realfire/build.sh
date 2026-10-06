#!/usr/bin/env bash
# Build realfire.so (see realfire.c) into the lab install, beside the recorder.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
lab="${BF42_LAB:-$HOME/bf1942-lab}/server"
mkdir -p "$lab"
# A new inode, renamed into place: a running server keeps what it mapped.
gcc -m32 -O2 -Wall -Wextra -fPIC -shared -o "$lab/realfire.so.new" "$here/realfire.c"
mv -f "$lab/realfire.so.new" "$lab/realfire.so"
echo "installed $lab/realfire.so"
