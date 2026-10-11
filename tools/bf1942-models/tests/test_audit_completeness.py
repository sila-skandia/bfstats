from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import audit_completeness as ac  # noqa: E402
import audit_mod  # noqa: E402

HERE = Path(__file__).resolve().parents[1]


class RegistryTests(unittest.TestCase):
    def test_every_artifact_names_a_real_owning_script(self) -> None:
        for art in ac.ARTIFACTS:
            self.assertIn(art.severity, ac.SEVERITIES, art.rel)
            script = art.script
            self.assertTrue((HERE / script).is_file()
                            or (HERE.parents[1] / "scripts" / Path(script).name).is_file(),
                            f"{art.rel}: owning script {script} does not exist")

    def test_artifact_keys_are_unique(self) -> None:
        keys = [(a.root, a.rel) for a in ac.ARTIFACTS]
        self.assertEqual(len(keys), len(set(keys)))

    def test_the_class_extract_all_omits_is_named(self) -> None:
        outside = {a.rel for a in ac.ARTIFACTS if a.script not in ac.EXTRACT_ALL_RUNS}
        self.assertIn("deployables.json", outside)
        self.assertIn("_shared/bot-names.json", outside)
        self.assertIn("_shared/movies/background.webm", outside)


class AcceptedTests(unittest.TestCase):
    def test_an_acceptance_without_evidence_is_ignored(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            old = ac.ACCEPTED_DIR
            ac.ACCEPTED_DIR = Path(tmp)
            try:
                (Path(tmp) / "x.json").write_text(json.dumps([
                    {"cause_key": "a", "evidence": ""},
                    {"cause_key": "b", "evidence": "the install lacks it"}]))
                self.assertEqual(["b"], [e["cause_key"] for e in ac.load_accepted("x")])
            finally:
                ac.ACCEPTED_DIR = old


class FindingSchemaTests(unittest.TestCase):
    def test_record_carries_the_common_schema(self) -> None:
        f = audit_mod.Finding("completeness", "missing-x", "x.json", "why", "lv")
        f.severity, f.owning_script = "major", "extract_x.py"
        row = f.record()
        for key in ("check", "level", "item", "severity", "cause_key",
                    "owning_script", "evidence"):
            self.assertIn(key, row)
        self.assertEqual("lv", row["level"])
        self.assertTrue(f.is_failure())

    def test_minor_and_accepted_do_not_fail(self) -> None:
        f = audit_mod.Finding("completeness", "c", "i")
        f.severity = "minor"
        self.assertFalse(f.is_failure())
        g = audit_mod.Finding("completeness", "c", "i")
        g.severity, g.accepted = "major", "evidence"
        self.assertFalse(g.is_failure())
        self.assertIsNone(
            audit_mod.Finding("completeness", "c", "i").record()["level"])


class RunOnAnEmptyTreeTests(unittest.TestCase):
    def test_a_bare_tree_reports_its_blockers(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "models").mkdir()
            (root / "maps").mkdir()
            tree = audit_mod.Tree("fh", root / "models", root / "maps",
                                  root / "tex", [])

            class NoGame:
                ok = False
                chain: list = []

            ctx: dict = {}
            out = ac.run(tree, NoGame(), ctx, audit_mod.Finding)
            causes = {f.cause: f for f in out}
            self.assertEqual("blocker", causes["missing-models.json"].severity)
            self.assertEqual("blocker", causes["missing-maps.json"].severity)
            self.assertEqual("extract_deployables.py",
                             causes["missing-deployables.json"].owning_script)


class LevelVehicleResolvesInTreeTests(unittest.TestCase):
    """A replay reads each hull from the mod's own tree: a spawner template
    that vanilla draws and the mod's models.json lacks draws nothing."""

    def _run(self, tmp: Path, mod_models: list[str]):
        viewer = tmp / "viewer"
        (viewer / "models" / "mods").mkdir(parents=True)
        (viewer / "maps" / "mods").mkdir(parents=True)
        (viewer / "models" / "models.json").write_text(json.dumps(
            [{"name": "Willy"}, {"name": "Spitfire"}, {"name": "Colt"}]))
        models, maps = tmp / "mod-models", tmp / "mod-maps"
        (maps / "agheila").mkdir(parents=True)
        models.mkdir()
        (models / "models.json").write_text(json.dumps(
            [{"name": n} for n in mod_models]))
        (maps / "agheila" / "scene.json").write_text(json.dumps({"objectSpawns": [
            {"vehicle": "willy", "templates": {"1": "Willy", "2": "Spitfire"}},
            {"vehicle": "Flettner", "templates": {"1": "Flettner"}},
        ]}))
        (maps / "maps.json").write_text("[]")
        tree = audit_mod.Tree("xpack2", models, maps, tmp / "tex", ["agheila"])

        class NoGame:
            ok = False
            chain: list = []

        old = ac.VIEWER
        ac.VIEWER = viewer
        try:
            return ac.run(tree, NoGame(), {}, audit_mod.Finding)
        finally:
            ac.VIEWER = old

    def test_vanilla_templates_missing_from_the_mod_tree_are_found(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            out = self._run(Path(tmp), ["Flettner"])
        found = {f.subject for f in out if f.cause == "level-vehicle-model-not-in-tree"}
        # Willy once, however many ways it is spelled; Flettner is the mod's
        # own and is in the tree; vanilla's Spitfire is spawned and absent.
        self.assertEqual({"Willy", "Spitfire"}, found)
        self.assertTrue(all(f.severity == "major" and f.owning_script == "extract_all.py"
                            for f in out if f.cause == "level-vehicle-model-not-in-tree"))

    def test_a_complete_tree_has_none(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            out = self._run(Path(tmp), ["Flettner", "Willy", "Spitfire"])
        self.assertEqual([], [f for f in out if f.cause == "level-vehicle-model-not-in-tree"])


if __name__ == "__main__":
    unittest.main()
