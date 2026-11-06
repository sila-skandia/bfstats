"""The proving ground: a battle's kits and vehicles on an empty white floor.

features/proving-ground. The sentence these tests defend:

    every vehicle a battle fields stands on the firing line to be taken and
    down range to be shot at, on a floor the rounds and wheels stand on, and
    every round the player fires says how far it flew and what it did.

`proving_ground_harness.mjs` drives `viewer/proving-ground.js` (the construct:
its layout, its report, its floor and scene, the front end's catalogue and
address) and the pure parts of `viewer/proving-ground-page.js` (the landing
point, the hit bands, the material names) under node.
"""

from __future__ import annotations

import json
import math
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from test_gunfire_layers import THREE_PACKAGE, VIEWER  # noqa: E402

HARNESS = Path(__file__).resolve().parent / "proving_ground_harness.mjs"
MODULES = {
    "proving-ground.js": VIEWER / "proving-ground.js",
    "proving-ground-page.js": VIEWER / "proving-ground-page.js",
    "controls-kits.js": VIEWER / "controls-kits.js",
    "vendor/utils/SkeletonUtils.js": VIEWER / "vendor" / "utils" / "SkeletonUtils.js",
    "node_modules/three/three.module.js": VIEWER / "vendor" / "three.module.js",
}


def run_harness() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        for name, source in MODULES.items():
            target = work / name
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source, target)
        (work / "node_modules" / "three" / "package.json").write_text(THREE_PACKAGE)
        (work / "package.json").write_text('{"type":"module"}\n')
        shutil.copyfile(HARNESS, work / "harness.mjs")
        proc = subprocess.run(["node", str(work / "harness.mjs")],
                              capture_output=True, text=True, timeout=120)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


class _Harness(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()


class BattleTests(_Harness):
    def test_every_template_the_battles_pads_hand_out_once_in_every_game_type(self) -> None:
        # Both sides' entry of each pad, a pad with no `templates` by its
        # vehicle, and a game type's own pads; case-insensitively once.
        self.assertEqual(["PanzerIV", "Sherman", "Willy", "BF109", "Spitfire"], self.results["templates"])

    def test_a_carriers_aircraft_come_from_the_catalogue_and_its_ships_stay_out(self) -> None:
        # Coral Sea's pads hold guns and ships; its Corsairs fly off the
        # Enterprise's own spawner, which only the catalogue's `levels` names.
        self.assertEqual(["Corsair", "AA_Allies"], self.results["fromCatalogue"])

    def test_an_object_that_draws_nothing_is_no_vehicle(self) -> None:
        # FHSW's ArtyEffectPCOMortar8cm: a pad's body with no mesh, only a
        # collision hull and an effect payload.
        self.assertEqual({"tank": True, "logic": False, "empty": False}, self.results["draws"])

    def test_a_vehicle_is_parked_by_its_physics_category(self) -> None:
        self.assertEqual({"air": "air", "sea": "sea", "land": "land", "gun": "land"}, self.results["classes"])


class LayoutTests(_Harness):
    def test_the_garage_the_airfield_and_two_target_rows(self) -> None:
        roles = [p["role"] for p in self.results["layout"]]
        self.assertEqual(3, roles.count("garage"))
        self.assertEqual(1, roles.count("airfield"))
        # Each land vehicle again in each target row; the aircraft are not targets.
        self.assertEqual(6, roles.count("target"))

    def test_a_ship_has_no_water_and_is_left_out(self) -> None:
        self.assertNotIn("Enterprise", [p["template"] for p in self.results["layout"]])

    def test_the_garage_is_the_players_and_faces_down_range_and_the_targets_face_back(self) -> None:
        for p in self.results["layout"]:
            if p["role"] == "target":
                self.assertEqual((1, 180), (p["team"], p["yaw"]))
            else:
                self.assertEqual((2, 0), (p["team"], p["yaw"]))

    def test_the_target_rows_stand_at_100_and_250_metres(self) -> None:
        line = -320
        rows = sorted({round(line - p["z"]) for p in self.results["layout"] if p["role"] == "target"})
        self.assertEqual([100, 250], rows)

    def test_a_row_is_centred_and_nothing_overlaps(self) -> None:
        garage = [p for p in self.results["layout"] if p["role"] == "garage"]
        xs = sorted(p["x"] for p in garage)
        # Widths 3, 3, 2 plus a 5 m gap each: centres 4 m and 3.5 m apart and more.
        self.assertTrue(all(b - a >= 3.5 for a, b in zip(xs, xs[1:])), xs)


class ReportTests(_Harness):
    def test_the_battle_lends_its_name_damage_and_material_tables(self) -> None:
        r = self.results["report"]
        self.assertEqual("Aberdeen", r["level"])
        self.assertEqual({"path": "../_shared/damage.json"}, r["damage"])
        self.assertEqual({"a": 1}, r["materialDiffuse"])

    def test_the_battles_ground_and_sky_are_dropped(self) -> None:
        # Its heightmap would stand the collider on the real level's hills
        # (`level-terrain.js` `loadHeightmap`), and its sky mesh is not there.
        r = self.results["report"]
        self.assertIsNone(r["heightmap"])
        self.assertIsNone(r["sky"])
        self.assertEqual(2048, r["worldSize"])

    def test_two_locked_bases_and_a_neutral_flag_between_them(self) -> None:
        # The bases cannot change hands, so the player's spawn is never lost;
        # the neutral flag with no spawns is what walks the bots up the range.
        r = self.results["report"]
        self.assertEqual([{"name": "FiringLine", "team": 2, "locked": True, "z": -320},
                          {"name": "FarEnd", "team": 1, "locked": True, "z": -920},
                          {"name": "Contest", "team": 0, "locked": False, "z": -520}], r["points"])
        self.assertEqual(8, r["firingLineSpawns"])
        self.assertEqual(12, r["farEndSpawns"])

    def test_every_pad_hands_out_its_own_vehicle_whichever_side(self) -> None:
        for spawn in self.results["report"]["spawns"]:
            self.assertEqual({"1": spawn["vehicle"], "2": spawn["vehicle"]}, spawn["templates"])
            self.assertEqual([6, 6], spawn["delay"])

    def test_a_target_is_never_abandoned_and_a_garage_vehicle_goes_home(self) -> None:
        # The abandon clock (`deployables.js` `AbandonClock`) bills
        # `damageWhenLost` a second once a hull is `distance` from its pad: at
        # 0 m it wrecked every target 4.5 s after load (seen on Aberdeen).
        for spawn in self.results["report"]["spawns"]:
            if spawn["role"] == "target":
                self.assertEqual(0, spawn["lost"])
                self.assertGreaterEqual(spawn["distance"], 1e5)
            else:
                self.assertEqual((30, 25, 100), (spawn["ttl"], spawn["distance"], spawn["lost"]))

    def test_the_round_never_ends(self) -> None:
        tickets = self.results["report"]["tickets"]
        self.assertEqual({"team1": 0, "team2": 0}, tickets["lossPerMin"])
        self.assertGreater(tickets["team1"], 100)

    def test_the_vehicles_keep_their_engine_sounds_and_the_statics_lose_theirs(self) -> None:
        sounds = self.results["report"]["sounds"]
        self.assertEqual([{"template": "panzeriv"}], sounds["vehicles"])
        self.assertEqual([], sounds["areas"])
        self.assertLess(sounds["ambient"]["volume"], 1.4)

    def test_the_report_says_it_is_the_proving_ground(self) -> None:
        self.assertEqual({"team": 2, "source": "Aberdeen"}, self.results["report"]["provingGround"])


class FloorTests(_Harness):
    def test_one_flat_floor_the_collider_can_snap(self) -> None:
        # `heightfield.js` `buildHeightfield` rebuilds the lattice from tile
        # vertices on exact multiples of the spacing.
        f = self.results["floor"]
        self.assertEqual(16, f["tiles"])
        self.assertEqual([40], f["heights"])
        self.assertTrue(f["onLattice"])
        self.assertEqual(["terrain"], f["kinds"])

    def test_the_floor_keeps_its_own_material(self) -> None:
        # `level-shading.js` `unlightTerrain` skips a tile already marked.
        self.assertTrue(self.results["floor"]["unlit"])

    def test_the_floor_covers_the_world_in_the_glb_frame(self) -> None:
        f = self.results["floor"]
        self.assertEqual([0, 40, -2048], f["min"])
        self.assertEqual([2048, 40, 0], f["max"])


class SceneTests(_Harness):
    def test_the_scene_is_what_a_baked_level_parses_into(self) -> None:
        s = self.results["scene"]
        self.assertEqual(0, s["animations"])
        self.assertEqual(["terrain"] * 16 + ["spawners", "controlPoints"], s["roots"])

    def test_one_node_per_placement_at_its_pad_named_as_the_bake_names_copies(self) -> None:
        s = self.results["scene"]
        # Three garage and six target land vehicles; the BF109 had no model here.
        self.assertEqual(9, s["spawners"])
        self.assertIn("PanzerIV", s["names"])
        self.assertIn("PanzerIV_1", s["names"])
        self.assertTrue(s["padsMatched"])

    def test_the_garage_faces_down_range_and_a_target_faces_the_line(self) -> None:
        s = self.results["scene"]
        self.assertEqual([0, 0, -1], s["garageFacing"])
        self.assertEqual([0, 0, 1], [abs(v) if v == 0 else v for v in s["targetFacing"]])


class LandingPointTests(_Harness):
    def test_a_level_shot_falls_its_height_in_the_free_fall_time(self) -> None:
        p = self.results["levelShot"]
        t = math.sqrt(2 * 1.6 / 9.81)
        self.assertAlmostEqual(t, p["time"], delta=0.01)
        self.assertAlmostEqual(100 * t, p["range"], delta=1.0)
        self.assertFalse(p["expired"])

    def test_a_45_degree_lob_flies_v_squared_over_g(self) -> None:
        self.assertAlmostEqual(50 ** 2 / 9.81, self.results["lob"]["range"], delta=1.5)

    def test_a_short_fuse_ends_the_flight_in_the_air(self) -> None:
        p = self.results["fuse"]
        self.assertTrue(p["expired"])
        self.assertAlmostEqual(0.5, p["time"], places=6)
        self.assertGreater(p["point"][1], 40)

    def test_a_round_with_no_speed_lands_nowhere(self) -> None:
        self.assertIsNone(self.results["noSpeed"])


class HitZoneTests(_Harness):
    def test_hits_to_destroy_a_sherman_by_the_bazooka(self) -> None:
        # features/bf1942-3d-models: the bazooka does 100 to the rear, 35 to
        # the side and 26 to the front of a 100 HP Sherman.
        h = self.results["hits"]
        self.assertEqual((1, 3, 4, 4), (h["rear"], h["side"], h["front"], h["exact"]))
        self.assertIsNone(h["none"])   # Infinity serialises as null
        self.assertIsNone(h["absent"])

    def test_the_bands(self) -> None:
        self.assertEqual(["1", "2", "3-4", "3-4", "5-9", "5-9", "10+", "10+", None], self.results["bands"])

    def test_material_names(self) -> None:
        n = self.results["names"]
        self.assertEqual("Bazookas", n["labelled"])
        self.assertEqual(("rear armour", "side armour", "front armour"), (n["rear"], n["side"], n["front"]))
        self.assertEqual(("soldier", "light armour", "naval armour", "aircraft"),
                         (n["soldier"], n["light"], n["naval"], n["air"]))
        self.assertEqual("material 178", n["other"])


class FrontEndTests(_Harness):
    def test_each_battles_vehicles_from_the_catalogue(self) -> None:
        c = self.results["catalogue"]
        self.assertEqual([{"name": "Spitfire", "cls": "air"}], c["battle_of_britain"])
        # Hand weapons and soldiers are not vehicles.
        self.assertEqual([{"name": "Sherman", "cls": "land"}], c["el_alamein"])

    def test_the_address_enter_opens(self) -> None:
        self.assertEqual(
            "http://x/map.html?proving=1&map=Kursk&team=2&botCount=8&botSkill=0.5&mod=fhsw", self.results["url"])
        self.assertEqual(
            "http://x/map.html?proving=1&map=Wake&team=1&botCount=0&botSkill=0.5", self.results["urlVanilla"])


class ArsenalTests(_Harness):
    def test_each_side_its_nation_and_its_kits_in_row_order(self) -> None:
        # The kits name their nation; a side whose kits do not takes the
        # page's nation code; a row bound to a kit the file lacks is skipped.
        f = self.results["factions"]
        self.assertEqual([1, 2], [x["team"] for x in f])
        self.assertEqual(("German", "Axis", "GermanDesertSoldier"), (f[0]["nation"], f[0]["side"], f[0]["soldier"]))
        self.assertEqual(["German_Scout", "German_AT"], [k["name"] for k in f[0]["kits"]])
        self.assertEqual(("British", "Allied"), (f[1]["nation"], f[1]["side"]))

    def test_a_kit_lists_what_the_soldier_holds_and_marks_the_primary(self) -> None:
        at = self.results["factions"][0]["kits"][1]
        self.assertEqual(("ANTI-TANK", "Anti-tank", "Panzershreck", 30), (at["label"], at["cls"], at["primary"], at["hp"]))
        # In the kit's own order, the ammo bundle (no slot) left out.
        self.assertEqual(["Panzershreck", "Walter P38", "Knife Axis", "Grenade Axis"], [i["name"] for i in at["items"]])
        self.assertEqual([True, False, False, False], [i["primary"] for i in at["items"]])

    def test_a_rolled_item_is_named_as_a_roll(self) -> None:
        assault = self.results["factions"][1]["kits"][0]
        self.assertEqual("Rifle", assault["items"][0]["name"])
        self.assertTrue(assault["items"][0]["rolled"])

    def test_a_level_the_file_does_not_know_has_no_racks(self) -> None:
        self.assertEqual([], self.results["factionsUnknownLevel"])
        self.assertEqual([], self.results["factionsEmpty"])

    def test_templates_read_as_names(self) -> None:
        self.assertEqual(["Walter P38", "Knife Axis", "3German AT Panzerfaust 100", "Panzer IV", "Panzershreck",
                          "T34-85", "Willy"], self.results["pretty"])


class HitLogTests(_Harness):
    def test_a_hit_names_the_vehicle_the_face_the_cost_and_what_is_left(self) -> None:
        row = self.results["logRows"]["hit"]
        self.assertEqual("hit", row["kind"])
        self.assertEqual("Panzer IV · front armour", row["title"])
        self.assertEqual("Panzershreck · -17 hp · 83/100 left · angle x0.66 · 54 m · 1.00 s", row["detail"])

    def test_a_soldier_hit_names_the_bone_and_no_hull_to_be_left(self) -> None:
        row = self.results["logRows"]["soldier"]
        self.assertEqual(("hit", "soldier · head", "K98 · -30 hp · 120 m · 0.30 s"), (row["kind"], row["title"], row["detail"]))

    def test_a_round_that_cost_nothing_says_so(self) -> None:
        row = self.results["logRows"]["dud"]
        self.assertEqual(("dud", "Sherman · wheels"), (row["kind"], row["title"]))
        self.assertTrue(row["detail"].startswith("Colt · no damage · 120 m"))

    def test_the_floor_and_the_fall_the_panzerfausts_lesson(self) -> None:
        row = self.results["logRows"]["floor"]
        self.assertEqual(("floor", "floor"), (row["kind"], row["title"]))
        self.assertEqual("3German AT Panzerfaust 100 · 54 m · 1.00 s · fell 1.4 m", row["detail"])

    def test_a_fuse_that_ran_out_is_the_weapons_reach(self) -> None:
        row = self.results["logRows"]["fuse"]
        self.assertEqual(("fuse", "fuse ran out", "933 m · 1.30 s"), (row["kind"], row["title"], row["detail"]))
        far = self.results["logRows"]["far"]
        self.assertEqual("1.54 km · 12.4 s · fell 240 m", far["detail"])


class StationTests(_Harness):
    def test_stations_stand_short_of_the_first_row_down_the_lane_and_at_the_far_end(self) -> None:
        st = self.results["stations"]
        # 10..400 m short of the 100 m row: z = -420 + d; all on the lane's centre.
        self.assertEqual([-410, -395, -370, -320, -270, -220, -120, -20], [s["z"] for s in st[:-1]])
        self.assertTrue(all(s["x"] == 1024 for s in st))
        self.assertIn("(the firing line)", st[3]["label"])
        self.assertEqual(("far-end", -900, 180), (st[-1]["id"], st[-1]["z"], st[-1]["yaw"]))

    def test_a_station_off_the_floor_is_not_offered(self) -> None:
        # Rows at 400 and 800 m: 400 m short of the first row is z = -320, 300
        # short is on the floor too; nothing stands past z = -10.
        st = self.results["stationsFarRows"]
        self.assertTrue(all(s["z"] <= -10 for s in st))
        self.assertEqual(-320, st[-2]["z"])

    def test_the_weakest_part_is_the_fewest_hits_and_none_when_nothing_is_hurt(self) -> None:
        w = self.results["weakest"]
        self.assertEqual({"defense": 50, "hits": 1}, w["rear"])
        self.assertIsNone(w["none"])
        self.assertEqual(51, w["tie"]["defense"])


class ControlsKitBarTests(_Harness):
    def test_factions_are_nations_the_axis_first_a_theatre_its_own_wardrobe(self) -> None:
        f = self.results["kitFactions"]
        self.assertEqual(["German", "German (Desert)", "Japanese", "American", "British"], [x["id"] for x in f])
        self.assertEqual(["Axis", "Axis", "Axis", "Allied", "Allied"], [x["side"] for x in f])
        self.assertEqual([{"template": "US_Assault", "label": "Assault", "primary": "Bar1918"},
                          {"template": "US_AT", "label": "Anti-tank", "primary": "Bazooka"}], f[3]["kits"])

    def test_the_posed_pair_is_the_primary_first_then_the_items_the_soldiers_in_order(self) -> None:
        p = self.results["pickPosed"]
        self.assertEqual({"soldier": "GermanSoldier", "weapon": "Panzershreck"}, p["primary"])
        # The primary is unposed for the desert man: his pistol is the pair.
        self.assertEqual({"soldier": "GermanDesertSoldier", "weapon": "WalterP38"}, p["fallback"])
        self.assertIsNone(p["none"])


class CommonTabTests(_Harness):
    def test_commons_probe_also_answers_the_infantry_map(self) -> None:
        # COMMON has no walk or crouch of its own: the soldier takes the
        # infantry's, and keeps COMMON's camera keys.
        self.assertEqual({"throttle": 1, "crouch": True, "camera3": True, "fire": False}, self.results["merged"])

    def test_the_camera_keys_pick_a_view_and_the_toggle_steps_on_its_press(self) -> None:
        self.assertEqual(["inside", "chaseRear", "chaseFront", "flyBy"], self.results["cameraModes"])
        c = self.results["camera"]
        self.assertEqual("inside", c["key"]["mode"])
        self.assertEqual(("chaseFront", True), (c["togglePress"]["mode"], c["togglePress"]["toggleWas"]))
        # Held down, the toggle steps once.
        self.assertEqual("chaseFront", c["toggleHeld"]["mode"])
        self.assertEqual("inside", c["wraps"]["mode"])
        self.assertEqual("chaseRear", c["idle"]["mode"])


if __name__ == "__main__":
    unittest.main()
