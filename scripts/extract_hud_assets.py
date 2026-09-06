#!/usr/bin/env python3
"""Extract Battlefield 1942 HUD assets, class icons, faction flags, medals, and loading textures.

Reads menu.rfa from a local BF1942 install, decompresses LZO-packed DDS textures,
decodes DXT1/DXT3/DXT5 and uncompressed DDS formats into RGBA, and encodes crisp PNGs
with alpha transparency into tournament-images/hud/.

Standard library + system liblzo2 only (no external pip dependencies).
"""

from __future__ import annotations

import argparse
import ctypes
import ctypes.util
import os
import re
import struct
import sys
import zlib
from pathlib import Path

DEFAULT_GAME_ROOT = Path("/home/dylan/.wine/drive_c/EA Games/Battlefield 1942")
DEFAULT_MENU_RFA = DEFAULT_GAME_ROOT / "Mods/bf1942/Archives/menu.rfa"
REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_OUT = REPO_ROOT / "tournament-images/hud"

# --------------------------------------------------------------------------- #
# LZO1X Decompression
# --------------------------------------------------------------------------- #

def _load_lzo():
    for name in ("liblzo2.so.2", "liblzo2.so", ctypes.util.find_library("lzo2")):
        if not name:
            continue
        try:
            lib = ctypes.CDLL(name)
            lib.lzo1x_decompress_safe.argtypes = [
                ctypes.c_char_p,
                ctypes.c_size_t,
                ctypes.c_char_p,
                ctypes.POINTER(ctypes.c_size_t),
                ctypes.c_void_p,
            ]
            lib.lzo1x_decompress_safe.restype = ctypes.c_int
            return lib
        except OSError:
            continue
    sys.exit("liblzo2 not found — install it (e.g. apt install liblzo2-2 / pacman -S lzo)")


_LZO = _load_lzo()


def lzo_decompress(src: bytes, dst_len: int) -> bytes:
    out = ctypes.create_string_buffer(dst_len)
    out_len = ctypes.c_size_t(dst_len)
    rc = _LZO.lzo1x_decompress_safe(src, len(src), out, ctypes.byref(out_len), None)
    if rc != 0:
        raise ValueError(f"lzo1x_decompress_safe returned error code {rc}")
    return out.raw[:out_len.value]


# --------------------------------------------------------------------------- #
# RFA (Refractor Flat Archive) Reader
# --------------------------------------------------------------------------- #

_VERSION_HEADER = b"Refractor2 FlatArchive 1.1  "


class RfaArchive:
    """Reads BF1942 RFA files and extracts uncompressed or LZO-compressed files."""

    def __init__(self, path: Path):
        self.path = path
        self._fh = open(path, "rb")
        header = self._fh.read(28)
        self._base = 28 if header == _VERSION_HEADER else 0
        self._fh.seek(self._base)
        self.data_size, self.compressed = struct.unpack("<II", self._fh.read(8))
        self.entries: dict[str, tuple[int, int, int]] = {}
        self._normalized_index: dict[str, str] = {}
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
                raise ValueError(f"implausible entry name length {name_len} in {self.path}")
            name = self._fh.read(name_len).decode("latin-1").replace("\\", "/")
            c_size, uc_size, offset = struct.unpack("<III", self._fh.read(12))
            self._fh.read(12)  # unused dwords
            self.entries[name] = (c_size, uc_size, offset)
            self._normalized_index[name.lower()] = name

    def find(self, suffix: str) -> str | None:
        needle = suffix.lower().replace("\\", "/")
        for norm_name, real_name in self._normalized_index.items():
            if norm_name.endswith(needle):
                return real_name
        return None

    def find_all(self, pattern: str) -> list[str]:
        p = pattern.lower().replace("\\", "/")
        matched = []
        for norm_name, real_name in self._normalized_index.items():
            if p in norm_name:
                matched.append(real_name)
        return sorted(matched)

    def read(self, name: str) -> bytes:
        real_name = self._normalized_index.get(name.lower().replace("\\", "/"), name)
        if real_name not in self.entries:
            raise KeyError(f"Entry {name!r} not found in {self.path}")

        c_size, uc_size, offset = self.entries[real_name]
        self._fh.seek(self._base + offset)
        if not self.compressed:
            return self._fh.read(uc_size)

        blob = self._fh.read(c_size)
        (segments,) = struct.unpack_from("<I", blob, 0)
        data_start = 4 + segments * 12
        out = bytearray()
        for i in range(segments):
            seg_c, seg_uc, seg_off = struct.unpack_from("<III", blob, 4 + i * 12)
            chunk = blob[data_start + seg_off : data_start + seg_off + seg_c]
            out += chunk if seg_c == seg_uc else lzo_decompress(chunk, seg_uc)
        return bytes(out)


# --------------------------------------------------------------------------- #
# DDS Parser (DXT1, DXT3, DXT5 & Uncompressed RGB/RGBA)
# --------------------------------------------------------------------------- #

def _rgb565(value: int) -> tuple[int, int, int]:
    return (
        (value >> 11 & 0x1F) * 255 // 31,
        (value >> 5 & 0x3F) * 255 // 63,
        (value & 0x1F) * 255 // 31,
    )


def _color_palette(data: bytes, offset: int, punchthrough: bool):
    c0, c1 = struct.unpack_from("<HH", data, offset)
    a, b = _rgb565(c0), _rgb565(c1)
    if c0 > c1 or not punchthrough:
        palette = [
            a,
            b,
            tuple((2 * x + y) // 3 for x, y in zip(a, b)),
            tuple((x + 2 * y) // 3 for x, y in zip(a, b)),
        ]
        alpha = (255, 255, 255, 255)
    else:
        palette = [a, b, tuple((x + y) // 2 for x, y in zip(a, b)), (0, 0, 0)]
        alpha = (255, 255, 255, 0)
    (indices,) = struct.unpack_from("<I", data, offset + 4)
    return palette, alpha, indices


def decode_dds(data: bytes) -> tuple[int, int, bytes]:
    """Decode raw DDS data into (width, height, RGBA_bytes)."""
    if data[:4] != b"DDS ":
        raise ValueError("Not a valid DDS file (missing 'DDS ' signature)")

    height, width = struct.unpack_from("<II", data, 12)
    pf_flags, fourcc, rgb_bits = struct.unpack_from("<I4sI", data, 80)
    masks = struct.unpack_from("<4I", data, 92)
    body = 128
    pixels = bytearray(width * height * 4)

    if pf_flags & 0x4:  # Block compressed
        if fourcc not in (b"DXT1", b"DXT3", b"DXT5"):
            raise ValueError(f"Unsupported FourCC compression: {fourcc!r}")

        stride = 8 if fourcc == b"DXT1" else 16
        offset = body

        for block_y in range(0, height, 4):
            for block_x in range(0, width, 4):
                if fourcc == b"DXT1":
                    palette, block_alpha, indices = _color_palette(data, offset, True)
                    alpha_at = lambda px, py, idx: block_alpha[idx]
                elif fourcc == b"DXT3":
                    alpha_bits = int.from_bytes(data[offset : offset + 8], "little")
                    palette, _, indices = _color_palette(data, offset + 8, False)
                    alpha_at = (
                        lambda px, py, idx, bits=alpha_bits: (
                            (bits >> (4 * (py * 4 + px))) & 0xF
                        )
                        * 17
                    )
                else:  # DXT5
                    a0, a1 = data[offset], data[offset + 1]
                    alpha_bits = int.from_bytes(data[offset + 2 : offset + 8], "little")
                    if a0 > a1:
                        ramp = [a0, a1] + [((7 - n) * a0 + n * a1) // 7 for n in range(1, 7)]
                    else:
                        ramp = (
                            [a0, a1]
                            + [((5 - n) * a0 + n * a1) // 5 for n in range(1, 5)]
                            + [0, 255]
                        )
                    palette, _, indices = _color_palette(data, offset + 8, False)
                    alpha_at = (
                        lambda px, py, idx, bits=alpha_bits, r=ramp: r[
                            (bits >> (3 * (py * 4 + px))) & 0x7
                        ]
                    )

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
                        pixels[n : n + 4] = bytes((r, g, b, alpha_at(px, py, idx)))
                offset += stride

    elif pf_flags & 0x40:  # Uncompressed RGB / RGBA
        bpp = rgb_bits // 8
        channels = []
        for mask in masks:
            if mask:
                shift = (mask & -mask).bit_length() - 1
                channels.append((shift, bin(mask >> shift).count("1")))
            else:
                channels.append(None)
        for n in range(width * height):
            value = int.from_bytes(data[body + n * bpp : body + (n + 1) * bpp], "little")
            out = []
            for channel in channels:
                if channel is None:
                    out.append(255)
                else:
                    shift, bits = channel
                    out.append(((value >> shift) & ((1 << bits) - 1)) * 255 // ((1 << bits) - 1))
            pixels[n * 4 : n * 4 + 4] = bytes(out)
    else:
        raise ValueError("Unsupported DDS pixel format (neither block-compressed nor uncompressed RGB)")

    return width, height, bytes(pixels)


# --------------------------------------------------------------------------- #
# PNG Encoder
# --------------------------------------------------------------------------- #

def encode_png(width: int, height: int, rgba: bytes, drop_alpha: bool = False) -> bytes:
    """Encode RGBA pixel buffer to standard PNG bytes."""
    if drop_alpha:
        raw = bytearray(width * height * 3)
        for n in range(width * height):
            raw[n * 3 : n * 3 + 3] = rgba[n * 4 : n * 4 + 3]
        raw_bytes, components, color_type = bytes(raw), 3, 2
    else:
        raw_bytes, components, color_type = rgba, 4, 6

    row_bytes = width * components
    scanlines = b"".join(
        b"\x00" + raw_bytes[y * row_bytes : (y + 1) * row_bytes] for y in range(height)
    )

    def chunk(tag: bytes, payload: bytes) -> bytes:
        return (
            struct.pack(">I", len(payload))
            + tag
            + payload
            + struct.pack(">I", zlib.crc32(tag + payload) & 0xFFFFFFFF)
        )

    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, color_type, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(scanlines, 9))
        + chunk(b"IEND", b"")
    )


# --------------------------------------------------------------------------- #
# Extraction Driver
# --------------------------------------------------------------------------- #

def extract_and_save(
    archive: RfaArchive, entry_key: str, dest_path: Path, drop_alpha: bool = False
) -> bool:
    """Read a DDS texture from archive, decode, and write as PNG."""
    try:
        raw_dds = archive.read(entry_key)
        w, h, rgba = decode_dds(raw_dds)
        png_bytes = encode_png(w, h, rgba, drop_alpha=drop_alpha)
        dest_path.parent.mkdir(parents=True, exist_ok=True)
        dest_path.write_bytes(png_bytes)
        return True
    except Exception as exc:
        print(f"  [ERROR] Failed {entry_key} -> {dest_path.name}: {exc}", file=sys.stderr)
        return False


def copy_or_link(src_file: Path, target_file: Path):
    """Ensure target_file exists with same content as src_file."""
    target_file.parent.mkdir(parents=True, exist_ok=True)
    target_file.write_bytes(src_file.read_bytes())


def run_extraction(menu_rfa_path: Path, out_dir: Path) -> int:
    if not menu_rfa_path.is_file():
        print(f"Error: menu.rfa not found at {menu_rfa_path}", file=sys.stderr)
        return 1

    print(f"Loading {menu_rfa_path}...")
    with RfaArchive(menu_rfa_path) as arch:
        total_extracted = 0

        # ------------------------------------------------------------------- #
        # 1. Classes: menu/Texture/Kits/*.dds and Debriefing/classes/*.dds
        # ------------------------------------------------------------------- #
        classes_dir = out_dir / "classes"
        print(f"\n--- Extracting Class Icons -> {classes_dir.relative_to(REPO_ROOT)} ---")

        # Map canonical role name to primary kit texture
        canonical_kits = {
            "assault.png": "menu/Texture/Kits/icon_assault_allies_selected.dds",
            "medic.png": "menu/Texture/Kits/icon_medic_allies_selected.dds",
            "engineer.png": "menu/Texture/Kits/icon_engineer_allies_selected.dds",
            "antitank.png": "menu/Texture/Kits/icon_antitank_allies_selected.dds",
            "at.png": "menu/Texture/Kits/icon_antitank_allies_selected.dds",
            "scout.png": "menu/Texture/Kits/icon_scout_allies_selected.dds",
        }

        # Extract all Kit textures
        kit_entries = arch.find_all("menu/texture/kits/")
        for entry in kit_entries:
            stem = Path(entry).stem.lower()
            # Save original stem (e.g. icon_assault_allies_selected.png)
            dest = classes_dir / f"{stem}.png"
            if extract_and_save(arch, entry, dest):
                total_extracted += 1

                # Clean kit alias without 'selected' and 'icon_'
                # e.g. icon_assault_allies_selected -> assault_allies.png
                clean_name = stem.replace("_selected", "").replace("icon_", "")
                alias_dest = classes_dir / f"{clean_name}.png"
                if not alias_dest.exists():
                    copy_or_link(dest, alias_dest)

        # Extract all debriefing classes
        debrief_entries = arch.find_all("menu/texture/debriefing/classes/")
        for entry in debrief_entries:
            stem = Path(entry).stem.lower()
            dest = classes_dir / f"{stem}.png"
            if extract_and_save(arch, entry, dest):
                total_extracted += 1

                # Debriefing shortcuts
                if stem.startswith("class_") and stem.endswith("_16x16"):
                    short_name = "debrief_" + stem[6:-6] + ".png"
                    alias_dest = classes_dir / short_name
                    if not alias_dest.exists():
                        copy_or_link(dest, alias_dest)

        # Ensure canonical class icons exist
        for canon_name, entry in canonical_kits.items():
            dest = classes_dir / canon_name
            if extract_and_save(arch, entry, dest):
                print(f"  [CANONICAL CLASS] {canon_name} <= {entry}")

        # ------------------------------------------------------------------- #
        # 2. Flags: baseflag_conp_*.dds, flag_*.dds, icon_flag_*.dds
        # ------------------------------------------------------------------- #
        flags_dir = out_dir / "flags"
        print(f"\n--- Extracting Faction Flags -> {flags_dir.relative_to(REPO_ROOT)} ---")

        flag_candidates = [
            e for e in arch.entries
            if "menu/texture/" in e.lower()
            and any(x in e.lower() for x in ["baseflag_conp_", "flag_", "icon_flag_"])
        ]

        for entry in flag_candidates:
            stem = Path(entry).stem.lower()
            dest = flags_dir / f"{stem}.png"
            if extract_and_save(arch, entry, dest):
                total_extracted += 1

        # Canonical faction flags: us, ger, jp, rus, brit, can
        canonical_factions = ["us", "ger", "jp", "rus", "brit", "can"]
        for f in canonical_factions:
            # Primary: baseflag_conp_<f>.dds (32x32 roundel flag badge)
            baseflag_entry = arch.find(f"baseflag_conp_{f}.dds")
            if baseflag_entry:
                dest = flags_dir / f"{f}.png"
                if extract_and_save(arch, baseflag_entry, dest):
                    print(f"  [CANONICAL FLAG] {f}.png <= {baseflag_entry}")

        # Aliases for convenience
        alias_map = {
            "usa.png": "us.png",
            "germany.png": "ger.png",
            "axis.png": "ger.png",
            "japan.png": "jp.png",
            "russia.png": "rus.png",
            "soviet.png": "rus.png",
            "britain.png": "brit.png",
            "uk.png": "brit.png",
            "canada.png": "can.png",
            "allies.png": "us.png",
        }
        for alias_name, target_name in alias_map.items():
            src_f = flags_dir / target_name
            dst_f = flags_dir / alias_name
            if src_f.exists() and not dst_f.exists():
                copy_or_link(src_f, dst_f)

        # ------------------------------------------------------------------- #
        # 3. Medals: menu/Texture/Debriefing/medals/*.dds
        # ------------------------------------------------------------------- #
        medals_dir = out_dir / "medals"
        print(f"\n--- Extracting Medals -> {medals_dir.relative_to(REPO_ROOT)} ---")

        medal_entries = arch.find_all("menu/texture/debriefing/medals/")
        for entry in medal_entries:
            stem = Path(entry).stem.lower()
            dest = medals_dir / f"{stem}.png"
            if extract_and_save(arch, entry, dest):
                total_extracted += 1

        # Canonical medal aliases
        medal_aliases = {
            "allied_gold.png": "allied_xl_gold_32x32.png",
            "allied_silver.png": "allied_xl_silver_32x32.png",
            "allied_bronze.png": "allied_xl_bronze_32x32.png",
            "axis_gold.png": "axis_xl_gold_32x32.png",
            "axis_silver.png": "axis_xl_silver_32x32.png",
            "axis_bronze.png": "axis_xl_bronze_32x32.png",
            "gold.png": "allied_xl_gold_32x32.png",
            "silver.png": "allied_xl_silver_32x32.png",
            "bronze.png": "allied_xl_bronze_32x32.png",
        }
        for alias_name, target_name in medal_aliases.items():
            src_m = medals_dir / target_name
            dst_m = medals_dir / alias_name
            if src_m.exists():
                copy_or_link(src_m, dst_m)
                print(f"  [MEDAL ALIAS] {alias_name} <= {target_name}")

        # ------------------------------------------------------------------- #
        # 4. Loading: loading_full, menu_loading, statusbar
        # ------------------------------------------------------------------- #
        loading_dir = out_dir / "loading"
        print(f"\n--- Extracting Loading Assets -> {loading_dir.relative_to(REPO_ROOT)} ---")

        loading_items = [
            ("loading_full_256x16.dds", "loading_full_256x16.png"),
            ("loadingfull_256x16.dds", "loadingfull_256x16.png"),
            ("menu_loading.dds", "menu_loading.png"),
            ("statusbar.dds", "statusbar.png"),
            ("statusbar_full.dds", "statusbar_full.png"),
        ]

        for suffix, out_name in loading_items:
            entry = arch.find(suffix)
            if entry:
                dest = loading_dir / out_name
                if extract_and_save(arch, entry, dest):
                    total_extracted += 1
                    print(f"  [LOADING ASSET] {out_name} <= {entry}")

        # Canonical alias
        if (loading_dir / "loading_full_256x16.png").exists():
            copy_or_link(
                loading_dir / "loading_full_256x16.png",
                loading_dir / "loading_full.png",
            )

        print(f"\n[DONE] Successfully extracted {total_extracted} assets into {out_dir.relative_to(REPO_ROOT)}/")

    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--menu-rfa",
        type=Path,
        default=DEFAULT_MENU_RFA,
        help=f"Path to menu.rfa (default: {DEFAULT_MENU_RFA})",
    )
    parser.add_argument(
        "--out",
        type=Path,
        default=DEFAULT_OUT,
        help=f"Destination directory (default: {DEFAULT_OUT})",
    )
    args = parser.parse_args()
    return run_extraction(args.menu_rfa, args.out)


if __name__ == "__main__":
    raise SystemExit(main())
