"""The page's tank against the BF1942 dedicated server's, per tick.

`tank_law_harness.mjs` replays the input words `lab/veh_law_probe.mjs` sent a
real server (vanilla Wake, 2026-10-22: a Sherman through idle, throttle,
throttle with either lock, release, brake into reverse, idle, a second turn
and a coast) through `viewer/tracked-vehicle.js`, on Wake's own heightmap and
material map, from the server's whole state at the serial the player took the
seat, and measures the page's hull against the server's at every
acknowledged serial. The law it holds the page to is TANK-18..TANK-24
(`features/bf1942-engine-reference/ledger.md`): one 30 Hz tick of
`Engine::handleUpdate`, the springs (`1.5 k D` and a damper on `D - Dprev`),
the root's sleep, box drag and one Euler step, each wheel's col0 vertex
pushed out of the engine's checkerboard terrain (TERR-16) along the face
normal, and `addFriction`'s EngineGrip arm. `lab/veh_law_check.py` is the same
law written out in Python against the same data.

Thresholds are the task's: per acknowledged tick, with the server's position,
rotation and velocity put back at every ack as the hull reconciler does, the
horizontal error's median at most 2 mm and its worst at most 10 mm in every
phase, the yaw within 0.2 degrees; one uncorrected run from the seat stays
within a few centimetres over the whole plan (about 22 s). The plan's last
word is not scored (two server ticks ran against its serial).
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
FIXTURES = Path(__file__).resolve().parent / "fixtures"
HARNESS = Path(__file__).resolve().parent / "tank_law_harness.mjs"
MODULES = [
    "tracked-vehicle.js", "suspension.js", "ground-specs.js", "ground-contact.js",
    "ground-engine.js", "track-scroll.js", "amphibious.js", "body-float.js",
    "vehicle-camera.js", "vehicle-discovery.js", "vehicle-base.js", "rest-pose.js", "viewer-root.js",
    "glb-loader.js", "glb-store.js", "camera-pivot.js", "aircraft.js", "aircraft-ground-law.js", "spawned-craft.js", "ship-spec.js",
    "geometry-search.js", "vectored-engines.js", "engine-revs.js", "engine-spin.js",
    "body-friction.js", "rigid-body.js", "physics.js", "walking-body.js",
    "soldier-resolve.js", "soldier-pose.js", "soldier-locomotion.js", "point-body.js",
    "fixed-step.js", "parachute.js", "model-file.js",
    "heightfield.js", "world-collider.js", "collision-materials.js", "static-index.js",
    "collision-meshes.js", "drivable-mask.js", "spawn-safety.js",
]
VENDOR = {
    "vendor/loaders/GLTFLoader.js": VIEWER / "vendor" / "loaders" / "GLTFLoader.js",
    "vendor/utils/BufferGeometryUtils.js": VIEWER / "vendor" / "utils" / "BufferGeometryUtils.js",
    "node_modules/three/three.module.js": VIEWER / "vendor" / "three.module.js",
}
THREE_PACKAGE = json.dumps({
    "name": "three", "version": "0.0.0", "type": "module",
    "main": "three.module.js", "exports": "./three.module.js",
})
SCORED = ["idle", "throttle", "throttle+right", "throttle+left", "release",
          "brake/reverse", "idle2", "throttle+left2", "coast"]


def run_harness() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        (work / "package.json").write_text('{"type": "module"}')
        for name in MODULES:
            shutil.copyfile(VIEWER / name, work / name)
        for name, source in VENDOR.items():
            if not source.exists():
                raise unittest.SkipTest(f"{source.name} is not in the tree")
            target = work / name
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source, target)
        (work / "node_modules" / "three" / "package.json").write_text(THREE_PACKAGE)
        shutil.copyfile(HARNESS, work / "harness.mjs")
        proc = subprocess.run(
            ["node", str(work / "harness.mjs"),
             str(FIXTURES / "tank_law_wake.ndjson.gz"),
             str(FIXTURES / "tank_law_wake_terrain.json.gz")],
            capture_output=True, text=True, timeout=120)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stdout}\n{proc.stderr}")
    return json.loads(proc.stdout)


class TankLawTests(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()

    def test_every_phase_was_replayed(self) -> None:
        for key in SCORED:
            self.assertIn(key, self.results["acked"], key)
            self.assertGreaterEqual(self.results["acked"][key]["horizontal"]["n"], 20, key)

    def test_the_page_tracks_the_server_to_two_millimetres_an_ack(self) -> None:
        for key in SCORED:
            h = self.results["acked"][key]["horizontal"]
            with self.subTest(phase=key):
                self.assertLessEqual(h["median"], 2.0, h)
                self.assertLessEqual(h["max"], 10.0, h)

    def test_the_hull_rides_the_servers_springs(self) -> None:
        for key in SCORED:
            v = self.results["acked"][key]["vertical"]
            with self.subTest(phase=key):
                self.assertLessEqual(v["median"], 2.0, v)
                self.assertLessEqual(v["max"], 10.0, v)

    def test_the_heading_holds_to_a_fifth_of_a_degree(self) -> None:
        for key in SCORED:
            y = self.results["acked"][key]["yaw"]
            with self.subTest(phase=key):
                self.assertLessEqual(y["max"], 0.2, y)

    def test_the_drivetrain_is_the_servers(self) -> None:
        # Revs and gear are the page's own all the way: nothing corrects them.
        for key in SCORED:
            r = self.results["acked"][key]
            with self.subTest(phase=key):
                self.assertLessEqual(r["revs"]["max"], 0.01, r["revs"])
                self.assertEqual(r["gearMisses"], 0)

    def test_an_uncorrected_run_stays_within_a_few_centimetres(self) -> None:
        for key in SCORED:
            f = self.results["free"][key]
            with self.subTest(phase=key):
                self.assertLessEqual(f["horizontal"]["max"], 30.0, f["horizontal"])
                self.assertLessEqual(f["vertical"]["max"], 10.0, f["vertical"])
                self.assertLessEqual(f["yaw"]["max"], 0.3, f["yaw"])

    def test_a_frame_shorter_than_a_tick_still_runs_one_tick(self) -> None:
        # Two 1/60 s frames a word: the drive's accumulator runs the engine's
        # tick once (LOOP-1), not the law twice at half the step.
        for key in SCORED:
            h = self.results["frame60"][key]["horizontal"]
            with self.subTest(phase=key):
                self.assertLessEqual(h["median"], 2.0, h)
                self.assertLessEqual(h["max"], 10.0, h)

    def test_the_hull_sleeps_and_wakes_on_the_servers_ticks(self) -> None:
        # TANK-21: 100 quiet ticks and the root sleeps; the engine's revs wake it.
        sleep = self.results["sleep"]
        self.assertEqual(sleep["pageFree"], sleep["server"])


if __name__ == "__main__":
    unittest.main()
