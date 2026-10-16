"""The sidecar's two install-built tables against every recorded copy.

`bf42/game_tables.py` builds, from the game files alone, what the sidecar used
to lift from bf42plus recordings: the engine's animation state table
(`[index, name, flag word]`, which sizes and names a soldier body's state
fields) and a level's control point names (template -> `setControlPointName`
word). Each must agree exactly with what the retail client and server held at
run time, as their recordings dumped it:

- the anim tables of `sidecar/templates/<level>.json` (vanilla, lab server
  recordings) and `fixtures/sidecar_anim_tables.json.gz` (client recordings of
  vanilla, Secret Weapons, Desert Combat, DC Final and Eve of Destruction),
  index, name and flags;
- the cpNames of every `sidecar/templates/<level>.json` and the 48 distinct
  control point maps in `fixtures/sidecar_cp_names.json` (vanilla, DC, DC Final,
  EoD, SW, FH, FHSW, FHSWEurope recordings).

The install-dependent tests skip on a machine without the game.
"""

from __future__ import annotations

import gzip
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from bf42 import game_tables  # noqa: E402

SIDECAR = ROOT / "sidecar"
FIXTURES = Path(__file__).parent / "fixtures"
GAME_DIR = Path(os.environ.get("BF1942_DIR") or Path.home() / ".wine/drive_c/EA Games/Battlefield 1942")
MODES = ("conquest", "coop", "ctf", "tdm", "objectivemode")


def installed(mod: str) -> bool:
    mods = GAME_DIR / "Mods"
    return mods.is_dir() and any(d.name.lower() == mod.lower() for d in mods.iterdir())


def chain(mod: str):
    from extract_models import mod_chain
    return mod_chain(GAME_DIR, mod)


def recorded_level_tables() -> dict[str, dict]:
    return {p.stem: json.loads(p.read_text()) for p in sorted((SIDECAR / "templates").glob("*.json"))}


class ParsingTests(unittest.TestCase):
    """The rules on their own, no install needed."""

    def test_flag_words_are_the_registered_constants(self) -> None:
        # ObjTemplBFModule::init 0x082986d0 (addConstantHelper calls).
        self.assertEqual(2, game_tables.flag_value("c_AsmHideWeapon"))
        self.assertEqual(4, game_tables.flag_value("c_AsmLockFreeLook"))
        self.assertEqual(8, game_tables.flag_value("c_AsmIsSwimming"))
        self.assertEqual(16, game_tables.flag_value("c_AsmIsClimbing"))
        self.assertEqual(32, game_tables.flag_value("c_AsmIsCrouching"))
        self.assertEqual(64, game_tables.flag_value("C_ASMISLYING"))
        self.assertEqual(3, game_tables.flag_value("3"))
        self.assertIsNone(game_tables.flag_value("c_AsmNoSuchFlag"))

    def test_the_name_goes_to_the_active_control_point(self) -> None:
        lines = [
            "ObjectTemplate.create ControlPoint The_Beach",
            "ObjectTemplate.setControlPointName Landing_Beach",
            "ObjectTemplate.create SimpleObject flagpole",
            "ObjectTemplate.setControlPointName Nowhere",       # not a control point
            "ObjectTemplate.create ControlPoint Village_CP",
            "ObjectTemplate.active the_beach",
            "ObjectTemplate.setControlPointName Beach_Two",     # reopens the first
            "ObjectTemplate.create ControlPoint Unnamed",
        ]
        self.assertEqual({"The_Beach": "Beach_Two"},
                         game_tables.control_point_names_from_lines(lines))


@unittest.skipUnless(installed("bf1942"), "BF1942 is not installed")
class AnimTableTests(unittest.TestCase):
    def check(self, mod: str, recorded: list) -> None:
        rows, _ = game_tables.anim_state_table(chain(mod))
        self.assertEqual(sorted(map(tuple, recorded)), [tuple(r) for r in rows])
        self.assertEqual(list(range(len(rows))), [r[0] for r in rows])

    def test_every_level_table_matches_vanilla(self) -> None:
        tables = {k: v["animStates"] for k, v in recorded_level_tables().items() if v.get("animStates")}
        self.assertGreater(len(tables), 0)
        rows, _ = game_tables.anim_state_table(chain("bf1942"))
        for level, recorded in tables.items():
            with self.subTest(level=level):
                self.assertEqual(sorted(map(tuple, recorded)), [tuple(r) for r in rows])

    def test_client_recordings_of_each_mod(self) -> None:
        fixture = json.loads(gzip.decompress((FIXTURES / "sidecar_anim_tables.json.gz").read_bytes()))
        for mod, table in fixture["tables"].items():
            with self.subTest(mod=mod, recording=table["recording"]):
                if not installed(mod):
                    self.skipTest(f"{mod} is not installed")
                self.check(mod, table["states"])

    def test_a_level_that_ships_animation_scripts_has_its_own_table(self) -> None:
        # Game::load runs Animations/AnimationStates.con at every level load,
        # with the level mounted (0x0805bb36; `AnimationStateMachine.init`
        # 0x08327250 starts the machine afresh). Cretan Village ships the
        # EihGr39's scripts and clips under its own `animations/`.
        if not installed("FH"):
            self.skipTest("FH is not installed")
        fh = chain("FH")
        bare, _ = game_tables.anim_state_table(fh)
        level = game_tables.level_archives(GAME_DIR, "FH", fh, "bf1942/levels/cretan_village/")
        own, read = game_tables.anim_state_table(fh, None, level)
        self.assertGreater(len(own), len(bare))
        self.assertTrue(any(name.endswith("EihGr39") for _, name, _ in own))
        self.assertFalse(any(name.endswith("EihGr39") for _, name, _ in bare))
        self.assertIn("Cretan_Village.rfa", [p.name for p in read])
        # A vanilla level ships none: the table is the mod's.
        van = chain("bf1942")
        wake = game_tables.level_archives(GAME_DIR, "bf1942", van, "wake")
        self.assertEqual(game_tables.anim_state_table(van)[0], game_tables.anim_state_table(van, None, wake)[0])

    def test_the_count_sizes_the_state_fields(self) -> None:
        # 1395 states read in 11 bits (wire.md, soldier body 0x20/0x40).
        rows, _ = game_tables.anim_state_table(chain("bf1942"))
        self.assertEqual(1395, len(rows))
        self.assertEqual(11, (len(rows) - 1).bit_length())


@unittest.skipUnless(installed("bf1942"), "BF1942 is not installed")
class ControlPointNameTests(unittest.TestCase):
    def matching_modes(self, mod: str, level: str, recorded: dict) -> list[str]:
        out = []
        for mode in MODES:
            try:
                names, _ = game_tables.control_point_names(GAME_DIR, mod, chain(mod), level, f"{mode}.con")
            except FileNotFoundError:
                continue
            low = {k.lower(): v for k, v in names.items()}
            if all(low.get(t.lower()) == n for t, n in recorded.items()):
                out.append(mode)
        return out

    def test_every_level_table(self) -> None:
        tables = {k: v["cpNames"] for k, v in recorded_level_tables().items() if v.get("cpNames")}
        self.assertGreater(len(tables), 0)
        for level, recorded in tables.items():
            with self.subTest(level=level):
                self.assertTrue(self.matching_modes("bf1942", level, recorded))

    def test_wake_coop_exactly(self) -> None:
        names, _ = game_tables.control_point_names(GAME_DIR, "bf1942", chain("bf1942"),
                                                    "bf1942/levels/wake/", "coop.con")
        self.assertEqual(recorded_level_tables()["wake"]["cpNames"], names)

    def test_every_recorded_mod_level(self) -> None:
        fixture = json.loads((FIXTURES / "sidecar_cp_names.json").read_text())
        for case in fixture["cases"]:
            with self.subTest(recording=case["recording"], mod=case["mod"], level=case["level"]):
                if not installed(case["mod"]):
                    self.skipTest(f"{case['mod']} is not installed")
                self.assertEqual(case["modes"], self.matching_modes(case["mod"], case["level"], case["cpNames"]))

    def test_a_joining_client_declares_what_the_host_does(self) -> None:
        # The templates are run outside `if v_arg1 == host` (3,839 level and
        # game type pairs over 15 installed mods agree, 2026-10-17).
        for level, mode in (("wake", "coop"), ("el_alamein", "conquest"), ("berlin", "tdm")):
            a, _ = game_tables.control_point_names(GAME_DIR, "bf1942", chain("bf1942"), level, mode, "client")
            b, _ = game_tables.control_point_names(GAME_DIR, "bf1942", chain("bf1942"), level, mode, "host")
            self.assertEqual(a, b)


@unittest.skipUnless(installed("DesertCombat"), "Desert Combat is not installed")
class SidecarWiringTests(unittest.TestCase):
    """sidecar_game_tables_harness.mjs: the node side runs the command line,
    caches by the archives read, and the body decoder sizes its soldier state
    fields from the server's mod once ServerInfo and SetLevel have been seen."""

    @classmethod
    def setUpClass(cls) -> None:
        if shutil.which("node") is None:
            raise unittest.SkipTest("node is not installed")
        cls.cache = tempfile.TemporaryDirectory()
        env = {**os.environ, "SIDECAR_CACHE": cls.cache.name}
        proc = subprocess.run(["node", str(Path(__file__).parent / "sidecar_game_tables_harness.mjs")],
                              capture_output=True, text=True, timeout=300, env=env)
        if proc.returncode != 0:
            raise AssertionError(proc.stderr)
        cls.r = json.loads(proc.stdout.strip().splitlines()[-1])

    @classmethod
    def tearDownClass(cls) -> None:
        cls.cache.cleanup()

    def test_vanilla_wake(self) -> None:
        self.assertEqual(1395, self.r["wake"]["anim"])
        self.assertEqual(recorded_level_tables()["wake"]["cpNames"], self.r["wake"]["cpNames"])

    def test_the_answer_is_cached(self) -> None:
        self.assertEqual(self.r["wake"], self.r["wakeCached"])
        self.assertTrue(self.r["cacheFiles"])

    def test_body_decoder_follows_the_servers_mod(self) -> None:
        self.assertEqual(2691, self.r["dcBodies"]["animStates"])
        self.assertIn("southopenbase", self.r["dcBodies"]["cpTemplates"])
        self.assertEqual("ControlPoint", self.r["dcBodies"]["cpClass"])

    def test_an_explicit_count_stays(self) -> None:
        self.assertEqual(1395, self.r["fixedBodies"])

    def test_no_mod_is_null_not_a_guess(self) -> None:
        self.assertEqual({"animStates": None, "cpNames": None}, self.r["noMod"])

    def test_cp_names_ignore_the_case_of_the_template(self) -> None:
        self.assertEqual("Village", self.r["caseless"])


if __name__ == "__main__":
    unittest.main()
