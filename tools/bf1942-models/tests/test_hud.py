"""`viewer/hud.js`'s fill-picture geometry, driven headless by `hud_harness.mjs`.

Only the bar-window arithmetic is covered here -- the part that decides which
band of a `fill-picture` leaf the fill layer is clipped to. Everything else in
that module needs a real canvas, a sprite pack and a font atlas; this needs
none of them, and it is where the bug was.
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
HARNESS = Path(__file__).with_name("hud_harness.mjs")
MODULES = {"hud.js": VIEWER / "hud.js"}


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


class FillPictureGeometryTests(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()

    def test_the_combat_area_warning_wraps_into_its_own_plate(self) -> None:
        # The first leaf whose string is wider than its rect. `menu/InGame`
        # backs it with `textmessBG_3LINE_256x64` -- three lines of art for a
        # 65-character string in a 230 px box -- so the engine wraps rather
        # than letting it run off the plate, which is what the painter did
        # before this. Two lines at Trebuchet MS8's real metrics.
        self.assertEqual(
            ["Warning! You are leaving the combat area!",
             "Desserters will be shot!"],
            self.results["wrap"]["warning"])

    def test_a_string_that_fits_is_left_on_one_line(self) -> None:
        # Every leaf fed before this one -- ammo counts, ticket counts, kit
        # names -- is short, and none of them may start wrapping.
        wrap = self.results["wrap"]
        self.assertEqual(["30"], wrap["short"])
        self.assertEqual(1, len(wrap["exact"]))
        self.assertEqual([], wrap["empty"])

    def test_a_word_wider_than_the_box_overflows_rather_than_splitting(self) -> None:
        # Hyphenating a bitmap font means inventing glyph metrics. The string
        # this exists for has no such word.
        wrap = self.results["wrap"]
        self.assertEqual(1, len(wrap["longWord"]))
        self.assertEqual(["a" * 120, "tail"], wrap["longWordThenMore"])
        self.assertEqual(["a" * 46, "b"], wrap["overByOne"])

    def test_a_short_bar_fills_the_band_its_art_actually_occupies(self) -> None:
        # `reloadtimebar_*_32x64.png` is opaque over rows 0..41 of a 64-row
        # texture -- exactly the `size: 42` its leaf declares, top-anchored,
        # and its leaf is `fillOrder: true` like every other top-anchored bar
        # in `hud-layout.json`. So a full bar covers y 547..589 of the rect,
        # not 547+22..547+64. Drawn the old way the fill was clipped into
        # rows 22..64, which on this art is 20 rows of bar and 22 rows of
        # transparent padding: nothing below a fraction of 0.52 drew at all.
        bar = self.results["reloadBar"]
        self.assertEqual([549, 547, 32, 42], bar["full"]["clip"])
        self.assertEqual([549, 568, 32, 21], bar["half"]["clip"])
        self.assertEqual([549, 578.5, 32, 10.5], bar["quarter"]["clip"])

    def test_an_empty_bar_draws_only_its_empty_layer(self) -> None:
        bar = self.results["reloadBar"]
        self.assertIsNone(bar["empty"]["clip"])
        self.assertEqual(1, bar["empty"]["layers"])

    def test_the_health_bar_is_unchanged_because_size_equals_height(self) -> None:
        # The one leaf a live feed had already confirmed (R1-30): bottom
        # anchored, fills upward. At `size == h` the corrected formula is the
        # old one term for term, which is what makes the fix safe.
        health = self.results["healthBar"]
        self.assertEqual([47, 525, 64, 64], health["full"]["clip"])
        self.assertEqual([47, 557, 64, 32], health["half"]["clip"])
        x, y, w, h = health["sliver"]["clip"]
        self.assertAlmostEqual(589 - 64 / 30, y, places=4)
        self.assertAlmostEqual(64 / 30, h, places=4)

    def test_a_fillOrder_false_bar_still_hangs_off_the_bottom_edge(self) -> None:
        # `magbar_rifle_*`'s art really is bottom-anchored (opaque rows
        # 44..63 = its `size: 20`), and it is the file's only
        # `fillOrder: false` leaf. It depletes downward from the window's own
        # top edge, y + h - size.
        mag = self.results["magBar"]
        self.assertEqual([696, 561, 32, 20], mag["full"]["clip"])
        self.assertEqual([696, 561, 32, 10], mag["half"]["clip"])

    # --- `when` comparisons ------------------------------------------------

    def test_the_combat_area_warning_is_culled_until_the_countdown_runs(self) -> None:
        # `menu/InGame`'s gate is `0 < Outside/OutsideTime`, which the
        # extractor flips to `{Outside/OutsideTime, gt, 0}`. `condOk` did not
        # implement `gt` and its default does not cull, so the plate, the
        # 65-character warning and the countdown drew over every level's HUD
        # -- including the 12 vanilla levels that declare no combat area at
        # all, where the countdown can never be anything but zero.
        c = self.results["conditions"]
        self.assertFalse(c["outsideAtZero"])
        self.assertTrue(c["outsideAtOne"])
        self.assertTrue(c["outsideAtTen"])

    def test_the_weapon_bar_shows_only_the_slots_the_kit_has(self) -> None:
        # The same fail-open default, on a pre-existing group: the fifth and
        # sixth weapon-select slots are `{Weapon/NumberOfItems, ge, 5|6}`.
        c = self.results["conditions"]
        self.assertFalse(c["slotFiveWithFour"])
        self.assertTrue(c["slotFiveWithFive"])
        self.assertTrue(c["slotFiveWithSix"])

    def test_the_operators_that_already_worked_are_unmoved(self) -> None:
        c = self.results["conditions"]
        self.assertTrue(c["ltTrue"])
        self.assertFalse(c["ltFalse"])
        self.assertTrue(c["leTrue"])
        self.assertTrue(c["eqTrue"])
        self.assertTrue(c["neTrue"])

    def test_a_nested_or_recurses_through_the_new_operators(self) -> None:
        c = self.results["conditions"]
        self.assertTrue(c["nested"])
        self.assertFalse(c["nestedFalse"])

    # --- the turret dial's rotation sense (ledger VHUD-9) -------------------

    def test_the_dial_turns_counter_clockwise_like_RotateEffect(self) -> None:
        # The engine's `RotateEffect` (client `0x007edbf0`) computes
        # `x' = x·cos + y·sin`, `y' = -x·sin + y·cos` about the pivot, so on
        # the HUD's y-down frame `(0,-1)` at +90 degrees becomes `(-1,0)`:
        # the sprite's top goes LEFT. Canvas `rotate(+θ)` would send it right,
        # which is why `_drawPicture` negates.
        dial = self.results["turretDial"]
        cx, cy = dial["centre"]
        self.assertEqual([cx, cy - 16], [dial["atZero"]["topX"], dial["atZero"]["topY"]])
        self.assertEqual([cx - 16, cy],
                         [dial["atPlus90"]["topX"], dial["atPlus90"]["topY"]])
        self.assertEqual([cx + 16, cy],
                         [dial["atMinus90"]["topX"], dial["atMinus90"]["topY"]])

    def test_the_canvas_rotation_is_the_negated_engine_angle(self) -> None:
        # Stated on its own because it is half of a PAIR: `map.html` feeds the
        # un-negated engine value (`TurretRig.turretYawRadians`), and it used
        # to feed `headingRadians()`, which carries `seats.js`'s
        # `RIG_SIGN.yaw = -1`. Two errors cancelling. Change one side without
        # the other and every dial in the game mirrors.
        dial = self.results["turretDial"]
        self.assertAlmostEqual(-1.570796, dial["atPlus90"]["canvasRotation"], places=5)
        self.assertAlmostEqual(1.570796, dial["atMinus90"]["canvasRotation"], places=5)

    def test_an_unrotated_picture_still_takes_the_plain_path(self) -> None:
        self.assertTrue(self.results["turretDial"]["unrotatedTakesThePlainPath"])

    # --- the seat dots' placement (ledger VHUD-11, VHUD-7) -----------------

    def test_a_dot_sits_at_the_panel_origin_plus_its_seats_own_offset(self) -> None:
        # VHUD-7 draws the six dots at `(192 + VehiclePosX[i+1],
        # 452 + VehiclePosY[i+1])`, and VHUD-11 found what feeds those: each
        # PlayerControlObject's own `setVehicleIconPos`. Sherman root 54/103
        # lands at (246, 555) — inside the 128x128 icon panel, which starts at
        # (200, 462). That geometry check is what turned the row from "the
        # data is not carried" into "the data was never parsed".
        dots = self.results["seatDots"]
        self.assertEqual([246, 555], dots["shermanRoot"])
        self.assertEqual([224, 513], dots["shermanGunner"])

    def test_an_unfed_dot_keeps_the_layouts_own_rect(self) -> None:
        # A scene extracted before the word was parsed has no pair to feed,
        # and six dots stacked at the panel's corner would be worse than the
        # layout's authored defaults. Half a pair is treated the same way.
        dots = self.results["seatDots"]
        self.assertEqual(dots["layoutRect"][:2], dots["unfed"])
        self.assertEqual(dots["layoutRect"][:2], dots["halfFed"])


if __name__ == "__main__":
    unittest.main()
