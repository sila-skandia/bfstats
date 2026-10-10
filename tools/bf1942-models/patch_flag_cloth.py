#!/usr/bin/env python3
"""Pose the flag cloths already baked into finished glbs, in place.

    python3 patch_flag_cloth.py --mod bf1942 --mod xpack1 --mod xpack2
    python3 patch_flag_cloth.py --mod eod --dry-run
    python3 patch_flag_cloth.py --all

Before 2026-10-10 every flag that rides a vehicle or a static
(`AnimatedUsFlag` on a landing craft's mast, a destroyer's ensign, a carrier's
island) was exported as its raw `.sm`: a sheet centred on its own origin with
the image upside down, 1,374 nodes in 434 files. `bf42/flagcloth.py` says what
the engine draws instead, and `bf42/assemble.py` now exports that. This script
brings the glbs already on disk to the same bytes without a re-bake, which for
the levels is hours: it rewrites only the POSITION and NORMAL data of each
flag cloth mesh (same vertex count, same layout) and the two accessors' bounds.

A mesh is touched only if every vertex still sits on a `.skn` rest position,
which is how a cloth in its authored pose is told from one already posed, so
a second run changes nothing. Files are rewritten in place, through their own
inode, so the hard-link mirrors see them, and their `.glb.gz` is refreshed.

The mod's own `flag.skn`, `flag.ske` and `FlagBlow.baf` are read from its
archive chain: GCMOD ships a different set from vanilla.
"""
from __future__ import annotations

import argparse
import struct
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from bf42 import baf, flagcloth, glbgz, glbopt, skin  # noqa: E402
from bf42.rfa import ArchivePool, find_archives_dir  # noqa: E402
from extract_models import DEFAULT_GAME_DIR, MESH_ARCHIVES, mod_chain  # noqa: E402

VIEWER = HERE / "viewer"
# viewer tree name -> game mod directory
MODS = {
    "bf1942": "bf1942", "xpack1": "XPack1", "xpack2": "XPack2", "eod": "EoD",
    "desertcombat": "DesertCombat", "dc_final": "DC_Final", "fh": "FH",
    "fhsw": "FHSW", "gcmod": "GCMOD", "pirates": "Pirates",
    "interstate": "interstate", "bf1918": "bf1918", "bg42": "bg42",
    "finnwars": "FinnWars",
}
TOLERANCE = 0.002  # metres; the .sm and .skn agree to the float


def tree_roots(mod: str) -> list[Path]:
    if mod == "bf1942":
        # The vanilla trees: `models/` and `maps/` themselves, not `mods/`.
        return [VIEWER / "models", VIEWER / "maps"]
    return [VIEWER / "models" / "mods" / mod, VIEWER / "maps" / "mods" / mod]


def glbs_under(root: Path, mod: str):
    if not root.is_dir():
        return
    for path in sorted(root.rglob("*.glb")):
        if mod == "bf1942" and "mods" in path.relative_to(root).parts:
            continue
        yield path


def rig_for(mod: str, game_dir: Path):
    """(skn, worlds) from the mod's chain, or None when it has no flag rig."""
    pool = ArchivePool()
    for directory in mod_chain(game_dir, MODS[mod]):
        archives = find_archives_dir(directory)
        if archives is not None:
            pool.add_dir(archives, MESH_ARCHIVES)
    skn_raw = pool.try_read(flagcloth.FLAG_SKIN)
    ske_raw = pool.try_read(flagcloth.FLAG_SKELETON)
    clip_raw = pool.try_read(flagcloth.FLAG_CLIP)
    if not (skn_raw and ske_raw and clip_raw):
        return None
    from bf42 import ske as ske_mod
    skn = skin.parse(skn_raw, flagcloth.FLAG_SKIN)
    skeleton = ske_mod.parse(ske_raw, flagcloth.FLAG_SKELETON)
    return skn, flagcloth.rest_worlds(skeleton, baf.parse(clip_raw))


def _accessor_view(doc: dict, index: int):
    acc = doc["accessors"][index]
    view = doc["bufferViews"][acc["bufferView"]]
    width = {"VEC3": 3}[acc["type"]]
    stride = view.get("byteStride") or width * 4
    base = view.get("byteOffset", 0) + acc.get("byteOffset", 0)
    return acc, base, stride


def _read_vec3(doc: dict, blob: bytes, index: int):
    acc, base, stride = _accessor_view(doc, index)
    return [struct.unpack_from("<3f", blob, base + i * stride)
            for i in range(acc["count"])]


def _write_vec3(doc: dict, blob: bytearray, index: int, values, bounds: bool):
    acc, base, stride = _accessor_view(doc, index)
    for i, v in enumerate(values):
        struct.pack_into("<3f", blob, base + i * stride, *v)
    if bounds:
        acc["min"] = [min(v[a] for v in values) for a in range(3)]
        acc["max"] = [max(v[a] for v in values) for a in range(3)]


def patch_bytes(data: bytes, skn, worlds) -> tuple[bytes | None, int]:
    """The glb with its authored-pose flag cloths posed, and how many primitives
    changed; `(None, 0)` when there is nothing to do."""
    doc, blob = glbopt.read_glb(data)
    wanted = {
        node["mesh"] for node in doc.get("nodes", [])
        if "mesh" in node
        and flagcloth.is_flag_skin((node.get("extras") or {}).get("skin"))
    }
    if not wanted:
        return None, 0
    buf = bytearray(blob)
    changed = 0
    done: set[int] = set()
    for mesh_index in sorted(wanted):
        for prim in doc["meshes"][mesh_index]["primitives"]:
            attrs = prim["attributes"]
            if attrs["POSITION"] in done:
                continue
            done.add(attrs["POSITION"])
            # glTF is Z-mirrored against the raw frame the rig is in.
            positions = [(x, y, -z) for x, y, z in _read_vec3(doc, buf, attrs["POSITION"])]
            normal_index = attrs.get("NORMAL")
            normals = ([(x, y, -z) for x, y, z in _read_vec3(doc, buf, normal_index)]
                       if normal_index is not None else None)
            posed = flagcloth.pose_points(positions, normals, skn, worlds,
                                          exact=TOLERANCE)
            if posed is None:
                continue
            new_p, new_n = posed
            _write_vec3(doc, buf, attrs["POSITION"],
                        [(x, y, -z) for x, y, z in new_p], bounds=True)
            if new_n is not None:
                _write_vec3(doc, buf, normal_index,
                            [(x, y, -z) for x, y, z in new_n], bounds=False)
            changed += 1
    if not changed:
        return None, 0
    return glbopt.write_glb(doc, bytes(buf)), changed


def rewrite_in_place(path: Path, data: bytes) -> None:
    with open(path, "r+b") as handle:
        handle.write(data)
        handle.truncate()
    glbgz.ensure(path, data)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--mod", action="append", default=[],
                        help="viewer tree name (bf1942 = vanilla, xpack1, eod, ...)")
    parser.add_argument("--all", action="store_true", help="every tree")
    parser.add_argument("--game-dir", type=Path, default=DEFAULT_GAME_DIR)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    mods = list(MODS) if args.all else args.mod
    if not mods:
        parser.error("name a tree with --mod, or --all")
    started = time.time()
    total_files = total_prims = 0
    for mod in mods:
        if mod not in MODS:
            parser.error(f"unknown tree {mod!r}; have {', '.join(MODS)}")
        rig = rig_for(mod, args.game_dir)
        if rig is None:
            print(f"{mod}: no flag rig in its archives, skipped")
            continue
        skn, worlds = rig
        files = prims = 0
        for root in tree_roots(mod):
            for path in glbs_under(root, mod):
                try:
                    data = path.read_bytes()
                except OSError:
                    continue
                # Cheap gate before parsing: the extras spell the skin path.
                if b"flag.skn" not in data:
                    continue
                try:
                    patched, n = patch_bytes(data, skn, worlds)
                except (ValueError, KeyError, struct.error) as exc:
                    print(f"  {path}: {exc}")
                    continue
                if patched is None:
                    continue
                files += 1
                prims += n
                if not args.dry_run:
                    rewrite_in_place(path, patched)
        verb = "would pose" if args.dry_run else "posed"
        print(f"{mod}: {verb} {prims} cloth(s) in {files} file(s)")
        total_files += files
        total_prims += prims
    print(f"{total_prims} cloth(s) in {total_files} file(s), "
          f"{time.time() - started:.0f}s")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
