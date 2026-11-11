"""The model viewer's part inspector (features/mesh-viewer-advanced-tab,
"Part inspector").

`viewer/model-parts-index.js` is the map from every mesh to the template
node it belongs to, what each part is made of and what moves it, the search,
and the pop-out and builder timing. It imports nothing, so
`model_parts_harness.mjs` runs it under node over a cut-down Fletcher built
the way GLTFLoader builds the real one, and these pin the result. The page
half is `model_parts_page.mjs` (run by hand: it needs the models), which
checks the hover, the pop-out returning every part to its exact position,
the builder view, and that a click in "Places a shot" still places a shot.
"""

from __future__ import annotations

import json
import re
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
VIEWER = ROOT / "viewer"
INDEX_MODULE = VIEWER / "model-parts-index.js"
HARNESS = Path(__file__).with_name("model_parts_harness.mjs")
PAGE = VIEWER / "index.html"
PARTS = VIEWER / "model-parts.js"
ARMOUR = VIEWER / "model-armour.js"
DISPLAY = VIEWER / "model-display.js"


def run_harness() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        shutil.copyfile(INDEX_MODULE, work / INDEX_MODULE.name)
        (work / "package.json").write_text('{"type":"module"}\n')
        shutil.copyfile(HARNESS, work / "harness.mjs")
        proc = subprocess.run(["node", str(work / "harness.mjs")],
                              capture_output=True, text=True, timeout=60)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


class PickingMapTests(unittest.TestCase):
    r: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.r = run_harness()

    def test_every_mesh_maps_to_its_template_node(self) -> None:
        m = self.r["mapping"]
        # A multi-primitive node's meshes are the node's.
        self.assertEqual("FletcherComplex", m["FletcherComplex_1"])
        self.assertEqual("FletcherComplex", m["FletcherComplex_2"])
        self.assertEqual("Fletcher_cannon", m["Fletcher_cannon_p0"])
        # A turret's barrel is its own part, not the turret's.
        self.assertEqual("Fletcher_cannon_barrel", m["Fletcher_cannon_barrel_m"])
        # A collision node has no templateKind: its mesh is its parent template's.
        self.assertEqual("Fletcher_cannon_barrel", m["Fletcher_cannon_barrel_collision_0m"])
        self.assertEqual("Fletcher_cannon", m["Fletcher_cannon_collision_0"])

    def test_effects_are_not_parts(self) -> None:
        self.assertFalse(self.r["flashMapped"])
        self.assertNotIn("e_MuzzDefGun", self.r["partNames"])
        # The flash belongs to the gun if anyone asks.
        self.assertEqual("fletcher_GunBarrel", self.r["templateOf"]["flashMesh"])

    def test_parts_come_parents_first_with_their_depth(self) -> None:
        names = self.r["partNames"]
        self.assertLess(names.index("FletcherComplex"), names.index("Fletcher_cannon"))
        self.assertLess(names.index("Fletcher_cannon"), names.index("Fletcher_cannon_barrel"))
        parts = self.r["parts"]
        self.assertEqual(0, parts["Fletcher"]["depth"])
        self.assertEqual(3, parts["Fletcher_cannon"]["depth"])
        self.assertEqual("Fletcher_cannon", parts["Fletcher_cannon_barrel"]["parent"])
        self.assertEqual(["Fletcher", "lodFletcher", "FletcherComplex", "Fletcher_cannon",
                          "Fletcher_cannon_barrel"], self.r["chain"])
        self.assertEqual(["Fletcher_cannon", "Fletcher_cannon_barrel", "fletcher_GunBarrel"],
                         self.r["subtree"])

    def test_what_a_part_is_made_of(self) -> None:
        turret = self.r["parts"]["Fletcher_cannon"]
        self.assertEqual("Fletch_canon_m1", turret["geometry"])
        self.assertEqual(104, turret["triangles"])
        self.assertEqual(10, turret["collisionTriangles"])
        self.assertEqual([57], turret["armour"])
        self.assertEqual([("Fletch_hull_M1_Material7", 7, "texture/Fle_base2_Z.dds"),
                          ("Fletch_hull_M1_Material13", 13, "texture/Fle_black_Z.dds")],
                         [(m["name"], m["number"], m["texture"]) for m in turret["renderMaterials"]])

    def test_a_collision_only_part_is_a_part(self) -> None:
        ladder = self.r["parts"]["ShipLadder03"]
        self.assertEqual([], ladder["meshes"])
        self.assertEqual([85, 195], ladder["armour"])

    def test_a_template_placed_twice_shows_its_own_name(self) -> None:
        copy = self.r["parts"]["Fletcher_cannon_1"]
        self.assertEqual("Fletcher_cannon", copy["label"])
        self.assertEqual(2, copy["copy"])
        self.assertEqual(1, self.r["parts"]["Fletcher_cannon"]["copy"])

    def test_a_hidden_lod_is_marked(self) -> None:
        self.assertFalse(self.r["parts"]["lodHidden"]["shown"])
        self.assertTrue(self.r["parts"]["Fletcher_cannon"]["shown"])

    def test_material_names(self) -> None:
        self.assertEqual([7, None, 23], self.r["materialNumber"])
        self.assertEqual(["Fle_base2_Z", "Fle_black_Z"], self.r["textureLabel"])


class SearchTests(unittest.TestCase):
    r: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.r = run_harness()["search"]

    def test_a_number_finds_armour_material_ids(self) -> None:
        groups = self.r["armour57"]
        self.assertEqual("armour", groups[0]["kind"])
        self.assertEqual("Armour material 57", groups[0]["title"])
        # Both copies of the turret, by their own armour.
        self.assertEqual(["Fletcher_cannon", "Fletcher_cannon_1"], groups[0]["parts"])
        # 57 is not render material 7.
        self.assertFalse(any(g["kind"] == "render" for g in groups))

    def test_a_number_finds_render_material_numbers(self) -> None:
        self.assertEqual([("render", "Fletch_hull_M1_Material23", ["FletcherComplex"])],
                         [(g["kind"], g["title"], g["parts"]) for g in self.r["n23"]])
        n7 = self.r["n7"][0]
        self.assertEqual("Render material", n7["label"])
        self.assertEqual(["FletcherComplex", "Fletcher_cannon", "Fletcher_cannon_barrel", "Fletcher_cannon_1"],
                         n7["parts"])

    def test_text_finds_mesh_files_textures_and_templates(self) -> None:
        self.assertEqual(("mesh", "Fletch_canonbar_m1"), (self.r["mesh"][0]["kind"], self.r["mesh"][0]["title"]))
        self.assertEqual(("texture", "Fle_black_Z"), (self.r["texture"][0]["kind"], self.r["texture"][0]["title"]))
        kinds = [g["kind"] for g in self.r["template"]]
        self.assertEqual(["template", "mesh", "texture"], kinds)

    def test_collision_only_parts_are_searched(self) -> None:
        self.assertEqual(["ShipLadder03"], self.r["collisionOnly"][0]["parts"])

    def test_nothing_and_blank(self) -> None:
        self.assertEqual([], self.r["none"])
        self.assertEqual([], self.r["blank"])


class MotionAndTimingTests(unittest.TestCase):
    r: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.r = run_harness()

    def test_what_moves_it(self) -> None:
        d = self.r["describe"]
        self.assertEqual(["Yaws with the mouse, left and right: -120 to 120 deg at 45 deg/s"], d["turret"]["moves"])
        self.assertEqual(["Continuous yaw 30 deg/s"], d["radar"]["moves"])
        self.assertIn("Fires FletcherProjectile (shell), 0.2 rounds/s, 160 m/s", d["gun"]["notes"])
        self.assertIn("Seat for Fletcher, enter within 6 m", d["entry"]["notes"])
        self.assertEqual(["Rolls continuously with the throttle (W and S), up to 5000 deg/s"], d["rate"])
        self.assertTrue(d["springs"][0].endswith("springs back"))

    def test_the_pop_out_direction_and_distance(self) -> None:
        p = self.r["pop"]
        # Away from the centre with a little lift; a part at the centre rises.
        self.assertGreater(p["side"][0], 0)
        self.assertGreater(p["side"][1], 0)
        self.assertEqual([0, 22, 0], [round(v, 6) for v in p["centre"]])
        self.assertAlmostEqual(22, p["lengths"][0])
        self.assertAlmostEqual(10, p["lengths"][1])

    def test_the_pop_out_ends_exactly_out_and_exactly_home(self) -> None:
        self.assertEqual([0, 1, 1, 1, 0], self.r["popProgress"])

    def test_the_builder_view_staggers_from_the_root_and_comes_home(self) -> None:
        b = self.r["builder"]
        self.assertEqual([0, 0, 0, 0], b["root"])
        self.assertEqual(0, b["depth1"][0])
        self.assertEqual(1, b["depth1"][2])
        self.assertEqual(1, b["depth1"][3])     # holding
        self.assertEqual(0, b["depth3Start"])   # deeper parts leave later
        self.assertEqual(1, b["depth3Out"])
        self.assertEqual([0, 0, 0], b["end"])   # everything home, exactly
        self.assertAlmostEqual(2 * 0.22 + 0.6 + 1.4 + 2 * 0.22 + 0.55, b["duration3"])


class PageWiringTests(unittest.TestCase):
    """The markup the inspector looks up, and the click hand-off with the shots."""

    def test_every_element_the_inspector_looks_up_is_there(self) -> None:
        html = PAGE.read_text()
        for id_ in sorted(set(re.findall(r"getElementById\('([\w-]+)'\)", PARTS.read_text()))):
            if id_ == "browser":
                continue
            with self.subTest(id_):
                self.assertIn(f'id="{id_}"', html)
        self.assertGreaterEqual(html.count("data-builder"), 2)   # the stage pill and the Model tab

    def test_shots_keep_the_click_while_places_a_shot_is_on(self) -> None:
        armour = ARMOUR.read_text()
        parts = PARTS.read_text()
        self.assertIn("get ownsClicks() { return state.collision && state.pick === 'shots'; }", armour)
        self.assertIn("pick: 'shots'", armour)   # the default keeps the old behaviour
        self.assertIn("if (!armour.ownsClicks || !armour.pointerStart) return;", armour)
        self.assertIn("page.armour.ownsClicks", parts)
        html = PAGE.read_text()
        self.assertEqual(["shots", "parts"], re.findall(r'data-pick="(\w+)"', html))

    def test_the_pop_out_and_explode_share_the_position_code(self) -> None:
        display = DISPLAY.read_text()
        self.assertIn("function applyPositions()", display)
        self.assertIn("obj.userData.popOffset", display)
        # At rest a part goes back to its authored position, not a sum.
        self.assertIn("obj.position.set(h.x * k, h.y * k, h.z * k);", display)

    def test_no_emoji(self) -> None:
        for path in (INDEX_MODULE, PARTS, PAGE):
            self.assertIsNone(re.search(r"[\U0001F300-\U0001FAFF☀-➿]", path.read_text()), path.name)


if __name__ == "__main__":
    unittest.main()
