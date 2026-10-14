#!/usr/bin/env python3
"""Census: SupplyDepots inside a held object that burns itself down, on the
EXPORTED levels of every tree (the rows of each tree's maps.json; FHSW and
FHSWEurope: the rows with a `loading` block).

FHSW's bombers carry `AlliedAirSpawnSelfReloaderSpawner`, which holds an
object whose Armor is authored over its own critical threshold (200 hit
points, `criticalDamage 201`, 100 a second): it bleeds from its first second,
is destroyed at 2 s (HP-17), and its 20 m ammo depot stops with it; the
spawner makes the next one its delay later (SPAWN-24). Until 2026-10-15 the
viewer kept such a depot alive for as long as its plane lived, so the A-26
and the Lancaster rearmed anywhere (`viewer/supply.js` `heldObjectLife`).

For each depot template: the held object, its life, the spawner's delay, how
many placed hulls carry it and on how many levels.

    python3 surveys/census_held_depots.py [--trees fhsweurope,fhsw] [--json -]

From tools/bf1942-models. Reads the level glbs' JSON chunks.
"""

from __future__ import annotations

import argparse
import collections
import json
import math
import struct
import sys
from pathlib import Path

VIEWER = Path(__file__).resolve().parent.parent / "viewer"
LOADING_ONLY = {"fhsw", "fhsweurope"}


def trees():
    out = [("bf1942", VIEWER / "maps")]
    for mod in json.loads((VIEWER / "models" / "mods.json").read_text()).get("mods", []):
        maps = VIEWER / "maps" / "mods" / mod["id"]
        if (maps / "maps.json").is_file():
            out.append((mod["id"], maps))
    return out


def exported(tree: str, root: Path) -> list[dict]:
    rows = json.loads((root / "maps.json").read_text())
    if isinstance(rows, dict):
        rows = rows.get("maps") or rows.get("levels") or []
    if tree in LOADING_ONLY:
        rows = [r for r in rows if r.get("loading")]
    return rows


def glb_json(path: Path) -> dict:
    with open(path, "rb") as fh:
        head = fh.read(20)
        return json.loads(fh.read(struct.unpack("<I", head[12:16])[0]))


def held_life(armor: dict | None) -> float:
    """`viewer/supply.js` `heldObjectLife`."""
    armor = armor or {}
    hp, critical = armor.get("hitpoints"), armor.get("criticalDamage")
    rate = armor.get("hpLostWhileCriticalDamage")
    if not (isinstance(hp, (int, float)) and hp > 0 and isinstance(rate, (int, float)) and rate > 0):
        return math.inf
    if not (isinstance(critical, (int, float)) and hp <= critical):
        return math.inf
    return math.ceil(hp / rate)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--trees")
    ap.add_argument("--json")
    args = ap.parse_args()
    wanted = set(args.trees.split(",")) if args.trees else None
    report = {}
    for tree, root in trees():
        if wanted and tree not in wanted:
            continue
        rows = exported(tree, root)
        kinds: dict[str, dict] = {}
        carriers = collections.Counter()
        levels = collections.defaultdict(set)
        for row in rows:
            glb = root / (row.get("glb") or f"{row.get('name')}/scene.glb")
            if not glb.is_file():
                continue
            doc = glb_json(glb)
            nodes = doc["nodes"]
            parent = {c: i for i, nd in enumerate(nodes) for c in nd.get("children", [])}
            for i, nd in enumerate(nodes):
                ex = nd.get("extras") or {}
                if ex.get("templateKind") != "SupplyDepot":
                    continue
                q, life, held, top = parent.get(i), math.inf, None, None
                while q is not None:
                    qx = nodes[q].get("extras") or {}
                    if qx.get("heldSpawner") and held is None:
                        lf = held_life(qx.get("armor"))
                        if math.isfinite(lf):
                            life, held = lf, nodes[q]
                    if qx.get("templateKind") == "PlayerControlObject":
                        top = nodes[q]
                    q = parent.get(q)
                if held is None:
                    continue
                hs = held["extras"]["heldSpawner"]
                key = str(nd.get("name")).rstrip("_0123456789")
                kinds.setdefault(key, {
                    "heldObject": str(held.get("name")).rstrip("_0123456789"),
                    "life": life, "delay": [hs.get("minSpawnDelay"), hs.get("maxSpawnDelay")],
                    "ammoRows": len((ex.get("supply") or {}).get("ammoTypes") or []),
                    "radius": (ex.get("supply") or {}).get("radius"),
                    "carriers": set()})
                carrier = str((top or {}).get("name")).rstrip("_0123456789")
                kinds[key]["carriers"].add(carrier)
                carriers[key] += 1
                levels[key].add(row.get("name") or glb.parent.name)
        report[tree] = {k: {**v, "carriers": sorted(v["carriers"]), "placed": carriers[k],
                            "levels": len(levels[k])} for k, v in sorted(kinds.items())}
        total = sum(carriers.values())
        nlev = len(set().union(*levels.values())) if levels else 0
        print(f"{tree:14} levels {len(rows):4}  burn-down depots: {len(kinds):2} templates, "
              f"{total:4} placed on {nlev:3} levels", file=sys.stderr)
        for k, v in report[tree].items():
            print(f"    {k} in {v['heldObject']}: life {v['life']} s, delay {v['delay']}, "
                  f"r{v['radius']}, {v['ammoRows']} ammo rows, {v['placed']} placed on {v['levels']} "
                  f"levels ({', '.join(v['carriers'][:8])})", file=sys.stderr)
    if args.json:
        text = json.dumps(report, indent=1)
        if args.json == "-":
            print(text)
        else:
            Path(args.json).write_text(text)
    return 0


if __name__ == "__main__":
    sys.exit(main())
