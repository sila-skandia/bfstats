#!/usr/bin/env python3
"""Sanity-check a bf42plus replay_*.ndjson recording.

    python3 summarize.py replays/replay_20260915-213000.ndjson

Prints line counts per record kind, the roster, event kinds seen, the raw dumps
of events whose layout is still unmapped (SetLevel is 0x36), and per-object
sample statistics so tests T1-T5 in README.md can be answered from one file.
"""
import json
import sys
from collections import Counter, defaultdict


def main(path: str) -> None:
    kinds = Counter()
    events = Counter()
    raw_types = defaultdict(list)
    players = {}
    objects = {}
    samples_per_object = Counter()
    first_seen = {}
    last_seen = {}
    control_points = {}
    t_max = 0.0
    header = None

    with open(path, encoding="utf-8") as f:
        for line_no, line in enumerate(f, 1):
            line = line.strip()
            if not line:
                continue
            try:
                rec = json.loads(line)
            except json.JSONDecodeError as exc:
                print(f"line {line_no}: bad JSON ({exc})")
                continue
            k = rec.get("k")
            kinds[k] += 1
            t = rec.get("t", 0.0)
            t_max = max(t_max, t)
            if k == "h":
                header = rec
            elif k == "e":
                e = rec["e"]
                events[e] += 1
                if e == "createPlayer":
                    players[rec["pid"]] = rec
                elif e == "raw" and len(raw_types[rec["type"]]) < 3:
                    raw_types[rec["type"]].append(rec["raw"])
            elif k == "o":
                objects[rec["id"]] = rec
                first_seen[rec["id"]] = t
            elif k == "s":
                for o in rec["o"]:
                    samples_per_object[o[0]] += 1
                    last_seen[o[0]] = t
            elif k == "cp":
                control_points.setdefault(rec["id"], rec)

    print(f"file: {path}")
    if header:
        print(f"header: {header}")
    print(f"duration: {t_max:.1f}s")
    print("\nrecords per kind:")
    for k, n in kinds.most_common():
        print(f"  {k:5} {n}")
    print("\nevents:")
    for e, n in events.most_common():
        print(f"  {e:14} {n}")
    if raw_types:
        print("\nunmapped event payloads (type: first bytes as hex):")
        for typ, dumps in sorted(raw_types.items()):
            for d in dumps:
                ascii_ = "".join(chr(b) if 32 <= b < 127 else "." for b in bytes.fromhex(d))
                print(f"  0x{typ:02x}: {d}\n        {ascii_}")
    print(f"\nplayers ({len(players)}):")
    for pid, p in sorted(players.items()):
        print(f"  {pid:3} team={p['team']} ai={p['ai']} veh={p['vehNetId']} {p['name']!r}")
    print(f"\ncontrol points ({len(control_points)}):")
    for cid, cp in sorted(control_points.items()):
        print(f"  {cid} {cp.get('name')!r} team={cp.get('team')} pos={cp.get('pos')}")
    templates = Counter(o["tmpl"] for o in objects.values())
    print(f"\nnetworked objects seen: {len(objects)} across {len(templates)} templates")
    for tmpl, n in templates.most_common(40):
        print(f"  {n:4} {tmpl}")
    if samples_per_object and t_max > 0:
        rates = sorted(
            ((samples_per_object[i] / max(last_seen.get(i, t_max) - first_seen.get(i, 0.0), 1e-6), i)
             for i in objects),
            reverse=True,
        )
        print("\nmost-updated objects (changed samples per second):")
        for rate, i in rates[:15]:
            print(f"  {rate:6.2f}/s  id={i:5} {objects[i]['tmpl']}")
        print("least-updated objects:")
        for rate, i in rates[-10:]:
            print(f"  {rate:6.2f}/s  id={i:5} {objects[i]['tmpl']}")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(sys.argv[1])
