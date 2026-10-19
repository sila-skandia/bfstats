"""A spawn point the combat area would kill is picked only as a last resort.

Root-caused on FHSWEurope stashuv_area (2026-10-19): the level's own
`singleplayer/SoldierSpawns.con` places `russianhq1` at 144.53/81.30/347.85 —
1240 m west of the `russianhqtemplate` flag at 1384/361, on terrain material 7
("Reserved (Outside map)", the CA-5 out-of-bounds material), a dropped digit
beside its five siblings at x 1344..1467. The engine offers the point and
draws `rand() %` over the pool (SPAWNGRP-10), so retail CoOp lands a Soviet
there one life in six and the out-of-area damage (10 s allowance, then
5 HP/s against 30 HP) kills him ~16 s in. The viewer's deterministic walk
landed there EVERY life, so every team-2 CoOp soldier died mid-magazine —
the behaviour audit read it as five `kit.reload-never-completes` (death stops
`footFire`, and with it the reload clock; `soldier-view.js` line ~278).

The fix keeps the deterministic walk and orders a point standing in the
damage field (outside the rectangle, or on the CA-5 material) out of the
usable pool, exactly as `paratrooper` and `onlyForAI` points already are,
falling back to the full pool when the flag offers nothing else.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
HARNESS = Path(__file__).resolve().parent / "combat_area_spawn_pick_harness.mjs"

_cache: dict | None = None


def run_harness() -> dict:
    global _cache
    if _cache is not None:
        return _cache
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    result = subprocess.run(["node", str(HARNESS)], cwd=ROOT,
                            capture_output=True, text=True, timeout=120)
    if result.returncode != 0:
        raise AssertionError(f"harness failed:\n{result.stderr}")
    _cache = json.loads(result.stdout)
    return _cache


class CombatAreaSpawnPickTests(unittest.TestCase):
    def test_a_point_in_the_damage_field_is_walked_past(self):
        r = run_harness()["trap_first_is_walked_past"]
        self.assertTrue(r["avoided"],
                        f"index 0 still lands in the damage field (x={r['picked_x']})")
        self.assertAlmostEqual(r["picked_x"], 1344.14, places=2)

    def test_a_flag_with_only_damaging_points_still_spawns(self):
        r = run_harness()["all_outside_still_spawns"]
        self.assertTrue(r["picked"], "the filter emptied the flag")
        self.assertAlmostEqual(r["picked_x"], 144.53, places=2)

    def test_no_area_means_no_change(self):
        r = run_harness()["no_area_unchanged"]
        self.assertAlmostEqual(r["picked_x"], 144.53, places=2)

    def test_a_vehicle_flags_points_are_not_filtered(self):
        r = run_harness()["vehicle_flag_unfiltered"]
        self.assertAlmostEqual(r["picked_x"], 144.53, places=2)


if __name__ == "__main__":
    unittest.main()
