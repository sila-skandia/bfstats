#!/usr/bin/env python3
"""Publish what changed under the mesh viewer's asset trees to the assets volume.

    scripts/publish-mesh-delta.py                 # models, then maps
    scripts/publish-mesh-delta.py maps --streams 8
    scripts/publish-mesh-delta.py --dry-run       # say what would go, send nothing
    scripts/publish-mesh-delta.py maps --hash     # also catch same-size edits

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
import subprocess
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
VIEWER = ROOT / "tools" / "bf1942-models" / "viewer"
STATE = Path.home() / ".cache" / "mesh-publish"
MANIFESTS = {"maps.json", "models.json", "mods.json", "kits.json"}
UNIT_BYTES = 48 * 1000 * 1000
SKIP_SUFFIXES = (".tmp", ".orig", ".pyc")


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
        """Every file under the tree with its size, fetched so it cannot be cut short."""
        dest = f"/mnt/assets/mesh/{tree}"
        tmp = f"/tmp/mesh-{tree}-listing.txt"
        counted = self.run("sh", "-c", f"mkdir -p '{dest}' && cd '{dest}' && "
                           f"find . -type f -exec stat -c '%s %n' {{}} + > {tmp}; wc -l < {tmp}",
                           text=True).stdout.strip()
        raw = self.run("sh", "-c", f"gzip -c {tmp}; rm -f {tmp}").stdout
        lines = gzip.decompress(raw).decode("utf-8", "replace").splitlines() if raw else []
        if str(len(lines)) != counted:
            sys.exit(f"{tree}: listing arrived short ({len(lines)} of {counted} lines); try again")
        out: dict[str, int] = {}
        for line in lines:
            size, _, name = line.partition(" ")
            out[name[2:] if name.startswith("./") else name] = int(size)
        return out

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


def local_files(tree: str) -> dict[str, int]:
    out: dict[str, int] = {}
    base = VIEWER / tree
    for root, _dirs, files in os.walk(base, followlinks=False):
        for name in files:
            path = Path(root) / name
            rel = str(path.relative_to(base))
            if path.is_symlink() or ".bak" in rel or rel.endswith(SKIP_SUFFIXES):
                continue
            out[rel] = path.stat().st_size
    return out


def rank(rel: str) -> tuple:
    """Vanilla before the mods, a mod's `_shared` before its levels."""
    parts = rel.split("/")
    mod = parts[1] if parts[0] == "mods" and len(parts) > 2 else ""
    return (0 if not mod else 1, mod, 0 if "_shared" in rel else 1, rel)


def publish(volume, tree: str, streams: int, dry_run: bool, *,
            hashes: HashManifest | None = None, hash_remote: bool = False,
            list_files: bool = False) -> bool:
    local = local_files(tree)
    remote = volume.listing(tree)
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
    total = sum(local[r] for r in send)
    print(f"{tree}: {len(local)} local, {len(remote)} on the volume, "
          f"{len(send)} to send ({total / 1e9:.2f} GB), "
          f"{sum(1 for r in remote if r not in local)} on the volume only (left alone)", flush=True)
    if hashes is not None:
        print(f"{tree}: {len(same_size_changed)} of them the same size with new content; "
              f"{len(unverified)} same-size files have no recorded hash"
              f"{' (--hash-remote checks them)' if unverified else ''}", flush=True)
        if not dry_run:
            hashes.save()
    if list_files:
        for rel in sorted(send, key=rank):
            print(f"  {rel}")
    if dry_run or not send:
        return True

    last = [r for r in send if os.path.basename(r) in MANIFESTS]
    body = sorted((r for r in send if r not in set(last)), key=rank)
    units: list[list[str]] = []
    current: list[str] = []
    weight = 0
    for rel in body:
        if current and weight + local[rel] > UNIT_BYTES:
            units.append(current)
            current, weight = [], 0
        current.append(rel)
        weight += local[rel]
    if current:
        units.append(current)

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


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("trees", nargs="*", choices=["models", "maps"], default=None)
    ap.add_argument("--streams", type=int, default=8)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--list", action="store_true",
                    help="print every file that would be (or is being) sent")
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
    trees = [t for t in (args.trees or ["models", "maps"]) if (VIEWER / t).is_dir()]
    for tree in set(args.trees or ["models", "maps"]) - set(trees):
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
                     hash_remote=args.hash_remote, list_files=args.list) and ok
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
