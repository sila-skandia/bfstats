"""What the assets volume is known to hold of the glb store, recorded locally.

The production volume holds more than this PC (`features/mesh-asset-size`,
"Local eviction"). A blob of the content-addressed store (`viewer/glbs/`,
`bf42/glbstore.py`) is named by its sha256, so once the volume holds
`<sha>.glb` at the local size, the local copy is only a cache: it may be
removed, and the next `store_glbs.py` run over a tree that still names it must
not write it back.

The record is `<store>/.on-volume.json`, written by
`scripts/publish-mesh-delta.py` from the volume listing it already takes
(a full, count-checked `find` on the pod) and from every unit it lands, and by
`evict_glbs.py --refresh`. It lives inside the store directory, so a scratch
store carries its own and a worktree that links the store shares it. The
publisher never sends it (a dot-name in `SKIP_NAMES` there).

    {"format": "bf1942-volume-record/1", "tree": "glbs",
     "listed": "2026-10-20T09:12:00Z", "files": {"<sha>.glb": 1234, ...}}

Readers trust a name only at the size the record holds: a blob is "on the
volume" when the record names it at exactly the size of the bytes in hand.
A missing or unreadable record holds nothing, which is always the safe
answer (nothing is skipped, nothing is evicted).
"""

from __future__ import annotations

import json
import os
import time
from pathlib import Path

RECORD_NAME = ".on-volume.json"
FORMAT = "bf1942-volume-record/1"


class VolumeRecord:
    """`name -> size` of the files the volume held when last listed."""

    def __init__(self, path: Path, files: dict[str, int] | None = None,
                 listed: str | None = None) -> None:
        self.path = Path(path)
        self.files: dict[str, int] = dict(files or {})
        self.listed = listed

    @classmethod
    def load(cls, store_root: Path) -> "VolumeRecord":
        path = Path(store_root) / RECORD_NAME
        try:
            doc = json.loads(path.read_text())
        except (OSError, ValueError):
            return cls(path)
        if not isinstance(doc, dict) or doc.get("format") != FORMAT \
                or not isinstance(doc.get("files"), dict):
            return cls(path)
        files = {str(k): int(v) for k, v in doc["files"].items()
                 if isinstance(v, int) and not isinstance(v, bool)}
        return cls(path, files, doc.get("listed"))

    def size(self, name: str) -> int | None:
        return self.files.get(name)

    def holds(self, name: str, size: int | None = None) -> bool:
        """Whether the volume holds `name` (at `size`, when given)."""
        held = self.files.get(name)
        return held is not None and (size is None or held == size)

    def __len__(self) -> int:
        return len(self.files)

    def replace(self, listing: dict[str, int]) -> None:
        """The volume as a fresh, complete listing says it is."""
        self.files = {str(k): int(v) for k, v in listing.items()}
        self.listed = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())

    def merge(self, landed: dict[str, int]) -> None:
        """Files just landed (and size-verified) on the volume."""
        self.files.update({str(k): int(v) for k, v in landed.items()})

    def save(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.path.with_name(f".{self.path.name}.{os.getpid()}.tmp")
        tmp.write_text(json.dumps({"format": FORMAT, "tree": "glbs", "listed": self.listed,
                                   "files": dict(sorted(self.files.items()))}, indent=0))
        tmp.replace(self.path)


def evictable(store_root: Path, record: VolumeRecord | None = None) -> list[tuple[Path, int]]:
    """Every local store file the record says the volume holds at the same
    size: `(path, size)`. Only store names (`<64 hex>.glb`, `.glb.gz`,
    `.glb.br`) qualify; the record itself and anything else never do."""
    store_root = Path(store_root)
    record = record if record is not None else VolumeRecord.load(store_root)
    out: list[tuple[Path, int]] = []
    if not record.files or not store_root.is_dir():
        return out
    with os.scandir(store_root) as entries:
        for entry in entries:
            if not entry.is_file(follow_symlinks=False) or not is_store_name(entry.name):
                continue
            size = entry.stat(follow_symlinks=False).st_size
            if record.holds(entry.name, size):
                out.append((Path(entry.path), size))
    return sorted(out)


def is_store_name(name: str) -> bool:
    stem, dot, tail = name.partition(".")
    return (len(stem) == 64 and all(c in "0123456789abcdef" for c in stem)
            and dot == "." and tail in ("glb", "glb.gz", "glb.br"))
