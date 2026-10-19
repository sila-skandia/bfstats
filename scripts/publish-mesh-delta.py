#!/usr/bin/env python3
"""Publish what changed under the mesh viewer's asset trees to the assets volume.

    scripts/publish-mesh-delta.py                 # textures, models, then maps
    scripts/publish-mesh-delta.py maps --streams 8
    scripts/publish-mesh-delta.py --dry-run       # say what would go, send nothing
    scripts/publish-mesh-delta.py maps --hash     # also catch same-size edits

`textures/` is the store the glbs point at (`features/mesh-asset-size`); it goes
first, so no glb lands before the textures it draws with. Its files are named
by their content and never change. `glbs/` is the same pattern for whole model,
rig and pose glbs (phase 5, `store_glbs.py`): it goes after `textures/` and
before `models/`, so no manifest advertises a blob the volume does not hold --
the manifests (which carry the `name -> sha` tables) already go last within
their tree. Blobs recorded only by an unpublished mod's manifests stay home
with the rest of that mod.

The mesh image carries the viewer's code; `models/` and `maps/` come from the
PVC (`deploy/app/mesh-deployment.yaml`), and this uploads exactly the files in
`tools/bf1942-models/viewer/{models,maps}` that are absent from the volume or a
different size there. `upload-mesh-assets.sh` tars a whole tree and
`upload-mesh-maps-resumable.sh` skips a level whose file COUNT matches, which
is the wrong test after a re-extract: every `scene.glb` changes and no count
does.

Three things learnt the slow way (2026-09-20, a 15 GB re-extract):

* One `kubectl exec` stream to Hetzner tops out near 1 MB/s whatever the
  uplink is - one TCP connection, a long round trip, tunnelled through the API
  server. Eight streams moved 15 GB in 51 minutes; one would have taken four
  hours. So files are packed into units of about 48 MB and sent in parallel.
* A large listing streamed straight out of `kubectl exec` can arrive
  TRUNCATED with no error (30,707 of 35,471 lines once), which reads as
  thousands of missing files. The listing is written to a file on the pod,
  its line count is taken there, and it is fetched gzipped and checked
  against that count.
* `gzip -1` on the wire is worth having: a `scene.glb` shrinks 15-27%.

Size alone misses an edit that keeps the length, which is the common case
for a layer patch (`patch_scene.py`): `timeToGetControl 10` -> `20` is the
same number of bytes. `--hash` adds a content compare. Every file this script
lands is recorded, with its size, mtime and sha256, in a hash manifest
(`~/.cache/mesh-publish/hashes-<tree>.json`); a file the volume holds at the
local size is then sent anyway when its content no longer matches the record.
The mtime is only a shortcut (an untouched file is not re-hashed); a touched
file is hashed and sent only if its content moved. A same-size file with no
record is reported as unverified; `--hash-remote` settles those by hashing
them on the pod once and recording the answer. The full bake is deterministic
(two bakes of one level give a byte-identical `scene.glb`, pinned by
`tools/bf1942-models/tests/test_scene_layers.py`), so an unchanged glb is
never sent under either compare.

`--remote-manifest FILE` reads the volume's state from a hash manifest instead
of the cluster (no kubectl; `--write-manifest FILE` records one from a local
tree), which is how a scratch tree's dry run says what a change would send.

Every glb goes with the `<name>.glb.gz` beside it, which nginx's
`gzip_static` sends to clients that take gzip (`features/mesh-asset-size`,
phase 2a; `tools/bf1942-models/optimise_mesh.py` writes it). The two go in one
unit, the `.gz` is sent whenever its glb is, and nothing is sent if a `.gz` does
not inflate to the glb beside it (its gzip trailer's CRC-32 and length, checked
against the glb) or is missing: a stale `.gz` on the volume is what most
clients would get. `--allow-plain` lets a glb with no `.gz` go, served plain,
unless the volume holds a `.gz` for it.

A `<name>.glb.br` (phase 2b, written for the glbs of 4 MB and up) rides the
same way: in its glb's unit, checked before anything goes. A `.br` is OPTIONAL
-- a glb without one is served gzip as before -- but one that exists must
inflate to its glb, read from the metadata meta-block `bf42/glbbr.py` opens
the stream with (the glb's CRC-32 and length; brotli itself records nothing),
and a glb that changes while the volume holds a `.br` for it must bring a new
one: brotli_static would go on sending the old bytes to every browser.

Every unit's landed sizes are checked against the local ones; manifests
(`maps.json`, `models.json`, `mods.json`, `kits.json`) go last, because they
are what advertises the rest; a finished unit is recorded under
`~/.cache/mesh-publish/` so a re-run resumes; nothing on the volume is ever
deleted. Publish re-extracted LEVELS only after the viewer code that reads
them is live (the image deploys itself from main): a multi-mode `scene.glb`
on an older page shows every mode's vehicles at once.
"""
from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import os
import re
import struct
import subprocess
import sys
import threading
import time
import zlib
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
VIEWER = ROOT / "tools" / "bf1942-models" / "viewer"
STATE = Path.home() / ".cache" / "mesh-publish"
TREES = ["textures", "glbs", "models", "maps"]
MANIFESTS = {"maps.json", "models.json", "mods.json", "kits.json", "index.json"}
# Mods kept in the local tree but removed from the volume (owner's call): their
# files are never sent, and their rows are stripped from models/mods.json on the
# way up. dc_final: deleted remotely 2026-10-19, local tree kept for when DC
# parity resumes.
UNPUBLISHED_MODS = {"dc_final"}
UNIT_BYTES = 48 * 1000 * 1000
SKIP_SUFFIXES = (".tmp", ".orig", ".pyc")
GZ_SUFFIX = ".gz"
BR_SUFFIX = ".br"
# The .br's first 19 bytes: a metadata meta-block (RFC 7932) bf42/glbbr.py
# writes, carrying this magic and the CRC-32 and length of the glb it inflates
# to -- the gzip trailer's job, done at the front because brotli has no trailer.
BR_MAGIC = b"GBR1"


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as fh:
        for block in iter(lambda: fh.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


class HashManifest:
    """`rel -> {size, mtime, sha}` of what was last landed on the volume."""

    def __init__(self, path: Path) -> None:
        self.path = path
        try:
            self.rows: dict[str, dict] = json.loads(path.read_text())
        except (OSError, ValueError):
            self.rows = {}

    def content_hash(self, root: Path, rel: str, size: int) -> str:
        """The local file's sha256, re-read only if it was touched since the
        record (a record's own mtime and size vouch for an untouched file)."""
        path = root / rel
        mtime = path.stat().st_mtime_ns
        row = self.rows.get(rel)
        if row and row["size"] == size and row["mtime"] == mtime:
            return row["sha"]
        return sha256(path)

    def record(self, root: Path, rel: str, sha: str | None = None) -> None:
        path = root / rel
        st = path.stat()
        self.rows[rel] = {"size": st.st_size, "mtime": st.st_mtime_ns,
                          "sha": sha or sha256(path)}

    def save(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.path.with_suffix(".tmp")
        tmp.write_text(json.dumps(self.rows, sort_keys=True))
        tmp.replace(self.path)


class ManifestVolume:
    """The volume as a hash manifest says it is: a dry run with no cluster."""

    def __init__(self, path: Path) -> None:
        self.manifest = HashManifest(path)

    def listing(self, tree: str) -> dict[str, int]:
        return {rel: row["size"] for rel, row in self.manifest.rows.items()}


class Volume:
    def __init__(self, context: str, namespace: str) -> None:
        self.kube = ["kubectl", "--context", context, "-n", namespace]
        # Tell "the API is unreachable" apart from "the deployment is scaled to
        # zero". An empty `get pods` means both, and saying only the second sent
        # somebody scaling a filebrowser that had been running for sixteen days
        # while the real problem was a VPN holding the API port open-circuit
        # (2026-09-22). kubectl's own exit code and stderr distinguish them.
        got = subprocess.run(self.kube + ["get", "pods", "-l", "app=filebrowser", "-o",
                                          "jsonpath={.items[0].metadata.name}"],
                             capture_output=True, text=True)
        pod = got.stdout.strip()
        if not pod:
            err = (got.stderr or "").strip()
            if got.returncode != 0 or err:
                sys.exit("cannot reach the cluster, so whether a filebrowser pod "
                         f"exists is unknown -- fix this first:\n  {err.splitlines()[-1] if err else f'kubectl exited {got.returncode}'}")
            sys.exit("the cluster answered and there is no filebrowser pod: "
                     "scale it up first")
        self.pod = pod

    def run(self, *args: str, **kwargs) -> subprocess.CompletedProcess:
        return subprocess.run(self.kube + ["exec", "-c", "filebrowser", self.pod, "--", *args],
                              capture_output=True, **kwargs)

    def listing(self, tree: str) -> dict[str, int]:
        """Every file under the tree with its size, fetched so it cannot be cut short.

        The listing is compressed into a pod file and read back in bounded
        chunks: the maps tree is over 100k files, and one `kubectl exec`
        stream carrying the whole gz has died mid-flight more than once
        (the same closed-stream failure that kills long upload legs).
        """
        dest = f"/mnt/assets/mesh/{tree}"
        tmp = f"/tmp/mesh-{tree}-listing.txt"
        counted = self.run("sh", "-c", f"mkdir -p '{dest}' && cd '{dest}' && "
                           f"find . -type f -exec stat -c '%s %n' {{}} + > {tmp}; wc -l < {tmp}",
                           text=True).stdout.strip()
        gz = f"{tmp}.gz"
        size = int(self.run("sh", "-c", f"gzip -c {tmp} > {gz}; rm -f {tmp}; wc -c < {gz}",
                            text=True).stdout.strip() or 0)
        raw = bytearray()
        chunk = 4 * 1024 * 1024
        while len(raw) < size:
            want = min(chunk, size - len(raw))
            part = self.run("sh", "-c", f"tail -c +{len(raw) + 1} {gz} | head -c {want}").stdout
            if not part:
                break
            raw.extend(part)
        self.run("sh", "-c", f"rm -f {gz}")
        lines = gzip.decompress(bytes(raw)).decode("utf-8", "replace").splitlines() if raw else []
        if str(len(lines)) != counted:
            sys.exit(f"{tree}: listing arrived short ({len(lines)} of {counted} lines); try again")
        out: dict[str, int] = {}
        for line in lines:
            size, _, name = line.partition(" ")
            out[name[2:] if name.startswith("./") else name] = int(size)
        return out

    def send_bytes(self, tree: str, rel: str, data: bytes) -> bool:
        """Land one file whose content differs from the local tree (the
        filtered mods.json), atomically, and verify its landed size."""
        dest = f"/mnt/assets/mesh/{tree}/{rel}"
        script = 'cat > "$1.tmp" && mv "$1.tmp" "$1"'
        put = subprocess.run(self.kube + ["exec", "-i", "-c", "filebrowser", self.pod, "--",
                                          "sh", "-c", script, "sh", dest],
                             input=data, capture_output=True)
        if put.returncode != 0:
            return False
        out = self.run("stat", "-c", "%s", dest, text=True).stdout.strip()
        return out == str(len(data))

    def remote_hashes(self, tree: str, rels: list[str]) -> dict[str, str]:
        """sha256 of each named file on the volume (read on the pod)."""
        dest = f"/mnt/assets/mesh/{tree}"
        script = 'cd "$1" && shift && sha256sum -- "$@" 2>/dev/null'
        out: dict[str, str] = {}
        for i in range(0, len(rels), 200):
            text = self.run("sh", "-c", script, "sh", dest, *rels[i:i + 200], text=True).stdout
            for line in text.splitlines():
                digest, _, name = line.partition("  ")
                out[name] = digest
        return out

    def send(self, tree: str, rels: list[str]) -> bool:
        dest = f"/mnt/assets/mesh/{tree}"
        tar = subprocess.Popen(["tar", "-C", str(VIEWER / tree), "-I", "gzip -1", "-cf", "-", "-T", "-"],
                               stdin=subprocess.PIPE, stdout=subprocess.PIPE)
        unpack = subprocess.Popen(self.kube + ["exec", "-i", "-c", "filebrowser", self.pod, "--",
                                               "tar", "xzf", "-", "-C", dest], stdin=tar.stdout)
        tar.stdin.write(("\n".join(rels) + "\n").encode())
        tar.stdin.close()
        tar.stdout.close()
        if not (unpack.wait() == 0 and tar.wait() == 0):
            return False
        # Names go as positional arguments, never into the remote quoting: EoD
        # has levels called `charlie_don't_surf` and `who'll_stop_the_rain`.
        script = ('cd "$1" && shift && for f in "$@"; do '
                  'stat -c "%s %n" "$f" 2>/dev/null || echo "-1 $f"; done')
        landed: dict[str, int] = {}
        for i in range(0, len(rels), 200):
            out = self.run("sh", "-c", script, "sh", dest, *rels[i:i + 200], text=True).stdout
            for line in out.splitlines():
                size, _, name = line.partition(" ")
                landed[name] = int(size)
        return all(landed.get(r) == (VIEWER / tree / r).stat().st_size for r in rels)


def manifest_blob_shas(tree_dir: Path) -> set[str]:
    """Every blob sha a model tree's manifests record (`bf42/glbstore.py`
    writes them: models.json rows' `sha`/`cockpitSha` and variant `sha`s, and
    the `sha` tables of viewmodels/index.json and poses/index.json)."""
    out: set[str] = set()

    def doc(path: Path):
        try:
            return json.loads(path.read_text())
        except (OSError, ValueError):
            return None
    rows = doc(tree_dir / "models.json")
    for row in rows if isinstance(rows, list) else []:
        if not isinstance(row, dict):
            continue
        out |= {row.get("sha"), row.get("cockpitSha")}
        out |= {v.get("sha") for v in row.get("variants") or [] if isinstance(v, dict)}
    for rel in ("viewmodels/index.json", "poses/index.json"):
        index = doc(tree_dir / rel)
        if isinstance(index, dict) and isinstance(index.get("sha"), dict):
            out |= set(index["sha"].values())
    return {sha for sha in out if isinstance(sha, str) and sha}


def unpublished_blobs() -> set[str]:
    """The `glbs/` files only an unpublished mod's manifests record. A blob a
    published tree also records stays in: blobs are shared, and the sha says
    the content is the same."""
    unpublished: set[str] = set()
    for mod in UNPUBLISHED_MODS:
        unpublished |= manifest_blob_shas(VIEWER / "models" / "mods" / mod)
    if not unpublished:
        return set()
    published = manifest_blob_shas(VIEWER / "models")
    mods = VIEWER / "models" / "mods"
    if mods.is_dir():
        for tree_dir in sorted(p for p in mods.iterdir() if p.is_dir()):
            if tree_dir.name not in UNPUBLISHED_MODS:
                published |= manifest_blob_shas(tree_dir)
    held = unpublished - published
    return {f"{sha}.glb{tail}" for sha in held for tail in ("", GZ_SUFFIX, BR_SUFFIX)}


def local_files(tree: str) -> dict[str, int]:
    out: dict[str, int] = {}
    base = VIEWER / tree
    held_back = unpublished_blobs() if tree == "glbs" else set()
    for root, _dirs, files in os.walk(base, followlinks=False):
        for name in files:
            path = Path(root) / name
            rel = str(path.relative_to(base))
            if path.is_symlink() or ".bak" in rel or rel.endswith(SKIP_SUFFIXES):
                continue
            parts = rel.split("/", 2)
            if parts[0] == "mods" and len(parts) > 1 and parts[1] in UNPUBLISHED_MODS:
                continue
            if rel in held_back:
                continue
            out[rel] = path.stat().st_size
    return out


def filtered_mods_json() -> bytes | None:
    """models/mods.json as the volume should hold it, with the unpublished
    mods' rows stripped -- or None when nothing needs stripping, in which case
    the file goes up unchanged like any other manifest."""
    path = VIEWER / "models" / "mods.json"
    if not UNPUBLISHED_MODS or not path.is_file():
        return None
    try:
        doc = json.loads(path.read_text())
    except ValueError:
        return None
    rows = doc.get("mods")
    if isinstance(rows, list):
        kept = [r for r in rows if r.get("id") not in UNPUBLISHED_MODS]
        if len(kept) == len(rows):
            return None
        doc["mods"] = kept
    elif isinstance(rows, dict):
        if not (set(rows) & UNPUBLISHED_MODS):
            return None
        doc["mods"] = {k: v for k, v in rows.items() if k not in UNPUBLISHED_MODS}
    else:
        return None
    return (json.dumps(doc, indent=1) + "\n").encode()


def plain_name(rel: str) -> str:
    """The glb a compressed sibling belongs to, or `rel` itself."""
    for suffix in (GZ_SUFFIX, BR_SUFFIX):
        if rel.endswith(".glb" + suffix):
            return rel[:-len(suffix)]
    return rel


def rank(rel: str) -> tuple:
    """Vanilla before the mods, a mod's `_shared` before its levels, and a
    glb's `.gz` then `.br` straight after it."""
    plain = plain_name(rel)
    copy = 0 if rel == plain else (1 if rel.endswith(GZ_SUFFIX) else 2)
    parts = plain.split("/")
    mod = parts[1] if parts[0] == "mods" and len(parts) > 2 else ""
    return (0 if not mod else 1, mod, 0 if "_shared" in plain else 1, plain, copy)


def glb_crc32(glb: Path) -> int:
    running = 0
    with glb.open("rb") as fh:
        for block in iter(lambda: fh.read(1 << 20), b""):
            running = zlib.crc32(block, running)
    return running


def gz_fresh(glb: Path, gz: Path, crc: int | None = None) -> bool:
    """Whether `gz` inflates to `glb`, by its trailer: the CRC-32 and length
    (mod 2**32) of the uncompressed bytes (`bf42/glbgz.py` writes them)."""
    try:
        with gz.open("rb") as fh:
            if fh.read(2) != b"\x1f\x8b" or gz.stat().st_size < 18:
                return False
            fh.seek(-8, os.SEEK_END)
            trailer_crc, size = struct.unpack("<II", fh.read(8))
    except OSError:
        return False
    if size != glb.stat().st_size & 0xFFFFFFFF:
        return False
    return (glb_crc32(glb) if crc is None else crc) == trailer_crc


def br_meta(head: bytes) -> tuple[int, int] | None:
    """(crc32, length) from the metadata meta-block a pipeline `.br` opens
    with, or None for anything else (mirrors `bf42/glbbr.py`: the WBITS code
    is 1, 4 or 7 bits, the block header 14 more, zero-filled to the byte
    boundary the payload -- BR_MAGIC, CRC-32, u64 length -- starts on, all
    within the first 19 bytes)."""
    if len(head) < 18:
        return None
    byte0 = head[0]
    if not byte0 & 1:
        wbits = 1
    elif (byte0 >> 1) & 0b111:
        wbits = 4
    elif (byte0 >> 4) & 0b111 == 1:
        return None
    else:
        wbits = 7
    bits = byte0 & ((1 << wbits) - 1)
    at = wbits
    for value, width in ((0, 1), (3, 2), (0, 1), (1, 2), (15, 8)):
        bits |= value << at
        at += width
    header = bits.to_bytes((at + 7) // 8, "little")
    payload_at = len(header)
    if len(head) < payload_at + 16 or head[:payload_at] != header \
            or head[payload_at:payload_at + 4] != BR_MAGIC:
        return None
    crc, length = struct.unpack_from("<IQ", head, payload_at + 4)
    return crc, length


def br_fresh(glb: Path, br: Path, crc: int | None = None) -> bool:
    """Whether `br` inflates to `glb`, by the CRC-32 and length its metadata
    meta-block records (`bf42/glbbr.py` writes it; brotli has no trailer)."""
    try:
        with br.open("rb") as fh:
            meta = br_meta(fh.read(19))
    except OSError:
        return False
    if meta is None or meta[1] != glb.stat().st_size:
        return False
    return (glb_crc32(glb) if crc is None else crc) == meta[0]


def gzip_pairs(base: Path, local: dict[str, int], remote: dict[str, int], send: list[str],
               allow_plain: bool) -> tuple[list[str], list[str], list[str]]:
    """`send` with the `.gz` and `.br` of every glb in it added, the problems
    that must stop the publish, and the glbs that go without a `.gz`
    (`--allow-plain`). The `.gz` is required; the `.br` only has to exist for
    a glb the volume already holds one for, and be of this glb when it does."""
    out = list(send)
    going = set(send)
    problems: list[str] = []
    plain: list[str] = []
    glbs = {plain_name(r) for r in send if plain_name(r).endswith(".glb")}
    for glb in sorted(glbs):
        gz = glb + GZ_SUFFIX
        br = glb + BR_SUFFIX
        if glb not in local:
            problems.append(f"{gz}: there is no {os.path.basename(glb)} beside it")
            continue
        crc: int | None = None

        def checked(copy: Path, fresh) -> bool:
            nonlocal crc
            crc = glb_crc32(base / glb) if crc is None else crc
            return fresh(base / glb, copy, crc)

        if gz not in local:
            if gz in remote:
                problems.append(f"{glb}: no .gz here, and the volume's is of another copy")
            elif allow_plain:
                plain.append(glb)
            else:
                problems.append(f"{glb}: no .gz beside it")
        elif not checked(base / gz, gz_fresh):
            problems.append(f"{glb}: its .gz is of another copy")
        elif gz not in going:
            out.append(gz)
            going.add(gz)
        if br not in local:
            # Optional -- unless the volume keeps a .br, which brotli_static
            # would go on sending against the glb this publish lands.
            if br in remote:
                problems.append(f"{glb}: no .br here, and the volume's is of another copy")
        elif not checked(base / br, br_fresh):
            problems.append(f"{glb}: its .br is of another copy")
        elif br not in going:
            out.append(br)
            going.add(br)
    return out, problems, plain


def pack_units(rels: list[str], local: dict[str, int]) -> list[list[str]]:
    """The files in send order, cut into units of about UNIT_BYTES. A glb and
    its `.gz` and `.br` are never cut apart, so none lands a unit after the
    others."""
    units: list[list[str]] = []
    current: list[str] = []
    weight = 0
    for rel in sorted(rels, key=rank):
        paired = bool(current) and rel != plain_name(rel) \
            and plain_name(rel) == plain_name(current[-1])
        if current and weight + local[rel] > UNIT_BYTES and not paired:
            units.append(current)
            current, weight = [], 0
        current.append(rel)
        weight += local[rel]
    if current:
        units.append(current)
    return units


def publish(volume, tree: str, streams: int, dry_run: bool, *,
            hashes: HashManifest | None = None, hash_remote: bool = False,
            list_files: bool = False, allow_plain: bool = False) -> bool:
    local = local_files(tree)
    mods_json = filtered_mods_json() if tree == "models" else None
    if mods_json is not None:
        local.pop("mods.json", None)
    remote = volume.listing(tree)
    mods_json_due = False
    if mods_json is not None:
        if remote.get("mods.json") != len(mods_json):
            mods_json_due = True
        elif isinstance(volume, Volume):
            there = volume.remote_hashes(tree, ["mods.json"]).get("mods.json")
            mods_json_due = there != hashlib.sha256(mods_json).hexdigest()
    send = [r for r in local if remote.get(r) != local[r]]
    base = VIEWER / tree
    same_size_changed: list[str] = []
    unverified: list[str] = []
    local_sha: dict[str, str] = {}
    if hashes is not None:
        for rel in local:
            if remote.get(rel) != local[rel]:
                continue
            row = hashes.rows.get(rel)
            if row is None:
                unverified.append(rel)
                continue
            sha = local_sha[rel] = hashes.content_hash(base, rel, local[rel])
            if sha != row["sha"]:
                same_size_changed.append(rel)
            elif row["mtime"] != (base / rel).stat().st_mtime_ns and not dry_run:
                hashes.record(base, rel, sha)          # touched, not changed
        if unverified and hash_remote and isinstance(volume, Volume):
            there = volume.remote_hashes(tree, unverified)
            for rel in unverified:
                sha = local_sha[rel] = sha256(base / rel)
                if rel in there and there[rel] != sha:
                    same_size_changed.append(rel)
                elif rel in there and not dry_run:
                    hashes.record(base, rel, sha)
            unverified = [r for r in unverified if r not in there]
        send += same_size_changed
    send, problems, plain = gzip_pairs(base, local, remote, send, allow_plain)
    if problems:
        print(f"{tree}: {len(problems)} glbs and their .gz/.br disagree; nothing sent. Run "
              "tools/bf1942-models/optimise_mesh.py over them:", flush=True)
        for row in problems[:20]:
            print(f"  {row}")
        return False
    if plain:
        print(f"{tree}: {len(plain)} glbs go without a .gz (--allow-plain), served "
              "uncompressed", flush=True)
    total = sum(local[r] for r in send)
    print(f"{tree}: {len(local)} local, {len(remote)} on the volume, "
          f"{len(send)} to send ({total / 1e9:.2f} GB), "
          f"{sum(1 for r in remote if r not in local)} on the volume only (left alone)", flush=True)
    if mods_json is not None:
        which = "differs, goes filtered" if mods_json_due else "up to date"
        print(f"{tree}: mods.json carries unpublished mods "
              f"({', '.join(sorted(UNPUBLISHED_MODS))}); the filtered copy {which}", flush=True)
    if hashes is not None:
        print(f"{tree}: {len(same_size_changed)} of them the same size with new content; "
              f"{len(unverified)} same-size files have no recorded hash"
              f"{' (--hash-remote checks them)' if unverified else ''}", flush=True)
        if not dry_run:
            hashes.save()
    if not texture_check(base, [r for r in send if r.endswith(".glb")], tree):
        return False
    if not store_check(base, [r for r in send if os.path.basename(r) in
                              ("models.json", "index.json")], tree):
        return False
    if list_files:
        for rel in sorted(send, key=rank):
            mark = "  (manifest, lands last)" if os.path.basename(rel) in MANIFESTS else ""
            print(f"  {rel}{mark}")
    if dry_run or not (send or mods_json_due):
        return True

    last = [r for r in send if os.path.basename(r) in MANIFESTS]
    units = pack_units([r for r in send if r not in set(last)], local)

    STATE.mkdir(parents=True, exist_ok=True)
    state = STATE / f"done-{tree}.txt"
    done = set(state.read_text().splitlines()) if state.exists() else set()
    key = lambda unit: hashlib.sha1("\n".join(f"{r}:{local[r]}" for r in unit).encode()).hexdigest()
    todo = [u for u in units if key(u) not in done]
    lock = threading.Lock()
    sent = [0, 0]
    failed: list[list[str]] = []
    started = time.time()

    def work(unit: list[str]) -> tuple[list[str], bool]:
        return unit, (volume.send(tree, unit) or volume.send(tree, unit))

    with ThreadPoolExecutor(max_workers=streams) as pool:
        for future in as_completed([pool.submit(work, u) for u in todo]):
            unit, ok = future.result()
            with lock:
                if ok:
                    with state.open("a") as fh:
                        fh.write(key(unit) + "\n")
                    if hashes is not None:
                        for rel in unit:
                            hashes.record(base, rel, local_sha.get(rel))
                    sent[0] += sum(local[r] for r in unit)
                    sent[1] += 1
                else:
                    failed.append(unit)
                rate = sent[0] / 1e6 / max(time.time() - started, 1)
                more = f" +{len(unit) - 1}" if len(unit) > 1 else ""
                print(f"[{sent[1] + len(failed)}/{len(todo)}] {unit[0]}{more}: "
                      f"{'ok' if ok else 'FAILED'}  {sent[0] / 1e9:.2f}/{total / 1e9:.2f} GB, "
                      f"{rate:.1f} MB/s", flush=True)

    if failed:
        print(f"{tree}: {len(failed)} units failed; manifests held back. Re-run to resume.")
        return False
    if last and not volume.send(tree, last):
        print(f"{tree}: the manifests failed to land. Re-run.")
        return False
    if mods_json_due and not volume.send_bytes(tree, "mods.json", mods_json):
        print(f"{tree}: the filtered mods.json failed to land. Re-run.")
        return False
    if hashes is not None:
        for rel in last:
            hashes.record(base, rel, local_sha.get(rel))
        hashes.save()
    dest = f"/mnt/assets/mesh/{tree}"
    unreadable = volume.run("sh", "-c", f"chmod -R a+rX '{dest}' 2>/dev/null; find '{dest}' "
                            r"\( -type f ! -perm -o=r \) -o \( -type d ! -perm -o=rx \) | head -5",
                            text=True).stdout.strip()
    if unreadable:
        print(f"{tree}: unreadable to nginx, would 403:\n{unreadable}")
        return False
    state.unlink(missing_ok=True)
    print(f"{tree}: published in {(time.time() - started) / 60:.0f} min")
    return True


def store_check(base: Path, rels: list[str], tree: str) -> bool:
    """Every blob a manifest about to go advertises exists in the local store,
    at the size of the per-tree file it names. A glb rewritten in place after
    `store_glbs.py` last ran (a re-optimise, a hand edit) leaves the manifest's
    sha naming the OLD bytes, and every viewer would draw them; a blob missing
    locally means the store and the manifests are out of step. Stats only, so
    it costs nothing; a failure is settled by re-running store_glbs.py."""
    if tree != "models":
        return True
    problems: list[str] = []

    def claim(tree_rel_dir: str, name: str, sha: str) -> None:
        blob = VIEWER / "glbs" / f"{sha}.glb"
        named = base / tree_rel_dir / name if tree_rel_dir else base / name
        if not blob.is_file():
            problems.append(f"{tree_rel_dir or '.'}/{name} -> {sha}: no such blob in "
                            "the local store")
        elif named.is_file() and named.stat().st_size != blob.stat().st_size:
            problems.append(f"{tree_rel_dir or '.'}/{name}: its size no longer matches "
                            f"blob {sha} (rewritten since store_glbs.py last ran)")

    for rel in rels:
        name = os.path.basename(rel)
        folder = os.path.dirname(rel)
        try:
            doc = json.loads((base / rel).read_text())
        except (OSError, ValueError):
            continue
        if name == "models.json" and isinstance(doc, list):
            for row in doc:
                if not isinstance(row, dict):
                    continue
                if row.get("sha"):
                    claim(folder, row["glb"], row["sha"])
                if row.get("cockpitSha"):
                    claim(folder, row["cockpit"], row["cockpitSha"])
                for v in row.get("variants") or []:
                    if isinstance(v, dict) and v.get("sha"):
                        claim(folder, v["glb"], v["sha"])
        elif name == "index.json" and isinstance(doc, dict) and isinstance(doc.get("sha"), dict):
            for file, sha in doc["sha"].items():
                claim(folder, file, sha)
    if problems:
        print(f"{tree}: {len(problems)} manifest shas disagree with the store; nothing "
              "sent. Run tools/bf1942-models/store_glbs.py over the tree:", flush=True)
        for row in problems[:20]:
            print(f"  {row}")
        return False
    return True


def glb_images(path: Path) -> list[dict]:
    with open(path, "rb") as handle:
        head = handle.read(20)
        if len(head) < 20 or head[:4] != b"glTF":
            return []
        length = struct.unpack_from("<I", head, 12)[0]
        return json.loads(handle.read(length)).get("images", [])


def texture_check(base: Path, glbs: list[str], tree: str) -> bool:
    """Every texture a glb about to go points at is in the local store (a glb
    whose texture never lands draws untextured), and say how many still carry
    their textures inside (a bake that skipped optimise_mesh.py).

    A store blob (`glbs/`) is byte-identical to the per-tree glb it replaces,
    so its URIs are spelled from that ORIGINAL location (`../textures/...`
    from vanilla's depth, `../../../textures/...` from a mod's); the viewer
    resolves them against the original URL (glb-loader.js). Here they are
    checked where every depth lands: the shared store under the mesh root."""
    missing: list[str] = []
    embedded = 0
    climb = re.compile(r"^(\.\./)+")
    for rel in glbs:
        path = base / rel
        images = glb_images(path)
        if any("bufferView" in image for image in images):
            embedded += 1
        for image in images:
            uri = image.get("uri")
            if not uri or uri.startswith("data:"):
                continue
            target = VIEWER / climb.sub("", uri) if tree == "glbs" else path.parent / uri
            if not target.is_file():
                missing.append(f"{rel} -> {uri}")
    if embedded:
        print(f"{tree}: {embedded} of the glbs to send still embed their textures; "
              "run tools/bf1942-models/optimise_mesh.py over them first unless that is "
              "meant (a mod tree left as it was)", flush=True)
    if missing:
        print(f"{tree}: {len(missing)} textures the glbs point at are not in the local "
              "store; nothing sent:", flush=True)
        for row in missing[:20]:
            print(f"  {row}")
        return False
    return True


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("trees", nargs="*", choices=list(TREES), default=None)
    ap.add_argument("--streams", type=int, default=8)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--list", action="store_true",
                    help="print every file that would be (or is being) sent")
    ap.add_argument("--allow-plain", action="store_true",
                    help="send a glb that has no .gz beside it (served uncompressed), "
                         "unless the volume holds a .gz for it")
    ap.add_argument("--hash", action="store_true",
                    help="compare content as well as size, against the hash "
                         "manifest of what this script last landed")
    ap.add_argument("--hash-remote", action="store_true",
                    help="with --hash: sha256 the same-size files that have no "
                         "record, on the pod, and record the answer")
    ap.add_argument("--hash-manifest", type=Path, default=None,
                    help="the hash manifest (default "
                         "~/.cache/mesh-publish/hashes-<tree>.json)")
    ap.add_argument("--remote-manifest", type=Path, default=None,
                    help="read the volume's state from this hash manifest "
                         "instead of the cluster (implies --dry-run --hash)")
    ap.add_argument("--write-manifest", type=Path, default=None,
                    help="write a hash manifest of the local tree and exit")
    ap.add_argument("--root", type=Path, default=None,
                    help="the directory holding models/ and maps/ (default "
                         "tools/bf1942-models/viewer)")
    ap.add_argument("--context", default=os.environ.get("KUBE_CONTEXT", "hetzner"))
    ap.add_argument("--namespace", default=os.environ.get("KUBE_NS", "bf42-stats"))
    args = ap.parse_args()
    global VIEWER
    if args.root is not None:
        VIEWER = args.root.resolve()
    wanted = sorted(args.trees or TREES, key=TREES.index)
    trees = [t for t in wanted if (VIEWER / t).is_dir()]
    for tree in set(wanted) - set(trees):
        print(f"{tree}: nothing at {VIEWER / tree}")
    if args.write_manifest is not None:
        for tree in trees:
            manifest = HashManifest(args.write_manifest.with_name(
                args.write_manifest.name.replace("{tree}", tree)))
            manifest.rows = {}
            for rel in local_files(tree):
                manifest.record(VIEWER / tree, rel)
            manifest.save()
            print(f"{tree}: {len(manifest.rows)} files -> {manifest.path}")
        return 0
    ok = True
    for tree in trees:
        if args.remote_manifest is not None:
            path = args.remote_manifest.with_name(args.remote_manifest.name.replace("{tree}", tree))
            volume = ManifestVolume(path)
            hashes, dry_run = volume.manifest, True
        else:
            volume = Volume(args.context, args.namespace)
            hashes = (HashManifest(args.hash_manifest or STATE / f"hashes-{tree}.json")
                      if args.hash or args.hash_remote else None)
            dry_run = args.dry_run
        ok = publish(volume, tree, args.streams, dry_run, hashes=hashes,
                     hash_remote=args.hash_remote, list_files=args.list,
                     allow_plain=args.allow_plain) and ok
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
