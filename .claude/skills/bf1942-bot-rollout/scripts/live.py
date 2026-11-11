#!/usr/bin/env python3
"""List the levels that carry the EXPERIMENTAL BOTS tag on the live site, by tree."""
import gzip, json, time, urllib.request

SITE = "https://mesh.bfstats.io"
TREES = ["maps", "maps/mods/xpack1", "maps/mods/xpack2", "maps/mods/fhsw", "maps/mods/fhsweurope", "maps/mods/fh",
         "maps/mods/desertcombat", "maps/mods/bf1918", "maps/mods/eod"]


def walk(o):
    if isinstance(o, dict):
        if o.get("generatedBots"):
            yield o
        for v in o.values():
            yield from walk(v)
    elif isinstance(o, list):
        for v in o:
            yield from walk(v)


total = 0
for tree in TREES:
    req = urllib.request.Request(f"{SITE}/{tree}/_shared/hud/menu/menu-levels.json?cb={int(time.time())}", headers={"Accept-Encoding": "gzip", "User-Agent": "bfstats-bot-rollout"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            data = r.read()
            data = gzip.decompress(data) if r.headers.get("Content-Encoding") == "gzip" else data
    except Exception:
        continue
    names = sorted(str(r.get("level") or r.get("name") or r.get("id")) for r in walk(json.loads(data)))
    total += len(names)
    if names:
        print(f"{tree}: {len(names)}  {', '.join(names)}")
print("live with generated bots:", total)
