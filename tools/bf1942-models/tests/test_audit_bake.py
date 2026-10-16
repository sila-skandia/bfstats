"""`audit_bake.py` (`audit_mod.py --audit hud poses levels`, and the causes it
adds to `sound` and `vehicles`): each check on a small tree with its defect
planted, named by the defect it was written for. No game install is needed.

The defects (features/static-validation-coverage): Raid on Agheila's vehicles
drawing the flak gun HUD picture; FHSW's rifle grenade sight and FHSWEurope's
loading pictures upside down; FHSW's soldiers sliding with no gait clips; the
bots holding a Colt for a weapon with no pose; FHT Golf Hotel's streaked
wings; Monster des Stahles' depots never baked; DC's MH-53 rotors never
blurring; the Flettner's rocket motor at the launcher; FH's rockets flying
silent; Wake's Daihatsus with no engine; Anzio's multi-template sound files.
"""

from __future__ import annotations

import io
import json
import os
import struct
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "surveys"))

import audit_bake as B  # noqa: E402
import audit_mod as A  # noqa: E402
import mod_pipeline as M  # noqa: E402
from bf42.con import ObjectLibrary  # noqa: E402


def write(p: Path, data) -> None:
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(data))


def write_glb(p: Path, doc: dict) -> None:
    blob = json.dumps(doc).encode()
    blob += b" " * (-len(blob) % 4)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_bytes(b"glTF" + struct.pack("<II", 2, 12 + 8 + len(blob))
                  + struct.pack("<II", len(blob), 0x4E4F534A) + blob)


def make_tree(root: Path, levels=("lv",)) -> A.Tree:
    tree = A.Tree("fhsw", root / "models", root / "maps", root / "textures", list(levels))
    write(tree.maps / "maps.json", [{"name": lv, "loading": {"background": f"{lv}/load.webp"}}
                                    for lv in levels])
    return tree


def two_tone(size=(8, 8)):
    """Red top half, blue bottom half: reads differently either way up."""
    from PIL import Image
    im = Image.new("RGBA", size, (0, 0, 255, 255))
    im.paste((255, 0, 0, 255), (0, 0, size[0], size[1] // 2))
    return im


def rle_tga(im, top_left: bool) -> bytes:
    """A type 10 (RLE) TGA of `im`'s rows in file order, with its origin bit.
    Raw packets of one pixel each: the simplest valid RLE stream."""
    w, h = im.size
    head = struct.pack("<BBBHHBHHHHBB", 0, 0, 10, 0, 0, 0, 0, 0, w, h, 32,
                       8 | (0x20 if top_left else 0))
    body = bytearray()
    for y in range(h):
        for x in range(w):
            r, g, b, a = im.getpixel((x, y))
            body += bytes([0, b, g, r, a])
    return head + bytes(body)


class Icons(unittest.TestCase):
    def test_a_picture_the_pack_lacks_is_named_by_where_the_game_keeps_it(self):
        rows = [
            {"template": "Flettner", "field": "vehicleIcon", "name": "Vehicle/Icon_flettner.tga",
             "status": "missing-sprite", "levels": ["raid_on_agheila"], "where": "level:Raid_on_Agheila"},
            {"template": "Ghost", "field": "vehicleIcon", "name": "Vehicle/Icon_ghost.tga",
             "status": "missing-sprite", "levels": [], "where": "nowhere"},
            {"template": "Willy", "field": "vehicleIcon", "name": "Vehicle/Icon_willy.tga",
             "status": "ok", "levels": []},
            {"template": "Kubel", "field": "vehicleIcon", "name": "Vehicle/Icon_kubel.tga",
             "status": "missing-file", "levels": []}]
        got = {f.cause: f for f in B.icon_findings(rows, A.Finding)}
        self.assertEqual({"vehicle-icon-not-extracted", "vehicle-icon-absent-from-install",
                          "vehicle-icon-file-missing"}, set(got))
        f = got["vehicle-icon-not-extracted"]
        self.assertEqual(("major", "raid_on_agheila"), (f.severity, f.level))
        self.assertIn("step hud", f.owning_script)
        self.assertTrue(f.is_failure())
        self.assertFalse(got["vehicle-icon-absent-from-install"].is_failure())

    def test_the_census_reads_any_tree_and_only_its_exported_scenes(self):
        import census_vehicle_icons as ci
        self.assertEqual(("fhsw", "models/mods/fhsw/models.json", "mods/fhsw/_shared/hud"),
                         ci.tree_spec("FHSW"))
        self.assertEqual(ci.TREES[0], ci.tree_spec("bf1942"))
        with tempfile.TemporaryDirectory() as tmp:
            viewer = Path(tmp)
            hud = {"extras": {"hud": {"vehicleIcon": "Vehicle/Icon_x.tga"}}}
            for lv in ("kept", "unexported"):
                write_glb(viewer / "maps/mods/fhsw" / lv / "scene.glb",
                          {"asset": {"version": "2.0"}, "nodes": [{"name": "X", **hud}]})
            write(viewer / "models/mods/fhsw/models.json", [])
            rows = ci.census(viewer, trees=[ci.tree_spec("fhsw")], levels={"kept"})
            self.assertEqual([["kept"]], [r["levels"] for r in rows])
            self.assertEqual("missing-sprite", rows[0]["status"])


class TgaOrientation(unittest.TestCase):
    def test_an_rle_bottom_left_file_is_drawn_as_stored(self):
        im = two_tone()
        raw = rle_tga(im, top_left=False)
        # the engine reads the rows as stored: red on top, as written
        got = B.engine_tga_image(raw)
        self.assertEqual((255, 0, 0, 255), got.getpixel((0, 0)))
        # a top-left one is upright either way
        self.assertEqual((255, 0, 0, 255), B.engine_tga_image(rle_tga(im, True)).getpixel((0, 0)))

    def test_an_export_the_other_way_up_is_flipped(self):
        from PIL import Image, ImageOps
        expected = B.engine_tga_image(rle_tga(two_tone(), top_left=False))
        self.assertEqual("ok", B.orientation(expected, expected))
        self.assertEqual("flipped", B.orientation(ImageOps.flip(expected), expected))
        # a picture that reads the same both ways up says nothing
        flat = Image.new("RGBA", (8, 8), (9, 9, 9, 255))
        self.assertEqual("unknown", B.orientation(flat, flat))
        self.assertEqual("unknown", B.orientation(expected.resize((4, 4)), expected))

    def test_a_flipped_hud_sprite_is_a_finding(self):
        from PIL import ImageOps
        with tempfile.TemporaryDirectory() as tmp:
            tree = make_tree(Path(tmp))
            hud = tree.maps / "_shared" / "hud"
            write(hud / "pack.json", {"files": ["hud.json", "sight.png", "ok.png"]})
            write(hud / "hud.json", {"sprites": {
                "sight": {"file": "sight.png", "source": "menu/Texture/sight.tga"},
                "ok": {"file": "ok.png", "source": "menu/Texture/ok.tga"}}})
            raw = rle_tga(two_tone(), top_left=False)
            want = B.engine_tga_image(raw)
            ImageOps.flip(want).save(hud / "sight.png")
            want.save(hud / "ok.png")

            class Arc:
                def read(self, name):
                    return raw
            entries = {"menu/texture/sight.tga": (Arc(), "x"), "menu/texture/ok.tga": (Arc(), "y")}
            with mock.patch.object(B, "_menu_entries", return_value=entries):
                rows = B.hud_orientation_findings(tree, SimpleNamespace(ok=True), {}, A.Finding)
            self.assertEqual([("hud-image-upside-down", "sight.png")],
                             [(f.cause, f.subject) for f in rows])
            self.assertIn("bottom-left", rows[0].detail)


class MeshTextures(unittest.TestCase):
    """FH's tank reticle discs read upside down (8dc4c985): a mesh texture in
    the shared store, mapped back to its TGA by the glb image's `name`."""

    def store_glb(self, tree, textures, name, image):
        key = f"ab/{name.rsplit('/', 1)[-1]}.webp"
        (textures / key).parent.mkdir(parents=True, exist_ok=True)
        image.save(textures / key, "WEBP", lossless=True)
        uri = os.path.relpath(textures / key, tree.models)
        blob = json.dumps({"images": [{"uri": uri, "mimeType": "image/webp", "name": name}]})
        write_glb(tree.models / f"{name.rsplit('/', 1)[-1]}.glb", json.loads(blob))

    def test_a_sight_disc_drawn_the_pil_way_up_is_a_finding(self):
        from PIL import Image, ImageOps
        # black lines on a clear field: the picture is all in the alpha
        sight = Image.new("RGBA", (16, 16), (0, 0, 0, 0))
        for x in range(16):
            sight.putpixel((x, 2), (0, 0, 0, 255))
        for y in range(2, 9):
            sight.putpixel((8, y), (0, 0, 0, 255))
        raw = rle_tga(sight, top_left=False)
        want = B.engine_tga_image(raw)
        with tempfile.TemporaryDirectory() as tmp:
            tree = make_tree(Path(tmp))
            textures = Path(tmp) / "textures"
            self.store_glb(tree, textures, "texture/Panzer_reticule.tga", ImageOps.flip(want))
            self.store_glb(tree, textures, "texture/brit_reticule.tga", want)
            self.assertEqual(2, len(B.tga_images(tree)))
            game = SimpleNamespace(textures=SimpleNamespace(try_read=lambda _n: raw))
            ctx = {}
            rows = B.mesh_tga_findings(tree, game, ctx, A.Finding)
            self.assertEqual([("mesh-texture-upside-down", "texture/Panzer_reticule.tga")],
                             [(f.cause, f.subject) for f in rows])
            self.assertTrue(rows[0].is_failure())
            self.assertIn("2 of 2", ctx["hud: TGA mesh textures checked"])
        # a source half the size of the store's is compared at the store's size
        self.assertEqual("ok", B.scaled_orientation(want.resize((32, 32)), want))
        self.assertEqual("unknown", B.scaled_orientation(want.resize((32, 16)), want))


class Minimap(unittest.TestCase):
    def test_a_symbol_the_viewer_draws_as_a_dot_is_a_finding(self):
        rows = [{"verdict": "dot", "template": "bf109-g10", "icon": "minimap_bf109", "source": "chain",
                 "viewer": "icon_vehicledot_empty", "level": "berlin"},
                {"verdict": "dot", "template": "bf109-g10", "icon": "minimap_bf109", "source": "chain",
                 "viewer": "icon_vehicledot_empty", "level": "anzio"},
                {"verdict": "ok", "template": "sherman", "icon": "minimap_sherman", "level": "anzio"},
                {"verdict": "size", "template": "b17", "icon": "minimap_b17", "level": "anzio"}]
        import census_minimap_icons as cm  # noqa: PLC0415  (the hud audit puts surveys/ on the path)
        with tempfile.TemporaryDirectory() as tmp, \
                mock.patch.object(cm, "survey_tree", return_value=rows):
            tree = make_tree(Path(tmp))
            ctx = {}
            got = B.minimap_findings(tree, SimpleNamespace(mod="FHSW", game_dir=Path(tmp)), ctx,
                                     A.Finding)
        self.assertEqual([("minimap-icon-not-drawn", "bf109-g10", "anzio")],
                         [(f.cause, f.subject, f.level) for f in got])
        self.assertIn("2 levels", got[0].detail)
        self.assertIn("size 1", ctx["hud: minimap marks read"])


class Poses(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.tree = make_tree(self.root, ("203_hill-1904",))

    def tearDown(self):
        self.tmp.cleanup()

    def test_a_bundle_without_a_gait_clip_slides(self):
        self.assertIsNone(B.gait_clips_missing(self.tree.models))
        clips = [{"name": f"{k}.lower"} for k in B.GAIT_CLIPS if k != "run"]
        write_glb(self.tree.models / "poses/gaits/lower.gait.glb",
                  {"asset": {"version": "2.0"}, "animations": clips})
        self.assertEqual(["run.lower"], B.gait_clips_missing(self.tree.models))
        rows = [f for f in B.run_poses(self.tree, None, {}, A.Finding)
                if f.cause == "gait-clip-missing"]
        self.assertEqual("major", rows[0].severity)
        self.assertIn("poses_shared", rows[0].owning_script)
        # the corpus gate's probe is the same check
        ctx = SimpleNamespace(paths={"models": self.tree.models})
        self.assertEqual("fail", M.probe_gait_clips(ctx)[0])

    def test_a_dealt_weapon_with_a_rig_and_no_pose_is_named(self):
        write(self.tree.models / "kits.json", {"kits": [{
            "template": "1Rus_Assault", "levels": ["203_hill-1904"], "soldiers": ["RussianSoldier"],
            "items": [{"template": "Mosin"}, {"template": "GrenadeRus"}, {"template": "Shashka"},
                      {"template": "RPG29"}]}]})
        write(self.tree.models / "viewmodels/index.json",
              ["RussianSoldier__Mosin", "RussianSoldier__GrenadeRus", "RussianSoldier__RPG29"])
        write(self.tree.models / "poses/index.json",
              {"format": "bf1942-pose-index/1", "glb": ["russiansoldier__mosin"], "recipe": []})
        with mock.patch.object(B, "VIEWER", self.root / "no-vanilla"):
            rows = B.pose_findings(self.tree, A.Finding, {"RussianSoldier__RPG29": "no stand pose"})
        got = {f.subject: f for f in rows}
        # the pose index is read case-blind; a pair with no rig is the rig audit's
        self.assertEqual({"RussianSoldier__GrenadeRus", "RussianSoldier__RPG29"}, set(got))
        f = got["RussianSoldier__GrenadeRus"]
        self.assertEqual(("kit-weapon-no-pose", "major", "203_hill-1904"),
                         (f.cause, f.severity, f.level))
        self.assertIn("poses_kit", f.owning_script)
        self.assertFalse(got["RussianSoldier__RPG29"].is_failure())
        # vanilla's index answers for an inherited pair
        write(self.root / "vanilla/models/poses/index.json",
              {"glb": [], "recipe": ["RussianSoldier__GrenadeRus"]})
        with mock.patch.object(B, "VIEWER", self.root / "vanilla"):
            rows = B.pose_findings(self.tree, A.Finding, {"RussianSoldier__RPG29": "x"})
        self.assertEqual(["RussianSoldier__RPG29"], [f.subject for f in rows])
        # a tree that ships no pose tree at all: its own army is figureless
        (self.tree.models / "poses/index.json").unlink()
        with mock.patch.object(B, "VIEWER", self.root / "no-vanilla"):
            rows = B.pose_findings(self.tree, A.Finding, {})
        self.assertEqual({"RussianSoldier__Mosin", "RussianSoldier__GrenadeRus",
                          "RussianSoldier__RPG29"}, {f.subject for f in rows})


ACTIVE_BLOCK = """ObjectTemplate.active Yamato1944
ObjectTemplate.addTemplate Axis_AntiKiller
ObjectTemplate.setHasMobilePhysics 1
ObjectTemplate.activeSafe Kii
ObjectTemplate.addTemplate Axis_AntiKiller
ObjectTemplate.create ObjectSpawner NotAnEdit
ObjectTemplate.addTemplate Ignored
"""


class Levels(unittest.TestCase):
    def test_a_lightmapped_part_with_rungs_is_found_unless_the_viewer_hides_them(self):
        doc = {"nodes": [{"name": "hotel", "extras": {"lightmap": "lm/hotel.png"}, "children": [1, 2]},
                         {"name": "hotel_lod0"}, {"name": "hotel_lod1", "extras": {"lod": {"level": 1}}}]}
        self.assertEqual(1, B.lightmapped_rungs(doc))
        with tempfile.TemporaryDirectory() as tmp:
            tree = make_tree(Path(tmp))
            write_glb(tree.maps / "lv/scene.glb", doc)
            write(tree.maps / "lv/scene.json", {})
            with mock.patch.object(B, "viewer_hides_lightmap_rungs", return_value=False):
                rows = B.run_levels(tree, SimpleNamespace(ok=False), {}, A.Finding)
            self.assertEqual(["lightmapped-part-ships-rungs"], [f.cause for f in rows])
            with mock.patch.object(B, "viewer_hides_lightmap_rungs", return_value=True):
                self.assertEqual([], B.run_levels(tree, SimpleNamespace(ok=False), {}, A.Finding))
        self.assertTrue(B.viewer_hides_lightmap_rungs())

    def test_a_reopened_templates_added_child_must_be_under_it(self):
        adds = B.active_additions([("ObjectiveMode/ObjectSpawnTemplates.con", ACTIVE_BLOCK)])
        self.assertEqual({"yamato1944": {"axis_antikiller"}, "kii": {"axis_antikiller"}}, adds)
        doc = {"nodes": [{"name": "Yamato1944", "children": [1]}, {"name": "YamatoHull", "children": [2]},
                         {"name": "Axis_AntiKiller_2"}, {"name": "Yamato1944_2", "children": []}]}
        self.assertEqual([("yamato1944", "axis_antikiller", 1, 2)], B.missing_additions(doc, adds))
        doc["nodes"][3]["children"] = [2]
        self.assertEqual([], B.missing_additions(doc, adds))

    def test_a_logic_child_leaves_no_node_and_a_held_one_leaves_its_object(self):
        lib = ObjectLibrary()
        lib.add_con("objects/x.con", "\n".join([
            "ObjectTemplate.create SpawnPoint HanomagSoldierSpawn64",
            "ObjectTemplate.create Bundle BattleshipRadar",
            "ObjectTemplate.addTemplate BattleshipRadar_Real",
            "ObjectTemplate.create SonarObject BattleshipRadar_Real",
            "ObjectTemplate.create ObjectSpawner ReloaderSpawner",
            "ObjectTemplate.setObjectTemplate 1 ReloaderObj",
            "ObjectTemplate.holdObject 1",
            "ObjectTemplate.create SupplyDepot ReloaderObj"]))
        self.assertIsNone(B.expected_node(lib, "HanomagSoldierSpawn64"))
        self.assertIsNone(B.expected_node(lib, "BattleshipRadar"))
        self.assertEqual("reloaderobj", B.expected_node(lib, "ReloaderSpawner"))
        self.assertEqual("axis_antikiller", B.expected_node(lib, "Axis_AntiKiller"))
        adds = {"hanomag": {"hanomagsoldierspawn64", "reloaderspawner"}}
        doc = {"nodes": [{"name": "Hanomag", "children": [1]}, {"name": "ReloaderObj"}]}
        self.assertEqual([], B.missing_additions(doc, adds, lib))
        doc["nodes"][0]["children"] = []
        self.assertEqual([("hanomag", "reloaderspawner", 1, 1)], B.missing_additions(doc, adds, lib))

    def test_a_stale_bake_of_a_mode_edit_is_a_finding(self):
        with tempfile.TemporaryDirectory() as tmp:
            tree = make_tree(Path(tmp), ("monster_des_stahles",))
            write_glb(tree.maps / "monster_des_stahles/scene.glb",
                      {"nodes": [{"name": "Yamato1944", "children": []}]})
            write(tree.maps / "monster_des_stahles/scene.json", {"gameplayMode": "ObjectiveMode"})
            with mock.patch.object(B, "mode_edit_blocks",
                                   return_value=([("x.con", ACTIVE_BLOCK)], None)) as blocks:
                rows = B.run_levels(tree, SimpleNamespace(ok=True, library=lambda: None), {},
                                    A.Finding)
            blocks.assert_called_once()
            self.assertEqual("ObjectiveMode", blocks.call_args[0][2])
            self.assertEqual([("mode-template-edit-not-baked", "yamato1944", "monster_des_stahles")],
                             [(f.cause, f.subject, f.level) for f in rows])
            self.assertIn("re-bake", rows[0].owning_script)


ROTOR_CON = """
ObjectTemplate.create PlayerControlObject MH53
ObjectTemplate.addTemplate MH53MainRotor
ObjectTemplate.create LodObject MH53MainRotor
ObjectTemplate.lodSelector MH53RotorSelector
ObjectTemplate.addTemplate MH53MainRotorStatic
ObjectTemplate.addTemplate MH53MainRotorBlur
ObjectTemplate.create SimpleObject MH53MainRotorStatic
ObjectTemplate.geometry MH53MainRotorStatic_m1
ObjectTemplate.create SimpleObject MH53MainRotorBlur
ObjectTemplate.geometry MH53MainRotorBlur_m1
GeometryTemplate.create StandardMesh MH53MainRotorStatic_m1
GeometryTemplate.create StandardMesh MH53MainRotorBlur_m1
LodSelectorTemplate.create CompareSelector MH53RotorSelector
"""


class Rotors(unittest.TestCase):
    def run_with(self, nodes, con=ROTOR_CON):
        lib = ObjectLibrary()
        lib.add_con("objects/vehicles/air/mh53/objects.con", con)
        with tempfile.TemporaryDirectory() as tmp:
            write_glb(Path(tmp) / "MH53.glb", {"nodes": nodes})
            return B.rotor_pair_findings(lib, [{"name": "MH53", "category": "air", "glb": "MH53.glb"}],
                                         Path(tmp), {"mh53"}, A.Finding)

    def test_a_rotor_kept_with_its_blades_alone_never_blurs(self):
        rows = self.run_with([{"name": "MH53", "children": [1]},
                              {"name": "MH53MainRotor", "children": [2]},
                              {"name": "MH53MainRotorStatic"}])
        self.assertEqual(["rotor-blur-pair-missing"], [f.cause for f in rows])
        self.assertIn("MH53MainRotorBlur", rows[0].detail)
        self.assertEqual("major", rows[0].severity)

    def test_a_half_with_no_declared_geometry_draws_nothing_and_is_not_missing(self):
        # the jets' fake propellers: the still half names no geometry
        con = ROTOR_CON.replace("ObjectTemplate.geometry MH53MainRotorStatic_m1\n", "")
        self.assertEqual([], self.run_with([
            {"name": "MH53", "children": [1]},
            {"name": "MH53MainRotor", "children": [2], "extras": {"propellerBlur": {}}},
            {"name": "MH53MainRotorBlur"}], con))

    def test_the_whole_pair_with_its_stamp_is_clean(self):
        self.assertEqual([], self.run_with([
            {"name": "MH53", "children": [1]},
            {"name": "MH53MainRotor", "children": [2, 3], "extras": {"propellerBlur": {}}},
            {"name": "MH53MainRotorStatic"}, {"name": "MH53MainRotorBlur"}]))


WEAPON_CON = """
ObjectTemplate.create PlayerControlObject Flettner
ObjectTemplate.addTemplate FlettnerLauncher
ObjectTemplate.addTemplate FlettnerGun
ObjectTemplate.create FireArms FlettnerLauncher
ObjectTemplate.projectileTemplate FlettnerRocket
ObjectTemplate.create FireArms FlettnerGun
ObjectTemplate.projectileTemplate FlettnerBomb
ObjectTemplate.create Projectile FlettnerRocket
ObjectTemplate.addTemplate FlettnerRocketMotor
ObjectTemplate.create Engine FlettnerRocketMotor
ObjectTemplate.loadSoundScript ../Sounds/Motor.ssc
ObjectTemplate.create Projectile FlettnerBomb
ObjectTemplate.loadSoundScript ../Sounds/Bomb.ssc
ObjectTemplate.create Projectile QuietShell
"""


class Sound(unittest.TestCase):
    def setUp(self):
        self.lib = ObjectLibrary()
        self.lib.add_con("objects/vehicles/air/flettner/objects.con", WEAPON_CON)

    def test_a_round_flight_loop_at_the_launcher_and_a_lost_report(self):
        import census_vehicle_weapon_sounds as cv
        thump = SimpleNamespace(file="bmbreal1.wav", loop=False, effects=[])
        kinds = {"flettnerlauncher": (cv.ROUND_FLIGHT, "m.ssc", "FlettnerRocket", []),
                 "flettnergun": (cv.ROUND_SHOT, "b.ssc", "FlettnerBomb", [thump])}
        coverage = {"flettner": {"weapons": [
            {"fireArms": "FlettnerLauncher", "layers": [{"file": "motor.mp3", "loop": True}]}]}}
        with mock.patch.object(cv, "classify", side_effect=lambda lib, pool, node: kinds[node.name.lower()]):
            rows = B.weapon_sound_findings(self.lib, object(), None, ["Flettner"], coverage, set(),
                                           A.Finding)
        got = {(f.cause, f.detail.split(" ")[0]) for f in rows}
        self.assertEqual({("weapon-loop-on-launcher", "FlettnerLauncher"),
                          ("weapon-round-report-not-in-table", "FlettnerGun")}, got)
        self.assertTrue(all(f.severity == "major" for f in rows))
        # a bullet's fly-by, gated 0.075 s and cut at 10 m, is never heard at
        # a 755 m/s gun: no report is lost (extract_map._heard_at_launcher)
        flyby = SimpleNamespace(file="bulletair1.wav", loop=False, effects=[
            SimpleNamespace(destination="volume", envelope="ramp", source="time",
                            params=[0.075, 0.1, 0.0, 1.0]),
            SimpleNamespace(destination="volume", envelope="ramp", source="distance",
                            params=[5.0, 10.0, 1.0, -1.0])])
        kinds["flettnergun"] = (cv.ROUND_SHOT, "p.ssc", "Bullet", [flyby])
        self.lib.object("FlettnerGun").velocity = 755.0
        with mock.patch.object(cv, "classify", side_effect=lambda lib, pool, node: kinds[node.name.lower()]):
            rows = B.weapon_sound_findings(self.lib, object(), None, ["Flettner"], coverage, set(),
                                           A.Finding)
        self.assertEqual(["weapon-loop-on-launcher"], [f.cause for f in rows])

    def test_a_round_with_a_motor_script_must_be_in_the_effect_manifest(self):
        self.assertEqual(["FlettnerBomb", "FlettnerRocket"], B.flight_rounds(self.lib))
        with tempfile.TemporaryDirectory() as tmp:
            tree = make_tree(Path(tmp))
            write(tree.maps / "_shared/effects.sounds.json",
                  {"bundles": {"flettnerbomb": {}}, "silent": {}})
            rows = B.round_manifest_findings(tree, self.lib, A.Finding)
        self.assertEqual([("round-flight-sound-not-in-manifest", "FlettnerRocket")],
                         [(f.cause, f.subject) for f in rows])

    def test_held_hulls_are_read_off_the_baked_glbs(self):
        with tempfile.TemporaryDirectory() as tmp:
            tree = make_tree(Path(tmp), ("wake",))
            write_glb(tree.maps / "wake/scene.glb", {"nodes": [
                {"name": "Hatsuzuki"}, {"name": "Daihatsu_2", "extras": {"heldSpawner": {"spawner": "s"}}}]})
            self.assertEqual({"daihatsu": "wake"}, B.held_hulls(tree))

    def test_every_placed_level_sound_template_is_an_area(self):
        con = ("ObjectTemplate.create SimpleObject River_01\nObjectTemplate.loadSoundScript River.ssc\n"
               "ObjectTemplate.create SimpleObject River_02\nObjectTemplate.loadSoundScript River.ssc\n"
               "ObjectTemplate.create SimpleObject Gulls\nObjectTemplate.loadSoundScript Gulls.ssc\n"
               "ObjectTemplate.create SimpleObject Unplaced\n")
        files = {"bf1942/levels/anzio/sounds/river.con": con,
                 "bf1942/levels/anzio/sounds/river.ssc": "newPatch\nload river.wav\nloop\n",
                 "bf1942/levels/anzio/sounds/gulls.ssc": "/*\nnewPatch\nload gulls.wav\n",
                 "bf1942/levels/anzio/staticobjects.con":
                     "Object.create River_01\nObject.create River_02\nObject.create Gulls\n"}

        class Arc:
            entries = list(files)

            def read(self, n):
                return files[n].encode()
        with tempfile.TemporaryDirectory() as tmp:
            tree = make_tree(Path(tmp), ("anzio",))
            write(tree.maps / "anzio/scene.json", {"sounds": {"areas": [{"name": "River_01"}]}})
            game = SimpleNamespace(level_archive=lambda lv: Arc())
            rows = B.level_sound_findings(tree, game, A.Finding)
        got = {f.subject: f for f in rows}
        self.assertEqual({"river_02", "gulls"}, set(got))
        self.assertEqual("level-sound-template-not-baked", got["river_02"].cause)
        self.assertTrue(got["river_02"].is_failure())
        # a script that parses to nothing is silent in retail too
        self.assertEqual("level-sound-template-script-silent", got["gulls"].cause)
        self.assertFalse(got["gulls"].is_failure())


def sm_bytes(lods, lightmapped=False, version=10, cols=1):
    """A `.sm` with `lods` = [[(material, vertices), ...], ...]: stride 32,
    three indices a material, one empty collision block."""
    out = struct.pack("<II", version, 0) + struct.pack("<6f", 0, 0, 0, 1, 1, 1)
    if version > 9:
        out += bytes([1 if lightmapped else 0])
    out += struct.pack("<I", cols)
    for _ in range(cols):
        out += struct.pack("<I", 16) + bytes(16)
    out += struct.pack("<I", len(lods))
    for mats in lods:
        out += struct.pack("<I", len(mats))
        for name, verts in mats:
            out += struct.pack("<I", len(name)) + name.encode() + bytes(12)
            out += struct.pack("<6I", 4, 0x411, 32, verts, 3, 0)
        for _name, verts in mats:
            out += bytes(32 * verts) + bytes(6)
    return out


def rung_doc(geometry, top, lightmap=False, parts=1):
    nodes = []
    for _ in range(parts):
        base = len(nodes)
        extras = {"geometry": geometry, **({"lightmap": "lm.png"} if lightmap else {})}
        nodes.append({"name": geometry, "extras": extras,
                      "children": [base + 1 + i for i in range(top)]})
        nodes += [{"name": f"{geometry}_lod{i}", "extras": {"lod": {"geometry": geometry, "level": i}}}
                  for i in range(1, top + 1)]
    return {"nodes": nodes}


class FakeFiles:
    """`LevelFiles` over a dict of level-relative path -> bytes."""

    def __init__(self, entries):
        self.entries = {k.lower(): (k, v) for k, v in entries.items()}

    def names(self):
        return [k for k, _v in self.entries.values()]

    def find(self, path):
        hit = self.entries.get(path.lower())
        return hit[0] if hit else None

    def read(self, path):
        return self.entries[path.lower()][1]


OMAHA_OBJECTS = """
ObjectTemplate.create PlayerControlObject LCVP_Spawn
ObjectTemplate.addTemplate LCVP_SpawnPoint1
spawnPointManager.group 8
spawnPointManager.groupTeam 2
ObjectTemplate.create SpawnPoint LCVP_SpawnPoint1
ObjectTemplate.setGroup 8
ObjectTemplate.create PlayerControlObject ParatrooperSpawnObject
ObjectTemplate.addTemplate ParaSpawn1
spawnPointManager.group 99
spawnPointManager.groupTeam 1
ObjectTemplate.create SpawnPoint ParaSpawn1
ObjectTemplate.setGroup 99
"""


class PromotedLevels(unittest.TestCase):
    """The checks promoted into `levels` on 2026-10-17: the stone bridge's hole
    and FHSW's japanesefarm rungs (census_lod_chains), the flat water of 225
    levels (envmap faces), FH Omaha's lost Allied spawn (the spawn_groups
    probe), and Hellendoorn's V2s (mode-script statics)."""

    def test_the_skimmer_reads_what_the_mesh_reader_reads(self):
        from bf42 import stdmesh
        raw = sm_bytes([[("a", 300), ("b", 68)], [("a", 200), ("b", 40)]], lightmapped=True)
        m = stdmesh.parse(raw)
        self.assertEqual((m.lightmapped, [lod.materials[-1].vertex_count for lod in m.lods]),
                         B.sm_lod_summary(raw))
        self.assertEqual((False, [5]), B.sm_lod_summary(sm_bytes([[("a", 5)]], version=9, cols=0)))
        self.assertIsNone(B.sm_lod_summary(b"\x07\x00\x00\x00" + bytes(40)))

    def test_the_client_stops_after_a_short_last_material_or_a_lightmapped_lod0(self):
        # stonebridge_sml_M1: LOD 0 ends on 68 vertices, so LOD 0 at every range
        self.assertEqual(1, B.kept_lod_count(False, [68, 27, 15, 14, 11, 30])[0])
        self.assertEqual(2, B.kept_lod_count(False, [266, 6, 137, 173, 78, 22])[0])
        self.assertEqual(6, B.kept_lod_count(False, [900, 800, 700, 600, 500, 400])[0])
        # an empty LOD keeps the last count seen (DAT_009ab664)
        self.assertEqual(3, B.kept_lod_count(False, [300, None, 40, 30])[0])
        kept, why = B.kept_lod_count(True, [1130, 997, 801, 539, 375, 25])
        self.assertEqual(1, kept)
        self.assertIn("LOD-6", why)

    def test_a_rung_past_the_kept_chain_is_a_finding_per_level(self):
        summaries = {"stonebridge_sml_m1": (False, [68, 27, 15, 14, 11, 30]),
                     "japanesefarm1_m1": (True, [1130, 997, 801, 539, 375, 25]),
                     "house_m1": (False, [900, 800, 700])}
        doc = rung_doc("stonebridge_sml_M1", 4)
        for extra in (rung_doc("japanesefarm1_m1", 5, parts=2), rung_doc("house_m1", 2)):
            shift = len(doc["nodes"])
            for n in extra["nodes"]:
                n = dict(n)
                if "children" in n:
                    n["children"] = [c + shift for c in n["children"]]
                doc["nodes"].append(n)
        find = summaries.get
        over = {r[0]: r for r in B.lod_chain_overruns(doc, lambda g: find(g.lower()), True)}
        self.assertEqual({"stonebridge_sml_M1", "japanesefarm1_m1"}, set(over))
        self.assertEqual((1, 6, 4, 1), (over["stonebridge_sml_M1"][1], over["stonebridge_sml_M1"][2],
                                         over["stonebridge_sml_M1"][4], over["stonebridge_sml_M1"][5]))
        rows = B.lod_chain_findings(doc, lambda g: find(g.lower()), True, "bocage", A.Finding)
        self.assertEqual(["lod-rung-beyond-kept-chain"] * 2, [f.cause for f in rows])
        self.assertTrue(all(f.is_failure() and f.level == "bocage" for f in rows))
        # a lightmapped part the viewer hides is the other cause's
        lit = rung_doc("japanesefarm1_m1", 5, lightmap=True)
        self.assertEqual([], B.lod_chain_overruns(lit, lambda g: find(g.lower()), True))
        self.assertEqual(1, len(B.lod_chain_overruns(lit, lambda g: find(g.lower()), False)))

    def test_a_level_geometry_counts_only_from_a_script_init_reaches(self):
        files = FakeFiles({"Objects/Geometries/Geometries.con":
                           b"GeometryTemplate.create StandardMesh Kii_hull_m1\n"
                           b"GeometryTemplate.file Kii_hull_Colless_m1\n",
                           "Objects/Farm/Geometries.con":
                           b"GeometryTemplate.create StandardMesh japanesefarm1_m1\n"
                           b"GeometryTemplate.file japanesefarm1_m1\n"
                           b"GeometryTemplate.create StandardMesh japanesefarm1_m1\n"
                           b"GeometryTemplate.file other_m1\n"})
        files._audit_run_order = ["Objects/Farm/Geometries.con"]
        self.assertEqual({"japanesefarm1_m1": "japanesefarm1_m1"}, B.level_geometry_files(files))

    def test_a_cube_the_chain_holds_must_be_baked(self):
        rcm = (b"positiveX=bf1942/levels/Wake/Textures/env_Wake_01.dds\n"
               b"negativeX=bf1942/levels/Wake/Textures/env_Wake_02.dds\n"
               b"positiveY=bf1942/levels/Wake/Textures/env_Wake_03.dds\n"
               b"negativeY=bf1942/levels/Wake/Textures/env_Wake_04.dds\n"
               b"positiveZ=bf1942/levels/Wake/Textures/env_Wake_05.dds\n"
               b"negativeZ=bf1942/levels/Wake/Textures/env_Wake_06.dds\n")
        files = FakeFiles({"bf1942/levels/M_I_A/Textures/ENVMAP_G_.rcm": rcm})
        faces = SimpleNamespace(resolves=lambda _files, path: "wake" in path.lower())
        with tempfile.TemporaryDirectory() as tmp:
            tree = make_tree(Path(tmp), ("m_i_a",))
            got = B.envmap_findings(tree, "m_i_a", {"envmap": None}, files, faces, A.Finding)
            self.assertEqual(["level-envmap-not-baked"], [f.cause for f in got])
            self.assertTrue(got[0].is_failure())
            # Mission Impossible: a face no archive holds; retail has no cube either
            faces = SimpleNamespace(resolves=lambda _files, path: not path.endswith("_06.dds"))
            got = B.envmap_findings(tree, "m_i_a", {"envmap": None}, files, faces, A.Finding)
            self.assertEqual(["level-envmap-faces-absent"], [f.cause for f in got])
            self.assertFalse(got[0].is_failure())
            # a baked cube whose files went missing
            env = [f"sky/{k}.png" for k in ("px", "nx", "py", "ny", "pz", "nz")]
            got = B.envmap_findings(tree, "m_i_a", {"envmap": env}, files, faces, A.Finding)
            self.assertEqual(["level-envmap-file-missing"], [f.cause for f in got])
            for f in env:
                (tree.maps / "m_i_a" / f).parent.mkdir(parents=True, exist_ok=True)
                (tree.maps / "m_i_a" / f).write_bytes(b"x")
            self.assertEqual([], B.envmap_findings(tree, "m_i_a", {"envmap": env}, files, faces,
                                                   A.Finding))
            # no .rcm: nothing to reflect
            self.assertEqual([], B.envmap_findings(tree, "m_i_a", {"envmap": None}, FakeFiles({}),
                                                   faces, A.Finding))

    def test_a_group_an_object_script_binds_on_a_placed_carrier_must_spawn(self):
        sc = {"soldierSpawns": [{"group": 1}], "vehicleSoldierSpawns": [],
              "objectSpawns": [{"vehicle": "LCVP_Spawn"}]}
        got = B.spawn_group_findings("omaha_charlie", sc, {"nodes": []}, [OMAHA_OBJECTS], A.Finding)
        # group 8 rides a placed craft; group 99's carrier is never placed
        self.assertEqual([("object-script-spawn-group-dropped", "group 8")],
                         [(f.cause, f.subject) for f in got])
        sc["vehicleSoldierSpawns"] = [{"group": 8}]
        self.assertEqual([], B.spawn_group_findings("omaha_charlie", sc, {"nodes": []},
                                                    [OMAHA_OBJECTS], A.Finding))

    def test_a_static_a_mode_script_places_must_be_in_the_scene(self):
        lib = ObjectLibrary()
        lib.add_con("objects/x.con", "\n".join([
            "ObjectTemplate.create SimpleObject V2_static",
            "ObjectTemplate.geometry V2_m1",
            "GeometryTemplate.create StandardMesh V2_m1",
            "ObjectTemplate.create ControlPoint OpenBases"]))
        inst = lambda t, x: SimpleNamespace(template=t, position=(x, 0.0, 0.0))  # noqa: E731
        gts = {"Conquest": SimpleNamespace(mode="Conquest", declared={}, objects=[
                   inst("V2_static", 1), inst("V2_static", 2), inst("OpenBases", 3),
                   inst("gebase", 4)]),
               "CoOp": SimpleNamespace(mode="SinglePlayer", declared={}, objects=[
                   inst("V2_static", 9)])}
        statics = B.mode_script_statics(gts, {"conquest"}, lib)
        self.assertEqual({"v2_static": {(1.0, 0.0, 0.0), (2.0, 0.0, 0.0)}, "gebase": {(4.0, 0.0, 0.0)}},
                         statics)
        doc = {"nodes": [{"name": "V2_static"}]}
        # gebase is declared nowhere, so the engine places nothing for it
        self.assertEqual([("v2_static", 1, 2)], B.missing_mode_statics(doc, statics, lib))
        doc["nodes"].append({"name": "V2_static_2"})
        self.assertEqual([], B.missing_mode_statics(doc, statics, lib))


class Wiring(unittest.TestCase):
    def test_v_static_runs_the_new_audits(self):
        for a in ("hud", "poses", "levels"):
            self.assertIn(a, A.AUDITS)
            self.assertIn(a, M.FAST_STATIC_AUDITS)

    def test_accepted_causes_reach_audit_mod(self):
        for cause in B.ACCEPTED:
            self.assertIn(cause, A.ACCEPTED)


if __name__ == "__main__":
    unittest.main()
