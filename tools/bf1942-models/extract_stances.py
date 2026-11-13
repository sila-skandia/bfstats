#!/usr/bin/env python3
"""Write `poses/stances.json`: every soldier's skeleton in each stance.

    python3 extract_stances.py viewer/models                  # the vanilla tree
    python3 extract_stances.py viewer/models/mods/xpack1
    python3 extract_stances.py <tree> --glbs viewer/glbs --out <file>

The room server and the headless runner hang a soldier's hit capsules on it
and aim the bots at its bones (`server/soldier-capsules.mjs`), so they meet
the body the page draws without loading a glb. Reads only what the tree
already holds: `poses/index.json`, one pose a soldier (a recipe and its rig,
or a single-file pose glb), and the content store for a file the tree has
moved there. Run after the pose steps (`mod_pipeline.py` `poses_stances`).
The format is `bf42/stance.py`'s docstring.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from bf42 import stance


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n", 1)[0])
    ap.add_argument("models", type=Path, help="a models tree (the folder holding poses/)")
    ap.add_argument("--glbs", type=Path, default=None,
                    help="the content store (default: the viewer's glbs/ beside the vanilla models tree)")
    ap.add_argument("--out", type=Path, default=None, help="where to write (default <models>/poses/stances.json)")
    args = ap.parse_args()
    poses = args.models / "poses"
    if not poses.is_dir():
        ap.error(f"no poses tree: {poses}")
    glbs = args.glbs
    if glbs is None:
        tree = args.models.resolve()
        root = tree.parents[2] if tree.parent.name == "mods" else tree.parent
        glbs = root / "glbs"
    doc = stance.write(poses, glbs if glbs.is_dir() else None, args.out,
                       log=lambda line: print(line, file=sys.stderr))
    print(f"{args.out or poses / 'stances.json'}: {len(doc['soldiers'])} soldiers, "
          f"{len(doc['bodies'])} bodies", file=sys.stderr)
    return 0 if doc["soldiers"] else 1


if __name__ == "__main__":
    sys.exit(main())
