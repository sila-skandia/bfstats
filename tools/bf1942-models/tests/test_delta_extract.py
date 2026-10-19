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
import os
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


def fake_glb(doc: dict) -> bytes:
    """A glb holding only a JSON chunk — enough for every JSON-chunk reader."""
    payload = json.dumps(doc).encode()
    payload += b" " * (-len(payload) % 4)
    return (b"glTF" + (2).to_bytes(4, "little")
            + (12 + 8 + len(payload)).to_bytes(4, "little")
            + len(payload).to_bytes(4, "little") + b"JSON" + payload)


def profile(soldier, key="BODY", images=None, view=None):
    return {"soldier": soldier, "key": key,
            "images": images if images is not None
            else [("sleeve", f"texture/{soldier}_sleeve.dds"),
                  ("hand", "texture/hand.dds")],
            "view": view or {"center1pHands": [0.0, -1.56, 0.1], "fov1p": 0.47}}


class BodyIdentity(unittest.TestCase):
    """`_fp_body_identity`: equal for bodies differing only in spellings and
    texture contents, apart for anything that renders."""

    @staticmethod
    def body(*, name="1PGerBody", png=b"PNGBYTES-GER", positions=((0, 0, 0), (1, 0, 0), (0, 1, 0)),
             envmap=False, cutoff=None):
        sys.path.insert(0, str(ROOT))
        from bf42 import gltf
        builder = gltf.GlbBuilder()
        image = builder.add_image_png(png, name=f"texture/{name}.dds")
        material = builder.add_material(name=f"{name}_Material0", texture=image,
                                        envmap=envmap, alpha_cutoff=cutoff)
        mesh = builder.add_mesh(name, [gltf.Primitive(
            positions=list(positions), indices=[0, 1, 2],
            normals=[(0.0, 0.0, 1.0)] * 3, uvs=[(0, 0), (1, 0), (0, 1)],
            material=material)])
        node = builder.add_node(gltf.Node(
            name=name, mesh=mesh, extras={"geometry": f"Soldier/{name}"}))
        return builder.build([node])

    def test_spellings_and_texture_bytes_are_factored_out(self):
        self.assertEqual(ev._fp_body_identity(self.body()),
                         ev._fp_body_identity(self.body(name="1PUsBody",
                                                        png=b"PNGBYTES-US!")))

    def test_geometry_material_flags_and_image_count_are_not(self):
        base = ev._fp_body_identity(self.body())
        self.assertNotEqual(base, ev._fp_body_identity(
            self.body(positions=((0, 0, 0), (2, 0, 0), (0, 1, 0)))))
        self.assertNotEqual(base, ev._fp_body_identity(self.body(envmap=True)))
        # The alpha cutoff a soldier's own texture pixels produce renders, so
        # it keeps nations apart even when everything else matches.
        self.assertNotEqual(base, ev._fp_body_identity(self.body(cutoff=0.5)))


class RigGrouping(unittest.TestCase):
    """`plan_rig_groups`: one export per (weapon, first-person body), proven
    per soldier, with every unprovable case falling back to the per-pair
    export."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.out = Path(self.tmp.name)
        self.context = {"library": None, "meshes": None, "textures": None,
                        "objects": None, "max_texture": 1024}

    def tearDown(self):
        self.tmp.cleanup()

    def plan(self, pairs, reused=(), profiles=None):
        table = profiles or {}

        def fake(soldier, **_kw):
            entry = table.get(soldier.lower())
            if entry is None:
                raise ev.PoseError(f"{soldier} has no skinned first-person parts")
            return entry

        with mock.patch.object(ev, "soldier_fp_profile", side_effect=fake):
            return ev.plan_rig_groups(list(pairs), list(reused), self.context,
                                      self.out)

    def test_twins_export_once_and_the_rest_become_painted_rows(self):
        plan = self.plan([("B", "Gun"), ("A", "Gun")],
                         profiles={"a": profile("A"), "b": profile("B")})
        self.assertEqual([("A", "Gun")], plan.build)
        row = plan.rows["B__Gun"]
        self.assertEqual("A__Gun", row["rig"])
        self.assertEqual({"texture/A_sleeve.dds": "texture/B_sleeve.dds"},
                         row["textures"])
        self.assertEqual("soldiers/B.skin.glb", row["skin"])
        self.assertNotIn("view", row)
        self.assertEqual(("A", "Gun"), plan.canonical_of["B__Gun"])
        self.assertEqual({"B": profile("B")["images"]}, plan.skins)

    def test_an_existing_rig_file_is_preferred_as_the_canonical(self):
        (self.out / "B__Gun.fp.glb").write_bytes(b"glTF")
        plan = self.plan([("A", "Gun"), ("B", "Gun")],
                         profiles={"a": profile("A"), "b": profile("B")})
        self.assertEqual([("B", "Gun")], plan.build)
        self.assertEqual("B__Gun", plan.rows["A__Gun"]["rig"])

    def test_delta_reuse_is_weapon_level(self):
        # The pair-level reuse becomes weapon-level: a new soldier of a weapon
        # whose twin rig is already on disk builds nothing at all.
        (self.out / "A__Gun.fp.glb").write_bytes(b"glTF")
        plan = self.plan([("B", "Gun")], reused=[("A", "Gun")],
                         profiles={"a": profile("A"), "b": profile("B")})
        self.assertEqual([], plan.build)
        self.assertEqual("A__Gun", plan.rows["B__Gun"]["rig"])

    def test_a_failed_profile_exports_per_pair(self):
        plan = self.plan([("A", "Gun"), ("B", "Gun")],
                         profiles={"a": profile("A")})
        self.assertEqual({("A", "Gun"), ("B", "Gun")}, set(plan.build))
        self.assertEqual({}, plan.rows)

    def test_different_bodies_export_per_pair(self):
        plan = self.plan([("A", "Gun"), ("B", "Gun")],
                         profiles={"a": profile("A", key="BODY1"),
                                   "b": profile("B", key="BODY2")})
        self.assertEqual({("A", "Gun"), ("B", "Gun")}, set(plan.build))
        self.assertEqual({}, plan.rows)

    def test_an_ambiguous_mapping_exports_per_pair(self):
        # One canonical image standing for two of the soldier's cannot be
        # painted by image name.
        a = profile("A", images=[("s", "texture/X.dds"), ("h", "texture/X.dds")])
        b = profile("B", images=[("s", "texture/Y.dds"), ("h", "texture/X.dds")])
        plan = self.plan([("A", "Gun"), ("B", "Gun")],
                         profiles={"a": a, "b": b})
        self.assertEqual({("A", "Gun"), ("B", "Gun")}, set(plan.build))

    def test_identical_textures_make_a_bare_row(self):
        twin = profile("B", images=profile("A")["images"])
        plan = self.plan([("A", "Gun"), ("B", "Gun")],
                         profiles={"a": profile("A"), "b": twin})
        self.assertEqual({"rig": "A__Gun"}, plan.rows["B__Gun"])
        self.assertEqual({}, plan.skins)

    def test_a_view_difference_rides_in_the_row(self):
        twin = profile("B", view={"center1pHands": [0.0, -1.56, 0.1],
                                  "fov1p": 0.6})
        plan = self.plan([("A", "Gun"), ("B", "Gun")],
                         profiles={"a": profile("A"), "b": twin})
        self.assertEqual({"fov1p": 0.6}, plan.rows["B__Gun"]["view"])

    def test_a_lone_pair_is_never_profiled(self):
        with mock.patch.object(ev, "soldier_fp_profile",
                               side_effect=AssertionError("profiled")) as probe:
            plan = ev.plan_rig_groups([("A", "Gun"), ("A", "Pistol")], [],
                                      self.context, self.out)
        self.assertEqual({("A", "Gun"), ("A", "Pistol")}, set(plan.build))
        probe.assert_not_called()

    def test_weapons_group_case_blind(self):
        plan = self.plan([("A", "Gun"), ("B", "gun")],
                         profiles={"a": profile("A"), "b": profile("B")})
        self.assertEqual([("A", "Gun")], plan.build)
        self.assertEqual("A__Gun", plan.rows["B__gun"]["rig"])


class FinaliseRows(unittest.TestCase):
    """`finalise_pair_rows`: rows validated against the canonical rig as
    built."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.out = Path(self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    def rig_doc(self, sleeve="texture/A_sleeve.dds", weapon="texture/gun.dds"):
        return {
            "images": [{"name": sleeve}, {"name": "texture/hand.dds"},
                       {"name": weapon}],
            "textures": [{"source": 0}, {"source": 1},
                         {"extensions": {"EXT_texture_webp": {"source": 2}}}],
            "materials": [
                {"name": "m0", "pbrMetallicRoughness": {"baseColorTexture": {"index": 0}}},
                {"name": "m1", "pbrMetallicRoughness": {"baseColorTexture": {"index": 1}}},
                {"name": "m2", "pbrMetallicRoughness": {"baseColorTexture": {"index": 2}}}],
            "meshes": [{"primitives": [{"material": 0}, {"material": 1}]},
                       {"primitives": [{"material": 2}]}],
            "nodes": [{"mesh": 0, "skin": 0}, {"mesh": 1}],
        }

    def plan_with(self, rows):
        plan = ev.RigPlan()
        plan.rows = dict(rows)
        for stem in rows:
            soldier, weapon = stem.split("__", 1)
            plan.pair_of[stem] = (soldier, weapon)
            plan.canonical_of[stem] = ("A", weapon)
        return plan

    def test_a_clean_row_passes(self):
        (self.out / "A__Gun.fp.glb").write_bytes(fake_glb(self.rig_doc()))
        row = {"rig": "A__Gun",
               "textures": {"texture/A_sleeve.dds": "texture/B_sleeve.dds"},
               "skin": "soldiers/B.skin.glb"}
        rows, demoted = ev.finalise_pair_rows(self.out, self.plan_with({"B__Gun": row}))
        self.assertEqual({"B__Gun": row}, rows)
        self.assertEqual([], demoted)

    def test_a_mapped_image_the_weapon_also_wears_demotes_the_pair(self):
        # The paint is by image name: a canonical sleeve texture that is also
        # a weapon texture cannot be told apart, so the pair keeps its own rig.
        doc = self.rig_doc(sleeve="texture/shared.dds", weapon="texture/shared.dds")
        (self.out / "A__Gun.fp.glb").write_bytes(fake_glb(doc))
        row = {"rig": "A__Gun",
               "textures": {"texture/shared.dds": "texture/B_sleeve.dds"},
               "skin": "soldiers/B.skin.glb"}
        rows, demoted = ev.finalise_pair_rows(self.out, self.plan_with({"B__Gun": row}))
        self.assertEqual({}, rows)
        self.assertEqual(["B__Gun"], demoted)

    def test_a_graft_row_keeps_only_the_target_and_the_view(self):
        (self.out / "A__Gun.fp.glb").write_bytes(
            fake_glb({"extras": {"graft": True}}))
        row = {"rig": "A__Gun", "textures": {"x": "y"},
               "skin": "soldiers/B.skin.glb", "view": {"fov1p": 0.6}}
        rows, demoted = ev.finalise_pair_rows(self.out, self.plan_with({"B__Gun": row}))
        self.assertEqual({"B__Gun": {"rig": "A__Gun", "view": {"fov1p": 0.6}}}, rows)
        self.assertEqual([], demoted)

    def test_a_canonical_that_never_landed_drops_its_rows(self):
        row = {"rig": "A__Gun", "textures": {"x": "y"}, "skin": "soldiers/B.skin.glb"}
        rows, demoted = ev.finalise_pair_rows(self.out, self.plan_with({"B__Gun": row}))
        self.assertEqual({}, rows)
        self.assertEqual([], demoted)


class SingleRigIndex(unittest.TestCase):
    """`write_index` with pairs rows: the object form, merged like
    absent.json, and the array form byte-stable when there are none."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.out = Path(self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    def rig(self, stem):
        (self.out / f"{stem}.fp.glb").write_bytes(b"glTF")

    def test_no_rows_keeps_the_bare_array_byte_for_byte(self):
        self.rig("A__X")
        ev.write_index(self.out)
        self.assertEqual(json.dumps(["A__X"], indent=1) + "\n",
                         (self.out / "index.json").read_text())

    def test_rows_make_the_object_form(self):
        self.rig("A__Gun")
        row = {"rig": "A__Gun", "textures": {"a": "b"}, "skin": "soldiers/B.skin.glb"}
        ev.write_index(self.out, {"B__Gun": row})
        doc = json.loads((self.out / "index.json").read_text())
        self.assertEqual(ev.RIG_INDEX_PAIRS_FORMAT, doc["format"])
        self.assertEqual(["A__Gun"], doc["rigs"])
        self.assertEqual({"B__Gun": row}, doc["pairs"])

    def test_prior_rows_survive_a_run_that_computed_none(self):
        # A positional-pairs run on a kits-built tree must not narrow it.
        self.rig("A__Gun")
        ev.write_index(self.out, {"B__Gun": {"rig": "A__Gun"}})
        self.rig("C__Other")
        ev.write_index(self.out)
        doc = json.loads((self.out / "index.json").read_text())
        self.assertEqual({"B__Gun": {"rig": "A__Gun"}}, doc["pairs"])
        self.assertEqual(["A__Gun", "C__Other"], doc["rigs"])

    def test_a_row_is_dropped_when_its_pair_grows_a_file_or_its_target_goes(self):
        self.rig("A__Gun")
        ev.write_index(self.out, {"B__Gun": {"rig": "A__Gun"},
                                  "C__Gun": {"rig": "A__Gun"},
                                  "D__Lost": {"rig": "Gone__Lost"}})
        self.rig("B__Gun")   # the pair now has its own rig file
        ev.write_index(self.out)
        doc = json.loads((self.out / "index.json").read_text())
        self.assertEqual({"C__Gun"}, set(doc["pairs"]))

    def test_a_target_is_respelled_to_the_file_on_disk(self):
        self.rig("A__Gun")
        ev.write_index(self.out, {"B__Gun": {"rig": "a__gun"}})
        doc = json.loads((self.out / "index.json").read_text())
        self.assertEqual("A__Gun", doc["pairs"]["B__Gun"]["rig"])

    def test_a_stores_sha_table_is_dropped_on_rewrite(self):
        # As a re-extract drops a models.json row's stale sha: the store's
        # next run records the new ones.
        self.rig("A__Gun")
        (self.out / "index.json").write_text(json.dumps(
            {"format": "bf1942-rig-index/2", "rigs": ["A__Gun"],
             "pairs": {"B__Gun": {"rig": "A__Gun"}},
             "sha": {"A__Gun.fp.glb": "stale"}}))
        ev.write_index(self.out)
        doc = json.loads((self.out / "index.json").read_text())
        self.assertNotIn("sha", doc)
        self.assertEqual({"B__Gun": {"rig": "A__Gun"}}, doc["pairs"])

    def test_superseded_files_go_only_on_a_full_run(self):
        for stem in ("A__Gun", "B__Gun"):
            self.rig(stem)
            (self.out / f"{stem}.fp.glb.gz").write_bytes(b"gz")
            (self.out / f"{stem}.fp.report.json").write_text("{}")
        removed = ev.remove_superseded_rigs(self.out, {"B__Gun": {"rig": "A__Gun"}})
        self.assertEqual(1, removed)
        self.assertFalse((self.out / "B__Gun.fp.glb").exists())
        self.assertFalse((self.out / "B__Gun.fp.glb.gz").exists())
        self.assertFalse((self.out / "B__Gun.fp.report.json").exists())
        self.assertTrue((self.out / "A__Gun.fp.glb").exists())


class SkinsDecisionDelta(unittest.TestCase):
    """The level-skin DECISION fast path: with `--delta`, a level none of
    whose fingerprinted inputs moved keeps its previous decision without
    `expected_level_skins` ever running for it. Soundness: the shared
    fingerprint covers the archives, the model trees and the rigs — so a NEW
    rig image an old level would repaint re-decides every level — and the
    per-level one its maps.json row and named files."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        root = Path(self.tmp.name)
        self.out = root / "models" / "viewmodels"
        self.out.mkdir(parents=True)
        self.game = root / "game"
        self.rfa = self.game / "Mods" / "M" / "Archives" / "base.rfa"
        self.rfa.parent.mkdir(parents=True)
        self.rfa.write_bytes(b"rfa")
        self.chain = [self.game / "Mods" / "M"]
        self.maps = [{"name": "L1", "glb": "l1/scene.glb"}]

    def tearDown(self):
        self.tmp.cleanup()

    def run_skins(self, maps, previous=None):
        decided = []

        def fake_expected(out, maps_arg, *, considered=None, **_kw):
            rows = {}
            for entry in maps_arg:
                key = ev.level_dir_name(entry)
                decided.append(key)
                if considered is not None:
                    considered.append(key)
                rows[key] = {"level": entry["name"], "textures": {"X": "y"}}
            return rows

        with mock.patch.object(ev, "expected_level_skins", side_effect=fake_expected), \
                mock.patch.object(ev, "build_level_skin",
                                  return_value=(b"glTF", {"X": "y"})):
            index = ev.write_level_skins(self.out, maps, game_dir=self.game,
                                         mod="M", chain=self.chain,
                                         textures=None, assembler=None,
                                         previous=previous)
        return index, decided

    def test_a_full_run_decides_everything_and_writes_the_state(self):
        index, decided = self.run_skins(self.maps)
        self.assertEqual(["l1"], decided)
        self.assertEqual(["l1"], sorted(index["levels"]))
        state = json.loads((self.out / ev.SKINS_STATE).read_text())
        self.assertEqual(ev.SKINS_STATE_FORMAT, state["format"])
        self.assertIn("l1", state["levels"])

    def test_an_unchanged_delta_run_decides_nothing_and_keeps_the_index(self):
        first, _ = self.run_skins(self.maps)
        second, decided = self.run_skins(self.maps, previous=first)
        self.assertEqual([], decided)
        self.assertEqual(first, second)

    def test_a_new_level_is_decided_alone(self):
        first, _ = self.run_skins(self.maps)
        grown = [*self.maps, {"name": "L2", "glb": "l2/scene.glb"}]
        index, decided = self.run_skins(grown, previous=first)
        self.assertEqual(["l2"], decided)
        self.assertEqual(["l1", "l2"], sorted(index["levels"]))
        self.assertEqual(["l1", "l2"], index["considered"])

    def test_a_changed_row_is_decided_alone(self):
        first, _ = self.run_skins(self.maps)
        changed = [{"name": "L1", "glb": "l1/scene.glb", "effects": "l1/fx.glb"}]
        _, decided = self.run_skins(changed, previous=first)
        self.assertEqual(["l1"], decided)

    def test_a_new_rig_image_re_decides_every_level(self):
        # The documented case: a rig (or a painted soldier's skin) added to
        # the tree can be repainted by an OLD level, so nothing may skip.
        first, _ = self.run_skins(self.maps)
        (self.out / "A__Gun.fp.glb").write_bytes(b"glTF")
        _, decided = self.run_skins(self.maps, previous=first)
        self.assertEqual(["l1"], decided)

    def test_a_touched_archive_re_decides_every_level(self):
        first, _ = self.run_skins(self.maps)
        os.utime(self.rfa, ns=(1, 1))
        _, decided = self.run_skins(self.maps, previous=first)
        self.assertEqual(["l1"], decided)

    def test_no_state_file_decides_everything(self):
        first, _ = self.run_skins(self.maps)
        (self.out / ev.SKINS_STATE).unlink()
        _, decided = self.run_skins(self.maps, previous=first)
        self.assertEqual(["l1"], decided)

    def test_a_missing_skin_glb_re_decides_its_level(self):
        first, _ = self.run_skins(self.maps)
        (self.out / "skins" / "l1.skin.glb").unlink()
        _, decided = self.run_skins(self.maps, previous=first)
        self.assertEqual(["l1"], decided)

    def test_a_removed_level_leaves_the_index_and_its_skin_goes(self):
        first, _ = self.run_skins([*self.maps,
                                   {"name": "L2", "glb": "l2/scene.glb"}])
        index, decided = self.run_skins(self.maps, previous=first)
        self.assertEqual([], decided)
        self.assertEqual(["l1"], sorted(index["levels"]))
        self.assertFalse((self.out / "skins" / "l2.skin.glb").exists())


if __name__ == "__main__":
    unittest.main()
