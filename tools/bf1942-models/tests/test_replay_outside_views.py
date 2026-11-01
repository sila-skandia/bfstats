"""The replay's outside views: the game's chase, front chase and fly-by.

features/replay-feature-sweep-2026-11-01, entry 8. The replay had its own
orbit, first person and free camera; retail's seats also give the chase
(F10, mode 12), the front chase (F11, 13) and the fly-by (F12, 14), each
gated on the seat Camera's `CVM*` words (ledger CVM-1). The chase and front
chase are the engine's law (CVM-2): the eye at the seat Camera plus `rel`,
eased by `1 - exp(-2 dt)` toward `(-/+fwd + 0.3 up) * 1.2 R` less or plus
0.6 s of the hull's velocity, a metre over the ground, looking at the
Camera. On foot the replay gives the soldier's chase over his shoulder
(features/soldier-third-person-camera) and refuses F11 and F12, as the page
does.

Run under node through `replay_outside_views_harness.mjs`: a tank driven at
5 m/s along its own forward, a second whose Camera says `CVMChase 0`, and a
rifleman standing.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import unittest
from pathlib import Path

HARNESS = Path(__file__).resolve().parent / "replay_outside_views_harness.mjs"

R = 3.5            # the stand-in hull's bounding radius (a 3 x 2 x 6 m box)
SPEED = 5.0        # m/s along its forward, the view's -Z


def run_harness() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    proc = subprocess.run(["node", str(HARNESS)], capture_output=True, text=True, timeout=120)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


class ReplayOutsideViewTests(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()

    def assertNear(self, got, want, places=2) -> None:
        for g, w in zip(got, want, strict=True):
            self.assertAlmostEqual(g, w, places=places, msg=f"{got} != {want}")

    def test_the_chase_rests_where_the_engines_law_puts_it(self) -> None:
        c = self.results["chase"]
        self.assertEqual((c["kind"], c["mode"], c["law"]), ("seat", "chase", "engine"))
        self.assertAlmostEqual(c["radius"], R, places=3)
        # (-fwd + 0.3 up) 1.2 R, and 0.6 s of 5 m/s further back.
        self.assertNear(c["rel"], [0, 0.3 * 1.2 * R, 1.2 * R + 0.6 * SPEED])
        # Looking at the seat Camera, with the page's 1 rad lens.
        self.assertEqual(c["offAxis"], 0)
        self.assertEqual(c["lens"], [57.3, 0.2])
        self.assertIsNone(c["sight"], "no first-person HUD outside")
        self.assertFalse(c["firstPersonHull"], "the hull is drawn from outside")

    def test_the_chase_swoops_out_from_the_view_on_screen(self) -> None:
        # The engine carries rel from its last output: the first frame is the
        # orbit's view, not a cut to the rest position 8.4 m back.
        self.assertAlmostEqual(self.results["chaseFirst"]["toEye"], self.results["orbitFirst"]["toEye"], delta=0.5)

    def test_the_front_chase_hangs_ahead_and_a_seek_settles_it(self) -> None:
        f = self.results["front"]
        self.assertEqual(f["mode"], "front")
        self.assertEqual(f["offAxis"], 0)
        # The tank stopped at 11 s: two seconds later, nearly at rest ahead.
        self.assertAlmostEqual(f["rel"][2], -1.2 * R, delta=0.1)
        s = self.results["seekBack"]
        self.assertNear(s["rel"], [0, 0.3 * 1.2 * R, -1.2 * R - 0.6 * SPEED])

    def test_the_fly_by_is_a_tripod_watching_the_hull(self) -> None:
        f = self.results["flyby"]
        self.assertEqual((f["mode"], f["law"]), ("flyby", "viewer"))
        self.assertGreater(f["toHull"], 50)
        self.assertEqual(f["offAxis"], 0)

    def test_f9_is_his_eyes_and_the_orbit_is_unchanged(self) -> None:
        self.assertEqual(self.results["keyInside"]["mode"], "pov")
        i = self.results["inside"]
        self.assertEqual((i["sight"], i["toEye"], i["outside"]), ("seat", 0, None))
        o = self.results["orbitAfter"]
        self.assertEqual((o["mode"], o["outside"]), ("orbit", None))
        self.assertGreater(o["toEye"], 1)

    def test_a_seat_that_forbids_the_chase_skips_it(self) -> None:
        self.assertEqual(self.results["lockedModes"], ["front", "flyby"])
        self.assertEqual(self.results["lockedChase"]["refused"], "chase")
        self.assertFalse(self.results["lockedChase"]["foot"])
        self.assertEqual(self.results["lockedFront"]["mode"], "front")
        self.assertEqual(self.results["lockedFrontShot"]["mode"], "front")
        # Put in the chase anyway, the seat keeps its inside view.
        forced = self.results["lockedForced"]
        self.assertEqual((forced["sight"], forced["outside"], forced["toEye"]), ("seat", None, 0))

    def test_on_foot_the_chase_is_over_his_shoulder_and_f11_f12_are_refused(self) -> None:
        self.assertEqual(self.results["footChase"]["mode"], "chase")
        for key in ("footFront", "footFlyby"):
            self.assertTrue(self.results[key]["foot"])
            self.assertIn("refused", self.results[key])
        f = self.results["foot"]
        self.assertEqual(f["kind"], "foot")
        # Anchored on his eye, where first person stands.
        self.assertEqual(f["anchor"], self.results["footPov"])
        # (-fwd + 0.3 up) 1.2 x 2.5 m, 0.5 m to his right; two seconds of the
        # ease out of his eyes leave 2% to go.
        for got, want in zip(f["rel"], [0.5, 0.9, 3.0], strict=True):
            self.assertAlmostEqual(got, want, delta=0.1)
        # Looking where he aims, 300 m out over open ground, his body drawn.
        self.assertEqual(f["aim"], 300)
        self.assertEqual(f["offAxis"], 0)
        self.assertIsNone(f["hidePid"])

    def test_the_creator_offers_the_games_cameras(self) -> None:
        c = self.results["creator"]
        # The replay's camera films them, as it films his eyes, in the mode
        # each names; a drag is the camera's own.
        self.assertEqual(c["filmed"], [False, False, False])
        self.assertEqual(c["asked"], ["chase", "front", "flyby"])
        self.assertFalse(c["drag"])
        self.assertEqual(c["usable"], [True, True, True])
        self.assertFalse(c["noTake"], "they film the shooter: a kill shot's only")
        self.assertEqual(c["recipes"], [["gamechase", "gamechase"], ["gamefront", "gamefront"], ["gameflyby", "gameflyby"]])
        self.assertEqual(c["labels"], ["Game chase", "Game front chase", "Game fly-by"])


if __name__ == "__main__":
    unittest.main()
