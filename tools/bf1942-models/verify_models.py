#!/usr/bin/env python3
"""Answer "did this extraction come out right?" without eyeballing a render.

    python3 verify_models.py                          # verifies ./viewer/models
    python3 verify_models.py --models ./out --strict
    python3 verify_models.py --only Thompson Sg44 Mp18

Runs every objective check `bf42/verify.py` defines over an extraction output
directory (`models.json` plus the `.glb`/`.report.json` pairs beside it):

* hand-weapon sub-part area outside the weapon's own shadow-mesh silhouette
  (needs the game archives; skipped with a note when they are absent)
* unresolved textures, meshes, geometry templates and shaders, per model
* unbound parts piled on the origin — the collapsed-`bindToSkeletonPart`
  signature, with the authored stacks (Type99, soldiers) excluded
* exported dimensions against real-world figures where a figure is unambiguous
* degenerate geometry: zero-area triangles, non-finite vertices

The verdict per model is clean / degraded / broken. Broken exits non-zero;
`--strict` makes degraded exit non-zero too. `--json` writes the same findings
machine-readably so a future agent can diff two runs.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from bf42 import con as con_mod  # noqa: E402
from bf42 import measure, stdmesh, verify  # noqa: E402

DEFAULT_MODELS = Path(__file__).resolve().parent / "viewer" / "models"


def find_shadow_geometry(library: con_mod.ObjectLibrary, root_name: str) -> str | None:
    """The `Simple` LodObject alternative's geometry template, or None.

    Every vanilla hand weapon's simple LOD is its `Shad_*`/`Shade_*` shadow
    mesh — the whole weapon as one part in the same space as the Complex
    assembly, which is what makes sub-part placement measurable.
    """
    seen: set[str] = set()

    def visit(name: str, depth: int = 0) -> str | None:
        if depth > 16:
            return None
        template = library.object(name)
        if template is None or template.name.lower() in seen:
            return None
        seen.add(template.name.lower())
        if template.is_lod_selector:
            for child in template.children:
                if con_mod.lod_alternative_role(child.template) == "simple":
                    simple = library.object(child.template)
                    if simple is not None and simple.geometry:
                        return simple.geometry
        for child in template.children:
            found = visit(child.template, depth + 1)
            if found:
                return found
        return None

    return visit(root_name)


def shadow_triangles(library: con_mod.ObjectLibrary, meshes,
                     root_name: str) -> list[verify.Triangle] | None:
    """The shadow mesh's LOD0 triangles, Z-mirrored into glTF space."""
    geometry_name = find_shadow_geometry(library, root_name)
    if geometry_name is None:
        return None
    geometry = library.geometry(geometry_name)
    if geometry is None:
        return None
    entry = meshes.resolve_ext(f"standardMesh/{geometry.mesh_file}", (".sm",))
    if not entry:
        return None
    try:
        mesh = stdmesh.parse(meshes.read(entry), entry)
    except stdmesh.MeshError:
        return None
    if not mesh.lods:
        return None
    triangles: list[verify.Triangle] = []
    for material in mesh.lods[0].materials:
        positions = [(x, y, -z) for x, y, z in material.positions()]
        for a, b, c in material.triangles():
            triangles.append((positions[a], positions[b], positions[c]))
    return triangles or None


def load_manifest(models_dir: Path) -> list[dict]:
    manifest_path = models_dir / "models.json"
    if manifest_path.is_file():
        return json.loads(manifest_path.read_text())
    # No manifest: verify whatever .glb files are present with generic checks.
    entries = []
    for glb in sorted(models_dir.glob("*.glb")):
        entries.append({"name": glb.stem.split(".")[0], "glb": glb.name,
                        "category": None})
    return entries


def open_archives(game_dir: Path, mod: str):
    """The library and mesh pool the silhouette check needs, or None."""
    from extract_models import build_library, build_pools, mod_chain
    if not game_dir.is_dir():
        return None
    chain = mod_chain(game_dir, mod)
    meshes, _textures, objects, _game = build_pools(chain, [])
    return build_library(objects), meshes


def verify_entry(entry: dict, models_dir: Path, archives, *,
                 length_tolerance: float,
                 vanilla_facts: bool = True) -> tuple[verify.Triage, dict]:
    name = entry["name"]
    glb_path = models_dir / entry["glb"]
    detail: dict = {"name": name, "glb": entry["glb"]}

    report = None
    report_path = models_dir / (glb_path.name[:-4] + ".report.json")
    if report_path.is_file():
        report = json.loads(report_path.read_text())

    if not glb_path.is_file():
        triage = verify.Triage(name)
        triage.broken(f"missing file: {glb_path.name}")
        return triage, detail

    try:
        doc, blob = verify.read_glb(glb_path)
        parts = verify.scene_parts(doc, blob)
    except (verify.VerifyError, KeyError, IndexError, ValueError) as exc:
        triage = verify.Triage(name)
        triage.broken(f"unreadable glb: {exc}")
        return triage, detail

    stats = verify.geometry_stats(parts)
    detail["triangles"] = stats.triangles

    silhouette = None
    is_weapon = entry.get("category") in ("handweapon", None)
    if archives is not None and is_weapon:
        library, meshes = archives
        shadow = shadow_triangles(library, meshes, name)
        if shadow is not None:
            bound = {
                part.name: part.triangles
                for part in parts
                if part.bound_bone is not None and not part.is_collision
            }
            silhouette = verify.silhouette_outside(bound, shadow)
            if silhouette is not None:
                detail["silhouette"] = {
                    "aggregate": round(silhouette.aggregate, 4),
                    "perPart": {k: round(v, 4)
                                for k, v in silhouette.per_part.items()},
                }

    bounds = measure.bounds(glb_path)
    dimensions = verify.dimension_check(
        name, bounds["length"] if bounds else None)
    if bounds:
        detail["length"] = bounds["length"]
    if dimensions:
        detail["expectedLength"] = dimensions.expected

    triage = verify.triage_report(
        name, report, parts=parts, stats=stats,
        silhouette=silhouette, dimensions=dimensions,
        length_tolerance=length_tolerance,
        vanilla_facts=vanilla_facts,
    )
    return triage, detail


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--models", type=Path, default=DEFAULT_MODELS,
                    help="extraction output directory (default: ./viewer/models)")
    ap.add_argument("--game-dir", type=Path,
                    default=Path.home() / ".wine/drive_c/EA Games/Battlefield 1942")
    ap.add_argument("--mod", default="bf1942")
    ap.add_argument("--only", nargs="*", default=None,
                    help="verify only these template names")
    ap.add_argument("--skip-silhouette", action="store_true",
                    help="skip the shadow-mesh check (no archive access needed)")
    ap.add_argument("--strict", action="store_true",
                    help="exit non-zero on degraded models too, not just broken")
    ap.add_argument("--length-tolerance", type=float, default=verify.LENGTH_TOLERANCE,
                    help="relative deviation allowed against real-world lengths "
                         f"(default: {verify.LENGTH_TOLERANCE})")
    ap.add_argument("--json", type=Path, default=None,
                    help="also write the findings as JSON to this path")
    args = ap.parse_args()

    models_dir = args.models.expanduser()
    if not models_dir.is_dir():
        sys.exit(f"models dir not found: {models_dir}")

    entries = load_manifest(models_dir)
    if args.only:
        wanted = {n.lower() for n in args.only}
        entries = [e for e in entries if e["name"].lower() in wanted]
        missing = wanted - {e["name"].lower() for e in entries}
        for name in sorted(missing):
            print(f"WARNING: {name} is not in the manifest", file=sys.stderr)
    if not entries:
        sys.exit("nothing to verify")

    archives = None
    if not args.skip_silhouette:
        need_shadow = any(e.get("category") in ("handweapon", None) for e in entries)
        if need_shadow:
            archives = open_archives(args.game_dir.expanduser(), args.mod)
            if archives is None:
                print(f"NOTE: game dir not found ({args.game_dir}); "
                      "silhouette checks skipped", file=sys.stderr)

    results: list[dict] = []
    by_status: dict[str, list[str]] = {"clean": [], "degraded": [], "broken": []}
    vanilla_facts = args.mod.lower() == "bf1942"
    for entry in entries:
        triage, detail = verify_entry(
            entry, models_dir, archives, length_tolerance=args.length_tolerance,
            vanilla_facts=vanilla_facts)
        by_status[triage.status].append(triage.name)
        results.append({
            "name": triage.name,
            "status": triage.status,
            "findings": [{"severity": f.severity, "message": f.message}
                         for f in triage.findings],
            **detail,
        })

        marker = {"clean": "ok", "degraded": "DEGRADED", "broken": "BROKEN"}[triage.status]
        print(f"{triage.name:24s} {marker}")
        for finding in triage.findings:
            print(f"    [{finding.severity}] {finding.message}")

    print()
    print(f"{len(by_status['clean'])} clean, "
          f"{len(by_status['degraded'])} degraded, "
          f"{len(by_status['broken'])} broken of {len(entries)} verified")
    for status in ("degraded", "broken"):
        if by_status[status]:
            print(f"  {status}: {', '.join(sorted(by_status[status]))}")

    if args.json:
        args.json.write_text(json.dumps(results, indent=2))

    if by_status["broken"]:
        return 1
    if args.strict and by_status["degraded"]:
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
