"""The Secret Weapons rocket and submarine rules (retail-inverse-gap-audit
2026-11-12, entries 51 to 53), pinned to retail's values.

- An Engine's heat (ledger PHY-45, `viewer/rocket-burn.js`): `Engine::
  handleUpdate` lnxded 0x0823e320 adds `|revs| * heatIncrement -
  coolingFactor` a tick and stops the engine for good at 1. The Natter's
  0.0003 is 3334 ticks, the Wasserfall rocket's 0.00084 is 1191.
- The round that is a vehicle (FA-29, `viewer/rocket-ride.js`), its
  `vehicleCameraShake` (CS-16), its warhead (`destroyVehicleWhenNoAmmo`,
  FA-30) and the temporary camera behind where it ended (CAM-4).
- A boarded carrier's spawn points (`disableSpawnPointsOnEnter`, SPAWN-39,
  `viewer/spawn-boarded.js`).
- The level's `templateWords` (`scene_layers.template_words`,
  `viewer/template-words.js`) and the exporter words behind it
  (`bf42/con.py`).
- Who is shown the submarine HUD (`subPos`, SUB-6).

The page half runs under node (`sw_rocket_sub_harness.mjs`), against fakes
of the page; the exporter half reads the packs' own lines, verbatim.
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
VIEWER = ROOT / "viewer"
HARNESS = Path(__file__).with_name("sw_rocket_sub_harness.mjs")
MODULES = {
    name: VIEWER / name for name in (
        "rocket-burn.js", "rocket-ride.js", "fire-shake.js", "fire-state.js",
        "deviation.js", "crash-damage.js", "spawn-boarded.js", "template-words.js",
        "submarine-hud.js", "spawn-safety.js")
}
MODULES["node_modules/three/three.module.js"] = VIEWER / "vendor" / "three.module.js"
THREE_PACKAGE = json.dumps({
    "name": "three", "version": "0.0.0", "type": "module",
    "main": "three.module.js", "exports": "./three.module.js",
})


def run_harness() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        for name, source in MODULES.items():
            (work / name).parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source, work / name)
        (work / "node_modules" / "three" / "package.json").write_text(THREE_PACKAGE)
        (work / "package.json").write_text('{"type":"module"}\n')
        shutil.copyfile(HARNESS, work / "harness.mjs")
        proc = subprocess.run(["node", str(work / "harness.mjs")],
                              capture_output=True, text=True, timeout=120)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


class PageTests(unittest.TestCase):
    r: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.r = run_harness()

    # --- PHY-45 ---------------------------------------------------------

    def test_an_engine_without_the_word_has_no_heat(self) -> None:
        # `Engine::hasHeat` 0x0823ec30: `heatIncrement > 0`; the ctor's is -1.
        self.assertIsNone(self.r["burn"]["none"])
        self.assertIsNone(self.r["burn"]["ctor"])
        self.assertEqual({"heatIncrement": 0.0003, "coolingFactor": 0,
                          "heatBarType": "B", "inverseHeatBar": True},
                         self.r["burn"]["spec"])

    def test_the_natter_burns_3334_ticks_and_the_rocket_1191(self) -> None:
        # 1 / 0.0003 and 1 / 0.00084 at revs 1, a tick being 1/30 s:
        # 111 s and 39.7 s.
        self.assertEqual(3334, self.r["burn"]["natter"]["ticks"])
        self.assertEqual(1191, self.r["burn"]["rocket"]["ticks"])
        # The gearbox's own clamp is 1.2 (0x086c4f64): flat out, 993 ticks.
        self.assertEqual(993, self.r["burn"]["rocketFlatOut"]["ticks"])
        # An engine that is not turning does not heat.
        self.assertEqual(100000, self.r["burn"]["idle"])

    def test_a_burnt_motor_is_at_one_and_makes_nothing_again(self) -> None:
        for key in ("natter", "rocket"):
            self.assertEqual(1, self.r["burn"][key]["heat"])
            self.assertEqual(0, self.r["burn"][key]["after"])

    def test_the_heat_is_of_the_revs_magnitude_and_cooling_floors_at_zero(self) -> None:
        half = self.r["burn"]["half"]
        self.assertEqual(-0.8, half["kept"])
        self.assertAlmostEqual(0.24, half["heat"], places=9)
        self.assertEqual(0, self.r["burn"]["cooled"])

    def test_the_bar_is_blue_and_shows_what_is_left(self) -> None:
        # `heatBarType` R 4, G 5, B 6 (0x08242b10); `inverseHeatBar` is
        # `1 - heat` (the client's `menu::Vehicle::update`).
        self.assertEqual({"R": 4, "G": 5, "B": 6}, self.r["burn"]["types"])
        self.assertEqual(6, self.r["burn"]["half"]["bar"]["show"])
        self.assertAlmostEqual(0.76, self.r["burn"]["half"]["bar"]["value"], places=9)
        self.assertEqual({"show": 6, "value": 0}, self.r["burn"]["rocket"]["bar"])
        # The ctor's type is R, and without the word the bar is the heat.
        self.assertEqual({"show": 4, "value": 0.5}, self.r["burn"]["plainBar"])

    def test_the_hud_takes_the_first_engine_with_heat(self) -> None:
        first, none, absent = self.r["burn"]["recover"]
        self.assertEqual(6, first["show"])
        self.assertEqual(0, none["show"])
        self.assertEqual(0, absent["show"])

    # --- CS-16 ----------------------------------------------------------

    def test_the_seat_shake_is_the_states_first_frame_every_frame(self) -> None:
        # `FireMachineGunShake`: roll 0.5 at 800 rad/s, pitch 0.25 at 900,
        # yaw 0.25 at 700, no fade-in. The machine is reset after each
        # frame, so the clock is always the frame's own dt.
        a, b, c, long = self.r["shake"]
        for frame in (a, b):
            self.assertTrue(frame["drawn"])
            self.assertAlmostEqual(0.5 * math.sin(800 / 60), frame["roll"], places=9)
            self.assertAlmostEqual(0.25 * math.sin(900 / 60), frame["pitch"], places=9)
            self.assertAlmostEqual(0.25 * math.sin(700 / 60), frame["yaw"], places=9)
        self.assertAlmostEqual(0.5 * math.sin(800 / 30), c["roll"], places=9)
        # `timeToShake 0.1`: a frame that long has no shake at all.
        self.assertFalse(long["drawn"])

    # --- CAM-4 ----------------------------------------------------------

    def test_the_temporary_camera_is_15_m_behind_looking_along_the_heading(self) -> None:
        cam = self.r["tempCamera"]
        # The hull faced -X (a quarter turn about Y from -Z).
        for got, want in zip(cam["pos"], (115, 50, -20)):
            self.assertAlmostEqual(want, got, places=6)
        for got, want in zip(cam["fwd"], (-1, 0, 0)):
            self.assertAlmostEqual(want, got, places=6)
        self.assertEqual(20, cam["ahead"])

    # --- FA-29 ----------------------------------------------------------

    def test_the_firer_boards_the_round_after_the_tick_with_its_velocity(self) -> None:
        ride = self.r["ride"]
        self.assertTrue(ride["took"])
        self.assertEqual({"pending": True, "riding": None, "launcher": None, "linger": None,
                          "bots": []}, ride["before"])
        self.assertEqual("WasserfallRocket", ride["riding"]["riding"])
        self.assertEqual("Wasserfall", ride["riding"]["launcher"])
        self.assertEqual([0, 45, 0], ride["speed"])
        self.assertEqual([["stand", "WasserfallRocket"], ["enter", "WasserfallRocket"],
                          ["enter", "Wasserfall"]], ride["log"])

    def test_the_ridden_view_shakes_and_is_put_back(self) -> None:
        self.assertTrue(self.r["ride"]["shaken"])
        self.assertTrue(self.r["ride"]["restored"])

    def test_the_rider_goes_back_to_the_launcher_and_the_camera_holds_5_s(self) -> None:
        ride = self.r["ride"]
        self.assertTrue(ride["out1"])
        self.assertTrue(ride["back"])
        # One second in, the button that set it off still down: 4 s left,
        # the eye 15 m behind the rocket's last place (it faced -Z).
        self.assertAlmostEqual(4.0, ride["held"], places=6)
        for got, want in zip(ride["eye"], (0, 100, 15)):
            self.assertAlmostEqual(want, got, places=6)
        # Let go and pressed again: `Camera::handlePlayerInput` ends it.
        self.assertIsNone(ride["afterPress"])
        # Untouched, it runs its `cameraDelayTime`.
        self.assertEqual(51, self.r["lingerFrames"])
        self.assertFalse(self.r["secondRideOut"])

    def test_the_use_key_goes_back_with_no_camera(self) -> None:
        self.assertEqual({"back": True, "linger": None}, self.r["useKey"])

    def test_a_launcher_gone_or_taken_leaves_the_rider_to_the_wreck(self) -> None:
        self.assertEqual([False, False], self.r["noLauncher"])

    def test_who_does_not_ride(self) -> None:
        # A room with no round for the launcher keeps the shell, so does a
        # bot the page has no referee for, a round that is no vehicle is a
        # round, and a tree with no model stands nothing.
        self.assertEqual({"room": False, "bot": False, "plain": False, "noModel": False},
                         self.r["refused"])

    def test_in_a_room_the_page_predicts_and_the_room_decides(self) -> None:
        room = self.r["roomRide"]
        self.assertTrue(room["took"])
        self.assertEqual("WasserfallRocket", room["riding"])
        # The room's own pooled copy is the one stood.
        self.assertEqual(["stand", "WasserfallRocket", True], room["log"][0])
        # One `launch` for the launcher, then the rider's `detonate` for the
        # round; the page deals no damage of its own.
        self.assertEqual([{"type": "launch", "vehicle": 3}, {"type": "detonate", "vehicle": 7}],
                         room["afterWarhead"])
        self.assertTrue(room["back"])
        # Boarding and the return, each without a seat row of the page's.
        self.assertEqual(2, room["quiet"])
        self.assertTrue(room["refusedBack"])
        self.assertIsNone(room["refusedRiding"])

    def test_a_bots_launch_is_the_same_launch(self) -> None:
        bot = self.r["botRide"]
        self.assertTrue(bot["took"])
        self.assertEqual(["bot3"], bot["riding"])
        self.assertIsNone(bot["human"])
        self.assertEqual([0, 45, 0], bot["speed"])
        # Out of the launcher silently (no `destroyOnExit`), into the round;
        # and at its death out again and back into the launcher, alive.
        self.assertEqual([["leave", {"silent": True}], ["enter", "rocket"],
                          ["leave", {"silent": True}], ["enter", "launcher"]], bot["calls"])
        self.assertTrue(bot["out1"])
        self.assertTrue(bot["back"])
        self.assertFalse(bot["again"])
        self.assertEqual([], bot["left"])

    # --- FA-30 ----------------------------------------------------------

    def test_the_last_round_of_the_warhead_kills_its_root(self) -> None:
        warhead = self.r["warhead"]
        self.assertEqual(0, warhead["afterPlain"])
        self.assertEqual(0, warhead["afterFirstOfTwo"])
        # `giveDamage(root, 1e10)`: 0x501502f9.
        self.assertEqual([1e10], warhead["hits"])
        # `magSize 30`, `numOfMag 2`: the magazine in and one spare.
        self.assertEqual(60, self.r["rounds"]["full"])
        self.assertIsNone(self.r["rounds"]["unlimited"])   # Infinity in JSON
        self.assertIsNone(self.r["rounds"]["none"])

    # --- SPAWN-39 -------------------------------------------------------

    def test_a_boarded_submarines_points_are_off(self) -> None:
        self.assertEqual({
            "byNode": True, "byRow": True, "neither": False,
            "empty": False, "held": True, "shipHeld": False, "noCarrier": False,
        }, self.r["boarded"])

    # --- the level's table ----------------------------------------------

    def test_template_words_fill_what_a_node_does_not_say(self) -> None:
        words = self.r["words"]
        self.assertEqual(5, words["touched"])
        # The node's own word wins; the missing ones arrive.
        self.assertEqual({"torque": 500, "heatIncrement": 0.5, "heatBarType": "B",
                          "inverseHeatBar": True}, words["engine"])
        self.assertEqual({"projectile": {"template": "WasserfallRocket", "kind": "shell",
                                         "vehicle": True},
                          "magSize": 1, "disableWhenFired": True}, words["launcher"])
        # A projectile named by a bare string is left as it is.
        self.assertEqual({"projectile": "WasserFallProjectile",
                          "destroyVehicleWhenNoAmmo": True}, words["stale"])
        self.assertIsNone(words["notAGun"])
        self.assertEqual({"disableSpawnPointsOnEnter": True, "subPos": True}, words["gato"])
        self.assertEqual({"mass": 1}, words["other"])
        self.assertTrue(words["lookup"])
        self.assertEqual(0, words["none"])

    # --- SPAWN-14 -------------------------------------------------------

    def test_a_hulls_tooltip_type_is_its_own_or_the_packs(self) -> None:
        # TTWasserfall is 36 = 0x24, the air hull `createObjectOnAllClients`
        # creates whoever stands on the point.
        self.assertEqual({"own": 36, "table": 36, "suffixed": 5, "unknown": None,
                          "noLayout": None}, self.r["toolTip"])
        self.assertEqual(0x24, 36)

    # --- SUB-6 ----------------------------------------------------------

    def test_the_submarine_hud_is_the_sub_pos_seats(self) -> None:
        self.assertEqual({
            "oldBoat": True, "oldTruck": False,
            "helm": True, "deckGun": False, "modHelm": True, "noBlock": False,
        }, self.r["subPos"])


# The packs' own lines (vanilla `Objects.rfa` and XPack2's), verbatim.
SCRIPT = """
ObjectTemplate.create PlayerControlObject Gato
ObjectTemplate.setVehicleType VTSubmarine
ObjectTemplate.subPos 1
ObjectTemplate.submarineData 0.009 0.03 1 10 19.5 40 5
ObjectTemplate.disableSpawnPointsOnEnter 1
ObjectTemplate.create PlayerControlObject GatoDeckGun
ObjectTemplate.setVehicleType VTSubmarine
ObjectTemplate.submarineData 0.009 0.03 1 10 19.5 40 5
ObjectTemplate.create ObjectSpawner GatoDaiHatsuSpawner
ObjectTemplate.setObjectTemplate 1 DaiHatsu
ObjectTemplate.useButtonRadius 2
ObjectTemplate.create Engine NatterEngine
ObjectTemplate.setEngineType c_ETPlane
ObjectTemplate.HeatIncrement 0.0003
ObjectTemplate.InverseHeatBar 1
ObjectTemplate.setHeatBarType B
ObjectTemplate.create Engine PodEngine
ObjectTemplate.HeatIncrement 0.1
ObjectTemplate.CoolingFactor 0.15
ObjectTemplate.create Engine PlainEngine
ObjectTemplate.setTorque 15
ObjectTemplate.create PlayerControlObject WasserfallRocket
ObjectTemplate.destroyOnExit 1
ObjectTemplate.vehicleCameraShake CstMachinegun
ObjectTemplate.CameraDelayTime 5.0
ObjectTemplate.CameraDelayDistance 15.0
ObjectTemplate.create FireArms WasserFallGuns
ObjectTemplate.projectileTemplate WasserFallProjectile
ObjectTemplate.magSize 1
ObjectTemplate.numOfMag 1
ObjectTemplate.DestroyVehicleWhenNoAmmo 1
ObjectTemplate.create Projectile WasserFallProjectile
ObjectTemplate.create FireArms WasserfallFireArmsBundle
ObjectTemplate.projectileTemplate WasserfallRocket
ObjectTemplate.magSize 1
ObjectTemplate.reloadtime 20
ObjectTemplate.disableWhenFired 1
ObjectTemplate.create SeatObject Sherman_T34CalliopeSeat
ObjectTemplate.LeftAngleMultiplier 0.1
ObjectTemplate.RightAngleMultiplier 0.1
ObjectTemplate.HeadMaxAngleMultiplier 0.1
ObjectTemplate.UpAngleMultiplier 0.1
ObjectTemplate.DownAngleMultiplier 0.1
ObjectTemplate.create RotationalBundle Turret
ObjectTemplate.lesserYawAtSpeed 12
"""


class ExporterTests(unittest.TestCase):
    library = None

    @classmethod
    def setUpClass(cls) -> None:
        from bf42.con import ObjectLibrary

        cls.library = ObjectLibrary()
        cls.library.add_con("Objects/Test/Objects.con", SCRIPT)

    def test_the_engine_heat_words(self) -> None:
        self.assertEqual({"engineType": "c_ETPlane", "heatIncrement": 0.0003,
                          "heatBarType": "B", "inverseHeatBar": True},
                         self.library.object("NatterEngine").physics())
        pod = self.library.object("PodEngine").physics()
        self.assertEqual(0.1, pod["heatIncrement"])
        self.assertEqual(0.15, pod["coolingFactor"])
        self.assertNotIn("heatBarType", pod)
        plain = self.library.object("PlainEngine").physics()
        for word in ("heatIncrement", "coolingFactor", "heatBarType", "inverseHeatBar"):
            self.assertNotIn(word, plain)

    def test_the_control_object_words(self) -> None:
        gato = self.library.object("Gato").physics()
        self.assertIs(True, gato["disableSpawnPointsOnEnter"])
        self.assertIs(True, gato["subPos"])
        # A seat with a submarine block says `subPos` outright, false too.
        self.assertIs(False, self.library.object("GatoDeckGun").physics()["subPos"])
        rocket = self.library.object("WasserfallRocket").physics()
        self.assertEqual("CstMachinegun", rocket["vehicleCameraShake"])
        self.assertNotIn("subPos", rocket)
        self.assertNotIn("disableSpawnPointsOnEnter", rocket)

    def test_the_fire_arms_and_seat_words(self) -> None:
        self.assertIs(True, self.library.object("WasserFallGuns").destroy_vehicle_when_no_ammo)
        self.assertIs(True, self.library.object("WasserfallFireArmsBundle").disable_when_fired)
        self.assertEqual(
            {"left": 0.1, "right": 0.1, "headMax": 0.1, "up": 0.1, "down": 0.1},
            self.library.object("Sherman_T34CalliopeSeat").seat_angle_multipliers)

    def test_the_words_read_and_not_exported(self) -> None:
        # No template adds the dinghy spawner and nothing calls the server's
        # use path (SPAWN-40); no archive writes `lesserYawAtSpeed`.
        spawner = self.library.object("GatoDaiHatsuSpawner")
        self.assertEqual(2.0, spawner.use_button_radius)
        self.assertNotIn("useButtonRadius", spawner.spawner_record() or {})
        self.assertEqual(12.0, self.library.object("Turret").lesser_yaw_at_speed)

    def test_the_levels_template_words(self) -> None:
        import scene_layers

        words = scene_layers.template_words(self.library)
        self.assertEqual({
            "gato": {"physics": {"disableSpawnPointsOnEnter": True, "subPos": True}},
            "gatodeckgun": {"physics": {"subPos": False}},
            "natterengine": {"physics": {"heatIncrement": 0.0003, "heatBarType": "B",
                                         "inverseHeatBar": True}},
            "podengine": {"physics": {"heatIncrement": 0.1, "coolingFactor": 0.15}},
            "wasserfallfirearmsbundle": {"fireArms": {"disableWhenFired": True,
                                                      "projectile": {"vehicle": True}}},
            "wasserfallguns": {"fireArms": {"destroyVehicleWhenNoAmmo": True}},
            "wasserfallrocket": {"physics": {"vehicleCameraShake": "CstMachinegun"}},
        }, words)
        self.assertEqual(scene_layers.LAYERS["templateWords"], (("templateWords",), ()))
        self.assertIn("templateWords", scene_layers.COMPUTE)
        self.assertIn("templateWords", scene_layers.REPORT_ORDER)

    def test_a_carried_points_carrier_shuts_it(self) -> None:
        import extract_map

        # The ctor's byte is 0 (`PlayerControlObjectTemplate` 0x083196e2),
        # and the console reads a float and tests it against 0.
        index = extract_map.TemplateIndex.__new__(extract_map.TemplateIndex)
        index.blocks = {}
        index._add("Objects/Test/Objects.con", SCRIPT + """
ObjectTemplate.create PlayerControlObject Fletcher
ObjectTemplate.disableSpawnPointsOnEnter 0
""")
        self.assertTrue(index.get("Gato").shuts_spawns)
        self.assertFalse(index.get("Fletcher").shuts_spawns)
        self.assertFalse(index.get("WasserfallRocket").shuts_spawns)

@unittest.skipIf(shutil.which("node") is None, "node is not installed")
class RoomSubmarineSpawnTests(unittest.TestCase):
    """SPAWN-39 on the room server, through the room's own rows
    (`room_sub_spawn_harness.mjs`: a descriptor level whose Willy carries a
    point that says `disableOnEnter`, two virtual peers)."""

    sub: dict

    @classmethod
    def setUpClass(cls) -> None:
        harness = Path(__file__).with_name("room_sub_spawn_harness.mjs")
        proc = subprocess.run(["node", str(harness), str(VIEWER)],
                              capture_output=True, text=True, timeout=600)
        if proc.returncode != 0:
            raise AssertionError(f"harness failed:\n{proc.stdout}\n{proc.stderr}")
        result = json.loads(proc.stdout.strip().splitlines()[-1])
        if "sub" not in result:
            raise unittest.SkipTest("models/Willy.glb is not in this tree")
        cls.sub = result["sub"]

    def test_an_empty_carriers_point_spawns(self) -> None:
        self.assertFalse(self.sub["before"])
        self.assertTrue(self.sub["helmSpawned"])
        self.assertEqual([40, 40], self.sub["helmAt"])

    def test_a_boarded_carriers_point_spawns_nobody(self) -> None:
        self.assertTrue(self.sub["seated"])
        self.assertTrue(self.sub["boarded"])
        # Refused before the revive: one `spawnRefused` to the asker alone,
        # no `spawn` row to anyone, and the player still dead.
        self.assertEqual({"rows": 1, "alive": False, "spawnRows": 0, "leaked": 0},
                         self.sub["refused"])

    def test_only_the_carriers_own_seat_shuts_it(self) -> None:
        # `PlayerControlObject::enter` reads the word off its own template:
        # the passenger's seat is another object.
        if self.sub["passenger"] is None:
            self.skipTest("the Willy has one seat in this tree")
        self.assertEqual({"moved": 1, "shut": False}, self.sub["passenger"])

    def test_getting_out_opens_it_again(self) -> None:
        self.assertFalse(self.sub["left"])
        after = self.sub["after"]
        self.assertTrue(after["alive"])
        self.assertEqual(1, after["spawnRows"])
        self.assertEqual(1, after["refusedRows"])
        # The world's books name the flag itself, not the filtered view.
        self.assertTrue(after["flagKept"])

    def test_a_point_without_the_word_is_never_shut(self) -> None:
        self.assertFalse(self.sub["plain"])


@unittest.skipIf(shutil.which("node") is None, "node is not installed")
class RoomMissileTests(unittest.TestCase):
    """FA-29 and FA-30 on the room server (`server/room-missiles.mjs`),
    through the room's own rows: `room_missiles_harness.mjs`, Eve of
    Destruction's Hawk and its `HawkRocket` when that tree is extracted."""

    r: dict

    @classmethod
    def setUpClass(cls) -> None:
        harness = Path(__file__).with_name("room_missiles_harness.mjs")
        proc = subprocess.run(["node", str(harness), str(VIEWER)],
                              capture_output=True, text=True, timeout=600)
        if proc.returncode != 0:
            raise AssertionError(f"harness failed:\n{proc.stdout}\n{proc.stderr}")
        result = json.loads(proc.stdout.strip().splitlines()[-1])
        if "round" not in result:
            raise unittest.SkipTest("models/mods/eod's Hawk is not in this tree")
        cls.r = result

    def test_the_launcher_gets_its_round_off_the_field(self) -> None:
        self.assertEqual({"hawk": True, "count": 1,
                          "rocket": {"template": "HawkRocket", "live": False, "round": 1}},
                         self.r["table"])

    def test_only_the_gunner_in_the_launcher_fires_it(self) -> None:
        on_foot = self.r["round"]["onFoot"]
        self.assertEqual(["seat"], on_foot["refused"])
        self.assertFalse(on_foot["live"])
        self.assertEqual("Hawk", self.r["round"]["inLauncher"])

    def test_the_launch_moves_the_gunner_into_the_round(self) -> None:
        launch = self.r["round"]["launch"]
        self.assertEqual("HawkRocket", launch["seat"])
        self.assertTrue(launch["live"])
        self.assertTrue(launch["drives"])
        # The round's own `velocity 45`, along the barrel.
        self.assertEqual(45, launch["speed"])
        self.assertEqual([{"round": 1, "pad": None}], launch["spawnRow"])
        # Everyone hears the launcher's seat and then the round's.
        self.assertEqual([1, 2], launch["seatRows"])
        self.assertEqual(2, launch["riding"])
        # The same launch heard again (the room's own barrel and the page's
        # row) is taken as one: no second refusal after the one on foot.
        self.assertEqual(["seat"], self.r["round"]["again"])
        self.assertEqual("HawkRocket", self.r["round"]["flown"]["seat"])

    def test_the_warhead_kills_the_round_and_gives_the_rider_back(self) -> None:
        d = self.r["round"]["detonated"]
        # Another player's `detonate` touches nothing.
        self.assertEqual(10, d["strangers"])
        self.assertEqual(0, d["hp"])
        self.assertTrue(d["destroyed"])
        self.assertEqual("Hawk", d["seat"])
        self.assertTrue(d["alive"])
        self.assertIsNone(d["riding"])
        self.assertGreaterEqual(d["hullRows"], 1)
        self.assertGreaterEqual(d["backRows"], 2)

    def test_a_new_round_is_fresh_and_the_use_key_ends_it(self) -> None:
        self.assertEqual({"seat": "HawkRocket", "hp": 10, "live": True},
                         self.r["round"]["relaunched"])
        # `destroyOnExit` (SEAT-38), then the launcher's seat again.
        self.assertEqual({"seat": "Hawk", "alive": True, "destroyed": True},
                         self.r["round"]["exited"])

    def test_a_round_shot_down_gives_its_rider_back_alive(self) -> None:
        self.assertEqual({"seat": "Hawk", "alive": True}, self.r["round"]["shot"])


if __name__ == "__main__":
    unittest.main()
