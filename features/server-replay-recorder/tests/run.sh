#!/usr/bin/env bash
# Build the core against a fake target and check what it writes (see
# core_harness.c). Needs gcc with -m32 support.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
src="$here/../src"
work="$(mktemp -d "${TMPDIR:-/tmp}/recorder-core.XXXXXX")"
trap 'rm -rf "$work"' EXIT
for tick in 0 1; do
gcc -m32 -O2 -Wall -Wno-unused-function -DREC_STAGE3=1 -DREC_TICK=$tick -I"$src" -o "$work/harness" \
    "$here/core_harness.c" "$src/core.c" -lpthread -lm
cd "$work"
rm -rf replays
printf 'recordReplays 1\nreplaySampleHz 10\n' > recorder.con
mkdir replays
# A file already holding the second this run starts in, and the next few:
# the recorder must pick other names, not truncate them.
now=$(date +%s)
for i in 0 1 2 3; do echo taken > "replays/replay_$((now + i)).ndjson"; done
timeout 30 ./harness 2> harness.err || { cat harness.err; exit 1; }
if ! grep -q 'harness: endmap on disk' harness.err; then
    echo "gameStatus 5 was not on disk when written"; cat harness.err; exit 1
fi
if [ "$tick" = 1 ] && ! grep -q 'faulted in the tick sample' harness.err; then
    echo "tick mode: the unreadable page did not reach the fault guard"; cat harness.err; exit 1
fi
python3 - "$work/replays" "$tick" <<'PY'
import json, sys
from pathlib import Path
files = sorted(p for p in Path(sys.argv[1]).glob("replay_*.ndjson") if p.read_text() != "taken\n")
assert len(files) == 2, f"expected two recordings, got {[f.name for f in files]}"
assert all("-" in f.name for f in files), "a recording took a name already on disk"
first, second = ([json.loads(l) for l in f.read_text().splitlines()] for f in files)
ev = lambda rows, name: [r for r in rows if r.get("e") == name]
# 1: held before the level loaded, written at t 0
assert [r["status"] for r in ev(first, "gameStatus")] == [1] and ev(first, "gameStatus")[0]["t"] == 0
assert ev(first, "gameRules") and ev(first, "gameRules")[0]["t"] == 0
# 2: the join is recorded in the same file, its name escaped
assert ev(first, "serverInfo") and ev(first, "serverName") and ev(first, "createPlayer")
assert ev(first, "createPlayer")[0]["name"] == "Julius Haimüller"
assert all(b < 0x80 for f in files for b in f.read_bytes()), "a raw high byte in a recording"
# 3: one kill fanned out to toall + 3 clients, then the same payload 20 ms later
assert len(ev(first, "score")) == 2, ev(first, "score")
# 7: pools. The hook's 599 once (its copies and the sample's sight of the
# same pool are one); the launcher's 700 from the sample, twice (a new
# launcher with the same ids); each written again in the next file.
pools = lambda rows: [(r["netId"], r["tid"], r["count"], r["tmpl"]) for r in ev(rows, "projPool")]
assert sorted(p[:3] for p in pools(first)) == [(599, 1293, 3), (700, 4242, 4), (700, 4242, 4)], pools(first)
assert [p[3] for p in pools(first) if p[0] == 700] == ["FloatingMine"] * 2, pools(first)
assert sorted(pools(second)) == [(599, 1293, 3, "GrenadeAxisProjectile"), (700, 4242, 4, "FloatingMine")], pools(second)
# 4: the unload closes the file; the next file starts with what was held
assert first[-1]["k"] == "end"
assert [r["status"] for r in ev(second, "gameStatus")][:1] == [2] and ev(second, "gameStatus")[0]["t"] == 0
assert ev(second, "clock")
print(f"recorder core ({'tick' if sys.argv[2] == '1' else 'thread'} mode): ok ({files[0].name}, {files[1].name})")
PY
if [ "$tick" = 1 ]; then
    # The live set (tick mode): a weapon looked at while new, then scenery.
    mkdir "$work/live" && cd "$work/live"
    printf 'recordReplays 1\nreplaySampleHz 10\n' > recorder.con
    mkdir replays
    timeout 30 ../harness live 2> harness.err || { cat harness.err; exit 1; }
    grep -q 'live set hooked' harness.err || { echo "live: the set was not hooked"; cat harness.err; exit 1; }
    python3 - "$work/live/replays" <<'PY'
import json, sys
from pathlib import Path
files = sorted(Path(sys.argv[1]).glob("replay_*.ndjson"))
assert len(files) == 2, f"expected two recordings, got {[f.name for f in files]}"
first, second = ([json.loads(l) for l in f.read_text().splitlines()] for f in files)
pools = lambda rows: sorted((r["netId"], r["tmpl"]) for r in rows if r.get("e") == "projPool")
# The launcher at the level's load and again when it respawned, the kit's
# grenades once; the next file has the two standing, though both are scenery.
assert pools(first) == [(599, "GrenadeAxisProjectile"), (700, "FloatingMine"), (700, "FloatingMine")], pools(first)
assert pools(second) == [(599, "GrenadeAxisProjectile"), (700, "FloatingMine")], pools(second)
# The launcher's rounds destroyed through the server's destroyObject: one
# record each, the first also heard from a client; the teardown between
# files in neither.
destroys = lambda rows: sorted(r["netId"] for r in rows if r.get("e") == "destroyObject")
assert destroys(first) == [700, 701, 702, 703], destroys(first)
assert destroys(second) == [], destroys(second)
print("recorder core (tick mode, live set): ok")
PY
    cd "$work"
fi
done
