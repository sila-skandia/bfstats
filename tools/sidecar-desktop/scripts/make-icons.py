#!/usr/bin/env python3
"""Build the app's icons from the site's favicon (ui/public/favicon.ico).

The favicon is a 16 x 16 pixel-art image, so every size is a whole-number
nearest-neighbour scale of it: the pixels stay square and sharp. Writes
assets/icons/<n>x<n>.png (the layout electron-builder takes for Linux) and
assets/icons/icon.ico for Windows, and beside them assets/icon.png (512),
assets/tray.png (32) and assets/tray@2x.png (64).

    python3 scripts/make-icons.py
"""
from pathlib import Path

from PIL import Image

HERE = Path(__file__).resolve().parent
APP = HERE.parent
REPO = APP.parent.parent
SRC = REPO / "ui" / "public" / "favicon.ico"
OUT = APP / "assets" / "icons"

SIZES = [16, 32, 48, 64, 128, 256, 512]


def scaled(base: Image.Image, size: int) -> Image.Image:
    return base.resize((size, size), Image.NEAREST)


def main() -> None:
    base = Image.open(SRC).convert("RGBA")
    if base.size != (16, 16):
        base = base.resize((16, 16), Image.NEAREST)
    OUT.mkdir(parents=True, exist_ok=True)
    for n in SIZES:
        scaled(base, n).save(OUT / f"{n}x{n}.png")
    # Beside the size folder, not in it: electron-builder reads every png in
    # assets/icons as a size of the Linux icon.
    scaled(base, 512).save(OUT.parent / "icon.png")
    scaled(base, 32).save(OUT.parent / "tray.png")
    scaled(base, 64).save(OUT.parent / "tray@2x.png")
    ico_sizes = [16, 32, 48, 64, 128, 256]
    scaled(base, 256).save(OUT / "icon.ico", sizes=[(n, n) for n in ico_sizes])
    print(f"wrote {len(SIZES) + 4} icons to {OUT}")


if __name__ == "__main__":
    main()
