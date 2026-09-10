"""Refractor `.skn` bind-pose skins.

A StandardMesh `.sm` stores triangles. The matching `.skn` stores, for each
unique vertex, the rest-pose position (identical to the `.sm`) and one or two
bone influences. Each influence is a bone-local offset: at bind pose,

    rest = R * offset + T

with (R, T) the bone's world matrix. Recovering that matrix from exclusive
vertices is exact — the records are a rigid transform, not a guess.

Soldier body, head and hand meshes are separate Max exports. Body and head
share a bind so they stack at the origin; the hands do not. They still share
forearm bones with the body, and those recovered matrices are the rigid map
that puts a hand onto the sleeve it was skinned against.
"""

from __future__ import annotations

import math
import struct
from dataclasses import dataclass


class SkinError(ValueError):
    pass


@dataclass(frozen=True)
class Influence:
    bone: int
    weight: float
    offset: tuple[float, float, float]


@dataclass(frozen=True)
class SkinVertex:
    rest: tuple[float, float, float]
    influences: tuple[Influence, ...]


@dataclass
class Skin:
    vertices: list[SkinVertex]
    bones: list[str]


# Prefer the bone that actually meets the sleeve. Hands are not in the body
# skin; the forearm is the last shared link.
_ALIGN_PREFERENCE = ("forearm", "hand", "upperarm", "clavicle")


def parse(data: bytes, name: str = "") -> Skin:
    if len(data) < 8:
        raise SkinError(f"truncated skin header in {name or 'skin'}")
    version, count = struct.unpack_from("<II", data, 0)
    if version != 1:
        raise SkinError(f"unsupported skin version {version} in {name or 'skin'}")
    pos = 8
    vertices: list[SkinVertex] = []
    try:
        for _ in range(count):
            rest = struct.unpack_from("<3f", data, pos)
            pos += 12
            ninf = data[pos]
            pos += 1
            if ninf < 1 or ninf > 8:
                raise SkinError(f"bad influence count {ninf} in {name or 'skin'}")
            inf: list[Influence] = []
            for _ in range(ninf):
                bone, = struct.unpack_from("<H", data, pos)
                pos += 2
                weight, = struct.unpack_from("<f", data, pos)
                pos += 4
                offset = struct.unpack_from("<3f", data, pos)
                pos += 12
                inf.append(Influence(bone, weight, offset))
            vertices.append(SkinVertex(rest, tuple(inf)))
        n_bones, = struct.unpack_from("<H", data, pos)
        pos += 2
        bones: list[str] = []
        for _ in range(n_bones):
            nlen, = struct.unpack_from("<H", data, pos)
            pos += 2
            raw = data[pos:pos + nlen]
            pos += nlen
            bones.append(raw.split(b"\0", 1)[0].decode("latin-1"))
    except (struct.error, IndexError) as exc:
        raise SkinError(f"truncated skin records in {name or 'skin'}") from exc
    return Skin(vertices, bones)


def exclusive_pairs(skin: Skin, bone: str) -> list[tuple[tuple[float, float, float], tuple[float, float, float]]]:
    """(offset, rest) for vertices weighted only to `bone`."""
    try:
        index = skin.bones.index(bone)
    except ValueError:
        return []
    out: list[tuple[tuple[float, float, float], tuple[float, float, float]]] = []
    for vertex in skin.vertices:
        if len(vertex.influences) != 1:
            continue
        inf = vertex.influences[0]
        if inf.bone == index and inf.weight > 0.99:
            out.append((inf.offset, vertex.rest))
    return out


def recover_bind(pairs: list[tuple[tuple[float, float, float], tuple[float, float, float]]]):
    """Least-squares rigid rest = R * offset + T. None if underdetermined."""
    if len(pairs) < 3:
        return None
    ata = [[0.0] * 12 for _ in range(12)]
    atb = [0.0] * 12
    for offset, rest in pairs:
        ox, oy, oz = offset
        rows = (
            ([ox, oy, oz, 1, 0, 0, 0, 0, 0, 0, 0, 0], rest[0]),
            ([0, 0, 0, 0, ox, oy, oz, 1, 0, 0, 0, 0], rest[1]),
            ([0, 0, 0, 0, 0, 0, 0, 0, ox, oy, oz, 1], rest[2]),
        )
        for row, value in rows:
            for i in range(12):
                atb[i] += row[i] * value
                for j in range(12):
                    ata[i][j] += row[i] * row[j]
    matrix = [ata[i][:] + [atb[i]] for i in range(12)]
    for i in range(12):
        pivot = i
        for row in range(i + 1, 12):
            if abs(matrix[row][i]) > abs(matrix[pivot][i]):
                pivot = row
        matrix[i], matrix[pivot] = matrix[pivot], matrix[i]
        if abs(matrix[i][i]) < 1e-12:
            return None
        scale = matrix[i][i]
        for j in range(i, 13):
            matrix[i][j] /= scale
        for row in range(12):
            if row == i:
                continue
            scale = matrix[row][i]
            for j in range(i, 13):
                matrix[row][j] -= scale * matrix[i][j]
    x = [matrix[i][12] for i in range(12)]
    rotation = (
        (x[0], x[1], x[2]),
        (x[4], x[5], x[6]),
        (x[8], x[9], x[10]),
    )
    translation = (x[3], x[7], x[11])
    return rotation, translation


def bind_poses(skin: Skin) -> dict[str, tuple[tuple[tuple[float, float, float], ...], tuple[float, float, float]]]:
    poses: dict[str, tuple[tuple[tuple[float, float, float], ...], tuple[float, float, float]]] = {}
    for bone in skin.bones:
        recovered = recover_bind(exclusive_pairs(skin, bone))
        if recovered is not None:
            poses[bone] = recovered
    return poses


def _transpose(rotation: tuple[tuple[float, float, float], ...]) -> tuple[tuple[float, float, float], ...]:
    return (
        (rotation[0][0], rotation[1][0], rotation[2][0]),
        (rotation[0][1], rotation[1][1], rotation[2][1]),
        (rotation[0][2], rotation[1][2], rotation[2][2]),
    )


def _mul(a: tuple[tuple[float, float, float], ...],
         b: tuple[tuple[float, float, float], ...]) -> tuple[tuple[float, float, float], ...]:
    return tuple(
        tuple(sum(a[i][k] * b[k][j] for k in range(3)) for j in range(3))
        for i in range(3)
    )


def _apply_rot(rotation: tuple[tuple[float, float, float], ...],
               point: tuple[float, float, float]) -> tuple[float, float, float]:
    return (
        rotation[0][0] * point[0] + rotation[0][1] * point[1] + rotation[0][2] * point[2],
        rotation[1][0] * point[0] + rotation[1][1] * point[1] + rotation[1][2] * point[2],
        rotation[2][0] * point[0] + rotation[2][1] * point[1] + rotation[2][2] * point[2],
    )


def relative_transform(source, target):
    """Rigid map taking source-space points into target-space for the same bone.

    p_target = R_rel * p_source + T_rel, with R_rel = R_t * R_s^T.
    """
    r_source, t_source = source
    r_target, t_target = target
    r_rel = _mul(r_target, _transpose(r_source))
    mapped = _apply_rot(r_rel, t_source)
    t_rel = (t_target[0] - mapped[0], t_target[1] - mapped[1], t_target[2] - mapped[2])
    return r_rel, t_rel


_IDENTITY = ((1.0, 0.0, 0.0), (0.0, 1.0, 0.0), (0.0, 0.0, 1.0))

# Skin offset space puts bone length along +X (child origin minus parent).
# A supporting-hand mesh is authored with the wrist cocked; past this angle
# the fingers stick out of the sleeve instead of continuing it.
_STRAIGHTEN_COS = 0.5  # 60 degrees


def _axis(rotation, index: int) -> tuple[float, float, float]:
    return (rotation[0][index], rotation[1][index], rotation[2][index])


def _dot(a, b) -> float:
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def _cross(a, b) -> tuple[float, float, float]:
    return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])


def _norm(v) -> tuple[float, float, float]:
    mag = math.sqrt(_dot(v, v)) or 1.0
    return (v[0] / mag, v[1] / mag, v[2] / mag)


def rotation_between(source, target) -> tuple[tuple[float, float, float], ...]:
    """Minimal rotation sending unit vector `source` onto `target`."""
    a, b = _norm(source), _norm(target)
    cosine = _dot(a, b)
    if cosine > 0.999999:
        return _IDENTITY
    if cosine < -0.999999:
        ortho = (1.0, 0.0, 0.0) if abs(a[0]) < 0.9 else (0.0, 1.0, 0.0)
        axis = _norm(_cross(a, ortho))
        return tuple(
            tuple(2.0 * axis[i] * axis[j] - (1.0 if i == j else 0.0) for j in range(3))
            for i in range(3)
        )
    v = _cross(a, b)
    skew = (
        (0.0, -v[2], v[1]),
        (v[2], 0.0, -v[0]),
        (-v[1], v[0], 0.0),
    )
    scale = (1.0 - cosine) / _dot(v, v)
    vx2 = _mul(skew, skew)
    return tuple(
        tuple(_IDENTITY[i][j] + skew[i][j] + scale * vx2[i][j] for j in range(3))
        for i in range(3)
    )


def _compose_about(r_rel, t_rel, extra, pivot):
    """Apply `extra` about `pivot` after (r_rel, t_rel). Wrist stays put."""
    r_out = _mul(extra, r_rel)
    mapped_t = _apply_rot(extra, t_rel)
    mapped_p = _apply_rot(extra, pivot)
    t_out = (
        mapped_t[0] + pivot[0] - mapped_p[0],
        mapped_t[1] + pivot[1] - mapped_p[1],
        mapped_t[2] + pivot[2] - mapped_p[2],
    )
    return r_out, t_out


def _hand_bone(forearm: str, names) -> str | None:
    side = "l " if " l " in f" {forearm.lower()} " else "r "
    for name in names:
        low = name.lower()
        if "hand" in low and side in f" {low} " and "finger" not in low:
            return name
    return None


def straighten_wrist(r_rel, t_rel, source_poses, target_forearm, forearm_name: str):
    """Swing a cocked Hand bone onto the forearm's length axis.

    Shared-forearm alignment preserves the hand file's own wrist. The left
    supporting hand is authored ~140 deg off that axis (weapon grip), so the
    fingers sit perpendicular to the hanging sleeve. The trigger hand is only
    ~40 deg off and is left alone.
    """
    hand_name = _hand_bone(forearm_name, source_poses)
    if hand_name is None:
        return r_rel, t_rel
    r_hand = _mul(r_rel, source_poses[hand_name][0])
    along_hand = _axis(r_hand, 0)
    along_sleeve = _axis(target_forearm[0], 0)
    if _dot(_norm(along_hand), _norm(along_sleeve)) >= _STRAIGHTEN_COS:
        return r_rel, t_rel
    hx, hy, hz = source_poses[hand_name][1]
    wrist = (
        _apply_rot(r_rel, (hx, hy, hz))[0] + t_rel[0],
        _apply_rot(r_rel, (hx, hy, hz))[1] + t_rel[1],
        _apply_rot(r_rel, (hx, hy, hz))[2] + t_rel[2],
    )
    return _compose_about(
        r_rel, t_rel, rotation_between(along_hand, along_sleeve), wrist,
    )


def _preference(name: str) -> tuple[int, str]:
    low = name.lower()
    for index, token in enumerate(_ALIGN_PREFERENCE):
        if token in low:
            return index, low
    return len(_ALIGN_PREFERENCE), low


def alignment(source: Skin, target: Skin):
    """The rigid transform that takes `source` vertices into `target`'s bind.

    Returns (R, T, bone_name) or None when the two skins share no recoverable bone.
    """
    source_poses = bind_poses(source)
    target_poses = bind_poses(target)
    shared = [name for name in source_poses if name in target_poses]
    if not shared:
        return None
    bone = min(shared, key=_preference)
    r_rel, t_rel = relative_transform(source_poses[bone], target_poses[bone])
    if "forearm" in bone.lower():
        r_rel, t_rel = straighten_wrist(
            r_rel, t_rel, source_poses, target_poses[bone], bone,
        )
    return r_rel, t_rel, bone
