"""The jet pack's bar in a replay (`viewer/replay-pack-heat.js`,
`replay-hud.js`).

Why it exists. A 2026-11-28 report: in Secret Weapons the jet pack's bar was
not visible. The page's own soldier feeds `Recover/*` from the pack
(soldier-hud.js), but the replay's first person wrote nothing there, so a
replayed flier's HUD had no fuel bar. The recording carries no heat: the bar
is the recorded heat (bf42plus `kh`) where the file has it, and otherwise the
pack's own heat law over the burns his heights show. Retail's bar is the heat
(`menu::Soldier::update` 0x006E98D7 -> setRecoverData(3, heat)), filling as
the pack heats.
"""

from __future__ import annotations

import shutil
import subprocess
import unittest
from pathlib import Path

HARNESS = Path(__file__).resolve().parent / "test_replay_pack_heat.mjs"


class ReplayPackHeatTest(unittest.TestCase):
    def test_heat(self) -> None:
        if shutil.which("node") is None:
            raise unittest.SkipTest("node is not installed")
        proc = subprocess.run(["node", str(HARNESS)], capture_output=True, text=True, timeout=60)
        self.assertEqual(proc.returncode, 0, proc.stderr + proc.stdout)


if __name__ == "__main__":
    unittest.main()
