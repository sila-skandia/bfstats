"""Community Maps: a view of vanilla's tree, not a tree of its own.

`build_mods_manifest.scan` adds a `community` row when vanilla's `maps.json`
holds a level retail does not ship (Strasbourg), with vanilla's paths,
`tree: "bf1942"` and those levels. `viewer/mods.js` `menuLevels` then lists
them under Community Maps only, and vanilla's menus leave them out.
See features/community-maps/README.md."""

from __future__ import annotations

import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(HERE))

import build_mods_manifest as bmm  # noqa: E402


def _viewer(tmp: Path, names: list[str]) -> Path:
    maps = tmp / "maps"
    maps.mkdir(parents=True)
    (maps / "maps.json").write_text(json.dumps([{"name": n} for n in names]))
    (tmp / "icons" / "mods").mkdir(parents=True)
    (tmp / "icons" / "mods" / "community.png").write_bytes(b"PNG")
    return tmp


class ManifestTests(unittest.TestCase):
    def test_retail_set_is_the_23(self) -> None:
        self.assertEqual(23, len(bmm.RETAIL_LEVELS))

    def test_a_community_level_gets_the_view(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            viewer = _viewer(Path(tmp), ["Wake", "El_Alamein", "strasbourg"])
            mods = {m["id"]: m for m in bmm.scan(viewer)}
        view = mods["community"]
        self.assertEqual("bf1942", view["tree"])
        self.assertEqual(["strasbourg"], view["levels"])
        self.assertEqual({"models": "models", "maps": "maps", "poses": "models/poses"},
                         view["paths"])
        self.assertEqual({"models": 0, "maps": 1, "poses": 0}, view["counts"])
        self.assertEqual("icons/mods/community.png", view["icon"])
        # Vanilla counts the levels its own list shows.
        self.assertEqual(2, mods["bf1942"]["counts"]["maps"])

    def test_no_community_level_no_view(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            viewer = _viewer(Path(tmp), ["Wake", "Coral_sea"])
            ids = [m["id"] for m in bmm.scan(viewer)]
        self.assertNotIn("community", ids)


HARNESS = """
const { menuLevels, treeOf, trees } = await import('./mods.js');
const vanilla = { id: 'bf1942' };
const community = { id: 'community', tree: 'bf1942', levels: ['strasbourg'] };
const eod = { id: 'eod' };
const mods = [vanilla, eod, community];
const rows = [{ map: 'Wake' }, { map: 'strasbourg' }, { map: 'El_Alamein' }];
const names = list => list.map(r => r.map);
console.log(JSON.stringify({
  vanilla: names(menuLevels(vanilla, mods, rows)),
  community: names(menuLevels(community, mods, rows)),
  eod: names(menuLevels(eod, mods, rows)),
  byName: menuLevels(community, mods, [{ name: 'Strasbourg' }, { name: 'Wake' }]).map(r => r.name),
  tree: [treeOf(community), treeOf(eod), treeOf(null)],
  trees: trees(mods).map(m => m.id),
}));
"""


class MenuLevelsTests(unittest.TestCase):
    def test_the_view_and_its_tree_split_the_list(self) -> None:
        if shutil.which("node") is None:
            self.skipTest("node is not installed")
        with tempfile.TemporaryDirectory() as tmp:
            work = Path(tmp)
            shutil.copyfile(HERE / "viewer" / "mods.js", work / "mods.js")
            (work / "package.json").write_text('{"type":"module"}\n')
            (work / "harness.mjs").write_text(HARNESS)
            proc = subprocess.run(["node", str(work / "harness.mjs")],
                                  capture_output=True, text=True, timeout=60)
        self.assertEqual(0, proc.returncode, proc.stderr[-500:])
        got = json.loads(proc.stdout)
        self.assertEqual(["Wake", "El_Alamein"], got["vanilla"])
        self.assertEqual(["strasbourg"], got["community"])
        self.assertEqual(["Wake", "strasbourg", "El_Alamein"], got["eod"])
        self.assertEqual(["Strasbourg"], got["byName"])
        self.assertEqual(["bf1942", "eod", "bf1942"], got["tree"])
        self.assertEqual(["bf1942", "eod"], got["trees"])


if __name__ == "__main__":
    unittest.main()
