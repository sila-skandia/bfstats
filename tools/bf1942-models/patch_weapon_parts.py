#!/usr/bin/env python3
"""Move the hand-weapon parts already baked into finished glbs, in place.

    python3 patch_weapon_parts.py --mod fhsweurope
    python3 patch_weapon_parts.py --all --dry-run
    python3 patch_weapon_parts.py --file some.glb --mod xpack2

Before 2026-11-28 the exporter placed a hand weapon's bound parts
(`bindToSkeletonPart`) at the parsed rest of their bone, which mirrors a part
that sits off the weapon's centre plane: Secret Weapons' knives hang their
whole blade off `Mag`, and lay up the soldier's sleeve; the Johnson's side
magazine stood on the right of the gun. `bf42/pose.py` `hand_weapon_part` is
where the engine draws such a part, and `bf42/assemble.py` now exports that
(`features/hand-weapon-part-placement`). This script brings the glbs already
on disk to the same place without a re-bake, which for the levels and the
FHSWEurope poses is hours: it rewrites only the TRS of each bound part's node.

The correction is exact whatever the part's own placement: the node holds
`P . B` (its `.con` placement times the bone's rest from the weapon's main
bone, Z-mirrored into glTF), and the patched node holds `P . rule(B)`, so it
is right-multiplied by `B^-1 . rule(B)`. `B` is read from the weapon's own
`.ske` through the mod's templates, the main bone found as the exporter finds
it (`Assembler._skeleton_scope`).

A node the exporter placed by the rule, or this script already moved, carries
`extras.handWeaponPart` and is left alone, so a second run changes nothing.
First-person rigs (`viewmodels/`) are skipped: `extract_viewmodel.py` sets
their parts itself. Files are rewritten in place, through their own inode,
and their `.glb.gz` (and `.glb.br`, where there is one) is refreshed. A level that is remote-only
(`evict_levels.py`) is named on stderr and not reached.
"""
from __future__ import annotations

import argparse
import math
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from bf42 import glbbr, glbopt, pose, ske  # noqa: E402
from bf42.assemble import is_hand_weapon_skeleton  # noqa: E402
from patch_flag_cloth import MODS, glbs_under, json_chunk_mentions, tree_roots  # noqa: E402
from patch_flag_cloth import rewrite_in_place as _rewrite_gz  # noqa: E402
from extract_models import DEFAULT_GAME_DIR  # noqa: E402

_S = (1.0, 1.0, -1.0)


def _conv(rt: pose.RT) -> pose.RT:
    """A Refractor transform as glTF holds it: conjugated by the Z mirror."""
    rotation, translation = rt
    return (tuple(tuple(_S[i] * rotation[i][j] * _S[j] for j in range(3)) for i in range(3)),
            (translation[0], translation[1], -translation[2]))


def _quat_to_matrix(q) -> pose.Matrix3:
    x, y, z, w = q
    return ((1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)),
            (2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)),
            (2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)))


def _matrix_to_quat(m: pose.Matrix3) -> tuple[float, float, float, float]:
    """A rotation matrix as a quaternion (x, y, z, w), w >= 0."""
    (m00, m01, m02), (m10, m11, m12), (m20, m21, m22) = m
    trace = m00 + m11 + m22
    if trace > 0:
        s = 0.5 / math.sqrt(trace + 1.0)
        q = ((m21 - m12) * s, (m02 - m20) * s, (m10 - m01) * s, 0.25 / s)
    elif m00 > m11 and m00 > m22:
        s = 2.0 * math.sqrt(1.0 + m00 - m11 - m22)
        q = (0.25 * s, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s)
    elif m11 > m22:
        s = 2.0 * math.sqrt(1.0 + m11 - m00 - m22)
        q = ((m01 + m10) / s, 0.25 * s, (m12 + m21) / s, (m02 - m20) / s)
    else:
        s = 2.0 * math.sqrt(1.0 + m22 - m00 - m11)
        q = ((m02 + m20) / s, (m12 + m21) / s, 0.25 * s, (m10 - m01) / s)
    if q[3] < 0:
        q = tuple(-v for v in q)
    n = math.sqrt(sum(v * v for v in q))
    return tuple(v / n for v in q)


class ModSkeletons:
    """The mod's templates and the skeletons its weapons name, read lazily."""

    def __init__(self, mod: str, game_dir: Path):
        import extract_pose as ep
        from bf42.template_table import mod_chain
        self._ep = ep
        chain = mod_chain(game_dir, MODS[mod])
        self.meshes, _textures, objects, _game = ep.build_pools(chain, [])
        self.library = ep.build_library(objects)
        self._skeletons: dict[str, ske.Skeleton | None] = {}

    def skeleton(self, path: str) -> ske.Skeleton | None:
        key = path.lower()
        if key not in self._skeletons:
            self._skeletons[key] = self._ep.read_skeleton(self.meshes, path)
        return self._skeletons[key]


def correction(doc: dict, index: int, parents: dict[int, int], mod: ModSkeletons) -> pose.RT | None:
    """`B^-1 . rule(B)` in glTF for node `index`, or None when it is not a
    hand weapon's part this script can place."""
    nodes = doc["nodes"]
    bone_name = (nodes[index].get("extras") or {}).get("boundBone")
    # The nearest `createSkeleton` at or above the part.
    skel_index = index
    while skel_index is not None and not (nodes[skel_index].get("extras") or {}).get("skeleton"):
        skel_index = parents.get(skel_index)
    if skel_index is None:
        return None
    skeleton = mod.skeleton(nodes[skel_index]["extras"]["skeleton"])
    if skeleton is None or not is_hand_weapon_skeleton(skeleton):
        return None
    # The main bone's name: the nearest `useSkeletonPartAsMain` at or above it.
    main_name = None
    walk = skel_index
    while walk is not None and main_name is None:
        template = mod.library.object(nodes[walk].get("name", ""))
        if template is not None and template.skeleton_main:
            main_name = template.skeleton_main
        walk = parents.get(walk)
    skel_template = mod.library.object(nodes[skel_index].get("name", ""))
    main_index = skeleton.main_index(main_name, skel_template.geometry if skel_template else None)
    bone_index = skeleton.index(bone_name)
    if main_index is None or bone_index is None:
        return None
    bind = skeleton.relative(bone_index, main_index)
    placed = pose.hand_weapon_part(bind)
    return _conv(pose.rt_mul(pose.rt_inverse(bind), placed))


def patch_doc(doc: dict, mod: ModSkeletons) -> tuple[int, int]:
    """Move every unmarked hand-weapon part in `doc`; (moved, left)."""
    nodes = doc.get("nodes", [])
    parents = {child: i for i, node in enumerate(nodes) for child in node.get("children", [])}
    moved = left = 0
    for i, node in enumerate(nodes):
        extras = node.get("extras") or {}
        if not extras.get("boundBone") or extras.get("handWeaponPart"):
            continue
        fix = correction(doc, i, parents, mod)
        if fix is None:
            left += 1
            continue
        scale = node.get("scale", [1.0, 1.0, 1.0])
        if max(scale) - min(scale) > 1e-6:
            left += 1
            continue
        rotation = _quat_to_matrix(node.get("rotation", [0.0, 0.0, 0.0, 1.0]))
        translation = node.get("translation", [0.0, 0.0, 0.0])
        fix_r, fix_t = fix
        k = scale[0]
        new_t = [translation[r] + k * sum(rotation[r][c] * fix_t[c] for c in range(3)) for r in range(3)]
        new_r = tuple(tuple(sum(rotation[r][m] * fix_r[m][c] for m in range(3)) for c in range(3))
                      for r in range(3))
        node["translation"] = [round(v, 7) for v in new_t]
        node["rotation"] = [round(v, 7) for v in _matrix_to_quat(new_r)]
        extras["handWeaponPart"] = True
        node["extras"] = extras
        moved += 1
    return moved, left


def rewrite_in_place(path: Path, data: bytes) -> None:
    """The glb through its own inode, its `.glb.gz` refreshed, and its `.glb.br`
    too when it had one: the edge prefers the brotli copy, so a stale one would
    keep the old parts live."""
    _rewrite_gz(path, data)
    if glbbr.br_path(path).exists():
        glbbr.ensure(path, data)


def patch_bytes(data: bytes, mod: ModSkeletons) -> tuple[bytes | None, int, int]:
    doc, blob = glbopt.read_glb(data)
    moved, left = patch_doc(doc, mod)
    if not moved:
        return None, 0, left
    return glbopt.write_glb(doc, blob), moved, left


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--mod", action="append", default=[],
                        help="viewer tree name (bf1942 = vanilla, xpack1, fhsweurope, ...)")
    parser.add_argument("--all", action="store_true", help="every tree")
    parser.add_argument("--file", type=Path, action="append", default=[],
                        help="patch these glbs only (with one --mod for their templates)")
    parser.add_argument("--game-dir", type=Path, default=DEFAULT_GAME_DIR)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    mods = list(MODS) if args.all else args.mod
    if not mods:
        parser.error("name a tree with --mod, or --all")
    if args.file and len(mods) != 1:
        parser.error("--file takes exactly one --mod")
    started = time.time()
    total_files = total_parts = 0
    for name in mods:
        if name not in MODS:
            parser.error(f"unknown tree {name!r}; have {', '.join(MODS)}")
        if not (args.game_dir / "Mods" / MODS[name]).is_dir():
            print(f"{name}: not installed, skipped")
            continue
        mod = ModSkeletons(name, args.game_dir)
        files = parts = left = 0
        paths = args.file or [p for root in tree_roots(name) for p in glbs_under(root, name)]
        for path in paths:
            if "viewmodels" in path.parts or path.name.endswith(".fp.glb"):
                continue
            if not json_chunk_mentions(path, b"boundBone"):
                continue
            try:
                data = path.read_bytes()
                patched, n, unplaced = patch_bytes(data, mod)
            except (OSError, ValueError, KeyError) as exc:
                print(f"  {path}: {exc}")
                continue
            left += unplaced
            if patched is None:
                continue
            files += 1
            parts += n
            if not args.dry_run:
                rewrite_in_place(path, patched)
        verb = "would move" if args.dry_run else "moved"
        print(f"{name}: {verb} {parts} part(s) in {files} file(s); {left} bound node(s) not a hand weapon's",
              flush=True)
        total_files += files
        total_parts += parts
    print(f"{total_parts} part(s) in {total_files} file(s), {time.time() - started:.0f}s")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
