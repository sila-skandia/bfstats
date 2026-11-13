"""When a soldier's hurt grunt and "Watch your aim!" sound,
`viewer/soldier-voice-gates.js`, run under node by
`soldier_voice_gates_harness.mjs`."""

from __future__ import annotations

import json
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
VIEWER = ROOT / "viewer"
HARNESS = Path(__file__).with_name("soldier_voice_gates_harness.mjs")


def run_harness() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        shutil.copyfile(VIEWER / "soldier-voice-gates.js", work / "soldier-voice-gates.js")
        (work / "package.json").write_text('{"type":"module"}\n')
        shutil.copyfile(HARNESS, work / "harness.mjs")
        proc = subprocess.run(["node", str(work / "harness.mjs")],
                              capture_output=True, text=True, timeout=60)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


class SoldierVoiceGateTests(unittest.TestCase):
    r: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.r = run_harness()

    def test_watch_your_aim_is_a_team_rounds_touch_once_in_three_seconds_each(self) -> None:
        # `BFSoldier::projectileHit` lnxded 0x0827ea20: round team == the
        # soldier's player team (0x0827ea4f), more than 3.0 s (0x086d2740)
        # since that soldier's own stamp `+0x56c`; `noFFSound` skips it
        # (`Projectile::handleCollision` 0x0831efe6).
        self.assertEqual(3.0, self.r["gap"])
        self.assertEqual([True, False, True, False, True, False, False], self.r["ff"])

    def test_the_hurt_grunt_keeps_a_clock_per_soldier(self) -> None:
        # `SoldierSound::triggerSound` (Mac client 0x000611a0, case 0x13) on
        # each soldier's own SoldierSound, 1.0 + 0.2 * rand between two.
        self.assertEqual([True, False, True, False, True], self.r["hurt"])

    def test_every_direct_round_path_asks_for_it(self) -> None:
        page = (VIEWER / "map.html").read_text()
        self.assertIn("onHit: (bot, hit) => roundTouchedSoldier(hit.targetId, bot.team)", page)
        self.assertIn("page.roundTouchedSoldier?.(best, myTeam);", (VIEWER / "hand-fire.js").read_text())
        # A seat gun's round carries its template's `noFFSound` (0x0831efe6).
        self.assertIn("page.roundTouchedSoldier?.(id, firerTeam, !!record.noFFSound);",
                      (VIEWER / "vehicle-hits.js").read_text())
        self.assertIn("|| noFFSound) return;", page)
        # No damage-driven copy left on the human's own hurt path.
        local = (VIEWER / "local-player.js").read_text()
        self.assertNotIn("playSoldierHurtSound(isFriendlyFire)", local)


if __name__ == "__main__":
    unittest.main()
