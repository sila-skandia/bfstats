"""`viewer/spawn-timer.js`: the authority-mode "TIME TO SPAWN: N" countdown.

Grounded in the lnxded RE (features/server-authoritative-multiplayer/README.md):
spawning is wave-based -- `serverSpawnTime` (period, default 15) and
`serverSpawnDelay` (min wait after death, default 5), the waves a global grid on
the server clock. The number is computed the way the retail client's own is, from
the wave params and the running server clock; the spawn itself stays
server-authoritative, so a wrong wave period only mistimes the DISPLAY.

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
        for name in _closure("spawn-timer.js"):
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

    def test_counts_to_the_next_global_wave_after_the_delay(self) -> None:
        """Died at t=100 with delay 5, wave 15: eligible at 105, the next grid
        boundary (k*15) at or after 105 is 105 itself (7*15=105), so at t=100 the
        wait is 5 s; at t=103 it is 2 s."""
        self.assertEqual(self.out["onBoundary"]["at100"], 5)
        self.assertEqual(self.out["onBoundary"]["at103"], 2)

    def test_a_death_between_boundaries_waits_for_the_next(self) -> None:
        """Died at t=104 (+5 = 109 eligible); the next boundary is 120, so the
        countdown is 16 s at death and 1 s at t=119 -- never a fraction of a wave
        early."""
        self.assertEqual(self.out["midWave"]["atDeath"], 16)
        self.assertEqual(self.out["midWave"]["justBefore"], 1)

    def test_zero_once_the_wave_is_due(self) -> None:
        self.assertEqual(self.out["midWave"]["atBoundary"], 0)

    def test_no_waves_is_the_flat_delay_from_death(self) -> None:
        """`serverSpawnTime <= 0`: no grid, the countdown is just the delay."""
        self.assertEqual(self.out["noWaves"]["atDeath"], 5)
        self.assertEqual(self.out["noWaves"]["half"], 2)

    def test_null_before_any_death_or_clock(self) -> None:
        self.assertIsNone(self.out["noDeath"])
        self.assertIsNone(self.out["noClock"])

    def test_the_deploy_line_text(self) -> None:
        self.assertEqual(self.out["line"]["waiting"], "TIME TO SPAWN: 7")
        self.assertEqual(self.out["line"]["due"], "SELECT A SPAWN POINT")
        self.assertEqual(self.out["line"]["beforeDeath"], "SELECT A SPAWN POINT")

    def test_a_future_seed_is_unbounded_a_reseeded_one_is_bounded(self) -> None:
        """A diedAt left in the future by a server-clock reset makes the grid
        compute a wait far beyond one wave (the live "TIME TO SPAWN: 2118");
        net-room re-seeds on the regression so the seed is <= now and the wait
        is bounded by one delay plus one wave."""
        r = self.out["clockReset"]
        self.assertGreater(r["staleFuture"], 2000)
        self.assertTrue(r["reseeded"])


if __name__ == "__main__":
    unittest.main()
