"""`viewer/asset-prefetch.js`: the level asset manifest read at open, and the
bounded, deduped, low-priority fetch of everything it names.

`asset-prefetch.js` imports nothing, so this copies the one module plus its
harness into a temp dir and runs `node harness.mjs`, the same shape as
`test_armor.py`. What is asserted here is the module's contract, not a
measurement: the load numbers live in `features/asset-batch-downloads/README.md`.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MODULE = ROOT / "viewer" / "asset-prefetch.js"
HARNESS = Path(__file__).resolve().parent / "asset_prefetch_harness.mjs"


def run_harness() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        shutil.copyfile(MODULE, work / "asset-prefetch.mjs")
        shutil.copyfile(HARNESS, work / "harness.mjs")
        proc = subprocess.run(["node", str(work / "harness.mjs")],
                              capture_output=True, text=True, timeout=120)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


class AssetPrefetchTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.out = run_harness()

    def test_level_dir_from_glb_name_or_nothing(self) -> None:
        d = self.out["levelDir"]
        self.assertEqual(d["fromGlb"], "aberdeen")
        self.assertEqual(d["fromName"], "battle_of_britain")
        self.assertIsNone(d["nothing"])

    def test_manifest_is_read_and_every_file_queued(self) -> None:
        full = self.out["full"]
        self.assertEqual(full["opened"]["queued"], 35)
        self.assertEqual(full["fileCalls"], 35)
        self.assertTrue(full["manifestUrl"].endswith("maps/aberdeen/assets.json"))
        self.assertEqual(full["status"]["done"], 35)
        self.assertEqual(full["status"]["failed"], 0)
        self.assertEqual(full["status"]["bytes"], 3500)
        self.assertFalse(full["status"]["running"])

    def test_requests_are_low_priority_and_cache_first(self) -> None:
        self.assertEqual(self.out["full"]["init"], {"cache": "force-cache", "priority": "low"})

    def test_concurrency_is_bounded(self) -> None:
        # 35 files, ceiling 64: every file in flight at once is fine, and the
        # queue never exceeds the module's own limit.
        self.assertLessEqual(self.out["full"]["peak"], 64)
        self.assertGreater(self.out["full"]["peak"], 1)


    def test_root_absolute_entry_resolves_to_the_site_root(self) -> None:
        self.assertEqual(self.out["full"]["firstFile"], "http://localhost/textures/00/t0.webp")

    def test_relative_entry_resolves_against_the_level_dir(self) -> None:
        self.assertIn("http://localhost/maps/aberdeen/textures/aa/a.webp",
                      self.out["partial"]["urls"])

    def test_a_second_open_asks_for_nothing_already_fetched(self) -> None:
        dedupe = self.out["dedupe"]
        self.assertEqual(dedupe["second"]["queued"], 0)
        # The manifest is re-read (no-cache) and the files are not.
        self.assertEqual(dedupe["extraCalls"], 1)

    def test_no_manifest_is_not_an_error(self) -> None:
        no_manifest = self.out["noManifest"]
        self.assertEqual(no_manifest["opened"]["queued"], 0)
        self.assertIn("404", no_manifest["opened"]["reason"])
        self.assertEqual(no_manifest["calls"], 1)

    def test_one_broken_entry_costs_only_that_entry(self) -> None:
        partial = self.out["partial"]
        self.assertEqual(partial["status"]["failed"], 1)
        self.assertEqual(partial["status"]["done"], 1)
        self.assertFalse(partial["status"]["running"])

    def test_no_level_directory_fetches_nothing(self) -> None:
        self.assertEqual(self.out["noLevel"]["queued"], 0)
        self.assertEqual(self.out["noLevel"]["reason"], "no-level")


if __name__ == "__main__":
    unittest.main()
