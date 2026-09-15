#!/usr/bin/env python3
"""Bake the impact and projectile EffectBundles into one shared GLB.

`_shared/effects.glb` holds every bundle the MaterialManager can pick for a
hit (`damage.json`'s effects matrix names 73 of them in vanilla) plus the
bundles projectiles play on their own — trails and end-of-flight explosions.
Each bundle is a hidden template subtree: emitter nodes carrying their sprite
quad or `Particle` mesh and the whole authored spec in `extras.effectEmitter`.
`viewer/effects.js` clones one per impact and `effects-core.js` runs it the
way the engine does.

    python3 extract_effects.py --mod bf1942 --out viewer/maps/_shared
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from bf42 import effects as effects_mod  # noqa: E402
from bf42 import gltf  # noqa: E402
from bf42.assemble import Assembler, Report  # noqa: E402
from extract_map import load_damage_tables  # noqa: E402
from extract_models import DEFAULT_GAME_DIR, build_library, build_pools, mod_chain  # noqa: E402


def effect_names(tables, library, extra: list[str]) -> set[str]:
    names: set[str] = set(extra)
    if tables is not None:
        names.update(tables.effects.values())
    names.update(effects_mod.effect_names_for_projectiles(library))
    return names


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--game-dir", type=Path, default=DEFAULT_GAME_DIR)
    ap.add_argument("--mod", default="bf1942")
    ap.add_argument("--out", type=Path, default=Path(__file__).parent / "viewer" / "maps" / "_shared")
    ap.add_argument("--name", action="append", default=[],
                    help="extra bundle template(s) to bake")
    ap.add_argument("--max-texture", type=int, default=512)
    args = ap.parse_args()

    started = time.time()
    chain = mod_chain(args.game_dir, args.mod)
    meshes, textures, objects, game = build_pools(chain, [])
    library = build_library(objects)
    tables = load_damage_tables(game)
    names = effect_names(tables, library, args.name)

    assembler = Assembler(meshes, textures, objects, library,
                          include_collision=False, max_texture=args.max_texture)
    assembler.apply_material_diffuse = True
    builder = gltf.GlbBuilder()
    report = Report(root="effects", configuration="complex", lod=0)
    roots, index = assembler.bake_effect_library(builder, names, report)
    manifest = {
        "mod": args.mod,
        "bundles": index["bundles"],
        "missing": index["missing"],
        "missingTextures": sorted(set(report.missing_textures)),
        "missingMeshes": sorted(set(report.missing_meshes)),
    }
    glb = builder.build(roots, extras={"effects": manifest})
    args.out.mkdir(parents=True, exist_ok=True)
    (args.out / "effects.glb").write_bytes(glb)
    (args.out / "effects.report.json").write_text(json.dumps(manifest, indent=1))
    print(f"{len(index['bundles'])} bundles, {sum(b['emitters'] for b in index['bundles'].values())} emitters, "
          f"{len(glb) // 1024} KB, {len(index['missing'])} missing, "
          f"{len(manifest['missingTextures'])} missing textures, in {time.time() - started:.1f}s "
          f"-> {args.out / 'effects.glb'}")
    if index["missing"]:
        print("missing:", ", ".join(index["missing"]))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
