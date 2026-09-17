"""Synthetic uncompressed Refractor Flat Archive (.rfa) generator."""

from __future__ import annotations

import struct
from pathlib import Path


class SyntheticRfaBuilder:
    """Builds valid uncompressed Refractor Flat Archive (.rfa) files for fast isolated testing."""

    def __init__(self) -> None:
        self.entries: dict[str, bytes] = {}

    def add_file(self, archive_path: str, data: bytes) -> SyntheticRfaBuilder:
        # Normalize Windows backslashes to forward slashes
        norm_path = archive_path.replace("\\", "/").strip("/")
        self.entries[norm_path] = data
        return self

    def add_text(self, archive_path: str, text: str, encoding: str = "latin-1") -> SyntheticRfaBuilder:
        return self.add_file(archive_path, text.encode(encoding))

    def build(self) -> bytes:
        payload = bytearray()
        index = bytearray()
        curr_offset = 156  # 4 dataSize + 4 compressed + 148 checksum padding

        for name, data in self.entries.items():
            name_bytes = name.encode("latin-1")
            c_size = len(data)
            uc_size = len(data)
            offset = curr_offset
            payload.extend(data)
            curr_offset += len(data)

            index.extend(struct.pack("<I", len(name_bytes)))
            index.extend(name_bytes)
            index.extend(struct.pack("<III", c_size, uc_size, offset))
            index.extend(b"\x00" * 12)  # 3 unused dwords

        header = struct.pack("<II", curr_offset, 0) + (b"\x00" * 148)
        return bytes(header + payload + struct.pack("<I", len(self.entries)) + index)

    def write(self, path: Path) -> Path:
        path = Path(path)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(self.build())
        return path
