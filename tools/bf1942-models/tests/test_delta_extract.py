"""The delta modes: adding one level to a baked mod is cheap, never lossy.

`extract_viewmodel.py --delta` and `extract_pose.py --kit-poses --delta` reuse
the deterministic outputs already on disk and build only what is missing; the
indexes (`viewmodels/index.json`, `skins.json`, `poses-matrix.json`,
`gaits/gaits.json`) are written from the full set either way, so a subset run
can never narrow them — the `extract_models subset clobbers models.json`
failure mode, kept out by construction. `mod_pipeline.py` passes the flag only
for a step that last finished under the very same command (`wants_delta`), so
a changed extractor, a failed prior or `--force-steps` still take the full
pass.

No game install is needed; nothing here runs an extractor against the game.
"""

from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import extract_pose as ep  # noqa: E402
import extract_viewmodel as ev  # noqa: E402
import mod_pipeline as M  # noqa: E402


class ViewmodelPairDiff(unittest.TestCase):
    """`split_existing_pairs`: the pair diff against the tree on disk."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.out = Path(self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    def rig(self, stem: str, report: bool = True):
        (self.out / f"{stem}.fp.glb").write_bytes(b"glTF")
        if report:
            (self.out / f"{stem}.fp.report.json").write_text("{}")

    def test_existing_pairs_are_reused_and_missing_ones_built(self):
        self.rig("USSoldier__Thompson")
        pairs = [("USSoldier", "Thompson"), ("GermanSoldier", "MP40")]
        to_build, reused = ev.split_existing_pairs(pairs, self.out)
        self.assertEqual([("GermanSoldier", "MP40")], to_build)
        self.assertEqual([("USSoldier", "Thompson")], reused)

    def test_a_case_change_re_exports(self):
        # A full run would write the new spelling beside the old file, so a
        # delta must too: the trees stay byte-identical.
        self.rig("USSoldier__Thompson")
        to_build, reused = ev.split_existing_pairs([("USSoldier", "thompson")],
                                                   self.out)
        self.assertEqual([("USSoldier", "thompson")], to_build)
        self.assertEqual([], reused)

    def test_a_rig_without_its_report_is_rebuilt(self):
        self.rig("USSoldier__Thompson", report=False)
        to_build, reused = ev.split_existing_pairs([("USSoldier", "Thompson")],
                                                   self.out)
        self.assertEqual([("USSoldier", "Thompson")], to_build)

    def test_an_empty_tree_builds_everything(self):
        pairs = [("A", "B"), ("C", "D")]
        to_build, reused = ev.split_existing_pairs(pairs, self.out)
        self.assertEqual(pairs, to_build)
        self.assertEqual([], reused)


class ViewmodelIndexMerge(unittest.TestCase):
    """A subset run's index keeps every rig already in the tree."""

    def test_index_is_the_directory_not_the_run(self):
        with tempfile.TemporaryDirectory() as d:
            out = Path(d)
            for stem in ("A__X", "B__Y"):
                (out / f"{stem}.fp.glb").write_bytes(b"glTF")
            # a delta run added one rig; the index lists all three
            (out / "C__Z.fp.glb").write_bytes(b"glTF")
            self.assertEqual(["A__X", "B__Y", "C__Z"], ev.write_index(out))
            self.assertEqual(["A__X", "B__Y", "C__Z"],
                             json.loads((out / "index.json").read_text()))


class SkinRowReuse(unittest.TestCase):
    """`skin_row_reusable`: keep a level's skin only when a rebuild would
    reproduce it."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.glb = Path(self.tmp.name) / "bocage.skin.glb"
        self.glb.write_bytes(b"glTF")
        self.expected = {"level": "Bocage",
                         "textures": {"Ame1_sleeve_T": "texture/winter/ame1_sleeve_t"}}

    def tearDown(self):
        self.tmp.cleanup()

    def prev(self, **over):
        row = {"level": "Bocage", "file": "skins/bocage.skin.glb",
               "textures": dict(self.expected["textures"])}
        row.update(over)
        return row

    def test_identical_row_with_its_glb_is_reused(self):
        self.assertTrue(ev.skin_row_reusable(self.prev(), self.expected, self.glb))

    def test_no_previous_row_rebuilds(self):
        self.assertFalse(ev.skin_row_reusable(None, self.expected, self.glb))

    def test_a_changed_mapping_rebuilds(self):
        # A new rig image this level repaints, or a texture the level now
        # answers differently: the expected mapping moved, so the glb must be
        # rebuilt to carry it.
        prev = self.prev(textures={"Ame1_sleeve_T": "texture/summer/ame1_sleeve_t"})
        self.assertFalse(ev.skin_row_reusable(prev, self.expected, self.glb))
        grown = {"level": "Bocage",
                 "textures": {**self.expected["textures"],
                              "Ste_hand2": "texture/winter/gloves"}}
        self.assertFalse(ev.skin_row_reusable(self.prev(), grown, self.glb))

    def test_a_missing_glb_rebuilds(self):
        self.glb.unlink()
        self.assertFalse(ev.skin_row_reusable(self.prev(), self.expected, self.glb))

    def test_a_renamed_level_rebuilds(self):
        self.assertFalse(ev.skin_row_reusable(self.prev(level="Bocage_Day3"),
                                              self.expected, self.glb))


class KitPoseReuse(unittest.TestCase):
    """`kit_pose_reuse`: the matrix rows a `--kit-poses --delta` run may keep."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.out = Path(self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    def write_matrix(self, pairs):
        (self.out / "poses-matrix.json").write_text(json.dumps({"pairs": pairs}))

    def pose(self, stem: str, report: bool = True):
        (self.out / f"{stem}.pose.glb").write_bytes(b"glTF")
        if report:
            (self.out / f"{stem}.pose.report.json").write_text("{}")

    def test_a_clean_row_with_its_files_is_reused_without_its_kit_list(self):
        self.write_matrix([{"soldier": "USSoldier", "weapon": "Thompson",
                            "glb": "USSoldier__Thompson.pose.glb",
                            "kits": ["US_Assault"]}])
        self.pose("USSoldier__Thompson")
        reuse = ep.kit_pose_reuse(self.out)
        row = reuse[("ussoldier", "thompson")]
        self.assertEqual("USSoldier", row["soldier"])
        self.assertEqual("Thompson", row["weapon"])
        # The run re-annotates the kits from its own jobs, as a full run does,
        # so a kit a new level adds reaches the matrix.
        self.assertNotIn("kits", row)
        # and the stored row is untouched (the reuse row is a copy)
        row["probe"] = True
        self.assertNotIn("probe", ep.kit_pose_reuse(self.out)[("ussoldier", "thompson")])

    def test_an_error_row_is_exported_again(self):
        self.write_matrix([{"soldier": "A", "weapon": "B",
                            "error": "no stand-aim clip"}])
        self.pose("A__B")
        self.assertEqual({}, ep.kit_pose_reuse(self.out))

    def test_a_row_without_its_glb_or_report_is_exported_again(self):
        self.write_matrix([{"soldier": "A", "weapon": "B"},
                           {"soldier": "C", "weapon": "D"}])
        self.pose("C__D", report=False)
        self.assertEqual({}, ep.kit_pose_reuse(self.out))

    def test_no_matrix_means_nothing_is_reused(self):
        self.pose("A__B")
        self.assertEqual({}, ep.kit_pose_reuse(self.out))

    def test_hosted_rows_keep_their_level(self):
        # A pair posed through a level's load keeps that fact, so the counts
        # and the chain/level gait split stay what a full run reports.
        self.write_matrix([{"soldier": "JapaneseSoldier", "weapon": "Arisaka30",
                            "level": "203_hill-1904"}])
        self.pose("JapaneseSoldier__Arisaka30")
        row = ep.kit_pose_reuse(self.out)[("japanesesoldier", "arisaka30")]
        self.assertEqual("203_hill-1904", row["level"])


class PipelineDeltaWiring(unittest.TestCase):
    """`mod_pipeline` passes the extractor's `--delta` only when it is safe:
    the step last finished under this very command and re-runs only because
    an input set or an output moved."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        t = Path(self.tmp.name)
        self.paths = {k: t / k for k in ("models", "maps", "shared",
                                         "models_root", "maps_root")}
        for p in self.paths.values():
            p.mkdir()
        self.ctx = M.Context(cfg=M.MODS["fh"], levels=["l1"], paths=self.paths)
        self.state = M.State(t / "state.json")
        self.out = self.paths["models"] / "out.txt"
        self.argv_log = t / "argv.jsonl"
        self.maps = self.paths["maps"] / "maps.json"
        self.maps.write_text(json.dumps([{"glb": "a/scene.glb"}]))

    def tearDown(self):
        self.tmp.cleanup()

    def step(self):
        code = (f"import sys, json; open({str(self.out)!r}, 'w').write('x'); "
                f"open({str(self.argv_log)!r}, 'a').write(json.dumps(sys.argv[1:]) + chr(10))")
        return M.Step("t", "test", cmds=(("python3", "-c", code),),
                      inputs=(str(self.maps),),
                      outputs=((str(self.out), 1),), delta_flag="--delta")

    def run_one(self, **kw):
        kw.setdefault("dry_run", False)
        kw.setdefault("force", False)
        with mock.patch.object(M, "OUT_ROOT", Path(self.tmp.name)):
            return M.run_steps([self.step()], self.ctx, self.state,
                               log_dir=Path(self.tmp.name) / "logs", **kw)[0]

    def last_argv(self):
        return json.loads(self.argv_log.read_text().splitlines()[-1])

    def grow_maps(self, dirs):
        self.maps.write_text(json.dumps([{"glb": f"{d}/scene.glb"} for d in dirs]))

    def test_first_run_is_full_and_a_level_addition_is_delta(self):
        self.assertEqual("done", self.run_one()["status"])
        self.assertNotIn("--delta", self.last_argv())
        self.grow_maps(["a", "b"])
        row = self.run_one()
        self.assertEqual("done", row["status"])
        self.assertIn("--delta", self.last_argv())
        self.assertIn("--delta", row["argv"][0])

    def test_the_recorded_hash_is_the_base_commands(self):
        # A delta re-run records the same identity as a full one, so the next
        # unchanged run is up to date rather than flapping between hashes.
        self.run_one()
        self.grow_maps(["a", "b"])
        self.run_one()
        self.assertEqual("skipped-done", self.run_one()["status"])

    def test_force_steps_takes_the_full_pass(self):
        self.run_one()
        self.grow_maps(["a", "b"])
        self.run_one(force=True)
        self.assertNotIn("--delta", self.last_argv())

    def test_a_missing_output_is_rebuilt_in_delta(self):
        self.run_one()
        self.out.unlink()
        self.run_one()
        self.assertIn("--delta", self.last_argv())

    def test_a_failed_prior_takes_the_full_pass(self):
        self.run_one()
        self.grow_maps(["a", "b"])
        self.state.set("t", status="failed")
        self.run_one()
        self.assertNotIn("--delta", self.last_argv())

    def test_dry_run_plan_names_the_delta(self):
        self.run_one()
        self.grow_maps(["a", "b"])
        row = self.run_one(dry_run=True)
        self.assertTrue(row["status"].startswith("would-run (inputs changed"))
        self.assertIn("[--delta]", row["status"])

    def test_wants_delta_is_the_rule(self):
        s = self.step()
        self.assertTrue(M.wants_delta(s, same_cmd=True, up_to_date=False, force=False))
        self.assertFalse(M.wants_delta(s, same_cmd=True, up_to_date=True, force=False))
        self.assertFalse(M.wants_delta(s, same_cmd=False, up_to_date=False, force=False))
        self.assertFalse(M.wants_delta(s, same_cmd=True, up_to_date=False, force=True))
        plain = M.Step("p", "no delta", cmds=(("true",),))
        self.assertFalse(M.wants_delta(plain, same_cmd=True, up_to_date=False,
                                       force=False))

    def test_the_recipe_steps_carry_the_flag(self):
        self.assertEqual("--delta", M.step_by_name("viewmodels").delta_flag)
        self.assertEqual("--delta", M.step_by_name("poses_kit").delta_flag)


if __name__ == "__main__":
    unittest.main()
