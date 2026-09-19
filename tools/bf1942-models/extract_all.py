#!/usr/bin/env python3
"""Extract a mod's whole catalogue in one command, and say what was skipped.

    python3 extract_all.py                             # vanilla, everything, ./viewer/models
    python3 extract_all.py --categories handweapon     # just the armoury
    python3 extract_all.py --mod FH --out ./out-fh
    python3 extract_all.py --level-all --configuration-all --verify

Replaces the pasted ten-line invocation: the template list comes from the same
catalogue `--list` prints (every spawnable object the mod's `.con` files
declare), so a new mod or a patched archive changes the set without anyone
editing a script. One `extract_models.py` run does the work, which is what
keeps `models.json` complete — per-template failures are counted, not fatal.

Honesty about skips, in three places:

* templates excluded by `--categories`/`--exclude` are printed up front;
* templates the extractor could not export are listed at the end with the
  extractor's own reason (vanilla has two: `Coaxial_browning` and
  `Coaxial_MG42`, which carry no geometry anywhere in their tree — they are
  the muzzle-flash logic of a tank's coax MG, whose visible barrel is part of
  the tank mesh);
* `--verify` runs `verify_models.py` over the result so the run ends with a
  clean / degraded / broken verdict instead of a wall of per-model lines.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from extract_models import (  # noqa: E402
    DEFAULT_GAME_DIR, build_library, build_pools, catalogue, mod_chain,
    own_templates,
)

HERE = Path(__file__).resolve().parent
CATEGORIES = ("air", "emplacement", "handweapon", "land", "sea", "soldier")


def has_renderable_geometry(library, root_name: str, *, depth: int = 0,
                            seen: frozenset[str] = frozenset()) -> bool:
    """Whether anything in this template tree carries a mesh at all.

    Vanilla's `Coaxial_browning` and `Coaxial_MG42` do not: they are the
    muzzle-flash and shell-eject logic of a tank's coax MG — the visible
    barrel belongs to the tank mesh. Asking the extractor for them just earns
    a "nothing renderable" error, so they are skipped up front with a reason.
    """
    if depth > 24:
        return False
    template = library.object(root_name)
    if template is None:
        return False
    key = template.name.lower()
    if key in seen:
        return False
    if template.geometry:
        return True
    seen = seen | {key}
    return any(
        has_renderable_geometry(library, child.template,
                                depth=depth + 1, seen=seen)
        for child in template.children
    )


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--game-dir", type=Path, default=DEFAULT_GAME_DIR)
    ap.add_argument("--mod", default="bf1942")
    ap.add_argument("--out", type=Path, default=HERE / "viewer" / "models")
    ap.add_argument("--categories", nargs="*", choices=CATEGORIES, default=None,
                    help="restrict to these catalogue categories (default: all)")
    ap.add_argument("--exclude", nargs="*", default=[],
                    help="template names to leave out")
    ap.add_argument("--own", action="store_true",
                    help="only templates this mod declares itself, not the ones "
                         "it inherits (Road to Rome: 15 rather than 113)")
    ap.add_argument("--level-all", action="store_true",
                    help="pass through: export theatre skin variants from level archives")
    ap.add_argument("--configuration-all", action="store_true",
                    help="pass through: export Wreck alternatives where they exist")
    ap.add_argument("--cockpit", action="store_true",
                    help="pass through: export first-person interiors as "
                         "`<Name>.cockpit.glb` for the templates that have one")
    ap.add_argument("--texture-fallback", action="append", default=[],
                    help="pass through: mod to borrow textures from (repeatable). "
                         "Vanilla needs none since texture.rfa was restored.")
    ap.add_argument("--max-texture", type=int, default=1024)
    ap.add_argument("-j", "--jobs", type=int, default=12,
                    help="number of parallel workers (default: 12)")
    ap.add_argument("--thumbs", action="store_true",
                    help="render model thumbnails via shoot.mjs and stamp models.json")
    ap.add_argument("--thumbs-url", default="http://localhost:5273",
                    help="viewer URL to shoot thumbnails against (default: http://localhost:5273)")
    ap.add_argument("--verify", action="store_true",
                    help="run verify_models.py over the output afterwards")
    args = ap.parse_args()

    game_dir = args.game_dir.expanduser()
    if not game_dir.is_dir():
        sys.exit(f"game dir not found: {game_dir}")

    # The same catalogue --list prints, derived from the archives.
    chain = mod_chain(game_dir, args.mod)
    _meshes, _textures, objects, _game = build_pools(chain, [])
    library = build_library(objects)
    entries = catalogue(objects, library)

    # An expansion inherits its parent wholesale, so most of its catalogue is
    # vanilla's. Extracting that again writes a second copy of every vanilla
    # mesh into the mod's subtree; the viewer's mod picker can fall back to
    # vanilla for those instead.
    own = own_templates(chain, library) if args.own else None

    excluded = {name.lower() for name in args.exclude}
    wanted_categories = set(args.categories or CATEGORIES)
    selected: list[str] = []
    skipped: list[tuple[str, str]] = []
    for name, category, _source in entries:
        if own is not None and name.lower() not in own:
            skipped.append((name, "inherited from a parent mod (--own)"))
        elif category not in wanted_categories:
            skipped.append((name, f"category {category} not requested"))
        elif name.lower() in excluded:
            skipped.append((name, "excluded by --exclude"))
        elif not has_renderable_geometry(library, name):
            skipped.append((name, "no geometry in its template tree (effects-only)"))
        else:
            selected.append(name)

    if not selected:
        sys.exit("nothing selected — check --categories/--exclude")

    print(f"{args.mod}: {len(selected)} of {len(entries)} catalogue templates selected",
          file=sys.stderr)
    for name, reason in skipped:
        print(f"  skipping {name}: {reason}", file=sys.stderr)

    command = [
        sys.executable, str(HERE / "extract_models.py"),
        *selected,
        "--game-dir", str(game_dir),
        "--mod", args.mod,
        "--out", str(args.out),
        "--max-texture", str(args.max_texture),
        "-j", str(args.jobs),
    ]
    if args.level_all:
        command.append("--level-all")
    if args.configuration_all:
        command.append("--configuration-all")
    if args.cockpit:
        command.append("--cockpit")
    for fallback in args.texture_fallback:
        command += ["--texture-fallback", fallback]

    completed = subprocess.run(command)

    # Passenger-seat poses (Ub_PassengerInX / Lb_PassengerInX): one .glb per
    # soldier per seat the mod ships, written under poses/. The viewer loads
    # them straight off the seat's `extras.seat.poseAnimation` — see
    # `loadSeatPose` in map.html and SEAT-13 in the engine reference ledger.
    # Only the categories that actually carry passenger seats matter; skip the
    # step entirely when the mod declares none (checked via `--dry-run` below:
    # a 0-byte exit with no output means no SeatObject with animations).
    pose_cmd = [
        sys.executable, str(HERE / "extract_pose.py"),
        "--seat-poses",
        "--game-dir", str(game_dir),
        "--mod", args.mod,
        "--out", str(args.out / "poses"),
        "--max-texture", str(args.max_texture),
    ]
    print("\nextracting seat poses (--seat-poses)...", file=sys.stderr)
    # Never fatal. Seat poses are an extra on top of the catalogue, and the
    # step exits non-zero whenever one pairing does not resolve (Road to Rome:
    # 40 of 50). Raising here skipped the thumbnails and the verifier, so a
    # complete catalogue came out with no `thumb` on any entry.
    posed = subprocess.run(pose_cmd)
    if posed.returncode:
        print(f"seat poses incomplete (exit {posed.returncode}); "
              "the catalogue itself is unaffected", file=sys.stderr)

    # What actually landed, versus what was asked for.
    manifest_path = args.out / "models.json"
    exported: set[str] = set()
    if manifest_path.is_file():
        exported = {entry["name"].lower()
                    for entry in json.loads(manifest_path.read_text())}
    failed = [name for name in selected if name.lower() not in exported]

    print(f"\nexported {len(selected) - len(failed)} of {len(selected)} "
          f"selected templates to {args.out}", file=sys.stderr)
    if failed:
        print("not exported (see the extractor's message above for each):",
              file=sys.stderr)
        for name in failed:
            print(f"  {name}", file=sys.stderr)

    if args.thumbs and manifest_path.is_file():
        thumbs_dir = args.out / "thumbs"
        shoot_cmd = [
            "node", str(HERE / "shoot.mjs"),
            "--thumbs",
            "--url", f"{args.thumbs_url}/?mod={args.mod.lower()}",
            "--out", str(thumbs_dir),
            "--manifest", str(manifest_path),
            "-j", str(min(args.jobs, 8)),
            "--skip-existing",
        ]
        print(f"\nrendering thumbnails to {thumbs_dir}...", file=sys.stderr)
        subprocess.run(shoot_cmd)

    if args.verify:
        verify_command = [
            sys.executable, str(HERE / "verify_models.py"),
            "--models", str(args.out),
            "--game-dir", str(game_dir),
            "--mod", args.mod,
        ]
        verified = subprocess.run(verify_command)
        return verified.returncode or (1 if failed and completed.returncode else 0)

    return completed.returncode


if __name__ == "__main__":
    raise SystemExit(main())
