#!/usr/bin/env python3
"""Tank fights from `extract_tank_fights.mjs` as flat tables, names keyed.

    python3 tools/recording-ml/flatten_tank_fights.py [--data ~/.cache/bfstats-recml]

Reads `<data>/extract/tankfights/<id>.json` (features/battle-schools, "Tank
fights from the recordings") and writes, beside the node exporter's tables,
`<data>/tables/<slug>/tank_fights.jsonl` (a row a fight) and
`tank_shots.jsonl` (a row a main-gun shot). The extract carries players'
names; these tables carry the key `export_recording_tables.mjs` gives the
same name (HMAC-SHA256 under `<data>/name-key`, first 16 hex digits).

A shot's `hit` is the detector's credited hit matched back to its shell, by
the detector's own rule: the hit falls between the shot and one second past
its closest pass, and the shell nearest its arrival that has no hit yet takes
it. `shooter_speed` is the hull's speed as it fired, `target_speed` and
`crossing_speed` the other hull's over the 0.8 s around the shot, the second
across the line of fire. Standard library only.
"""

from __future__ import annotations

import argparse
import hashlib
import hmac
import json
import math
from collections import defaultdict
from pathlib import Path

from common import data_dir

HIT_SLACK = 1.0  # tank-fights-detect.js RULES.hitSlack


def credit(shots: list[dict], hits: list[dict]) -> None:
    """Mark each aimed shot a credited hit names (`creditFor` in the detector)."""
    for hit in sorted(hits, key=lambda e: e["t"]):
        best, best_key = None, math.inf
        for shot in shots:
            if not shot["aimed"] or shot["side"] != hit["side"]:
                continue
            if not shot["t"] <= hit["t"] <= shot["t"] + shot["tau"] + HIT_SLACK + 0.3:
                continue
            late = hit["t"] - (shot["t"] + shot["tau"])
            key = (late if late >= -0.25 else 1e3 - late) + (1e6 if shot["hit"] else 0)
            if key < best_key:
                best, best_key = shot, key
        if best is not None and not best["hit"]:
            best["hit"] = True
            best["hp_drop"] = hit.get("drop")


def flatten(fight: dict, key) -> tuple[dict, list[dict]]:
    slug = fight["meta"]["slug"]
    dt = fight["dt"]
    sides = fight["sides"]

    def hull_at(side: int, t: float) -> tuple[list[float], list[float]]:
        track = sides[side]["p"]
        n = len(track) // 3
        i = max(0, min(n - 1, round(t / dt)))
        a, b = max(0, i - 2), min(n - 1, i + 2)
        span = (b - a) * dt or dt
        pos = track[i * 3:i * 3 + 3]
        vel = [(track[b * 3 + k] - track[a * 3 + k]) / span for k in range(3)]
        return pos, vel

    shots = []
    seen = defaultdict(int)
    seen_aimed = defaultdict(int)
    for shot in fight["shots"]:
        side = shot["side"]
        pos, vel = hull_at(1 - side, shot["t"])
        los = [pos[k] - shot["pos"][k] for k in range(3)]
        length = math.hypot(*los) or 1.0
        along = sum(vel[k] * los[k] / length for k in range(3))
        speed = math.hypot(*vel)
        seen[side] += 1
        if shot["aimed"]:
            seen_aimed[side] += 1
        shots.append({
            "slug": slug, "fight": fight["id"], "side": side, "t": shot["t"], "weapon": shot["weapon"],
            "shell_speed": shot["speed"], "gravity": shot["gravity"], "aimed": shot["aimed"],
            "miss": shot.get("miss"), "tau": shot.get("tau", 0.0), "range": shot.get("range"),
            "hull_range": round(length, 1), "shooter_speed": round(math.hypot(*shot["pv"]), 2),
            "target_speed": round(speed, 2), "crossing_speed": round(math.sqrt(max(0.0, speed * speed - along * along)), 2),
            "shot_number": seen[side], "aimed_number": seen_aimed[side] if shot["aimed"] else None,
            "hit": False, "hp_drop": None,
        })
    credit(shots, [e for e in fight["evidence"] if e["kind"] == "hit"])
    row = fight["row"]
    kill = fight.get("kill")
    fight_row = {
        "slug": slug, "fight": fight["id"], "t0": fight["t0"], "duration": fight["duration"], "ending": row["ending"],
        "winner_side": None if row["winner"] is None else "ab".index(row["winner"]),
        "kill_t": kill["t"] if kill else None, "kill_range": fight.get("range"), "mutual": row["mutual"],
        "full_hp_start": row["fullHpStart"], "upset": row["upset"], "closest": row["closest"],
    }
    for i, side in enumerate(sides):
        fight_row.update({
            f"player{i}": key(side.get("name")), f"team{i}": side.get("team"), f"tank{i}": side.get("tmpl"),
            f"weight{i}": side.get("weight"), f"hp_start{i}": side.get("hpStart"), f"hp_max{i}": side.get("hpMax"),
            f"shots{i}": side.get("shots"), f"aimed{i}": side.get("aimed"), f"hits{i}": side.get("hits"),
            f"turret{i}": any(v is not None for v in side.get("turret") or []),
        })
    return fight_row, shots


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--data")
    args = parser.parse_args()
    data = data_dir(args.data)
    secret = bytes.fromhex((data / "name-key").read_text().strip())

    def key(name: str | None) -> str | None:
        return hmac.new(secret, name.encode("utf-8"), hashlib.sha256).hexdigest()[:16] if name else None

    fights: dict[str, list[dict]] = defaultdict(list)
    shots: dict[str, list[dict]] = defaultdict(list)
    source = data / "extract" / "tankfights"
    for path in sorted(source.glob("*.json")):
        if path.name == "index.json":
            continue
        fight_row, fight_shots = flatten(json.loads(path.read_text()), key)
        fights[fight_row["slug"]].append(fight_row)
        shots[fight_row["slug"]].extend(fight_shots)
    # Every exported recording gets both files, so one that lost its fights
    # in a later extract does not keep stale rows.
    for folder in sorted((data / "tables").iterdir()):
        if not (folder / "recordings.jsonl").exists():
            continue
        for name, rows in (("tank_fights", fights.get(folder.name, [])), ("tank_shots", shots.get(folder.name, []))):
            (folder / f"{name}.jsonl").write_text("".join(json.dumps(r) + "\n" for r in rows))
    print(json.dumps({"fights": sum(map(len, fights.values())), "shots": sum(map(len, shots.values())),
                      "hits": sum(s["hit"] for rows in shots.values() for s in rows)}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
