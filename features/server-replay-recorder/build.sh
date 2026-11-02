#!/usr/bin/env bash
# Build both recorders; recorder.so is also installed into the lab server.
#   ./build.sh                build recorder.so (lnxded) + WINMM.dll (w32ded proxy)
#   WINDOWS_ONLY=1 ./build.sh WINMM.dll alone (the CI's Windows job)
#
# One shared core (src/core.c) plus a thin target layer per binary, selected
# at build time: the lnxded target compiles stage 3 in (-DREC_STAGE3=1), the
# w32ded target too (-DREC_STAGE3=1 -DREC_MSVC_VT=1: its detour layer is
# VirtualProtect byte patches with RWX trampolines; see research/w32ded-offsets.md).
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
out="$here/build"
mkdir -p "$out"
if [ -z "${WINDOWS_ONLY:-}" ]; then
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
fi
# RECORDER_ONLY=1 stops after recorder.so.
if [ -n "${RECORDER_ONLY:-}" ]; then
    exit 0
fi
# The Windows proxy: every winmm export forwards to the system's winmm.dll
# (src/winmm_exports.py writes the stubs and the .def). libgcc is linked in,
# so the dll needs nothing beyond kernel32 and msvcrt on the server.
python3 "$here/src/winmm_exports.py" "$out/gen"
i686-w64-mingw32-gcc -O2 -Wall -shared -static-libgcc -fms-extensions \
    -DREC_STAGE3=1 -DREC_MSVC_VT=1 \
    -o "$out/WINMM.dll" \
    "$here/src/core.c" "$here/src/target_w32ded.c" "$out/gen/winmm_exports.S" "$out/gen/winmm.def" \
    -lkernel32
echo "built $out/WINMM.dll"
