"""The object template id table computed from the install, against every recorded id.

A CreateObject event names its template by id only. `bf42/template_table.py`
replays a level load (the level's `Init.con`, the mod chain's `objects/`
scripts, the round's `<mode>.con`) and numbers each first-created name, as
`ObjectTemplateManager::createTemplate` does (ledger LOAD-12..LOAD-18). Its
table must agree with every tid -> name pair a real round recorded:

- the 19 vanilla tables in `sidecar/templates/<level>.json` (the lab server's
  recorder), each in the game type its run used;
- `fixtures/sidecar_tid_tables.json`: lab server recordings of Desert Combat,
  FHSW and FHSWEurope, and BF1942.exe client recordings on public vanilla and
  Secret Weapons servers, which show the client numbers its templates the
  same way.

`sidecar_template_table_harness.mjs` covers the node side: template-table.mjs,
its cache, and namesForLevel / the body decoder using the computed table.
The install-dependent tests skip on a machine without the game.
"""

from __future__ import annotations

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

from bf42 import template_table as tt  # noqa: E402

SIDECAR = ROOT / "sidecar"
FIXTURES = Path(__file__).parent / "fixtures"
GAME_DIR = Path(os.environ.get("BF1942_DIR") or Path.home() / ".wine/drive_c/EA Games/Battlefield 1942")

# The game type each recorded table's lab run used (lab/scenarios
# sidecar-names-*: GPM_CQ for these three, GPM_COOP for the rest).
CONQUEST_RUNS = {"aberdeen", "liberation_of_caen", "coral_sea"}


def installed(mod: str) -> bool:
    mods = GAME_DIR / "Mods"
    return mods.is_dir() and any(d.name.lower() == mod.lower() for d in mods.iterdir())


_memo: dict = {}


def computed(mod: str, level: str, mode: str) -> list[str]:
    key = (mod.lower(), level, mode)
    if key not in _memo:
        _memo[key] = tt.template_table(GAME_DIR, mod, level, mode).names
    return _memo[key]


def mismatches(names: list[str], recorded: dict[str, str]) -> list[tuple]:
    out = []
    for tid, name in sorted(recorded.items(), key=lambda kv: int(kv[0])):
        got = names[int(tid)] if int(tid) < len(names) else None
        if got is None or got.lower() != name.lower():
            out.append((int(tid), name, got))
    return out


class ConsoleRuleTests(unittest.TestCase):
    """The console rules on their own, no install needed."""

    class Files:
        def __init__(self, files: dict[str, str]) -> None:
            self.files = {k.lower(): v for k, v in files.items()}

        def read(self, path: str) -> str | None:
            import posixpath
            return self.files.get(posixpath.normpath(path).lower())

    def run_files(self, files: dict[str, str], start: str, args=(), play_mode="GPM_CQ") -> list[str]:
        console = tt.Console(self.Files(files), play_mode=play_mode)
        console.run(start, list(args))
        return console.names

    def test_first_creation_numbers_a_name_and_id_zero_is_the_code_camera(self) -> None:
        names = self.run_files({"a.con": "ObjectTemplate.create Bundle Tank\n"
                                         "ObjectTemplate.create SimpleObject TANK\n"
                                         "objecttemplate.create SimpleObject Wheel\n"}, "a.con")
        self.assertEqual(["ObjectManagerCamera", "Tank", "Wheel"], names)

    def test_beginrem_nests(self) -> None:
        # Liberation of Caen's ParaTrooperSpawnObject: a beginRem inside a
        # beginRem block, one endRem, and the rest of the file is comment.
        names = self.run_files({"a.con": "beginRem\nObjectTemplate.create Bundle A\nbeginRem\n"
                                         "ObjectTemplate.create Bundle B\nendRem\n"
                                         "ObjectTemplate.create Bundle C\n"}, "a.con")
        self.assertEqual(["ObjectManagerCamera"], names)

    def test_rem_and_if_arms(self) -> None:
        names = self.run_files({"a.con": "rem ObjectTemplate.create Bundle A\n"
                                         "if v_arg1 == host\nObjectTemplate.create Bundle H\n"
                                         "else\nObjectTemplate.create Bundle J\nendIf\n"}, "a.con", ["host"])
        self.assertEqual(["ObjectManagerCamera", "H"], names)

    def test_run_is_relative_and_adds_con(self) -> None:
        names = self.run_files({"lv/init.con": "run init/sky\n",
                                "lv/init/sky.con": "ObjectTemplate.create LensFlare TSun\n"}, "lv/init.con")
        self.assertEqual(["ObjectManagerCamera", "TSun"], names)

    def test_fh_is_coop_variable(self) -> None:
        # FH's bf1942/game/is_coop.con, run with relative paths off.
        files = {
            "objects/w.con": "Var v_is_coop\nconsole.useRelativePaths 0\nrun bf1942/game/is_coop.con\n"
                             "console.useRelativePaths 1\nif v_is_coop == True\n"
                             "ObjectTemplate.create Projectile CoopBomb\nelse\n"
                             "ObjectTemplate.create Projectile ChuteBomb\nendIf\n",
            "bf1942/game/is_coop.con": "Var v_playmode\ngame.gamePlayMode -> v_playmode\n"
                                       "echo False -> v_is_coop\nif v_playmode == GPM_COOP\n"
                                       "echo True -> v_is_coop\nendIf\n",
        }
        self.assertEqual("CoopBomb", self.run_files(files, "objects/w.con", play_mode="GPM_COOP")[1])
        self.assertEqual("ChuteBomb", self.run_files(files, "objects/w.con", play_mode="GPM_CQ")[1])

    def test_a_create_with_three_arguments_creates_nothing(self) -> None:
        names = self.run_files({"a.con": "ObjectTemplate.create SimpleObject SimpleObject KV2Simple\n"
                                         "ObjectTemplate.create SimpleObject KV2\n"}, "a.con")
        self.assertEqual(["ObjectManagerCamera", "KV2"], names)

    def test_mode_names(self) -> None:
        self.assertEqual("coop", tt.mode_name("CoOp"))
        self.assertEqual("conquest", tt.mode_name("conquest.con"))
        self.assertEqual("conquest", tt.mode_name("GPM_CQ"))
        self.assertEqual("wake", tt.level_name("bf1942/levels/Wake/"))


@unittest.skipUnless(installed("bf1942"), "BF1942 is not installed")
class RecordedVanillaTablesTests(unittest.TestCase):
    def test_every_recorded_tid_of_every_vanilla_level(self) -> None:
        tables = sorted((SIDECAR / "templates").glob("*.json"))
        self.assertGreaterEqual(len(tables), 19)
        total = 0
        for path in tables:
            level = path.stem
            mode = "conquest" if level in CONQUEST_RUNS else "coop"
            recorded = json.loads(path.read_text())["tidNames"]
            with self.subTest(level=level, mode=mode):
                self.assertEqual([], mismatches(computed("bf1942", level, mode), recorded))
            total += len(recorded)
        self.assertGreater(total, 500)

    def test_spot_checks(self) -> None:
        wake = computed("bf1942", "bf1942/levels/wake/", "coop.con")
        alamein = computed("bf1942", "el_alamein", "coop")
        self.assertEqual("Sherman", wake[2916])
        self.assertEqual("Sherman", alamein[2914])
        self.assertEqual("ObjectManagerCamera", wake[0])
        self.assertEqual("BlueFlag", wake[1])        # Wake's Init.con declares its flags first
        self.assertEqual("ALLIES_north_village", wake[3605])
        self.assertEqual(3606, len(wake))

    def test_the_game_type_moves_only_its_own_templates(self) -> None:
        coop = computed("bf1942", "wake", "coop")
        conquest = computed("bf1942", "wake", "conquest")
        shared = min(len(coop), len(conquest))
        self.assertEqual(coop[:3550], conquest[:3550])
        self.assertGreater(shared, 3550)


@unittest.skipUnless(installed("bf1942"), "BF1942 is not installed")
class RecordedModTablesTests(unittest.TestCase):
    def test_every_fixture_table(self) -> None:
        fixture = json.loads((FIXTURES / "sidecar_tid_tables.json").read_text())
        self.assertGreaterEqual(len(fixture["tables"]), 19)
        for table in fixture["tables"]:
            with self.subTest(mod=table["mod"], level=table["level"], mode=table["mode"]):
                if not installed(table["mod"]):
                    self.skipTest(f"{table['mod']} is not installed")
                names = computed(table["mod"], table["level"], table["mode"])
                self.assertEqual([], mismatches(names, table["tidNames"]))


@unittest.skipUnless(installed("bf1942") and shutil.which("node"), "needs BF1942 and node")
class SidecarTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.tmp = tempfile.TemporaryDirectory()
        env = {**os.environ, "SIDECAR_CACHE": cls.tmp.name}
        proc = subprocess.run(["node", str(Path(__file__).parent / "sidecar_template_table_harness.mjs")],
                              capture_output=True, text=True, timeout=300, env=env)
        if proc.returncode != 0:
            raise AssertionError(proc.stderr)
        cls.r = json.loads(proc.stdout.strip().splitlines()[-1])
        cls.stderr = proc.stderr

    @classmethod
    def tearDownClass(cls) -> None:
        cls.tmp.cleanup()

    def test_template_table_module(self) -> None:
        self.assertEqual({"count": 3606, "0": "ObjectManagerCamera", "1": "BlueFlag", "2916": "Sherman",
                          "3601": "The_Airfield", "3605": "ALLIES_north_village"}, self.r["wake"])
        self.assertEqual("Sherman", self.r["alamein"]["2914"])
        self.assertNotEqual("Sherman", self.r["alamein"]["2916"])

    def test_the_answer_is_cached_against_the_archives_read(self) -> None:
        self.assertEqual(3606, self.r["cached"]["names"])
        self.assertGreater(self.r["cached"]["inputs"], 1)

    def test_names_for_level_uses_the_computed_table(self) -> None:
        self.assertEqual({"computed": True, "n2916": "Sherman", "n1": "BlueFlag"}, self.r["named"])
        self.assertEqual("Sherman", self.r["decoder"])

    def test_no_mod_falls_back_loudly_to_the_recorded_table(self) -> None:
        self.assertFalse(self.r["fallback"]["computed"])
        self.assertEqual("Sherman", self.r["fallback"]["n2916"])   # templates/wake.json
        self.assertIsNone(self.r["fallback"]["n1"])                # partial: never instantiated
        self.assertIn("FALLBACK", self.stderr)

    def test_a_level_the_install_lacks_is_null(self) -> None:
        self.assertIsNone(self.r["noLevel"])


if __name__ == "__main__":
    unittest.main()
