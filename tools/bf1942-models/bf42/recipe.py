"""The split pose format: one rig glb per soldier, one recipe per pose.

A pose file used to be self-contained — `<Soldier>__<Pose>.pose.glb` carried the
soldier's body, face and hands skinned to the shared `.ske`, the weapon's whole
template tree welded under `Bip01 R Hand`, and a few KB of pose on top. Measured
2026-09-25 that is 2.8 GB of assets in which the body is stored once per pose per
soldier (36 times over for a vanilla soldier, 19 for an EoD one) and each weapon
tree once per soldier who can hold it.

Everything pose-specific is small: the skeleton's rest pose, three constant
stance clips, the weapon's attachment transform under the hand, and two
`gaitAssets` references. So a split tree carries:

  `poses/rigs/<Soldier>.rig.glb`   body, face, hands, skeleton, binds, textures
  `poses/<Soldier>__<Pose>.pose.json`  this document

and the viewer composes them at load. The rig is per *soldier*, not per pose, so
the body is stored once; the weapon half is the standalone `<Weapon>.glb` the
model extractor already publishes. Nothing else moves — the gait sidecars, the
`.ske` rig and the `.con` parsing are untouched.

**The recipe is the pose glb's own JSON, restructured**, so the two agree
number for number:

  `joints`  the joint nodes' static `translation`/`rotation` (what the glb's
            node tree holds, and what a viewer that ignores animations draws)
  `clips`   the glb's `animations`, keyed by bone name instead of node index

Both are stored in glTF space — the quaternion `gltf.quat_from_matrix` gives and
the translation with its Z mirrored, exactly the floats `build()` writes — so the
viewer assigns them without a conversion of its own, and a test can compare a
recipe against the glb it came from.

Bone keys are `ske.canonical` names (`Bip01_Pelvis` and `Bip01 Pelvis` are one
bone, case is irrelevant), because that is how the pose code has always addressed
a skeleton. The viewer normalises node names the same way.
"""

from __future__ import annotations

import json
from pathlib import Path

from . import gltf
from .gltf import _hemisphere_align
from .ske import canonical

# Bumped when the shape changes in a way an older viewer would misread. The
# viewer checks the prefix only, so a recipe from a newer extractor still loads
# as long as the keys it reads are there.
FORMAT = "bf1942-pose-recipe/1"

RIG_DIR = "rigs"

# The bone the weapon welds onto: every hand weapon's `.ske` is rooted at a bone
# named this, and the engine grafts that root onto the soldier's hand. See
# `bf42/pose.py`'s `weapon_attachment`.
WELD_BONE = "Bip01 R Hand"

# What a float is worth in a file loaded over HTTP. The glb writes float32;
# six decimal places is finer than the float32 mantissa for every value here
# (positions in metres, unit quaternions) and keeps a 55-bone clip readable.
PLACES = 6


def _round(value: float) -> float:
    out = round(value, PLACES)
    return 0.0 if out == 0 else out


def trs(rt) -> list[float]:
    """One Refractor `(Matrix3, Vector3)` as glTF's seven numbers.

    The same conversion `gltf.GlbBuilder.build` performs on a node's static
    transform and `add_animation` on a keyframe: the Z-mirrored quaternion,
    then the translation with its Z mirrored to match.
    """
    rotation, translation = rt
    quaternion = gltf.quat_from_matrix(rotation)
    return [_round(v) for v in (*quaternion, translation[0], translation[1],
                                -translation[2])]


def joints_of(locals_by_name: dict, joint_names) -> dict[str, list[float]]:
    """The bones a pose moves, as the joint nodes' static transforms."""
    names = set(joint_names) if joint_names is not None else set(locals_by_name)
    return {canonical(name): trs(locals_by_name[name])
            for name in sorted(locals_by_name) if name in names}


def still_clip(effective: dict, joint_names) -> dict:
    """A constant clip: one value per bone, held for the clip's whole length.

    This is what the pose glb writes for `stand`/`crouch`/`lie` — two keys a
    second apart holding the same transform, so a three.js `AnimationMixer` can
    crossfade between stances. `effective` is the stance's own locals *with the
    `.ske` rest filled in* for the bones every stance animates but this one does
    not, which is the rule the glb's track list already follows: a bone no
    stance moves holds its rest, and blending never mixes a posed bone against
    an unposed one.
    """
    return {"still": joints_of(effective, joint_names)}


def timeline_clip(frames: list[dict], period: float, joint_names,
                  loop: bool = True) -> dict:
    """A timed clip: `frames` over `period` seconds, one entry per bone.

    The key layout is `extract_pose.timeline_tracks`', and for the same reason:
    a looping clip gets N+1 keys, the last repeating frame 0, so its duration is
    exactly `period`; a one-shot has no wrap and spans N-1 intervals.
    """
    count = len(frames)
    names = sorted(set(frames[0]) & set(joint_names)) if frames else []
    if count <= 1:
        return {"times": [0.0, _round(period)],
                "bones": {canonical(name): [trs(frames[0][name])] * 2
                          for name in names}}
    intervals = count if loop else count - 1
    keys = count + 1 if loop else count
    step = period / intervals
    bones: dict[str, list[list[float]]] = {}
    for name in names:
        rts = [frames[k % count][name] for k in range(keys)]
        # The same hemisphere alignment `add_animation` applies, so a clip that
        # passes through a branch boundary interpolates the short arc.
        quats = _hemisphere_align([gltf.quat_from_matrix(rt[0]) for rt in rts])
        bones[canonical(name)] = [
            [_round(v) for v in (*q, rt[1][0], rt[1][1], -rt[1][2])]
            for q, rt in zip(quats, rts)]
    return {"times": [_round(k * step) for k in range(keys)], "bones": bones}


def rig_rel(soldier: str) -> str:
    """A soldier's rig, relative to `poses/` — the same in every tree."""
    return f"{RIG_DIR}/{soldier}.rig.glb"


def recipe_rel(soldier: str, pose: str) -> str:
    """A pose's recipe, relative to `poses/`."""
    return f"{soldier}__{pose}.pose.json"


def document(*, kind: str, soldier: str, pose: str, rig: str,
             joints: dict, clips: dict, root: dict,
             weapon: str | None = None, attach: dict | None = None,
             extras: dict | None = None, **fields) -> dict:
    """One recipe, ready to serialise.

    `kind` is `weapon` or `seat`; `root` is the pitched root node
    (`{"name": ..., "q": [...]}`) the pose glb carries and the rig does not;
    `attach` is the weapon's transform under `WELD_BONE`; `fields` are whatever
    else the caller wants a reader to have (the pose's own state names, the gait
    references, the clip names in order).
    """
    doc: dict = {
        "format": FORMAT,
        "kind": kind,
        "soldier": soldier,
        "pose": pose,
        "rig": rig,
        "root": root,
        "joints": joints,
        "clips": clips,
        "clipNames": list(clips),
    }
    if weapon is not None:
        doc["weapon"] = weapon
    if attach is not None:
        doc["attach"] = attach
    # A caller passing None means "this pose has none of it" — a `--gaits none`
    # export has no gait assets and an embedded one has no sidecar paths — and
    # an absent key reads the same as a null one for every reader.
    doc.update({key: value for key, value in fields.items() if value is not None})
    if extras:
        doc["extras"] = extras
    return doc


def write(out_dir: Path, soldier: str, pose: str, doc: dict) -> Path:
    """Serialise one recipe under `out_dir` and return the path.

    Compact rather than indented: these are fetched one per drawn soldier and
    there are thousands of them, and the `<Pose>.pose.report.json` beside each
    one is the human-readable record. `python3 -m json.tool` reads one back.
    """
    target = out_dir / recipe_rel(soldier, pose)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(doc, separators=(",", ":"), sort_keys=False))
    return target
