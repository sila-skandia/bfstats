"""The entry rule on Berlin, in the headless runner (`sim/stage.mjs`).

The owner's report: an enemy bot jumped into the T-34 he was driving. In the
game a hull is its crew's side and an empty one nobody's
(`GameServer::toggleEntryPoint`, lnxded 0x0814f13d: the root PCO's team must
be 0 or the player's), and a bot neither weighs nor walks to a hull the enemy
crews (`BBChange::isMannedByEnemy` 0x0855fcb0). Ledger SEAT-26..SEAT-29,
features/vehicle-entry-team-rule/README.md.

`tests/vehicle_team_harness.mjs` loads Berlin the way the page does and runs
the page's own bots and vehicles. The extracted maps tree is untracked, so the
test looks for it in `$BF42_VIEWER_ASSETS`, then this checkout's `viewer/`,
then the main checkout's, and skips when there is none.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
HARNESS = ROOT / "tests" / "vehicle_team_harness.mjs"


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
        if (c / "maps" / "berlin" / "scene.glb").exists() and (c / "maps" / "_shared" / "vehicle-ai.json").exists():
            return c
    return None


ASSETS = find_assets()


def recipe(name: str) -> dict:
    proc = subprocess.run(["node", str(HARNESS), str(ASSETS), name], capture_output=True, text=True, timeout=600)
    if proc.returncode != 0:
        raise AssertionError(f"recipe {name} failed:\n{proc.stderr}")
    return json.loads(proc.stdout.strip().splitlines()[-1])


@unittest.skipIf(shutil.which("node") is None, "node is not installed")
@unittest.skipIf(ASSETS is None, "no extracted viewer/maps/berlin tree (set BF42_VIEWER_ASSETS)")
class VehicleTeamGateTests(unittest.TestCase):
    """An Allied bot drives the T34-85 (two seats); an Axis bot beside it."""

    r: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.r = recipe("gate")

    def test_the_setup(self) -> None:
        self.assertEqual(self.r["teams"], {"driver": 2, "thief": 1})
        self.assertTrue(self.r["driverSeated"])
        self.assertTrue(self.r["t34HolderSeated"])

    def test_the_crewed_hulls_free_seat_carries_its_crews_team(self) -> None:
        mg = self.r["mgCandidate"]
        self.assertEqual((mg["template"], mg["seat"]), ("T34-85", "T34-85MG42_PCO1"))
        self.assertIsNone(mg["occupiedBy"], "the seat itself is free")
        self.assertEqual(mg["hullTeam"], 2)

    def test_the_enemy_told_to_take_it_is_refused(self) -> None:
        self.assertFalse(self.r["directed"])
        self.assertIsNone(self.r["directedSeat"])
        self.assertEqual(len(self.r["hullAfterDirected"]), 1, "only the Allied driver aboard")

    def test_left_to_itself_the_enemy_never_weighs_it(self) -> None:
        natural = self.r["natural"]
        self.assertFalse(any(k.startswith("T34-85:") for k in natural["bests"]), natural)
        if natural["mounted"]:
            self.assertNotEqual(natural["mounted"]["template"], "T34-85")

    def test_the_enemy_steals_an_empty_hull(self) -> None:
        self.assertTrue(self.r["steal"])
        self.assertEqual(self.r["stealSeat"], {"template": "T34", "seat": "T34"})

    def test_a_friend_takes_the_free_seat(self) -> None:
        self.assertTrue(self.r["friend"])
        self.assertEqual(len(self.r["hullWithFriend"]), 2)

    def test_an_emptied_hull_is_nobodys(self) -> None:
        self.assertEqual(self.r["freedHullTeam"], 0)
        self.assertTrue(self.r["thiefTakesFreed"])


@unittest.skipIf(shutil.which("node") is None, "node is not installed")
@unittest.skipIf(ASSETS is None, "no extracted viewer/maps/berlin tree (set BF42_VIEWER_ASSETS)")
class VehicleTeamMatchTests(unittest.TestCase):
    """A 60 s match, 8 a side, seed 3. Before the rule an Allied bot took the
    wheel of a Hanomag an Axis bot was sitting in (t = 53.5 s) and the hull
    held both sides for 196 ticks."""

    def test_no_hull_ever_holds_two_sides(self) -> None:
        r = recipe("match")
        self.assertGreater(r["mounts"], 0)
        self.assertEqual(r["mountsIntoEnemyHull"], [])
        self.assertEqual(r["mixedTicks"], 0)


if __name__ == "__main__":
    unittest.main()
