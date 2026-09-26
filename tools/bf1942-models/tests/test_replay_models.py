"""`viewer/replay.js` and its modules under node: the replayed-aircraft
propeller law, the recording's players, kits, seats and deaths, and the
kinematics a replayed hull is presented from.

One node run (`replay_harness.mjs`), many assertions. The harness imports the
viewer's modules in place through `sim/env.mjs`'s hooks, so the files under
test are the files the page loads.

Why the propeller half exists. A 2026-09-20 defect report read "the planes are
not showing the correct propeller: it's showing both the spinning + idle" --
both of a prop plane's meshes drawn at once, in a round replay, which clones
whole `models/<Template>.glb` files that ship both alternatives visible. The
2026-09-27 rework presents a replayed aircraft through the map's own
`Aircraft` (`presentKinematic`), so the swap is now the flight model's own and
the propeller turns; the idle default still holds until the drive's first
frame.

Why the recording half exists. The 2026-09-27 report: "I spawned as assault,
but the recorder shows me with a zook". The parser gave every soldier the last
kit anyone picked up; each soldier now keeps his own player's kit.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
VIEWER = ROOT / "viewer"
HARNESS = Path(__file__).resolve().parent / "replay_harness.mjs"


def run_harness() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    proc = subprocess.run(["node", str(HARNESS)], capture_output=True, text=True, timeout=900)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


class ReplayPropellerTests(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()

    def test_a_replayed_propeller_shows_the_idle_blade_never_the_disc(self) -> None:
        # The level's own parked law (map.html's load walk): blade visible,
        # blurred disc hidden. A replay has no throttle to swap on, so the
        # clone gets exactly the state a parked spawner shows.
        state = self.results["corsair"]
        self.assertTrue(state["blade"], "the idle blade must stay visible")
        self.assertFalse(state["disc"], "the blurred disc must be hidden")

    def test_the_bf109_cockpit_named_like_a_propeller_stays_whole(self) -> None:
        # Vanilla's one counter-example to the naming convention: the bf109's
        # *cockpit* LodObject under a DistCompareSelector, with both halves in
        # an already-published tree. Its "blurred" half is the pilot's 1P
        # interior; hiding it strips the cockpit out of every replay.
        state = self.results["bf109CockpitBothHalves"]
        self.assertTrue(state["exterior"], "the fuselage must stay visible")
        self.assertTrue(state["interior"], "the 1P interior must stay visible")

    def test_a_fresh_tree_cockpit_stamp_without_its_interior_is_a_noop(self) -> None:
        # The current exporter excludes the 1P interior, so the stamp names a
        # child that is not there. Walk it without throwing; the fuselage
        # stands.
        state = self.results["bf109CockpitFreshTree"]
        self.assertTrue(state["exterior"])
        self.assertTrue(state["interiorMissing"])

    def test_a_wrapper_without_a_stamp_is_untouched(self) -> None:
        # The kind gate, pointed the other way: nothing names this LodObject a
        # propeller, so nothing may hide either half of it.
        state = self.results["unstampedPair"]
        self.assertTrue(state["blade"])
        self.assertTrue(state["disc"])

    def test_every_stamped_wrapper_on_a_multiengine_airframe_is_walked(self) -> None:
        # The B17 ships four propellers; the walk covers each wrapper, not
        # just the first the traverse meets.
        for engine, state in enumerate(self.results["b17AllFour"]):
            self.assertTrue(state["blade"], f"engine {engine}: blade visible")
            self.assertFalse(state["disc"], f"engine {engine}: disc hidden")

    def test_the_model_loader_actually_applies_the_walk(self) -> None:
        # The harness proves the law; this pins the call site, so the loader
        # cannot silently stop calling it. (The loader path itself needs a
        # browser — `model()` fetches a glb — so the source is the contract.)
        source = (VIEWER / "replay-assets.js").read_text()
        self.assertIn("setReplayPropellerIdle(gltf.scene)", source)


    def test_a_replayed_aircraft_runs_the_flown_propeller_law(self) -> None:
        # Parked with nobody aboard: the idle blade, gear down. Under power
        # 300 m up: the disc past the 0.07 swap, the propeller turned, the gear
        # away -- the flight model's own presentation of a recorded pose.
        flown = self.results["flownPropeller"]
        self.assertEqual(flown["parked"], {"blade": True, "disc": False, "gear": 0})
        self.assertFalse(flown["flying"]["blade"])
        self.assertTrue(flown["flying"]["disc"])
        self.assertEqual(flown["flying"]["gear"], 1)
        self.assertGreater(flown["flying"]["throttle"], 0.07)
        self.assertGreater(flown["flying"]["turned"], 0)
        self.assertTrue(flown["flying"]["wrapperTurned"])
        self.assertEqual(flown["placed"], {"x": 0, "y": 300})


class ReplayRecordingTests(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()

    def test_each_soldier_keeps_his_own_kit(self) -> None:
        # The report: spawned as assault, drawn with a bazooka. The recording
        # player picked up UsMarine_Assault; a bot carried UsMarine_AT from the
        # join. Each keeps his own.
        rec = self.results["recording"]
        self.assertEqual(rec["mine"], {"pid": 0, "kit": "UsMarine_Assault", "weapon": "Bar1918"})
        self.assertEqual(rec["bot"]["kit"], "UsMarine_AT")
        self.assertEqual(rec["bot"]["weapon"], "Bazooka")
        self.assertEqual(rec["fallback"], {"mine": "Bar1918", "bot": "Bazooka"})
        self.assertEqual(rec["fire"], [{"t": 8, "soldier": True, "kit": "UsMarine_Assault"}])

    def test_a_seat_id_resolves_to_its_hull(self) -> None:
        # A hull's nested PlayerControlObjects take the ids after its own: the
        # Sherman at 532 has its hull gun at 533.
        rec = self.results["recording"]
        self.assertEqual(rec["seat"], {"root": "Sherman", "seat": 1})
        self.assertEqual(rec["crewAt7"], [{"pid": 250, "seat": 1}])
        self.assertEqual(rec["crewAt10"], [])

    def test_a_death_is_the_score_streams(self) -> None:
        rec = self.results["recording"]
        self.assertEqual(rec["bot"]["diedAt"], 12)
        self.assertEqual(rec["bot"]["killer"], 0)
        self.assertEqual(rec["controlledAt13"], 700)

    def test_round_end_tallies_decode_from_raw(self) -> None:
        self.assertEqual(self.results["recording"]["stats"], [{"pid": 0, "fired": [[1231, 31]]}])

    def test_v4_records(self) -> None:
        v4 = self.results["v4"]
        self.assertEqual(v4["seat"], {"root": "Sherman", "seat": 1})
        self.assertEqual(v4["crew"], [{"pid": 251, "seat": 1}])
        self.assertEqual(v4["pooled"], ["GrenadeAlliesProjectile#1075", "GrenadeAlliesProjectile#1076",
                                        "GrenadeAlliesProjectile#1077"])
        self.assertAlmostEqual(v4["clock"], 289.5)
        self.assertEqual(v4["stats"], [{"tid": 1941, "tmpl": "AichiVal", "n": 3}])
        self.assertEqual(v4["shot"], [{"nid": 532, "weapon": "ShermanCannon", "kind": 1}])
        # The engine: the PhysicsEngine's revs, running and not.
        self.assertEqual(v4["engine"][0], {"revs": 0.8, "running": True, "disabled": False})
        self.assertEqual(v4["engine"][1], {"revs": 0.1, "running": False, "disabled": False})
        # A turret's rotation against its hull, by the part's template name.
        self.assertEqual(v4["joint"], {"name": "ShermanTower", "q": [0, 0.7071, 0, 0.7071]})
        # A soldier's body through the engine's own state table: crouched
        # and firing, then lying and holding his fourth item.
        crouched, lying = v4["body"]
        self.assertEqual((crouched["stance"], crouched["firing"], crouched["item"]), ("crouch", True, 2))
        self.assertEqual(crouched["pitch"], -12.5)
        self.assertEqual((lying["stance"], lying["firing"], lying["item"]), ("prone", False, 3))


class ReplayKinematicsTests(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()["kinematics"]

    def test_motion_is_read_in_the_viewers_frame(self) -> None:
        # 10 m/s along BF1942's +Z is the viewer's -Z; a left turn is +Y.
        self.assertEqual(self.results["velocity"], [0, 0, -10])
        self.assertAlmostEqual(self.results["yawRate"], 0.5, places=3)
        self.assertGreater(self.results["forward"], 0)

    def test_the_stick_follows_the_games_signs(self) -> None:
        # c_PIPitch positive is nose DOWN, c_PIYaw positive is right,
        # c_PIRoll positive is right wing down (controls-rows.js).
        self.assertEqual(self.results["stickNoseUp"], {"pitch": -0.5, "roll": 0, "yaw": 0})
        self.assertEqual(self.results["stickLeft"], {"pitch": 0, "roll": 0, "yaw": -0.5})
        self.assertEqual(self.results["stickRightWingDown"], {"pitch": 0, "roll": 0.5, "yaw": 0})
        self.assertLess(self.results["steerLeft"], 0)

    def test_the_gearbox_shifts_on_the_engines_own_thresholds(self) -> None:
        gears = [row["gear"] for row in self.results["revs"]]
        self.assertEqual(gears, sorted(gears[:4]) + gears[4:])
        self.assertEqual(gears[0], 1)
        self.assertEqual(gears[3], 4)
        self.assertEqual(gears[-1], 1)
        for row in self.results["revs"]:
            self.assertLessEqual(row["revs"], 1.2)

    def test_the_throttle_is_shut_without_a_crew(self) -> None:
        self.assertEqual(self.results["throttleEmpty"], 0)
        self.assertEqual(self.results["throttleParked"], 0)
        self.assertGreater(self.results["throttleFlying"], 0.5)


if __name__ == "__main__":
    unittest.main()
