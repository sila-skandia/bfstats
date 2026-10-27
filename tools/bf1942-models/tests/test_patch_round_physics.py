"""`patch_round_physics.py`: a finished glb's round spec gains the physics bits
its `.con` clears (FHX-30), as a fresh export writes them, only for rounds the
page can move; a second pass changes nothing; the rewrite is by rename and
leaves the BIN chunk and a fresh `.glb.gz`."""

from __future__ import annotations

import os
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from bf42 import glbgz, glbopt  # noqa: E402
from bf42.con import ObjectLibrary  # noqa: E402
from patch_round_physics import cleared_bits, flies, patch_doc, write_atomic  # noqa: E402

CON = """
ObjectTemplate.create Projectile TestTransformKilleProjectile
ObjectTemplate.invisible 1
ObjectTemplate.setHasMobilePhysics 0
ObjectTemplate.setHasCollisionPhysics 0
ObjectTemplate.timeToLive 2.95

ObjectTemplate.create Projectile TestSpotterProjectile
ObjectTemplate.setHasCollisionPhysics 0
ObjectTemplate.timeToLive 180

ObjectTemplate.create Projectile TestYellProjectile
ObjectTemplate.setHasCollisionPhysics 0
ObjectTemplate.timeToLive 0.01

ObjectTemplate.create Projectile TestBullet
ObjectTemplate.invisible 1
ObjectTemplate.setHasCollisionPhysics 1
"""


def node(name, projectile, ttl=None, **fire):
    spec = {"template": projectile, "kind": "bullet"}
    if ttl is not None:
        spec["timeToLive"] = ttl
    return {"name": name, "extras": {"templateKind": "FireArms",
                                     "fireArms": {"projectile": spec, **fire}}}


def spec_of(doc, i):
    return doc["nodes"][i]["extras"]["fireArms"]["projectile"]


class PatchRoundPhysicsTests(unittest.TestCase):
    def setUp(self) -> None:
        self.library = ObjectLibrary()
        self.library.add_con("Objects/Test/Objects.con", CON)

    def test_the_reader_keeps_a_declared_zero_only(self) -> None:
        self.assertEqual({"hasMobilePhysics": False, "hasCollisionPhysics": False},
                         cleared_bits(self.library.object("TestTransformKilleProjectile")))
        self.assertEqual({"hasCollisionPhysics": False},
                         cleared_bits(self.library.object("TestSpotterProjectile")))
        self.assertEqual({}, cleared_bits(self.library.object("TestBullet")))
        self.assertEqual({}, cleared_bits(None))

    def test_a_killer_charge_gains_both_bits_once(self) -> None:
        # velocity 0: it still leaves with its hull's velocity, so it flies.
        doc = {"nodes": [node("KillerGunBarrel", "TestTransformKilleProjectile", 2.95, velocity=0.0),
                         node("Coax", "TestBullet", 5.0), {"name": "Hull"}]}
        self.assertEqual(1, patch_doc(doc, self.library, {}))
        self.assertIs(False, spec_of(doc, 0)["hasMobilePhysics"])
        self.assertIs(False, spec_of(doc, 0)["hasCollisionPhysics"])
        self.assertNotIn("hasCollisionPhysics", spec_of(doc, 1))
        self.assertEqual(0, patch_doc(doc, self.library, {}))

    def test_rounds_the_page_never_moves_are_left_alone(self) -> None:
        doc = {"nodes": [node("Binos", "TestSpotterProjectile", 180.0, magType=2),
                         node("Yell", "TestYellProjectile", 0.01, velocity=10.0)]}
        self.assertFalse(flies(doc["nodes"][0]["extras"]["fireArms"], spec_of(doc, 0)))
        self.assertFalse(flies(doc["nodes"][1]["extras"]["fireArms"], spec_of(doc, 1)))
        self.assertEqual(0, patch_doc(doc, self.library, {}))
        self.assertEqual(2, patch_doc(doc, self.library, {}, every=True))

    def test_a_key_the_template_no_longer_earns_is_removed(self) -> None:
        doc = {"nodes": [node("Coax", "TestBullet", 5.0)]}
        spec_of(doc, 0)["hasCollisionPhysics"] = False
        self.assertEqual(1, patch_doc(doc, self.library, {}))
        self.assertNotIn("hasCollisionPhysics", spec_of(doc, 0))

    def test_the_rewrite_is_by_rename_with_a_fresh_gzip(self) -> None:
        doc = {"asset": {"version": "2.0"},
               "nodes": [node("KillerGunBarrel", "TestTransformKilleProjectile", 2.95)]}
        blob = bytes(range(64))
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "scene.glb"
            path.write_bytes(glbopt.write_glb(doc, blob))
            before = path.stat().st_ino
            self.assertEqual(1, patch_doc(doc, self.library, {}))
            data = glbopt.write_glb(doc, blob)
            write_atomic(path, data, brotli=False)
            self.assertNotEqual(before, path.stat().st_ino)
            self.assertEqual(data, path.read_bytes())
            self.assertTrue(glbgz.is_fresh(data, glbgz.gz_path(path)))
            _, kept = glbopt.read_glb(path.read_bytes())
            self.assertEqual(blob, kept[:len(blob)])
            self.assertEqual(["scene.glb", "scene.glb.gz"], sorted(os.listdir(tmp)))


if __name__ == "__main__":
    unittest.main()
