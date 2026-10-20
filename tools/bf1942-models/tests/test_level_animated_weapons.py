"""A weapon the chain declares and only a level animates is built and posed
through that level's load (FHSWEurope's Krag, einunnabridge, 2026-10-20), and
a weapon the mod animates nowhere is the mod's data in the static audit
(bryansk-1942's SpawnradioDeploy)."""

from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import audit_mod  # noqa: E402
import extract_pose  # noqa: E402
import extract_viewmodel  # noqa: E402
from extract_pose import (LevelAnimates, chain_animates, level_rig_hosts,  # noqa: E402
                          level_weapon_host, never_animated)


def machine(*states: str) -> SimpleNamespace:
    """The states a reader asks of a machine, keyed lower-case as parsed."""
    return SimpleNamespace(states={s.lower(): object() for s in states}, dropped={})


CHAIN = machine("Ub_StandAimNo4", "Ub_IdleNo41", "Ub_StandAimMp40", "Lb_RunForwardK98")
EINUNNA = machine(*CHAIN.states, "Ub_StandAimKrag", "Ub_IdleKrag1", "Lb_RunForwardKrag")


class Library:
    """The chain declares Krag, No4 and K98; GrenadeRus only a level does."""

    def object(self, name):
        if name.lower() in {"krag", "no4", "k98"}:
            return SimpleNamespace(name=name, source="objects/handweapons/x/objects.con")
        return None


def animates_from(machines: dict[str, SimpleNamespace]):
    return lambda level, weapon: chain_animates(machines[level], weapon) \
        if level in machines else False


class ChainAnimates(unittest.TestCase):
    def test_a_state_ending_in_the_weapon_animates_it(self) -> None:
        self.assertTrue(chain_animates(CHAIN, "No4"))
        self.assertTrue(chain_animates(CHAIN, "mp40"))   # a name ending in digits
        self.assertTrue(chain_animates(CHAIN, "K98"))    # a lower-body state counts
        self.assertTrue(chain_animates(EINUNNA, "Krag"))

    def test_no_state_of_the_weapon_animates_nothing(self) -> None:
        self.assertFalse(chain_animates(CHAIN, "Krag"))
        self.assertFalse(chain_animates(CHAIN, ""))
        # A name only inside another's state is not this weapon's state.
        self.assertFalse(chain_animates(machine("Ub_StandAimKragJorgensen"), "Krag"))


class LevelRigHosts(unittest.TestCase):
    PAIRS = [("GermanSoldier", "Krag"), ("MILORGSoldier", "Krag"),
             ("BritishSoldier", "No4"), ("RussianSoldier", "GrenadeRus")]
    LEVELS = {("GermanSoldier", "Krag"): ["aaa_plain", "einunnabridge"],
              ("MILORGSoldier", "Krag"): ["einunnabridge"],
              ("BritishSoldier", "No4"): ["einunnabridge"],
              ("RussianSoldier", "GrenadeRus"): ["203_hill-1904"]}

    def declared_by(self, level: str) -> set[str]:
        return {"203_hill-1904": {"grenaderus"}}.get(level, set())

    def test_a_chain_weapon_only_a_level_animates_is_that_levels(self) -> None:
        hosts, rest = level_rig_hosts(
            self.PAIRS, self.LEVELS, Library(), self.declared_by, chain_machine=CHAIN,
            animates=animates_from({"einunnabridge": EINUNNA, "aaa_plain": CHAIN}))
        self.assertEqual({"einunnabridge": [("GermanSoldier", "Krag"),
                                            ("MILORGSoldier", "Krag")],
                          "203_hill-1904": [("RussianSoldier", "GrenadeRus")]}, hosts)
        # No4 has chain states: a chain rig as ever.
        self.assertEqual([("BritishSoldier", "No4")], rest)

    def test_without_the_level_animations_it_is_what_it_was(self) -> None:
        hosts, rest = level_rig_hosts(self.PAIRS, self.LEVELS, Library(), self.declared_by)
        self.assertEqual({"203_hill-1904": [("RussianSoldier", "GrenadeRus")]}, hosts)
        self.assertEqual([("GermanSoldier", "Krag"), ("MILORGSoldier", "Krag"),
                          ("BritishSoldier", "No4")], rest)

    def test_a_chain_weapon_no_level_animates_stays_the_chains(self) -> None:
        hosts, rest = level_rig_hosts(
            [("GermanSoldier", "Krag")], self.LEVELS, Library(), self.declared_by,
            chain_machine=CHAIN, animates=animates_from({"aaa_plain": CHAIN,
                                                         "einunnabridge": CHAIN}))
        self.assertEqual({}, hosts)
        self.assertEqual([("GermanSoldier", "Krag")], rest)

    def test_a_weapon_the_chain_animates_never_asks_a_level(self) -> None:
        asked: list = []

        def animates(level, weapon):
            asked.append((level, weapon))
            return True
        hosts, rest = level_rig_hosts([("BritishSoldier", "No4")], self.LEVELS, Library(),
                                      self.declared_by, chain_machine=CHAIN,
                                      animates=animates)
        self.assertEqual(({}, [("BritishSoldier", "No4")]), (hosts, rest))
        self.assertEqual([], asked)


class LevelWeaponHost(unittest.TestCase):
    """The third-person side: Krag had no kit pose at all."""

    def test_a_chain_weapon_only_a_level_animates_is_posed_there(self) -> None:
        animates = animates_from({"einunnabridge": EINUNNA, "zz_exported": EINUNNA})
        nobody = lambda level: set()  # noqa: E731
        self.assertIsNone(level_weapon_host(["einunnabridge"], "Krag", Library(), nobody))
        self.assertEqual("einunnabridge", level_weapon_host(
            ["zz_exported", "einunnabridge"], "Krag", Library(), nobody,
            chain_machine=CHAIN, animates=animates))
        # The exported levels first, as for a level-declared weapon.
        self.assertEqual("zz_exported", level_weapon_host(
            ["zz_exported", "einunnabridge"], "Krag", Library(), nobody, {"zz_exported"},
            chain_machine=CHAIN, animates=animates))
        # A chain-animated weapon has no host whatever the levels do.
        self.assertIsNone(level_weapon_host(
            ["einunnabridge"], "No4", Library(), nobody,
            chain_machine=CHAIN, animates=animates))


class LevelAnimatesCache(unittest.TestCase):
    def test_the_text_answers_first_and_a_machine_is_built_once(self) -> None:
        built: list = []

        def machine_of(pool):
            built.append(pool)
            return EINUNNA
        animates = LevelAnimates([Path("/nowhere/Mods/FHSWEurope")], meshes=None,
                                 machine_of=machine_of)
        animates._texts.update({"einunnabridge": "copystate krag v_arg1 no4 1.0",
                                "aaa_plain": "copystate no4 v_arg1 k98 1.0"})
        with mock.patch.object(extract_pose, "level_animation_pool",
                               return_value="pool") as pool:
            self.assertFalse(animates("aaa_plain", "Krag"))
            self.assertTrue(animates("einunnabridge", "Krag"))
            self.assertTrue(animates("einunnabridge", "krag"))
            self.assertFalse(animates("einunnabridge", "GrenadeRus"))
        self.assertEqual(["pool"], built)
        self.assertEqual(1, pool.call_count)


class UnanimatedRigs(unittest.TestCase):
    def test_a_clipless_rig_says_why_it_is_the_mods_data(self) -> None:
        clips = {"idle": {"error": "no state"}, "fire": {"error": "no state"}}
        with mock.patch.object(extract_viewmodel, "export_viewmodel",
                               return_value={"clips": clips, "glb": "a.fp.glb"}):
            families, glb, error, why = extract_viewmodel._export_pair(
                ("GermanSoldier", "SpawnradioDeploy"), Path("."), {"machine": CHAIN})
        self.assertEqual(([], "a.fp.glb", None), (families, glb, error))
        self.assertEqual(never_animated(CHAIN, "SpawnradioDeploy"), why)
        with mock.patch.object(extract_viewmodel, "export_viewmodel",
                               return_value={"clips": {"idle": {}}, "glb": "b.fp.glb"}):
            self.assertIsNone(extract_viewmodel._export_pair(
                ("BritishSoldier", "No4"), Path("."), {"machine": CHAIN})[3])

    def test_the_record_merges_like_absent_json(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp)
            (out / "unanimated.json").write_text(json.dumps([
                {"soldier": "GermanSoldier", "weapon": "SpawnradioDeploy", "reason": "x"},
                {"soldier": "GermanSoldier", "weapon": "Krag", "reason": "x"},
                {"soldier": "Gone", "weapon": "Rig", "reason": "x"}]))
            rows = extract_viewmodel.merge_unanimated(
                out, [{"soldier": "RussianSoldier", "weapon": "SpawnradioDeploy",
                       "level": "bryansk-1942", "reason": "y"}],
                built={"germansoldier__krag", "russiansoldier__spawnradiodeploy"},
                index_stems={"germansoldier__spawnradiodeploy", "germansoldier__krag",
                             "russiansoldier__spawnradiodeploy"})
            # Krag was built again with clips this run; Gone has no rig.
            self.assertEqual([("GermanSoldier", "SpawnradioDeploy"),
                              ("RussianSoldier", "SpawnradioDeploy")],
                             [(r["soldier"], r["weapon"]) for r in rows])
            self.assertEqual(rows, json.loads((out / "unanimated.json").read_text()))

    def test_no_row_and_no_file_writes_nothing(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            self.assertEqual([], extract_viewmodel.merge_unanimated(Path(tmp), [], set(), set()))
            self.assertFalse((Path(tmp) / "unanimated.json").exists())

    def test_the_static_audit_reads_the_record_and_the_kit_poses(self) -> None:
        self.assertTrue(never_animated(CHAIN, "SpawnradioDeploy").startswith(
            audit_mod.NEVER_ANIMATED_PREFIX))
        self.assertIn("viewmodel-never-animated", audit_mod.ACCEPTED)
        with tempfile.TemporaryDirectory() as tmp:
            models = Path(tmp)
            (models / "viewmodels").mkdir()
            (models / "poses").mkdir()
            (models / "viewmodels" / "unanimated.json").write_text(json.dumps([
                {"soldier": "GermanSoldier", "weapon": "SpawnradioDeploy", "reason": "r"}]))
            (models / "poses" / "poses-matrix.json").write_text(json.dumps({"pairs": [
                {"soldier": "RussianSoldier", "weapon": "SpawnradioDeploy",
                 "error": "no state", "absent": never_animated(CHAIN, "SpawnradioDeploy")},
                {"soldier": "ItalianSoldier", "weapon": "RPG29", "error": "e",
                 "absent": "its third-person clip is in no archive"}]}))
            found = audit_mod.unanimated_rigs(models / "viewmodels")
        self.assertEqual({"germansoldier__spawnradiodeploy", "russiansoldier__spawnradiodeploy"},
                         set(found))
        self.assertEqual("r", found["germansoldier__spawnradiodeploy"])


if __name__ == "__main__":
    unittest.main()
