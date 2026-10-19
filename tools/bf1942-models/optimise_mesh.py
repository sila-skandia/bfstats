#!/usr/bin/env python3
"""Move the embedded textures of finished glbs into the shared texture store,
and keep a gzip copy beside each one.

    optimise_mesh.py viewer/maps/bocage/scene.glb
    optimise_mesh.py viewer/maps --skip-mods -j 16
    optimise_mesh.py viewer/maps/mods/xpack1 viewer/models/mods/xpack1

Every glb under the given paths has its embedded images written once to
`<mesh root>/textures/` as lossless WebP and referenced from there
(`bf42/glbopt.py`, `features/mesh-asset-size`). Pixels and every other byte are
checked unchanged before a file is rewritten. A glb is rewritten in place,
through its own inode, so the hard-link mirrors of `viewer/models` see it.

Then each glb gets `<name>.glb.gz` beside it, a deterministic gzip of its final
bytes, which nginx sends to clients that take gzip (`bf42/glbgz.py`, phase 2a).
A glb of 4 MB or more (the level scenes, the largest models) also gets
`<name>.glb.br`, a brotli copy at less than half the gzip's size, for clients
that take brotli -- all browsers, and what Cloudflare caches (`bf42/glbbr.py`,
phase 2b). A copy that already matches its glb is left alone. The git-tracked
first-person fixtures keep their textures but get the copies too (git ignores
them). `--no-brotli` writes no NEW `.br` (it is minutes of CPU per level,
where the `.gz` is seconds); a stale one beside a changed glb is still
rewritten either way, because the publisher refuses stale copies.

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

from bf42 import glbbr, glbgz, glbopt

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


def collect(paths: list[Path], skip_mods: bool) -> tuple[list[Path], list[Path]]:
    """(glbs to optimise, git-tracked glbs that only get their `.gz`)."""
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
    return ([g for g in found if g.resolve() not in skip],
            [g for g in found if g.resolve() in skip])


def process(glb: str, mesh_root: str, textures: bool = True, brotli: bool = True) -> dict:
    path = Path(glb)
    data = path.read_bytes()
    if not textures:
        gz_written, gz_bytes = glbgz.ensure(path, data)
        br_written, br_bytes = glbbr.ensure(path, data, create=brotli)
        return {"glb": glb, "changed": False, "before": len(data), "after": len(data),
                "images": 0, "written": [], "gz_written": gz_written, "gz": gz_bytes,
                "br_written": br_written, "br": br_bytes}
    store = glbopt.TextureStore(Path(mesh_root))
    out, result = glbopt.externalise_images(data, path, store)
    if result.changed:
        with open(path, "r+b") as handle:
            handle.write(out)
            handle.truncate()
    # Every image the glb points at, new or from an earlier run, must be where
    # its URI says. A glb optimised somewhere other than where it is served
    # (a staging directory) fails here instead of drawing untextured.
    doc, _ = glbopt.read_glb(out)
    broken = [i["uri"] for i in doc.get("images", [])
              if "uri" in i and not (path.parent / i["uri"]).is_file()]
    if broken:
        raise ValueError(f"{len(broken)} image URIs resolve to nothing, e.g. {broken[0]}")
    # Last, from the bytes just written: a .gz (and a .br where the glb is big
    # enough) is only ever made from the glb as it will be served.
    gz_written, gz_bytes = glbgz.ensure(path, out)
    br_written, br_bytes = glbbr.ensure(path, out, create=brotli)
    return {"glb": glb, "changed": result.changed, "before": result.bytes_before,
            "after": result.bytes_after, "images": result.images,
            "written": result.written, "gz_written": gz_written, "gz": gz_bytes,
            "br_written": br_written, "br": br_bytes}


def mesh_root_of(out: Path) -> Path | None:
    """The directory above the `maps/` or `models/` a tree lives in, or None."""
    for parent in [out.resolve(), *out.resolve().parents]:
        if parent.name in ("maps", "models"):
            return parent.parent
    return None


def root_for(glb: Path, mesh_root: Path) -> Path:
    """The mesh root a resolved glb's texture URIs are made relative to.

    Normally `mesh_root` itself. A worktree's `viewer/` links `models/mods`,
    `maps` and `textures` into the main checkout (`link_viewer_assets.sh`), so
    a glb named through those links resolves into the main tree while
    `mesh_root` resolves to the worktree: the glb's own tree (the directory
    above its `maps/` or `models/`) is the root then, accepted only when its
    `textures/` is the very store `mesh_root/textures` resolves to, so every
    URI written stays inside one real tree. Anything else is refused."""
    if mesh_root in glb.parents:
        return mesh_root
    real = mesh_root_of(glb)
    if real is not None and (real / "textures").resolve() == (mesh_root / "textures").resolve():
        return real
    raise ValueError(f"{glb} is not under the mesh root {mesh_root}")


def run(paths: list[Path], mesh_root: Path, skip_mods: bool = False, jobs: int = 8,
        log_path: Path | None = None, brotli: bool = True) -> int:
    """Optimise every glb under `paths`. Returns the number that failed (each
    one is left as it was)."""
    mesh_root = mesh_root.resolve()
    glbs, fixtures = collect([p.resolve() for p in paths], skip_mods)
    roots = {glb: root_for(glb, mesh_root) for glb in (*glbs, *fixtures)}

    started = time.time()
    before = after = changed = images = written = gz_written = gz_bytes = 0
    br_written = br_bytes = 0
    failures = 0
    log = open(log_path, "a") if log_path else None
    with ProcessPoolExecutor(max_workers=jobs) as pool:
        futures = {pool.submit(process, str(g), str(roots[g]), True, brotli): g for g in glbs}
        futures |= {pool.submit(process, str(g), str(roots[g]), False, brotli): g
                    for g in fixtures}
        total = len(futures)
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
            gz_written += row["gz_written"]
            gz_bytes += row["gz"]
            br_written += row["br_written"]
            br_bytes += row["br"]
            if log:
                log.write(json.dumps(row) + "\n")
            if done % 50 == 0 or done == total:
                print(f"{done}/{total}  {before / 1e6:,.0f} MB -> {after / 1e6:,.0f} MB"
                      f"  new textures {written}  {time.time() - started:.0f} s",
                      file=sys.stderr, flush=True)
    if log:
        log.close()
    print(f"{changed} of {len(glbs)} glbs rewritten, {images} images, {written} new in"
          f" {mesh_root / 'textures'}; glbs {before / 1e6:,.1f} MB -> {after / 1e6:,.1f} MB;"
          f" {gz_written} .gz written, {gz_bytes / 1e6:,.1f} MB gzipped;"
          f" {br_written} .br written, {br_bytes / 1e6:,.1f} MB brotli; {failures} failed",
          file=sys.stderr)
    return failures


def optimise_bake(out: Path, jobs: int = 8) -> int:
    """The last step of a batch extract: optimise the tree it just wrote. A
    vanilla tree's `mods/` holds other bakes and is left alone. Returns the
    number of failures; an `out` outside any mesh root is skipped with a note."""
    root = mesh_root_of(out)
    if root is None:
        print(f"not optimising {out}: no maps/ or models/ above it to hang textures/ off",
              file=sys.stderr)
        return 0
    print(f"\nmoving textures into {root / 'textures'} (optimise_mesh.py)...", file=sys.stderr)
    return run([out], root, skip_mods=True, jobs=jobs)


def run_then_optimise(main, default_out: Path) -> int:
    """An extractor's entry point: run its `main()`, then optimise its `--out`.

    For the extractors whose many modes return from many places (`extract_pose`,
    `extract_viewmodel`, `extract_kits`, `extract_effects`). `--no-optimise`
    is taken off the command line before `main()` sees it.

    A non-zero `main()` still optimises what it wrote, and still returns its
    code: a batch that fails one record in several hundred (`extract_viewmodel`
    on a soldier and weapon the game ships no first-person idle clip for) has
    written every other glb, and leaving those self-contained is a second
    failure the publisher then refuses (no `.glb.gz`)."""
    pre = argparse.ArgumentParser(add_help=False)
    pre.add_argument("--out", type=Path, default=default_out)
    pre.add_argument("--no-optimise", action="store_true")
    known, rest = pre.parse_known_args(sys.argv[1:])
    sys.argv = [sys.argv[0], *(a for a in sys.argv[1:] if a != "--no-optimise")]
    code = main()
    if known.no_optimise or {"-h", "--help", "--list", "--dry-run", "--index-only"} & set(rest):
        return code
    if code and not known.out.is_dir():
        return code
    optimise_failed = optimise_bake(known.out)
    return code or (1 if optimise_failed else 0)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("paths", nargs="+", type=Path)
    parser.add_argument("--mesh-root", type=Path, default=VIEWER,
                        help="the directory holding models/ and maps/ (default: the viewer)")
    parser.add_argument("--skip-mods", action="store_true")
    parser.add_argument("-j", "--jobs", type=int, default=8)
    parser.add_argument("--log", type=Path, help="write one JSON line per glb here")
    parser.add_argument("--no-brotli", action="store_true",
                        help="write no NEW .glb.br copies (a stale one beside a "
                             "changed glb is still rewritten: the publisher "
                             "refuses stale copies)")
    args = parser.parse_args()
    try:
        failures = run(args.paths, args.mesh_root, args.skip_mods, args.jobs, args.log,
                       brotli=not args.no_brotli)
    except ValueError as exc:
        parser.error(str(exc))
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
