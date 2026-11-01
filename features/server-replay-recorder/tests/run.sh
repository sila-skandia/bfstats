#!/usr/bin/env bash
# Build the core against a fake target and check what it writes (see
# core_harness.c). Needs gcc with -m32 support. With node on the path the
# world run's file is also read by the viewer (replay-recording.js).
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
src="$here/../src"
work="$(mktemp -d "${TMPDIR:-/tmp}/recorder-core.XXXXXX")"
trap 'rm -rf "$work"' EXIT
# Recordings in the order they were opened: replay_<unix>[-<n>].ndjson. Sorted
# as names, "replay_T-1" comes before "replay_T".
cat > "$work/files.py" <<'PY'
import re
from pathlib import Path
def recordings(folder):
    def opened(p):
        m = re.fullmatch(r"replay_(\d+)(?:-(\d+))?\.ndjson", p.name)
        return (int(m.group(1)), int(m.group(2) or 0))
    return sorted((p for p in Path(folder).glob("replay_*.ndjson") if p.read_text() != "taken\n"), key=opened)
PY
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
PYTHONPATH="$work" python3 - "$work/replays" "$tick" <<'PY'
import json, sys
from files import recordings
files = recordings(sys.argv[1])
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
# 8 and 9 are reported together: each names what it found.
bad = []
def check(name, ok, found):
    if not ok: bad.append(f"{name}: {found}")
# 8: chat from its pieces, the client recorder's record. No roster here, so
# the text is the line alone. One record a line though three clients were
# sent it; the line cut short and the leaver's are not written; the server's
# own is pid -1; forty unfinished lines do not stop the next.
chat = [(r["pid"], r["team"], r["text"]) for r in first if r.get("k") == "chat"]
check("8 chat lines", chat == [
    (2, 0, "the bridge is down, go round by the ford"), (4, 0, "ok"),
    (-1, 0, "Server restarts at 22:00"), (2, 0, "last")], chat)
pieces = [r["text"] for r in ev(first, "chat") if r["pid"] == 2]
check("8 a piece's text ends at its length", pieces == ["the bridge is d", "own, go round b", "y the ford", "last"], pieces)
# 9: the kit again after the destroyObject on its id (the repeat before it is
# dropped); the controlled object again for the pid's next player.
kits = [r["netId"] for r in ev(first, "pickupKit") if r["pid"] == 9]
check("9 pickupKit after a destroyObject on its id", kits == [760, 760], kits)
controls = [r["netId"] for r in ev(first, "control") if r["pid"] == 8]
check("9 control for a pid's next player", controls == [770, 770], controls)
if bad:
    sys.exit("recorder core: " + "; ".join(bad))
print(f"recorder core ({'tick' if sys.argv[2] == '1' else 'thread'} mode): ok ({files[0].name}, {files[1].name})")
PY
if [ "$tick" = 1 ]; then
    # The live set (tick mode): a weapon looked at while new, then scenery.
    mkdir "$work/live" && cd "$work/live"
    printf 'recordReplays 1\nreplaySampleHz 10\n' > recorder.con
    mkdir replays
    timeout 30 ../harness live 2> harness.err || { cat harness.err; exit 1; }
    grep -q 'live set hooked' harness.err || { echo "live: the set was not hooked"; cat harness.err; exit 1; }
    PYTHONPATH="$work" python3 - "$work/live/replays" <<'PY'
import json, sys
from files import recordings
files = recordings(sys.argv[1])
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
    # The world (tick mode, a sample a tick): root objects, an Armor, a
    # roster and the chat handler's slot.
    mkdir "$work/world" && cd "$work/world"
    printf 'recordReplays 1\nreplaySampleHz 30\n' > recorder.con
    mkdir replays
    timeout 30 ../harness world 2> harness.err || { cat harness.err; exit 1; }
    PYTHONPATH="$work" python3 - "$work/world/replays" "$work/world/harness.err" <<'PY'
import json, sys
from pathlib import Path
from files import recordings
files = recordings(sys.argv[1])
assert len(files) == 2, f"expected two recordings, got {[f.name for f in files]}"
log = Path(sys.argv[2]).read_text()
bad = []
def check(name, ok, found):
    if not ok: bad.append(f"{name}: {found}")
def rows_of(f):
    rows, broken = [], []
    for n, line in enumerate(f.read_text().splitlines()):
        try: rows.append(json.loads(line))
        except ValueError: broken.append(line[:100])
    return rows, broken
(first, broken1), (second, broken2) = rows_of(files[0]), rows_of(files[1])
ev = lambda rows, name: [r for r in rows if r.get("e") == name]
at = lambda rows, pick: next((i for i, r in enumerate(rows) if pick(r)), None)
entries = lambda rows, k, arr, nid: [e for r in rows if r.get("k") == k for e in r[arr] if e[0] == nid]

# 10: what was held before the first file, and between the two.
check("10 a held clock is not carried", not [r for r in ev(first, "clock") if r["t"] == 0], ev(first, "clock"))
check("10 the last held gameStatus", [r["status"] for r in ev(first, "gameStatus")] == [3], ev(first, "gameStatus"))
held = sorted(r["name"] for r in ev(first, "createPlayer") if r["t"] == 0)
check("10 each held createPlayer, not the leaver's", held == ["Alpha", "Bravo", "Charlie"], held)
check("10 no held destroyPlayer", not [r for r in ev(first, "destroyPlayer") if r["t"] == 0], ev(first, "destroyPlayer"))
check("10 a held kill is not carried", not [r for r in ev(first, "score") if r["t"] == 0], ev(first, "score"))
made = [r["netId"] for r in ev(second, "createObject")]
check("10 a full buffer drops its oldest", made and made[-1] == 3099 and 2000 not in made and len(made) <= 1024,
      (made[:1], made[-1:], len(made)))
check("10 the held gameStatus after a full buffer", [r["status"] for r in ev(second, "gameStatus")] == [2], ev(second, "gameStatus"))

# 11: the tank that never moves has its place and hit points from first sight.
o800 = at(first, lambda r: r.get("k") == "o" and r["id"] == 800)
s800 = at(first, lambda r: r.get("k") == "s" and any(e[0] == 800 for e in r["o"]))
check("11 first sight writes the pose", s800 is not None and o800 < s800 and first[s800]["t"] == first[o800]["t"]
      and entries(first, "s", "o", 800)[0][1:4] == [100, 20, 300], entries(first, "s", "o", 800)[:1])
check("11 first sight writes the hit points", entries(first, "a", "a", 800)[:1] == [[800, 100, -1]], entries(first, "a", "a", 800)[:1])

# 12: the jeep's turn from yaw 90 to 102, where the summed differences cancel.
turns = [e[5] for e in entries(first, "s", "o", 801)]
check("12 a turn near yaw 90 is written", any(abs(q - 0.777) < 0.002 for q in turns), turns)

# 13: values that are not numbers.
check("13 every line is JSON", not broken1 and not broken2, (broken1 + broken2)[:3])
check("13 no sample for a place that is not a number", not entries(first, "s", "o", 802), entries(first, "s", "o", 802)[:2])
o803 = [r for r in first if r.get("k") == "o" and r["id"] == 803]
check("13 the o record without a maxhp that is not a number", len(o803) == 1 and "maxhp" not in o803[0], o803)
check("13 the hit beside it is written", [800, 90, -1] in entries(first, "a", "a", 800), entries(first, "a", "a", 800))
check("13 no hit points that are not a number", all(isinstance(e[1], (int, float)) for e in entries(first, "a", "a", 803)), entries(first, "a", "a", 803))

# 14: net id 805, the jeep's (gid 0x2005) and then the tank's (0x2006).
d805 = at(first, lambda r: r.get("k") == "d" and r["id"] == 805)
o805 = at(first, lambda r: r.get("k") == "o" and r["id"] == 805 and r["gid"] == 0x2006)
s805 = at(first, lambda r: r.get("k") == "s" and any(e[0] == 805 and e[1] == 71 for e in r["o"]))
check("14 the d of the old life before the o of the new", None not in (d805, o805) and d805 < o805, (d805, o805))
check("14 one d for the old life", len([r for r in first if r.get("k") == "d" and r["id"] == 805]) == 1, d805)
check("14 the new life's o before its s", None not in (o805, s805) and o805 < s805, (o805, s805))

# 15: chat through the handler's slot, as the chat box shows it.
check("15 the chat handler's slot is hooked", "harness: chat handler hooked" in log, log.splitlines()[:8])
chat = [(r["pid"], r["team"], r["text"]) for r in first if r.get("k") == "chat"]
check("15 chat lines", chat == [
    (5, 1, "Alpha Dog: hello all"), (6, 2, "Bravo [allies]: push left"), (-1, 0, "Server restarts at 22:00"),
    (5, 1, "Alpha Dog: grüß dich"),
    (6, 2, "Bravo: sixty-three characters is the most a line of chat can hold, ok?")], chat)
check("15 its pieces are still events", len(ev(first, "chat")) == 1, ev(first, "chat"))
check("15 no raw high byte", all(b < 0x80 for f in files for b in f.read_bytes()), "")

# 16: pid 5's second player controls the first one's net id.
c5 = [r["netId"] for r in ev(first, "control") if r["pid"] == 5]
check("16 control for the pid's next player, once", c5 == [800, 800], c5)
check("16 the first player's destroyPlayer", [r["pid"] for r in ev(first, "destroyPlayer")] == [5], ev(first, "destroyPlayer"))

# 17: 40 faulted samples a file is not 64; then 70 in the second file.
check("17 sampling goes on after 40 faults a file", any(e[1] == 77 for e in entries(second, "s", "o", 801)), entries(second, "s", "o", 801))
check("17 the 64th fault closes the file", "recording stopped" in log and second and second[-1].get("k") == "end"
      and len([r for r in second if r.get("k") == "end"]) == 1, second[-1:])
check("17 nothing is written after it", not [r for r in ev(second, "score") if r["kind"] == 8]
      and not any(e[1] == 99 for e in entries(second, "s", "o", 801)), ev(second, "score"))
check("the first file ends", first and first[-1].get("k") == "end", first[-1:])
if bad:
    sys.exit("recorder core (tick mode, world):\n  " + "\n  ".join(bad))
print("recorder core (tick mode, world): ok")
PY
    # The same file as the viewer reads it: a pose and hit points for the
    # tank, the chat lines, and the tank on net id 805 still in the world.
    viewer="$here/../../../tools/bf1942-models/viewer/replay-recording.js"
    if command -v node > /dev/null && [ -f "$viewer" ]; then
        node --input-type=module - "$viewer" "$work/world/replays" <<'JS'
import { readFileSync, readdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const [viewer, folder] = process.argv.slice(2);
const { parseRecording } = await import(pathToFileURL(viewer));
const opened = name => { const m = /^replay_(\d+)(?:-(\d+))?\.ndjson$/.exec(name); return [Number(m[1]), Number(m[2] ?? 0)]; };
const [first] = readdirSync(folder).sort((a, b) => opened(a)[0] - opened(b)[0] || opened(a)[1] - opened(b)[1]);
const rec = parseRecording(readFileSync(`${folder}/${first}`, 'utf8'));
const bad = [];
const check = (name, ok, found) => { if (!ok) bad.push(`${name}: ${JSON.stringify(found)}`); };
check('nothing skipped', rec.skipped === 0, rec.skipped);
const tank = rec.lives.find(l => l.nid === 800);
check('11 the tank has a pose', tank?.keys.length >= 1, tank?.keys.length);
check('11 the tank has hit points', tank?.hp[0]?.hp === 100 && tank.maxhp === 100, tank?.hp);
const on805 = rec.lives.filter(l => l.nid === 805);
const last = on805[on805.length - 1];
check('14 two lives on net id 805', on805.length === 2 && on805[0].tmpl === 'Willy' && last.tmpl === 'Tiger', on805.map(l => l.tmpl));
check('14 the second life is not ended by the first one\'s d',
      last?.replicated.at(-1)?.[1] === Infinity && last.keys.length >= 1, last?.replicated);
const feed = rec.events.filter(e => e.kind === 'chat').map(e => e.text);
check('15 the chat box', rec.chat.length === 5 && rec.chat[0].text === 'Alpha Dog: hello all', rec.chat.map(c => c.text));
check('15 the feed rows', feed.includes('Alpha Dog: hello all') && feed.includes('Bravo: push left')
      && feed.includes('Server restarts at 22:00'), feed);
if (bad.length) { console.error(`recorder core (world, as the viewer reads it):\n  ${bad.join('\n  ')}`); process.exit(1); }
console.log('recorder core (world, as the viewer reads it): ok');
JS
    else
        echo "recorder core (world, as the viewer reads it): skipped, no node or no viewer"
    fi
    # Hits and impacts (tick mode): the two hooks' lines, with recorder.con's
    # keys on, then each off.
    for keys in "1 1" "0 1" "1 0"; do
        set -- $keys
        rm -rf "$work/hits" && mkdir "$work/hits" && cd "$work/hits"
        printf 'recordReplays 1\nreplaySampleHz 30\nrecordHits %s\nrecordImpacts %s\n' "$1" "$2" > recorder.con
        mkdir replays
        timeout 30 ../harness hits 2> harness.err || { cat harness.err; exit 1; }
        grep -q "recordHits $1, recordImpacts $2" harness.err || { echo "hits: config keys not read"; cat harness.err; exit 1; }
        PYTHONPATH="$work" python3 - "$work/hits/replays" "$1" "$2" <<'PY'
import json, sys
from files import recordings
files = recordings(sys.argv[1])
hits_on, impacts_on = sys.argv[2] == "1", sys.argv[3] == "1"
assert len(files) == 1, [f.name for f in files]
lines = files[0].read_text().splitlines()
rows = [json.loads(l) for l in lines]
hg = [l for l in lines if '"k":"hg"' in l]
im = [l for l in lines if '"k":"i"' in l]
bad = []
def check(name, ok, found):
    if not ok: bad.append(f"{name}: {found}")
strip_t = lambda l: json.dumps({k: v for k, v in json.loads(l).items() if k != "t"}, separators=(",", ":"))
if hits_on:
    check("18 hg lines", [strip_t(l) for l in hg] == [
        '{"k":"hg","pid":5,"tid":3001,"tmpl":"Mp40"}', '{"k":"hg","pid":6,"tid":777}',
        '{"k":"hg","pid":5,"tid":3001,"tmpl":"Mp40"}', '{"k":"hg","pid":5,"tid":3001,"tmpl":"Mp40"}'], hg)
    check("18 hg shape", all(l.startswith('{"k":"hg","t":') for l in hg), hg[:1])
else:
    check("18 recordHits 0 writes no hg", not hg, hg)
if impacts_on:
    check("19 i lines", [strip_t(l) for l in im] == [
        '{"k":"i","pid":5,"tid":3001,"tmpl":"Mp40","o":[1.23,2.0,3.5],"p":[10.5,1.75,31.0],"obj":800,"dmg":1}',
        '{"k":"i","pid":5,"tid":3001,"tmpl":"Mp40","o":[1.23,2.0,3.5],"p":[10.5,1.75,31.0],"obj":-1,"dmg":0}',
        '{"k":"i","pid":-1,"tid":777,"o":[7.0,8.0,9.0],"p":[10.5,1.75,31.0],"obj":800,"dmg":0}',
        '{"k":"i","pid":5,"tid":3001,"tmpl":"Mp40","o":[1.23,2.0,3.5],"p":[10.5,1.75,31.0],"obj":-1,"dmg":1}'], im)
    # The file's own text: f's precision, compact
    check("19 i text", im and im[0].split(',"tid"')[1] == ':3001,"tmpl":"Mp40","o":[1.23,2.00,3.50],"p":[10.50,1.75,31.00],"obj":800,"dmg":1}', im[:1])
else:
    check("19 recordImpacts 0 writes no i", not im, im)
check("the file ends", rows[-1]["k"] == "end", rows[-1:])
if bad:
    sys.exit("recorder core (tick mode, hits):\n  " + "\n  ".join(bad))
print(f"recorder core (tick mode, hits, recordHits {sys.argv[2]} recordImpacts {sys.argv[3]}): ok")
PY
    done
    # The events emit_event_json used to drop (core_harness.c 20 to 25),
    # under the client recorder's record names.
    rm -rf "$work/events" && mkdir "$work/events" && cd "$work/events"
    printf 'recordReplays 1\nreplaySampleHz 30\n' > recorder.con
    mkdir replays
    timeout 30 ../harness events 2> harness.err || { cat harness.err; exit 1; }
    PYTHONPATH="$work" python3 - "$work/events/replays" <<'PY'
import json, sys
from files import recordings
files = recordings(sys.argv[1])
assert len(files) == 1, [f.name for f in files]
lines = files[0].read_text().splitlines()
rows = [json.loads(l) for l in lines]
ev = lambda name: [r for r in rows if r.get("e") == name]
no_t = lambda r: {k: v for k, v in r.items() if k not in ("k", "t")}
bad = []
def check(name, ok, found):
    if not ok: bad.append(f"{name}: {found}")
# 20
check("20 welcome held at t 0, once a line", [(r["t"], r["id"], r["text"]) for r in ev("welcome")] == [
    (0, 0, "Welcome to bfstats-lab"), (0, 1, "be nice!!")], ev("welcome"))
check("20 the rotation held at t 0, once an entry", [no_t(r) for r in ev("mapList")] == [
    {"e": "mapList", "add": 1, "map": "wake", "mode": "conquest", "mod": "bf1942"},
    {"e": "mapList", "add": 1, "map": "el_alamein", "mode": "coop", "mod": "bf1942"}]
    and all(r["t"] == 0 for r in ev("mapList")), ev("mapList"))
check("20 the session id is not held", ev("sessionId") == [], ev("sessionId"))
# 21
check("21 vote", [no_t(r) for r in ev("vote")] == [
    {"e": "vote", "action": 1, "type": 0, "pid": 5, "target": 6, "yes": 1, "required": 2}], ev("vote"))
# 22
rs = [no_t(r) for r in ev("roundStats")]
two = [{"tid": 3001, "tmpl": "Mp40", "n": 13}, {"tid": 777, "tmpl": "", "n": 2}]
check("22 tallies", rs == [
    {"e": "roundStats", "stat": "destroyed", "pid": 5, "rows": two},
    {"e": "roundStats", "stat": "fired", "pid": 5, "rows": two},
    {"e": "roundStats", "stat": "hit", "pid": 5, "rows": two},
    {"e": "roundStats", "stat": "fired", "pid": 6, "rows": [{"tid": 3001, "tmpl": "Mp40", "n": 4}]}], rs)
# 23, 24
check("23/24 hitFrom", [no_t(r) for r in ev("hitFrom")] == [
    {"e": "hitFrom", "dir": 2, "strength": 191},
    {"e": "hitFrom", "pid": 5, "dir": 4, "strength": 64},
    {"e": "hitFrom", "pid": 6, "dir": 4, "strength": 64}], ev("hitFrom"))
check("23/24 special", [no_t(r) for r in ev("special")] == [
    {"e": "special", "action": 0}, {"e": "special", "action": 0, "pid": 6}], ev("special"))
# 24b
check("24b spawnPick", [no_t(r) for r in ev("spawnPick")] == [
    {"e": "spawnPick", "pid": 5, "group": 3, "kit": 1},
    {"e": "spawnPick", "pid": 5, "group": 3, "kit": 4},
    {"e": "spawnPick", "pid": 6, "group": 0, "kit": 2}], ev("spawnPick"))
# 25
check("25 raw", [no_t(r) for r in ev("raw")] == [
    {"e": "raw", "type": 0x1e, "size": 14, "raw": "0105"},
    {"e": "raw", "type": 0x25, "size": 14, "raw": "0201"},
    {"e": "raw", "type": 0x3b, "size": 16, "raw": "07000000"},
    {"e": "raw", "type": 0x0e, "size": 14, "raw": "3412"}], ev("raw"))
# 26
ps = [e for r in rows if r["k"] == "ps" for e in r["ps"]]
check("26 ps, each player's once and on change", ps == [
    [5, 7, 2, 1, 48, 0, 0, 0], [6, -1, 0, 1, 0, 1, 0, 2], [5, 7, 2, 1, 52, 0, 0, 0]], ps)
table = {"e": "scoreTable", "kill": 3, "death": -1, "tk": -3, "capture": 20, "attack": 5,
         "defence": 5, "objective": 5, "objectiveTk": -15}
check("26 scoreTable once, again on change", [no_t(r) for r in ev("scoreTable")] == [
    table, {**table, "capture": 25}], ev("scoreTable"))
# 27
check("27 gameStatus at the end names the result", [no_t(r) for r in ev("gameStatus")] == [
    {"e": "gameStatus", "status": 2, "winner": 2, "victory": 2},
    {"e": "gameStatus", "status": 5, "winner": 2, "victory": 2}], ev("gameStatus"))
# 28
cps = [(r["k"], no_t(r)) for r in rows if r["k"] in ("cp", "cpt")]
full = {"timeToGet": 10.0, "timeToLose": 10.0}
row = lambda state, by, get, lose, **kw: ("cpt", {"id": 12289, "state": state, "by": by, "get": get, "lose": lose, **kw})
check("28 cp and cpt", cps == [
    ("cp", {"id": 12289, "name": "ALLIES_village", "tmpl": "ControlPoint", "pos": [400.0, 30.0, 500.0], "team": 2}),
    row(4, 0, 10.0, 10.0, **full),
    row(2, 0, 10.0, 9.5), row(2, 0, 10.0, 7.0),
    ("cp", {"id": 12289, "team": 0}), row(1, 0, 10.0, 0.0),
    row(3, 1, 9.9, 0.0), row(3, 1, 9.0, 0.0),
    ("cp", {"id": 12289, "team": 1}), row(4, 0, 10.0, 10.0)], cps)
cpt_text = [l for l in lines if '"k":"cpt"' in l]
check("28 cpt text", cpt_text and cpt_text[0].split(',"id"')[1] == ':12289,"state":4,"by":0,"get":10.00,"lose":10.00,"timeToGet":10.00,"timeToLose":10.00}', cpt_text[:1])
check("the file ends", rows[-1]["k"] == "end", rows[-1:])
if bad:
    sys.exit("recorder core (tick mode, events):\n  " + "\n  ".join(bad))
print("recorder core (tick mode, events): ok")
PY
    # The same file as the viewer reads it: the tallies, the hits and the
    # refills where the client's copies go, each player's under his pid.
    if command -v node > /dev/null && [ -f "$viewer" ]; then
        node --input-type=module - "$viewer" "$work/events/replays" <<'JS'
import { readFileSync, readdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const [viewer, folder] = process.argv.slice(2);
const { parseRecording } = await import(pathToFileURL(viewer));
const [file] = readdirSync(folder).filter(n => n.endsWith('.ndjson'));
const rec = parseRecording(readFileSync(`${folder}/${file}`, 'utf8'));
const bad = [];
const check = (name, ok, found) => { if (!ok) bad.push(`${name}: ${JSON.stringify(found)}`); };
check('nothing skipped', rec.skipped === 0, rec.skipped);
const p5 = rec.roundStats.get(5), p6 = rec.roundStats.get(6);
check('22 tallies by player', p5?.fired?.length === 2 && p5.fired[0].tmpl === 'Mp40' && p5.fired[0].n === 13
      && p5.destroyed.length === 2 && p5.hit.length === 2 && p6?.fired?.[0]?.n === 4, [p5, p6]);
check('24 hits taken, each his own', JSON.stringify(rec.hitsTaken.map(h => [h.pid, h.dir, h.strength]))
      === JSON.stringify([[undefined, 2, 191], [5, 4, 64], [6, 4, 64]].map(([p, d, s]) => [p, d, s])), rec.hitsTaken);
check('24 refills', rec.refills.length === 2 && rec.refills[1].pid === 6, rec.refills);
// 28: the timers on the point, and the ring they make (replay-capture.js)
const { captureProgressAt } = await import(pathToFileURL(viewer.replace(/replay-recording\.js$/, 'replay-capture.js')));
const cp = rec.controlPoints.get(12289);
check('28 timers', rec.cpTimers === true && cp?.timers?.length === 7 && cp.timeToGet === 10 && cp.timeToLose === 10
      && JSON.stringify(cp.timers.map(r => [r.state, r.by, r.get, r.lose])) === JSON.stringify(
        [[4, 0, 10, 10], [2, 0, 10, 9.5], [2, 0, 10, 7], [1, 0, 10, 0], [3, 1, 9.9, 0], [3, 1, 9, 0], [4, 0, 10, 10]]), cp);
const ring = i => captureProgressAt(cp, cp.timers[i].t);
check('28 rings', ring(0) === null && ring(1)?.kind === 'losing' && ring(1).team === 2 && Math.abs(ring(1).fraction - 0.95) < 1e-9
      && ring(3) === null && ring(4)?.kind === 'getting' && ring(4).team === 1 && Math.abs(ring(5).fraction - 0.1) < 1e-9
      && ring(6) === null, [0, 1, 2, 3, 4, 5, 6].map(ring));
if (bad.length) { console.error(`recorder core (events, as the viewer reads it):\n  ${bad.join('\n  ')}`); process.exit(1); }
console.log('recorder core (events, as the viewer reads it): ok');
JS
    else
        echo "recorder core (events, as the viewer reads it): skipped, no node or no viewer"
    fi
    cd "$work"
fi
done
# The lnxded target with build.sh's flags, into objects nothing installs: a
# typo in it fails here. Then its string read at the end of a mapping, in a
# directory with no recorder.con (the constructor finds recording off).
for f in core target_lnxded; do
    gcc -m32 -O2 -Wall -Wextra -fPIC -DREC_STAGE3=1 -DREC_TICK=1 -c -o "$work/$f.o" "$src/$f.c"
done
gcc -m32 -no-pie -I"$src" -o "$work/lnxded_strings" -x c - -x none "$work/core.o" "$work/target_lnxded.o" -lpthread -lm <<'C'
#include <stdint.h>
#include <stdio.h>
#include <string.h>
#include <sys/mman.h>
#include "core.h"
extern const struct rec_target lnxded_target;
/* The entry stubs, run against stand-ins for the trampolines they jump
 * through: the hit stub reaches the original with its two arguments; the
 * impact stub calls the original with all eight and returns what it did. */
extern char recorder_stub_hit, recorder_stub_impact, recorder_stub_special;
extern uint32_t recorder_tramp_hit, recorder_tramp_impact, recorder_tramp_special;
static uint32_t got[8];
static uint32_t orig_hit(uint32_t a, uint32_t b) { got[0] = a; got[1] = b; return 0; }
static uint32_t orig_special(uint32_t a, uint32_t b, uint32_t c) { got[0] = a; got[1] = b; got[2] = c; return 0; }
static uint32_t orig_impact(uint32_t a, uint32_t b, uint32_t c, uint32_t d, uint32_t e, uint32_t f, uint32_t g, uint32_t h)
{ got[0] = a; got[1] = b; got[2] = c; got[3] = d; got[4] = e; got[5] = f; got[6] = g; got[7] = h; return 0x1234; }
/* The SpawnRequest site is mid-function: entered with the BFPlayer in eax
 * and the event at ebp+0x10, and left through its trampoline with every
 * register as it came. `spawnreq_frame(player, 0, event)` builds that frame
 * and is the trampoline's target too. */
extern uint32_t spawnreq_frame(uint32_t player, uint32_t unused, uint32_t event);
extern char spawnreq_back;
extern char recorder_stub_spawnreq, recorder_stub_aigroup, recorder_stub_aikit;
extern uint32_t recorder_tramp_spawnreq, recorder_tramp_aigroup, recorder_tramp_aikit;
uint32_t spawnreq_seen[2];
__asm__(".text\n.globl spawnreq_frame\nspawnreq_frame:\n"
        "  pushl %ebp\n  movl %esp, %ebp\n  pushl %ebx\n"
        "  movl 8(%ebp), %eax\n  movl $0x5a5a, %edx\n  movl %esp, %ebx\n"
        "  jmp recorder_stub_spawnreq\n"
        ".globl spawnreq_back\nspawnreq_back:\n"
        "  movl %eax, spawnreq_seen\n  movl %edx, spawnreq_seen+4\n"
        "  subl %esp, %ebx\n  movl %ebx, %eax\n"
        "  popl %ebx\n  popl %ebp\n  ret\n");
static int stubs(void)
{
    recorder_tramp_hit = (uint32_t)(uintptr_t)orig_hit;
    ((void (*)(uint32_t, uint32_t))(uintptr_t)&recorder_stub_hit)(0x5000, 77);
    if (got[0] != 0x5000 || got[1] != 77) { fprintf(stderr, "lnxded hit stub: %x %u\n", got[0], got[1]); return 1; }
    recorder_tramp_special = (uint32_t)(uintptr_t)orig_special;
    ((void (*)(uint32_t, uint32_t, uint32_t))(uintptr_t)&recorder_stub_special)(0x6000, 0, 0x7000);
    if (got[0] != 0x6000 || got[1] != 0 || got[2] != 0x7000) { fprintf(stderr, "lnxded special stub: %x %u %x\n", got[0], got[1], got[2]); return 1; }
    recorder_tramp_aigroup = (uint32_t)(uintptr_t)orig_hit;
    ((void (*)(uint32_t, uint32_t))(uintptr_t)&recorder_stub_aigroup)(0x8000, 74);
    if (got[0] != 0x8000 || got[1] != 74) { fprintf(stderr, "lnxded setSpawnGroup stub: %x %u\n", got[0], got[1]); return 1; }
    recorder_tramp_aikit = (uint32_t)(uintptr_t)orig_hit;
    ((void (*)(uint32_t, uint32_t))(uintptr_t)&recorder_stub_aikit)(0x9000, 3);
    if (got[0] != 0x9000 || got[1] != 3) { fprintf(stderr, "lnxded setSpawnKit stub: %x %u\n", got[0], got[1]); return 1; }
    {
        static uint8_t player[0x200], event[16];
        event[0xc] = 5; event[0xd] = 2;
        recorder_tramp_spawnreq = (uint32_t)(uintptr_t)&spawnreq_back;
        uint32_t moved = spawnreq_frame((uint32_t)(uintptr_t)player, 0, (uint32_t)(uintptr_t)event);
        if (spawnreq_seen[0] != (uint32_t)(uintptr_t)player || spawnreq_seen[1] != 0x5a5a || moved) {
            fprintf(stderr, "lnxded SpawnRequest stub: eax %x edx %x, esp moved %d\n", spawnreq_seen[0], spawnreq_seen[1], (int)moved);
            return 1;
        }
    }
    recorder_tramp_impact = (uint32_t)(uintptr_t)orig_impact;
    float contact[3] = { 1, 2, 3 };
    uint32_t r = ((uint32_t (*)(uint32_t, uint32_t, uint32_t, uint32_t, uint32_t, uint32_t, uint32_t, uint32_t))
                  (uintptr_t)&recorder_stub_impact)(0x11, 0, 0, 0x44, 0x55, (uint32_t)(uintptr_t)contact, 7, 8);
    uint32_t want[8] = { 0x11, 0, 0, 0x44, 0x55, (uint32_t)(uintptr_t)contact, 7, 8 };
    if (r != 0x1234 || memcmp(got, want, sizeof want)) { fprintf(stderr, "lnxded impact stub: %x, args %x %x %x %x %x %x %x %x\n", r, got[0], got[1], got[2], got[3], got[4], got[5], got[6], got[7]); return 1; }
    return 0;
}
int main(void)
{
    if (stubs()) return 1;
    /* Three pages, the middle one unmapped: a name whose terminator is the
     * first page's last byte, and one that runs to the page's end with none. */
    char *m = mmap(0, 3 * 4096, PROT_READ | PROT_WRITE, MAP_PRIVATE | MAP_ANONYMOUS, -1, 0);
    munmap(m + 4096, 4096);
    char out[64];
    uint32_t str = (uint32_t)(uintptr_t)(m + 4096 - 7);
    memcpy(m + 4096 - 7, "Julius", 7);
    lnxded_target.read_string((uintptr_t)&str, out, sizeof out);
    if (strcmp(out, "Julius")) { fprintf(stderr, "lnxded read_string at a mapping's end: '%s', not 'Julius'\n", out); return 1; }
    memcpy(m + 4096 - 4, "Otto", 4);
    str = (uint32_t)(uintptr_t)(m + 4096 - 4);
    lnxded_target.read_string((uintptr_t)&str, out, sizeof out);
    if (strcmp(out, "Otto")) { fprintf(stderr, "lnxded read_string cut by a mapping's end: '%s', not 'Otto'\n", out); return 1; }
    return 0;
}
C
mkdir "$work/lnxded" && cd "$work/lnxded"
"$work/lnxded_strings" 2> lnxded.err || { cat lnxded.err; exit 1; }
echo "recorder lnxded target: builds; a string at a mapping's end is read; the hit, impact, refill and spawn-choice stubs pass their arguments"
