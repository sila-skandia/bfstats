"""Barbed wire (`viewer/obstacle.js` and the modules that act on it), driven
headless by `obstacle_harness.mjs`.

The law is three collision handlers in the Linux server (ledger OBS-1..OBS-7,
`features/barbed-wire-parity/README.md`): `Obstacle::handleCollision`
0x08315e10, `PlayerControlObject::handleCollision` 0x08318b00 and
`BFSoldier::handleCollision` 0x0827d3b0. A vehicle rolls through wire and
messages it (the scrape); a soldier walks through it at `slowDownMod` (0.4)
of his speed and is billed the wire's `damage` (5 HP) once per second of
contact through his Armor's collision list.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import unittest
from pathlib import Path

HARNESS = Path(__file__).with_name("obstacle_harness.mjs")


def run_harness() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    proc = subprocess.run(["node", str(HARNESS)], capture_output=True, text=True, timeout=120)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


class ObstacleTests(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()

    def test_the_engine_numbers(self) -> None:
        c = self.results["constants"]
        # ObstacleTemplate ctor `+0x150 = 0x40a00000`; BFSoldierTemplate ctor
        # `+0x2f8 = 0x3ecccccd`; the §6.2 handler gate; Armor's list life.
        self.assertEqual(c["damage"], 5.0)
        self.assertAlmostEqual(c["slowDownMod"], 0.4)
        self.assertEqual(c["gate"], 0.1)
        self.assertEqual(c["lifetime"], 1.0)

    def test_a_collision_list_entry_leaves_a_second_after_it_went_in(self) -> None:
        leaves = self.results["colList"]["leaves"]
        # Added at 0 and at 0.5 s; each leaves on the first tick past 1.0 s
        # of its own life (`Armor::update` keeps an entry at exactly 0).
        self.assertAlmostEqual(leaves["a"], 1.0 + 1 / 30, places=2)
        self.assertAlmostEqual(leaves["b"], 1.5, places=2)

    def test_held_against_wire_a_soldier_loses_5_hp_a_second(self) -> None:
        held = self.results["held"]
        hps = [b["hp"] for b in held["bills"]]
        self.assertEqual(hps, [25, 20, 15, 10, 5, 0])
        gaps = [round(b - a, 3) for a, b in zip([x["t"] for x in held["bills"]],
                                                [x["t"] for x in held["bills"]][1:])]
        for gap in gaps:
            self.assertAlmostEqual(gap, 1.0 + 1 / 30, places=2)
        # 30 HP, six bills: dead a little over five seconds into the wire.
        self.assertAlmostEqual(held["deadAt"], 5.17, places=1)

    def test_a_soldier_walks_through_wire_slowed(self) -> None:
        w = self.results["walk"]
        self.assertEqual(w["obstacles"], 1)
        # Through the coil (z -20..-24) and out the far side.
        self.assertLess(w["wireEndZ"], -30)
        self.assertAlmostEqual(w["freeSpeed"], 6.0, places=2)
        # The tick after every touch runs at slowDownMod of the run speed.
        self.assertAlmostEqual(w["slowedMin"], 2.4, places=2)
        self.assertAlmostEqual(w["slowedMax"], 2.4, places=2)
        # Billed on the touch and again a second later, and no more often.
        self.assertEqual([b["lost"] for b in w["bills"]], [5, 5])
        self.assertEqual(w["bills"][0]["tick"], w["firstTouch"])
        self.assertEqual(w["bills"][1]["tick"] - w["bills"][0]["tick"], 31)
        self.assertEqual(w["endHp"], 20)
        # The scrape sounds from the wire's own origin.
        self.assertEqual(w["origin"], [32, 0, -22])

    def test_the_same_fence_as_a_plain_static_stops_him(self) -> None:
        w = self.results["walk"]
        self.assertGreater(w["wallEndZ"], -20)
        self.assertEqual(w["wallTouched"], 0)

    def test_wire_is_known_per_triangle(self) -> None:
        t = self.results["perTriangle"]
        # One Bundle owner, a solid fence child and an Obstacle child.
        self.assertEqual(t["obstacles"], 1)
        self.assertEqual(t["fenceObstacle"], -1)
        self.assertEqual(t["wireObstacle"], 0)
        self.assertEqual(t["sweptObstacle"], 0)
        self.assertEqual(t["wireNodeKind"], "Obstacle")
        self.assertTrue(t["passedWire"])
        self.assertTrue(t["fenceStillStops"])
        self.assertTrue(t["passFlagCleared"])

    def test_a_hull_rolls_through_wire_and_messages_it(self) -> None:
        h = self.results["hull"]
        self.assertEqual(h["fastWire"]["applied"], 0)
        self.assertEqual(h["fastWire"]["touched"], [{"owner": 1, "id": 4, "z": -2.1}])
        # Below the handler gate no handler runs: the wire pushes, silently.
        self.assertEqual(h["slowWire"]["applied"], 1)
        self.assertEqual(h["slowWire"]["touched"], [])
        self.assertEqual(h["fastWall"]["applied"], 1)

    def test_the_scrape_starts_once_per_contact_not_per_tick(self) -> None:
        s = self.results["scrape"]
        # 105 messages over three seconds; wire 1 held throughout plays its
        # 1.2 s sample through three times, wire 2 touched for half a second
        # once. Never two voices of one wire at once.
        self.assertEqual(s["starts"], [
            {"id": 1, "t": 0}, {"id": 2, "t": 0.5}, {"id": 1, "t": 1.2}, {"id": 1, "t": 2.4},
        ])
        self.assertFalse(s["overlap"])


class WireScriptDataTests(unittest.TestCase):
    """The extracted scene carries `e_Barbwire.ssc` whole: `randomPlay 1`'s
    three samples and `randomStartPitch 0.03 / 0.0` on every wire's one-shot
    (`bf42/level.py` `discover_level_sounds`, `extract_map.py`)."""

    def test_omaha_wire_ships_its_pick_list(self) -> None:
        scene = Path(__file__).resolve().parents[1] / "viewer" / "maps" / "omaha_beach" / "scene.json"
        if not scene.exists():
            self.skipTest("no extracted Omaha Beach in this tree")
        areas = json.loads(scene.read_text())["sounds"]["areas"]
        wire = [a for a in areas if a["name"].startswith("stebarbwire")]
        self.assertTrue(wire)
        for a in wire:
            self.assertFalse(a["loop"])
            self.assertEqual(a["distanceVolume"], [3.0, 4.0, 1.0, -1.0])
            self.assertEqual([Path(f).name for f in a["randomPlay"]],
                             ["barbwire1.mp3", "barbwire2.mp3", "barbwire3.mp3"])
            self.assertEqual(a["randomStartPitch"], [0.03, 0.0])
        # A bed is untouched by the one-shot fields.
        self.assertFalse(any("randomPlay" in a for a in areas if a.get("loop", True)))


if __name__ == "__main__":
    unittest.main()
