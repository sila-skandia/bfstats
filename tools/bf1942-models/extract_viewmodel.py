#!/usr/bin/env python3
"""Export a first-person viewmodel: 1P arms + hands + weapon, with real clips.

    python3 extract_viewmodel.py USSoldier Thompson GermanSoldier MP40 \
        --out ./viewer/models/viewmodels

Positional arguments are soldier/weapon pairs, exactly like `extract_pose.py`.
Each pair comes out as `<Soldier>__<Weapon>.fp.glb`: the soldier's three
first-person meshes — the camo forearm sleeves (`1P<Nation>Body`, which despite
the name contains no torso) and the two fully-fingered hands — skinned to the
ordinary soldier skeleton, with the weapon's full template tree welded under
`Bip01 R Hand` exactly as the third-person poses do. The file carries one baked
glTF animation per first-person clip family the state machine declares:

    idle    Ub_StandAim<W>'s 1P clip at its declared rate (0.1x -- the
            breathing sway that plays when the player just stands there)
    walk    Ub_WalkForward<W>  (the same 1pRun clip at the walk rate)
    run     Ub_RunForward<W>
    fire    Ub_Fire<W>, looping while the trigger is held
    reload  Ub_StandReload<W>, plus the weapon channel: the state's declared
            `c_AsmWeaponState` clip driving the weapon's own bound parts
            (the Thompson's magazine leaves the gun and comes back)
    deploy  Ub_StandRaiseWeapon<W> -- the draw-in

Everything is data: the state machine names the clips and their rates, the
clips pose the bones, the `.ske` weld places the weapon, and the soldier's
`center1pHands` / `set1pFov` and the weapon's `soldierCameraPosition` /
`soldierZoomPosition` ride out in the extras for the viewer to mount the rig
with (see features/bf1942-3d-models/first-person-soldier.md §11 for how).

Clip timing is the engine's, not an authoring rate: a full pass of any clip
lasts `1/|speed|` seconds however many frames it holds (`clip_span`; read out
of `AnimationStateMachineInstance::updateState` and
`BoneAnimation::applyOnSkeleton`, corpus doc §3). The Thompson's fire clip at
10.0 is the 0.1 s of its 600 rpm cycle; the aim sway at 0.1 is a 10 s breath;
the reload at its tweaked 0.21 is a 4.76 s pass against the 4.8 s `reloadTime`
(the `{1p,3p}AnimationsTweaking.con` scripts, which the parser now applies,
are where the declared rates are overridden -- the run clip is declared 0.7
and plays at 1.40). Each family's `duration`, its state's `morphFactor` (the
per-second blend-in rate, `setMorphFactor`) and `returnTo` ride in the extras.

Standard library plus the system liblzo2, same as the rest of the pipeline.
"""

from __future__ import annotations

import argparse
import json
import posixpath
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from bf42 import animstates, baf, con as con_mod, gltf, pose as pose_mod
from bf42 import ske as ske_mod
from bf42.assemble import Assembler, Report
from bf42.rfa import ArchivePool
from extract_models import DEFAULT_GAME_DIR, build_library, build_pools, mod_chain
from extract_pose import (
    PoseError,
    build_skinned_part,
    read_clip,
    read_skeleton,
    state_machine,
)

# The `.baf` nominal frame rate. UNVERIFIED (first-person-soldier.md §7): 25
# fps is the PAL authoring-rate best guess. Recorded in the extras so the
# viewer can rescale a clip against a declared gameplay duration.
# (There is no authoring rate to declare any more: clip_span() below is the
# engine's own 1/|speed|, read out of updateState/applyOnSkeleton.)

# key, upper-body state family (`Ub_<family><Weapon>`), loop flag. The weapon
# channel is not listed here because it is data, not convention: a state that
# plays one names it via `setOtherState c_AsmWeaponState` and the parser
# carries it as `State.weapon_state`.
FAMILIES: tuple[tuple[str, str, bool], ...] = (
    ("idle", "StandAim", True),
    ("walk", "WalkForward", True),
    ("run", "RunForward", True),
    ("fire", "Fire", True),
    ("reload", "StandReload", False),
    ("deploy", "StandRaiseWeapon", False),
)
PRIMARY = "idle"

# Conjugation between the raw `.baf`/`.ske`-file frame convention and the
# parsed (Z-mirror) one — the same S = diag(1, 1, -1) `pose.weapon_attachment`
# uses. A weapon-channel clip poses the weapon skeleton in the raw convention;
# the exported nodes sit in the parsed one.
_S = (1.0, 1.0, -1.0)


def _conjugate(rt: pose_mod.RT) -> pose_mod.RT:
    rotation, translation = rt
    return (
        tuple(tuple(_S[i] * rotation[i][j] * _S[j] for j in range(3))
              for i in range(3)),
        (translation[0], translation[1], -translation[2]),
    )


def first_person_parts(library: con_mod.ObjectLibrary, soldier: str,
                       ) -> list[con_mod.ObjectTemplate]:
    """The soldier's skinned first-person parts: sleeves and both hands.

    `con.instance_template_name` erases any child with
    `setIsFirstPersonPart 1` before the assembler ever sees a geometry name —
    that is the gate the feature doc's §4.1 names — so this walks
    `template.children` directly and keeps exactly the parts that gate drops.
    """
    root = library.object(soldier)
    if root is None:
        raise PoseError(f"no such template: {soldier}")
    if root.kind.lower() != "bfsoldier":
        raise PoseError(f"{soldier} is a {root.kind}, not a BFSoldier")
    parts = []
    for ref in root.children:
        if ref.first_person_part != 1:
            continue
        child = library.object(ref.template)
        if child is None or not child.geometry:
            continue
        geom = library.geometry(child.geometry)
        if geom is None or not geom.skin:
            continue
        parts.append(child)
    if not parts:
        raise PoseError(f"{soldier} has no skinned first-person parts")
    return parts


def soldier_view_constants(objects: ArchivePool, soldier: con_mod.ObjectTemplate,
                           ) -> dict:
    """`center1pHands` and `set1pFov`, read from the soldier's own `.con` tree.

    Both live in `CommonSoldierData.inc`, reached by an `include` from the
    soldier's `Objects.con` — and the object library never replays includes
    (it indexes `.con` files only). So replay them here, the engine's way:
    relative to the including file's folder, textually, then hand the joined
    text to the ordinary `.con` parser against a probe template.
    """

    def gather(path: str, depth: int = 0) -> str:
        if depth > 4:
            return ""
        blob = objects.try_read(path)
        if blob is None:
            return ""
        text = blob.decode("latin-1")
        folder = path.rsplit("/", 1)[0] if "/" in path else ""
        out = [text]
        for line in text.splitlines():
            parts = line.split()
            if len(parts) >= 2 and parts[0].lower() == "include":
                target = posixpath.normpath(
                    posixpath.join(folder, parts[1].replace("\\", "/")))
                out.append(gather(target, depth + 1))
        return "\n".join(out)

    text = gather(soldier.source)
    probe_lib = con_mod.ObjectLibrary()
    probe_lib.add_con(soldier.source, "ObjectTemplate.create BFSoldier __probe\n"
                      + "\n".join(line for line in text.splitlines()
                                  if "create" not in line.lower()))
    probe = probe_lib.object("__probe")
    return {
        "center1pHands": (list(probe.center_1p_hands)
                          if probe.center_1p_hands else None),
        "fov1p": probe.fov_1p,
    }


def resolve_families(machine: animstates.StateMachine, weapon: str,
                     ) -> tuple[dict[str, dict], dict[str, dict]]:
    """Per family: the 1P clip ref and any declared weapon-channel clip ref."""
    resolved: dict[str, dict] = {}
    report: dict[str, dict] = {}
    for key, family, loop in FAMILIES:
        state = machine.state(f"Ub_{family}{weapon}")
        clip_ref = state.clip_1p() if state else None
        if clip_ref is None:
            report[key] = {"error": f"no Ub_{family}{weapon} state with a 1P clip"}
            continue
        entry: dict = {"ref": clip_ref, "loop": loop, "weaponRef": None,
                       "morphFactor": state.morph_factor,
                       "returnTo": state.return_to}
        if state.weapon_state:
            weapon_channel = machine.state(state.weapon_state)
            if weapon_channel and weapon_channel.clips:
                entry["weaponRef"] = weapon_channel.clips[0]
                entry["weaponState"] = state.weapon_state
        resolved[key] = entry
        report[key] = {
            "upperClip": clip_ref.path,
            "speed": clip_ref.speed,
            "loop": loop,
            # The rate at which the engine blends *into* this state, per
            # second (`setMorphFactor`; >= 1000 is a cut). A viewer's
            # crossfade to this clip lasts 1/morphFactor.
            "morphFactor": state.morph_factor,
            "returnTo": state.return_to,
        }
        if entry["weaponRef"] is not None:
            report[key]["weaponClip"] = entry["weaponRef"].path
            report[key]["weaponSpeed"] = entry["weaponRef"].speed
    return resolved, report


def weapon_part_locals(clip: baf.Animation, skeleton: ske_mod.Skeleton,
                       main_index: int, frame: int) -> dict[str, pose_mod.RT]:
    """Canonical bone name -> transform relative to the weapon's main bone.

    A weapon-channel clip (`ThompsonReload.baf`) poses the weapon skeleton's
    bones in the raw file convention; the exported bound parts sit relative
    to the main bone in the parsed convention (`assemble._bind_pose` uses
    `skeleton.relative`). Conjugate each clip local into the parsed
    convention, chain worlds down the weapon skeleton, and re-express against
    the main bone. At frame 0 of the Thompson reload this reproduces the
    static rest relative to 0.1 mm, which is the identity that pins it.
    """
    clip_locals = {name: _conjugate(rt)
                   for name, rt in clip.local_pose(frame).items()}
    worlds: list[pose_mod.RT] = []
    for index, bone in enumerate(skeleton.bones):
        local = clip_locals.get(ske_mod.canonical(bone.name),
                                (bone.rotation, bone.translation))
        if bone.parent < 0 or bone.parent >= index:
            worlds.append(local)
        else:
            worlds.append(pose_mod.rt_mul(worlds[bone.parent], local))
    inv_main = pose_mod.rt_inverse(worlds[main_index])
    return {
        ske_mod.canonical(bone.name): pose_mod.rt_mul(inv_main, worlds[index])
        for index, bone in enumerate(skeleton.bones)
    }


def collect_bound_nodes(builder: gltf.GlbBuilder, weapon_node: int,
                        ) -> dict[str, int]:
    """boundBone name -> node index, for every bound part under the weapon.

    Bound parts are placed relative to the weapon's main bone with identity
    wrappers between (LodObject / AnimatedBundle nodes carry no transform on
    any vanilla hand weapon), so a track that writes main-relative transforms
    onto the node lands in the right space. A bound node under a transformed
    parent would not — none exists in vanilla, and one that appeared would
    simply animate slightly off rather than crash.
    """
    found: dict[str, int] = {}
    stack = [weapon_node]
    while stack:
        index = stack.pop()
        node = builder.node(index)
        bone = (node.extras or {}).get("boundBone")
        if bone:
            found[ske_mod.canonical(bone)] = index
        stack.extend(node.children)
    return found


def clip_span(speed: float) -> float:
    """Seconds for one full pass of a clip at a declared state speed.

    The engine has no frames-per-second anywhere. `updateState` advances a
    normalized phase by `dt * speed` (lnxded 0x0832b4fa, client 0x00613c60),
    and `BoneAnimation::applyOnSkeleton` (lnxded 0x0832ed60, client
    0x0066b740) maps `frac(phase) * N` onto the frame list -- so a clip is
    `1/|speed|` seconds long however many frames it holds. The Thompson's
    fire clip at 10.0 is the 0.1 s of its 600 rpm cycle, its aim sway at 0.1
    a 10 s breath, and its reload at the tweaked 0.21 a 4.76 s pass against
    the 4.8 s `reloadTime` -- the rate was fitted to the timer in
    `1pAnimationsTweaking.con`, which is why the old `bakedSpan / reloadTime`
    stretch happened to land.
    """
    return 1.0 / (abs(speed) or 1.0)


def clip_times(frames: int, speed: float, loop: bool) -> tuple[float, ...]:
    """Key times for a baked clip.

    A looping clip has `frames` intervals -- the engine's frame B is
    `(frameA + 1) % frames`, so the wrap from the last frame back to the
    first is interpolated like any other step -- and the bake carries one
    extra key (frame 0 again) at the full span so a glTF `LoopRepeat` crosses
    the wrap the same way. A one-shot has `frames - 1` intervals: phase 0 is
    the first frame, phase 1 the last.
    """
    span = clip_span(speed)
    if frames <= 1:
        return (0.0, span)
    intervals = frames if loop else frames - 1
    count = frames + 1 if loop else frames
    return tuple(span * f / intervals for f in range(count))


def clip_loops(ref: animstates.ClipRef) -> bool:
    """`addAnimation ... <path> <speed> <loop>`: 1 / c_AsmLooping loop."""
    flag = ref.looping.strip().lower()
    return flag in ("1", "c_asmlooping", "true")


def export_viewmodel(soldier: str, weapon: str, *, machine, meshes, textures,
                     objects, library, max_texture: int, out: Path | None,
                     ) -> dict:
    result: dict = {"soldier": soldier, "weapon": weapon}

    root_template = library.object(soldier)
    parts = first_person_parts(library, soldier)
    if root_template is None or not root_template.skeleton:
        raise PoseError(f"{soldier} declares no skeleton")
    skeleton = read_skeleton(meshes, root_template.skeleton)
    if skeleton is None:
        raise PoseError(f"skeleton unreadable: {root_template.skeleton}")

    resolved, clip_report = resolve_families(machine, weapon)
    if PRIMARY not in resolved:
        raise PoseError(clip_report[PRIMARY]["error"])
    result["clips"] = clip_report

    # The static base pose: the idle 1P clip over the skeleton's own rest,
    # which is what the engine shows. In first person the lower-body state
    # machine applies nothing to the skeleton: `BFSoldier::updateAnimations`
    # hands `AnimationStateMachineInstance::updateAnimations` clip slot 1 (the
    # 1P clip), that returns when the state has no such slot (lnxded
    # 0x0832af36), and no `Lb_*` state declares one -- so Bip01, the pelvis
    # and the legs sit at the `.ske` rest that `BFSoldier::setFirstPerson`
    # restores from the template skeleton (lnxded 0x0826d3d9). `Lb_Stand`
    # frame 0 is the third-person answer; under `center1pHands` it held the
    # arms 9 cm higher and 6 cm nearer the eye than the game does, and put
    # the head bone 7 cm above the eye where the rest pose puts it 2 cm
    # below. Corpus: features/bf1942-engine-reference/subsystems/
    # handweapon-view-and-deviation.md, section 3.
    idle = read_clip(meshes, resolved[PRIMARY]["ref"].path)
    if idle is None:
        raise PoseError(f"idle clip unreadable: {resolved[PRIMARY]['ref'].path}")
    base_locals = pose_mod.align_clip_roots(skeleton, idle.local_pose(0))

    # Read every family's clips up front; a family whose file is unreadable
    # records the error and drops out rather than costing the export.
    clips: dict[str, dict] = {}
    for key, entry in resolved.items():
        upper = read_clip(meshes, entry["ref"].path)
        if upper is None:
            clip_report[key] = {"error": f"clip unreadable: {entry['ref'].path}"}
            continue
        weapon_clip = None
        if entry["weaponRef"] is not None:
            weapon_clip = read_clip(meshes, entry["weaponRef"].path)
        clips[key] = {**entry, "upper": upper, "weapon": weapon_clip}

    posed = pose_mod.worlds_by_name(
        skeleton, pose_mod.posed_worlds(skeleton, base_locals))
    if posed.get("bip01 r hand") is None:
        raise PoseError("posed skeleton has no Bip01 R Hand")

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
        main_index = None
        attach = (pose_mod.CLIP_WORLD_YAW, (0.0, 0.0, 0.0))
        result["weaponSkeleton"] = "unreadable, attached at hand root"

    result["view"] = {
        **soldier_view_constants(objects, root_template),
        "soldierCameraPosition": (
            list(weapon_template.soldier_camera_position)
            if weapon_template.soldier_camera_position else None),
        "soldierZoomPosition": (
            list(weapon_template.soldier_zoom_position)
            if weapon_template.soldier_zoom_position else None),
        "soldierZoomFov": weapon_template.soldier_zoom_fov,
        "zoomFov": weapon_template.zoom_fov,
    }
    # Clip timing is the engine's: one pass of a clip lasts 1/|speed| s
    # (clip_span), whatever its frame count. Every family's `duration`
    # below is that number.
    result["clipTiming"] = "1/speed"
    stats = weapon_template.weapon_stats()
    if stats:
        result["weaponStats"] = stats

    if out is None:
        return result

    builder = gltf.GlbBuilder()
    assembler = Assembler(meshes, textures, objects, library,
                          max_texture=max_texture, include_collision=False)
    report = Report(root=f"{soldier}+{weapon}", configuration="viewmodel",
                    lod=0, first_person=True)

    # Joint hierarchy at the base pose, exactly as extract_pose builds it.
    joint_nodes: dict[str, int] = {}
    children_of: dict[int, list[int]] = {}
    order: list[tuple[int, int]] = []
    for index, bone in enumerate(skeleton.bones):
        local = base_locals.get(ske_mod.canonical(bone.name),
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
    skinned_roots: list[int] = []
    for template in parts:
        node = build_skinned_part(builder, assembler, meshes, skeleton,
                                  template, joint_nodes, report, part_report)
        if node is not None:
            skinned_roots.append(node)
    if not skinned_roots:
        raise PoseError(f"none of {soldier}'s first-person parts produced mesh")

    weapon_report = Report(root=weapon, configuration="complex", lod=0)
    weapon_node = assembler.build_node(builder, weapon, weapon_report)
    bound_nodes: dict[str, int] = {}
    if weapon_node is not None:
        bound_nodes = collect_bound_nodes(builder, weapon_node)
        wrapper = builder.add_node(gltf.Node(
            name=f"{weapon} grip",
            translation=attach[1],
            rotation=gltf.quat_from_matrix(attach[0]),
            children=[weapon_node],
            extras={"weapon": weapon, "weldBone": "Bip01 R Hand"},
        ))
        builder._nodes[joint_nodes["bip01 r hand"]].children.append(wrapper)

    root = builder.add_node(gltf.Node(
        name=f"{soldier} {weapon} viewmodel",
        rotation=gltf.quat_from_ypr(0.0, -90.0, 0.0),
        children=root_children,
        extras={"soldier": soldier, "weapon": weapon, "viewmodel": True},
    ))

    # Baked animations. Every animation carries every bone any family's 1P
    # clip animates, plus every bound weapon part — a bone this clip leaves
    # alone holds the base pose (or the weapon rest) as a two-key constant —
    # so a viewer crossfading two clips never mixes an animated bone against
    # an unanimated one.
    rest_by_name = {
        ske_mod.canonical(bone.name): (bone.rotation, bone.translation)
        for bone in skeleton.bones}
    animated = sorted({
        name
        for entry in clips.values()
        for name in entry["upper"].local_pose(0)
    } & set(joint_nodes))
    weapon_rest: dict[str, pose_mod.RT] = {}
    if weapon_skeleton is not None and main_index is not None:
        for index, bone in enumerate(weapon_skeleton.bones):
            key = ske_mod.canonical(bone.name)
            if key in bound_nodes:
                weapon_rest[key] = weapon_skeleton.relative(index, main_index)

    for key, entry in clips.items():
        upper: baf.Animation = entry["upper"]
        speed = entry["ref"].speed
        loop = bool(entry["loop"])
        times = clip_times(upper.frames, speed, loop)
        # A loop's key list ends on frame 0 again (see clip_times), so the
        # sampled frame indices wrap once.
        frame_index = list(range(upper.frames)) + ([0] if loop and upper.frames > 1 else [])
        frame_locals = [
            pose_mod.align_clip_roots(skeleton, upper.local_pose(f))
            for f in frame_index]
        tracks = []
        for name in animated:
            if name in frame_locals[0]:
                values = [locals_f.get(name, base_locals.get(
                    name, rest_by_name[name])) for locals_f in frame_locals]
                tracks.append((joint_nodes[name], times, values))
            else:
                value = base_locals.get(name, rest_by_name[name])
                tracks.append((joint_nodes[name],
                               (times[0], times[-1]), [value, value]))
        weapon_clip: baf.Animation | None = entry.get("weapon")
        if weapon_clip is not None and weapon_skeleton is not None \
                and main_index is not None:
            weapon_speed = entry["weaponRef"].speed
            weapon_loop = clip_loops(entry["weaponRef"])
            weapon_times = clip_times(weapon_clip.frames, weapon_speed, weapon_loop)
            weapon_index = list(range(weapon_clip.frames)) + (
                [0] if weapon_loop and weapon_clip.frames > 1 else [])
            per_frame = [weapon_part_locals(weapon_clip, weapon_skeleton,
                                            main_index, f)
                         for f in weapon_index]
            clip_bones = {ske_mod.canonical(track.name)
                          for track in weapon_clip.bones}
            for bone_key, node_index in bound_nodes.items():
                if bone_key in clip_bones:
                    tracks.append((node_index, weapon_times,
                                   [frame[bone_key] for frame in per_frame]))
                elif bone_key in weapon_rest:
                    tracks.append((node_index, (times[0], times[-1]),
                                   [weapon_rest[bone_key]] * 2))
        else:
            for bone_key, node_index in bound_nodes.items():
                if bone_key in weapon_rest:
                    tracks.append((node_index, (times[0], times[-1]),
                                   [weapon_rest[bone_key]] * 2))
        builder.add_animation(key, tracks)
        clip_report[key]["frames"] = upper.frames
        # One full pass in seconds -- the engine's 1/|speed|, not a frame
        # count over an authoring rate (clip_span).
        clip_report[key]["duration"] = round(times[-1], 4)

    result["soldierParts"] = part_report
    result["weaponParts"] = weapon_report.parts
    result["boundParts"] = sorted(bound_nodes)
    result["texturesMissing"] = sorted(
        set(report.missing_textures + weapon_report.missing_textures))

    out.mkdir(parents=True, exist_ok=True)
    target = out / f"{soldier}__{weapon}.fp.glb"
    # Skinned mesh nodes sit at the scene root, never under the pitched root —
    # same three.js bind-matrix reasoning as extract_pose (see the comment
    # there); the joints carry the pitch and that is what poses the mesh.
    roots = [root] + skinned_roots
    extras = {key: value for key, value in result.items()
              if key not in ("soldierParts", "weaponParts")}
    target.write_bytes(builder.build(roots, extras=extras))
    result["glb"] = target.name
    (out / f"{soldier}__{weapon}.fp.report.json").write_text(
        json.dumps(result, indent=2))
    return result


def main() -> int:
    ap = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("pairs", nargs="*",
                    help="soldier weapon [soldier weapon ...]")
    ap.add_argument("--game-dir", type=Path, default=DEFAULT_GAME_DIR)
    ap.add_argument("--mod", default="bf1942")
    ap.add_argument("--out", type=Path,
                    default=Path(__file__).resolve().parent
                    / "viewer" / "models" / "viewmodels")
    ap.add_argument("--max-texture", type=int, default=1024)
    args = ap.parse_args()

    if not args.pairs or len(args.pairs) % 2:
        ap.error("give soldier/weapon pairs, e.g. USSoldier Thompson")

    game_dir = args.game_dir.expanduser()
    chain = mod_chain(game_dir, args.mod)
    meshes, textures, objects, _game = build_pools(chain, [])
    library = build_library(objects)
    machine = state_machine(meshes)
    context = dict(machine=machine, meshes=meshes, textures=textures,
                   objects=objects, library=library,
                   max_texture=args.max_texture)

    failures = 0
    for soldier, weapon in zip(args.pairs[::2], args.pairs[1::2]):
        try:
            result = export_viewmodel(soldier, weapon, out=args.out, **context)
        except PoseError as exc:
            print(f"{soldier} + {weapon}: {exc}", file=sys.stderr)
            failures += 1
            continue
        families = [key for key, entry in result["clips"].items()
                    if "error" not in entry]
        print(f"{soldier} + {weapon}: clips [{', '.join(families)}] "
              f"-> {result.get('glb')}", file=sys.stderr)
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
