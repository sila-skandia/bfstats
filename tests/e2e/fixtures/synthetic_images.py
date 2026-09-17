"""Synthetic image generators for TGA, DDS (DXT1), and WebP."""

from __future__ import annotations

import io
import struct
from PIL import Image


def create_synthetic_tga(
    width: int = 800,
    height: int = 600,
    color: tuple[int, int, int] = (127, 124, 73),
) -> bytes:
    """Generates an uncompressed 24-bit BGR TGA image (Type 2, top-to-bottom).

    Header:
    - 1 byte id length (0)
    - 1 byte colormap type (0)
    - 1 byte image type (2 = uncompressed true-color)
    - 5 bytes colormap spec (0)
    - 2 bytes x origin (0)
    - 2 bytes y origin (0)
    - 2 bytes width
    - 2 bytes height
    - 1 byte bit depth (24)
    - 1 byte image descriptor (0x20 = top-left origin)
    """
    header = (
        b"\x00\x00\x02\x00\x00\x00\x00\x00\x00\x00\x00\x00"
        + struct.pack("<HHBB", width, height, 24, 0x20)
    )
    b, g, r = color[2], color[1], color[0]
    pixel_data = bytes([b, g, r]) * (width * height)
    return header + pixel_data


def create_synthetic_dxt1_dds(
    width: int = 512,
    height: int = 64,
    color_565: int = 0x3B80,
) -> bytes:
    """Generates a valid DXT1 DDS texture with standard 128-byte header."""
    header = bytearray(128)
    header[0:4] = b"DDS "
    # dwSize = 124
    struct.pack_into("<I", header, 4, 124)
    # DDSD flags: CAPS | HEIGHT | WIDTH | PIXELFORMAT | LINEARSIZE
    struct.pack_into("<I", header, 8, 0x1 | 0x2 | 0x4 | 0x1000 | 0x80000)
    struct.pack_into("<II", header, 12, height, width)
    # dwPitchOrLinearSize = max(1, (width+3)//4) * max(1, (height+3)//4) * 8
    blocks_x = max(1, (width + 3) // 4)
    blocks_y = max(1, (height + 3) // 4)
    linear_size = blocks_x * blocks_y * 8
    struct.pack_into("<I", header, 20, linear_size)
    # ddspf.dwSize = 32
    struct.pack_into("<I", header, 76, 32)
    # ddspf.dwFlags = DDPF_FOURCC (0x4)
    struct.pack_into("<I", header, 80, 0x4)
    header[84:88] = b"DXT1"
    # caps = DDSCAPS_TEXTURE (0x1000)
    struct.pack_into("<I", header, 108, 0x1000)

    # DXT1 block: 2 bytes color0, 2 bytes color1, 4 bytes bitmask lookup table
    # color0 = color_565, color1 = 0x0000, lookup = 0x00000000
    block = struct.pack("<HH", color_565, 0x0000) + b"\x00\x00\x00\x00"
    block_data = block * (blocks_x * blocks_y)
    return bytes(header) + block_data


def create_synthetic_webp(
    width: int = 800,
    height: int = 600,
    color: tuple[int, int, int] = (127, 124, 73),
) -> bytes:
    """Generates a minimal valid WebP image using Pillow."""
    img = Image.new("RGB", (width, height), color)
    buf = io.BytesIO()
    img.save(buf, format="WEBP")
    return buf.getvalue()
