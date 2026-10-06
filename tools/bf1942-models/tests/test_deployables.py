"""`viewer/deployables.js` and the kit pads of `viewer/deployables-page.js`:
the engine's ObjectSpawner as a soldier meets it on foot -- Desert Combat's
mortar, which the Support kit's round places, and the kits a map lays on pads
(features/dc-mortar-and-kit-pads, ledger SPAWN-9 .. SPAWN-16).

`deployables.js` touches no DOM and no `three`, so `deployables_harness.mjs`
runs it with the one module it imports. `kit_pads_harness.mjs` runs the page
half against the vendored three.js, with a made-up level: the pads it builds
from `objectSpawns` and a loadouts file, and the kits they lay down.

What each test pins, against the lnxded reading the module header cites:

  SPAWN-9   a pad spawns in its first update and holds its slot while the
            object lives anywhere; the delay runs once it is gone.
  SPAWN-11  the clearance: no spawn while a live human soldier's origin is
            within 2 m of the point, for a land hull or a non-0x24 air hull.
  SPAWN-12  the abandoned clock: 0.5 s steps, a countdown that runs only when
            nobody is near or seated and the spawner is far or gone, then
            hit points billed per step.
  SPAWN-13  a pad hands out the entry of its team, and nothing for a team it
            has none for; `CPDisable` stops it.
  SPAWN-14  `calcSpawnDelay` and `setActive`: the window shrinks with the
            player count, and switching a pad redraws a running delay.
  SPAWN-15  the template's 5 m `radius`.
  Pads      a kit pad is made only for a kit the loadouts file knows, matched
            case-blind (DC's levels spell `US_Sniper_hvy` three ways), and
            the level's baked copy is taken out. DC 0.7's loadouts lacked its
            two pad kits, so its pads were inert piles (kit-pickups package).
  The mortar round falls, stops on the ground, and dies in water and after
  its `timeToLive`. DC 0.7's `projectilePosition 0/0/0` never clears the
  thrower on a level throw; DC Final's 0/1/0 does on the first tick. What
  retail 0.7 does there is unmeasured (the feature README's open question).
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
TESTS = Path(__file__).resolve().parent

THREE_PACKAGE = json.dumps({
    "name": "three", "version": "0.0.0", "type": "module",
    "main": "three.module.js", "exports": "./three.module.js",
})

PAGE_MODULES = ("deployables-page.js", "deployables.js", "point-body.js",
                "soldier-pose.js", "fire-state.js", "deviation.js")


def _node(work: Path, harness: str, *args: str) -> dict:
    proc = subprocess.run(["node", str(work / harness), *args],
                          capture_output=True, text=True, timeout=120)
    if proc.returncode != 0:
        raise AssertionError(f"{harness} failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


def run_harness() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        # `deployables.js` imports `./point-body.js`: keep that name and make
        # every `.js` here an ES module.
        (work / "package.json").write_text('{"type":"module"}\n')
        shutil.copyfile(VIEWER / "deployables.js", work / "deployables.mjs")
        shutil.copyfile(VIEWER / "point-body.js", work / "point-body.js")
        shutil.copyfile(TESTS / "deployables_harness.mjs", work / "harness.mjs")
        return _node(work, "harness.mjs")


def run_pads(loadouts: dict, scenes: list[dict]) -> dict:
    """`kit_pads_harness.mjs` over `scenes` with `loadouts`."""
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    three = VIEWER / "vendor" / "three.module.js"
    if not three.exists():
        raise unittest.SkipTest("three.module.js is not vendored")
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        (work / "package.json").write_text('{"type":"module"}\n')
        for name in PAGE_MODULES:
            shutil.copyfile(VIEWER / name, work / name)
        (work / "node_modules" / "three").mkdir(parents=True)
        shutil.copyfile(three, work / "node_modules" / "three" / "three.module.js")
        (work / "node_modules" / "three" / "package.json").write_text(THREE_PACKAGE)
        shutil.copyfile(TESTS / "kit_pads_harness.mjs", work / "pads.mjs")
        (work / "input.json").write_text(json.dumps({"loadouts": loadouts, "scenes": scenes}))
        return _node(work, "pads.mjs", str(work / "input.json"))


class DeployablesTests(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()

    def test_engine_constants(self) -> None:
        c = self.results["constants"]
        self.assertEqual(2.0, c["SPAWN_CLEARANCE"])   # d^2 < 4.0, 0x08133a10
        self.assertEqual(0.5, c["LIFE_STEP"])         # +0x19c against 0.5, 0x08318d20
        self.assertEqual(5.0, c["PAD_RADIUS"])        # template +0x16c, 0x08314a70

    def test_clearance_applies_to_land_and_most_air_hulls(self) -> None:
        # VCLand, VCSea, VCAir, an air hull whose tooltip type is 0x24.
        self.assertEqual([True, False, True, False], self.results["needsClearance"])

    def test_dc_final_mortar_clears_the_thrower_and_dc_07s_never_does(self) -> None:
        clear = self.results["clear"]
        # 0/1/0 in the view frame puts the point 2.02 m over his origin.
        self.assertEqual(0, clear["dcFinalLevel"]["tick"])
        self.assertEqual([0, 3.02, 0], clear["dcFinalLevel"]["at"])
        # 0/0/0: the round lands 0.93 m ahead of him and dies at 1 s, the
        # point never 2 m from his origin. Thrown 45 degrees down, DC Final's
        # does not clear either.
        self.assertIsNone(clear["dcLevel"]["tick"])
        self.assertTrue(clear["dcLevel"]["rest"])
        self.assertEqual([0, 0, 0.933], clear["dcLevel"]["pos"])
        self.assertIsNone(clear["dcFinalDown"]["tick"])

    def test_the_round_falls_rests_and_dies(self) -> None:
        trail = self.results["bombTrail"]
        self.assertEqual(1, trail["last"])            # on the ground at y 1
        self.assertTrue(trail["rest"])
        self.assertTrue(trail["dead"])                # timeToLive 1
        self.assertTrue(self.results["drowned"])      # DetonateOnWaterCollision

    def test_spawn_delay_shrinks_with_the_player_count(self) -> None:
        # min + (max - min) * (1 - players / maxPlayers), 0x08314430.
        self.assertEqual([60, 30, 45, 25], self.results["delays"])

    def test_abandoned_clock(self) -> None:
        life = self.results["life"]
        # 40 s of countdown in 0.5 s steps, then each step billed unscaled
        # with the spawner gone; dead at 10 hit points.
        self.assertAlmostEqual(40.128, life["first"], places=3)
        self.assertAlmostEqual(0.533, life["step"], places=3)
        self.assertAlmostEqual(49.632, life["deadAt"], places=3)
        # A man in the seat resets it; so does a spawner within its Distance.
        self.assertAlmostEqual(10.133, life["beforeReset"], places=3)
        self.assertEqual(40, life["afterReset"])
        self.assertEqual(40, life["nearSpawner"])
        # With the spawner alive but far: the step times damageWhenLost (2).
        self.assertEqual([0, 0, 1, 1], life["billedWithSpawner"])

    def test_kit_pad(self) -> None:
        pad = self.results["pad"]
        self.assertTrue(pad["first"])                 # the first update spawns
        self.assertEqual("US_Sniper_hvy", pad["firstTemplate"])
        self.assertEqual(0, pad["extra"])             # carried 300 m: slot full
        self.assertAlmostEqual(25.067, pad["respawnAt"], places=3)
        self.assertIsNone(pad["teamless"])            # no entry for team 0
        self.assertIsNone(pad["wrongTeam"])           # nor for team 1
        self.assertTrue(pad["rightTeam"])
        self.assertEqual(0, pad["whileOff"])          # CPDisable
        self.assertEqual(25, pad["delayAfterOff"])    # setActive redraws it


# A made-up level: the M82 pad spelled as Medina Ridge spells it, filed under
# a control point; a two-sided AA pad as DC Final's Lost Village has one;
# a vehicle; and Operation Bragg's `UST`, a spawn carrier and not a kit.
SCENE = {
    "name": "made_up",
    "controlPoints": [],
    "objectSpawns": [
        {"spawner": "m82sniperspawner", "vehicle": "US_Sniper_Hvy", "team": 2,
         "position": [10, 1, 20], "rotation": [0, 0, 0], "minSpawnDelay": 30,
         "maxSpawnDelay": 45},
        {"spawner": "aakitspawner", "vehicle": "us_aa", "team": 2,
         "templates": {"1": "Iraq_AA", "2": "us_aa"},
         "position": [-5, 2, 4], "rotation": [0, 0, 0]},
        {"spawner": "tankspawner", "vehicle": "M1A1", "team": 2,
         "position": [0, 0, 0], "rotation": [0, 0, 0]},
        {"spawner": "talilus", "vehicle": "UST", "team": 2,
         "position": [50, 0, 50], "rotation": [0, 0, 0]},
    ],
    # The bake's inert copy of the M82 kit, half a metre off the pad.
    "baked": [[10.2, 1.0, 20.4]],
}


class KitPadTests(unittest.TestCase):

    def test_a_pad_kit_the_loadouts_know_is_laid_down(self) -> None:
        loadouts = {"kits": {"US_Sniper_hvy": {}, "US_AA": {}}}
        scene = run_pads(loadouts, [SCENE])["scenes"][0]
        self.assertEqual(4, scene["spawns"])
        # Two pads: no pad for the vehicle, none for the carrier.
        self.assertEqual(["m82sniperspawner", "aakitspawner"],
                         [pad["spawner"] for pad in scene["pads"]])
        m82, aa = scene["pads"]
        # The loadouts' spelling, for both sides of a one-name pad.
        self.assertEqual({"1": "US_Sniper_hvy", "2": "US_Sniper_hvy"}, m82["templates"])
        # Iraq_AA is not in this loadouts file, so team 1 has no entry.
        self.assertEqual({"2": "US_AA"}, aa["templates"])
        # The baked copy goes, and the kit lies where it stood.
        self.assertEqual(0, scene["bakedLeft"])
        self.assertEqual([10.2, 1.0, 20.4], m82["place"])
        self.assertEqual([("US_Sniper_hvy", [10.2, 1.0, 20.4]), ("US_AA", [-5, 2, 4])],
                         [(p["kit"], p["at"]) for p in scene["placed"]])
        self.assertIsNotNone(m82["slot"])

    def test_no_pad_for_a_kit_the_loadouts_lack(self) -> None:
        # DC 0.7's loadouts before the kit-pickups fix: the bound kits only.
        loadouts = {"kits": {"US_Sniper": {}, "Iraq_AT": {}}}
        scene = run_pads(loadouts, [SCENE])["scenes"][0]
        self.assertEqual([], scene["pads"])
        self.assertEqual([], scene["placed"])
        self.assertEqual(1, scene["bakedLeft"])       # the inert pile stays


if __name__ == "__main__":
    unittest.main()
