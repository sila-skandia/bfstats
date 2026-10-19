#!/usr/bin/env python3
"""Census: kits in play on the EXPORTED levels of a tree only as pickups —
laid on a pad by a placed ObjectSpawner, stood by a placed object's own
spawners (FHSW's cola machines), or thrown down by a vehicle's deploy round —
that no exported level's deploy table (`game.setKit`) deals, and which of
them the tree's `kits.json` on disk is missing.

The replay-404 audit of 2026-10-19 found FHSWEurope's `Us_ColaBottleFighter*`
in no `kits.json`: a kit only ever reachable by walking over it was outside
`extract_kits.py`'s scope, a recording that carried one 404'd
`models/<kit>.glb` in every tree, and the page drew nothing. This census
measures that class per tree, with the extended scope
(`bf42.kit.static_templates` + `bf42.kit.spawner_laid_kits`).

    python3 surveys/census_pickup_kits.py --trees fhsweurope [--json out.json]
    python3 surveys/census_pickup_kits.py --trees all --viewer <main viewer>

One tree per run keeps the chain census' memory bounded; `--trees all` loops
them in one process. Exported levels only (each tree's `maps.json` rows, the
`loading`-block rows where the tree marks imports that way), never the whole
install. From tools/bf1942-models.
"""

from __future__ import annotations

import argparse
import gc
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(HERE))

from bf42 import kit as kit_mod  # noqa: E402
import extract_map as em  # noqa: E402
from extract_models import (DEFAULT_GAME_DIR, build_library, build_pools,  # noqa: E402
                            discover_levels, mod_chain)
from mod_pipeline import MODS, ModConfig  # noqa: E402


def tree_paths(viewer: Path, tree_id: str) -> tuple[Path, Path]:
    """(models dir, maps dir) of a tree id; `bf1942` is the root pair."""
    if tree_id == "bf1942":
        return viewer / "models", viewer / "maps"
    return viewer / "models" / "mods" / tree_id, viewer / "maps" / "mods" / tree_id


def exported_levels(maps_json: Path) -> set[str]:
    """The exported set: every row, or the `loading`-block rows where the
    tree marks imports that way (FHSW, FHSWEurope)."""
    rows = json.loads(maps_json.read_text())
    loaded = [e for e in rows if e.get("loading")]
    kept = loaded if loaded else rows
    return {e["name"].lower() for e in kept}


def census_tree(cfg: ModConfig, viewer: Path, game_dir: Path) -> dict | None:
    models_dir, maps_dir = tree_paths(viewer, cfg.id)
    maps_json = maps_dir / "maps.json"
    kits_json = models_dir / "kits.json"
    if not maps_json.is_file() or not kits_json.is_file():
        return None
    exported = exported_levels(maps_json)
    on_disk = {k["template"].lower()
               for k in json.loads(kits_json.read_text()).get("kits", [])}

    chain = mod_chain(game_dir, cfg.install)
    if not chain:
        print(f"  {cfg.id}: no mod chain for {cfg.install}", file=sys.stderr)
        return None
    levels = [(name, path) for name, path in discover_levels(chain)
              if name.lower() in exported]
    # What each exported level's placements name (spawners and statics) ...
    pads = kit_mod.level_pads(levels, chain)
    placed_by_spawner = {level: set(named) for level, named in pads.items()}
    # ... and the library the kits resolve in: the chain's objects with the
    # exported levels' own scripts registered, as `read_chain_levels` builds
    # it (a quarter of a big mod's kits are declared in level archives).
    _m, _t, objects, _g = build_pools(chain, [])
    for name, _path in levels:
        try:
            em.add_level_run_objects(objects, chain, name)
        except Exception as exc:  # noqa: BLE001 - one unreadable level
            print(f"  {name}: level scripts unreadable ({exc})", file=sys.stderr)
    gc.collect()
    library = build_library(objects)
    kit_mod.add_spawner_laid_kits(library, pads)
    kits = kit_mod.collect(library)
    kit_mod.sweep_levels(kits, levels, library, pads=pads)

    rows = []
    for kit in sorted(kits.values(), key=lambda k: k.template.lower()):
        if not (kit.live and kit.pads and not kit.slots):
            continue
        laid = sorted(level for level in kit.pads
                      if kit.template.lower() not in placed_by_spawner.get(level, ()))
        rows.append({
            "template": kit.template,
            "pickup": kit.pickup,
            "levels": sorted(kit.pads),
            # The levels where no placed ObjectSpawner names it: an object's
            # own spawners lay it there (the cola machine class).
            "objectLaid": laid,
            "inKitsJson": kit.template.lower() in on_disk,
        })
    return {
        "tree": cfg.id,
        "exportedLevels": len(exported),
        "pickupOnly": rows,
        "missing": [r["template"] for r in rows if not r["inKitsJson"]],
    }


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--trees", default="all",
                    help="comma-separated tree ids (fhsweurope,fhsw,...), "
                         "'bf1942' for vanilla, or 'all'")
    ap.add_argument("--viewer", type=Path, default=HERE / "viewer",
                    help="the viewer holding the trees' maps.json / kits.json")
    ap.add_argument("--game-dir", type=Path, default=DEFAULT_GAME_DIR)
    ap.add_argument("--json", type=Path, default=None)
    args = ap.parse_args()

    configs = {**{"bf1942": ModConfig("bf1942", "bf1942")}, **MODS}
    wanted = (list(configs) if args.trees == "all"
              else [t.strip() for t in args.trees.split(",") if t.strip()])
    out = []
    for tree_id in wanted:
        cfg = configs.get(tree_id)
        if cfg is None:
            print(f"  {tree_id}: no ModConfig", file=sys.stderr)
            continue
        print(f"{tree_id}:", file=sys.stderr)
        result = census_tree(cfg, args.viewer, args.game_dir)
        if result is None:
            print("  skipped (no maps.json/kits.json pair)", file=sys.stderr)
            continue
        out.append(result)
        for row in result["pickupOnly"]:
            tag = "" if row["inKitsJson"] else "  MISSING from kits.json"
            how = "object-laid" if row["objectLaid"] else "pad spawner"
            print(f"  {row['template']:40s} {how:12s} "
                  f"{len(row['levels'])} levels{tag}", file=sys.stderr)
        print(f"  {len(result['pickupOnly'])} pickup-only kits, "
              f"{len(result['missing'])} missing from kits.json", file=sys.stderr)
        gc.collect()
    if args.json:
        args.json.write_text(json.dumps(out, indent=1))
    print(json.dumps([{**r, "pickupOnly": len(r["pickupOnly"])} for r in out], indent=1))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
