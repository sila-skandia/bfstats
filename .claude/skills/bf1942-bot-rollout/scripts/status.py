#!/usr/bin/env python3
"""Every published level that ships no AI of its own, and where it stands.

    status.py [--md]         all trees;  status.py maps/mods/fhsw   one tree

One line a level: live (it carries the menu tag), turned down (its layer was
played on the page and withdrawn, with the reason), out (the lint or the
judge refuses it, or a held.json in its layer folder says why it waits, with
the reason), judged (a verdict, not yet on the page), or not screened. Reads the live menus and maps trees, and the layer folders
in this checkout.
"""
import json, re, subprocess, sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import fetch_tree as ft  # noqa: E402

ROOT = Path(subprocess.check_output(["git", "rev-parse", "--show-toplevel"], text=True).strip())
LAYERS = ROOT / "tools/bf1942-models/bot-layers"
TREES = ["maps", "maps/mods/xpack1", "maps/mods/xpack2", "maps/mods/fhsw", "maps/mods/fhsweurope", "maps/mods/fh",
         "maps/mods/desertcombat", "maps/mods/bf1918", "maps/mods/eod", "maps/mods/gcmod"]


def tagged(tree):
    try:
        d = json.loads(ft.get(f"{ft.SITE}/{tree}/_shared/hud/menu/menu-levels.json"))
    except Exception:
        return set()
    out = set()

    def walk(o):
        if isinstance(o, dict):
            if o.get("generatedBots"):
                out.add(str(o.get("level") or o.get("name") or o.get("id")).lower())
            for v in o.values():
                walk(v)
        elif isinstance(o, list):
            for v in o:
                walk(v)
    walk(d)
    return out


def state(tree, folder, scene, live):
    layers = "bf1942" if tree == "maps" else tree.split("/")[-1]
    d = LAYERS / layers / folder
    name = str(scene.get("level") or folder).lower()
    if folder.lower() in live or name in live:
        return "live", ""
    flags = scene.get("controlPoints") or []
    hint = f"world {int(scene.get('worldSize') or 0)}, {len(flags)} flags, {len(scene.get('soldierSpawns') or [])} soldier spawns"
    if (d / "held.json").is_file():
        return "out", "held: " + str(json.loads((d / "held.json").read_text()).get("because", ""))[:150]
    if not (d / "verdict.json").is_file():
        if not flags:
            return "out", "no control point: not a Conquest level on foot (" + hint + ")"
        if len(flags) < 2:
            return "out", "one control point: nothing to order bots to (" + hint + ")"
        return "not screened", hint
    v = json.loads((d / "verdict.json").read_text())
    if v.get("lintErrors"):
        why = "; ".join(sorted({re.sub(r":.*", "", e)[:70] for e in v["lintErrors"]}))
        return "out", "lint: " + why
    if v.get("outcome") == "unsuitable":
        return "out", "unsuitable"
    if v.get("acceptanceWithdrawn"):
        return "turned down", str(v["acceptanceWithdrawn"].get("because", ""))[:150]
    if (d / "page.json").is_file():
        # Played on the page and never tagged: nothing was accepted, so there was nothing to withdraw.
        p = json.loads((d / "page.json").read_text())
        runs = "; ".join(f"{r.get('enemyKillsPerBotMinute')} enemy kills a bot-minute, {r.get('capturesTotal')} captures"
                         for r in p.get("runs") or [])
        if not (p.get("rollout") or {}).get("pass"):
            return "turned down", f"page match {p.get('date')}: {runs}; under the rollout floor"[:150]
        return "judged", f"passed the page {p.get('date')} ({runs}), not tagged: run menus.sh"[:150]
    return "judged", f"{v.get('outcome')}, not on the page" + (" (accepted)" if v.get("accepted") else "")


def one_tree(tree):
    live = tagged(tree)
    rows = ft.rows_of(tree)

    def one(item):
        folder, _ = item
        try:
            sc = json.loads(ft.get(f"{ft.SITE}/{tree}/{folder}/scene.json"))
        except Exception as e:
            return folder, "error", repr(e)[:80], "?"
        k = ft.kind(sc)
        if k == "shipped":
            return folder, "shipped", "", k
        return (folder, *state(tree, folder, sc, live), k)
    with ThreadPoolExecutor(8) as pool:
        return [r for r in pool.map(one, rows)]


def main():
    md = "--md" in sys.argv
    trees = [a for a in sys.argv[1:] if not a.startswith("--")] or TREES
    totals = {}
    for tree in trees:
        rows = one_tree(tree)
        shipped = sum(1 for r in rows if r[1] == "shipped")
        rest = [r for r in rows if r[1] != "shipped"]
        counts = {}
        for r in rest:
            counts[r[1]] = counts.get(r[1], 0) + 1
            totals[r[1]] = totals.get(r[1], 0) + 1
        print(f"\n{'### ' if md else '== '}{tree}: {len(rows)} levels, {shipped} ship their own AI; of the other {len(rest)}: "
              + ", ".join(f"{n} {k}" for k, n in sorted(counts.items())))
        if md and rest:
            print("\n| Level | State | Why |\n|---|---|---|")
        for folder, st, why, _ in sorted(rest, key=lambda r: (r[1], r[0])):
            print(f"| {folder} | {st} | {why} |" if md else f"  {st:13s} {folder:36s} {why}")
    print("\n" + ("**All trees:** " if md else "all trees: ") + ", ".join(f"{n} {k}" for k, n in sorted(totals.items())))


if __name__ == "__main__":
    main()
