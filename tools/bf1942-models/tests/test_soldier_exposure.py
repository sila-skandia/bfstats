"""`viewer/soldier-exposure.js` -- HP-10's line-of-sight sampling, headless.

Every number here was read out of the unstripped Linux dedicated server
(`bf1942_lnxded-1.61-patched/bf1942/bf1942_lnxded.static`) and the module's own
header carries the addresses:

  * `GameServer::checkForHitOnSoldier(Pos3, float, BFSoldier*, IObject*)` at
    0x08156090 is three copies of one loop, selected by `BFSoldier::getPose()`
    (0x0827ddc0, which answers 1 for the 0x20 flag, 2 for 0x40, else 0).
  * pose 0 walks 0x0871bac0 for nine samples and divides by 18.0 (0x86c08d0);
    pose 1 walks 0x0871ba40 for nine and divides by 9.0 (0x86c08cc); pose 2
    walks 0x0871ba00 for three and divides by 3.0 (0x86c08c8). The loop counts
    are `mov edi,0x8` / `mov edi,0x2` with `dec edi; jns`, so 9 and 3.
  * The standing and crouching tables are byte-identical -- all 108 bytes --
    so the only difference between the two poses is the divisor, and a fully
    exposed standing soldier tops out at 0.5 where a crouching one reaches 1.0.
  * A pose outside 0..2 takes the Debug branch at 0x08156215 and returns 0.0
    (`fldz`, 0x08156298).
  * Each sample is `getPos() + offset` with no rotation anywhere in the
    function, so the lateral spread is along world X whichever way the soldier
    faces.

The exposure multiplies the linear distance falloff rather than replacing it
(`fmulp` at 0x081566b4) and an exposure of exactly 0.0 short-circuits the
victim entirely (0x08156ede).
"""

from __future__ import annotations

import json
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
VIEWER = ROOT / "viewer"
HARNESS = Path(__file__).with_name("soldier_exposure_harness.mjs")
MODULES = {"soldier-exposure.js": VIEWER / "soldier-exposure.js"}


def run_harness() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    for source in MODULES.values():
        if not source.exists():
            raise unittest.SkipTest(f"{source.name} is not in the tree")
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        for name, source in MODULES.items():
            shutil.copyfile(source, work / name)
        (work / "package.json").write_text('{"type":"module"}\n')
        shutil.copyfile(HARNESS, work / "harness.mjs")
        proc = subprocess.run(
            ["node", str(work / "harness.mjs")],
            capture_output=True, text=True, timeout=120)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


class SoldierExposureTests(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()

    def test_the_three_tables_are_the_engine_tables(self) -> None:
        tables = self.results["tables"]
        self.assertEqual([9, 9, 3], tables["sampleCounts"])
        self.assertEqual([18, 9, 3], tables["divisors"])
        # 0x0871ba00: one row across the body at the prone camera height.
        self.assertEqual(
            [[0.0, -0.699999988079071, 0.0],
             [-0.5, -0.699999988079071, 0.0],
             [0.5, -0.699999988079071, 0.0]],
            tables["prone"])
        # 0x0871bac0: three heights at three lateral offsets, z always 0.
        standing = tables["standing"]
        self.assertEqual(9, len(standing))
        self.assertEqual({0.0, -0.2, 0.2}, {round(v[0], 6) for v in standing})
        self.assertEqual({-0.1, -0.3, -0.7}, {round(v[1], 6) for v in standing})
        self.assertEqual({0.0}, {v[2] for v in standing})

    def test_standing_and_crouching_share_one_table(self) -> None:
        # The 108 bytes at 0x0871ba40 and 0x0871bac0 are identical, so the
        # poses differ ONLY in the divisor. This is the finding that makes
        # crouching worse than standing, and a reconstruction that invents a
        # lower silhouette for crouching gets the sign of the mechanic wrong.
        tables = self.results["tables"]
        self.assertEqual(tables["standing"], tables["crouching"])
        self.assertTrue(tables["standingIsCrouching"])

    def test_standing_caps_at_half_and_crouching_at_one(self) -> None:
        # `fdiv ds:0x86c08d0` = 18.0 against nine samples.
        self.assertEqual([0.5, 1.0, 1.0], self.results["tables"]["maxExposure"])
        wide = self.results["openGround"]
        self.assertAlmostEqual(0.5, wide["standing"])
        self.assertAlmostEqual(1.0, wide["crouching"])
        self.assertAlmostEqual(1.0, wide["prone"])

    def test_total_cover_is_zero_in_every_pose(self) -> None:
        # Exposure 0.0 is the short-circuit at 0x08156ede: no damage at all,
        # however close the blast.
        covered = self.results["fullyCovered"]
        self.assertEqual(0, covered["standing"])
        self.assertEqual(0, covered["crouching"])
        self.assertEqual(0, covered["prone"])

    def test_an_unknown_pose_returns_zero(self) -> None:
        # 0x08156215's Debug branch ends in `fldz` at 0x08156298.
        unknown = self.results["unknownPose"]
        self.assertEqual(0, unknown["three"])
        self.assertEqual(0, unknown["minusOne"])
        self.assertEqual(0, unknown["undefinedPose"])
        self.assertEqual([True, True, True, False], unknown["known"])

    def test_partial_cover_is_the_fraction_of_samples_that_got_through(self) -> None:
        partial = self.results["partial"]
        # Six of nine blocked -> 3/18 standing, 3/9 crouching.
        self.assertAlmostEqual(3 / 18, partial["standingLowSix"])
        self.assertAlmostEqual(3 / 9, partial["crouchingLowSix"])
        # Three of nine blocked -> 6/18.
        self.assertAlmostEqual(6 / 18, partial["standingLowThree"])
        # Prone is one row, so it is all or nothing.
        self.assertEqual(0, partial["proneAll"])

    def test_sample_points_are_offsets_from_the_object_origin(self) -> None:
        points = self.results["points"]
        self.assertEqual(9, len(points["standing"]))
        self.assertEqual(3, len(points["prone"]))
        self.assertEqual([], points["unknown"])
        # The soldier's origin in the harness is (100, 10, -100).
        for x, y, z in points["prone"]:
            self.assertAlmostEqual(-100.0, z)
            self.assertAlmostEqual(9.3, y)
        self.assertEqual({99.5, 100.0, 100.5},
                         {round(p[0], 6) for p in points["prone"]})

    def test_a_wall_between_the_blast_and_the_man_costs_him_exposure(self) -> None:
        cover = self.results["cover"]
        self.assertAlmostEqual(0.5, cover["open"])
        self.assertEqual(0, cover["behindWall"])
        self.assertLess(cover["behindWall"], cover["open"])

    def test_the_collider_blocker_ignores_water_and_honours_the_firer(self) -> None:
        blocker = self.results["blocker"]
        # Water is neither a world object nor `terrainBase`; the engine's two
        # casts cannot see it, so it is not cover.
        self.assertFalse(blocker["water"])
        self.assertTrue(blocker["terrain"])
        self.assertTrue(blocker["object"])
        self.assertFalse(blocker["none"])
        self.assertFalse(blocker["noCollider"])
        # The segment is pulled in by the slack, and the firer's owner id is
        # passed through as the collider's skip argument.
        calls = blocker["calls"]
        self.assertEqual(1, len(calls), "a segment shorter than the slack is not cast")
        self.assertAlmostEqual(4.98, calls[0]["dist"])
        self.assertEqual(4, calls[0]["owner"])


if __name__ == "__main__":
    unittest.main()
