"""`viewer/ctf.js` -- Capture the Flag as the Linux server plays it, driven
headless by `ctf_harness.mjs` with `viewer/round-state.js` behind it.

The law under test is the server's (ledger CTF-1..CTF-8,
`features/ctf-mode/README.md`):

  - `FlagBase::handleUpdate` (0x08292b30): while a base's own flag is home, a
    carrier of its team on foot inside its radius captures; then the nearest
    enemy soldier inside the radius takes the home flag;
  - `Flag::handleUpdate` (0x08291a90): a flag on the ground goes home after
    `TimeToReSpawn` (30), is returned by the nearest live soldier of its own
    team inside its radius, else taken by the nearest live enemy;
  - `Flag::handleDrop` (0x08291df0): a live carrier's drop is a capture, a
    dead one's leaves the flag at the terrain height plus 1.5;
  - the scores are `handleScore`'s: Attack for a pick-up, FlagCapture for a
    capture, Defence for a return, and a CTF round ends when a side's flag
    captures reach the score limit;
  - the client's lines and `CTF.ssc` patches are 0x006e4290's.
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
HARNESS = Path(__file__).with_name("ctf_harness.mjs")
MODULES = ("ctf.js", "round-state.js")


def run_harness() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        for name in MODULES:
            shutil.copyfile(VIEWER / name, work / name)
        (work / "package.json").write_text('{"type": "module"}\n')
        shutil.copyfile(HARNESS, work / "harness.mjs")
        proc = subprocess.run(["node", str(work / "harness.mjs")],
                              capture_output=True, text=True, timeout=120)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


class CtfTests(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()

    def test_the_shipped_flag_numbers(self) -> None:
        d = self.results["defaults"]
        self.assertEqual((5, 30, [0, 7.6, 0], 1.5),
                         (d["radius"], d["timeToRespawn"], d["location"], d["drop"]))
        # A bare base keeps them.
        base = self.results["normalised"]
        self.assertEqual((5, 30, 1), (base["radius"], base["flag"]["timeToRespawn"],
                                      base["flag"]["team"]))

    def test_ctf_ssc_patches_by_the_actors_team(self) -> None:
        p = self.results["patches"]
        self.assertEqual((0, 1, 2, 3, 4, 5), (
            p["stoleAxis"], p["stoleAllied"], p["capturedAxis"], p["capturedAllied"],
            p["returnedAxis"], p["returnedAllied"]))
        self.assertIsNone(p["dropped"])

    def test_the_information_lines(self) -> None:
        lines = self.results["lines"]
        self.assertEqual("Hans [axis]: stole the flag", lines["stole"])
        self.assertEqual("Smith [Coalition]: captured the flag", lines["captured"])
        self.assertEqual("", lines["none"])

    def test_an_enemy_in_the_base_radius_takes_the_home_flag(self) -> None:
        play = self.results["play"]
        self.assertEqual([{"kind": "stole", "flag": 0, "team": 1, "player": 1}], play["stole"])
        self.assertEqual({"home": False, "carrier": 1, "carried": 2}, play["afterSteal"])
        self.assertEqual(0, play["farEvents"])

    def test_a_carrier_home_with_his_own_flag_captures(self) -> None:
        play = self.results["play"]
        self.assertEqual([{"kind": "captured", "flag": 0, "team": 1}], play["captured"])
        after = play["afterCapture"]
        self.assertTrue(after["ukHome"])
        self.assertIsNone(after["carrier"])
        # CTF's table: capture 10; the pick-up's attack is 0.
        self.assertEqual((1, 10, 1), (after["axisCaptures"], after["score"], after["flags"]))

    def test_no_capture_while_the_own_flag_is_away(self) -> None:
        play = self.results["play"]
        self.assertEqual([], play["blocked"])
        self.assertEqual({"axisCaptures": 1, "ukCarrier": 1, "geCarrier": 2}, play["whileAway"])

    def test_a_dead_carrier_drops_the_flag_on_the_ground(self) -> None:
        play = self.results["play"]
        self.assertEqual([{"kind": "dropped", "team": 2, "player": 2}], play["dropped"])
        self.assertAlmostEqual(41.5, play["dropPos"][1])

    def test_a_teammate_returns_a_dropped_flag(self) -> None:
        play = self.results["play"]
        self.assertEqual([{"kind": "returned", "team": 1, "player": 3}], play["returned"])
        self.assertEqual((3, 1), (play["returnerScore"], play["returnerDefences"]))

    def test_the_score_limit_ends_the_round(self) -> None:
        play = self.results["play"]
        self.assertEqual(["captured"], play["second"])
        self.assertEqual({"status": "endGame", "winner": 1, "reason": "score",
                          "captures": {"1": 2, "2": 0}}, play["round"])

    def test_a_flag_on_the_ground_goes_home_after_thirty_seconds(self) -> None:
        more = self.results["more"]
        self.assertEqual(30, more["seconds"])
        self.assertEqual(["home"], more["events"])

    def test_an_enemy_retakes_a_dropped_flag(self) -> None:
        self.assertEqual(["stole"], self.results["more"]["again"])

    def test_vehicles_take_capture_and_return_nothing(self) -> None:
        more = self.results["more"]
        self.assertEqual([], more["inVehicle"])
        self.assertEqual([], more["noCaptureInVehicle"])
        # ...but a carrier who climbs in keeps the flag.
        self.assertEqual(2, more["keeps"])
        self.assertTrue(more["resetHome"])

    def test_a_whole_round_ends_on_the_third_capture(self) -> None:
        r = self.results["round"]
        # Playing after the first two British captures, over on the third.
        self.assertEqual([("playing", 1), ("playing", 2), ("endGame", 3)],
                         [(s["status"], s["britCaps"]) for s in r["statusAfter"]])
        e = r["ended"]
        self.assertEqual((2, "score", 1), (e["winner"], e["reason"], e["victoryType"]))
        self.assertEqual({"1": 0, "2": 1}, e["roundsWon"])
        self.assertEqual({"1": 1, "2": 3}, e["captures"])
        self.assertEqual((3, 1), (e["smith"], e["hans"]))
        self.assertEqual(["stole:1:11", "captured:1:11", "stole:0:12", "captured:0:12",
                          "stole:1:11", "captured:1:11", "stole:1:11", "captured:1:11",
                          "stole:1:11"], r["timeline"])

    def test_the_medals_go_by_score(self) -> None:
        medals = self.results["round"]["ended"]["medals"]
        self.assertEqual([(11, "gold", 30), (12, "silver", 10), (13, "bronze", 0)],
                         [(m["playerId"], m["medal"], m["score"]) for m in medals])

    def test_nothing_scores_after_the_end(self) -> None:
        after = self.results["round"]["afterEnd"]
        self.assertEqual(1, after["carried"])
        self.assertEqual(0, after["scoreDelta"])

    def test_the_restart_keeps_the_rounds_won(self) -> None:
        r = self.results["round"]["restarted"]
        self.assertEqual("playing", r["status"])
        self.assertEqual({"1": 0, "2": 0}, r["captures"])
        self.assertEqual({"1": 0, "2": 1}, r["roundsWon"])
        self.assertTrue(r["flagsHome"])
        self.assertTrue(r["replicaHome"])

    def test_a_replica_fed_the_events_agrees_every_frame(self) -> None:
        r = self.results["round"]
        self.assertEqual(0, r["mismatches"])
        self.assertIsNone(r["unknownEvent"])

    def test_an_event_says_where_the_flag_is_now(self) -> None:
        pos = self.results["round"]["eventPositions"]
        self.assertEqual(pos["ukHome"], pos["capturedAtHome"])


if __name__ == "__main__":
    unittest.main()
