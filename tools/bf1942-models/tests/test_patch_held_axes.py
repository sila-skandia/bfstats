"""`patch_held_axes.py`: a finished glb gets back the held key axes the exporter
dropped from a vehicle with no visible Springs (FHSWEurope al_marj-1942's Flak
18/36, whose APHE/AA selector is on W/S), exactly as a fresh extract writes
them, and a second run changes nothing."""

from __future__ import annotations

import copy
import os
import sys
import tempfile
import unittest
from unittest import mock
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from bf42.assemble import browse_rig  # noqa: E402
from bf42.con import ObjectLibrary  # noqa: E402
import patch_held_axes  # noqa: E402
from bf42 import glbgz, glbopt  # noqa: E402
from patch_held_axes import patch_doc, patch_file  # noqa: E402

CON = """
ObjectTemplate.create RotationalBundle Flak18/36GunSelector
ObjectTemplate.setMinRotation 0/0/-180
ObjectTemplate.setMaxRotation 0/0/0
ObjectTemplate.setMaxSpeed 0/0/900000
ObjectTemplate.setAcceleration 0/0/90000000
ObjectTemplate.setInputToRoll c_PIThrottle

ObjectTemplate.create RotationalBundle Flak18/36GunBase
ObjectTemplate.setMinRotation 0/-5/0
ObjectTemplate.setMaxRotation 0/85/0
ObjectTemplate.setMaxSpeed 0/27/0
ObjectTemplate.setAcceleration 0/-150/0
ObjectTemplate.setInputToPitch c_PIMouseLookY

ObjectTemplate.create RotationalBundle Elco_ThrottleR
ObjectTemplate.setMinRotation 0/-30/0
ObjectTemplate.setMaxRotation 0/30/0
ObjectTemplate.setInputToPitch c_PIThrottle
ObjectTemplate.setAutomaticReset 1
"""


def doc() -> dict:
    return {"nodes": [
        {"name": "Flak18/36GunSelector", "children": [1],
         "extras": {"templateKind": "RotationalBundle", "geometry": None, "control": "Flak18/36"}},
        {"name": "Flak18/36GunBase", "mesh": 0,
         "extras": {"templateKind": "RotationalBundle", "control": "Flak18/36",
                    "rig": {"axes": {"pitch": {"input": "c_PIMouseLookY"}}, "automaticReset": False,
                            "control": "Flak18/36"}}},
        {"name": "Elco_ThrottleR_1", "mesh": 1,
         "extras": {"templateKind": "RotationalBundle", "control": "Elco"}},
        # Nothing drawn and nothing under it: an extract never rigs it.
        {"name": "Flak18/36GunSelector_2",
         "extras": {"templateKind": "RotationalBundle", "control": "Flak18/36"}},
    ]}


class PatchHeldAxesTests(unittest.TestCase):
    def setUp(self) -> None:
        self.library = ObjectLibrary()
        self.library.add_con("Objects/Vehicles/Land/Flak18-36/Objects.con", CON)

    def test_the_selector_gets_the_rig_a_fresh_extract_writes(self) -> None:
        d = doc()
        self.assertEqual(1, patch_doc(d, self.library))
        fresh = browse_rig(self.library.object("Flak18/36GunSelector"), has_visible_springs=False)
        rig = d["nodes"][0]["extras"]["rig"]
        self.assertEqual(fresh["axes"], rig["axes"])
        self.assertFalse(rig["automaticReset"])
        self.assertEqual("Flak18/36", rig["control"])

    def test_a_reset_lever_a_rigged_aim_axis_and_an_empty_node_are_left(self) -> None:
        d = doc()
        before = copy.deepcopy(d)
        patch_doc(d, self.library)
        self.assertEqual(before["nodes"][1:], d["nodes"][1:])

    def test_the_kind_is_read_as_the_con_spells_it(self) -> None:
        # FHSWEurope's horse legs: `rotationalbundle`, lower case. The patch
        # read only `RotationalBundle` and left all three horses without the
        # throttle's held pitch (v_static, 2026-10-15).
        d = doc()
        d["nodes"][0]["extras"]["templateKind"] = "rotationalbundle"
        self.assertEqual(1, patch_doc(d, self.library))
        self.assertIn("rig", d["nodes"][0]["extras"])

    def test_a_second_run_changes_nothing(self) -> None:
        d = doc()
        patch_doc(d, self.library)
        once = copy.deepcopy(d)
        self.assertEqual(0, patch_doc(d, self.library))
        self.assertEqual(once, d)


class PatchFileTests(unittest.TestCase):
    """Other sessions audit and patch the same trees while this runs
    (2026-10-28: an overnight behaviour audit and a projectile-field patcher on
    FHSWEurope): every file is replaced whole, and only from the bytes on disk."""

    def setUp(self) -> None:
        self.library = ObjectLibrary()
        self.library.add_con("Objects/Vehicles/Land/Flak18-36/Objects.con", CON)
        self.dir = Path(tempfile.mkdtemp())
        self.glb = self.dir / "flak.glb"
        self.glb.write_bytes(glbopt.write_glb(doc(), b"\0" * 8))

    def tearDown(self) -> None:
        for p in self.dir.iterdir():
            p.unlink()
        self.dir.rmdir()

    def test_the_glb_and_its_gz_are_replaced_by_rename(self) -> None:
        snapshot = self.dir / "snapshot.glb"
        os.link(self.glb, snapshot)
        old = snapshot.read_bytes()
        self.assertEqual(1, patch_file(self.glb, self.library))
        # A new inode: the hard-link snapshot keeps what it was taken with.
        self.assertEqual(old, snapshot.read_bytes())
        self.assertNotEqual(snapshot.stat().st_ino, self.glb.stat().st_ino)
        data = self.glb.read_bytes()
        self.assertIn("rig", glbopt.read_glb(data)[0]["nodes"][0]["extras"])
        self.assertTrue(glbgz.is_fresh(data, glbgz.gz_path(self.glb)))
        self.assertEqual([], [p for p in self.dir.iterdir() if p.suffix == ".tmp"])
        self.assertEqual(0, patch_file(self.glb, self.library))

    def test_a_file_rewritten_while_patching_is_read_again(self) -> None:
        # Another session's patch lands between the read and the write: its
        # field must survive, so the patch is redone from the new bytes.
        real = patch_held_axes.patch_bytes
        calls = []

        def racing(data, library):
            out = real(data, library)
            if not calls:
                d, blob = glbopt.read_glb(self.glb.read_bytes())
                d["nodes"][1]["extras"]["otherSession"] = 1
                self.glb.write_bytes(glbopt.write_glb(d, blob))
                os.utime(self.glb, ns=(1, 1))
            calls.append(1)
            return out

        with mock.patch.object(patch_held_axes, "patch_bytes", racing):
            self.assertEqual(1, patch_file(self.glb, self.library))
        self.assertEqual(2, len(calls))
        nodes = glbopt.read_glb(self.glb.read_bytes())[0]["nodes"]
        self.assertEqual(1, nodes[1]["extras"]["otherSession"])
        self.assertIn("rig", nodes[0]["extras"])


if __name__ == "__main__":
    unittest.main()
