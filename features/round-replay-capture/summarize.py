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
    armor = defaultdict(list)   # net id -> [(t, hitPoints, lastHitPlayer)], format v3
    chats = []                  # format v3
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
                    # Format v2 records the event's size; v1 did not.
                    raw_types[rec["type"]].append((rec.get("size"), rec["raw"]))
            elif k == "o":
                objects[rec["id"]] = rec
                first_seen[rec["id"]] = t
            elif k == "s":
                for o in rec["o"]:
                    samples_per_object[o[0]] += 1
                    last_seen[o[0]] = t
            elif k == "cp":
                control_points.setdefault(rec["id"], rec)
            elif k == "a":
                for oid, hp, last_hit in rec["a"]:
                    armor[oid].append((t, hp, last_hit))
            elif k == "chat":
                chats.append(rec)

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
        print("\nunmapped event payloads (type, sizeof, payload as hex):")
        print("  size ? = no size recorded; the dump is a fixed prefix and may run past the event")
        for typ, dumps in sorted(raw_types.items()):
            for size, d in dumps:
                ascii_ = "".join(chr(b) if 32 <= b < 127 else "." for b in bytes.fromhex(d))
                print(f"  0x{typ:02x} size {size if size is not None else '?'}: {d}\n        {ascii_}")
    print(f"\nplayers ({len(players)}):")
    for pid, p in sorted(players.items()):
        print(f"  {pid:3} team={p['team']} ai={p['ai']} veh={p['vehNetId']} {p['name']!r}")
    print(f"\ncontrol points ({len(control_points)}):")
    for cid, cp in sorted(control_points.items()):
        print(f"  {cid} {cp.get('name')!r} team={cp.get('team')} pos={cp.get('pos')}")
    # An object is written again, with unchanged hit points, every time it comes
    # back into relevance range; only a change in value is damage.
    changes = {}
    for oid, track in armor.items():
        steps = [track[0]] + [cur for prev, cur in zip(track, track[1:]) if cur[1] != prev[1]]
        if len(steps) > 1:
            changes[oid] = steps
    if armor:
        print(f"\nobjects with armor: {len(armor)}; hit points changed during the recording: {len(changes)}")
        for oid, steps in sorted(changes.items()):
            o = objects.get(oid, {})
            shown = " ".join(f"{t:.1f}s:{hp:g}" for t, hp, _ in steps[:12])
            more = f" ... ({len(steps) - 1} changes)" if len(steps) > 12 else ""
            # lastHitPlayer reads -1 on the client in every recording so far:
            # the server does not replicate it.
            print(f"  id={oid} {o.get('tmpl', '?')} maxhp={o.get('maxhp')} crit={o.get('crit')}: {shown}{more}")
    if chats:
        print(f"\nchat ({len(chats)}):")
        for c in chats:
            print(f"  {c['t']:7.1f}s pid={c['pid']} team={c['team']}: {c['text']}")
    templates = Counter(o["tmpl"] for o in objects.values())
    print(f"\nnetworked objects seen: {len(objects)} across {len(templates)} templates")
    for tmpl, n in templates.most_common(40):
        print(f"  {n:4} {tmpl}")
    if samples_per_object and t_max > 0:
        # An object is written once when first seen and then only when its
        # transform changes. One sample therefore means "never moved after we
        # first saw it", and it has no meaningful rate -- dividing by its zero
        # -width window is what produced the 1e6/s entries in the first run.
        static = [i for i in objects if samples_per_object[i] <= 1]
        rates = sorted(
            (((samples_per_object[i] - 1) / (last_seen[i] - first_seen[i]), i)
             for i in objects
             if samples_per_object[i] > 1 and last_seen[i] > first_seen[i]),
            reverse=True,
        )
        print(f"\nobjects that never moved after first sight: {len(static)}/{len(objects)}")
        if rates:
            print("objects that did move (changed samples per second, over their own window):")
            for rate, i in rates[:20]:
                window = last_seen[i] - first_seen[i]
                print(f"  {rate:6.2f}/s  over {window:5.1f}s  id={i:5} {objects[i]['tmpl']}")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(sys.argv[1])
