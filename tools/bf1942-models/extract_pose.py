#!/usr/bin/env python3
"""Export a soldier holding a weapon, posed the way the game poses him.

    python3 extract_pose.py BritishSoldier Colt GermanSoldier K98 --out ./viewer/models
    python3 extract_pose.py --matrix
    python3 extract_pose.py --matrix --export --out ./viewer/models

    --seat-poses extracts every seat pose the mod ships, one
    `<Soldier>__<PoseName>.pose.glb` per soldier per pose (e.g.
    `USSoldier__PassengerInWilly.pose.glb`, `USSoldier__SitInVehicle.pose.glb`),
    resolving each SeatObject's upper/lower state names the way
    `BFSoldier::setUseSeat` does — the seat's own `seatAnimationUpperBody` /
    `LowerBody` where it declares them, the soldier template's
    `Ub_SitInVehicle` / `Lb_SitInVehicle` / `Lb_StandInVehicle` where it does
    not. The viewer's `map.html` loads them onto a seat when it is occupied, so
    pressing E into a Willy's passenger door shows the soldier posed by
    `Ub_PassengerInWilly`/`Lb_PassengerInWilly`, and into its *driver's* door
    the `SitInVehicle` pair, instead of an empty seat. `--soldiers` restricts
    the rows (default: every BfSoldier).

Positional arguments are soldier/weapon pairs. Each pair comes out as
`<Soldier>__<Weapon>.pose.glb`: the soldier's body, head and hands skinned to
the `UsSoldier.ske` skeleton posed by `Lb_Stand` + `Ub_StandAim<Weapon>`, and
the weapon's full template tree parented under the `Bip01 R Hand` joint node.
The file also carries one constant animation clip per stance — `stand`,
`crouch` (`Lb_Crouch` + `Ub_Crouch<W>`) and `lie` (`Lb_Lie` + `Ub_Lie<W>`) —
so a viewer can crossfade the shared skeleton between the three postures;
the static hierarchy stays the standing pose for viewers that ignore clips.

Alongside those come the **locomotion timelines** named by `GAITS`, two clips
each (`run.lower` + `run.upper`, `walk.*`, `crouchwalk.*`, `crawl.*`): every
frame of the game's own `.baf`, at the rate the engine plays it. These are
motion, not poses — `3PRunLower` is 13 frames of a two-step stride over
0.625 s. A viewer plays a gait's two halves together and holds the stance
clips at weight 0.

They do **not** live in the pose file. Neither half of a gait varies per
pose — the lower body takes no weapon and every soldier shares one rig, and
the upper body depends only on the weapon's grip — so `--gaits shared` (the
default) writes them once into `gaits/lower.gait.glb` and
`gaits/<Grip>.gait.glb`, and each pose names its two in `extras.gaitAssets`
for a viewer to retarget by bone name. `--gaits embed` puts a private copy
in every pose file instead, and `--gaits none` skips locomotion entirely.

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
from bf42.assemble import (Assembler, Report, geometry_is_first_person,
                          is_foreign_skeleton_part)
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

# Gait -> (lower-body state, upper-body state family). Unlike the stances
# above — which are sampled at one frame and written as constant clips — these
# are baked as the clip's whole timeline, at the rate the engine plays it.
#
# **The lower and upper halves are two independent state machines with
# independent phases**, so each gait exports as two clips (`run.lower`,
# `run.upper`) rather than one resampled composite. The bone sets are disjoint
# (11 lower: root, pelvis, legs, `Spine Root`; 44 upper: `Bip01 Spine` out to
# the fingertips), which is why two `AnimationMixer` actions at full weight
# compose rather than fight, and why a composite would have to be resampled
# onto a common period it does not have — vanilla's 3P run happens to run both
# halves at 1.60, but `Lb_StrafeLeft` (1.30) against `Ub_StrafeLeft<W>` does
# not, and the 1P side of the same run state is 1.40 against 1.60.
GAITS: tuple[tuple[str, str, str], ...] = (
    ("run", "Lb_RunForward", "RunForward"),
    ("walk", "Lb_WalkForward", "WalkForward"),
    ("crouchwalk", "Lb_CrouchForward", "CrouchForward"),
    ("crawl", "Lb_LieForward", "LieForward"),
)

# Where the shared gait clips live, relative to the pose directory. The clips
# are not baked into the 224 pose files because neither half of a gait varies
# per pose: the lower body is weapon- *and* soldier-independent (one set for
# the whole game), and the upper body depends only on the weapon's grip. See
# `export_gait_clips`.
GAIT_ASSET_DIR = "gaits"
GAIT_LOWER_ASSET = "lower"
GAIT_MODES = ("shared", "embed", "none")


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
            children = [con_mod.select_lod_alternative(
                children, "complex", library.selector(template.lod_selector))]
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
        # The soldier's parachute and anything else bound to a skeleton this
        # soldier cannot pose. The predicate — and the cross-mod sweep behind it,
        # and the two wrong versions that came before it — lives in
        # `bf42.assemble.is_foreign_skeleton_part`, shared with the model
        # exporter's own child walk so the two cannot drift apart.
        if is_foreign_skeleton_part(child, root):
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


# -- locomotion timelines ---------------------------------------------------- #

def clip_timeline(animation: baf.Animation, speed: float,
                  skeleton: ske_mod.Skeleton,
                  ) -> tuple[list[dict], float]:
    """Every frame of a clip, aligned into mesh space, plus its period.

    `AnimationStateMachineInstance::updateState` advances a *normalized*
    phase by `dt * speed` and `applyOnSkeleton` reads frames
    `int(phase * N) % N` and `+1` (ledger ANIM-1), so `speed` is cycles per
    second and the clip's wall-clock period is `1 / |speed|` regardless of
    how many frames it holds. 13-frame `3PRunLower` at 1.60 is a 0.625 s
    stride; 24-frame `3PWalkLower` at 1.00 is a 1 s one — the frame count
    sets resolution, not duration.

    A negative speed runs the phase backwards (`Lb_RunBackward` is the
    forward run clip at -1.60), which is the same frames in reverse with
    frame 0 still the cycle's start.
    """
    frames = [pose_mod.align_clip_roots(skeleton, animation.local_pose(f))
              for f in range(animation.frames)]
    if speed < 0 and len(frames) > 1:
        frames = [frames[0], *reversed(frames[1:])]
    return frames, 1.0 / abs(speed)


def timeline_tracks(frames: list[dict], period: float,
                    joint_nodes: dict[str, int],
                    ) -> list[tuple[int, tuple[float, ...], list]]:
    """glTF tracks for a looping timeline: N frames over `period` seconds.

    N+1 keyframes, the last repeating frame 0, so the final segment is the
    wrap the engine's `% frames` performs and the clip's duration comes out
    at exactly `period` — a three.js `LoopRepeat` action then seams.
    """
    count = len(frames)
    step = period / count
    times = tuple(k * step for k in range(count + 1))
    tracks = []
    for name in sorted(set(frames[0]) & set(joint_nodes)):
        tracks.append((joint_nodes[name], times,
                       [frames[k % count][name] for k in range(count + 1)]))
    return tracks


def resolve_gait(machine: animstates.StateMachine, meshes: ArchivePool,
                 skeleton: ske_mod.Skeleton, weapon: str,
                 lower_state: str, upper_family: str,
                 load_frames: bool = True,
                 ) -> dict:
    """One gait's two half-body timelines, or `{"error": ...}`.

    `load_frames=False` keeps the metadata — clip paths, rates, frame counts,
    periods — and skips aligning every frame into mesh space. The shared-clip
    export needs the metadata for all 224 pairs but the frames only once per
    grip, and the alignment is the expensive half.
    """
    lower_st = machine.state(lower_state)
    lower_ref = lower_st.clip_3p() if lower_st else None
    if lower_ref is None:
        return {"error": f"state machine has no {lower_state} clip"}
    upper_ref = machine.clip_3p(f"{UPPER_PREFIX}{upper_family}", weapon)
    if upper_ref is None:
        return {"error": f"no {UPPER_PREFIX}{upper_family}{weapon} 3P clip"}
    lower = read_clip(meshes, lower_ref.path)
    upper = read_clip(meshes, upper_ref.path)
    if lower is None:
        return {"error": f"lower clip unreadable: {lower_ref.path}"}
    if upper is None:
        return {"error": f"upper clip unreadable: {upper_ref.path}"}
    entry = {
        "lowerClip": lower_ref.path,
        "upperClip": upper_ref.path,
        "lowerState": lower_st.name,
        "upperState": f"{UPPER_PREFIX}{upper_family}{weapon}",
        "lowerSpeed": lower_ref.speed,
        "upperSpeed": upper_ref.speed,
        "lowerFrames": lower.frames,
        "upperFrames": upper.frames,
        "lowerPeriod": round(1.0 / abs(lower_ref.speed), 4),
        "upperPeriod": round(1.0 / abs(upper_ref.speed), 4),
    }
    if load_frames:
        entry["lower"] = clip_timeline(lower, lower_ref.speed, skeleton)
        entry["upper"] = clip_timeline(upper, upper_ref.speed, skeleton)
    return entry


def collect_gaits(machine: animstates.StateMachine, meshes: ArchivePool,
                  skeleton: ske_mod.Skeleton, weapon: str,
                  load_frames: bool = True) -> dict[str, dict]:
    return {key: resolve_gait(machine, meshes, skeleton, weapon,
                              lower_state, upper_family, load_frames)
            for key, lower_state, upper_family in GAITS}


def gait_grip(machine: animstates.StateMachine, weapon: str) -> str | None:
    """The clip folder a weapon's third-person gait clips are filed under.

    `copyState`'s donor argument makes `Ub_RunForwardK98` play the *No4's*
    clip, so vanilla's 28 weapons resolve to 23 distinct grips — K98,
    K98Sniper, No4 and No4Sniper share one, as do Bazooka/Panzershreck and
    Colt/WalterP38. The folder is the natural name for the shared asset
    because it is the one the game itself files those clips under, and it is
    stable: every weapon resolves to the same folder on all four gaits, and
    weapons that share a folder share the playback rate too (measured across
    vanilla; both are asserted in `tests/test_gaits.py`).
    """
    for _key, _lower, family in GAITS:
        ref = machine.clip_3p(f"{UPPER_PREFIX}{family}", weapon)
        if ref is not None:
            return ref.path.replace("\\", "/").rsplit("/", 2)[-2]
    return None


def gait_assets(machine: animstates.StateMachine, weapon: str) -> dict | None:
    """Where a pair's two gait clip files live, relative to the pose folder."""
    grip = gait_grip(machine, weapon)
    if grip is None:
        return None
    return {
        "grip": grip,
        "lower": f"{GAIT_ASSET_DIR}/{GAIT_LOWER_ASSET}.gait.glb",
        "upper": f"{GAIT_ASSET_DIR}/{grip}.gait.glb",
    }


def _joint_hierarchy(builder: gltf.GlbBuilder, skeleton: ske_mod.Skeleton,
                     ) -> tuple[dict[str, int], list[int]]:
    """The skeleton as glTF nodes at `.ske` rest; returns the map and roots.

    A gait sidecar carries no geometry, but its channels still need nodes to
    target, and the track names three.js derives from those nodes are what
    retargets the clip onto a pose file's own skeleton. Building the real
    parent chain (rather than a flat list) also leaves the sidecar a valid,
    independently loadable glTF.
    """
    joint_nodes: dict[str, int] = {}
    children_of: dict[int, list[int]] = {}
    order: list[tuple[int, int]] = []
    for index, bone in enumerate(skeleton.bones):
        node = builder.add_node(gltf.Node(
            name=bone.name,
            translation=bone.translation,
            rotation=gltf.quat_from_matrix(bone.rotation),
            extras={"joint": True},
        ))
        joint_nodes[ske_mod.canonical(bone.name)] = node
        order.append((index, node))
        if 0 <= bone.parent < index:
            children_of.setdefault(bone.parent, []).append(node)
    for bone_index, node_index in order:
        builder._nodes[node_index].children = children_of.get(bone_index, [])
    roots = [node for (bone_index, node) in order
             if skeleton.bones[bone_index].parent < 0]
    return joint_nodes, roots


def _write_clip_bundle(skeleton: ske_mod.Skeleton, clips: list[tuple[str, list, float]],
                       target: Path, extras: dict) -> int:
    """One clips-only `.glb`: the joint hierarchy plus `clips`, nothing else."""
    builder = gltf.GlbBuilder()
    joint_nodes, roots = _joint_hierarchy(builder, skeleton)
    written = 0
    for name, frames, period in clips:
        tracks = timeline_tracks(frames, period, joint_nodes)
        if tracks:
            builder.add_animation(name, tracks)
            written += 1
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(builder.build(roots, extras=extras))
    return written


def export_gait_clips(machine: animstates.StateMachine, meshes: ArchivePool,
                      skeleton: ske_mod.Skeleton, weapons: list[str],
                      out: Path) -> dict:
    """Write the shared gait clip sidecars once for a whole extraction run.

    Neither half of a gait varies per pose, so baking them into every pose
    file duplicates them 224-fold:

    * the **lower** body is weapon- and soldier-independent — `Lb_RunForward`
      takes no weapon and every vanilla soldier declares the same
      `UsSoldier.ske` — so all four lower clips ship once, in
      `gaits/lower.gait.glb`;
    * the **upper** body is soldier-independent and depends only on the
      weapon's grip, so `gaits/<Grip>.gait.glb` holds that grip's four upper
      clips, 23 files for vanilla's 28 weapons.

    A pose file then names its two sidecars in `extras.gaitAssets` and the
    viewer retargets the clips onto its own skeleton by bone name.
    """
    manifest: dict = {"lower": None, "grips": {}, "weaponGrip": {}, "errors": {}}
    root = out / GAIT_ASSET_DIR

    # -- the weapon-independent lower half, once ---------------------------- #
    lower_clips: list[tuple[str, list, float]] = []
    lower_meta: dict[str, dict] = {}
    for key, lower_state, _family in GAITS:
        state = machine.state(lower_state)
        ref = state.clip_3p() if state else None
        if ref is None:
            manifest["errors"][key] = f"state machine has no {lower_state} clip"
            continue
        animation = read_clip(meshes, ref.path)
        if animation is None:
            manifest["errors"][key] = f"lower clip unreadable: {ref.path}"
            continue
        frames, period = clip_timeline(animation, ref.speed, skeleton)
        lower_clips.append((f"{key}.lower", frames, period))
        lower_meta[key] = {"state": state.name, "clip": ref.path,
                           "speed": ref.speed, "frames": animation.frames,
                           "period": round(period, 4)}
    if lower_clips:
        _write_clip_bundle(
            skeleton, lower_clips,
            root / f"{GAIT_LOWER_ASSET}.gait.glb",
            {"gaitHalf": "lower", "gaits": lower_meta,
             "skeleton": skeleton.source})
        manifest["lower"] = f"{GAIT_ASSET_DIR}/{GAIT_LOWER_ASSET}.gait.glb"

    # -- one upper bundle per grip ------------------------------------------ #
    by_grip: dict[str, list[str]] = {}
    for weapon in weapons:
        grip = gait_grip(machine, weapon)
        if grip is None:
            manifest["errors"][weapon] = "no 3P gait state"
            continue
        manifest["weaponGrip"][weapon] = grip
        by_grip.setdefault(grip, []).append(weapon)

    for grip, sharing in sorted(by_grip.items()):
        representative = sharing[0]
        clips: list[tuple[str, list, float]] = []
        meta: dict[str, dict] = {}
        for key, _lower_state, family in GAITS:
            ref = machine.clip_3p(f"{UPPER_PREFIX}{family}", representative)
            if ref is None:
                continue
            animation = read_clip(meshes, ref.path)
            if animation is None:
                manifest["errors"][f"{grip}/{key}"] = (
                    f"upper clip unreadable: {ref.path}")
                continue
            frames, period = clip_timeline(animation, ref.speed, skeleton)
            clips.append((f"{key}.upper", frames, period))
            meta[key] = {"clip": ref.path, "speed": ref.speed,
                         "frames": animation.frames, "period": round(period, 4)}
        if not clips:
            continue
        _write_clip_bundle(
            skeleton, clips, root / f"{grip}.gait.glb",
            {"gaitHalf": "upper", "grip": grip, "weapons": sorted(sharing),
             "gaits": meta, "skeleton": skeleton.source})
        manifest["grips"][grip] = f"{GAIT_ASSET_DIR}/{grip}.gait.glb"

    (root / "gaits.json").write_text(json.dumps(manifest, indent=2))
    return manifest


def write_shared_gaits(machine: animstates.StateMachine, meshes: ArchivePool,
                       library: con_mod.ObjectLibrary, soldiers: list[str],
                       weapons: list[str], out: Path) -> dict | None:
    """Run `export_gait_clips` once, on the rig the soldiers actually share.

    Every vanilla soldier declares `animations/UsSoldier.ske` (two spellings
    of one file, since Refractor paths are case-insensitive) — 67 identical
    bones — so one joint hierarchy retargets onto all of them. A mod that
    ships two genuinely different rigs would need a bundle per rig; this
    reports the mismatch rather than silently exporting the first one's
    clips for all of them.
    """
    by_skeleton: dict[str, list[str]] = {}
    for soldier in soldiers:
        template = library.object(soldier)
        if template is None or not template.skeleton:
            continue
        by_skeleton.setdefault(template.skeleton.replace("\\", "/").lower(),
                               []).append(soldier)
    if not by_skeleton:
        return None
    skeletons = {
        key: read_skeleton(meshes, library.object(who[0]).skeleton)
        for key, who in by_skeleton.items()}
    signatures = {
        key: tuple((bone.name.lower(), bone.parent) for bone in sk.bones)
        for key, sk in skeletons.items() if sk is not None}
    if len(set(signatures.values())) > 1:
        print("warning: soldiers do not share one skeleton; shared gait clips "
              f"use {next(iter(by_skeleton))}: {sorted(by_skeleton)}",
              file=sys.stderr)
    skeleton = next(sk for sk in skeletons.values() if sk is not None)
    return export_gait_clips(machine, meshes, skeleton, weapons, out)


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
                out: Path | None, gait_mode: str = "shared") -> dict:
    result: dict = {"soldier": soldier, "weapon": weapon, "state": state}

    root_template = library.object(soldier)
    parts = soldier_parts(library, soldier)
    if not root_template.skeleton:
        raise PoseError(f"{soldier} declares no skeleton")
    skeleton = read_skeleton(meshes, root_template.skeleton)
    if skeleton is None:
        raise PoseError(f"skeleton unreadable: {root_template.skeleton}")

    gaits: dict[str, dict] = {}
    if state == DEFAULT_STATE:
        stance_locals, stance_report = collect_stances(
            machine, meshes, skeleton, weapon, frame)
        if PRIMARY_STANCE not in stance_locals:
            raise PoseError(stance_report[PRIMARY_STANCE]["error"])
        result["upperClip"] = stance_report[PRIMARY_STANCE]["upperClip"]
        result["stances"] = stance_report
        if gait_mode != "none":
            # In shared mode the frames live in the sidecars that
            # `export_gait_clips` writes once per run, so a pair only needs
            # the metadata — which is also the expensive half skipped.
            gaits = collect_gaits(machine, meshes, skeleton, weapon,
                                  load_frames=(gait_mode == "embed"))
            # The frame payload stays out of the JSON; the rates and clip
            # paths are what a reader (and the viewer's readout) wants.
            result["gaits"] = {
                key: {name: value for name, value in entry.items()
                      if name not in ("lower", "upper")}
                for key, entry in gaits.items()}
            if gait_mode == "shared":
                assets = gait_assets(machine, weapon)
                if assets is not None:
                    result["gaitAssets"] = assets
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
                          max_texture=max_texture, include_collision=False,
                          include_effects=False)
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

    # Locomotion, as real timelines. Each gait ships as `<gait>.lower` and
    # `<gait>.upper` — the engine's two independent state machines — so a
    # viewer plays both at full weight for a running soldier, or keeps the
    # aim `Ub_` pose over running legs the way the game does when a player
    # runs while pointing a weapon. Each clip covers only the bones its own
    # half animates, so the halves never contend for a channel, and a bone
    # neither touches keeps the node's static (standing) transform.
    #
    # In the default `shared` mode nothing is written here: the clips are in
    # the sidecars and the viewer retargets them by bone name. `embed` puts
    # them back in the pose file, which costs +22% per file across 224 files
    # for data that has only 96 distinct values — see `export_gait_clips`.
    gait_clips_written: list[str] = []
    for key, _lower_state, _upper_family in GAITS:
        entry = gaits.get(key)
        if not entry or "error" in entry:
            continue
        if gait_mode == "embed":
            for half in ("lower", "upper"):
                frames, period = entry[half]
                tracks = timeline_tracks(frames, period, joint_nodes)
                if tracks:
                    builder.add_animation(f"{key}.{half}", tracks)
        gait_clips_written.append(key)

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
    if gait_clips_written:
        extras["gaitClips"] = gait_clips_written
        extras["gaitSource"] = gait_mode
    target.write_bytes(builder.build(roots, extras=extras))
    result["glb"] = target.name
    (out / f"{soldier}__{weapon}.pose.report.json").write_text(
        json.dumps(result, indent=2))
    return result


def resolve_seat_pose(machine: animstates.StateMachine, meshes: ArchivePool,
                      upper_state: str, lower_state: str, frame: int,
                      ) -> tuple[dict[str, tuple[ske_mod.Matrix3, ske_mod.Vector3]],
                                 str, str]:
    """One seat's bone locals plus the two clip paths that made them.

    Unlike stances — which build the upper name as `Ub_<family><Weapon>` — seat
    poses name their state explicitly (`Ub_PassengerInWilly`,
    `Lb_PassengerInWilly`), so both halves are looked up directly on the state
    machine. A passenger seat that omits `seatAnimationLowerBody` (rare, but
    the data has it) falls back to `Lb_Stand` — the engine does the same, the
    lower body is just standing legs under the seated upper body.
    """
    lower_st = machine.state(lower_state)
    if lower_st is None and lower_state != "Lb_Stand":
        lower_st = machine.state("Lb_Stand")
    lower_ref = lower_st.clip_3p() if lower_st else None
    if lower_ref is None:
        raise PoseError(f"state machine has no {lower_state} clip")
    upper_st = machine.state(upper_state)
    upper_ref = upper_st.clip_3p() if upper_st else None
    if upper_ref is None:
        raise PoseError(f"state machine has no {upper_state} clip")
    lower = read_clip(meshes, lower_ref.path)
    if lower is None:
        raise PoseError(f"lower clip unreadable: {lower_ref.path}")
    upper = read_clip(meshes, upper_ref.path)
    if upper is None:
        raise PoseError(f"upper clip unreadable: {upper_ref.path}")
    locals_map = lower.local_pose(frame)
    locals_map.update(upper.local_pose(frame))
    return locals_map, lower_ref.path, upper_ref.path


def export_seat_pose(soldier: str, upper_state: str, lower_state: str, *,
                     machine, meshes, textures, objects, library, frame: int,
                     max_texture: int, out: Path | None,
                     ) -> dict:
    """A soldier posed in a seat — no weapon, one animation clip.

    The pose glb carries the soldier's body/head/hands skinned to the skeleton,
    baked at `frame` of the seat's `Ub_`/`Lb_` clips (frame 0 = cycle start, the
    engine's `int(phase * N) % N`). The node tree holds a single
    `AnimationClip` named `seat` so a viewer can play the full seated animation;
    the root node's static transform is the frame-0 pose for viewers that ignore
    clips.

    The filename comes from `seat_pose_name`: `Ub_PassengerInWilly` +
    `Lb_PassengerInWilly` -> `USSoldier__PassengerInWilly.pose.glb`, matching
    what `map.html` derives from `extras.seat` through the same rule.
    """
    result: dict = {"soldier": soldier, "upperState": upper_state,
                    "lowerState": lower_state}

    root_template = library.object(soldier)
    parts = soldier_parts(library, soldier)
    if not root_template.skeleton:
        raise PoseError(f"{soldier} declares no skeleton")
    skeleton = read_skeleton(meshes, root_template.skeleton)
    if skeleton is None:
        raise PoseError(f"skeleton unreadable: {root_template.skeleton}")

    locals_map, lower_path, upper_path = resolve_seat_pose(
        machine, meshes, upper_state, lower_state, frame)
    locals_map = pose_mod.align_clip_roots(skeleton, locals_map)
    result["lowerClip"] = lower_path
    result["upperClip"] = upper_path

    if out is None:
        return result

    builder = gltf.GlbBuilder()
    assembler = Assembler(meshes, textures, objects, library,
                          max_texture=max_texture, include_collision=False,
                          include_effects=False)
    report = Report(root=f"{soldier}+seat:{upper_state}", configuration="pose",
                    lod=0)

    joint_nodes: dict[str, int] = {}
    children_of: dict[int, list[int]] = {}
    order: list[tuple[int, int]] = []
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
    skinned_roots: list[int] = []
    for template in parts:
        node = build_skinned_part(builder, assembler, meshes, skeleton,
                                  template, joint_nodes, report, part_report)
        if node is not None:
            skinned_roots.append(node)

    # Bind-pose soldier meshes stand along +Z (Refractor forward). Stance poses
    # pitch -90 on X so the soldier faces the side-on camera; a seat pose stands
    # the soldier upright facing the vehicle's own forward, which glTF reads as
    # -Z — a 180-degree yaw, not a coordinate-system pitch.
    root = builder.add_node(gltf.Node(
        name=f"{soldier} in {upper_state}",
        rotation=gltf.quat_from_ypr(180.0, 0.0, 0.0),
        children=root_children,
        extras={"soldier": soldier, "upperState": upper_state,
                "lowerState": lower_state, "poseKind": "seat"},
    ))

    # One looping animation clip per half — the lower and upper clips are
    # independent state machines with independent periods, mirroring how gaits
    # ship. A viewer drives both at full weight; bones neither half animates
    # hold the static (frame-0) node transform.
    lower_st = machine.state(lower_state) or machine.state("Lb_Stand")
    lower_ref = lower_st.clip_3p() if lower_st else None
    upper_st = machine.state(upper_state)
    upper_ref = upper_st.clip_3p() if upper_st else None
    lower_clip = read_clip(meshes, lower_ref.path) if lower_ref else None
    upper_clip = read_clip(meshes, upper_ref.path) if upper_ref else None
    for half, clip, ref, label in [
        ("lower", lower_clip, lower_ref, "seat.lower"),
        ("upper", upper_clip, upper_ref, "seat.upper"),
    ]:
        if clip is None or ref is None:
            continue
        frames, period = clip_timeline(clip, ref.speed, skeleton)
        tracks = timeline_tracks(frames, period, joint_nodes)
        if tracks:
            builder.add_animation(label, tracks)

    result["soldierParts"] = part_report
    result["texturesMissing"] = sorted(set(report.missing_textures))

    out.mkdir(parents=True, exist_ok=True)
    pose_name = seat_pose_name(upper_state, lower_state)
    target = out / f"{soldier}__{pose_name}.pose.glb"
    extras = {key: value for key, value in result.items()
              if key not in ("metrics", "stances")}
    target.write_bytes(builder.build([root] + skinned_roots,
                                     extras=extras))
    result["glb"] = target.name
    (out / f"{soldier}__{pose_name}.pose.report.json").write_text(
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
    soldier, weapon, out_str, state, frame, max_texture, gait_mode = task_args
    out = Path(out_str) if out_str else None
    ctx = {**_pose_worker_context, "state": state, "frame": frame,
           "max_texture": max_texture, "gait_mode": gait_mode}
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
    ap.add_argument("--gaits", choices=GAIT_MODES, default="shared",
                    help="where the locomotion timelines go. shared (default): "
                         "one set of clip sidecars under gaits/, retargeted by "
                         "bone name; embed: a copy inside every pose .glb; "
                         "none: stance stills only")
    ap.add_argument("--max-texture", type=int, default=1024)
    ap.add_argument("--matrix", action="store_true",
                    help="verify every soldier against every weapon")
    ap.add_argument("--export", action="store_true",
                    help="with --matrix: also write every .glb")
    ap.add_argument("--soldiers", nargs="*", default=None,
                    help="restrict to these soldiers (--matrix or --seat-poses; "
                         "default: every BfSoldier the mod declares)")
    ap.add_argument("--weapons", nargs="*", default=None,
                    help="with --matrix: restrict the columns to these weapons. "
                         "A mod's armoury is not vanilla's 28 — EoD declares 77 "
                         "weapons with a stand-aim state, and the full product "
                         "is a long run for a sample of it.")
    ap.add_argument("--seat-poses", action="store_true",
                    help="extract every passenger-seat pose (Ub_PassengerInX / "
                         "Lb_PassengerInX) the mod ships, one .glb per soldier per "
                         "pose. Named after the seat, not a weapon — "
                         "USSoldier__PassengerInWilly.pose.glb — so map.html looks "
                         "them up straight off extras.seat.poseAnimation.")
    args = ap.parse_args()

    if not args.matrix and not args.seat_poses and (
            not args.pairs or len(args.pairs) % 2):
        ap.error("give soldier/weapon pairs, or --matrix, or --seat-poses")

    game_dir = args.game_dir.expanduser()
    chain = mod_chain(game_dir, args.mod)
    meshes, textures, objects, _game = build_pools(chain, [])
    library = build_library(objects)
    machine = state_machine(meshes)

    context = dict(machine=machine, meshes=meshes, textures=textures,
                   objects=objects, library=library, state=args.state,
                   frame=args.frame, max_texture=args.max_texture,
                   gait_mode=args.gaits)

    if args.seat_poses:
        return extract_seat_poses(machine, meshes, textures, objects, library,
                                  args)

    if args.matrix:
        declared = machine.weapons(f"{UPPER_PREFIX}{args.state}")
    soldiers = soldier_templates(library)
    if args.soldiers is not None:
        keep = {s.lower() for s in args.soldiers}
        soldiers = [s for s in soldiers if s.lower() in keep]
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
            tasks = [(s, w, str(args.out) if args.export else None, args.state,
                      args.frame, args.max_texture, args.gaits)
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
        if args.export and args.gaits == "shared":
            shared = write_shared_gaits(
                machine, meshes, library, soldiers, weapons, args.out)
            if shared:
                print(f"shared gait clips: 1 lower + {len(shared['grips'])} "
                      f"grips for {len(shared['weaponGrip'])} weapons",
                      file=sys.stderr)
        matrix_path = args.out / "poses-matrix.json"

        # Merge rather than overwrite. A mod extracted with `--own` wants two
        # targeted passes, not the full cross product — its own soldiers against
        # every weapon their kits carry, then every soldier against its own
        # weapons — because the rest of the product is byte-identical to
        # vanilla's poses. Overwriting leaves the second pass's rows describing
        # a directory that holds both passes' `.glb` files, and the viewer
        # believes the manifest, so the first pass silently vanishes from the UI.
        #
        # Keyed on (soldier, weapon) lowercased, this run winning, so re-running
        # one pass refreshes its own rows and leaves the other's alone.
        merged: dict[tuple[str, str], dict] = {}
        if matrix_path.exists():
            try:
                previous = json.loads(matrix_path.read_text())
            except (OSError, json.JSONDecodeError):
                previous = {}
            for row in previous.get("pairs", []):
                merged[(str(row.get("soldier", "")).lower(),
                        str(row.get("weapon", "")).lower())] = row
            soldiers = sorted({*previous.get("soldiers", []), *soldiers}, key=str.lower)
            weapons = sorted({*previous.get("weapons", []), *weapons}, key=str.lower)
        for row in rows:
            merged[(row["soldier"].lower(), row["weapon"].lower())] = row
        rows = [merged[key] for key in sorted(merged)]

        matrix_path.write_text(json.dumps({
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
    pairs = list(zip(args.pairs[::2], args.pairs[1::2]))
    if args.gaits == "shared":
        # A one-pair run still has to leave the sidecars next to the pose, or
        # the viewer has a `gaitAssets` pointing at nothing.
        args.out.mkdir(parents=True, exist_ok=True)
        write_shared_gaits(machine, meshes, library,
                           sorted({s for s, _w in pairs}),
                           sorted({w for _s, w in pairs}), args.out)
    for soldier, weapon in pairs:
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


# The engine's own seat poses, for the seats that name none. `BFSoldierTemplate
# ::init` resolves all three by name (lnxded `0x0827acaf`/`0x0827acff`/
# `0x0827ad4f`, stored at template +0x294/+0x298/+0x29c) and
# `BFSoldier::setUseSeat` (`0x08271950`) spends them like this:
#
#   upper body := the seat's own `seatAnimationUpperBody`, else `Ub_SitInVehicle`
#   lower body := the seat's own `seatAnimationLowerBody`,
#                 else `Lb_StandInVehicle` when the seat is
#                      `c_SeatShowStandingSoldier`,
#                 else `Lb_SitInVehicle`
#
# Every driver's seat in the game takes the default pair: `WillySeat`,
# `KubelwagenSeat`, `ShermanBrowningSeat` and 50 others declare `seatFlags` and
# no animation at all, which is why the driver has never had a glb to load.
# These are exported under the same `<Soldier>__<Pose>.pose.glb` naming as a
# declared seat pose, so the viewer's lookup path is one path, not two.
DEFAULT_SEAT_POSES: tuple[tuple[str, str], ...] = (
    ("Ub_SitInVehicle", "Lb_SitInVehicle"),
    ("Ub_SitInVehicle", "Lb_StandInVehicle"),
)


LOWER_PREFIX = "Lb_"
STANDING_FLAG = "c_seatshowstandingsoldier"


def resolve_seat_states(template: con_mod.ObjectTemplate) -> tuple[str, str]:
    """The (upper, lower) animation states one SeatObject actually plays.

    `BFSoldier::setUseSeat` (lnxded `0x08271950`) in full. The seat's own two
    strings win where it declares them; where it does not, the soldier
    template's three defaults do, and which lower default depends on one flag.
    This is not `Lb_Stand`: no path in `setUseSeat` reaches a standing-on-the-
    ground state, and the two branches that pick a default read template
    +0x294 (`Lb_SitInVehicle`) and +0x29c (`Lb_StandInVehicle`), resolved by
    name in `BFSoldierTemplate::init` at `0x0827acaf` and `0x0827ad4f`.
    """
    upper = template.seat_animation_upper_body or "Ub_SitInVehicle"
    lower = template.seat_animation_lower_body
    if not lower:
        standing = any(f.strip().lower() == STANDING_FLAG
                       for f in template.seat_flags)
        lower = "Lb_StandInVehicle" if standing else "Lb_SitInVehicle"
    return upper, lower


def seat_pose_name(upper: str, lower: str) -> str:
    """The asset name for one resolved pair, and the viewer's lookup key.

    The upper half names it, as it always has (`Ub_PassengerInWilly` ->
    `PassengerInWilly`), because in vanilla every seat that declares an upper
    declares the matching lower. A pair whose halves disagree — a Kettenkrad
    driver sitting in the Hanomag's legs, or the engine's own default upper
    over `Lb_StandInVehicle` — carries both, so two genuinely different poses
    cannot land on one file. `Lb_Stand` is treated as no lower at all, which
    is how a mod that declares only the upper half used to be named.
    """
    upper_suffix = upper[len(UPPER_PREFIX):] if upper.startswith(UPPER_PREFIX) else upper
    lower_suffix = lower[len(LOWER_PREFIX):] if lower.startswith(LOWER_PREFIX) else lower
    if lower_suffix in (upper_suffix, "Stand"):
        return upper_suffix
    return f"{upper_suffix}-{lower_suffix}"


def discover_seat_poses(library: con_mod.ObjectLibrary
                        ) -> list[tuple[str, str]]:
    """Every (upperState, lowerState) pair the mod's seats resolve to.

    One entry per distinct pair, in declaration order, each run through
    `resolve_seat_states` — so a seat that declares nothing at all (every
    driver's seat in vanilla: `WillySeat`, `KubelwagenSeat`, 50 more) yields
    the engine's own `Ub_SitInVehicle`/`Lb_SitInVehicle`, which is the pose
    that was missing and the reason a driver was never drawn.

    A mod that pairs halves from two different seats (Black Medal's
    `Ub_PassengerInWilly` with `Lb_PassengerInHanomag`) keeps that pair rather
    than being corrected towards a matching one: it is what the game plays,
    and `seat_pose_name` now gives it a file of its own instead of colliding
    with the Willys'.
    """
    seen: list[tuple[str, str]] = []
    for template in library.objects.values():
        if template.kind.lower() != "seatobject":
            continue
        pair = resolve_seat_states(template)
        if pair not in seen:
            seen.append(pair)
    return seen


def extract_seat_poses(machine, meshes, textures, objects, library,
                       args) -> int:
    """Export one seat-pose glb per soldier per discovered pose name."""
    poses = discover_seat_poses(library)
    if not poses:
        print("no seat poses found in this mod", file=sys.stderr)
        return 0
    soldiers = soldier_templates(library)
    if args.soldiers is not None:
        keep = {s.lower() for s in args.soldiers}
        soldiers = [s for s in soldiers if s.lower() in keep]
    args.out.mkdir(parents=True, exist_ok=True)
    failures = 0
    manifest = []
    for upper, lower in poses:
        pose_name = seat_pose_name(upper, lower)
        for soldier in soldiers:
            try:
                result = export_seat_pose(
                    soldier, upper, lower,
                    out=args.out, machine=machine, meshes=meshes,
                    textures=textures, objects=objects, library=library,
                    frame=args.frame, max_texture=args.max_texture)
                manifest.append({"soldier": soldier, "pose": pose_name,
                                 "upperState": upper, "lowerState": lower,
                                 "glb": result.get("glb")})
                if "error" in result:
                    failures += 1
                    print(f"{soldier} / {pose_name}: {result['error']}",
                          file=sys.stderr)
                else:
                    print(f"{soldier} / {pose_name} -> {result.get('glb')}",
                          file=sys.stderr)
            except PoseError as exc:
                failures += 1
                print(f"{soldier} / {pose_name}: {exc}", file=sys.stderr)
    (args.out / "seat-poses.json").write_text(
        json.dumps({"poses": manifest}, indent=2))
    total = len(soldiers) * len(poses)
    ok = total - failures
    print(f"\n{ok}/{total} seat poses resolved; "
          f"manifest in {args.out / 'seat-poses.json'}", file=sys.stderr)
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
