"""`viewer/kit-drops.js`: the kit a dead soldier leaves on the ground, with
the engine's numbers (features/kit-drops): 30 s on the ground
(`timeToLiveAftherDeath`'s default), 1 degree a world update of spin
(`yawSpeed`), taken within 1.1 m plus the kit's own radius
(`findKitObject`), no more than once every 2 s, by either side, with the
rounds its weapons still hold. The modules touch no DOM and no `three`, so
this copies them plus the harness into a temp dir and runs node.
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
HARNESS = Path(__file__).resolve().parent / "kit_drops_harness.mjs"


def run_harness() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        shutil.copyfile(VIEWER / "kit-drops.js", work / "kit-drops.mjs")
        shutil.copyfile(VIEWER / "kit-ammo.js", work / "kit-ammo.mjs")
        shutil.copyfile(HARNESS, work / "harness.mjs")
        proc = subprocess.run(["node", str(work / "harness.mjs")],
                              capture_output=True, text=True, timeout=60)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


class KitDropTests(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()

    def test_engine_constants(self) -> None:
        c = self.results["constants"]
        self.assertEqual(30, c["KIT_TIME_TO_LIVE"])     # KitTemplate +0x16c
        self.assertAlmostEqual(1.1, c["PICKUP_RADIUS"])  # 0x3f8ccccd at 0x081503af
        self.assertEqual(2.0, c["PICKUP_COOLDOWN"])      # 0x086c0330
        self.assertEqual(1.0, c["KIT_YAW_SPEED"])        # ItemTemplate +0x158
        self.assertEqual(30, c["WORLD_HZ"])

    def test_rests_on_the_nearer_surface_facing_its_normal(self) -> None:
        r = self.results["rest"]
        self.assertEqual(10, r["terrainOnly"]["y"])
        self.assertEqual(0.5, r["terrainOnly"]["yaw"])
        self.assertEqual(14, r["upperFloor"]["y"])       # the floor he stood on
        self.assertEqual(10, r["fromTheAir"]["y"])       # no fall: straight down
        self.assertEqual([0.6, 0.8, 0], [round(v, 6) for v in r["slope"]["normal"]])
        self.assertEqual(7, r["nothing"]["y"])

    def test_turns_thirty_degrees_a_second_and_lasts_thirty_seconds(self) -> None:
        life = self.results["life"]
        self.assertAlmostEqual(30.0, life["spinAfter1s"])
        self.assertAlmostEqual(29.0, life["leftA"])
        self.assertEqual([], life["expired28"])
        self.assertEqual(["German_AT"], life["expired29"])
        self.assertEqual(["Us_Medic"], life["alive"])
        self.assertEqual("Us_Medic", life["took"])
        self.assertEqual(0, life["left"])

    def test_reach_is_the_query_plus_the_kits_radius(self) -> None:
        reach = self.results["life"]["reach"]
        self.assertEqual("German_AT", reach["at1m"])
        self.assertEqual("German_AT", reach["at1_8m"])
        self.assertIsNone(reach["at1_95m"])
        self.assertIsNone(reach["between"])
        self.assertEqual("Us_Medic", reach["nearMedic"])

    def test_pickup_gate(self) -> None:
        g = self.results["gate"]
        self.assertTrue(g["onFootReady"])
        self.assertFalse(g["seated"])
        self.assertFalse(g["firing"])
        self.assertFalse(g["cooldown"])                  # exactly 2 s: not yet
        self.assertTrue(g["cooldownExact"])

    def test_ammo_is_carried_not_refilled(self) -> None:
        a = self.results["ammo"]
        names = [row["name"] for row in a["rows"]]
        self.assertEqual(["Sg44", "GrenadeAxis"], names)  # the knife has no row
        self.assertTrue(a["thompsonGone"])                # the old kit's counts go
        self.assertEqual({"rounds": 7, "mags": 2, "size": 30, "spares": 4}, a["sg44"])
        self.assertEqual({"rounds": 1, "mags": 0}, a["grenade"])
        self.assertEqual({"rounds": 8, "mags": 3}, a["unraisedPistol"])
        self.assertTrue(a["refilled"])                    # a depot still fills it
        self.assertEqual({"rounds": 30, "mags": 4}, a["sg44After"])


if __name__ == "__main__":
    unittest.main()
