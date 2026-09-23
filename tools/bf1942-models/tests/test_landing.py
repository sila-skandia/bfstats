"""`viewer/doctrine-landing.js` under node (`tests/landing_harness.mjs`).

The SAI's beach orders for a landing craft and the bail at the beach, read
from the lnxded decompile on 2026-09-24 (ledger AI-96..AI-99): the zone's
geometry (`AILandingZone` 0x0863ac80..0x0863b130), the order
`orderNormalBot` 0x08640bd0 gives (`WPBeachLanding` 0x08536350,
`WPMoveToBeachLanding` 0x08537ce0), the leg flip on entering the zone
(`getUrgency` 0x085363d0) and `BBChangeLandingCraft` 0x085602b0.
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
HARNESS = Path(__file__).resolve().parent / "landing_harness.mjs"
MODULES = ("strategic.js", "strategic-layer.js", "strategic-ai.js", "doctrine.js", "doctrine-squad.js",
           "doctrine-landing.js")


def run_harness() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        for name in MODULES:
            shutil.copyfile(VIEWER / name, work / name)
        shutil.copyfile(HARNESS, work / "harness.mjs")
        (work / "package.json").write_text('{"type":"module"}\n')
        proc = subprocess.run(["node", str(work / "harness.mjs")], capture_output=True, text=True, timeout=120)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


class LandingTests(unittest.TestCase):
    r: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.r = run_harness()

    def test_the_engines_numbers(self) -> None:
        c = self.r["constants"]
        self.assertEqual(c["unitType"], "LandingCraft")          # AIbehaviours.con setVehicle 7
        self.assertEqual(c["approachOffset"], 10.0)              # 0x41200000 at getGoalPoint 0x08536450
        self.assertEqual(c["approachTries"], 20)                 # getApproachPosition 0x0863ad80
        self.assertEqual(c["waypointRadius"], 10.0)              # getWayPointRadius 0x08536500
        self.assertEqual(c["moveToRadiusMin"], 5.0)              # WPMoveToBeachLanding ctor 0x08537ce0
        self.assertEqual(c["moveToInsideD2"], 10.0)              # 0x08537e89
        self.assertEqual(c["bailSpeed"], 2.0)                    # 0x8560c60

    def test_zone_distance_is_zero_inside_and_to_the_centre_rays_exit_outside(self) -> None:
        g = self.r["geometry"]
        self.assertEqual(g["inside"], 0)
        self.assertEqual(g["onEdge"], 0)                          # insideCornerBox is inclusive
        self.assertEqual(g["south"], 93 ** 2)                     # (1153, -500) to the z = -593 edge
        self.assertAlmostEqual(g["corner"], g["cornerExit"], places=2)

    def test_beach_points_lie_on_the_beach_edge_and_approach_points_10_m_in_from_the_other(self) -> None:
        p = self.r["points"]
        # SouthLanding is LZZMax: the engine's z = 713 edge, the exporter's
        # z = -713; the approach side is the engine's z = 593 + 10.
        self.assertEqual(p["beachZ"], [-713])
        self.assertEqual(p["approachZ"], [-603])
        self.assertGreaterEqual(p["beachX"][0], 1110)
        self.assertLessEqual(p["beachX"][1], 1196)
        self.assertGreater(p["beachX"][1] - p["beachX"][0], 50)   # spread along the edge
        self.assertEqual(p["twentieth"], {"valid": True, "tries": 20})
        self.assertEqual(p["none"], {"valid": False, "point": True})
        # SouthBayLanding is LZZMin: the beach is the exporter's z max.
        self.assertEqual(p["bayBeachZ"], -830)
        self.assertEqual(p["bayApproachZ"], -925)

    def test_the_sai_sends_a_landing_craft_to_the_beach_of_its_target(self) -> None:
        t = self.r["targets"]
        self.assertEqual(t["crossRoads"], {"kind": "WPBeachLanding", "zone": "SouthLanding", "via": "CrossRoads", "radius": 10})
        self.assertEqual(t["southernBase"]["zone"], "SouthBayLanding")
        # MainBase expels landing craft: the first zone user on the way.
        self.assertEqual(t["mainBase"], {"kind": "WPMoveToBeachLanding", "zone": "SouthLanding", "via": "CrossRoads", "radius": 5})
        self.assertEqual(t["defGun1"]["via"], "CrossRoads")
        self.assertIsNone(t["seaArea3"])                          # a sea area: an ordinary WPMoveTo
        self.assertIsNone(t["infantry"])                          # only the LandingCraft unit
        self.assertEqual(t["craftArea"], "SeaArea1")
        self.assertEqual(t["craftAreaOnBeach"], "WesternMainBaseExit")
        # WesternMainBaseExit lists SeaArea3 as a neighbour (Wake's own line).
        self.assertEqual(t["path"], ["SeaArea3", "WesternMainBaseExit", "MainBase"])
        f = t["fromSeaArea3"]
        self.assertEqual(f, {"kind": "WPMoveToBeachLanding", "via": "CrossRoads", "radius": 5})
        # No zone user on that way (this copy gives WesternMainBaseExit no
        # zone): the ordinary WPMoveTo.
        self.assertIsNone(t["mainBaseFromSeaArea3"])

    def test_the_command_flips_the_leg_in_the_zone_and_bails_everyone_at_the_beach(self) -> None:
        c = self.r["command"]
        self.assertEqual(c["kindsRegistered"], [True, True])
        f = c["first"]
        # Whichever area the SAI attacks, the craft's order is a beach order
        # on SouthLanding: its own (CrossRoads) or the first on the way.
        if f["area"] == "CrossRoads":
            self.assertEqual((f["kind"], f["radius"]), ("WPBeachLanding", 10))
        else:
            self.assertEqual((f["kind"], f["radius"]), ("WPMoveToBeachLanding", 5))
        self.assertEqual((f["zone"], f["direct"]), ("SouthLanding", False))
        self.assertEqual(f["point"][1], -603)                     # the approach point
        self.assertEqual(f["urgency"], 1)
        # One flip to the beach leg at the zone's seaward edge (z = -593):
        # on it for `WPBeachLanding` (d^2 == 0), sqrt(10) m short of it for
        # `WPMoveToBeachLanding` (d^2 < 10).
        self.assertEqual(len(c["legs"]), 2)
        self.assertFalse(c["legs"][0]["direct"])
        self.assertTrue(c["legs"][1]["direct"])
        edge = -593 if f["kind"] == "WPBeachLanding" else -593 + 10 ** 0.5
        self.assertLessEqual(c["legs"][1]["z"], edge)
        self.assertGreater(c["legs"][1]["z"], edge - 0.5)
        self.assertEqual(c["beachPointZ"], -713)
        self.assertTrue(c["saiFollows"])
        # Moving at 12 m/s nobody gets out; stopped on walkable ground in the
        # zone but afloat, nobody either (`isTouchingLand` 0x085606bd);
        # aground there, the driver and both riders do.
        self.assertEqual(c["exitsMoving"], 0)
        self.assertEqual(c["exitsAfloat"], 0)
        self.assertEqual(c["exitsStopped"], ["c", "p1", "p2"])
        self.assertEqual(c["infantry"], "WPMoveTo")

    def test_a_tipped_craft_bails_at_sea(self) -> None:
        self.assertEqual(self.r["tipped"], ["c", "p1", "p2"])

    def test_the_crews_own_bail_test(self) -> None:
        # BBChangeLandingCraft 0x085602b0: in ANY zone, under 2 m/s (strict,
        # 0x8560c60), on the soldier's map; or tipped, anywhere.
        b = self.r["bailReason"]
        self.assertEqual(b["beached"], "beach")
        self.assertIsNone(b["fast"])
        self.assertIsNone(b["atTwo"])
        self.assertIsNone(b["wet"])
        self.assertIsNone(b["offZone"])
        self.assertEqual(b["bay"], "beach")                       # another zone than the order's
        self.assertEqual(b["tippedAtSea"], "tipped")
        self.assertTrue(b["sameZones"])
        # In the zone, stopped, walkable, but not touching land: no bail.
        self.assertIsNone(b["afloat"])
        self.assertEqual(b["tippedFlag"], "tipped")
        self.assertEqual(b["tippedWins"], "tipped")

    def test_the_tip_test_has_two_forms(self) -> None:
        # BBChangeLandingCraft 0x08560b8a..0x08560c4b: water more than 2 m
        # over the terrain (`getWaterLevel` vt+0xb4 > `getHeight` vt+0x9c +
        # 2.0) reads the up axis's y; shallower, the up axis against the
        # terrain normal (`getNormal` vt+0xa8); tipped under 0.7071, strict.
        t = self.r["tip"]
        self.assertFalse(t["deepUpright"])
        self.assertTrue(t["deepOver"])
        self.assertFalse(t["shallowOnSlope"])
        self.assertTrue(t["shallowOver"])
        self.assertTrue(t["atTwo"])          # 2 m exactly is shallow: the normal (flat here)
        self.assertFalse(t["noSea"])         # no sea: the terrain form
        self.assertEqual(t["limit"], [False, True])


if __name__ == "__main__":
    unittest.main()
