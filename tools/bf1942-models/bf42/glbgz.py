"""Keep a gzip copy beside every glb, for nginx's `gzip_static` to send.

Phase 2a of `features/mesh-asset-size`. After phase 1 a glb is geometry and
JSON, which gzip cuts to 35-40% (a level) or 20-30% (a model). The server sends
the pre-compressed `<name>.glb.gz` to a client that takes gzip, so the node
spends no CPU per request, and the plain `.glb` beside it to everything else:
the local dev server, the API's own route, a client without gzip.

The two must never disagree, and the gzip trailer says whether they do: its
last eight bytes are the CRC-32 and the length (mod 2**32) of what it inflates
to. `is_fresh` compares those with the glb, so a `.gz` left behind by a glb
that was rebuilt without this step is caught by whoever reads it next (this
module when it runs again, the publisher before it sends either file).

The copy is deterministic (no name and no timestamp in the header), so a glb
that does not change never gets a `.gz` that does.
"""

from __future__ import annotations

import os
import struct
import zlib
from pathlib import Path

# -9 against -6 over the in-scope trees: 0.3-0.5 points smaller for three times
# the CPU, about 2 s a level. It is paid once per bake and saved on every
# transfer.
LEVEL = 9
SUFFIX = ".gz"


def gz_path(glb: Path) -> Path:
    return glb.with_name(glb.name + SUFFIX)


def compress(data: bytes) -> bytes:
    """A single-member gzip of `data` with an empty header: no file name,
    mtime 0, so the same bytes in give the same bytes out."""
    deflate = zlib.compressobj(LEVEL, zlib.DEFLATED, -zlib.MAX_WBITS, 9)
    body = deflate.compress(data) + deflate.flush()
    header = b"\x1f\x8b\x08\x00" + b"\x00\x00\x00\x00" + b"\x02\xff"
    trailer = struct.pack("<II", zlib.crc32(data), len(data) & 0xFFFFFFFF)
    return header + body + trailer


def trailer(gz: Path) -> tuple[int, int] | None:
    """(crc32, length mod 2**32) from a gzip file's trailer, or None when the
    file is missing or is not a gzip."""
    try:
        with open(gz, "rb") as handle:
            if handle.read(2) != b"\x1f\x8b":
                return None
            handle.seek(0, os.SEEK_END)
            if handle.tell() < 18:
                return None
            handle.seek(-8, os.SEEK_END)
            return struct.unpack("<II", handle.read(8))
    except OSError:
        return None


def is_fresh(data: bytes, gz: Path) -> bool:
    """Whether `gz` inflates to `data`, going by its trailer."""
    return trailer(gz) == (zlib.crc32(data), len(data) & 0xFFFFFFFF)


def ensure(glb: Path, data: bytes | None = None) -> tuple[bool, int]:
    """Make `<glb>.gz` match the glb. Returns (rewritten, size of the .gz).

    An existing `.gz` is rewritten through its own inode, as the glb is, so a
    hard-link mirror that carries both keeps them in step. A fresh one older
    than its glb (a rebuild that gave the same bytes) is touched, so its mtime
    still says it was made from this glb: the API only sends a `.gz` that is at
    least as new as the file beside it."""
    data = glb.read_bytes() if data is None else data
    gz = gz_path(glb)
    if is_fresh(data, gz):
        stat = gz.stat()
        if stat.st_mtime_ns < glb.stat().st_mtime_ns:
            os.utime(gz)
        return False, stat.st_size
    out = compress(data)
    mode = "r+b" if gz.exists() else "wb"
    with open(gz, mode) as handle:
        handle.write(out)
        handle.truncate()
    return True, len(out)
