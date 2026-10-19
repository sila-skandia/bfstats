#!/usr/bin/env python3
"""Remove local glb-store blobs the assets volume already holds.

    evict_glbs.py                      # dry run: what would go, in GB
    evict_glbs.py --refresh            # list the volume first (read-only kubectl)
    evict_glbs.py --refresh --apply    # and remove them

`viewer/glbs/` (phase 5 of `features/mesh-asset-size`, `bf42/glbstore.py`)
holds one file per distinct model, rig and pose glb, named by its sha256,
with its `.glb.gz` (and `.glb.br`) beside it. Once the volume holds a blob,
the local copy is a cache. The store's `.on-volume.json` (`bf42/onvolume.py`)
is what the volume held when `scripts/publish-mesh-delta.py` last listed it
(every publish of the `glbs` tree rewrites it, and `--refresh` here does the
same through the publisher's own count-checked listing). A blob goes only
when the record names it, and every local copy of it, at the local size; a
blob with any copy the volume lacks stays whole.

After eviction the name still resolves: the manifests keep the sha, the
viewer and the stats site fetch the volume's copy, `serve_viewer.py` fetches
it on demand for local play, `store_glbs.py` does not write it back (the
record says the volume holds it), and the publisher's `store_check` reads it
as present.

Only the store is touched. The per-tree glbs under `models/` are rewritten in
place by every extractor (and mirrored by hard links), so they are never
hard-linked to the store and never evicted by this.

A store file with other hard links (a `cp -al` mirror of `glbs/`) frees no
space when its name here goes; the report counts those apart.
"""

from __future__ import annotations

import argparse
import importlib.util
import os
import sys
from pathlib import Path

from bf42 import onvolume

HERE = Path(__file__).resolve().parent
VIEWER = HERE / "viewer"
PUBLISHER = HERE.parents[1] / "scripts" / "publish-mesh-delta.py"


def load_publisher():
    spec = importlib.util.spec_from_file_location("publish_mesh_delta", PUBLISHER)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def refresh(store: Path, context: str, namespace: str) -> onvolume.VolumeRecord:
    """List the volume's `glbs/` (read-only: `find` and `stat` on the pod)
    and write the record."""
    publisher = load_publisher()
    volume = publisher.Volume(context, namespace)
    record = onvolume.VolumeRecord.load(store)
    record.replace(volume.listing("glbs"))
    record.save()
    return record


def plan(store: Path, record: onvolume.VolumeRecord) -> tuple[list[tuple[Path, int]], int]:
    """(files to remove, blobs kept because a copy is not on the volume).

    Grouped per sha: a blob and its `.gz`/`.br` go together or not at all, so
    the store never holds an orphan copy the publisher would refuse."""
    held = {p.name: (p, size) for p, size in onvolume.evictable(store, record)}
    groups: dict[str, list[str]] = {}
    with os.scandir(store) as entries:
        for entry in entries:
            if entry.is_file(follow_symlinks=False) and onvolume.is_store_name(entry.name):
                groups.setdefault(entry.name[:64], []).append(entry.name)
    out: list[tuple[Path, int]] = []
    kept = 0
    for sha, names in sorted(groups.items()):
        if all(n in held for n in names) and f"{sha}.glb" in held:
            out += [held[n] for n in sorted(names)]
        elif any(n in held for n in names):
            kept += 1
    return out, kept


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--mesh-root", type=Path, default=VIEWER,
                    help="the directory holding glbs/ (default: the viewer)")
    ap.add_argument("--refresh", action="store_true",
                    help="list the volume's glbs/ first (kubectl, read-only) and "
                         "rewrite the record")
    ap.add_argument("--apply", action="store_true", help="remove the files (default: dry run)")
    ap.add_argument("--context", default=os.environ.get("KUBE_CONTEXT", "hetzner"))
    ap.add_argument("--namespace", default=os.environ.get("KUBE_NS", "bf42-stats"))
    args = ap.parse_args()

    store = (args.mesh_root / "glbs").resolve()
    if not store.is_dir():
        sys.exit(f"no store at {store}")
    record = (refresh(store, args.context, args.namespace) if args.refresh
              else onvolume.VolumeRecord.load(store))
    if not len(record):
        sys.exit(f"{store / onvolume.RECORD_NAME}: no record of what the volume holds; "
                 "run with --refresh (or publish the glbs tree) first")
    files, kept = plan(store, record)
    total = sum(size for _, size in files)
    linked = sum(size for p, size in files if p.stat().st_nlink > 1)
    blobs = sum(1 for p, _ in files if p.name.endswith(".glb"))
    print(f"{store}: record of {len(record)} volume files, listed {record.listed or 'unknown'}")
    print(f"{'removing' if args.apply else 'would remove'} {len(files)} files "
          f"({blobs} blobs and their copies), {total / 1e9:.2f} GB"
          + (f"; {linked / 1e9:.2f} GB of it has other hard links and frees nothing"
             if linked else ""))
    if kept:
        print(f"kept {kept} blobs with a copy the volume does not hold at the local size")
    if not args.apply:
        print("dry run: nothing removed (--apply removes)")
        return 0
    for path, _ in files:
        path.unlink()
    print(f"removed {len(files)} files")
    return 0


if __name__ == "__main__":
    sys.exit(main())
