#!/usr/bin/env python3
"""Bring a finished weapon glb's magazine block to what `con.py` reads today.

    python3 patch_weapon_stats.py --mod bf1942 --mod fhsw
    python3 patch_weapon_stats.py --mod fh --dry-run
    python3 patch_weapon_stats.py --census            # who declares the words

A hand weapon's magazine (`size`, `magazines`, `type`, `reloadTime`,
`autoReload`, `reloadOnEmptyOnly`) is `ObjectTemplate.weapon_stats()["magazine"]`,
written into the document extras of the weapon's own glb (`extras.weapon`) and
of every first-person rig that holds it (`<Soldier>__<Weapon>.fp.glb`,
`extras.weaponStats`), and repeated in the `.report.json` beside each. A word
`con.py` learns to read later (`allowReloadOnEmptyClipOnly`, ledger FA-6) is in
none of the files extracted before it, and re-extracting every rig that holds
an M1 Garand to add one boolean is minutes of baking per tree. This rewrites
only the JSON chunk's magazine block to the one a fresh extract writes (the
template is looked up by name in the mod's own chain), leaves the BIN chunk
alone and refreshes the `.glb.gz`. A second run changes nothing.

`--census` reads no glb: it lists, per installed mod, the hand weapons whose
template declares a magazine word outside the plain five, which is the list of
weapons this patch can change.
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from bf42 import glbgz, glbopt  # noqa: E402
from extract_models import (  # noqa: E402
    DEFAULT_GAME_DIR, build_library, build_pools, mod_chain,
)
from patch_flag_cloth import MODS, VIEWER  # noqa: E402

# Document extras key -> where the template's name is, for the two glb shapes.
SHAPES = (("weapon", "root"), ("weaponStats", "weapon"))
# The magazine words every extract since the block existed has written.
PLAIN = frozenset({"size", "magazines", "type", "reloadTime", "autoReload"})


def library_for(mod: str, game_dir: Path):
    _, _, objects, _ = build_pools(mod_chain(game_dir, MODS[mod]), [])
    return build_library(objects)


def models_root(mod: str) -> Path:
    return VIEWER / "models" if mod == "bf1942" else VIEWER / "models" / "mods" / mod


def glbs_under(root: Path, mod: str):
    """The tree's own weapon and rig glbs: its top level and `viewmodels/`."""
    for folder in (root, root / "viewmodels"):
        if folder.is_dir():
            yield from sorted(folder.glob("*.glb"))


def fresh_magazine(library, name) -> dict | None:
    template = library.object(name) if isinstance(name, str) else None
    if template is None or template.kind.lower() not in ("handfirearms", "firearms"):
        return None
    return (template.weapon_stats() or {}).get("magazine")


def patch_extras(extras: dict, library) -> bool:
    """Replace the magazine block in one document's extras (or one report).
    True when it changed."""
    for key, name_key in SHAPES:
        block = extras.get(key)
        if not isinstance(block, dict) or not isinstance(block.get("magazine"), dict):
            continue
        fresh = fresh_magazine(library, extras.get(name_key))
        if fresh is None or fresh == block["magazine"]:
            return False
        block["magazine"] = fresh
        return True
    return False


def patch_bytes(data: bytes, library) -> bytes | None:
    """The glb with its magazine block refreshed, or None when it is current."""
    if b'"magazine"' not in data:
        return None
    doc, blob = glbopt.read_glb(data)
    extras = doc.get("extras")
    if not isinstance(extras, dict) or not patch_extras(extras, library):
        return None
    return glbopt.write_glb(doc, blob)


def patch_report(path: Path, library, dry_run: bool) -> bool:
    try:
        report = json.loads(path.read_text())
    except (OSError, ValueError):
        return False
    if not isinstance(report, dict) or not patch_extras(report, library):
        return False
    if not dry_run:
        # In place, as the glb is: the trees are hard-linked into worktrees.
        with open(path, "r+") as handle:
            handle.write(json.dumps(report, indent=2))
            handle.truncate()
    return True


def rewrite_in_place(path: Path, data: bytes) -> None:
    with open(path, "r+b") as handle:
        handle.write(data)
        handle.truncate()
    glbgz.ensure(path, data)


def census(library) -> dict[str, dict]:
    """Hand weapons whose magazine block carries a word outside the plain
    five: `{template: {word: value}}`."""
    rows: dict[str, dict] = {}
    for template in library.objects.values():
        if template.kind.lower() != "handfirearms":
            continue
        magazine = (template.weapon_stats() or {}).get("magazine") or {}
        extra = {k: v for k, v in magazine.items() if k not in PLAIN}
        if extra:
            rows[template.name] = extra
    return dict(sorted(rows.items()))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--mod", action="append", default=[],
                        help="viewer tree name (bf1942 = vanilla, xpack1, fhsw, ...)")
    parser.add_argument("--game-dir", type=Path, default=DEFAULT_GAME_DIR)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--census", action="store_true",
                        help="list the weapons that declare such a word; touch nothing")
    args = parser.parse_args()
    game_dir = args.game_dir.expanduser()
    if args.census and not args.mod:
        installed = {d.name.lower() for d in (game_dir / "Mods").iterdir() if d.is_dir()}
        args.mod = [m for m, folder in MODS.items() if folder.lower() in installed]
    if not args.mod:
        parser.error("name a tree with --mod")
    started = time.time()
    for mod in args.mod:
        if mod not in MODS:
            parser.error(f"unknown tree {mod!r}; have {', '.join(MODS)}")
        library = library_for(mod, game_dir)
        if args.census:
            rows = census(library)
            print(f"{mod}: {len(rows)} hand weapon(s)")
            for name, words in rows.items():
                print(f"  {name}: {words}")
            continue
        glbs = reports = 0
        root = models_root(mod)
        verb = "would patch" if args.dry_run else "patched"
        for path in glbs_under(root, mod):
            try:
                patched = patch_bytes(path.read_bytes(), library)
            except (OSError, ValueError, KeyError) as exc:
                print(f"  {path}: {exc}")
                continue
            if patched is not None:
                glbs += 1
                print(f"  {verb} {path.relative_to(VIEWER)}")
                if not args.dry_run:
                    rewrite_in_place(path, patched)
            report = path.with_name(path.name[:-len(".glb")] + ".report.json")
            if report.is_file() and patch_report(report, library, args.dry_run):
                reports += 1
        print(f"{mod}: {glbs} glb(s), {reports} report(s) "
              f"{'would change' if args.dry_run else 'changed'}")
    print(f"{time.time() - started:.1f} s")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
