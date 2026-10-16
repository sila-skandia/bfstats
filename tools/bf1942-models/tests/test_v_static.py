"""`mod_pipeline.py` `v_static`: the fast static audits run in `verify` and
after `run`, with no browser and no `--gates`. Play-breaking findings fail the
step and come first; cosmetic ones are listed and do not; an audit that died
is a failure, never a pass (the placement audit crashed on FHSWEurope until
2026-10-15 and nothing noticed)."""

from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import mod_pipeline as M  # noqa: E402


def row(cause, severity="", level="203_hill-1904", audit="kits", accepted=False):
    return {"audit": audit, "check": audit, "cause": cause, "cause_key": cause,
            "subject": "1Rus_AssaultNaganta", "item": "1Rus_AssaultNaganta",
            "detail": "x", "level": level, "severity": severity, "accepted": accepted}


class VStatic(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.ctx = M.Context(cfg=M.MODS["fh"], levels=[], level_names=[],
                             paths={"models": Path(self.tmp.name)})
        self.ctx.static_audits = True

    def tearDown(self):
        self.tmp.cleanup()

    def run_with(self, rows, status=None):
        status = status or [{"audit": a, "ran": True, "seconds": 1.0, "rc": 1, "findings": 1}
                            for a in M.FAST_STATIC_AUDITS]
        with mock.patch.object(M, "OUT_ROOT", Path(self.tmp.name)), \
                mock.patch.object(M, "run_static_audits", return_value=(status, rows)):
            (Path(self.tmp.name) / "fh" / "static").mkdir(parents=True, exist_ok=True)
            return M.check_static_audits(self.ctx)

    def test_a_play_breaking_finding_fails_and_comes_first(self):
        checks = self.run_with([row("texture-magenta", "", audit="textures"),
                                row("kit-level-weapon-no-rig", "blocker"),
                                row("uv-constant", "", audit="textures", accepted=True)])
        self.assertFalse(checks[0]["ok"])
        self.assertEqual("kit-level-weapon-no-rig", checks[0]["cause"])
        self.assertIn("cannot use the weapon", checks[0]["what"])
        self.assertEqual(1, sum(1 for c in checks if not c["ok"]))
        visible = next(c for c in checks if c["what"].startswith("visible"))
        self.assertTrue(visible["ok"])
        self.assertEqual({"texture-magenta": 1}, visible["causes"])

    def test_a_dealt_kit_with_no_kits_json_row_fails_and_the_promoted_majors_list(self):
        # 2026-10-17: the rules gate's kit check is a kits cause; the promoted
        # censuses and probes are majors that are listed, not failing
        checks = self.run_with([row("level-kit-not-in-kits-json", "blocker"),
                                row("lod-rung-beyond-kept-chain", "major", audit="levels"),
                                row("launcher-motor-one-shots-dropped", "major", audit="sound"),
                                row("level-envmap-faces-absent", "info", audit="levels",
                                    accepted=True)])
        bad = [c for c in checks if not c["ok"]]
        self.assertEqual(["level-kit-not-in-kits-json"], [c["cause"] for c in bad])
        self.assertIn("no kit look", bad[0]["what"])
        majors = next(c for c in checks if c["what"].startswith("open majors"))
        self.assertEqual(2, majors["count"])

    def test_cosmetic_and_accepted_findings_pass(self):
        checks = self.run_with([row("uv-constant", "", audit="textures", accepted=True),
                                row("spawn-buried", "", audit="placement")])
        self.assertTrue(all(c["ok"] for c in checks))

    def test_an_audit_that_did_not_finish_fails(self):
        status = [{"audit": "placement", "ran": False, "seconds": 3.0, "rc": 1,
                   "detail": "ValueError: could not convert string to float: '737.619.2'"}]
        checks = self.run_with([], status)
        bad = [c for c in checks if not c["ok"]]
        self.assertEqual(["audit placement"], [c["what"] for c in bad])

    def test_a_context_built_by_hand_or_a_dry_run_skips_it(self):
        self.ctx.static_audits = False
        checks = M.check_static_audits(self.ctx)
        self.assertTrue(checks[0]["ok"])
        self.assertIn("not run", checks[0]["detail"])

    def test_v_static_is_a_verify_step(self):
        self.assertIn("v_static", [s.name for s in M.VERIFY_STEPS])
        self.assertIn("check_static_audits", M.VERIFY_HOOKS)

    def test_a_crashing_audit_process_is_reported_not_run(self):
        ctx = M.Context(cfg=M.ModConfig(id="no-such-tree", install="none"),
                        levels=[], level_names=[], paths={"models": Path(self.tmp.name)})
        status, rows = M.run_static_audits(ctx, Path(self.tmp.name) / "out", audits=("kits",))
        self.assertEqual([], rows)
        self.assertFalse(status[0]["ran"])


if __name__ == "__main__":
    unittest.main()
