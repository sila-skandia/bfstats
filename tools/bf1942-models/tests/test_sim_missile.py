"""A bot's guided missile in the headless runner (ledger FA-29).

Secret Weapons' Wasserfall and the mods' guided missiles throw a round that is
a vehicle: `FireArms::fireBarrel` 0x0828aba0 spawns it at the barrel and moves
the firer into it, and `GameServer::exitVehicle` 0x0814e2c0 seats them back in
the launcher when it ends. The page and the room fly a bot's through the same
pieces (`viewer/rocket-ride.js` `botLaunch` and `botRideOut`,
`viewer/round-spawners.js` `standVehicle` over the pool `loadRoundSpawnPool`
parks); the runner (`sim/stage.mjs`, `sim/level.mjs`, `sim/match.mjs`,
`sim/env.mjs`) hands them its own pieces, so a bot there flies it too and no
longer throws the plain shell.

`MissileWiringTests` pins the wiring in the sources and needs nothing else.
`MissileRunTests` runs `tests/sim_missile_harness.mjs` on a tree that holds a
launcher level and its two models: `$BF42_SIM_MISSILE_TREE` names a directory
with `maps/` and `models/` of one mod (`maps/mods/xpack2/peenemunde` and
`models/mods/xpack2/Wasserfall.glb`, `WasserfallRocket.glb`), and the test
skips without it.
"""

# watches: nothing
# (it reads fixed files, and a tree named in the environment: scripts/select_model_tests.py)

from __future__ import annotations

import json
import os
import shutil
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
HARNESS = ROOT / "tests" / "sim_missile_harness.mjs"


def text(*parts: str) -> str:
    return (ROOT.joinpath(*parts)).read_text(encoding="utf-8")


class MissileWiringTests(unittest.TestCase):
    def test_the_stage_gives_the_guns_the_pages_vehicle_round(self):
        stage = text("sim", "stage.mjs")
        self.assertIn("S.createRoundSpawners(", stage)
        self.assertIn("S.createRocketRide(", stage)
        self.assertIn("guns.onVehicleRound = stage.rocketRide.onVehicleRound", stage)
        # `rocket-ride.js botRideOut`: a bot whose round died goes back.
        self.assertIn("stage.rideOut = bot => stage.rocketRide.botRideOut(bot)", stage)

    def test_the_level_parks_the_round_vehicle_in_a_pool(self):
        level = text("sim", "level.mjs")
        self.assertIn("S.loadRoundSpawnPool(root", level)
        self.assertIn("S.applyTemplateWords?.(root, extras.templateWords)", level)

    def test_the_match_ticks_it_and_asks_it_when_a_ridden_hull_dies(self):
        match = text("sim", "match.mjs")
        self.assertIn("rideOut: bot => stage?.rideOut?.(bot) ?? false", match)
        self.assertIn("this.stage?.rounds?.(dt)", match)

    def test_the_stage_modules_are_loaded(self):
        env = text("sim", "env.mjs")
        for name in ("round-spawners.js", "rocket-ride.js", "template-words.js"):
            self.assertIn(f"imp('{name}')", env)
        self.assertIn("loadRoundSpawnPool", env)


def find_tree() -> Path | None:
    named = os.environ.get("BF42_SIM_MISSILE_TREE")
    if not named:
        return None
    root = Path(named)
    ok = (root / "maps" / "mods" / "xpack2" / "peenemunde" / "scene.glb").exists() \
        and (root / "models" / "mods" / "xpack2" / "WasserfallRocket.glb").exists()
    return root if ok else None


TREE = find_tree()


@unittest.skipIf(shutil.which("node") is None, "node is not installed")
@unittest.skipIf(TREE is None, "no launcher tree (set BF42_SIM_MISSILE_TREE)")
class MissileRunTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        proc = subprocess.run(
            ["node", str(HARNESS), str(TREE / "maps" / "mods" / "xpack2"),
             str(TREE / "models" / "mods" / "xpack2"), "peenemunde", "Wasserfall"],
            capture_output=True, text=True, timeout=600)
        if proc.returncode != 0:
            raise AssertionError(proc.stderr)
        cls.out = json.loads(proc.stdout.strip().splitlines()[-1])

    def test_the_level_parks_the_rocket(self):
        self.assertEqual(["WasserfallRocket", "WasserfallRocket"], self.out["pool"])

    def test_the_bot_rides_the_rocket_it_fired_and_it_flies(self):
        self.assertEqual("Wasserfall", self.out["seatedIn"])
        self.assertEqual("WasserfallRocket", self.out["rodeIn"])
        self.assertEqual("WasserfallRocket", self.out["after2s"])
        self.assertGreater(self.out["moved"], 20.0)
        self.assertGreater(self.out["speed"], 30.0)

    def test_the_bot_is_back_in_the_launcher_alive_when_it_ends(self):
        self.assertEqual("Wasserfall", self.out["finally"])
        self.assertTrue(self.out["alive"])


if __name__ == "__main__":
    unittest.main()
