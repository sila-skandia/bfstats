"""A plane shot down in the air glides; it does not drop.

The owner's report, from playing: "In our implementation planes will drop
almost straight down once shot. In retail they basically glide in the path
they were heading."

Retail's rule, read on the server binary. The Armor's destruction is
TemplateMessage 0x15, and each node's answer to it is all there is:

* `PlayerControlObject::handlePlayerInput` (lnxded `0x08318920`) forwards no
  input once the destroyed byte is set (HP-15), so the stick stays where the
  kill found it;
* `Engine::handleMessage` (`0x0823e730`) stops the engine (PHY-14);
* `Wing::handleMessage` (`0x08250bf0`) writes the destroyed byte at
  `0x08250d5a` and nothing else: the lift pair is left alone, and neither
  `Wing::handleUpdate` (`0x08250950`) nor `PhysicsWing::updatePhysics`
  (`0x0824ed10`) reads the byte;
* the physics passes ask no destroyed flag (HP-24).

So the wreck is the same airframe on the same law with its engine dead, and
`plane_wreck_harness.mjs` holds the wreck pass (`world-vehicle-tick.js`
`stepFallingWrecks`) to exactly that: the page's Spitfire killed in level
flight, a climb, a dive and a turn, against the same Spitfire flown dead-stick
on `viewer/aircraft.js` with no wreck pass at all.

The neighbouring case is critical hit points. Message 0x14 scales every
Wing's lift by where it sits across the hull (`Wing::handleMessage`
`0x08250d70`..`0x08250ee0`), which is what rolls a burning plane over, and the
wreck keeps that scale.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from test_dogfight_school import MODULES  # noqa: E402
from test_flight import THREE_PACKAGE  # noqa: E402

HARNESS = Path(__file__).resolve().parent / "plane_wreck_harness.mjs"
CASES = ("level", "climb", "dive", "turn")


def run_harness() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        for name, source in MODULES.items():
            target = work / name
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source, target)
        (work / "node_modules" / "three" / "package.json").write_text(THREE_PACKAGE)
        (work / "package.json").write_text('{"type":"module"}\n')
        shutil.copyfile(HARNESS, work / "harness.mjs")
        proc = subprocess.run(["node", str(work / "harness.mjs")],
                              capture_output=True, text=True, timeout=300, env={**os.environ})
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


class PlaneWreckTests(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()

    def test_a_wreck_flies_the_live_planes_own_law(self) -> None:
        """The wreck pass adds nothing and takes nothing away: tick for tick
        the wreck is where the same airframe is with its engine stopped and
        nobody on the stick."""
        for case in CASES:
            wreck, dead = self.results["wreck"][case], self.results["deadStick"][case]
            with self.subTest(case=case):
                self.assertEqual(wreck["trace"], dead["trace"])
                self.assertEqual(wreck["seconds"], dead["seconds"])
                self.assertEqual(wreck["distance"], dead["distance"])

    def test_a_wreck_from_level_flight_glides(self) -> None:
        """Killed at 70 m/s and 200 m, the Spitfire covers several times its
        height before it is down, on a path under 25 degrees. The fall this
        replaces came down at 55 degrees, 138 m away in 4.3 s."""
        r = self.results["wreck"]["level"]
        self.assertTrue(r["down"], r)
        self.assertGreater(r["distance"], 3 * r["sink"], f"a glide covers ground: {r}")
        self.assertLess(r["glideAngle"], 25.0, f"it glides, it does not drop: {r}")
        self.assertGreater(r["seconds"], 12.0, r)
        # The airframe's own numbers on the law (measured 699.9 m in 20.3 s):
        # a change that moves them moved the flight model, not the wreck.
        self.assertAlmostEqual(r["distance"], 700.0, delta=40.0)
        self.assertAlmostEqual(r["seconds"], 20.3, delta=1.5)

    def test_the_time_to_live_finds_the_wreck_still_in_the_air(self) -> None:
        """A destroyed object lasts its `timeToLiveAfterDeath`, 10 s on every
        vanilla aircraft, from the kill (HP-19). From 200 m that finds the
        wreck some 350 m on and still well up, which is where
        `vehicle-wrecks.js` fades and removes it."""
        at = self.results["wreck"]["level"]["at10"]
        self.assertIsNotNone(at)
        self.assertGreater(at["distance"], 250.0, at)
        self.assertGreater(at["height"], 100.0, at)

    def test_a_wreck_goes_on_the_way_it_was_heading(self) -> None:
        """A climb carries on up before it comes down, a dive stays a dive and
        a turn is still a turn: none of them is pulled onto one forced sink."""
        climb, dive = self.results["wreck"]["climb"], self.results["wreck"]["dive"]
        self.assertGreater(climb["climbed"], 30.0, f"killed climbing, it zooms first: {climb}")
        self.assertEqual(dive["climbed"], 0, dive)
        for case in CASES:
            with self.subTest(case=case):
                r = self.results["wreck"][case]
                self.assertTrue(r["down"], r)
                self.assertGreater(r["distance"], 300.0, r)
                self.assertGreater(r["minSpeed"], 10.0, f"it keeps flying speed: {r}")

    def test_the_wreck_pass_leaves_the_stick_and_stops_the_engine(self) -> None:
        c = self.results["controls"]
        self.assertEqual(c["pitch"], -0.6, "the stick is where the kill found it (HP-15)")
        self.assertEqual(c["roll"], 0.4)
        self.assertEqual(c["fire"], 0, "the trigger is let go: 0x15 takes the weapon component off")
        self.assertFalse(c["engineRunning"], "0x15 stops every Engine (PHY-14)")
        self.assertTrue(c["lift"], "and no Wing loses its lift")

    def test_critical_damage_scales_each_wings_lift_across_the_hull(self) -> None:
        """`Wing::handleMessage` 0x14: `f = clamp((wing.x - root.x + R) / 2R,
        0.1, 1)`, mirrored to `1 - f` when the last hit place's x is negative.
        The harness Spitfire's composite radius is 9.319 m, so its ailerons at
        -3.814 and +3.815 m keep 0.295 and 0.705 of their lift."""
        c = self.results["critical"]
        self.assertTrue(c["built"])
        radius = c["radius"]
        self.assertAlmostEqual(radius, 9.319, places=2)
        for name, x in c["attach"].items():
            want = min(1.0, max(0.1, (x + radius) / (2 * radius)))
            with self.subTest(wing=name):
                self.assertAlmostEqual(c["factors"][name], want, places=3)
                self.assertAlmostEqual(c["mirrored"][name], 1 - want, places=3)
        self.assertAlmostEqual(c["factors"]["SpitfireRudderFrontLeft"], 0.295, places=3)
        self.assertAlmostEqual(c["factors"]["SpitfireRudderFrontRight"], 0.705, places=3)
        self.assertEqual(c["factors"]["SpitfireBodyWingVertical"], 0.5)
        self.assertTrue(c["restored"], "the recovery (0x13) puts the template's pair back")

    def test_the_critical_scale_reads_the_worlds_x(self) -> None:
        """The engine subtracts absolute positions and reads their x: a hull
        flying along the world's x has its two ailerons at one x, so they keep
        the same share and nothing rolls it."""
        q = self.results["critical"]["quarter"]
        self.assertEqual(q["SpitfireRudderFrontLeft"], q["SpitfireRudderFrontRight"])
        self.assertEqual(q["SpitfireAirbreakLeft"], q["SpitfireAirbreakRight"])

    def test_a_critical_plane_comes_down_steeper_than_a_clean_wreck(self) -> None:
        """Half its lift gone and one wing lighter than the other, hands off:
        it rolls and comes down in half the distance of the clean glide."""
        run, clean = self.results["critical"]["run"], self.results["wreck"]["level"]
        self.assertTrue(run["down"], run)
        self.assertLess(run["distance"], 0.7 * clean["distance"], run)
        self.assertGreater(run["glideAngle"], clean["glideAngle"] + 8.0, run)

    def test_the_crossing_into_critical_keeps_the_hit_that_made_it(self) -> None:
        """`GameServer::_giveDamage` writes the hit point less the root's
        position before every damage (`0x0814b996`), and the Wings read its x
        when the Armor's 0x14 reaches them, so the hit that crosses the
        threshold is the one that picks the side."""
        h = self.results["hitPlace"]
        self.assertEqual(h["safe"], {"flagged": False, "place": -4, "critical": 0})
        self.assertEqual(h["crossed"], {"flagged": True, "place": 3, "critical": 3})
        self.assertEqual(h["later"], {"place": -5, "critical": 3})
        self.assertEqual(h["afterReset"], {"place": 0, "critical": 0})

    def test_the_wings_follow_the_armors_critical_byte(self) -> None:
        sync = self.results["hitPlace"]["sync"]
        self.assertEqual(sync["before"], 1)
        self.assertAlmostEqual(sync["mirrored"], 0.705, places=3)
        self.assertEqual(sync["dead"], sync["mirrored"], "0x15 leaves the pair as 0x14 set it")
        self.assertEqual(sync["repaired"], 1, "0x13 puts the template's pair back")

    def test_a_wreck_keeps_the_lift_it_died_with(self) -> None:
        """0x15 writes the destroyed byte on a Wing and nothing else, so a
        hull that was critical when it died keeps the scaled pair."""
        self.assertTrue(self.results["criticalWreckKeepsLift"])


if __name__ == "__main__":
    unittest.main()
