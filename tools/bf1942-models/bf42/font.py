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


@dataclass(frozen=True)
class HudGlyph:
    """One row of `Font/BF1942.font`: a raw character byte and the glyph's
    atlas rectangle, `(x0, y) - (x1, y + Height)` (`Height` is the font's,
    not stored per glyph)."""
    code: int
    x0: float
    y: float
    x1: float

    @property
    def width(self) -> float:
        """`x1 - x0 + 1`: `Font::loadFontFile` client 0x0065d1a0."""
        return self.x1 - self.x0 + 1


@dataclass
class HudFont:
    """`Font/BF1942.font`, the in-game HUD font (kill messages, chat, radio,
    server messages - everything outside the menu system, which uses `.dif`
    instead). `Font::loadFontFile` (client 0x0065d1a0, `Font` vtable
    0x00919098 +0x20) reads eight `key = value` header lines by position,
    never checking the key text, discards one line (a `-------` divider in
    both files this has been read against), then reads `%c %f %f %f` rows
    into a 256-entry table indexed by the raw character byte - so the text
    must stay undecoded (latin-1, one byte per glyph) for the codes to mean
    anything past ASCII.

    Only vanilla ships the file. The live copy (`Font.rfa`) is 256x256,
    `Height` 20, `BetweenWidth` 0, `SpaceWidth` 5; the original 2004 copy
    (`Font-Original.zip`'s own `Font.rfa`) is 128x128, 11, 1, 1 - a smaller
    face repacked into a smaller atlas, not just a resize.
    """
    texture: str
    texture_width: int
    texture_height: int
    between_width: int
    space_width: int
    height: int
    alpha_test: int
    alpha_blend: int
    glyphs: dict[int, HudGlyph] = field(default_factory=dict)

    def uv(self, code: int) -> tuple[float, float, float, float]:
        """`(u0, v0, u1, v1)`, normalised 0..1. `Font::buildQuads`
        (0x0065ce10) starts half a texel in so the sampler never bleeds into
        a neighbouring glyph, and spans the font's shared `Height`, not a
        per-glyph one."""
        g = self.glyphs[code]
        w, h = self.texture_width, self.texture_height
        u0, v0 = (g.x0 + 0.5) / w, (g.y + 0.5) / h
        return u0, v0, u0 + g.width / w, v0 + self.height / h

    def advance(self, code: int, scale: float = 1.0) -> float:
        """`Font::buildQuads`: `(width + BetweenWidth) * scale`, except a
        space draws nothing and advances `SpaceWidth * scale` instead - its
        atlas rectangle (typically `(0, 0)-(0, 0)`, a dummy) is never used."""
        if code == 0x20:
            return self.space_width * scale
        return (self.glyphs[code].width + self.between_width) * scale

    def measure(self, text: str, scale: float = 1.0) -> float:
        return sum(self.advance(ord(c), scale) for c in text if ord(c) in self.glyphs or c == " ")


def parse_hud_font(text: str) -> HudFont:
    lines = text.splitlines()
    if len(lines) < 9:
        raise ValueError("not a BF1942.font: fewer than 8 header lines plus the divider")

    def value(line: str) -> str:
        # "without checking their keys": the key half of `key = value` is
        # never inspected, only its position in the first eight lines.
        return line.partition("=")[2].strip()

    texture = value(lines[0])
    texture_width, texture_height, between_width, space_width, height, alpha_test, alpha_blend = (
        int(float(value(lines[i]))) for i in range(1, 8))
    # lines[8] is discarded unconditionally - a "-------" divider in both
    # files this has been read against, but nothing reads its content.
    font = HudFont(texture, texture_width, texture_height, between_width,
                   space_width, height, alpha_test, alpha_blend)
    for line in lines[9:]:
        if not line:
            continue
        code = ord(line[0])
        parts = line[1:].split()
        if len(parts) != 3:
            raise ValueError(f"bad glyph row: {line!r}")
        x0, y, x1 = (float(v) for v in parts)
        font.glyphs[code] = HudGlyph(code, x0, y, x1)
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
