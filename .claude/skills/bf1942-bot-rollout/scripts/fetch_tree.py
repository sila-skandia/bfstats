#!/usr/bin/env python3
"""Mirror published levels into a local tree the headless runner can load.

    fetch_tree.py --tree maps/mods/fhsweurope --dest <dir> --list
    fetch_tree.py --tree maps/mods/fhsweurope --dest <dir> --levels aberdeen,kursk-1943 [--models <models dir>]

`--list` reads the tree's maps.json and every level's scene.json (small) and
prints one line a level: its folder, world size, capturable flags, vehicle
spawners, and whether it ships an AI layer (`shipped`), carries a generated
one (`generated`), or has none (`botless`). Nothing large is fetched.

With `--levels` it fetches what `sim/run.mjs` loads: scene.json, scene.glb,
the heightmap and terrain material images, the level's pathfinding maps, and
the tree's `_shared` tables (bot names, loadouts, vehicle AI, damage,
collision meshes). `--models` also fetches the glb and report of every
vehicle the levels' spawners place, into the models mirror (the mod's own
tree, else vanilla's), skipping files already there.
"""
import argparse, gzip, json, sys, time, urllib.error, urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

SITE = "https://mesh.bfstats.io"
SHARED = ["bot-names.json", "loadouts.json", "vehicle-ai.json", "damage.json", "collision-meshes.json"]


def get(url, ok404=False):
    req = urllib.request.Request(f"{url}?cb={int(time.time())}", headers={"Accept-Encoding": "gzip", "User-Agent": "bfstats-bot-rollout"})
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=300) as r:
                data = r.read()
                return gzip.decompress(data) if r.headers.get("Content-Encoding") == "gzip" else data
        except urllib.error.HTTPError as e:
            if e.code == 404 and ok404:
                return None
            if e.code == 404 or attempt == 2:
                raise
        except Exception:
            if attempt == 2:
                raise
        time.sleep(2)


def rows_of(tree):
    d = json.loads(get(f"{SITE}/{tree}/maps.json"))
    rows = d if isinstance(d, list) else d.get("maps") or d.get("levels") or []
    return [(r["report"].split("/")[0], r) for r in rows if r.get("report")]


def kind(scene):
    ai = scene.get("ai") or {}
    if ai.get("generated"):
        return "generated"
    return "shipped" if ai.get("strategies") or ai.get("strategicAreas") else "botless"


def listing(tree):
    def one(item):
        folder, row = item
        try:
            sc = json.loads(get(f"{SITE}/{tree}/{folder}/scene.json"))
        except Exception as e:  # a row whose scene is missing is reported, not fatal
            return f"{folder}\tERROR {e!r}"
        flags = sc.get("controlPoints") or []
        cap = sum(1 for f in flags if not f.get("unableToChangeTeam"))
        return "\t".join([folder, row.get("name", folder), kind(sc), f"world {int(sc.get('worldSize') or 0)}",
                          f"flags {len(flags)} ({cap} capturable)", f"vehicles {len(sc.get('objectSpawns') or [])}",
                          f"spawns {len(sc.get('soldierSpawns') or [])}"])
    with ThreadPoolExecutor(8) as pool:
        for line in pool.map(one, rows_of(tree)):
            print(line)


def fetch_level(tree, folder, dest):
    base = f"{SITE}/{tree}/{folder}"

    def put(rel, ok404=False):
        data = get(f"{base}/{rel}", ok404)
        if data is None:
            return None
        p = dest / folder / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(data)
        return data

    sc = json.loads(put("scene.json"))
    put("scene.glb")
    damage = (sc.get("damage") or {}).get("path")
    for rel in filter(None, [(sc.get("heightmap") or {}).get("image"), ((sc.get("terrain") or {}).get("materials") or {}).get("image"), damage]):
        put(rel, ok404=True)
    if damage:
        put(damage.replace("damage.json", "collision-meshes.json"), ok404=True)
    idx = put("pathfinding/index.json", ok404=True)
    if idx:
        idx = json.loads(idx)
        for m in idx.get("maps", []):
            if m.get("file"):
                put("pathfinding/" + m["file"])
        for m in idx.get("strategic", []):
            if m.get("file"):
                put("pathfinding/" + m["file"])
                put("pathfinding/" + m["infoFile"])
    size = sum(f.stat().st_size for f in (dest / folder).rglob("*") if f.is_file()) // 1000
    print(f"{folder}: {kind(sc)}, {size} kB")
    return sc


def fetch_models(tree, scenes, models):
    mod_tree = tree.replace("maps", "models", 1)          # maps/mods/x -> models/mods/x, maps -> models
    want = set()
    for sc in scenes:
        for s in sc.get("objectSpawns") or []:
            want.update(v for v in (s.get("templates") or {}).values() if v)
            if s.get("vehicle"):
                want.add(s["vehicle"])
    models.mkdir(parents=True, exist_ok=True)
    have = {f.name.lower() for f in models.iterdir()}
    index = {}
    for src in dict.fromkeys([mod_tree, "models"]):
        try:
            rows = json.loads(get(f"{SITE}/{src}/models.json"))
        except Exception:
            continue
        for r in rows if isinstance(rows, list) else rows.get("models", []):
            index.setdefault(str(r.get("name", "")).lower(), (src, r))
    got = miss = 0
    for name in sorted(want):
        hit = index.get(name.lower())
        if not hit:
            miss += 1
            continue
        src, row = hit
        dest = models if src == mod_tree else (models.parent.parent if models.parent.name == "mods" else models)
        for key in ("glb", "report"):
            rel = row.get(key)
            if not rel or (dest / rel).exists():
                continue
            data = get(f"{SITE}/{src}/{rel}", ok404=True)
            if data is not None:
                (dest / rel).parent.mkdir(parents=True, exist_ok=True)
                (dest / rel).write_bytes(data)
                got += 1
    print(f"models: {len(want)} vehicle templates, {got} files fetched, {miss} not in any models.json, {len(have)} already in {models}")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--tree", required=True, help="the published tree: maps, or maps/mods/<mod>")
    ap.add_argument("--dest", help="the local tree to write (not needed with --list)")
    ap.add_argument("--list", action="store_true")
    ap.add_argument("--levels", help="comma-separated level folders")
    ap.add_argument("--models", help="the local models dir for this tree; fetches the vehicles the levels place")
    a = ap.parse_args()
    if a.list:
        return listing(a.tree)
    if not a.levels or not a.dest:
        ap.error("--levels and --dest, or --list")
    dest = Path(a.dest)
    for rel in SHARED:
        data = get(f"{SITE}/{a.tree}/_shared/{rel}", ok404=True)
        if data is not None:
            (dest / "_shared").mkdir(parents=True, exist_ok=True)
            (dest / "_shared" / rel).write_bytes(data)
    (dest / "maps.json").write_bytes(get(f"{SITE}/{a.tree}/maps.json"))
    scenes = [fetch_level(a.tree, l.strip(), dest) for l in a.levels.split(",") if l.strip()]
    if a.models:
        fetch_models(a.tree, scenes, Path(a.models))


if __name__ == "__main__":
    sys.exit(main())
