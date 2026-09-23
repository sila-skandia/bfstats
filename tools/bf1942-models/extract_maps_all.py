#!/usr/bin/env python3
"""Extract every level a mod ships, in parallel, and say what failed.

    python3 extract_maps_all.py                                  # vanilla, all 23
    python3 extract_maps_all.py --mod EoD --out viewer/maps/mods/eod -j 8
    python3 extract_maps_all.py --mod EoD --levels A_Shau Hue_Imperial_Palace
    python3 extract_maps_all.py --mod EoD --skip-existing         # resume a run

This is the full bake. A change that only moves con-derived values in
`scene.json` (control points, spawns, tickets, fog, damage, sounds, AI) is a
layer, and `patch_scene.py --layer <name> --mod <M> --all` rewrites it in
seconds without touching a glb; see `features/level-bake-layers/README.md`.

`extract_map.py` takes one level, which is right for iterating on one map and
useless for a mod that ships 237 of them. This is the map-side counterpart of
`extract_all.py`: the level list comes from the same `discover_levels` the
roster uses, so a new mod or a patched archive changes the set without anyone
editing a script, and a level that fails is counted rather than fatal.

Two things force the shape of this.

**`maps.json` is read-modify-written by each `extract_map.py` run**, so N
workers aimed at one `--out` would lose entries to the last writer. Each worker
therefore gets its own staging directory, and this script moves the finished
`<level>/` into place and merges the single-entry indexes itself. The merge also
preserves rows already in a pre-existing `maps.json`, which is what makes
`--skip-existing` a real resume rather than a truncation.

**A level extract is one process, not one thread.** It holds decoded terrain,
lightmaps and textures, so the useful knob is process count, and the default is
deliberately below `nproc`: eight concurrent levels is already several GB of
peak RSS.

Failures are per level and reported with the extractor's own last line of
stderr. `ValueError: nothing renderable in this level` is the common one and it
is a real answer about a level, not a bug here — a few archives in any mod are
menu backdrops or unfinished stubs with no static objects at all.
"""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
from concurrent.futures import ProcessPoolExecutor, as_completed
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import extract_map  # noqa: E402
from extract_models import (  # noqa: E402
    DEFAULT_GAME_DIR, discover_levels, mod_chain,
)

HERE = Path(__file__).resolve().parent


def merge_index(listing: dict[str, dict], rows: list[dict]) -> None:
    """Fold a run's `maps.json` rows into the accumulated index, in place.

    Keyed on the lowercase level name because that is what the on-disk
    directory and the viewer's fetch both use. Re-extracting a level replaces
    its own row and leaves every other mod-mate alone, which is what makes a
    resumed or partial run additive rather than truncating.

    Keys only present on the previous row — notably `loading` from
    `extract_loading_assets.py` — are kept, otherwise every re-extract drops
    every map back to the Western beach fallback in the viewer.
    """
    for row in rows:
        name = row.get("name")
        if not name:
            continue
        key = name.lower()
        prior = listing.get(key)
        merged = dict(row)
        if isinstance(prior, dict):
            for k, v in prior.items():
                if k not in merged:
                    merged[k] = v
        listing[key] = merged


def promote(staging: Path, out: Path) -> int:
    """Move a finished level out of its worker's staging dir into the tree.

    `maps.json` stays behind: the worker's copy holds one entry, and the
    merged index is this script's to write. Anything already at the target is
    replaced, so a re-extract cannot leave half of the previous run's
    lightmaps behind.
    """
    moved = 0
    for child in sorted(staging.iterdir()):
        if child.name == "maps.json":
            continue
        target = out / child.name
        if target.is_dir():
            shutil.rmtree(target, ignore_errors=True)
        elif target.exists():
            target.unlink()
        shutil.move(str(child), str(target))
        moved += 1
    return moved


def _extract_one(task: tuple) -> dict:
    """One `extract_map.py` run in its own staging dir. Never raises."""
    (level, game_dir, mod, staging_root, max_texture,
     terrain_only, texture_fallbacks, shared_sounds, audio_format,
     final_out) = task
    staging = Path(staging_root) / level.lower()
    command = [
        sys.executable, str(HERE / "extract_map.py"), level,
        "--game-dir", game_dir,
        "--mod", mod,
        "--out", str(staging),
        "--max-texture", str(max_texture),
        # Aimed at the real tree, not at staging: samples are shared across
        # levels, so they must outlive the per-level directory that `promote`
        # moves. Workers race on this directory and `write` handles it by
        # writing to a temp name and `os.replace`-ing.
        "--shared-sounds", shared_sounds,
        "--audio-format", audio_format,
        # Where this level ends up, so the relative sound paths in scene.json
        # are measured from the published location rather than from staging.
        "--final-out", final_out,
    ]
    if terrain_only:
        command.append("--terrain-only")
    for fallback in texture_fallbacks:
        command += ["--texture-fallback", fallback]

    proc = subprocess.run(command, capture_output=True, text=True)
    if proc.returncode != 0:
        shutil.rmtree(staging, ignore_errors=True)
        tail = [ln for ln in proc.stderr.strip().splitlines() if ln.strip()]
        return {"level": level, "ok": False,
                "error": tail[-1] if tail else f"exit {proc.returncode}"}

    index = staging / "maps.json"
    rows = []
    if index.is_file():
        try:
            rows = json.loads(index.read_text())
        except json.JSONDecodeError:
            rows = []
    return {"level": level, "ok": True, "rows": rows, "staging": str(staging)}


def main() -> int:
    ap = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--game-dir", type=Path, default=DEFAULT_GAME_DIR)
    ap.add_argument("--mod", default="bf1942")
    ap.add_argument("--out", type=Path, default=HERE / "viewer" / "maps")
    ap.add_argument("--levels", nargs="*", default=None,
                    help="restrict to these level names (default: every level "
                         "archive in the mod chain)")
    ap.add_argument("--exclude", nargs="*", default=[],
                    help="level names to leave out")
    ap.add_argument("--skip-existing", action="store_true",
                    help="leave levels that already have a scene.glb alone")
    ap.add_argument("--max-texture", type=int, default=512,
                    help="pass through to extract_map.py (default: 512)")
    ap.add_argument("--terrain-only", action="store_true",
                    help="pass through: heightmap and tiles, no objects")
    ap.add_argument("--texture-fallback", action="append", default=[],
                    help="pass through: mod to borrow textures from (repeatable)")
    ap.add_argument("--shared-sounds", type=Path, default=None,
                    help="pass through: directory samples are deduplicated "
                         "into (default: <out>/_shared/sounds)")
    ap.add_argument("--audio-format", choices=("mp3", "wav"), default="mp3",
                    help="pass through: sample format (default: mp3)")
    ap.add_argument("-j", "--jobs", type=int, default=8,
                    help="concurrent level extracts (default: 8; each is a "
                         "process holding a decoded level, so this is memory "
                         "bound rather than core bound)")
    ap.add_argument("--staging", type=Path, default=None,
                    help="where workers write before the move (default: "
                         "<out>/.staging)")
    args = ap.parse_args()

    game_dir = args.game_dir.expanduser()
    if not game_dir.is_dir():
        sys.exit(f"game dir not found: {game_dir}")

    chain = mod_chain(game_dir, args.mod)
    available = [name for name, _archive in discover_levels(chain)]
    if not available:
        sys.exit(f"no level archives found for mod {args.mod}")

    if args.levels is not None:
        keep = {name.lower() for name in args.levels}
        unknown = keep - {name.lower() for name in available}
        if unknown:
            sys.exit(f"unknown level(s): {', '.join(sorted(unknown))}")
        available = [name for name in available if name.lower() in keep]
    excluded = {name.lower() for name in args.exclude}
    selected = [name for name in available if name.lower() not in excluded]

    args.out.mkdir(parents=True, exist_ok=True)
    if args.skip_existing:
        already = [name for name in selected
                   if (args.out / name.lower() / "scene.glb").is_file()]
        if already:
            print(f"skipping {len(already)} level(s) already extracted",
                  file=sys.stderr)
        done = {name.lower() for name in already}
        selected = [name for name in selected if name.lower() not in done]

    if not selected:
        print("nothing to do", file=sys.stderr)
        return 0

    print(f"{args.mod}: {len(selected)} of {len(available)} levels, "
          f"{args.jobs} at a time -> {args.out}", file=sys.stderr)

    staging_root = args.staging or (args.out / ".staging")
    staging_root.mkdir(parents=True, exist_ok=True)

    # Rows already published survive the run; a re-extracted level replaces its
    # own row.
    listing: dict[str, dict] = {}
    index_path = args.out / "maps.json"
    if index_path.is_file():
        try:
            merge_index(listing, json.loads(index_path.read_text()))
        except json.JSONDecodeError:
            pass

    def publish() -> None:
        rows = sorted(listing.values(), key=lambda e: e["name"].lower())
        index_path.write_text(json.dumps(rows, indent=2))

    # Once, here, rather than 239 times in the workers: a missing encoder is a
    # setup problem and every level would hit it identically.
    if args.audio_format == "mp3" and not extract_map.ffmpeg_available():
        sys.exit("ffmpeg is not on PATH, so samples cannot be transcoded.\n"
                 "Install it, or pass --audio-format wav to keep raw PCM.")

    shared_sounds = args.shared_sounds or (args.out / "_shared" / "sounds")
    shared_sounds.mkdir(parents=True, exist_ok=True)
    tasks = [(level, str(game_dir), args.mod, str(staging_root),
              args.max_texture, args.terrain_only, args.texture_fallback,
              str(shared_sounds), args.audio_format, str(args.out))
             for level in selected]

    failures: list[tuple[str, str]] = []
    finished = 0
    with ProcessPoolExecutor(max_workers=max(1, args.jobs)) as pool:
        futures = {pool.submit(_extract_one, task): task[0] for task in tasks}
        for future in as_completed(futures):
            result = future.result()
            finished += 1
            level = result["level"]
            progress = f"[{finished}/{len(tasks)}]"
            if not result["ok"]:
                failures.append((level, result["error"]))
                print(f"{progress} {level}: FAILED — {result['error']}",
                      file=sys.stderr)
                continue

            # Move the finished level into the real tree, then merge its row.
            staging = Path(result["staging"])
            promote(staging, args.out)
            shutil.rmtree(staging, ignore_errors=True)
            merge_index(listing, result["rows"])
            # Written every time, so an interrupted run still leaves a usable
            # index for everything that finished before it.
            publish()
            size = sum(f.stat().st_size
                       for f in (args.out / level.lower()).rglob("*")
                       if f.is_file()) // (1024 * 1024)
            row = next(iter(result["rows"]), {})
            print(f"{progress} {level}: {row.get('objects', '?')} objects, "
                  f"{row.get('tiles', '?')} tiles, {size} MB", file=sys.stderr)

    shutil.rmtree(staging_root, ignore_errors=True)
    publish()

    print(f"\nextracted {len(tasks) - len(failures)} of {len(tasks)} levels; "
          f"{len(listing)} in {index_path}", file=sys.stderr)
    if failures:
        print(f"{len(failures)} level(s) produced nothing:", file=sys.stderr)
        for level, error in sorted(failures):
            print(f"  {level}: {error}", file=sys.stderr)
    return 1 if failures and len(failures) == len(tasks) else 0


if __name__ == "__main__":
    raise SystemExit(main())
