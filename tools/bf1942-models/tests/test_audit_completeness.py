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


if __name__ == "__main__":
    unittest.main()
