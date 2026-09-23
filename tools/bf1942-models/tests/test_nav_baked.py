"""The level's own search maps as the bots load them (`viewer/nav-baked.js`,
`buildNavMap`'s baked path; `tests/nav_baked_harness.mjs`), and the runner's
Bocage match on them.

The level archives ship their search maps baked and the retail server loads
them (`ai.loadMaps`, ledger AI-102), so a level that has one is searched on
the engine's own bitmap and paints nothing. The real-level cases need the
untracked maps tree with the `pathfinding/` folders `extract_search_maps.py`
writes; they look in `$BF42_VIEWER_ASSETS`, this checkout's `viewer/`, then
the main checkout's, and skip without one.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
VIEWER = ROOT / "viewer"
HARNESS = Path(__file__).resolve().parent / "nav_baked_harness.mjs"


def find_assets() -> Path | None:
    candidates: list[Path] = []
    if os.environ.get("BF42_VIEWER_ASSETS"):
        candidates.append(Path(os.environ["BF42_VIEWER_ASSETS"]))
    candidates.append(VIEWER)
    try:
        common = subprocess.run(["git", "rev-parse", "--path-format=absolute", "--git-common-dir"], cwd=ROOT,
                                capture_output=True, text=True, timeout=10).stdout.strip()
        if common:
            candidates.append(Path(common).parent / "tools" / "bf1942-models" / "viewer")
    except (OSError, subprocess.SubprocessError):
        pass
    for c in candidates:
        if (c / "maps" / "bocage" / "pathfinding" / "index.json").exists():
            return c
    return None


ASSETS = find_assets()


def run_harness() -> dict:
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        for name in ("nav-grid.js", "nav-map.js", "nav-search.js", "nav-baked.js"):
            shutil.copyfile(VIEWER / name, work / name)
        shutil.copyfile(HARNESS, work / "harness.mjs")
        (work / "package.json").write_text('{"type":"module"}\n')
        args = ["node", str(work / "harness.mjs")]
        if ASSETS is not None:
            args.append(str(ASSETS / "maps"))
        proc = subprocess.run(args, capture_output=True, text=True, timeout=180)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


@unittest.skipIf(shutil.which("node") is None, "node is not installed")
class NavBakedTests(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()

    def test_the_file_decodes_special_cells_and_inline_blocks(self) -> None:
        d = self.results["decode"]
        self.assertEqual(d["size"], [128, 128, 0, 1])
        self.assertFalse(d["free"])
        self.assertTrue(d["full"])
        self.assertTrue(d["inlineHit"])
        self.assertFalse(d["inlineMiss"])
        self.assertTrue(d["inlineFar"])
        self.assertFalse(d["lastFree"])
        self.assertTrue(d["outside"])
        self.assertEqual(self.results["trailing"], "refused")

    def test_a_baked_map_is_the_nav_map(self) -> None:
        b = self.results["baked"]
        self.assertEqual((b["source"], b["searchMap"]), ("baked", "Tank0"))
        self.assertTrue(b["freeOverWater"], "the file's free pixel is free whatever the terrain says")
        self.assertTrue(b["blockedBlock"])
        self.assertTrue(b["pixel"])
        self.assertTrue(b["besidePixel"])
        self.assertTrue(b["whyWater"])
        self.assertTrue(b["whyObject"])

    def test_the_painted_path_stays(self) -> None:
        self.assertEqual(self.results["painted"], {"source": "painted", "water": True})
        self.assertEqual(self.results["noMatch"], "painted")

    def test_the_infantry_defaults_take_the_infantry_map(self) -> None:
        r = self.results["infantryDefaults"]
        self.assertEqual((r["source"], r["searchMap"]), ("baked", "Infantry1"))
        self.assertTrue(r["block0"])
        self.assertTrue(r["block1"])

    def test_a_level_two_map_is_four_metre_pixels(self) -> None:
        r = self.results["level2"]
        self.assertEqual((r["source"], r["level"]), ("baked", 2))
        self.assertEqual(r["cells"], [False, True, True, False])
        self.assertEqual(r["row"], [True, False])

    @unittest.skipIf(ASSETS is None, "no maps tree with pathfinding/ (set BF42_VIEWER_ASSETS)")
    def test_bocage_loads_one_component_a_map(self) -> None:
        # Brief C's numbers (ledger AI-93): after the bridges, the painted
        # Tank0 and Infantry1 maps are each one coarse component, as the
        # level's own maps are.
        bocage = self.results["bocage"]
        for name in ("Tank0", "Infantry1"):
            self.assertEqual(bocage[name]["source"], "baked")
            self.assertEqual(len(bocage[name]["components"]), 1, name)
        self.assertEqual(bocage["bridge"],
                         {"source": "baked", "deck": True, "upstream": True, "downstream": True})


@unittest.skipIf(shutil.which("node") is None, "node is not installed")
@unittest.skipIf(ASSETS is None or not (ASSETS / "maps" / "bocage" / "scene.glb").exists()
                 or not (ASSETS / "maps" / "_shared" / "vehicle-ai.json").exists(),
                 "no extracted viewer/maps tree (set BF42_VIEWER_ASSETS)")
class RunnerOnBakedMapTests(unittest.TestCase):
    def test_bocage_match_route_failures(self) -> None:
        """A seeded 600 s Bocage match, 8 a side, on the baked maps: under 100
        route failures (before the bridges were read, 30,000 a side)."""
        with tempfile.TemporaryDirectory() as tmp:
            proc = subprocess.run(
                ["node", str(ROOT / "sim" / "run.mjs"), "--map", "bocage",
                 "--maps", str(ASSETS / "maps"), "--models", str(ASSETS / "models"),
                 "--bots", "8", "--time", "600", "--seed", "1", "--no-trace", "--out", tmp],
                cwd=ROOT, capture_output=True, text=True, timeout=900)
            if proc.returncode != 0:
                raise AssertionError(f"runner failed:\n{proc.stderr[-2000:]}")
            summary = json.loads((Path(tmp) / "summary.json").read_text())
        self.assertLess(summary["metrics"]["routeFailures"]["total"], 100)
        self.assertGreater(summary["metrics"]["captures"]["total"], 0)


if __name__ == "__main__":
    unittest.main()
