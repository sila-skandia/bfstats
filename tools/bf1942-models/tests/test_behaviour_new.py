"""`mod_pipeline.py` v_behaviour_new and v_harness: which levels a run baked
for the first time, how the quick behaviour check's verdict is reached, and
how the node harness output is read. Fixtures only: no browser, no server, no
game install.
"""

from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import mod_pipeline as M  # noqa: E402


def args(**kw):
    base = dict(levels=None, pick=None, all_own_levels=False, dry_run=False,
                no_behaviour_new=False, only_steps=None)
    base.update(kw)
    return SimpleNamespace(**base)


def finding(level, cause, severity="major", **kw):
    return {"check": cause.split(".")[0], "level": level, "template_or_kit": "T",
            "severity": severity, "cause_key": cause, "evidence": "seen", **kw}


def gate(rows, levels, status="partial"):
    return M.GateResult("behaviour", status, "rc=0", M.normalise_external(rows, "behaviour"),
                        "node audit_behaviour.mjs", 12.0, levels)


class NewLevelSet(unittest.TestCase):
    def test_only_levels_maps_json_did_not_list(self):
        self.assertEqual(["Kharkov"], M.new_level_set(["Karelia", "Kharkov"], ["karelia"],
                                                      bakes=True, force=False))

    def test_force_counts_every_requested_level(self):
        self.assertEqual(["Karelia", "Kharkov"],
                         M.new_level_set(["Karelia", "Kharkov"], ["karelia"], bakes=True, force=True))

    def test_a_run_that_bakes_nothing_has_no_new_levels(self):
        self.assertEqual([], M.new_level_set(["Kharkov"], [], bakes=False, force=True))

    def test_case_insensitive_and_unique(self):
        self.assertEqual(["Kharkov"], M.new_level_set(["Kharkov", "kharkov"], [], bakes=True, force=False))


class Plan(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        t = Path(self.tmp.name)
        self.paths = {k: t / k for k in ("models", "maps", "shared", "models_root", "maps_root")}
        for p in self.paths.values():
            p.mkdir()
        self.state_path = t / "state.json"
        self.write_maps(["karelia"])

    def tearDown(self):
        self.tmp.cleanup()

    def write_maps(self, dirs):
        rows = [{"name": d.title(), "report": f"{d}/scene.json"} for d in dirs]
        (self.paths["maps"] / "maps.json").write_text(json.dumps(rows))

    def ctx(self, names, force=False):
        c = M.Context(cfg=M.MODS["fh"], paths=self.paths, level_names=list(names),
                      levels=[n.lower() for n in names])
        c.force = force
        return c

    def plan(self, a, names, steps=None, force=False):
        ctx = self.ctx(names, force)
        state = M.State(self.state_path)
        with mock.patch("sys.stderr"):
            got = M.behaviour_new_plan(a, ctx, state, steps or list(M.STEPS))
        return got, ctx, state

    def test_new_levels_are_recorded_and_the_step_is_made_to_run(self):
        got, ctx, state = self.plan(args(levels=["Karelia", "Kharkov"]), ["Karelia", "Kharkov"])
        self.assertEqual(["Kharkov"], got)
        self.assertTrue(ctx.behaviour_new)
        saved = json.loads(self.state_path.read_text())
        self.assertEqual(["Kharkov"], saved["behaviour_new"]["pending"])
        self.assertEqual("pending", saved["steps"]["v_behaviour_new"]["status"])

    def test_a_resumed_run_still_knows_the_set(self):
        self.plan(args(levels=["Kharkov"]), ["Kharkov"])
        self.write_maps(["karelia", "kharkov"])          # the first run baked it, then stopped
        got, _, _ = self.plan(args(levels=["Kharkov"]), ["Kharkov"])
        self.assertEqual(["Kharkov"], got)

    def test_a_forced_rebake_counts_as_new(self):
        got, _, _ = self.plan(args(levels=["Karelia"]), ["Karelia"], force=True)
        self.assertEqual(["Karelia"], got)

    def test_no_levels_step_no_new_levels(self):
        steps = [M.step_by_name("kits"), M.step_by_name("v_behaviour_new")]
        got, _, _ = self.plan(args(levels=["Kharkov"]), ["Kharkov"], steps=steps)
        self.assertEqual([], got)

    def test_the_baked_set_without_force_bakes_nothing(self):
        got, _, _ = self.plan(args(), ["Karelia"])
        self.assertEqual([], got)

    def test_only_the_behaviour_step_with_levels_checks_them(self):
        steps = [M.step_by_name("v_behaviour_new")]
        got, _, _ = self.plan(args(levels=["Karelia"], only_steps=["v_behaviour_new"]),
                              ["Karelia"], steps=steps)
        self.assertEqual(["Karelia"], got)

    def test_dry_run_writes_nothing_and_opt_out_defers(self):
        got, ctx, _ = self.plan(args(levels=["Kharkov"], dry_run=True), ["Kharkov"])
        self.assertEqual(["Kharkov"], got)
        self.assertFalse(ctx.behaviour_new)
        self.assertFalse(self.state_path.exists())
        _, ctx, _ = self.plan(args(levels=["Kharkov"], no_behaviour_new=True), ["Kharkov"])
        self.assertFalse(ctx.behaviour_new)
        self.assertEqual(["Kharkov"], json.loads(self.state_path.read_text())["behaviour_new"]["pending"])

    def finish(self, summary, status="done"):
        got, ctx, state = self.plan(args(levels=["Kharkov"]), ["Kharkov"])
        self.assertEqual(["Kharkov"], got)
        self.write_maps(["karelia", "kharkov"])          # the run's bake registers it
        out = Path(self.tmp.name) / "out"
        (out / "fh" / "gates").mkdir(parents=True)
        (out / "fh" / "gates" / "behaviour-new.summary.json").write_text(json.dumps(summary))
        with mock.patch.object(M, "OUT_ROOT", out), mock.patch("builtins.print"):
            M.behaviour_new_finish(ctx, state, [{"step": "v_behaviour_new", "status": status}],
                                   dry_run=False)
        return json.loads(self.state_path.read_text())["behaviour_new"]

    def test_a_pass_clears_the_set(self):
        rec = self.finish({"ok": True, "status": "partial", "verdict": "pass", "levels": ["Kharkov"]})
        self.assertEqual([], rec["pending"])
        self.assertIn("Kharkov", rec["checked"])

    def test_a_failure_keeps_the_set(self):
        rec = self.finish({"ok": False, "status": "partial", "verdict": "fail", "levels": ["Kharkov"]},
                          status="failed")
        self.assertEqual(["Kharkov"], rec["pending"])

    def test_a_skip_keeps_the_set(self):
        rec = self.finish({"ok": True, "status": "skipped", "levels": ["Kharkov"]})
        self.assertEqual(["Kharkov"], rec["pending"])


class Verdict(unittest.TestCase):
    def test_minor_and_info_pass(self):
        v = M.behaviour_new_verdict(gate([finding("A", "kit.no-fire-clip", "minor"),
                                          finding("A", "veh.no-model", "info")], ["A"]), ["A"])
        self.assertTrue(v["ok"])
        self.assertEqual("pass", v["verdict"])

    def test_an_open_major_fails_and_play_breaking_comes_first(self):
        v = M.behaviour_new_verdict(gate([finding("A", "asset.404"), finding("A", "asset.404"),
                                          finding("A", "kit.weapon-no-fire")], ["A"]), ["A"])
        self.assertFalse(v["ok"])
        self.assertEqual("kit.weapon-no-fire", v["rows"][0]["cause"])
        self.assertTrue(v["rows"][0]["what"].startswith("play-breaking"))
        self.assertEqual(2, v["rows"][1]["count"])

    def test_an_accepted_major_with_evidence_passes(self):
        v = M.behaviour_new_verdict(gate([finding("A", "veh.no-engine-sound", accepted=True,
                                                  retail_faithful=True)], ["A"]), ["A"])
        self.assertTrue(v["ok"])
        self.assertEqual(1, v["counts"]["accepted"])

    def test_could_not_stage_is_not_a_pass(self):
        with tempfile.TemporaryDirectory() as t:
            out = Path(t) / "b.json"
            out.write_text(json.dumps({"levels": [], "findings": []}))
            ctx = M.Context(cfg=M.MODS["fh"], behaviour_args=["--quick"])
            g = M._behaviour_result(ctx, out, subprocess.CompletedProcess([], 2), [], 1.0)
        v = M.behaviour_new_verdict(g, ["A"])
        self.assertFalse(v["ok"])
        self.assertEqual("failed-to-run", v["verdict"])

    def test_a_quick_run_is_partial_never_a_sweep(self):
        with tempfile.TemporaryDirectory() as t:
            out = Path(t) / "b.json"
            out.write_text(json.dumps({"levels": [{"level": "A"}], "findings": []}))
            ctx = M.Context(cfg=M.MODS["fh"], behaviour_args=["--quick"])
            g = M._behaviour_result(ctx, out, subprocess.CompletedProcess([], 0), [], 1.0)
        self.assertEqual("partial", g.status)
        self.assertTrue(M.behaviour_new_verdict(g, ["A"])["ok"])

    def test_a_level_the_audit_never_reported_fails(self):
        v = M.behaviour_new_verdict(gate([], ["A"]), ["A", "B"])
        self.assertFalse(v["ok"])
        self.assertEqual(["B"], v["not_covered"])


class Running(unittest.TestCase):
    def test_resolve_matches_name_or_directory_and_keeps_apostrophes(self):
        rows = [{"name": "charlie_don't_surf", "report": "charlie_don't_surf/scene.json"},
                {"name": "203_hill-1904", "report": "203_hill-1904/scene.json"}]
        self.assertEqual((["charlie_don't_surf", "203_hill-1904"], ["Nowhere"]),
                         M.resolve_new_levels(["Charlie_Don't_Surf", "203_HILL-1904", "Nowhere"], rows))

    def test_gate_behaviour_passes_the_levels_as_one_argv_entry(self):
        seen = {}

        def fake(argv, timeout=7200, chromium=False):
            seen.update(argv=argv, timeout=timeout, chromium=chromium)
            Path(argv[argv.index("--json") + 1]).write_text(json.dumps({"levels": [], "findings": []}))
            return subprocess.CompletedProcess(argv, 0, "", ""), 1.0
        with tempfile.TemporaryDirectory() as t, mock.patch.object(M, "_run_capture", fake):
            ctx = M.Context(cfg=M.MODS["fh"], behaviour_args=["--quick"])
            M.gate_behaviour(ctx, Path(t), "http://127.0.0.1:5350", levels=["a'b", "c"],
                             out_name="behaviour-new.json", timeout=99, log=Path(t) / "x.log")
            self.assertTrue((Path(t) / "x.log").is_file())
        a = seen["argv"]
        self.assertEqual("a'b,c", a[a.index("--levels") + 1])
        self.assertIn("--quick", a)
        self.assertTrue(seen["chromium"])
        self.assertEqual(99, seen["timeout"])

    def test_nothing_new_passes_without_a_browser(self):
        with tempfile.TemporaryDirectory() as t, mock.patch.object(M, "OUT_ROOT", Path(t)), \
                mock.patch.object(M, "ViewerServer", side_effect=AssertionError("no server")):
            M.run_behaviour_new(M.Context(cfg=M.MODS["fh"], behaviour_new=True))

    def test_a_failing_check_raises_with_the_first_row(self):
        with tempfile.TemporaryDirectory() as t:
            paths = {k: Path(t) / k for k in ("models", "maps", "shared", "models_root", "maps_root")}
            for p in paths.values():
                p.mkdir()
            (paths["maps"] / "maps.json").write_text(json.dumps([{"name": "A", "report": "a/scene.json"}]))
            ctx = M.Context(cfg=M.MODS["fh"], paths=paths, behaviour_new=True, new_levels=["A"])
            srv = mock.MagicMock()
            srv.__enter__.return_value = SimpleNamespace(proc=SimpleNamespace(poll=lambda: None),
                                                         url="http://127.0.0.1:5350")
            with mock.patch.object(M, "OUT_ROOT", Path(t) / "out"), \
                    mock.patch.object(M, "ViewerServer", return_value=srv), \
                    mock.patch.object(M, "free_viewer_port", return_value=5350), \
                    mock.patch.object(M, "run_static_audits", return_value=([], [])), \
                    mock.patch.object(M, "gate_behaviour",
                                      return_value=gate([finding("A", "veh.immobile")], ["A"])):
                with self.assertRaises(RuntimeError) as cm:
                    M.run_behaviour_new(ctx)
            self.assertIn("veh.immobile", str(cm.exception))
            summary = json.loads((Path(t) / "out" / "fh" / "gates" / "behaviour-new.summary.json").read_text())
            self.assertEqual("fail", summary["verdict"])

    def test_the_audit_reads_the_static_sound_audit(self):
        # `staticExplains` needs the static sound audit: an engine or a gun
        # script no archive holds is silent in retail (FHSW's B4howitzer). A
        # run of this step alone makes the file and hands it over.
        with tempfile.TemporaryDirectory() as t:
            paths = {k: Path(t) / k for k in ("models", "maps", "shared", "models_root", "maps_root")}
            for p in paths.values():
                p.mkdir()
            (paths["maps"] / "maps.json").write_text(json.dumps([{"name": "A", "report": "a/scene.json"}]))
            ctx = M.Context(cfg=M.MODS["fh"], paths=paths, behaviour_new=True, new_levels=["A"])
            srv = mock.MagicMock()
            srv.__enter__.return_value = SimpleNamespace(proc=SimpleNamespace(poll=lambda: None),
                                                         url="http://127.0.0.1:5350")
            seen = {}

            def made(c, out_dir, audits=()):
                seen["audits"] = tuple(audits)
                (out_dir / "sound.json").write_text("[]")
                return [], []

            def gated(qctx, work, url, **kw):
                seen["args"] = list(qctx.behaviour_args)
                return gate([], ["A"])
            with mock.patch.object(M, "OUT_ROOT", Path(t) / "out"), \
                    mock.patch.object(M, "ViewerServer", return_value=srv), \
                    mock.patch.object(M, "free_viewer_port", return_value=5350), \
                    mock.patch.object(M, "run_static_audits", side_effect=lambda c, d, audits=(): (
                        d.mkdir(parents=True, exist_ok=True), made(c, d, audits))[1]), \
                    mock.patch.object(M, "gate_behaviour", side_effect=gated):
                M.run_behaviour_new(ctx)
            self.assertEqual(("sound",), seen["audits"])
            self.assertEqual("--static", seen["args"][1])
            self.assertTrue(seen["args"][2].endswith("fh/static/sound.json"))

    def test_the_port_is_never_the_owners(self):
        port = M.free_viewer_port()
        self.assertIn(port, M.BEHAVIOUR_NEW_PORTS)
        self.assertNotEqual(M.OWNER_PORT, port)

    def test_the_step_is_registered_after_the_completion_steps(self):
        s = M.step_by_name("v_behaviour_new")
        # after every extract step, not only the registry's: the page reads
        # loadouts, collision, voices and the HUD pack too
        self.assertEqual({x.name for x in M.STEPS if x.kind == "extract"}, set(s.after))
        self.assertEqual("run_behaviour_new", s.action)
        self.assertFalse(M.build_parser().parse_args(["run", "--mod", "fh"]).no_behaviour_new)
        self.assertTrue(M.build_parser().parse_args(["run", "--mod", "fh", "--no-behaviour-new"])
                        .no_behaviour_new)


class Harness(unittest.TestCase):
    def test_parse_ok_and_failures(self):
        ok = M.parse_unittest_output("....\n------\nRan 4 tests in 0.5s\n\nOK (skipped=1)\n", 0)
        self.assertEqual({"tests": 4, "skipped": 1, "failed": [], "ok": True}, ok)
        bad = M.parse_unittest_output(
            "FAIL: test_x (tests.test_flight.Flight.test_x)\n---\nRan 2 tests in 1.0s\n\nFAILED (failures=1)\n", 1)
        self.assertFalse(bad["ok"])
        self.assertEqual(["FAIL tests.test_flight.Flight.test_x"], bad["failed"])

    def test_the_harness_list_exists_and_leaves_out_this_file(self):
        for t in M.HARNESS_TESTS:
            self.assertTrue((ROOT / "tests" / f"{t}.py").is_file(), t)
        self.assertNotIn("test_mod_pipeline", M.HARNESS_TESTS)
        self.assertNotIn("test_behaviour_new", M.HARNESS_TESTS)

    def test_off_for_a_context_built_by_hand(self):
        rows = M.check_node_harnesses(M.Context(cfg=M.MODS["fh"]))
        self.assertTrue(rows[0]["ok"])
        self.assertIn("not run", rows[0]["detail"])


if __name__ == "__main__":
    unittest.main()
