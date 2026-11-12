"""The restricted exit (ledger SEAT-42): `PlayerControlObject::isAllowedToExit`
(lnxded 0x08317490) for a seat whose template says `hasRestrictedExit` (all
eight vanilla tanks, the Willys). The line from the seat PCO to its
`soldierExitLocation`, raised 0.5 m (0x086be450), is cast against every object
but the hull's own (`ObjectManager::intersectLine` 0x0819e840, `PCOPredicator`
0x0831ce70), never the ground. Blocked: X mirrored, the same lifted Y, cast
again; clear, the soldier goes there (`exit` 0x08317e1d). Both blocked: the
press does nothing (`toggleEntryPoint` 0x0814eee3).

The page (`viewer/vehicle-entry.js`), the room (`server/level-instance.mjs`)
and the bots (`viewer/bot-units.js`) are asked the same cases
(`tests/restricted_exit_harness.mjs`)."""

from __future__ import annotations

import json
import shutil
import subprocess
import unittest
from pathlib import Path

HARNESS = Path(__file__).resolve().parent / "restricted_exit_harness.mjs"


class RestrictedExitTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        if shutil.which("node") is None:
            raise unittest.SkipTest("node is not installed")
        proc = subprocess.run(["node", str(HARNESS)], capture_output=True, text=True, timeout=120)
        if proc.returncode != 0:
            raise AssertionError(proc.stderr)
        cls.r = json.loads(proc.stdout)

    def test_the_lift_is_retails_half_metre(self) -> None:
        self.assertEqual(self.r["lift"], 0.5)

    def test_a_clear_door_is_the_declared_point_not_lifted(self) -> None:
        for walls in ("none", "right"):
            c = self.r["cases"][walls]
            self.assertTrue(c["page"]["allowed"])
            self.assertFalse(c["page"]["mirrored"])
            self.assertEqual(c["page"]["at"], [-2, 0.5, 0])
            self.assertEqual(c["room"]["at"], [-2, 0.5, 0])
            self.assertTrue(c["botMayExit"])

    def test_a_blocked_door_steps_out_the_other_side_lifted(self) -> None:
        c = self.r["cases"]["left"]
        self.assertTrue(c["page"]["allowed"])
        self.assertTrue(c["page"]["mirrored"])
        self.assertEqual(c["page"]["at"], [2, 1, 0])
        self.assertEqual(c["room"]["at"], [2, 1, 0])
        self.assertTrue(c["botMayExit"])

    def test_both_sides_blocked_refuses_the_exit(self) -> None:
        c = self.r["cases"]["both"]
        self.assertFalse(c["page"]["allowed"])
        self.assertFalse(c["room"]["allowed"])
        self.assertFalse(c["botMayExit"])

    def test_without_the_flag_nothing_is_tested(self) -> None:
        c = self.r["unrestrictedBoth"]
        self.assertTrue(c["page"]["allowed"])
        self.assertEqual(c["page"]["at"], [-2, 0.5, 0])
        self.assertTrue(c["botMayExit"])

    def test_the_ground_never_blocks(self) -> None:
        s = self.r["sunk"]
        self.assertEqual(s["groundOnLine"], "terrain")
        self.assertTrue(s["page"]["allowed"])
        self.assertFalse(s["page"]["mirrored"])
        self.assertTrue(s["botMayExit"])

    def test_the_mirror_negates_x_only(self) -> None:
        p = self.r["pure"]
        self.assertEqual(p["lines"], [[-2.8, 0, 0.3], [2.8, 0, 0.3]])
        self.assertEqual(p["local"], [2.8, 0, 0.3])
        self.assertTrue(p["mirrored"])


if __name__ == "__main__":
    unittest.main()
