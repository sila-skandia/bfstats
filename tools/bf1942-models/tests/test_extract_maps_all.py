from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from extract_maps_all import kept_files, land, merge_index, promote  # noqa: E402


class MergeIndexTests(unittest.TestCase):
    def test_a_new_level_is_added(self) -> None:
        listing: dict[str, dict] = {}
        merge_index(listing, [{"name": "A_Shau", "objects": 165}])
        self.assertEqual(listing["a_shau"]["objects"], 165)

    def test_existing_rows_survive_a_partial_run(self) -> None:
        # The reason the index is merged rather than rewritten: 236 finished
        # levels must not vanish because the 237th was the only one re-run.
        listing = {"aberdeen": {"name": "Aberdeen", "objects": 2033}}
        merge_index(listing, [{"name": "A_Shau", "objects": 165}])
        self.assertEqual(sorted(listing), ["a_shau", "aberdeen"])

    def test_a_re_extracted_level_replaces_its_own_row(self) -> None:
        listing = {"a_shau": {"name": "A_Shau", "objects": 1}}
        merge_index(listing, [{"name": "A_Shau", "objects": 165}])
        self.assertEqual(len(listing), 1)
        self.assertEqual(listing["a_shau"]["objects"], 165)

    def test_the_key_is_case_insensitive(self) -> None:
        # `extract_map.py` writes the level name as the archive spells it; the
        # directory and the viewer's fetch both use the lowercase form, so a
        # differently-cased row must not become a second entry.
        listing = {"hue_imperial_palace": {"name": "hue_imperial_palace"}}
        merge_index(listing, [{"name": "Hue_Imperial_Palace", "objects": 7}])
        self.assertEqual(len(listing), 1)
        self.assertEqual(listing["hue_imperial_palace"]["objects"], 7)

    def test_a_row_without_a_name_is_ignored(self) -> None:
        listing: dict[str, dict] = {}
        merge_index(listing, [{"objects": 3}, {"name": "", "objects": 4}])
        self.assertEqual(listing, {})


class PromoteTests(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.root = Path(self._tmp.name)
        self.staging = self.root / "staging" / "a_shau"
        self.out = self.root / "maps"
        (self.staging / "a_shau").mkdir(parents=True)
        (self.staging / "a_shau" / "scene.glb").write_bytes(b"new")
        (self.staging / "maps.json").write_text("[]")
        self.out.mkdir()

    def tearDown(self) -> None:
        self._tmp.cleanup()

    def test_the_level_directory_moves_and_maps_json_stays(self) -> None:
        self.assertEqual(promote(self.staging, self.out), 1)
        self.assertEqual((self.out / "a_shau" / "scene.glb").read_bytes(), b"new")
        self.assertFalse((self.out / "maps.json").exists())
        self.assertTrue((self.staging / "maps.json").is_file())

    def test_a_re_extract_leaves_no_stale_files_behind(self) -> None:
        # A level whose object count dropped ships fewer lightmaps. Merging
        # directories would keep the orphans, so the target is removed first.
        previous = self.out / "a_shau"
        previous.mkdir()
        (previous / "scene.glb").write_bytes(b"old")
        (previous / "lightmap_41.png").write_bytes(b"orphan")

        promote(self.staging, self.out)

        self.assertEqual((self.out / "a_shau" / "scene.glb").read_bytes(), b"new")
        self.assertFalse((self.out / "a_shau" / "lightmap_41.png").exists())


class LoadingAssetsSurviveARebakeTests(unittest.TestCase):
    """`merge_index` keeps a row's `loading` key; the file it names must stay.

    `extract_loading_assets.py` writes `<level>/load.webp` and points the row's
    `loading.background` at it. The bake owns neither, and a re-bake that
    replaced the directory wholesale left the row pointing at a 404 (the
    replay feed card and map.html's loading screen).
    """

    LOADING = {"title": "A SHAU", "background": "a_shau/load.webp",
               "music": "_shared/music/vehicle4.mp3", "theme": "eod"}

    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.root = Path(self._tmp.name)
        self.out = self.root / "maps"
        previous = self.out / "a_shau"
        previous.mkdir(parents=True)
        (previous / "scene.glb").write_bytes(b"old")
        (previous / "lightmap_41.png").write_bytes(b"orphan")
        (previous / "load.webp").write_bytes(b"picture")
        self.listing = {"a_shau": {"name": "A_Shau", "objects": 1,
                                   "loading": dict(self.LOADING)}}

    def tearDown(self) -> None:
        self._tmp.cleanup()

    def bake(self, row: dict) -> dict:
        staging = self.root / "staging" / "a_shau"
        (staging / "a_shau").mkdir(parents=True)
        (staging / "a_shau" / "scene.glb").write_bytes(b"new")
        (staging / "maps.json").write_text(json.dumps([row]))
        return {"level": "A_Shau", "ok": True, "rows": [row],
                "staging": str(staging)}

    def test_a_re_bake_keeps_the_loading_background_and_its_row(self) -> None:
        land(self.bake({"name": "A_Shau", "objects": 165}), self.out, self.listing)

        level = self.out / "a_shau"
        self.assertEqual((level / "scene.glb").read_bytes(), b"new")
        self.assertFalse((level / "lightmap_41.png").exists())
        self.assertEqual((level / "load.webp").read_bytes(), b"picture")
        row = self.listing["a_shau"]
        self.assertEqual(row["objects"], 165)
        self.assertEqual(row["loading"], self.LOADING)
        # The invariant, stated directly: every kept path resolves.
        self.assertTrue((self.out / row["loading"]["background"]).is_file())

    def test_a_bake_that_writes_the_key_itself_owns_its_files(self) -> None:
        # The new row carries `loading`, so nothing is carried over for it.
        row = {"name": "A_Shau", "loading": {"background": "_shared/load/western.webp"}}
        land(self.bake(row), self.out, self.listing)
        self.assertFalse((self.out / "a_shau" / "load.webp").exists())

    def test_a_shared_background_is_not_the_level_s_to_keep(self) -> None:
        prior = {"name": "Wake", "loading": {"background": "_shared/load/pacific2.webp"}}
        self.assertEqual(kept_files(prior, [{"name": "Wake"}]), {})

    def test_paths_that_climb_out_of_the_level_are_ignored(self) -> None:
        prior = {"name": "Wake", "loading": {"background": "wake/../aberdeen/load.webp",
                                             "extra": ["wake/menu/load.webp"]}}
        self.assertEqual(kept_files(prior, [{"name": "Wake"}]),
                         {"wake": ["menu/load.webp"]})

    def test_a_first_bake_has_nothing_to_keep(self) -> None:
        self.assertEqual(kept_files(None, [{"name": "Wake"}]), {})


class IndexRoundTripTests(unittest.TestCase):
    def test_the_published_index_is_sorted_by_lowercase_name(self) -> None:
        listing: dict[str, dict] = {}
        merge_index(listing, [{"name": "a_shau"}, {"name": "Aberdeen"},
                              {"name": "Ambush"}])
        rows = sorted(listing.values(), key=lambda e: e["name"].lower())
        # Underscore (0x5f) precedes the letters, so `A_Shau` leads `Aberdeen`
        # — the same order `extract_map.py` has always written, and the order
        # the viewer's level dropdown shows.
        self.assertEqual([row["name"] for row in rows],
                         ["a_shau", "Aberdeen", "Ambush"])
        # Round-trips as the JSON the viewer fetches.
        self.assertEqual(len(json.loads(json.dumps(rows))), 3)


if __name__ == "__main__":
    unittest.main()
