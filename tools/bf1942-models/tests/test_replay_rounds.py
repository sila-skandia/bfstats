"""What a round replay's rounds leave behind: no stranded smoke trails, and no
grenade, mine or pack but the recording's own.

The owner's report on `replay_20260928-133433` (Bocage, 2026-09-29):

* "heaps of these phantom smoke trails left by tanks and bazooka shots" (two
  at the Axis bridge base by the barn at 3:04). Every replay seek clears the
  page's rounds, and `GunFire.clear` walked the list to stop each round's
  trail only after emptying it, so a rocket's `e_rocketFume` or a tank
  shell's `e_PanzShootTrail`, looping emitters with no life of their own,
  smoked on where the round had been.
* Mines that "linger for longer than they actually existed on the server",
  with an enemy jeep driving over one and nothing happening. The page fired
  every recorded `f` through its own guns, the Landmine's included: beside
  the recorded mine (which went off under the jeep, its ghost ending in the
  tick the jeep died) lay the page's own, for its authored 360 s, where no
  replayed hull could set it off.

The grenades, the pack, the landmine, the floating mine and the binoculars'
marker are the six networked rounds (capture README section 13): the server
flies them and the recording carries each as an object. Those are drawn from
the recording only. And a mine that goes because its kit went is not a
blast: a dead engineer's dropped kit expires 30 s after him and the server
deletes his pool, laid mines included (kit 14434 at 187.46 s, four mines).

Run under node through `replay_rounds_harness.mjs`.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import unittest
from pathlib import Path

HARNESS = Path(__file__).resolve().parent / "replay_rounds_harness.mjs"


def run_harness() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    proc = subprocess.run(["node", str(HARNESS)], capture_output=True, text=True, timeout=300)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


class ReplayRoundsTests(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()

    def test_a_clear_stops_the_trail_of_every_round_in_the_air(self) -> None:
        cleared = self.results["clearStopsTrails"]
        self.assertEqual(cleared["before"], {"inFlight": 1, "trailStopped": False})
        self.assertTrue(cleared["trailAttached"], "the rocket drags its authored trail")
        self.assertEqual(cleared["inFlight"], 0)
        self.assertTrue(cleared["trailStopped"], "the trail must stop with its round")
        self.assertTrue(cleared["wakeStopped"], "and a torpedo's wake with its")
        self.assertFalse(cleared["meshInScene"])

    def test_the_six_networked_rounds_and_a_mods_pool_are_the_recordings(self) -> None:
        networked = self.results["networked"]
        self.assertEqual(networked["six"], [True] * 6)
        self.assertTrue(networked["modPool"], "a round a recorded pool made is the recording's too")
        for key in ("landmine", "grenade", "floatingMine"):
            self.assertTrue(networked[key], key)
        for key in ("tankShell", "bullet", "noSet"):
            self.assertFalse(networked[key], key)

    def test_a_replayed_engineer_lays_no_mine_of_the_pages_own(self) -> None:
        soldier = self.results["soldierRounds"]
        self.assertEqual(soldier["templates"], ["BazookaProjectile"],
                         "the bazooka's round flies; the landmine is the recording's")
        # The defect, measured: the page's own mine would have lain six
        # minutes, the shipped Landmine's fuse.
        self.assertEqual(soldier["unfilteredMineTtl"], 360)

    def test_a_pt_boats_floating_mine_is_the_recordings_and_its_gun_the_pages(self) -> None:
        hull = self.results["hullRounds"]
        self.assertEqual(hull["templates"], ["Elco80GunShell"])
        self.assertTrue(hull["launcherSounding"], "the launcher still sounds as it lays")

    def test_a_recorded_mine_goes_off_only_where_it_went_off(self) -> None:
        ended = self.results["propsEnd"]
        self.assertEqual(ended["blasts"], [{"name": "e_ExplMine", "at": [30, 0, -30]}],
                         "one blast: mine 100, where it went off (view coordinates)")
        self.assertEqual(ended["wentOff"], {
            "detonated": True,
            "outOfRange": False,
            "withKitDestroyFirst": False,
            "withKitGhostFirst": False,
            "noRangeKnown": True,
        })
        # Each is drawn until its ghost ends, not a frame past it.
        self.assertEqual(ended["lastShown"], {"100": 19.95, "101": 39.95, "102": 20.95, "103": 39.95})
        self.assertEqual(ended["recorderAt20"], [[10, 1, 10]])
        self.assertTrue(ended["secondEye"], "any recording player in range sees it go off")


if __name__ == "__main__":
    unittest.main()
