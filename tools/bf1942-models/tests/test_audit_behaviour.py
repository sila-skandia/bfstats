"""The behavioural audit's contract, without a browser.

The harness itself needs a GPU and a served viewer (`audit_behaviour.mjs`); what
can be pinned here is that it parses, that its wrapper builds the command the
pipeline relies on, that the summary groups by the stable cause key, and that
the accepted list (when present) carries evidence on every entry.
"""

import json
import shutil
import subprocess
import unittest
from argparse import Namespace
from pathlib import Path

import audit_behaviour

ROOT = Path(__file__).resolve().parents[1]


class AuditBehaviourContract(unittest.TestCase):
    @unittest.skipUnless(shutil.which("node"), "node not installed")
    def test_harness_parses(self):
        subprocess.run(["node", "--check", str(ROOT / "audit_behaviour.mjs")], check=True)

    def test_no_mod_or_level_names_in_the_harness(self):
        text = (ROOT / "audit_behaviour.mjs").read_text().lower()
        for word in ("forgotten", "gold_beach", "omaha", "tarawa", "iwo_jima", "prokhorovka",
                     "ramelle", "'fh'", "fhsw", "wake", "el_alamein"):
            self.assertNotIn(word, text.replace("`", ""), word)

    def test_command_builds_the_pipeline_call(self):
        ns = Namespace(mod="fh", levels="all", port=5311, quick=True, json="o.json", only="kits", url=None)
        cmd = audit_behaviour.command(ns, ["--vehicle", "Pak"])
        self.assertEqual(cmd[:3], ["flock", "/tmp/claude-1000/chromium.lock", "node"])
        for token in ("--mod", "fh", "--quick", "--json", "o.json", "--only", "kits", "--vehicle", "Pak"):
            self.assertIn(token, cmd)

    def test_summary_groups_by_cause_key_and_marks_accepted(self):
        report = {"findings": [
            {"severity": "major", "cause_key": "veh.immobile", "accepted": False},
            {"severity": "major", "cause_key": "veh.immobile", "accepted": False},
            {"severity": "major", "cause_key": "veh.immobile", "accepted": True},
            {"severity": "minor", "cause_key": "veh.wheels-static"}]}
        s = audit_behaviour.summarise(report)
        self.assertEqual(s["major"]["veh.immobile"], 2)
        self.assertEqual(s["major"]["veh.immobile [accepted]"], 1)
        self.assertEqual(s["minor"]["veh.wheels-static"], 1)

    def test_accepted_entries_carry_evidence(self):
        path = ROOT / "audit_behaviour_accepted.json"
        if not path.exists():
            self.skipTest("no accepted list")
        for entry in json.loads(path.read_text()):
            self.assertTrue(entry.get("evidence"), entry)
            self.assertIn("check", entry)


if __name__ == "__main__":
    unittest.main()
