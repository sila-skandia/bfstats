#!/usr/bin/env python3
"""Give a round the physics bits its `.con` clears, in finished glbs.

    python3 patch_round_physics.py --mod fhsweurope --dry-run
    python3 patch_round_physics.py --mod fh --mod fhsw --levels-only
    python3 patch_round_physics.py --census --mod fh   # which rounds clear a bit

A Projectile's constructor sets every physics bit (`ProjectileTemplate()` ORs
0x0f into +0x70, lnxded 0x0831faa9); a declared `setHasMobilePhysics 0` /
`setHasCollisionPhysics 0` clears one. Since 2026-10-27 (FHX-30, 1dc9ca07)
`assemble.py` writes `projectile.hasMobilePhysics` / `hasCollisionPhysics`
false into a gun node's `extras.fireArms.projectile` when the `.con` clears
them, and `viewer/projectile-flight.js` neither moves nor sweeps such a round:
FH's mobile guns' killer charges (`*_TransformKilleProjectile`,
`*_SupplyObjKillerProjectile`) stay where they are dropped and burst on their
clock. A glb baked before that carries neither key, and the charge flew at its
velocity 1, struck the static an earlier deploy stood, and never burst.

The spec is JSON in the glb's first chunk; nothing it draws or places moves.
So this rewrites that chunk only, for the round specs whose template clears a
bit (looked up by name in the mod's library, the levels' own scripts
included), leaves the BIN chunk alone, and writes the glb, its `.glb.gz` and
(when one exists or the glb is big enough) its `.glb.br` each through a temp
file and a rename, so a reader holding the old file never sees a half-written
one. A spec that already says what the template says is left alone, and a key
the template no longer earns is removed, so a second run changes nothing.

Only rounds the page can move are patched unless `--all`; for the others the
keys change nothing. Left out: a `magType 2` weapon's round (the spotters and
binoculars, ~5,000 nodes across FH, FHSW and FHSWEurope), which never fires
(`gun-cycle.js` hands the pull to the marker, ledger SPOT-1), and a round
that lives under `MIN_LIFE` (the Komet's fumes at `timeToLive 0`; the yell,
jumper and bravery rounds at 0.01 s). Kept: everything else, the killer
charges included even at `velocity 0`, since a round leaves the muzzle with
its hull's velocity on top (`round-launch.js` `muzzleVelocity`), and the
landmine spawner rounds, the BAKA placeholder and the searchlight. `--skip`
names more templates to leave alone.

Scope: the tree's model glbs (unless `--levels-only`), and the level glbs of
the EXPORTED levels only (`patch_held_axes.candidate_glbs`: `maps.json` rows;
FHSW and FHSWEurope the rows with a `loading` block). `--exclude-level` keeps
a level out (one an audit is reading right now, say). A remote-only level has
no scene.glb here and is named on stderr.
"""
from __future__ import annotations

import argparse
import os
import re
import sys
import tempfile
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from bf42 import glbbr, glbgz, glbopt  # noqa: E402
from extract_models import DEFAULT_GAME_DIR  # noqa: E402
from patch_engine_limits import library_for  # noqa: E402
from patch_flag_cloth import MODS, tree_roots  # noqa: E402
from patch_held_axes import candidate_glbs, json_chunk  # noqa: E402

KEYS = ("hasMobilePhysics", "hasCollisionPhysics")
# A round that lives less than this is gone before a frame moves it.
MIN_LIFE = 0.05


def flies(fire: dict, spec: dict) -> bool:
    """Whether the page can ever move or sweep this round: its weapon fires
    one (not a `magType 2` marker), and it lives past a frame. Speed is not
    asked: a `velocity 0` round still leaves with its hull's velocity."""
    if fire.get("magType") == 2:
        return False
    life = spec.get("timeToLive")
    return life is None or life >= MIN_LIFE


def cleared_bits(template) -> dict:
    """What a fresh extract writes for this round: the bits its `.con` clears,
    each as False (`assemble.py` `_projectile_spec`)."""
    out: dict = {}
    if template is None:
        return out
    if template.mobile_physics_declared and not template.has_mobile_physics:
        out["hasMobilePhysics"] = False
    if (getattr(template, "collision_physics_declared", False)
            and not template.has_collision_physics):
        out["hasCollisionPhysics"] = False
    return out


def patch_doc(doc: dict, library, cache: dict, skip: re.Pattern | None = None,
              every: bool = False) -> int:
    """Bring every round spec's physics keys to its template's; how many nodes
    changed. Mutates `doc`."""
    changed = 0
    for node in doc.get("nodes", []):
        fire = (node.get("extras") or {}).get("fireArms")
        spec = fire.get("projectile") if isinstance(fire, dict) else None
        if not isinstance(spec, dict) or not spec.get("template"):
            continue
        name = spec["template"]
        if skip is not None and skip.search(name):
            continue
        if not every and not flies(fire, spec):
            continue
        key = name.lower()
        if key not in cache:
            cache[key] = cleared_bits(library.object(name))
        want = cache[key]
        touched = False
        for field in KEYS:
            if field in want:
                if spec.get(field) is not False:
                    spec[field] = False
                    touched = True
            elif field in spec:
                del spec[field]
                touched = True
        changed += touched
    return changed


def _atomic_write(path: Path, data: bytes) -> None:
    fd, tmp = tempfile.mkstemp(prefix=f".{path.name}.", suffix=".tmp", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as handle:
            handle.write(data)
        os.chmod(tmp, 0o644)
        os.replace(tmp, path)
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def write_atomic(path: Path, data: bytes, brotli: bool = True) -> None:
    """The glb, then its `.gz`, then its `.br` (made when one is there already
    or the glb is big enough), each by rename; in that order, so each copy is
    at least as new as the glb (the API sends a `.gz` only then)."""
    _atomic_write(path, data)
    _atomic_write(glbgz.gz_path(path), glbgz.compress(data))
    br = glbbr.br_path(path)
    if br.exists() or (brotli and glbbr.wants(len(data))):
        _atomic_write(br, glbbr.compress(data))


def census(mod: str, library) -> None:
    rows = sorted((t.name, cleared_bits(t)) for t in library.objects.values()
                  if cleared_bits(t))
    print(f"{mod}: {len(rows)} template(s) clear a physics bit")
    for name, bits in rows:
        print(f"    {name}: {', '.join(bits)}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--mod", action="append", default=[],
                        help="viewer tree name (bf1942 = vanilla, xpack1, fh, fhsw, fhsweurope, ...)")
    parser.add_argument("--game-dir", type=Path, default=DEFAULT_GAME_DIR)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--census", action="store_true",
                        help="list the templates that clear a bit, and stop")
    parser.add_argument("--levels-only", action="store_true",
                        help="leave the models tree alone (re-extract it instead)")
    parser.add_argument("--exclude-level", action="append", default=[],
                        help="a level directory name to leave alone this run")
    parser.add_argument("--level", action="append", default=[],
                        help="only these level directories (and no model glbs)")
    parser.add_argument("--skip", default="",
                        help="regex of round templates left alone")
    parser.add_argument("--all", action="store_true",
                        help="patch rounds the page never moves too")
    parser.add_argument("--list", type=Path,
                        help="append each changed glb's path here, one a line")
    args = parser.parse_args()
    if not args.mod:
        parser.error("name a tree with --mod")
    skip = re.compile(args.skip, re.I) if args.skip else None
    excluded = {name.lower() for name in args.exclude_level}
    only = {name.lower() for name in args.level}
    started = time.time()
    for mod in args.mod:
        if mod not in MODS:
            parser.error(f"unknown tree {mod!r}; have {', '.join(MODS)}")
        library = library_for(mod, args.game_dir.expanduser())
        if args.census:
            census(mod, library)
            continue
        models_root, maps_root = tree_roots(mod)
        cache: dict = {}
        files = nodes = 0
        for path in candidate_glbs(mod):
            in_models = models_root in path.parents
            if in_models and (args.levels_only or only):
                continue
            if only and path.parent.name.lower() not in only:
                continue
            if not in_models and path.parent.name.lower() in excluded:
                print(f"  excluded {path.relative_to(HERE / 'viewer')}", file=sys.stderr)
                continue
            doc = json_chunk(path)
            if doc is None or not patch_doc(doc, library, cache, skip, args.all):
                continue
            data = path.read_bytes()
            full, blob = glbopt.read_glb(data)
            n = patch_doc(full, library, cache, skip, args.all)
            if not n:
                continue
            files += 1
            nodes += n
            print(f"  {'would patch' if args.dry_run else 'patched'} "
                  f"{path.relative_to(HERE / 'viewer')}: {n} node(s)")
            if not args.dry_run:
                write_atomic(path, glbopt.write_glb(full, blob))
            if args.list:
                with open(args.list, "a") as out:
                    out.write(f"{path}\n")
        print(f"{mod}: {files} glb(s), {nodes} node(s) "
              f"{'would change' if args.dry_run else 'changed'}")
    print(f"{time.time() - started:.1f} s")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
