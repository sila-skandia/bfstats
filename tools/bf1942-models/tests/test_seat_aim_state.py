"""The seated gun against the server's: the rig's rest and the acked state.

`tests/seat_aim_state_harness.mjs` runs the real `turret-rig.js`,
`rest-pose.js` and `netcode-reconcile.js` under node. What it pins
(features/udp-sidecar/wire.md section 41):

* a rig built on a node the server's joint rows had already turned measures
  from the node's authored rest: the owner's re-manned Defgun drew every
  angle 16 degrees past the server's;
* the acked-tick correction takes the server's speed register with its
  angle and re-runs the page's newer ticks from it, so a slow servo matches
  the server's through fast swings (the retail client's
  readControlObjectState, then its unacknowledged actions).
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
HARNESS = Path(__file__).resolve().parent / "seat_aim_state_harness.mjs"

MODULES = {
    "turret-rig.js": VIEWER / "turret-rig.js",
    "seat-survey.js": VIEWER / "seat-survey.js",
    "camera-pivot.js": VIEWER / "camera-pivot.js",
    "rest-pose.js": VIEWER / "rest-pose.js",
    "netcode-reconcile.js": VIEWER / "netcode-reconcile.js",
    "mouse-input.js": VIEWER / "mouse-input.js",
    "node_modules/three/three.module.js": VIEWER / "vendor" / "three.module.js",
}
THREE_PACKAGE = json.dumps({
    "name": "three", "version": "0.0.0", "type": "module",
    "main": "three.module.js", "exports": "./three.module.js",
})


def run_harness() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    for source in MODULES.values():
        if not source.exists():
            raise unittest.SkipTest(f"{source.name} is not in the tree")
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        for name, source in MODULES.items():
            target = work / name
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source, target)
        (work / "node_modules" / "three" / "package.json").write_text(THREE_PACKAGE)
        (work / "package.json").write_text('{"type":"module"}\n')
        shutil.copyfile(HARNESS, work / "harness.mjs")
        proc = subprocess.run(
            ["node", str(work / "harness.mjs")],
            capture_output=True, text=True, timeout=120)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


class SeatAimStateTests(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()

    def test_a_rig_measures_from_the_authored_rest(self) -> None:
        r = self.results["r"]
        self.assertAlmostEqual(r["atZero"], 0.0, delta=1e-3)
        self.assertAlmostEqual(r["atTen"], 10.0, delta=1e-3)
        self.assertAlmostEqual(r["secondRigAtZero"], 0.0, delta=1e-3)

    def test_the_servo_state_matches_the_server_through_fast_swings(self) -> None:
        s = self.results["s"]
        # Taking the server's angle and speed and re-running the newer ticks
        # puts the page on the server's turret to float precision, swinging
        # or still: the pintle's 0.1 deg target, three orders over.
        self.assertLess(s["state"]["swingMax"], 1e-3)
        self.assertLess(s["state"]["stillMax"], 1e-3)
        # The angle alone does not: the page coasts on its own speed register
        # between acks, a degree and more on the Defgun's slow servo.
        self.assertGreater(s["angle"]["swingMax"], 0.5)


if __name__ == "__main__":
    unittest.main()
