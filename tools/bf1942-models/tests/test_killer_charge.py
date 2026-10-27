"""FH's mobile guns' killer charge stays where it is dropped and bursts at the
end of its clock, whatever stands beside it (FHX-30).

Its `.con` clears two physics bits a Projectile's constructor sets
(`ProjectileTemplate()` ORs 0x0f into +0x70, lnxded 0x0831faa9):
`setHasMobilePhysics 0` and `setHasCollisionPhysics 0`. The exporter writes
them as `projectile.hasMobilePhysics` / `hasCollisionPhysics` false
(`bf42/assemble.py`); `projectile-flight.js` neither moves such a round nor
sweeps it. Before, the 85mm AA gun's charge (velocity 1) flew into the static
an earlier deploy had stood 1-3 m in front of it, died on contact
(`dieAfterColl 1`, no collision effect) and never burst: the mobile gun and its
static coexisted (`veh.deploy-hull-survived`, pakfront).
"""

from __future__ import annotations

import unittest

from pathlib import Path

import importlib.util

# The proximity-fuse test's module set and runner: the same GunFire stack.
_spec = importlib.util.spec_from_file_location(
    "fhx30_proximity_fuse", Path(__file__).resolve().parent / "test_proximity_fuse.py")
fuse = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(fuse)

HARNESS = Path(__file__).resolve().parent / "killer_charge_harness.mjs"


class KillerChargeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        saved = fuse.HARNESS
        fuse.HARNESS = HARNESS
        try:
            cls.out = fuse.run_harness()
        finally:
            fuse.HARNESS = saved

    def test_a_charge_that_neither_moves_nor_collides_bursts_where_it_was_dropped(self):
        hits = self.out["declared"]
        self.assertEqual(1, len(hits))
        self.assertEqual("endOfLife", hits[0]["blast"])
        self.assertEqual(6, hits[0]["splashRadius"])
        self.assertEqual([0, 0, 0], [abs(v) for v in hits[0]["point"]])

    def test_without_the_words_it_flies_into_the_wall_and_never_bursts(self):
        self.assertFalse(any(h["blast"] == "endOfLife" for h in self.out["undeclared"]))


class KillerChargeWordsTests(unittest.TestCase):
    """The two words, as the reader keeps them: only a declared 0 clears a
    bit the Projectile constructor sets."""

    def test_a_declared_zero_is_kept_and_an_absent_word_is_not(self):
        import sys
        sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
        from bf42.con import ObjectLibrary
        library = ObjectLibrary()
        library.add_con("Objects/Vehicles/Land/85mmAA/Weapons.con", """
ObjectTemplate.create Projectile 85mmAAmobile_TransformKilleProjectile
ObjectTemplate.timeToLive CRD_UNIFORM/2.95/3.0/0
ObjectTemplate.setHasMobilePhysics 0
ObjectTemplate.setHasCollisionPhysics 0
ObjectTemplate.hasOnTimeEffect 1

ObjectTemplate.create Projectile 88mmL56_Projectile
ObjectTemplate.timeToLive CRD_NONE/10/0/0
""")
        killer = library.object("85mmAAmobile_TransformKilleProjectile")
        self.assertTrue(killer.mobile_physics_declared and not killer.has_mobile_physics)
        self.assertTrue(killer.collision_physics_declared and not killer.has_collision_physics)
        shell = library.object("88mmL56_Projectile")
        self.assertFalse(shell.mobile_physics_declared or shell.collision_physics_declared)


if __name__ == "__main__":
    unittest.main()
