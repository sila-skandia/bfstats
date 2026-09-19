"""`viewer/kit-graft.js`: the helmet, and the two bones beside it.

A `BFSoldier` template declares a body, a head and two hands and nothing else,
so every soldier the extractor produces is bare-headed -- the helmet belongs to
the kit, and the engine hangs it off one of three bones of the wearer's own
skeleton (`A` under `Bip01 Head`, `backpack`, `HipPack`). `kits.html` has
browsed them since the kit work landed; `map.html` now dresses a seated
occupant the same way, which is why the convention moved into a module both
read rather than staying in one page.

The per-slot rotations are **pinned, not derived**, and deliberately so: three
automated checks passed that graft while every helmet was upside down (see
`features/bf1942-3d-models/kits.md`), so the eye stayed the instrument of
record. What these tests protect is that the two pages agree with each other
and that the numbers do not drift.

Like `test_seat_ik.py` this copies the module into a temp dir and runs
`node harness.mjs`; `kit-graft.js` imports nothing, so there is nothing else to
copy.
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
MODULE = ROOT / "viewer" / "kit-graft.js"
HARNESS = Path(__file__).resolve().parent / "kit_graft_harness.mjs"


def run_harness() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        shutil.copyfile(MODULE, work / "kit-graft.mjs")
        shutil.copyfile(HARNESS, work / "harness.mjs")
        proc = subprocess.run(["node", str(work / "harness.mjs")],
                              capture_output=True, text=True, timeout=60)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


class KitGraftHarness(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()


class SlotRotationTests(KitGraftHarness):
    def test_the_head_is_a_half_turn_about_y(self) -> None:
        self.assertEqual([0, 1, 0, 0], self.results["slotRotation"]["head"])

    def test_the_back_is_a_half_turn_about_z(self) -> None:
        self.assertEqual([0, 0, -1, 0], self.results["slotRotation"]["back"])

    def test_the_hip_needs_none(self) -> None:
        self.assertEqual([0, 0, 0, 1], self.results["slotRotation"]["hip"])

    def test_a_slot_the_engine_does_not_have_is_left_alone(self) -> None:
        # The engine offers exactly three attachment points; a mod inventing a
        # fourth gets the bone's own frame rather than a guess.
        self.assertEqual([0, 0, 0, 1], self.results["unknownSlotIsIdentity"])


class WornGraftTests(KitGraftHarness):
    def test_a_vanilla_kit_grafts_all_three_parts(self) -> None:
        self.assertEqual(["head", "back", "hip"],
                         [g["slot"] for g in self.results["vanilla"]])

    def test_each_part_names_the_bone_the_manifest_names(self) -> None:
        self.assertEqual(["A", "backpack", "HipPack"],
                         [g["bone"] for g in self.results["vanilla"]])

    def test_a_part_with_no_mesh_is_dropped(self) -> None:
        self.assertEqual([], self.results["noGlbIsDropped"])

    def test_a_hidden_slot_is_left_off(self) -> None:
        self.assertEqual(["head"], self.results["hidden"])

    def test_a_kit_parts_own_offsets_compose_on_top(self) -> None:
        # Vanilla and EoD declare none; FH and FHSW do, and they are further
        # offsets from the bone, not a replacement for the slot rotation.
        self.assertTrue(self.results["offsetEqualsComposition"])
        self.assertEqual([0.01, 0.02, 0.03], self.results["offset"]["position"])

    def test_a_declared_offset_actually_changes_the_rotation(self) -> None:
        self.assertNotEqual(self.results["slotRotation"]["head"],
                            self.results["offset"]["quaternion"])


class BoneMatchTests(KitGraftHarness):
    def test_case_and_separators_are_loose(self) -> None:
        self.assertTrue(self.results["bones"]["hipPackLowercase"])
        self.assertTrue(self.results["bones"]["hipPackUnderscore"])

    def test_the_match_is_anchored_so_A_is_not_every_bone(self) -> None:
        self.assertFalse(self.results["bones"]["aIsNotAnywhere"])
        self.assertTrue(self.results["bones"]["aMatchesItself"])


class ManifestIndexTests(KitGraftHarness):
    def test_kits_are_indexed_by_template_case_insensitively(self) -> None:
        self.assertEqual(2, self.results["index"]["size"])
        self.assertTrue(self.results["index"]["caseInsensitive"])


class ManifestShapeTests(unittest.TestCase):
    """The harness's `GB_AT` row is a transcription; check the real file still
    has that shape where one is on disk."""

    def test_the_published_manifest_still_hangs_parts_off_named_bones(self) -> None:
        manifest = (ROOT / "viewer" / "models" / "kits.json")
        if not manifest.is_file():
            self.skipTest("no extracted kits.json in this tree")
        data = json.loads(manifest.read_text())
        worn = [part for kit in data.get("kits", [])
                for part in kit.get("worn", [])]
        self.assertTrue(worn, "the manifest declares no worn parts")
        self.assertLessEqual({p["slot"] for p in worn}, {"head", "back", "hip"})
        self.assertLessEqual({p["bone"].lower() for p in worn},
                             {"a", "backpack", "hippack"})


if __name__ == "__main__":
    unittest.main()
