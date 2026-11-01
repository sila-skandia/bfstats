#!/usr/bin/env python3
"""Build the stats site's loading-screen backdrops from the map viewer's level exports.

Every exported level in the viewer trees has a maps.json row whose `loading.background`
names its loading screen (its own <level>/load.webp, or the mod's shared screen for that
theatre). This writes one small copy per level into the stats assets tree:

    <out>/<mod>/<level>.load.webp      640px wide, letterbox bars trimmed, lightly blurred

The site shows it dimmed behind a page header, so it is shrunk hard: the full 800x600
screen is 25-115 KB, this is roughly 5-15 KB. The API finds these files on disk along each mod's
search path (api/ImageStorage/MapImageResolver.cs, MapImageKind.Loading); manifest.json is
not touched.

Only exported levels are covered (rows of each tree's maps.json), never the whole install.

    python3 scripts/build_map_loading_art.py \
        --viewer-maps tools/bf1942-models/viewer/maps --out tournament-images/maps
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from PIL import Image, ImageFilter

WIDTH = 640
QUALITY = 50
BLUR = 1.5

# Viewer tree folder -> stats assets mod folder. FHSWEurope's levels belong to FHSW on the
# stats side (bflist reports them as fhsw), so they fill in only where FHSW has none.
TREE_TO_MOD = {"fhsweurope": "fhsw"}


def trees(viewer_maps: Path):
    """Yield (mod, tree root) with the vanilla tree first and FHSWEurope after FHSW."""
    yield "bf1942", viewer_maps
    mods = viewer_maps / "mods"
    names = sorted(p.name for p in mods.iterdir() if (p / "maps.json").is_file()) if mods.is_dir() else []
    names.sort(key=lambda n: n in TREE_TO_MOD)
    for name in names:
        yield name, mods / name


def trim_letterbox(img: Image.Image) -> Image.Image:
    """Drop the black bars stock 800x600 screens pad their 16:9 art with."""
    grey = img.convert("L")
    w, h = grey.size

    def dark(y: int) -> bool:
        return grey.crop((0, y, w, y + 1)).getextrema()[1] < 24

    top = 0
    while top < h // 3 and dark(top):
        top += 1
    bottom = h
    while bottom > h - h // 3 and dark(bottom - 1):
        bottom -= 1
    if top + (h - bottom) < h * 0.04:
        return img
    return img.crop((0, top, w, bottom))


def shrink(src: Path, dst: Path) -> int:
    img = Image.open(src).convert("RGB")
    img = trim_letterbox(img)
    if img.width > WIDTH:
        img = img.resize((WIDTH, round(img.height * WIDTH / img.width)), Image.LANCZOS)
    # It only ever sits dimmed behind text: a light blur halves the bytes and keeps titles
    # some mods paint into the art from competing with the page heading.
    img = img.filter(ImageFilter.GaussianBlur(BLUR))
    dst.parent.mkdir(parents=True, exist_ok=True)
    img.save(dst, "WEBP", quality=QUALITY, method=6)
    return dst.stat().st_size


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--viewer-maps", type=Path, required=True, help="tools/bf1942-models/viewer/maps")
    ap.add_argument("--out", type=Path, required=True, help="the stats assets maps folder")
    ap.add_argument("--force", action="store_true", help="rebuild files that already exist")
    args = ap.parse_args()

    written = skipped = missing = total_bytes = 0
    seen: set[tuple[str, str]] = set()
    roots = [root for _, root in trees(args.viewer_maps)]

    def source(root: Path, background: str) -> Path | None:
        # FHSW and FHSWEurope share _shared screens, and a local tree can lack a copy the
        # other holds; take the same path from a sibling tree before giving up.
        for candidate in [root, *roots]:
            if (candidate / background).is_file():
                return candidate / background
        return None

    for tree, root in trees(args.viewer_maps):
        mod = TREE_TO_MOD.get(tree, tree)
        rows = json.loads((root / "maps.json").read_text())
        for row in rows:
            background = (row.get("loading") or {}).get("background")
            if not background:
                continue
            level = Path(row["glb"]).parent.name.lower()
            if (mod, level) in seen:
                continue
            seen.add((mod, level))
            src = source(root, background)
            if src is None:
                missing += 1
                print(f"missing {tree}/{background}", file=sys.stderr)
                continue
            dst = args.out / mod / f"{level}.load.webp"
            if dst.exists() and not args.force:
                skipped += 1
                continue
            total_bytes += shrink(src, dst)
            written += 1

    print(f"wrote {written} ({total_bytes / 1024:.0f} KB), kept {skipped}, missing source {missing}")
    # A level whose screen is missing from its tree just gets no backdrop; the page copes.
    return 0


if __name__ == "__main__":
    sys.exit(main())
