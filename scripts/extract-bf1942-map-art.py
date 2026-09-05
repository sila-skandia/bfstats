#!/usr/bin/env python3
"""Extract BF1942 InGameMap textures for Field Lore theater recon.

Reads official (and expansion) level RFAs from a local Battlefield 1942 install,
decompresses LZO-packed DDS files, and writes WebPs plus a catalog JSON.

WebPs are never checked in and never shipped in the UI image. Extract writes
to api/assets/arcade/maps (gitignored). Production copies live on the assets
volume and are served only at /stats/assets/arcade/. Upload with
scripts/upload-arcade-map-art.sh.

Requires: liblzo2, ffmpeg with libwebp.
"""

from __future__ import annotations

import argparse
import ctypes
import json
import re
import struct
import subprocess
import sys
from pathlib import Path

DEFAULT_GAME = Path("/home/dylan/.wine/drive_c/EA Games/Battlefield 1942")
REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_OUT = REPO_ROOT / "api/assets/arcade/maps"
DEFAULT_CATALOG = REPO_ROOT / "ui/src/data/bf1942MapArt.json"

PATCH_STEM = re.compile(r"^(?P<base>.+?)_(?P<patch>\d{3})$")

# Official / community display names that differ from the RFA folder.
DISPLAY_NAMES = {
    "wake": "Wake Island",
    "coral_sea": "Coral Sea",
    "el_alamein": "El Alamein",
    "guadalcanal": "Guadalcanal",
    "iwo_jima": "Iwo Jima",
    "omaha_beach": "Omaha Beach",
    "battle_of_the_bulge": "Battle of the Bulge",
    "battle_of_britain": "Battle of Britain",
    "invasion_of_the_philippines": "Invasion of the Philippines",
    "liberation_of_caen": "Liberation of Caen",
    "market_garden": "Market Garden",
    "santo_croce": "Santo Croce",
    "eagles_nest": "Eagle's Nest",
    "raid_on_agheila": "Raid on Agheila",
    "kbely_airfield": "Kbely Airfield",
    "husky": "Operation Husky",
    "salerno": "Battle of Salerno",
    "cassino": "Monte Cassino",
    "baytown": "Operation Baytown",
}

EXTRA_ALIASES = {
    "wake": ["wake island", "wakeisland"],
    "guadalcanal": ["guadal canal", "guadalcanal"],
    "coral_sea": ["coral sea"],
    "eagles_nest": ["eagle's nest", "eagles nest", "eaglesnest"],
    "husky": ["operation husky", "husky"],
    "salerno": ["battle of salerno", "salerno"],
    "cassino": ["monte cassino", "cassino"],
    "baytown": ["operation baytown", "baytown"],
    "santo_croce": ["santa croce", "santo croce"],
}

# Keep the in-game spawn map colors. Recognition is the point.
FFMPEG_VF = "format=rgba"

lzo = ctypes.CDLL("liblzo2.so.2")
lzo.lzo1x_decompress_safe.argtypes = [
    ctypes.c_void_p,
    ctypes.c_uint,
    ctypes.c_void_p,
    ctypes.POINTER(ctypes.c_uint),
    ctypes.c_void_p,
]
lzo.lzo1x_decompress_safe.restype = ctypes.c_int


def slugify(folder: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", folder.lower()).strip("_")


def title_from_folder(folder: str) -> str:
    slug = slugify(folder)
    if slug in DISPLAY_NAMES:
        return DISPLAY_NAMES[slug]
    return folder.replace("_", " ")


def normalize_alias(value: str) -> str:
    return re.sub(r"[\s_\-]+", " ", value.strip().lower())


def compact_alias(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", normalize_alias(value))


class RfaArchive:
    def __init__(self, path: Path):
        self.path = path
        self.data = path.read_bytes()
        self.entries: dict[str, tuple[int, int, int]] = {}
        self.compressed = False
        self._parse()

    def _parse(self) -> None:
        data = self.data
        if data[:28] == b"Refractor2 FlatArchive 1.1 ":
            offset = struct.unpack_from("<I", data, 28)[0]
            self.compressed = struct.unpack_from("<I", data, 32)[0] == 1
        else:
            offset, flag = struct.unpack_from("<II", data, 0)
            self.compressed = flag == 1

        count = struct.unpack_from("<I", data, offset)[0]
        pos = offset + 4
        for _ in range(count):
            name_len = struct.unpack_from("<I", data, pos)[0]
            pos += 4
            name = data[pos : pos + name_len].decode("latin1")
            pos += name_len
            compressed_size, uncompressed_size, file_offset = struct.unpack_from("<III", data, pos)
            pos += 24
            self.entries[name.replace("\\", "/")] = (compressed_size, uncompressed_size, file_offset)

    def find(self, suffix: str) -> str | None:
        needle = suffix.lower().replace("\\", "/")
        for name in self.entries:
            if name.lower().replace("\\", "/").endswith(needle):
                return name
        return None

    def extract(self, name: str) -> bytes:
        _cs, uncompressed_size, file_offset = self.entries[name]
        if not self.compressed:
            return self.data[file_offset : file_offset + uncompressed_size]

        segs = struct.unpack_from("<I", self.data, file_offset)[0]
        pieces: list[bytes] = []
        header = file_offset + 4
        for i in range(segs):
            seg_cs, seg_us, seg_off = struct.unpack_from("<III", self.data, header + 12 * i)
            start = header + 12 * segs + seg_off
            payload = self.data[start : start + seg_cs]
            out = ctypes.create_string_buffer(seg_us)
            out_len = ctypes.c_uint(seg_us)
            rc = lzo.lzo1x_decompress_safe(payload, seg_cs, out, ctypes.byref(out_len), None)
            if rc != 0:
                raise RuntimeError(f"LZO decompress failed ({rc}) for {name} in {self.path}")
            pieces.append(out.raw[: out_len.value])
        return b"".join(pieces)


def is_patch_rfa(path: Path) -> bool:
    return bool(PATCH_STEM.match(path.stem))


def base_stem(path: Path) -> str:
    match = PATCH_STEM.match(path.stem)
    return match.group("base") if match else path.stem


def collect_level_rfas(game_root: Path) -> list[tuple[int, Path]]:
    """Return (priority, path) pairs. Lower priority wins when slugs collide."""
    found: list[tuple[int, Path]] = []
    specs = [
        (0, game_root / "Mods/bf1942/Archives/bf1942/levels"),
        (1, game_root / "Mods/XPack1/Archives/Bf1942/Levels"),
        (2, game_root / "Mods/XPack2/Archives/bf1942/Levels"),
        (3, game_root / "Mods/DC_Final/Archives/BF1942/levels"),
    ]
    for priority, folder in specs:
        if not folder.is_dir():
            continue
        for rfa in sorted(folder.glob("*.rfa")):
            if priority == 3 and not rfa.stem.upper().startswith("DC_"):
                continue
            found.append((priority, rfa))
    return found


def group_by_slug(rfas: list[tuple[int, Path]]) -> dict[str, list[tuple[int, int, Path]]]:
    """slug -> list of (priority, patch_index, path)."""
    grouped: dict[str, list[tuple[int, int, Path]]] = {}
    for priority, path in rfas:
        stem = base_stem(path)
        slug = slugify(stem)
        patch = int(PATCH_STEM.match(path.stem).group("patch")) if is_patch_rfa(path) else -1
        grouped.setdefault(slug, []).append((priority, patch, path))
    for slug, items in grouped.items():
        items.sort(key=lambda item: (item[0], item[1]))
    return grouped


def pick_texture(archives: list[RfaArchive], suffix: str) -> bytes | None:
    for archive in reversed(archives):
        name = archive.find(suffix)
        if name:
            return archive.extract(name)
    return None


def convert_dds(dds_bytes: bytes, dest: Path) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(".dds")
    tmp.write_bytes(dds_bytes)
    try:
        cmd = [
            "ffmpeg",
            "-y",
            "-hide_banner",
            "-loglevel",
            "error",
            "-i",
            str(tmp),
            "-vf",
            f"scale='min(512,iw)':'min(512,ih)':force_original_aspect_ratio=decrease,{FFMPEG_VF}",
            "-frames:v",
            "1",
            "-update",
            "1",
            "-c:v",
            "libwebp",
            "-quality",
            "86",
            "-compression_level",
            "5",
            str(dest),
        ]
        subprocess.run(cmd, check=True)
    finally:
        if tmp.exists():
            tmp.unlink()


def build_aliases(folder: str, display_name: str) -> list[str]:
    slug = slugify(folder)
    aliases = {
        normalize_alias(folder),
        normalize_alias(display_name),
        compact_alias(folder),
        compact_alias(display_name),
        slug.replace("_", " "),
        slug,
    }
    for extra in EXTRA_ALIASES.get(slug, []):
        aliases.add(normalize_alias(extra))
        aliases.add(compact_alias(extra))
    if slug.startswith("dc_"):
        rest = slug[3:].replace("_", " ")
        aliases.add(normalize_alias(rest))
        aliases.add(compact_alias(rest))
    return sorted({alias for alias in aliases if alias})


def extract_all(game_root: Path, out_dir: Path, catalog_path: Path) -> int:
    grouped = group_by_slug(collect_level_rfas(game_root))
    catalog: list[dict] = []

    for slug, items in sorted(grouped.items()):
        archives: list[RfaArchive] = []
        folder = base_stem(items[0][2])
        for _priority, _patch, path in items:
            try:
                archives.append(RfaArchive(path))
            except Exception as exc:  # noqa: BLE001
                print(f"skip unreadable {path.name}: {exc}", file=sys.stderr)

        ingame = pick_texture(archives, "/textures/ingamemap.dds")
        thumb = pick_texture(archives, "/menu/thumbnail.dds")
        source = ingame or thumb
        if not source:
            print(f"skip {slug}: no InGameMap or thumbnail")
            continue

        dest = out_dir / slug / "ingame.webp"
        convert_dds(source, dest)
        display = title_from_folder(folder)
        catalog.append(
            {
                "slug": slug,
                "folder": folder,
                "displayName": display,
                "ingame": f"/stats/assets/arcade/maps/{slug}/ingame.webp",
                "aliases": build_aliases(folder, display),
            }
        )
        kind = "ingame" if ingame else "thumb"
        print(f"wrote {dest.relative_to(REPO_ROOT)} ({kind}, {dest.stat().st_size} bytes)")

    catalog_path.parent.mkdir(parents=True, exist_ok=True)
    catalog_path.write_text(json.dumps({"maps": catalog}, indent=2) + "\n", encoding="utf-8")
    print(f"catalog {len(catalog)} maps -> {catalog_path.relative_to(REPO_ROOT)}")
    return 0 if catalog else 1


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--game", type=Path, default=DEFAULT_GAME)
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    parser.add_argument("--catalog", type=Path, default=DEFAULT_CATALOG)
    args = parser.parse_args()
    if not args.game.is_dir():
        print(f"BF1942 install not found: {args.game}", file=sys.stderr)
        return 2
    return extract_all(args.game, args.out, args.catalog)


if __name__ == "__main__":
    raise SystemExit(main())
