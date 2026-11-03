#!/usr/bin/env bash
# The Windows recorder's tests that run under Wine: the fault guard
# (w32_guard_test.c) and the shot and hit stubs (w32_stub_test.c). Needs
# i686-w64-mingw32-gcc and wine on the path; run.sh calls it when both are
# there, and CI's Windows job runs it on the runner with Ubuntu's own
# (.github/workflows/recorder.yml).
#
#   tests/w32_wine.sh [work dir]
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
src="$here/../src"
work="${1:-$(mktemp -d)}"
mkdir -p "$work" && cd "$work"
export WINEDEBUG=-all
export WINEPREFIX="${WINEPREFIX:-$work/wineprefix}"

python3 "$src/winmm_exports.py" "$work/gen" > /dev/null
flags=(-O2 -Wno-array-bounds -fms-extensions -DREC_STAGE3=1 -DREC_MSVC_VT=1)

# The guard. The two child modes must crash: a fault outside a guard, or
# inside msvcrt, is the server's to have, never swallowed.
i686-w64-mingw32-gcc "${flags[@]}" -o w32guard.exe "$here/w32_guard_test.c" "$src/core.c" \
    gen/winmm_exports.S -lkernel32 2> build.err || { cat build.err; exit 1; }
timeout 300 wine w32guard.exe > guard.out 2>&1 || { cat guard.out; exit 1; }
for mode in crash-outside crash-libc; do
    timeout 300 wine w32guard.exe "$mode" > "$mode.out" 2>&1 || true
    if grep -q survived "$mode.out"; then echo "w32 guard: $mode was swallowed"; exit 1; fi
done
echo "recorder w32ded guard (wine): reads fail instead of faulting, guard pages stay armed, a fault in the recorder ends its pass and frees the lock, faults in the server or msvcrt are not swallowed"

# The shot and hit stubs, entered as the exe enters them.
i686-w64-mingw32-gcc "${flags[@]}" -o w32stub.exe "$here/w32_stub_test.c" "$src/core.c" \
    gen/winmm_exports.S -lkernel32 2> stub-build.err || { cat stub-build.err; exit 1; }
timeout 300 wine w32stub.exe > stub.out 2>&1 || { cat stub.out; exit 1; }
echo "recorder w32ded stubs (wine): fire, fake fire, hit, impact and hit sector hand the hooks and the originals their arguments, keep every register, and the fake-fire trampoline re-aims its call"
