"""The headless runner's vehicle path (`sim/stage.mjs`) on real levels.

Each recipe (`tests/sim_vehicles_harness.mjs`) loads a level the way the page
does and seats a bot with the page's own law: a tank's real drive in the body
world, its shell killing a frozen soldier, a fixed gun firing, a Spitfire
leaving the ground, a landing craft on the water map, a parked hull that stops
a ray on its pad and not after it has been driven off.

The extracted maps tree is untracked, so the test looks for it in
`$BF42_VIEWER_ASSETS`, then this checkout's `viewer/`, then the main
checkout's (a worktree's git common dir), and skips when there is none.
"""

from __future__ import annotations

import json
import math
import os
import shutil
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
HARNESS = ROOT / "tests" / "sim_vehicles_harness.mjs"


def find_assets() -> Path | None:
    candidates: list[Path] = []
    if os.environ.get("BF42_VIEWER_ASSETS"):
        candidates.append(Path(os.environ["BF42_VIEWER_ASSETS"]))
    candidates.append(ROOT / "viewer")
    try:
        common = subprocess.run(["git", "rev-parse", "--path-format=absolute", "--git-common-dir"], cwd=ROOT,
                                capture_output=True, text=True, timeout=10).stdout.strip()
        if common:
            candidates.append(Path(common).parent / "tools" / "bf1942-models" / "viewer")
    except (OSError, subprocess.SubprocessError):
        pass
    for c in candidates:
        if (c / "maps" / "el_alamein" / "scene.glb").exists() and (c / "maps" / "_shared" / "vehicle-ai.json").exists():
            return c
    return None


ASSETS = find_assets()


def recipe(name: str) -> dict:
    proc = subprocess.run(["node", str(HARNESS), str(ASSETS), name], capture_output=True, text=True, timeout=300)
    if proc.returncode != 0:
        raise AssertionError(f"recipe {name} failed:\n{proc.stderr}")
    return json.loads(proc.stdout.strip().splitlines()[-1])


@unittest.skipIf(shutil.which("node") is None, "node is not installed")
@unittest.skipIf(ASSETS is None, "no extracted viewer/maps tree (set BF42_VIEWER_ASSETS)")
class SimVehicleTests(unittest.TestCase):
    def test_a_bot_drives_a_tank_on_its_real_drive(self) -> None:
        r = recipe("drive")
        self.assertEqual(r["driveClass"], "TrackedVehicle")
        self.assertTrue(r["adopted"], "the drive is adopted into the body world")
        self.assertGreater(r["parkedBodies"], 10, "the level's parked hulls are bodies")
        self.assertGreater(r["moved"], 20.0)
        self.assertLess(r["nodeOff"], 1e-6, "the hull's node is where its drive is")
        self.assertTrue(r["stillMounted"])
        self.assertEqual(recipe("drive")["trail"], r["trail"], "the same seed drives the same path")

    def test_a_tank_shell_kills_a_soldier_through_the_page_hit_path(self) -> None:
        r = recipe("gun")
        self.assertTrue(r["killed"], r)
        self.assertEqual(r["kill"]["killer"], "bot_1")
        # The cannon's shell (a direct round or its splash) or the coaxial
        # Browning's round cast against his body: either is the page's path.
        self.assertRegex(r["kill"]["weapon"], r"^(round|splash) (ShermanGunBarrel|Coaxial_browning)")
        self.assertGreaterEqual(r["rounds"], 1)
        self.assertTrue(any(f.startswith("Sherman:") for f in r["fired"]))

    def test_deck_planes_take_off_and_the_carriers_stay_put(self) -> None:
        # Brief Q, Midway seed 1: the Corsair and the Zero are vehicles of their
        # own, held on their pads until the throttle reaches 0.1
        # (`ObjectSpawner::handleFrameUpdate` 0x083138c0), and fly off their
        # decks without moving the carrier; the SBD left parked rides the
        # Enterprise 200 m on its pad.
        r = recipe("deckAir")
        self.assertEqual({(h["plane"], h["ship"]) for h in r["held"]},
                         {("Corsair", "Enterprise"), ("SBD", "Enterprise"), ("Zero", "Shokaku"), ("AichiVal", "Shokaku")})
        for name in ("Corsair", "Zero"):
            p = r["planes"][name]
            self.assertIsNotNone(p["releasedAt"], name)
            self.assertEqual(p["padDriftHeld"], 0, name)
            self.assertIsNotNone(p["leftDeckAt"], name)
            self.assertGreater(p["top"], 30.0, name)
            self.assertEqual(p["shipMoved"], 0, name)
        e = r["enterprise"]
        self.assertGreater(e["moved"], 200.0)
        self.assertTrue(e["sbdHeld"])
        self.assertLess(e["sbdOffPad"], 0.5)
        self.assertLess(abs(e["sbdAboveDeck"] - 1.5), 1.0)

    def test_a_spitfire_takes_off_on_the_page_flight_model(self) -> None:
        r = recipe("air")
        self.assertEqual(r["driveClass"], "Aircraft")
        self.assertTrue(r["takeoff"], "a takeoff event")
        self.assertGreater(r["topAgl"], 20.0)
        self.assertTrue(r["stillMounted"])

    def test_a_landing_craft_sails_on_the_water_map(self) -> None:
        if not (ASSETS / "maps" / "wake" / "scene.glb").exists():
            self.skipTest("wake is not extracted")
        r = recipe("ship")
        self.assertEqual(r["template"], "Daihatsu")
        self.assertEqual(r["driveClass"], "Ship")
        self.assertTrue(r["landingCraft"])
        self.assertTrue(r["navWater"])
        self.assertGreater(r["moved"], 50.0)
        self.assertEqual(r["routeFailures"], 0)
        low, high = r["y"]
        self.assertLess(abs(low - r["waterLevel"]), 3.0, "afloat")
        self.assertLess(abs(high - r["waterLevel"]), 3.0, "afloat")

    def test_a_fixed_gun_fires_and_its_rounds_land(self) -> None:
        r = recipe("fixedGun")
        self.assertEqual(r["kind"], "gun")
        self.assertFalse(r["drive"], "a fixed gun is a seat with no drive")
        self.assertEqual(r["seat"], "AA_Allies")
        self.assertGreater(r["rounds"], 5)
        self.assertEqual(r["fired"], ["gun:AA_Allies:AA_Allies_GunBarrel_1"])
        self.assertGreater(sum(r["landed"].values()), 5, "the rounds fly and land")

    def test_a_fixed_gun_holds_fire_on_what_it_has_not_spotted(self) -> None:
        # Brief R item 2 (ledger AI-124): a Fixed unit's Fire is
        # `BBFireInfantery`, which scores only the spotted list; the old
        # large-bore rule fired on an unseen soldier through
        # `getEnemyObjects`. Behind the pit's lip he is never spotted.
        r = recipe("fixedGunHidden")
        self.assertFalse(r["spotted"])
        self.assertEqual(r["rounds"], 0)

    def test_a_bot_takes_a_free_aa_gun_by_itself(self) -> None:
        # Brief K item 1: the gun's value is its `basicTemp` (9), not its
        # strategic strength (0), and its reach test is the engine's (a trace
        # 12 m behind it), not its seat's own cell.
        r = recipe("takeAA")
        self.assertEqual(r["value"], 9)
        self.assertTrue(r["noPathfinding"])
        self.assertIsNotNone(r["spottedAt"], "the plane is known")
        self.assertEqual(r["best"]["template"], "AA_Allies")
        self.assertIsNotNone(r["took"], r)
        self.assertEqual(r["took"]["template"], "AA_Allies")
        self.assertLess(r["took"]["t"], 15.0)

    def test_two_planes_head_on_turn_away(self) -> None:
        # Brief K item 2: `BBAvoid` predicts the collision 5 s out and
        # `BBPAvoidCollision3d` turns each 45 deg away; without it the same
        # pair passes within 7 m.
        r = recipe("headOn")
        control = recipe("headOnNoAvoid")
        self.assertEqual(control["avoid"], 0)
        self.assertLess(control["closest"], 15.0, "the control is a collision course")
        self.assertGreater(r["avoid"], 0)
        self.assertGreater(r["closest"], 20.0)
        self.assertEqual(r["destroyed"], [])

    def test_the_tank_pair_both_reach_north_outpost(self) -> None:
        # Brief K item 3 (ledger AI-100) sampled this pair with no line at
        # the flag; since then the Sherman had stopped reaching it at all,
        # wedged on the barbed wire round the British base. The viewer
        # stopped a hull on wire, where `Obstacle::handleCollision`
        # 0x08315e10 vetoes the response for anything but a soldier (and
        # the level's Tank0 map paints the wire free). Rolling through it,
        # the Sherman leaves its base and both hulls meet near the outpost
        # the PanzerIV takes.
        r = recipe("tankDuel")
        self.assertGreater(r["samples"], 0, r["end"])
        flag = (874.005, -1815.98)
        allied = r["end"]["allied"]
        self.assertLess(math.hypot(allied[0] - flag[0], allied[2] - flag[1]), 250.0, r["end"])
        self.assertIn("144.67 North_outpost 0->1 bot_0", r["captures"])

    def test_the_tank_pair_close_until_one_can_fire(self) -> None:
        # Brief P item 3 (ledger AI-116) and Brief R (AI-123..AI-125): K's
        # North outpost pair, set down 158.7 m apart where K's run left them.
        # A tank's Fire is `BBFireInfantery` (the spotted list only), so
        # neither is in Fire until it has seen the other: both drive on
        # their order and meet. They see each other from their cameras,
        # rays to points on the hulls (the old soldier-height rays from 2 m
        # over the hull origin never cleared the crest); then S holds
        # (in range, a valid aim, the target not lost) and the trigger,
        # gated on S alone, lets go. Before Brief R the pair closed to 45 m
        # on an unspotted target and held there with no round live.
        r = recipe("tankApproach")
        self.assertGreater(r["behs"]["axis"].get("MoveTo", 0), 0, "no Fire before the other is spotted")
        self.assertGreater(r["behs"]["allied"].get("MoveTo", 0), 0, "no Fire before the other is spotted")
        self.assertGreater(r["moves"]["axis"].get("hold", 0) + r["moves"]["allied"].get("hold", 0), 0)
        self.assertLess(r["closest"], 60.0)
        self.assertGreater(r["rounds"]["axis"] + r["rounds"]["allied"], 0)
        self.assertIsNotNone(r["firstRound"])

    def test_a_parked_hull_is_an_obstacle_until_it_is_driven_off(self) -> None:
        r = recipe("obstacle")
        self.assertTrue(r["parked"], "a parked body")
        self.assertTrue(r["bodyOwner"], "the nav map and the sweeps treat it as a body")
        self.assertEqual(r["before"]["owner"], r["owner"], "a ray onto the pad stops on the hull")
        self.assertGreater(r["moved"], 20.0)
        self.assertNotEqual(r["atPad"] and r["atPad"]["owner"], r["owner"], "the pad is clear once it is gone")
        self.assertEqual(r["atHull"]["owner"], r["owner"], "the hull answers where it stands")

    def test_a_landing_craft_lands_holding_its_ramp_and_nobody_climbs_back(self) -> None:
        # Brief N items 1 and 3 on Wake: the SAI's beach order to
        # WesternMainBaseExit's CentreLanding, a helm and a rider aboard.
        r = recipe("beach")
        # Its own zone, as `WPBeachLanding` (no route) or, from the craft's
        # area over the engine's route, `WPMoveToBeachLanding` (AI-113).
        self.assertIn(r["order"]["kind"], ("WPBeachLanding", "WPMoveToBeachLanding"))
        self.assertEqual(r["order"]["zone"], "CentreLanding")
        self.assertIsNotNone(r["beachLegAt"], "the craft enters its zone and takes the beach leg")
        # `BAPATriggerContinously(PIPitch)` on the beach leg: 1.0 in the
        # channel, carried into the word the world consumes.
        self.assertEqual(r["pitchHeld"], 1.0)
        self.assertEqual(r["pitchSeen"], 1.0)
        # Both out, in the zone and aground (`BBChangeLandingCraft` 0x085602b0).
        b = r["bail"]
        self.assertIsNotNone(b, "the crew gets out")
        self.assertTrue(b["inZone"])
        self.assertTrue(b["touchingLand"])
        self.assertLess(b["t"], 150.0)
        # The beached craft is off its water map, so `BBChange` offers it to
        # nobody (0x0855ee25 -> 0x0855f0f0): no bot climbs back in for 30 s
        # (the loop was one boarding every ~8 s after the 15 s ramp).
        self.assertFalse(r["after"]["onOwnMap"])
        self.assertEqual(r["remounts"], [])


if __name__ == "__main__":
    unittest.main()
