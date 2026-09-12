"""Posing a soldier skeleton from `.baf` clips and welding a weapon to it.

Two clips make one pose. The `Lb_Stand` lower clip carries `Bip01`, the
pelvis, the legs and `Spine Root`; the per-weapon `Ub_StandAim<W>` upper clip
carries everything from `Bip01 Spine` out to the fingertips. Their union is
every bone the soldier skins reference, so the `.ske` rest pose never enters
the skinned math — it supplies the parent chain, and rest transforms only for
helper bones no skin uses (the rig's `Wrist bone`, `Bone01..03`, `backpack`,
and the `Thompson` prop bone).

**The `.ske` rest pose is not the mesh's bind pose.** `UsSoldier.ske` stores
a Thompson-holding stance — it even carries that `Thompson` bone under
`Bip01 R Hand` — while each body `.skn` was exported in its own arms-down
pose. Inverse-bind matrices must therefore come from the `.skn` (recovered
per bone from exclusively-weighted vertices, `skin.bind_poses`), never from
the skeleton's rest. The rest stance is also the exact ground truth for the
weld below: posed at rest, both Brit palms land on the Thompson (right
0.027 m, left 0.036 m to the nearest weapon vertex) and the soldier's own
`Thompson` bone coincides with the welded weapon origin to 4 mm.

**The weapon weld is a bone-name identity, not a config command.** Every
hand-weapon `.ske` is rooted at a bone literally named `Bip01 R Hand`, and
its root's rest translation is (0.305, 0, 0) — exactly the soldier's
forearm-to-hand offset, because the weapon skeletons were exported off the
same Max rig. The engine grafts that root onto the soldier's hand bone, so:

    weapon_world = posed(Bip01 R Hand) * rest(main bone relative to root)

where the main bone is `useSkeletonPartAsMain` resolved the way `ske.py`
already does. There is no `setPosition`, no attach command, and no grip
offset anywhere in `Objects.rfa` — the folder layout, the state names and
the shared bone name are the whole mechanism.

Bind recovery from exclusive vertices leaves gaps — finger-base bones in the
hand skins, the pelvis in the Marine and Canadian bodies — because too few
vertices are weighted to them alone. `refine_binds` closes those exactly:
a two-influence vertex whose other bone is known pins the missing bone's
contribution, `residual = (rest - sum(known)) / w`, and three such vertices
make the same least-squares problem `skin.recover_bind` already solves.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

from . import skin as skin_mod
from .baf import ROOT_ALIGN
from .ske import Matrix3, Skeleton, Vector3, canonical, _inverse, _mul

RT = tuple[Matrix3, Vector3]

rt_mul = _mul
rt_inverse = _inverse


def align_clip_roots(skeleton: Skeleton, locals_by_name: dict[str, RT],
                     ) -> dict[str, RT]:
    """Carry clip-driven root transforms from clip world into mesh world.

    A `.baf` root track is the one transform in a clip expressed in world
    space rather than relative to another bone, so it alone picks up the
    clip world's 180-degree yaw against mesh world (`baf.ROOT_ALIGN`).
    Bones that fall back to their `.ske` rest are left alone — the rest
    pose is already in mesh space.
    """
    out = dict(locals_by_name)
    for bone in skeleton.bones:
        if bone.parent >= 0:
            continue
        key = canonical(bone.name)
        if key in out:
            out[key] = rt_mul(ROOT_ALIGN, out[key])
    return out


def apply(rt: RT, point: Vector3) -> Vector3:
    rotation, translation = rt
    return tuple(
        sum(rotation[i][k] * point[k] for k in range(3)) + translation[i]
        for i in range(3)
    )


def posed_worlds(skeleton: Skeleton, locals_by_name: dict[str, RT]) -> list[RT]:
    """World (R, t) per bone; clip locals replace rest locals wholesale."""
    worlds: list[RT] = [None] * len(skeleton.bones)  # type: ignore[list-item]
    for index, bone in enumerate(skeleton.bones):
        local = locals_by_name.get(canonical(bone.name),
                                   (bone.rotation, bone.translation))
        if bone.parent < 0 or bone.parent >= index:
            worlds[index] = local
        else:
            worlds[index] = rt_mul(worlds[bone.parent], local)
    return worlds


def worlds_by_name(skeleton: Skeleton, worlds: list[RT]) -> dict[str, RT]:
    return {canonical(bone.name): worlds[i]
            for i, bone in enumerate(skeleton.bones)}


def weapon_attachment(weapon_skeleton: Skeleton, main_index: int | None) -> RT:
    """The weapon object's origin relative to the soldier's hand bone.

    The weapon skeleton's root *is* the hand, but its rest transform is not
    identity — it stores the hand's pose in the weapon's authoring rig,
    relative to the forearm (that is where the (0.305, 0, 0) root translation
    comes from). Grafting replaces that root with the soldier's posed hand,
    so the root's own rest must be cancelled out of the chain:

        attach = rest(root)^-1 * rest(main)
    """
    if main_index is None:
        main_index = 0
    return _mul(_inverse(weapon_skeleton.rest(0)),
                weapon_skeleton.rest(main_index))


def refine_binds(skn: skin_mod.Skin,
                 poses: dict[str, RT] | None = None,
                 rounds: int = 4) -> dict[str, RT]:
    """Bind poses per bone, extended through shared-influence vertices."""
    poses = dict(poses if poses is not None else skin_mod.bind_poses(skn))
    for _ in range(rounds):
        missing = [name for name in skn.bones if name not in poses]
        if not missing:
            break
        progressed = False
        for bone_name in missing:
            bone_index = skn.bones.index(bone_name)
            pairs = []
            for vertex in skn.vertices:
                target = next((inf for inf in vertex.influences
                               if inf.bone == bone_index), None)
                if target is None or target.weight < 0.05:
                    continue
                others = [inf for inf in vertex.influences if inf is not target]
                if any(skn.bones[inf.bone] not in poses for inf in others):
                    continue
                known = [0.0, 0.0, 0.0]
                for inf in others:
                    point = apply(poses[skn.bones[inf.bone]], inf.offset)
                    for axis in range(3):
                        known[axis] += inf.weight * point[axis]
                residual = tuple(
                    (vertex.rest[axis] - known[axis]) / target.weight
                    for axis in range(3))
                pairs.append((target.offset, residual))
            recovered = skin_mod.recover_bind(pairs)
            if recovered is not None:
                poses[bone_name] = recovered
                progressed = True
        if not progressed:
            break
    return poses


@dataclass
class SkinnedVertexGroup:
    """One skn vertex expressed for glTF: up to four (joint bone, weight)."""
    joints: tuple[int, int, int, int]
    weights: tuple[float, float, float, float]


def remap_influences(skn: skin_mod.Skin, skeleton: Skeleton,
                     binds: dict[str, RT] | None = None,
                     ) -> tuple[list[str], str | None]:
    """Per skn-bone: the driving skeleton bone it maps to.

    Bones the skeleton knows drive themselves. Bones it does not — the face
    rig's `Bone39`, `face`, the eyes — ride rigidly with the mesh's anchor
    bone, the skeleton bone that dominates this skin's weights (the head for
    every face). Vertices influenced by them then follow the anchor with
    weight 1, which is exact as long as those bones are never animated — and
    no body clip names them.

    A name match is necessary but not sufficient. The face skins and
    `UsSoldier.ske` both carry bones named `Bone07..09` from the exporter's
    default numbering — face bones in the skin, a forearm helper chain in
    the skeleton, 0.5 m apart on different limbs. Driving one with the other
    tears the face off the skull, so a matched bone must also pass a
    geometric check when `binds` are supplied: walk its `.ske` parent chain
    to the nearest bone that is also in this skin with a recovered bind, and
    compare the bind-to-bind distance against the same distance at `.ske`
    rest. For a direct parent that distance is the bone's length — invariant
    across stances, which is what makes the check safe against the skins
    being authored in different poses than the skeleton. A failed bone drags
    every skin bone whose ancestor path runs through it (the rest of the
    misnamed chain), and a bone with no recoverable bind anchors too — the
    skinning paths need its bind to use it at all.
    """
    weight_per_bone = [0.0] * len(skn.bones)
    for vertex in skn.vertices:
        for inf in vertex.influences:
            weight_per_bone[inf.bone] += inf.weight
    anchor: str | None = None
    best = -1.0
    for index, name in enumerate(skn.bones):
        if skeleton.index(name) is None:
            continue
        if binds is not None and name not in binds:
            continue
        if weight_per_bone[index] > best:
            best = weight_per_bone[index]
            anchor = name

    skn_by_canonical = {canonical(name): name for name in skn.bones}
    rest_origin: dict[int, Vector3] = {}

    def origin(index: int) -> Vector3:
        if index not in rest_origin:
            rest_origin[index] = skeleton.rest(index)[1]
        return rest_origin[index]

    verdicts: dict[str, bool] = {}  # skn bone name -> drives itself

    def drives_itself(name: str) -> bool:
        if name in verdicts:
            return verdicts[name]
        verdicts[name] = True  # break cycles optimistically
        index = skeleton.index(name)
        if index is None:
            verdicts[name] = False
            return False
        if binds is None:
            return True
        if name not in binds:
            verdicts[name] = False
            return False
        if name == anchor:
            return True
        parent = skeleton.bones[index].parent
        while parent >= 0:
            other = skn_by_canonical.get(canonical(skeleton.bones[parent].name))
            if other is not None and other in binds:
                if not drives_itself(other):
                    verdicts[name] = False  # the misnamed chain continues
                    return False
                d_skn = math.dist(binds[name][1], binds[other][1])
                d_ske = math.dist(origin(index), origin(parent))
                verdicts[name] = abs(d_skn - d_ske) <= 0.05 + 0.2 * d_ske
                return verdicts[name]
            parent = skeleton.bones[parent].parent
        return True  # nothing to test against

    mapped = [name if drives_itself(name) else anchor for name in skn.bones]
    return mapped, anchor


def skinned_positions(skn: skin_mod.Skin, posed: dict[str, RT],
                      bone_map: list[str] | None = None,
                      binds: dict[str, RT] | None = None,
                      ) -> list[Vector3 | None]:
    """CPU linear-blend skinning straight from the bone-local offsets.

    Influences whose bone maps to itself need no bind at all — the offset is
    bone-local and the posed world carries it. A remapped influence (face
    bone riding the head) needs the anchor's bind to re-express the vertex:
    that path uses `binds` and the vertex's rest position instead.
    """
    out: list[Vector3 | None] = []
    for vertex in skn.vertices:
        accumulated = [0.0, 0.0, 0.0]
        total = 0.0
        for inf in vertex.influences:
            source = skn.bones[inf.bone]
            target = bone_map[inf.bone] if bone_map else source
            if target is None:
                continue
            key = canonical(target)
            if key not in posed:
                continue
            if target == source:
                point = apply(posed[key], inf.offset)
            else:
                if binds is None or target not in binds:
                    continue
                local = apply(rt_inverse(binds[target]), vertex.rest)
                point = apply(posed[key], local)
            for axis in range(3):
                accumulated[axis] += inf.weight * point[axis]
            total += inf.weight
        out.append(tuple(value / total for value in accumulated)
                   if total > 1e-3 else None)
    return out
