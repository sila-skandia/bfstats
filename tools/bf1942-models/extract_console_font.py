#!/usr/bin/env python3
"""Extract `Font/BF1942.font` -- the face the in-game console draws with.

The console is drawn by the object at `Setup+0x2d8`: `FUN_00460e40`
(client 0x00460e40) creates its text object at `+0x08` and loads
`"font/BF1942.font"` into it, and `FUN_00464ee0` (0x00464ee0, the console
drawer) draws every line through that same `+0x08`.  So the console's face is
the HUD's bitmap font, not one of the menu system's `.dif` faces.

`Font.rfa` ships the pair `Font/BF1942.font` (the glyph table, read by
`bf42.font.parse_hud_font`) and `Font/BF1942.tga` (an 8-bit alpha atlas).  This
writes them out as the same `<face>.png` + `<face>.json` pair the spawn-screen
fonts already use, so `viewer/console.js` can draw from the game's own glyphs.

    python3 extract_console_font.py                    # -> viewer/fonts/
    python3 extract_console_font.py --out /tmp/probe   # anywhere else
    python3 extract_console_font.py --mod FHSW         # a mod's own face

The installed vanilla `Font.rfa` is a 2012 double-size replacement (256x256,
Height 20); the untouched 2004 file is kept beside it in
`Mods/bf1942/Archives/Font-Original.zip` (128x128, Height 11).  `--original`
reads that instead.  The user's reference capture was taken on the installed
copy, so the default is the installed one.

`--mod` resolves `Font.rfa` along the mod's `game.addModPath` chain, nearest
child first.  Five of the 18 installed mods ship one (FHSW, FinnWars, GCMOD,
bfheroes and vanilla); the other thirteen -- Eve of Destruction, Road to Rome
and Secret Weapons among them -- inherit vanilla's whole, and a one-deep
chain writes exactly the bytes this has always written.  A mod's own copy
lands in that mod's pack (`maps/mods/<id>/_shared/hud/console/`), which is
the half of the viewer tree a deploy can replace without an image build;
vanilla's stays at `viewer/fonts/`, where `map.html` already looks.
`--original` stays vanilla-only: it is a note about one shipped file.
"""
from __future__ import annotations

import argparse
import json
import sys
import tempfile
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from bf42.font import decode_alpha_tga, parse_hud_font  # noqa: E402
from bf42.modmenu import MenuSources  # noqa: E402
from bf42.rfa import RfaArchive  # noqa: E402
from extract_map_images import encode_png  # noqa: E402
from extract_models import mod_chain  # noqa: E402

DEFAULT_GAME_DIR = Path("~/.wine/drive_c/EA Games/Battlefield 1942").expanduser()
VIEWER_DIR = Path(__file__).resolve().parent / "viewer"
VIEWER_FONT_DIR = VIEWER_DIR / "fonts"
FACE_ID = "bf1942"


def console_dir_for(mod_id: str) -> Path:
    """Where a mod's console face lands. Vanilla keeps the path the viewer
    has always fetched; a mod's goes inside its own uploadable level tree."""
    if mod_id == "bf1942":
        return VIEWER_FONT_DIR
    return VIEWER_DIR / "maps" / "mods" / mod_id / "_shared" / "hud" / "console"


def hud_font_json(font) -> str:
    """The glyph table in the shape `viewer/console.js` reads.

    One row per glyph, `[x0, y, x1, width]`, straight out of the `.font` file's
    own `%c %f %f %f` columns plus the width `Font::loadFontFile`
    (client 0x0065d1a0) derives as `x1 - x0 + 1`.  `height`, `betweenWidth` and
    `spaceWidth` are the file's header fields; `Font::buildQuads` (0x0065ce10)
    advances by `width + betweenWidth`, except a space, which draws nothing and
    advances `spaceWidth`.
    """
    return json.dumps({
        "face": FACE_ID,
        "source": font.texture,
        "atlas": [font.texture_width, font.texture_height],
        "height": font.height,
        "betweenWidth": font.between_width,
        "spaceWidth": font.space_width,
        "columns": ["x0", "y", "x1", "width"],
        "glyphs": {str(code): [g.x0, g.y, g.x1, g.width]
                   for code, g in sorted(font.glyphs.items())},
    }, separators=(",", ":")) + "\n"


def open_font_rfa(game_dir: Path, original: bool, sources: MenuSources | None = None):
    """Yields (archive, cleanup). `Font-Original.zip` holds a whole
    `Font.rfa`, so it is unzipped to a temp path first.

    Without `sources` this is vanilla's single `Font.rfa`, unchanged. With
    one it is the mod's layered font chain, which for a mod that ships no
    `Font.rfa` of its own is vanilla's single archive again."""
    archives = game_dir / "Mods" / "bf1942" / "Archives"
    if original:
        zip_path = archives / "Font-Original.zip"
        if not zip_path.exists():
            raise SystemExit(f"no {zip_path}")
        tmp = tempfile.TemporaryDirectory()
        rfa = Path(tmp.name) / "Font-Original.rfa"
        with zipfile.ZipFile(zip_path) as z:
            rfa.write_bytes(z.read("Font.rfa"))
        return RfaArchive(rfa), tmp.cleanup
    if sources is not None:
        return sources.open_font(), lambda: None
    rfa = archives / "Font.rfa"
    if not rfa.exists():
        raise SystemExit(f"no {rfa}")
    return RfaArchive(rfa), lambda: None


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n", 1)[0])
    ap.add_argument("--game-dir", type=Path, default=DEFAULT_GAME_DIR)
    ap.add_argument("--mod", default="bf1942",
                    help="mod whose Font.rfa chain to read (default: bf1942)")
    ap.add_argument("--out", type=Path, default=None,
                    help=f"output directory (default: {VIEWER_FONT_DIR} for "
                         "vanilla, the mod's own console/ dir otherwise)")
    ap.add_argument("--original", action="store_true",
                    help="read the 2004 Font-Original.zip instead of the installed Font.rfa")
    args = ap.parse_args()

    game_dir = args.game_dir.expanduser()
    sources = (None if args.mod.lower() == "bf1942"
               else MenuSources(mod_chain(game_dir, args.mod)))
    mod_id = "bf1942" if sources is None else sources.mod_id
    out = args.out or console_dir_for(mod_id)
    arch, cleanup = open_font_rfa(game_dir, args.original, sources)
    try:
        with arch:
            index = {e.lower(): e for e in arch.entries}
            font_entry = index.get("font/bf1942.font")
            if not font_entry:
                raise SystemExit("Font/BF1942.font not in the archive")
            font = parse_hud_font(arch.read(font_entry).decode("latin-1"))
            # The header's Texture field names the atlas; fall back to the
            # sibling .tga, which is what every shipped copy actually uses.
            tga_entry = (index.get(font.texture.lower().replace("\\", "/"))
                         or index.get("font/bf1942.tga"))
            if not tga_entry:
                raise SystemExit(f"atlas {font.texture!r} not in the archive")
            width, height, rgba = decode_alpha_tga(arch.read(tga_entry))
    finally:
        cleanup()

    out.mkdir(parents=True, exist_ok=True)
    (out / f"{FACE_ID}.png").write_bytes(
        encode_png(width, height, rgba, drop_alpha=False))
    (out / f"{FACE_ID}.json").write_text(hud_font_json(font))
    print(f"{FACE_ID}: {len(font.glyphs)} glyphs, atlas {width}x{height}, "
          f"height {font.height}, between {font.between_width}, "
          f"space {font.space_width} -> {out}")


if __name__ == "__main__":
    main()
