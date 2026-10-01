#!/usr/bin/env bash
# Build both recorders and install the Windows one into the wine install.
#   ./build.sh                build WINMM.dll (w32ded proxy) + recorder.so (lnxded)
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
out="$here/build"
mkdir -p "$out"
gcc -m32 -O2 -Wall -Wextra -fPIC -shared -o "$out/recorder.so" \
    "$here/src/recorder.c" -lpthread
lab="${BF42_LAB:-$HOME/bf1942-lab}/server"
if [ -d "$lab" ]; then
    cp "$out/recorder.so" "$lab/recorder.so"
    echo "installed $lab/recorder.so"
fi
i686-w64-mingw32-gcc -O2 -Wall -shared -fms-extensions \
    -fasynchronous-unwind-tables -o "$out/WINMM.dll" \
    "$here/src/w32ded-recorder.c" -lkernel32
echo "built $out/WINMM.dll"
