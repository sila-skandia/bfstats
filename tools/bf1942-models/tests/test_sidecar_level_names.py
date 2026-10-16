"""`sidecar/names.mjs` namesForLevel: a template id is the level's own load order.

Wake's names (the class map was read there) hold on another level only when that
level's own known ids agree with Wake's on every one they share (Midway: 25 of 25),
and never for a level's own templates (its control points). El Alamein, whose ids
differ (a Sherman is 2914 there, 2916 on Wake), borrows none.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import unittest
from pathlib import Path

SIDECAR = Path(__file__).resolve().parents[1] / "sidecar"

SCRIPT = """
import('./names.mjs').then((m) => {
  const out = {};
  for (const l of ['wake', 'midway', 'el_alamein']) {
    const a = m.namesForLevel(`bf1942/levels/${l}/`);
    out[l] = { n1325: a.tidNames['1325'] ?? null, n3601: a.tidNames['3601'] ?? null, n3582: a.tidNames['3582'] ?? null,
               n2914: a.tidNames['2914'] ?? null, n2916: a.tidNames['2916'] ?? null };
  }
  console.log(JSON.stringify(out));
});
"""


class LevelNamesTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        if shutil.which("node") is None:
            raise unittest.SkipTest("node is not installed")
        proc = subprocess.run(["node", "--input-type=module", "-e", SCRIPT], cwd=SIDECAR,
                              capture_output=True, text=True, timeout=60)
        if proc.returncode != 0:
            raise AssertionError(proc.stderr)
        cls.r = json.loads(proc.stdout)

    def test_wake_keeps_its_own_names(self) -> None:
        self.assertEqual(self.r["wake"]["n2916"], "Sherman")
        self.assertEqual(self.r["wake"]["n3601"], "The_Airfield")

    def test_a_level_in_wakes_order_borrows_shared_templates_only(self) -> None:
        self.assertEqual(self.r["midway"]["n1325"], "LandmineProjectile")
        self.assertEqual(self.r["midway"]["n3582"], "The_Airfield")
        self.assertIsNone(self.r["midway"]["n3601"])

    def test_a_level_in_another_order_borrows_nothing(self) -> None:
        self.assertEqual(self.r["el_alamein"]["n2914"], "Sherman")
        self.assertIsNone(self.r["el_alamein"]["n2916"])
        self.assertIsNone(self.r["el_alamein"]["n1325"])


if __name__ == "__main__":
    unittest.main()
