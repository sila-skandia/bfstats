#!/usr/bin/env python3
"""Export a soldier holding a weapon, posed the way the game poses him.

    python3 extract_pose.py BritishSoldier Colt GermanSoldier K98 --out ./viewer/models
    python3 extract_pose.py --matrix
    python3 extract_pose.py --matrix --export --out ./viewer/models

Positional arguments are soldier/weapon pairs. Each pair comes out as
`<Soldier>__<Weapon>.pose.glb`: the soldier's body, head and hands skinned to
the `UsSoldier.ske` skeleton posed by `Lb_Stand` + `Ub_StandAim<Weapon>`, and
the weapon's full template tree parented under the `Bip01 R Hand` joint node.
The file also carries one constant animation clip per stance — `stand`,
`crouch` (`Lb_Crouch` + `Ub_Crouch<W>`) and `lie` (`Lb_Lie` + `Ub_Lie<W>`) —
so a viewer can crossfade the shared skeleton between the three postures;
the static hierarchy stays the standing pose for viewers that ignore clips.
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
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from bf42 import animstates, baf, con as con_mod, gltf, pose as pose_mod
from bf42 import roster as roster_mod
from bf42 import ske as ske_mod, skin as skin_mod, stdmesh
from bf42.assemble import Assembler, Report, geometry_is_first_person
from bf42.rfa import ArchivePool
from extract_models import DEFAULT_GAME_DIR, build_library, build_pools, discover_levels, mod_chain

UPPER_PREFIX = "Ub_"

# Stance -> (lower-body state, upper-body state family). The upper state is
# `Ub_<family><Weapon>`. Standing keeps the ready `Ub_StandAim<W>` the export
# has always shown; crouch and prone have no separate Aim family in vanilla —
# `Ub_Crouch<W>` / `Ub_Lie<W>` (the 3PCrouchBreathUpper / 3PLieBreathUpper
# clips) ARE the weapon-holding idle in those postures — and their lower
# halves come from `Lb_Crouch` / `Lb_Lie`. The donor sharing (`copyState`)
# resolves per stance exactly as it does for StandAim: the K98 borrows the
# No4's crouch and lie clips too.
STANCES: tuple[tuple[str, str, str], ...] = (
    ("stand", "Lb_Stand", "StandAim"),
    ("crouch", "Lb_Crouch", "Crouch"),
    ("lie", "Lb_Lie", "Lie"),
)
PRIMARY_STANCE = "stand"
DEFAULT_STATE = "StandAim"


# -- resolution ------------------------------------------------------------- #

def state_machine(meshes: ArchivePool) -> animstates.StateMachine:
    def read(path: str) -> str | None:
        blob = meshes.try_read(path)
        return blob.decode("latin-1") if blob is not None else None
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


def resolve_stance(machine: animstates.StateMachine, meshes: ArchivePool,
                   weapon: str, lower_state: str, upper_family: str,
                   frame: int,
                   ) -> tuple[dict[str, tuple[ske_mod.Matrix3, ske_mod.Vector3]],
                              str, str]:
    """One stance's bone locals plus the two clip paths that made them."""
    lower_st = machine.state(lower_state)
    lower_ref = lower_st.clip_3p() if lower_st else None
    if lower_ref is None:
        raise PoseError(f"state machine has no {lower_state} clip")
    upper_ref = machine.clip_3p(f"{UPPER_PREFIX}{upper_family}", weapon)
    if upper_ref is None:
        raise PoseError(
            f"no {UPPER_PREFIX}{upper_family}{weapon} state with a 3P clip")
    lower = read_clip(meshes, lower_ref.path)
    if lower is None:
        raise PoseError(f"lower clip unreadable: {lower_ref.path}")
    upper = read_clip(meshes, upper_ref.path)
    if upper is None:
        raise PoseError(f"upper clip unreadable: {upper_ref.path}")
    locals_map = lower.local_pose(frame)
    locals_map.update(upper.local_pose(frame))
    return locals_map, lower_ref.path, upper_ref.path


def collect_stances(machine: animstates.StateMachine, meshes: ArchivePool,
                    skeleton: ske_mod.Skeleton, weapon: str, frame: int,
                    ) -> tuple[dict[str, dict], dict[str, dict]]:
    """Aligned bone locals per stance, plus the per-stance report entries.

    A stance the weapon lacks (a mod without crouch clips, say) records its
    error in the report and is skipped; the caller decides which stances are
    mandatory. Vanilla has all three for all 28 weapons.
    """
    stance_locals: dict[str, dict] = {}
    report: dict[str, dict] = {}
    for key, lower_state, upper_family in STANCES:
        try:
            locals_map, lower_path, upper_path = resolve_stance(
                machine, meshes, weapon, lower_state, upper_family, frame)
        except PoseError as exc:
            report[key] = {"error": str(exc)}
            continue
        stance_locals[key] = pose_mod.align_clip_roots(skeleton, locals_map)
        report[key] = {"lowerClip": lower_path, "upperClip": upper_path}
    return stance_locals, report


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
    bone_map, anchor = pose_mod.remap_influences(skn, skeleton, binds)
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
        if not joints and anchor in slot:
            # Every influence unmapped: ride the anchor rather than carry
            # zero weight, which three.js "repairs" into joint 0, weight 1.
            joints, weights = [slot[anchor]], [1.0]
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

    if state == DEFAULT_STATE:
        stance_locals, stance_report = collect_stances(
            machine, meshes, skeleton, weapon, frame)
        if PRIMARY_STANCE not in stance_locals:
            raise PoseError(stance_report[PRIMARY_STANCE]["error"])
        result["upperClip"] = stance_report[PRIMARY_STANCE]["upperClip"]
        result["stances"] = stance_report
    else:
        # The escape hatch for other stills (`--state Fire`, say): one
        # stance, no clips in the glb — exactly the old single-pose export.
        locals_map, _lower, upper_path = resolve_stance(
            machine, meshes, weapon, "Lb_Stand", state, frame)
        stance_locals = {
            PRIMARY_STANCE: pose_mod.align_clip_roots(skeleton, locals_map)}
        stance_report = {}
        result["upperClip"] = upper_path
    posed_by_stance = {
        key: pose_mod.worlds_by_name(
            skeleton, pose_mod.posed_worlds(skeleton, locals_a))
        for key, locals_a in stance_locals.items()}
    locals_map = stance_locals[PRIMARY_STANCE]
    posed = posed_by_stance[PRIMARY_STANCE]

    weapon_template = library.object(weapon)
    if weapon_template is None:
        raise PoseError(f"no such weapon template: {weapon}")
    weapon_skeleton = (read_skeleton(meshes, weapon_template.skeleton)
                      if weapon_template.skeleton else None)
    if weapon_skeleton is not None:
        main_index = weapon_skeleton.main_index(
            weapon_template.skeleton_main, weapon)
        attach = pose_mod.weapon_attachment(weapon_skeleton, main_index,
                                            clip_posed=True)
    else:
        # GrenadeAllies: its .ske is corrupt, so the grenade sits directly on
        # the hand bone rather than at its base bone's offset from it. The
        # clip-world yaw still applies — the hand it welds to is clip-posed,
        # and an identity attach re-expressed for that frame is just the yaw.
        attach = (pose_mod.CLIP_WORLD_YAW, (0.0, 0.0, 0.0))
        result["weaponSkeleton"] = "unreadable, attached at hand root"

    if posed.get("bip01 r hand") is None:
        raise PoseError("posed skeleton has no Bip01 R Hand")
    metrics_by_stance = weld_metrics(
        library, meshes, parts, posed_by_stance, attach, weapon)
    result["metrics"] = metrics_by_stance[PRIMARY_STANCE]
    for key, metrics in metrics_by_stance.items():
        if key in stance_report and "error" not in stance_report[key]:
            stance_report[key]["metrics"] = metrics

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
    # Skinned meshes are deliberately NOT parented under the pitched root; see
    # the note on `skinned_roots` below.
    skinned_roots: list[int] = []
    for template in parts:
        node = build_skinned_part(builder, assembler, meshes, skeleton,
                                  template, joint_nodes, report, part_report)
        if node is not None:
            skinned_roots.append(node)

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
    # same way the static soldier export does. The joints hang off this node,
    # so the pose is pitched through their world transforms.
    root = builder.add_node(gltf.Node(
        name=f"{soldier} holding {weapon}",
        rotation=gltf.quat_from_ypr(0.0, -90.0, 0.0),
        children=root_children,
        extras={"soldier": soldier, "weapon": weapon,
                "state": f"{UPPER_PREFIX}{state}{weapon}"},
    ))

    # One constant clip per stance, so a viewer can crossfade between them
    # with an AnimationMixer. Every clip carries every bone any stance
    # animates — a bone a stance's clips leave alone holds its `.ske` rest,
    # which is exactly what the static node transform falls back to — so
    # blending two clips never mixes a posed bone against an unposed one.
    # The weapon rides the hand joint; its weld transform is stance-
    # independent, so it needs no channels. The node hierarchy itself stays
    # posed at the primary stance: a viewer that ignores animations (or an
    # old deployed one) renders exactly the single-stance export.
    if len(stance_locals) > 1:
        rest_by_name = {
            ske_mod.canonical(bone.name): (bone.rotation, bone.translation)
            for bone in skeleton.bones}
        animated = sorted(
            {name for locals_a in stance_locals.values() for name in locals_a}
            & set(joint_nodes))
        for key, _lower, _upper in STANCES:
            locals_a = stance_locals.get(key)
            if locals_a is None:
                continue
            tracks = []
            for name in animated:
                value = locals_a.get(name, rest_by_name[name])
                tracks.append((joint_nodes[name], (0.0, 1.0), [value, value]))
            builder.add_animation(key, tracks)

    result["soldierParts"] = part_report
    result["weaponParts"] = weapon_report.parts
    result["texturesMissing"] = sorted(
        set(report.missing_textures + weapon_report.missing_textures))

    out.mkdir(parents=True, exist_ok=True)
    target = out / f"{soldier}__{weapon}.pose.glb"
    # A skinned mesh node sits at the scene root with no transform of its own,
    # and never under `root`. glTF says a skinned mesh node's transform MUST be
    # ignored -- vertices are already in skin space -- but three.js does not
    # ignore it: GLTFLoader binds the skeleton with `mesh.matrixWorld` as the
    # bind matrix and the renderer still applies the same matrix as the model
    # matrix, so the node's world transform lands on the vertices *before*
    # skinning. Parenting these under the pitched root therefore rotates every
    # vertex 90 degrees out of skin space and the figure collapses, while the
    # file still measures correct against the spec formula. The joints keep the
    # pitch, which is what actually poses the mesh, so the render is upright
    # either way -- identical under a spec-exact reader and under three.js.
    roots = [root] + skinned_roots
    extras = {key: value for key, value in result.items()
              if key not in ("metrics", "stances")}
    if len(stance_locals) > 1:
        extras["stanceClips"] = [key for key, _lo, _up in STANCES
                                 if key in stance_locals]
    target.write_bytes(builder.build(roots, extras=extras))
    result["glb"] = target.name
    (out / f"{soldier}__{weapon}.pose.report.json").write_text(
        json.dumps(result, indent=2))
    return result


def weld_metrics(library, meshes, parts, posed_by_stance, attach, weapon,
                 ) -> dict[str, dict]:
    """How far each palm is from the weapon surface, in metres, per stance.

    The palm is the centroid of the hand-skin vertices weighted only to that
    hand bone, posed by the same skinning the export uses; the weapon is its
    principal geometry's vertex cloud under the weld transform. `naive` is
    the same distance with the weapon left at the soldier's origin — the
    number this whole feature exists to shrink. The weapon cloud and hand
    skins are resolved once and re-posed per stance.
    """
    metrics_by_stance: dict[str, dict] = {key: {} for key in posed_by_stance}
    geometry_name = weapon_main_geometry(library, weapon)
    # `ObjectTemplate.geometry` can name a template the mod never declares —
    # EoD's M79 points at a `M79` geometry that exists nowhere in its archives.
    # The engine draws nothing for such a reference, so a named-but-unknown
    # geometry has to read the same here as no geometry at all rather than
    # dereferencing None.
    geometry = library.geometry(geometry_name) if geometry_name else None
    entry = (meshes.resolve_ext(f"standardMesh/{geometry.mesh_file}", (".sm",))
             if geometry else None)
    if geometry is None or not entry:
        error = ("weapon has no third-person geometry" if geometry is None
                 else f"weapon mesh missing: {geometry.mesh_file}")
        for metrics in metrics_by_stance.values():
            metrics["error"] = error
        return metrics_by_stance
    mesh = stdmesh.parse(meshes.read(entry), entry)
    raw = [p for material in mesh.lods[0].materials
           for p in material.positions()]

    hand_skins: dict[str, tuple] = {}
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
        bone_index = next(
            (i for i, b in enumerate(skn.bones)
             if ske_mod.canonical(b) == f"bip01 {side.lower()} hand"), None)
        if bone_index is None:
            continue
        hand_skins[side] = (skn, bone_index)

    for key, posed in posed_by_stance.items():
        metrics = metrics_by_stance[key]
        hand = posed.get("bip01 r hand")
        if hand is None:
            metrics["error"] = "posed skeleton has no Bip01 R Hand"
            continue
        world = pose_mod.rt_mul(hand, attach)
        welded = [pose_mod.apply(world, p) for p in raw]
        metrics["weaponOrigin"] = [round(v, 4) for v in world[1]]
        metrics["handBone"] = [round(v, 4) for v in hand[1]]
        for side, (skn, bone_index) in hand_skins.items():
            positions = pose_mod.skinned_positions(skn, posed)
            palm = [p for vertex, p in zip(skn.vertices, positions)
                    if p is not None and len(vertex.influences) == 1
                    and vertex.influences[0].bone == bone_index]
            if not palm:
                continue
            centroid = tuple(
                sum(p[i] for p in palm) / len(palm) for i in range(3))
            metrics[f"palm{side}"] = round(
                min(math.dist(centroid, v) for v in welded), 4)
            metrics[f"palm{side}Naive"] = round(
                min(math.dist(centroid, v) for v in raw), 4)
    return metrics_by_stance


_pose_worker_context: dict = {}


def _init_pose_worker(chain_paths: list[str]) -> None:
    chain = [Path(p) for p in chain_paths]
    meshes, textures, objects, _game = build_pools(chain, [])
    library = build_library(objects)
    machine = state_machine(meshes)
    _pose_worker_context["machine"] = machine
    _pose_worker_context["meshes"] = meshes
    _pose_worker_context["textures"] = textures
    _pose_worker_context["objects"] = objects
    _pose_worker_context["library"] = library


def _export_pose_task(task_args: tuple) -> dict:
    soldier, weapon, out_str, state, frame, max_texture = task_args
    out = Path(out_str) if out_str else None
    ctx = {**_pose_worker_context, "state": state, "frame": frame, "max_texture": max_texture}
    try:
        row = export_pose(soldier, weapon, out=out, **ctx)
    except PoseError as exc:
        row = {"soldier": soldier, "weapon": weapon, "error": str(exc)}
    return row


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
    ap.add_argument("-j", "--jobs", type=int, default=1,
                    help="parallel workers for pose export (default: 1)")
    ap.add_argument("--match-side", action="store_true",
                    help="with --matrix: only pair soldiers with weapons of their side (Allied/Axis)")
    ap.add_argument("--match-faction", action="store_true",
                    help="with --matrix: only pair soldiers with weapons of their faction/nation")
    ap.add_argument("--state", default=DEFAULT_STATE,
                    help="upper-body state family (default: StandAim, which "
                         "also packs the crouch and lie stance clips; any "
                         "other family exports that single still)")
    ap.add_argument("--frame", type=int, default=0)
    ap.add_argument("--max-texture", type=int, default=1024)
    ap.add_argument("--matrix", action="store_true",
                    help="verify every soldier against every weapon")
    ap.add_argument("--export", action="store_true",
                    help="with --matrix: also write every .glb")
    ap.add_argument("--soldiers", nargs="*", default=None,
                    help="with --matrix: restrict the rows to these soldiers "
                         "(default: every BfSoldier the mod declares)")
    ap.add_argument("--weapons", nargs="*", default=None,
                    help="with --matrix: restrict the columns to these weapons. "
                         "A mod's armoury is not vanilla's 28 — EoD declares 77 "
                         "weapons with a stand-aim state, and the full product "
                         "is a long run for a sample of it.")
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
        declared = machine.weapons(f"{UPPER_PREFIX}{args.state}")
        soldiers = soldier_templates(library)
        weapons = [w for w in declared if library.object(w) is not None]
        skipped = [w for w in declared if library.object(w) is None]
        if args.soldiers is not None:
            keep = {s.lower() for s in args.soldiers}
            soldiers = [s for s in soldiers if s.lower() in keep]
        if args.weapons is not None:
            keep = {w.lower() for w in args.weapons}
            weapons = [w for w in weapons if w.lower() in keep]
            skipped = [w for w in skipped if w.lower() in keep]
        if not soldiers or not weapons:
            ap.error("--soldiers/--weapons matched nothing in this mod's "
                     f"{len(soldier_templates(library))} soldiers / "
                     f"{len(declared)} {args.state} weapons")

        roster, _, _ = roster_mod.build(library, discover_levels(chain))
        target_pairs = []
        for soldier in soldiers:
            s_entry = roster.entry(soldier)
            s_sides = set(s_entry.get("sides", []))
            s_facs = set(s_entry.get("factions", []))
            for weapon in weapons:
                w_entry = roster.entry(weapon)
                w_sides = set(w_entry.get("sides", []))
                w_facs = set(w_entry.get("factions", []))
                if args.match_faction:
                    if not (s_facs and w_facs and (s_facs & w_facs)):
                        continue
                elif args.match_side:
                    if not (s_sides and w_sides and (s_sides & w_sides)):
                        continue
                target_pairs.append((soldier, weapon))

        rows = []
        if args.jobs > 1 and len(target_pairs) > 1:
            tasks = [(s, w, str(args.out) if args.export else None, args.state, args.frame, args.max_texture)
                     for s, w in target_pairs]
            chain_strs = [str(p) for p in chain]
            with ProcessPoolExecutor(
                max_workers=min(args.jobs, len(tasks)),
                initializer=_init_pose_worker,
                initargs=(chain_strs,),
            ) as executor:
                for row in executor.map(_export_pose_task, tasks):
                    rows.append(row)
                    status = "ok" if "error" not in row else f"FAIL {row['error']}"
                    m = row.get("metrics", {})
                    print(f"{row['soldier']:22s} {row['weapon']:14s} "
                          f"R {m.get('palmR', '-'):>7} L {m.get('palmL', '-'):>7}"
                          f"  {status if status != 'ok' else ''}".rstrip(),
                          file=sys.stderr)
        else:
            for soldier, weapon in target_pairs:
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
