"""`audit_mod.py`: the adversarial audit finds the defects it was written for.

Each test builds a small tree in a temp directory with exactly one planted
defect and asserts the audit names it by cause. No game archives are needed:
the glb-only half of every sub-audit runs without them.
"""

from __future__ import annotations

import json
import struct
import sys
import tempfile
import unittest
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import audit_mod as A  # noqa: E402
from bf42 import gltf  # noqa: E402

NAN = float("nan")
TRI = [(0, 0, 0), (1, 0, 0), (0, 1, 0)]


def glb_with(uvs, material_texture=True, positions=TRI):
    """A one-triangle glb whose material has (or lacks) a texture."""
    b = gltf.GlbBuilder()
    tex = b.add_image_png(b"x", "texture/a.dds") if material_texture else None
    mat = b.add_material("m", texture=tex)
    # NaN is written through `_vec2_accessor`'s sanitiser, so patch the bytes
    # after the fact when a test wants a NaN in the file.
    mesh = b.add_mesh("m", [gltf.Primitive(
        positions=list(positions), indices=[0, 1, 2], uvs=list(uvs), material=mat)])
    node = b.add_node(gltf.Node("n", mesh=mesh))
    return b.build([node])


def with_nan(data: bytes, vertex: int = 1) -> bytes:
    """Overwrite one vertex's UV in the first VEC2 accessor with NaN."""
    n = struct.unpack_from("<I", data, 12)[0]
    doc = json.loads(data[20:20 + n])
    acc = next(a for a in doc["accessors"] if a["type"] == "VEC2")
    view = doc["bufferViews"][acc["bufferView"]]
    blob_at = 20 + n + 8
    o = blob_at + view.get("byteOffset", 0) + acc.get("byteOffset", 0) + vertex * 8
    out = bytearray(data)
    struct.pack_into("<ff", out, o, NAN, NAN)
    return bytes(out)


def png(width, height, rgba):
    def chunk(tag, payload):
        return (struct.pack(">I", len(payload)) + tag + payload
                + struct.pack(">I", zlib.crc32(tag + payload) & 0xFFFFFFFF))
    raw = b"".join(b"\x00" + bytes(rgba) * width for _ in range(height))
    return (b"\x89PNG\r\n\x1a\n"
            + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b""))


class ImageTests(unittest.TestCase):
    def check(self, width, height, rgba):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "t.png"
            p.write_bytes(png(width, height, rgba))
            return A.classify_image(p)

    def test_opaque_white_magenta_and_one_pixel_are_named(self):
        self.assertEqual("texture-opaque-white", self.check(8, 8, (255, 255, 255, 255))[0])
        self.assertEqual("texture-magenta", self.check(8, 8, (255, 0, 255, 255))[0])
        self.assertEqual("texture-1x1", self.check(1, 1, (10, 20, 30, 255))[0])

    def test_a_white_mask_with_alpha_and_a_real_texture_pass(self):
        self.assertIsNone(self.check(8, 8, (255, 255, 255, 128)))
        self.assertIsNone(self.check(8, 8, (90, 120, 60, 255)))

    def test_a_missing_file_is_named(self):
        self.assertEqual("texture-file-missing",
                         A.classify_image(Path("/nonexistent/x.webp"))[0])


class UvTests(unittest.TestCase):
    def verdict(self, data):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "m.glb"
            p.write_bytes(data)
            doc, blob = A.read_glb(p, with_bin=True)
        return A.uv_degenerate(doc, blob, doc["meshes"][0]["primitives"][0])

    def test_a_nan_on_a_drawn_triangle_is_visible(self):
        data = with_nan(glb_with([(0, 0), (1, 0), (0, 1)]))
        self.assertEqual("nan-visible", self.verdict(data))

    def test_a_nan_on_a_zero_area_triangle_is_degenerate(self):
        flat = [(0, 0, 0), (1, 0, 0), (2, 0, 0)]
        data = with_nan(glb_with([(0, 0), (1, 0), (0, 1)], positions=flat))
        self.assertEqual("nan-degenerate", self.verdict(data))

    def test_constant_uvs_and_clean_uvs(self):
        self.assertEqual("constant", self.verdict(
            glb_with([(0.5, 0.5)] * 4, positions=TRI + [(1, 1, 0)])))
        self.assertIsNone(self.verdict(glb_with([(0, 0), (1, 0), (0, 1)])))


class TreeFixture:
    def __enter__(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        (self.root / "models").mkdir()
        (self.root / "maps").mkdir()
        return self

    def __exit__(self, *exc):
        self.tmp.cleanup()

    def tree(self, levels=()):
        return A.Tree("t", self.root / "models", self.root / "maps",
                      self.root / "textures", list(levels))


class PlacementTests(unittest.TestCase):
    def level(self, fx, scene_extra, nodes):
        d = fx.root / "maps" / "lv"
        d.mkdir(parents=True)
        (d / "terrain").mkdir()
        dim = 8
        row = b"".join(b"\x00\x00\x00" for _ in range(dim))   # flat at 0 m
        raw = b"".join(b"\x00" + row for _ in range(dim))
        def chunk(tag, payload):
            return (struct.pack(">I", len(payload)) + tag + payload
                    + struct.pack(">I", zlib.crc32(tag + payload) & 0xFFFFFFFF))
        (d / "terrain" / "heightmap.png").write_bytes(
            b"\x89PNG\r\n\x1a\n"
            + chunk(b"IHDR", struct.pack(">IIBBBBB", dim, dim, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b""))
        scene = {"level": "lv", "worldSize": 32.0, "waterLevel": -50.0,
                 "heightmap": {"image": "terrain/heightmap.png", "dim": dim,
                               "spacing": 4.0, "heightUnits": 100.0},
                 "objectSpawns": [], "soldierSpawns": [], "controlPoints": []}
        scene.update(scene_extra)
        (d / "scene.json").write_text(json.dumps(scene))
        b = gltf.GlbBuilder()
        mesh = b.add_mesh("box", [gltf.Primitive(
            positions=[(-1, 0, -1), (1, 0, -1), (0, 2, 1)], indices=[0, 1, 2])])
        roots = [b.add_node(gltf.Node(name, translation=pos, mesh=mesh,
                                      extras={"templateKind": "SimpleObject"}))
                 for name, pos in nodes]
        (d / "scene.glb").write_bytes(b.build(roots))

    def run_audit(self, scene_extra, nodes):
        with TreeFixture() as fx:
            self.level(fx, scene_extra, nodes)
            return A.audit_placement(fx.tree(["lv"]), A.Game(""), {})

    def test_a_static_in_the_air_a_stacked_duplicate_and_one_outside(self):
        found = self.run_audit({}, [
            # Refractor coordinates: the builder mirrors z into the glb
            ("floater", (16, 40.0, 16)),       # 40 m up, nothing under it
            ("twin", (8, 0.0, 8)), ("twin", (8, 0.0, 8)),
            ("far", (500, 0.0, 8)),
            ("fine", (24, 0.0, 24))])
        causes = {(f.cause, f.subject) for f in found}
        self.assertIn(("static-floating", "floater"), causes)
        self.assertIn(("object-stacked-duplicate", "twin"), causes)
        self.assertIn(("object-outside-world", "far"), causes)
        self.assertFalse([f for f in found if f.subject == "fine"])

    def test_a_static_resting_on_another_is_supported(self):
        found = self.run_audit({}, [("mid", (16, 3.5, 16)),
                                    ("roof", (16, 7.0, 16))])
        self.assertFalse([f for f in found if f.cause == "static-floating"])


class SoundFileTests(unittest.TestCase):
    def test_a_layer_whose_sample_is_not_in_the_tree_is_named(self):
        with TreeFixture() as fx:
            shared = fx.root / "maps" / "_shared"
            (shared / "sounds").mkdir(parents=True)
            (shared / "sounds" / "ok.mp3").write_bytes(b"x")
            (shared / "vehicle-sounds.json").write_text(json.dumps({"vehicles": [
                {"template": "T", "layers": [
                    {"file": "../_shared/sounds/ok.mp3"},
                    {"file": "../_shared/sounds/gone.mp3"}], "weapons": []}]}))
            found = A.audit_sound(fx.tree(), A.Game(""), {})
        self.assertEqual(["layer-file-missing"], [f.cause for f in found])
        self.assertIn("gone.mp3", found[0].detail)

    def test_a_level_own_sound_record_covers_a_template_the_table_lacks(self):
        # Kikusui's `Lion45+10000`: the table never lists it, its level does.
        with TreeFixture() as fx:
            lv = fx.root / "maps" / "lv"
            lv.mkdir(parents=True)
            (lv / "scene.json").write_text(json.dumps({"sounds": {"vehicles": [
                {"template": "Ship+10000", "layers": [{"file": "a.mp3"}],
                 "weapons": [{"fireArms": "Gun", "layers": [{"file": "g.mp3"}]}]},
                {"template": "Silent+10000", "layers": [], "weapons": []}]}}))
            coverage = A.sound_coverage(fx.tree(["lv"]), {})
        self.assertEqual(1, len(coverage["ship+10000"]["layers"]))
        self.assertEqual("Gun", coverage["ship+10000"]["weapons"][0]["fireArms"])
        self.assertFalse(coverage["silent+10000"]["layers"])

    def test_the_table_entry_is_not_rewritten_by_a_level_record(self):
        table = {"t": {"template": "T", "layers": [{"file": "shared.mp3"}],
                       "weapons": []}}
        with TreeFixture() as fx:
            lv = fx.root / "maps" / "lv"
            lv.mkdir(parents=True)
            (lv / "scene.json").write_text(json.dumps({"sounds": {"vehicles": [
                {"template": "T", "layers": [{"file": "level.mp3"}],
                 "weapons": []}]}}))
            coverage = A.sound_coverage(fx.tree(["lv"]), table)
        self.assertEqual("shared.mp3", table["t"]["layers"][0]["file"])
        self.assertEqual("shared.mp3", coverage["t"]["layers"][0]["file"])

    def test_a_hand_weapon_listed_in_weapons_json_is_known(self):
        with TreeFixture() as fx:
            (fx.root / "models" / "sounds").mkdir()
            (fx.root / "models" / "sounds" / "weapons.json").write_text(json.dumps(
                {"weapons": {"BayonetK98": {"file": "x.mp3"}}, "silent": {}}))
            names = A.handweapon_names(fx.tree())
        self.assertEqual({"bayonetk98"}, names)


class AuthoredPositionTests(unittest.TestCase):
    class _Arc:
        entries = {"bf1942/levels/Lv/StaticObjects.con": 1,
                   "bf1942/levels/Lv/Other.txt": 1}

        def read(self, en):
            return (b"Object.create crate\r\n"
                    b"Object.absolutePosition 351.48/253.492/1443.32\r\n"
                    b"rem Object.absolutePosition 10/20/30\r\n")

    def test_scripts_positions_are_keyed_by_scene_xz_and_rem_is_skipped(self):
        got = A.authored_positions(self._Arc())
        self.assertEqual({(351.5, 1443.3)}, set(got))
        x, y, src = got[(351.5, 1443.3)]
        self.assertAlmostEqual(253.492, y)
        self.assertEqual("StaticObjects.con:2", src)


class MalformedAuthoredPositionTests(unittest.TestCase):
    def test_a_typod_vector_reads_as_the_engine_reads_it(self):
        # FHSW Supercharge-1942 StaticObjects.con:13925, CON-18
        arc = _FakeArc({"bf1942/levels/Lv/StaticObjects.con":
                        b"Object.create tankobs_ste_M1\r\n"
                        b"Object.absolutePosition 967.94/55.55.28/1358.53\r\n"})
        got = A.authored_positions(arc)
        self.assertEqual({(967.9, 28.0)}, set(got))
        self.assertAlmostEqual(55.55, got[(967.9, 28.0)][1])


class AuthoredSpawnTests(unittest.TestCase):
    """2026-10-19 FHSW/FHSWEurope gates: every `spawn-buried` (60 and 43) and
    `ship-off-waterline` (136 and 140) row stood at its spawner's own authored
    pose. The engine stands a spawned object there with no ground query and
    the terrain lifts a mobile hull out (SPAWN-28; FHX-18, FHX-22)."""

    SCRIPT = (b"Object.create tank_pad\r\n"
              b"Object.absolutePosition 16/-5/16\r\n"
              b"Object.create boat_pad\r\n"
              b"Object.absolutePosition 8/0/8\r\n"
              b"rem Object.absolutePosition 8/-50/8\r\n"
              b"Object.create kit_pad\r\n"
              b"Object.absolutePosition 24.0.-30/24\r\n"   # CON-18: (24.0, -30, 24)
              b"Object.create corner_pad\r\n"
              b"Object.setOSId 4\r\n"
              b"Object.create drop_point\r\n"
              b"Object.absolutePosition 20/40/20\r\n")

    class _Arc:
        def __init__(self, text):
            self.entries = {"bf1942/levels/Lv/Conquest/ObjectSpawns.con": 1}
            self.text = text

        def read(self, en):
            return self.text

    class _Game:
        ok = True

        def __init__(self, arc):
            self.arc = arc

        def level_archive(self, name):
            return self.arc

    def test_positions_are_per_object_read_as_the_engine_reads_them(self):
        got = A.authored_object_positions(self._Arc(self.SCRIPT))
        self.assertEqual([(16.0, -5.0, -16.0, "Conquest/ObjectSpawns.con:2")], got["tank_pad"])
        self.assertEqual((24.0, -30.0, -24.0), got["kit_pad"][0][:3])
        self.assertEqual((0.0, 0.0, 0.0), got["corner_pad"][0][:3])
        self.assertIn("no absolutePosition", got["corner_pad"][0][3])
        self.assertEqual(1, len(got["boat_pad"]))   # the `rem` line is not a place
        self.assertEqual("Conquest/ObjectSpawns.con:2",
                         A.authored_at(got, "Tank_Pad", (16.0, -5.05, -16.0)))
        self.assertIsNone(A.authored_at(got, "tank_pad", (16.0, -3.0, -16.0)))

    def run_audit(self):
        spawns = [
            {"spawner": "tank_pad", "vehicle": "Tank", "position": [16, -5, -16]},
            {"spawner": "moved_pad", "vehicle": "Tank", "position": [12, -5, -12]},
            {"spawner": "boat_pad", "vehicle": "Boat", "position": [8, 0, -8]},
            {"spawner": "kit_pad", "vehicle": "SomeKit", "position": [24, -30, -24]},
            {"spawner": "corner_pad", "vehicle": "Tank", "position": [0, 0, 0]}]
        soldiers = [{"name": "drop_point", "position": [20, 40, -20], "paratrooper": True},
                    {"name": "ledge_point", "position": [12, 40, -20]}]
        with TreeFixture() as fx:
            PlacementTests.level(None, fx, {"objectSpawns": spawns, "soldierSpawns": soldiers},
                                 [("fine", (28, 0.0, 28))])
            (fx.root / "models" / "models.json").write_text(json.dumps(
                [{"name": "Tank", "category": "land"}, {"name": "Boat", "category": "sea"}]))
            return A.audit_placement(fx.tree(["lv"]), self._Game(self._Arc(self.SCRIPT)), {})

    def test_an_authored_buried_pad_is_accepted_and_a_moved_one_is_not(self):
        found = self.run_audit()
        causes = [f.cause for f in found]
        self.assertIn("spawn-buried-authored", causes)
        self.assertIn("spawn-buried", causes)               # moved_pad: not the script's pose
        self.assertIn("ship-off-waterline-authored", causes)
        self.assertIn("marker-below-ground-authored", causes)
        self.assertIn("spawn-at-origin-authored", causes)
        self.assertIn("soldier-spawn-floating-paratrooper", causes)
        self.assertIn("soldier-spawn-floating", causes)     # ledge_point: no drop flag
        for c in ("spawn-buried-authored", "ship-off-waterline-authored",
                  "marker-below-ground-authored", "spawn-at-origin-authored",
                  "soldier-spawn-floating-paratrooper"):
            self.assertIn(c, A.ACCEPTED)
        self.assertNotIn("spawn-buried", A.ACCEPTED)
        buried = next(f for f in found if f.cause == "spawn-buried-authored")
        self.assertIn("authored for tank_pad [Conquest/ObjectSpawns.con:2]", buried.detail)


class _FakeArc:
    def __init__(self, files: dict):
        self.files = files
        self.entries = {n: 1 for n in files}

    def read(self, name):
        return self.files[name]


class ChainArchiveTests(unittest.TestCase):
    def test_the_nearest_archive_wins_and_the_parents_fill_the_rest(self):
        child = _FakeArc({"bf1942/levels/L/Init.con": b"child"})
        parent = _FakeArc({"bf1942/levels/L/Init.con": b"parent",
                           "bf1942/levels/L/StaticObjects.con": b"statics"})
        arc = A.ChainArchive([child, parent])
        self.assertEqual(b"child", arc.read("bf1942/levels/L/Init.con"))
        self.assertEqual(b"statics", arc.read("bf1942/levels/L/StaticObjects.con"))
        self.assertEqual(2, len(arc.entries))


class DataRuleTests(unittest.TestCase):
    """2026-10-19 gates: rows the data audit raised on the mods' own authoring."""

    LEVEL = {
        "bf1942/levels/Lv/Conquest/ControlPoints.con":
            b"Object.create cp_town\r\nObject.absolutePosition 1/0/1\r\n",
        "bf1942/levels/Lv/Conquest/SoldierSpawnTemplates.con":
            b"ObjectTemplate.create SpawnPoint town_spawn\r\nObjectTemplate.setGroup 3\r\n"
            b"ObjectTemplate.create SpawnPoint tunnel_spawn\r\nObjectTemplate.setGroup 5\r\n",
        "bf1942/levels/Lv/Conquest/SoldierSpawns.con":
            b"Object.create town_spawn\r\nObject.absolutePosition 2/0/2\r\n"
            b"rem Object.create tunnel_spawn\r\n",
    }

    class _Lib:
        objects: dict = {}

    class _Game:
        ok = True

        def __init__(self, arc):
            self.arc = arc

        def level_archive(self, name):
            return self.arc

        mod = "Lv"
        chain: list = []

        def library(self):
            return DataRuleTests._Lib()

    def run_audit(self, scene):
        with TreeFixture() as fx:
            d = fx.root / "maps" / "lv"
            d.mkdir(parents=True)
            base = {"level": "Lv", "objectSpawns": [], "soldierSpawns": [],
                    "vehicleSoldierSpawns": [], "controlPoints": []}
            base.update(scene)
            (d / "scene.json").write_text(json.dumps(base))
            b = gltf.GlbBuilder()
            mesh = b.add_mesh("m", [gltf.Primitive(positions=[(0, 0, 0), (1, 0, 0), (0, 1, 0)],
                                                   indices=[0, 1, 2])])
            roots = [b.add_node(gltf.Node("RampKiller", mesh=mesh,
                                          extras={"sourceTemplate": "RampKillerPCO"}))]
            (d / "scene.glb").write_bytes(b.build(roots))
            (fx.root / "models" / "models.json").write_text("[]")
            shared = fx.root / "maps" / "_shared"
            (shared / "voices" / "dut").mkdir(parents=True)
            (shared / "voices" / "languages.json").write_text(json.dumps(
                {"soldiers": {"dutchsoldier": "dut"}}))
            (shared / "loadouts.json").write_text(json.dumps(
                {"kits": {}, "levels": {"lv": {"1": {"soldier": "DutchSoldier", "slots": {}}}}}))
            from unittest import mock
            with mock.patch.object(A, "voices_stale_findings", lambda *a: []):
                return A.audit_data(fx.tree(["lv"]), self._Game(_FakeArc(self.LEVEL)), {})

    def test_a_group_no_placed_spawn_point_fills_is_the_scripts_own(self):
        found = self.run_audit({"controlPoints": [
            {"name": "cp_tunnel", "spawnGroupId": 5, "team": 1},
            {"name": "cp_town", "spawnGroupId": 3, "team": 1},
            {"name": "cp_pads", "spawnGroupId": 8, "team": 1}],
            "vehicleSoldierSpawns": [{"name": "pad", "vehicle": "", "group": 8}]})
        got = {(f.cause, f.subject) for f in found if f.cause.startswith("control-point")}
        # tunnel: its only spawn is rem'd; town: placed, so the bake lost it; pads: seats fill 8
        self.assertEqual({("control-point-spawn-group-empty-in-script", "cp_tunnel"),
                          ("control-point-spawn-group-empty", "cp_town")}, got)
        self.assertIn("control-point-spawn-group-empty-in-script", A.ACCEPTED)
        self.assertNotIn("control-point-spawn-group-empty", A.ACCEPTED)

    def test_a_soldier_the_language_table_voices_is_not_unknown(self):
        found = self.run_audit({})
        self.assertFalse([f for f in found if f.cause == "soldier-nation-unknown"])
        self.assertFalse([f for f in found if f.cause == "voices-nation-missing"])

    def test_a_spawn_nothing_defines_is_retail_and_a_baked_one_is_fine(self):
        found = self.run_audit({"objectSpawns": [
            {"spawner": "s1", "vehicle": "GhostGun", "position": [1, 0, 1]},
            {"spawner": "s2", "vehicle": "RampKillerPCO", "position": [1, 0, 1]}]})
        got = {(f.cause, f.subject) for f in found if "spawn-template" in f.cause}
        self.assertEqual({("spawn-template-undefined-in-install", "GhostGun")}, got)
        self.assertIn("spawn-template-undefined-in-install", A.ACCEPTED)

    def test_a_neutral_point_needs_no_main_cloth(self):
        found = self.run_audit({"controlPoints": [
            {"name": "bunker", "team": 0, "visible": True, "flagMesh": "flagge_m1",
             "spawnGroupId": -1},
            {"name": "base", "team": 1, "visible": True, "flagMesh": "flagge_m1",
             "spawnGroupId": -1}]})
        got = {f.subject for f in found if f.cause == "control-point-flag-not-baked"}
        self.assertEqual({"base"}, got)


class SeatTreeTests(unittest.TestCase):
    def test_a_spawn_carrier_with_no_entry_point_has_no_seat_by_authoring(self):
        from types import SimpleNamespace as NS

        def t(name, kind, *kids):
            return NS(name=name, kind=kind, children=[NS(template=k) for k in kids])
        lib = NS(objects={o.name.lower(): o for o in (
            t("ParaSpawnObject83", "PlayerControlObject", "ParaSpawnPoint"),
            t("ParaSpawnPoint", "SpawnPoint"),
            t("Jeep", "PlayerControlObject", "JeepBody"),
            t("JeepBody", "Bundle", "JeepEntry"),
            t("JeepEntry", "EntryPoint"))})
        self.assertIs(False, A.tree_has_seat(lib, "ParaSpawnObject83"))
        self.assertIs(True, A.tree_has_seat(lib, "jeep"))
        self.assertIsNone(A.tree_has_seat(lib, "Unknown"))
        self.assertIn("air-no-seats-authored", A.ACCEPTED)


class OwnLevelTests(unittest.TestCase):
    def test_a_texture_pack_in_the_levels_folder_is_not_a_level(self):
        import audit_completeness as C
        from unittest import mock
        arcs = {"Pack.rfa": {"bf1942/levels/_TEXTURE_GENERAL/texture/a.dds": 1},
                "Real.rfa": {"bf1942/levels/Real/Init.con": 1}}

        class Arc:
            def __init__(self, path):
                self.entries = arcs[Path(path).name]
        with mock.patch("bf42.rfa.RfaArchive", Arc):
            self.assertFalse(C._is_level_archive(Path("Pack.rfa")))
            self.assertTrue(C._is_level_archive(Path("Real.rfa")))


class ReportTests(unittest.TestCase):
    def test_only_findings_outside_accepted_fail_the_run(self):
        ok = [A.Finding("textures", "uv-constant", "x.glb")]
        bad = [A.Finding("textures", "uv-nan-visible", "x.glb")]
        import contextlib
        import io
        with contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(0, A.report(ok, {}, ["textures"]))
            self.assertEqual(1, A.report(bad, {}, ["textures"]))


class LevelScopeTests(unittest.TestCase):
    """`--levels` cuts every per-level read to those levels, and `--since` the
    model-tree reads to what a run wrote (2026-10-20: thirteen whole-tree audits
    after each 25-level FHSWEurope batch ran the PC out of memory)."""

    def setUp(self):
        self.fx = TreeFixture().__enter__()
        maps = self.fx.root / "maps"
        rows = []
        for d, name in (("aberdeen", "Aberdeen"), ("kursk", "Kursk"), ("wake", "Wake")):
            (maps / d).mkdir()
            (maps / d / "scene.json").write_text("{}")
            (maps / d / "scene.glb").write_bytes(glb_with([(0, 0), (1, 0), (0, 1)]))
            rows.append({"name": name, "glb": f"{d}/scene.glb", "report": f"{d}/scene.json"})
        (maps / "maps.json").write_text(json.dumps(rows))
        models = self.fx.root / "models"
        (models / "Old.glb").write_bytes(glb_with([(0, 0), (1, 0), (0, 1)]))
        import os
        os.utime(models / "Old.glb", (1000, 1000))
        (models / "New.glb").write_bytes(glb_with([(0, 0), (1, 0), (0, 1)]))
        self.tree = self.fx.tree(["aberdeen", "kursk", "wake"])
        self.tree.all_levels = list(self.tree.levels)

    def tearDown(self):
        self.fx.__exit__()

    def test_levels_match_by_directory_or_maps_json_name(self):
        self.assertEqual(self.tree.restrict(["Kursk", "aberdeen", "Nowhere"]), ["Nowhere"])
        self.assertEqual(self.tree.levels, ["aberdeen", "kursk"])
        self.assertEqual(self.tree.all_levels, ["aberdeen", "kursk", "wake"])

    def test_the_scenes_read_are_the_scoped_ones(self):
        self.tree.restrict(["Kursk"])
        scenes = [p.parent.name for p in A.glb_files(self.tree) if p.name == "scene.glb"]
        self.assertEqual(scenes, ["kursk"])

    def test_since_reads_only_the_model_files_written_since(self):
        self.tree.restrict(["Kursk"], since=2000)
        models = [p.name for p in A.glb_files(self.tree) if p.name != "scene.glb"]
        self.assertEqual(models, ["New.glb"])

    def test_without_since_every_model_file_is_read(self):
        self.tree.restrict(["Kursk"])
        models = sorted(p.name for p in A.glb_files(self.tree) if p.name != "scene.glb")
        self.assertEqual(models, ["New.glb", "Old.glb"])

    def test_the_exported_set_is_cut_to_the_scope(self):
        import audit_play
        self.assertEqual(audit_play._exported_levels(self.tree), {"aberdeen", "kursk", "wake"})
        self.tree.restrict(["kursk"])
        self.assertEqual(audit_play._exported_levels(self.tree), {"kursk"})


if __name__ == "__main__":
    unittest.main()
