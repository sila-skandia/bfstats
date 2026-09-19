#!/usr/bin/env bash
# Decompile functions of bf1942_lnxded.static with a headless Ghidra.
#
#   ./decompile.sh <outdir> <0xADDR | name-regex> [...]
#   ./decompile.sh /tmp/out 0x08258d30 'ResponsePhysics::impulseOn' 'world::PhysicsNode::update'
#
# A regex is matched against `nm -C` and every matching function is decompiled.
# Output is one <addr>.c per function (names inside are mangled: pipe through
# c++filt) plus <outdir>/index.txt mapping address to demangled name.
#
# The analysed program lives in the Ghidra project ~/ghidra/linux-server (39,983
# functions, names intact). It was saved by an older Ghidra, so it needs a minor
# language upgrade that the GUI refuses to do; headless does it on open. This
# script therefore works on a throwaway COPY of the project and never touches
# the original or the GUI's open project. About 15 s plus 0.1 s per function.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
bin=/home/dylan/projects/public/bf42plus/bf1942_lnxded.static
proj_src="${LNXDED_GHIDRA_PROJECT:-$HOME/ghidra}"
out="$1"; shift
mkdir -p "$out"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
cp -r "$proj_src/linux-server.gpr" "$proj_src/linux-server.rep" "$work/"
: > "$work/list.txt"
for arg in "$@"; do
  if [[ "$arg" == 0x* ]]; then
    echo "$arg" >> "$work/list.txt"
  else
    nm -C "$bin" | grep -E ' [TtWw] ' | grep -E -- "$arg" \
      | awk '{a=$1; $1=""; $2=""; sub(/^  /,""); print "0x" a " " $0}' >> "$work/list.txt"
  fi
done
sort -u "$work/list.txt" -o "$work/list.txt"
cat "$work/list.txt" >> "$out/index.txt"; sort -u "$out/index.txt" -o "$out/index.txt"
echo "decompiling $(wc -l < "$work/list.txt") functions into $out" >&2
/opt/ghidra/support/analyzeHeadless "$work" linux-server -process bf1942_lnxded.static \
  -noanalysis -scriptPath "$here" -postScript DumpDecomp.java "$work/list.txt" "$out" \
  > "$work/headless.log" 2>&1 || { tail -30 "$work/headless.log" >&2; exit 1; }
grep -E 'decompiled ok=|NOFUNC' "$work/headless.log" >&2 || true
