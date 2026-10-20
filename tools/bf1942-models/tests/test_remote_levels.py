"""Remote-only levels (`features/mesh-asset-size`, "Local eviction").

A published level may have its scene glbs evicted (`evict_levels.py`), leaving
`scene.remote.json` beside `scene.json`. Such a level is present to every
reader that decides whether a level is baked, counts levels or builds a
manifest; the publisher never sends or removes anything of it, and refuses a
manifest that would hide it from the live site; `serve_viewer.py` fetches its
scene on demand.
"""

from __future__ import annotations

import hashlib
import http.server
import importlib.util
import json
import sys
import tempfile
import threading
import unittest
import urllib.request
from functools import partial
from pathlib import Path

HERE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(HERE))

from bf42 import glbgz, remote_scene  # noqa: E402
import build_mods_manifest  # noqa: E402
import evict_levels  # noqa: E402
import mod_pipeline as mp  # noqa: E402
import serve_viewer  # noqa: E402

SCRIPT = HERE.parents[1] / "scripts" / "publish-mesh-delta.py"


def load_publisher():
    spec = importlib.util.spec_from_file_location("publish_mesh_delta_remote", SCRIPT)
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


class Tree(unittest.TestCase):
    """A scratch viewer: vanilla with two levels, a mod with one."""

    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.viewer = Path(self._tmp.name) / "viewer"
        self.maps = self.viewer / "maps"
        self.scene = b"glTF scene bytes " * 200
        for tree, levels in (("", ["bocage", "wake"]), ("mods/fhsw/", ["tobruk"])):
            rows = []
            for lv in levels:
                d = self.maps / tree / lv
                write(d / "scene.glb", self.scene)
                write(d / "scene.glb.gz", glbgz.compress(self.scene))
                write(d / "scene.json", {"name": lv})
                write(d / "minimap" / "minimap.png", b"png")
                rows.append({"name": lv.title(), "glb": f"{lv}/scene.glb",
                             "report": f"{lv}/scene.json", "loading": {"background": "x"}})
            write(self.maps / tree / "maps.json", rows)
        write(self.viewer / "models" / "models.json", [])
        write(self.viewer / "models" / "mods" / "fhsw" / "models.json", [])

    def volume(self) -> dict[str, int]:
        """The volume's maps tree: everything local, at the local size."""
        return {str(p.relative_to(self.maps)): p.stat().st_size
                for p in self.maps.rglob("*") if p.is_file()}

    def evict(self, tree: str, level: str) -> None:
        d = self.maps / (evict_levels.tree_prefix(tree)) / level
        lv = evict_levels.Level(tree, level, d,
                                {f: (d / f).stat().st_size for f in remote_scene.SCENE_FILES
                                 if (d / f).is_file()})
        evict_levels.evict(lv)


class MarkerSemantics(Tree):
    def test_an_evicted_level_is_present_and_remote(self) -> None:
        self.evict("bf1942", "bocage")
        d = self.maps / "bocage"
        self.assertFalse((d / "scene.glb").exists())
        self.assertFalse((d / "scene.glb.gz").exists())
        self.assertTrue((d / "scene.json").is_file())
        self.assertTrue(remote_scene.is_remote(d))
        self.assertTrue(remote_scene.has_scene(d))
        self.assertTrue(remote_scene.has_file(d, "scene.glb.gz"))
        self.assertFalse(remote_scene.has_file(d, "scene.glb.br"))   # never had one
        doc = remote_scene.read_marker(d)
        self.assertEqual(len(self.scene), doc["files"]["scene.glb"]["size"])
        self.assertEqual(64, len(doc["files"]["scene.glb"]["sha256"]))
        self.assertEqual(["bocage"], remote_scene.remote_levels(self.maps))

    def test_a_rebake_makes_the_level_local_whatever_the_marker_says(self) -> None:
        self.evict("bf1942", "bocage")
        write(self.maps / "bocage" / "scene.glb", b"new bake")
        self.assertFalse(remote_scene.is_remote(self.maps / "bocage"))
        self.assertFalse(remote_scene.has_file(self.maps / "bocage", "scene.glb.gz"))

    def test_a_missing_level_is_not_present(self) -> None:
        self.assertFalse(remote_scene.has_scene(self.maps / "nowhere"))


class EvictPlan(Tree):
    def plan(self, listing=None, keep=None, trees=("bf1942", "fhsw"), unpublished=()):
        return evict_levels.plan(self.viewer, list(trees), keep or {},
                                 self.volume() if listing is None else listing, set(unpublished))

    def test_evicts_only_what_the_volume_holds_at_the_local_size(self) -> None:
        listing = self.volume()
        listing["wake/scene.glb.gz"] += 1                      # another copy there
        del listing["mods/fhsw/tobruk/scene.glb"]              # never published
        p = self.plan(listing)
        self.assertEqual(["bocage"], [lv.name for lv in p.evict])
        reasons = {lv.name: lv.reason for lv in p.kept}
        self.assertIn("on the volume,", reasons["wake"])
        self.assertIn("not on the volume", reasons["tobruk"])

    def test_a_local_br_the_volume_lacks_keeps_the_level(self) -> None:
        listing = self.volume()
        write(self.maps / "bocage" / "scene.glb.br", b"br bytes")
        p = self.plan(listing)
        self.assertNotIn("bocage", [lv.name for lv in p.evict])

    def test_the_keep_list_and_unpublished_trees_stay(self) -> None:
        p = self.plan(keep={"bf1942": {"wake"}}, unpublished=("fhsw",))
        self.assertEqual(["bocage"], [lv.name for lv in p.evict])
        self.assertEqual(["fhsw"], p.skipped_trees)

    def test_an_evicted_level_is_counted_once_as_remote(self) -> None:
        self.evict("bf1942", "bocage")
        p = self.plan()
        self.assertEqual(["bocage"], [lv.name for lv in p.remote])
        self.assertNotIn("bocage", [lv.name for lv in p.evict + p.kept])

    def test_restore_brings_the_files_back_and_checks_them(self) -> None:
        volume = Path(self._tmp.name) / "volume"
        d = self.maps / "bocage"
        for f in ("scene.glb", "scene.glb.gz"):
            write(volume / "maps" / "bocage" / f, (d / f).read_bytes())
        self.evict("bf1942", "bocage")
        base = volume.as_uri()
        self.assertEqual(0, evict_levels.restore(self.viewer, "bf1942", ["bocage"], base))
        self.assertEqual(self.scene, (d / "scene.glb").read_bytes())
        self.assertFalse(remote_scene.marker_path(d).exists())
        # A volume copy that is not the evicted one is refused and leaves the level remote.
        self.evict("bf1942", "bocage")
        write(volume / "maps" / "bocage" / "scene.glb", b"x" * len(self.scene))
        self.assertEqual(1, evict_levels.restore(self.viewer, "bf1942", ["bocage"], base))
        self.assertTrue(remote_scene.is_remote(d))
        self.assertEqual([], [p.name for p in d.iterdir() if p.name.endswith(".restore")])

    def test_the_checked_in_keep_list_names_real_rows(self) -> None:
        """Every keep-list level is a maps.json row of its tree, where the
        real tree is on this PC."""
        keep = evict_levels.load_keep(evict_levels.KEEP_LIST)
        self.assertIn("wake", keep["bf1942"])
        real = evict_levels.VIEWER
        for tree, levels in keep.items():
            maps_json = evict_levels.tree_dir(real, tree) / "maps.json"
            if not maps_json.is_file():
                continue
            rows = {d.lower() for d in evict_levels.level_dirs(maps_json.parent)}
            self.assertEqual(set(), levels - rows, f"{tree}: keep-list names no row")


class ManifestGuard(Tree):
    def test_the_registry_counts_an_evicted_level(self) -> None:
        before = {e["id"]: e["counts"]["maps"] for e in build_mods_manifest.scan(self.viewer)}
        self.evict("bf1942", "bocage")
        self.evict("fhsw", "tobruk")
        after = {e["id"]: e["counts"]["maps"] for e in build_mods_manifest.scan(self.viewer)}
        self.assertEqual({"bf1942": 2, "fhsw": 1}, after)
        self.assertEqual(before, after)

    def test_pipeline_outputs_and_coverage_count_an_evicted_level(self) -> None:
        self.evict("bf1942", "bocage")
        full = self.maps / "*" / "scene.glb"
        self.assertEqual((2, 1), mp.glob_outputs(full))
        self.assertEqual((2, 1), mp.glob_outputs(self.maps / "*" / "scene.glb.gz"))
        self.assertEqual((0, 0), mp.glob_outputs(self.maps / "*" / "scene.glb.br"))
        cfg = mp.MODS["fh"]
        paths = {"models": self.viewer / "models", "maps": self.maps,
                 "shared": self.maps / "_shared", "models_root": self.viewer / "models",
                 "maps_root": self.maps}
        ctx = mp.Context(cfg, paths=paths, levels=["bocage", "wake"])
        rows = {r["what"]: r for r in mp.check_level_coverage(ctx)}
        stale = rows["levels whose scene.glb.gz is missing or older than scene.glb"]
        self.assertEqual(0, stale["count"])
        remote = next(r for w, r in rows.items() if w.startswith("remote-only levels"))
        self.assertEqual(["bocage"], remote["examples"])


class SkinsPassKeepsPublishedPaint(Tree):
    def test_a_remote_level_keeps_its_row_its_skin_and_its_considered_mark(self) -> None:
        import extract_viewmodel as ev
        out = self.viewer / "models" / "viewmodels"
        row = {"level": "Bocage", "file": f"{ev.SKIN_DIR}/bocage{ev.SKIN_SUFFIX}",
               "textures": {"hand": "texture/x"}}
        write(out / row["file"], b"skin glb")
        write(out / ev.SKIN_INDEX, {"levels": {"bocage": row}, "considered": ["bocage"]})
        self.evict("bf1942", "bocage")
        maps = [{"name": "Bocage", "glb": "bocage/scene.glb", "report": "bocage/scene.json"}]
        index = ev.write_level_skins(out, maps, game_dir=Path(self._tmp.name), mod="bf1942",
                                     chain=[], textures=None, assembler=None, previous=None)
        self.assertEqual({"bocage": row}, index["levels"])
        self.assertEqual(["bocage"], index["considered"])
        self.assertTrue((out / row["file"]).is_file())


class PublisherGuard(Tree):
    @classmethod
    def setUpClass(cls) -> None:
        cls.pub = load_publisher()

    def setUp(self) -> None:
        super().setUp()
        self._kept = self.pub.VIEWER
        self.pub.VIEWER = self.viewer
        self.addCleanup(lambda: setattr(self.pub, "VIEWER", self._kept))

    class Volume:
        def __init__(self, files):
            self.files = files

        def listing(self, tree):
            return dict(self.files)

    def publish(self, listing, tree="maps", lines=None) -> bool:
        import contextlib
        import io
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            ok = self.pub.publish(self.Volume(listing), tree, 1, True, list_files=True)
        if lines is not None:
            lines.extend(buf.getvalue().splitlines())
        return ok

    def test_an_evicted_level_is_neither_sent_nor_removed(self) -> None:
        listing = self.volume()
        self.evict("bf1942", "bocage")
        self.evict("fhsw", "tobruk")
        out: list[str] = []
        self.assertTrue(self.publish(listing, lines=out))
        sent = [line.strip().split()[0] for line in out if line.startswith("  ")]
        self.assertEqual([], sent)                    # nothing to send at all
        self.assertTrue(any("2 remote-only levels" in line for line in out))
        self.assertNotIn("bocage/scene.remote.json", self.pub.local_files("maps"))
        self.assertTrue(any("0 to send" in line and "left alone" in line for line in out))

    def test_a_maps_json_that_drops_an_evicted_level_is_refused(self) -> None:
        listing = self.volume()
        self.evict("bf1942", "bocage")
        write(self.maps / "maps.json", [{"name": "Wake", "glb": "wake/scene.glb",
                                         "report": "wake/scene.json"}])
        out: list[str] = []
        self.assertFalse(self.publish(listing, lines=out))
        self.assertTrue(any("drops 1 remote-only levels: bocage" in line for line in out))

    def test_a_mods_json_that_undercounts_an_evicted_tree_is_refused(self) -> None:
        self.evict("fhsw", "tobruk")
        mods = {"mods": build_mods_manifest.scan(self.viewer)}
        write(self.viewer / "models" / "mods.json", mods)
        self.assertTrue(self.publish({}, tree="models"))
        for entry in mods["mods"]:
            if entry["id"] == "fhsw":
                entry["counts"]["maps"] = 0
        write(self.viewer / "models" / "mods.json", mods)
        out: list[str] = []
        self.assertFalse(self.publish({}, tree="models", lines=out))
        self.assertTrue(any("counts 0 maps for fhsw" in line for line in out))

    def test_a_volume_missing_an_evicted_scene_is_reported(self) -> None:
        listing = self.volume()
        self.evict("bf1942", "bocage")
        del listing["bocage/scene.glb"]
        out: list[str] = []
        self.assertTrue(self.publish(listing, lines=out))
        self.assertTrue(any(line.startswith("WARNING bocage/scene.glb") for line in out))


class ServeViewerFallback(Tree):
    def serve(self, root: Path, handler_cls) -> str:
        server = http.server.ThreadingHTTPServer(("127.0.0.1", 0),
                                                 partial(handler_cls, directory=str(root)))
        threading.Thread(target=server.serve_forever, daemon=True).start()
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        return f"http://127.0.0.1:{server.server_address[1]}"

    def setUp(self) -> None:
        super().setUp()
        self.volume_root = Path(self._tmp.name) / "volume"
        write(self.volume_root / "maps" / "bocage" / "scene.glb", self.scene)
        self.blob_sha = hashlib.sha256(b"blob").hexdigest()
        write(self.volume_root / "glbs" / (self.blob_sha + ".glb"), b"blob")
        write(self.volume_root / "glbs" / ("b" * 64 + ".glb"), b"not what the name says")

        class Quiet(http.server.SimpleHTTPRequestHandler):
            def log_message(self, *a):
                pass
        self.mesh = self.serve(self.volume_root, Quiet)
        self.cache = Path(self._tmp.name) / "cache"

    def local(self, remote: bool, trees=serve_viewer.REMOTE_TREES) -> str:
        cache = serve_viewer.RemoteCache(self.mesh, self.cache, trees=trees) if remote else None
        handler = type("H", (serve_viewer.Handler,),
                       {"remote": cache, "log_message": lambda *a: None})
        return self.serve(self.viewer, handler)

    def get(self, url: str) -> tuple[int, bytes]:
        try:
            with urllib.request.urlopen(url, timeout=10) as reply:
                return reply.status, reply.read()
        except urllib.error.HTTPError as exc:
            exc.close()
            return exc.code, b""

    def test_an_evicted_scene_is_fetched_cached_and_the_tree_untouched(self) -> None:
        self.evict("bf1942", "bocage")
        base = self.local(remote=True)
        self.assertEqual((200, self.scene), self.get(f"{base}/maps/bocage/scene.glb"))
        self.assertEqual(self.scene, (self.cache / "maps" / "bocage" / "scene.glb").read_bytes())
        self.assertFalse((self.maps / "bocage" / "scene.glb").exists())
        self.assertEqual((200, b"blob"), self.get(f"{base}/glbs/{self.blob_sha}.glb"))
        # Local files win, and a file the volume lacks is a 404.
        self.assertEqual(200, self.get(f"{base}/maps/wake/scene.glb")[0])
        self.assertEqual(404, self.get(f"{base}/maps/nowhere/scene.glb")[0])
        # Only the asset trees are fetched.
        self.assertEqual(404, self.get(f"{base}/not-an-asset.js")[0])

    def test_a_store_blob_that_does_not_hash_to_its_name_is_not_served(self) -> None:
        base = self.local(remote=True)
        self.assertEqual(404, self.get(f"{base}/glbs/{'b' * 64}.glb")[0])
        self.assertFalse((self.cache / "glbs" / ("b" * 64 + ".glb")).exists())

    def test_the_pipelines_server_fetches_store_blobs_only(self) -> None:
        # 2026-10-21: evict_glbs.py emptied the local store and the pipeline's
        # own --no-remote server 404'd every model the thumbs page drew.
        self.evict("bf1942", "bocage")
        base = self.local(remote=True, trees=("glbs",))
        self.assertEqual((200, b"blob"), self.get(f"{base}/glbs/{self.blob_sha}.glb"))
        self.assertEqual(404, self.get(f"{base}/maps/bocage/scene.glb")[0])

    def test_a_cached_scene_that_disagrees_with_the_marker_is_fetched_again(self) -> None:
        self.evict("bf1942", "bocage")
        write(self.cache / "maps" / "bocage" / "scene.glb", b"stale")
        base = self.local(remote=True)
        self.assertEqual((200, self.scene), self.get(f"{base}/maps/bocage/scene.glb"))

    def test_no_remote_serves_local_files_only(self) -> None:
        self.evict("bf1942", "bocage")
        base = self.local(remote=False)
        self.assertEqual(404, self.get(f"{base}/maps/bocage/scene.glb")[0])
        self.assertFalse(self.cache.exists())

    def test_the_opt_out_switches(self) -> None:
        import os
        self.assertTrue(serve_viewer.remote_enabled(False) or
                        os.environ.get("BF_VIEWER_REMOTE"))
        self.assertFalse(serve_viewer.remote_enabled(True))


if __name__ == "__main__":
    unittest.main()
