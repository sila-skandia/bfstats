#!/usr/bin/env python3
"""An airframe as a test fixture: a published aircraft's node tree and the
box its drag and inertia are taken from, with no geometry.

    python3 surveys/airframe_fixture.py desertcombat F16 Mig29 \\
        --out tests/fixtures/dc-jets.json
    python3 surveys/airframe_fixture.py bf1942 Stuka SBD bf1918:AlbatrossC3 \\
        --tracers --out tests/fixtures/two-seaters.json

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

A template may name its own tree (`bf1918:AlbatrossC3`); `bf1942` is
vanilla's (`models/`, `maps/`), and a tree whose catalogue carries no store
`sha` is read from its own `models/` folder. `--tracers` keeps each FireArms'
tracer interval and scaler, which the dogfight school's gunners fire by
(features/dogfight-doctrine, "The gunners from the planes' own data").
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


def trim(node: dict, tracers: bool = False) -> dict:
    """A node as the flight law needs it."""
    extras = dict(node.get("extras") or {})
    extras.pop("effects", None)
    if isinstance(extras.get("armor"), dict):
        extras["armor"] = {k: v for k, v in extras["armor"].items() if k != "effects"}
    arms = extras.get("fireArms")
    if isinstance(arms, dict):
        arms = {k: v for k, v in arms.items() if (tracers and k == "tracer") or k not in DROP_FIREARMS}
        if isinstance(arms.get("tracer"), dict):
            arms["tracer"] = {k: v for k, v in arms["tracer"].items() if k in ("interval", "scaler", "timeToLive", "gravity")}
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


def trees(mod: str) -> tuple[str, str]:
    """A tree's models and maps folders on the site."""
    return ("models", "maps") if mod == "bf1942" else (f"models/mods/{mod}", f"maps/mods/{mod}")


def airframe(mod_models: str, row: dict, collision: dict, tracers: bool = False) -> dict:
    url = f"{SITE}/glbs/{row['sha']}.glb" if row.get("sha") else f"{SITE}/{mod_models}/{row['glb']}"
    doc = glb_json(_get(url))
    nodes = [trim(node, tracers) for node in doc["nodes"]]
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
    return {"template": row["name"], "sha": row.get("sha"), "scene": scene, "nodes": nodes,
            "collisionMeshes": {"geometries": geometries, "meshes": meshes}}


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("mod", help="the tree's id under models/mods and maps/mods")
    ap.add_argument("templates", nargs="+", help="a template of the tree, or <mod>:<template> of another")
    ap.add_argument("--tracers", action="store_true", help="keep each FireArms' tracer interval and scaler")
    ap.add_argument("--out", type=Path, required=True)
    args = ap.parse_args()
    cache: dict[str, tuple[str, dict, dict]] = {}

    def tree(mod: str) -> tuple[str, dict, dict]:
        if mod not in cache:
            models, maps = trees(mod)
            rows = {r["name"]: r for r in json.loads(_get(f"{SITE}/{models}/models.json"))}
            collision = json.loads(_get(f"{SITE}/{maps}/_shared/collision-meshes.json"))
            cache[mod] = (models, rows, collision)
        return cache[mod]

    airframes, mods = {}, {}
    for spec in args.templates:
        mod, _, name = spec.rpartition(":")
        mod = mod or args.mod
        models, rows, collision = tree(mod)
        airframes[name] = airframe(models, rows[name], collision, args.tracers)
        mods[name] = mod
    out = {"mod": args.mod, "source": SITE, "airframes": airframes}
    if any(m != args.mod for m in mods.values()):
        out["mods"] = mods
    args.out.write_text(json.dumps(out, separators=(",", ":")) + "\n")
    print(f"{args.out}: {', '.join(args.templates)} ({args.out.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
