"""`viewer/hud.js`, and the damage indicator's clock in `viewer/soldier-hud.js`,
driven headless by `hud_harness.mjs`.

Only what needs no canvas, sprite pack or font atlas: the fill-picture bar
window (which band of a `fill-picture` leaf the fill layer is clipped to, where
the first bug was), wrapping, the seat dots, the crosshair's hit marks, and the
damage indicator -- its wash, its octant and its six-frame clock.
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
MODULES = {"hud.js": VIEWER / "hud.js", "soldier-hud.js": VIEWER / "soldier-hud.js"}


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

    # --- the soldier ammo panel's type enum (ledger HUD-10) ----------------

    def test_an_at_icon_weapon_feeds_2_so_a_bazooka_shows_its_rockets(self) -> None:
        # The one real change HUD-10 asks for. `map.html` fed 6 for `ATIcon`,
        # on the reasoning that 6 and 7 painted the same and the choice was
        # arbitrary. It is neither: 6 is `ATIconAndHeatBar` (the MedPack), and
        # the `{6,7}` panel has no rounds text at all — so every AT weapon in
        # the game showed an icon with no count beside it. 2 lands in the
        # `{2,3,4,5}` panel, which prints one.
        ammo = self.results["ammoType"]
        self.assertEqual(2, ammo["bazooka"])
        self.assertEqual(6, ammo["medPack"])

    def test_the_con_word_and_the_meme_value_are_one_enumeration(self) -> None:
        # No converter to write: the client's own `operator>>` (`0x004c4cd0`)
        # stores the same seven values the layout tests. Every vanilla hand
        # weapon, through the table.
        ammo = self.results["ammoType"]
        self.assertEqual(
            {"atnone": 0, "atammobar": 1, "aticon": 2, "aticonandstrengthbar": 3,
             "aticonandreloadbar": 4, "aticonnotext": 5, "aticonandheatbar": 6},
            ammo["codes"])
        self.assertEqual(1, ammo["thompson"])
        self.assertEqual(3, ammo["grenade"])
        self.assertEqual(4, ammo["repairPack"])
        self.assertEqual(0, ammo["knife"])

    def test_which_types_print_rounds_is_read_off_the_layouts_own_gate(self) -> None:
        # `AMMO_TYPES_WITH_ROUNDS` is not a choice: run the layout's real
        # `when` list for the `Ammo/PrimaryAmmo` text through `hud.js`'s own
        # condition evaluator and exactly 2 and 3 survive it.
        ammo = self.results["ammoType"]
        self.assertEqual([2, 3], ammo["roundsTextAdmits"])
        self.assertEqual(ammo["roundsTextAdmits"], ammo["withRounds"])

    def test_an_unfed_dot_is_not_drawn_at_the_layouts_placeholder(self) -> None:
        # A scene extracted before the word was parsed feeds no pair, and the
        # leaf's own rect is that pair's AUTHORED DEFAULT -- the six leaves
        # are a 5px diagonal staircase from (247,457), i.e. the panel origin
        # plus (55,5)..(85,30). Drawing there claims a seat layout the data
        # does not have. Measured on the page (Kasserine Hanomag): 0 texels
        # of dot in that corner with the pairs fed, 66 with them deleted.
        # Half a pair is treated the same way.
        dots = self.results["seatDots"]
        self.assertIsNone(dots["unfed"])
        self.assertIsNone(dots["halfFed"])
        self.assertEqual(0, dots["unfedDrawsNothing"])
        # ...and a fed one does reach the canvas, at the anchored position.
        self.assertEqual([[246, 555]], dots["fedDrawsOne"])
        # A leaf binding no pair at all keeps its own rect: it never claimed
        # to be placed by a variable.
        self.assertEqual(dots["layoutRect"][:2], dots["noBinding"])

    def test_hit_octants_map_to_compass_directions(self) -> None:
        octants = self.results["hitOctants"]
        self.assertEqual(1, octants["front"])
        self.assertEqual(2, octants["frontRight"])
        self.assertEqual(3, octants["right"])
        self.assertEqual(4, octants["rearRight"])
        self.assertEqual(5, octants["rear"])
        self.assertEqual(6, octants["rearLeft"])
        self.assertEqual(7, octants["left"])
        self.assertEqual(8, octants["frontLeft"])

    # -- the crosshair's hit marks (XHIT-1, XHIT-7, XHIT-8) ---------------------

    def slope(self, seg: dict) -> str:
        """`\\` when the segment runs top-left to bottom-right on the y-down
        frame, `/` the other way -- how the capture's marks read."""
        (ax, ay), (bx, by) = sorted([seg["a"], seg["b"]])
        return "\\" if by > ay else "/"

    def test_the_marks_are_radial_diagonals_like_the_capture(self) -> None:
        # Top-left `\`, top-right `/`, bottom-left `/`, bottom-right `\`: each
        # points away from the crosshair, as in the owner's recording.
        marks = self.results["hitMarks"]["atHit"]
        self.assertEqual(["\\", "/", "/", "\\"], [self.slope(m) for m in marks])

    def test_each_mark_turns_about_its_own_centre(self) -> None:
        # XHIT-8: the rotated quad's midpoint is the unrotated rect's centre.
        rects = [[387, 288, 1, 3], [408, 289, 3, 1], [387, 310, 3, 1], [409, 309, 1, 3]]
        for seg, (x, y, w, h) in zip(self.results["hitMarks"]["atHit"], rects):
            mid = [(seg["a"][i] + seg["b"][i]) / 2 for i in (0, 1)]
            self.assertAlmostEqual(x + w / 2, mid[0], places=3)
            self.assertAlmostEqual(y + h / 2, mid[1], places=3)

    def test_the_marks_turn_counter_clockwise_by_the_datas_angle(self) -> None:
        # The vertical top-left quad: its top end goes LEFT (RotateEffect is
        # counter-clockwise, VHUD-9), by 0.8 rad from vertical.
        import math
        seg = self.results["hitMarks"]["atHit"][0]
        top = min(seg["a"], seg["b"], key=lambda p: p[1])
        bottom = max(seg["a"], seg["b"], key=lambda p: p[1])
        self.assertLess(top[0], bottom[0])
        angle = math.atan2(bottom[0] - top[0], bottom[1] - top[1])
        self.assertAlmostEqual(0.8, angle, places=4)   # endpoints are rounded to 1e-3

    def test_the_marks_are_the_crosshair_colour_at_the_timers_alpha(self) -> None:
        marks = self.results["hitMarks"]
        # 255/256, as the engine divides it -- not 255/255.
        self.assertEqual("rgb(254,0,0)", marks["atHit"][0]["style"])
        self.assertEqual("rgb(254,254,0)", marks["yellow"]["style"])
        self.assertEqual(1, marks["atHit"][0]["alpha"])
        self.assertEqual(0.5, marks["halfWay"]["alpha"])

    def test_nothing_draws_at_rest_unfed_hidden_or_under_a_periscope(self) -> None:
        marks = self.results["hitMarks"]
        for case in ("atRest", "unfedTimer", "groupHidden", "periscope"):
            self.assertIsNone(marks[case], case)

    def test_a_layout_without_the_new_fields_paints_as_before(self) -> None:
        legacy = self.results["hitMarks"]["legacyLeaf"]
        self.assertEqual([387.5, 288], legacy["a"])
        self.assertEqual([387.5, 291], legacy["b"])
        self.assertEqual("rgb(1,1,1)", legacy["style"])

    # -- the damage indicator: wash, arc, octant and clock (HFD-1..HFD-8) -------

    def test_a_zero_right_dot_is_the_right_side(self) -> None:
        # Client 0x004b0993: `fcomp 0.0; test ah,5; jp` -- r >= 0 is right.
        octants = self.results["hitOctants"]
        self.assertEqual([2, 3, 4, 8], [octants["zeroRightFront"], octants["zeroRightSide"],
                                        octants["zeroRightRear"], octants["justLeft"]])

    def test_the_octant_puts_the_right_side_on_the_screens_right(self) -> None:
        # At yaw 0 a soldier faces +z and the camera's right is -x
        # (`free-camera.js`: rx = -cos yaw, rz = sin yaw). The page used to
        # dot with +x, which mirrored every arc.
        yaw0 = self.results["hitFromDir"]["yaw0"]
        self.assertEqual(
            {"front": 1, "frontRight": 2, "right": 3, "rearRight": 4,
             "rear": 5, "rearLeft": 6, "left": 7, "frontLeft": 8}, yaw0)
        self.assertEqual({"front": 1, "right": 3, "left": 7},
                         self.results["hitFromDir"]["yawQuarter"])
        self.assertEqual(3, self.results["hitFromDir"]["offOrigin"])

    def test_the_octant_is_three_dimensional(self) -> None:
        # `calcLookAtMatrix` row 2 is the unit 3-D direction: a muzzle 1.5 m
        # up at 2 m is 0.8 forward, past cos 22.5 deg; at 40 m it is not.
        got = self.results["hitFromDir"]
        self.assertEqual(2, got["closeAndHigh"])
        self.assertEqual(1, got["farAndHigh"])
        self.assertEqual(3, got["overhead"])

    def test_a_source_on_the_victim_is_the_identity_look_at(self) -> None:
        # Row 2 of an identity is the engine's +z, this frame's -z.
        got = self.results["hitFromDir"]
        self.assertEqual(5, got["coincidentFacingPlusZ"])
        self.assertEqual(1, got["coincidentFacingMinusZ"])

    def test_the_alpha_is_the_damages_share_capped_at_three_quarters(self) -> None:
        a = self.results["hitFromDirAlpha"]
        self.assertAlmostEqual(1 / 3, a["third"])
        self.assertEqual(0.75, a["exactCap"])
        self.assertEqual(0.75, a["overCap"])
        self.assertEqual(0, a["none"])
        self.assertEqual(0, a["negative"])
        self.assertEqual(0, a["zeroOverZero"])
        self.assertEqual(0.75, a["overZero"])

    def test_the_wash_covers_the_screen_in_red_at_the_variables_alpha(self) -> None:
        wash = self.results["wash"]
        self.assertEqual([{"fill": [0, 0, 800, 600], "alpha": 0.545, "style": "rgb(255,0,0)"}],
                         wash["fed"])
        # Direction 1 has no arc, but the wash is not gated on the direction.
        self.assertEqual(0.3, wash["frontHit"][0]["alpha"])
        self.assertEqual([], wash["off"])
        self.assertEqual([], wash["unfed"])

    def test_a_layout_without_colour_bindings_sets_the_alpha_rather_than_halving_it(self) -> None:
        # `VariableColorEffect` sets the colour (XHIT-7); the file's 0.5 is
        # only its default.
        wash = self.results["wash"]
        self.assertEqual(0.545, wash["legacy"][0]["alpha"])
        self.assertEqual(0.545, wash["legacyArc"][0]["alpha"])
        self.assertEqual(0.545, wash["arc"][0]["alpha"])
        self.assertEqual([], wash["arcOtherSide"])

    def test_groups_paint_in_the_engines_chain_order(self) -> None:
        order = self.results["paintOrder"]["painted"]
        # The wash tints everything drawn before it and nothing after it.
        wash = order.index("hitIndicator")
        for key in ("crosshair", "supplyIcon", "weaponBar", "soldierIcon", "soldierAmmo",
                    "vehicleIcon", "vehicleHealth", "vehicleSeats", "primaryAmmo",
                    "secondaryAmmo", "tickets"):
            self.assertLess(order.index(key), wash, key)
        self.assertGreater(order.index("outside"), wash)
        # A group the constant does not know still paints, last.
        self.assertEqual("someModGroup", order[-1])

    def test_the_flash_is_six_painted_frames_at_a_constant_alpha(self) -> None:
        single = self.results["hitClock"]["single"]
        self.assertEqual([3, 3, 3, 3, 3, 3, 0, 0], single["dirs"])
        self.assertEqual([0.4] * 8, single["alphas"])

    def test_the_flash_counts_frames_not_seconds(self) -> None:
        # `BfMenu::paint` steps the menu 1/30 a frame whatever the frame
        # rate, so the flash is six frames at 144 Hz and at 20 Hz alike.
        clock = self.results["hitClock"]
        self.assertEqual([3, 3, 3, 3, 3, 3, 0, 0], clock["at144"])
        self.assertEqual([3, 3, 3, 3, 3, 3, 0, 0], clock["at20"])

    def test_a_second_hit_turns_the_arc_but_does_not_stretch_the_flash(self) -> None:
        burst = self.results["hitClock"]["burst"]
        self.assertEqual([3, 3, 5, 5, 5, 5, 0, 0], burst["dirs"])
        self.assertEqual([0.4, 0.4] + [0.2] * 6, burst["alphas"])
        self.assertEqual([7, 7, 7, 7, 7, 7, 0, 0], self.results["hitClock"]["again"])

    def test_hp_lost_unraised_washes_the_screen_without_an_arc(self) -> None:
        poll = self.results["hitClock"]["poll"]
        self.assertEqual([1] * 6 + [0, 0], poll["dirs"])
        self.assertAlmostEqual(0.3, poll["alphas"][0])

    def test_hp_a_hit_already_raised_is_not_raised_again(self) -> None:
        self.assertEqual([4] * 6 + [0, 0], self.results["hitClock"]["raisedOnce"])

    def test_putting_it_out_is_immediate_and_the_next_hit_gets_all_six(self) -> None:
        cleared = self.results["hitClock"]["cleared"]
        self.assertEqual([3, 3, 3], cleared["before"])
        self.assertEqual([0], cleared["cleared"])
        self.assertEqual([6] * 6 + [0, 0], cleared["after"])


if __name__ == "__main__":
    unittest.main()
