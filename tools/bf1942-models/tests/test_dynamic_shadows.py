"""Dynamic shadows: retail's `fx::ShadowManager` numbers, pinned.

features/retail-inverse-gap-audit-2026-11-12, entry 11; ledger VID-7 and
DSH-1..DSH-9. The sentence these tests defend:

    with SHADOWS on, each `hasDynamicShadow` object within 50 m of the camera
    and 10 m of the terrain casts one of ten 128 px shadows down a light never
    lower than 53 degrees, as strong as the level's `shadow.shadowColor`
    alpha, its height and the edge of the range leave it.

Every number is read from BF1942.exe 1.61: `drawVisible` 0x005b93d0, `apply`
0x005b8700, `setLightDirection` 0x005b8a00, the texture create at 0x005b9dce,
the pool size at 0x00465c52 and the colour word's stream read at 0x0043b9a0.
`viewer/dynamic-shadows.js` runs under node through
`dynamic_shadows_harness.mjs`; the exporter half is `bf42/con.py`
`shadow_color` and `extract_dynamic_shadows.py`.
"""

from __future__ import annotations

import json
import math
import shutil
import struct
import subprocess
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from bf42 import con as con_mod  # noqa: E402
from bf42.level import LevelInfo, parse_init_con, parse_terrain_con  # noqa: E402
import extract_dynamic_shadows  # noqa: E402

HARNESS = Path(__file__).resolve().parent / "dynamic_shadows_harness.mjs"
#: An install's folder (the one holding Mods/), where this machine has one.
_INSTALLS = [
    Path.home() / ".wine/drive_c/EA Games/Battlefield 1942",
    Path.home() / "Library/Application Support/CrossOver/Bottles/BF1942/drive_c/EA Games/Battlefield 1942",
    Path.home() / ".cache/vimpact-game",
    Path.home() / "bf1942-game",
]
INSTALL = next((p for p in _INSTALLS if (p / "Mods/bf1942/Archives/Objects.rfa").is_file()), None)


def f32(value: float) -> float:
    return struct.unpack("<f", struct.pack("<f", value))[0]


class LawTests(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        if shutil.which("node") is None:
            raise unittest.SkipTest("node is not installed")
        proc = subprocess.run(["node", str(HARNESS)], capture_output=True, text=True, timeout=60)
        if proc.returncode != 0:
            raise AssertionError(f"harness failed:\n{proc.stderr}")
        cls.results = json.loads(proc.stdout)

    def test_the_engines_numbers(self) -> None:
        c = self.results["constants"]
        # 0x005b9452 `push 0x42480000`; 0x005b9dce / 0x005b9dd3 `push 0x80`;
        # 0x00465c52 `mov [esi+0xf0], 0xa`.
        self.assertEqual((50, 128, 10), (c["range"], c["texture"], c["pool"]))
        # 0x008dbe18 10.0; 0x00905d34 1.02f; 0x008c3e80 100.0; 0x00905d30
        # 0.0009f; 0x008eaf50 0.2 (the band's inverse); 0x008d6290 0.8f;
        # 0x005b8a32 0x3f51eb85.
        self.assertEqual(10, c["maxHeight"])
        self.assertEqual(f32(1.02), c["radiusScale"])
        self.assertEqual(100, c["radiusMax"])
        self.assertEqual(f32(0.0009), c["redraw"])
        self.assertEqual(5, c["band"])
        self.assertEqual(f32(0.8), c["minY"])
        self.assertEqual(struct.unpack("<f", struct.pack("<I", 0x3F51EB85))[0], c["setY"])
        # The constructor's colour.
        self.assertEqual([1, 1, 1, 1], c["color"])

    def test_the_light_is_never_lower_than_point_eight(self) -> None:
        light = self.results["light"]
        for name, v in light.items():
            with self.subTest(name):
                self.assertAlmostEqual(1.0, math.hypot(*v), places=6)
                self.assertGreaterEqual(v[1], f32(0.8))
        # A sun already steeper than 0.8 is left alone.
        self.assertEqual([0, 1, 0], light["noon"])
        self.assertAlmostEqual(0.9 / math.hypot(0.3, 0.9, 0.1), light["steep"][1], places=6)
        # El Alamein (-0.75/0.46/0.46): Y to 0.82 and unit again, twice, the
        # first pass leaving it at 0.731. The side it leans to is kept.
        a = light["alamein"]
        self.assertAlmostEqual(0.8024, a[1], places=4)
        self.assertLess(a[0], 0)
        self.assertGreater(a[2], 0)
        self.assertAlmostEqual(-0.75 / 0.46, a[0] / a[2], places=6)
        # A sun under the horizon is lifted the same way.
        self.assertGreaterEqual(light["under"][1], f32(0.8))

    def test_the_radius_is_the_roots_by_1_02_capped_at_100(self) -> None:
        r = self.results["radius"]
        self.assertEqual(f32(1.02), r[0])
        self.assertAlmostEqual(8.28 * f32(1.02), r[1], places=9)
        self.assertEqual([100, 100], r[2:])

    def test_the_shadow_weakens_with_height_and_ends_at_ten_metres(self) -> None:
        # 255 - h * 0.1 * 255, truncated; over 10 m (either way) none.
        self.assertEqual([255, 229, 127, 0, 0, None, 178, None], self.results["heightByte"])

    def test_it_fades_over_the_last_five_metres_of_the_range(self) -> None:
        # clamp((50 + r - d) * 0.2, 0, 1).
        self.assertEqual([1, 1, 0.5, 0, 0, 0.5], self.results["fade"])

    def test_the_alpha_is_the_colours_alpha_by_height_and_range(self) -> None:
        a = self.results["alpha"]
        # Tobruk's 0.55 on the ground: trunc(0.55 * 255) / 255.
        self.assertEqual(140 / 255, a["ground"])
        # 5 m up: byte 127.
        self.assertEqual(math.trunc(0.55 * 127) / 255, a["halfway"])
        # 2.5 m inside the edge: half.
        self.assertEqual(math.trunc(0.55 * 255 * 0.5) / 255, a["edge"])
        self.assertEqual(0, a["past"])
        self.assertEqual(0, a["high"])
        # No `shadow.shadowColor` line: solid black.
        self.assertEqual(1, a["solid"])

    def test_shadow_color_repeats_the_last_number_read(self) -> None:
        c = self.results["color"]
        self.assertEqual([0.55] * 4, c["one"])
        self.assertEqual([0.4] * 4, c["bare"])
        self.assertEqual([0.36, 0.36, 0.38, 0.38], c["three"])
        self.assertEqual([0.2, 0.3, 0.6, 0.9], c["four"])
        # scene.json's two forms.
        self.assertEqual([0.55] * 4, c["number"])
        self.assertEqual([0.36, 0.36, 0.38, 0.38], c["list"])
        self.assertEqual([0.3, 0.3, 0.36, 0.36], c["short"])
        self.assertEqual([1, 1, 1, 1], c["none"])
        self.assertEqual([1, 1, 1, 1], c["junk"])

    def test_the_camera_stands_two_radii_up_the_light(self) -> None:
        self.assertEqual({"position": [10, 24, 30], "size": 4, "near": 2, "far": 6}, self.results["camera"])

    def test_the_pool_keeps_a_holder_and_hands_out_the_idlest_slot(self) -> None:
        p = self.results["pool"]
        self.assertEqual({"a": 0, "b": 1}, p[0])
        # Three slots: the fourth object goes without.
        self.assertEqual({"a": 0, "b": 1, "c": 2}, p[1])
        # b and c fall out of range; d takes one of their slots, a keeps its own.
        self.assertEqual(0, p[2]["a"])
        self.assertIn(p[2]["d"], (1, 2))
        # b comes back: the slot d did not take.
        self.assertEqual({0, 1, 2}, set(p[3].values()))
        self.assertEqual(p[2]["d"], p[3]["d"])
        self.assertEqual({}, p[4])
        self.assertEqual({"a": 0}, p[5])

    def test_a_part_casts_only_when_its_own_template_is_flagged(self) -> None:
        self.assertEqual({"exact": True, "dup": True, "part": False, "none": False, "missing": True},
                         self.results["casts"])

    def test_the_walk_gathers_pad_room_and_replay_hulls_and_every_soldier(self) -> None:
        # The casters: a flagged vehicle root wherever the page stands it
        # (baked under the level, on a pad under the level's `spawners` node,
        # a room's remote hull, a replay's hull) and the group of each
        # soldier rig. The pads were missed until 2026-11-13: the walk stopped
        # at any node carrying `userData.kind`, and `spawners` carries one, so
        # no vehicle on Wake cast a shadow.
        g = self.results["gather"]
        self.assertEqual([
            "vehicle:Sherman < (level)",
            "vehicle:Willy < spawners < (level)",
            "vehicle:Willy_1 < spawners < (level)",
            "vehicle:Willy < (level) < remote vehicle 2 Willy < remote-room",
            "soldier:(rig group) < remote soldier 3 < remote-room",
            "vehicle:Tiger < (level) < replay Tiger 521 < replay",
            "soldier:(rig group) < bot A < bot-renderers",
        ], g["found"])
        found = " ".join(g["found"])
        # Not gathered: an unflagged root on the same pads (a destroyer, an
        # emplaced gun), a seat's own PlayerControlObject inside a hull, and
        # anything under a node the walk stops at: the effect pools and the
        # sky, a static's template, a mesh, a LOD, and past six levels down.
        for name in ("Fletcher", "Defgun", "PassengerPCO", "Willy_fx", "Willy_sky",
                     "Willy_inStatic", "Willy_inMesh", "Willy_inLod", "Willy_9"):
            self.assertNotIn(name, found)
        self.assertEqual(6, g["depth"])
        self.assertEqual(["effects", "sky", "terrainEdge", "dynamic-shadows"], g["groups"])
        # A top-level node handed in as `skip` (the pass's own receivers) is left out.
        self.assertEqual(5, g["withoutRoom"])

    def test_shadows_is_on_in_high_alone(self) -> None:
        # Settings/Default/Video{Low,Medium,High}.con: `game.setShadows` 0 / 0 / 1.
        self.assertEqual({"default": True, "presets": {"1": False, "2": False, "3": True}},
                         self.results["video"])


class ExporterTests(unittest.TestCase):
    def test_shadow_color_is_the_clients_stream_read(self) -> None:
        # 0x0043b9a0: four floats into one local; a line of one number is
        # that number four times, kept as the float scene.json always held.
        self.assertEqual(0.55, con_mod.shadow_color("0.550000"))
        self.assertEqual(0.4, con_mod.shadow_color(".4"))
        self.assertEqual([0.36, 0.36, 0.38, 0.38], con_mod.shadow_color("0.36/0.36/0.38"))
        self.assertEqual([0.3, 0.3, 0.36, 0.36], con_mod.shadow_color(".3/.3/.36"))
        self.assertEqual([0.2, 0.3, 0.6, 0.9], con_mod.shadow_color("0.2/0.3/0.6/0.9"))
        self.assertIsNone(con_mod.shadow_color("x"))

    def test_a_level_that_writes_three_numbers_keeps_its_shadow_colour(self) -> None:
        # Battle of Britain, Invasion of the Philippines, Anzio, Baytown,
        # Cassino and Telemark: read as nothing before 2026-11-13.
        info = LevelInfo(name="Battle_of_Britain", terrain=parse_terrain_con(""))
        parse_init_con("shadow.shadowColor 0.36/0.36/0.38\n", info)
        self.assertEqual([0.36, 0.36, 0.38, 0.38], info.lighting.shadow_color)

    def test_the_flag_is_read_per_template(self) -> None:
        objects: dict[str, bool] = {}
        geometries: dict[str, bool] = {}
        extract_dynamic_shadows.scan(
            """
ObjectTemplate.create PlayerControlObject Willy
ObjectTemplate.hasDynamicShadow 1
ObjectTemplate.addTemplate lodWilly
rem ObjectTemplate.hasDynamicShadow 0
ObjectTemplate.create LodObject lodWilly
ObjectTemplate.create SimpleObject WillyCockpitExternal
ObjectTemplate.hasDynamicShadow 1
ObjectTemplate.create SimpleObject WillyWreck
ObjectTemplate.hasDynamicShadow 0
ObjectTemplate.active lodWilly
GeometryTemplate.create StandardMesh Shad_Bar1918
GeometryTemplate.hasDynamicShadow 0
ObjectTemplate.create Bundle v_arg1
ObjectTemplate.hasDynamicShadow 1
""",
            objects, geometries)
        self.assertEqual({"willy": True, "willycockpitexternal": True, "willywreck": False}, objects)
        self.assertEqual({"shad_bar1918": False}, geometries)

    def test_vanilla_flags_the_land_vehicles_aircraft_soldiers_and_hand_weapons(self) -> None:
        if INSTALL is None:
            self.skipTest("BF1942 is not installed")
        data = extract_dynamic_shadows.extract("bf1942", INSTALL)
        flagged = set(data["templates"])
        self.assertEqual(130, len(flagged))
        for name in ("willy", "willycockpitexternal", "sherman", "tiger", "m10", "spitfire", "bf109", "b17",
                     "ussoldier3pbody", "gersoldiercomplexhead1", "k98", "thompson", "parachute"):
            self.assertIn(name, flagged)
        # No ship, no landing craft, no emplaced gun, no turret, no wheel.
        for name in ("enterprise", "fletcher", "gato", "lcvp", "daihatsu", "defgun", "aa_allies", "flak38",
                     "stationary_mg42", "m10tower", "willyfrontwheelr"):
            self.assertNotIn(name, flagged)
        # The hand weapons' `Shad_*` meshes switch the geometry's own flag off.
        self.assertIn("shad_bar1918", data["geometriesOff"])


if __name__ == "__main__":
    unittest.main()
