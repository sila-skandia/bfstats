#!/usr/bin/env python3
"""Re-export a published level's reflection cube without a full bake.

    python3 patch_sky.py --mod EoD --all
    python3 patch_sky.py --mod bf1942 coral_sea truk

The six `sky/<face>.png` files and the `envmap` key of `scene.json` (and
`skybox`, where the level has no sky box mesh and the cube doubles as the
background) belong to the `scene` layer, which only a full bake writes
(features/level-bake-layers). A full bake of Eve of Destruction is an hour
and a half; this writes the cube alone, with the same `write_skybox` the bake
uses, from the same `LevelContext` and the same chain-wide texture pool.

Levels whose `envmap` is already set are left alone unless `--force`. The
`scene.json` round-trip rule is `patch_scene.py`'s: a file that is not the
extractor's own serialisation is refused rather than reformatted.
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import scene_layers  # noqa: E402
from patch_scene import DEFAULT_GAME_DIR, MAPS  # noqa: E402


def patch_level(game_dir: Path, mod: str, level_dir: Path, *, tree: Path,
                force: bool = False, dry_run: bool = False) -> dict:
    import extract_map
    scene = level_dir / "scene.json"
    original = scene.read_text()
    report = json.loads(original)
    if scene_layers.dump(report) != original:
        raise ValueError(f"{scene} does not round-trip through indent=2 json")
    if report.get("envmap") and not force:
        return {"level": level_dir.name, "changed": [], "written": False,
                "faces": report["envmap"], "skipped": "already has a cube"}
    ctx = scene_layers.LevelContext(
        game_dir, mod, report.get("level") or level_dir.name, out=tree)
    if ctx.info.name.lower() != level_dir.name.lower():
        raise ValueError(f"{level_dir.name}: the archive answers as {ctx.info.name}")
    _meshes, textures, _objects, _game = ctx.pools
    extract_map.mount_level_pools(ctx)
    written_faces = None
    if dry_run:
        # Resolve every face without writing: the same lookups, no PNGs.
        for name in extract_map._cubemap_candidates(ctx.files, ctx.info.envmap_rcm):
            mapping = extract_map.parse_cubemap_rcm(
                ctx.files.read(name).decode("latin-1"))
            if len(mapping) == 6 and all(
                    extract_map._cubemap_face_bytes(ctx.files, textures, p) is not None
                    for p in mapping.values()):
                written_faces = [f"sky/{f}.png" for f in ("px", "nx", "py", "ny", "pz", "nz")]
                break
    else:
        written_faces = extract_map.write_skybox(
            ctx.files, level_dir, textures=textures, rcm=ctx.info.envmap_rcm)
    merged = dict(report)
    merged["envmap"] = written_faces
    # Without a sky box the cube is also the background (`extract_map.main`).
    if not report.get("sky"):
        merged["skybox"] = written_faces
    changed = sorted(k for k in set(report) | set(merged)
                     if json.dumps(report.get(k)) != json.dumps(merged.get(k)))
    text = scene_layers.dump(merged)
    written = text != original
    if written and not dry_run:
        tmp = scene.with_suffix(".json.tmp")
        tmp.write_text(text)
        tmp.replace(scene)
    return {"level": level_dir.name, "changed": changed, "written": written,
            "faces": written_faces}


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("levels", nargs="*", help="level directory names")
    ap.add_argument("--all", action="store_true",
                    help="every level with a scene.json in the tree")
    ap.add_argument("--mod", default="bf1942")
    ap.add_argument("--game-dir", type=Path, default=DEFAULT_GAME_DIR)
    ap.add_argument("--out", type=Path, default=MAPS)
    ap.add_argument("--tree", type=Path, default=None,
                    help="the level tree to patch (default: --out, or --out/mods/<mod>)")
    ap.add_argument("--force", action="store_true",
                    help="rewrite levels that already have a cube")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args(argv)

    game_dir = args.game_dir.expanduser()
    tree = args.tree or scene_layers.tree_for(args.out, args.mod)
    if not tree.is_dir():
        sys.exit(f"no maps tree at {tree}; pass --out or --tree")
    wanted = list(args.levels)
    if args.all:
        wanted = [p.name for p in sorted(tree.iterdir()) if (p / "scene.json").is_file()]
    if not wanted:
        ap.error("name levels or pass --all")

    rc = 0
    written = 0
    missing = []
    started = time.time()
    for name in wanted:
        level_dir = tree / name.lower()
        if not (level_dir / "scene.json").is_file():
            print(f"{name}: no scene.json in {level_dir}", file=sys.stderr)
            rc = 1
            continue
        t0 = time.time()
        try:
            result = patch_level(game_dir, args.mod, level_dir, tree=tree,
                                 force=args.force, dry_run=args.dry_run)
        except (Exception, SystemExit) as exc:  # noqa: BLE001 - one level, not the run
            print(f"{name}: FAILED {exc}", file=sys.stderr)
            rc = 1
            continue
        written += result["written"]
        if result.get("skipped"):
            print(f"{result['level']}: {result['skipped']}")
            continue
        if not result["faces"]:
            missing.append(result["level"])
        verb = "would change" if args.dry_run else "changed"
        what = (f"{verb} {', '.join(result['changed'])}" if result["changed"]
                else ("unchanged" if result["faces"] else "no cube resolves"))
        print(f"{result['level']}: {what} ({time.time() - t0:.1f} s)")
    print(f"{len(wanted)} level(s), {written} scene.json "
          f"{'would be ' if args.dry_run else ''}written, "
          f"{len(missing)} without a cube, {time.time() - started:.0f} s")
    if missing:
        print("no cube: " + ", ".join(missing))
    return rc


if __name__ == "__main__":
    raise SystemExit(main())
