#!/usr/bin/env python3
"""Census: LOD rungs a baked level ships that the client never draws, or draws
with another texture than their base mesh, over the EXPORTED levels of every
tree (the rows of each tree's maps.json, never the install's archives).

    lightmapped  a part with the level's lightmap (`extras.lightmap`, given
                 only to a mesh whose `.sm` lightmap byte is set) that still
                 ships rungs. The client keeps LOD 0 alone for such a mesh
                 (ledger LOD-6, `readLods` 0x005b5585); a bake from before
                 2026-10-15 ships them, and the viewer hides them
                 (`level-statics.js` `liftLods`). Re-baked, they are gone.
    texture      a rung whose base-colour texture is none of its base mesh's.

    python3 surveys/census_lod_chains.py [--trees fhsweurope,fhsw] [--json out.json]

From tools/bf1942-models. Reads only the glb JSON chunks: seconds a tree.
"""

from __future__ import annotations

import argparse
import json
import struct
import sys
from pathlib import Path

VIEWER = Path(__file__).resolve().parent.parent / "viewer"


def trees() -> list[tuple[str, Path]]:
    out = [("bf1942", VIEWER / "maps")]
    registry = json.loads((VIEWER / "models" / "mods.json").read_text())
    for mod in registry.get("mods", []):
        maps = VIEWER / "maps" / "mods" / mod["id"]
        if (maps / "maps.json").is_file():
            out.append((mod["id"], maps))
    return out


def glb_json(path: Path) -> dict:
    with open(path, "rb") as fh:
        head = fh.read(20)
        length = struct.unpack("<I", head[12:16])[0]
        return json.loads(fh.read(length))


def base_textures(doc: dict, node: dict) -> set:
    if node.get("mesh") is None:
        return set()
    out = set()
    for prim in doc["meshes"][node["mesh"]]["primitives"]:
        if prim.get("material") is None:
            continue
        pbr = doc["materials"][prim["material"]].get("pbrMetallicRoughness", {})
        index = pbr.get("baseColorTexture", {}).get("index")
        if index is None:
            out.add(None)
            continue
        tex = doc["textures"][index]
        source = tex.get("source", (tex.get("extensions") or {}).get("EXT_texture_webp", {}).get("source"))
        image = doc["images"][source] if source is not None else {}
        out.add(image.get("uri") or image.get("name") or source)
    return out


def census_level(glb: Path) -> dict:
    doc = glb_json(glb)
    nodes = doc["nodes"]
    lit, texture, parts = set(), set(), 0
    lit_parts = 0
    for node in nodes:
        rungs = [nodes[c] for c in node.get("children", [])
                 if (nodes[c].get("extras") or {}).get("lod", {}).get("level", 0) > 0]
        if not rungs:
            continue
        parts += 1
        geometry = (node.get("extras") or {}).get("geometry") or node.get("name")
        if (node.get("extras") or {}).get("lightmap"):
            lit.add(geometry)
            lit_parts += 1
        base = base_textures(doc, node)
        for rung in rungs:
            if base_textures(doc, rung) - base:
                texture.add(geometry)
    return {"parts": parts, "litParts": lit_parts, "lit": sorted(lit), "texture": sorted(texture)}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--trees", help="comma-separated tree ids (default: every tree)")
    ap.add_argument("--json", help="write the per-level report here")
    args = ap.parse_args()
    wanted = set(args.trees.split(",")) if args.trees else None
    report = {}
    for tree, maps in trees():
        if wanted and tree not in wanted:
            continue
        rows = json.loads((maps / "maps.json").read_text())
        levels = {}
        for row in rows:
            glb = maps / row["glb"]
            if not glb.is_file():
                continue
            levels[row["glb"].split("/")[0]] = census_level(glb)
        lit_levels = [lv for lv, r in levels.items() if r["litParts"]]
        report[tree] = levels
        print(f"{tree}: {len(levels)}/{len(rows)} levels; parts with rungs "
              f"{sum(r['parts'] for r in levels.values())}; lightmapped parts still shipping rungs "
              f"{sum(r['litParts'] for r in levels.values())} on {len(lit_levels)} levels "
              f"({len(set(g for r in levels.values() for g in r['lit']))} meshes); rungs with another texture "
              f"{len(set(g for r in levels.values() for g in r['texture']))} meshes")
    if args.json:
        Path(args.json).write_text(json.dumps(report, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
