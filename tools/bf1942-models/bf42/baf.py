"""Refractor `.baf` bone animation clips — the pose a soldier holds a weapon in.

A `.ske` is where a weapon's parts sit; a `.baf` is where a soldier's bones go.
`animations.rfa` carries 1,154 of them, split Upper/Lower because the weapon
only ever changes the upper body: `StandWalkRun/3P/<Weapon>/3PStandAimUpper<W>.baf`
poses the spine, arms and every finger around that weapon, while the legs come
from the weapon-independent `StandWalkRun/LowerBody/` clips.

    u32 version           3 throughout vanilla
    u16 boneCount
      per bone: u16 nameLen (includes the trailing NUL), name
    u32 frameCount
    u8  precision         fraction bits for the position channels only
    per bone, in name order:
      u16 dataWords       redundant: the seven channels' payload words summed
      7 channels          quat x, y, z, w, then pos x, y, z
        u16 wordCount     words that follow
        segments until frameCount frames are covered:
          u16 control     low byte:  runLength | 0x80 when the run is a hold
                          high byte: words in this segment incl. the control
                                     (redundant, and capped the same way)
          hold:    1 value word, repeated runLength frames
          literal: runLength value words

A run length lives in 7 bits, so any span past 127 frames is just more
segments — a constant channel over 231 frames is two holds (127 + 104), which
is why "constant" cannot be read off the descriptor alone. Values are signed
16-bit fixed point. **The header precision applies to the position channels
only; quaternions are always divided by 2^15.** 1,121 files say 15, where the
two scales coincide and hide the distinction — the tell is the 33 clips that
need bone offsets past +-1 m (dying, ladders, the parachute) and drop to 14,
12 or 11: their position channels stay in range while their quaternions still
land at unit norm only under /2^15 (at /2^precision they come out at exactly
2, 8 and 16). Position channels reproduce the skeleton's bone lengths
exactly, which is what pins the channel order and both scales.

**A `.baf` transform replaces the bone's `.ske` local transform outright** —
rotation as a quaternion, translation absolute in parent space, not an offset
from rest. The stored values live in the same mirrored space as the `.ske`
(see `ske.py`), but the quaternion follows the transposed (row-vector)
convention, and the map into mesh space is the one that survives three
measurements — the standing clip landing on the body skin's bind stance
(2.2 cm mean across the feet), the figure upright and facing +Y, and the
right hand on the character's right:

    quat (x, y, z, w)  ->  matrix of (x, -y, z, w)
    pos  (x, y, z)     ->  (-x, y, -z)

Getting the quaternion map wrong is not subtle: three of the eight sign
choices still produce an upright, forward-facing soldier — mirrored left to
right, which a symmetric body hides until the weapon lands in the wrong hand.

One vanilla file cannot be read: `Weapons/MedPack/MedPackFire.baf` opens with
a stray `0x21` byte before what looks like a version-3 header and one bone
named MEDKIT, and no offset yields a clean parse of the rest of its 142
bytes. Same corruption class as `GrenadeAllies.ske`; it surfaces as
`AnimationError` (version 801, which is that leading byte folded into the
version word).
"""

from __future__ import annotations

import math
import struct
from dataclasses import dataclass

from .ske import Matrix3, Vector3, canonical

Quat = tuple[float, float, float, float]


class AnimationError(ValueError):
    pass


@dataclass(frozen=True)
class BoneTrack:
    name: str
    rotations: tuple[Quat, ...]      # per frame, mesh space, xyzw
    translations: tuple[Vector3, ...]  # per frame, mesh space


@dataclass
class Animation:
    version: int
    frames: int
    precision: int
    bones: list[BoneTrack]
    source: str = ""

    def local_pose(self, frame: int) -> dict[str, tuple[Matrix3, Vector3]]:
        """Canonical bone name -> local (R, t) at `frame`, clamped to the clip."""
        frame = max(0, min(frame, self.frames - 1))
        return {
            canonical(track.name): (
                matrix_from_quat(track.rotations[frame]),
                track.translations[frame],
            )
            for track in self.bones
        }


def matrix_from_quat(q: Quat) -> Matrix3:
    x, y, z, w = q
    norm = math.sqrt(x * x + y * y + z * z + w * w) or 1.0
    x, y, z, w = x / norm, y / norm, z / norm, w / norm
    return (
        (1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)),
        (2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)),
        (2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)),
    )


def _decode_channel(words: tuple[int, ...], frames: int, where: str) -> list[int]:
    """RLE segments -> one signed value per frame."""
    values: list[int] = []
    i = 0
    while len(values) < frames:
        if i >= len(words):
            raise AnimationError(f"channel ran out of segments in {where}")
        control = words[i] & 0xFFFF
        i += 1
        count = control & 0x7F
        if count == 0:
            raise AnimationError(f"zero-length segment in {where}")
        if control & 0x80:  # hold: one value, repeated
            if i >= len(words):
                raise AnimationError(f"hold segment missing its value in {where}")
            value = words[i] - 0x10000 if words[i] & 0x8000 else words[i]
            values.extend([value] * count)
            i += 1
        else:  # literal run
            if i + count > len(words):
                raise AnimationError(f"literal segment overruns channel in {where}")
            values.extend(
                w - 0x10000 if w & 0x8000 else w for w in words[i:i + count])
            i += count
    if i != len(words):
        raise AnimationError(f"trailing words after final segment in {where}")
    if len(values) != frames:
        raise AnimationError(f"segment run lengths exceed frame count in {where}")
    return values


def parse(data: bytes, name: str = "") -> Animation:
    where = name or "animation"
    try:
        version, = struct.unpack_from("<I", data, 0)
        if version != 3:
            raise AnimationError(f"unsupported animation version {version} in {where}")
        count, = struct.unpack_from("<H", data, 4)
        pos = 6
        bone_names: list[str] = []
        for _ in range(count):
            length, = struct.unpack_from("<H", data, pos)
            pos += 2
            raw = data[pos:pos + length]
            if len(raw) < length:
                raise AnimationError(f"truncated bone name in {where}")
            pos += length
            bone_names.append(raw.split(b"\0", 1)[0].decode("latin-1"))
        frames, = struct.unpack_from("<I", data, pos)
        pos += 4
        if not 1 <= frames <= 100000:
            raise AnimationError(f"implausible frame count {frames} in {where}")
        precision = data[pos]
        pos += 1
        # Quaternions are always 1.15 fixed point; only positions use the
        # declared precision. See the module docstring for the measurement.
        quat_scale = 1.0 / 32768.0
        pos_scale = 1.0 / (1 << precision)

        bones: list[BoneTrack] = []
        for bone_name in bone_names:
            declared, = struct.unpack_from("<H", data, pos)
            pos += 2
            channels: list[list[int]] = []
            payload_words = 0
            for channel in range(7):
                word_count, = struct.unpack_from("<H", data, pos)
                pos += 2
                if pos + 2 * word_count > len(data):
                    raise AnimationError(
                        f"channel {channel} of {bone_name!r} overruns file in {where}")
                words = struct.unpack_from(f"<{word_count}H", data, pos)
                pos += 2 * word_count
                payload_words += word_count
                channels.append(_decode_channel(
                    words, frames, f"{where}:{bone_name}[{channel}]"))
            if declared != payload_words:
                raise AnimationError(
                    f"bone {bone_name!r} declares {declared} data words, "
                    f"holds {payload_words} in {where}")
            rotations = tuple(
                # Stored transposed (row-vector convention): the matrix of
                # (x, -y, z, w) is the mesh-space local rotation. See module doc.
                (channels[0][f] * quat_scale, -channels[1][f] * quat_scale,
                 channels[2][f] * quat_scale, channels[3][f] * quat_scale)
                for f in range(frames)
            )
            translations = tuple(
                (-channels[4][f] * pos_scale, channels[5][f] * pos_scale,
                 -channels[6][f] * pos_scale)
                for f in range(frames)
            )
            bones.append(BoneTrack(bone_name, rotations, translations))
        if pos != len(data):
            raise AnimationError(f"{len(data) - pos} trailing bytes in {where}")
    except struct.error as exc:
        raise AnimationError(f"truncated animation records in {where}") from exc
    return Animation(version, frames, precision, bones, source=name)
