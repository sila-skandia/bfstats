"""`extract_pose.py --kit-poses`: one pose per (soldier, kit) a level binds."""

from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import extract_models  # noqa: E402
from bf42 import kit as kit_mod  # noqa: E402
from bf42.con import ObjectLibrary  # noqa: E402
from bf42.kit import TeamLoadout  # noqa: E402
from extract_models import add_level_objects, add_level_textures  # noqa: E402
from extract_pose import (kit_item_pairs, kit_pose_plan, kit_poses_exit,  # noqa: E402
                          level_weapon_host, never_animated, merge_level_gaits, merge_matrix,
                          resolve_kit_poses, write_pose_index)


class _Machine:
    """The one question the plan asks of the animation state machine."""

    def __init__(self, weapons: list[str]) -> None:
        self._weapons = weapons

    def weapons(self, _family: str) -> list[str]:
        return list(self._weapons)


class KitPosePlanTests(unittest.TestCase):
    def library(self) -> ObjectLibrary:
        library = ObjectLibrary()
        library.add_con("Objects/Soldiers/IraqSoldier/Objects.con",
                        "ObjectTemplate.create BFSoldier IraqSoldier\n")
        library.add_con("Objects/Items/IraqKit/Assault/Objects.con", """
ObjectTemplate.create Kit Iraq_Assault
ObjectTemplate.addTemplate Makarov
ObjectTemplate.addTemplate AK47

ObjectTemplate.create Kit Iraq_Assault_CHUTE
ObjectTemplate.addTemplate Makarov
ObjectTemplate.addTemplate AK47

ObjectTemplate.create Kit Iraq_Unbound
ObjectTemplate.addTemplate RPG7

ObjectTemplate.create Kit Iraq_Spotter
ObjectTemplate.addTemplate Binoculars
""")
        for name, index in (("AK47", 3), ("Makarov", 2), ("RPG7", 3), ("Binoculars", 5)):
            library.add_con(f"Objects/HandWeapons/{name}/Objects.con",
                            f"ObjectTemplate.create HandFireArms {name}\n"
                            f"ObjectTemplate.itemIndex {index}\n")
        return library

    def plan(self, loadouts: dict):
        with mock.patch.object(kit_mod, "level_loadouts", return_value=loadouts):
            return kit_pose_plan(self.library(), _Machine(["AK47", "Makarov", "RPG7"]), [])

    def test_one_job_per_soldier_and_set_of_candidates(self) -> None:
        jobs, notes = self.plan({
            "DC_Gazala": {1: TeamLoadout("IraqSoldier", {0: "Iraq_Assault", 1: "Iraq_Spotter"}),
                          2: TeamLoadout("Iraq_Assault", {0: "Iraq_Assault"})},
            # Another level spells the skin its own way and drops the team in by parachute.
            "DC_Airborne": {1: TeamLoadout("iraqsoldier", {0: "Iraq_Assault_CHUTE"})},
        })

        # The spawn weapon first, though the kit declares the pistol before it;
        # the parachute twin is the same job, and the skin is the template's spelling.
        self.assertEqual({("IraqSoldier", ("AK47", "Makarov")): ["Iraq_Assault", "Iraq_Assault_CHUTE"]},
                         jobs)
        self.assertEqual(["Iraq_Spotter"], notes["unposableKits"])
        # A team skin that is no soldier (here a kit's name) is reported, not posed.
        self.assertEqual(["Iraq_Assault"], notes["unknownSoldiers"])

    def test_a_kit_no_level_binds_is_not_planned(self) -> None:
        jobs, _ = self.plan({"DC_Gazala": {1: TeamLoadout("IraqSoldier", {0: "Iraq_Assault"})}})
        self.assertNotIn("Iraq_Unbound", [kit for kits in jobs.values() for kit in kits])


class RandomKitPosePlanTests(unittest.TestCase):
    """A kit whose spawn weapon is rolled (ledger KIT-1) is seen holding each
    variant, so each is a job: FHSW's British tank commander with a No2 or a
    Sten. The bundle itself names no animation state and is never posed."""

    def test_each_variant_of_a_rolled_primary_is_a_job(self) -> None:
        library = ObjectLibrary()
        library.add_con("Objects/Soldiers/French/Objects.con",
                        "ObjectTemplate.create BFSoldier FrenchSoldier\n")
        library.add_con("Objects/Items/BritKit/Tanker/Objects.con", """
ObjectTemplate.create Kit 5GB_TankCommander
ObjectTemplate.addTemplate RandomGBTankcommander
ObjectTemplate.setRandomGeometries 2
ObjectTemplate.addTemplate KnifeAllies
""")
        for name, index in (("RandomGBTankcommander1", 3), ("RandomGBTankcommander2", 3),
                            ("KnifeAllies", 1)):
            library.add_con(f"Objects/HandWeapons/{name}/Objects.con",
                            f"ObjectTemplate.create HandFireArms {name}\n"
                            f"ObjectTemplate.itemIndex {index}\n")
        machine = _Machine(["RandomGBTankcommander1", "RandomGBTankcommander2", "KnifeAllies"])
        loadouts = {"Counterattack-1950": {2: TeamLoadout("frenchsoldier",
                                                          {4: "5GB_TankCommander"})}}
        with mock.patch.object(kit_mod, "level_loadouts", return_value=loadouts):
            jobs, notes = kit_pose_plan(library, machine, [])
        self.assertEqual({
            ("FrenchSoldier", ("RandomGBTankcommander1", "KnifeAllies")): ["5GB_TankCommander"],
            ("FrenchSoldier", ("RandomGBTankcommander2", "KnifeAllies")): ["5GB_TankCommander"],
        }, jobs)
        self.assertEqual([], notes["unposableKits"])


class PoseIndexTests(unittest.TestCase):
    """`poses/index.json`: every pose a tree holds, by kind, from the files."""

    def test_the_index_lists_recipes_and_glbs_by_their_own_stems(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp)
            for name in ("GermanSoldier__MP40.pose.glb", "FrenchSoldier__Mas36.pose.glb",
                         "USSoldier__K98.pose.json", "USSoldier__K98.pose.glb",
                         "USSoldier__K98.pose.report.json", "poses-matrix.json"):
                (out / name).write_text("{}")
            index = write_pose_index(out)
            written = json.loads((out / "index.json").read_text())
        self.assertEqual(index, written)
        self.assertEqual("bf1942-pose-index/1", written["format"])
        self.assertEqual(["USSoldier__K98"], written["recipe"])
        self.assertEqual(["FrenchSoldier__Mas36", "GermanSoldier__MP40", "USSoldier__K98"],
                         written["glb"])


class ResolveKitPosesTests(unittest.TestCase):
    @staticmethod
    def exporter(failing: set[str], log: list):
        def export(pairs):
            log.append(list(pairs))
            return [{"soldier": soldier, "weapon": weapon,
                     **({"error": "upper clip unreadable"} if weapon in failing else {})}
                    for soldier, weapon in pairs]
        return export

    def test_a_job_whose_first_candidate_fails_takes_the_next_in_a_later_round(self) -> None:
        spotter = ("RussianSoldier", ("SmokeGren_RDG2", "TT33"))
        assault = ("RussianSoldier", ("PPSh41",))
        log: list = []

        chosen, rows = resolve_kit_poses({spotter: ["Rus_Spotter"], assault: ["Rus_Assault"]},
                                         self.exporter({"SmokeGren_RDG2"}, log))

        self.assertEqual({spotter: "TT33", assault: "PPSh41"}, chosen)
        self.assertEqual([[("RussianSoldier", "SmokeGren_RDG2"), ("RussianSoldier", "PPSh41")],
                          [("RussianSoldier", "TT33")]], log)
        self.assertIn("error", rows[("russiansoldier", "smokegren_rdg2")])

    def test_a_pair_is_exported_once_across_jobs_and_rounds(self) -> None:
        first = ("USSoldier", ("M16", "Colt"))
        second = ("USSoldier", ("Colt",))
        log: list = []

        chosen, _ = resolve_kit_poses({first: ["US_Rifleman"], second: ["US_Pilot"]},
                                      self.exporter({"M16"}, log))

        self.assertEqual({first: "Colt", second: "Colt"}, chosen)
        # Colt went out in the first round for the pilot; the rifleman's fallback reuses it.
        self.assertEqual([[("USSoldier", "M16"), ("USSoldier", "Colt")]], log)

    def test_a_job_none_of_whose_candidates_poses_resolves_to_none(self) -> None:
        job = ("USSoldier", ("Flare", "Smoke"))
        chosen, _ = resolve_kit_poses({job: ["US_Marker"]}, self.exporter({"Flare", "Smoke"}, []))
        self.assertEqual({job: None}, chosen)


class LevelWeaponPoseTests(unittest.TestCase):
    """A weapon only a level declares is posed through that level's load.

    203 Hill's Japanese spawn holding `Arisaka30`, declared by the level's own
    `objects/Arisaka/` and given states only by its `animations/`. The plan
    skipped it as unposable and posed the kit's bayonet knife, and the bots,
    finding no `JapaneseSoldier__Arisaka30`, held the Colt (2026-10-15)."""

    @staticmethod
    def library() -> ObjectLibrary:
        library = ObjectLibrary()
        library.add_con("Objects/Soldiers/Japanese/Objects.con",
                        "ObjectTemplate.create BFSoldier JapaneseSoldier\n")
        library.add_con("bf1942/levels/203_hill-1904/objects/JapKit/Objects.con", """
ObjectTemplate.create Kit 2Jap_AssaultArisaka38nichiro
ObjectTemplate.addTemplate Arisaka30
ObjectTemplate.addTemplate GrenadeRJ
ObjectTemplate.addTemplate Knife_Type30Bayonet_ID2
""")
        for source, name, index in (
                ("bf1942/levels/203_hill-1904/objects/Arisaka", "Arisaka30", 3),
                ("bf1942/levels/203_hill-1904/objects/Grenade97", "GrenadeRJ", 4),
                ("Objects/HandWeapons/!_PACK_COMMON", "Knife_Type30Bayonet_ID2", 1),
                ("Objects/HandWeapons/Arisaka38", "Arisaka38", 3)):
            library.add_con(f"{source}/Objects.con",
                            f"ObjectTemplate.create HandFireArms {name}\n"
                            f"ObjectTemplate.itemIndex {index}\n")
        return library

    LOADOUTS = {"203_hill-1904": {2: TeamLoadout("JapaneseSoldier",
                                                {0: "2Jap_AssaultArisaka38nichiro"})}}

    def host(self, library, declared):
        return lambda levels, weapon: level_weapon_host(
            levels, weapon, library, lambda level: declared.get(level.lower(), set()))

    def test_the_spawn_weapon_a_level_declares_leads_the_job(self) -> None:
        library = self.library()
        host = self.host(library, {"203_hill-1904": {"arisaka30", "grenaderj"}})
        with mock.patch.object(kit_mod, "level_loadouts", return_value=self.LOADOUTS):
            jobs, notes = kit_pose_plan(library, _Machine(["Knife_Type30Bayonet_ID2"]), [],
                                        level_host=host)
        self.assertEqual({("JapaneseSoldier", ("Arisaka30", "GrenadeRJ",
                                               "Knife_Type30Bayonet_ID2")):
                          ["2Jap_AssaultArisaka38nichiro"]}, jobs)
        self.assertEqual({("japanesesoldier", "arisaka30"): "203_hill-1904",
                          ("japanesesoldier", "grenaderj"): "203_hill-1904"}, notes["hosts"])

    def test_without_a_host_the_plan_is_what_it_was(self) -> None:
        with mock.patch.object(kit_mod, "level_loadouts", return_value=self.LOADOUTS):
            jobs, notes = kit_pose_plan(self.library(), _Machine(["Knife_Type30Bayonet_ID2"]), [])
        self.assertEqual([("JapaneseSoldier", ("Knife_Type30Bayonet_ID2",))], list(jobs))
        self.assertEqual({}, notes["hosts"])

    def test_a_host_is_a_handing_out_level_that_declares_it(self) -> None:
        library = self.library()
        declared = {"203_hill-1904": {"arisaka30"}, "aaa_other": set(),
                    "zz_exported": {"arisaka30"}}
        by = lambda level: declared[level]  # noqa: E731
        # The chain declares Arisaka38: no level hosts it.
        self.assertIsNone(level_weapon_host(["203_hill-1904"], "Arisaka38", library, by))
        # Name order, among the levels that hand it out and declare it ...
        self.assertEqual("203_hill-1904", level_weapon_host(
            ["zz_exported", "aaa_other", "203_hill-1904"], "Arisaka30", library, by))
        # ... the exported ones first.
        self.assertEqual("zz_exported", level_weapon_host(
            ["zz_exported", "203_hill-1904"], "Arisaka30", library, by, {"zz_exported"}))
        self.assertIsNone(level_weapon_host(["aaa_other"], "Arisaka30", library, by))

    def test_every_item_of_an_exported_level_is_a_pair(self) -> None:
        # The player's third person switches through the kit: SVT40Bay, the
        # bayonet knife and RDG33 on Doomed_Budapest had no pose to switch to.
        library = self.library()
        kits = {"kits": [
            {"template": "2Jap_AssaultArisaka38nichiro", "levels": ["203_hill-1904"],
             "soldiers": ["JapaneseSoldier"],
             "items": [{"template": "Arisaka30"}, {"template": "GrenadeRJ"},
                       {"template": "Knife_Type30Bayonet_ID2"}, {"template": "scoldID7"}]},
            {"template": "Unexported", "levels": ["elsewhere"],
             "soldiers": ["JapaneseSoldier"], "items": [{"template": "Arisaka38"}]}]}
        posable = {"knife_type30bayonet_id2": "Knife_Type30Bayonet_ID2",
                   "arisaka38": "Arisaka38"}
        host = self.host(library, {"203_hill-1904": {"arisaka30"}})
        pairs, hosts = kit_item_pairs(kits, {"203_hill-1904"}, library, posable, host)
        # GrenadeRJ: declared by the level's archive (in this library) but not
        # by its load here, so nothing poses it; scoldID7 is no weapon at all.
        self.assertEqual([("JapaneseSoldier", "Arisaka30"),
                          ("JapaneseSoldier", "Knife_Type30Bayonet_ID2")], pairs)
        self.assertEqual({("japanesesoldier", "arisaka30"): "203_hill-1904"}, hosts)

    def test_a_dropped_kit_s_weapon_is_posed_on_the_other_side_s_soldier(self) -> None:
        # KITDROP-6: a Russian on 203 Hill can pick up a Japanese kit, and the
        # bots and the chase view draw his own body holding its rifle.
        library = self.library()
        library.add_con("Objects/Soldiers/RussianSoldier/Objects.con",
                        "ObjectTemplate.create BFSoldier RussianSoldier\n")
        kits = {"kits": [
            {"template": "2Jap_Assault", "levels": ["203_hill-1904"],
             "soldiers": ["JapaneseSoldier"], "items": [{"template": "Arisaka38"}]}]}
        loadouts = {"levels": {"203_hill-1904": {
            "1": {"soldier": "RussianSoldier", "slots": {}},
            "2": {"soldier": "JapaneseSoldier", "slots": {}}}}}
        posable = {"arisaka38": "Arisaka38"}
        host = self.host(library, {})
        self.assertEqual([("JapaneseSoldier", "Arisaka38")], kit_item_pairs(
            kits, {"203_hill-1904"}, library, posable, host)[0])
        self.assertEqual([("JapaneseSoldier", "Arisaka38"), ("RussianSoldier", "Arisaka38")],
                         kit_item_pairs(kits, {"203_hill-1904"}, library, posable, host,
                                        loadouts)[0])

    def test_a_level_weapon_with_no_pose_exits_2_and_mod_data_exits_1(self) -> None:
        ok = {("a", "x"): {"soldier": "A", "weapon": "X"}}
        self.assertEqual(0, kit_poses_exit(ok, [], [("A", "X")])[0])
        data = {**ok, ("a", "y"): {"soldier": "A", "weapon": "Y", "error": "clip absent"}}
        code, level_failed, item_failed = kit_poses_exit(data, [], [("A", "Y")])
        self.assertEqual((1, [], [data[("a", "y")]]), (code, level_failed, item_failed))
        self.assertEqual(1, kit_poses_exit(ok, [("A", ("Z",))], [])[0])
        ours = {**data, ("a", "w"): {"soldier": "A", "weapon": "W", "level": "203_hill-1904",
                                     "error": "no Ub_StandAim"}}
        code, level_failed, item_failed = kit_poses_exit(ours, [], [("A", "Y"), ("A", "W")])
        self.assertEqual(2, code)
        self.assertEqual([ours[("a", "w")]], level_failed)
        self.assertEqual([data[("a", "y")]], item_failed)
        # Latakia's RPG29: the level's state names a 3P clip no archive holds.
        absent = {**ok, ("a", "r"): {"soldier": "A", "weapon": "R", "level": "latakia-2016",
                                     "error": "no 3P clip", "absent": "in no archive"}}
        code, level_failed, item_failed = kit_poses_exit(absent, [], [("A", "R")])
        self.assertEqual((1, []), (code, level_failed))
        self.assertEqual([absent[("a", "r")]], item_failed)

    def test_a_level_grip_joins_the_tree_and_a_chain_grip_stays(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            out, level_root = Path(tmp) / "poses", Path(tmp) / "level"
            (out / "gaits").mkdir(parents=True)
            (out / "gaits" / "No4.gait.glb").write_bytes(b"chain")
            (out / "gaits" / "gaits.json").write_text(json.dumps(
                {"grips": {"No4": "gaits/No4.gait.glb"}, "weaponGrip": {"No4": "No4"}}))
            (level_root / "gaits").mkdir(parents=True)
            for grip in ("No4", "Katana"):
                (level_root / "gaits" / f"{grip}.gait.glb").write_bytes(b"level")
            manifest = {"grips": {"No4": "gaits/No4.gait.glb",
                                  "Katana": "gaits/Katana.gait.glb"},
                        "weaponGrip": {"Arisaka30": "No4", "Shashka": "Katana"},
                        "stateMachine": {"weaponSpeeds": {"Shashka": {"Ub_Fire": 1.5}}}}
            gripless = merge_level_gaits(out, level_root, manifest,
                                         ["Arisaka30", "Shashka", "GrenadeRJ"])
            written = json.loads((out / "gaits" / "gaits.json").read_text())
            self.assertEqual(["GrenadeRJ"], gripless)
            self.assertEqual(b"chain", (out / "gaits" / "No4.gait.glb").read_bytes())
            self.assertEqual(b"level", (out / "gaits" / "Katana.gait.glb").read_bytes())
            self.assertEqual({"No4": "No4", "Arisaka30": "No4", "Shashka": "Katana"},
                             written["weaponGrip"])
            self.assertEqual({"Ub_Fire": 1.5},
                             written["stateMachine"]["weaponSpeeds"]["Shashka"])


class AddLevelObjectsTests(unittest.TestCase):
    def test_each_levels_patches_are_added_before_its_base(self) -> None:
        pool = mock.Mock()
        pool.add_level_objects.return_value = 2

        def patches(path: Path) -> list[Path]:
            return [path.with_name("Wake_003.rfa")] if path.stem == "Wake" else []

        with mock.patch.object(extract_models.roster_mod, "level_patches", side_effect=patches):
            added = add_level_objects(pool, [("Wake", Path("/levels/Wake.rfa")),
                                             ("Berlin", Path("/levels/Berlin.rfa"))])

        self.assertEqual(["Wake_003.rfa", "Wake.rfa", "Berlin.rfa"],
                         [call.args[0].name for call in pool.add_level_objects.call_args_list])
        self.assertEqual(6, added)

    def test_an_unreadable_archive_costs_only_its_own_templates(self) -> None:
        pool = mock.Mock()
        pool.add_level_objects.side_effect = [ValueError("not an rfa"), 3]

        with mock.patch.object(extract_models.roster_mod, "level_patches", return_value=[]), \
                mock.patch("sys.stderr"):
            added = add_level_objects(pool, [("Broken", Path("/levels/Broken.rfa")),
                                             ("Berlin", Path("/levels/Berlin.rfa"))])

        self.assertEqual(3, added)


class AddLevelTexturesTests(unittest.TestCase):
    def test_each_levels_patches_fill_texture_gaps_before_its_base(self) -> None:
        pool = mock.Mock()
        pool.add_level.return_value = 4

        def patches(path: Path) -> list[Path]:
            return [path.with_name("Cebu-1945_001.rfa")] if path.stem == "Cebu-1945" else []

        with mock.patch.object(extract_models.roster_mod, "level_patches", side_effect=patches):
            added = add_level_textures(pool, [("Cebu-1945", Path("/levels/Cebu-1945.rfa")),
                                              ("KotaBharu", Path("/levels/KotaBharu.rfa"))])

        self.assertEqual(["Cebu-1945_001.rfa", "Cebu-1945.rfa", "KotaBharu.rfa"],
                         [call.args[0].name for call in pool.add_level.call_args_list])
        self.assertEqual(12, added)


class MergeMatrixTests(unittest.TestCase):
    def test_a_second_pass_keeps_the_first_and_refreshes_its_own_rows(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp)
            merge_matrix(out, [{"soldier": "IraqSoldier", "weapon": "AK47"},
                               {"soldier": "IraqSoldier", "weapon": "RPG7", "error": "old"}],
                         ["IraqSoldier"], ["AK47", "RPG7"], [], state="StandAim", frame=0)

            rows = merge_matrix(out, [{"soldier": "iraqsoldier", "weapon": "rpg7"},
                                      {"soldier": "USSoldier", "weapon": "M16"}],
                                ["USSoldier"], ["M16"], ["Ghost"], state="StandAim", frame=0)

            written = json.loads((out / "poses-matrix.json").read_text())
        self.assertEqual(rows, written["pairs"])
        self.assertEqual([("IraqSoldier", "AK47"), ("iraqsoldier", "rpg7"), ("USSoldier", "M16")],
                         [(row["soldier"], row["weapon"]) for row in rows])
        self.assertNotIn("error", rows[1])
        self.assertEqual(["IraqSoldier", "USSoldier"], written["soldiers"])
        self.assertEqual(["AK47", "M16", "RPG7"], written["weapons"])
        self.assertEqual(["Ghost"], written["weaponsWithoutTemplate"])


class NeverAnimatedTests(unittest.TestCase):
    """bryansk-1942's SpawnradioDeploy: declared by the level, animated nowhere."""

    def machine(self, states=(), dropped=()):
        from bf42.animstates import StateMachine
        m = StateMachine()
        m.states = {s.lower(): object() for s in states}
        m.dropped = {d.lower(): "deleted" for d in dropped}
        return m

    def test_a_weapon_no_state_names_is_the_mods_data(self):
        why = never_animated(self.machine(["Ub_StandAimMortarDeploy"]), "SpawnradioDeploy")
        self.assertIn("animates it nowhere", why)

    def test_a_state_naming_the_weapon_stays_the_readers_gap(self):
        self.assertIsNone(never_animated(
            self.machine(["Ub_CrouchAimGrenadeRus"]), "GrenadeRus"))
        self.assertIsNone(never_animated(
            self.machine(dropped=["ub_standaimgrenaderus"]), "GrenadeRus"))

    def test_the_mods_data_row_does_not_stop_the_recipe(self):
        rows = {("russiansoldier", "spawnradiodeploy"): {
            "soldier": "RussianSoldier", "weapon": "SpawnradioDeploy", "level": "bryansk-1942",
            "error": "no state", "absent": never_animated(self.machine(), "SpawnradioDeploy")}}
        code, level_failed, _ = kit_poses_exit(rows, [], [])
        self.assertEqual([], level_failed)
        self.assertNotEqual(2, code)


if __name__ == "__main__":
    unittest.main()
