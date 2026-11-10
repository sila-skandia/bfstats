"""A bot-driven hull shuffling in a pocket (features/bot-map-generation/
hull-steering.md, cause 1).

FH's and FHSW's Pegasus park their one drivable land hull, a RedTractor,
nose-in to a pocket six metres wide with its first route point behind it.
`actionStatusDecision` drives it ahead (state 9) while the run ahead beats
the 5 m turn radius and backs it (state 8) while it does not; across that
line it shuffles, each pedal change a second or more of the wheeled
drivetrain braking its revs through zero, and the hull hardly moves. The
obstruction count counted a forward throttle only, so every reverse tick
zeroed it and the hull's escape (the obstructed circle and the back-out
route) never came: 578 s of a 600 s match on FHSW's Pegasus, all of both
levels' hull-stuck time in seed 1.

`viewer/bot-route.js` now counts a hull's throttle either way
(`trackObstruction`, INVENTION like the rule it corrects) and plants the
hull's obstructed circle at the end its map gives the shorter run
(`onObstructed`), so a hull nosed into a pocket is backed out of it.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from test_bot_ai import MODULES, THREE_PACKAGE  # noqa: E402

HARNESS = Path(__file__).resolve().parent / "bot_hull_shuffle_harness.mjs"


def run_harness() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        for name, source in MODULES.items():
            if not source.exists():
                raise unittest.SkipTest(f"{source.name} is not in the tree")
            target = work / name
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source, target)
        (work / "node_modules" / "three" / "package.json").write_text(THREE_PACKAGE)
        (work / "package.json").write_text('{"type":"module"}\n')
        shutil.copyfile(HARNESS, work / "harness.mjs")
        proc = subprocess.run(["node", str(work / "harness.mjs")], capture_output=True, text=True, timeout=300)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


class HullShuffleTests(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()

    def test_a_hull_held_with_its_pedal_changing_sign_is_counted(self) -> None:
        # The flag at 150 counted ticks and the path failure at 401, the same
        # as a hull held at full throttle ahead.
        self.assertEqual(self.results["countHull"], {"flaggedAt": 150, "failedAt": 400})

    def test_a_soldier_count_is_unchanged(self) -> None:
        # His throttle is zero on the reverse half: those ticks reset it.
        self.assertEqual(self.results["countSoldier"], {"flaggedAt": None, "failedAt": None})

    def test_the_circle_goes_where_the_map_run_is_short(self) -> None:
        # Nosed into the pocket, the circle is ahead (4 m along the heading,
        # west) whichever pedal the flag fell on.
        for case in ("flagPocketReversing", "flagPocketForward"):
            with self.subTest(case=case):
                r = self.results[case]
                self.assertEqual(r["obstacles"], [[-4.0, 0.0, 4.5]])
                self.assertTrue(r["backOut"])
        # On open ground the pedal still decides: reversing, astern.
        self.assertEqual(self.results["flagOpenReversing"]["obstacles"], [[4.0, 0.0, 4.5]])

    def test_the_tractor_leaves_its_pocket_and_arrives(self) -> None:
        r = self.results["pocket"]
        self.assertIsNotNone(r["leftPocketAt"], f"still in the pocket at {r['end']}")
        self.assertIsNotNone(r["arrivedAt"], f"never arrived: ended at {r['end']}")
        self.assertLess(r["arrivedAt"], 75.0)
        self.assertGreaterEqual(r["circles"], 1)


if __name__ == "__main__":
    unittest.main()
