"""`viewer/replay.js` under node: the replayed-aircraft propeller law.

Same pattern as `test_flight.py` — one node run (`replay_harness.mjs`), many
assertions. The replayed-aircraft half of the propeller-blur pair machinery:
the playable map's own swap is pinned in `test_flight.py`, the extractor's
stamp in `test_assemble.py`/`test_con.py`.

Why this file exists. A 2026-09-20 defect report read "the planes are not
showing the correct propeller: it's showing both the spinning + idle" — both
of a prop plane's meshes drawn at once. The playable map cannot do that (the
pair toggle in `flight.js`'s `applyRig` is exclusive by construction, and the
level load hides the disc before anything renders); the one place both meshes
really did draw together was a **round replay**: `replay.js` clones whole
`models/<Template>.glb` files, which ship both alternatives visible, and a
recording carries no throttle for anything to swap on. It stayed latent until
the models tree was republished with both meshes (before that, the clone held
one blade), which is why the report landed the same day as the republish.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

ROOT = Path(__file__).resolve().parents[1]
VIEWER = ROOT / "viewer"
HARNESS = Path(__file__).resolve().parent / "replay_harness.mjs"

# `replay.js` copied as `.mjs` next to the harness, plus everything its import
# graph reaches for at their own relative paths (`vehicle-base.js` for the pair-kind
# gate, `gait-select.js` for the soldier retargeting, `soldier.js` and
# `physics.js` under that, and the two vendored utilities).
MODULES = {
    "replay.js": VIEWER / "replay.js",
    "replay-recording.js": VIEWER / "replay-recording.js",
    "replay-server-log.js": VIEWER / "replay-server-log.js",
    "replay-ui.js": VIEWER / "replay-ui.js",
    "replay-gait.js": VIEWER / "replay-gait.js",
    "replay-assets.js": VIEWER / "replay-assets.js",
    "replay-actors.js": VIEWER / "replay-actors.js",
    "replay-camera.js": VIEWER / "replay-camera.js",
    "replay-gunfire.js": VIEWER / "replay-gunfire.js",
    "vehicle-camera.js": VIEWER / "vehicle-camera.js",
    "vehicle-discovery.js": VIEWER / "vehicle-discovery.js",
    "vehicle-base.js": VIEWER / "vehicle-base.js",
    "aircraft.js": VIEWER / "aircraft.js",
    "gait-select.js": VIEWER / "gait-select.js",
    "soldier.js": VIEWER / "soldier.js",
    "spawn-flags.js": VIEWER / "spawn-flags.js",
    "spawn-safety.js": VIEWER / "spawn-safety.js",
    "physics.js": VIEWER / "physics.js",
    "walking-body.js": VIEWER / "walking-body.js",
    "soldier-resolve.js": VIEWER / "soldier-resolve.js",
    "soldier-pose.js": VIEWER / "soldier-pose.js",
    "soldier-locomotion.js": VIEWER / "soldier-locomotion.js",
    "point-body.js": VIEWER / "point-body.js",
    "fixed-step.js": VIEWER / "fixed-step.js",
    "parachute.js": VIEWER / "parachute.js",
    "swim.js": VIEWER / "swim.js",
    "vendor/utils/SkeletonUtils.js": VIEWER / "vendor" / "utils" / "SkeletonUtils.js",
    "vendor/loaders/GLTFLoader.js": VIEWER / "vendor" / "loaders" / "GLTFLoader.js",
    "vendor/utils/BufferGeometryUtils.js": VIEWER / "vendor" / "utils" / "BufferGeometryUtils.js",
    # The bare specifier `three` is an import map entry in the page; node needs
    # a package, so the same file is published as one.
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
            capture_output=True, text=True, timeout=900)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


class ReplayPropellerTests(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()

    def test_a_replayed_propeller_shows_the_idle_blade_never_the_disc(self) -> None:
        # The level's own parked law (map.html's load walk): blade visible,
        # blurred disc hidden. A replay has no throttle to swap on, so the
        # clone gets exactly the state a parked spawner shows.
        state = self.results["corsair"]
        self.assertTrue(state["blade"], "the idle blade must stay visible")
        self.assertFalse(state["disc"], "the blurred disc must be hidden")

    def test_the_bf109_cockpit_named_like_a_propeller_stays_whole(self) -> None:
        # Vanilla's one counter-example to the naming convention: the bf109's
        # *cockpit* LodObject under a DistCompareSelector, with both halves in
        # an already-published tree. Its "blurred" half is the pilot's 1P
        # interior; hiding it strips the cockpit out of every replay.
        state = self.results["bf109CockpitBothHalves"]
        self.assertTrue(state["exterior"], "the fuselage must stay visible")
        self.assertTrue(state["interior"], "the 1P interior must stay visible")

    def test_a_fresh_tree_cockpit_stamp_without_its_interior_is_a_noop(self) -> None:
        # The current exporter excludes the 1P interior, so the stamp names a
        # child that is not there. Walk it without throwing; the fuselage
        # stands.
        state = self.results["bf109CockpitFreshTree"]
        self.assertTrue(state["exterior"])
        self.assertTrue(state["interiorMissing"])

    def test_a_wrapper_without_a_stamp_is_untouched(self) -> None:
        # The kind gate, pointed the other way: nothing names this LodObject a
        # propeller, so nothing may hide either half of it.
        state = self.results["unstampedPair"]
        self.assertTrue(state["blade"])
        self.assertTrue(state["disc"])

    def test_every_stamped_wrapper_on_a_multiengine_airframe_is_walked(self) -> None:
        # The B17 ships four propellers; the walk covers each wrapper, not
        # just the first the traverse meets.
        for engine, state in enumerate(self.results["b17AllFour"]):
            self.assertTrue(state["blade"], f"engine {engine}: blade visible")
            self.assertFalse(state["disc"], f"engine {engine}: disc hidden")

    def test_the_model_loader_actually_applies_the_walk(self) -> None:
        # The harness proves the law; this pins the call site, so the loader
        # cannot silently stop calling it. (The loader path itself needs a
        # browser — `model()` fetches a glb — so the source is the contract.)
        source = (VIEWER / "replay-assets.js").read_text()
        self.assertIn("setReplayPropellerIdle(gltf.scene)", source)


if __name__ == "__main__":
    unittest.main()
