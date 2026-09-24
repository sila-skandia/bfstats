#!/usr/bin/env python3
"""Rebuild named layers of published levels' `scene.json`, nothing else.

    python3 patch_scene.py --layer controlPoints --mod bf1942 --all
    python3 patch_scene.py --layer ai sounds --mod XPack1 --all
    python3 patch_scene.py el_alamein wake --layer game
    python3 patch_scene.py --layer damage --mod XPack2 --levels essen

Layers (see `scene_layers.py`; `features/level-bake-layers/README.md` maps
each kind of change to one):

    controlPoints   the flags' settings (implies spawns, which reads them)
    spawns          soldier, vehicle soldier and object spawn lists
    game            tickets, modes' game types, gameplayMode, combatArea
    environment     fog, sun, lighting, water level, draw distance
    damage          the `damage` key and the mod's _shared/damage.json
    sounds          the `sounds` key; new samples into _shared/sounds
    ai              the `ai` key and the level's pathfinding/ folder
    all             every one of them

Each level's layers are re-parsed from the game install and swapped into its
`scene.json` in place. Every other key keeps its position and its bytes: the
file is re-dumped with the extractor's own `indent=2`, which is checked to
reproduce the file as it stands before anything is written, and a file whose
content did not change is not rewritten at all. The glb is never opened. A
full `extract_map.py` bake writes the same layers through the same functions
(`tests/test_scene_layers.py` holds the two together).

`--all` takes the levels that already have a `scene.json` in the tree, so a
pack's tree (which holds only the pack's own levels) is never widened with the
vanilla levels its archives inherit. `--mod EoD` is accepted like any mod.
"""
from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import json  # noqa: E402

import scene_layers  # noqa: E402
from extract_models import DEFAULT_GAME_DIR  # noqa: E402

MAPS = HERE / "viewer" / "maps"


def patch_level(game_dir: Path, mod: str, level_dir: Path, layers: list[str], *,
                tree: Path, shared_sounds: Path | None = None,
                audio_format: str = "mp3", dry_run: bool = False) -> dict:
    """Patch one level. Returns {"level", "changed": [keys], "written": bool}."""
    scene = level_dir / "scene.json"
    original = scene.read_text()
    report = json.loads(original)
    if scene_layers.dump(report) != original:
        # Not the extractor's serialisation, so a rewrite would reformat keys
        # nobody asked to touch. Refuse rather than churn a published file.
        raise ValueError(f"{scene} does not round-trip through indent=2 json")
    ctx = scene_layers.LevelContext(
        game_dir, mod, report.get("level") or level_dir.name, out=tree,
        shared_sounds=shared_sounds, audio_format=audio_format)
    if ctx.info.name.lower() != level_dir.name.lower():
        raise ValueError(f"{level_dir.name}: the archive answers as {ctx.info.name}")
    ctx.placed_flags = scene_layers.placed_from_report(report)
    warnings = []
    if "controlPoints" in layers and ctx.placed_flags is not None:
        for inst in ctx.info.gameplay.control_points:
            tpl = ctx.info.gameplay.template_for(inst)
            if tpl is not None and tpl.visible and inst.template.lower() not in ctx.placed_flags:
                warnings.append(f"{inst.template} is visible in the con but not in the "
                                "glb: a new flag is a placement, re-bake the level")
    top, modes = scene_layers.compute(ctx, layers)
    merged = scene_layers.merge(report, layers, top, modes)
    text = scene_layers.dump(merged)
    # Compared as serialised text: a freshly computed layer holds tuples where
    # the parsed file holds lists (`sounds.flags.randomStartPitch`), equal on disk but
    # not to `!=`.
    changed = sorted(k for k in set(report) | set(merged)
                     if json.dumps(report.get(k)) != json.dumps(merged.get(k)))
    written = text != original
    if written and not dry_run:
        tmp = scene.with_suffix(".json.tmp")
        tmp.write_text(text)
        tmp.replace(scene)
    return {"level": level_dir.name, "changed": changed, "written": written,
            "warnings": warnings}


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("levels", nargs="*", help="level directory names")
    ap.add_argument("--levels", dest="more_levels", nargs="*", default=[],
                    help="more level names (the extract_maps_all.py spelling)")
    ap.add_argument("--all", action="store_true",
                    help="every level in the tree that has a scene.json")
    ap.add_argument("--layer", nargs="+", required=True,
                    choices=[*scene_layers.LAYERS, "all"])
    ap.add_argument("--mod", default="bf1942")
    ap.add_argument("--game-dir", type=Path, default=DEFAULT_GAME_DIR)
    ap.add_argument("--out", type=Path, default=MAPS,
                    help="the maps root (default viewer/maps); a mod's levels "
                         "are under <out>/mods/<mod>. See --tree.")
    ap.add_argument("--tree", type=Path, default=None,
                    help="the directory holding the level folders, when it is "
                         "not <out> (vanilla) or <out>/mods/<mod>")
    ap.add_argument("--shared-sounds", type=Path, default=None,
                    help="default <tree>/_shared/sounds, as the bake uses")
    ap.add_argument("--audio-format", choices=("mp3", "wav"), default="mp3")
    ap.add_argument("--dry-run", action="store_true",
                    help="say what would change, write nothing (samples, "
                         "damage.json and pathfinding/ are still written: "
                         "they are the layer's own side files)")
    args = ap.parse_args(argv)

    names = list(scene_layers.LAYERS) if "all" in args.layer else list(args.layer)
    layers = scene_layers.expand(names)
    if layers != [n for n in scene_layers.LAYERS if n in names]:
        print(f"layers:   {' '.join(layers)} (with what reads them)", file=sys.stderr)
    game_dir = args.game_dir.expanduser()
    tree = args.tree or scene_layers.tree_for(args.out, args.mod)
    if not tree.is_dir():
        # A fresh worktree has no maps tree of its own (`link_viewer_assets.sh`
        # links the shared one); say so rather than trace back.
        sys.exit(f"no maps tree at {tree}; pass --out or --tree")
    wanted = [*args.levels, *args.more_levels]
    if args.all:
        wanted = [p.name for p in sorted(tree.iterdir()) if (p / "scene.json").is_file()]
    if not wanted:
        ap.error("name levels or pass --all")
    if "sounds" in layers and args.audio_format == "mp3":
        import extract_map
        if not extract_map.ffmpeg_available():
            sys.exit("ffmpeg is not on PATH; the sounds layer transcodes new samples")

    rc = 0
    written = 0
    started = time.time()
    for name in wanted:
        level_dir = tree / name.lower()
        if not (level_dir / "scene.json").is_file():
            print(f"{name}: no scene.json in {level_dir}", file=sys.stderr)
            rc = 1
            continue
        t0 = time.time()
        try:
            result = patch_level(game_dir, args.mod, level_dir, layers, tree=tree,
                                 shared_sounds=args.shared_sounds,
                                 audio_format=args.audio_format, dry_run=args.dry_run)
        except (Exception, SystemExit) as exc:  # noqa: BLE001 - one level, not the run
            print(f"{name}: FAILED {exc}", file=sys.stderr)
            rc = 1
            continue
        written += result["written"]
        verb = "would change" if args.dry_run else "changed"
        what = f"{verb} {', '.join(result['changed'])}" if result["changed"] else "unchanged"
        print(f"{result['level']}: {what} ({time.time() - t0:.1f} s)")
        for warning in result["warnings"]:
            print(f"  warning: {warning}")
    print(f"{len(wanted)} level(s), {written} scene.json "
          f"{'to write' if args.dry_run else 'written'}, {time.time() - started:.1f} s "
          f"[{' '.join(layers)}]")
    return rc


if __name__ == "__main__":
    raise SystemExit(main())
