#!/usr/bin/env python3
"""The hand weapons whose round puts an object in the world: which object,
where, and for how long.

    python3 extract_deployables.py --mod DC_Final \
        --out viewer/models/mods/dc_final
    python3 extract_deployables.py --mod DesertCombat \
        --out viewer/models/mods/desertcombat

Writes `<out>/deployables.json`. Desert Combat's mortar is the case that asked
for it: the Support kit's `Mortar_weap` fires `mortarbomb`, a one-second
projectile that carries `mortarspawner3` as a child, and that ObjectSpawner
places a `Mortar` a soldier can crew. Nothing on the hand weapon names the
mortar; the chain is weapon -> `projectileTemplate` -> the projectile's
`addTemplate` children -> the ObjectSpawner among them -> its
`setObjectTemplate <team>` entries. The engine rules the viewer plays it by
are `viewer/deployables.js`'s (features/dc-mortar-and-kit-pads).

A field the scripts leave unset carries the engine's own default, read from
`ObjectSpawnerTemplate::ObjectSpawnerTemplate` (lnxded 0x08314a70) and named
by `ObjectSpawnerTemplate::makeScript` (0x08314f70):

    minSpawnDelay 30 (+0x14c)   maxSpawnDelay 60 (+0x150)
    TimeToLive    30 (+0x154)   Distance     100 (+0x158)
    team           0 (+0x15c)   maxNrOfObjectSpawned 1 (+0x168)
    spawnOffset    0 (+0x174)   damageWhenLost 1.0 (+0x180, ConsoleClass435
    holdObject     0 (+0x184)   0x082e9060)   teamOnVehicle 0 (+0x185)

`SpawnDelay` (ConsoleClass419 0x082e51b0) writes both delays. The object's
own hit points, critical damage and category ride along from its template, so
the page can run its life without its glb in hand. Standard library plus the
system liblzo2, like the rest of the pipeline.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from bf42 import level as level_mod  # noqa: E402
from extract_models import (  # noqa: E402
    DEFAULT_GAME_DIR, build_library, build_pools, mod_chain,
)

FORMAT = "bf1942-deployables/1"

# `ObjectSpawnerTemplate::ObjectSpawnerTemplate` (lnxded 0x08314a70).
SPAWNER_DEFAULTS = {
    "minSpawnDelay": 30.0,
    "maxSpawnDelay": 60.0,
    "timeToLive": 30.0,
    "distance": 100.0,
    "team": 0,
    "maxNrOfObjectSpawned": 1,
    "spawnOffset": [0.0, 0.0, 0.0],
    "damageWhenLost": 1.0,
    "holdObject": False,
    "teamOnVehicle": False,
}


def _vec(value) -> list[float] | None:
    if value is None:
        return None
    return [round(float(v), 6) for v in value]


def block_words(text: str, name: str) -> dict[str, str]:
    """`ObjectTemplate.<word> <args>` of the `create` block named `name`, the
    word lower-cased and any `set` prefix dropped: the console takes a
    property with or without it (DC Final's `setHasMobilePhysics 1` beside
    DC's `hasMobilePhysics 1`), and the object parser reads only one of the
    two spellings for some words. Last write wins, as in the console."""
    words: dict[str, str] = {}
    inside = False
    for raw in text.splitlines():
        line = raw.strip()
        if not line.lower().startswith("objecttemplate."):
            continue
        head, _, args = line[len("objecttemplate."):].partition(" ")
        word = head.lower()
        if word == "create":
            tokens = args.split()
            inside = len(tokens) >= 2 and tokens[1].lower() == name.lower()
            continue
        if not inside:
            continue
        if word.startswith("set") and len(word) > 3:
            word = word[3:]
        words[word] = args.strip()
    return words


def _flag(words: dict[str, str], word: str) -> bool | None:
    value = words.get(word)
    if value is None:
        return None
    return value.split()[0].startswith("1") if value.split() else None


def spawner_record(library, objects, name: str, position) -> dict | None:
    """One ObjectSpawner template as the page reads it, defaults filled in."""
    template = library.object(name)
    if template is None or template.kind.lower() != "objectspawner":
        return None
    record = {"name": template.name, "position": _vec(position) or [0.0, 0.0, 0.0],
              **{key: (list(value) if isinstance(value, list) else value)
                 for key, value in SPAWNER_DEFAULTS.items()}}
    record["templates"] = {str(team): vehicle
                           for team, vehicle in sorted(template.spawner_vehicles.items())}
    if template.spawner_team is not None:
        record["team"] = template.spawner_team
    if template.spawner_hold_object is not None:
        record["holdObject"] = bool(template.spawner_hold_object)
    if template.spawner_distance is not None:
        record["distance"] = template.spawner_distance
    if template.spawner_spawn_offset is not None:
        record["spawnOffset"] = _vec(template.spawner_spawn_offset)
    if template.spawner_max_nr is not None:
        record["maxNrOfObjectSpawned"] = template.spawner_max_nr
    if template.spawner_damage_when_lost is not None:
        record["damageWhenLost"] = template.spawner_damage_when_lost
    if template.time_to_live is not None:
        record["timeToLive"] = template.time_to_live
    # The delays and `teamOnVehicle` are the level parser's words; the block
    # is read again from its own file for them.
    blob = objects.try_read(template.source) if template.source else None
    if blob is not None:
        spec = level_mod.parse_spawn_templates(blob.decode("latin-1")).get(name.lower())
        if spec is not None:
            if spec.spawn_delay is not None:
                record["minSpawnDelay"] = record["maxSpawnDelay"] = spec.spawn_delay
            if spec.min_spawn_delay is not None:
                record["minSpawnDelay"] = spec.min_spawn_delay
            if spec.max_spawn_delay is not None:
                record["maxSpawnDelay"] = spec.max_spawn_delay
            record["teamOnVehicle"] = bool(spec.team_on_vehicle)
    return record


def object_record(library, name: str, models: dict[str, dict]) -> dict:
    """What the page needs of a spawned object before its glb is in hand."""
    template = library.object(name)
    row = models.get(name.lower())
    record: dict = {"template": template.name if template else name,
                    "glb": (row or {}).get("glb") or f"{name.replace('/', '_')}.glb"}
    if template is not None:
        record["kind"] = template.kind
        if template.vehicle_category:
            record["vehicleCategory"] = template.vehicle_category
        for key, value in (("hitpoints", template.hitpoints),
                           ("maxHitpoints", template.max_hitpoints),
                           ("criticalDamage", template.critical_damage),
                           ("hpLostWhileCriticalDamage",
                            template.hp_lost_while_critical_damage),
                           ("timeToLiveAfterDeath", template.time_to_live_after_death)):
            if value is not None:
                record[key] = value
    radius = ((row or {}).get("dimensions") or {}).get("radius")
    if radius is not None:
        record["radius"] = radius
    return record


def collect(library, objects, models: dict[str, dict]) -> dict:
    """Every hand weapon whose projectile carries an ObjectSpawner."""
    weapons: dict[str, dict] = {}
    placed: dict[str, dict] = {}
    for template in sorted(library.objects.values(), key=lambda t: t.name.lower()):
        if template.kind.lower() != "handfirearms" or not template.projectile_template:
            continue
        projectile = library.object(template.projectile_template)
        if projectile is None:
            continue
        spawners = [spawner_record(library, objects, ref.template, ref.position)
                    for ref in projectile.children]
        spawners = [s for s in spawners if s is not None]
        if not spawners:
            continue
        spawner = spawners[0]
        blob = objects.try_read(projectile.source) if projectile.source else None
        words = block_words(blob.decode("latin-1"), projectile.name) if blob else {}
        mobile = _flag(words, "hasmobilephysics")
        collision = _flag(words, "hascollisionphysics")
        weapons[template.name] = {
            "projectile": projectile.name,
            "projectilePosition": _vec(template.projectile_position) or [0.0, 0.0, 0.0],
            "velocity": template.velocity if template.velocity is not None else 0.0,
            "fireInCameraDof": bool(template.fire_in_camera_dof),
            "bomb": {
                "timeToLive": projectile.time_to_live,
                "collision": bool(projectile.has_collision_physics if collision is None
                                  else collision),
                "mobile": bool(projectile.has_mobile_physics if mobile is None else mobile),
                "response": bool(_flag(words, "hasresponsephysics")),
            },
            "spawner": spawner,
        }
        for vehicle in spawner["templates"].values():
            if vehicle.lower() not in {k.lower() for k in placed}:
                placed[vehicle] = object_record(library, vehicle, models)
    return {"weapons": weapons, "objects": placed}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--mod", required=True)
    ap.add_argument("--game-dir", type=Path, default=DEFAULT_GAME_DIR)
    ap.add_argument("--out", type=Path, required=True,
                    help="the mod's model tree; deployables.json lands there")
    args = ap.parse_args()

    chain = mod_chain(args.game_dir.expanduser(), args.mod)
    _meshes, _textures, objects, _game = build_pools(chain, [])
    library = build_library(objects)
    models: dict[str, dict] = {}
    manifest = args.out / "models.json"
    if manifest.is_file():
        for row in json.loads(manifest.read_text()):
            models.setdefault(str(row.get("name", "")).lower(), row)
    found = collect(library, objects, models)
    document = {"format": FORMAT, "mod": args.mod, **found}
    args.out.mkdir(parents=True, exist_ok=True)
    target = args.out / "deployables.json"
    target.write_text(json.dumps(document, indent=1) + "\n")
    print(f"{target}: {len(found['weapons'])} weapon(s), "
          f"{len(found['objects'])} object(s)", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
