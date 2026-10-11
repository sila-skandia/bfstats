"""A first-person rifle returns to rest after every shot, and its parts rest right.

The FH report (2026-10-11): spawn as the Russian second kit (SVT40), "the weapon
starts in place, then rises up as they fire; in the real game it quickly
recoils and acts like a real bolt". Two causes sat behind it:

* the bound parts (charging handle, magazine) of every family without a weapon
  clip held `weapon_skeleton.relative(...)` of the *template's* skeleton, while
  the parts are placed by the AnimatedBundle's. FH's SVT40 declares `Type5.ske`
  on the template and `SVT40.ske` on its bundle, so the handle stood up as a
  30 cm tube (90 degrees) until a fire clip snapped it back;
* nothing asserted that a shot's clip *ends* where the idle begins, so a rest
  that differed from the clip's last frame read as the gun "rising".

These read the extracted FH viewmodels and skip when the tree is absent (it is
not checked in). A shot is a clip that is a pure function of its own time (no
state carried between shots: every family writes absolute locals), so "returns
to rest after the clip" is the same statement as "no cumulative drift over any
number of consecutive shots".

Retail's recoil, measured off the owner's capture of the real game (SVT40, a
single muzzle-flash frame): the rifle's apparent size grows 1.65x, which at the
receiver's 0.55 m is a pull-back of about 0.2 m. The data's fire clip pulls the
weapon 0.279 m at its first key; the bounds below bracket both.
"""

from __future__ import annotations

import json
import math
import struct
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FH = ROOT / "viewer" / "models" / "mods" / "fh" / "viewmodels"

RIGS = [
    "RussianSoldier__SVT40",
    "RussianSoldier__MosinNagant",
    "GermanSoldier__K98",
    "BritishSoldier__No4",
    "USSoldier__Springfield03A3",
    "USSoldier__Springfield03",
    "JapaneseSoldier__Arisaka",
    "USSoldier__Winchester",
]


# The bolt state of these runs the weapon's whole reload clip, and the data's
# clip ends the arms off the aim pose (the Winchester's 1PReloadWinchester.baf:
# 15 cm); `returnToState _POSE_` then morphs home at the aim state's rate, as
# the engine does. Not the exporter's to fix.
BOLT_ENDS_OFF_REST = {"USSoldier__Winchester"}


def load(path: Path):
    blob = path.read_bytes()
    n = struct.unpack("<I", blob[12:16])[0]
    doc = json.loads(blob[20:20 + n])
    off = 20 + n
    size = struct.unpack("<I", blob[off:off + 4])[0]
    return doc, blob[off + 8:off + 8 + size]


def accessor(doc, binary, index):
    a = doc["accessors"][index]
    view = doc["bufferViews"][a["bufferView"]]
    width = {"SCALAR": 1, "VEC3": 3, "VEC4": 4}[a["type"]]
    base = view.get("byteOffset", 0) + a.get("byteOffset", 0)
    return [struct.unpack_from("<" + "f" * width, binary, base + 4 * width * k)
            for k in range(a["count"])]


def quat_matrix(q):
    x, y, z, w = q
    n = math.sqrt(x * x + y * y + z * z + w * w) or 1.0
    x, y, z, w = x / n, y / n, z / n, w / n
    return [[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
            [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
            [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]]


def compose(t, q):
    r = quat_matrix(q)
    return [r[0] + [t[0]], r[1] + [t[1]], r[2] + [t[2]], [0, 0, 0, 1]]


def mul(a, b):
    return [[sum(a[i][k] * b[k][j] for k in range(4)) for j in range(4)]
            for i in range(4)]


def quat_angle(a, b):
    d = min(1.0, abs(sum(x * y for x, y in zip(a, b))
                     / (math.hypot(*a) * math.hypot(*b) or 1.0)))
    return math.degrees(2 * math.acos(d))


class Rig:
    def __init__(self, path: Path):
        self.doc, self.bin = load(path)
        self.nodes = self.doc["nodes"]
        self.parent = {c: i for i, n in enumerate(self.nodes)
                       for c in n.get("children", [])}
        self.anim = {a["name"]: a for a in self.doc.get("animations", [])}

    def tracks(self, clip):
        out = {}
        a = self.anim[clip]
        for ch in a["channels"]:
            s = a["samplers"][ch["sampler"]]
            out[(ch["target"]["node"], ch["target"]["path"])] = accessor(
                self.doc, self.bin, s["output"])
        return out

    def grip(self):
        return next(i for i, n in enumerate(self.nodes)
                    if n.get("name", "").endswith(" grip"))

    def bound(self):
        return [i for i, n in enumerate(self.nodes)
                if (n.get("extras") or {}).get("boundBone")]

    def world(self, node, tracks, key):
        def local(i):
            n = self.nodes[i]
            t, q = n.get("translation", [0, 0, 0]), n.get("rotation", [0, 0, 0, 1])
            if (i, "translation") in tracks:
                v = tracks[(i, "translation")]
                t = v[min(key, len(v) - 1)]
            if (i, "rotation") in tracks:
                v = tracks[(i, "rotation")]
                q = v[min(key, len(v) - 1)]
            return compose(t, q)
        m = local(node)
        while node in self.parent:
            node = self.parent[node]
            m = mul(local(node), m)
        return [m[r][3] for r in range(3)]


def rigs():
    for name in RIGS:
        path = FH / f"{name}.fp.glb"
        if path.exists():
            yield name, Rig(path)


@unittest.skipUnless(FH.is_dir(), "FH viewmodels are not extracted here")
class RifleRestTests(unittest.TestCase):
    def test_a_shot_ends_where_the_idle_begins(self) -> None:
        seen = 0
        for name, rig in rigs():
            seen += 1
            grip = rig.grip()
            idle, fire = rig.tracks("idle"), rig.tracks("fire")
            # The arms clip is 11 keys; the grip's world follows the hand.
            rest = rig.world(grip, idle, 0)
            end = rig.world(grip, fire, 10)
            with self.subTest(rig=name):
                self.assertLess(math.dist(rest, end), 0.005,
                                "the weapon is not back at rest after a shot")
        self.assertGreater(seen, 0)

    def test_a_shots_recoil_is_the_retail_kick(self) -> None:
        for name, rig in rigs():
            grip = rig.grip()
            idle, fire = rig.tracks("idle"), rig.tracks("fire")
            rest = rig.world(grip, idle, 0)
            peak = max(math.dist(rest, rig.world(grip, fire, k)) for k in range(11))
            with self.subTest(rig=name):
                self.assertGreater(peak, 0.15)
                self.assertLess(peak, 0.35)

    def test_bound_parts_rest_where_the_shot_leaves_them(self) -> None:
        """The charging handle must not stand up between shots (SVT40)."""
        for name, rig in rigs():
            idle, fire = rig.tracks("idle"), rig.tracks("fire")
            for node in rig.bound():
                for path, tol in (("translation", 0.003), ("rotation", 1.5)):
                    key = (node, path)
                    if key not in idle or key not in fire:
                        continue
                    a, b = idle[key][0], fire[key][-1]
                    gap = (math.dist(a, b) if path == "translation"
                           else quat_angle(a, b))
                    with self.subTest(rig=name, part=self.nodes_name(rig, node),
                                      path=path):
                        self.assertLess(gap, tol)

    def test_a_bolt_cycle_ends_at_rest_too(self) -> None:
        """FH's bolt rifles fire into `bolt`; consecutive shots must not stack."""
        checked = 0
        for name, rig in rigs():
            if "bolt" not in rig.anim or name in BOLT_ENDS_OFF_REST:
                continue
            checked += 1
            grip = rig.grip()
            idle, bolt = rig.tracks("idle"), rig.tracks("bolt")
            rest = rig.world(grip, idle, 0)
            last = max(len(v) for v in bolt.values()) - 1
            with self.subTest(rig=name):
                self.assertLess(math.dist(rest, rig.world(grip, bolt, last)), 0.02)
        self.assertGreater(checked, 0)

    @staticmethod
    def nodes_name(rig, node):
        return rig.nodes[node].get("name")


if __name__ == "__main__":
    unittest.main()
