"""`viewer/glb-store.js`: a model, rig or pose name whose manifest carries a
sha is fetched as its `glbs/<sha>.glb` blob, resourcePath pinned to the
original URL's directory; everything else -- an untreated tree, a name with
no sha, a file no manifest covers, a level scene -- keeps its own URL.

Phase 5 of `features/mesh-asset-size`; the blobs and the manifest tables are
written by `store_glbs.py` (tested in `test_glb_store.py`). Driven headless
by `glb_store_harness.mjs`.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MODULE = ROOT / "viewer" / "glb-store.js"
HARNESS = Path(__file__).with_name("glb_store_harness.mjs")


def run_harness() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        shutil.copyfile(MODULE, work / "glb-store.js")
        shutil.copyfile(HARNESS, work / "harness.mjs")
        (work / "package.json").write_text('{"type":"module"}\n')
        proc = subprocess.run(["node", str(work / "harness.mjs")],
                              capture_output=True, text=True, timeout=60)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


class GlbStoreResolveTests(unittest.TestCase):
    r: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.r = run_harness()

    def test_a_tree_url_parses_into_prefix_tree_and_rel(self) -> None:
        p = self.r["parse"]
        self.assertEqual({"prefix": "", "treeBase": "models", "rel": "Tiger.glb",
                          "query": "?t=1"}, p["vanilla"])
        self.assertEqual({"prefix": "", "treeBase": "models/mods/fhsw",
                          "rel": "poses/gaits/Gun.gait.glb", "query": ""}, p["mod"])
        self.assertEqual({"prefix": "http://host/viewer/",
                          "treeBase": "http://host/viewer/models/mods/fhsw",
                          "rel": "Tiger.glb", "query": ""}, p["absolute"])
        # A level scene, a manifest and a blob are not the store's to answer.
        self.assertIsNone(p["maps"])
        self.assertIsNone(p["manifest"])
        self.assertIsNone(p["bare"])

    def test_a_hashed_model_name_resolves_to_its_blob(self) -> None:
        self.assertEqual({"url": "glbs/S1.glb?t=1", "resourcePath": "models/mods/fhsw/"},
                         self.r["model"])
        self.assertEqual("glbs/S2.glb", self.r["cockpit"]["url"])
        self.assertEqual("glbs/S3.glb", self.r["wreck"]["url"])
        # One manifest fetch serves every lookup in the tree.
        self.assertEqual(1, self.r["modelsJsonFetches"])

    def test_a_name_with_no_sha_keeps_its_old_path(self) -> None:
        self.assertEqual({"url": "models/mods/fhsw/Old.glb", "resourcePath": None},
                         self.r["noSha"])
        # Exact names only: a spelling that would 404 today still 404s, rather
        # than the mod's copy answering where vanilla's used to.
        self.assertIsNone(self.r["caseMiss"]["resourcePath"])

    def test_an_untreated_tree_is_served_untouched_and_asked_once(self) -> None:
        self.assertEqual({"url": "models/Tiger.glb", "resourcePath": None},
                         self.r["untreated"])
        self.assertEqual(1, self.r["untreatedFetches"])

    def test_rigs_resolve_through_the_rig_index(self) -> None:
        self.assertEqual({"url": "glbs/S4.glb?v=9", "resourcePath": "models/mods/fhsw/viewmodels/"},
                         self.r["rig"])
        # The bare-array index the extractor writes carries no shas.
        self.assertIsNone(self.r["rigOldIndex"]["resourcePath"])
        # Level paint under viewmodels/skins/ is no rig and is left alone.
        self.assertIsNone(self.r["skin"]["resourcePath"])

    def test_poses_rigs_and_gaits_resolve_through_the_pose_index(self) -> None:
        self.assertEqual("glbs/S5.glb", self.r["pose"]["url"])
        self.assertEqual("glbs/S6.glb", self.r["gait"]["url"])
        self.assertEqual("glbs/S7.glb", self.r["poseRig"]["url"])
        self.assertEqual("models/mods/fhsw/poses/gaits/", self.r["gait"]["resourcePath"])

    def test_a_level_scene_is_not_the_stores_business(self) -> None:
        self.assertEqual({"url": "maps/bocage/scene.glb", "resourcePath": None},
                         self.r["scene"])
        self.assertTrue(self.r["noFetchForScene"])

    def test_the_blob_url_keeps_the_trees_prefix(self) -> None:
        self.assertEqual({"url": "../glbs/S1.glb", "resourcePath": "../models/mods/fhsw/"},
                         self.r["relative"])
        self.assertEqual({"url": "http://host/viewer/glbs/S1.glb?v=2",
                          "resourcePath": "http://host/viewer/models/mods/fhsw/"},
                         self.r["absolute"])

    def test_a_failed_manifest_fetch_is_retried_not_remembered(self) -> None:
        self.assertIsNone(self.r["errFirst"]["resourcePath"])
        self.assertIsNone(self.r["errSecond"]["resourcePath"])
        self.assertEqual(2, self.r["errFetches"])

    def test_forgetting_the_tables_refetches(self) -> None:
        self.assertEqual(2, self.r["refetchedAfterForget"])


if __name__ == "__main__":
    unittest.main()
