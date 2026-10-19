"""Remote-only levels: a published level whose scene glbs left this PC.

`evict_levels.py` removes `<level>/scene.glb` and its `.gz`/`.br` once the
volume holds each at the local size, and leaves `scene.remote.json` beside
`scene.json` in their place (`features/mesh-asset-size`, "Local eviction").
Everything else in the level directory stays: `scene.json`, the terrain, the
sky, the sounds, the loading art.

    {"format": "bf1942-remote-scene/1", "evicted": "2026-10-20T09:12:00Z",
     "files": {"scene.glb": {"size": 70040340, "sha256": "..."},
               "scene.glb.gz": {"size": ...}, "scene.glb.br": {"size": ...}}}

An evicted level is PRESENT, not missing: every reader that decides whether
a level is baked, counts levels, builds a manifest, or skips a bake asks
`has_scene` here instead of `scene.glb.is_file()`. A reader that needs the
glb's bytes (an audit, a patch) skips it with a count, or restores it first
(`evict_levels.py restore`).

The marker is authoritative only while `scene.glb` is absent: a re-bake writes
a new `scene.glb` and the level is local again whatever the marker says (the
next eviction pass rewrites or drops the stale marker). The publisher never
sends the marker.
"""

from __future__ import annotations

import json
import os
import time
from pathlib import Path

MARKER = "scene.remote.json"
FORMAT = "bf1942-remote-scene/1"
SCENE = "scene.glb"
COPIES = ("scene.glb.gz", "scene.glb.br")
SCENE_FILES = (SCENE, *COPIES)


def marker_path(level_dir: Path) -> Path:
    return Path(level_dir) / MARKER


def read_marker(level_dir: Path) -> dict | None:
    try:
        doc = json.loads(marker_path(level_dir).read_text())
    except (OSError, ValueError):
        return None
    if not isinstance(doc, dict) or doc.get("format") != FORMAT \
            or not isinstance(doc.get("files"), dict) or SCENE not in doc["files"]:
        return None
    return doc


def is_remote(level_dir: Path) -> bool:
    """The level's scene is on the volume only: no local `scene.glb`, and a
    marker that says it was evicted."""
    level_dir = Path(level_dir)
    return not (level_dir / SCENE).is_file() and read_marker(level_dir) is not None


def has_scene(level_dir: Path) -> bool:
    """The level is baked: its scene is here, or on the volume by eviction."""
    level_dir = Path(level_dir)
    return (level_dir / SCENE).is_file() or is_remote(level_dir)


def has_file(level_dir: Path, name: str) -> bool:
    """`scene.glb`, `.gz` or `.br`: here, or recorded as evicted to the volume."""
    level_dir = Path(level_dir)
    if (level_dir / name).is_file():
        return True
    doc = read_marker(level_dir) if not (level_dir / SCENE).is_file() else None
    return doc is not None and name in doc["files"]


def remote_levels(maps_dir: Path) -> list[str]:
    """Directory names of the remote-only levels directly under a maps tree
    (not descending into `mods/`)."""
    maps_dir = Path(maps_dir)
    out: list[str] = []
    try:
        entries = sorted(os.scandir(maps_dir), key=lambda e: e.name)
    except OSError:
        return out
    for entry in entries:
        if entry.is_dir(follow_symlinks=False) and entry.name not in ("mods", "_shared") \
                and is_remote(Path(entry.path)):
            out.append(entry.name)
    return out


def write_marker(level_dir: Path, files: dict[str, dict]) -> Path:
    path = marker_path(level_dir)
    doc = {"format": FORMAT,
           "evicted": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
           "files": {name: files[name] for name in SCENE_FILES if name in files}}
    tmp = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    tmp.write_text(json.dumps(doc, indent=1) + "\n")
    tmp.replace(path)
    return path


def skipped_note(tool: str, levels: list[str], what: str = "read") -> str:
    """One line for a tool that skips remote-only levels."""
    names = ", ".join(levels[:6]) + (f" and {len(levels) - 6} more" if len(levels) > 6 else "")
    return (f"{tool}: {len(levels)} remote-only levels not {what} (scene.glb evicted to the "
            f"volume; `evict_levels.py restore` brings one back): {names}")
