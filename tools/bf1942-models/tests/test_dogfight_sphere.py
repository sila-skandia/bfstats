"""The sphere (features/dogfight-school, "The sphere"): the live fight's
instrument bottom right, you at the centre of a sphere that holds the two of
you, the other pilot where they are against you, with the guide's next
seconds drawn inside it instead of across the sky.

`dogfight_sphere_harness.mjs` feeds it states under node and reads back the
radius and where the other pilot lands in the window: behind you is below
the centre, ahead above it, the way the edge arrow reads.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

from test_dogfight_school import THREE_PACKAGE
from test_flight import VIEWER

SCRIPT = Path(__file__).resolve().parent / "dogfight_sphere_harness.mjs"
MODULES = {
    "dogfight-sphere.js": VIEWER / "dogfight-sphere.js",
    "dogfight-flight.js": VIEWER / "dogfight-flight.js",
    # `dogfight-flight.js` takes the engine's g from it.
    "rigid-body.js": VIEWER / "rigid-body.js",
    "node_modules/three/three.module.js": VIEWER / "vendor" / "three.module.js",
}


def run() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        for name, source in MODULES.items():
            target = work / name
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source, target)
        (work / "node_modules" / "three" / "package.json").write_text(THREE_PACKAGE)
        (work / "package.json").write_text('{"type":"module"}\n')
        shutil.copyfile(SCRIPT, work / "s.mjs")
        proc = subprocess.run(["node", str(work / "s.mjs")], capture_output=True, text=True, timeout=300, env={**os.environ})
    if proc.returncode != 0:
        raise AssertionError(f"sphere harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


class SphereTests(unittest.TestCase):
    out: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.out = run()

    def test_the_radius_holds_them_with_room_within_its_bounds(self) -> None:
        r, rules = self.out["radius"], self.out["rules"]
        self.assertEqual(r["near"], rules["min"])
        self.assertAlmostEqual(r["mid"], 400 * rules["fit"], delta=1)
        self.assertEqual(r["far"], rules["max"])

    def test_the_radius_grows_at_once_and_eases_back_in(self) -> None:
        e = self.out["radius"]["ease"]
        self.assertAlmostEqual(e["r0"], 540, delta=1)
        self.assertGreater(e["r1"], 520, "one frame in, the sphere has barely started to close")
        self.assertAlmostEqual(e["r2"], 150, delta=5, msg="five seconds in it holds them at the minimum")
        self.assertAlmostEqual(e["r3"], 2025, delta=1, msg="when they would leave the sphere it grows at once")

    def test_behind_reads_below_the_centre_and_ahead_above_it(self) -> None:
        w = self.out["where"]
        for name, p in w.items():
            if name == "eastBehind":
                continue
            x, y = p["him"]
            self.assertLess(abs(x), 0.9, f"{name}: inside the window")
            self.assertLess(abs(y), 0.9, f"{name}: inside the window")
        self.assertLess(w["behind"]["him"][1], -0.08)
        self.assertTrue(w["behind"]["behind"])
        self.assertGreater(w["ahead"]["him"][1], 0.04)
        self.assertFalse(w["ahead"]["behind"])
        self.assertGreater(w["right"]["him"][0], 0.2)
        self.assertLess(w["left"]["him"][0], -0.2)
        self.assertGreater(w["behindAbove"]["him"][1], w["behind"]["him"][1], "higher than you draws higher")
        self.assertLess(w["behindBelow"]["him"][1], w["behindAbove"]["him"][1])
        self.assertGreater(w["high"]["him"][1], 0.3, "straight over you is near the top")

    def test_the_frame_follows_your_heading_not_the_world(self) -> None:
        w = self.out["where"]
        self.assertLess(w["eastBehind"][1], -0.08, "heading east, a pilot to the west is behind and reads below")
        self.assertLess(abs(w["eastBehind"][0]), 0.15)

    def test_the_heading_holds_through_the_vertical(self) -> None:
        loop = self.out["loop"]
        self.assertEqual(loop["c0"], loop["c1"], "the camera does not swing as the nose goes through 88 degrees")

    def test_the_guides_seconds_and_the_ground_show_when_they_should(self) -> None:
        L = self.out["lines"]
        self.assertGreater(L["on"]["paths"], 50)
        self.assertTrue(L["on"]["ground"], "the ground 100 m under you is inside a 540 m sphere")
        self.assertEqual(L["off"]["paths"], 0, "guide off: no path")
        self.assertEqual(L["high"]["paths"], 0)
        self.assertFalse(L["high"]["ground"], "3 km up, the ground is out of the sphere")
        self.assertFalse(L["shotVisible"], "no flight, no shot ring")
        self.assertTrue(L["shotVisibleOn"], "the first shot of the flight is a ring")


if __name__ == "__main__":
    unittest.main()
