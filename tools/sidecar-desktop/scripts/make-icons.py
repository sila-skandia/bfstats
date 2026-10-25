#!/usr/bin/env python3
"""Build the app's icons from the bfstats.io site logo (the header's sigil,
ui/src/assets/clippy_my_boi.webp), so the app reads as part of the site.

The logo is a 256 x 248 painted image: it is centred on a transparent square
and every size is a smooth (Lanczos) resample of that. Writes
assets/icons/<n>x<n>.png (the layout electron-builder takes for Linux) and
assets/icons/icon.ico for Windows, and beside them assets/icon.png (512),
assets/tray.png (32) and assets/tray@2x.png (64), and the tray's status
variants tray-<state>.png / tray-<state>@2x.png: the same icon with a dot in
its lower right corner (green in game, orange joining).

    python3 scripts/make-icons.py
"""
from pathlib import Path

from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parent
APP = HERE.parent
REPO = APP.parent.parent
SRC = REPO / "ui" / "src" / "assets" / "clippy_my_boi.webp"
OUT = APP / "assets" / "icons"

SIZES = [16, 32, 48, 64, 128, 256, 512]


def scaled(base: Image.Image, size: int) -> Image.Image:
    return base.resize((size, size), Image.LANCZOS)


def squared(img: Image.Image) -> Image.Image:
    """The logo centred on a transparent square of its longer side."""
    n = max(img.size)
    out = Image.new("RGBA", (n, n), (0, 0, 0, 0))
    out.alpha_composite(img, ((n - img.size[0]) // 2, (n - img.size[1]) // 2))
    return out


# The tray's status dots: (fill, ring) per state. The dark ring keeps the
# dot readable on a light panel and on the icon itself.
DOTS = {
    "joined": ((46, 204, 64, 255), (12, 40, 16, 255)),
    "joining": ((255, 149, 0, 255), (60, 32, 0, 255)),
}


def with_dot(icon: Image.Image, fill, ring) -> Image.Image:
    """The icon with a ringed dot in its lower right, drawn 4x and scaled down
    so its edge is smooth while the pixel-art icon underneath stays sharp."""
    n = icon.size[0]
    k = 4
    layer = Image.new("RGBA", (n * k, n * k), (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    d = n * k * 0.5            # dot diameter, ring included
    x1 = y1 = n * k - 1
    x0 = y0 = x1 - d
    draw.ellipse((x0, y0, x1, y1), fill=ring)
    inset = d * 0.16
    draw.ellipse((x0 + inset, y0 + inset, x1 - inset, y1 - inset), fill=fill)
    out = icon.copy()
    out.alpha_composite(layer.resize((n, n), Image.LANCZOS))
    return out


def main() -> None:
    base = squared(Image.open(SRC).convert("RGBA"))
    OUT.mkdir(parents=True, exist_ok=True)
    for n in SIZES:
        scaled(base, n).save(OUT / f"{n}x{n}.png")
    # Beside the size folder, not in it: electron-builder reads every png in
    # assets/icons as a size of the Linux icon.
    scaled(base, 512).save(OUT.parent / "icon.png")
    scaled(base, 32).save(OUT.parent / "tray.png")
    scaled(base, 64).save(OUT.parent / "tray@2x.png")
    for state, (fill, ring) in DOTS.items():
        with_dot(scaled(base, 32), fill, ring).save(OUT.parent / f"tray-{state}.png")
        with_dot(scaled(base, 64), fill, ring).save(OUT.parent / f"tray-{state}@2x.png")
    ico_sizes = [16, 32, 48, 64, 128, 256]
    scaled(base, 256).save(OUT / "icon.ico", sizes=[(n, n) for n in ico_sizes])
    print(f"wrote {len(SIZES) + 4 + 2 * len(DOTS)} icons to {OUT}")


if __name__ == "__main__":
    main()
