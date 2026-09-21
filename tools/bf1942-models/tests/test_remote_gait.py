"""`viewer/remote-gait.js` -- the clip a third-person soldier owes.

A remote player in a room arrives as a position stream plus two stance bits
(`netcode.js` snapshot flags 4 and 8). Turning that into a clip was wrong in
three name-level ways, none of which could throw:

  * the gait halves are baked as `run.lower` / `run.upper` and bound as
    `runLower` / `runUpper`, and selection asked for `actions.run` and
    `actions.walk` -- names that never existed, so **a remote soldier never
    played a walk or a run at all**;
  * the prone pose clip is baked as `lie` (the engine's own word: `Lb_Lie`,
    `c_BfSoldierLying`) and selection asked for `prone`, so a prone remote
    stood up;
  * `crouchwalk` and `crawl` are in every published gait bundle and nothing
    referenced them.

Read back out of the published tree to be sure, not assumed:
`USMarineSoldier__Colt.pose.glb` holds exactly `stand`, `crouch`, `lie`, and
`gaits/lower.gait.glb` holds `run.lower`, `walk.lower`, `crouchwalk.lower`,
`crawl.lower` with each grip bundle carrying the four `.upper`. That check is
`test_the_clip_names_are_the_published_files_own` below, which skips when the
tree is not linked into the worktree.

The speed bands are the engine's own tables rather than new numbers:
`BFSoldierTemplate::directionalSpeed` (`0x009581b4`, `physics.js`
`DIRECTIONAL_SPEED`) is 6 m/s standing forward, 2 crouched, 1 prone, and
`walkSpeedFactor` 1/3 puts a standing walk at 2. A boundary sits at the
midpoint of the two speeds it separates -- `gait-select.js`'s own rule.
"""

from __future__ import annotations

import json
import shutil
import struct
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
VIEWER = ROOT / "viewer"
HARNESS = Path(__file__).with_name("remote_gait_harness.mjs")
MODULES = {"remote-gait.js": VIEWER / "remote-gait.js"}
POSES = VIEWER / "models" / "poses"


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


def glb_animation_names(path: Path) -> list[str]:
    data = path.read_bytes()
    json_size, kind = struct.unpack_from("<II", data, 12)
    assert kind == 0x4E4F534A, path
    doc = json.loads(data[20:20 + json_size])
    return [anim.get("name") for anim in doc.get("animations", [])]


class RemoteGaitTests(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()

    def test_the_bands_are_the_engines_own_speed_tables(self) -> None:
        self.assertEqual({"stand": 6, "crouch": 2, "prone": 1},
                         self.results["topSpeed"])
        self.assertAlmostEqual(1 / 3, self.results["walkFactor"])
        bands = self.results["bands"]
        self.assertAlmostEqual(1.0, bands["walk"])    # half of the 2 m/s walk
        self.assertAlmostEqual(4.0, bands["run"])     # midpoint of 2 and 6
        # Crouch and prone have one movement family, so their boundary
        # separates still from the SLOWEST speed it covers -- the stance's
        # walk speed, since `walkSpeedFactor` applies in every pose.
        self.assertAlmostEqual(1 / 3, bands["crouch"])   # half of 2 x 1/3
        self.assertAlmostEqual(1 / 6, bands["prone"])    # half of 1 x 1/3

    def test_a_standing_soldier_walks_and_runs(self) -> None:
        standing = self.results["standing"]
        self.assertEqual("stand", standing["still"])
        self.assertEqual("stand", standing["creeping"])
        # The bands are strict, so sitting exactly on one keeps the lower gait.
        self.assertEqual("stand", standing["atWalkBand"])
        self.assertEqual("walk", standing["walking"])
        self.assertEqual("walk", standing["betweenBands"])
        self.assertEqual("walk", standing["atRunBand"])
        self.assertEqual("run", standing["running"])
        # A speed is a magnitude, and a missing one is standing still.
        self.assertEqual("run", standing["negative"])
        self.assertEqual("stand", standing["nonsense"])

    def test_crouch_has_one_movement_family(self) -> None:
        crouched = self.results["crouched"]
        self.assertEqual("crouch", crouched["still"])
        self.assertEqual("crouch", crouched["atBand"])
        # A crouched man with the walk key down makes 0.67 m/s; he is moving.
        self.assertEqual("crouchwalk", crouched["walking"])
        self.assertEqual("crouchwalk", crouched["moving"])
        # There is no crouch-run: a lerp that overshoots still crouch-walks.
        self.assertEqual("crouchwalk", crouched["fast"])

    def test_prone_crawls_and_outranks_crouch(self) -> None:
        prone = self.results["prone"]
        self.assertEqual("prone", prone["still"])
        self.assertEqual("prone", prone["atBand"])
        # And with the walk key down, 0.33 m/s: still a crawl.
        self.assertEqual("crawl", prone["walking"])
        self.assertEqual("crawl", prone["crawling"])
        # `soldier.js` `#gaitFor` tests prone first; so does this.
        self.assertEqual("prone", prone["bothBits"])
        self.assertEqual("crawl", prone["bothBitsMoving"])

    def test_a_full_rig_plays_the_family_it_was_asked_for(self) -> None:
        self.assertEqual(
            {"stand": "stand", "walk": "walk", "run": "run",
             "crouch": "crouch", "crouchwalk": "crouchwalk",
             "prone": "prone", "crawl": "crawl"},
            self.results["resolvedFull"])

    def test_a_rig_with_no_gait_bundle_keeps_the_stance(self) -> None:
        # The fallbacks go toward the stance before they go toward standing: a
        # crawling man whose crawl did not bind is better drawn lying still.
        poses = self.results["resolvedPoses"]
        self.assertEqual("stand", poses["walk"])
        self.assertEqual("stand", poses["run"])
        self.assertEqual("crouch", poses["crouchwalk"])
        self.assertEqual("prone", poses["crawl"])
        self.assertEqual("prone", poses["prone"])

    def test_the_defect_this_replaces_is_pinned(self) -> None:
        # With only the two names the old code could ever reach, everything
        # prone or moving collapsed onto a standing pose. That is what the
        # page drew.
        broken = self.results["resolvedBroken"]
        self.assertEqual("stand", broken["walk"])
        self.assertEqual("stand", broken["run"])
        self.assertEqual("stand", broken["prone"])
        self.assertEqual("stand", broken["crawl"])
        self.assertEqual("crouch", broken["crouchwalk"])

    def test_an_unknown_family_and_an_unnamed_rig(self) -> None:
        self.assertEqual("crawl", self.results["resolvedNoBound"])
        self.assertEqual("stand", self.results["resolvedUnknown"])

    def test_end_to_end(self) -> None:
        end = self.results["endToEnd"]
        self.assertEqual("prone", end["proneStill"])
        self.assertEqual("crawl", end["proneCrawling"])
        self.assertEqual("crouchwalk", end["crouchMoving"])
        self.assertEqual("run", end["running"])
        self.assertEqual("stand", end["runningPosesOnly"])
        self.assertEqual("prone", end["crawlingPosesOnly"])

    def test_the_clip_names_are_the_published_files_own(self) -> None:
        pose = POSES / "USMarineSoldier__Colt.pose.glb"
        lower = POSES / "gaits" / "lower.gait.glb"
        upper = POSES / "gaits" / "Colt.gait.glb"
        if not (pose.exists() and lower.exists() and upper.exists()):
            raise unittest.SkipTest("the poses tree is not linked into this worktree")
        clips = self.results["clips"]
        pose_names = glb_animation_names(pose)
        # The prone pose is `lie`, which is the name the renderer asked for
        # wrongly for as long as this code has existed.
        self.assertIn("lie", pose_names)
        self.assertNotIn("prone", pose_names)
        for family in ("stand", "crouch", "prone"):
            self.assertIn(clips[family]["pose"], pose_names, family)
        lower_names = glb_animation_names(lower)
        upper_names = glb_animation_names(upper)
        for family in ("walk", "run", "crouchwalk", "crawl"):
            self.assertIn(clips[family]["lower"], lower_names, family)
            self.assertIn(clips[family]["upper"], upper_names, family)


if __name__ == "__main__":
    unittest.main()
