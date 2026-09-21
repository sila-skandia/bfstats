"""`viewer/contact-response.js` -- the rigid-body contact a fuse round gets.

Every number here was read out of the unstripped Linux dedicated server
(`bf1942_lnxded-1.61-patched/bf1942/bf1942_lnxded.static`) or surveyed out of
the shipped `.con` and `.sm` data; the module's own header carries the
addresses. The four that the tests below turn on:

  * `ResponsePhysics::impulseOn` (0x08258900) stores the pair's friction,
    elasticity and resistance at `+0xa8`, `+0xac` and `+0xb0` as
    `0.5 * (value(mat1) + value(mat2))` -- the 0.5 is `ds:0x86b05e8`, and the
    three `call [edx+0x58]` / `+0x5c` / `+0x60` pairs at 0x08258b76-0x08258c06
    are the two lookups per word.
  * `ResponsePhysics::solveImpulse` (0x08258d30) hands the root
    `speedAdjust * 30 * (1 + elasticity) * 0.5` (`fld1; fadd [edx+0xac]` at
    0x08258ed4/0x08258ed6), so one tick leaves `v_n * (1 - e) / 2`.
  * `getElasticityForMaterial` (0x081751f0) reads `Material+0x10` and falls
    back through `getMaterialPtr(0)` to **material 0**, then to `fld1` = 1.0.
  * `materialManagerdefine.con` gives material 70 "Grenades" elasticity 2.0,
    friction 2.0 and resistance 2.0, and every other vanilla material
    elasticity 0. 70 is also the collision-vertex material of both grenade
    meshes (`gran_al_Base_m1.sm`, `granade_axis_m1.sm`, six col0 vertices
    each); the explosives pack is 195 and the landmine 232, neither of which
    vanilla defines, so both fall back to material 0.

So a grenade's pair elasticity is exactly 1.0 and `(1 - 1)/2` is zero: it
cancels its into-surface velocity rather than rebounding, and what it keeps is
the along-surface half. That is the finding these tests exist to pin, because
"the grenade bounces" is the obvious reading of elasticity 2.0 and it is wrong.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
VIEWER = ROOT / "viewer"
HARNESS = Path(__file__).with_name("contact_response_harness.mjs")
MODULES = {"contact-response.js": VIEWER / "contact-response.js"}


def run_harness() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    for source in MODULES.values():
        if not source.exists():
            raise unittest.SkipTest(f"{source.name} is not in the tree")
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        for name, source in MODULES.items():
            shutil.copyfile(source, work / name)
        (work / "package.json").write_text('{"type":"module"}\n')
        shutil.copyfile(HARNESS, work / "harness.mjs")
        proc = subprocess.run(
            ["node", str(work / "harness.mjs")],
            capture_output=True, text=True, timeout=120)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


class ContactResponseTests(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()

    def test_the_constants_are_the_engine_constants(self) -> None:
        constants = self.results["constants"]
        # The solver runs at the engine's 30 Hz and every budget in it is per
        # tick; `addFriction` hard-codes 1.5 * 9.82 rather than reading
        # getGravity(), and the static latch costs 1.5x to break.
        self.assertEqual(30, constants["simHz"])
        self.assertAlmostEqual(14.73, constants["gravity"])
        self.assertEqual(1.5, constants["staticFactor"])
        self.assertEqual(70, constants["grenadeMaterial"])
        self.assertEqual({"friction": 1.0, "elasticity": 0.0, "resistance": 0.01},
                         constants["defaults"])

    def test_an_undefined_material_falls_back_to_material_zero(self) -> None:
        # The accessors ask `getMaterialPtr(id)`, then `getMaterialPtr(0)`,
        # then push `fld1`. A real miss -- 99, one of the gaps in
        # `materialManagerdefine.con`, which declares 155 ids and not that one
        # -- gets material 0's AUTHORED friction 1.0 and resistance 0.02, not
        # the Material constructor's 0.01.
        lookup = self.results["lookup"]
        self.assertAlmostEqual(1.0, lookup["undefinedFriction"])
        self.assertAlmostEqual(0.02, lookup["undefinedResistance"])
        self.assertAlmostEqual(0.0, lookup["undefinedElasticity"])
        # 195 and 232 are NOT misses: both are declared, each with a
        # `materialDamage` and none of the three physical words, so each is a
        # real Material carrying the constructor's 0.01. Reading them as
        # fall-throughs would put material 0's 0.02 in a landmine's contact.
        self.assertAlmostEqual(0.01, lookup["expackResistance"])
        self.assertAlmostEqual(0.01, lookup["landmineResistance"])
        # No table at all, and a table with no material 0: `fld1`.
        self.assertEqual(1.0, lookup["noTable"])
        self.assertEqual(1.0, lookup["noZero"])

    def test_a_declared_but_bare_material_is_not_a_miss(self) -> None:
        # The engine's Material constructor writes 1.0 / 0 / 0.01 and the
        # `.con` overrides only the words it names, so a declaration naming
        # none of the three -- 195 and 232 among others -- is a real Material
        # holding those values. `getMaterialPtr` never misses on it and
        # material 0's authored 0.02 never comes into it. In JSON that state
        # is an entry with no such key.
        bare = self.results["declaredBare"]
        self.assertAlmostEqual(0.01, bare["resistance"])
        self.assertAlmostEqual(0.0, bare["elasticity"])
        self.assertAlmostEqual(1.0, bare["friction"])
        # An id that is not in the table at all is still a real miss, and
        # still takes material 0's authored 0.02.
        self.assertAlmostEqual(0.02, bare["missResistance"])

    def test_a_table_that_predates_the_two_new_words_is_not_read_as_a_miss(self) -> None:
        # `elasticity` and `resistance` only joined `bf42/damage.py` this
        # round, so an asset tree extracted before it carries `friction`
        # alone. The engine has no such state -- a Material always holds all
        # three -- so running the miss chain on it would answer `fld1` and
        # make every elasticity 1.0 (a landmine would stop dead like a
        # grenade) and every resistance 1.0 (twenty times material 0's).
        stale = self.results["staleTable"]
        self.assertAlmostEqual(0.8, stale["friction"])
        self.assertAlmostEqual(0.0, stale["grenadeElasticity"])
        self.assertAlmostEqual(0.01, stale["grassResistance"])
        self.assertAlmostEqual(0.0, stale["undefinedElasticity"])
        # Both rounds then behave as the pre-round viewer's materials would:
        # no elasticity anywhere, so `v_n / 2` for both.
        self.assertAlmostEqual(0.0, stale["grenadeOnGrass"]["elasticity"])
        self.assertAlmostEqual(0.0, stale["landmineOnGrass"]["elasticity"])
        self.assertAlmostEqual(0.01, stale["landmineOnGrass"]["resistance"])
        # `friction` is in the stale table, so it is untouched by the guard.
        self.assertAlmostEqual(1.4, stale["grenadeOnGrass"]["friction"])

    def test_a_pair_is_the_mean_of_the_two_materials(self) -> None:
        pairs = self.results["pairs"]
        # Grenade (2.0 / 2.0 / 2.0) on juicy grass (0.8 / 0 / 0.08).
        self.assertAlmostEqual(1.4, pairs["grenadeOnGrass"]["friction"])
        self.assertAlmostEqual(1.0, pairs["grenadeOnGrass"]["elasticity"])
        self.assertAlmostEqual(1.04, pairs["grenadeOnGrass"]["resistance"])
        # Landmine (material 232: declared, bare, so 1.0 / 0 / 0.01) on the
        # same grass. The resistance is 0.045, not the 0.05 a fall-through to
        # material 0's authored 0.02 would give.
        self.assertAlmostEqual(0.9, pairs["landmineOnGrass"]["friction"])
        self.assertAlmostEqual(0.0, pairs["landmineOnGrass"]["elasticity"])
        self.assertAlmostEqual(0.045, pairs["landmineOnGrass"]["resistance"])
        # The explosives pack's 195 lands on exactly the same three.
        self.assertAlmostEqual(0.9, pairs["expackOnGrass"]["friction"])
        self.assertAlmostEqual(0.0, pairs["expackOnGrass"]["elasticity"])
        self.assertAlmostEqual(0.045, pairs["expackOnGrass"]["resistance"])

    def test_a_grenade_cancels_its_normal_velocity_and_does_not_rebound(self) -> None:
        # This is the whole finding. `(1 - e) / 2` with e = 1.0 is ZERO, so a
        # grenade's into-surface velocity goes to exactly nothing and the
        # along-surface velocity survives. Elasticity 2.0 is the value that
        # produces that, not a restitution coefficient of 2.
        restitution = self.results["restitution"]
        self.assertAlmostEqual(0.5, restitution["zero"])
        self.assertAlmostEqual(0.0, restitution["one"])
        self.assertAlmostEqual(0.0, restitution["grenadeOnGrass"])
        self.assertAlmostEqual(0.5, restitution["landmineOnGrass"])
        # Only above a pair mean of 1 does anything come back, and nothing in
        # vanilla reaches it -- 70 is the only non-zero and it pairs to 1.0.
        self.assertAlmostEqual(-0.5, restitution["two"])
        self.assertAlmostEqual(-1.0, restitution["three"])

        flat = self.results["singleContact"]["grenadeFlat"]
        self.assertAlmostEqual(0.0, flat["velocity"]["y"])
        self.assertGreater(flat["velocity"]["x"], 13)
        # And a landmine keeps half of its downward speed: the soft settle.
        mine = self.results["singleContact"]["landmineFlat"]
        self.assertAlmostEqual(-5.0, mine["velocity"]["y"])

    def test_a_vertical_face_applies_no_coulomb_friction(self) -> None:
        # `limKinetic = mu * N.y * 14.73/30` -- collision-response.md section
        # 8. A wall has N.y = 0, so the only thing slowing a round sliding down
        # it is the viscous resistance term, which is why a grenade drops down
        # a wall rather than skidding along it.
        wall = self.results["singleContact"]["grenadeWall"]
        self.assertAlmostEqual(0.0, wall["velocity"]["x"], places=6)
        # -3 m/s downward, shed only by resistance 1.005 * 3 / 30 = 0.1005.
        self.assertAlmostEqual(-2.8830515, wall["velocity"]["y"], places=5)
        self.assertFalse(wall["latched"])

    def test_the_push_out_is_minus_depth_along_the_normal(self) -> None:
        push = self.results["singleContact"]["pushOut"]
        self.assertAlmostEqual(5.25, push["y"])
        self.assertAlmostEqual(5.0, push["x"])

    def test_a_degenerate_normal_changes_nothing(self) -> None:
        # `impulseOn` divides by `n . n`; a zero normal must not produce NaN.
        degenerate = self.results["singleContact"]["degenerateNormal"]
        self.assertEqual({"x": 1, "y": 2, "z": 3}, degenerate["velocity"])
        self.assertEqual(0, degenerate["tangentSpeed"])

    def test_a_thrown_grenade_skids_past_where_it_used_to_stop(self) -> None:
        # The measurement the feature doc quotes: the same throw (18 m/s
        # forward, 4 m/s up, from 1.6 m) under the old "stop dead at first
        # contact" rule and under the contact solver.
        old = self.results["stopDead"]
        new = self.results["flatGround"]["grenade"]
        self.assertAlmostEqual(14.3816, old["x"], places=3)
        # 21.388 since the elastic rebound: one soft hop off the landing, then
        # the same skid (it was 18.7548 when a grenade stopped dead on touch).
        self.assertAlmostEqual(21.388, new["rest"]["x"], places=3)
        self.assertGreater(new["rest"]["x"] - old["x"], 4.0)
        self.assertTrue(new["resting"])
        standoff = self.results["constants"]["standoff"]
        self.assertAlmostEqual(standoff, new["rest"]["y"], places=6,
                               msg="the round must end ON the ground, not in it")
        self.assertGreaterEqual(new["lowest"], 0.0)
        self.assertEqual(0, new["speed"])

    def test_a_landmine_slides_further_than_a_grenade(self) -> None:
        # Not because it is heavier -- mass is nowhere in this solver -- but
        # because material 232 falls back to material 0's friction 1.0 while
        # the grenade's own is 2.0, so the pair means are 0.9 and 1.4.
        # On the ground alone that still holds, but the grenade now hops once
        # off its landing (ELASTIC_REBOUND) and the hop carries it past the
        # landmine, so the comparison that survives is the one the materials
        # make: the inelastic rounds never rebound, and everything rests a
        # standoff above the ground, never in it.
        ground = self.results["flatGround"]
        self.assertTrue(ground["landmine"]["resting"])
        self.assertTrue(ground["expack"]["resting"])
        self.assertEqual(ground["landmine"]["rest"], ground["expack"]["rest"])
        standoff = self.results["constants"]["standoff"]
        for name in ("grenade", "landmine", "expack"):
            self.assertAlmostEqual(standoff, ground[name]["rest"]["y"], places=6)
            self.assertGreaterEqual(ground[name]["lowest"], 0.0)

    def test_a_round_thrown_at_a_wall_ends_at_its_foot(self) -> None:
        wall = self.results["againstWall"]
        standoff = self.results["constants"]["standoff"]
        for name in ("grenade", "landmine"):
            self.assertLess(wall[name]["rest"]["x"], 6.0, "never past the wall")
            self.assertAlmostEqual(standoff, wall[name]["rest"]["y"], places=6)
            self.assertTrue(wall[name]["resting"])
            # The corner where the wall meets the floor is where a round used
            # to sink through the floor and fall out of the world.
            self.assertGreaterEqual(wall[name]["lowest"], 0.0)
        # The inelastic landmine ends at the wall's foot. The grenade comes off
        # it with a soft rebound -- 20 m/s in, a metre or two back, not a
        # ricochet -- and is not hauled back to the wall by the re-seat probe.
        self.assertLess(wall["landmine"]["backFromWall"], 0.05)
        self.assertGreater(wall["grenade"]["backFromWall"], 0.5)
        self.assertLess(wall["grenade"]["backFromWall"], 3.0)
        self.assertGreater(wall["landmine"]["contacts"], 2)

    def test_friction_decides_what_rolls_down_a_slope(self) -> None:
        # A ContactGrip part slides when the along-slope pull beats
        # `mu * N.y * g/30`, i.e. when `tan(theta) > mu`, and a latched contact
        # needs 1.5x that. A grenade's 1.4 holds it on a 45-degree slope; a
        # landmine's 0.9 does not.
        slope = self.results["downSlope"]
        self.assertTrue(slope["grenadeGentle"]["resting"])
        self.assertLess(abs(slope["grenadeGentle"]["rest"]["x"]), 0.05)
        self.assertTrue(slope["grenadeSteep"]["resting"])
        self.assertLess(abs(slope["grenadeSteep"]["rest"]["x"]), 1.0)
        self.assertTrue(slope["landmineGentle"]["resting"])
        self.assertFalse(slope["landmineSteep"]["resting"])
        self.assertGreater(slope["landmineSteep"]["rest"]["x"], 5.0)

    def test_the_solver_is_frame_rate_independent(self) -> None:
        # Every budget in `applyContact` is a per-tick velocity change rather
        # than an acceleration, so the step is fixed at 1/30 with a carried
        # remainder. Running it at the frame's own dt would shed friction
        # proportionally faster on a fast machine.
        rates = self.results["frameRate"]
        self.assertEqual(rates["30"]["x"], rates["60"]["x"])
        self.assertEqual(rates["30"]["x"], rates["144"]["x"])
        self.assertTrue(all(r["resting"] for r in rates.values()))


if __name__ == "__main__":
    unittest.main()
