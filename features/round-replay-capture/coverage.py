#!/usr/bin/env python3
"""Test T1: does the recording client hold a ghost for every object on the map?

Compares the set of networked objects in a replay recording against the spawn
points the level actually defines, read straight out of the level's .rfa, and
reports what is missing along with how far it was from the recording client.

    python3 coverage.py replays/replay_20260915-143655.ndjson --level Wake

The level archives are found in the BF1942 install; point at a different one
with --game-dir, and at a mod other than bf1942 with --mod. Patch archives
(Wake_003.rfa) override the base archive, the same way the engine loads them.

A spawn point counts as covered when a recorded object sits within --radius of
it. Vehicles that were driven away before the recording started will therefore
read as missing; keep recordings short after a round start, or read the result
as a lower bound on coverage.
"""
from __future__ import annotations

import argparse
import json
import math
import re
import sys
from pathlib import Path

# The .rfa reader lives with the model extraction pipeline.
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "tools" / "bf1942-models"))
from bf42.rfa import RfaArchive  # noqa: E402

DEFAULT_GAME_DIR = Path.home() / ".wine/drive_c/EA Games/Battlefield 1942"


def read_spawns(game_dir: Path, mod: str, level: str, gamemode: str) -> list[dict]:
    """ObjectSpawns.con for one level, honouring patch-archive precedence."""
    levels = game_dir / "Mods" / mod / "Archives" / mod / "levels"
    # Wake.rfa, Wake_000.rfa, Wake_003.rfa -- later numbers win.
    archives = sorted(levels.glob(f"{level}*.rfa"), key=lambda p: p.stem)
    if not archives:
        sys.exit(f"no archive for level {level!r} under {levels}")

    blob = None
    for path in archives:
        archive = RfaArchive(path)
        # Entry names differ in case between the base and patch archives.
        wanted = f"levels/{level}/{gamemode}/objectspawns.con".lower()
        for name in archive.entries:
            if name.lower().endswith(wanted):
                blob = archive.read(name)
                source = path.name
    if blob is None:
        sys.exit(f"no {gamemode}/ObjectSpawns.con in any of {[p.name for p in archives]}")
    print(f"spawns read from {source}")

    spawns: list[dict] = []
    current: dict | None = None
    for line in blob.decode("latin-1").splitlines():
        line = line.strip()
        if m := re.match(r"(?i)Object\.create\s+(\S+)", line):
            current = {"tmpl": m.group(1), "pos": None, "team": None}
            spawns.append(current)
        elif current is None:
            continue
        elif m := re.match(r"(?i)Object\.absolutePosition\s+(\S+)", line):
            current["pos"] = tuple(float(v) for v in m.group(1).split("/"))
        elif m := re.match(r"(?i)Object\.setTeam\s+(\S+)", line):
            current["team"] = int(m.group(1))
    return [s for s in spawns if s["pos"]]


def read_recording(path: Path) -> tuple[dict, dict]:
    objects, first_pos = {}, {}
    for line in path.open(encoding="utf-8"):
        line = line.strip()
        if not line:
            continue
        rec = json.loads(line)
        if rec.get("k") == "o":
            objects[rec["id"]] = rec
        elif rec.get("k") == "s":
            for o in rec["o"]:
                first_pos.setdefault(o[0], (o[1], o[2], o[3]))
    return objects, first_pos


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("replay", type=Path)
    ap.add_argument("--level", required=True)
    ap.add_argument("--mod", default="bf1942")
    ap.add_argument("--gamemode", default="Conquest")
    ap.add_argument("--game-dir", type=Path, default=DEFAULT_GAME_DIR)
    ap.add_argument("--radius", type=float, default=25.0,
                    help="how close a recorded object must be to count as that spawn point")
    ap.add_argument("--client", type=int, default=None,
                    help="network id of the recording client's soldier; "
                         "defaults to the vehicle id in the first player record")
    args = ap.parse_args()

    spawns = read_spawns(args.game_dir, args.mod, args.level, args.gamemode)
    objects, first_pos = read_recording(args.replay)

    client = args.client
    if client is None:
        for line in args.replay.open(encoding="utf-8"):
            rec = json.loads(line)
            if rec.get("k") == "p" and rec["p"]:
                client = rec["p"][0][2]
                break
    client_pos = first_pos.get(client, (0.0, 0.0, 0.0))

    # Control points sit on top of vehicle spawns and would steal matches; they
    # are the objects the engine reports with team -1. The free camera is not a
    # spawned object either.
    not_a_vehicle = {oid for oid, o in objects.items()
                     if o.get("team") == -1 or o.get("tmpl") == "MultiPlayerFreeCamera"}
    not_a_vehicle.add(client)

    matched, missing, used = [], [], set()
    for spawn in spawns:
        best, best_d = None, math.inf
        for oid, pos in first_pos.items():
            if oid in used or oid in not_a_vehicle:
                continue
            d = math.dist(spawn["pos"], pos)
            if d < best_d:
                best, best_d = oid, d
        if best is not None and best_d <= args.radius:
            used.add(best)
            matched.append((spawn, best))
        else:
            missing.append(spawn)

    def from_client(spawn: dict) -> float:
        return math.dist(spawn["pos"], client_pos)

    print(f"\nspawn points defined by {args.level}/{args.gamemode} : {len(spawns)}")
    print(f"networked objects in the recording            : {len(objects)}")
    print(f"spawn points covered                          : {len(matched)}")
    print(f"spawn points MISSING                          : {len(missing)}")
    print(f"\nrecording client netid {client} at {tuple(round(v, 1) for v in client_pos)}")

    if matched:
        print(f"\nfarthest covered spawn point : {max(from_client(s) for s, _ in matched):.0f}m")
    if missing:
        print(f"nearest missing spawn point  : {min(from_client(s) for s in missing):.0f}m")

    print("\n--- missing, by distance from the client ---")
    for spawn in sorted(missing, key=from_client):
        print(f"  {from_client(spawn):7.0f}m  team={spawn['team']}  {spawn['tmpl']:22}"
              f" at {tuple(round(v) for v in spawn['pos'])}")

    print("\n--- covered, by distance from the client ---")
    for spawn, oid in sorted(matched, key=lambda t: from_client(t[0])):
        print(f"  {from_client(spawn):7.0f}m  team={spawn['team']}  {spawn['tmpl']:22}"
              f" -> id={oid} {objects[oid]['tmpl']}")


if __name__ == "__main__":
    main()
