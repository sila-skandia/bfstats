#!/usr/bin/env python3
"""Export a soldier holding a weapon, posed the way the game poses him.

    python3 extract_pose.py BritishSoldier Colt GermanSoldier K98 --out ./viewer/models
    python3 extract_pose.py --matrix
    python3 extract_pose.py --matrix --export --out ./viewer/models

Positional arguments are soldier/weapon pairs. Each pair comes out as
`<Soldier>__<Weapon>.pose.glb`: the soldier's body, head and hands skinned to
the `UsSoldier.ske` skeleton posed by `Lb_Stand` + `Ub_StandAim<Weapon>`, and
the weapon's full template tree parented under the `Bip01 R Hand` joint node.
`--matrix` runs every vanilla soldier against every weapon the animation
state machine knows, measures how far each palm is from the weapon surface,
and writes `poses-matrix.json`.

The pose is driven entirely by game data: the state machine names the clip,
the clip poses the bones, the weapon skeleton's root bone names the hand it
grafts onto. Nothing here is tuned per weapon.

Standard library plus the system liblzo2, same as the rest of the pipeline.
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from bf42 import animstates, baf, con as con_mod, gltf, pose as pose_mod
from bf42 import ske as ske_mod, skin as skin_mod, stdmesh
from bf42.assemble import Assembler, Report, geometry_is_first_person
from bf42.rfa import ArchivePool
from extract_models import DEFAULT_GAME_DIR, build_library, build_pools, mod_chain

LOWER_STATE = "Lb_Stand"
UPPER_PREFIX = "Ub_"


# -- resolution ------------------------------------------------------------- #

def state_machine(meshes: ArchivePool) -> animstates.StateMachine:
    def read(path: str) -> str | None:
        return meshes.read(path).decode("latin-1") if path in meshes else None
    return animstates.parse(read)


def soldier_templates(library: con_mod.ObjectLibrary) -> list[str]:
    return sorted(
        (t.name for t in library.objects.values()
         if t.kind.lower() == "bfsoldier"
         and t.source.lower().startswith("objects/soldiers/")),
        key=str.lower)


def weapon_main_geometry(library: con_mod.ObjectLibrary, name: str,
                         ) -> str | None:
    """The weapon's principal third-person geometry, LOD alternatives resolved."""
    visited: set[str] = set()

    def visit(template_name: str, depth: int = 0) -> str | None:
        if depth > 12:
            return None
        template = library.object(template_name)
        if template is None or template.name.lower() in visited:
            return None
        visited.add(template.name.lower())
        if template.geometry and not geometry_is_first_person(template.geometry):
            return template.geometry
        children = template.children
        if template.is_lod_selector and children:
            children = [con_mod.select_lod_alternative(children, "complex")]
        for ref in children:
            child = con_mod.instance_template_name(ref, library.object)
            if child and (found := visit(child, depth + 1)):
                return found
        return None

    return visit(name)


def read_skeleton(meshes: ArchivePool, path: str) -> ske_mod.Skeleton | None:
    entry = (meshes.find(path)
             or meshes.resolve_ext(path.rsplit(".", 1)[0], (".ske",)))
    if not entry:
        return None
    try:
        return ske_mod.parse(meshes.read(entry), entry)
    except ske_mod.SkeletonError:
        return None


def read_clip(meshes: ArchivePool, path: str) -> baf.Animation | None:
    entry = meshes.find(path)
    if not entry:
        return None
    try:
        return baf.parse(meshes.read(entry), entry)
    except baf.AnimationError:
        return None


def read_skin(meshes: ArchivePool, path: str) -> skin_mod.Skin | None:
    entry = (meshes.find(path)
             or meshes.resolve_ext(path.rsplit(".", 1)[0], (".skn",)))
    if not entry:
        return None
    try:
        return skin_mod.parse(meshes.read(entry), entry)
    except skin_mod.SkinError:
        return None


class PoseError(RuntimeError):
    pass


def soldier_parts(library: con_mod.ObjectLibrary, soldier: str,
                  ) -> list[con_mod.ObjectTemplate]:
    """The skinned third-person parts: body, one head variant, both hands."""
    root = library.object(soldier)
    if root is None:
        raise PoseError(f"no such template: {soldier}")
    if root.kind.lower() != "bfsoldier":
        raise PoseError(f"{soldier} is a {root.kind}, not a BFSoldier")
    parts = []
    for ref in root.children:
        name = con_mod.instance_template_name(ref, library.object)
        if name is None:
            continue
        child = library.object(name)
        if child is None or not child.geometry:
            continue
        if geometry_is_first_person(child.geometry):
            continue
        geom = library.geometry(child.geometry)
        if geom is None or not geom.skin:
            continue
        parts.append(child)
    if not parts:
        raise PoseError(f"{soldier} has no skinned third-person parts")
    return parts


def resolve_pose(machine: animstates.StateMachine, meshes: ArchivePool,
                 weapon: str, state: str, frame: int,
                 ) -> dict[str, tuple[ske_mod.Matrix3, ske_mod.Vector3]]:
    lower_state = machine.state(LOWER_STATE)
    lower_ref = lower_state.clip_3p() if lower_state else None
    if lower_ref is None:
        raise PoseError(f"state machine has no {LOWER_STATE} clip")
    upper_ref = machine.clip_3p(f"{UPPER_PREFIX}{state}", weapon)
    if upper_ref is None:
        raise PoseError(f"no {UPPER_PREFIX}{state}{weapon} state with a 3P clip")
    lower = read_clip(meshes, lower_ref.path)
    if lower is None:
        raise PoseError(f"lower clip unreadable: {lower_ref.path}")
    upper = read_clip(meshes, upper_ref.path)
    if upper is None:
        raise PoseError(f"upper clip unreadable: {upper_ref.path}")
    locals_map = lower.local_pose(frame)
    locals_map.update(upper.local_pose(frame))
    locals_map["__upper_clip__"] = upper_ref.path  # type: ignore[assignment]
    return locals_map


# -- skinned part assembly -------------------------------------------------- #

def _match_skn_vertices(mesh_positions, skn: skin_mod.Skin) -> list[int]:
    """sm vertex index -> skn vertex index. Positions are byte-identical in
    vanilla; the nearest-vertex fallback covers rounding at dict granularity."""
    index: dict[tuple, int] = {}
    for i, vertex in enumerate(skn.vertices):
        index.setdefault(tuple(round(c, 3) for c in vertex.rest), i)
    out = []
    for position in mesh_positions:
        key = tuple(round(c, 3) for c in position)
        found = index.get(key)
        if found is None:
            found = min(range(len(skn.vertices)),
                        key=lambda i: math.dist(skn.vertices[i].rest, position))
        out.append(found)
    return out


def build_skinned_part(builder: gltf.GlbBuilder, assembler: Assembler,
                       meshes: ArchivePool, skeleton: ske_mod.Skeleton,
                       template: con_mod.ObjectTemplate,
                       joint_nodes: dict[str, int], report: Report,
                       part_report: dict) -> int | None:
    library = assembler.library
    geom = library.geometry(template.geometry)
    entry = meshes.resolve_ext(f"standardMesh/{geom.mesh_file}", (".sm",))
    if not entry:
        part_report.setdefault("missing", []).append(geom.mesh_file)
        return None
    mesh = stdmesh.parse(meshes.read(entry), entry)
    skn = read_skin(meshes, geom.skin)
    if skn is None or not mesh.lods:
        part_report.setdefault("missing", []).append(geom.skin)
        return None

    binds = pose_mod.refine_binds(skn)
    bone_map, anchor = pose_mod.remap_influences(skn, skeleton)
    part_report.setdefault("anchors", {})[template.name] = anchor

    # The skin's joint list: every mapped bone in stable order.
    joint_bones: list[str] = []
    for name in bone_map:
        if name is not None and name not in joint_bones:
            joint_bones.append(name)
    joint_bones = [name for name in joint_bones if name in binds
                   and ske_mod.canonical(name) in joint_nodes]
    slot = {name: i for i, name in enumerate(joint_bones)}

    def vertex_slots(skn_index: int) -> tuple[tuple[int, ...], tuple[float, ...]]:
        joints, weights = [], []
        for inf in skn.vertices[skn_index].influences:
            mapped = bone_map[inf.bone]
            if mapped is None or mapped not in slot:
                continue
            joints.append(slot[mapped])
            weights.append(inf.weight)
        total = sum(weights) or 1.0
        weights = [w / total for w in weights]
        joints = (joints + [0, 0, 0, 0])[:4]
        weights = (weights + [0.0, 0.0, 0.0, 0.0])[:4]
        return tuple(joints), tuple(weights)

    primitives = []
    triangles = 0
    lod = mesh.lods[0]
    for material in lod.materials:
        tris = material.triangles()
        if not tris:
            continue
        positions = material.positions()
        matched = _match_skn_vertices(positions, skn)
        slots = [vertex_slots(i) for i in matched]
        triangles += len(tris)
        primitives.append(gltf.Primitive(
            positions=positions,
            normals=material.normals(),
            uvs=material.uvs(),
            indices=[i for tri in tris for i in tri],
            material=assembler.material_for(
                builder, template.geometry, material.name, report),
            joints=[s[0] for s in slots],
            weights=[s[1] for s in slots],
        ))
    if not primitives:
        return None

    skin_index = builder.add_skin(
        [joint_nodes[ske_mod.canonical(name)] for name in joint_bones],
        [binds[name] for name in joint_bones],
        name=template.name)
    mesh_index = builder.add_mesh(geom.mesh_file, primitives)
    part_report.setdefault("parts", []).append(
        f"{template.name} [{template.geometry}] {triangles} tris, "
        f"{len(joint_bones)} joints")
    return builder.add_node(gltf.Node(
        name=template.name, mesh=mesh_index, skin=skin_index,
        extras={"templateKind": template.kind, "geometry": template.geometry},
    ))


# -- the export ------------------------------------------------------------- #

def export_pose(soldier: str, weapon: str, *, machine, meshes, textures,
                objects, library, state: str, frame: int, max_texture: int,
                out: Path | None) -> dict:
    result: dict = {"soldier": soldier, "weapon": weapon, "state": state}

    root_template = library.object(soldier)
    parts = soldier_parts(library, soldier)
    if not root_template.skeleton:
        raise PoseError(f"{soldier} declares no skeleton")
    skeleton = read_skeleton(meshes, root_template.skeleton)
    if skeleton is None:
        raise PoseError(f"skeleton unreadable: {root_template.skeleton}")

    locals_map = resolve_pose(machine, meshes, weapon, state, frame)
    result["upperClip"] = locals_map.pop("__upper_clip__")
    worlds = pose_mod.posed_worlds(skeleton, locals_map)
    posed = pose_mod.worlds_by_name(skeleton, worlds)

    weapon_template = library.object(weapon)
    if weapon_template is None:
        raise PoseError(f"no such weapon template: {weapon}")
    weapon_skeleton = (read_skeleton(meshes, weapon_template.skeleton)
                      if weapon_template.skeleton else None)
    if weapon_skeleton is not None:
        main_index = weapon_skeleton.main_index(
            weapon_template.skeleton_main, weapon)
        attach = pose_mod.weapon_attachment(weapon_skeleton, main_index)
    else:
        # GrenadeAllies: its .ske is corrupt, so the grenade sits directly on
        # the hand bone rather than at its base bone's offset from it.
        attach = (((1.0, 0.0, 0.0), (0.0, 1.0, 0.0), (0.0, 0.0, 1.0)),
                  (0.0, 0.0, 0.0))
        result["weaponSkeleton"] = "unreadable, attached at hand root"

    hand = posed.get("bip01 r hand")
    if hand is None:
        raise PoseError("posed skeleton has no Bip01 R Hand")
    result["metrics"] = weld_metrics(
        library, meshes, parts, posed, hand, attach, weapon)

    if out is None:
        return result

    builder = gltf.GlbBuilder()
    assembler = Assembler(meshes, textures, objects, library,
                          max_texture=max_texture, include_collision=False)
    report = Report(root=f"{soldier}+{weapon}", configuration="pose", lod=0)

    # Joint hierarchy: local transforms are exactly the posed locals.
    joint_nodes: dict[str, int] = {}
    children_of: dict[int, list[int]] = {}
    order: list[tuple[int, int]] = []  # (bone index, node index)
    for index, bone in enumerate(skeleton.bones):
        local = locals_map.get(ske_mod.canonical(bone.name),
                               (bone.rotation, bone.translation))
        node = builder.add_node(gltf.Node(
            name=bone.name,
            translation=local[1],
            rotation=gltf.quat_from_matrix(local[0]),
            extras={"joint": True},
        ))
        joint_nodes[ske_mod.canonical(bone.name)] = node
        order.append((index, node))
        if 0 <= bone.parent < index:
            children_of.setdefault(bone.parent, []).append(node)
    for bone_index, node_index in order:
        builder._nodes[node_index].children = children_of.get(bone_index, [])

    part_report: dict = {}
    root_children = [node for (bone_index, node) in order
                     if skeleton.bones[bone_index].parent < 0]
    for template in parts:
        node = build_skinned_part(builder, assembler, meshes, skeleton,
                                  template, joint_nodes, report, part_report)
        if node is not None:
            root_children.append(node)

    weapon_report = Report(root=weapon, configuration="complex", lod=0)
    weapon_node = assembler.build_node(builder, weapon, weapon_report)
    if weapon_node is not None:
        wrapper = builder.add_node(gltf.Node(
            name=f"{weapon} grip",
            translation=attach[1],
            rotation=gltf.quat_from_matrix(attach[0]),
            children=[weapon_node],
            extras={"weapon": weapon, "weldBone": "Bip01 R Hand"},
        ))
        builder._nodes[joint_nodes["bip01 r hand"]].children.append(wrapper)

    # Bind-pose soldier meshes stand along +Z; pitch the root onto +Y the
    # same way the static soldier export does.
    root = builder.add_node(gltf.Node(
        name=f"{soldier} holding {weapon}",
        rotation=gltf.quat_from_ypr(0.0, -90.0, 0.0),
        children=root_children,
        extras={"soldier": soldier, "weapon": weapon,
                "state": f"{UPPER_PREFIX}{state}{weapon}"},
    ))

    result["soldierParts"] = part_report
    result["weaponParts"] = weapon_report.parts
    result["texturesMissing"] = sorted(
        set(report.missing_textures + weapon_report.missing_textures))

    out.mkdir(parents=True, exist_ok=True)
    target = out / f"{soldier}__{weapon}.pose.glb"
    target.write_bytes(builder.build([root], extras={
        key: value for key, value in result.items() if key != "metrics"}))
    result["glb"] = target.name
    (out / f"{soldier}__{weapon}.pose.report.json").write_text(
        json.dumps(result, indent=2))
    return result


def weld_metrics(library, meshes, parts, posed, hand, attach, weapon) -> dict:
    """How far each palm is from the weapon surface, in metres.

    The palm is the centroid of the hand-skin vertices weighted only to that
    hand bone, posed by the same skinning the export uses; the weapon is its
    principal geometry's vertex cloud under the weld transform. `naive` is
    the same distance with the weapon left at the soldier's origin — the
    number this whole feature exists to shrink.
    """
    metrics: dict = {}
    geometry_name = weapon_main_geometry(library, weapon)
    if geometry_name is None:
        metrics["error"] = "weapon has no third-person geometry"
        return metrics
    geom = library.geometry(geometry_name)
    entry = meshes.resolve_ext(f"standardMesh/{geom.mesh_file}", (".sm",))
    if not entry:
        metrics["error"] = f"weapon mesh missing: {geom.mesh_file}"
        return metrics
    mesh = stdmesh.parse(meshes.read(entry), entry)
    raw = [p for material in mesh.lods[0].materials
           for p in material.positions()]
    world = pose_mod.rt_mul(hand, attach)
    welded = [pose_mod.apply(world, p) for p in raw]
    metrics["weaponOrigin"] = [round(v, 4) for v in world[1]]
    metrics["handBone"] = [round(v, 4) for v in hand[1]]

    for side in ("R", "L"):
        hand_part = next(
            (t for t in parts
             if f"{side.lower()}ighthand" in t.name.lower().replace("left", "L")
             or (side == "R" and "righthand" in t.name.lower())
             or (side == "L" and "lefthand" in t.name.lower())),
            None)
        if hand_part is None:
            continue
        skn = read_skin(meshes, library.geometry(hand_part.geometry).skin)
        if skn is None:
            continue
        bone_name = f"bip01 {side.lower()} hand"
        bone_index = next(
            (i for i, b in enumerate(skn.bones)
             if ske_mod.canonical(b) == bone_name), None)
        if bone_index is None:
            continue
        positions = pose_mod.skinned_positions(skn, posed)
        palm = [p for vertex, p in zip(skn.vertices, positions)
                if p is not None and len(vertex.influences) == 1
                and vertex.influences[0].bone == bone_index]
        if not palm:
            continue
        centroid = tuple(sum(p[i] for p in palm) / len(palm) for i in range(3))
        metrics[f"palm{side}"] = round(
            min(math.dist(centroid, v) for v in welded), 4)
        metrics[f"palm{side}Naive"] = round(
            min(math.dist(centroid, v) for v in raw), 4)
    return metrics


# -- CLI -------------------------------------------------------------------- #

def main() -> int:
    ap = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("pairs", nargs="*",
                    help="soldier weapon [soldier weapon ...]")
    ap.add_argument("--game-dir", type=Path, default=DEFAULT_GAME_DIR)
    ap.add_argument("--mod", default="bf1942")
    ap.add_argument("--out", type=Path,
                    default=Path(__file__).resolve().parent / "out")
    ap.add_argument("--state", default="StandAim",
                    help="upper-body state family (default: StandAim)")
    ap.add_argument("--frame", type=int, default=0)
    ap.add_argument("--max-texture", type=int, default=1024)
    ap.add_argument("--matrix", action="store_true",
                    help="verify every soldier against every weapon")
    ap.add_argument("--export", action="store_true",
                    help="with --matrix: also write every .glb")
    args = ap.parse_args()

    if not args.matrix and (not args.pairs or len(args.pairs) % 2):
        ap.error("give soldier/weapon pairs, or --matrix")

    game_dir = args.game_dir.expanduser()
    chain = mod_chain(game_dir, args.mod)
    meshes, textures, objects, _game = build_pools(chain, [])
    library = build_library(objects)
    machine = state_machine(meshes)

    context = dict(machine=machine, meshes=meshes, textures=textures,
                   objects=objects, library=library, state=args.state,
                   frame=args.frame, max_texture=args.max_texture)

    if args.matrix:
        soldiers = soldier_templates(library)
        weapons = [w for w in machine.weapons(f"{UPPER_PREFIX}{args.state}")
                   if library.object(w) is not None]
        skipped = [w for w in machine.weapons(f"{UPPER_PREFIX}{args.state}")
                   if library.object(w) is None]
        rows = []
        for soldier in soldiers:
            for weapon in weapons:
                try:
                    row = export_pose(soldier, weapon,
                                      out=args.out if args.export else None,
                                      **context)
                    status = "ok"
                except PoseError as exc:
                    row = {"soldier": soldier, "weapon": weapon,
                           "error": str(exc)}
                    status = f"FAIL {exc}"
                rows.append(row)
                m = row.get("metrics", {})
                print(f"{soldier:22s} {weapon:14s} "
                      f"R {m.get('palmR', '-'):>7} L {m.get('palmL', '-'):>7}"
                      f"  {status if status != 'ok' else ''}".rstrip(),
                      file=sys.stderr)
        args.out.mkdir(parents=True, exist_ok=True)
        (args.out / "poses-matrix.json").write_text(json.dumps({
            "state": args.state, "frame": args.frame,
            "soldiers": soldiers, "weapons": weapons,
            "weaponsWithoutTemplate": skipped,
            "pairs": rows,
        }, indent=2))
        failures = sum(1 for r in rows if "error" in r)
        print(f"\n{len(rows) - failures}/{len(rows)} pairs resolved; "
              f"matrix in {args.out / 'poses-matrix.json'}", file=sys.stderr)
        return 1 if failures else 0

    failures = 0
    for soldier, weapon in zip(args.pairs[::2], args.pairs[1::2]):
        try:
            result = export_pose(soldier, weapon, out=args.out, **context)
        except PoseError as exc:
            print(f"{soldier} + {weapon}: {exc}", file=sys.stderr)
            failures += 1
            continue
        m = result["metrics"]
        print(f"{soldier} + {weapon}: palm R {m.get('palmR')} m, "
              f"L {m.get('palmL')} m -> {result.get('glb')}", file=sys.stderr)
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
