"""`audit_render_rules.mjs`: which model frames the render audit flags.

2026-10-19: the FHSW and FHSWEurope render gates flagged 48 and 20 models
`0 px` and made them blockers. Every one is a placeholder: a PlayerControlObject
whose only drawn geometry is one triangle 0.02 m across (`ratte_88_dummy_m1`,
`CNSPAirDummy`: the killer cages, spawn breakers, ammo-box depots) or the hard
AT mine's 0.08 m `mine_invisible`. Their business is a SupplyDepot radius and
retail draws nothing there either.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RULES = ROOT / "audit_render_rules.mjs"
LIMITS = {"white": 0.35, "magenta": 0.05, "black": 0.6}


def verdicts(cases: list[dict]) -> list[bool]:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    script = (f"import {{ modelFlagged }} from {json.dumps(RULES.as_uri())};\n"
              f"const cases = {json.dumps(cases)};\n"
              f"console.log(JSON.stringify(cases.map(c => modelFlagged(c.m, c.row, {json.dumps(LIMITS)}))));\n")
    proc = subprocess.run(["node", "--input-type=module", "-e", script],
                          capture_output=True, text=True, timeout=60)
    if proc.returncode != 0:
        raise AssertionError(proc.stderr)
    return json.loads(proc.stdout)


def row(px, white=0.0, magenta=0.0, black=0.0):
    return {"model": px, "white": white, "magenta": magenta, "black": black}


class ModelVerdicts(unittest.TestCase):
    def test_a_killer_cage_placeholder_is_not_flagged(self):
        cage = {"name": "AllieskillerCage5mHard", "tris": 1, "extent": 0.02}
        mine = {"name": "ATMineHard", "tris": 1, "extent": 0.084}
        self.assertEqual([False, False], verdicts([{"m": cage, "row": row(0)},
                                                   {"m": mine, "row": row(81)}]))

    def test_a_real_small_model_that_drew_nothing_is_still_flagged(self):
        grenade = {"name": "Grenade97", "tris": 634, "extent": 0.171}
        tank = {"name": "Tiger", "tris": 4000, "extent": 8.4}
        self.assertEqual([True, True], verdicts([{"m": grenade, "row": row(0)},
                                                 {"m": tank, "row": row(150)}]))

    def test_a_one_triangle_sprite_a_metre_across_is_judged(self):
        smoke = {"name": "BuildingSmokeIdleDark", "tris": 1, "extent": 1.0}
        self.assertEqual([True], verdicts([{"m": smoke, "row": row(0)}]))

    def test_colour_shares_still_flag_a_drawn_model(self):
        tank = {"name": "Tiger", "tris": 4000, "extent": 8.4}
        self.assertEqual([True, False], verdicts([{"m": tank, "row": row(5000, white=0.8)},
                                                  {"m": tank, "row": row(5000, white=0.1)}]))


if __name__ == "__main__":
    unittest.main()
