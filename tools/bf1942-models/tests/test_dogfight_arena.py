"""The dogfight arenas (features/dogfight-school, "The school's own page"):
the battles the school's own page flies its lessons in, read from the model
catalogue, and the address that puts you in one.

`dogfight_arena_harness.mjs` runs `viewer/dogfight-arena.js` over a small
catalogue of its own.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import unittest
from pathlib import Path

HARNESS = Path(__file__).resolve().parent / "dogfight_arena_harness.mjs"


def run_harness() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    proc = subprocess.run(["node", str(HARNESS)], capture_output=True, text=True, timeout=120)
    if proc.returncode != 0:
        raise AssertionError(f"dogfight arena harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


class ArenaTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.out = run_harness()

    def test_one_arena_per_pair_of_fighters_with_both_sides(self) -> None:
        arenas = {a["map"]: a for a in self.out["arenas"]}
        # El Alamein's Spitfire v Bf 109 is Battle of Britain's; Midway has
        # no Axis fighter; Kursk is its own.
        self.assertEqual(list(arenas), ["Battle_of_Britain", "Kursk"])
        self.assertEqual((arenas["Battle_of_Britain"]["allied"], arenas["Battle_of_Britain"]["axis"]), (["Spitfire"], ["BF109"]))
        self.assertEqual((arenas["Kursk"]["allied"], arenas["Kursk"]["axis"]), (["Yak9"], ["BF109"]))

    def test_an_arena_flies_its_bombers_too_but_not_a_plane_both_sides_fly(self) -> None:
        planes = {a["map"]: a["planes"] for a in self.out["arenas"]}
        self.assertIn("Ju88A", planes["Battle_of_Britain"])
        self.assertIn("Ilyushin", planes["Kursk"])
        self.assertNotIn("B17", planes["Battle_of_Britain"])
        self.assertNotIn("T34", planes["Kursk"])

    def test_your_plane_and_the_ace_on_the_other_side(self) -> None:
        self.assertEqual(self.out["planeIn"], {"chosen": "BF109", "missing": "Spitfire"})
        self.assertEqual(self.out["ace"], {"againstAxis": "Spitfire", "againstAllied": "BF109"})

    def test_a_lesson_draws_you_on_your_sides_fighter(self) -> None:
        # The pair lesson drew a Stuka picked in the chooser, flying a Bf 109's
        # moves with its rear gun silent: a lesson draws a fighter.
        self.assertEqual(self.out["lessonPlane"], {
            "Battle_of_Britain:Ju88A": "BF109", "Battle_of_Britain:BF109": "BF109", "Battle_of_Britain:Spitfire": "Spitfire",
            "Kursk:Ilyushin": "Yak9", "Kursk:Yak9": "Yak9"})

    def test_the_address_is_the_range_as_an_arena(self) -> None:
        q = self.out["url"]
        self.assertEqual(self.out["path"], "/map.html")
        self.assertEqual((q["proving"], q["map"], q["team"], q["botCount"], q["spawn"], q["arena"]),
                         ("1", "Kursk", "1", "1", "FiringLine", "dogfight"))
        self.assertEqual((q["dogfight"], q["move"]), ("boom-and-zoom", "dip-1"))


    def test_a_mod_whose_teams_change_by_level_pairs_by_its_spawners(self) -> None:
        # BF1918 (features/dogfight-doctrine): one arena per pair of fighter
        # sets, team 1 flying as the construct's team 1; the two-seaters
        # and bombers are no fighters; a level the tree lacks is no arena.
        arenas = {a["map"]: a for a in self.out["teams"]}
        self.assertEqual(sorted(arenas), ["Montfaucon", "battle_of_the_vosges"])
        self.assertEqual((arenas["Montfaucon"]["allied"], arenas["Montfaucon"]["axis"]), (["Sopwith"], ["FokkerRed"]))
        self.assertIn("Breguet14", arenas["Montfaucon"]["planes"])
        self.assertEqual((arenas["battle_of_the_vosges"]["allied"], arenas["battle_of_the_vosges"]["axis"]), (["Spad7"], ["Fokker"]))

    def test_the_wwi_scouts_are_fighters_and_the_two_seaters_are_not(self) -> None:
        r = self.out["ranks"]
        for scout in ("Spad7", "FokkerRed", "Sopwith", "Albatross", "se5"):
            self.assertLess(r[scout], 100, scout)
        for other in ("AlbatrossC3", "AircoDH4_Brit", "Gotha"):
            self.assertEqual(900, r[other], other)
        self.assertEqual(0, r["Spitfire"])
        self.assertLess(r["Spad7"], r["se5"])


    def test_the_jets_are_fighters_and_a_helicopter_stays_on_the_ground(self) -> None:
        # Desert Combat (features/dogfight-doctrine-1991): its jets pair,
        # the attack planes fly but are no fighters, the gunships are left
        # out, and its own battle stands for the pair before a borrowed one.
        r = self.out["ranks"]
        for jet in ("F16", "Mig29", "F-15C", "Mirage", "F-14B", "AV-8H"):
            self.assertLess(r[jet], 100, jet)
        for other in ("A10_B", "SU-25"):
            self.assertEqual(100, r[other], other)
        for heli in ("AH64", "Mi24D", "UH-60Q", "SA-342G", "MH-6", "Mi8"):
            self.assertEqual(900, r[heli], heli)
        # The propeller names still come first: a jet's name never takes one.
        self.assertEqual((1, 0), (r["BF109"], r["Spitfire"]))
        self.assertEqual(100, r["Mitsubishi"])
        self.assertLess(r["BF109"], r["F16"])
        rot = self.out["rotary"]
        self.assertTrue(all(rot[n] for n in ("AH64", "Mi24D", "UH-60Q", "SA-342G", "MH-500", "OH-6", "Mi8")))
        self.assertFalse(any(rot[n] for n in ("F16", "Mig29", "Mirage", "Mitsubishi", "Mosquito")))
        arenas = self.out["jets"]
        self.assertEqual(["DC_DesertShield", "Bocage"], [a["map"] for a in arenas])
        shield = arenas[0]
        self.assertEqual(("Desert Shield", ["F16"], ["Mig29"]), (shield["name"], shield["allied"], shield["axis"]))
        self.assertEqual(["F16", "Mig29", "A10_B", "SU-25"], shield["planes"])
        self.assertEqual((["F-15C", "AV-8B"], ["Mig29"]), (arenas[1]["allied"], arenas[1]["axis"]))

    def test_a_jet_is_named_by_its_designation(self) -> None:
        self.assertEqual({"F16": "F-16", "Mig29": "MiG-29", "F-15C": "F-15C", "F-14B": "F-14B", "SU-25": "Su-25",
                          "A10_B": "A-10", "AV-8H": "AV-8", "Mirage": None, "Spitfire": None, "BF109": None},
                         self.out["jetNames"])


class ArenaIndexTests(unittest.TestCase):
    """`extract_dogfight_arenas.py`: each level's aircraft by team, from its
    object spawners, in the catalogue's own spelling."""

    def test_the_index_names_each_teams_aircraft(self) -> None:
        import json
        import sys
        import tempfile
        sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
        import extract_dogfight_arenas as E
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            maps, models = root / "maps" / "mods" / "bf1918", root / "models" / "mods" / "bf1918"
            models.mkdir(parents=True)
            (models / "models.json").write_text(json.dumps([
                {"name": "FokkerRed", "category": "air"}, {"name": "Sopwith", "category": "air"},
                {"name": "Spad7", "category": "air"}, {"name": "MarkV", "category": "land"}]))
            for level, spawns in {
                "montfaucon": [{"templates": {"1": "fokkerred", "2": "sopwith"}}, {"templates": {"1": "markv", "2": "markv"}}],
                "one_sided": [{"templates": {"1": "fokkerred"}}],
            }.items():
                (maps / level).mkdir(parents=True)
                (maps / level / "scene.json").write_text(json.dumps({"objectSpawns": spawns}))
            self.assertEqual(models.resolve(), E.models_tree_for(maps))
            out = E.build(maps, models)
        self.assertEqual({"version": 1, "levels": {"montfaucon": {"1": ["FokkerRed"], "2": ["Sopwith"]}}}, out)

    def test_a_pad_with_one_template_for_both_teams_is_its_own_teams(self) -> None:
        # Desert Combat lays out every jet this way: `f16spawner` names the
        # F-16 for both teams and carries no `templates`; the pad's own team
        # fields it. A pad placed for neither team is nobody's.
        import sys
        sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
        import extract_dogfight_arenas as E
        air = {"f16": "F16", "mig29": "Mig29", "mi8": "Mi8", "uh-60q": "UH-60Q"}
        scene = {"objectSpawns": [
            {"spawner": "f16spawner", "vehicle": "f16", "team": 2},
            {"spawner": "mig29spawner", "vehicle": "mig29", "team": 1},
            {"spawner": "neutral", "vehicle": "f16", "team": 0},
            {"spawner": "tanks", "vehicle": "t72", "team": 1},
            {"spawner": "evacspawner", "vehicle": "mi8", "team": 1, "templates": {"1": "mi8", "2": "UH-60Q"}},
        ]}
        self.assertEqual({"1": ["Mi8", "Mig29"], "2": ["F16", "UH-60Q"]}, E.level_teams(scene, air))
        import tempfile
        with tempfile.TemporaryDirectory() as tmp:
            tree = Path(tmp)
            (tree / "models.json").write_text(json.dumps([{"name": n, "category": "air"} for n in air.values()]))
            out = E.build(tree, tree, {"dc_no_fly_zone": scene, "empty": {"objectSpawns": []}})
        self.assertEqual(["dc_no_fly_zone"], list(out["levels"]))


if __name__ == "__main__":
    unittest.main()
