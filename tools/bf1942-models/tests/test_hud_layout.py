from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from extract_models import DEFAULT_GAME_DIR  # noqa: E402
from bf42 import meme  # noqa: E402
import extract_hud_layout as hud  # noqa: E402

GAME_MENU = DEFAULT_GAME_DIR / "Mods" / "bf1942" / "Archives" / "menu.rfa"


# --------------------------------------------------------- pure-logic tests
#
# No game install needed: these pin down the two places this file's
# condition-flattening has to do more than extract_spawn_layout.py's ever
# needed to (see the module docstring), plus the raw-u32 sign fix, against
# synthetic data built the way tests/test_meme.py's own Stream tests do
# (constructing `meme.Obj`s directly is simpler here, since there is no
# on-disk round trip to prove).

def bool_data(name: str = "", value: bool = True) -> meme.Obj:
    return meme.Obj(cls="BoolData", name=name, fields={"Value": value})


def int_data(name: str = "", value: int = 0) -> meme.Obj:
    return meme.Obj(cls="IntData", name=name, fields={"Value": value})


class ToSigned32Tests(unittest.TestCase):
    def test_small_positive_values_are_returned_unchanged(self) -> None:
        self.assertEqual(64, hud.to_signed32(64))

    def test_a_raw_value_at_or_past_2_31_becomes_negative(self) -> None:
        # Ammo/SoldierAmmo/SoldierAmmoPosY's real default, byte for byte.
        self.assertEqual(-17, hud.to_signed32(4294967279))
        self.assertEqual(-1, hud.to_signed32(4294967295))

    def test_the_boundary_itself_is_the_most_negative_value(self) -> None:
        self.assertEqual(-2147483648, hud.to_signed32(2147483648))


class ConditionTests(unittest.TestCase):
    def test_named_bool_becomes_an_eq_true_condition(self) -> None:
        self.assertEqual({"var": "Soldier/ShowSoldierIcon", "op": "eq", "value": True},
                          hud.condition(bool_data("Soldier/ShowSoldierIcon")))

    def test_unnamed_bool_is_a_hard_coded_const(self) -> None:
        self.assertEqual({"const": False}, hud.condition(bool_data("", False)))

    def test_not_of_or_becomes_and_of_negated_terms_by_de_morgan(self) -> None:
        # supplyIcon's ShowNonTakeableFlagIcon second element:
        # NOT(AxisFlagIcon OR AlliedFlagIcon).
        or_data = meme.Obj(cls="OrData", fields={
            "Data 1": bool_data("AxisFlagIcon", False),
            "Data 2": bool_data("AlliedFlagIcon", True),
        })
        not_data = meme.Obj(cls="NotData", fields={"Data": or_data})
        self.assertEqual(
            {"op": "and", "terms": [
                {"var": "AxisFlagIcon", "op": "ne", "value": True},
                {"var": "AlliedFlagIcon", "op": "ne", "value": True},
            ]},
            hud.condition(not_data),
        )

    def test_not_of_and_becomes_or_of_negated_terms(self) -> None:
        and_data = meme.Obj(cls="AndData", fields={
            "Data 1": bool_data("A"), "Data 2": bool_data("B"),
        })
        got = hud.condition(meme.Obj(cls="NotData", fields={"Data": and_data}))
        self.assertEqual("or", got["op"])
        self.assertEqual([{"var": "A", "op": "ne", "value": True},
                          {"var": "B", "op": "ne", "value": True}], got["terms"])

    def test_a_comparison_written_variable_second_is_flipped(self) -> None:
        # weaponBar's own gate on two of its six slots:
        # `5 <= Weapon/NumberOfItems` (no GreaterEqualData class exists).
        le = meme.Obj(cls="LessEqualData", fields={
            "Data 1": int_data("", 5),
            "Data 2": int_data("Weapon/NumberOfItems", 5),
        })
        self.assertEqual({"var": "Weapon/NumberOfItems", "op": "ge", "value": 5},
                          hud.condition(le))

    def test_a_comparison_written_variable_first_is_left_alone(self) -> None:
        eq = meme.Obj(cls="EqualData", fields={
            "Data 1": int_data("Ammo/AmmoType", 1), "Data 2": int_data("", 1),
        })
        self.assertEqual({"var": "Ammo/AmmoType", "op": "eq", "value": 1}, hud.condition(eq))

    def test_a_bare_named_int_used_as_a_condition_is_nonzero(self) -> None:
        # HitFromDir/HitFromDir gates its whole top-level entry as a plain
        # IntData, not a comparison -- see NOTES for why "ne 0" and not,
        # say, a read of the engine's own bool-coercion.
        got = hud.condition(int_data("HitFromDir/HitFromDir", 0))
        self.assertEqual("HitFromDir/HitFromDir", got["var"])
        self.assertEqual("ne", got["op"])
        self.assertEqual(0, got["value"])


@unittest.skipUnless(GAME_MENU.exists(), "needs the BF1942 install")
class HudLayoutGoldenTests(unittest.TestCase):
    """Golden checks against vanilla `menu/InGame` -- see
    features/bf1942-engine-reference/ for how this archive is pinned."""

    @classmethod
    def setUpClass(cls) -> None:
        from bf42.rfa import RfaArchive
        with RfaArchive(GAME_MENU) as arch:
            entry = next(e for e in arch.entries if e.lower() == "menu/ingame")
            data = arch.read(entry)
        cls.hud = hud.decode_hud(data, lexicon={})

    def group(self, key: str) -> dict:
        return self.hud["groups"][key]

    def elements_of_kind(self, key: str, kind: str) -> list[dict]:
        return [e for e in self.group(key)["elements"] if e["kind"] == kind]

    # -- the health group's rect and bindings --------------------------------

    def test_soldier_icon_group_rect(self) -> None:
        self.assertEqual([47.0, 525.0, 107.0, 64.0], self.group("soldierIcon")["rect"])

    def test_soldier_icon_group_has_the_icon_health_and_recover_elements(self) -> None:
        kinds = sorted(e["kind"] for e in self.group("soldierIcon")["elements"])
        self.assertEqual(["fill-picture", "fill-picture", "variable-picture"], kinds)

    def test_soldier_health_bar_rect_and_bindings(self) -> None:
        [health] = [e for e in self.elements_of_kind("soldierIcon", "fill-picture")
                    if e.get("valueVar") == "Soldier/SoldierHitPoints"]
        self.assertEqual([47.0, 525.0, 64.0, 64.0], health["rect"])
        self.assertEqual("healthbar_empty_scout_64x64", health["picture"])
        self.assertEqual("Soldier/SoldierHealthBarIcon", health["pictureVar"])
        self.assertEqual("healthbar_full_scout_64x64", health["fillPicture"])
        self.assertEqual("Soldier/SoldierHealthBarFullIcon", health["fillPictureVar"])
        self.assertEqual(5.0, health["value"])
        self.assertEqual("Soldier/SoldierMaxHitPoints", health["maxVar"])
        self.assertEqual(10.0, health["max"])
        self.assertEqual(64, health["size"])
        self.assertEqual("Soldier/SoldierBarSize", health["sizeVar"])
        self.assertFalse(health["horizontalAlign"])
        self.assertTrue(health["fillOrder"])
        self.assertEqual([{"var": "Soldier/ShowSoldierIcon", "op": "eq", "value": True}], health["when"])

    def test_soldier_icon_itself_defaults_to_the_standing_us_soldier(self) -> None:
        [icon] = self.elements_of_kind("soldierIcon", "variable-picture")
        self.assertEqual("Soldier/SoldierIcon", icon["var"])
        self.assertEqual("icon_us_soldier_standing", icon["texture"])
        self.assertEqual([90.0, 525.0, 64.0, 64.0], icon["rect"])

    # -- the soldier ammo panel's rect ---------------------------------------

    def test_soldier_ammo_panel_rect(self) -> None:
        self.assertEqual([690.0, 517.0, 78.0, 79.0], self.group("soldierAmmo")["rect"])

    def test_soldier_ammo_panel_is_gated_on_soldier_weapon_and_not_vehicle(self) -> None:
        for el in self.group("soldierAmmo")["elements"]:
            self.assertIn({"var": "Soldier/ShowSoldierIcon", "op": "eq", "value": True}, el["when"])
            self.assertIn({"var": "Weapon/ShowWeaponIcon", "op": "eq", "value": True}, el["when"])
            self.assertIn({"var": "Vehicle/ShowVehicleIcon", "op": "ne", "value": True}, el["when"])

    def test_soldier_ammo_magazine_bar_position_recovers_the_negative_y_default(self) -> None:
        # SoldierAmmoPosY's raw default is 4294967279 (u32) = -17 signed;
        # the resolved rect (690+6, 534-17) is the only place that shows up.
        [magbar] = [e for e in self.elements_of_kind("soldierAmmo", "fill-picture")
                    if e.get("pictureVar") == "Ammo/SoldierAmmo/SoldierAmmoBar"]
        self.assertEqual([696.0, 517.0, 32.0, 64.0], magbar["rect"])
        self.assertEqual("Ammo/PrimaryAmmo", magbar["valueVar"])
        self.assertFalse(magbar["fillOrder"])  # False here; True on the health bar

    def test_soldier_ammo_every_ammo_type_variant_is_present(self) -> None:
        seen: set[int] = set()

        def walk(cond: dict) -> None:
            if cond.get("var") == "Ammo/AmmoType":
                seen.add(cond["value"])
            for term in cond.get("terms", ()):
                walk(term)

        for el in self.group("soldierAmmo")["elements"]:
            for c in el["when"]:
                walk(c)
        self.assertEqual({1, 2, 3, 4, 5, 6, 7}, seen)

    def test_soldier_ammo_has_mag_variant_is_present(self) -> None:
        found = any(c.get("var") == "Ammo/SoldierAmmo/SoldierAmmoHasMag"
                    for el in self.group("soldierAmmo")["elements"] for c in el["when"])
        self.assertTrue(found)

    # -- one vehicle ammo variant ---------------------------------------------

    def test_primary_ammo_heat_bar_variant_rect_and_binding(self) -> None:
        # PrimaryAmmoBar has two heat-bar variants in the single-weapon-icon
        # layout (2 and 4, both bound to Overheat/OverHeat) at different
        # rects; this checks the specific one the briefing's Data facts
        # bullet calls out as an observed AB* value.
        [heat] = [e for e in self.elements_of_kind("primaryAmmo", "fill-picture")
                  if {"var": "Ammo/NumberOfWeaponIcons", "op": "eq", "value": 1} in e["when"]
                  and {"var": "Ammo/PrimaryAmmoBar", "op": "eq", "value": 2} in e["when"]]
        self.assertEqual([659.0, 547.0, 32.0, 64.0], heat["rect"])
        self.assertEqual("heatbar_empty_32x64", heat["picture"])
        self.assertEqual("heatbar_full_32x64", heat["fillPicture"])
        self.assertEqual("Overheat/OverHeat", heat["valueVar"])

    def test_vehicle_ammo_panels_are_gated_on_the_vehicle_icon_alone(self) -> None:
        for key in ("primaryAmmo", "secondaryAmmo"):
            for el in self.group(key)["elements"]:
                self.assertIn({"var": "Vehicle/ShowVehicleIcon", "op": "eq", "value": True}, el["when"])

    def test_vehicle_ammo_side_split_is_structural_not_by_variable_name(self) -> None:
        # The heat-bar variant on both sides binds the same Overheat/OverHeat
        # variable and the shared backdrop picture carries no side-specific
        # variable at all -- a split by "contains 'Secondary'" would put
        # both wrongly into primaryAmmo (see tag_ammo_side's docstring).
        secondary_heat = [e for e in self.elements_of_kind("secondaryAmmo", "fill-picture")
                          if e.get("valueVar") == "Overheat/OverHeat"]
        self.assertEqual(2, len(secondary_heat))
        secondary_backdrops = [e for e in self.elements_of_kind("secondaryAmmo", "picture")
                               if e.get("texture") == "ammobar_vehicle_panel_64x64"]
        self.assertEqual(1, len(secondary_backdrops))

    def test_no_internal_tag_leaks_into_the_output(self) -> None:
        for key in ("primaryAmmo", "secondaryAmmo"):
            for el in self.group(key)["elements"]:
                self.assertNotIn("_tag", el)

    def test_primary_and_secondary_ammo_element_counts(self) -> None:
        self.assertEqual(16, len(self.group("primaryAmmo")["elements"]))
        self.assertEqual(8, len(self.group("secondaryAmmo")["elements"]))

    # -- everything else the extractor is expected to produce ----------------

    def test_all_twelve_groups_are_present_and_non_empty(self) -> None:
        expected = {"soldierIcon", "soldierAmmo", "vehicleIcon", "vehicleHealth",
                    "vehicleSeats", "primaryAmmo", "secondaryAmmo", "supplyIcon",
                    "hitIndicator", "weaponBar", "crosshair", "tickets"}
        self.assertEqual(expected, set(self.hud["groups"]))
        for key in expected:
            self.assertTrue(self.group(key)["elements"], key)

    # -- the ticket counter --------------------------------------------------

    def test_ticket_group_rect_and_gate(self) -> None:
        # `ShowTicket` is a top-level entry of menu/InGame in its own right, a
        # sibling of the spawn screen's `Kit/ShowKit` rather than a child of
        # it, which is why the game draws the counter over the live world as
        # well as over the deploy screen. Its rect is the one the spawn-screen
        # extractor independently decodes for the same top, and the one
        # `authentic-spawn-map/README.md` section 8 measured against the
        # capture: (620, 4) 256x32.
        group = self.group("tickets")
        self.assertEqual([620.0, 4.0, 256.0, 32.0], group["rect"])
        for element in group["elements"]:
            self.assertIn({"var": "ShowTicket", "op": "eq", "value": True},
                          element["when"])

    def test_ticket_group_has_both_sides_flag_number_and_blink(self) -> None:
        group = self.group("tickets")
        # Nine leaves: the bar plate, then per side a flag, a black drop
        # shadow, the coloured number, and the low-ticket blink quad.
        self.assertEqual(9, len(group["elements"]))
        kinds = [e["kind"] for e in group["elements"]]
        self.assertEqual(1, kinds.count("picture"))          # icon_ticketbar
        self.assertEqual(2, kinds.count("variable-picture"))  # the two flags
        self.assertEqual(4, kinds.count("text"))              # 2 numbers + 2 shadows
        self.assertEqual(2, kinds.count("fill"))              # the blink quads

    def test_ticket_flags_are_bound_and_default_to_the_german_art(self) -> None:
        # The live game swaps these per side and per level; the literal the
        # data ships is the fallback `hud.js` draws when a page has not fed
        # the variable (HUD-1).
        flags = self.elements_of_kind("tickets", "variable-picture")
        self.assertEqual({"AlliedTicketFlag", "AxisTicketFlag"},
                         {f["var"] for f in flags})
        for flag in flags:
            self.assertEqual("flag_ticket_ger", flag["texture"])
            self.assertEqual([16.0, 16.0], flag["rect"][2:])

    def test_ticket_numbers_are_drawn_twice_for_a_drop_shadow(self) -> None:
        # Each side's count is two text leaves one pixel apart: black behind,
        # the team colour in front. Both bind the same variable, so a feed
        # that writes one writes both.
        texts = self.elements_of_kind("tickets", "text")
        allied = [t for t in texts if t["var"] == "AlliedTicket"]
        axis = [t for t in texts if t["var"] == "AxisTicket"]
        self.assertEqual(2, len(allied))
        self.assertEqual(2, len(axis))
        for pair in (allied, axis):
            shadow = [t for t in pair if t["color"][:3] == [0.0, 0.0, 0.0]]
            self.assertEqual(1, len(shadow))
            [front] = [t for t in pair if t is not shadow[0]]
            # The shadow sits one pixel down and right of the coloured glyph.
            self.assertEqual(front["rect"][0] + 1, shadow[0]["rect"][0])
            self.assertEqual(front["rect"][1] + 1, shadow[0]["rect"][1])
            self.assertEqual("trebuchet_ms14_latin", front["font"])
            self.assertEqual("right", front["align"])

    def test_ticket_blink_quads_need_both_blink_variables(self) -> None:
        # The low-ticket warning is a live-round state. Both its variables
        # must hold for the quad to draw, so a page that feeds neither gets a
        # culled leaf rather than a permanent red wash.
        fills = self.elements_of_kind("tickets", "fill")
        self.assertEqual(2, len(fills))
        for fill in fills:
            self.assertEqual([1.0, 0.0, 0.0, 0.5], fill["color"])
            [_, nested] = fill["when"]
            self.assertEqual("and", nested["op"])
            self.assertEqual(
                {"Ticket/AlliedTicketBlink", "Ticket/ShowAlliedTicketBlink"}
                if any("Allied" in t["var"] for t in nested["terms"])
                else {"Ticket/AxisTicketBlink", "Ticket/ShowAxisTicketBlink"},
                {t["var"] for t in nested["terms"]})

    def test_vehicle_health_bar_rect_and_binding(self) -> None:
        [health] = [e for e in self.elements_of_kind("vehicleHealth", "fill-picture")
                    if e.get("valueVar") == "Vehicle/VehicleHitPoints"]
        self.assertEqual([174.0, 525.0, 32.0, 64.0], health["rect"])
        self.assertEqual("vehicle_healthbar_empty_32x64", health["picture"])
        self.assertEqual("vehicle_healthbar_full_32x64", health["fillPicture"])
        self.assertEqual(10.0, health["max"])

    def test_occupied_seat_zero_rect_and_position(self) -> None:
        [seat0] = [e for e in self.elements_of_kind("vehicleSeats", "occupied-seat")
                   if e["position"] == 0]
        self.assertEqual([247.0, 457.0, 8.0, 8.0], seat0["rect"])
        self.assertEqual({"x": "Vehicle/VehiclePos/VehiclePosX1", "y": "Vehicle/VehiclePos/VehiclePosY1"},
                         seat0["posVar"])

    def test_all_six_occupied_seats_present(self) -> None:
        seats = self.elements_of_kind("vehicleSeats", "occupied-seat")
        self.assertEqual(list(range(6)), sorted(e["position"] for e in seats))

    def test_crosshair_leaf_bindings(self) -> None:
        [ch] = self.elements_of_kind("crosshair", "crosshair")
        self.assertEqual(2.0, ch["radius"])
        self.assertEqual("CrossHair/Radius", ch["radiusVar"])
        self.assertEqual("CrossHair/Deviation", ch["deviationVar"])
        self.assertAlmostEqual(0.9, ch["crosshairColor"][3])

    def test_hit_indicator_has_seven_wired_up_directions(self) -> None:
        # Not 8: direction 1 is permanently disabled by an unnamed
        # `BoolData{False}` gate ahead of its own HitFromDir/HitFromDir==1
        # check -- see NOTES. Directions 2-8 are all present.
        pics = [e for e in self.elements_of_kind("hitIndicator", "picture")
                if e.get("texture") == "ingame_hit_indicator_64x128"]
        self.assertEqual(7, len(pics))
        directions = {c["value"] for e in pics for c in e["when"] if c.get("var") == "HitFromDir/HitFromDir"
                     and c["op"] == "eq"}
        self.assertEqual({2, 3, 4, 5, 6, 7, 8}, directions)

    def test_weapon_bar_has_six_slots(self) -> None:
        icons = [e for e in self.elements_of_kind("weaponBar", "variable-picture")
                 if str(e.get("var", "")).startswith("Weapon/Icon/WeaponIcon")]
        self.assertEqual(6, len(icons))

    def test_turret_body_carries_a_rotation_binding_the_others_do_not(self) -> None:
        pics = {e["texture"]: e for e in self.elements_of_kind("vehicleIcon", "picture")}
        self.assertIn("rotation", pics["icon_tank_turn_body_32x32"])
        self.assertEqual("IconLookRotation", pics["icon_tank_turn_body_32x32"]["rotation"]["angleVar"])
        self.assertNotIn("rotation", pics["icon_tank_turn_back_64x64"])
        self.assertNotIn("rotation", pics["icon_tank_turn_pipe_16x32"])

    def test_the_ingame_stream_is_read_to_the_last_byte(self) -> None:
        from bf42.rfa import RfaArchive
        with RfaArchive(GAME_MENU) as arch:
            entry = next(e for e in arch.entries if e.lower() == "menu/ingame")
            data = arch.read(entry)
        _, reader = meme.load(data)
        self.assertEqual(len(data), reader.pos)

    def test_fonts_are_the_ones_extract_spawn_layout_already_knows(self) -> None:
        from extract_spawn_layout import font_handles
        handles = font_handles(self.hud)
        self.assertEqual(set(self.hud["fonts"]), set(handles))


if __name__ == "__main__":
    unittest.main()
