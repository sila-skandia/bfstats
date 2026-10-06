"""`extract_vehicle_sounds.py`: one table of every vehicle sound a mod has.

A round replay shows what the server spawned, not what the level's spawners
place, and `scene.json` `sounds.vehicles` only answers for the second: the
MoonGamers Midway recording's PT boats, their rafts, Kubelwagens, stationary
MG42s and a B17 were all silent. `<tree>/_shared/vehicle-sounds.json` answers
for every vehicle template of the mod. Pinned here:

* which templates are asked: the catalogue's hulls and guns, every template a
  level's spawner names, the hulls those carry on spawners of their own, and
  neither a level's own object nor a pickup kit;
* the Midway extras carry their engines and their guns' FireArms names;
* every sample path is `../_shared/sounds/...` from a level directory and
  lands on a file in the tree;
* a template a level also places has exactly the level's entry, and the
  published table is what the extractor makes now.
"""

from __future__ import annotations

import contextlib
import io
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import extract_vehicle_sounds as evs  # noqa: E402
from bf42.con import ObjectLibrary  # noqa: E402
from extract_models import DEFAULT_GAME_DIR  # noqa: E402

INSTALLED = (DEFAULT_GAME_DIR / "Mods" / "bf1942" / "Archives" / "Objects.rfa").is_file()
MODS = ("bf1942", "XPack1", "XPack2")


def find_maps() -> Path | None:
    """The maps tree holding the published tables: `$BF42_VIEWER_ASSETS`,
    this checkout's (a worktree has none unless linked), or the main
    checkout's, which is the one every worktree shares."""
    candidates: list[Path] = []
    if os.environ.get("BF42_VIEWER_ASSETS"):
        candidates.append(Path(os.environ["BF42_VIEWER_ASSETS"]))
    candidates.append(ROOT / "viewer")
    try:
        common = subprocess.run(
            ["git", "rev-parse", "--path-format=absolute", "--git-common-dir"],
            cwd=ROOT, capture_output=True, text=True, timeout=10).stdout.strip()
        if common:
            candidates.append(Path(common).parent / "tools" / "bf1942-models" / "viewer")
    except (OSError, subprocess.SubprocessError):
        pass
    for c in candidates:
        if (c / "maps" / "_shared" / evs.TABLE_NAME).is_file():
            return c / "maps"
    return None


MAPS = find_maps()


def stub_writer(resolved: tuple[str, bytes]) -> str:
    """The path `sample_writer` gives an mp3 from a level directory, with no
    transcode: the table's JSON without touching a file."""
    return f"../_shared/sounds/{Path(resolved[0]).stem}.mp3"


def entry_files(entry: dict) -> list[str]:
    """Every sample an entry names: the engine's, its guns' and their edges,
    and its parts' patches."""
    layers = list(entry["layers"])
    for weapon in entry.get("weapons") or []:
        layers += weapon["layers"] + (weapon.get("press") or []) + (weapon.get("reload") or [])
        for edge in (weapon.get("release") or {}).values():
            layers += edge
    for part in entry.get("parts") or []:
        for patch in part["patches"]:
            layers += patch
    return [layer["file"] for layer in layers]


def as_level_entry(entry: dict) -> str:
    """An entry keyed the way the viewer matches it: `template` case-folded
    (a level writes its spawner's spelling, `sherman`; the table the
    declared one, `Sherman`)."""
    return json.dumps(dict(entry, template=entry["template"].lower()), sort_keys=True)


class LevelRelativeWriterTests(unittest.TestCase):
    def test_a_sample_lands_in_the_tree_and_is_named_from_a_level(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            tree = Path(tmp)
            write = evs.level_relative_writer(tree, audio_format="wav")
            rel = write(("Elco80_Engine.wav", b"RIFF"))
            self.assertEqual(rel, "../_shared/sounds/Elco80_Engine.wav")
            self.assertEqual((tree / "_shared" / "sounds" / "Elco80_Engine.wav").read_bytes(), b"RIFF")
            # Resolved from any level directory, as `getBuffer(levelDir, rel)` does.
            self.assertTrue((tree / "midway" / rel).resolve().is_file())


LIBRARY = {
    "Objects/Vehicles/Land/Sherman/Objects.con": """
ObjectTemplate.create PlayerControlObject Sherman
ObjectTemplate.addTemplate ShermanEngine
ObjectTemplate.addTemplate ShermanTurret
ObjectTemplate.create Engine ShermanEngine
ObjectTemplate.create PlayerControlObject ShermanTurret
""",
    "Objects/Vehicles/Sea/fletcher/Objects.con": """
ObjectTemplate.create PlayerControlObject Fletcher
ObjectTemplate.create PlayerControlObject Fletcher2
""",
    "Objects/Vehicles/Sea/Hatsuzuki/Objects.con": """
ObjectTemplate.create PlayerControlObject Hatsuzuki
ObjectTemplate.addTemplate HatsuzukiDaihatsuSpawner
ObjectTemplate.create ObjectSpawner HatsuzukiDaihatsuSpawner
ObjectTemplate.setObjectTemplate 1 Daihatsu
ObjectTemplate.setObjectTemplate 2 Daihatsu
ObjectTemplate.create PlayerControlObject Daihatsu
""",
    "Objects/Stationary_Weapons/Stationary_MG42/Objects.con": """
ObjectTemplate.create PlayerControlObject Stationary_mg42
""",
    "Objects/Misc/SupplyTruck/Trucks.con": """
ObjectTemplate.create PlayerControlObject SupplyTruck
""",
    "Objects/Soldiers/USSoldier/Objects.con": """
ObjectTemplate.create BFSoldier USSoldier
""",
    "Objects/HandWeapons/K98/Objects.con": """
ObjectTemplate.create HandFireArms K98
""",
    "Objects/Items/GerEliteKit/Scout/Objects.con": """
ObjectTemplate.create Kit GermanElite_Scout
ObjectTemplate.addTemplate EliteKnifeStab
ObjectTemplate.create FireArms EliteKnifeStab
""",
}


class VehicleTemplateTests(unittest.TestCase):
    def setUp(self) -> None:
        self.library = ObjectLibrary()
        for path, text in LIBRARY.items():
            self.library.add_con(path, text)
        # `fletcher2` is named by a spawner the way Midway names it, `supplytruck`
        # from outside every catalogue folder, `pak40` is a level's own object,
        # and `germanelite_scout` a pickup kit an XPack2 spawner lays down.
        self.names = evs.vehicle_templates(
            None, self.library, {"fletcher2", "supplytruck", "pak40", "germanelite_scout"})

    def test_the_hulls_a_round_can_field_by_their_declared_names(self) -> None:
        self.assertEqual(self.names, ["Daihatsu", "Fletcher", "Fletcher2", "Hatsuzuki",
                                      "Sherman", "Stationary_mg42", "SupplyTruck"])

    def test_a_seat_a_soldier_a_kit_and_a_hand_weapon_are_not_hulls(self) -> None:
        for name in ("ShermanTurret", "ShermanEngine", "USSoldier", "K98",
                     "HatsuzukiDaihatsuSpawner", "GermanElite_Scout", "EliteKnifeStab"):
            self.assertNotIn(name, self.names)

    def test_a_level_object_is_left_to_its_level(self) -> None:
        self.assertNotIn("pak40", [n.lower() for n in self.names])


class RebuildHookTests(unittest.TestCase):
    """The table is rebuilt wherever the levels' sounds are: once per
    `patch_scene.py --layer sounds` run and once per `extract_maps_all.py`."""

    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.tree = Path(self._tmp.name)
        self.result = {"path": self.tree / "_shared" / evs.TABLE_NAME,
                       "table": {"mod": "bf1942", "vehicles": []}, "changed": False,
                       "written": False, "asked": [], "silent": [], "new_samples": []}

    def tearDown(self) -> None:
        self._tmp.cleanup()

    def test_a_patch_refreshes_a_table_the_tree_has(self) -> None:
        import patch_scene
        (self.tree / "_shared").mkdir()
        (self.tree / "_shared" / evs.TABLE_NAME).write_text("{}")
        out = io.StringIO()
        with mock.patch.object(evs, "write_table", return_value=self.result) as write, \
                contextlib.redirect_stdout(out):
            rc = patch_scene.refresh_vehicle_sounds(
                Path("/game"), "XPack1", self.tree, dry_run=True)
        self.assertEqual(rc, 0)
        write.assert_called_once_with(Path("/game"), "XPack1", self.tree,
                                      shared_sounds=None, audio_format="mp3", dry_run=True)
        self.assertIn(f"{evs.TABLE_NAME} (unchanged)", out.getvalue())

    def test_a_patch_never_adds_one(self) -> None:
        # A scratch bake (`test_scene_layers.py`) patched with `--layer all`
        # must come out with exactly the files it went in with.
        import patch_scene
        with mock.patch.object(evs, "write_table") as write:
            self.assertEqual(patch_scene.refresh_vehicle_sounds(
                Path("/game"), "bf1942", self.tree), 0)
        write.assert_not_called()

    def test_a_failed_table_fails_the_patch_run_but_not_a_bake(self) -> None:
        import extract_maps_all
        import patch_scene
        (self.tree / "_shared").mkdir()
        (self.tree / "_shared" / evs.TABLE_NAME).write_text("{}")
        with mock.patch.object(evs, "write_table", side_effect=RuntimeError("no ffmpeg")), \
                mock.patch("sys.stderr"):
            self.assertEqual(patch_scene.refresh_vehicle_sounds(
                Path("/game"), "bf1942", self.tree), 1)
            self.assertFalse(extract_maps_all.write_vehicle_sounds(
                Path("/game"), "bf1942", self.tree, self.tree / "_shared" / "sounds", "mp3"))


@unittest.skipUnless(INSTALLED, "no BF1942 install")
class VanillaTableTests(unittest.TestCase):
    """The vanilla table as the extractor makes it now (no sample written)."""

    @classmethod
    def setUpClass(cls) -> None:
        cls.sources = evs.load_sources(DEFAULT_GAME_DIR, "bf1942")
        cls.table, cls.asked = evs.build_table(cls.sources, stub_writer)
        cls.by_name = {v["template"].lower(): v for v in cls.table["vehicles"]}

    def entry(self, name: str) -> dict:
        self.assertIn(name.lower(), self.by_name, f"{name} has no entry")
        return self.by_name[name.lower()]

    def guns(self, name: str) -> list[str]:
        return [w["fireArms"] for w in self.entry(name).get("weapons") or []]

    def test_the_midway_recordings_extras_have_their_engines(self) -> None:
        for template, engine in (("Elco80", "Elco80_Engine"), ("Type38", "Type38_Engine"),
                                 ("Elco80Raft", "PTRaft_Engine"),
                                 ("Type38Raft", "Type38Raft_Engine"),
                                 ("Kubelwagen", "KubelwagenEngine"), ("B17", "B17_Engine1")):
            with self.subTest(template):
                entry = self.entry(template)
                self.assertEqual(entry["engine"], engine)
                self.assertTrue(entry["layers"])
                self.assertEqual(entry["template"], template)

    def test_and_their_guns(self) -> None:
        self.assertEqual(self.guns("Elco80"),
                         ["Elco80_Torpedos", "FloatingMineLauncher", "Elco80_SideGunner"])
        self.assertEqual(self.guns("Type38"),
                         ["Type38_Torpedos", "FloatingMineLauncher", "Type38_Oerlikon"])
        # The rack's sound is its projectile's `Bomb.ssc` (G-5), under the rack's name.
        self.assertEqual(self.guns("B17"), ["B17BombRack", "B17_MG1_FB", "B17_MG2_FB"])
        # A fixed gun has no drivetrain: an entry with no engine, its gun filled.
        mg = self.entry("Stationary_mg42")
        self.assertEqual((mg["engine"], mg["script"], mg["layers"]), (None, None, []))
        self.assertEqual(self.guns("Stationary_mg42"), ["MG42_unlimited"])
        for unarmed in ("Elco80Raft", "Type38Raft", "Kubelwagen"):
            self.assertNotIn("weapons", self.entry(unarmed))

    def test_every_entry_is_a_scene_json_entry(self) -> None:
        self.assertEqual(self.table["mod"], "bf1942")
        keys = {"template", "engine", "script", "level", "layers", "attachToListener", "weapons",
                "parts"}
        for entry in self.table["vehicles"]:
            with self.subTest(entry["template"]):
                self.assertLessEqual(set(entry), keys)
                self.assertEqual(entry["level"], "high")
                for path in entry_files(entry):
                    self.assertTrue(path.startswith("../_shared/sounds/"), path)

    def test_the_templates_keep_their_declared_names(self) -> None:
        names = [v["template"] for v in self.table["vehicles"]]
        self.assertIn("Sherman", names)
        self.assertIn("flak38", names)
        self.assertEqual(names, sorted(names, key=str.lower))

    def test_a_levels_own_objects_are_its_own(self) -> None:
        # Battle of Britain's Ju88A, Coral Sea's carriers, Caen's Pak40.
        for name in ("Ju88A", "Hiryu", "Hornet", "PAK40", "CDNRaft"):
            self.assertNotIn(name.lower(), self.by_name)


@unittest.skipUnless(INSTALLED, "no BF1942 install")
@unittest.skipIf(MAPS is None, "no published maps tree with a vehicle-sounds.json")
class PublishedTableTests(unittest.TestCase):
    """The tables in the shared maps tree."""

    def tree(self, mod: str) -> Path:
        return evs.tree_for(MAPS, mod)

    def published(self, mod: str) -> dict:
        path = self.tree(mod) / "_shared" / evs.TABLE_NAME
        if not path.is_file():
            self.skipTest(f"no {path}")
        return json.loads(path.read_text())

    def test_every_sample_is_level_relative_and_in_the_tree(self) -> None:
        for mod in MODS:
            with self.subTest(mod):
                table = self.published(mod)
                self.assertEqual(table["mod"], mod)
                level = self.tree(mod) / "any_level"
                missing = [path for entry in table["vehicles"] for path in entry_files(entry)
                           if not path.startswith("../_shared/sounds/")
                           or not (level / path).resolve().is_file()]
                self.assertEqual(missing, [])

    def test_the_published_tables_are_what_the_extractor_makes_now(self) -> None:
        for mod in MODS:
            with self.subTest(mod):
                published = self.published(mod)
                fresh, _asked = evs.build_table(
                    evs.load_sources(DEFAULT_GAME_DIR, mod), stub_writer)
                self.assertEqual(evs.dump(fresh), evs.dump(published))

    def test_a_template_midway_places_has_midways_entry(self) -> None:
        scene = MAPS / "midway" / "scene.json"
        if not scene.is_file():
            self.skipTest(f"no {scene}")
        level = json.loads(scene.read_text())["sounds"]["vehicles"]
        table = {v["template"].lower(): v for v in self.published("bf1942")["vehicles"]}
        compared = []
        for entry in level:
            key = entry["template"].lower()
            with self.subTest(entry["template"]):
                # Midway declares no vehicle of its own: every one is global.
                self.assertIn(key, table)
                self.assertEqual(as_level_entry(entry), as_level_entry(table[key]))
                compared.append(key)
        self.assertIn("zero", compared)
        self.assertIn("sherman", compared)


if __name__ == "__main__":
    unittest.main()
