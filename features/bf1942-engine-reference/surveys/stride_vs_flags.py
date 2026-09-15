#!/usr/bin/env python3
"""Ledger SM-1/SM-2: a StandardMesh material's `flags` word against its stride.

The engine lays a vertex out from `flags` (its vertex format) and derives the
stride from it with `rend::getStride`; the file's `vertex_stride` is only the
number of bytes the loader pulls from the stream. This tabulates the file's
stride, the flags word and the engine's stride across every installed mod, and
for each disagreement checks that the flags-driven positions land inside the
mesh's own header bounds.

    python3 features/bf1942-engine-reference/surveys/stride_vs_flags.py

Expected result as of 2026-09-15 (33,038 meshes, 234,144 descriptors):

    file stride  32  flags 0x00411  engine  32  x167425  mods=14
    file stride  40  flags 0x02411  engine  40  x 66718  mods=14
    file stride  64  flags 0x00411  engine  32  x     1  mods= 1  MISMATCH  bf1918 o_WoodenCart_M2.sm

    1 material where the file's stride is not getStride(flags):
      bf1918:standardMesh/o_WoodenCart_M2.sm:o_woodencart_m2_Material0
        288 vertices, positions within header bounds: yes, second uv set: none

Before 2026-09-15 the reader laid vertices out by stride and that one cart came
through as every other vertex plus an invented lightmap channel. See
../subsystems/standardmesh-vertex-format.md.
"""

from __future__ import annotations

import collections
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO / "tools/bf1942-models"))

from bf42 import stdmesh                     # noqa: E402
from bf42.rfa import ArchivePool             # noqa: E402

MODS = Path.home() / ".wine/drive_c/EA Games/Battlefield 1942/Mods"


def within_bounds(mesh: stdmesh.StandardMesh, material: stdmesh.Material, slack: float = 1e-3) -> bool:
    positions = material.positions()
    if not positions:
        return False
    lo = [min(p[i] for p in positions) for i in range(3)]
    hi = [max(p[i] for p in positions) for i in range(3)]
    return all(lo[i] >= mesh.bounds_min[i] - slack and hi[i] <= mesh.bounds_max[i] + slack
               for i in range(3))


def main() -> int:
    if not MODS.is_dir():
        print(f"No BF1942 install at {MODS}", file=sys.stderr)
        return 1

    combos: dict[tuple[int, int, int], collections.Counter] = collections.defaultdict(collections.Counter)
    examples: dict[tuple[int, int, int], tuple[str, str, str, int]] = {}
    mismatches: list[tuple[str, str, stdmesh.StandardMesh, stdmesh.Material]] = []
    total_meshes = total_failed = 0

    for mod in sorted(p.name for p in MODS.iterdir() if p.is_dir()):
        archives = MODS / mod / "Archives"
        if not archives.is_dir():
            continue
        pool = ArchivePool()
        loaded = 0
        for rfa in sorted(archives.glob("*.rfa")):
            try:
                pool.add(rfa, rfa.name)
                loaded += 1
            except Exception:
                pass          # a mod shipping a corrupt archive is not our problem here
        if not loaded:
            continue

        ok = failed = 0
        for name in (n for n in pool.names() if n.lower().endswith(".sm")):
            try:
                mesh = stdmesh.parse(pool.read(name), Path(name).stem)
            except Exception:
                failed += 1
                continue
            ok += 1
            for lod in mesh.lods:
                for m in lod.materials:
                    key = (m.stride, m.flags, m.engine_stride)
                    combos[key][mod] += 1
                    examples.setdefault(key, (mod, name, m.name, m.primitive))
                    if not m.stride_matches_flags:
                        mismatches.append((mod, name, mesh, m))

        total_meshes += ok
        total_failed += failed
        print(f"{mod:14s} {loaded:3d} rfa  {ok:5d} sm ok  {failed:4d} failed", file=sys.stderr)

    print(f"\n=== (file stride, flags, engine stride) across {total_meshes} meshes, "
          f"{total_failed} unparseable ===")
    for (stride, flags, engine), per_mod in sorted(combos.items()):
        mod, path, mat, prim = examples[(stride, flags, engine)]
        tag = "" if stride == engine else "  MISMATCH"
        print(f"file stride {stride:3d}  flags 0x{flags:05x}  engine {engine:3d}  "
              f"x{sum(per_mod.values()):6d}  mods={len(per_mod):2d}{tag}  "
              f"eg {mod}:{path}:{mat} prim={prim}")

    print(f"\n{len(mismatches)} material(s) where the file's stride is not getStride(flags):")
    for mod, path, mesh, m in mismatches:
        inside = "yes" if within_bounds(mesh, m) else "NO"
        uv2 = "none" if m.uvs2() is None else "present"
        print(f"  {mod}:{path}:{m.name}")
        print(f"    {m.vertex_count} vertices, positions within header bounds: {inside}, "
              f"second uv set: {uv2}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
