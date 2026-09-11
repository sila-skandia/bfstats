"""Refractor `.ske` skeletons — the bind pose a weapon is assembled in.

A vehicle says where its turret sits with `setPosition` after `addTemplate`. A
hand weapon does not: its sub-parts carry `bindToSkeletonPart <bone>` and no
placement at all, because the bone *is* the placement. `animations/K98.ske`
holds the rest transform of every named part, so the trigger, the bolt and the
stripper clip are positioned by the same file that later animates the reload.

    u32  version          1 throughout vanilla
    u32  boneCount
      per bone:
        u16 nameLen       includes the trailing NUL
        u8  name[nameLen]
        i16 parent        -1 for the root
        f32 matrix[12]    row-major 3x4, rotation then translation per row

The matrix is local to the parent, so a bone's rest pose is the product down
its chain. Roots are `Bip01 R Hand` on every weapon — the skeleton is authored
where it attaches to the soldier, not where the weapon's own origin is, which
is why `useSkeletonPartAsMain` exists and why every placement here is measured
relative to that main bone rather than to the root.

**A `.ske` is stored mirrored in Z against the `.sm` it poses.** The soldier is
the clearest case: `UsSoldier.ske` puts `Bip01 Head` at z = -1.51 while the head
mesh it drives sits at z = +1.56..1.87. Weapons are the same, and there the cost
of missing it is obvious — every bound part lands on the wrong end of the gun.
A K98's bolt ends up behind the butt plate and a Colt's magazine hangs off the
back of the grip, each displaced by twice its distance from the origin. Measured
against the weapons' own shadow meshes, reading the file as-is throws 15-60% of
each part's area outside the silhouette of the weapon it belongs to; mirroring
brings that to under 3%.

A mirror is a change of basis, so it conjugates: R -> S R S and t -> S t with
S = diag(1, 1, -1), applied at parse time. Mirroring the translation alone would
land the parts in almost the same place — most of these bones are rotated about
X, where conjugation barely shows — but it is not a rigid transform of anything,
and the pistols' front view is where it comes apart.

This is separate from, and composes with, the Refractor-to-glTF mirror that
`gltf.py` applies on the way out.
"""

from __future__ import annotations

import struct
from dataclasses import dataclass

Matrix3 = tuple[tuple[float, float, float], ...]
Vector3 = tuple[float, float, float]

_IDENTITY: Matrix3 = ((1.0, 0.0, 0.0), (0.0, 1.0, 0.0), (0.0, 0.0, 1.0))
_ORIGIN: Vector3 = (0.0, 0.0, 0.0)


class SkeletonError(ValueError):
    pass


@dataclass(frozen=True)
class Bone:
    name: str
    parent: int
    rotation: Matrix3
    translation: Vector3


def canonical(name: str) -> str:
    """`.con` writes bone names with underscores, the `.ske` with spaces.

    `bindToSkeletonPart Bip01_Spine3` and the stored `Bip01 Spine3` are the same
    bone. Case is irrelevant throughout Refractor, as everywhere else.
    """
    return name.replace("_", " ").strip().lower()


def _mul(a: tuple[Matrix3, Vector3], b: tuple[Matrix3, Vector3]) -> tuple[Matrix3, Vector3]:
    (ra, ta), (rb, tb) = a, b
    rotation = tuple(
        tuple(sum(ra[i][k] * rb[k][j] for k in range(3)) for j in range(3))
        for i in range(3)
    )
    translation = tuple(
        sum(ra[i][k] * tb[k] for k in range(3)) + ta[i] for i in range(3)
    )
    return rotation, translation


def _inverse(pose: tuple[Matrix3, Vector3]) -> tuple[Matrix3, Vector3]:
    """A rigid transform's inverse: R^T, -R^T t."""
    rotation, translation = pose
    transposed = tuple(
        tuple(rotation[j][i] for j in range(3)) for i in range(3)
    )
    negated = tuple(
        -sum(transposed[i][k] * translation[k] for k in range(3)) for i in range(3)
    )
    return transposed, negated


@dataclass
class Skeleton:
    bones: list[Bone]
    source: str = ""

    def index(self, name: str | None) -> int | None:
        if not name:
            return None
        wanted = canonical(name)
        for i, bone in enumerate(self.bones):
            if canonical(bone.name) == wanted:
                return i
        return None

    def rest(self, index: int) -> tuple[Matrix3, Vector3]:
        """The bone's pose in skeleton space, accumulated down its parent chain."""
        pose = (_IDENTITY, _ORIGIN)
        seen: set[int] = set()
        while 0 <= index < len(self.bones) and index not in seen:
            seen.add(index)
            bone = self.bones[index]
            pose = _mul((bone.rotation, bone.translation), pose)
            index = bone.parent
        return pose

    def main_index(self, *candidates: str | None) -> int | None:
        """The bone the object's own origin sits on.

        `useSkeletonPartAsMain` names it, except when it does not: the K98 and
        the No4 both ask for a part named after the weapon while their skeletons
        call it `BaseK98` / `BaseNo4`, and the RepairPack asks for `base` against
        a bone left at the exporter's default `Object01`. The engine still draws
        all three correctly, so the name is a hint rather than a key. Every
        vanilla weapon skeleton hangs its body off the `Bip01 R Hand` root, which
        is what the fallback uses.
        """
        for candidate in candidates:
            if not candidate:
                continue
            bare = candidate.replace("\\", "/").rsplit("/", 1)[-1]
            for form in (bare, f"base{bare}", f"{bare}base"):
                found = self.index(form)
                if found is not None:
                    return found
        for i, bone in enumerate(self.bones):
            if bone.parent == 0 and i != 0:
                return i
        return 0 if self.bones else None

    def relative(self, bone_index: int, main_index: int | None,
                 ) -> tuple[Matrix3, Vector3]:
        """Where `bone_index` sits in the space of the object's main bone."""
        if main_index is None or main_index == bone_index:
            return _IDENTITY, _ORIGIN
        return _mul(_inverse(self.rest(main_index)), self.rest(bone_index))


def _mirror_z(rotation: Matrix3, translation: Vector3) -> dict:
    """Conjugate a stored bone transform into the mesh's handedness.

    S T S with S = diag(1, 1, -1): the rotation's Z row and Z column flip sign
    (the corner where they cross flips twice and so does not), and the
    translation's Z flips. See the module docstring for why this is needed.
    """
    (r00, r01, r02), (r10, r11, r12), (r20, r21, r22) = rotation
    return {
        "rotation": ((r00, r01, -r02), (r10, r11, -r12), (-r20, -r21, r22)),
        "translation": (translation[0], translation[1], -translation[2]),
    }


def parse(data: bytes, name: str = "") -> Skeleton:
    if len(data) < 8:
        raise SkeletonError(f"truncated skeleton header in {name or 'skeleton'}")
    version, count = struct.unpack_from("<II", data, 0)
    if version != 1:
        raise SkeletonError(f"unsupported skeleton version {version} in {name or 'skeleton'}")
    pos = 8
    bones: list[Bone] = []
    try:
        for _ in range(count):
            length, = struct.unpack_from("<H", data, pos)
            pos += 2
            raw = data[pos:pos + length]
            if len(raw) < length:
                raise SkeletonError(f"truncated bone name in {name or 'skeleton'}")
            pos += length
            parent, = struct.unpack_from("<h", data, pos)
            pos += 2
            values = struct.unpack_from("<12f", data, pos)
            pos += 48
            bones.append(Bone(
                name=raw.split(b"\0", 1)[0].decode("latin-1"),
                parent=parent,
                **_mirror_z(
                    rotation=(values[0:3], values[4:7], values[8:11]),
                    translation=(values[3], values[7], values[11]),
                ),
            ))
    except struct.error as exc:
        raise SkeletonError(f"truncated skeleton records in {name or 'skeleton'}") from exc
    return Skeleton(bones, source=name)
