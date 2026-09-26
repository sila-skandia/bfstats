"""The headless runner's round tickets: `sim/match.mjs` over `viewer/round-state.js`.

The runner plays the page's round (`createRoundState`). A round starts each
side at the level's count times the server's max players over 16, truncated,
and a side bleeds a whole ticket every `60 / (rate x maxPlayers / 16)` s while
the enemy's summed `areaValue` is over 99 (ledger TKT-1..TKT-4); a level's own
`tickets.maxPlayers` (Kasserine Pass co-op's 18) sets the start and not the
bleed. `sim/run.mjs --max-players N` names the server. Without it the server
is the bots, 2 x `--bots`: the engine's top-up fills every slot of a bot
server, so its population is its slot count, which is `map.html`'s rule too.

`tests/sim_tickets_harness.mjs` sets matches up on the synthetic level with
other levels' tickets and control points; the rest runs `sim/run.mjs`.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RUN = ROOT / "sim" / "run.mjs"
HARNESS = ROOT / "tests" / "sim_tickets_harness.mjs"


def node(*args: object) -> subprocess.CompletedProcess:
    return subprocess.run(["node", *map(str, args)], capture_output=True, text=True, timeout=300)


def run_match(out: Path, *extra: str) -> tuple[dict, dict]:
    """A one-second match, 2 bots a side: the trace's header and the summary."""
    proc = node(RUN, "--synthetic", "--bots", "2", "--time", "1", "--seed", "1", "--trace-every", "30",
                "--quiet", "--out", out, *extra)
    if proc.returncode != 0:
        raise AssertionError(f"sim/run.mjs failed:\n{proc.stderr}")
    head = json.loads((out / "trace.jsonl").read_text().splitlines()[0])
    return head, json.loads((out / "summary.json").read_text())


@unittest.skipIf(shutil.which("node") is None, "node is not installed")
class SimTicketTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.tmp = tempfile.TemporaryDirectory()
        base = Path(cls.tmp.name)
        cls.head, cls.summary = run_match(base / "bots")
        cls.head32, cls.summary32 = run_match(base / "named", "--max-players", "32")
        proc = node(HARNESS)
        if proc.returncode != 0:
            raise AssertionError(f"harness failed:\n{proc.stderr}")
        cls.results = json.loads(proc.stdout)

    @classmethod
    def tearDownClass(cls) -> None:
        cls.tmp.cleanup()

    def test_the_server_is_the_bots_unless_named(self) -> None:
        # 2 a side is a 4-slot server: the synthetic level's 100 and 5 a minute
        # are 25 and 1.25.
        self.assertEqual(4, self.head["maxPlayers"])
        self.assertEqual({"1": 25, "2": 25}, self.head["tickets"])
        self.assertEqual({"1": 1.25, "2": 1.25}, self.head["lossPerMin"])
        self.assertEqual(4, self.summary["maxPlayers"])
        self.assertEqual([0, 25, 25], self.summary["metrics"]["ticketsOverTime"][0])
        # 3 a side: 100 x 6 / 16 = 37.5, truncated.
        self.assertEqual(6, self.results["population"]["maxPlayers"])
        self.assertEqual({"1": 37, "2": 37}, self.results["population"]["tickets"])

    def test_max_players_names_the_server(self) -> None:
        # The parity lab's 32 slots: 100 starts at 200, as Wake co-op's does there.
        self.assertEqual(32, self.head32["maxPlayers"])
        self.assertEqual(32, self.head32["startPlayers"])
        self.assertEqual({"1": 200, "2": 200}, self.head32["tickets"])
        self.assertEqual({"1": 10, "2": 10}, self.head32["lossPerMin"])
        self.assertEqual(32, self.summary32["maxPlayers"])
        self.assertEqual([0, 200, 200], self.summary32["metrics"]["ticketsOverTime"][0])
        self.assertEqual(32, self.results["named"]["maxPlayers"])
        self.assertEqual({"1": 200, "2": 200}, self.results["named"]["tickets"])

    def test_the_bleed_runs_at_the_servers_rate(self) -> None:
        # Every control point the Axis's, 150 of weight: the Allies lose a whole
        # ticket every 60 / (5 x 8/16) = 24 s of their 50, or every 6 s of their
        # 200, and run out in 1200 s either way.
        bleed = self.results["bleed"]
        self.assertEqual({"1": 50, "2": 50}, bleed["8"]["before"])
        self.assertEqual({"1": 50, "2": 48}, bleed["8"]["minute"])
        self.assertEqual({"1": 200, "2": 200}, bleed["32"]["before"])
        self.assertEqual({"1": 200, "2": 190}, bleed["32"]["minute"])
        for players, start in (("8", 50), ("32", 200)):
            self.assertEqual({"1": 150, "2": 0}, bleed[players]["weight"])
            self.assertTrue(bleed[players]["over"])
            self.assertEqual({"1": start, "2": 0}, bleed[players]["after"])
            self.assertAlmostEqual(1200, bleed[players]["out"], delta=1 / 30 + 1e-9)

    def test_half_the_points_bleed_the_enemy_when_they_weigh_over_99(self) -> None:
        # Battle of Britain: the Allied_Base owns no spawns and cannot change
        # hands, so it is no flag, but it weighs 150. The Allies hold three of
        # six points, no more than half, and the Axis bleeds its 4 a minute
        # from the first tick: a ticket every 15 s, the first between the 14 s
        # and 16 s samples.
        britain = self.results["britain"]
        self.assertEqual(6, britain["points"])
        self.assertEqual(5, britain["flags"])
        self.assertEqual({"0": 1, "1": 2, "2": 3}, britain["held"])
        self.assertEqual({"1": 50, "2": 200}, britain["firstTick"]["weight"])
        self.assertEqual({"1": True, "2": False}, britain["firstTick"]["bleeding"])
        self.assertEqual({"1": 100, "2": 100}, britain["before"])
        self.assertEqual(61, britain["clock"])
        self.assertEqual({"1": 96, "2": 100}, britain["after"])
        self.assertEqual([[14, 100, 100], [16, 99, 100]], britain["samples"])

    def test_more_than_half_the_points_under_99_bleed_nobody(self) -> None:
        # Wake: the US's five points weigh 100, and Japan bleeds 15 a minute x
        # 32/16, a ticket every 2 s (the lab's measurement). Japan taking one
        # point leaves the US four of five and 80: Japan's bleed stops.
        wake = self.results["wake"]
        self.assertEqual({"1": 0, "2": 100}, wake["allUs"]["weight"])
        self.assertEqual({"1": 195, "2": 200}, wake["allUs"]["tickets"])
        taken = wake["oneTaken"]
        self.assertEqual({"0": 0, "1": 1, "2": 4}, taken["held"])
        self.assertEqual({"1": 20, "2": 80}, taken["weight"])
        self.assertEqual({"1": False, "2": False}, taken["bleeding"])
        self.assertEqual({"1": 195, "2": 200}, taken["tickets"])

    def test_a_point_with_no_spawns_changes_hands_and_weighs_for_its_holder(self) -> None:
        # Midway's sea areas: 40 each, neutral, no `spawnGroupId`. They are
        # capture-only flags, after the synthetic level's five, among the
        # runner's control points and weighed by their live owner.
        sea = self.results["sea"]
        five = ["AlliedBase", "Home", "Middle", "Enemy", "AxisBase"]
        self.assertEqual(five + ["North_Sea", "South_Sea"], sea["setup"]["flags"])
        self.assertEqual(2, sea["setup"]["captureOnly"])
        self.assertEqual(five + ["North_Sea", "South_Sea"], sea["setup"]["controlPoints"])
        self.assertEqual({"1": 50, "2": 50}, sea["before"]["weight"])
        # An Allied bot alone in each for 11 s takes it by the law.
        self.assertEqual([[2, 0], [2, 2]], sea["taken"])
        self.assertEqual([2, 2], sea["owners"])
        # 50 + 80 over 99: the Axis bleeds a ticket every 12 s, two in 25 s.
        self.assertEqual({"1": 50, "2": 130}, sea["after"]["weight"])
        self.assertEqual({"1": True, "2": False}, sea["after"]["bleeding"])
        self.assertEqual({"1": 100, "2": 100}, sea["tickets"])
        self.assertEqual({"1": 98, "2": 100}, sea["bled"])
        self.assertEqual(0, sea["atSea"])

    def test_a_levels_own_max_players_sets_the_start_and_not_the_bleed(self) -> None:
        # Kasserine Pass co-op on a 32-slot server: 100 x 18 / 16 = 112.5 -> 112,
        # and its 15 a minute x 32 / 16.
        kp = self.results["kasserine"]
        self.assertEqual({"1": 112, "2": 112}, kp["tickets"])
        self.assertEqual({"1": 30, "2": 30}, kp["lossPerMin"])
        self.assertEqual(32, kp["maxPlayers"])
        self.assertEqual(18, kp["startPlayers"])
        # The level's own numbers are left as they were.
        self.assertEqual(100, kp["level"]["team1"])
        self.assertEqual(15, kp["level"]["lossPerMin"]["team1"])

    def test_a_layer_with_no_tickets_starts_at_a_scaled_hundred(self) -> None:
        none = self.results["none"]
        self.assertEqual({"1": 50, "2": 50}, none["tickets"])
        self.assertEqual({"1": 0, "2": 0}, none["lossPerMin"])

    def test_a_server_the_engine_cannot_run_is_refused(self) -> None:
        for bad in ("0", "65", "2.5", "x"):
            proc = node(RUN, "--synthetic", "--max-players", bad)
            self.assertNotEqual(0, proc.returncode, bad)
            self.assertIn(f"--max-players {bad}: expected a whole number from 1 to 64", proc.stderr)


if __name__ == "__main__":
    unittest.main()
