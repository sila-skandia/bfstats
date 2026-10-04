#!/usr/bin/env bash
# Build both recorders and install the Windows one into the wine install.
#   ./build.sh                build WINMM.dll (w32ded proxy) + recorder.so (lnxded)
#
# One shared core (src/core.c) plus a thin target layer per binary, selected
# at build time: the lnxded target compiles stage 3 in (-DREC_STAGE3=1), the
# w32ded target too (-DREC_STAGE3=1 -DREC_MSVC_VT=1: its detour layer is
# VirtualProtect byte patches with RWX trampolines; see w32ded-offsets.md).
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
out="$here/build"
mkdir -p "$out"
gcc -m32 -O2 -Wall -Wextra -fPIC -shared -DREC_STAGE3=1 -DREC_TICK=1 -o "$out/recorder.so" \
    "$here/src/core.c" "$here/src/target_lnxded.c" -lpthread
lab="${BF42_LAB:-$HOME/bf1942-lab}/server"
if [ -d "$lab" ]; then
    # A new inode, renamed into place: a running lab server keeps the copy it
    # mapped. cp over it would rewrite the pages it is executing.
    cp "$out/recorder.so" "$lab/recorder.so.new"
    mv -f "$lab/recorder.so.new" "$lab/recorder.so"
    echo "installed $lab/recorder.so"
fi
i686-w64-mingw32-gcc -O2 -Wall -shared -fms-extensions \
    -fasynchronous-unwind-tables -DREC_STAGE3=1 -DREC_MSVC_VT=1 \
    -o "$out/WINMM.dll" \
    "$here/src/core.c" "$here/src/target_w32ded.c" -lkernel32
echo "built $out/WINMM.dll"
