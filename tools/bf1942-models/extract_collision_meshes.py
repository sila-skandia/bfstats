#!/usr/bin/env python3
"""Bake every vehicle/emplacement collision hull into one shared `collision-meshes.json`.

`viewer/rigid-body.js` and friends (features/vehicle-collision-physics) need the
whole per-vertex/per-face material picture `stdmesh.py`'s collision reader now
exposes (collision-response.md #5.4, #9.4) — the running scene glb carries only
ONE collision layer per part (`bf42/assemble.py::_collision_mesh_indices` picks
the last non-degenerate layer) and never the per-vertex material at all. This
writes every layer of every collision-bearing geometry a vehicle or stationary
weapon template tree can reach, keyed by the geometry's own mesh file name —
the same name `assemble.py` uses for the glb's collision/render meshes — so a
JS body can look either up the same way.

    python3 extract_collision_meshes.py --mod bf1942 --out viewer/maps/_shared

The file is `{"meshes": {<lowercase mesh file>: {bbox, layers}}, "geometries":
{<lowercase GeometryTemplate name>: <lowercase mesh file>}}`. The second map is
there because a glb collision node names its source by geometry *template*
(`sourceGeometry: "Willy_Hull_M1"`) while the mesh *file* it loads is
`Willy_Hul_M1.sm`; aliases collapse onto one mesh entry.

Coordinates match the glb bit for bit: Z negated and triangle winding flipped
the way `bf42/gltf.py::add_mesh` converts Refractor's left-handed space to
glTF's right-handed one (see `_to_viewer_vertex`/`_viewer_face` below). Per-face
normals are supplied pre-computed and pre-converted — `n = normalize((v2-v0) x
(v1-v0))` in the engine's own space and winding (collision-response.md #5.4) —
because that formula does NOT commute with the Z-mirror the same way winding
does: mirroring one axis is an orientation-reversing transform, so the correct
outward normal in viewer space is `normalize((v1'-v0') x (v2'-v0'))` computed
on the *unflipped* vertex order (see `_viewer_face_normal`'s docstring for the
derivation). Consumers must read `n` as given, never re-derive it from the
(winding-flipped) `f` array.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from bf42 import con as con_mod  # noqa: E402
from bf42 import stdmesh  # noqa: E402
from bf42.rfa import ArchivePool  # noqa: E402
from extract_models import (  # noqa: E402
    DEFAULT_GAME_DIR,
    build_library,
    build_pools,
    mod_chain,
)

# Root scope (spec: "every StandardMesh geometry referenced by any object
# template under Objects/Vehicles/, Objects/Stationary_Weapons/"). Wreck
# templates need no special casing: `WillyWreck` etc. are declared in the
# *vehicle's own* folder even though the geometry they name resolves to a mesh
# filed under `Objects/MOVE_FILES/Wreck_*` — the recursive `addTemplate` walk
# below reaches them exactly the way `bf42/assemble.py` does, regardless of
# which folder a descendant template or geometry happens to live in.
ROOT_PREFIXES = ("objects/vehicles/", "objects/stationary_weapons/")

# `checkFaceAndEdgeCollision`/`getDistanceToGeometry` cull a face whose area is
# (numerically) zero; `assemble.py::_collision_mesh_indices` drops the same
# faces from the glb for the same reason — a face with no normal cannot be hit.
# The bar itself lives in `bf42/stdmesh.py`, beside the collision records, so
# the two readers cannot drift apart; see the comment there for why it is
# 1e-20 and not the 1e-12 that ate three tanks' wheel probes.
_DEGENERATE_CROSS_SQ = stdmesh.DEGENERATE_CROSS_SQ


def collect_geometry_refs(library: con_mod.ObjectLibrary) -> dict[str, str]:
    """Every StandardMesh geometry a vehicle/emplacement template tree reaches.

    Walks `addTemplate` children the way `bf42/assemble.py::build_node` does,
    from every template whose *own* declaring `.con` sits under
    `Objects/Vehicles/` or `Objects/Stationary_Weapons/` (their sub-parts,
    turrets, LOD alternatives and wrecks are reached from there, wherever
    those descendants happen to be declared). Returns lowercase mesh-file name
    -> the file's own-cased spelling, `GeometryTemplate` aliases collapsed the
    same way `assemble.py::_mesh_index` collapses them (two geometry names
    that load the same `.sm` are one entry, not two).
    """
    mesh_files, _aliases = _walk_geometry(library)
    return mesh_files


def collect_geometry_aliases(library: con_mod.ObjectLibrary) -> dict[str, str]:
    """Lowercase `GeometryTemplate` name -> lowercase mesh-file name.

    The scene glb names a collision node's source by its *geometry template*
    (`sourceGeometry: "Willy_Hull_M1"`), while this file is keyed by the mesh
    *file* that template loads (`Willy_Hul_M1.sm`) so that aliases collapse.
    The viewer needs the step between the two.
    """
    _mesh_files, aliases = _walk_geometry(library)
    return aliases


def _walk_geometry(library: con_mod.ObjectLibrary
                   ) -> tuple[dict[str, str], dict[str, str]]:
    roots = [t for t in library.objects.values()
            if t.source.replace("\\", "/").lower().startswith(ROOT_PREFIXES)]

    visited_templates: set[str] = set()
    mesh_files: dict[str, str] = {}
    aliases: dict[str, str] = {}

    def walk(template_name: str, depth: int = 0) -> None:
        if depth > 64:
            return
        key = template_name.lower()
        if key in visited_templates:
            return
        visited_templates.add(key)
        template = library.object(template_name)
        if template is None:
            return
        if template.geometry:
            geom = library.geometry(template.geometry)
            # TreeMesh (vegetation SCM, TM-2) is a different file format;
            # nothing under Vehicles/Stationary_Weapons declares one, but skip
            # it the way `_mesh_index` does rather than assume that forever.
            if geom is not None and geom.kind.lower() != "treemesh":
                mesh_files.setdefault(geom.mesh_file.lower(), geom.mesh_file)
                aliases.setdefault(template.geometry.lower(), geom.mesh_file.lower())
        for child in template.children:
            walk(child.template, depth + 1)

    for root in roots:
        walk(root.name)
    return mesh_files, aliases


def _to_viewer_vertex(p: tuple[float, float, float]) -> tuple[float, float, float]:
    """Refractor -> glTF: negate Z (`bf42/gltf.py::add_mesh`)."""
    x, y, z = p
    return (x, y, -z)


def _viewer_face_normal(q0: tuple[float, float, float], q1: tuple[float, float, float],
                        q2: tuple[float, float, float]) -> tuple[float, float, float] | None:
    """The outward face normal in viewer space, given the face's vertices
    already Z-negated but still in the file's *original* (un-reindexed) order.

    collision-response.md #5.4 / R3 F10: in engine space the stored (and
    engine-computed) normal is `N_e = normalize((v2-v0) x (v1-v0))`. Negating
    one axis is an orientation-*reversing* map `M`, so it does not commute with
    a cross product the naive way: for any vectors `a, b`, `M(a) x M(b) =
    -M(a x b)`, i.e. `M(a x b) = M(b) x M(a)`. Substituting `a = v2-v0`,
    `b = v1-v0` (so `M(a) = q2-q0`, `M(b) = q1-q0`):

        N_v := M(N_e) = M(normalize((v2-v0) x (v1-v0)))
                       = normalize(M((v2-v0) x (v1-v0)))
                       = normalize(M(b) x M(a))            # M(a x b) = M(b) x M(a)
                       = normalize((q1-q0) x (q2-q0))

    `N_v` is the geometrically correct answer — mirroring an outward normal
    together with the surface it belongs to keeps it outward, since Z-negation
    is an orthogonal transform — and it is what `bf42/gltf.py` reproduces for
    *supplied* vertex normals by mirroring them component-wise with no extra
    sign flip. Note the cross product above uses `(q1-q0) x (q2-q0)`: the
    engine's own index pattern `(v2-v0) x (v1-v0)` applied to this same
    (unflipped) `q` order gives `-N_v`, the wrong sign — the winding flip
    `gltf.py` applies to the face's *indices* is what would let the engine's
    literal formula keep working, but this function is not re-indexing, so it
    swaps which cross-product operand comes first instead. Verified against
    two hand-worked triangles and, in `tests/test_extract_collision_meshes.py`,
    against a real closed vehicle hull (Sherman): the large majority of faces
    point away from the mesh centroid.

    Returns None for a degenerate (zero-area) face.
    """
    ux, uy, uz = q1[0] - q0[0], q1[1] - q0[1], q1[2] - q0[2]
    vx, vy, vz = q2[0] - q0[0], q2[1] - q0[1], q2[2] - q0[2]
    cx = uy * vz - uz * vy
    cy = uz * vx - ux * vz
    cz = ux * vy - uy * vx
    length_sq = cx * cx + cy * cy + cz * cz
    if length_sq <= _DEGENERATE_CROSS_SQ:
        return None
    length = length_sq ** 0.5
    return (cx / length, cy / length, cz / length)


def _round(values: tuple[float, ...], places: int = 5) -> list[float]:
    return [round(v, places) for v in values]


def _bbox_viewer(mesh: stdmesh.StandardMesh) -> list[list[float]]:
    """The mesh header's own bounds (its *visual* geometry, per the file
    layout in `bf42/stdmesh.py`), converted to viewer space.

    Z negation swaps which end of the Z range is the min and which is the
    max, so the box is rebuilt from the two mirrored corners rather than
    negating each component of `bounds_min`/`bounds_max` in place.
    """
    minx, miny, minz = mesh.bounds_min
    maxx, maxy, maxz = mesh.bounds_max
    lo = (minx, miny, -maxz)
    hi = (maxx, maxy, -minz)
    return [_round(lo), _round(hi)]


def collision_layers_for(mesh: stdmesh.StandardMesh) -> list[dict]:
    """Every collision layer of `mesh`, in file order, converted to viewer space."""
    layers: list[dict] = []
    for layer in mesh.collision_layers:
        viewer_vertices = [_to_viewer_vertex(v) for v in layer.vertices]
        v_flat: list[float] = []
        for vx, vy, vz in viewer_vertices:
            v_flat += _round((vx, vy, vz))

        f_flat: list[int] = []
        fm: list[int] = []
        n_flat: list[float] = []
        for face in layer.faces:
            i0, i1, i2 = face.vertices
            normal = _viewer_face_normal(
                viewer_vertices[i0], viewer_vertices[i1], viewer_vertices[i2])
            if normal is None:
                continue
            # Winding flip, matching `bf42/gltf.py::add_mesh` (`[a, c, b]`)
            # bit for bit -- the normal above is independently derived, not
            # re-computed from this reindexed order (see the docstring).
            f_flat += [i0, i2, i1]
            fm.append(face.material_id)
            n_flat += _round(normal)

        layers.append({
            "v": v_flat,
            "vm": list(layer.vertex_materials),
            "f": f_flat,
            "fm": fm,
            "n": n_flat,
        })
    return layers


def build_collision_meshes(meshes: ArchivePool, mesh_files: dict[str, str],
                           ) -> tuple[dict[str, dict], dict]:
    out: dict[str, dict] = {}
    stats = {"resolved": 0, "missing": [], "parse_errors": [],
             "no_collision": 0, "layers": 0, "faces": 0}
    for lower_name, mesh_file in sorted(mesh_files.items()):
        entry = meshes.resolve_ext(f"standardMesh/{mesh_file}", (".sm",))
        if not entry:
            stats["missing"].append(mesh_file)
            continue
        try:
            mesh = stdmesh.parse(meshes.read(entry), entry)
        except stdmesh.MeshError as exc:
            stats["parse_errors"].append(f"{mesh_file} ({exc})")
            continue
        stats["resolved"] += 1
        if not mesh.collision_layers:
            stats["no_collision"] += 1
            continue
        layers = collision_layers_for(mesh)
        # Vertices, not faces, are what decides whether this mesh is worth
        # keeping: `checkVsTerrain` drops a part's **col0 vertices** onto the
        # heightfield and never looks at a face (collision-response.md #7), so
        # a layer whose every face was culled is still a usable ground probe.
        # Asking for faces here is the second of the two gates that dropped
        # the Sherman's suspension.
        if not any(layer["v"] for layer in layers):
            stats["no_collision"] += 1
            continue
        out[lower_name] = {"bbox": _bbox_viewer(mesh), "layers": layers}
        stats["layers"] += len(layers)
        stats["faces"] += sum(len(layer["fm"]) for layer in layers)
    return out, stats


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--game-dir", type=Path, default=DEFAULT_GAME_DIR)
    ap.add_argument("--mod", default="bf1942")
    ap.add_argument("--out", type=Path, required=True)
    args = ap.parse_args()

    started = time.time()
    chain = mod_chain(args.game_dir, args.mod)
    meshes, _textures, objects, _game = build_pools(chain, [])
    library = build_library(objects)

    mesh_files = collect_geometry_refs(library)
    collision_meshes, stats = build_collision_meshes(meshes, mesh_files)
    aliases = {name: mesh for name, mesh in collect_geometry_aliases(library).items()
               if mesh in collision_meshes}

    args.out.mkdir(parents=True, exist_ok=True)
    out_path = args.out / "collision-meshes.json"
    text = json.dumps({"meshes": collision_meshes, "geometries": aliases},
                      separators=(",", ":"))
    out_path.write_text(text)

    print(f"{len(collision_meshes)} geometries, {stats['layers']} layers, "
          f"{stats['faces']} faces, {len(text)} bytes, "
          f"in {time.time() - started:.1f}s -> {out_path}")
    if stats["missing"]:
        print(f"missing .sm ({len(stats['missing'])}): "
              f"{', '.join(stats['missing'][:10])}")
    if stats["parse_errors"]:
        print(f"parse errors ({len(stats['parse_errors'])}): "
              f"{', '.join(stats['parse_errors'][:10])}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
