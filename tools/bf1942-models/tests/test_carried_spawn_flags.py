"""Spawn points an object carries, on the spawn screen (`viewer/spawn-flags.js`),
driven by `carried_spawn_flags_harness.mjs`.

Ledger SPAWNGRP-10. Since SPAWN-8 the exporter emits the spawn points Desert
Combat's airbase buildings, the Talil statics and the AC-130 carry, and the
flag list made one flag per carrier named after its template: `Air_radardome_des`,
`Mil_hangar_a10_des` twice, `Ust`, `Ist`. The spawn screen lists spawn groups:
`getGroupsForTeam` offers each group of the side that holds a point, the map
draws one ring per group at the average of its points (`BFSpawnGroup::calcNewPos`),
and the screen prints no name at all.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
HARNESS = Path(__file__).resolve().parent / "carried_spawn_flags_harness.mjs"
MAPS = ROOT / "viewer" / "maps"
LEVELS = {
    "nfz2": MAPS / "mods/dc_final/dc_no_fly_zone_day2/scene.json",
    "bragg": MAPS / "mods/dc_final/dc_operation_bragg/scene.json",
    "wake": MAPS / "wake/scene.json",
    "bob": MAPS / "battle_of_britain/scene.json",
}
TEMPLATE_NAMES = ("Air_", "Mil_", "Ust", "Ist", "Ac-130", "Shokaku", "Hatsuzuki", "East_Harwick")


@unittest.skipIf(shutil.which("node") is None, "node is not installed")
class CarriedSpawnFlagTests(unittest.TestCase):
    r: dict

    @classmethod
    def setUpClass(cls) -> None:
        args = []
        for name, path in LEVELS.items():
            if path.exists():
                args += [name, str(path)]
        proc = subprocess.run(["node", str(HARNESS), *args], capture_output=True, text=True, timeout=120)
        if proc.returncode != 0:
            raise AssertionError(proc.stderr)
        cls.r = json.loads(proc.stdout)

    def level(self, name: str) -> dict:
        if name not in self.r["levels"]:
            self.skipTest(f"{name} is not extracted in this tree")
        return self.r["levels"][name]

    def test_carriers_sharing_a_group_are_one_flag_with_one_ring(self) -> None:
        flags = self.r["synthetic"]["flags"]
        airbase = next(f for f in flags if 99 in f["groups"])
        self.assertEqual(["air_hangar", "air_tower"], airbase["carriers"])
        self.assertEqual(3, airbase["spawns"])
        # The ring sits at the average of the group's three points.
        self.assertEqual([{"group": 99, "position": [10, 0, 10]}], airbase["rings"])
        self.assertEqual(3, len(flags))

    def test_a_ships_rings_are_its_groups_and_ride_the_hull(self) -> None:
        syn = self.r["synthetic"]
        ship = next(f for f in syn["flags"] if 75 in f["groups"])
        self.assertEqual([75, 76], ship["groups"])
        self.assertEqual([1000, 20, 110], syn["shipRingBefore"])
        self.assertEqual([1050, 20, 110], syn["shipRingAfter"])
        self.assertEqual([1050, 20, 0], syn["shipPositionAfter"])

    def test_no_fly_zone_day_2_offers_each_airbase_once(self) -> None:
        nfz = self.level("nfz2")
        self.assertEqual([("airbase_soldierspawn", 1, [99], 21), ("airbase1_soldierspawn", 2, [97], 21)],
                         [(f["name"], f["team"], f["groups"], f["spawns"]) for f in nfz["flags"]])
        for flag in nfz["flags"]:
            ring = flag["rings"][0]
            self.assertEqual(nfz["averages"][str(ring["group"])], ring["position"])

    def test_operation_bragg_labels_its_groups_by_their_spawn_points(self) -> None:
        bragg = self.level("bragg")
        self.assertEqual([("oil_talil_4_us", 2, [7]), ("talil_4", 1, [8]), ("ac-130_soldierspawn", 2, [74])],
                         [(f["name"], f["team"], f["groups"]) for f in bragg["flags"]])

    def test_wake_keeps_its_three_and_two_deck_rings(self) -> None:
        wake = self.level("wake")
        self.assertEqual([[70, 71], [75, 76, 77]], [f["groups"] for f in wake["flags"]])
        for flag in wake["flags"]:
            for ring in flag["rings"]:
                self.assertEqual(wake["averages"][str(ring["group"])], ring["position"])

    def test_an_ai_only_group_draws_no_ring_on_a_humans_screen(self) -> None:
        # Each Battle of Britain tower carries a human group (74..77) and an
        # `OnlyForAI` one (64..67) indoors: one ring, the human group's, and
        # the AI point stays among the spawns (`pickSpawn` refuses it a human).
        bob = self.level("bob")
        self.assertEqual([[74], [75], [77], [76]], [f["groups"] for f in bob["flags"]])
        self.assertEqual([6, 6, 6, 6], [f["spawns"] for f in bob["flags"]])

    def test_no_flag_is_named_after_its_carriers_template(self) -> None:
        for name in LEVELS:
            if name not in self.r["levels"]:
                continue
            for label in self.r["levels"][name]["names"]:
                self.assertFalse(label.startswith(TEMPLATE_NAMES), (name, label))

    def test_a_dead_carriers_points_leave_the_ring_and_the_pick(self) -> None:
        """Weapon Bunkers' group 99 over three bunkers (SPAWN-5, SPAWNGRP-10):
        `calcNewPos` and `getSpawnPoint` take only the points whose carrier is
        not critically damaged."""
        dead = self.r["deadCarriers"]
        self.assertEqual([478, 74, -813], dead["allUp"]["ring"])
        self.assertEqual([400, 402, 476, 478, 555, 557], dead["allUp"]["picks"])
        middle = dead["middleDown"]
        self.assertFalse(middle["inactive"])
        self.assertEqual([478.5, 74, -813], middle["ring"])
        self.assertNotIn(476, middle["picks"])
        self.assertNotIn(478, middle["picks"])

    def test_with_every_bunker_down_iraq_has_no_spawn(self) -> None:
        down = self.r["deadCarriers"]["allDown"]
        self.assertTrue(down["inactive"])
        self.assertEqual([None] * 6, down["picks"])
        # Asked for, the spawn is refused; unasked, the side waits rather than
        # going to the US flag.
        self.assertIsNone(down["spawn"])
        self.assertIsNone(down["defaultPick"])
        # The ring stays where the group was, not at the world origin.
        self.assertEqual([478, 74, -813], down["ring"])


if __name__ == "__main__":
    unittest.main()
