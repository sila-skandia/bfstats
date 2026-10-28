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

    @unittest.skipUnless(shutil.which("node"), "node not installed")
    def test_verdicts_node_suite(self):
        # `audit_verdicts.mjs`: a hull still slewing from a knock when D goes
        # down is not a reversed steer, and an aim axis its own data holds
        # still is not a dead one (tests/test_audit_verdicts.mjs).
        proc = subprocess.run(["node", str(ROOT / "tests" / "test_audit_verdicts.mjs")],
                              capture_output=True, text=True, timeout=60)
        self.assertEqual(0, proc.returncode, proc.stdout + proc.stderr)

    def test_its_server_fetches_evicted_store_blobs(self):
        # 2026-10-28: evict_glbs.py left the vanilla PanzerIV, T34, Willy,
        # Corsair and Zero cockpit, wreck and pose blobs on the volume alone;
        # the harness's --no-remote server 404'd them and every run reported
        # asset.404 for blobs mesh.bfstats.io serves. Same server as the
        # pipeline's (mod_pipeline.py).
        text = (ROOT / "audit_behaviour.mjs").read_text()
        self.assertIn("'serve_viewer.py'), String(PORT), '--remote-store-only']", text)
        self.assertNotIn("'--no-remote'", text)

    def test_no_mod_or_level_names_in_the_harness(self):
        text = (ROOT / "audit_behaviour.mjs").read_text().lower()
        for word in ("forgotten", "gold_beach", "omaha", "tarawa", "iwo_jima", "prokhorovka",
                     "ramelle", "'fh'", "fhsw", "wake", "el_alamein"):
            self.assertNotIn(word, text.replace("`", ""), word)

    def test_the_flag_stand_knows_a_kill_trap_and_a_dead_tester(self):
        # FH's push maps cage a flag the attacker may not take yet (a
        # `PushCage` or `*killerCage25mHard` an ObjectSpawner filed under the
        # flag before it stands there, whose SupplyDepot kills anyone inside).
        # The tester dies within a second and the flag stays the owner's:
        # eastern_blitz's INDUSTRIAL_ZONE read that as a law mismatch, and a
        # dead tester (`__soldier()` null) aborted the whole flags phase.
        text = (ROOT / "audit_behaviour.mjs").read_text()
        body = text[text.index("async function flagPhase"):text.index("async function botPhase")]
        self.assertIn("__killZones", body)
        self.assertIn("'flag.kill-trap'", body)
        self.assertIn("'flag.tester-died'", body)
        self.assertNotRegex(body, r"window\.__soldier\(\);\s*return\s+x\.hp")
        spawns = text[text.index("async function spawnPhase"):text.index("async function seatSpawnPhase")]
        self.assertNotRegex(spawns, r"const q = window\.__soldier\(\);")

    def test_a_stand_outside_the_combat_area_names_the_bleed(self):
        # 2026-10-28: two FHSWEurope flags (a team-1 base past the level's
        # playable pocket, on terrain material 7) killed the tester 18 s into
        # the stand -- the CA-5 material bleed, 10 s then 5 HP/s, retail's own
        # -- and the report said "no killing blow recorded". The blow was
        # recorded; the stand counted the capped list's length (64 once hulls
        # had burnt out on their pads, so `slice(64)` was always empty) and
        # took the newest blow of any Armor (a hull's critical burn).
        text = (ROOT / "audit_behaviour.mjs").read_text()
        opener = text[text.index("async open()"):text.index("ev(fn, arg)")]
        self.assertIn("seq: ++window.__killSeq", opener)
        self.assertIn("Object.defineProperty(Armor.prototype, 'hitPoints'", opener)
        body = text[text.index("async function flagPhase"):text.index("async function botPhase")]
        self.assertIn("'flag.outside-combat-area'", body)
        self.assertIn("'flag.stand-in-barbed-wire'", body)
        self.assertIn("window.__combatArea?.()", body)
        self.assertIn("b.seq > n", body)
        self.assertIn("b.max === max", body)
        self.assertNotIn("(window.__killBlows ?? []).length", text)

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
