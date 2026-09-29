"""scripts/publish-mesh-delta.py keeps every glb and its .gz in step on the volume."""
from __future__ import annotations

import importlib.util
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from bf42 import glbgz  # noqa: E402

SCRIPT = Path(__file__).resolve().parents[3] / "scripts" / "publish-mesh-delta.py"
spec = importlib.util.spec_from_file_location("publish_mesh_delta", SCRIPT)
publisher = importlib.util.module_from_spec(spec)
spec.loader.exec_module(publisher)


class FakeVolume:
    def __init__(self, files: dict[str, int]) -> None:
        self.files = files

    def listing(self, tree: str) -> dict[str, int]:
        return dict(self.files)


class GzipPairTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.base = Path(self.tmp.name)

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def glb(self, rel: str, data: bytes, gz: bytes | None = None) -> None:
        path = self.base / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
        if gz is not None:
            glbgz.gz_path(path).write_bytes(gz)

    def local(self) -> dict[str, int]:
        return {str(p.relative_to(self.base)): p.stat().st_size
                for p in self.base.rglob("*") if p.is_file()}

    def pairs(self, send: list[str], remote: dict[str, int] | None = None,
              allow_plain: bool = False):
        return publisher.gzip_pairs(self.base, self.local(), remote or {}, send, allow_plain)

    def test_the_trailer_check_matches_the_writer(self) -> None:
        data = b"glTF" * 5000
        self.glb("a/scene.glb", data, glbgz.compress(data))
        self.assertTrue(publisher.gz_fresh(self.base / "a/scene.glb", self.base / "a/scene.glb.gz"))
        self.glb("b/scene.glb", data, glbgz.compress(b"glTX" * 5000))   # same length
        self.assertFalse(publisher.gz_fresh(self.base / "b/scene.glb", self.base / "b/scene.glb.gz"))

    def test_a_glb_that_goes_takes_its_gz_even_when_the_gz_looks_landed(self) -> None:
        data = b"glTF" * 100
        self.glb("bocage/scene.glb", data, glbgz.compress(data))
        send, problems, _ = self.pairs(["bocage/scene.glb"],
                                       remote={"bocage/scene.glb.gz": len(glbgz.compress(data))})
        self.assertEqual([], problems)
        self.assertEqual(["bocage/scene.glb", "bocage/scene.glb.gz"], send)

    def test_a_stale_gz_stops_the_publish(self) -> None:
        self.glb("bocage/scene.glb", b"new" * 100, glbgz.compress(b"old" * 100))
        _, problems, _ = self.pairs(["bocage/scene.glb", "bocage/scene.glb.gz"])
        self.assertEqual(1, len(problems))
        # Also when only the .gz is about to go.
        _, problems, _ = self.pairs(["bocage/scene.glb.gz"])
        self.assertEqual(1, len(problems))

    def test_a_missing_gz_stops_the_publish_unless_plain_is_allowed(self) -> None:
        self.glb("Sherman.glb", b"glTF" * 100)
        _, problems, _ = self.pairs(["Sherman.glb"])
        self.assertEqual(1, len(problems))
        send, problems, plain = self.pairs(["Sherman.glb"], allow_plain=True)
        self.assertEqual(([], ["Sherman.glb"], ["Sherman.glb"]), (problems, plain, send))

    def test_plain_is_refused_while_the_volume_holds_an_older_gz(self) -> None:
        # nginx would go on sending the old .gz to every client that takes gzip.
        self.glb("Sherman.glb", b"glTF" * 100)
        _, problems, _ = self.pairs(["Sherman.glb"], remote={"Sherman.glb.gz": 40},
                                    allow_plain=True)
        self.assertEqual(1, len(problems))

    def test_an_orphan_gz_stops_the_publish(self) -> None:
        (self.base / "gone.glb.gz").write_bytes(glbgz.compress(b"x"))
        _, problems, _ = self.pairs(["gone.glb.gz"])
        self.assertEqual(1, len(problems))

    def test_other_files_pass_through(self) -> None:
        (self.base / "maps.json").write_text("[]")
        self.assertEqual((["maps.json"], [], []), self.pairs(["maps.json"]))

    def test_a_dry_run_lists_the_gz_beside_its_glb(self) -> None:
        big = bytes(range(256)) * 4000
        for name in ("a", "b"):
            self.glb(f"{name}/scene.glb", big, glbgz.compress(big))
        volume = FakeVolume({})
        old = publisher.VIEWER
        publisher.VIEWER = self.base.parent
        try:
            tree = self.base.name
            order = sorted(self.local(), key=publisher.rank)
            self.assertEqual(["a/scene.glb", "a/scene.glb.gz", "b/scene.glb", "b/scene.glb.gz"],
                             order)
            self.assertTrue(publisher.publish(volume, tree, 1, True))
        finally:
            publisher.VIEWER = old

    def test_a_unit_boundary_never_falls_between_a_glb_and_its_gz(self) -> None:
        unit = publisher.UNIT_BYTES
        local = {"a/scene.glb": unit - 10, "a/scene.glb.gz": unit // 2,
                 "b/scene.glb": 100, "b/scene.glb.gz": 50}
        self.assertEqual([["a/scene.glb", "a/scene.glb.gz"], ["b/scene.glb", "b/scene.glb.gz"]],
                         publisher.pack_units(list(local), local))


if __name__ == "__main__":
    unittest.main()
