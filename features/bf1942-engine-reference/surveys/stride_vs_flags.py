#!/usr/bin/env python3
"""Ledger SM-1/SM-2: does a StandardMesh material's `flags` word track its stride?

Our reader infers vertex layout from `vertex_stride` and ignores `flags`. This
tabulates both across every installed mod so the claim can be checked against
real data rather than against vanilla habit.

    python3 features/bf1942-engine-reference/surveys/stride_vs_flags.py

Expected result as of 2026-09-12 (33,038 meshes, 234,144 descriptors):

    stride  32 ( 8f)  flags 0x00411  x167425  mods=14
    stride  40 (10f)  flags 0x02411  x 66718  mods=14
    stride  64 (16f)  flags 0x00411  x     1  mods=1   bf1918 o_WoodenCart_M2.sm

That third row is the counterexample: the same component flags as the 8-float
layout, in a 16-float stride. See ../ledger.md.
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


def main() -> int:
    if not MODS.is_dir():
        print(f"No BF1942 install at {MODS}", file=sys.stderr)
        return 1

    combos: dict[tuple[int, int], collections.Counter] = collections.defaultdict(collections.Counter)
    examples: dict[tuple[int, int], tuple[str, str, str, int]] = {}
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
                    key = (m.stride, m.flags)
                    combos[key][mod] += 1
                    examples.setdefault(key, (mod, name, m.name, m.primitive))

        total_meshes += ok
        total_failed += failed
        print(f"{mod:14s} {loaded:3d} rfa  {ok:5d} sm ok  {failed:4d} failed", file=sys.stderr)

    print(f"\n=== (stride, flags) across {total_meshes} meshes, {total_failed} unparseable ===")
    for (stride, flags), per_mod in sorted(combos.items()):
        mod, path, mat, prim = examples[(stride, flags)]
        print(f"stride {stride:3d} ({stride // 4:2d}f)  flags 0x{flags:05x}  "
              f"x{sum(per_mod.values()):6d}  mods={len(per_mod):2d}  "
              f"eg {mod}:{path}:{mat} prim={prim}")

    if len(combos) > 2:
        print("\nMore than two combinations: stride is NOT a safe proxy for layout.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
