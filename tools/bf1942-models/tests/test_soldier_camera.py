"""`viewer/soldier-camera.js` against the engine, through node.

What C does to a soldier. The engine's half is read out of
`bf1942_lnxded.static` and out of the shipped `.con` data and is asserted
here; the parachute cycle on top of it is a viewer choice made to the owner's
play, and this file says which is which in the same words the module does.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MODULES = [ROOT / "viewer" / "soldier-camera.js"]
HARNESS = Path(__file__).resolve().parent / "soldier_camera_harness.mjs"


def run_harness() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        (work / "package.json").write_text('{"type": "module"}')
        for module in MODULES:
            shutil.copyfile(module, work / module.name)
        shutil.copyfile(HARNESS, work / "harness.mjs")
        proc = subprocess.run(
            ["node", str(work / "harness.mjs")],
            capture_output=True, text=True, timeout=120)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


CONTROLS = (Path("/home/dylan/.wine/drive_c/EA Games/Battlefield 1942")
            / "Mods/bf1942/Settings/Default/Controls")
SOLDIER_OBJECTS = "Objects/Soldiers/Common/Objects.con"


class SoldierCameraTests(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()

    # --- the engine's half -------------------------------------------------

    def test_c_is_the_camera_mode_toggle_in_every_control_map(self) -> None:
        """`c_PIToggleCameraMode` is input channel 26 and IDKey_C binds it.

        Read from the shipped control maps rather than asserted from memory.
        Infantry.con is the one that matters: it is why C reaches a soldier.
        """
        if not CONTROLS.is_dir():
            raise unittest.SkipTest("the game is not installed here")
        for name in ("Infantry", "Land", "Air", "Common"):
            with self.subTest(map=name):
                text = (CONTROLS / f"{name}.con").read_text(errors="replace")
                lines = [ln.strip() for ln in text.splitlines()
                         if "IDKey_C " in ln or ln.rstrip().endswith("IDKey_C")]
                bound = [ln for ln in lines if " IDKey_C " in f"{ln} "]
                self.assertTrue(bound, f"{name}.con binds nothing to IDKey_C")
                # And it binds it to exactly one trigger, the camera toggle.
                self.assertEqual(1, len(bound))
                self.assertIn("c_PIToggleCameraMode", bound[0])

    def test_the_soldier_camera_authorises_only_inside(self) -> None:
        # Objects/Soldiers/Common/Objects.con, the only place in vanilla that
        # writes all six CVM words. Camera::setViewMode (0x081ac7c0) refuses
        # any mode whose word is zero.
        cvm = self.results["cvm"]
        self.assertEqual(1, cvm["CVMInside"])
        for word in ("CVMChase", "CVMFrontChase", "CVMFlyBy",
                     "CVMTrace", "CVMExternTrace"):
            with self.subTest(word=word):
                self.assertEqual(0, cvm[word])

    def test_the_engines_own_cycle_for_a_soldier_is_one_view(self) -> None:
        self.assertEqual(["inside"], self.results["engineCycle"])
        foot = self.results["onFoot"]
        self.assertEqual(["inside"], foot["modes"])
        # Four presses of C, still first person.
        self.assertEqual(["inside"] * 5, foot["seen"])
        self.assertTrue(foot["firstPerson"])

    def test_the_mode_ids_are_the_engines_switch_labels(self) -> None:
        # Camera::setViewMode's cases, and Camera::getViewMode (0x081acc10)
        # reads the same number back out of Camera+0x14c.
        ids = self.results["modeIds"]
        self.assertEqual(3, ids["inside"])
        self.assertEqual(12, ids["chase"])
        self.assertEqual(13, ids["front"])
        self.assertEqual(14, ids["flyby"])
        self.assertEqual(16, ids["trace"])
        self.assertEqual(17, ids["externTrace"])

    # --- the viewer's half, marked as such ---------------------------------

    def test_the_canopy_cycles_three_views(self) -> None:
        # A VIEWER CHOICE made to the owner's play, not an engine reading:
        # the shipped SoldierCamera forbids both external modes. See the
        # header of soldier-camera.js.
        self.assertEqual(["inside", "chase", "front"],
                         self.results["parachuteCycle"])

    def test_the_canopy_cycle_walks_on_c(self) -> None:
        air = self.results["underCanopy"]
        self.assertEqual(["inside", "chase", "front", "inside"], air["seen"])
        self.assertEqual([3, 12, 13, 3], air["ids"])

    # --- on foot, 2026-10-15 (features/soldier-third-person-camera) ---------

    def test_on_foot_the_page_offers_inside_and_chase(self) -> None:
        # A VIEWER DEPARTURE from CAM-1, made to the owner's report of retail.
        # Front-chase and fly-by stay out: F11 and C were the 2026-09-26
        # accident (features/viewer-foot-first-person).
        foot = self.results["footCycle"]
        self.assertEqual(["inside", "chase"], foot["cycle"])
        self.assertEqual(["inside", "chase"], foot["modes"])
        self.assertFalse(foot["toggles"])

    def test_on_foot_f10_and_f9_switch_and_c_and_f11_do_not(self) -> None:
        foot = self.results["footCycle"]
        self.assertEqual("inside", foot["start"])
        self.assertEqual("inside", foot["afterC"])      # C: nothing
        self.assertEqual("inside", foot["afterF11"])    # F11, front: refused
        self.assertEqual("chase", foot["afterF10"])     # F10: the chase view
        self.assertEqual("inside", foot["afterF9"])     # F9: first person
        # The touch layout's VIEW button forces the cycle: a phone has no F keys.
        self.assertEqual("chase", foot["touch"])
        self.assertEqual("inside", foot["touchBack"])

    def test_the_foot_chase_radius_is_the_marked_viewer_number(self) -> None:
        # INFERRED (soldier-camera.js): the engine's is the soldier's bounding
        # radius, which PARA-6 leaves open.
        self.assertEqual(2.5, self.results["footCycle"]["radius"])

    def test_a_landing_keeps_the_chase_view_and_drops_the_front(self) -> None:
        r = self.results["footLanding"]
        self.assertEqual("chase", r["fromChase"])
        self.assertEqual("inside", r["fromFront"])
        # And a chute opening hands C back its cycle.
        self.assertTrue(r["canopyToggles"])

    def test_the_chase_view_converges_on_the_aim_point(self) -> None:
        a = self.results["aim"]
        # 2 m up, 30 degrees down onto flat ground: 4 m along the line.
        self.assertAlmostEqual(4.0, a["groundAhead"], delta=0.05)
        # Level over flat ground, upward, or with nothing to read: the reach.
        self.assertEqual(a["reach"], a["levelNoHit"])
        self.assertEqual(a["reach"], a["straightUp"])
        self.assertEqual(a["reach"], a["nothing"])
        # A static in the way wins over the ground.
        self.assertAlmostEqual(7.5, a["wall"], places=6)
        # Never closer than the near clamp.
        self.assertEqual(a["near"], a["nearClamp"])

    def test_look_angles_use_the_pages_convention(self) -> None:
        import math
        a = self.results["aim"]
        self.assertAlmostEqual(math.pi / 2, a["look"]["yaw"], places=6)
        self.assertAlmostEqual(math.atan2(1, 1), a["look"]["pitch"], places=6)
        self.assertAlmostEqual(math.pi, abs(a["lookBack"]["yaw"]), places=6)
        self.assertAlmostEqual(0.0, a["lookBack"]["pitch"], places=6)

    def test_a_landing_returns_the_view_to_first_person(self) -> None:
        r = self.results["landingResets"]
        self.assertEqual("inside", r["onFoot"])
        self.assertEqual("chase", r["inAir"])
        self.assertEqual("inside", r["afterLanding"])

    def test_a_mode_outside_the_cycle_is_refused(self) -> None:
        g = self.results["gate"]
        self.assertEqual("inside", g["refused"])
        self.assertEqual("front", g["allowed"])


if __name__ == "__main__":
    unittest.main()
