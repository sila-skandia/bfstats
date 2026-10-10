"""How a mesh material's TGA is read: rows in file order for RLE files.

`decode_tga` (scripts/extract_hud_assets.py) honours the origin bit, which is
right for the menu and HUD art. A 3D mesh's texture is a different loader's
business, and the shipped data says it does not honour the bit for RLE files
(image type 10): every one of the 100+ placements of Forgotten Hope's tank
sight pictures (`Panzer_reticule`, `T34-85_reticule`, `amer_reticule`,
`brit_reticule`, `88cm_reticule`) is a type 10 file with a bottom-left origin,
and every one of their discs is UV-mapped with `v` rising with the mesh's
height, which draws the picture upside down (range ticks above the ladders)
once the origin bit has been applied. The owner's retail capture of the KV-1's
gunner sight shows the picture upright: ticks below, arrowheads on top. So the
mesh loader hands the rows over as stored. Type 2 files stay as `decode_tga`
returns them (the muzzle and dust sprites, `Yak9_crosshair`, all mapped the
other way up, and read upright already).

That a type 10 file is the one the engine reads as stored is inferred from
which files the sight meshes use, not read in the loader; if a type 2 file
ever shows the same fault the rule widens here and nowhere else.
"""
from __future__ import annotations


def mesh_tga_rows_as_stored(raw: bytes) -> bool:
    """Does this TGA's mesh texture keep its rows in file order?"""
    return len(raw) > 17 and raw[2] == 10 and not raw[17] & 0x20


def mesh_tga_pixels(raw: bytes, width: int, height: int, rgba: bytes) -> bytes:
    """`decode_tga`'s top-down RGBA, put back in file order where the mesh
    loader reads it so (`mesh_tga_rows_as_stored`)."""
    if not mesh_tga_rows_as_stored(raw):
        return rgba
    row = width * 4
    return b"".join(rgba[y * row:(y + 1) * row] for y in range(height - 1, -1, -1))
