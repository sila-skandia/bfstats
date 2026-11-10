#!/usr/bin/env python3
"""An airframe as a test fixture: a published aircraft's node tree and the
box its drag and inertia are taken from, with no geometry.

    python3 surveys/airframe_fixture.py desertcombat F16 Mig29 \\
        --out tests/fixtures/dc-jets.json

The dogfight school's tests fly a Spitfire built by hand from El Alamein's
table (`tests/dogfight_school_harness.mjs`). A jet is too many parts to
write out, and the repository holds no glb, so this reads the published
tree instead (`models.json` for the store's `sha`, the glb's JSON chunk, and
`_shared/collision-meshes.json` for the header box the engine reads its
geometry inertia and box drag from, COL-14), and keeps what the flight law
reads: each node's name, placement, children and extras, and whether it
draws (`mesh`), less the parts only a renderer or a gun's effects need (the
meshes themselves, effect lists, trails, tracer and projectile part lists). `collisionMeshes` holds the boxes of the
geometries the tree names and nothing else.

`tests/jet_airframes.mjs` builds an `Aircraft` from a row of it.
"""
from __future__ import annotations

import argparse
import json
import struct
import urllib.request
from pathlib import Path

SITE = "https://mesh.bfstats.io"
DROP_FIREARMS = ("tracer",)
DROP_PROJECTILE = ("trail", "parts", "trailBundle")


def _get(url: str) -> bytes:
    request = urllib.request.Request(url, headers={"User-Agent": "bfstats-tools"})
    with urllib.request.urlopen(request, timeout=120) as response:
        return response.read()


def glb_json(data: bytes) -> dict:
    length = struct.unpack("<I", data[12:16])[0]
    return json.loads(data[20:20 + length])


def trim(node: dict) -> dict:
    """A node as the flight law needs it."""
    extras = dict(node.get("extras") or {})
    extras.pop("effects", None)
    if isinstance(extras.get("armor"), dict):
        extras["armor"] = {k: v for k, v in extras["armor"].items() if k != "effects"}
    arms = extras.get("fireArms")
    if isinstance(arms, dict):
        arms = {k: v for k, v in arms.items() if k not in DROP_FIREARMS}
        if isinstance(arms.get("projectile"), dict):
            arms["projectile"] = {k: v for k, v in arms["projectile"].items() if k not in DROP_PROJECTILE}
        extras["fireArms"] = arms
    out = {k: node[k] for k in ("name", "translation", "rotation", "scale", "children") if k in node}
    if extras:
        out["extras"] = extras
    # Whether the node draws: the law's geometry search asks only that.
    if "mesh" in node:
        out["mesh"] = True
    return out


def airframe(mod_models: str, row: dict, collision: dict) -> dict:
    doc = glb_json(_get(f"{SITE}/glbs/{row['sha']}.glb"))
    nodes = [trim(node) for node in doc["nodes"]]
    scene = doc["scenes"][doc.get("scene", 0)]["nodes"]
    geometries, meshes = {}, {}
    for node in nodes:
        key = str((node.get("extras") or {}).get("geometry") or "").lower()
        if not key:
            continue
        file = collision.get("geometries", {}).get(key, key)
        box = collision.get("meshes", {}).get(file, {}).get("bbox")
        if box:
            geometries[key] = file
            meshes[file] = {"bbox": box}
    return {"template": row["name"], "sha": row["sha"], "scene": scene, "nodes": nodes,
            "collisionMeshes": {"geometries": geometries, "meshes": meshes}}


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("mod", help="the tree's id under models/mods and maps/mods")
    ap.add_argument("templates", nargs="+")
    ap.add_argument("--out", type=Path, required=True)
    args = ap.parse_args()
    models = f"{SITE}/models/mods/{args.mod}"
    rows = {r["name"]: r for r in json.loads(_get(f"{models}/models.json"))}
    collision = json.loads(_get(f"{SITE}/maps/mods/{args.mod}/_shared/collision-meshes.json"))
    out = {"mod": args.mod, "source": SITE, "airframes": {name: airframe(models, rows[name], collision) for name in args.templates}}
    args.out.write_text(json.dumps(out, separators=(",", ":")) + "\n")
    print(f"{args.out}: {', '.join(args.templates)} ({args.out.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
