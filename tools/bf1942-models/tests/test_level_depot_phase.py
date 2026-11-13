"""A level's supply depots start at SUP-4's random phase (`level-load.js`
`depotStartPhase`, `supply.js` `depotPhase`).

The `SupplyDepot` constructor stamps each depot's last cycle at
`(rand() % 30) / 30.0` seconds of world time (lnxded `SupplyDepot` ctor, ledger
SUP-4), so depots placed together do not all fire on the same frame. The page
draws that phase from its own `random` when it has one, else `Math.random`,
which the headless runner seeds, so a seeded run repeats exactly.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
VIEWER = ROOT / "viewer"

SCRIPT = f"""
import {{ installModuleHooks, viewerDir }} from {json.dumps(str(ROOT / 'sim' / 'env.mjs'))};
import {{ mulberry32 }} from {json.dumps(str(ROOT / 'sim' / 'rng.mjs'))};
installModuleHooks(viewerDir({json.dumps(str(VIEWER))}));
const {{ depotStartPhase }} = await import({json.dumps(str(VIEWER / 'level-load.js'))});
const draw = seed => {{ const r = mulberry32(seed); return Array.from({{ length: 64 }}, () => depotStartPhase(r)); }};
console.log(JSON.stringify({{
  a: draw(7), again: draw(7), other: draw(8),
  low: depotStartPhase(() => 0), high: depotStartPhase(() => 29.5 / 0x8000), wrap: depotStartPhase(() => 30.5 / 0x8000),
}}));
"""


class DepotStartPhaseTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        if shutil.which("node") is None:
            raise unittest.SkipTest("node is not installed")
        proc = subprocess.run(["node", "--input-type=module", "-e", SCRIPT],
                              capture_output=True, text=True, timeout=60, cwd=ROOT)
        if proc.returncode != 0:
            raise AssertionError(proc.stderr)
        cls.r = json.loads(proc.stdout.strip().splitlines()[-1])

    def test_the_phase_is_a_thirtieth_of_a_second_in_0_to_29(self) -> None:
        for p in self.r["a"]:
            self.assertGreaterEqual(p, 0)
            self.assertLess(p, 1)
            self.assertAlmostEqual(round(p * 30), p * 30, places=9)
        self.assertEqual(0, self.r["low"])
        # rand() % 30: 29 is the last phase and 30 wraps to 0.
        self.assertAlmostEqual(29 / 30, self.r["high"])
        self.assertEqual(0, self.r["wrap"])

    def test_a_seed_repeats_and_spreads(self) -> None:
        self.assertEqual(self.r["a"], self.r["again"])
        self.assertNotEqual(self.r["a"], self.r["other"])
        self.assertGreater(len(set(self.r["a"])), 10)

    def test_every_level_depot_takes_one(self) -> None:
        # The walk is shared with the room server (`supply-collect.js`); the
        # page hands it its own `random`.
        source = (VIEWER / "supply-collect.js").read_text()
        start = source.index("function collectSupplyDepots")
        body = source[start:source.index("depots.push(", start) + 400]
        self.assertIn("phase: depotStartPhase(", body)
        page = (VIEWER / "level-load.js").read_text()
        start = page.index("function collectSupplyDepots")
        self.assertIn("page.random", page[start:start + 400])


if __name__ == "__main__":
    unittest.main()
