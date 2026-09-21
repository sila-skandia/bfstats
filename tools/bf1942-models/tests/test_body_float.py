"""`viewer/body-float.js` -- Refractor's buoyancy, driven headless by
`body_float_harness.mjs`.

`PhysicsFloatingBundle::updatePhysics` (lnxded `0x0824d640`, client
`0x0057e980`) is read in full in
`features/bf1942-ships-research-2026-09-22/README.md` §1.3 and corrected by
that folder's `VERDICT.md`. The three corrections the verdict makes are each a
test here:

  * `t` is formed from the **unclamped** `f` (`fst`, not `fstp`, at
    `0x0824d718`; the `max(f, -1)` store is at `0x0824d778`), which is what
    turns a submarine's trim angle into a dive-depth setpoint in metres rather
    than a one-way sink.
  * `g / -9.82` is **exactly 1.5**, so `8 * 1.5 * 1.2275 = 14.73 = |g|` lands
    on the nose and shows the `floatMinLift`/`floatMaxLift` pair was centred on
    `|g| / (N * 1.5)` deliberately.
  * the `(1 - f) + f*25 = 1 + 24f` damping coefficient really does change sign
    at `f = -1/24`, so the first `hullHeight/24` of submersion is
    anti-damping.

Every expected number below is derived IN THIS FILE from the law's own
algebra -- the closed form `rootY = waterLevel + H - 9.82*H/(N*floatMaxLift)
- relY` for the fleet, and hand arithmetic for the rest. None of it was read
back out of the module's output, and the harness's fleet table is the authored
`.con` data typed in from the research, not read out of a glb.
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
HARNESS = Path(__file__).with_name("body_float_harness.mjs")
MODULES = {"body-float.js": VIEWER / "body-float.js"}

WATER = 20.0
GRAVITY = -14.73
#: What `sum (-f) * lift` has to reach: `|g| / (g / -9.82)` = 9.82.
EQUILIBRIUM_SUM = 9.82

#: N, relY, hullHeight, floatMinLift, floatMaxLift -- each hull's `Physics.con`
#: and `Objects.con`, per the research's §1.5 table.
FLEET = {
    "Fletcher": (8, 7.5, 20.0, 2.0, 2.0),
    "Hatsuzuki": (8, 9.5, 10.0, 2.0, 2.0),
    "Enterprise": (8, 14.8, 17.0, 7.0, 7.0),
    "Shokaku": (8, 11.0, 15.0, 5.0, 5.0),
    "PrinceOW": (8, 14.0, 17.0, 2.0, 2.0),
    "Yamato": (8, 10.5, 10.0, 6.0, 6.0),
    "Gato": (8, 2.0, 3.3, 0.8275, 1.6275),
    "Sub7C": (8, 2.0, 4.3, 0.8275, 1.6275),
}


def closed_form(n, rel_y, hull_height, max_lift):
    """`sum (-f) * lift = 9.82` with every node at one height and `t` saturated.

    `(-f) = 9.82 / (N * floatMaxLift)`, `depth = (-f) * hullHeight`,
    `nodeY = waterLevel + hullHeight - depth`, `rootY = nodeY - relY`.
    """
    f = EQUILIBRIUM_SUM / (n * max_lift)
    return WATER + hull_height - f * hull_height - rel_y


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


class BodyFloatTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.out = run_harness()

    # -- the constants ------------------------------------------------------

    def test_the_lift_normaliser_is_exactly_three_halves(self):
        """`g / -9.82` is 1.5 on the nose, not 1.49995 -- VERDICT §2.7."""
        self.assertEqual(self.out["constants"]["LIFT_NORMALISER"], 1.5)
        self.assertAlmostEqual(9.82 * 1.5, 14.73, places=10)
        self.assertEqual(self.out["constants"]["EQUILIBRIUM_SUM"], 9.82)

    def test_the_submarine_lift_pair_is_centred_on_gravity(self):
        """`8 * 1.5 * (0.8275 + 1.6275)/2 = 14.73` exactly: the midpoint of the
        pair is `|g| / (N * 1.5)`, which is why the dive law has a fixed point
        at `t = 0.5`."""
        self.assertAlmostEqual(8 * 1.5 * (0.8275 + 1.6275) / 2, 14.73, places=10)

    # -- (a) the pieces of the law ------------------------------------------

    def test_submersion_is_zero_at_the_reference_plane_and_minus_one_at_the_sea(self):
        sub = self.out["submersion"]
        self.assertAlmostEqual(sub["atReference"], 0.0, places=12)
        self.assertAlmostEqual(sub["atWaterline"], -1.0, places=12)
        # ((27.725 - 20) - 20) / 20
        self.assertAlmostEqual(sub["fletcherAtDraft"], -0.61375, places=9)
        # ((27.9371 - 20) - 20) / 20
        self.assertAlmostEqual(sub["fletcherAtPad"], -0.603145, places=9)

    def test_a_sink_offset_lowers_the_reference_plane(self):
        """VERDICT §2.4: the accumulator is added to the numerator of `f`, so a
        positive offset deepens `f` -- the plane falls and the hull chases it
        down. ((27.725 - 20) - 20 + 1) / 20."""
        self.assertAlmostEqual(self.out["submersion"]["withSinkOffset"], -0.56375,
                               places=9)

    def test_a_ship_never_reaches_its_float_min_lift(self):
        """Every vanilla ship authors `floatMinLift == floatMaxLift` because at
        any draft over a metre with no trim angle `t` saturates at 1."""
        self.assertAlmostEqual(self.out["lift"]["fletcher"], 2.0, places=12)

    def test_t_comes_from_the_unclamped_f(self):
        """A Gato at 40 m is far past `f = -1`, yet `t` is still 1 because it is
        formed before the clamp -- `0x0824d718` is `fst`. Were `t` taken from
        the clamped `f` the lift would sit at the `depth = 1 m` value for ever
        and the boat could not have a stable dive depth."""
        self.assertAlmostEqual(self.out["lift"]["gatoDeepNoTrim"], 1.6275, places=12)

    def test_the_lift_pair_is_half_way_at_half_a_metre_and_at_the_setpoint(self):
        mid = (0.8275 + 1.6275) / 2
        self.assertAlmostEqual(self.out["lift"]["gatoHalfMetre"], mid, places=12)
        self.assertAlmostEqual(self.out["lift"]["gatoDiveSetpoint"], mid, places=12)

    def test_one_fletcher_node_at_its_draft_carries_an_eighth_of_gravity(self):
        """`(g * 0.61375 * 2) / -9.82`, and eight of them make 14.73."""
        one = self.out["acceleration"]["fletcherAtDraft"]
        self.assertAlmostEqual(one, (GRAVITY * 0.61375 * 2) / -9.82, places=9)
        self.assertAlmostEqual(8 * one, 14.73, places=6)

    def test_a_node_above_its_reference_plane_makes_no_force_and_no_damping(self):
        """`if (!(f < 0)) return` comes before the damping term, so a hull held
        clear of the water has no vertical drag either."""
        self.assertEqual(self.out["acceleration"]["aboveReference"], 0)

    def test_the_damping_coefficient_reverses_sign_inside_h_over_24(self):
        """`1 + 24f`: at `f = -0.5` the coefficient is -11 and the term damps;
        at `f = -0.01` it is +0.76 and the term feeds heave. Both are
        `drag * coeff * 100 * DX*DZ / mass` per unit of `vy`."""
        area = 2507
        deep = 3 * (1 + 24 * -0.5) * 100 * area / 2500000
        sliver = 3 * (1 + 24 * -0.01) * 100 * area / 2500000
        self.assertAlmostEqual(self.out["acceleration"]["dampingDeep"], deep, places=9)
        self.assertAlmostEqual(self.out["acceleration"]["dampingSliver"], sliver,
                               places=9)
        self.assertLess(deep, 0)
        self.assertGreater(sliver, 0)

    # -- (b) the closed-form equilibrium ------------------------------------

    def test_every_vanilla_capital_ship_lands_on_its_closed_form_draft(self):
        for name, (n, rel_y, hull, _min_lift, max_lift) in FLEET.items():
            with self.subTest(ship=name):
                self.assertAlmostEqual(self.out["equilibrium"][name],
                                       closed_form(n, rel_y, hull, max_lift),
                                       places=6)

    def test_the_equilibrium_is_the_laws_own_fixed_point(self):
        """Not just the algebra: at the solved `y`, the eight nodes' own
        accelerations plus gravity sum to zero."""
        for name in FLEET:
            with self.subTest(ship=name):
                self.assertAlmostEqual(self.out["support"][name]["support"],
                                       EQUILIBRIUM_SUM, places=9)
                self.assertAlmostEqual(self.out["support"][name]["netWithGravity"],
                                       0.0, places=6)

    def test_a_submarine_settles_at_its_trim_angle_plus_half_a_metre(self):
        """VERDICT §2.1, reversing the research's "sinks without limit": once
        the hull is fully submerged the root is `depth = angle_Y + 0.5`, stable,
        independent of `hullHeight`."""
        for angle_y in ("5", "10", "20", "50"):
            with self.subTest(angle=angle_y):
                self.assertAlmostEqual(self.out["dive"][angle_y]["depth"],
                                       float(angle_y) + 0.5, places=4)
        # With no trim at all it is the surfaced draft, 9.82/(8*1.6275) * 3.3.
        self.assertAlmostEqual(self.out["dive"]["0"]["depth"],
                               EQUILIBRIUM_SUM / (8 * 1.6275) * 3.3, places=6)

    def test_a_hull_that_cannot_carry_itself_has_no_equilibrium(self):
        """Fully submerged the support saturates at `sum floatMaxLift`; under
        9.82 there is no depth that floats. One node at lift 1 is 1."""
        self.assertIsNone(self.out["cannotFloat"])

    # -- (c) why the closed form and not an iterative settle ----------------

    def test_three_hundred_ticks_leaves_a_destroyer_high(self):
        """VERDICT §2.2. The system is overdamped by about 15, so it settles
        slowly: a Fletcher's slow pole is about 0.036 per second. The existing
        `SETTLE_TICKS = 300` is ten seconds and leaves it more than 0.1 m above
        its draft, which is why the viewer places from the closed form instead.
        """
        target = closed_form(*FLEET["Fletcher"][:3], FLEET["Fletcher"][4])
        fletcher = self.out["settle"]["fletcher"]
        self.assertGreater(fletcher["y"] - target, 0.10)
        self.assertLess(fletcher["y"] - target, 0.20)
        # It does get there, given about eighty times as long.
        self.assertLess(abs(self.out["settle"]["fletcherLong"]["y"] - target), 0.01)

    def test_the_settle_never_overshoots(self):
        """Overdamped means monotone: no vanilla ship oscillates, so a viewer
        seeing a bobbing hull has the `1 + 24f` sign or the `DX*DZ` area
        wrong."""
        for ship in ("fletcher", "hatsuzuki"):
            with self.subTest(ship=ship):
                self.assertLessEqual(self.out["settle"][ship]["vy"], 1e-6)

    # -- (d) the sink rate ---------------------------------------------------

    def test_the_sink_rate_spread_across_a_hull_is_about_two_to_one(self):
        """VERDICT §2.4: `q = clamp((2R + dz + dx)/(4R), 0, 1)` with R about 70 m
        and nodes at dz = +-50, dx = +-5 spans 0.30..0.70, so the rate spread is
        about 2:1 -- the ship goes down by one end, but not 11 times faster at
        one end."""
        sink = self.out["sink"]
        bow_q = (140 + 50 + 5) / 280
        stern_q = (140 - 50 - 5) / 280
        self.assertAlmostEqual(sink["bow"], (bow_q + 0.1) * 0.05, places=12)
        self.assertAlmostEqual(sink["stern"], (stern_q + 0.1) * 0.05, places=12)
        self.assertAlmostEqual(sink["bow"] / sink["stern"], 1.9735, places=3)
        self.assertAlmostEqual(sink["centre"], 0.03, places=12)

    def test_sinking_speed_mod_zero_never_sinks_and_seven_sinks_fast(self):
        self.assertEqual(self.out["sink"]["raft"], 0)
        self.assertAlmostEqual(self.out["sink"]["lcvpFast"], 0.6 * 0.05 * 7, places=12)

    # -- (e) reading float nodes off a node tree ----------------------------

    def test_float_nodes_are_found_at_any_depth_of_the_tree(self):
        """A float node carries no collision mesh, so `describeVehicleParts`
        never sees one; they are read straight off the tree, and their offsets
        come from the live world matrices so a rotated hull still measures in
        world metres."""
        nodes = self.out["floatNodes"]
        self.assertEqual(len(nodes), 2)
        self.assertEqual([n["name"] for n in nodes],
                         ["Fletcher_Floater", "Fletcher_Floater"])
        self.assertEqual([round(n["offsetY"], 6) for n in nodes], [7.5, 7.5])
        self.assertEqual([round(n["offsetX"], 6) for n in nodes], [-2.0, 2.0])
        self.assertEqual([round(n["offsetZ"], 6) for n in nodes], [50.0, -50.0])
        self.assertEqual(nodes[0]["hullHeight"], 20)
        self.assertEqual(nodes[0]["sinkingSpeedMod"], 1)

    def test_a_vehicle_with_no_floaters_yields_none(self):
        self.assertEqual(self.out["floatNodesEmpty"], 0)


if __name__ == "__main__":
    unittest.main()
