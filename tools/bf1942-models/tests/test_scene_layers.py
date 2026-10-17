"""The level bake in layers (Brief S, 2026-09-24).

`scene_layers.py` splits `scene.json` into con-derived layers a patch can
rebuild on their own (`patch_scene.py`), leaving the glb-side keys to the full
bake. Pinned here:

* the merge rewrites only the named layers' keys and keeps every other byte;
* a full bake of a real level is deterministic, byte for byte, glb included;
* the glb carries no layer, so a con change cannot reach it through extras;
* every layer patched back over a bake reproduces the bake exactly, even when
  the published keys were stale;
* a synthetic change to one control point, in a scratch copy of the install,
  changes only that level's control point keys, and the publisher's dry run
  sends only that `scene.json` (the edit keeps the file's length, which a
  size-only compare would miss).
"""

from __future__ import annotations

import json
import os
import shutil
import struct
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(HERE))

import scene_layers  # noqa: E402

REPO = HERE.parents[1]
PUBLISHER = REPO / "scripts" / "publish-mesh-delta.py"
LEVEL = "Berlin"


def _game_dir() -> Path | None:
    try:
        from extract_models import DEFAULT_GAME_DIR
    except Exception:  # noqa: BLE001
        return None
    game = Path(os.path.expanduser(str(DEFAULT_GAME_DIR)))
    return game if (game / "Mods" / "bf1942").is_dir() else None


def _child(parent: Path, name: str) -> Path:
    return next(c for c in parent.iterdir() if c.name.lower() == name.lower())


def scratch_install(game_dir: Path, dest: Path, mod: str, level: str,
                    files: dict[str, bytes]) -> Path:
    """A copy of the install, made of symlinks, with one more patch archive
    (`<level>_999.rfa`, loaded last so it wins) holding `files`.

    `files` keys are level-relative (`Conquest/ControlPointTemplates.con`).
    """
    from bf42.rfa import write_rfa
    src_mod = _child(game_dir / "Mods", mod)
    path = [src_mod, _child(src_mod, "Archives")]
    path.append(_child(path[-1], "bf1942"))
    path.append(_child(path[-1], "levels"))
    out = dest / "Mods" / src_mod.name
    for depth, src in enumerate(path):
        out.mkdir(parents=True, exist_ok=True)
        keep = path[depth + 1].name if depth + 1 < len(path) else None
        for child in src.iterdir():
            if child.name != keep:
                (out / child.name).symlink_to(child)
        if keep:
            out = out / keep
    archive_names = {f"bf1942/levels/{level}/{rel}": data for rel, data in files.items()}
    write_rfa(out / f"{level}_999.rfa", archive_names)
    return dest


class MaterialsLayerTests(unittest.TestCase):
    """`layer_materials`: the `.rs` materials that declare `depthWrite false`."""

    class _Pool:
        def __init__(self, files: dict[str, str]) -> None:
            self.files = files

        def names(self) -> list[str]:
            return list(self.files)

        def try_read(self, name: str):
            text = self.files.get(name)
            return None if text is None else text.encode("latin-1")

    def _ctx(self, meshes: dict[str, str], objects: dict[str, str] | None = None):
        pools = (self._Pool(meshes), None, self._Pool(objects or {}), None)
        info = type("Info", (), {"name": "Operation_Coronet-1946"})()
        # Already mounted: the level's own archives are the bake's business.
        return type("Ctx", (), {"pools": pools, "info": info,
                                "_level_pools_mounted": True})()

    def test_the_levels_own_archive_beats_another_levels(self) -> None:
        # FHSW's Operation Coronet ships `japanesefarm4`, which the chain does
        # not, and its blocks `isi`, `tatami` and `hasira` share their names
        # with Alaska's and Kushira's meshes. The bake draws the level's own
        # file (`ArchivePool.add_level_meshes`), so its words are the ones kept.
        meshes = {
            "bf1942/levels/Alaska-1948/standardMesh/vOne_base_m1.rs":
                'subshader "isi" "StandardMesh/Default" '
                '{ materialDiffuse 0.5 0.5 0.5; texture "texture/a"; }',
            "bf1942/levels/Operation_Coronet-1946/StandardMesh/japanesefarm4.rs":
                'subshader "isi" "StandardMesh/Default" '
                '{ materialDiffuse 0.25 0.25 0.25; texture "texture/a"; }',
        }
        top, _ = scene_layers.layer_materials(self._ctx(meshes))
        self.assertEqual(top["materialDiffuse"], {"0.25 0.25 0.25": ["isi"]})

    def test_another_levels_archive_only_fills_gaps(self) -> None:
        # A level archive mounted at its own path declares a block the mod's
        # global file also declares: the global one is nearer.
        meshes = {
            "bf1942/levels/Other/standardMesh/X.rs":
                'subshader "X_Material0" "StandardMesh/Default" '
                '{ materialDiffuse 0.5 0.5 0.5; texture "texture/a"; }'
                'subshader "Only_Material0" "StandardMesh/Default" '
                '{ materialDiffuse 0.25 0.25 0.25; texture "texture/a"; }',
            "standardMesh/X.rs":
                'subshader "X_Material0" "StandardMesh/Default" '
                '{ materialDiffuse 0.75 0.75 0.75; texture "texture/a"; }',
        }
        top, _ = scene_layers.layer_materials(self._ctx(meshes))
        self.assertEqual(top["materialDiffuse"], {
            "0.25 0.25 0.25": ["only_material0"],
            "0.75 0.75 0.75": ["x_material0"],
        })

    def test_lists_only_the_materials_that_say_depth_write_false(self) -> None:
        meshes = {
            "standardMesh/ILyushin_Cockpit_M1.rs":
                'subshader "ILyushin_Cockpit_M1_Material0" "StandardMesh/Default" '
                '{ transparent true; texture "texture/a"; }',
            "standardMesh/1P_Katyusha_M1.rs":
                'subshader "1P_Katyusha_M1_Material1" "StandardMesh/Default" '
                '{ transparent true; depthWrite false; texture "texture/b"; }',
            "standardMesh/notes.txt": "depthWrite false",
        }
        top, modes = scene_layers.layer_materials(self._ctx(meshes))
        self.assertEqual(top, {"depthWriteOff": ["1p_katyusha_m1_material1"],
                               "materialDiffuse": {}, "alphaBlend": [],
                               "alphaLodDistance": {}})
        self.assertEqual(modes, {})

    def test_lists_the_transparent_materials_that_also_test_alpha(self) -> None:
        # Blended within the geometry's alphaLodDistance, cut past it (ledger
        # DL-12). An additive material and one that only tests are not these.
        meshes = {
            "standardMesh/pega_grassfield02.rs":
                'subshader "pega_grassfield02_Material0" "StandardMesh/Default" '
                '{ transparent true; depthWrite false; alphaTestRef 0.7; texture "texture/a"; }',
            "standardMesh/glass.rs":
                'subshader "glass_Material0" "StandardMesh/Default" '
                '{ transparent true; texture "texture/b"; }',
            "standardMesh/net.rs":
                'subshader "net_Material0" "StandardMesh/Default" '
                '{ alphaTestRef 0.5; texture "texture/c"; }',
            "standardMesh/flash.rs":
                'subshader "flash_Material0" "StandardMesh/Default" '
                '{ transparent true; blendSrc sourceAlpha; blendDest one; alphaTestRef 0.1; '
                'texture "texture/d"; }',
        }
        objects = {
            "Objects/Wire/Geometries.con":
                "GeometryTemplate.create StandardMesh Stebarbwire_m1\n"
                "GeometryTemplate.file Stebarbwire_m1\n"
                "GeometryTemplate.alphaLodDistance 0\n"
                "GeometryTemplate.create StandardMesh Plain_m1\n"
                "GeometryTemplate.file Plain_m1\n"
                "GeometryTemplate.create StandardMesh B17_Prp1\n"
                "geometryTemplate.alphaLodDistance 750\n",
            "Objects/Wire/Objects.con": "ObjectTemplate.create SimpleObject Stebarbwire_m1\n",
        }
        top, _ = scene_layers.layer_materials(self._ctx(meshes, objects))
        self.assertEqual(top["alphaBlend"], ["pega_grassfield02_material0"])
        self.assertEqual(top["alphaLodDistance"], {"b17_prp1": 750.0, "stebarbwire_m1": 0.0})


    def test_groups_the_lit_materials_whose_diffuse_is_not_white(self) -> None:
        # The word scales the sun's term only (ledger DL-9); white needs no
        # entry and a `lighting false` material is not lit at all.
        meshes = {
            "standardMesh/pega_grassfield02.rs":
                'subshader "pega_grassfield02_Material0" "StandardMesh/Default" '
                '{ lighting true; materialDiffuse 0.588235 0.588235 0.588235; texture "texture/a"; }',
            "standardMesh/pega_grassfield01.rs":
                'subshader "pega_grassfield01_Material0" "StandardMesh/Default" '
                '{ lighting true; materialDiffuse 0.588235 0.588235 0.588235; texture "texture/a"; }',
            "standardMesh/white.rs":
                'subshader "white_Material0" "StandardMesh/Default" '
                '{ lighting true; materialDiffuse 1 1 1; texture "texture/b"; }',
            "standardMesh/glow.rs":
                'subshader "glow_Material0" "StandardMesh/Default" '
                '{ lighting false; materialDiffuse 0.5 0.5 0.5; texture "texture/c"; }',
            "standardMesh/track.rs":
                'subshader "track_Material0" "StandardMesh/Default" '
                '{ materialDiffuse 0 0 0; texture "texture/d"; }',
        }
        top, _ = scene_layers.layer_materials(self._ctx(meshes))
        self.assertEqual(top["materialDiffuse"], {
            "0 0 0": ["track_material0"],
            "0.588235 0.588235 0.588235": ["pega_grassfield01_material0",
                                           "pega_grassfield02_material0"],
        })

    def test_the_nearer_declaration_wins(self) -> None:
        # An object script's Art/ override beats the mod chain's file.
        objects = {"Art/X.rs": 'subshader "X_Material0" "StandardMesh/Default" '
                               '{ transparent true; texture "texture/a"; }'}
        meshes = {"standardMesh/X.rs": 'subshader "X_Material0" "StandardMesh/Default" '
                                       '{ transparent true; depthWrite false; texture "texture/a"; }'}
        top, _ = scene_layers.layer_materials(self._ctx(meshes, objects))
        self.assertEqual(top["depthWriteOff"], [])


class TerrainShadowWordTests(unittest.TestCase):
    class _Files:
        def __init__(self, files: dict[str, str]) -> None:
            self._files = {k.lower(): v for k, v in files.items()}

        def find(self, name: str):
            return name if name.lower() in self._files else None

        def read(self, name: str) -> bytes:
            return self._files[name.lower()].encode("latin-1")

    def test_the_constructors_values_until_a_script_says(self) -> None:
        # client 0x00684a00..0x00684a7d
        self.assertEqual(scene_layers.terrain_shadow_words(self._Files({})), {
            "ambient": [10.0, 10.0, 10.0], "fadeTime": 0.5, "cullY": 15.0,
            "cullBox": [5.0, 5.0, 5.0]})

    def test_road_to_ramelles_words(self) -> None:
        words = scene_layers.terrain_shadow_words(self._Files({"Init/Terrain.con": (
            "GeometryTemplate.create PatchTerrain patchGeometry\n"
            "Terrain.ShadowAmbient 80/80/90\n"
            "Terrain.ShadowBorderFadeTime 0.25\n"
            "terrain.shadowSamplingCullY 5\n"
            "Terrain.shadowStaticObjectsCullBox 8/8/8\n")}))
        self.assertEqual(words, {"ambient": [80.0, 80.0, 90.0], "fadeTime": 0.25,
                                 "cullY": 5.0, "cullBox": [8.0, 8.0, 8.0]})


class MeshCullWordTests(unittest.TestCase):
    def test_only_what_moves_off_the_constructor(self) -> None:
        from bf42.con import ObjectLibrary

        library = ObjectLibrary()
        library.add_con("Objects/T/Geometries.con", """
GeometryTemplate.create StandardMesh Browning_m1
geometryTemplate.cullFactor 0.15
GeometryTemplate.create StandardMesh Default_m1
GeometryTemplate.cullFactor 0.03
GeometryTemplate.setLodDistance 0 0
GeometryTemplate.create StandardMesh Runway_m1
GeometryTemplate.scale 0.42/1/0.89
GeometryTemplate.setLodDistance 0 40
GeometryTemplate.create StandardMesh Crate_m1
GeometryTemplate.scale 0.5/1.5/0.5
GeometryTemplate.create TreeMesh Bush_m1
""")
        self.assertEqual(scene_layers.mesh_cull_words(library), {
            "browning_m1": {"cullFactor": 0.15},
            "bush_m1": {"kind": "treemesh"},
            "crate_m1": {"scale": 1.5},
            "runway_m1": {"lod0": 40.0},
        })

    def test_its_own_layer(self) -> None:
        self.assertEqual(scene_layers.LAYERS["meshCull"], (("meshCull",), ()))
        # After terrainDetail, ahead of envmapTexture (both added 2026-10-17).
        self.assertEqual(scene_layers.REPORT_ORDER[-2:], ("meshCull", "envmapTexture"))


class MergeTests(unittest.TestCase):
    def setUp(self) -> None:
        self.report = {
            "level": "T", "fogStart": 1.0, "terrain": {"tiles": 4},
            "controlPoints": [{"name": "a", "radius": 5.0}],
            "soldierSpawns": [], "vehicleSoldierSpawns": [], "objectSpawns": [],
            "modes": {"Conquest": {"gameTypes": ["Conquest"],
                                   "controlPoints": [{"name": "a", "radius": 5.0}],
                                   "tickets": None}},
            "sounds": {"ambient": None},
        }

    def test_only_the_named_layer_moves(self) -> None:
        top = {"controlPoints": [{"name": "a", "radius": 9.0}]}
        modes = {"Conquest": {"controlPoints": [{"name": "a", "radius": 9.0}]}}
        out = scene_layers.merge(self.report, ["controlPoints"], top, modes)
        self.assertEqual(list(out), list(self.report))
        self.assertEqual(out["controlPoints"][0]["radius"], 9.0)
        self.assertEqual(list(out["modes"]["Conquest"]), ["gameTypes", "controlPoints", "tickets"])
        for key in ("level", "fogStart", "terrain", "sounds", "soldierSpawns"):
            self.assertIs(out[key], self.report[key])
        self.assertIs(out["modes"]["Conquest"]["gameTypes"],
                      self.report["modes"]["Conquest"]["gameTypes"])

    def test_a_key_the_layer_no_longer_has_is_dropped(self) -> None:
        report = {**self.report, "ai": {"strategies": []}}
        out = scene_layers.merge(report, ["ai"], {}, {})
        self.assertNotIn("ai", out)
        out = scene_layers.merge(self.report, ["ai"], {"ai": {"x": 1}}, {})
        self.assertEqual(list(out)[-1], "ai")

    def test_a_new_mode_needs_every_mode_layer(self) -> None:
        modes = {"Conquest": {"controlPoints": []}, "Ctf": {"controlPoints": []}}
        with self.assertRaises(scene_layers.ModeSetChanged):
            scene_layers.merge(self.report, ["controlPoints", "spawns"], {}, modes)
        full = {m: {"gameTypes": [], "controlPoints": [], "soldierSpawns": [],
                    "objectSpawns": [], "vehicleSoldierSpawns": [], "tickets": None,
                    "combatArea": None, "flagBases": [], "objectives": None}
                for m in ("Conquest", "Ctf")}
        out = scene_layers.merge(self.report, ["controlPoints", "spawns", "game"], {}, full)
        self.assertEqual(sorted(out["modes"]), ["Conquest", "Ctf"])
        self.assertEqual(list(out["modes"]["Ctf"]), list(scene_layers.MODE_KEY_ORDER))

    def test_the_game_layer_owns_the_briefing(self) -> None:
        # `briefing` sits with the game layer's con-derived keys: patching
        # `game` rewrites it, patching anything else leaves it alone.
        self.assertIn("briefing", scene_layers.LAYERS["game"][0])
        self.assertIn("briefing", scene_layers.REPORT_ORDER)
        report = {**self.report, "briefing": {"objectives": "old", "mapType": "OLD"}}
        top = {"briefing": {"objectives": "new text", "mapType": "ASSAULT MAP",
                            "mapId": "BF1942"}}
        out = scene_layers.merge(report, ["game"], top, {"Conquest": {}})
        self.assertEqual(top["briefing"], out["briefing"])
        # A level with no Menu/Init.con reports no briefing. Like
        # `combatArea: null` on a level with no combat box, the layer still
        # owns the key and writes it null rather than leaving the old value.
        out = scene_layers.merge(report, ["game"], {"briefing": None},
                                 {"Conquest": {}})
        self.assertIsNone(out["briefing"])
        # Patching a layer that does not own it leaves it untouched.
        out = scene_layers.merge(report, ["sounds"], {}, {"Conquest": {}})
        self.assertEqual({"objectives": "old", "mapType": "OLD"}, out["briefing"])

    def test_the_environment_layer_owns_the_terrain_budget(self) -> None:
        # `targetTriCount` (level-content.md Gap 10) rides with the
        # environment layer's con-derived keys: it is read out of
        # `Init/Terrain.con`, so patching `environment` rewrites it and
        # patching anything else leaves it alone.
        self.assertIn("targetTriCount", scene_layers.LAYERS["environment"][0])
        self.assertIn("targetTriCount", scene_layers.REPORT_ORDER)
        report = {**self.report, "targetTriCount": 4000}
        out = scene_layers.merge(report, ["environment"],
                                 {"targetTriCount": 5000}, {"Conquest": {}})
        self.assertEqual(5000, out["targetTriCount"])
        # A level whose Terrain.con declares none writes None rather than
        # leaving a stale value behind.
        out = scene_layers.merge(report, ["environment"],
                                 {"targetTriCount": None}, {"Conquest": {}})
        self.assertIsNone(out["targetTriCount"])
        out = scene_layers.merge(report, ["sounds"], {}, {"Conquest": {}})
        self.assertEqual(4000, out["targetTriCount"])

    def test_control_points_bring_the_spawns_that_read_them(self) -> None:
        self.assertEqual(scene_layers.expand(["controlPoints"]), ["controlPoints", "spawns"])
        self.assertEqual(scene_layers.expand(["ai", "game"]), ["game", "ai"])

    def test_the_placed_flags_of_a_bake_before_the_split(self) -> None:
        report = {"objects": {"placed": 9, "controlPoints": 2},
                  "controlPoints": [{"name": "A", "visible": True},
                                    {"name": "B", "visible": False}],
                  "modes": {"Ctf": {"controlPoints": [{"name": "C", "visible": True}]}}}
        self.assertEqual(scene_layers.placed_from_report(report), {"a", "c"})
        report["objects"]["placedControlPoints"] = ["b"]
        self.assertEqual(scene_layers.placed_from_report(report), {"b"})
        self.assertIsNone(scene_layers.placed_from_report(
            {"objects": {"placed": 0}, "controlPoints": []}))

    def test_compose_keeps_the_extractors_order(self) -> None:
        scene = {"level": "T", "worldSize": 1.0, "terrain": {}, "objects": {},
                 "minimap": {}, "envmap": None}
        top = {k: None for top_keys, _ in scene_layers.LAYERS.values() for k in top_keys}
        out = scene_layers.compose(scene, top, {"Conquest": {"tickets": 1, "gameTypes": []}})
        self.assertEqual(list(out), [k for k in scene_layers.REPORT_ORDER if k in out])
        self.assertEqual(list(out["modes"]["Conquest"]), ["gameTypes", "tickets"])


@unittest.skipIf(_game_dir() is None, "no BF1942 install")
@unittest.skipIf(shutil.which("ffmpeg") is None, "ffmpeg is not installed")
class BakeTests(unittest.TestCase):
    """Two real bakes of one small level (Berlin, ~40 s each, run at once)."""

    @classmethod
    def setUpClass(cls) -> None:
        cls.tmp = Path(tempfile.mkdtemp(prefix="scene-layers-"))
        procs = []
        for side in ("a", "b"):
            procs.append(subprocess.Popen(
                [sys.executable, str(HERE / "extract_map.py"), LEVEL,
                 "--out", str(cls.tmp / side)],
                stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True))
        for proc in procs:
            _out, err = proc.communicate(timeout=900)
            if proc.returncode != 0:
                raise AssertionError(err[-2000:])
        cls.a = cls.tmp / "a"
        cls.level = cls.a / LEVEL.lower()

    @classmethod
    def tearDownClass(cls) -> None:
        shutil.rmtree(cls.tmp, ignore_errors=True)

    def _copy(self, name: str) -> Path:
        dest = self.tmp / name
        shutil.rmtree(dest, ignore_errors=True)
        shutil.copytree(self.a, dest)
        return dest

    def test_two_bakes_are_byte_identical(self) -> None:
        a = {p.relative_to(self.a): p for p in self.a.rglob("*") if p.is_file()}
        b_root = self.tmp / "b"
        b = {p.relative_to(b_root): p for p in b_root.rglob("*") if p.is_file()}
        self.assertEqual(sorted(a), sorted(b))
        self.assertIn(Path(LEVEL.lower()) / "scene.glb", a)
        differ = [str(rel) for rel in a if a[rel].read_bytes() != b[rel].read_bytes()]
        self.assertEqual(differ, [])

    def test_the_glb_carries_no_layer(self) -> None:
        buf = (self.level / "scene.glb").read_bytes()
        length = struct.unpack_from("<I", buf, 12)[0]
        doc = json.loads(buf[20:20 + length])
        self.assertEqual(doc["extras"], {"level": LEVEL})

    def test_every_layer_patched_over_a_bake_changes_nothing(self) -> None:
        import patch_scene
        tree = self._copy("all")
        before = {p: p.read_bytes() for p in tree.rglob("*") if p.is_file()}
        self.assertEqual(patch_scene.main([LEVEL.lower(), "--layer", "all", "--tree", str(tree)]), 0)
        after = {p: p.read_bytes() for p in tree.rglob("*") if p.is_file()}
        self.assertEqual(sorted(before), sorted(after))
        self.assertEqual([str(p) for p in before if before[p] != after[p]], [])

    def test_each_layer_rewrites_stale_keys_to_the_bakes(self) -> None:
        import patch_scene
        baked = (self.level / "scene.json").read_text()
        for name, (top_keys, mode_keys) in scene_layers.LAYERS.items():
            # `lightmaps` writes side files and no scene.json key: nothing to stale.
            if not top_keys and not mode_keys:
                continue
            with self.subTest(name):
                tree = self._copy(f"stale-{name}")
                scene = tree / LEVEL.lower() / "scene.json"
                report = json.loads(baked)
                for key in top_keys:
                    if key in report:
                        report[key] = "stale"
                for entry in report.get("modes", {}).values():
                    for key in mode_keys:
                        entry[key] = "stale"
                scene.write_text(scene_layers.dump(report))
                self.assertNotEqual(scene.read_text(), baked)
                # The dependents come along, so give each layer alone.
                result = patch_scene.patch_level(
                    _game_dir(), "bf1942", scene.parent, [name], tree=tree)
                self.assertTrue(result["written"])
                self.assertEqual(scene.read_text(), baked)

    def test_a_synthetic_control_point_change_reaches_only_its_keys(self) -> None:
        import patch_scene
        from bf42.level import find_level_archives, load_level_files
        game = _game_dir()
        files = load_level_files(find_level_archives(game, "bf1942", LEVEL), LEVEL)
        con = files.read("Conquest/ControlPointTemplates.con").decode("latin-1")
        marker = "ObjectTemplate.create controlpoint AxisBase_1_Cpoint"
        head, tail = con.split(marker, 1)
        changed = tail.replace("ObjectTemplate.timeToGetControl 10",
                               "ObjectTemplate.timeToGetControl 20", 1)
        self.assertNotEqual(changed, tail)
        scratch = scratch_install(
            game, self.tmp / "install", "bf1942", LEVEL,
            {"Conquest/ControlPointTemplates.con": (head + marker + changed).encode("latin-1")})

        root = self.tmp / "pub"
        shutil.rmtree(root, ignore_errors=True)
        shutil.copytree(self.a, root / "maps")
        manifest = self.tmp / "published-maps.json"
        subprocess.run([sys.executable, str(PUBLISHER), "maps", "--root", str(root),
                        "--write-manifest", str(manifest)], check=True, capture_output=True)
        glb_before = (root / "maps" / LEVEL.lower() / "scene.glb").stat()
        scene = root / "maps" / LEVEL.lower() / "scene.json"
        old = json.loads(scene.read_text())
        size_before = scene.stat().st_size

        self.assertEqual(patch_scene.main([LEVEL.lower(), "--layer", "controlPoints",
                                           "--tree", str(root / "maps"),
                                           "--game-dir", str(scratch)]), 0)
        new = json.loads(scene.read_text())
        self.assertEqual(sorted(k for k in old if old[k] != new[k]), ["controlPoints", "modes"])
        axis = [cp for cp in new["controlPoints"] if cp["name"] == "AxisBase_1_Cpoint"]
        self.assertEqual([cp["timeToGetControl"] for cp in axis], [20.0])
        for mode, entry in new["modes"].items():
            moved = [k for k in entry if entry[k] != old["modes"][mode][k]]
            self.assertIn(moved, ([], ["controlPoints"]), mode)
        self.assertEqual(new["modes"]["Conquest"]["controlPoints"], new["controlPoints"])
        # 10.0 -> 20.0: the same length, which a size-only compare cannot see.
        self.assertEqual(scene.stat().st_size, size_before)
        glb_after = (root / "maps" / LEVEL.lower() / "scene.glb").stat()
        self.assertEqual(glb_before.st_mtime_ns, glb_after.st_mtime_ns)

        dry = subprocess.run([sys.executable, str(PUBLISHER), "maps", "--root", str(root),
                              "--remote-manifest", str(manifest), "--list"],
                             check=True, capture_output=True, text=True).stdout
        listed = [line.strip() for line in dry.splitlines() if line.startswith("  ")]
        self.assertEqual(listed, [f"{LEVEL.lower()}/scene.json"], dry)


if __name__ == "__main__":
    unittest.main()
