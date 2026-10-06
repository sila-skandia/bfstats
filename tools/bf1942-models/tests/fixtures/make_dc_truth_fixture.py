#!/usr/bin/env python3
"""Cut `dc_truth_el_alamein.ndjson.gz` out of the first Desert Combat lab round.

    python3 tests/fixtures/make_dc_truth_fixture.py \
        ~/bf1942-lab/runs/20261006-212343-dc-el_alamein-coop-rec/server/replay_1791285831.ndjson

The recording is the server recorder's file of a bots-only DC El Alamein co-op
round (2026-10-06). The cut keeps, verbatim, every line about a handful of
objects in a few windows, and nothing else:

- M2A3 524 from 240 s: its driver left at 247.2 s, and 46 s later its hit
  points drain at 10 a second to 0 (302.9 s); its wreck goes at 362.9 s.
- Humvee 551 from 28 to 60 s: a bot drives it off its pad.
- Flights: three AS-7 rockets off a Su-25, the round's one T-72 shell in
  flight, two TOW missiles, with the shots (`f`) that fired them.
- The round's status changes (the play and its end at 727.1 s).

`tests/test_dc_truth.py` reads it.
"""
import gzip
import json
import sys
from pathlib import Path

OUT = Path(__file__).resolve().parent / "dc_truth_el_alamein.ndjson.gz"
WINDOWS = {524: (240.0, 365.0), 551: (28.0, 60.0)}
WEAPONS = {"SU-25_BombRack", "T72GunBarrel", "M2A3_TOW"}
ROUNDS_WANTED = {"AS-7": 3, "T72Projectile": 1, "TOW_Projectile": 2}


def crews(src: Path) -> set[int]:
    """Every player who sat in one of the kept hulls (their seat records are kept whole)."""
    pids = set()
    for line in src.open():
        if '"k":"p"' in line:
            for o in json.loads(line)["p"]:
                if o[3] in WINDOWS:
                    pids.add(o[0])
    return pids


def main(src: Path) -> None:
    PIDS = crews(src)
    keys: dict[int, str] = {}
    taken = {k: 0 for k in ROUNDS_WANTED}
    out = []
    for line in src.open():
        try:
            r = json.loads(line)
        except ValueError:
            continue
        k, t = r.get("k"), r.get("t", 0.0)
        if k == "h" or (k == "e" and r.get("e") in ("gameStatus", "setLevel")):
            out.append(r)
        elif k == "e" and r.get("e") == "destroyObject" and r.get("netId") in WINDOWS:
            out.append(r)
        elif k == "o" and r["id"] in WINDOWS and t <= WINDOWS[r["id"]][1]:
            out.append(r)
        elif k in ("s", "j", "g", "jn", "a"):
            key = "a" if k == "a" else "o"
            rows = [o for o in r[key] if o[0] in WINDOWS and WINDOWS[o[0]][0] <= t <= WINDOWS[o[0]][1]
                    or (k in ("jn", "a") and o[0] in WINDOWS and t <= WINDOWS[o[0]][1])]
            if rows:
                out.append({**r, key: rows})
        elif k in ("p", "lod"):
            key = "p" if k == "p" else "o"
            rows = [o for o in r[key] if o[0] in PIDS]
            if rows:
                out.append({**r, key: rows})
        elif k == "e" and r.get("e") == "createPlayer" and r.get("pid") in PIDS:
            out.append(r)
        elif k == "pn":
            for key_, tmpl in r["o"]:
                if tmpl in taken and taken[tmpl] < ROUNDS_WANTED[tmpl]:
                    taken[tmpl] += 1
                    keys[key_] = tmpl
                    out.append({"k": "pn", "t": t, "o": [[key_, tmpl]]})
        elif k == "pj":
            rows = [o for o in r["o"] if o[0] in keys]
            if rows:
                out.append({**r, "o": rows})
        elif k == "pd":
            rows = [x for x in r["o"] if x in keys]
            if rows:
                out.append({"k": "pd", "t": t, "o": rows})
                for x in rows:
                    keys.pop(x)     # a pooled key flies again: keep one flight
        elif k == "f" and r.get("w") in WEAPONS and not r.get("fake"):
            out.append(r)
    with gzip.open(OUT, "wt") as f:
        for r in out:
            f.write(json.dumps(r, separators=(",", ":")) + "\n")
    print(f"{OUT}: {len(out)} lines, flights {taken}")


if __name__ == "__main__":
    main(Path(sys.argv[1]))
