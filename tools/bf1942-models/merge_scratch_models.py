#!/usr/bin/env python3
"""Merge a scratch extract of a mod's models into its published tree, adding
only what the tree lacks.

    # 1. the whole chain, into a scratch mesh root (models/ above the --out, so
    #    optimise_mesh.py hangs its textures/ store off the scratch root)
    python3 extract_all.py --mod XPack2 --level-all --configuration-all --cockpit \\
        -j 6 --out ~/.cache/x/mesh/models/mods/xpack2
    # 2. see what would move, then do it
    python3 merge_scratch_models.py --id xpack2 --scratch ~/.cache/x/mesh/models/mods/xpack2
    python3 merge_scratch_models.py --id xpack2 --scratch ~/.cache/x/mesh/models/mods/xpack2 --apply
    #    --refresh-own also rewrites the mod's OWN templates' files where the
    #    scratch differs (an exporter fix since the tree was built)

Why not `extract_all.py --out <the tree>`: the trees are shared by sessions
that write them at the same time (another session's `Willy.Raid_on_Agheila`
variant rows, a thumbnail pass), and a whole-tree extract rewrites every file
and `models.json` from its own point of view. This touches:

* each template `models.json` lacks: its `.glb`, `.glb.gz`, `.report.json`,
  wreck, cockpit and level variants, the textures they name that the shared
  `textures/` store lacks, and its row;
* with `--refresh-own`, the files of the templates the mod declares itself
  (`extract_all.select_templates(own_only=True)`) whose bytes changed, each
  written through its own inode (hard-link mirrors see it);
* `models.json`, re-read immediately before it is written and rewritten
  through its own inode, rows sorted the way the catalogue is (category, name).

A file another session wrote since is not detected: look at `ls -l --time-style
=full-iso` first, and run it once, quickly. Nothing is deleted.
"""

from __future__ import annotations

import argparse
import json
import shutil
import struct
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
VIEWER = HERE / "viewer"


def glb_uris(path: Path) -> list[str]:
    """The external image URIs of a glb's JSON chunk."""
    raw = path.read_bytes()
    length = struct.unpack("<I", raw[12:16])[0]
    doc = json.loads(raw[20:20 + length])
    return [i["uri"] for i in doc.get("images", []) if "uri" in i]


def entry_files(entry: dict) -> set[str]:
    """Every file a models.json row names, with each glb's `.gz` and report."""
    files: set[str] = set()
    for key in ("glb", "report", "cockpit"):
        if entry.get(key):
            files.add(entry[key])
    for variant in entry.get("variants") or []:
        for key in ("glb", "report"):
            if variant.get(key):
                files.add(variant[key])
    for name in list(files):
        if name.endswith(".glb"):
            files.add(name + ".gz")
            files.add(name[:-4] + ".report.json")
    return files


def sort_rows(rows: list[dict]) -> list[dict]:
    return sorted(rows, key=lambda e: (e.get("category", ""), str(e.get("name", "")).lower()))


def plan(tree: Path, scratch: Path, own_names: set[str] | None) -> dict:
    """What a merge would do: new rows, files to add, files to replace."""
    old = json.loads((tree / "models.json").read_text())
    new = json.loads((scratch / "models.json").read_text())
    have = {e["name"].lower() for e in old}
    add_rows = [e for e in new if e["name"].lower() not in have]
    add_files: set[str] = set()
    for row in add_rows:
        add_files |= entry_files(row)
    replace: list[str] = []
    if own_names:
        by_name = {e["name"].lower(): e for e in new}
        for name in sorted(own_names):
            row = by_name.get(name)
            if not row:
                continue
            for f in sorted(entry_files(row)):
                dst, src = tree / f, scratch / f
                if src.is_file() and dst.is_file() and src.read_bytes() != dst.read_bytes():
                    replace.append(f)
    return {"old": old, "new": new, "add_rows": add_rows,
            "add_files": sorted(f for f in add_files if (scratch / f).is_file()),
            "absent": sorted(f for f in add_files if not (scratch / f).is_file()),
            "replace": replace}


def merge(tree: Path, scratch: Path, store: Path, scratch_store: Path, *,
          own_names: set[str] | None = None, apply: bool = False) -> dict:
    p = plan(tree, scratch, own_names)
    glbs = [f for f in p["add_files"] + p["replace"] if f.endswith(".glb")]
    wanted: set[str] = set()
    for f in glbs:
        for uri in glb_uris(scratch / f):
            wanted.add(uri.split("textures/", 1)[1])
    new_textures = sorted(t for t in wanted if not (store / t).is_file())
    nowhere = [t for t in new_textures if not (scratch_store / t).is_file()]
    result = {"rows": len(p["add_rows"]), "files": len(p["add_files"]),
              "replace": len(p["replace"]), "textures": len(new_textures),
              "texturesNowhere": nowhere, "absent": p["absent"]}
    if not apply:
        return result
    for t in new_textures:
        if t in nowhere:
            continue
        dst = store / t
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(scratch_store / t, dst)
    for f in p["add_files"]:
        dst = tree / f
        if dst.exists():
            continue  # another session's, or a re-run
        shutil.copyfile(scratch / f, dst)
    for f in p["replace"]:
        data = (scratch / f).read_bytes()
        with open(tree / f, "r+b") as fh:
            fh.write(data)
            fh.truncate()
    # models.json last, re-read now, through its own inode
    current = json.loads((tree / "models.json").read_text())
    merged = {e["name"].lower(): e for e in current}
    for row in p["add_rows"]:
        merged.setdefault(row["name"].lower(), row)
    text = json.dumps(sort_rows(list(merged.values())), indent=2) + "\n"
    with open(tree / "models.json", "r+b") as fh:
        fh.write(text.encode())
        fh.truncate()
    result["written"] = len(merged)
    return result


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--id", required=True,
                    help="tree id (xpack2), or bf1942 for the vanilla models/ itself "
                         "(--scratch is then <mesh root>/models)")
    ap.add_argument("--mod", help="install folder (XPack2); default: the id")
    ap.add_argument("--scratch", type=Path, required=True,
                    help="the scratch models dir: <mesh root>/models/mods/<id>")
    ap.add_argument("--refresh-own", action="store_true")
    ap.add_argument("--apply", action="store_true")
    args = ap.parse_args()

    vanilla = args.id in ("bf1942", "vanilla")
    tree = VIEWER / "models" if vanilla else VIEWER / "models" / "mods" / args.id
    scratch = args.scratch.expanduser().resolve()
    # <mesh root>/models[/mods/<id>] -> <mesh root>
    root = scratch.parent if vanilla else scratch.parents[2]
    own: set[str] | None = None
    if args.refresh_own:
        sys.path.insert(0, str(HERE))
        from extract_all import select_templates
        from extract_models import DEFAULT_GAME_DIR
        _entries, names, _skipped = select_templates(
            DEFAULT_GAME_DIR, args.mod or args.id, own_only=True)
        own = {n.lower() for n in names}
    result = merge(tree, scratch, VIEWER / "textures", root / "textures",
                   own_names=own, apply=args.apply)
    print(json.dumps(result, indent=1))
    return 1 if result["texturesNowhere"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
