#!/usr/bin/env python3
"""What a first-person reload does in the game's own files, read without the exporter.

    python3 viewmodel_source_motion.py --mod fhsw GermanSoldier__VG-1 --family proneReload
    python3 viewmodel_source_motion.py --mod fhsw --check      # every AUTHORED entry

`audit_viewmodel_motion.py` plays the baked `.fp.glb`. When it flags a clip,
the question is whether the exporter put the motion there (a mirrored part, a
weld anchored wrong: the d758adb2 class) or the mod's `.baf` files carry it.
This answers the second half from the archive bytes alone: its own minimal
`.baf` and `.ske` readers (none of `bf42.baf`, `bf42.ske`, `bf42.pose` or
`extract_viewmodel`), every transform kept in the files' raw convention, and
the chain multiplied the way the engine does, child world = parent world .
child local, a `.baf` rotation read as the conjugate of its stored quaternion
(the row-vector storage, `bf42/baf.py`'s docstring).

The weapon is placed the way the validated rig places it, and nothing more:

* the weapon skeleton's root is the soldier's right hand, and the weld is the
  `.ske` rest, root^-1 . main (`pose.weapon_attachment`);
* what a weapon clip says about the main bone is its motion from the clip's
  own frame 0 (`extract_viewmodel.weapon_main_track`: FH's clips hold Base at
  identity, 110-125 degrees off the weld);
* every other bone is chained from the clip's tracks, the `.ske` rest where a
  track is missing, and expressed against the main bone.

Those two rules are pinned by the K98 family: under them FHSW's K98 bolt cycle
keeps the rifle within 0.06 degrees of the left hand while the right hand
rolls 112, which is what the clips were made to do. A rotation angle measured
from a first frame does not change under any fixed change of basis, so no
mirror convention can make or hide one here.

Measured per family over 41 samples (both clips at one phase; a paired weapon
clip has the 1P clip's frame count and rate in every case read so far), in
the audit's own terms: the body's turn and travel in the rig's space, its turn
against each hand, each hand's slip in the body's frame, each named part's
travel against the body and where it ends, and `unheld` (see
`audit_viewmodel_motion.py`). `--check` reads every `AUTHORED` entry of the
audit from the archive and fails when the files do not compose to the value
the entry accepts.
"""

from __future__ import annotations

import argparse
import json
import math
import struct
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

SAMPLES = 40

RT = tuple  # ((3x3 rotation), (translation))


def canon(name: str) -> str:
    return name.replace("_", " ").strip().lower()


# --- the two readers, from the bytes ----------------------------------------

def read_baf(data: bytes) -> tuple[int, dict[str, list]]:
    """frames, canonical bone -> per frame (stored quaternion xyzw, position)."""
    version, = struct.unpack_from("<I", data, 0)
    if version != 3:
        raise ValueError(f"baf version {version}")
    count, = struct.unpack_from("<H", data, 4)
    pos = 6
    names = []
    for _ in range(count):
        length, = struct.unpack_from("<H", data, pos)
        pos += 2
        names.append(data[pos:pos + length].split(b"\0")[0].decode("latin-1"))
        pos += length
    frames, = struct.unpack_from("<I", data, pos)
    precision = data[pos + 4]
    pos += 5
    quat_scale = 1.0 / 32768.0
    pos_scale = 1.0 / ((1 << precision) - 1)
    out: dict[str, list] = {}
    for name in names:
        pos += 2                                  # the redundant word total
        channels = []
        for _channel in range(7):
            words_n, = struct.unpack_from("<H", data, pos)
            pos += 2
            words = struct.unpack_from(f"<{words_n}h", data, pos)
            pos += 2 * words_n
            values: list[int] = []
            i = 0
            while len(values) < frames:
                control = words[i] & 0xFFFF
                run = control & 0x7F
                if control & 0x80:
                    values += [words[i + 1]] * run
                    i += 2
                else:
                    values += list(words[i + 1:i + 1 + run])
                    i += 1 + run
            channels.append(values)
        out[canon(name)] = [
            ((channels[0][f] * quat_scale, channels[1][f] * quat_scale,
              channels[2][f] * quat_scale, channels[3][f] * quat_scale),
             (channels[4][f] * pos_scale, channels[5][f] * pos_scale,
              channels[6][f] * pos_scale))
            for f in range(frames)]
    if pos != len(data):
        raise ValueError(f"{len(data) - pos} trailing bytes")
    return frames, out


def read_ske(data: bytes) -> list[tuple[str, int, RT]]:
    """(canonical name, parent, (rotation, translation)) as stored, unmirrored."""
    _version, count = struct.unpack_from("<II", data, 0)
    pos = 8
    bones = []
    for _ in range(count):
        length, = struct.unpack_from("<H", data, pos)
        pos += 2
        name = data[pos:pos + length].split(b"\0")[0].decode("latin-1")
        pos += length
        parent, = struct.unpack_from("<h", data, pos)
        v = struct.unpack_from("<12f", data, pos + 2)
        pos += 50
        bones.append((canon(name), parent,
                      ((v[0:3], v[4:7], v[8:11]), (v[3], v[7], v[11]))))
    return bones


# --- rigid transforms, column vectors ---------------------------------------

def _conj_matrix(q) -> tuple:
    x, y, z, w = q
    n = math.sqrt(x * x + y * y + z * z + w * w) or 1.0
    x, y, z, w = -x / n, -y / n, -z / n, w / n
    return ((1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)),
            (2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)),
            (2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)))


def _mm(a, b):
    return tuple(tuple(sum(a[i][k] * b[k][j] for k in range(3)) for j in range(3))
                 for i in range(3))


def _mv(a, v):
    return tuple(sum(a[i][k] * v[k] for k in range(3)) for i in range(3))


def _t(a):
    return tuple(tuple(a[j][i] for j in range(3)) for i in range(3))


def mul(a: RT, b: RT) -> RT:
    return _mm(a[0], b[0]), tuple(x + y for x, y in zip(_mv(a[0], b[1]), a[1]))


def inv(a: RT) -> RT:
    rt = _t(a[0])
    return rt, tuple(-x for x in _mv(rt, a[1]))


def turn(a: RT, b: RT) -> float:
    """Degrees between two orientations."""
    m = _mm(_t(a[0]), b[0])
    return math.degrees(math.acos(max(-1.0, min(1.0, (m[0][0] + m[1][1] + m[2][2] - 1) / 2))))


def _sample(track, frames: int, u: float) -> RT:
    x = u * (frames - 1)
    k = min(int(x), frames - 2) if frames > 1 else 0
    a = x - k if frames > 1 else 0.0
    q0, t0 = track[k]
    q1, t1 = track[min(k + 1, frames - 1)]
    if sum(p * q for p, q in zip(q0, q1)) < 0:
        q1 = tuple(-c for c in q1)
    return (_conj_matrix(tuple(p + (q - p) * a for p, q in zip(q0, q1))),
            tuple(p + (q - p) * a for p, q in zip(t0, t1)))


def _worlds(ske, clip, frames: int, u: float) -> list[RT]:
    out: list[RT] = []
    for name, parent, rest in ske:
        local = _sample(clip[name], frames, u) if clip and name in clip else rest
        out.append(local if parent < 0 else mul(out[parent], local))
    return out


def main_bone(ske, *candidates: str | None) -> str:
    """`useSkeletonPartAsMain` as `ske.Skeleton.main_index` resolves it."""
    names = [b[0] for b in ske]
    for candidate in candidates:
        if not candidate:
            continue
        bare = canon(candidate.replace("\\", "/").rsplit("/", 1)[-1])
        for form in (bare, "base" + bare, bare + "base"):
            if form in names:
                return form
    for i, bone in enumerate(ske):
        if bone[1] == 0 and i != 0:
            return bone[0]
    return names[0]


# --- one family ---------------------------------------------------------------

def measure(soldier_ske: bytes, upper: bytes | None, weapon_ske: bytes,
            weapon_clip: bytes | None, main: str, body: str | None = None,
            parts: tuple[str, ...] = ()) -> dict:
    """The audit's numbers for one family, from the files."""
    sske = read_ske(soldier_ske)
    sidx = {b[0]: i for i, b in enumerate(sske)}
    uf, uclip = read_baf(upper) if upper else (1, {})
    wske = read_ske(weapon_ske)
    widx = {b[0]: i for i, b in enumerate(wske)}
    wf, wclip = read_baf(weapon_clip) if weapon_clip else (1, {})
    body = canon(body or main)
    rest = _worlds(wske, None, 1, 0.0)
    first = _worlds(wske, wclip, wf, 0.0)
    mi = widx[canon(main)]
    weld = mul(inv(rest[0]), rest[mi])
    main0 = mul(inv(first[0]), first[mi])
    frames = []
    for k in range(SAMPLES + 1):
        u = k / SAMPLES
        sw = _worlds(sske, uclip, uf, u)
        ww = _worlds(wske, wclip, wf, u)
        anchor = mul(sw[sidx["bip01 r hand"]], mul(weld, inv(main0)))
        frames.append({
            "R": sw[sidx["bip01 r hand"]], "L": sw[sidx["bip01 l hand"]],
            "body": mul(anchor, mul(inv(ww[0]), ww[widx[body]])),
            **{p: mul(anchor, mul(inv(ww[0]), ww[widx[canon(p)]])) for p in parts}})
    b0 = frames[0]["body"]
    out: dict = {
        "bodyPeak": max(turn(b0, f["body"]) for f in frames),
        "bodyMove": max(math.dist(b0[1], f["body"][1]) for f in frames),
        "bodyEnd": (turn(b0, frames[-1]["body"]),
                    math.dist(b0[1], frames[-1]["body"][1])),
        "hands": {}, "parts": {}}
    for side in "LR":
        in_body = [mul(inv(f["body"]), f[side]) for f in frames]
        out["hands"][side] = {
            "turn": max(turn(in_body[0], p) for p in in_body),
            "slip": max(math.dist(in_body[0][1], p[1]) for p in in_body)}
    for p in parts:
        in_body = [mul(inv(f["body"]), f[p]) for f in frames]
        out["parts"][p] = {
            "move": max(math.dist(in_body[0][1], q[1]) for q in in_body),
            "end": math.dist(in_body[0][1], in_body[-1][1])}
    un_rot = un_move = 0.0
    for a, b in zip(frames, frames[1:]):
        steps = [(turn(a["body"], b["body"]), math.dist(a["body"][1], b["body"][1]))]
        for side in "LR":
            p, q = mul(inv(a[side]), a["body"]), mul(inv(b[side]), b["body"])
            steps.append((turn(p, q), math.dist(p[1], q[1])))
        un_rot += min(s[0] for s in steps)
        un_move += min(s[1] for s in steps)
    out["unheld"] = (un_rot, un_move)
    return out


def finding_value(kind: str, m: dict, part: str | None = None) -> float:
    """The number `audit_viewmodel_motion.findings_of` reports for `kind`."""
    hands = m["hands"].values()
    if kind == "body-turns-in-hands":
        return min(min(h["turn"] for h in hands), m["bodyPeak"])
    if kind == "body-leaves-hands":
        return min(min(h["slip"] for h in hands), m["bodyMove"])
    if kind == "part-leaves-body":
        return m["parts"][part]["move"]
    raise ValueError(kind)


# --- the archive --------------------------------------------------------------

class Source:
    """A mod chain's archives and templates, loaded once."""

    def __init__(self, mod: str):
        from extract_models import (DEFAULT_GAME_DIR, build_library, build_pools,
                                    mod_chain)
        chain = mod_chain(DEFAULT_GAME_DIR, mod)
        self.meshes, _textures, objects, _game = build_pools(chain, [])
        self.library = build_library(objects)

    def read(self, path: str) -> bytes:
        entry = self.meshes.find(path)
        if entry is None:
            raise FileNotFoundError(path)
        return self.meshes.read(entry)

    def family(self, soldier: str, weapon: str, upper: str | None,
               weapon_clip: str | None, body: str | None = None,
               parts: tuple[str, ...] = ()) -> dict:
        st, wt = self.library.object(soldier), self.library.object(weapon)
        wske = self.read(wt.skeleton)
        main = main_bone(read_ske(wske), wt.skeleton_main, weapon)
        return measure(self.read(st.skeleton), self.read(upper) if upper else None,
                       wske, self.read(weapon_clip) if weapon_clip else None,
                       main, body, parts)


def rig_clips(viewmodels: Path, stem: str) -> dict:
    """The rig's own record of which files each family plays."""
    report = viewmodels / f"{stem}.fp.report.json"
    return json.loads(report.read_text())


def check(source: Source, viewmodels: Path, verbose: bool = True) -> list[str]:
    """Every AUTHORED entry against the files. Returns the failures."""
    import audit_viewmodel_motion as motion
    failures = []
    reports = {p.name[:-len(".fp.report.json")]: None
               for p in viewmodels.glob("*.fp.report.json")}
    for entry in motion.AUTHORED:
        found = None
        for stem in sorted(reports):
            report = reports[stem] or rig_clips(viewmodels, stem)
            reports[stem] = report
            for family, clip in (report.get("clips") or {}).items():
                if motion.matches(entry, clip):
                    found = (stem, report, family, clip)
                    break
            if found:
                break
        if found is None:
            if verbose:
                print(f"  {entry['name']}: no rig in {viewmodels} plays these files")
            continue
        stem, report, family, clip = found
        m = source.family(report["soldier"], report["weapon"], clip.get("upperClip"),
                          clip.get("weaponClip"), entry.get("body"),
                          (entry["part"],) if entry.get("part") else ())
        for kind, want in entry["values"].items():
            got = finding_value(kind, m, entry.get("part"))
            ok = abs(got - want) <= motion.authored_tolerance(kind)
            if verbose:
                print(f"  {entry['name']:22} {kind:20} files {got:8.3f}  entry {want:8.3f}"
                      f"  {'ok' if ok else 'DIFFERS'}  ({stem} {family})")
            if not ok:
                failures.append(f"{entry['name']} {kind}: files {got:.3f}, entry {want:.3f}")
    return failures


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--mod", required=True)
    ap.add_argument("rigs", nargs="*", help="rig stems (Soldier__Weapon)")
    ap.add_argument("--family", action="append", default=None)
    ap.add_argument("--body", help="the body bone (default: the main bone)")
    ap.add_argument("--part", action="append", default=[])
    ap.add_argument("--check", action="store_true")
    args = ap.parse_args(argv)
    import audit_viewmodel_motion as motion
    models, _maps = motion.tree_dirs(args.mod)
    viewmodels = models / "viewmodels"
    source = Source(args.mod)
    if args.check:
        failures = check(source, viewmodels)
        for line in failures:
            print("FAIL", line)
        return 1 if failures else 0
    for stem in args.rigs:
        report = rig_clips(viewmodels, stem)
        for family in args.family or sorted(report.get("clips") or {}):
            clip = report["clips"].get(family) or {}
            if "error" in clip or not (clip.get("upperClip") or clip.get("weaponClip")):
                continue
            m = source.family(report["soldier"], report["weapon"], clip.get("upperClip"),
                              clip.get("weaponClip"), args.body, tuple(args.part))
            print(f"{stem} {family}: {clip.get('upperClip')} + {clip.get('weaponClip')}")
            print("   ", json.dumps(m, default=lambda x: x))
    return 0


if __name__ == "__main__":
    sys.exit(main())
