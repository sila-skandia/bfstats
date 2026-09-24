"""The red wash for a player seated in a hit hull (`vehicle-hits.js`), driven
headless by `hull_wash_harness.mjs`.

`_giveDamage` washes every player in its victim's `PlayerControlObject`
`getPcos()` map, which only a root PCO fills, with itself and every seat under
it (ledger HFD-10). In vanilla and both expansions the victim of any hull
damage is the hull's root (HFD-11). So everyone seated anywhere in it sees the
wash, with the octant taken from the hull's own origin, forward and right, and
the alpha the damage over the hull's max HP. Each `Pos3` is HFD-4's or
HFD-13's. The painting and the six-frame clock are `test_hud.py`'s.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import unittest
from pathlib import Path

HARNESS = Path(__file__).with_name("hull_wash_harness.mjs")


def run_harness() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    proc = subprocess.run(["node", str(HARNESS)], capture_output=True, text=True, timeout=120)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


class HullWashTests(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()

    def test_a_round_on_his_hull_washes_him_toward_where_it_was_fired(self) -> None:
        # 30 of a Sherman's 100 HP, from 40 m off its right side.
        self.assertEqual([{"dir": 3, "alpha": 0.3}], self.results["round"]["fromTheRight"])

    def test_the_octant_is_the_hulls_frame_not_the_worlds(self) -> None:
        # Turned to face +x, the same muzzle is dead ahead and its mirror dead
        # astern: the octant is the damaged root's own, never the view's.
        self.assertEqual([1, 5], self.results["round"]["turned"])

    def test_the_hulls_frame_is_three_dimensional(self) -> None:
        # In a 45-degree dive a source along the nose is the front, and one
        # level ahead is 45 degrees off it: the front-right arc.
        self.assertEqual([1, 2], self.results["round"]["pitched"])

    def test_only_the_hull_he_sits_in_washes_him(self) -> None:
        self.assertEqual([], self.results["round"]["otherHull"])
        self.assertEqual([], self.results["round"]["notSeated"])

    def test_a_round_without_a_launch_point_washes_with_no_arc(self) -> None:
        self.assertEqual([{"dir": 1, "alpha": 0.3}], self.results["round"]["noOrigin"])

    def test_the_alpha_is_the_damage_not_the_hp_it_could_still_lose(self) -> None:
        # `_giveDamage` divides its own damage argument by the max (HFD-2): a
        # 70 on a hull with 40 left washes at 0.7, not 0.4.
        killing = self.results["round"]["killing"]
        self.assertEqual([0.6, 0.7], [w["alpha"] for w in killing["washes"]])
        self.assertEqual(0, killing["hp"])
        self.assertEqual([{"dir": 1, "alpha": 0.75}], self.results["round"]["capped"])

    def test_a_wreck_washes_nobody(self) -> None:
        # A destroyed Armor returns from `_giveDamage` before the wash.
        self.assertEqual(2, self.results["round"]["onTheWreck"])

    def test_a_blast_washes_him_toward_its_centre_at_its_share(self) -> None:
        behind = self.results["splash"]["behind"]
        self.assertEqual(1, len(behind["washes"]))
        self.assertEqual(5, behind["washes"][0]["dir"])
        self.assertAlmostEqual(behind["lost"] / 100, behind["washes"][0]["alpha"], places=5)

    def test_a_crash_points_at_the_origin_or_at_the_ground_it_met(self) -> None:
        # HFD-13: object against object, and water, give the world origin
        # (ahead-left of a hull at (100, 0, 50) facing -z); the ground gives
        # its contact point (HFD-4); the kill material's point is unread.
        self.assertEqual(
            [{"dir": 8, "alpha": 0.225}, {"dir": 3, "alpha": 0.225},
             {"dir": 8, "alpha": 0.225}, {"dir": 1, "alpha": 0.75}],
            self.results["crash"]["kinds"])
        self.assertEqual(0, self.results["crash"]["ignored"])

    def test_a_burning_hull_washes_him_every_tick_toward_the_origin(self) -> None:
        # `Armor::update`'s tick is a `giveDamage` on the hull with a zero
        # `Pos3` (HFD-11, HFD-13): 1.5 of 100 HP.
        timed = self.results["timed"]
        self.assertEqual([{"owner": 6, "amount": 1.5}], timed["ticks"])
        self.assertEqual([{"dir": 8, "alpha": 0.015}], timed["washes"])

    def test_on_foot_the_arc_points_at_the_rounds_launch_point(self) -> None:
        # The record's `Projectile+0x134`; the firer's gun as it stands now
        # only for a record without one.
        self.assertEqual([{"x": 5, "y": 1.5, "z": 7}, {"x": 9, "y": 9, "z": 9}],
                         self.results["onFoot"])


if __name__ == "__main__":
    unittest.main()
