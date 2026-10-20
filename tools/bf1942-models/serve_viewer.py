#!/usr/bin/env python3
"""Serve the viewer for local work, telling the browser to revalidate.

    python3 serve_viewer.py 5273
    python3 serve_viewer.py 5290 --no-remote        # local files only
    BF_VIEWER_REMOTE=off python3 serve_viewer.py 5290

`python3 -m http.server` sends no Cache-Control, so a browser keeps a module
by heuristic for hours: `map.html` imports its siblings with no cache buster,
and an edited `hull-bodies.js` goes on running as its old self behind a fresh
page, through a hard reload. `no-cache` makes every request conditional (a 304
when the file has not changed), which is what mesh/nginx.conf sends in
production.

A file missing under `maps/`, `models/`, `glbs/` or `textures/` is fetched
from https://mesh.bfstats.io (the same layout: the volume's `assets/mesh`) and
cached under `~/.cache/bfstats-mesh-remote/`, so a level whose scene glbs were
evicted to the volume (`evict_levels.py`), or a store blob evicted the same
way (`evict_glbs.py`), still opens locally (`features/mesh-asset-size`,
"Local eviction"). The local tree always wins; the tree itself is never
written. A cached scene is checked against the level's `scene.remote.json`
(its recorded size) and fetched again when it disagrees; other cached files
are kept until the cache is removed (`rm -rf ~/.cache/bfstats-mesh-remote`).
`--no-remote` (or `BF_VIEWER_REMOTE=off`) turns it off: the pipeline's and
the audits' own servers run that way, so they never fill the cache and
report remote-only levels as skipped instead.

The fetch asks for the plain URL, which the edge caches; a file the volume
lacks comes back 404 and is remembered as missing for the life of the server.
"""

from __future__ import annotations

import argparse
import hashlib
import os
import re
import shutil
import sys
import threading
import urllib.error
import urllib.parse
import urllib.request
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from bf42 import remote_scene  # noqa: E402

REMOTE = "https://mesh.bfstats.io"
REMOTE_TREES = ("maps", "models", "glbs", "textures")
CACHE = Path.home() / ".cache" / "bfstats-mesh-remote"
STORE_BLOB = re.compile(r"glbs/([0-9a-f]{64})\.glb")
TIMEOUT_S = 60


class RemoteCache:
    """Missing files under the asset trees, fetched once from the volume."""

    def __init__(self, base: str, cache: Path, trees: tuple[str, ...] = REMOTE_TREES) -> None:
        self.base = base.rstrip("/")
        self.cache = cache
        self.trees = trees
        self.missing: set[str] = set()
        self.locks: dict[str, threading.Lock] = {}
        self.guard = threading.Lock()

    def eligible(self, rel: str) -> bool:
        parts = rel.split("/")
        return len(parts) > 1 and parts[0] in self.trees and all(
            p not in ("", ".", "..") for p in parts)

    @staticmethod
    def store_sha(rel: str) -> str | None:
        """The sha256 a store blob's name promises (`glbs/<sha>.glb`), else None."""
        m = STORE_BLOB.fullmatch(rel)
        return m.group(1) if m else None

    def expected_size(self, local_root: Path, rel: str) -> int | None:
        """A scene file's size from its level's eviction marker, if any."""
        path = local_root / rel
        if path.name not in remote_scene.SCENE_FILES:
            return None
        doc = remote_scene.read_marker(path.parent)
        row = (doc or {}).get("files", {}).get(path.name)
        return row.get("size") if isinstance(row, dict) else None

    def get(self, local_root: Path, rel: str) -> Path | None:
        """The cached copy of `rel`, fetched if need be; None when the volume
        does not have it either."""
        if rel in self.missing:
            return None
        target = self.cache / rel
        want = self.expected_size(local_root, rel)
        with self.guard:
            lock = self.locks.setdefault(rel, threading.Lock())
        with lock:
            if target.is_file() and (want is None or target.stat().st_size == want):
                return target
            url = f"{self.base}/{urllib.parse.quote(rel)}"
            request = urllib.request.Request(url, headers={"User-Agent": "bfstats-serve-viewer"})
            target.parent.mkdir(parents=True, exist_ok=True)
            tmp = target.with_name(f".{target.name}.{os.getpid()}.part")
            try:
                with urllib.request.urlopen(request, timeout=TIMEOUT_S) as reply, \
                        open(tmp, "wb") as out:
                    shutil.copyfileobj(reply, out, 1 << 20)
                    length = reply.headers.get("Content-Length")
                got = tmp.stat().st_size
                if (length is not None and int(length) != got) or (want is not None and got != want):
                    raise OSError(f"short or mismatched fetch: {got} bytes")
                sha = self.store_sha(rel)
                if sha is not None:
                    digest = hashlib.sha256()
                    with open(tmp, "rb") as fh:
                        for chunk in iter(lambda: fh.read(1 << 20), b""):
                            digest.update(chunk)
                    if digest.hexdigest() != sha:
                        raise OSError("store blob does not hash to its name")
                tmp.replace(target)
            except urllib.error.HTTPError as exc:
                exc.close()
                tmp.unlink(missing_ok=True)
                if exc.code == 404:
                    self.missing.add(rel)
                print(f"remote {rel}: HTTP {exc.code}", file=sys.stderr)
                return None
            except (OSError, urllib.error.URLError) as exc:
                tmp.unlink(missing_ok=True)
                print(f"remote {rel}: {exc}", file=sys.stderr)
                return None
            print(f"remote {rel}: fetched {got / 1e6:,.1f} MB into {self.cache}", file=sys.stderr)
            return target


class Handler(SimpleHTTPRequestHandler):
    remote: RemoteCache | None = None

    def end_headers(self) -> None:
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def translate_path(self, path: str) -> str:
        local = super().translate_path(path)
        if self.remote is None or os.path.exists(local):
            return local
        root = Path(self.directory)
        try:
            rel = Path(local).relative_to(root).as_posix()
        except ValueError:
            return local
        if not self.remote.eligible(rel):
            return local
        cached = self.remote.get(root, rel)
        return str(cached) if cached is not None else local


def remote_enabled(flag: bool) -> bool:
    return not flag and os.environ.get("BF_VIEWER_REMOTE", "").lower() not in ("0", "off", "no", "false")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("port", nargs="?", type=int, default=5273)
    ap.add_argument("directory", nargs="?", default=str(Path(__file__).resolve().parent / "viewer"))
    ap.add_argument("--no-remote", action="store_true",
                    help="serve local files only (also BF_VIEWER_REMOTE=off)")
    ap.add_argument("--remote-store-only", action="store_true",
                    help="fetch only missing glbs/<sha>.glb store blobs (checked against "
                         "their sha), every other tree local only: the pipeline's servers, "
                         "which audit the local trees but whose store may be evicted")
    ap.add_argument("--remote", default=REMOTE, help=f"where missing assets come from ({REMOTE})")
    ap.add_argument("--cache", type=Path, default=CACHE, help=f"fetched files ({CACHE})")
    args = ap.parse_args()
    if args.remote_store_only:
        remote = RemoteCache(args.remote, args.cache, trees=("glbs",))
    else:
        remote = RemoteCache(args.remote, args.cache) if remote_enabled(args.no_remote) else None
    handler = type("ViewerHandler", (Handler,), {"remote": remote})
    ThreadingHTTPServer(("", args.port), partial(handler, directory=args.directory)).serve_forever()


if __name__ == "__main__":
    main()
