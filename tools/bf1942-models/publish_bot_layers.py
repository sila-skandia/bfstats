#!/usr/bin/env python3
"""Stage generated bot layers for publishing from a PC that does not hold the tree.

    python3 publish_bot_layers.py --root <scratch dir> --game-dir <game folder>
    python3 publish_bot_layers.py --root <scratch dir> --game-dir <game folder> --levels shigaisen_b

A generated layer (features/bot-map-generation) reaches a level through the
bake's `ai` layer, which needs the level's `scene.json` in a maps tree. The
community maps are in the vanilla tree, and that tree is not on every PC. This
takes the published `scene.json` of each level whose layer the bake's gate
lets through (`bf42/ai_level.py generated_layer_gate`: a verdict of pass, or an
accepted reason), patches the `ai` layer into it with `patch_scene.py`, and
refreshes the menu rows' `generatedBots` flags in the published
`menu-levels.json`, all under `<root>/maps`. Nothing is sent: it prints the
publisher's command for the staged root. The publisher sends only files that
are absent from the volume or differ there, and deletes nothing, so a root
holding these few files is safe to publish.

Each `scene.json` is fetched fresh on every run, so a level another session
re-baked since is patched as it now stands. A level whose layer is gated out
is left alone, and its menu row loses the flag if it had one.
"""
from __future__ import annotations

import argparse
import gzip
import json
import sys
import time
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import patch_scene  # noqa: E402
import scene_layers  # noqa: E402
from bf42.ai_level import GENERATED_ROOT, generated_layer_gate  # noqa: E402

SITE = "https://mesh.bfstats.io"
MENU_REL = "_shared/hud/menu/menu-levels.json"


def fetch(url: str) -> bytes:
    """The published file's bytes, past any cache."""
    req = urllib.request.Request(f"{url}?cb={int(time.time())}",
                                 headers={"Accept-Encoding": "gzip", "User-Agent": "bfstats-bot-layers"})
    with urllib.request.urlopen(req, timeout=120) as r:
        data = r.read()
        return gzip.decompress(data) if r.headers.get("Content-Encoding") == "gzip" else data


def gated_layers(mod: str, layers_root: Path | None = None) -> tuple[list[str], dict[str, str]]:
    """The mod's layer folders split by the bake's gate: `(open, {closed: why})`."""
    base = Path(layers_root or GENERATED_ROOT) / mod.lower()
    live, closed = [], {}
    for folder in sorted(p for p in base.iterdir() if (p / "generated.json").is_file()) if base.is_dir() else []:
        ok, why = generated_layer_gate(folder)
        if ok:
            live.append(folder.name)
        else:
            closed[folder.name] = why
    return live, closed


def mark_menu(doc: dict, live: set[str]) -> list[str]:
    """Set `generatedBots` on the rows of `live` that ship no single player,
    drop it everywhere else. Returns what changed, as `+dir` / `-dir`."""
    changed = []
    for row in doc.get("levels", []):
        want = row.get("dir", "").lower() in live and row.get("singlePlayer") is False
        if want and row.get("generatedBots") is not True:
            row["generatedBots"] = True
            changed.append("+" + row["dir"])
        elif not want and "generatedBots" in row:
            del row["generatedBots"]
            changed.append("-" + row["dir"])
    return changed


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--root", type=Path, required=True,
                    help="scratch directory to stage under (its maps/ is what the publisher sends)")
    ap.add_argument("--game-dir", type=Path, required=True,
                    help="a game folder holding the mod's archives and each level's own")
    ap.add_argument("--mod", default="bf1942", help="the mod folder the layers belong to")
    ap.add_argument("--levels", default=None, help="comma-separated subset of the gated-in layers")
    ap.add_argument("--site", default=SITE)
    args = ap.parse_args(argv)

    live, closed = gated_layers(args.mod)
    for name, why in closed.items():
        print(f"{name}: left alone ({why})", file=sys.stderr)
    stage = live
    if args.levels:
        asked = [n.strip().lower() for n in args.levels.split(",") if n.strip()]
        for name in asked:
            if name not in live:
                print(f"{name}: not staged, its layer is not gated in", file=sys.stderr)
        stage = [n for n in live if n in asked]
    maps_root = args.root.resolve() / "maps"
    tree = scene_layers.tree_for(maps_root, args.mod)
    prefix = f"{args.site}/maps" + ("" if tree == maps_root else f"/mods/{args.mod.lower()}")

    staged = []
    for name in stage:
        try:
            body = fetch(f"{prefix}/{name}/scene.json")
        except Exception as e:  # a level the volume does not hold is not an error of the layer
            print(f"{name}: no published scene.json ({e}); skipped", file=sys.stderr)
            continue
        level_dir = tree / name
        level_dir.mkdir(parents=True, exist_ok=True)
        (level_dir / "scene.json").write_bytes(body)
        staged.append(name)
    if staged:
        code = patch_scene.main(["--layer", "ai", "--mod", args.mod, "--tree", str(tree),
                                 "--game-dir", str(args.game_dir.expanduser()), *staged])
        if code:
            return code
    failed = []
    for name in staged:
        scene = json.loads((tree / name / "scene.json").read_text())
        marker = (scene.get("ai") or {}).get("generated")
        if not marker:
            failed.append(name)
            print(f"{name}: the patch wrote no generated layer (does the level ship its own AI?)", file=sys.stderr)
            continue
        maps = sorted(p.name for p in (tree / name / "pathfinding").glob("*")) if (tree / name / "pathfinding").is_dir() else []
        print(f"{name}: staged, gate '{marker.get('gate')}', {len(maps)} pathfinding files")

    # The menu: flags follow the gate for every layer of the mod, staged this run or not.
    menu_file = tree / MENU_REL
    try:
        body = fetch(f"{prefix}/{MENU_REL}")
    except Exception as e:
        print(f"menu rows not fetched ({e}); flags untouched", file=sys.stderr)
        body = None
    if body is not None:
        doc = json.loads(body)
        if (json.dumps(doc, indent=1) + "\n").encode() != body:
            print("menu rows: the published file is not in the extractor's own form; flags untouched", file=sys.stderr)
        else:
            changed = mark_menu(doc, set(live))
            menu_file.parent.mkdir(parents=True, exist_ok=True)
            if changed:
                menu_file.write_text(json.dumps(doc, indent=1) + "\n")
                print(f"menu rows: {' '.join(changed)}")
            else:
                menu_file.unlink(missing_ok=True)
                print("menu rows: already as the gate has them")

    root = args.root.resolve()
    print("\nto publish (dry run first):")
    print(f"  python3 scripts/publish-mesh-delta.py maps --hash --list --dry-run --root {root} --hash-manifest {root}/hashes-maps.json")
    print(f"  python3 scripts/publish-mesh-delta.py maps --hash --list --root {root} --hash-manifest {root}/hashes-maps.json")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
