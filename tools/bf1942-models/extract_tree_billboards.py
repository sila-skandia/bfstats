#!/usr/bin/env python3
"""Extract the far-distance tree billboards a mod ships, for the map viewer.

Every `GeometryTemplate.create TreeMesh` carries `.billboard 1` and a
`.billboardDistance` (50 m for all of vanilla's). Past that range the engine
stops drawing the trunk, branch cards and leaf sprites and draws one
camera-facing card instead, textured from `treeMesh/Billboards/<mesh>.dds`:
a 1024x128 strip (512x64 for the bushes) of eight pre-rendered views, 45
degrees apart, each one square in world units and spanning the mesh bounding
box's height. That card is what every tree beyond 50 m *is* in the retail
game — the soft, dense canopies in the distance are these strips, not the
geometry — so a viewer that keeps drawing the geometry out to the fog shows
alpha-tested leaf cards thinning to sticks instead.

Nothing here touches a level bake: the strips are shared per mod and land
beside the other per-mod shared assets, keyed by geometry template name, so
`map.html` can pick them up for any placed tree without a re-extract.

    python3 extract_tree_billboards.py --mod bf1942 --out viewer/maps/_shared
    python3 extract_tree_billboards.py --mod XPack1 --out viewer/maps/mods/xpack1/_shared

Writes `<out>/trees.json` and `<out>/trees/<mesh>.png`.

The frame order was fitted against the geometry (2026-09-23, IoU of the
strip's alpha against the trunk and leaf sprites projected from eight
azimuths, 37 vanilla trees): frame `f` is the tree seen by a camera at
azimuth `180 + 45 f` degrees in the mesh's own left-handed frame, azimuth 0
being the camera on the +z side — i.e. frame 0 is the default D3D front view
(camera on -z looking down +z) and the camera walks toward +x from there.
"""

from __future__ import annotations

import argparse
import json
import re
import struct
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from bf42.assemble import decode_dds, encode_png  # noqa: E402
from extract_models import DEFAULT_GAME_DIR, build_library, build_pools, mod_chain  # noqa: E402

FRAMES = 8

# `GeometryTemplate.create TreeMesh <name>` and the two lines that follow it.
# The con library keeps kind/file/source per geometry but not these two, so
# the block is re-read from the declaring `.con` here.
_CREATE = re.compile(r"^\s*GeometryTemplate\.create\s+TreeMesh\s+(\S+)", re.IGNORECASE | re.MULTILINE)
_BILLBOARD = re.compile(r"^\s*GeometryTemplate\.billboard\s+(\d+)", re.IGNORECASE | re.MULTILINE)
_DISTANCE = re.compile(r"^\s*GeometryTemplate\.billboardDistance\s+([0-9.]+)", re.IGNORECASE | re.MULTILINE)


def billboard_settings(text: str) -> dict[str, tuple[bool, float | None]]:
    """`{geometry name lower: (billboard on, distance)}` for every TreeMesh in a con."""
    out: dict[str, tuple[bool, float | None]] = {}
    starts = list(_CREATE.finditer(text))
    for i, m in enumerate(starts):
        end = starts[i + 1].start() if i + 1 < len(starts) else len(text)
        body = text[m.end():end]
        # The block ends at the next GeometryTemplate.create of any kind.
        nxt = re.search(r"^\s*GeometryTemplate\.create\s", body, re.IGNORECASE | re.MULTILINE)
        if nxt:
            body = body[:nxt.start()]
        on = _BILLBOARD.search(body)
        dist = _DISTANCE.search(body)
        out[m.group(1).lower()] = (
            (on.group(1) != "0") if on else True,
            float(dist.group(1)) if dist else None,
        )
    return out


def tree_bounds(tm: bytes) -> tuple[list[float], list[float]] | None:
    """The two bounding boxes in a `.tm` header: whole mesh, then leaf sprites."""
    if len(tm) < 12 + 48:
        return None
    version, _unknown, angles = struct.unpack_from("<III", tm, 0)
    if version != 3 or not 1 <= angles <= 16:
        return None
    mesh = list(struct.unpack_from("<6f", tm, 12))
    sprites = list(struct.unpack_from("<6f", tm, 36))
    return mesh, sprites


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--game-dir", type=Path, default=DEFAULT_GAME_DIR)
    ap.add_argument("--mod", default="bf1942")
    ap.add_argument("--out", type=Path,
                    default=Path(__file__).parent / "viewer" / "maps" / "_shared")
    args = ap.parse_args()

    started = time.time()
    chain = mod_chain(args.game_dir, args.mod)
    meshes, _textures, objects, _game = build_pools(chain, [])
    library = build_library(objects)

    settings: dict[str, tuple[bool, float | None]] = {}
    con_cache: dict[str, dict[str, tuple[bool, float | None]]] = {}
    trees: dict[str, dict] = {}
    missing: list[str] = []
    off: list[str] = []
    out_dir = args.out / "trees"
    out_dir.mkdir(parents=True, exist_ok=True)

    for key, geom in sorted(library.geometries.items()):
        if geom.kind.lower() != "treemesh":
            continue
        if geom.source not in con_cache:
            blob = objects.try_read(geom.source)
            con_cache[geom.source] = billboard_settings(
                blob.decode("latin-1", "replace")) if blob else {}
        on, distance = con_cache[geom.source].get(key, (True, None))
        settings[key] = (on, distance)
        if not on:
            off.append(geom.name)
            continue
        mesh_file = geom.mesh_file
        tm_entry = meshes.resolve_ext(f"treeMesh/{mesh_file}", (".tm",))
        dds_entry = meshes.resolve_ext(f"treeMesh/Billboards/{mesh_file}", (".dds",))
        if not tm_entry or not dds_entry:
            missing.append(geom.name)
            continue
        bounds = tree_bounds(meshes.read(tm_entry))
        if bounds is None:
            missing.append(f"{geom.name} (unreadable .tm header)")
            continue
        try:
            width, height, rgba = decode_dds(meshes.read(dds_entry))
        except Exception as exc:  # a strip we cannot decode is one missing tree
            missing.append(f"{geom.name} ({exc})")
            continue
        if width != height * FRAMES:
            missing.append(f"{geom.name} (strip is {width}x{height}, not {FRAMES} square frames)")
            continue
        png_name = f"{mesh_file.lower()}.png"
        (out_dir / png_name).write_bytes(encode_png(width, height, rgba, drop_alpha=False))
        mesh_box, sprite_box = bounds
        trees[geom.name] = {
            "file": f"trees/{png_name}",
            "mesh": mesh_file,
            # 50 for every vanilla tree; a template that never said is drawn
            # as geometry at every range, the same as `.billboard 0`.
            "distance": distance,
            "frames": FRAMES,
            "width": width,
            "height": height,
            # `.tm` order and handedness (x, y, z min then max); the viewer
            # negates z like the mesh exporter does.
            "bounds": [round(v, 4) for v in mesh_box],
            "spriteBounds": [round(v, 4) for v in sprite_box],
        }

    manifest = {
        "mod": args.mod,
        "frames": FRAMES,
        "trees": trees,
        "billboardOff": sorted(off),
        "missing": sorted(missing),
    }
    (args.out / "trees.json").write_text(json.dumps(manifest, indent=1, sort_keys=True))
    print(f"{len(trees)} tree billboards, {len(off)} with billboard off, "
          f"{len(missing)} missing, {time.time() - started:.1f}s -> {args.out / 'trees.json'}",
          file=sys.stderr)
    for name in missing:
        print(f"  missing: {name}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
