"""The menu system's bitmap fonts: `Font/<face>.dif` + `Font/<face>.tga`.

A `.dif` is a tab-separated text file:

    header
    2                       format version
    <face name>
    <atlas width>
    <atlas height>
    <line height>
    glyphs
    <count>
    <code> <left> <width> <right> <ascent> <x0> <y0> <x1> <y1>   (one per glyph)

`left` / `right` are the side bearings and `width` the inked width, so the
pen advances `left + width + right` per glyph. `ascent` is the distance from
the glyph's top row to the baseline (a comma has 2, a dollar sign 9 in the
8 px face), so `top = baseline - ascent` places every glyph; the face's
baseline is the largest ascent any glyph has. `(x0, y0)-(x1, y1)` is the
glyph's rectangle in the atlas, whose `x1 - x0` equals `width`.

The atlas is an 8-bit greyscale TGA (image type 3) holding coverage only:
the engine draws the glyph in the current colour and uses the texel as
alpha. It is written out as white RGBA with that alpha so a canvas can tint
it with a composite operation.
"""

from __future__ import annotations

import json
import struct
from dataclasses import dataclass, field


@dataclass
class Glyph:
    code: int
    left: int
    width: int
    right: int
    ascent: int
    x0: int
    y0: int
    x1: int
    y1: int

    @property
    def advance(self) -> int:
        return self.left + self.width + self.right


@dataclass
class BitmapFont:
    face: str
    atlas_width: int
    atlas_height: int
    line_height: int
    glyphs: dict[int, Glyph] = field(default_factory=dict)

    @property
    def baseline(self) -> int:
        """Where the baseline sits below the line's top: the cap height.
        Accented capitals and the dollar sign reach a row or two above it,
        exactly as they overshoot the cap line in any typeface."""
        caps = [g.ascent for c, g in self.glyphs.items() if 48 <= c <= 90]
        return max(caps or [g.ascent for g in self.glyphs.values()] or [self.line_height])

    def measure(self, text: str) -> int:
        return sum(self.glyphs[ord(c)].advance for c in text if ord(c) in self.glyphs)

    def to_json(self) -> dict:
        """The glyph table the viewer draws from. Rows are the `.dif` columns
        after the code, unchanged, so the file documents itself against the
        source format."""
        return {
            "face": self.face,
            "atlas": [self.atlas_width, self.atlas_height],
            "lineHeight": self.line_height,
            "baseline": self.baseline,
            "columns": ["left", "width", "right", "ascent", "x0", "y0", "x1", "y1"],
            "glyphs": {
                str(code): [g.left, g.width, g.right, g.ascent, g.x0, g.y0, g.x1, g.y1]
                for code, g in sorted(self.glyphs.items())
            },
        }


def parse_dif(text: str) -> BitmapFont:
    lines = [line.rstrip("\r").rstrip("\t") for line in text.splitlines()]
    if not lines or lines[0].strip() != "header":
        raise ValueError("not a .dif font: missing `header`")
    version = lines[1].strip()
    if version != "2":
        raise ValueError(f"unsupported .dif version {version!r}")
    face = lines[2].strip()
    atlas_w, atlas_h, line_h = (int(lines[i].strip()) for i in (3, 4, 5))
    if lines[6].strip() != "glyphs":
        raise ValueError("not a .dif font: missing `glyphs`")
    count = int(lines[7].strip())
    font = BitmapFont(face, atlas_w, atlas_h, line_h)
    for line in lines[8:8 + count]:
        cols = [int(v) for v in line.split("\t") if v != ""]
        if len(cols) != 9:
            raise ValueError(f"bad glyph row: {line!r}")
        font.glyphs[cols[0]] = Glyph(*cols)
    return font


def decode_alpha_tga(data: bytes) -> tuple[int, int, bytes]:
    """An 8-bit greyscale TGA (type 3, or type 11 RLE) to white RGBA with the
    texel as alpha. Returns (width, height, rgba) top-down."""
    id_len, _cmap_type, image_type = data[0], data[1], data[2]
    width, height = struct.unpack_from("<HH", data, 12)
    depth, descriptor = data[16], data[17]
    if depth != 8 or image_type not in (3, 11):
        raise ValueError(f"expected an 8-bit greyscale TGA, got type {image_type} at {depth} bpp")
    pos = 18 + id_len
    n = width * height
    if image_type == 3:
        pixels = data[pos:pos + n]
    else:
        out = bytearray()
        while len(out) < n:
            packet = data[pos]
            pos += 1
            run = (packet & 0x7F) + 1
            if packet & 0x80:
                out += bytes([data[pos]]) * run
                pos += 1
            else:
                out += data[pos:pos + run]
                pos += run
        pixels = bytes(out[:n])
    rows = [pixels[y * width:(y + 1) * width] for y in range(height)]
    if not descriptor & 0x20:  # bottom-up storage
        rows.reverse()
    rgba = bytearray(n * 4)
    i = 0
    for row in rows:
        for a in row:
            rgba[i] = rgba[i + 1] = rgba[i + 2] = 255
            rgba[i + 3] = a
            i += 4
    return width, height, bytes(rgba)


def font_json(font: BitmapFont) -> str:
    return json.dumps(font.to_json(), separators=(",", ":")) + "\n"
