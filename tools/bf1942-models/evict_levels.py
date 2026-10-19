#!/usr/bin/env python3
"""Make published levels remote-only: remove their scene glbs from this PC.

    evict_levels.py                          # dry run over every tree, in GB
    evict_levels.py --mod fhsw --mod eod     # some trees
    evict_levels.py --apply                  # remove them
    evict_levels.py restore --mod fhsw tobruk desert_hill    # bring scenes back

A level's `scene.glb`, `scene.glb.gz` and `scene.glb.br` are its bulk (37.5 GB
of the 2026-10-20 trees); everything else in its directory is small and stays
(`features/mesh-asset-size`, "Local eviction"). A level goes only when:

* its tree is published (not one of the publisher's `UNPUBLISHED_MODS`) and
  the level is a row of the tree's `maps.json`;
* it is not on the keep-list, `local_levels.json` (the levels tests, lab
  scenarios, benches and fixtures load, and a few per tree for play);
* the volume holds every one of the three files the level has locally, each
  at the local size, by the publisher's own count-checked listing of the
  `maps` tree (read-only kubectl, hetzner / bf42-stats), or `--listing FILE`
  (a JSON `{rel: size}` of that tree, for a scratch run);
* with `--apply`, also: where the publisher's hash record
  (`~/.cache/mesh-publish/hashes-maps.json`) knows the file, the local
  content is the content it landed. A same-size edit not yet published
  (a layer patch) stays.

Each evicted level gets `scene.remote.json` beside its `scene.json`
(`bf42/remote_scene.py`), written before anything is removed, recording each
file's size and the glb's sha256. From then on the level is present to every
tool that asks (the pipeline's skip logic and verify steps, the manifests,
the publisher), `serve_viewer.py` fetches its scene from mesh.bfstats.io when
a page opens it, and tools that need the glb's bytes skip it with a count.

`restore` fetches the files back from mesh.bfstats.io, checks them against
the marker (size, and sha256 for the glb), and removes the marker: run it
before patching or auditing a remote-only level. A re-bake needs no restore;
it writes a new `scene.glb`, and the level is local again.

Refuses `--apply` while an extractor, the optimiser or the publisher is
running (they read or write the same trees); `--force` overrides.
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import os
import subprocess
import sys
import urllib.parse
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path

from bf42 import remote_scene

HERE = Path(__file__).resolve().parent
VIEWER = HERE / "viewer"
KEEP_LIST = HERE / "local_levels.json"
PUBLISHER = HERE.parents[1] / "scripts" / "publish-mesh-delta.py"
HASH_RECORD = Path.home() / ".cache" / "mesh-publish" / "hashes-maps.json"
REMOTE = "https://mesh.bfstats.io"
BUSY = r"extract_maps_all|extract_map\.py|mod_pipeline|optimise_mesh|publish-mesh-delta|patch_scene|scene_layers"


def load_publisher():
    spec = importlib.util.spec_from_file_location("publish_mesh_delta", PUBLISHER)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as fh:
        for block in iter(lambda: fh.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def load_keep(path: Path) -> dict[str, set[str]]:
    doc = json.loads(path.read_text())
    return {tree: {lv.lower() for lv in levels} for tree, levels in doc.get("trees", {}).items()}


def tree_dir(viewer: Path, tree: str) -> Path:
    return viewer / "maps" if tree == "bf1942" else viewer / "maps" / "mods" / tree


def tree_prefix(tree: str) -> str:
    """The tree's path under the volume's `maps/`."""
    return "" if tree == "bf1942" else f"mods/{tree}/"


def all_trees(viewer: Path) -> list[str]:
    out = ["bf1942"] if (viewer / "maps" / "maps.json").is_file() else []
    mods = viewer / "maps" / "mods"
    if mods.is_dir():
        out += sorted(p.name for p in mods.iterdir() if (p / "maps.json").is_file())
    return out


def level_dirs(maps_dir: Path) -> list[str]:
    """The directory of every `maps.json` row, in row order."""
    try:
        rows = json.loads((maps_dir / "maps.json").read_text())
    except (OSError, ValueError):
        return []
    out: list[str] = []
    for row in rows if isinstance(rows, list) else []:
        if isinstance(row, dict):
            d = (row.get("report") or row.get("glb") or "").split("/")[0]
            if d and d not in out:
                out.append(d)
    return out


@dataclass
class Level:
    tree: str
    name: str
    path: Path
    files: dict[str, int] = field(default_factory=dict)   # local scene files -> size
    reason: str = ""                                       # why it stays; "" = evictable

    @property
    def bytes(self) -> int:
        return sum(self.files.values())


@dataclass
class Plan:
    evict: list[Level] = field(default_factory=list)
    kept: list[Level] = field(default_factory=list)
    remote: list[Level] = field(default_factory=list)       # already remote-only
    skipped_trees: list[str] = field(default_factory=list)


def plan(viewer: Path, trees: list[str], keep: dict[str, set[str]], listing: dict[str, int],
         unpublished: set[str]) -> Plan:
    out = Plan()
    for tree in trees:
        if tree in unpublished:
            out.skipped_trees.append(tree)
            continue
        maps_dir = tree_dir(viewer, tree)
        kept_here = keep.get(tree, set())
        for name in level_dirs(maps_dir):
            path = maps_dir / name
            level = Level(tree, name, path)
            if remote_scene.is_remote(path):
                out.remote.append(level)
                continue
            level.files = {f: (path / f).stat().st_size for f in remote_scene.SCENE_FILES
                           if (path / f).is_file()}
            if remote_scene.SCENE not in level.files:
                level.reason = "no scene.glb here"
            elif name.lower() in kept_here:
                level.reason = "keep-list"
            else:
                for f, size in level.files.items():
                    held = listing.get(f"{tree_prefix(tree)}{name}/{f}")
                    if held is None:
                        level.reason = f"{f} is not on the volume"
                        break
                    if held != size:
                        level.reason = f"{f} is {held} bytes on the volume, {size} here"
                        break
            (out.kept if level.reason else out.evict).append(level)
    return out


def content_unpublished(level: Level, record: dict) -> str:
    """Why the local content may not be what the publisher landed, or "".
    Only files the hash record knows are checked (it knows what this PC's
    publishes sent); the glb's sha is returned for the marker as a side job."""
    for f in level.files:
        rel = f"{tree_prefix(level.tree)}{level.name}/{f}"
        row = record.get(rel)
        if not row or row.get("size") != level.files[f]:
            continue
        path = level.path / f
        if row.get("mtime") == path.stat().st_mtime_ns:
            continue
        if sha256(path) != row.get("sha"):
            return f"{f} has the volume's size but not the content last published"
    return ""


def busy() -> list[str]:
    got = subprocess.run(["pgrep", "-af", BUSY], capture_output=True, text=True)
    me = str(os.getpid())
    return [line for line in got.stdout.splitlines() if line.split(" ", 1)[0] != me]


def evict(level: Level) -> None:
    """The marker first, then the files: an interrupted run leaves a local
    scene beside a stale marker (still local), never a scene with no record."""
    files = {f: {"size": size} for f, size in level.files.items()}
    files[remote_scene.SCENE]["sha256"] = sha256(level.path / remote_scene.SCENE)
    remote_scene.write_marker(level.path, files)
    for f in level.files:
        (level.path / f).unlink()


def report(p: Plan, apply: bool) -> None:
    by_tree: dict[str, list[Level]] = {}
    for lv in p.evict:
        by_tree.setdefault(lv.tree, []).append(lv)
    verb = "evicting" if apply else "would evict"
    for tree in sorted(by_tree, key=lambda t: (t != "bf1942", t)):
        levels = by_tree[tree]
        glb = sum(lv.files.get(remote_scene.SCENE, 0) for lv in levels)
        print(f"{tree:12s} {verb} {len(levels):4d} levels  {sum(lv.bytes for lv in levels) / 1e9:7.2f} GB"
              f"  (scene.glb {glb / 1e9:.2f} GB)")
    reasons: dict[str, int] = {}
    for lv in p.kept:
        key = "keep-list" if lv.reason == "keep-list" else (
            "no scene.glb here" if lv.reason == "no scene.glb here" else
            "not on the volume" if "not on the volume" in lv.reason else
            "differs from the volume" if "on the volume," in lv.reason else lv.reason)
        reasons[key] = reasons.get(key, 0) + 1
    total = sum(lv.bytes for lv in p.evict)
    print(f"total: {verb} {len(p.evict)} levels, {total / 1e9:.2f} GB; "
          f"{len(p.remote)} already remote-only; kept {len(p.kept)} "
          f"({', '.join(f'{n} {k}' for k, n in sorted(reasons.items())) or 'none'})")
    held: dict[tuple[str, str], list[Level]] = {}
    for lv in p.kept:
        if lv.reason not in ("keep-list", "no scene.glb here"):
            held.setdefault((lv.tree, lv.reason), []).append(lv)
    for (tree, reason), levels in sorted(held.items()):
        names = ", ".join(lv.name for lv in levels[:5]) + (
            f" and {len(levels) - 5} more" if len(levels) > 5 else "")
        print(f"  kept {len(levels)} {tree} levels ({sum(lv.bytes for lv in levels) / 1e9:.2f} GB), "
              f"{reason}: {names}")
    if p.skipped_trees:
        print(f"not published, never evicted: {', '.join(p.skipped_trees)}")


def restore(viewer: Path, tree: str, names: list[str], base: str) -> int:
    failed = 0
    maps_dir = tree_dir(viewer, tree)
    for name in names:
        path = maps_dir / name.lower()
        doc = remote_scene.read_marker(path)
        if doc is None or not remote_scene.is_remote(path):
            print(f"{tree}/{name}: not remote-only, nothing to restore")
            continue
        try:
            for f, row in doc["files"].items():
                rel = f"maps/{tree_prefix(tree)}{path.name}/{f}"
                tmp = path / f".{f}.restore"
                req = urllib.request.Request(f"{base}/{urllib.parse.quote(rel)}",
                                             headers={"User-Agent": "bfstats-evict-levels"})
                with urllib.request.urlopen(req, timeout=60) as reply, open(tmp, "wb") as out:
                    while block := reply.read(1 << 20):
                        out.write(block)
                if tmp.stat().st_size != row.get("size") or (
                        row.get("sha256") and sha256(tmp) != row["sha256"]):
                    tmp.unlink()
                    raise OSError(f"{f} from the volume does not match the marker (republished "
                                  "since it was evicted? a re-bake is the fix)")
            for f in doc["files"]:
                (path / f".{f}.restore").replace(path / f)
            remote_scene.marker_path(path).unlink()
            print(f"{tree}/{path.name}: restored {len(doc['files'])} files")
        except OSError as exc:
            failed += 1
            for f in doc["files"]:
                (path / f".{f}.restore").unlink(missing_ok=True)
            print(f"{tree}/{path.name}: FAILED {exc}", file=sys.stderr)
    return 1 if failed else 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("action", nargs="?", default="plan", choices=["plan", "restore"])
    ap.add_argument("levels", nargs="*", help="restore: the level directories")
    ap.add_argument("--mod", action="append", default=None,
                    help="tree id (bf1942, fhsw, ...); repeatable; default every tree")
    ap.add_argument("--apply", action="store_true", help="remove the files (default: dry run)")
    ap.add_argument("--force", action="store_true", help="--apply while an extractor runs")
    ap.add_argument("--viewer", type=Path, default=VIEWER)
    ap.add_argument("--keep", type=Path, default=KEEP_LIST)
    ap.add_argument("--listing", type=Path, default=None,
                    help="the volume's maps tree as a JSON {rel: size} (default: list it)")
    ap.add_argument("--remote", default=REMOTE, help="restore: where the files come from")
    ap.add_argument("--context", default=os.environ.get("KUBE_CONTEXT", "hetzner"))
    ap.add_argument("--namespace", default=os.environ.get("KUBE_NS", "bf42-stats"))
    args = ap.parse_args()
    viewer = args.viewer.resolve()

    if args.action == "restore":
        if not args.mod or len(args.mod) != 1 or not args.levels:
            ap.error("restore takes one --mod and the level directories")
        return restore(viewer, args.mod[0], args.levels, args.remote.rstrip("/"))

    trees = args.mod or all_trees(viewer)
    keep = load_keep(args.keep)
    publisher = load_publisher()
    if args.listing is not None:
        listing = json.loads(args.listing.read_text())
    else:
        listing = publisher.Volume(args.context, args.namespace).listing("maps")
    p = plan(viewer, trees, keep, listing, set(publisher.UNPUBLISHED_MODS))
    if args.apply:
        running = busy()
        if running and not args.force:
            print("refusing --apply while these run (--force overrides):", *running, sep="\n  ")
            return 1
        try:
            record = json.loads(HASH_RECORD.read_text())
        except (OSError, ValueError):
            record = {}
        for lv in list(p.evict):
            why = content_unpublished(lv, record)
            if why:
                lv.reason = why
                p.evict.remove(lv)
                p.kept.append(lv)
    report(p, args.apply)
    if not args.apply:
        print("dry run: nothing removed (--apply removes)")
        return 0
    for lv in p.evict:
        evict(lv)
    print(f"evicted {len(p.evict)} levels")
    return 0


if __name__ == "__main__":
    sys.exit(main())
