"""A bot's shot cadence per weapon class (`tests/bot_bolt_cadence_harness.mjs`).

The owner's FH report was that bots fire their bolt-action rifles with no
bolt cycle between rounds. The retail gate on a soldier's next round is the
weapon's own `FireArms` timer (`timeToFireFinished`, set to `1 / roundOfFire`
by each round, `FireArms::handleMessage` 0x082895c0, ledger GUN-5, GUN-13), and
the bolt-cycle state a fire state returns to in FH and FHSW does not gate it.
The referee implements exactly that for every bot, so these tests pin it for
a bolt rifle, a semi-automatic and an automatic, FH's data and vanilla's:

* the gap between rounds in one magazine is the float32 timer's whole ticks
  (`30 / ceil(30 / roundOfFire)` a second, GUN-13);
* the magazine's reload begins once the last round's cycle has run out and
  nothing fires while it runs (`reloadTime` plus one cycle between magazines);
* a bolt rifle's cadence is far slower than a semi-automatic's, so a bot never
  works a bolt rifle at a self-loader's rate.
"""

from __future__ import annotations

import json
import shutil
import struct
import subprocess
import unittest
from pathlib import Path

HARNESS = Path(__file__).resolve().parent / "bot_bolt_cadence_harness.mjs"


def f32(x: float) -> float:
    return struct.unpack("f", struct.pack("f", x))[0]


def cycle_ticks(rate: float) -> int:
    """Ticks a round's timer takes to run out: the engine's float32 timer set
    to `1 / roundOfFire` and counted down by the tick's dt (GUN-13), so a
    `roundOfFire 6` gun waits a sixth tick (`0.1666667f` minus five `1/30f`
    is still above zero) and fires 5 rounds a second."""
    timer, dt, n = f32(1.0 / rate), f32(1.0 / 30.0), 0
    while timer > 0:
        timer = f32(timer - dt)
        n += 1
    return n


def run_harness() -> list[dict]:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    proc = subprocess.run(["node", str(HARNESS)], capture_output=True, text=True, timeout=300)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout.strip().splitlines()[-1])["rows"]


class BotCadenceTests(unittest.TestCase):
    rows: list[dict]

    @classmethod
    def setUpClass(cls) -> None:
        cls.rows = run_harness()

    def test_gap_inside_a_magazine_is_the_weapons_own_whole_tick_cycle(self) -> None:
        for r in self.rows:
            want = cycle_ticks(r["roundOfFire"]) / 30.0
            with self.subTest(weapon=f'{r["mod"]} {r["name"]}'):
                self.assertAlmostEqual(r["withinMin"], want, places=3)
                self.assertAlmostEqual(r["withinMax"], want, places=3)

    def test_a_reload_waits_for_the_cycle_and_nothing_fires_during_it(self) -> None:
        for r in self.rows:
            with self.subTest(weapon=f'{r["mod"]} {r["name"]}'):
                self.assertEqual(r["firedWhileReloading"], 0)
                self.assertIsNotNone(r["acrossMin"])
                # The last round's cycle, then the reload, then the next round.
                self.assertGreaterEqual(r["acrossMin"], r["withinMin"] + r["reloadTime"] - 1e-6)
                self.assertLess(r["acrossMin"], r["withinMin"] + r["reloadTime"] + 0.1)

    def test_a_bolt_rifle_is_never_worked_at_a_self_loaders_rate(self) -> None:
        bolt = [r for r in self.rows if r["cls"] == "bolt"]
        fast = [r for r in self.rows if r["cls"] != "bolt"]
        self.assertTrue(bolt and fast)
        for r in bolt:
            # FH's No4 is 1.0 s and the slowest of FH's bolt rifles 1.33 s;
            # vanilla's are 2.7 s. None is under a second.
            self.assertGreaterEqual(r["withinMin"], 1.0 - 1e-6, r["name"])
        for r in fast:
            self.assertLess(r["withinMin"], 0.5, r["name"])

    def test_every_bot_magazine_is_spent_and_reloaded(self) -> None:
        for r in self.rows:
            with self.subTest(weapon=f'{r["mod"]} {r["name"]}'):
                self.assertGreater(r["shots"], r["size"])


if __name__ == "__main__":
    unittest.main()
