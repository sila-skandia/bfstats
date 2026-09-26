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
from extract_pose import kit_pose_plan, merge_matrix, resolve_kit_poses  # noqa: E402


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


if __name__ == "__main__":
    unittest.main()
