"""Capture-only flags: control points that own no soldier spawn.

`viewer/spawn-flags.js` used to skip a control point whose spawn groups hold
no `SpawnPoint`, so the world had no flag for it and the capture law never
ran on it, while its `areaValue` still reached the ticket bleed, frozen at the
level's team. Midway Conquest's two sea areas (neutral, 40 each; their
templates set no `spawnGroupId`) and Salerno's `The_top` in XPack1 Conquest
and CoOp (neutral, 50; `spawnGroupId -1`, its seven hilltop points remmed out)
could never change hands, and Midway could never bleed: the islands weigh 80.

The engine's capture path reads no spawn group (ledger SPAWNGRP-7):
`ControlPoint::handleFrameUpdate` 0x08283b00 reads the template's radius and
law bytes and the point's own team and timers, and `CPEnable` 0x082840e0
skips a `spawnGroupId` of -1 (0x0828410b). Such a point is now a capture-only
flag: the law runs on it, the map and the round follow its owner, and no
spawn picker offers it. `tests/capture_only_harness.mjs` runs Midway's own
control points through the page's modules.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import unittest
from pathlib import Path

HARNESS = Path(__file__).resolve().parent / "capture_only_harness.mjs"


@unittest.skipIf(shutil.which("node") is None, "node is not installed")
class CaptureOnlyFlagTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        proc = subprocess.run(["node", str(HARNESS)], capture_output=True, text=True, timeout=120)
        if proc.returncode != 0:
            raise AssertionError(proc.stderr)
        cls.r = json.loads(proc.stdout)

    def test_a_spawnless_point_is_a_flag_after_the_others(self) -> None:
        flags = self.r["midway"]
        self.assertEqual(["The_Airfield", "The_Radar_Bunker", "Enterprise", "Shokaku", "North_Midway", "South_Midway"],
                         [f["name"] for f in flags])
        self.assertEqual([False, False, False, False, True, True], [f["captureOnly"] for f in flags])
        for sea in flags[4:]:
            self.assertEqual({"team": 0, "spawns": 0, "group": None, "groups": 0, "radius": 100,
                              "uncapturable": False, "timeToGetControl": 10},
                             {k: sea[k] for k in ("team", "spawns", "group", "groups", "radius",
                                                  "uncapturable", "timeToGetControl")})

    def test_nothing_changes_for_a_flag_that_has_spawns(self) -> None:
        # Every field and every index, against the list built without them.
        self.assertTrue(self.r["spawnFlagsUnchanged"])

    def test_the_hill_carries_its_settings_and_no_group(self) -> None:
        top = self.r["top"]
        self.assertEqual("HILL_424", top["name"])
        self.assertEqual("The_top", top["controlPointName"])
        self.assertEqual((0, None, [], []), (top["team"], top["group"], top["groups"], top["spawns"]))
        self.assertEqual((10, 10, 10, True, False), (top["radius"], top["timeToGetControl"], top["timeToLoseControl"],
                                                     top["loseControlWhenEnemyClose"], top["uncapturable"]))

    def test_an_uncapturable_or_unmade_point_is_still_no_flag(self) -> None:
        # Battle of Britain's `Allied_Base` cannot change hands; Cassino CTF's
        # `openbasecammo` names a template the layer never defines, and
        # `ObjectTemplateAdm::createObject` 0x084513e0 makes nothing of that.
        self.assertEqual([{"name": "AxisBase", "captureOnly": False}, {"name": "The_top", "captureOnly": True}],
                         self.r["salerno"])

    def test_the_law_takes_a_sea_area_and_the_round_weighs_it(self) -> None:
        law = self.r["law"]
        # The American starts on his carrier's deck, the side's one flag.
        self.assertEqual("Enterprise", law["start"])
        got = [(e["flag"], e["got"], e["from"]) for e in law["events"]]
        self.assertEqual([("North_Midway", 2, 0), ("South_Midway", 2, 0), ("The_Airfield", 2, 0)], got)
        # Ten seconds alone in each: `timeToGetControl 10`.
        for event, at in zip(law["events"], (10.0, 21.0, 32.0)):
            self.assertAlmostEqual(at, event["t"], delta=0.1)
            self.assertEqual(["us"], event["takers"])
        # The map's entries follow the flags (`hoistCaptureFlag`).
        self.assertEqual({"The_Airfield": 2, "The_Radar_Bunker": 0, "North_Midway": 2, "South_Midway": 2},
                         law["entries"])
        self.assertEqual(law["entries"], law["teams"])
        # 120 over 99: Japan bleeds a ticket every 60 / 5 s, five in 61 s.
        self.assertEqual({"1": 0, "2": 120}, law["held"])
        self.assertEqual({"1": True, "2": False}, law["bleeding"])
        self.assertEqual({"1": 95, "2": 100}, law["tickets"])
        # With the sea areas frozen neutral the islands' 80 never bled anyone.
        self.assertEqual({"1": 0, "2": 80}, law["islandsOnly"]["held"])
        self.assertEqual({"1": 100, "2": 100}, law["islandsOnly"]["tickets"])

    def test_the_world_never_spawns_anyone_at_one(self) -> None:
        s = self.r["spawnPlayer"]
        # The Americans hold North_Midway and nothing else: a neutral island,
        # and they stay American.
        self.assertEqual({"flag": "The_Airfield", "team": 2, "spawn": "g4_0"}, s["picked"])
        self.assertEqual({"flag": "The_Airfield", "spawn": "g4_0"}, s["asked"])

    def test_the_bots_start_and_respawn_where_there_are_spawns(self) -> None:
        bots = self.r["bots"]
        self.assertEqual(4, len(bots["starts"]))
        for start in bots["starts"]:
            self.assertTrue(start["spawned"], start)
            self.assertEqual("The_Airfield", start["flag"], start)
        self.assertEqual(40, len(bots["respawns"]))
        for respawn in bots["respawns"]:
            self.assertEqual({"flag": "The_Airfield", "atSpawn": True}, respawn)

    def test_the_deploy_screen_never_offers_one(self) -> None:
        d = self.r["deploy"]
        # The Axis hold both sea areas and no island: nobody has a spawn of
        # his own, so a fresh join is not steered to the Axis.
        self.assertEqual(2, d["team"])
        self.assertEqual(["0", "1"], d["options"])
        self.assertEqual(2, d["built"])
        self.assertEqual([0, 1], d["axisTab"])
        self.assertFalse(d["selectSea"])
        self.assertTrue(d["selectIsland"])
        self.assertEqual("0", d["selected"])


if __name__ == "__main__":
    unittest.main()
