# Refractor Flat Archive (.rfa) format

Battlefield 1942's asset archives. Reverse engineered against a retail v1.61 install and
cross-checked against the RFA reader in the BGA modding tool
(`github.com/yann-papouin/bga`, `src/RFALib.pas`), which is the authoritative open source
implementation.

All integers are little-endian unsigned 32-bit.

## Layout

```
[28 bytes: "Refractor2 FlatArchive 1.1  "]   <- demo archives only, absent in retail
u32  dataSize        offset of the entry table, relative to the end of the version header
u32  compressed      1 = segments are LZO1X compressed, 0 = stored
148 bytes            magic checksum written by winRFA, meaning unknown, safe to skip
...                  file payloads, back to back
u32  entryCount
entryCount x entry
```

An entry is variable length because the name is inline:

```
u32       nameLength
char[]    name          e.g. "bf1942/levels/Wake/Menu/thumbnail.dds"
u32       cSize         bytes occupied in the archive, including segment headers
u32       ucSize        decompressed size
u32       offset        absolute, from the end of the version header
u32 x 3                 unused
```

Names use either slash or backslash and their casing is inconsistent even within one
archive (`bf1942/levels/...` in a base archive, `Bf1942/Levels/...` in its patches).
Normalise before matching.

## Payload segmentation

When `compressed` is 1, the bytes at `offset` are not raw LZO. They are a segment table
followed by the segment data:

```
u32  segmentCount
segmentCount x { u32 cSize, u32 ucSize, u32 dataOffset }
...segment data, dataOffset is relative to the end of this table
```

Segments decompress to at most 32768 bytes. **Every segment is LZO, including one where
`cSize == ucSize`.** That is not a "stored verbatim" marker: LZO output is not bounded
below by its input (`animations/GrenadeAxis.ske` deflates 130 bytes up to 136), so a
break-even segment is an ordinary compressed stream. Across vanilla and nine mods, all 448
break-even segments inflate cleanly; none is raw, and reading them raw yields garbage
(`animations/GrenadeAllies.ske`, 247 == 247, is the canonical case). Always inflate first;
fall back to verbatim only for a break-even segment LZO rejects or that inflates to the
wrong length. When the sizes differ a failed inflate is real damage — let it raise.

The compression is **LZO1X** (`lzo1x_decompress_safe` from liblzo2, which BGA vendors as
minilzo). It is reachable from Python through ctypes with no bindings package:

```python
lzo = ctypes.CDLL("liblzo2.so.2")
lzo.lzo1x_decompress_safe(src, len(src), out_buf, ctypes.byref(out_len), None)
```

## Patch archives

Levels ship as `Wake.rfa` plus `Wake_000.rfa`, `Wake_003.rfa` and so on. The suffixed
archives are patch overlays from later game patches; a higher number is newer and
overrides the same path in the base archive. Sorting archives by filename happens to give
the correct application order, because `.` sorts before `_` in ASCII.

Patches are usually small and often contain no art, so for image extraction they rarely
matter — but a naive "first one wins" skip will pick the stale base version on the
handful of maps where a patch did replace the image.

## Mod content inheritance

`Mods/<mod>/init.con` declares the mod's search path:

```
game.setCustomGameName FHSW
game.addmodPath Mods/FHSW/
game.addModPath Mods/FH/
game.addModPath Mods/Bf1942/
```

The engine resolves a level by walking that list in order. Any tool that maps a running
server's map back to a file has to walk it too, or it will miss every map a mod inherits
rather than ships.

Directory casing on disk is not consistent either: `Archives/bf1942/levels`,
`Archives/BF1942/levels`, `archives/bf1942/levels` and `Archives/Bf1942/Levels` all occur
across the stock mods. Walk case-insensitively.

## DDS variants in the wild

BF1942 art is plain DX9-era DDS with a 128 byte header:

- `DXT1` — 8 bytes per 4x4 block, 1-bit alpha when `c0 <= c1`. Used for minimaps.
- `DXT3` — 16 bytes per block, 4-bit explicit alpha then a DXT1-style colour block. Used
  for menu thumbnails.
- `DXT5` — 16 bytes per block, interpolated alpha ramp then the colour block.
- Uncompressed RGB/RGBA, described by the pixel format masks.

Thumbnails are 4:3 artwork letterboxed into a power-of-two square (128x96 inside 128x128,
256x192 inside 256x256). The padding is black on most maps and white on a few, so crop by
aspect ratio rather than by sniffing for black rows.
