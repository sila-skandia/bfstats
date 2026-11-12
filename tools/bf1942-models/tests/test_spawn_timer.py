"""`viewer/spawn-timer.js`: the authority-mode "TIME TO SPAWN: N" countdown.

The server's own wait wins; this is the fallback, and it follows lnxded's wave
law: windows of 5 s every `serverSpawnTime` (20) + 5 s from the round's start
(`resetTimers` 0x08157790, `gameStatusPlaying` 0x08152806), and `killPlayer`
(0x0814d920) waits for the next window when more than a window's length is
left to it, else the one after (findings modes-spawns-supply F3, netcode F7).
`serverSpawnDelay` (default 3) is the flat wait with waves off.

Driven headless by `spawn_timer_harness.mjs`.
"""

from __future__ import annotations

import json
import posixpath
import re
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

VIEWER = Path(__file__).resolve().parents[1] / "viewer"
HARNESS = Path(__file__).resolve().parent / "spawn_timer_harness.mjs"


def _closure(entry: str) -> set[str]:
    seen: set[str] = set()
    queue = [entry]
    while queue:
        name = queue.pop()
        if name in seen or not (VIEWER / name).exists():
            continue
        seen.add(name)
        here = posixpath.dirname(name)
        for spec in re.findall(r"from '(\.\.?/[^']+\.js)'", (VIEWER / name).read_text()):
            queue.append(posixpath.normpath(posixpath.join(here, spec)))
    return seen


def run_harness() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        for name in _closure("spawn-timer.js") | _closure("team-to-add.js"):
            (work / name).parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(VIEWER / name, work / name)
        (work / "package.json").write_text('{"type":"module"}\n')
        shutil.copyfile(HARNESS, work / "harness.mjs")
        proc = subprocess.run(["node", str(work / "harness.mjs")],
                              capture_output=True, text=True, timeout=60)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


class SpawnTimerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.out = run_harness()

    def test_engine_defaults(self) -> None:
        """`Setup::initServerSettings` 20 / 3 (0x080c09e6 / 0x080c09ed) and
        the 5 s window of `GameServer::init`."""
        self.assertEqual(self.out["defaults"], {"time": 20, "delay": 3, "window": 5})

    def test_a_death_as_a_window_opens_waits_for_the_next(self) -> None:
        self.assertEqual(self.out["onBoundary"]["at100"], 25)
        self.assertEqual(self.out["onBoundary"]["at103"], 22)

    def test_a_death_inside_the_window_waits_for_the_next(self) -> None:
        self.assertEqual(self.out["midWave"]["atDeath"], 21)
        self.assertEqual(self.out["midWave"]["justBefore"], 1)

    def test_zero_once_the_wave_is_due(self) -> None:
        self.assertEqual(self.out["midWave"]["atBoundary"], 0)

    def test_more_than_a_window_to_go_is_the_countdown(self) -> None:
        self.assertEqual(self.out["countdown"], {"wait": 15, "atDeath": 15})

    def test_a_window_or_less_to_go_skips_to_the_one_after(self) -> None:
        self.assertEqual(self.out["lateDeath"], {"wait": 29, "atDeath": 29})
        self.assertEqual(self.out["edge"], 30)

    def test_no_waves_is_the_flat_delay_from_death(self) -> None:
        """`serverSpawnTime <= 0`: no grid, the countdown is the delay, 0..127."""
        self.assertEqual(self.out["noWaves"]["atDeath"], 5)
        self.assertEqual(self.out["noWaves"]["half"], 2)
        self.assertEqual(self.out["noWaves"]["defaultDelay"], 3)
        self.assertEqual(self.out["noWaves"]["clamped"], 127)

    def test_null_before_any_death_or_clock(self) -> None:
        self.assertIsNone(self.out["noDeath"])
        self.assertIsNone(self.out["noClock"])

    def test_the_pre_game_plate_reads_time_until_game_starts(self) -> None:
        lab = self.out["label"]
        self.assertEqual("TIME UNTIL GAME STARTS:", lab["pre"])
        self.assertEqual("TIME TO SPAWN:", lab["play"])
        self.assertEqual("TIME UNTIL GAME STARTS:", lab["bare"])

    def test_the_deploy_line_text(self) -> None:
        self.assertEqual(self.out["line"]["waiting"], "TIME TO SPAWN: 2")
        self.assertEqual(self.out["line"]["due"], "SELECT A SPAWN POINT")
        self.assertEqual(self.out["line"]["beforeDeath"], "SELECT A SPAWN POINT")

    def test_a_future_seed_is_unbounded_a_reseeded_one_is_bounded(self) -> None:
        """A diedAt left in the future by a server-clock reset makes the grid
        compute a wait far beyond one wave (the live "TIME TO SPAWN: 2118");
        net-room re-seeds on the regression so the seed is <= now and the wait
        is bounded by one cycle plus one window."""
        r = self.out["clockReset"]
        self.assertGreater(r["staleFuture"], 2000)
        self.assertTrue(r["reseeded"])


    def test_the_gate_holds_until_the_window_then_rearms_at_its_close(self) -> None:
        """The wave as a gate (SPAWN-35): `gameStatusPlaying` stands a dead
        player once their wait is spent (0x08152917..0x08152987); a spent wait
        not taken by the window's close is re-armed to the next window
        (0x0815288c..0x081528ab)."""
        g = self.out["gate"]
        self.assertEqual(125, g["readyAt"])
        self.assertEqual(15, g["atDeath"])
        self.assertEqual(0, g["atOpen"])
        self.assertEqual(0, g["inWindow"])
        self.assertEqual(19, g["afterClose"])
        self.assertEqual(0, g["nextWindow"])
        self.assertEqual(0, g["hair"])
        self.assertEqual(0, g["noDeath"])
        self.assertEqual([3, 0], g["noWaves"])

    def test_get_team_to_add_player(self) -> None:
        """`PlayerManager::getTeamToAddPlayer` 0x08261670: the side over its
        ratio share loses the newcomer; level, the closer split with them
        counted; a tie to `rand() & 1` + 1 (0x0826179e)."""
        t = self.out["teamToAdd"]
        self.assertEqual([1, 2], t["empty"])
        self.assertEqual([2, 1], t["fewer"])
        self.assertEqual([1, 2], t["tie"])
        self.assertEqual(2, t["ratioFirst"])
        self.assertEqual([8, 8], t["topUp"])
        self.assertEqual([7, 9], t["topUp34"])


if __name__ == "__main__":
    unittest.main()
