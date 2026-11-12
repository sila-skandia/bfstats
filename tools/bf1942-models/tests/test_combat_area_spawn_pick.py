"""A spawn point the combat area would damage is never offered.

Root-caused on FHSWEurope stashuv_area (2026-10-19): the level's own
`singleplayer/SoldierSpawns.con` places `russianhq1` at 144.53/81.30/347.85 —
1240 m west of the `russianhqtemplate` flag at 1384/361, on terrain material 7
("Reserved (Outside map)", the CA-5 out-of-bounds material), a dropped digit
beside its five siblings at x 1344..1467. The viewer's deterministic walk
landed there every life, so every team-2 CoOp soldier died mid-magazine of
the out-of-area damage.

Retail never offers such a point: `BFSpawnPoint::getActive` (lnxded
0x08163dd0, SPAWN-5) refuses a point outside the active combat area in x/z
or on `materialToGiveDamage`, and `BFSpawnGroup::getSpawnPoint` (0x08166f60)
draws `rand()` only among the points it passes. A flag whose every point is
out spawns nobody (modes-spawns-supply F4; this suite's earlier "fall back to
the full pool" rested on reading the engine as offering the point). Vehicle
points are tested too, at the live positions `rebaseDeckSpawns` writes.
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

    def test_a_flag_with_only_damaging_points_offers_nothing(self):
        r = run_harness()["all_outside_still_spawns"]
        self.assertFalse(r["picked"], "a point getActive refuses was offered")

    def test_no_area_means_no_change(self):
        r = run_harness()["no_area_unchanged"]
        self.assertAlmostEqual(r["picked_x"], 144.53, places=2)

    def test_a_vehicle_flags_points_are_filtered_too(self):
        r = run_harness()["vehicle_flag_filtered"]
        self.assertAlmostEqual(r["picked_x"], 1344.14, places=2)


if __name__ == "__main__":
    unittest.main()
