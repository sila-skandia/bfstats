"""verify.sh's test selection (scripts/select_model_tests.py): a change runs the
tool tests that reference it, directly or through other files, and no more.

The owner's ask (2026-11-02): "if we change a subset of the system we don't
re-run everything". features/verify-test-selection/README.md.
"""

from __future__ import annotations

import subprocess
import sys
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
SELECTOR = REPO / "scripts" / "select_model_tests.py"


def at(stem: str, ext: str) -> str:
    """A sample path, built so this file does not itself name it: the selector
    reads a path literal as a use, and would run this test for every README."""
    return f"{stem}.{ext}"


def select(*files: str, explain: bool = False) -> tuple[list[str], str]:
    args = [sys.executable, str(SELECTOR), "--files", *files] + (["--explain"] if explain else [])
    proc = subprocess.run(args, capture_output=True, text=True, timeout=120, check=True)
    return proc.stdout.split(), proc.stderr


class SelectionTests(unittest.TestCase):
    def test_a_viewer_module_runs_the_tests_that_reach_it(self) -> None:
        picked, why = select(at("tools/bf1942-models/viewer/replay-accuracy", "js"), explain=True)
        self.assertIn("test_replay_accuracy", picked)
        self.assertIn("replay_accuracy_harness.mjs <- replay-accuracy.js", why)
        # A subset, not the suite.
        self.assertLess(len(picked), 200)

    def test_a_module_reaches_through_its_importers(self) -> None:
        # replay-recording.js is imported by replay-accuracy.js, which the
        # accuracy harness imports.
        picked, _ = select(at("tools/bf1942-models/viewer/replay-recording", "js"))
        self.assertIn("test_replay_accuracy", picked)

    def test_a_python_import_is_a_reference(self) -> None:
        picked, _ = select(at("tools/bf1942-models/audit_mod", "py"))
        self.assertIn("test_audit_mod", picked)

    def test_a_change_outside_the_tools_runs_none(self) -> None:
        self.assertEqual(select(at("api/Program", "cs"))[0], [])
        self.assertEqual(select()[0], [])

    def test_a_folder_scan_runs_on_what_it_watches(self) -> None:
        # test_world_damage scans viewer/*.js and says so.
        self.assertIn("test_world_damage", select(at("tools/bf1942-models/viewer/brand-new-module", "js"))[0])
        self.assertIn("test_features_catalogue", select(at("features/some-new-folder/README", "md"))[0])
        self.assertNotIn("test_features_catalogue", select(at("tools/bf1942-models/viewer/replay", "js"))[0])

    def test_changing_the_selection_runs_everything(self) -> None:
        self.assertEqual(select(at("scripts/verify", "sh"))[0], ["ALL"])
        self.assertEqual(select(at("scripts/select_model_tests", "py"))[0], ["ALL"])


if __name__ == "__main__":
    unittest.main()
