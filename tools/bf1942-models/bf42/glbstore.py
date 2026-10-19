"""One content-addressed store for the model trees' glbs.

Phase 5 of `features/mesh-asset-size`, the phase 1 pattern applied to whole
glbs: most model, rig and pose glbs are byte-identical copies of one another
(a mod tree holds its whole chain's library, script-only variants re-export
the same geometry), so each distinct file is stored once as
`<mesh root>/glbs/<sha256>.glb` with its deterministic `.glb.gz` beside it,
and the tree's manifests record which blob each name resolves to:

* `models.json` rows gain `sha` (the row's `glb`), `cockpitSha`, and a `sha`
  per `variants[]` entry;
* `viewmodels/index.json` becomes `{"format": "bf1942-rig-index/1",
  "rigs": [<stems, exactly as the array form listed them>],
  "sha": {"<stem>.fp.glb": <sha>}}`;
* `poses/index.json` (`bf1942-pose-index/1`) gains `"sha"`, keyed by the path
  under `poses/`: `"<stem>.pose.glb"` for the stems its `glb` list names, and
  every glb in a subdirectory (`rigs/<s>.rig.glb`, `gaits/<w>.gait.glb`).

The viewer resolves a name through the manifest it already loads and fetches
the blob (`viewer/glb-store.js`); a name with no sha keeps its per-tree path,
so an untreated tree still loads. The per-tree glbs are never touched here --
removing the superseded copies from the volume is a later, separate GC.

A manifest's claims are the record, not the directory: a glb on disk that no
manifest names (a kit glb, `viewmodels/skins/`) is neither stored nor
recorded, and keeps working through its old path. The extractors still write
plain manifests; a re-export drops the shas for what it rewrote, which is
correct (the bytes changed), and the next run of `store_glbs.py` records the
new ones.

Everything here is deterministic and idempotent: a blob's name is its
content, the `.gz` is `glbgz.compress` of those bytes (reusing the fresh
`<name>.glb.gz` beside the source, which is the same bytes), and a manifest
is rewritten only when its content would change.

A blob may be EVICTED locally once the volume holds it (`evict_glbs.py`,
`features/mesh-asset-size` "Local eviction"): the store's `.on-volume.json`
(`bf42/onvolume.py`, written by the publisher from its volume listing) names
it at its size, so `put` leaves it absent rather than writing it back, and
counts it as remote. The sha is still recorded in the manifest: the name
still resolves, to the volume's copy (and locally through `serve_viewer.py`).
"""

from __future__ import annotations

import hashlib
import json
import os
from dataclasses import dataclass, field
from pathlib import Path

from . import glbbr, glbgz, onvolume

STORE_DIR = "glbs"
RIG_INDEX_FORMAT = "bf1942-rig-index/1"


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def rig_index_stems(doc) -> list[str]:
    """The stems of the rig FILES a `viewmodels/index.json` names, whichever
    form it is: the bare array `extract_viewmodel.py` writes for a tree of
    per-pair rigs, or the object form (`format` + `rigs`, this store's and
    the single-rig world's). A `pairs` row is not a file; `rig_pair_stems`
    is the union a coverage check wants."""
    if isinstance(doc, list):
        return [str(stem) for stem in doc]
    if isinstance(doc, dict) and isinstance(doc.get("rigs"), list):
        return [str(stem) for stem in doc["rigs"]]
    return []


def rig_index_pairs(doc) -> dict[str, dict]:
    """The `pairs` rows of a `viewmodels/index.json` (bf1942-rig-index/2,
    `extract_viewmodel.py`): pair stem -> `{"rig": <file stem>, ...}` for the
    (soldier, weapon) pairs served by another soldier's rig file painted with
    this soldier's textures. Empty for the array form and for /1."""
    if isinstance(doc, dict) and isinstance(doc.get("pairs"), dict):
        return {str(stem): row for stem, row in doc["pairs"].items()
                if isinstance(row, dict) and isinstance(row.get("rig"), str)}
    return {}


def rig_pair_stems(doc) -> list[str]:
    """Every (soldier, weapon) pair a `viewmodels/index.json` can serve a rig
    for: the rig files plus the painted `pairs` rows. The audits ask this one
    ("does the pair have first-person arms?"); the store and the loaders ask
    `rig_index_stems` (which stems are files)."""
    stems = rig_index_stems(doc)
    seen = {stem.lower() for stem in stems}
    for stem in rig_index_pairs(doc):
        if stem.lower() not in seen:
            seen.add(stem.lower())
            stems.append(stem)
    return stems


def rig_pair_files(doc) -> dict[str, str]:
    """Lower-cased pair stem -> the stem of the rig FILE that serves it: a
    file rig serves itself, a `pairs` row its target. A reader that opens
    `<stem>.fp.glb` by pair resolves through this (`conformance_weapons`)."""
    files = {stem.lower(): stem for stem in rig_index_stems(doc)}
    for stem, row in rig_index_pairs(doc).items():
        files.setdefault(stem.lower(), row["rig"])
    return files


@dataclass
class Result:
    files: int = 0                  # glbs a manifest names and the tree holds
    bytes: int = 0                  # their stored (per-tree) size
    distinct: int = 0               # blobs they resolve to
    distinct_bytes: int = 0
    blobs_written: int = 0          # blobs new to the store this run
    gz_written: int = 0
    recorded: int = 0               # name -> sha entries written
    remote: int = 0                 # blobs left absent: evicted, held by the volume
    manifests: list[str] = field(default_factory=list)   # rewritten files

    def add(self, other: "Result") -> None:
        self.files += other.files
        self.bytes += other.bytes
        self.distinct += other.distinct
        self.distinct_bytes += other.distinct_bytes
        self.blobs_written += other.blobs_written
        self.gz_written += other.gz_written
        self.recorded += other.recorded
        self.remote += other.remote
        self.manifests += other.manifests


class BlobStore:
    """`<mesh root>/glbs`: one file per distinct glb, named by its bytes."""

    def __init__(self, mesh_root: Path) -> None:
        self.mesh_root = Path(mesh_root)
        self.root = self.mesh_root / STORE_DIR
        self._record: onvolume.VolumeRecord | None = None

    @property
    def record(self) -> onvolume.VolumeRecord:
        """What the volume is known to hold (`.on-volume.json`), read once."""
        if self._record is None:
            self._record = onvolume.VolumeRecord.load(self.root)
        return self._record

    def remote_only(self, sha: str, size: int) -> bool:
        """The blob is absent here and the volume holds it at `size`: it was
        evicted, and must not be written back."""
        return not self.path(sha).exists() and self.record.holds(f"{sha}.glb", size)

    def path(self, sha: str) -> Path:
        return self.root / f"{sha}.glb"

    def gz(self, sha: str) -> Path:
        return self.root / f"{sha}.glb{glbgz.SUFFIX}"

    def put(self, data: bytes, sha: str, source: Path, verify: bool = False) -> tuple[bool, bool]:
        """Store `data` and its gzip once. Returns (blob written, gz written).

        An existing blob is trusted by its size (its name is its content and
        only this module writes one); `verify` byte-compares it instead. A
        size mismatch is always an error: the store is corrupt, or sha256
        collided, and either deserves a stop."""
        target = self.path(sha)
        wrote_blob = False
        if self.remote_only(sha, len(data)):
            # Evicted: the volume holds these bytes (the name is the content,
            # the record vouches for the size). Nothing is written, not even a
            # copy the record lacks: a `.gz` with no blob beside it is an
            # orphan the publisher refuses.
            return False, False
        if target.exists():
            held = target.stat().st_size
            if held != len(data):
                raise ValueError(f"{target} holds {held} bytes where {source} has "
                                 f"{len(data)}: the store is corrupt")
            if verify and target.read_bytes() != data:
                raise ValueError(f"{target} does not hold the bytes its name says "
                                 f"(checked against {source})")
        else:
            self.root.mkdir(parents=True, exist_ok=True)
            wrote_blob = _write_once(target, data)
        return wrote_blob, self._put_copies(data, sha, source)

    def _put_copies(self, data: bytes, sha: str, source: Path) -> bool:
        """The blob's `.gz` (always) and `.br` (when a fresh one sits beside
        the source). Returns whether a `.gz` was written."""
        wrote_gz = False
        gz_target = self.gz(sha)
        if not gz_target.exists():
            side = glbgz.gz_path(source)
            if side.is_file() and glbgz.is_fresh(data, side):
                # glbgz is deterministic, so the fresh copy beside the source
                # is byte for byte what compress(data) would give.
                payload = side.read_bytes()
            else:
                payload = glbgz.compress(data)
            wrote_gz = _write_once(gz_target, payload)
        # The .br (phase 2b) rides along only when a fresh one sits beside the
        # source: compressing here would turn a seconds-per-tree sweep into
        # minutes per big glb, and a blob without one is served gzip as before.
        br_target = self.root / f"{sha}.glb{glbbr.SUFFIX}"
        if not br_target.exists():
            br_side = glbbr.br_path(source)
            if br_side.is_file() and glbbr.is_fresh(data, br_side):
                _write_once(br_target, br_side.read_bytes())
        return wrote_gz


def _write_once(target: Path, data: bytes) -> bool:
    """Write `target` unless it exists; never replace it (another worker may
    have just written the same content, and blobs are shared)."""
    tmp = target.with_name(f".{target.name}.{os.getpid()}.tmp")
    tmp.write_bytes(data)
    try:
        os.link(tmp, target)
        return True
    except FileExistsError:
        return False
    finally:
        tmp.unlink()


def _store_named(tree: Path, names: list[str], store: BlobStore, verify: bool,
                 result: Result) -> dict[str, str]:
    """Store every `tree/<name>` that exists; name -> sha for those."""
    shas: dict[str, str] = {}
    seen: set[str] = set()
    for name in names:
        path = tree / name
        if not path.is_file():
            continue
        data = path.read_bytes()
        sha = sha256_bytes(data)
        result.remote += store.remote_only(sha, len(data))
        wrote_blob, wrote_gz = store.put(data, sha, path, verify=verify)
        shas[name] = sha
        result.files += 1
        result.bytes += len(data)
        result.blobs_written += wrote_blob
        result.gz_written += wrote_gz
        if sha not in seen:
            seen.add(sha)
            result.distinct += 1
            result.distinct_bytes += len(data)
    return shas


def _write_if_changed(path: Path, text: str, result: Result) -> None:
    if path.read_text() != text:
        # Through the inode (write_text truncates in place), as the extractors
        # and optimise_mesh.py write, so a hard-link mirror sees the change.
        path.write_text(text)
        result.manifests.append(str(path))


def _record_models(tree: Path, store: BlobStore, verify: bool, result: Result) -> None:
    manifest = tree / "models.json"
    if not manifest.is_file():
        return
    try:
        rows = json.loads(manifest.read_text())
    except ValueError:
        return
    if not isinstance(rows, list):
        return
    names: list[str] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        for key in ("glb", "cockpit"):
            if isinstance(row.get(key), str):
                names.append(row[key])
        for variant in row.get("variants") or []:
            if isinstance(variant, dict) and isinstance(variant.get("glb"), str):
                names.append(variant["glb"])
    shas = _store_named(tree, sorted(set(names)), store, verify, result)
    for row in rows:
        if not isinstance(row, dict):
            continue
        for key, sha_key in (("glb", "sha"), ("cockpit", "cockpitSha")):
            sha = shas.get(row.get(key)) if isinstance(row.get(key), str) else None
            if sha:
                result.recorded += 1
                row[sha_key] = sha
            else:
                row.pop(sha_key, None)
        for variant in row.get("variants") or []:
            if not isinstance(variant, dict):
                continue
            sha = shas.get(variant.get("glb")) if isinstance(variant.get("glb"), str) else None
            if sha:
                result.recorded += 1
                variant["sha"] = sha
            else:
                variant.pop("sha", None)
    _write_if_changed(manifest, json.dumps(rows, indent=2), result)


def _record_rigs(tree: Path, store: BlobStore, verify: bool, result: Result) -> None:
    manifest = tree / "viewmodels" / "index.json"
    if not manifest.is_file():
        return
    try:
        doc = json.loads(manifest.read_text())
    except ValueError:
        return
    stems = rig_index_stems(doc)
    if not stems:
        return
    files = [f"{stem}.fp.glb" for stem in stems]
    shas = _store_named(tree / "viewmodels", files, store, verify, result)
    result.recorded += len(shas)
    # A /2 index (the single-rig world) keeps its format and its `pairs`
    # rows: they name no file of their own, so they carry no sha — the pair
    # resolves to its target rig's.
    held_format = (doc.get("format") if isinstance(doc, dict) else None) or RIG_INDEX_FORMAT
    out = {"format": held_format, "rigs": stems}
    pairs = rig_index_pairs(doc)
    if pairs:
        out["pairs"] = {stem: pairs[stem] for stem in sorted(pairs)}
    out["sha"] = {name: shas[name] for name in sorted(shas)}
    _write_if_changed(manifest, json.dumps(out, indent=1) + "\n", result)


def _record_poses(tree: Path, store: BlobStore, verify: bool, result: Result) -> None:
    poses = tree / "poses"
    manifest = poses / "index.json"
    if not manifest.is_file():
        return
    try:
        doc = json.loads(manifest.read_text())
    except ValueError:
        return
    if not isinstance(doc, dict) or "glb" not in doc:
        return
    # The stems the index advertises, plus every glb in a subdirectory (the
    # rigs and gait bundles the split poses and the pages load by path).
    names = [f"{stem}.pose.glb" for stem in doc.get("glb") or []]
    for sub in sorted(p for p in poses.iterdir() if p.is_dir()):
        names += sorted(f"{sub.name}/{p.name}" for p in sub.glob("*.glb"))
    shas = _store_named(poses, names, store, verify, result)
    result.recorded += len(shas)
    doc["sha"] = {name: shas[name] for name in sorted(shas)}
    _write_if_changed(manifest, json.dumps(doc, indent=1) + "\n", result)


def store_tree(tree: Path, mesh_root: Path, verify: bool = False) -> Result:
    """Run the store over one model tree (`viewer/models`, or
    `viewer/models/mods/<m>`): hash what its manifests name, write the blobs
    under `mesh_root/glbs`, and record the shas back into the manifests."""
    store = BlobStore(mesh_root)
    result = Result()
    _record_models(tree, store, verify, result)
    _record_rigs(tree, store, verify, result)
    _record_poses(tree, store, verify, result)
    return result
