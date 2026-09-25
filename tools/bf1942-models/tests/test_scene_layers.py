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
                    "combatArea": None} for m in ("Conquest", "Ctf")}
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
