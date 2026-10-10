"""The FH defect classes, pinned so none returns silently.

`mod_pipeline.REGRESSION_CORPUS` is the list. Each entry names its guards:
an `audit_mod.py` cause key, a unit test, and/or a live probe over the
extracted tree. This file checks the table itself (every guard exists, every
commit is real) and builds the cases that have no other unit test from the
real FH archives, skipping cleanly when the install is absent.
"""

from __future__ import annotations

import subprocess
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import mod_pipeline as M  # noqa: E402

GAME = Path.home() / ".wine/drive_c/EA Games/Battlefield 1942"
HAVE_FH = (GAME / "Mods" / "FH").is_dir()
FH_TREE = ROOT / "viewer" / "maps" / "mods" / "fh" / "maps.json"


class CorpusTable(unittest.TestCase):
    def test_keys_unique_and_every_entry_has_a_guard(self):
        keys = [e.key for e in M.REGRESSION_CORPUS]
        self.assertEqual(len(keys), len(set(keys)))
        for e in M.REGRESSION_CORPUS:
            self.assertTrue(e.audit_causes or e.tests or e.probe, e.key)

    def test_unit_test_guards_exist(self):
        for e in M.REGRESSION_CORPUS:
            for t in e.tests:
                self.assertTrue((ROOT / t).is_file(), f"{e.key}: {t}")

    def test_probes_exist(self):
        for e in M.REGRESSION_CORPUS:
            if e.probe:
                self.assertIn(e.probe, M.PROBES, e.key)

    def test_commits_are_real(self):
        for e in M.REGRESSION_CORPUS:
            r = subprocess.run(["git", "cat-file", "-e", f"{e.commit}^{{commit}}"],
                               cwd=ROOT, capture_output=True)
            if r.returncode and b"not a git repository" in r.stderr:
                self.skipTest("no git")
            self.assertEqual(0, r.returncode, f"{e.key}: commit {e.commit}")

    def test_audit_causes_are_ones_the_audit_can_emit(self):
        src = (ROOT / "audit_mod.py").read_text()
        for e in M.REGRESSION_CORPUS:
            for cause in e.audit_causes:
                frag = cause.split("-")[0]
                self.assertIn(frag, src, f"{e.key}: {cause}")
        # the exact keys that carry the load
        for cause in ("rs-texture-line-unparsed", "bolt-rifle-no-bolt-clip",
                      "engine-without-script", "engine-script-ok-but-no-layers"):
            self.assertIn(f'"{cause}"', src)
        self.assertIn('"nan-visible"', src)

    def test_the_probes_fail_on_a_tree_with_the_defect(self):
        """Each live probe is a real detector: plant the defect, see it fail."""
        import json
        import tempfile
        with tempfile.TemporaryDirectory() as d:
            t = Path(d)
            (t / "om").mkdir()
            (t / "om" / "scene.json").write_text(json.dumps({"vehicleSoldierSpawns": []}))
            (t / "pr").mkdir()
            (t / "pr" / "scene.json").write_text(json.dumps({"controlPoints": [
                {"name": "3rd_sstemplate", "unableToChangeTeam": True, "timeToGetControl": 9999}]}))
            models = t / "models"
            models.mkdir()
            ctx = M.Context(cfg=M.MODS["fh"], levels=["omaha_charlie-sector-1944", "prokhorovka-1943"],
                            paths={"models": models, "maps": t, "shared": t / "_s",
                                   "models_root": t, "maps_root": t})
            (t / "omaha_charlie-sector-1944").symlink_to(t / "om")
            (t / "prokhorovka-1943").symlink_to(t / "pr")
            self.assertEqual("fail", M.probe_spawn_groups(ctx)[0])
            self.assertEqual("fail", M.probe_unable_points(ctx)[0])
            self.assertEqual("fail", M.probe_deployables(ctx)[0])
            (models / "deployables.json").write_text(json.dumps({"weapons": [], "objects": []}))
            self.assertEqual("pass", M.probe_deployables(ctx)[0])


@unittest.skipUnless(HAVE_FH, "needs the FH install")
class FromTheArchives(unittest.TestCase):
    """Cases with no synthetic equivalent, built from the real FH archives."""

    @classmethod
    def setUpClass(cls):
        import extract_map as em
        from extract_models import build_library, build_pools, mod_chain, DEFAULT_GAME_DIR
        cls.em = em
        chain = mod_chain(DEFAULT_GAME_DIR, "FH")
        meshes, textures, objects, game = build_pools(chain, [])
        cls.meshes, cls.textures, cls.objects = meshes, textures, objects
        cls.library = build_library(objects)

    def test_random_geometry_families_find_their_engine(self):
        for name in ("GMC", "Opelblitz", "Zis5", "Bedford"):
            with self.subTest(name):
                self.assertIsNotNone(self.em.find_engine_script(self.library, self.objects, name),
                                     f"{name} drives silent: setRandomGeometries family not followed")

    def test_child_template_follows_the_family_suffix(self):
        lib = SimpleNamespace(objects={"lodgmc1": "child"})
        ref = SimpleNamespace(template="lodgmc", random_geometries=2)
        self.assertEqual("child", self.em._child_template(lib, ref))
        self.assertIsNone(self.em._child_template(lib, SimpleNamespace(
            template="lodgmc", random_geometries=0)))

    def test_engine_script_candidates_skip_an_unusable_first_engine(self):
        for name in ("Ju52", "B25"):
            with self.subTest(name):
                cands = list(self.em.engine_script_candidates(self.library, self.objects, name))
                self.assertGreaterEqual(len(cands), 1, name)

    def test_nebelwerfer_never_writes_hasMobilePhysics(self):
        t = self.library.object("Nebelwerfer")
        self.assertIsNotNone(t)
        self.assertFalse(t.has_mobile_physics)
        self.assertFalse(t.mobile_physics_declared,
                         "the stamp rule applies to a root that never wrote the word")

    def test_su76_gun_mount_texture_resolves_by_stem(self):
        hit = self.textures.resolve_ext("texture/SU_76MSummer.tga", (".dds", ".tga"))
        self.assertIsNotNone(hit, "a reference that spells .tga for a shipped .dds must resolve")

    def test_no_texture_line_in_the_install_goes_unparsed(self):
        import audit_mod
        game = audit_mod.Game(audit_mod.resolve_mod_name("fh"))
        self.assertTrue(game.ok)
        self.assertEqual([], [(f.subject, f.detail) for f in audit_mod.rs_source_scan(game)])

    def test_prokhorovka_3rd_ss_is_unable_with_finite_timers_in_the_script(self):
        from bf42 import level as lv
        from extract_models import DEFAULT_GAME_DIR, mod_chain
        chain = mod_chain(DEFAULT_GAME_DIR, "FH")
        paths = lv.find_level_archives(DEFAULT_GAME_DIR, "FH", "Prokhorovka-1943", chain=chain)
        files = lv.load_level_files(paths, "Prokhorovka-1943")
        gt = lv.load_game_types(files)["Conquest"]
        gp = lv.load_gameplay_objects(files, gt.mode, sources=gt.files or None)
        found = [gp.template_for(i) for i in gp.created_control_points()
                 if i.template.startswith("3rd_ss")]
        self.assertEqual(1, len(found))
        self.assertTrue(found[0].unable_to_change_team)
        self.assertLess(found[0].time_to_get_control, 9999)


@unittest.skipUnless(FH_TREE.is_file(), "needs the extracted FH tree")
class LiveProbesOnFh(unittest.TestCase):
    def test_every_probe_passes_or_is_not_applicable_on_fh(self):
        ctx = M.Context(cfg=M.MODS["fh"])
        ctx.levels, ctx.level_names = M.baked_levels(ctx)
        res = M.gate_corpus(ctx, Path("."))
        bad = [r for r in res.extra["rows"] if r["status"] == "fail"]
        self.assertEqual([], bad)
        passed = {r["key"] for r in res.extra["rows"] if r["status"] == "pass"}
        # these have FH assets that must be present: n/a would hide a missing tree
        for key in ("random-geometries-sound", "stationary-guns-static", "engine-alpha-floor",
                    "object-script-spawn-groups", "unable-to-change-team", "deployables-json"):
            self.assertIn(key, passed)


if __name__ == "__main__":
    unittest.main()
