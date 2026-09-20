#!/usr/bin/env python3
"""Publish what changed under the mesh viewer's asset trees to the assets volume.

    scripts/publish-mesh-delta.py                 # models, then maps
    scripts/publish-mesh-delta.py maps --streams 8
    scripts/publish-mesh-delta.py --dry-run       # say what would go, send nothing

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


class Volume:
    def __init__(self, context: str, namespace: str) -> None:
        self.kube = ["kubectl", "--context", context, "-n", namespace]
        pod = subprocess.run(self.kube + ["get", "pods", "-l", "app=filebrowser", "-o",
                                          "jsonpath={.items[0].metadata.name}"],
                             capture_output=True, text=True).stdout.strip()
        if not pod:
            sys.exit("no filebrowser pod; scale it up first")
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


def publish(volume: Volume, tree: str, streams: int, dry_run: bool) -> bool:
    local = local_files(tree)
    remote = volume.listing(tree)
    send = [r for r in local if remote.get(r) != local[r]]
    total = sum(local[r] for r in send)
    print(f"{tree}: {len(local)} local, {len(remote)} on the volume, "
          f"{len(send)} to send ({total / 1e9:.2f} GB), "
          f"{sum(1 for r in remote if r not in local)} on the volume only (left alone)", flush=True)
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
    ap.add_argument("--context", default=os.environ.get("KUBE_CONTEXT", "hetzner"))
    ap.add_argument("--namespace", default=os.environ.get("KUBE_NS", "bf42-stats"))
    args = ap.parse_args()
    volume = Volume(args.context, args.namespace)
    ok = True
    for tree in args.trees or ["models", "maps"]:
        if not (VIEWER / tree).is_dir():
            print(f"{tree}: nothing at {VIEWER / tree}")
            continue
        ok = publish(volume, tree, args.streams, args.dry_run) and ok
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
