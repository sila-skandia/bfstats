"""A round meets its own hull's bullet catcher, and nothing else of its hull.

Retail tests a round against every part of every hull, its firer's own
included (ledger COL-24). FH's and FHSW's ship and tank round selectors rely
on it: the gun not chosen fires its round under the hull, into a
`BulletCatcher_new` cube in `c_CGLandscape` (features/fhswe-mechanics-audit
item 12; features/fhsweurope-extraction "Where a selector gun's round
starts"). The page skips the firer's hull, whose muzzles start inside it,
so that round flew 40 m into the sea and its AA shell burst far below. The
index now lets back the parts in `CG_OWN_CATCHERS` (`static-index.js`
`ownHits`), placed or driven off their bake (`world-collider.js`
`castMoved`), and `own_catcher_harness.mjs` drives `WorldCollider.cast` as
`projectile-flight.js` does.
"""
import json
import shutil
import subprocess
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent


class OwnCatcherTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if shutil.which("node") is None:
            raise unittest.SkipTest("node is not installed")
        out = subprocess.run(["node", str(HERE / "own_catcher_harness.mjs")], capture_output=True,
                             text=True, check=True, timeout=120)
        cls.r = json.loads(out.stdout.strip().splitlines()[-1])

    def test_the_unchosen_round_stops_in_its_own_catcher(self):
        self.assertEqual(self.r["unchosenDown"], {"y": -38.5, "owner": "own"})
        self.assertIsNone(self.r["unchosenDownNoCatch"])

    def test_the_chosen_round_leaves_its_own_hull(self):
        self.assertIsNone(self.r["chosenUp"])
        self.assertIsNone(self.r["chosenSide"])

    def test_another_hulls_round_meets_hull_and_catcher(self):
        self.assertEqual(self.r["otherOnHull"], {"y": 6, "owner": "own"})
        self.assertEqual(self.r["otherOnCatcher"], {"y": -38.5, "owner": "own"})

    def test_a_driven_hull_takes_its_catcher_along(self):
        self.assertEqual(self.r["movedUnchosen"], {"y": -38.5, "owner": "own"})
        self.assertIsNone(self.r["movedChosenUp"])
        self.assertEqual(self.r["movedOtherOnHull"], {"y": 6, "owner": "own"})


if __name__ == "__main__":
    unittest.main()
