#!/usr/bin/env python3
"""Move the embedded textures of finished glbs into the shared texture store.

    optimise_mesh.py viewer/maps/bocage/scene.glb
    optimise_mesh.py viewer/maps --skip-mods -j 16
    optimise_mesh.py viewer/maps/mods/xpack1 viewer/models/mods/xpack1

Every glb under the given paths has its embedded images written once to
`<mesh root>/textures/` as lossless WebP and referenced from there
(`bf42/glbopt.py`, `features/mesh-asset-size`). Pixels and every other byte are
checked unchanged before a file is rewritten. A glb is rewritten in place,
through its own inode, so the hard-link mirrors of `viewer/models` see it.

`--skip-mods` leaves `mods/` subtrees out of a directory walk, so a vanilla pass
does not touch a mod tree that is out of scope.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import time
from concurrent.futures import ProcessPoolExecutor, as_completed
from pathlib import Path

from bf42 import glbopt

VIEWER = Path(__file__).resolve().parent / "viewer"


def tracked(paths: list[Path]) -> set[Path]:
    """glbs git tracks (the first-person fixtures under `models/viewmodels`).
    They stay as committed: rewriting one would show up as a change."""
    out: set[Path] = set()
    for path in paths:
        where = path if path.is_dir() else path.parent
        try:
            top = subprocess.run(["git", "-C", str(where), "rev-parse", "--show-toplevel"],
                                 capture_output=True, text=True, check=True).stdout.strip()
            files = subprocess.run(["git", "-C", top, "ls-files", "-z", "--", "*.glb"],
                                   capture_output=True, text=True, check=True).stdout
        except (subprocess.CalledProcessError, FileNotFoundError):
            continue
        out |= {(Path(top) / f).resolve() for f in files.split("\0") if f}
    return out


def collect(paths: list[Path], skip_mods: bool) -> list[Path]:
    found: list[Path] = []
    for path in paths:
        if path.is_file():
            found.append(path)
            continue
        for glb in sorted(path.rglob("*.glb")):
            rel = glb.relative_to(path).parts
            if skip_mods and "mods" in rel:
                continue
            found.append(glb)
    skip = tracked(paths)
    return [g for g in found if g.resolve() not in skip]


def process(glb: str, mesh_root: str) -> dict:
    path = Path(glb)
    store = glbopt.TextureStore(Path(mesh_root))
    data = path.read_bytes()
    out, result = glbopt.externalise_images(data, path, store)
    if result.changed:
        with open(path, "r+b") as handle:
            handle.write(out)
            handle.truncate()
    return {"glb": glb, "changed": result.changed, "before": result.bytes_before,
            "after": result.bytes_after, "images": result.images,
            "written": result.written}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("paths", nargs="+", type=Path)
    parser.add_argument("--mesh-root", type=Path, default=VIEWER,
                        help="the directory holding models/ and maps/ (default: the viewer)")
    parser.add_argument("--skip-mods", action="store_true")
    parser.add_argument("-j", "--jobs", type=int, default=8)
    parser.add_argument("--log", type=Path, help="write one JSON line per glb here")
    args = parser.parse_args()

    mesh_root = args.mesh_root.resolve()
    glbs = collect([p.resolve() for p in args.paths], args.skip_mods)
    for glb in glbs:
        if mesh_root not in glb.parents:
            parser.error(f"{glb} is not under the mesh root {mesh_root}")

    started = time.time()
    before = after = changed = images = written = 0
    failures = 0
    log = open(args.log, "a") if args.log else None
    with ProcessPoolExecutor(max_workers=args.jobs) as pool:
        futures = {pool.submit(process, str(g), str(mesh_root)): g for g in glbs}
        for done, future in enumerate(as_completed(futures), 1):
            try:
                row = future.result()
            except Exception as exc:  # report, keep going: the file is untouched
                failures += 1
                print(f"FAILED {futures[future]}: {exc}", file=sys.stderr)
                continue
            before += row["before"]
            after += row["after"]
            changed += row["changed"]
            images += row["images"]
            written += len(row["written"])
            if log:
                log.write(json.dumps(row) + "\n")
            if done % 50 == 0 or done == len(glbs):
                print(f"{done}/{len(glbs)}  {before / 1e6:,.0f} MB -> {after / 1e6:,.0f} MB"
                      f"  new textures {written}  {time.time() - started:.0f} s", flush=True)
    if log:
        log.close()
    print(f"{changed} of {len(glbs)} glbs rewritten, {images} images, {written} new in the store;"
          f" glbs {before / 1e6:,.1f} MB -> {after / 1e6:,.1f} MB; {failures} failed")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
