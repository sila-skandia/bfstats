#!/usr/bin/env python3
"""Answer "did this extraction come out right?" without eyeballing a render.

    python3 verify_models.py                          # verifies ./viewer/models
    python3 verify_models.py --models ./out --strict
    python3 verify_models.py --only Thompson Sg44 Mp18

Runs every objective check `bf42/verify.py` defines over an extraction output
directory (`models.json` plus the `.glb`/`.report.json` pairs beside it):

* hand-weapon sub-part area outside the weapon's own shadow-mesh silhouette
  (needs the game archives; skipped with a note when they are absent, and
  skipped per weapon when the simple LOD is not a shadow mesh at all)
* unresolved textures, meshes, geometry templates and shaders, per model,
  each weighed by what in the game data actually wanted it
* unexplained parts piled on the origin — the collapsed-`bindToSkeletonPart`
  signature, with the authored stacks, the skinned meshes and the exporter's
  own emitters, tracers and projectile previews excluded
* exported dimensions against real-world figures where a figure is
  unambiguous, measured over the model's own geometry
* degenerate geometry: zero-area triangles, non-finite vertices

The verdict per model is clean / degraded / broken. Broken exits non-zero;
`--strict` makes degraded exit non-zero too. `--json` writes the same findings
machine-readably so a future agent can diff two runs.

Two of these checks are catalogue-wide rather than per model, because that is
where their real signal lives:

* the silhouette regression (reading the `.ske` unmirrored) throws every
  weapon high at once, while one weapon reading high is usually a coarse or
  borrowed shadow mesh. So the *median* weapon decides whether a high reading
  is broken or a degradation worth looking at.
* an unresolved asset is weighed by whether anything the model draws wanted
  it. A geometry template only a projectile or an emitter referenced left the
  model whole.

Both are the same principle: say what is true, and keep the severity for what
a regression would actually look like. Before 2026-09-20 this exited 1 on
every catalogue it was pointed at — 42 of 96 vanilla models and 96 of 285 EoD
models called BROKEN, every one a false alarm — which is the same as having no
verifier at all.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from bf42 import con as con_mod  # noqa: E402
# `bf42.measure.bounds` is deliberately not used here: it reads the whole
# file, and since the exporter began baking emitters, tracers and projectile
# previews that box is metres bigger than the object. `verify.body_length`
# measures the model over its own geometry instead.
from bf42 import stdmesh, verify  # noqa: E402

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


#: `ObjectTemplate.kind` values that mean a geometry was wanted by something
#: the object fires or emits, not by a part of the object. Taken from the
#: `.con` vocabulary the library already parses.
_PROJECTILE_KINDS = frozenset({"projectile", "bullet", "shell", "grenade",
                               "rocket", "missile", "explosivepack",
                               "timedexplosive"})
_EFFECT_KINDS = frozenset({"particle", "spriteparticle", "effectbundle",
                           "lightsource", "sound"})


def missing_asset_roles(library: con_mod.ObjectLibrary, root_name: str,
                        names: list[str]) -> dict[str, str]:
    """What, in *this model's* own template tree, wanted each unresolved asset.

    An `.rfa` can reference a geometry template that ships nowhere, and the
    verdict depends entirely on what wanted it. EoD's BF109 reports
    `Big_Bomb_M1` unresolved; walking the BF109's tree, the only thing that
    names it is `FighterBomb` — the bomb the rack *fires*, reached through
    `ObjectTemplate.projectileTemplate`, not a part of the aeroplane, which
    exported 17 parts and 1,974 triangles perfectly well.

    Per model and not globally, because the same geometry can be a projectile
    on one object and a drawn part on another: vanilla's `IlyushinDummyBomb`
    is a `SimpleObject` carrying that very mesh under the Il-2's wing, and
    the Il-2 losing it really would be a hole in the model.

    Returns lowercased asset name -> `"projectile"` / `"effect"` /
    `"collision"` / `"part"`. An asset this tree never reaches is left out, so
    the caller keeps its default severity.
    """
    wanted = {n.split(" (", 1)[0].strip().lower() for n in names}
    if not wanted:
        return {}

    found: dict[str, set[str]] = {}
    seen: set[str] = set()

    def note(geometry_name: str | None, role: str) -> None:
        if not geometry_name:
            return
        keys = {geometry_name.lower()}
        geometry = library.geometry(geometry_name)
        if geometry is not None and geometry.mesh_file:
            keys.add(geometry.mesh_file.replace("\\", "/").rsplit("/", 1)[-1].lower())
            if geometry.kind.lower() in ("skeletoncollisionmesh", "collisionmesh"):
                role = "collision"
        for key in keys & wanted:
            found.setdefault(key, set()).add(role)

    def visit(name: str | None, role: str, depth: int = 0) -> None:
        if not name or depth > 24:
            return
        key = f"{name.lower()}|{role}"
        if key in seen:
            return
        seen.add(key)
        template = library.object(name)
        if template is None:
            return
        kind = template.kind.lower()
        own = ("projectile" if role == "projectile" or kind in _PROJECTILE_KINDS
               else "effect" if role == "effect" or kind in _EFFECT_KINDS
               else "part")
        note(template.geometry, own)
        for child in template.children:
            visit(child.template, own, depth + 1)
        for fired in (getattr(template, "projectile_template", None),
                      getattr(template, "visible_dummy_projectile_template", None)):
            visit(fired, "projectile", depth + 1)
        visit(getattr(template, "start_effect_template", None), "effect", depth + 1)

    visit(root_name, "part")

    # A "part" reading outranks the rest: if anything the model draws wanted
    # the asset, the model lost something it draws.
    return {
        key: ("part" if "part" in roles
              else "projectile" if "projectile" in roles
              else "effect" if "effect" in roles else "collision")
        for key, roles in found.items()
    }


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


def measure_entry(entry: dict, models_dir: Path, archives) -> dict:
    """Everything about one model that does not depend on the catalogue.

    Separated from the verdict because two of the checks need the whole
    catalogue before they can say how severe a reading is, so the run
    measures every model first and triages afterwards.
    """
    name = entry["name"]
    glb_path = models_dir / entry["glb"]
    out: dict = {"name": name, "glb": entry["glb"], "path": glb_path,
                 "entry": entry}

    report_path = models_dir / (glb_path.name[:-4] + ".report.json")
    out["report"] = (json.loads(report_path.read_text())
                     if report_path.is_file() else None)

    if not glb_path.is_file():
        out["error"] = f"missing file: {glb_path.name}"
        return out
    try:
        doc, blob = verify.read_glb(glb_path)
        out["parts"] = verify.scene_parts(doc, blob)
    except (verify.VerifyError, KeyError, IndexError, ValueError) as exc:
        out["error"] = f"unreadable glb: {exc}"
        return out

    parts = out["parts"]
    out["stats"] = verify.geometry_stats(parts)
    out["length"] = verify.body_length(parts)

    is_weapon = entry.get("category") in ("handweapon", None)
    if archives is not None and is_weapon:
        library, meshes = archives
        shadow = shadow_triangles(library, meshes, name)
        model_triangles = sum(len(p.triangles) for p in verify.body_parts(parts))
        if shadow is not None and model_triangles:
            ratio = len(shadow) / model_triangles
            out["shadowRatio"] = round(ratio, 3)
            if ratio > verify.SHADOW_TRIANGLE_RATIO:
                # Not a shadow mesh at all -- the Simple LOD points at the
                # weapon's own detailed body, so the comparison would measure
                # the trigger-guard hole rather than a misplacement.
                out["shadowSkipped"] = (
                    f"simple LOD is {len(shadow)} triangles against the "
                    f"model's {model_triangles} ({ratio:.2f}), so it is the "
                    f"weapon itself rather than a shadow mesh")
            else:
                bound = {
                    part.name: part.triangles
                    for part in parts
                    if part.bound_bone is not None and part.is_body
                }
                out["silhouette"] = verify.silhouette_outside(bound, shadow)
    return out


def triage_measured(measured: dict, *, length_tolerance: float,
                    vanilla_facts: bool, silhouette_fatal: bool,
                    roles: dict[str, str]) -> tuple[verify.Triage, dict]:
    """The verdict for one measured model, given what the catalogue says."""
    name = measured["name"]
    detail: dict = {"name": name, "glb": measured["glb"]}

    if "error" in measured:
        triage = verify.Triage(name)
        triage.broken(measured["error"])
        return triage, detail

    parts = measured["parts"]
    stats = measured["stats"]
    detail["triangles"] = stats.triangles

    silhouette = measured.get("silhouette")
    if silhouette is not None:
        detail["silhouette"] = {
            "aggregate": round(silhouette.aggregate, 4),
            "perPart": {k: round(v, 4) for k, v in silhouette.per_part.items()},
        }
    if "shadowRatio" in measured:
        detail["shadowRatio"] = measured["shadowRatio"]

    length = measured.get("length")
    if length is not None:
        detail["length"] = round(length, 4)
    dimensions = verify.dimension_check(name, length)
    if dimensions:
        detail["expectedLength"] = dimensions.expected

    triage = verify.triage_report(
        name, measured["report"], parts=parts, stats=stats,
        silhouette=silhouette, dimensions=dimensions,
        length_tolerance=length_tolerance,
        vanilla_facts=vanilla_facts,
        silhouette_fatal=silhouette_fatal,
        missing_asset_roles=roles,
    )
    if measured.get("shadowSkipped"):
        triage.info("silhouette check skipped: " + measured["shadowSkipped"])
    return triage, detail


def catalogue_silhouette_fatal(measured: list[dict]) -> tuple[bool, float, int]:
    """Whether this catalogue looks mirrored: (fatal, median, sample size).

    One weapon reading outside its shadow is usually the shadow. The
    regression this check exists for throws every weapon at once, so the
    median is what tells them apart -- and only with enough weapons to have
    a median worth the name.
    """
    values = sorted(m["silhouette"].aggregate for m in measured
                    if m.get("silhouette") is not None)
    if not values:
        return False, 0.0, 0
    median = (values[len(values) // 2] if len(values) % 2
              else 0.5 * (values[len(values) // 2 - 1] + values[len(values) // 2]))
    fatal = (len(values) >= verify.SILHOUETTE_CATALOGUE_MIN
             and median > verify.SILHOUETTE_CATALOGUE_FAIL)
    return fatal, median, len(values)


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

    # The archives answer two questions: the shadow mesh for the silhouette
    # check, and what in a model's own template tree wanted an asset the
    # assembler could not resolve. The second applies to every category, so
    # the library is opened whenever any model has an unresolved asset too.
    archives = None
    if not args.skip_silhouette:
        need_shadow = any(e.get("category") in ("handweapon", None) for e in entries)
        need_roles = any(
            (json.loads(p.read_text()).get("missingMeshFiles")
             or json.loads(p.read_text()).get("missingGeometryTemplates"))
            for p in [models_dir / (e["glb"][:-4] + ".report.json") for e in entries]
            if p.is_file())
        if need_shadow or need_roles:
            archives = open_archives(args.game_dir.expanduser(), args.mod)
            if archives is None:
                print(f"NOTE: game dir not found ({args.game_dir}); "
                      "silhouette checks skipped and unresolved assets left "
                      "unclassified", file=sys.stderr)

    # Pass one: measure every model. Pass two: decide how severe each reading
    # is, now that the catalogue's own shape is known.
    measured = [measure_entry(entry, models_dir, archives) for entry in entries]

    fatal, median, sample = catalogue_silhouette_fatal(measured)
    if sample:
        print(f"silhouette: median {median * 100:.1f}% outside over {sample} "
              f"weapons with a usable shadow mesh"
              + (" — above the catalogue threshold, so high readings are "
                 "treated as a mirrored .ske read" if fatal else ""))

    results: list[dict] = []
    by_status: dict[str, list[str]] = {"clean": [], "degraded": [], "broken": []}
    vanilla_facts = args.mod.lower() == "bf1942"
    for m in measured:
        # What, in this model's own template tree, wanted each asset the
        # assembler could not resolve.
        roles: dict[str, str] = {}
        report = m.get("report") or {}
        wanted = ((report.get("missingMeshFiles") or [])
                  + (report.get("missingGeometryTemplates") or []))
        if wanted and archives is not None:
            roles = missing_asset_roles(archives[0], m["name"], wanted)
        triage, detail = triage_measured(
            m, length_tolerance=args.length_tolerance,
            vanilla_facts=vanilla_facts, silhouette_fatal=fatal, roles=roles)
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
