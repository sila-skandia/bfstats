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

    def test_a_zero_capture_time_takes_the_point_at_once(self) -> None:
        # `handleFrameUpdate` gets control only while the get timer is above
        # 0 and takes it otherwise, the same frame (0x08283c65..0x08283c76).
        self.assertEqual(self.r["instantSettings"]["timeToGet"], 0)
        i = self.r["instant"]
        self.assertEqual(i["team"], 2)
        self.assertEqual(len(i["events"]), 1)
        self.assertAlmostEqual(i["events"][0]["t"], 1 / 30, places=3)

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



    def test_a_point_switches_its_spawns_off_while_it_is_taken(self) -> None:
        s = self.r["switched"]
        self.assertEqual([[True, 1], [True, 1], [True, 1]], s["start"])
        # Losing: still Axis, state 2, nothing offered; the plain point keeps
        # its spawn while it runs down.
        self.assertEqual([1, False, 0, 2], s["losing"]["bridge"])
        self.assertEqual([1, True, 1], s["losing"]["plain"])
        # The defender back alone: held, state 4, the spawn back.
        self.assertEqual([1, True, 1, 4], s["held"])
        # Lost to neutral: off, as any lost point is.
        self.assertEqual([0, False], s["lost"][:2])
        # Contested with `disableIfEnemyInsideRadius` and no
        # `loseControlWhenEnemyClose`: held but off; enemy gone, on again.
        self.assertEqual([2, False, 0, 4], s["contested"])
        self.assertEqual([2, True, 1], s["cleared"])


if __name__ == "__main__":
    unittest.main()

    # -- Forgotten Hope's push maps (features/fh-mod-extraction) ------------

    def test_gold_beach_front_is_taken_once_and_never_lost(self) -> None:
        r = self.r
        # The Germans cannot take the neutral front (`onlyTakeableByTeam 2`).
        self.assertEqual(r["gbFrontGermansFirst"], {"team": 0, "events": []})
        # The British take it after 10 s ...
        self.assertEqual(r["gbFrontTaken"]["team"], 2)
        self.assertAlmostEqual(r["gbFrontTaken"]["events"][0]["t"], 10.0, delta=0.1)
        # ... and no German force, alone or against a British defender, or
        # nobody at all, ever moves it again.
        for key in ("gbFrontGermansAlone", "gbFrontContested", "gbFrontGermansNothing"):
            self.assertEqual(r[key], {"team": 2, "events": []}, key)

    def test_gold_beach_german_points_swap_by_presence(self) -> None:
        r = self.r
        # A German on the point holds it against any number of British
        # (`loseControlWhenEnemyClose 0`).
        self.assertEqual(r["gbBunkerHeld"], {"team": 1, "events": []})
        # Alone, the British run it down in 5 s and own it a frame later
        # (`timeToGetControl 0`, AI-142), and the Germans do the same back:
        # the data has no recapture block on these points.
        taken = r["gbBunkerTaken"]
        self.assertEqual(taken["team"], 2)
        self.assertEqual([("lost" in e, "got" in e) for e in taken["events"]],
                         [(True, False), (False, True)])
        self.assertAlmostEqual(taken["events"][0]["t"], 5.0, delta=0.2)
        self.assertEqual(r["gbBunkerRetaken"]["team"], 1)

    def test_gold_beach_beach_flag_does_not_move(self) -> None:
        self.assertEqual(self.r["gbBeachGermans"], {"team": 2, "events": []})

    def test_omaha_beach_needs_two_and_is_then_final(self) -> None:
        r = self.r
        self.assertEqual(r["omahaBeachOneSoldier"], {"team": 0, "events": []})
        self.assertEqual(r["omahaBeachTaken"]["team"], 2)
        self.assertEqual(r["omahaBeachGermansAfter"], {"team": 2, "events": []})

    def test_not_close_runs_down_only_a_point_with_no_takeable_team(self) -> None:
        """FHR-1: `losingControl(-1)` is refused when `onlyTakeableByTeam` is set."""
        self.assertEqual(self.r["notCloseOnlyTeam"], {"team": 1, "events": []})
        self.assertEqual(self.r["emptyLoses"]["team"], 0)

    def test_a_point_that_cannot_change_team_still_loses_its_spawns(self) -> None:
        """FHR-4: `ControlPoint::setTeam` 0x08284490 is a no-op for
        `unableToChangeTeam`, but `lostControl` still runs `CPDisable`."""
        r = self.r
        self.assertEqual(r["fixedRunDown"], {"team": 2, "events": [], "spawnsEnabled": False})
        self.assertEqual(r["fixedStillThere"]["spawnsEnabled"], False)
        self.assertEqual(r["fixedLeft"], {"team": 2, "events": [], "spawnsEnabled": True})
        # The 9999 s base of a vanilla level never moves.
        self.assertEqual(r["fixedMain"]["team"], 1)
        self.assertTrue(r["fixedMain"]["spawnsEnabled"])

