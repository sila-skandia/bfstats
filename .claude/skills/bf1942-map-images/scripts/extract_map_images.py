#!/usr/bin/env python3
"""Extract per-map preview images from a Battlefield 1942 installation.

Walks every mod under <install>/Mods, opens each level archive (.rfa), pulls out
the map's `Menu/thumbnail.dds` (and optionally `Textures/InGameMap.dds`), and writes
them as PNGs laid out as <gameId>/<mapName>.png so they can be looked up directly
from a bflist server record.

Nothing outside the standard library is required: RFA segments are LZO1X, decoded
through the system liblzo2, and DDS/PNG are handled here.

    python3 extract_map_images.py --game-dir "~/.wine/drive_c/EA Games/Battlefield 1942" \
        --out ./maps --minimaps
"""

from __future__ import annotations

import argparse
import ctypes
import ctypes.util
import datetime
import json
import os
import re
import struct
import sys
import zlib
from pathlib import Path

# --------------------------------------------------------------------------- #
# LZO1X
# --------------------------------------------------------------------------- #

def _load_lzo():
    for name in ("liblzo2.so.2", "liblzo2.so", ctypes.util.find_library("lzo2")):
        if not name:
            continue
        try:
            return ctypes.CDLL(name)
        except OSError:
            continue
    sys.exit("liblzo2 not found — install it (Arch: `pacman -S lzo`, Debian: `apt install liblzo2-2`)")


_LZO = _load_lzo()
_LZO.lzo1x_decompress_safe.argtypes = [
    ctypes.c_char_p, ctypes.c_size_t, ctypes.c_char_p,
    ctypes.POINTER(ctypes.c_size_t), ctypes.c_void_p,
]


def lzo_decompress(src: bytes, dst_len: int) -> bytes:
    if dst_len == 0:
        return b""
    out = ctypes.create_string_buffer(dst_len)
    out_len = ctypes.c_size_t(dst_len)
    rc = _LZO.lzo1x_decompress_safe(src, len(src), out, ctypes.byref(out_len), None)
    if rc != 0:
        raise ValueError(f"lzo1x_decompress_safe returned {rc}")
    return out.raw[:out_len.value]


# --------------------------------------------------------------------------- #
# RFA — Refractor Flat Archive
# --------------------------------------------------------------------------- #
#
# [28 bytes "Refractor2 FlatArchive 1.1  "]   (demo archives only)
# u32 dataSize | u32 compressed | 148 bytes checksum | file payloads...
# u32 entryCount | entryCount x { u32 nameLen, name, u32 cSize, u32 ucSize, u32 offset, 12 pad }
#
# A compressed payload is u32 segmentCount, then that many
# { u32 cSize, u32 ucSize, u32 offset } headers, then the LZO1X segment data.

_VERSION_HEADER = b"Refractor2 FlatArchive 1.1  "


class RfaArchive:
    def __init__(self, path: Path):
        self.path = path
        self._fh = open(path, "rb")
        self._base = 28 if self._fh.read(28) == _VERSION_HEADER else 0
        self._fh.seek(self._base)
        self.data_size, self.compressed = struct.unpack("<II", self._fh.read(8))
        self.entries: dict[str, tuple[int, int, int]] = {}
        self._read_index()

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.close()

    def close(self):
        self._fh.close()

    def _read_index(self):
        self._fh.seek(self._base + self.data_size)
        (count,) = struct.unpack("<I", self._fh.read(4))
        for _ in range(count):
            (name_len,) = struct.unpack("<I", self._fh.read(4))
            if name_len > 255:
                raise ValueError(f"implausible entry name length {name_len}")
            name = self._fh.read(name_len).decode("latin-1").replace("\\", "/")
            c_size, uc_size, offset = struct.unpack("<III", self._fh.read(12))
            self._fh.read(12)  # three unused dwords
            self.entries[name] = (c_size, uc_size, offset)

    def read(self, name: str) -> bytes:
        c_size, uc_size, offset = self.entries[name]
        if uc_size == 0:
            return b""
        self._fh.seek(self._base + offset)
        if not self.compressed:
            return self._fh.read(uc_size)

        blob = self._fh.read(c_size)
        (segments,) = struct.unpack_from("<I", blob, 0)
        data_start = 4 + segments * 12
        out = bytearray()
        for i in range(segments):
            seg_c, seg_uc, seg_off = struct.unpack_from("<III", blob, 4 + i * 12)
            chunk = blob[data_start + seg_off: data_start + seg_off + seg_c]
            out += _inflate_segment(chunk, seg_c, seg_uc)
        return bytes(out)


def _inflate_segment(chunk: bytes, seg_c: int, seg_uc: int) -> bytes:
    """One segment's payload: LZO first, verbatim only as a break-even fallback.

    `seg_c == seg_uc` does NOT mean "stored verbatim". LZO output is not bounded
    below by its input (`animations/GrenadeAxis.ske` deflates 130 bytes up to
    136), so a break-even stream is an ordinary compressed one. Across vanilla
    and nine mods all 448 such segments are genuine LZO; read raw they come
    back as garbage (`animations/GrenadeAllies.ske`, 247 == 247, was one).

    Verbatim is kept only for a break-even segment LZO rejects. When the sizes
    differ it is arithmetically impossible, so a failed inflate there is real
    archive damage and raises. A short inflate counts as a failed one —
    `lzo1x_decompress_safe` can return a truncated buffer for a non-LZO stream.
    """
    if seg_c != seg_uc:
        out = lzo_decompress(chunk, seg_uc)
        if len(out) != seg_uc:
            raise ValueError(f"segment inflated to {len(out)} bytes, header says {seg_uc}")
        return out
    try:
        out = lzo_decompress(chunk, seg_uc)
    except ValueError:
        return chunk
    return out if len(out) == seg_uc else chunk


# --------------------------------------------------------------------------- #
# DDS -> RGBA
# --------------------------------------------------------------------------- #

def _rgb565(value: int) -> tuple[int, int, int]:
    return ((value >> 11 & 0x1F) * 255 // 31,
            (value >> 5 & 0x3F) * 255 // 63,
            (value & 0x1F) * 255 // 31)


def _color_palette(data: bytes, offset: int, punchthrough: bool):
    """The 8-byte colour half of a DXT block: two RGB565 endpoints + 2-bit indices."""
    c0, c1 = struct.unpack_from("<HH", data, offset)
    a, b = _rgb565(c0), _rgb565(c1)
    if c0 > c1 or not punchthrough:
        palette = [a, b,
                   tuple((2 * x + y) // 3 for x, y in zip(a, b)),
                   tuple((x + 2 * y) // 3 for x, y in zip(a, b))]
        alpha = (255, 255, 255, 255)
    else:
        palette = [a, b, tuple((x + y) // 2 for x, y in zip(a, b)), (0, 0, 0)]
        alpha = (255, 255, 255, 0)
    (indices,) = struct.unpack_from("<I", data, offset + 4)
    return palette, alpha, indices


def decode_dds(data: bytes) -> tuple[int, int, bytes]:
    """Return (width, height, RGBA bytes) for the DDS variants BF1942 ships."""
    if data[:4] != b"DDS ":
        raise ValueError("not a DDS file")
    height, width = struct.unpack_from("<II", data, 12)
    pf_flags, fourcc, rgb_bits = struct.unpack_from("<I4sI", data, 80)
    masks = struct.unpack_from("<4I", data, 92)
    body = 128
    pixels = bytearray(width * height * 4)

    if pf_flags & 0x4:  # block compressed
        if fourcc not in (b"DXT1", b"DXT3", b"DXT5"):
            raise ValueError(f"unsupported FourCC {fourcc!r}")
        stride = 8 if fourcc == b"DXT1" else 16
        offset = body
        for block_y in range(0, height, 4):
            for block_x in range(0, width, 4):
                if fourcc == b"DXT1":
                    palette, block_alpha, indices = _color_palette(data, offset, True)
                    alpha_at = lambda px, py, idx: block_alpha[idx]
                elif fourcc == b"DXT3":
                    alpha_bits = int.from_bytes(data[offset:offset + 8], "little")
                    palette, _, indices = _color_palette(data, offset + 8, False)
                    alpha_at = lambda px, py, idx, bits=alpha_bits: \
                        ((bits >> (4 * (py * 4 + px))) & 0xF) * 17
                else:  # DXT5
                    a0, a1 = data[offset], data[offset + 1]
                    alpha_bits = int.from_bytes(data[offset + 2:offset + 8], "little")
                    if a0 > a1:
                        ramp = [a0, a1] + [((7 - n) * a0 + n * a1) // 7 for n in range(1, 7)]
                    else:
                        ramp = [a0, a1] + [((5 - n) * a0 + n * a1) // 5 for n in range(1, 5)] + [0, 255]
                    palette, _, indices = _color_palette(data, offset + 8, False)
                    alpha_at = lambda px, py, idx, bits=alpha_bits, r=ramp: \
                        r[(bits >> (3 * (py * 4 + px))) & 0x7]

                for py in range(4):
                    y = block_y + py
                    if y >= height:
                        break
                    for px in range(4):
                        x = block_x + px
                        if x >= width:
                            break
                        idx = (indices >> (2 * (py * 4 + px))) & 0x3
                        r, g, b = palette[idx]
                        n = (y * width + x) * 4
                        pixels[n:n + 4] = bytes((r, g, b, alpha_at(px, py, idx)))
                offset += stride

    elif pf_flags & 0x40:  # uncompressed RGB/RGBA
        bpp = rgb_bits // 8
        channels = []
        for mask in masks:
            if mask:
                shift = (mask & -mask).bit_length() - 1
                channels.append((shift, bin(mask >> shift).count("1")))
            else:
                channels.append(None)
        for n in range(width * height):
            value = int.from_bytes(data[body + n * bpp: body + (n + 1) * bpp], "little")
            out = []
            for channel in channels:
                if channel is None:
                    out.append(255)
                else:
                    shift, bits = channel
                    out.append(((value >> shift) & ((1 << bits) - 1)) * 255 // ((1 << bits) - 1))
            pixels[n * 4:n * 4 + 4] = bytes(out)
    else:
        raise ValueError("unsupported DDS pixel format")

    return width, height, bytes(pixels)


def crop_to_4_3(width: int, height: int, rgba: bytes) -> tuple[int, int, bytes]:
    """Trim the padding off a menu thumbnail.

    Thumbnails are 4:3 artwork letterboxed into a power-of-two square texture
    (128x96 art in a 128x128 DDS), which is how the game displays them. The dead
    bottom quarter is usually black but some mods pad with white, so the crop is
    driven by the aspect ratio rather than by sniffing the pixels.
    """
    if width != height:
        return width, height, rgba
    new_h = height * 3 // 4
    return width, new_h, rgba[:width * new_h * 4]


def downscale(width: int, height: int, rgba: bytes, target: int) -> tuple[int, int, bytes]:
    """Box-filter down to `target` on the long edge. No-op if already smaller."""
    if max(width, height) <= target:
        return width, height, rgba
    factor = max(width, height) // target
    if factor < 2:
        return width, height, rgba
    new_w, new_h = width // factor, height // factor
    out = bytearray(new_w * new_h * 4)
    area = factor * factor
    for y in range(new_h):
        for x in range(new_w):
            totals = [0, 0, 0, 0]
            for sy in range(y * factor, y * factor + factor):
                row = sy * width
                for sx in range(x * factor, x * factor + factor):
                    n = (row + sx) * 4
                    totals[0] += rgba[n]
                    totals[1] += rgba[n + 1]
                    totals[2] += rgba[n + 2]
                    totals[3] += rgba[n + 3]
            n = (y * new_w + x) * 4
            out[n:n + 4] = bytes(t // area for t in totals)
    return new_w, new_h, bytes(out)


def encode_png(width: int, height: int, rgba: bytes, drop_alpha: bool = True) -> bytes:
    """Map previews are fully opaque, so default to 24-bit to keep files small."""
    if drop_alpha:
        raw = bytearray(width * height * 3)
        for n in range(width * height):
            raw[n * 3:n * 3 + 3] = rgba[n * 4:n * 4 + 3]
        raw, components, color_type = bytes(raw), 3, 2
    else:
        raw, components, color_type = rgba, 4, 6

    row_bytes = width * components
    scanlines = b"".join(b"\x00" + raw[y * row_bytes:(y + 1) * row_bytes] for y in range(height))

    def chunk(tag: bytes, payload: bytes) -> bytes:
        return (struct.pack(">I", len(payload)) + tag + payload
                + struct.pack(">I", zlib.crc32(tag + payload) & 0xFFFFFFFF))

    return (b"\x89PNG\r\n\x1a\n"
            + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, color_type, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(scanlines, 9))
            + chunk(b"IEND", b""))


# --------------------------------------------------------------------------- #
# Extraction
# --------------------------------------------------------------------------- #

# Suffix inside the archive -> output filename suffix.
WANTED = {
    "/menu/thumbnail.dds": "",          # 128x128 in-game map preview
    "/textures/ingamemap.dds": ".map",  # 512x512 minimap
}


def level_key(entry_name: str) -> str | None:
    """`Bf1942/Levels/Battle_of_the_Bulge/Menu/thumbnail.dds` -> `battle_of_the_bulge`.

    bflist reports mapName as the level directory with underscores turned into
    spaces and the case flattened, so the reverse is a stable lookup key.
    """
    parts = entry_name.lower().split("/")
    if "levels" not in parts:
        return None
    idx = parts.index("levels")
    if idx + 1 >= len(parts):
        return None
    return parts[idx + 1]


_MOD_PATH_RE = re.compile(r"^\s*game\.addModPath\s+Mods[/\\]([^/\\\s]+)", re.IGNORECASE | re.MULTILINE)


def mod_search_path(mod_dir: Path) -> list[str]:
    """Read the mod's own fallback chain out of its init.con.

    A mod declares where the engine looks for content it does not ship itself:

        game.addModPath Mods/FHSW/
        game.addModPath Mods/FH/
        game.addModPath Mods/Bf1942/

    A server running FHSW can therefore report a map that only exists in FH or in
    the base game, so image lookup has to walk the same chain.
    """
    for candidate in mod_dir.iterdir():
        if candidate.name.lower() == "init.con" and candidate.is_file():
            text = candidate.read_text(encoding="latin-1", errors="replace")
            chain = [m.lower() for m in _MOD_PATH_RE.findall(text)]
            # Dedupe, keep declaration order, and make sure the mod itself leads.
            ordered = list(dict.fromkeys([mod_dir.name.lower(), *chain]))
            return ordered
    return [mod_dir.name.lower()]


def find_level_archives(mod_dir: Path) -> list[Path]:
    archives = []
    for dirpath, _, filenames in os.walk(mod_dir):
        if Path(dirpath).name.lower() != "levels":
            continue
        archives += [Path(dirpath) / f for f in filenames if f.lower().endswith(".rfa")]
    # Patch archives (Wake_003.rfa) override the base archive, so process them last.
    return sorted(archives, key=lambda p: (p.name.lower(), len(p.name)))


def extract_mod(mod_dir: Path, out_root: Path, want_minimaps: bool, force: bool,
                minimap_size: int = 0, crop: bool = True) -> dict:
    game_id = mod_dir.name.lower()
    out_dir = out_root / game_id
    stats: dict = {"maps": {}, "written": 0, "skipped": 0, "failed": []}
    written_this_run: set[Path] = set()

    for archive_path in find_level_archives(mod_dir):
        try:
            archive = RfaArchive(archive_path)
        except Exception as exc:
            stats["failed"].append(f"{archive_path.name}: open failed: {exc}")
            continue

        with archive:
            for entry_name in archive.entries:
                lowered = entry_name.lower()
                suffix = next((v for k, v in WANTED.items() if lowered.endswith(k)), None)
                if suffix is None:
                    continue
                key = level_key(entry_name)
                if not key:
                    continue

                kind = "minimap" if suffix else "thumbnail"
                stats["maps"].setdefault(key, set())
                if kind == "minimap" and not want_minimaps:
                    continue

                target = out_dir / f"{key}{suffix}.png"
                # Within a run the later (patch) archive must win, so only images left
                # over from a previous run count as already done.
                if target.exists() and target not in written_this_run and not force:
                    stats["maps"][key].add(kind)
                    stats["skipped"] += 1
                    continue
                try:
                    width, height, rgba = decode_dds(archive.read(entry_name))
                    if kind == "thumbnail" and crop:
                        width, height, rgba = crop_to_4_3(width, height, rgba)
                    if kind == "minimap" and minimap_size:
                        width, height, rgba = downscale(width, height, rgba, minimap_size)
                    out_dir.mkdir(parents=True, exist_ok=True)
                    target.write_bytes(encode_png(width, height, rgba))
                    written_this_run.add(target)
                    stats["maps"][key].add(kind)
                    stats["written"] += 1
                except Exception as exc:
                    stats["failed"].append(f"{archive_path.name}:{entry_name}: {exc}")
    return stats


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--game-dir", default="~/.wine/drive_c/EA Games/Battlefield 1942",
                        help="Battlefield 1942 installation root")
    parser.add_argument("--out", default="./maps", help="output directory")
    parser.add_argument("--mods", nargs="*", help="restrict to these mod folder names")
    parser.add_argument("--minimaps", action="store_true",
                        help="also extract the 512x512 minimap as <map>.map.png (~170MB for a full install)")
    parser.add_argument("--minimap-size", type=int, default=0, metavar="PX",
                        help="downscale minimaps to this long edge, e.g. 256")
    parser.add_argument("--no-crop", action="store_true",
                        help="keep the padded square thumbnail instead of cropping to its 4:3 artwork")
    parser.add_argument("--force", action="store_true", help="rewrite images that already exist")
    args = parser.parse_args()

    game_dir = Path(os.path.expanduser(args.game_dir))
    mods_dir = game_dir / "Mods"
    if not mods_dir.is_dir():
        print(f"No Mods directory under {game_dir}", file=sys.stderr)
        return 1

    out_root = Path(os.path.expanduser(args.out))
    wanted = {m.lower() for m in args.mods} if args.mods else None

    total_written = total_maps = 0
    all_failures = []
    manifest_file = out_root / "manifest.json"
    existing_mods = {}
    if manifest_file.is_file():
        try:
            existing_mods = json.loads(manifest_file.read_text()).get("mods", {})
        except Exception:
            pass

    manifest = {
        "version": 1,
        "generated": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"),
        "source": str(game_dir),
        "mods": {**existing_mods},
    }

    for mod_dir in sorted(p for p in mods_dir.iterdir() if p.is_dir()):
        if wanted and mod_dir.name.lower() not in wanted:
            continue
        stats = extract_mod(mod_dir, out_root, args.minimaps, args.force,
                            args.minimap_size, crop=not args.no_crop)
        if not stats["maps"] and not stats["failed"]:
            continue
        print(f"{mod_dir.name.lower():<16} maps={len(stats['maps']):<4} "
              f"written={stats['written']:<4} skipped={stats['skipped']:<4} "
              f"failed={len(stats['failed'])}")
        total_written += stats["written"]
        total_maps += len(stats["maps"])
        all_failures += [f"{mod_dir.name}/{f}" for f in stats["failed"]]
        manifest["mods"][mod_dir.name.lower()] = {
            "searchPath": mod_search_path(mod_dir),
            "maps": {k: sorted(v) for k, v in sorted(stats["maps"].items()) if v},
        }

    out_root.mkdir(parents=True, exist_ok=True)
    (out_root / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")

    print(f"\n{total_maps} maps, {total_written} images written to {out_root}")
    if all_failures:
        print(f"\n{len(all_failures)} failures:", file=sys.stderr)
        for failure in all_failures[:40]:
            print(f"  {failure}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
