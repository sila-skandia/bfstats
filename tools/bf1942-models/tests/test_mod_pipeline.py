"""`mod_pipeline.py`: the recipe is ordered, resumable and fails closed.

No game install and no extracted tree are needed except where a test says so
(those skip cleanly). Nothing here runs an extractor or a browser.
"""

from __future__ import annotations

import glob
import json
import os
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import mod_pipeline as M  # noqa: E402

REPO = ROOT.parents[1]
FH_TREE = ROOT / "viewer" / "maps" / "mods" / "fh" / "maps.json"
GAME = Path.home() / ".wine/drive_c/EA Games/Battlefield 1942"


def names():
    return [s.name for s in M.STEPS]


class RecipeShape(unittest.TestCase):
    def test_names_are_unique_and_after_refers_to_earlier_steps(self):
        n = names()
        self.assertEqual(len(n), len(set(n)))
        for i, s in enumerate(M.STEPS):
            for a in s.after:
                self.assertIn(a, n[:i], f"{s.name} must come after {a}")

    def test_ordering_constraints_the_owner_found_by_hand(self):
        pos = {n: i for i, n in enumerate(names())}
        # build_mods_manifest.py after the work it counts, thumbs after the
        # manifest, and the manifest again after thumbs (and last)
        for dep in ("models", "levels", "kits", "viewmodels"):
            self.assertLess(pos[dep], pos["manifest"])
        self.assertLess(pos["manifest"], pos["thumbs"])
        self.assertLess(pos["thumbs"], pos["manifest_final"])
        self.assertEqual(pos["manifest_final"], len(pos) - 1)
        # extract_kits and extract_viewmodel read maps.json, so levels first
        self.assertLess(pos["levels"], pos["kits"])
        self.assertLess(pos["levels"], pos["viewmodels"])
        self.assertLess(pos["kits"], pos["viewmodels"])
        self.assertIn("{maps}/maps.json", M.step_by_name("kits").needs)
        self.assertIn("{maps}/maps.json", M.step_by_name("viewmodels").needs)
        # flag cloth after the bakes, optimise after flag cloth
        self.assertLess(pos["levels"], pos["flag_cloth"])
        self.assertLess(pos["flag_cloth"], pos["optimise"])

    def test_every_extractor_is_a_step_or_explained(self):
        used = {t for s in M.STEPS for c in s.cmds for t in c if t.endswith((".py", ".mjs"))}
        for p in glob.glob(str(ROOT / "extract_*.py")):
            n = os.path.basename(p)
            self.assertTrue(n in used or n in M.NOT_A_STEP,
                            f"{n} is neither a recipe step nor in NOT_A_STEP")
        for n in M.NOT_A_STEP:
            self.assertTrue((ROOT / n).is_file(), n)

    def test_every_script_a_step_names_exists(self):
        for s in M.STEPS:
            for c in s.cmds:
                for t in c:
                    if t.endswith((".py", ".mjs")):
                        self.assertTrue((ROOT / t).is_file(), f"{s.name}: {t}")

    def test_no_step_runs_a_subset_extract_into_the_tree(self):
        # models.json is rewritten by any extract_models run; the only step that
        # may run it is the full `models` step, and extract_models.py itself is
        # reached only through reextract_models_subset's scratch directory
        for s in M.STEPS:
            for c in s.cmds:
                self.assertNotIn("extract_models.py", c)

    def test_expansion_leaves_no_unresolved_tokens(self):
        for cfg in M.MODS.values():
            ctx = M.Context(cfg=cfg, levels=["a"], level_names=["A"])
            for s in M.STEPS:
                if s.when and not getattr(cfg, s.when):
                    continue
                for argv in M.build_argv(s, ctx):
                    for tok in argv:
                        self.assertNotIn("{", tok, f"{cfg.id}/{s.name}: {tok}")

    def test_per_mod_flags(self):
        fhsw = M.Context(cfg=M.MODS["fhsw"], levels=["x"])
        kits = M.build_argv(M.step_by_name("kits"), fhsw)[0]
        self.assertIn("--no-pickups", kits)
        self.assertNotIn("--level-all", M.build_argv(M.step_by_name("models"), fhsw)[0])
        dc = M.Context(cfg=M.MODS["desertcombat"], levels=["x"])
        self.assertTrue(M.MODS["desertcombat"].pose_matrix)
        sel = [s.name for s in M.select_steps(None, None, M.MODS["desertcombat"])]
        self.assertIn("poses_matrix", sel)
        self.assertNotIn("poses_matrix", [s.name for s in M.select_steps(None, None, M.MODS["fh"])])
        del dc

    def test_a_plain_run_bakes_only_levels_with_no_scene_and_force_rebakes(self):
        ctx = M.Context(cfg=M.MODS["fh"], levels=["a"], level_names=["A"])
        argv = M.build_argv(M.step_by_name("levels"), ctx)[0]
        self.assertIn("--skip-existing", argv)
        ctx.force = True
        self.assertNotIn("--skip-existing", M.build_argv(M.step_by_name("levels"), ctx)[0])
        args = M.build_parser().parse_args(["run", "--mod", "fh", "--no-gates"])
        self.assertTrue(args.no_gates)

    def test_levels_expand_to_names_not_directories(self):
        ctx = M.Context(cfg=M.MODS["fh"], levels=["gold_beach-1944"],
                        level_names=["Gold_Beach-1944"])
        argv = M.build_argv(M.step_by_name("levels"), ctx)[0]
        self.assertIn("Gold_Beach-1944", argv)
        self.assertNotIn("gold_beach-1944", argv)

    def test_owner_port_is_refused(self):
        with self.assertRaises(SystemExit):
            M.ViewerServer(5273)
        args = M.build_parser().parse_args(["gates", "--mod", "fh", "--port", "5273"])
        with self.assertRaises(SystemExit):
            M.make_context(args)

    def test_unknown_mod_names_the_fix(self):
        with self.assertRaises(SystemExit) as cm:
            M.resolve_mod("nosuchmod")
        self.assertIn("MODS", str(cm.exception))
        self.assertEqual("fh", M.resolve_mod("FH").id)

    def test_readme_step_table_is_current(self):
        readme = REPO / "features" / "mod-extraction-pipeline" / "README.md"
        text = readme.read_text()
        self.assertIn(M.PROSE_BEGIN, text)
        self.assertIn(M.steps_markdown().strip(), text,
                      "run `python3 mod_pipeline.py prose --write-readme`")


class Resume(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        t = Path(self.tmp.name)
        self.paths = {k: t / k for k in ("models", "maps", "shared", "models_root", "maps_root")}
        for p in self.paths.values():
            p.mkdir()
        self.ctx = M.Context(cfg=M.MODS["fh"], levels=["l1"], paths=self.paths)
        self.state = M.State(t / "state.json")
        self.out = self.paths["models"] / "out.txt"

    def tearDown(self):
        self.tmp.cleanup()

    def step(self, code, minimum=1):
        return M.Step("t", "test", cmds=(("python3", "-c", code),),
                      outputs=((str(self.out), minimum),))

    def run_one(self, step, **kw):
        kw.setdefault("dry_run", False)
        kw.setdefault("force", False)
        with mock.patch.object(M, "OUT_ROOT", Path(self.tmp.name)):
            return M.run_steps([step], self.ctx, self.state,
                               log_dir=Path(self.tmp.name) / "logs", **kw)[0]

    def test_done_is_skipped_then_redone_when_the_output_goes(self):
        step = self.step(f"open({str(self.out)!r},'w').write('x')")
        self.assertEqual("done", self.run_one(step)["status"])
        self.assertEqual("skipped-done", self.run_one(step)["status"])
        self.out.unlink()
        self.assertEqual("done", self.run_one(step)["status"])
        self.assertEqual("done", self.run_one(step, force=True)["status"])

    def test_exit_zero_with_no_output_is_a_failure(self):
        row = self.run_one(self.step("pass"))
        self.assertEqual("failed-outputs", row["status"])
        self.assertEqual("failed", self.state.get("t")["status"])

    def test_a_tolerated_exit_needs_the_marker_and_is_done_with_findings(self):
        code = f"import sys; open({str(self.out)!r},'w').write('x'); print('skins.json: 3', file=sys.stderr); raise SystemExit(1)"
        step = M.Step("t", "test", cmds=(("python3", "-c", code),),
                      outputs=((str(self.out), 1),), tolerate_rc=(1,), done_marker="skins.json:")
        row = self.run_one(step)
        self.assertEqual("done-with-findings", row["status"])
        self.assertEqual("done", self.state.get("t")["status"])
        crash = f"open({str(self.out)!r},'w').write('x'); raise SystemExit(1)"
        step = M.Step("t2", "test", cmds=(("python3", "-c", crash),),
                      outputs=((str(self.out), 1),), tolerate_rc=(1,), done_marker="skins.json:")
        self.assertEqual("failed", self.run_one(step)["status"])

    def test_nonzero_exit_fails_and_stops(self):
        row = self.run_one(self.step("raise SystemExit(3)"))
        self.assertEqual("failed", row["status"])
        self.assertEqual(3, row["rc"])

    def test_dry_run_runs_nothing(self):
        step = self.step(f"open({str(self.out)!r},'w').write('x')")
        row = self.run_one(step, dry_run=True)
        self.assertEqual("would-run", row["status"])
        self.assertFalse(self.out.exists())

    def test_missing_input_blocks(self):
        step = M.Step("t", "test", cmds=(("python3", "-c", "pass"),),
                      needs=(str(self.paths["maps"] / "maps.json"),))
        self.assertEqual("failed-needs", self.run_one(step)["status"])

    def test_a_changed_command_reruns(self):
        a = self.step(f"open({str(self.out)!r},'w').write('1')")
        b = self.step(f"open({str(self.out)!r},'w').write('2')")
        self.run_one(a)
        self.assertEqual("done", self.run_one(b)["status"])
        self.assertEqual("2", self.out.read_text())


class DiskGuard(unittest.TestCase):
    def test_a_step_is_killed_below_the_floor(self):
        with tempfile.TemporaryDirectory() as d:
            started = time.time()
            with mock.patch.object(M, "free_gb", return_value=1.0), \
                    mock.patch.object(M, "GUARD_POLL_S", 0.2), \
                    mock.patch.object(M.time, "sleep", lambda s: None):
                with self.assertRaises(M.DiskGuardTripped):
                    M.run_argv(["sleep", "60"], log=Path(d) / "l.log", guard=True,
                               min_free_gb=15, chromium=False)
            self.assertLess(time.time() - started, 20)
            self.assertIn("GUARD", (Path(d) / "l.log").read_text())

    def test_no_guard_no_kill(self):
        with tempfile.TemporaryDirectory() as d, \
                mock.patch.object(M, "free_gb", return_value=1.0), \
                mock.patch.object(M, "GUARD_POLL_S", 0.2):
            rc = M.run_argv(["sleep", "0.5"], log=Path(d) / "l.log", guard=False,
                            min_free_gb=15, chromium=False)
            self.assertEqual(0, rc)

    def test_chromium_steps_take_the_lock_before_starting(self):
        events = []

        class Lock:
            def __enter__(self):
                events.append("lock")

            def __exit__(self, *a):
                events.append("unlock")
                return False

        with tempfile.TemporaryDirectory() as d, \
                mock.patch.object(M, "chromium_lock", Lock), \
                mock.patch.object(M.subprocess, "Popen") as popen:
            popen.side_effect = lambda *a, **k: (events.append("start"), mock.Mock(
                wait=lambda timeout=None: 0, pid=1))[1]
            M.run_argv(["node", "x.mjs"], log=Path(d) / "l.log", guard=False,
                       min_free_gb=0, chromium=True)
        self.assertEqual(["lock", "start", "unlock"], events)

    def test_the_lock_is_the_flock_cli_lock(self):
        # the real path is the owner's convention; the behaviour is tested on a temp file
        self.assertEqual("/tmp/claude-1000/chromium.lock", M.CHROMIUM_LOCK)
        with tempfile.TemporaryDirectory() as d, \
                mock.patch.object(M, "CHROMIUM_LOCK", str(Path(d) / "c.lock")):
            with M.chromium_lock():
                r = subprocess.run(["flock", "-n", M.CHROMIUM_LOCK, "true"])
                self.assertNotEqual(0, r.returncode)
            r = subprocess.run(["flock", "-n", M.CHROMIUM_LOCK, "true"])
            self.assertEqual(0, r.returncode)


class Thumbs(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self.tmp.name)
        (self.dir / "thumbs").mkdir()
        (self.dir / "thumbs" / "a.png").write_bytes(b"x")
        self.write([{"name": "A", "glb": "A.glb", "thumb": "thumbs/a.png"},
                    {"name": "B", "glb": "B.glb"}])

    def tearDown(self):
        self.tmp.cleanup()

    def write(self, rows):
        (self.dir / "models.json").write_text(json.dumps(rows))

    def read(self):
        return json.loads((self.dir / "models.json").read_text())

    def test_a_rewrite_that_drops_the_keys_has_them_put_back(self):
        with M.ThumbGuard(self.dir):
            self.write([{"name": "A", "glb": "A.glb"}, {"name": "B", "glb": "B.glb"}])
        self.assertEqual("thumbs/a.png", self.read()[0]["thumb"])

    def test_a_key_whose_file_is_gone_is_not_resurrected(self):
        with M.ThumbGuard(self.dir):
            (self.dir / "thumbs" / "a.png").unlink()
            self.write([{"name": "A", "glb": "A.glb"}])
        self.assertNotIn("thumb", self.read()[0])

    def test_subset_copy_moves_only_changed_files_and_keeps_models_json(self):
        scratch = self.dir / "scratch"
        scratch.mkdir()
        (self.dir / "A.glb").write_bytes(b"old")
        (self.dir / "B.glb").write_bytes(b"same")
        (scratch / "A.glb").write_bytes(b"new")
        (scratch / "B.glb").write_bytes(b"same")
        (scratch / "models.json").write_text(json.dumps([{"name": "A", "glb": "A.glb", "triangles": 9}]))
        before = (self.dir / "models.json").read_text()
        written = M.copy_changed(scratch, self.dir)
        self.assertEqual(["A.glb"], written)
        self.assertEqual(before, (self.dir / "models.json").read_text())
        n = M.merge_manifest(self.dir / "models.json", scratch / "models.json")
        self.assertEqual(1, n)
        rows = {r["name"]: r for r in self.read()}
        self.assertEqual(9, rows["A"]["triangles"])
        self.assertEqual("thumbs/a.png", rows["A"]["thumb"])      # thumb key kept
        self.assertIn("B", rows)                                  # untouched row kept

    def test_subset_plan_never_targets_the_tree(self):
        ctx = M.Context(cfg=M.MODS["fh"], levels=[])
        with mock.patch.object(M, "OUT_ROOT", self.dir):
            plan = M.reextract_models_subset(ctx, ["GMC"], dry_run=True)
        out = plan["argv"][plan["argv"].index("--out") + 1]
        self.assertNotEqual(str(ctx.paths["models"]), out)
        self.assertTrue(out.startswith(str(self.dir)))


def F(gate, sev, cause="c", level="", accepted=False, rf=None, item="x"):
    return M.Finding(gate=gate, check=gate, level=level, item=item, severity=sev,
                     cause_key=cause, evidence="e" if accepted else "", accepted=accepted,
                     retail_faithful=rf)


def ran(name, findings=(), levels=None):
    return M.GateResult(name, "ran", findings=list(findings), levels_covered=levels)


class Tiers(unittest.TestCase):
    def gates(self, **over):
        g = {n: ran(n) for n in M.REQUIRED_GATES}
        g.update(over)
        return g

    def tier(self, findings=(), modwide=(), **over):
        gates = self.gates(**over)
        return M.level_tier("l", list(findings), gates, list(modwide))

    def test_clean_is_ready(self):
        self.assertEqual("ready", self.tier()[0])

    def test_a_gate_that_is_not_installed_is_unverified_never_ready(self):
        t, why = self.tier(behaviour=M.GateResult("behaviour", "not-installed", "absent"))
        self.assertEqual("unverified", t)
        self.assertTrue(any("behaviour" in w for w in why))

    def test_a_gate_that_failed_to_run_or_was_a_sample_is_unverified(self):
        for status in ("failed-to-run", "partial", "skipped"):
            self.assertEqual("unverified",
                             self.tier(render=M.GateResult("render", status))[0], status)

    def test_a_gate_that_skipped_this_level_is_unverified(self):
        self.assertEqual("unverified", self.tier(rules=ran("rules", levels=["other"]))[0])
        self.assertEqual("ready", self.tier(rules=ran("rules", levels=["L"]))[0])

    def test_blocked_names_the_uncovered_gate_too_and_is_never_ready(self):
        t, why = self.tier([F("static", "blocker")],
                           render=M.GateResult("render", "not-installed"))
        self.assertEqual("blocked", t)
        self.assertTrue(any("gate render" in w for w in why))

    def test_open_blocker_and_major_block(self):
        self.assertEqual("blocked", self.tier([F("static", "blocker")])[0])
        self.assertEqual("blocked", self.tier([F("behaviour", "major")])[0])

    def test_accepted_with_evidence_does_not_block(self):
        self.assertEqual("ready", self.tier([F("static", "major", accepted=True, rf=True)])[0])

    def test_minor_is_ready_with_notes(self):
        self.assertEqual("ready-with-notes", self.tier([F("static", "minor")])[0])

    def test_modwide_open_findings_cap_a_level_at_notes(self):
        t, why = self.tier(modwide=[F("static", "major", cause="glb-missing")])
        self.assertEqual("ready-with-notes", t)
        self.assertIn("glb-missing", why[0])

    def test_retail_faithful_without_evidence_stays_open(self):
        rows = [{"check": "drive", "level": "l", "template_or_kit": "T", "severity": "major",
                 "cause_key": "k", "evidence": "", "retail_faithful": True}]
        f = M.normalise_external(rows, "behaviour")[0]
        self.assertFalse(f.accepted)
        self.assertTrue(f.open_bad)
        rows[0]["evidence"] = "ledger PHY-17: the engine does the same"
        g = M.normalise_external(rows, "behaviour")[0]
        self.assertTrue(g.accepted)
        self.assertFalse(g.open_bad)


class Normalise(unittest.TestCase):
    def test_static_legacy_and_common_schema(self):
        acc = {"engine-without-script": "retail is silent too"}
        legacy = {"audit": "sound", "cause": "engine-without-script", "subject": "Ark",
                  "detail": "d", "level": "", "pos": None}
        f = M.normalise_static([legacy], acc)[0]
        self.assertTrue(f.accepted)
        self.assertEqual("retail is silent too", f.accepted_reason)
        new = {"audit": "textures", "cause": "texture-opaque-white", "subject": "x.png",
               "detail": "", "level": None, "severity": "major", "cause_key": "texture-opaque-white",
               "owning_script": "extract_all.py", "evidence": "", "accepted": False}
        g = M.normalise_static([new], acc)[0]
        self.assertEqual("blocker", g.severity)       # a white texture is a visible defect
        self.assertEqual("extract_all.py", g.owning_script)
        self.assertEqual("", g.level)

    def test_load_rows_reads_list_and_wrapper(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "a.json"
            p.write_text(json.dumps([{"cause_key": "k"}]))
            self.assertEqual(([{"cause_key": "k"}], None), M._load_rows(p))
            p.write_text(json.dumps({"findings": [{"cause_key": "k"}],
                                     "levels": [{"level": "A"}, {"level": "B"}]}))
            rows, lv = M._load_rows(p)
            self.assertEqual(1, len(rows))
            self.assertEqual(["A", "B"], lv)

    def test_render_output_is_parsed_per_level(self):
        text = ("rendered 21 frames (3 models, 6 levels); flagged 2\n"
                "  level:iwo_jima:cp1: 90 colours, white 31.0%, magenta 0.00%, black 0.0% of frame\n"
                "  Tiger: 1200 px, white 80%, magenta 0%, black 0%\n")
        head, fs = M.parse_render_output(text)
        self.assertEqual(6, head["levels"])
        self.assertEqual(["iwo_jima", ""], [f.level for f in fs])
        self.assertTrue(all(f.open_bad for f in fs))
        self.assertIsNone(M.parse_render_output("Traceback ...")[0])


class Reuse(unittest.TestCase):
    def test_reuse_merges_saved_gate_output_without_running_anything(self):
        with tempfile.TemporaryDirectory() as d:
            work = Path(d)
            (work / "static.json").write_text(json.dumps([
                {"audit": "textures", "cause": "texture-opaque-white", "subject": "a.png",
                 "detail": "", "level": ""}]))
            (work / "behaviour.json").write_text(json.dumps({
                "findings": [], "levels": [{"level": "Gold_Beach-1944"}]}))
            (work / "render.txt").write_text("rendered 3 frames (0 models, 1 levels); flagged 0\n")
            ctx = M.Context(cfg=M.MODS["fh"], levels=["gold_beach-1944"],
                            level_names=["Gold_Beach-1944"], reuse=True)
            with mock.patch.object(M, "_run_capture", side_effect=AssertionError("ran")):
                st = M.gate_static(ctx, work)
                be = M.gate_behaviour(ctx, work, "http://x")
                rn = M.gate_render(ctx, work, "http://x")
            self.assertEqual("ran", st.status)
            self.assertEqual("blocker", st.findings[0].severity)
            self.assertEqual(["gold_beach-1944"], be.levels_covered)
            self.assertEqual("ran", rn.status)

    def test_render_that_covered_fewer_levels_than_baked_is_not_a_pass(self):
        with tempfile.TemporaryDirectory() as d:
            work = Path(d)
            (work / "render.txt").write_text("rendered 3 frames (0 models, 1 levels); flagged 0\n")
            ctx = M.Context(cfg=M.MODS["fh"], levels=["a", "b"], level_names=["A", "B"], reuse=True)
            self.assertEqual("failed-to-run", M.gate_render(ctx, work, "http://x").status)


class RuleChecks(unittest.TestCase):
    RAW = {"beach": {"team": 2, "radius": 5.0, "areaValue": 0.0, "spawnGroupId": 1,
                     "secondSpawnGroupId": None, "objectSpawnerId": 1,
                     "unableToChangeTeam": True, "timeToGetControl": 9999.0,
                     "timeToLoseControl": 9999.0, "disableIfEnemyInsideRadius": False,
                     "disableWhenLosingControl": False, "loseControlWhenEnemyClose": False,
                     "loseControlWhenNotClose": False, "minNrToTakeControl": None,
                     "onlyTakeableByTeam": None}}

    def test_equal_scene_has_no_disagreement(self):
        self.assertEqual([], M.compare_control_points([{"name": "beach", **self.RAW["beach"]}],
                                                      self.RAW))

    def test_a_changed_capture_field_is_named(self):
        cp = {"name": "beach", **self.RAW["beach"], "onlyTakeableByTeam": 2}
        out = M.compare_control_points([cp], self.RAW)
        self.assertEqual(1, len(out))
        self.assertEqual("capture-rule-field-differs", out[0][1])
        self.assertIn("onlyTakeableByTeam", out[0][2])

    def test_a_point_on_one_side_only(self):
        causes = {c for _i, c, _e in M.compare_control_points(
            [{"name": "ghost", **self.RAW["beach"]}], self.RAW)}
        self.assertEqual({"cp-not-in-script", "cp-not-in-scene"}, causes)

    def test_null_and_zero_booleans_agree(self):
        self.assertTrue(M._same(None, 0))
        self.assertTrue(M._same(True, 1))
        self.assertFalse(M._same(2, None))

    @unittest.skipUnless(FH_TREE.is_file() and (GAME / "Mods" / "FH").is_dir(),
                         "needs the FH tree and the game install")
    def test_a_tampered_scene_is_caught_against_the_real_archive(self):
        paths = M.tree_paths("fh")
        with tempfile.TemporaryDirectory() as d:
            t = Path(d)
            lvl = "gold_beach-1944"
            (t / lvl).mkdir()
            scene = json.loads((paths["maps"] / lvl / "scene.json").read_text())
            for mode in scene["modes"].values():
                for cp in mode["controlPoints"]:
                    if cp["name"] == "front":
                        cp["onlyTakeableByTeam"] = None
            (t / lvl / "scene.json").write_text(json.dumps(scene))
            (t / "maps.json").write_text("[]")
            ctx = M.Context(cfg=M.MODS["fh"], levels=[lvl], level_names=["Gold_Beach-1944"],
                            paths={**paths, "maps": t})
            res = M.gate_rules(ctx, t)
            self.assertEqual("ran", res.status)
            bad = [f for f in res.findings if f.cause_key == "capture-rule-field-differs"]
            self.assertTrue(bad, "tampering with `front` was not noticed")
            self.assertIn("onlyTakeableByTeam", bad[0].evidence)


class Scorecard(unittest.TestCase):
    def test_scorecard_fails_closed_and_renders(self):
        with tempfile.TemporaryDirectory() as d:
            t = Path(d)
            (t / "l1").mkdir()
            (t / "l1" / "scene.json").write_text(json.dumps(
                {"objectSpawns": [{"vehicle": "Tiger", "spawner": "s"}]}))
            paths = {**M.tree_paths("fh"), "maps": t}
            ctx = M.Context(cfg=M.MODS["fh"], levels=["l1"], paths=paths)
            gates = {n: ran(n) for n in M.REQUIRED_GATES}
            gates["static"] = ran("static", [
                F("static", "major", cause="glb-missing", item="Tiger.glb"),
                F("static", "accepted", cause="uv-constant", accepted=True, rf=True)])
            gates["behaviour"] = M.GateResult("behaviour", "not-installed", "absent")
            sc = M.build_scorecard(ctx, gates, {})
            self.assertEqual("blocked", sc["levels"]["l1"]["tier"])
            self.assertEqual("blocked", sc["tier"])
            # the template attribution reached the level: Tiger.glb is placed there
            self.assertEqual(1, sc["levels"]["l1"]["counts"]["major"])
            md = M.scorecard_markdown(sc)
            self.assertIn("not-installed", md)
            self.assertIn("uv-constant", md)
            clean = {n: ran(n) for n in M.REQUIRED_GATES}
            clean["behaviour"] = M.GateResult("behaviour", "not-installed", "absent")
            sc2 = M.build_scorecard(ctx, clean, {})
            self.assertEqual("unverified", sc2["levels"]["l1"]["tier"])
            self.assertEqual("unverified", sc2["tier"])
            clean["behaviour"] = ran("behaviour")
            self.assertEqual("ready", M.build_scorecard(ctx, clean, {})["tier"])


class MergeBehaviour(unittest.TestCase):
    def test_a_rerun_replaces_only_its_levels(self):
        base = {"mod": "fh", "levels": [{"level": "A"}, {"level": "B"}],
                "findings": [{"level": "A", "cause_key": "x"}, {"level": "B", "cause_key": "level.harness-failure"}],
                "tested": [{"level": "A"}, {"level": "B"}]}
        part = {"levels": [{"level": "B", "vehicles_tested": 9}], "findings": [], "tested": [{"level": "B"}]}
        out = M.merge_behaviour(base, part, ["b"])
        self.assertEqual([{"level": "A", "cause_key": "x"}], out["findings"])
        self.assertEqual(["A", "B"], [r["level"] for r in out["levels"]])
        self.assertEqual(9, out["levels"][1]["vehicles_tested"])


class HarnessFailures(unittest.TestCase):
    def test_a_level_the_harness_could_not_stage_is_unverified_not_blocked(self):
        ctx = M.Context(cfg=M.MODS["fh"], levels=["a", "b"], level_names=["A", "B"],
                        paths={**M.tree_paths("fh"), "maps": Path("/nonexistent")})
        gates = {n: ran(n) for n in M.REQUIRED_GATES}
        gates["behaviour"] = M.GateResult("behaviour", "ran", findings=[
            M.Finding("behaviour", "level.load", "A", "-", "blocker", "level.harness-failure",
                      "browser.newPage: Target page, context or browser has been closed")])
        sc = M.build_scorecard(ctx, gates, {})
        self.assertEqual("unverified", sc["levels"]["a"]["tier"])
        self.assertEqual("ready", sc["levels"]["b"]["tier"])
        self.assertEqual([], sc["blockers"])


class Verify(unittest.TestCase):
    @unittest.skipUnless(FH_TREE.is_file(), "needs the extracted FH tree")
    def test_fh_verification_steps_pass(self):
        ctx = M.Context(cfg=M.MODS["fh"], levels=[], level_names=[])
        ctx.levels, ctx.level_names = M.baked_levels(ctx)
        for row in M.run_verify_steps(ctx, None, record=False):
            self.assertEqual("pass", row["status"], json.dumps(row)[:400])


if __name__ == "__main__":
    unittest.main()


class InputSets(unittest.TestCase):
    """A step that reads a manifest runs again when the manifest's SET changes
    (a level added to maps.json), not when another key of it is rewritten."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        t = Path(self.tmp.name)
        self.paths = {k: t / k for k in ("models", "maps", "shared", "models_root", "maps_root")}
        for p in self.paths.values():
            p.mkdir()
        self.ctx = M.Context(cfg=M.MODS["fh"], levels=["l1"], paths=self.paths)
        self.state = M.State(t / "state.json")
        self.out = self.paths["models"] / "out.txt"
        self.maps = self.paths["maps"] / "maps.json"
        self.maps.write_text(json.dumps([{"name": "L1", "report": "l1/scene.json"}]))

    def tearDown(self):
        self.tmp.cleanup()

    def step(self):
        return M.Step("t", "test", cmds=(("python3", "-c", f"open({str(self.out)!r},'w').write('x')"),),
                      inputs=(str(self.maps),), outputs=((str(self.out), 1),))

    def run_one(self, step, **kw):
        kw.setdefault("dry_run", False)
        kw.setdefault("force", False)
        with mock.patch.object(M, "OUT_ROOT", Path(self.tmp.name)):
            return M.run_steps([step], self.ctx, self.state,
                               log_dir=Path(self.tmp.name) / "logs", **kw)[0]

    def test_a_new_level_reruns_a_done_step_and_the_dry_run_says_why(self):
        self.assertEqual("done", self.run_one(self.step())["status"])
        self.assertEqual("skipped-done", self.run_one(self.step())["status"])
        self.maps.write_text(json.dumps([{"name": "L1", "report": "l1/scene.json"},
                                         {"name": "L2", "report": "l2/scene.json"}]))
        plan = self.run_one(self.step(), dry_run=True)
        self.assertTrue(plan["status"].startswith("would-run (inputs changed"), plan["status"])
        row = self.run_one(self.step())
        self.assertEqual("done", row["status"])
        self.assertIn("inputs changed", row["reason"])
        self.assertEqual("skipped-done", self.run_one(self.step())["status"])

    def test_another_key_of_the_manifest_is_not_a_change(self):
        self.run_one(self.step())
        self.maps.write_text(json.dumps([{"name": "L1", "report": "l1/scene.json",
                                          "loading": {"title": "L1"}}]))
        self.assertEqual("skipped-done", self.run_one(self.step())["status"])

    def test_the_set_of_each_manifest_kind(self):
        t = Path(self.tmp.name)
        kits = t / "kits.json"
        kits.write_text(json.dumps({"kits": [{"name": "K", "levels": ["B", "a"]}]}))
        self.assertEqual(["K:a,b"], M.manifest_set(kits))
        models = t / "models.json"
        models.write_text(json.dumps([{"name": "Tiger", "thumb": "x"}, {"name": "Bf109"}]))
        self.assertEqual(["Bf109", "Tiger"], M.manifest_set(models))
        self.assertEqual(["l1"], M.manifest_set(self.maps))
        self.assertEqual([], M.manifest_set(t / "nothing.json"))

    def test_the_steps_that_read_the_level_set_declare_it(self):
        for name in ("kits", "loadouts", "viewmodels", "loading", "hud", "flag_cloth",
                     "optimise", "manifest", "manifest_final"):
            self.assertIn("{maps}/maps.json", M.step_by_name(name).inputs, name)
        for name in ("poses_kit", "poses_shared", "poses_matrix", "viewmodels"):
            self.assertIn("{models}/kits.json", M.step_by_name(name).inputs, name)
        self.assertIn("{models}/models.json", M.step_by_name("thumbs").inputs)


class LevelCoverage(unittest.TestCase):
    """`v_levels`: a level with a scene and nothing else is named."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        t = Path(self.tmp.name)
        self.paths = {"models": t / "models", "maps": t / "maps", "shared": t / "maps" / "_shared",
                      "models_root": t / "models", "maps_root": t / "maps"}
        for p in self.paths.values():
            p.mkdir(parents=True, exist_ok=True)
        (self.paths["models"] / "viewmodels").mkdir()
        self.ctx = M.Context(cfg=M.MODS["fh"], levels=["a", "b"], paths=self.paths)
        for lvl in ("a", "b"):
            d = self.paths["maps"] / lvl
            d.mkdir()
            (d / "scene.glb").write_bytes(b"glTF")
            (d / "scene.glb.gz").write_bytes(b"gz")
        (self.paths["maps"] / "maps.json").write_text(json.dumps([
            {"name": "A", "report": "a/scene.json", "loading": {"title": "A"}},
            {"name": "B", "report": "b/scene.json"}]))
        (self.paths["models"] / "kits.json").write_text(json.dumps({"kits": [{"name": "K", "levels": ["A"]}]}))
        (self.paths["shared"] / "loadouts.json").write_text(json.dumps({"levels": {"a": {}}}))
        (self.paths["models"] / "viewmodels" / "skins.json").write_text(json.dumps({"levels": {"a": {}}}))

    def tearDown(self):
        self.tmp.cleanup()

    def test_the_level_added_by_a_bake_alone_is_named_in_every_row(self):
        rows = {r["what"]: r for r in M.check_level_coverage(self.ctx)}
        for what, r in rows.items():
            if "scene.glb.gz" in what:
                self.assertTrue(r["ok"], what)
            else:
                self.assertFalse(r["ok"], what)
                self.assertEqual(["b"], r["examples"], what)

    def test_a_level_considered_but_repainting_nothing_is_covered(self):
        skins = self.paths["models"] / "viewmodels" / "skins.json"
        skins.write_text(json.dumps({"levels": {"a": {}}, "considered": ["a", "B"]}))
        rows = {r["what"]: r for r in M.check_level_coverage(self.ctx)}
        paint = next(r for w, r in rows.items() if "first-person paint" in w)
        self.assertTrue(paint["ok"], paint)

    def test_a_stale_gz_is_named(self):
        gz = self.paths["maps"] / "a" / "scene.glb.gz"
        os.utime(gz, (1, 1))
        rows = {r["what"]: r for r in M.check_level_coverage(self.ctx)}
        stale = next(r for w, r in rows.items() if "scene.glb.gz" in w)
        self.assertEqual(["a"], stale["examples"])

    def test_v_levels_is_a_verify_step(self):
        self.assertIn("v_levels", [s.name for s in M.VERIFY_STEPS])
        self.assertIn("check_level_coverage", M.VERIFY_HOOKS)


class PickLevels(unittest.TestCase):
    """`--pick N`: unbaked own levels, single-player first, the rest random and repeatable."""

    OWN = [(n, Path(f"/a/{n}.rfa")) for n in ("Alpha", "Bravo", "Charlie", "Delta", "Echo", "Foxtrot")]

    def test_single_player_first_then_random_and_baked_excluded(self):
        sp = lambda p: p.stem in ("Echo", "Charlie")  # noqa: E731
        pick = M.pick_levels(self.OWN, {"alpha"}, 4, has_sp=sp, seed=1)
        self.assertEqual(["Charlie", "Echo"], pick["chosen"][:2])
        self.assertEqual(["Charlie", "Echo"], pick["singleplayer"])
        self.assertEqual(2, len(pick["random"]))
        self.assertNotIn("Alpha", pick["chosen"])
        self.assertEqual(5, pick["candidates"])
        self.assertEqual(pick["chosen"], M.pick_levels(self.OWN, {"alpha"}, 4, has_sp=sp, seed=1)["chosen"])

    def test_random_only_ignores_single_player(self):
        pick = M.pick_levels(self.OWN, set(), 3, has_sp=lambda p: True, prefer_sp=False, seed=7)
        self.assertEqual([], pick["singleplayer"])
        self.assertEqual(3, len(pick["random"]))

    def test_parser_takes_pick(self):
        args = M.build_parser().parse_args(["run", "--mod", "fhsw", "--pick", "10", "--seed", "3", "--no-gates"])
        self.assertEqual(10, args.pick)
        args = M.build_parser().parse_args(["pick", "--mod", "fhsw"])
        self.assertEqual(10, args.pick)
