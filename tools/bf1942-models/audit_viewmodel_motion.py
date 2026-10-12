#!/usr/bin/env python3
"""Offline audit of first-person rig motion: what a player would see as broken.

    python3 audit_viewmodel_motion.py --mod fhsw            # table of findings
    python3 audit_viewmodel_motion.py --mod fhsw --verbose  # every finding
    python3 audit_viewmodel_motion.py --mod fhsw --levels battle_of_foy berlin-1945
    python3 audit_viewmodel_motion.py --mod bf1942 --metrics m.json   # raw numbers
    python3 audit_mod.py --mod fhsw --audit animation       # the same, in the audit

Every `*.fp.glb` of a tree's `viewmodels/` is loaded and every baked clip is
played in Python: the channels are sampled, the node chain is multiplied out,
and the weapon's body, its bound parts and the two hands are measured in the
rig's own space. No browser, no game archives; a 700-rig tree takes about a
minute on twenty processes.

The weapon's *body* is the mesh under the grip wrapper with the longest
bounding box (a rifle's receiver and stock, whichever node carries it: FHSW's
bolt rifles hang it on a `GUNBODY` bone the clips key, vanilla's hang it on the
main bone). What is measured, and the finding each makes:

    body-turns-in-hands   the body turns against *both* hands and in the
                          rig's space, each by more than TURN_IN_HANDS. A
                          weapon is still against something: a hand that
                          carries it (in vanilla it is welded to one and the
                          number is 0.2 degrees), or the view while it rests
                          and both hands work on it. This is the rifle going
                          round like a clock hand while the arms work the bolt.
    body-leaves-hands     the same for distance: the body moves away from both
                          hands and from where it began, in a clip that is not
                          a throw (a clip that moves the grip wrapper itself
                          is one, and is let be).
    body-jumps-at-start   a family begins with the body somewhere else in the
                          hand than the idle holds it: it snaps as the clip
                          starts (a clip authored against another rest).
    body-spins            the body's orientation in the rig's space leaves its
                          first frame by more than the family's limit. A
                          reload tips a rifle; none turns it over.
    bolt-moves-the-rifle  the same in a `bolt` family, whose limit is a rifle
                          reload's: the cycle is meant to move a bolt part.
    body-revolves         the body's summed frame-to-frame rotation is a turn
                          and a half above what its peak accounts for: it goes
                          round rather than there and back.
    body-leaves           the body's origin travels further from where the
                          idle holds it than the family's limit (a weapon
                          carried out of the view by a clip that is not a draw).
    hand-leaves-weapon    a hand moves against the body in a family where the
                          weapon is only held (idle, walk, run, crouch, prone).
    no-return             a reload, bolt cycle or fidget ends away from where
                          it began.
    part-leaves-body      a bound part of real size (BIG_PART of the body's
                          length) moves against the body in a held family, is
                          left away from it at the end of a play-once one, or
                          travels further than any vanilla part does.
    clip-moves-nothing    a reload, bolt or fire family in which no node moves.
    clip-zero-length      a clip with no duration or fewer than two keys.
    clip-not-finite       a NaN or infinity in a clip's keys.
    clip-targets-missing  a channel that drives a node the scene does not hold.

The limits are calibrated on vanilla's rigs, which have been played for weeks:
each sits above the worst vanilla value of its family (written beside it
below), so vanilla is quiet and a rig that leaves the envelope of the retail
game's own clips is reported. `features/viewmodel-motion-audit/README.md` has
the counts per tree.
"""

from __future__ import annotations

import argparse
import bisect
import json
import math
import struct
import sys
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

SAMPLES = 40                 # per clip, evenly spaced, both ends included

# --- limits (degrees, metres) ------------------------------------------------
# Each sits above the worst value any vanilla rig reaches, given beside it.
THROW = 0.02                 # the clip moves the grip wrapper: an authored throw
TURN_IN_HANDS = 60.0         # vanilla 0.24 (the weapon is welded to a hand)
LEAVES_HANDS = 0.20          # vanilla 0.00 outside a throw
START_LIMIT = (10.0, 0.03)   # vanilla 0.12 deg, 0.00 m
# family class -> peak body rotation from the clip's first frame
SPIN_LIMIT = {"hold": 35.0,      # vanilla 16.8 (GrenadeAllies crawl)
              "fire": 165.0,     # 142.7 (the knife's fourth swing)
              "bolt": 70.0,      # no vanilla family; its rifle reloads reach 61.4
              "reload": 150.0,   # 126.3 (the Bazooka is tipped up to load)
              "fidget": 165.0}   # 149.2 (the knife is turned over)
REVOLVE_EXCESS = 540.0       # summed rotation beyond 2 x peak; vanilla 439
# family class -> peak travel of the body's origin from the idle's first frame
LEAVE_LIMIT = {"hold": 0.60,     # vanilla 0.48 (Detonator)
               "fire": 1.20,     # 0.92 (a grenade leaving the hand)
               "bolt": 0.60,
               "reload": 1.10,   # 0.86 (Bazooka)
               "fidget": 0.60}   # 0.48
HAND_SLIP = 0.25             # a hand against the body, hold families; vanilla 0.16
RETURN_LIMIT = (15.0, 0.20)  # play-once end against start; vanilla 5.5 deg, 0.14 m
BIG_PART = 0.35              # a bound part this share of the body's length
PART_MOVE = 0.60             # such a part against the body; vanilla 0.38 (K98 Load)
PART_HELD = 0.02             # the same in a hold family; vanilla 0.00
PART_END = 0.10              # where it ends, reload/bolt/fidget; vanilla 0.04
MOVES_NOTHING = (0.05, 1e-4)  # deg, m: under both, a channel is still

# The families a rig carries, by what a hand is meant to do in them.
HOLD = {"idle", "walk", "run", "crouch", "crouchWalk", "prone", "crawl"}
FIRE = {"fire", "proneFire", "altfire"}
BOLT = {"bolt", "proneBolt"}
RELOAD = {"reload", "proneReload"}
DEPLOY = {"deploy", "crouchDeploy", "proneDeploy"}


def family_class(key: str) -> str:
    base = key.rstrip("0123456789")
    if key in HOLD:
        return "hold"
    if base in FIRE:
        return "fire"
    if key in BOLT:
        return "bolt"
    if key in RELOAD:
        return "reload"
    if key in DEPLOY:
        return "deploy"
    if base == "idle":
        return "fidget"
    return "other"


# ---------------------------------------------------------------------------
# quaternions (x, y, z, w), plain tuples
# ---------------------------------------------------------------------------

def qmul(a, b):
    ax, ay, az, aw = a
    bx, by, bz, bw = b
    return (aw * bx + ax * bw + ay * bz - az * by,
            aw * by - ax * bz + ay * bw + az * bx,
            aw * bz + ax * by - ay * bx + az * bw,
            aw * bw - ax * bx - ay * by - az * bz)


def qconj(q):
    return (-q[0], -q[1], -q[2], q[3])


def qrot(q, v):
    x, y, z, w = q
    vx, vy, vz = v
    tx = 2 * (y * vz - z * vy)
    ty = 2 * (z * vx - x * vz)
    tz = 2 * (x * vy - y * vx)
    return (vx + w * tx + y * tz - z * ty,
            vy + w * ty + z * tx - x * tz,
            vz + w * tz + x * ty - y * tx)


def qangle(a, b) -> float:
    d = abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3])
    return math.degrees(2 * math.acos(min(1.0, d)))


def _nlerp(a, b, u):
    if a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3] < 0:
        b = (-b[0], -b[1], -b[2], -b[3])
    q = [x + (y - x) * u for x, y in zip(a, b)]
    n = math.sqrt(sum(x * x for x in q)) or 1.0
    return tuple(x / n for x in q)


def rel(a, b):
    """Pose b in the frame of pose a: (rotation, translation)."""
    inv = qconj(a[0])
    return (qmul(inv, b[0]),
            qrot(inv, tuple(y - x for x, y in zip(a[1], b[1]))))


# ---------------------------------------------------------------------------
# a rig, read and played
# ---------------------------------------------------------------------------

class Rig:
    """One `.fp.glb`: its nodes, its clips, and a sampler over them."""

    def __init__(self, path: Path):
        blob = path.read_bytes()
        if blob[:4] != b"glTF":
            raise ValueError("not a glb")
        n = struct.unpack_from("<I", blob, 12)[0]
        self.doc = json.loads(blob[20:20 + n])
        self.bin = blob[20 + n + 8:]
        self.nodes = self.doc.get("nodes", [])
        self.parent: dict[int, int] = {}
        for index, node in enumerate(self.nodes):
            for child in node.get("children", ()):
                self.parent[child] = index
        self.extras = self.doc.get("extras") or {}
        self.clips: dict[str, dict] = {}
        self.problems: list[tuple[str, str, str]] = []   # kind, clip, detail
        for anim in self.doc.get("animations", ()):
            channels: dict[tuple[int, str], tuple[list, list]] = {}
            name = anim.get("name", "")
            for channel in anim["channels"]:
                target = channel["target"]
                node, path_ = target.get("node"), target["path"]
                if node is None or not 0 <= node < len(self.nodes):
                    self.problems.append(("clip-targets-missing", name,
                                          f"node {node}"))
                    continue
                sampler = anim["samplers"][channel["sampler"]]
                times = self._floats(sampler["input"])
                values = self._floats(sampler["output"])
                if not all(map(math.isfinite, times)) or not all(
                        math.isfinite(x) for v in values for x in v):
                    self.problems.append((
                        "clip-not-finite", name,
                        f"{self.nodes[node].get('name')}.{path_}"))
                    continue
                channels[(node, path_)] = (times, values)
            self.clips[name] = channels

    def _floats(self, index: int):
        acc = self.doc["accessors"][index]
        view = self.doc["bufferViews"][acc["bufferView"]]
        width = {"SCALAR": 1, "VEC3": 3, "VEC4": 4}[acc["type"]]
        offset = view.get("byteOffset", 0) + acc.get("byteOffset", 0)
        flat = struct.unpack_from(f"<{width * acc['count']}f", self.bin, offset)
        if width == 1:
            return list(flat)
        return [flat[k * width:(k + 1) * width] for k in range(acc["count"])]

    def duration(self, clip: str) -> float:
        return max((times[-1] for times, _v in self.clips[clip].values()
                    if times), default=0.0)

    def find(self, name: str) -> int | None:
        for index, node in enumerate(self.nodes):
            if node.get("name") == name:
                return index
        return None

    def _local(self, index: int, clip: str | None, t: float):
        node = self.nodes[index]
        rotation = tuple(node.get("rotation", (0.0, 0.0, 0.0, 1.0)))
        translation = tuple(node.get("translation", (0.0, 0.0, 0.0)))
        channels = self.clips.get(clip) if clip else None
        if channels:
            for path_ in ("rotation", "translation"):
                track = channels.get((index, path_))
                if not track:
                    continue
                times, values = track
                if t <= times[0]:
                    value = values[0]
                elif t >= times[-1]:
                    value = values[-1]
                else:
                    k = bisect.bisect_right(times, t) - 1
                    u = (t - times[k]) / ((times[k + 1] - times[k]) or 1.0)
                    value = (_nlerp(values[k], values[k + 1], u)
                             if path_ == "rotation" else
                             tuple(a + (b - a) * u
                                   for a, b in zip(values[k], values[k + 1])))
                if path_ == "rotation":
                    rotation = tuple(value)
                else:
                    translation = tuple(value)
        return rotation, translation

    def poses(self, wanted: list[int], clip: str | None, t: float) -> dict:
        """World (rotation, translation) of each wanted node at time t."""
        done: dict[int, tuple] = {}

        def world(index: int):
            if index in done:
                return done[index]
            local = self._local(index, clip, t)
            up = self.parent.get(index)
            if up is None:
                done[index] = local
            else:
                pq, pt = world(up)
                done[index] = (qmul(pq, local[0]),
                               tuple(a + b for a, b in
                                     zip(pt, qrot(pq, local[1]))))
            return done[index]

        return {index: world(index) for index in wanted}

    def under(self, root: int) -> list[int]:
        out, stack = [], [root]
        while stack:
            index = stack.pop()
            out.append(index)
            stack.extend(self.nodes[index].get("children", ()))
        return out

    def box(self, index: int):
        """(min, max) of the node's own mesh in its local space, or None."""
        mesh = self.nodes[index].get("mesh")
        if mesh is None:
            return None
        lo, hi = [math.inf] * 3, [-math.inf] * 3
        for prim in self.doc["meshes"][mesh]["primitives"]:
            acc = self.doc["accessors"][prim["attributes"]["POSITION"]]
            if "min" not in acc:
                continue
            lo = [min(a, b) for a, b in zip(lo, acc["min"])]
            hi = [max(a, b) for a, b in zip(hi, acc["max"])]
        return (lo, hi) if lo[0] != math.inf else None


def _box_distance(box, point) -> float:
    lo, hi = box
    return math.sqrt(sum(max(l - p, 0.0, p - h) ** 2
                         for l, h, p in zip(lo, hi, point)))


def measure(path: Path) -> dict:
    """Every number the findings are made of, for one rig."""
    rig = Rig(path)
    out: dict = {"rig": path.name[:-len(".fp.glb")],
                 "weapon": rig.extras.get("weapon"),
                 "soldier": rig.extras.get("soldier"),
                 "graft": bool(rig.extras.get("graft")),
                 "problems": rig.problems, "clips": {}}
    grip = next((i for i, n in enumerate(rig.nodes)
                 if (n.get("extras") or {}).get("weldBone")), None)
    hands = {side: rig.find(f"Bip01 {side} Hand") for side in "LR"}
    if grip is None or out["graft"]:
        return out
    weapon_nodes = rig.under(grip)
    # The body: the longest mesh under the grip. Its lower LODs hang under it
    # tagged `lod`, and are the same thing drawn from further off.
    meshes = []
    for index in weapon_nodes:
        extras = rig.nodes[index].get("extras") or {}
        box = rig.box(index)
        if box is None or extras.get("lod") or extras.get("effect"):
            continue
        size = math.dist(*box)
        meshes.append((size, index, box))
    if not meshes:
        return out
    meshes.sort(reverse=True)
    _size, body, body_box = meshes[0]
    out["body"] = rig.nodes[body].get("name")
    out["bodyBound"] = (rig.nodes[body].get("extras") or {}).get("boundBone")
    out["bodySize"] = round(_size, 3)
    parts = {index: (rig.nodes[index].get("extras") or {}).get("boundBone")
             for size, index, _b in meshes[1:]
             if (rig.nodes[index].get("extras") or {}).get("boundBone")
             and size >= BIG_PART * _size}
    wanted = [body, *parts, *(h for h in hands.values() if h is not None)]

    idle0 = rig.poses(wanted, "idle", 0.0) if "idle" in rig.clips else None
    holding = {}
    if idle0:
        for side, hand in hands.items():
            if hand is None:
                continue
            local = rel(idle0[body], idle0[hand])[1]
            holding[side] = _box_distance(body_box, local)
    out["holdDistance"] = {k: round(v, 4) for k, v in holding.items()}
    in_hand_idle = ({side: rel(idle0[hand], idle0[body])
                     for side, hand in hands.items() if hand is not None}
                    if idle0 else {})

    for clip, channels in rig.clips.items():
        row: dict = {"class": family_class(clip)}
        out["clips"][clip] = row
        duration = rig.duration(clip)
        keys = max((len(times) for times, _v in channels.values()), default=0)
        row["duration"], row["keys"] = round(duration, 4), keys
        if duration <= 0.0 or keys < 2:
            continue
        frames = [rig.poses(wanted, clip, duration * k / SAMPLES)
                  for k in range(SAMPLES + 1)]
        first, last = frames[0], frames[-1]
        body_rot = [qangle(first[body][0], f[body][0]) for f in frames]
        row["bodyPeak"] = round(max(body_rot), 2)
        row["bodyPath"] = round(sum(
            qangle(a[body][0], b[body][0])
            for a, b in zip(frames, frames[1:])), 2)
        row["bodyMove"] = round(max(
            math.dist(first[body][1], f[body][1]) for f in frames), 4)
        row["bodyEnd"] = (round(body_rot[-1], 2),
                          round(math.dist(first[body][1], last[body][1]), 4))
        if idle0:
            row["bodyTravel"] = round(max(
                math.dist(idle0[body][1], f[body][1]) for f in frames), 4)
            row["bodyStart"] = (
                round(qangle(idle0[body][0], first[body][0]), 2),
                round(math.dist(idle0[body][1], first[body][1]), 4))
        hand_rows = {}
        for side, hand in hands.items():
            if hand is None:
                continue
            in_body = [rel(f[body], f[hand]) for f in frames]
            slip = max(math.dist(in_body[0][1], p[1]) for p in in_body)
            turn = max(qangle(in_body[0][0], p[0]) for p in in_body)
            still = (max(qangle(first[hand][0], f[hand][0]) for f in frames),
                     max(math.dist(first[hand][1], f[hand][1]) for f in frames))
            at_start = rel(first[hand], first[body])
            idle_grip = in_hand_idle.get(side)
            hand_rows[side] = {
                **({"start": (round(qangle(idle_grip[0], at_start[0]), 2),
                              round(math.dist(idle_grip[1], at_start[1]), 4))}
                   if idle_grip else {}),
                "slip": round(slip, 4), "turn": round(turn, 2),
                "still": (round(still[0], 2), round(still[1], 4)),
                "end": (round(qangle(first[hand][0], last[hand][0]), 2),
                        round(math.dist(first[hand][1], last[hand][1]), 4))}
        row["hands"] = hand_rows
        part_rows = {}
        for index, bone in parts.items():
            in_body = [rel(f[body], f[index]) for f in frames]
            entry = {
                "move": (round(max(qangle(in_body[0][0], p[0])
                                   for p in in_body), 2),
                         round(max(math.dist(in_body[0][1], p[1])
                                   for p in in_body), 4)),
                "end": (round(qangle(in_body[0][0], in_body[-1][0]), 2),
                        round(math.dist(in_body[0][1], in_body[-1][1]), 4))}
            if idle0:
                at_idle = rel(idle0[body], idle0[index])
                entry["start"] = (round(qangle(at_idle[0], in_body[0][0]), 2),
                                  round(math.dist(at_idle[1], in_body[0][1]), 4))
            part_rows[bone] = entry
        row["parts"] = part_rows
        # Does anything at all move? Every channel's own spread.
        moving = 0
        for (_node, path_), (_times, values) in channels.items():
            if path_ == "rotation":
                if max(qangle(values[0], v) for v in values) > MOVES_NOTHING[0]:
                    moving += 1
            elif max(math.dist(values[0], v) for v in values) > MOVES_NOTHING[1]:
                moving += 1
        row["moving"] = moving
        # Does the clip itself move the weapon in the hand (a throw)?
        grip_move = 0.0
        for path_ in ("rotation", "translation"):
            track = channels.get((grip, path_))
            if track:
                values = track[1]
                grip_move = max(grip_move, max(
                    (qangle(values[0], v) / 100.0 if path_ == "rotation"
                     else math.dist(values[0], v)) for v in values))
        row["gripMoves"] = round(grip_move, 4)
    return out


def findings_of(m: dict) -> list[dict]:
    """The findings one rig's measurements make."""
    out: list[dict] = []
    body = m.get("body")

    def add(kind: str, clip: str, detail: str, value: float = 0.0) -> None:
        out.append({"rig": m["rig"], "weapon": m.get("weapon"),
                    "soldier": m.get("soldier"), "kind": kind, "clip": clip,
                    "detail": detail, "value": round(value, 3)})

    for kind, clip, detail in m["problems"]:
        add(kind, clip, detail)
    for clip, row in m["clips"].items():
        cls = row["class"]
        if row["duration"] <= 0.0 or row["keys"] < 2:
            add("clip-zero-length", clip,
                f"{row['keys']} keys over {row['duration']} s")
            continue
        if "bodyPeak" not in row:
            continue
        if cls in ("reload", "bolt", "fire") and not row["moving"]:
            add("clip-moves-nothing", clip, "no channel leaves its first key")
        thrown = row["gripMoves"] > THROW
        hands = row.get("hands") or {}
        if hands and not thrown:
            # A weapon is still against something: a hand that carries it, or
            # the rig's space while it rests and both hands work on it (an
            # anti-tank rifle on its bipod, a rifle grenade being fitted).
            side, hand = min(hands.items(), key=lambda kv: kv[1]["turn"])
            if min(hand["turn"], row["bodyPeak"]) > TURN_IN_HANDS:
                add("body-turns-in-hands", clip,
                    f"{body} turns {hand['turn']:.0f} deg against the {side} "
                    f"hand, more against the other, and {row['bodyPeak']:.0f} "
                    "in the rig's space", min(hand["turn"], row["bodyPeak"]))
            side, hand = min(hands.items(), key=lambda kv: kv[1]["slip"])
            if min(hand["slip"], row["bodyMove"]) > LEAVES_HANDS:
                add("body-leaves-hands", clip,
                    f"{body} moves {hand['slip']:.2f} m against the {side} "
                    f"hand, further from the other, and {row['bodyMove']:.2f} "
                    "in the rig's space", min(hand["slip"], row["bodyMove"]))
        starts = [h["start"] for h in hands.values() if "start" in h]
        if starts and cls != "deploy":
            rot = min(s[0] for s in starts)
            pos = min(s[1] for s in starts)
            if rot > START_LIMIT[0] or pos > START_LIMIT[1]:
                add("body-jumps-at-start", clip,
                    f"{body} begins {rot:.0f} deg and {pos:.2f} m from where "
                    "the idle holds it in the hand", max(rot, pos * 100))
        peak, path_ = row["bodyPeak"], row["bodyPath"]
        limit = SPIN_LIMIT.get(cls)
        if limit is not None and peak > limit:
            if cls == "bolt":
                add("bolt-moves-the-rifle", clip,
                    f"{body} turns {peak:.0f} deg in the bolt cycle "
                    f"(limit {limit:.0f})", peak)
            else:
                add("body-spins", clip,
                    f"{body} turns {peak:.0f} deg from its first frame "
                    f"(limit {limit:.0f} for a {cls} family)", peak)
        if cls != "deploy" and path_ - 2 * peak > REVOLVE_EXCESS:
            add("body-revolves", clip,
                f"{body} turns through {path_:.0f} deg in all, "
                f"{peak:.0f} at the peak", path_)
        travel = row.get("bodyTravel")
        leave = LEAVE_LIMIT.get(cls)
        if travel is not None and leave is not None and travel > leave:
            add("body-leaves", clip,
                f"{body} travels {travel:.2f} m from where the idle "
                f"holds it (limit {leave:.2f})", travel)
        if cls == "hold":
            for side, hand in hands.items():
                if hand["slip"] > HAND_SLIP:
                    add("hand-leaves-weapon", clip,
                        f"the {side} hand moves {hand['slip']:.2f} m against "
                        f"{body} (limit {HAND_SLIP:.2f})", hand["slip"])
        if cls in ("reload", "bolt", "fidget"):
            end = row["bodyEnd"]
            if end[0] > RETURN_LIMIT[0] or end[1] > RETURN_LIMIT[1]:
                add("no-return", clip,
                    f"{body} ends {end[0]:.0f} deg and {end[1]:.2f} m "
                    "from where it began", max(end[0], end[1] * 100))
        for bone, part in (row.get("parts") or {}).items():
            move, end = part["move"][1], part["end"][1]
            if (move > PART_MOVE or (cls == "hold" and move > PART_HELD)
                    or (cls in ("reload", "bolt", "fidget")
                        and end > PART_END)):
                add("part-leaves-body", clip,
                    f"{bone} moves {move:.2f} m against {body} and ends "
                    f"{end:.2f} m off", move)
    return out


# ---------------------------------------------------------------------------
# trees
# ---------------------------------------------------------------------------

def tree_dirs(mod: str) -> tuple[Path, Path]:
    """(models, maps) of a tree id, as audit_mod.Tree.locate lays them out."""
    viewer = HERE / "viewer"
    mod = mod.lower()
    if mod == "bf1942":
        return viewer / "models", viewer / "maps"
    return viewer / "models" / "mods" / mod, viewer / "maps" / "mods" / mod


def measure_tree(viewmodels: Path, jobs: int = 0) -> list[dict]:
    paths = sorted(viewmodels.glob("*.fp.glb"))
    if not paths:
        return []
    with ProcessPoolExecutor(max_workers=jobs or None) as pool:
        return list(pool.map(_measure_safe, paths, chunksize=4))


def _measure_safe(path: Path) -> dict:
    try:
        return measure(path)
    except Exception as exc:                              # noqa: BLE001
        return {"rig": path.name[:-len(".fp.glb")], "weapon": None,
                "soldier": None, "clips": {},
                "problems": [("rig-unreadable", "", str(exc)[:120])]}


def level_weapons(models: Path, maps: Path, levels: list[str],
                  ) -> dict[tuple[str, str], set[str]]:
    """(soldier, weapon) -> the levels of `levels` whose kits hand it out."""
    import extract_viewmodel
    kits = json.loads((models / "kits.json").read_text())
    out: dict[tuple[str, str], set[str]] = {}
    for level in levels:
        for pair in extract_viewmodel.kit_pairs(kits, {level.lower()}):
            out.setdefault(pair, set()).add(level)
    return out


def run(tree, game, ctx: dict, Finding) -> list:
    """`audit_mod.py --audit animation`: the findings as audit rows."""
    measured = measure_tree(tree.models / "viewmodels")
    ctx["viewmodel rigs played"] = len(measured)
    rows = []
    for m in measured:
        for f in findings_of(m):
            rows.append(Finding("animation", f"viewmodel-{f['kind']}",
                                f["rig"], f"{f['clip']}: {f['detail']}"))
    return rows


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--mod", default="bf1942")
    ap.add_argument("--dir", type=Path, help="a viewmodels folder, instead of --mod")
    ap.add_argument("--levels", nargs="*", default=None,
                    help="only weapons a kit of these levels hands out")
    ap.add_argument("--metrics", type=Path, help="write every measurement here")
    ap.add_argument("--json", type=Path, help="write every finding here")
    ap.add_argument("--verbose", action="store_true")
    ap.add_argument("-j", "--jobs", type=int, default=0)
    args = ap.parse_args(argv)

    models, maps = tree_dirs(args.mod)
    measured = measure_tree(args.dir or models / "viewmodels", args.jobs)
    if args.metrics:
        args.metrics.write_text(json.dumps(measured))
    findings = [f for m in measured for f in findings_of(m)]
    if args.levels is not None:
        wanted = level_weapons(models, maps, args.levels)
        for f in findings:
            f["levels"] = sorted(wanted.get((f["soldier"], f["weapon"]), ()))
        findings = [f for f in findings if f["levels"]]
    if args.json:
        args.json.write_text(json.dumps(findings, indent=1))
    kinds: dict[str, list[dict]] = {}
    for f in findings:
        kinds.setdefault(f["kind"], []).append(f)
    print(f"{len(measured)} rigs played, {len(findings)} findings on "
          f"{len({f['rig'] for f in findings})} rigs "
          f"({len({f['weapon'] for f in findings})} weapons)")
    for kind, items in sorted(kinds.items(), key=lambda kv: -len(kv[1])):
        weapons = sorted({f["weapon"] or f["rig"] for f in items})
        print(f"  {kind:22} {len(items):>5}  {len(weapons):>4} weapons  "
              f"{', '.join(weapons[:6])}{' ..' if len(weapons) > 6 else ''}")
    if args.verbose:
        for f in sorted(findings, key=lambda f: (f["kind"], f["rig"], f["clip"])):
            print(f"{f['kind']}\t{f['rig']}\t{f['clip']}\t{f['detail']}"
                  + (f"\t{','.join(f['levels'])}" if f.get("levels") else ""))
    return 1 if findings else 0


if __name__ == "__main__":
    sys.exit(main())
