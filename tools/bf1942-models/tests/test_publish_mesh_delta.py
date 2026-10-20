"""`scripts/publish-mesh-delta.py`, the glb-store half (mesh-asset-size,
phase 5): the `glbs` tree ranks before `models` and a blob's `.gz` rides with
it; the sha-carrying manifests land last; a manifest whose sha no longer
matches the store refuses the publish; an unpublished mod's blobs stay home
unless a published tree records the same sha; a blob's `../`-spelled texture
URIs are checked against the shared store, not the store directory.
"""

from __future__ import annotations

import importlib.util
import json
import struct
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
SCRIPT = ROOT / "scripts" / "publish-mesh-delta.py"

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from bf42 import glbgz, glbstore  # noqa: E402


def load_publisher():
    spec = importlib.util.spec_from_file_location("publish_mesh_delta", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def glb_with_uri(uri: str) -> bytes:
    """A minimal valid glb whose JSON chunk carries one image URI."""
    doc = json.dumps({"asset": {"version": "2.0"}, "images": [{"uri": uri}]}).encode()
    doc += b" " * (-len(doc) % 4)
    return (b"glTF" + struct.pack("<II", 2, 28 + len(doc))
            + struct.pack("<I4s", len(doc), b"JSON") + doc)


class PublishMeshDeltaTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.pub = load_publisher()

    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.viewer = Path(self._tmp.name)
        self._kept = self.pub.VIEWER
        self.pub.VIEWER = self.viewer
        self.addCleanup(lambda: setattr(self.pub, "VIEWER", self._kept))

    def write(self, rel: str, data) -> Path:
        path = self.viewer / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        if isinstance(data, bytes):
            path.write_bytes(data)
        else:
            path.write_text(json.dumps(data))
        return path

    def test_glbs_rank_before_models_and_a_gz_rides_with_its_blob(self) -> None:
        self.assertEqual(["textures", "glbs", "models", "maps"], self.pub.TREES)
        order = sorted(["aa.glb.gz", "aa.glb", "zz.glb"], key=self.pub.rank)
        self.assertEqual(["aa.glb", "aa.glb.gz", "zz.glb"], order)

    def test_the_sha_manifests_are_held_last(self) -> None:
        for name in ("models.json", "index.json", "kits.json", "mods.json", "maps.json"):
            self.assertIn(name, self.pub.MANIFESTS)

    def test_store_check_passes_a_consistent_tree(self) -> None:
        data = b"glb bytes " * 10
        sha = glbstore.sha256_bytes(data)
        self.write(f"glbs/{sha}.glb", data)
        self.write("models/mods/m/Tank.glb", data)
        self.write("models/mods/m/models.json",
                   [{"name": "Tank", "glb": "Tank.glb", "sha": sha}])
        self.assertTrue(self.pub.store_check(self.viewer / "models",
                                             ["mods/m/models.json"], "models"))
        # Not the models tree: nothing to check.
        self.assertTrue(self.pub.store_check(self.viewer / "maps", ["x/index.json"], "maps"))

    def test_store_check_refuses_a_rewritten_glb_and_a_missing_blob(self) -> None:
        data = b"glb bytes " * 10
        sha = glbstore.sha256_bytes(data)
        self.write(f"glbs/{sha}.glb", data)
        self.write("models/mods/m/viewmodels/A__Gun.fp.glb", data + b"rewritten")
        self.write("models/mods/m/viewmodels/index.json",
                   {"format": "bf1942-rig-index/1", "rigs": ["A__Gun"],
                    "sha": {"A__Gun.fp.glb": sha}})
        self.assertFalse(self.pub.store_check(self.viewer / "models",
                                              ["mods/m/viewmodels/index.json"], "models"))
        self.write("models/mods/m/poses/index.json",
                   {"format": "bf1942-pose-index/1", "recipe": [], "glb": [],
                    "sha": {"gaits/G.gait.glb": "0" * 64}})
        self.assertFalse(self.pub.store_check(self.viewer / "models",
                                              ["mods/m/poses/index.json"], "models"))

    def test_a_glb_the_store_serves_is_not_sent_per_tree(self) -> None:
        data = b"glb bytes " * 10
        sha = glbstore.sha256_bytes(data)
        self.write("models/mods/m/Tank.glb", data)
        self.write("models/mods/m/Tank.glb.gz", glbgz.compress(data))
        self.write("models/mods/m/New.glb", data + b"new")
        self.write("models/mods/m/viewmodels/A__Gun.fp.glb", data)
        self.write("models/mods/m/viewmodels/index.json",
                   {"rigs": ["A__Gun"], "sha": {"A__Gun.fp.glb": sha}})
        self.write("models/mods/m/models.json",
                   [{"name": "Tank", "glb": "Tank.glb", "sha": sha},
                    {"name": "New", "glb": "New.glb", "sha": glbstore.sha256_bytes(data + b"new")}])
        local = self.pub.local_files("models")
        served = self.pub.store_served(self.viewer / "models", local, {f"{sha}.glb": len(data)})
        # GC'd from the volume (phase 5): the blob serves it, so it never goes again.
        self.assertIn("mods/m/Tank.glb", served)
        self.assertIn("mods/m/Tank.glb.gz", served)
        self.assertIn("mods/m/viewmodels/A__Gun.fp.glb", served)
        # A blob the volume does not hold yet: the per-tree file still goes.
        self.assertNotIn("mods/m/New.glb", served)
        # A manifest is never "served".
        self.assertNotIn("mods/m/models.json", served)

    def test_a_blob_of_another_size_does_not_serve(self) -> None:
        data = b"glb bytes " * 10
        sha = glbstore.sha256_bytes(data)
        self.write("models/T.glb", data)
        self.write("models/models.json", [{"name": "T", "glb": "T.glb", "sha": sha}])
        local = self.pub.local_files("models")
        self.assertEqual(set(), self.pub.store_served(self.viewer / "models", local,
                                                      {f"{sha}.glb": len(data) + 1}))

    def test_an_unpublished_mods_blobs_stay_home(self) -> None:
        shared = b"shared bytes"
        private = b"dc_final only"
        sha_shared = glbstore.sha256_bytes(shared)
        sha_private = glbstore.sha256_bytes(private)
        for sha, data in ((sha_shared, shared), (sha_private, private)):
            self.write(f"glbs/{sha}.glb", data)
            self.write(f"glbs/{sha}.glb.gz", glbgz.compress(data))
        self.write("models/models.json", [{"name": "T", "glb": "T.glb", "sha": sha_shared}])
        self.write("models/mods/dc_final/models.json",
                   [{"name": "T", "glb": "T.glb", "sha": sha_shared},
                    {"name": "P", "glb": "P.glb", "sha": sha_private}])
        kept = self.pub.UNPUBLISHED_MODS
        self.pub.UNPUBLISHED_MODS = {"dc_final"}
        try:
            local = self.pub.local_files("glbs")
        finally:
            self.pub.UNPUBLISHED_MODS = kept
        self.assertIn(f"{sha_shared}.glb", local)
        self.assertIn(f"{sha_shared}.glb.gz", local)
        self.assertNotIn(f"{sha_private}.glb", local)
        self.assertNotIn(f"{sha_private}.glb.gz", local)

    def test_a_blobs_climbing_uris_are_checked_against_the_shared_store(self) -> None:
        blob = glb_with_uri("../../../textures/ab/cafe.webp")
        self.write("glbs/deadbeef.glb", blob)
        base = self.viewer / "glbs"
        # Missing texture: refused.
        self.assertFalse(self.pub.texture_check(base, ["deadbeef.glb"], "glbs"))
        # Present in the shared store: fine, whatever depth the URI climbs.
        self.write("textures/ab/cafe.webp", b"pixels")
        self.assertTrue(self.pub.texture_check(base, ["deadbeef.glb"], "glbs"))
        # The per-tree form is unchanged: resolved beside the glb.
        tree_glb = glb_with_uri("../../../textures/ab/cafe.webp")
        self.write("models/mods/m/Tank.glb", tree_glb)
        self.assertTrue(self.pub.texture_check(self.viewer / "models",
                                               ["mods/m/Tank.glb"], "models"))


if __name__ == "__main__":
    unittest.main()
