#!/usr/bin/env python3
"""The iPhone app's icon from the bfstats.io site logo (the header's sigil,
ui/src/assets/clippy_my_boi.webp), as tools/sidecar-desktop/scripts/make-icons.py
makes the desktop and Android ones.

The App Store takes one 1024 x 1024 opaque square and iOS rounds its corners
itself, so the logo sits on the site's dark ground (Neutral Depth #131313
with the panel's olive glow) instead of a transparent square. The logo is
only 256 x 248, so this is a smooth (Lanczos) upscale; a larger source would
make a sharper icon.

    python3 tools/sidecar-ios/scripts/make-icon.py
"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

HERE = Path(__file__).resolve().parent
APP = HERE.parent
REPO = APP.parent.parent
SRC = REPO / "ui" / "src" / "assets" / "clippy_my_boi.webp"
OUT = APP / "App" / "Assets.xcassets" / "AppIcon.appiconset" / "AppIcon-1024.png"

N = 1024
LOGO = 820  # the logo's longer side on the 1024 square


def main() -> None:
    ground = Image.new("RGB", (N, N), (0x13, 0x13, 0x13))
    # The panel's olive glow, top right, soft.
    glow = Image.new("L", (N, N), 0)
    ImageDraw.Draw(glow).ellipse((N * 0.35, -N * 0.45, N * 1.45, N * 0.65), fill=70)
    glow = glow.filter(ImageFilter.GaussianBlur(160))
    olive = Image.new("RGB", (N, N), (0x7D, 0x88, 0x49))
    ground = Image.composite(olive, ground, glow)

    logo = Image.open(SRC).convert("RGBA")
    k = LOGO / max(logo.size)
    logo = logo.resize((round(logo.size[0] * k), round(logo.size[1] * k)), Image.LANCZOS)
    canvas = ground.convert("RGBA")
    canvas.alpha_composite(logo, ((N - logo.size[0]) // 2, (N - logo.size[1]) // 2))
    OUT.parent.mkdir(parents=True, exist_ok=True)
    canvas.convert("RGB").save(OUT, optimize=True)
    print(f"wrote {OUT.relative_to(REPO)}")


if __name__ == "__main__":
    main()
