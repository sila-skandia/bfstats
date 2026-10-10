"""The IL-2's control column deviation (`bf42/cockpit_overrides.py`, ledger
CVM-4), built from the real Forgotten Hope archives.

FH's `IL2` authors the stick pivot 0.67 m ahead of and 0.25 m below the eye;
every comparable FH aircraft that draws the same stick-with-hands mesh has it
0.27-0.42 ahead and 0.35-0.42 below. The override re-seats the IL-2's column
at the comparable median and must touch nothing else.

Skipped cleanly when the game install or its Forgotten Hope mod is absent.
"""

from __future__ import annotations

import json
import math
import struct
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from bf42 import cockpit_overrides  # noqa: E402
from bf42.assemble import Assembler  # noqa: E402
from extract_models import (  # noqa: E402
    DEFAULT_GAME_DIR, build_library, build_pools, mod_chain,
)

AHEAD_BAND = (0.27, 0.42)
BELOW_BAND = (0.35, 0.42)
NEAR_MAX = 0.25


def glb_json(blob: bytes) -> dict:
    length = struct.unpack_from("<I", blob, 12)[0]
    return json.loads(blob[20:20 + length])


def local_matrix(node: dict) -> list[list[float]]:
    x, y, z, w = node.get("rotation", [0, 0, 0, 1])
    sx, sy, sz = node.get("scale", [1, 1, 1])
    tx, ty, tz = node.get("translation", [0, 0, 0])
    r = [[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
         [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
         [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]]
    s = (sx, sy, sz)
    t = (tx, ty, tz)
    return [[r[i][j] * s[j] for j in range(3)] + [t[i]] for i in range(3)] \
        + [[0, 0, 0, 1]]


def mul(a, b):
    return [[sum(a[i][k] * b[k][j] for k in range(4)) for j in range(4)]
            for i in range(4)]


def walk(doc: dict):
    """(node index, world matrix, node) for every node of the first scene."""
    nodes = doc["nodes"]
    ident = [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]]

    def rec(i, parent):
        world = mul(parent, local_matrix(nodes[i]))
        yield i, world, nodes[i]
        for child in nodes[i].get("children", []):
            yield from rec(child, world)

    for root in doc["scenes"][0]["nodes"]:
        yield from rec(root, ident)


def position(world) -> tuple[float, float, float]:
    return (world[0][3], world[1][3], world[2][3])


def eye_of(doc: dict, control: str):
    return next(position(w) for _, w, n in walk(doc)
                if (n.get("extras") or {}).get("templateKind") == "Camera"
                and (n.get("extras") or {}).get("control") == control)


def stick_pivot(doc: dict, rotation_name: str):
    return next(position(w) for _, w, n in walk(doc)
                if n.get("name", "").casefold() == rotation_name.casefold())


def nearest_stick_point(doc: dict, rotation_name: str, eye) -> float:
    """Distance from the eye to the nearest corner-clamped point of the
    stick's meshes (box of each mesh's POSITION accessor, in world space)."""
    best = math.inf
    nodes = doc["nodes"]
    root = next(i for i, n in enumerate(nodes)
                if n.get("name", "").casefold() == rotation_name.casefold())
    subtree = set()

    def mark(i):
        subtree.add(i)
        for c in nodes[i].get("children", []):
            mark(c)
    mark(root)
    for i, world, node in walk(doc):
        if i not in subtree or "mesh" not in node:
            continue
        for prim in doc["meshes"][node["mesh"]]["primitives"]:
            acc = doc["accessors"][prim["attributes"]["POSITION"]]
            lo, hi = acc["min"], acc["max"]
            corners = [(a, b, c) for a in (lo[0], hi[0])
                       for b in (lo[1], hi[1]) for c in (lo[2], hi[2])]
            pts = [(sum(world[r][k] * p[k] for k in range(3)) + world[r][3])
                   for p in corners for r in range(3)]
            pts = [tuple(pts[j:j + 3]) for j in range(0, len(pts), 3)]
            bb = [(min(p[k] for p in pts), max(p[k] for p in pts))
                  for k in range(3)]
            near = [min(max(eye[k], bb[k][0]), bb[k][1]) for k in range(3)]
            best = min(best, math.dist(near, eye))
    return best


class CockpitOverrideTests(unittest.TestCase):
    library = None
    pools = None

    @classmethod
    def setUpClass(cls) -> None:
        game = Path(DEFAULT_GAME_DIR).expanduser()
        mods = game / "Mods"
        if not mods.is_dir() or not any(
                d.name.lower() == "fh" for d in mods.iterdir()):
            raise unittest.SkipTest("Forgotten Hope is not installed")
        chain = mod_chain(game, "fh")
        meshes, textures, objects, _game = build_pools(chain, [])
        cls.pools = (meshes, textures, objects)
        cls.library = build_library(objects)
        for name in ("IL2", "Zero", "BF109"):
            if cls.library.object(name) is None:
                raise unittest.SkipTest(f"FH has no {name} template")

    def export(self, name: str, *, mod, first_person=False) -> dict:
        meshes, textures, objects = self.pools
        assembler = Assembler(meshes, textures, objects, self.library,
                              max_texture=64, first_person=first_person,
                              include_collision=not first_person,
                              install_mod=mod)
        blob, _report = assembler.export(name)
        return glb_json(blob)

    def test_the_il2_pivot_lies_in_the_comparable_band(self) -> None:
        base = self.export("IL2", mod="fh")
        cockpit = self.export("IL2", mod="fh", first_person=True)
        eye = eye_of(base, "IL2")
        pivot = stick_pivot(base, "IL2stickrotation")
        # glTF is Z-mirrored: ahead of the eye is -Z.
        ahead = eye[2] - pivot[2]
        below = eye[1] - pivot[1]
        self.assertTrue(AHEAD_BAND[0] <= ahead <= AHEAD_BAND[1], ahead)
        self.assertTrue(BELOW_BAND[0] <= below <= BELOW_BAND[1], below)
        near = nearest_stick_point(cockpit, "IL2stickrotation",
                                   eye_of(base, "IL2"))
        self.assertLessEqual(near, NEAR_MAX)
        # The grip's top is below the eye line, not above it (authored: +0.09).
        top = self._world_top(cockpit, "IL2stickrotation")
        self.assertLess(top, eye[1])

    def _world_top(self, doc, rotation_name) -> float:
        nodes = doc["nodes"]
        root = next(i for i, n in enumerate(nodes)
                    if n.get("name", "").casefold() == rotation_name.casefold())
        subtree = set()

        def mark(i):
            subtree.add(i)
            for c in nodes[i].get("children", []):
                mark(c)
        mark(root)
        top = -math.inf
        for i, world, node in walk(doc):
            if i not in subtree or "mesh" not in node:
                continue
            for prim in doc["meshes"][node["mesh"]]["primitives"]:
                acc = doc["accessors"][prim["attributes"]["POSITION"]]
                for a in (acc["min"][0], acc["max"][0]):
                    for b in (acc["min"][1], acc["max"][1]):
                        for c in (acc["min"][2], acc["max"][2]):
                            top = max(top, sum(world[1][k] * v for k, v in
                                               enumerate((a, b, c))) + world[1][3])
        return top

    def test_the_deviation_is_stamped_and_authored_is_recoverable(self) -> None:
        base = self.export("IL2", mod="fh")
        node = next(n for n in base["nodes"]
                    if n.get("name", "").casefold() == "il2stickrotation")
        stamp = node["extras"]["cockpitOverride"]
        self.assertEqual("fh-il2-stick-seat", stamp["id"])
        self.assertEqual([0.03, 0.58, 0.465], stamp["original"])
        self.assertEqual("refractor", stamp["frame"])
        # Revert is a table edit: without the mod key the authored value returns.
        plain = self.export("IL2", mod=None)
        authored = next(n for n in plain["nodes"]
                        if n.get("name", "").casefold() == "il2stickrotation")
        self.assertNotIn("cockpitOverride", authored.get("extras", {}))
        self.assertEqual([0.03, 0.58, -0.465], authored["translation"])

    def test_other_planes_are_byte_identical_with_and_without_the_table(self) -> None:
        for name in ("Zero", "BF109"):
            for first_person in (False, True):
                with self.subTest(name=name, first_person=first_person):
                    on = self.export(name, mod="fh", first_person=first_person)
                    off = self.export(name, mod=None, first_person=first_person)
                    self.assertEqual(
                        json.dumps(on["nodes"], sort_keys=True),
                        json.dumps(off["nodes"], sort_keys=True))
                    self.assertFalse(any(
                        "cockpitOverride" in (n.get("extras") or {})
                        for n in on["nodes"]))


class TableTests(unittest.TestCase):
    def test_pattern_and_mod_selection(self) -> None:
        self.assertIsNotNone(cockpit_overrides.stick_override("FH", "Il2-bstickrotation"))
        self.assertIsNotNone(cockpit_overrides.stick_override("fhsw", "IL2stickrotation"))
        self.assertIsNone(cockpit_overrides.stick_override("bf1942", "IL2stickrotation"))
        self.assertIsNone(cockpit_overrides.stick_override("fh", "bf109stickrotation"))
        self.assertIsNone(cockpit_overrides.stick_override(None, "IL2stickrotation"))

    def test_reseat_keeps_the_lateral_offset(self) -> None:
        entry = cockpit_overrides.stick_override("fh", "IL2stickrotation")
        self.assertEqual((0.03, 0.47, 0.15),
                         cockpit_overrides.reseat(entry, (-0.007, 0.83, -0.2),
                                                  (0.03, 0.58, 0.465)))



def _synthetic(ahead: float, below: float, override=None):
    """(base doc, cockpit doc) of a one-stick aircraft whose pilot's eye is at
    (0, 1, 0.2) and whose stick pivot sits `ahead`/`below` it (glTF: -Z)."""
    eye = (0.0, 1.0, 0.2)
    base = {
        "scenes": [{"nodes": [0]}],
        "nodes": [{"name": "X", "children": [1],
                   "extras": {"control": "X"}},
                  {"name": "XCamera", "translation": list(eye),
                   "extras": {"templateKind": "Camera", "cameraView": 0,
                              "control": "X"}}],
    }
    pivot = [0.0, eye[1] - below, eye[2] - ahead]
    extras = {"control": "X",
              "rig": {"axes": {"roll": {"input": "c_PIRoll"}}}}
    if override:
        extras["cockpitOverride"] = override
    cockpit = {
        "scenes": [{"nodes": [0]}],
        "nodes": [{"name": "X", "children": [1], "extras": {"control": "X"}},
                  {"name": "Xstickrotation", "translation": pivot,
                   "children": [2], "extras": extras},
                  {"name": "stick", "mesh": 0, "extras": {"control": "X"}}],
        "meshes": [{"primitives": [{"attributes": {"POSITION": 0},
                                    "material": 0}]}],
        "accessors": [{"min": [-0.02, 0.0, -0.01], "max": [0.13, 0.26, 0.23]}],
        "materials": [{"pbrMetallicRoughness": {
            "baseColorTexture": {"index": 0}}}],
        "textures": [{"source": 0}],
        "images": [{"name": "Pilot_Hand_Sleeve.tga"}],
    }
    return base, cockpit


class GripAuditTests(unittest.TestCase):
    def test_grip_is_measured_against_the_eye(self) -> None:
        import audit_mod
        grip = audit_mod.cockpit_grip(*_synthetic(0.35, 0.36))
        self.assertAlmostEqual(0.35, grip["ahead"], places=6)
        self.assertAlmostEqual(0.36, grip["below"], places=6)
        self.assertLess(grip["top_above_eye"], 0)

    def test_outlier_is_flagged_and_a_stamped_deviation_is_accepted(self) -> None:
        import tempfile
        import audit_mod
        docs = {f"R{i}": _synthetic(0.35, 0.36) for i in range(4)}
        docs["Bad"] = _synthetic(0.67, 0.25)
        docs["Fixed"] = _synthetic(0.35, 0.36, override={
            "id": "x", "ledger": "CVM-4", "reason": "r",
            "original": [0, 0.58, 0.465], "applied": [0, 0.47, 0.15]})
        with tempfile.TemporaryDirectory() as tmp:
            models = Path(tmp)
            entries = []
            for name in docs:
                for suffix in (".glb", ".cockpit.glb"):
                    (models / f"{name}{suffix}").write_bytes(b"")
                entries.append({"name": name, "category": "air",
                                "glb": f"{name}.glb",
                                "cockpit": f"{name}.cockpit.glb"})
            tree = audit_mod.Tree("fh", models, models, models)
            real = audit_mod.read_glb
            audit_mod.read_glb = lambda p, with_bin=False: (
                docs[Path(p).name.split(".")[0]][1 if ".cockpit" in str(p) else 0],
                None)
            try:
                found = audit_mod.grip_findings(tree, entries)
            finally:
                audit_mod.read_glb = real
        by = {f.subject: f for f in found}
        self.assertEqual({"Bad", "Fixed"}, set(by))
        self.assertEqual("cockpit-stick-out-of-band", by["Bad"].cause)
        self.assertEqual("minor", by["Bad"].severity)
        self.assertEqual("cockpit-stick-deviation-applied", by["Fixed"].cause)
        self.assertTrue(by["Fixed"].record()["accepted"])
        self.assertEqual("Fixed", by["Fixed"].record()["template"])


if __name__ == "__main__":
    unittest.main()
