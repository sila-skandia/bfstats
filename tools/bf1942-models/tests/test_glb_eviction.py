"""Local eviction of glb-store blobs the volume holds (`features/mesh-asset-size`,
"Local eviction").

The store's `.on-volume.json` (`bf42/onvolume.py`) is written by the
publisher from its volume listing. A blob it names at the local size may be
removed (`evict_glbs.py`), and then: `store_glbs.py` does not write it back
but still records its sha, the publisher's `store_check` reads it as present,
and the record itself never goes to the volume.
"""

from __future__ import annotations

import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(HERE))

from bf42 import glbgz, glbstore, onvolume  # noqa: E402
import evict_glbs  # noqa: E402

SCRIPT = HERE.parents[1] / "scripts" / "publish-mesh-delta.py"


def load_publisher():
    spec = importlib.util.spec_from_file_location("publish_mesh_delta_evict", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def write(path: Path, data) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    if isinstance(data, bytes):
        path.write_bytes(data)
    else:
        path.write_text(json.dumps(data))
    return path


class Base(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.root = Path(self._tmp.name)
        self.store = self.root / "glbs"
        self.tank = b"GLB tank bytes " * 50
        self.sha = glbstore.sha256_bytes(self.tank)
        write(self.root / "models" / "Tank.glb", self.tank)
        write(self.root / "models" / "models.json",
              [{"name": "Tank", "glb": "Tank.glb", "cockpit": None, "variants": []}])

    def record(self, files: dict[str, int]) -> None:
        rec = onvolume.VolumeRecord.load(self.store)
        rec.replace(files)
        rec.save()

    def volume_holds_tank(self) -> None:
        gz = glbgz.compress(self.tank)
        self.record({f"{self.sha}.glb": len(self.tank), f"{self.sha}.glb.gz": len(gz)})


class StoreWriteOnce(Base):
    def test_an_evicted_blob_is_not_written_back_but_its_sha_is_recorded(self) -> None:
        self.volume_holds_tank()
        result = glbstore.store_tree(self.root / "models", self.root)
        self.assertFalse((self.store / f"{self.sha}.glb").exists())
        self.assertFalse((self.store / f"{self.sha}.glb.gz").exists())
        self.assertEqual(1, result.remote)
        self.assertEqual(0, result.blobs_written)
        rows = json.loads((self.root / "models" / "models.json").read_text())
        self.assertEqual(self.sha, rows[0]["sha"])

    def test_a_record_at_another_size_does_not_count(self) -> None:
        self.record({f"{self.sha}.glb": len(self.tank) + 1})
        result = glbstore.store_tree(self.root / "models", self.root)
        self.assertTrue((self.store / f"{self.sha}.glb").is_file())
        self.assertEqual(0, result.remote)

    def test_without_a_record_the_store_is_written_as_before(self) -> None:
        result = glbstore.store_tree(self.root / "models", self.root)
        self.assertEqual(1, result.blobs_written)
        self.assertEqual(self.tank, (self.store / f"{self.sha}.glb").read_bytes())

    def test_a_blob_still_held_locally_is_untouched_by_the_record(self) -> None:
        glbstore.store_tree(self.root / "models", self.root)
        self.volume_holds_tank()
        result = glbstore.store_tree(self.root / "models", self.root)
        self.assertEqual(0, result.remote)
        self.assertTrue((self.store / f"{self.sha}.glb").is_file())

    def test_an_unreadable_record_holds_nothing(self) -> None:
        write(self.store / onvolume.RECORD_NAME, b"{not json")
        self.assertEqual(0, len(onvolume.VolumeRecord.load(self.store)))
        write(self.store / onvolume.RECORD_NAME, {"format": "other", "files": {"a": 1}})
        self.assertEqual(0, len(onvolume.VolumeRecord.load(self.store)))


class EvictCommand(Base):
    def test_evicts_a_blob_and_its_copies_only_when_all_are_on_the_volume(self) -> None:
        glbstore.store_tree(self.root / "models", self.root)
        other = b"other glb " * 30
        osha = glbstore.sha256_bytes(other)
        write(self.store / f"{osha}.glb", other)
        write(self.store / f"{osha}.glb.gz", glbgz.compress(other))
        gz = (self.store / f"{self.sha}.glb.gz").stat().st_size
        # The tank and its .gz are on the volume; the other blob's .gz is not.
        self.record({f"{self.sha}.glb": len(self.tank), f"{self.sha}.glb.gz": gz,
                     f"{osha}.glb": len(other)})
        files, kept = evict_glbs.plan(self.store, onvolume.VolumeRecord.load(self.store))
        self.assertEqual({f"{self.sha}.glb", f"{self.sha}.glb.gz"}, {p.name for p, _ in files})
        self.assertEqual(1, kept)

    def test_never_offers_the_record_or_a_foreign_name(self) -> None:
        write(self.store / "notes.glb", b"x")
        self.record({"notes.glb": 1, onvolume.RECORD_NAME: 10})
        files, _ = evict_glbs.plan(self.store, onvolume.VolumeRecord.load(self.store))
        self.assertEqual([], files)
        self.assertFalse(onvolume.is_store_name("notes.glb"))
        self.assertTrue(onvolume.is_store_name(f"{self.sha}.glb.br"))


class PublisherSeesEvictedBlobs(Base):
    @classmethod
    def setUpClass(cls) -> None:
        cls.pub = load_publisher()

    def setUp(self) -> None:
        super().setUp()
        self._kept = self.pub.VIEWER
        self.pub.VIEWER = self.root
        self.addCleanup(lambda: setattr(self.pub, "VIEWER", self._kept))
        write(self.root / "models" / "models.json",
              [{"name": "Tank", "glb": "Tank.glb", "sha": self.sha}])

    def check(self) -> bool:
        return self.pub.store_check(self.root / "models", ["models.json"], "models")

    def test_store_check_reads_an_evicted_blob_the_volume_holds_as_present(self) -> None:
        self.store.mkdir()
        self.assertFalse(self.check())          # no blob, no record
        self.volume_holds_tank()
        self.assertTrue(self.check())

    def test_store_check_still_refuses_a_rewritten_glb_against_the_record(self) -> None:
        self.volume_holds_tank()
        write(self.root / "models" / "Tank.glb", self.tank + b"rewritten")
        self.assertFalse(self.check())

    def test_the_record_never_goes_to_the_volume(self) -> None:
        self.volume_holds_tank()
        write(self.store / f"{self.sha}.glb", self.tank)
        local = self.pub.local_files("glbs")
        self.assertIn(f"{self.sha}.glb", local)
        self.assertNotIn(onvolume.RECORD_NAME, local)

    def test_a_listing_of_the_store_writes_the_record_even_on_a_dry_run(self) -> None:
        pub = self.pub

        class FakeVolume(pub.Volume):
            def __init__(self, files):          # no cluster
                self.files = files

            def listing(self, tree):
                return dict(self.files)

        write(self.store / f"{self.sha}.glb", self.tank)
        write(self.store / f"{self.sha}.glb.gz", glbgz.compress(self.tank))
        held = {f"{'a' * 64}.glb": 7}
        self.assertTrue(pub.publish(FakeVolume(held), "glbs", 1, True))
        self.assertEqual(held, onvolume.VolumeRecord.load(self.store).files)
        # And an evicted blob the volume holds is "on the volume only": not sent.
        (self.store / f"{self.sha}.glb").unlink()
        (self.store / f"{self.sha}.glb.gz").unlink()
        gz = len(glbgz.compress(self.tank))
        self.assertTrue(pub.publish(FakeVolume({f"{self.sha}.glb": len(self.tank),
                                                f"{self.sha}.glb.gz": gz}), "glbs", 1, True))
        self.assertTrue(onvolume.VolumeRecord.load(self.store).holds(f"{self.sha}.glb",
                                                                     len(self.tank)))


if __name__ == "__main__":
    unittest.main()
