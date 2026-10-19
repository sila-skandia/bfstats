"""`bf42/glbstore.py`: the content-addressed glb store (mesh-asset-size,
phase 5).

Every model, rig and pose glb a tree's manifests name is stored once as
`glbs/<sha256>.glb` with a deterministic `.glb.gz`, byte-identical to the
per-tree file, and the manifests record `name -> sha`. Running it twice
changes nothing; a file no manifest names is neither stored nor recorded, so
an untreated name keeps its per-tree path.
"""

from __future__ import annotations

import gzip
import hashlib
import json
import os
import tempfile
import unittest
from pathlib import Path

import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from bf42 import glbgz, glbstore  # noqa: E402


def write(path: Path, data) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    if isinstance(data, bytes):
        path.write_bytes(data)
    else:
        path.write_text(json.dumps(data, indent=1) + "\n")
    return path


def snapshot(root: Path) -> dict[str, str]:
    return {str(p.relative_to(root)): hashlib.sha256(p.read_bytes()).hexdigest()
            for p in sorted(root.rglob("*")) if p.is_file()}


class GlbStoreTests(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.root = Path(self._tmp.name)
        self.tree = self.root / "models"

        self.tank = b"GLB tank bytes " * 50
        self.cockpit = b"GLB cockpit bytes " * 20
        self.wreck = b"GLB wreck bytes " * 30
        self.rig = b"GLB rig bytes, the same for two nations " * 40
        self.pose = b"GLB pose bytes " * 25
        self.gait = b"GLB gait bytes " * 10
        self.srig = b"GLB soldier rig bytes " * 15

        write(self.tree / "Tank.glb", self.tank)
        write(self.tree / "Tank.cockpit.glb", self.cockpit)
        write(self.tree / "Tank.wreck.glb", self.wreck)
        write(self.tree / "Loose.kit.glb", b"kit bytes no manifest names")
        write(self.tree / "models.json", [
            {"name": "Tank", "glb": "Tank.glb", "cockpit": "Tank.cockpit.glb",
             "variants": [{"glb": "Tank.glb", "level": None},
                          {"glb": "Tank.wreck.glb", "configuration": "wreck"}]},
            # A row whose file is gone, carrying a stale sha to be dropped.
            {"name": "Ghost", "glb": "Ghost.glb", "cockpit": None, "sha": "stale"},
        ])
        write(self.tree / "viewmodels" / "A__Gun.fp.glb", self.rig)
        write(self.tree / "viewmodels" / "B__Gun.fp.glb", self.rig)   # nation twin
        write(self.tree / "viewmodels" / "skins" / "lvl.skin.glb", b"level paint")
        write(self.tree / "viewmodels" / "index.json", ["A__Gun", "B__Gun"])
        write(self.tree / "poses" / "A__Gun.pose.glb", self.pose)
        write(self.tree / "poses" / "rigs" / "ASoldier.rig.glb", self.srig)
        write(self.tree / "poses" / "gaits" / "Gun.gait.glb", self.gait)
        write(self.tree / "poses" / "index.json",
              {"format": "bf1942-pose-index/1", "recipe": [], "glb": ["A__Gun"]})
        # One file has a fresh sidecar .gz (the optimiser's), to be reused.
        glbgz.ensure(self.tree / "Tank.glb", self.tank)

        # A mod tree holding its chain's copy of the tank, plus its own rig.
        self.mod = self.tree / "mods" / "m2"
        write(self.mod / "Tank.glb", self.tank)
        write(self.mod / "models.json", [{"name": "Tank", "glb": "Tank.glb",
                                          "cockpit": None, "variants": []}])

    def run_store(self, tree=None, **kwargs) -> glbstore.Result:
        return glbstore.store_tree(tree or self.tree, self.root, **kwargs)

    def test_every_name_resolves_to_a_byte_identical_blob(self) -> None:
        self.run_store()
        rows = json.loads((self.tree / "models.json").read_text())
        tank = rows[0]
        for sha, original in [(tank["sha"], self.tank),
                              (tank["cockpitSha"], self.cockpit),
                              (tank["variants"][0]["sha"], self.tank),
                              (tank["variants"][1]["sha"], self.wreck)]:
            blob = self.root / "glbs" / f"{sha}.glb"
            self.assertEqual(original, blob.read_bytes())
            self.assertEqual(hashlib.sha256(original).hexdigest(), sha)
            gz = self.root / "glbs" / f"{sha}.glb.gz"
            self.assertEqual(original, gzip.decompress(gz.read_bytes()))

    def test_a_reused_sidecar_gz_is_the_deterministic_bytes(self) -> None:
        self.run_store()
        sha = glbstore.sha256_bytes(self.tank)
        self.assertEqual(glbgz.compress(self.tank),
                         (self.root / "glbs" / f"{sha}.glb.gz").read_bytes())

    def test_a_fresh_sidecar_br_rides_into_the_store_and_nothing_makes_one(self) -> None:
        # The store never compresses brotli itself (minutes per big glb); it
        # carries a fresh .br across, and a blob without one is served gzip.
        from bf42 import glbbr
        write(glbbr.br_path(self.tree / "Tank.glb"), glbbr.compress(self.tank))
        self.run_store()
        sha = glbstore.sha256_bytes(self.tank)
        self.assertEqual(glbbr.compress(self.tank),
                         (self.root / "glbs" / f"{sha}.glb.br").read_bytes())
        others = {p.name for p in (self.root / "glbs").glob("*.br")}
        self.assertEqual({f"{sha}.glb.br"}, others)

    def test_a_stale_sidecar_br_stays_out_of_the_store(self) -> None:
        from bf42 import glbbr
        write(glbbr.br_path(self.tree / "Tank.glb"), glbbr.compress(b"older tank bytes"))
        self.run_store()
        self.assertEqual([], list((self.root / "glbs").glob("*.br")))

    def test_twin_rigs_share_one_blob_and_the_index_carries_both(self) -> None:
        result = self.run_store()
        doc = json.loads((self.tree / "viewmodels" / "index.json").read_text())
        self.assertEqual(glbstore.RIG_INDEX_FORMAT, doc["format"])
        self.assertEqual(["A__Gun", "B__Gun"], doc["rigs"])
        sha = glbstore.sha256_bytes(self.rig)
        self.assertEqual({"A__Gun.fp.glb": sha, "B__Gun.fp.glb": sha}, doc["sha"])
        self.assertEqual(1, len(list((self.root / "glbs").glob(f"{sha}.glb"))))
        # Two files, one distinct blob.
        self.assertGreater(result.files, result.distinct)

    def test_the_pose_index_covers_poses_rigs_and_gaits(self) -> None:
        self.run_store()
        doc = json.loads((self.tree / "poses" / "index.json").read_text())
        self.assertEqual({"A__Gun.pose.glb": glbstore.sha256_bytes(self.pose),
                          "rigs/ASoldier.rig.glb": glbstore.sha256_bytes(self.srig),
                          "gaits/Gun.gait.glb": glbstore.sha256_bytes(self.gait)},
                         doc["sha"])
        self.assertEqual("bf1942-pose-index/1", doc["format"])

    def test_what_no_manifest_names_is_neither_stored_nor_recorded(self) -> None:
        self.run_store()
        stored = {p.read_bytes() for p in (self.root / "glbs").glob("*.glb")}
        self.assertNotIn(b"kit bytes no manifest names", stored)
        self.assertNotIn(b"level paint", stored)
        text = (self.tree / "models.json").read_text()
        self.assertNotIn("Loose.kit.glb", text)

    def test_a_missing_file_gets_no_sha_and_loses_a_stale_one(self) -> None:
        self.run_store()
        ghost = json.loads((self.tree / "models.json").read_text())[1]
        self.assertNotIn("sha", ghost)
        self.assertNotIn("cockpitSha", ghost)

    def test_running_twice_changes_nothing(self) -> None:
        self.run_store()
        self.run_store(self.mod)
        before = snapshot(self.root)
        second = self.run_store()
        second_mod = self.run_store(self.mod)
        self.assertEqual(before, snapshot(self.root))
        for result in (second, second_mod):
            self.assertEqual(0, result.blobs_written)
            self.assertEqual(0, result.gz_written)
            self.assertEqual([], result.manifests)

    def test_a_chain_copy_in_a_mod_tree_is_one_blob(self) -> None:
        self.run_store()
        blobs = len(list((self.root / "glbs").glob("*.glb")))
        result = self.run_store(self.mod)
        self.assertEqual(blobs, len(list((self.root / "glbs").glob("*.glb"))))
        self.assertEqual(0, result.blobs_written)
        row = json.loads((self.mod / "models.json").read_text())[0]
        self.assertEqual(glbstore.sha256_bytes(self.tank), row["sha"])

    def test_a_corrupt_blob_stops_the_run(self) -> None:
        self.run_store()
        sha = glbstore.sha256_bytes(self.tank)
        blob = self.root / "glbs" / f"{sha}.glb"
        blob.write_bytes(b"x" * (len(self.tank) + 1))       # wrong size: always caught
        with self.assertRaises(ValueError):
            self.run_store()
        blob.write_bytes(b"x" * len(self.tank))             # right size: --verify catches it
        with self.assertRaises(ValueError):
            self.run_store(verify=True)

    def test_an_untreated_tree_is_left_alone(self) -> None:
        bare = self.root / "models" / "mods" / "bare"
        write(bare / "Thing.glb", b"thing")
        before = snapshot(bare)
        result = self.run_store(bare)
        self.assertEqual(before, snapshot(bare))
        self.assertEqual(0, result.files)
        self.assertEqual([], result.manifests)

    def test_rig_index_stems_reads_both_forms(self) -> None:
        self.assertEqual(["A", "B"], glbstore.rig_index_stems(["A", "B"]))
        self.assertEqual(["A"], glbstore.rig_index_stems(
            {"format": glbstore.RIG_INDEX_FORMAT, "rigs": ["A"], "sha": {}}))
        self.assertEqual([], glbstore.rig_index_stems({"rigs": "no"}))
        self.assertEqual([], glbstore.rig_index_stems(None))

    def test_the_store_cli_derives_the_mesh_root(self) -> None:
        import store_glbs  # noqa: PLC0415
        self.assertEqual(self.root, store_glbs.mesh_root_of(self.mod))
        self.assertEqual(self.root, store_glbs.mesh_root_of(self.tree))
        self.assertIsNone(store_glbs.mesh_root_of(self.root))

    def test_the_mods_flag_expands_to_every_mod_tree(self) -> None:
        import store_glbs  # noqa: PLC0415
        write(self.root / "models" / "mods" / "zz" / "marker.txt", b"")
        self.assertEqual([self.tree, self.mod, self.root / "models" / "mods" / "zz"],
                         store_glbs.expand([self.tree], mods=True))
        self.assertEqual([self.tree], store_glbs.expand([self.tree], mods=False))


if __name__ == "__main__":
    unittest.main()
