"""The local player's own grenade, mine or pack on a real server is drawn once.

The retail client's `FireArms::Fire` launches no round of a networked
projectile: when the projectile template's networkableInfo is not empty and
the game answers IGameClient (0x1d4c2), it jumps over the barrel loop
(BF1942.exe `0x0053db29`..`0x0053db61`; lnxded `0x0828a090` has the same test),
and the server ghosts the thrower his own round like anyone else's. So the
round he sees is the server's alone. The page drew its own at the throw and
then the server's a round trip later. Ledger NET-15.

The fixture is a lab session (Wake, 2026-10-25, `lab/own_round_probe.mjs`)
in which the sidecar's own soldier threw three grenades.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

from tests.test_sidecar_join import VIEWER, _closure

HERE = Path(__file__).resolve().parent
HARNESS = HERE / "sidecar_own_round_harness.mjs"
FIXTURE = HERE / "fixtures" / "sidecar_own_throw.ndjson.gz"


def run_harness() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        for name in _closure("net-sidecar.js", "net-server-rounds.js", "gunfire.js"):
            (work / name).parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(VIEWER / name, work / name)
        (work / "node_modules" / "three").mkdir(parents=True)
        shutil.copyfile(VIEWER / "vendor" / "three.module.js",
                        work / "node_modules" / "three" / "three.module.js")
        (work / "node_modules" / "three" / "package.json").write_text(json.dumps({
            "name": "three", "version": "0.0.0", "type": "module",
            "main": "three.module.js", "exports": "./three.module.js"}))
        (work / "package.json").write_text('{"type":"module"}\n')
        shutil.copyfile(HARNESS, work / "harness.mjs")
        proc = subprocess.run(["node", str(work / "harness.mjs"), str(FIXTURE)],
                              capture_output=True, text=True, timeout=120)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr[-4000:]}")
    return json.loads(proc.stdout.strip().splitlines()[-1])


class OwnRoundTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.out = run_harness()

    def test_the_server_ghosts_the_thrower_his_own_rounds(self) -> None:
        out = self.out
        self.assertEqual(out["owned"], [609, 610, 611])
        # Each of the three throws comes back as rows the page draws, first
        # seen a hand's reach from his soldier, and each goes off on the
        # server's word.
        self.assertEqual(out["shown"], [609, 610, 611])
        self.assertEqual(len(out["firstAway"]), 3)
        for metres in out["firstAway"]:
            self.assertLess(metres, 4.0)
        self.assertEqual(out["detonates"], [609, 610, 611])

    def test_the_page_throws_none_of_its_own_once_the_server_pools_it(self) -> None:
        self.assertTrue(self.out["pooled"])
        self.assertEqual(self.out["afterPool"], {"launched": 0, "onShot": 1})

    def test_a_round_the_server_does_not_fly_is_still_the_pages_own(self) -> None:
        # Before the pool row, and a rifle's bullet: launched by the page.
        self.assertEqual(self.out["beforePool"], {"launched": 1, "onShot": 1})
        self.assertEqual(self.out["rifle"], {"launched": 1, "onShot": 1})


if __name__ == "__main__":
    unittest.main()
