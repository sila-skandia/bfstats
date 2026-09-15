from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from bf42.con import ObjectLibrary  # noqa: E402
from bf42.roster import (  # noqa: E402
    Roster,
    add_kits,
    add_levels,
    level_pool,
    nation_label,
    side_of,
    theatre_of,
)


def _fake_archives(content: dict[str, dict[str, bytes]], broken: frozenset[str] = frozenset()):
    """A stand-in for `RfaArchive`, keyed by filename rather than real bytes.

    `ArchivePool.add` calls `RfaArchive(path)` and then iterates `.entries`;
    this reproduces just that surface so `level_pool`'s directory-scanning and
    overlay-order logic can be exercised against real files on disk (real
    `Path.iterdir()`, real case) without hand-rolling a valid RFA binary.
    Patch with `mock.patch("bf42.rfa.RfaArchive", _fake_archives(...))`.
    """
    class _FakeArchive:
        def __init__(self, path: Path) -> None:
            if path.name in broken:
                raise ValueError(f"synthetic corruption: {path.name}")
            self._payloads = content.get(path.name, {})
            self.entries = list(self._payloads)

        def read(self, name: str) -> bytes:
            return self._payloads[name]

    return _FakeArchive


class NationTests(unittest.TestCase):
    def test_kit_and_soldier_spellings_resolve_to_one_nation(self) -> None:
        # `German_AT` and `GermanDesertSoldier` are the same army named twice.
        self.assertEqual("German", nation_label("Ger"))
        self.assertEqual("German", nation_label("german"))
        self.assertEqual("German", nation_label("GermanDesert"))
        self.assertEqual("British", nation_label("GB"))
        self.assertEqual("British", nation_label("Brit"))
        self.assertEqual("Soviet", nation_label("Russ"))

    def test_unknown_nation_is_not_invented(self) -> None:
        self.assertIsNone(nation_label("Klingon"))

    def test_sides_split_axis_from_everyone_else(self) -> None:
        self.assertEqual("Axis", side_of("German"))
        self.assertEqual("Axis", side_of("Japanese"))
        self.assertEqual("Allied", side_of("Soviet"))
        self.assertEqual("Allied", side_of("US Marines"))

    def test_an_elite_formation_keeps_its_countrys_side(self) -> None:
        # Secret Weapons' elite kits resolve to "German Elite", a label that
        # shares no string with "German". `side_of` defaults everything it does
        # not recognise to Allied, so the whole XPack2 elite line — Gewehr42,
        # Gewehr43_zf4, K98RifleGrenade, EliteKnife, GermanEliteSoldier — used
        # to come out fighting for the Allies.
        self.assertEqual("Axis", side_of("German Elite"))
        self.assertEqual("Allied", side_of("British Commandos"))

    def test_a_formation_resolves_from_its_kit_and_its_soldier(self) -> None:
        # `GerEliteKit` names the kit folder, `GermanEliteSoldier` the skin a
        # level puts on a team; both have to land on the same army.
        self.assertEqual("German Elite", nation_label("GerElite"))
        self.assertEqual("German Elite", nation_label("GermanElite"))
        self.assertEqual("British Commandos", nation_label("Commando"))
        self.assertEqual("British Commandos", nation_label("BritishCommando"))


class TheatreTests(unittest.TestCase):
    def test_desert_kit_wins_over_the_nations_wearing_it(self) -> None:
        # Kasserine Pass fields Germans against Americans, but in desert skins.
        self.assertEqual(
            "North Africa",
            theatre_of(["GermanDesertSoldier", "USSoldier"]))

    def test_marines_or_japanese_read_as_pacific(self) -> None:
        self.assertEqual("Pacific", theatre_of(["JapaneseSoldier", "USMarineSoldier"]))

    def test_soviets_read_as_the_eastern_front(self) -> None:
        self.assertEqual("Eastern Front", theatre_of(["GermanSoldier", "RussianSoldier"]))

    def test_anything_else_is_the_western_campaign(self) -> None:
        self.assertEqual("Western Europe", theatre_of(["GermanSoldier", "USSoldier"]))

    def test_a_level_naming_no_skins_still_gets_a_theatre(self) -> None:
        self.assertEqual("Western Europe", theatre_of([]))


class KitRosterTests(unittest.TestCase):
    def library(self) -> ObjectLibrary:
        library = ObjectLibrary()
        library.add_con(
            "Objects/Items/BritKit/AntiTank/Objects.con",
            """
ObjectTemplate.create Kit GB_AT
ObjectTemplate.setType AT
ObjectTemplate.addTemplate Bazoo
ObjectTemplate.addTemplate Colt
""")
        library.add_con(
            "Objects/Items/GerKit/AntiTank/Objects.con",
            """
ObjectTemplate.create Kit German_AT
ObjectTemplate.addTemplate Panzershreck
ObjectTemplate.addTemplate WalterP38
""")
        # The kit names a wrapper; the real weapon is a child of it.
        library.add_con(
            "Objects/HandWeapons/Bazooka/Objects.con",
            """
ObjectTemplate.create LauncherWrapper Bazoo
ObjectTemplate.addTemplate Bazooka

ObjectTemplate.create ProjectileLauncher Bazooka
""")
        return library

    def test_a_kit_reaches_the_weapon_behind_its_wrapper(self) -> None:
        roster = Roster()
        self.assertEqual(2, add_kits(roster, self.library()))

        bazooka = roster.entry("Bazooka")
        self.assertEqual(["British"], bazooka["factions"])
        self.assertEqual(["Allied"], bazooka["sides"])
        self.assertEqual(["Anti-tank"], bazooka["kitClasses"])

    def test_a_weapon_in_both_sides_kits_carries_both(self) -> None:
        library = self.library()
        library.add_con(
            "Objects/Items/USKit/Engineer/Objects.con",
            """
ObjectTemplate.create Kit US_Engineer
ObjectTemplate.addTemplate Colt
""")
        roster = Roster()
        add_kits(roster, library)

        colt = roster.entry("Colt")
        self.assertEqual(["British", "US"], colt["factions"])
        self.assertEqual(["Anti-tank", "Engineer"], colt["kitClasses"])

    def test_lookup_is_case_insensitive(self) -> None:
        roster = Roster()
        add_kits(roster, self.library())
        self.assertEqual(
            roster.entry("bazooka")["factions"],
            roster.entry("BAZOOKA")["factions"])

    def test_a_template_no_kit_carries_has_no_faction(self) -> None:
        roster = Roster()
        add_kits(roster, self.library())
        self.assertEqual([], roster.entry("Sherman")["factions"])

    def test_templates_outside_the_items_tree_are_not_kits(self) -> None:
        library = ObjectLibrary()
        library.add_con(
            "Objects/Vehicles/Land/Sherman/Objects.con",
            """
ObjectTemplate.create Kit NotReallyAKit
ObjectTemplate.addTemplate Sherman
""")
        roster = Roster()
        self.assertEqual(0, add_kits(roster, library))
        self.assertEqual([], roster.entry("Sherman")["factions"])


class LevelPoolTests(unittest.TestCase):
    """`level_pool` — a level's base archive, overlaid by its numbered patches.

    Five vanilla `_003` layers rewrite the Pacific maps' US side to Marine
    kits; reading only the base archive (the old behaviour) reports the dead
    binding the patch replaced.
    """

    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.levels_dir = Path(self._tmp.name)

    def tearDown(self) -> None:
        self._tmp.cleanup()

    def _touch(self, *names: str) -> None:
        for name in names:
            (self.levels_dir / name).touch()

    def _init_of(self, pool) -> bytes:
        name = next(n for n in pool.names() if n.lower().endswith("/init.con"))
        return pool.read(name)

    def test_a_patch_layer_overrides_the_base_init_con(self) -> None:
        self._touch("Wake.rfa", "Wake_003.rfa")
        content = {
            "Wake.rfa": {"bf1942/levels/Wake/Init.con":
                         b"game.setTeamSkin 2 USSoldier\ngame.setKit 2 4 US_Engineer\n"},
            "Wake_003.rfa": {"bf1942/levels/Wake/Init.con":
                             b"game.setTeamSkin 2 USMarineSoldier\n"
                             b"game.setKit 2 4 USMarine_Engineer\n"},
        }
        with mock.patch("bf42.rfa.RfaArchive", _fake_archives(content)):
            pool = level_pool(self.levels_dir / "Wake.rfa")
        self.assertIsNotNone(pool)
        self.assertEqual(
            b"game.setTeamSkin 2 USMarineSoldier\ngame.setKit 2 4 USMarine_Engineer\n",
            self._init_of(pool))

    def test_sibling_matching_is_case_insensitive(self) -> None:
        # Vanilla ships `Berlin.rfa` next to a lowercase `berlin_003.rfa`.
        self._touch("Berlin.rfa", "berlin_003.rfa")
        content = {
            "Berlin.rfa": {"bf1942/levels/Berlin/Init.con": b"base\n"},
            "berlin_003.rfa": {"bf1942/levels/Berlin/Init.con": b"patched\n"},
        }
        with mock.patch("bf42.rfa.RfaArchive", _fake_archives(content)):
            pool = level_pool(self.levels_dir / "Berlin.rfa")
        self.assertIsNotNone(pool)
        self.assertEqual(b"patched\n", self._init_of(pool))
        self.assertIn("berlin_003.rfa", {label for label, _ in pool.archives})

    def test_the_highest_numbered_patch_wins(self) -> None:
        # XPack1's Salerno ships both `_001` and `_003`.
        self._touch("Salerno.rfa", "Salerno_001.rfa", "Salerno_003.rfa")
        content = {
            "Salerno.rfa": {"bf1942/levels/Salerno/Init.con": b"base\n"},
            "Salerno_001.rfa": {"bf1942/levels/Salerno/Init.con": b"patch one\n"},
            "Salerno_003.rfa": {"bf1942/levels/Salerno/Init.con": b"patch three\n"},
        }
        with mock.patch("bf42.rfa.RfaArchive", _fake_archives(content)):
            pool = level_pool(self.levels_dir / "Salerno.rfa")
        self.assertEqual(b"patch three\n", self._init_of(pool))

    def test_a_four_digit_build_stamp_still_matches(self) -> None:
        # WarFront patches every level with a four-digit `_0351` build stamp,
        # not the vanilla three-digit convention.
        self._touch("Tobruk.rfa", "Tobruk_0351.rfa")
        content = {
            "Tobruk.rfa": {"bf1942/levels/Tobruk/Init.con": b"base\n"},
            "Tobruk_0351.rfa": {"bf1942/levels/Tobruk/Init.con": b"patched\n"},
        }
        with mock.patch("bf42.rfa.RfaArchive", _fake_archives(content)):
            pool = level_pool(self.levels_dir / "Tobruk.rfa")
        self.assertEqual(b"patched\n", self._init_of(pool))

    def test_a_patch_that_wont_open_is_skipped(self) -> None:
        self._touch("Tobruk.rfa", "Tobruk_003.rfa")
        content = {"Tobruk.rfa": {"bf1942/levels/Tobruk/Init.con": b"base\n"}}
        with mock.patch("bf42.rfa.RfaArchive",
                        _fake_archives(content, broken=frozenset({"Tobruk_003.rfa"}))):
            pool = level_pool(self.levels_dir / "Tobruk.rfa")
        self.assertIsNotNone(pool)
        self.assertEqual(b"base\n", self._init_of(pool))

    def test_the_level_is_skipped_only_when_the_base_itself_wont_open(self) -> None:
        self._touch("Tobruk.rfa", "Tobruk_003.rfa")
        content = {"Tobruk_003.rfa": {"bf1942/levels/Tobruk/Init.con": b"patched\n"}}
        with mock.patch("bf42.rfa.RfaArchive",
                        _fake_archives(content, broken=frozenset({"Tobruk.rfa"}))):
            pool = level_pool(self.levels_dir / "Tobruk.rfa")
        self.assertIsNone(pool)

    def test_a_level_with_no_patch_still_resolves_from_the_base(self) -> None:
        self._touch("El_Alamein.rfa")
        content = {"El_Alamein.rfa": {"bf1942/levels/El_Alamein/Init.con": b"base only\n"}}
        with mock.patch("bf42.rfa.RfaArchive", _fake_archives(content)):
            pool = level_pool(self.levels_dir / "El_Alamein.rfa")
        self.assertEqual(b"base only\n", self._init_of(pool))


class AddLevelsPatchTests(unittest.TestCase):
    """`add_levels` credits the patch's soldier, not the dead base binding."""

    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.levels_dir = Path(self._tmp.name)

    def tearDown(self) -> None:
        self._tmp.cleanup()

    def test_a_patched_team_skin_is_what_gets_credited(self) -> None:
        (self.levels_dir / "Wake.rfa").touch()
        (self.levels_dir / "Wake_003.rfa").touch()
        content = {
            "Wake.rfa": {"bf1942/levels/Wake/Init.con":
                         b"game.setTeamSkin 1 JapaneseSoldier\n"
                         b"game.setTeamSkin 2 USSoldier\n"},
            "Wake_003.rfa": {"bf1942/levels/Wake/Init.con":
                             b"game.setTeamSkin 1 JapaneseSoldier\n"
                             b"game.setTeamSkin 2 USMarineSoldier\n"},
        }
        with mock.patch("bf42.rfa.RfaArchive", _fake_archives(content)):
            roster = Roster()
            read = add_levels(roster, [("Wake", self.levels_dir / "Wake.rfa")])

        self.assertEqual(1, read)
        self.assertEqual(["Wake"], sorted(roster.levels.get("usmarinesoldier", set())))
        self.assertNotIn("ussoldier", roster.levels)
        self.assertEqual(["US Marines"], roster.entry("USMarineSoldier")["factions"])


if __name__ == "__main__":
    unittest.main()
