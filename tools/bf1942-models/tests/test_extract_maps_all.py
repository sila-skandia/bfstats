from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from extract_maps_all import merge_index, promote  # noqa: E402


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
