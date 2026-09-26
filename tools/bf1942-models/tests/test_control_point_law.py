"""The control points' own law (`ControlPoint::handleFrameUpdate` 0x08283b00),
as the bot referee runs it (`viewer/bot-referee.js controlPointStep`).

Brief K item 3: a PanzerIV and a Sherman sat on El Alamein's North outpost
and traded it every 10 s for minutes, because each bot ran its own capture
timer and took the flag from under the other. The engine's point is held by
its owner's player, runs down to neutral with an enemy on it too
(`loseControlWhenEnemyClose`, on by default and on most vanilla flags), and
is taken only by one team alone on it.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import unittest
from pathlib import Path

HARNESS = Path(__file__).resolve().parent / "control_point_harness.mjs"


@unittest.skipIf(shutil.which("node") is None, "node is not installed")
class ControlPointLawTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        proc = subprocess.run(["node", str(HARNESS)], capture_output=True, text=True, timeout=120)
        if proc.returncode != 0:
            raise AssertionError(proc.stderr)
        cls.r = json.loads(proc.stdout)

    def test_the_template_defaults(self) -> None:
        # `ControlPointTemplate` ctor 0x082846d0.
        d = self.r["defaults"]
        self.assertEqual(d["timeToGet"], 5)
        self.assertEqual(d["timeToLose"], 5)
        self.assertTrue(d["loseWhenEnemyClose"])
        self.assertFalse(d["loseWhenNotClose"])
        self.assertEqual(d["minNr"], 1)

    def test_one_team_alone_takes_a_point(self) -> None:
        self.assertEqual(self.r["neutralTaken"]["team"], 2)
        self.assertAlmostEqual(self.r["neutralTaken"]["events"][0]["t"], 10.0, delta=0.1)
        # An owned point runs down first, then is taken.
        events = self.r["ownedTaken"]["events"]
        self.assertEqual([("lost" in e, "got" in e) for e in events], [(True, False), (False, True)])
        self.assertAlmostEqual(events[0]["t"], 5.0, delta=0.1)
        self.assertAlmostEqual(events[1]["t"], 15.0, delta=0.2)

    def test_two_enemies_on_a_point_do_not_trade_it(self) -> None:
        # Run down to neutral once, then nothing for two minutes.
        c = self.r["contested"]
        self.assertEqual(c["team"], 0)
        self.assertEqual(len(c["events"]), 1)
        # Without `loseControlWhenEnemyClose` the defender holds it.
        self.assertEqual(self.r["contestedHeld"], {"team": 1, "events": []})
        # The old per-bot law traded it eleven times in the same two minutes.
        self.assertEqual(self.r["oldLawTrades"], 11)

    def test_the_other_settings(self) -> None:
        self.assertEqual(self.r["empty"], {"team": 1, "events": []})
        self.assertEqual(self.r["emptyLoses"]["team"], 0)
        self.assertEqual(self.r["tooFew"]["team"], 0)
        self.assertEqual(self.r["onlyAxis"]["team"], 0)

    def test_the_level_lose_time_reaches_the_law(self) -> None:
        # The exporter's `timeToLoseControl` (vanilla 10 on 85 of 115 placed
        # points) through spawn-flags.js into `controlPointSettings`.
        lf = self.r["levelFlag"]
        self.assertEqual(lf["settings"]["timeToLose"], 10)
        events = lf["events"]
        self.assertEqual([("lost" in e, "got" in e) for e in events], [(True, False), (False, True)])
        self.assertAlmostEqual(events[0]["t"], 10.0, delta=0.1)
        self.assertAlmostEqual(events[1]["t"], 20.0, delta=0.2)
        self.assertEqual(self.r["oldScene"]["timeToLose"], 5)

    def test_a_holder_spawns_at_its_own_group_of_two(self) -> None:
        """Ledger SPAWNGRP-4 on Kasserine SinglePlayer's two-group bases.

        `ControlPoint::control(0)` 0x08283fe0 enables `spawnGroupId` for team 1
        and `secondSpawnGroupId` for team 2; losing the point zeroes both, and
        the group not enabled keeps what it last held.
        """
        k = self.r["kasserine"]
        # The start: both of axis_base's groups are Axis (group 6 by its
        # `groupTeam`), so the Axis spawn at both, as before.
        self.assertEqual(k["start"]["offered"], [1, 6])
        self.assertEqual(k["start"]["groupTeams"], {"1": 1, "6": 1})
        self.assertEqual(k["alliedStart"]["offered"], [2, 7])
        # Taken by the Allies: the second group alone, the first on no side --
        # the Axis spawn at neither.
        captured = k["captured"]
        self.assertEqual(captured["team"], 2)
        self.assertEqual([("lost" in e, "got" in e) for e in captured["events"]],
                         [(True, False), (False, True)])
        self.assertEqual(captured["offered"], [6])
        self.assertEqual(captured["picked"], 6)
        self.assertEqual(captured["groupTeams"], {"1": 0, "6": 2})
        # Retaken by the Axis: the first group alone; 6 stays zeroed.
        self.assertEqual(k["retaken"]["team"], 1)
        self.assertEqual(k["retaken"]["offered"], [1])
        self.assertEqual(k["retaken"]["groupTeams"], {"1": 1, "6": 0})
        # A decree straight from one side to the other is the same hand-over.
        self.assertEqual(k["decreed"]["offered"], [6])
        self.assertEqual(k["decreed"]["groupTeams"], {"1": 0, "6": 2})
        # allied_base: lost zeroes both; the Axis take it at its FIRST group.
        self.assertEqual(k["alliedLost"]["groupTeams"], {"2": 0, "7": 0})
        self.assertEqual(k["alliedTakenByAxis"]["offered"], [2])
        self.assertEqual(k["alliedTakenByAxis"]["picked"], 2)
        # A one-group point offers its whole group to whoever holds it.
        self.assertEqual(k["village"]["offered"], [3])
        self.assertEqual(k["village"]["groupTeams"], {"3": 2})



if __name__ == "__main__":
    unittest.main()
