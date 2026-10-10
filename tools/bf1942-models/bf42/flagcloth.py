"""A flag cloth as the engine draws it, not as its `.sm` was authored.

Every flag in the game (`flagus_m1`, `flagge_m1`, `flagjp_m1`, `flaguk_m1`,
`flagso_m1`, `flagcan_m1`) is a 20-vertex `AnimatedMesh` skinned to
`animations/flag.skn` and played by `animations/flag.ske`. The `.sm` and the
`.skn` agree with each other, but both are the authoring pose: a flat sheet
centred on its own origin, hoist at +x, with the image's top row at the
BOTTOM (V rises with y). It is not a pose the engine ever draws.

The skeleton's root, `Bone01`, is rotated half a turn (`diag(1, -1, -1)`) and
every bone below it chains along +x, so posed the cloth's hoist sits at the
bone's origin, the sheet runs out along +x for 2.1 m and hangs 1.3 m below
it, and the image's top row is the highest. Drawn from the raw `.sm`, the
same cloth straddles the top of its pole, with the free end on the wrong
side, upside down.

The level exporter has known this for control points since
`extract_map._build_flag_cloth`, which skins the cloth and ships the
`FlagBlow` clip. The flags that ride a vehicle or a static
(`AnimatedUsFlag` on a landing craft's mast, a destroyer's ensign) never
went through it: they were exported as the raw sheet, 1,374 of them across
the trees, all upside down.

These are rigid, not skinned: the cloth is posed once, at frame 0 of
`FlagBlow` (the same frame the control points' joint nodes open on), and
shipped as an ordinary mesh. The wave is a viewer matter.

Frames. Meshes and `.skn` rest positions are in the raw Refractor frame (the
exporter mirrors Z on the way out), and `.baf` clips are in the raw `.ske`
frame, so the clip's locals compose into raw-frame world matrices that apply
to the `.skn`'s bone-local offsets directly. That is exactly what
`pose.skinned_positions` does for a soldier.
"""

from __future__ import annotations

import math
from dataclasses import replace

from . import pose, ske, stdmesh

#: The skin every flag cloth in every mod names (`GeometryTemplate.setSkin`).
FLAG_SKIN = "animations/flag.skn"
FLAG_SKELETON = "animations/flag.ske"
FLAG_CLIP = "animations/Flag/FlagBlow.baf"


def is_flag_skin(path: str | None) -> bool:
    return bool(path) and path.replace("\\", "/").lower().endswith(FLAG_SKIN)


def rest_worlds(skeleton: ske.Skeleton, clip) -> dict[str, pose.RT]:
    """Canonical bone name -> raw-frame world (R, t) at frame 0 of the clip.

    A bone the clip does not name falls back to the skeleton's rest local,
    which `ske.parse` mirrored; flags name every bone, so that is a safety net
    and not a path.
    """
    locals_by_name = clip.local_pose(0) if clip is not None else {}
    return pose.worlds_by_name(
        skeleton, pose.posed_worlds(skeleton, locals_by_name))


def _nearest(skn, position) -> int:
    best, best_d = 0, math.inf
    for i, vertex in enumerate(skn.vertices):
        d = math.dist(vertex.rest, position)
        if d < best_d:
            best, best_d = i, d
    return best


def _match(positions, skn) -> list[int]:
    """`.sm` vertex -> `.skn` vertex. Byte-identical in vanilla; the nearest
    fallback covers a lower LOD whose rung re-derives a position."""
    index: dict[tuple, int] = {}
    for i, vertex in enumerate(skn.vertices):
        index.setdefault(tuple(round(c, 3) for c in vertex.rest), i)
    out = []
    for position in positions:
        found = index.get(tuple(round(c, 3) for c in position))
        out.append(found if found is not None else _nearest(skn, position))
    return out


def pose_points(positions, normals, skn, worlds: dict[str, pose.RT], *,
                exact: float | None = None):
    """Posed `(positions, normals)` for one primitive's vertices, raw frame.

    `normals` may be None. A vertex whose bones the skeleton lacks keeps its
    authored position. With `exact` set, a vertex that is not within that many
    metres of some `.skn` rest position means the cloth is not in its authored
    pose (it has been posed already, or it is another mesh), and None comes
    back: posing it again would scatter it.
    """
    matches = _match(positions, skn)
    if exact is not None:
        for p, i in zip(positions, matches):
            if math.dist(skn.vertices[i].rest, p) > exact:
                return None
    out_p, out_n = [], []
    for k, i in enumerate(matches):
        point = [0.0, 0.0, 0.0]
        turned = [0.0, 0.0, 0.0]
        total = 0.0
        n = normals[k] if normals is not None else None
        for inf in skn.vertices[i].influences:
            world = worlds.get(ske.canonical(skn.bones[inf.bone]))
            if world is None:
                continue
            moved = pose.apply(world, inf.offset)
            for axis in range(3):
                point[axis] += inf.weight * moved[axis]
            if n is not None:
                rotation = world[0]
                for axis in range(3):
                    turned[axis] += inf.weight * sum(
                        rotation[axis][c] * n[c] for c in range(3))
            total += inf.weight
        if total <= 1e-6:
            out_p.append(tuple(positions[k]))
            out_n.append(tuple(n) if n is not None else None)
            continue
        out_p.append(tuple(c / total for c in point))
        if n is not None:
            length = math.sqrt(sum(c * c for c in turned)) or 1.0
            out_n.append(tuple(c / length for c in turned))
        else:
            out_n.append(None)
    return out_p, (out_n if normals is not None else None)


def pose_mesh(mesh: stdmesh.StandardMesh, skn, worlds: dict[str, pose.RT],
              ) -> stdmesh.StandardMesh:
    """`mesh` with every vertex moved to where the skeleton holds it."""
    bounds_lo = [math.inf] * 3
    bounds_hi = [-math.inf] * 3

    def material(m: stdmesh.Material) -> stdmesh.Material:
        position = m.component("position")
        normal = m.component("normal")
        if position is None or not m.vertex_count:
            return m
        step = m.engine_stride // 4
        values = list(m.vertices)
        if len(values) < step * m.vertex_count:
            values += [0.0] * (step * m.vertex_count - len(values))
        posed_p, posed_n = pose_points(
            m.positions(), m.normals() if normal is not None else None,
            skn, worlds)
        for i, point in enumerate(posed_p):
            at = i * step + position.offset // 4
            values[at:at + 3] = point
            if posed_n is not None:
                at = i * step + normal.offset // 4
                values[at:at + 3] = posed_n[i]
            for axis in range(3):
                bounds_lo[axis] = min(bounds_lo[axis], point[axis])
                bounds_hi[axis] = max(bounds_hi[axis], point[axis])
        return replace(m, vertices=values)

    lods = [replace(lod, materials=[material(m) for m in lod.materials])
            for lod in mesh.lods]
    if math.inf in bounds_lo:
        return mesh
    return replace(mesh, lods=lods,
                   bounds_min=tuple(bounds_lo), bounds_max=tuple(bounds_hi))
