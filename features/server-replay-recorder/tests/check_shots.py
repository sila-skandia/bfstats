#!/usr/bin/env python3
"""Check a server recording's shots, hits, impacts and flights against the game.

    tests/check_shots.py replay.ndjson [--log recorder.log] [--expect-fake]

The oracle is the server's own tally: at a round's end GameServer sends every
player's StatsShots and StatsHits (`roundStats`, `fired` and `hit`), which
reach the recorder through sendGameEventToAll, not through the shot and hit
hooks. Each player's `fired` total must equal his real `f` lines (fake rounds
are rolled by the AI and not counted), his `hit` total his `hg` lines.

Then every line is checked on its own: JSON; `f` from a known player, a
named weapon, a finite place and a unit direction; a fake round starting near
its shooter's object; `hg`, `i` and `hitFrom` naming known players, sectors
0-7 and strengths 0-255; an `i` whose impact is a plausible distance from its
fire origin; flights (`pn`/`pj`/`pd`) opened and closed once each; and each
real shot of a projectile weapon followed by a flight within 0.15 s.

With --log, recorder.log must show every detour installed and no fault.
Exit 1 on any failure; the report says which.
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from bisect import bisect_left
from collections import Counter, defaultdict

# The Windows build's detours, in recorder.log's own words.
W32_DETOURS = ["00478490", "00471090", "00506bf0", "00507aca", "004058b0", "00473b40", "004759eb"]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("recording")
    ap.add_argument("--log", help="recorder.log of the run")
    ap.add_argument("--expect-fake", action="store_true", help="a bots-only round: fake rounds must appear")
    ap.add_argument("--json", help="write the numbers here too")
    a = ap.parse_args()

    fails: list[str] = []
    notes: list[str] = []
    kinds: Counter = Counter()
    events: Counter = Counter()
    players: dict[int, dict] = {}
    fires, hits, impacts, hitfroms, pools = [], [], [], [], []
    flights_open: dict[int, dict] = {}
    flights: list[dict] = []
    stats = defaultdict(lambda: {"fired": 0, "hit": 0, "seen": set()})
    # Template names two ways: `o` lines read the template through the
    # object's pointer (its name and its id field); hg, i, roundStats and
    # projPool name a bare id through the template manager. They must agree.
    by_pointer: dict[int, str] = {}
    by_id: list[tuple[str, int, str]] = []
    positions: dict[int, list[tuple[float, tuple]]] = defaultdict(list)
    bad_json = 0
    header = None

    with open(a.recording, errors="replace") as fh:
        for n, line in enumerate(fh, 1):
            try:
                r = json.loads(line)
            except json.JSONDecodeError:
                bad_json += 1
                continue
            k = r.get("k")
            kinds[k] += 1
            if k in ("hg", "i") and r.get("tmpl"):
                by_id.append((k, r["tid"], r["tmpl"]))
            if k == "o" and r.get("tid") is not None and r.get("tmpl"):
                by_pointer.setdefault(r["tid"], r["tmpl"])
            if k == "e" and r.get("e") == "roundStats":
                by_id.extend(("roundStats", row["tid"], row["tmpl"]) for row in r["rows"] if row.get("tmpl"))
            if k == "e" and r.get("e") == "projPool":
                by_pointer.setdefault(r["tid"], r["tmpl"])
            if k == "h":
                header = r
            elif k == "e":
                e = r.get("e")
                events[e] += 1
                if e == "createPlayer":
                    players[r["pid"]] = r
                elif e == "roundStats" and r.get("stat") in ("fired", "hit"):
                    s = stats[r["pid"]]
                    # One event per ten rows; a resend of the same rows is one tally.
                    key = (r["stat"], json.dumps(r["rows"], sort_keys=True))
                    if key not in s["seen"]:
                        s["seen"].add(key)
                        s[r["stat"]] += sum(row["n"] for row in r["rows"])
                elif e == "hitFrom":
                    hitfroms.append(r)
                elif e == "projPool":
                    pools.append(r)
            elif k == "f":
                fires.append(r)
            elif k == "hg":
                hits.append(r)
            elif k == "i":
                impacts.append(r)
            elif k == "s":
                for o in r.get("o", []):
                    positions[o[0]].append((r["t"], (o[1], o[2], o[3])))
            elif k == "pn":
                for key, tmpl in r["o"]:
                    if key in flights_open:
                        fails.append(f"line {n}: flight {key} opened twice")
                    flights_open[key] = {"key": key, "tmpl": tmpl, "t0": r["t"], "first": None}
            elif k == "pj":
                for key, x, y, z in r["o"]:
                    fl = flights_open.get(key)
                    if fl is None:
                        fails.append(f"line {n}: pj for flight {key}, never opened")
                    elif fl["first"] is None:
                        fl["first"] = (x, y, z)
            elif k == "pd":
                for key in r["o"]:
                    fl = flights_open.pop(key, None)
                    if fl is None:
                        fails.append(f"line {n}: pd for flight {key}, not open")
                    else:
                        fl["t1"] = r["t"]
                        flights.append(fl)
    flights.extend(flights_open.values())

    if bad_json:
        fails.append(f"{bad_json} lines are not JSON")
    plus = (header or {}).get("plus", "?")

    def known(pid: int) -> bool:
        return pid in players

    # --- shots --------------------------------------------------------------
    real = [f for f in fires if not f.get("fake")]
    fake = [f for f in fires if f.get("fake")]
    for f in fires:
        what = f"f t={f['t']}"
        if not known(f["pid"]):
            fails.append(f"{what}: pid {f['pid']} has no createPlayer")
        if not f.get("w"):
            fails.append(f"{what}: no weapon name")
        if not all(math.isfinite(v) for v in f["p"] + f["d"]):
            fails.append(f"{what}: not finite")
        norm = math.sqrt(sum(v * v for v in f["d"]))
        if abs(norm - 1) > 0.02:
            fails.append(f"{what}: direction length {norm:.3f}")
    if not fires:
        fails.append("no f lines")
    if a.expect_fake and not fake:
        fails.append("a bots-only round, and no fake rounds")

    # A fake round's place against its shooter's object: the f's id is the
    # weapon's root, the soldier or the vehicle.
    def place_at(oid: int, t: float):
        seq = positions.get(oid)
        if not seq:
            return None
        i = bisect_left(seq, (t,))
        best = min((seq[j] for j in (i - 1, i) if 0 <= j < len(seq)), key=lambda s: abs(s[0] - t))
        return best[1] if abs(best[0] - t) < 0.5 else None

    def far_from_shooter(group):
        d = []
        for f in group:
            at = place_at(f["id"], f["t"])
            if at is not None:
                d.append(math.dist(at, f["p"]))
        return d

    for label, group in (("real", real), ("fake", fake)):
        d = far_from_shooter(group)
        if group and not d:
            fails.append(f"no {label} shot's shooter has a sampled place")
        elif d:
            d.sort()
            med, p95 = d[len(d) // 2], d[int(len(d) * 0.95)]
            notes.append(f"{label} shots: muzzle to shooter's object, median {med:.2f} m, 95% {p95:.2f} m ({len(d)} placed)")
            if p95 > 15:
                fails.append(f"{label} shots start {p95:.1f} m from their shooter (95th percentile)")

    # --- the server's tally ---------------------------------------------------
    tallied = {pid: s for pid, s in stats.items() if s["fired"] or s["hit"]}
    real_by = Counter(f["pid"] for f in real)
    fake_by = Counter(f["pid"] for f in fake)
    hg_by = Counter(h["pid"] for h in hits)
    fired_ok = hit_ok = 0
    mism = []
    for pid, s in sorted(tallied.items()):
        if s["fired"] == real_by[pid]:
            fired_ok += 1
        else:
            mism.append(f"pid {pid}: fired {s['fired']}, real f {real_by[pid]} (fake {fake_by[pid]})")
        if s["hit"] == hg_by[pid]:
            hit_ok += 1
        else:
            mism.append(f"pid {pid}: hit {s['hit']}, hg {hg_by[pid]}")
    if not tallied:
        fails.append("no roundStats: the round did not end inside the recording")
    else:
        notes.append(f"server tally: fired = real f for {fired_ok} of {len(tallied)} players, "
                     f"hit = hg for {hit_ok} of {len(tallied)}")
        if mism:
            fails.extend(mism[:20])
            if len(mism) > 20:
                fails.append(f"... {len(mism) - 20} more")

    # --- hits, impacts, sectors ----------------------------------------------
    for h in hits:
        if not known(h["pid"]):
            fails.append(f"hg t={h['t']}: pid {h['pid']} unknown")
    far = []
    for i in impacts:
        what = f"i t={i['t']}"
        if i["pid"] != -1 and not known(i["pid"]):
            fails.append(f"{what}: pid {i['pid']} unknown")
        if not all(math.isfinite(v) for v in i["o"] + i["p"]):
            fails.append(f"{what}: not finite")
        if i["dmg"] not in (0, 1):
            fails.append(f"{what}: dmg {i['dmg']}")
        far.append(math.dist(i["o"], i["p"]))
    if far:
        far.sort()
        notes.append(f"impacts: fire origin to impact, median {far[len(far) // 2]:.1f} m, max {far[-1]:.0f} m")
        if far[-1] > 3000:
            fails.append(f"an impact {far[-1]:.0f} m from its fire origin")
    dmg1 = sum(i["dmg"] for i in impacts)
    if dmg1 > len(hits):
        fails.append(f"{dmg1} impacts with dmg 1, but only {len(hits)} hg")
    for h in hitfroms:
        if not known(h["pid"]):
            fails.append(f"hitFrom t={h['t']}: pid {h['pid']} unknown")
        if not 0 <= h["dir"] <= 7 or not 0 <= h["strength"] <= 255:
            fails.append(f"hitFrom t={h['t']}: dir {h['dir']} strength {h['strength']}")
    if hitfroms:
        notes.append(f"hitFrom: sectors {sorted(set(h['dir'] for h in hitfroms))}, "
                     f"strongest {max(h['strength'] for h in hitfroms)}, "
                     f"{len(set(h['pid'] for h in hitfroms))} players")

    # --- flights ---------------------------------------------------------------
    t0s = sorted((fl["t0"], fl["first"]) for fl in flights)
    starts = [t for t, _ in t0s]
    flown = 0
    for f in real:
        i = bisect_left(starts, f["t"] - 0.05)
        ok = False
        while i < len(t0s) and t0s[i][0] <= f["t"] + 0.15:
            first = t0s[i][1]
            if first is None or math.dist(first, f["p"]) < 60:
                ok = True
                break
            i += 1
        flown += ok
    if real:
        notes.append(f"real shots followed by a flight within 0.15 s: {flown} of {len(real)}")
        if flown < 0.95 * len(real):
            fails.append(f"only {flown} of {len(real)} real shots have a flight")
    if fires and not flights:
        fails.append("shots, and no flights")
    if not pools:
        fails.append("no projPool")

    # --- template names --------------------------------------------------------
    named = [h for h in hits if h.get("tmpl")] + [i for i in impacts if i.get("tmpl")]
    if hits and not named:
        fails.append("no hg or i line names its template: the id -> template lookup finds nothing")
    if tallied and not any(src == "roundStats" for src, _, _ in by_id):
        fails.append("no roundStats row names its template")
    agree = clash = 0
    for src, tid, name in by_id:
        want = by_pointer.get(tid)
        if want is None:
            continue
        if want == name:
            agree += 1
        else:
            clash += 1
            if clash <= 5:
                fails.append(f"{src}: tid {tid} named {name!r} by id, {want!r} through its object")
    if by_pointer and len(set(by_pointer.values())) < 0.5 * len(by_pointer):
        fails.append(f"{len(by_pointer)} template ids carry only {len(set(by_pointer.values()))} names: "
                     f"the id field is not the id")
    notes.append(f"template names by id agree with the objects' own: {agree} of {agree + clash} comparable "
                 f"({len(by_id)} named by id)")

    # --- recorder.log -------------------------------------------------------------
    if a.log:
        log = open(a.log, errors="replace").read()
        if "w32ded" in plus:
            for site in W32_DETOURS:
                if f"detour at {site}" not in log:
                    fails.append(f"recorder.log: no detour at {site}")
        for bad in ("fault", "not the expected code", "failed", "stopped"):
            for line in log.splitlines():
                if bad in line:
                    fails.append(f"recorder.log: {line.strip()}")

    summary = {
        "recording": a.recording, "plus": plus, "lines": sum(kinds.values()),
        "players": len(players), "f_real": len(real), "f_fake": len(fake), "hg": len(hits),
        "i": len(impacts), "i_dmg": dmg1, "hitFrom": len(hitfroms), "flights": len(flights),
        "projPool": len(pools), "tallied": len(tallied), "fired_ok": fired_ok, "hit_ok": hit_ok,
        "kinds": dict(kinds), "fails": fails,
    }
    print(f"{a.recording} ({plus}), {summary['lines']} lines, {len(players)} players")
    print(f"  f {len(real)} real + {len(fake)} fake, hg {len(hits)}, i {len(impacts)} ({dmg1} dmg), "
          f"hitFrom {len(hitfroms)}, flights {len(flights)}, projPool {len(pools)}")
    for n in notes:
        print(f"  {n}")
    if a.json:
        with open(a.json, "w") as fh:
            json.dump(summary, fh, indent=1)
    if fails:
        print(f"FAIL ({len(fails)})")
        for f in fails[:40]:
            print(f"  {f}")
        return 1
    print("ok")
    return 0


if __name__ == "__main__":
    sys.exit(main())
