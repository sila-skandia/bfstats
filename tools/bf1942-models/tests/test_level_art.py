"""A level's loading picture is on disk and every consumer falls back to one.

The defect (2026-10-11, a Secret Weapons + Road to Rome replay): Raid on
Agheila's `maps.json` row declared `raid_on_agheila/load.webp`, the file was
not in the tree (a re-bake replaces a level's directory), and every consumer
that trusted the row drew a black square: the replay feed's card cover and the
loading screen's `<img>`. The twenty-three vanilla levels the two expansions
inherit had no `loading` row at all and showed the Western beach whatever they
were. Pinned here:

  * every `maps.json` row of every tree on disk declares a `loading` block,
    its picture, its music and the load chrome (plate, bar, briefing plate)
    are files in that tree;
  * the chain `level-art.js` hands a consumer starts with a file that is on
    disk for every level (a row with no picture resolves to vanilla's, the
    engine's rule for an inherited level);
  * the chain's order, and the overlay's walk down it on a 404, which is the
    part the page runs (`level_art_harness.mjs`).

The tree check skips when the asset trees are not checked out (they are
untracked, and CI has none).
"""

from __future__ import annotations

import json
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
VIEWER = ROOT / "viewer"
MAPS = VIEWER / "maps"
HARNESS = Path(__file__).with_name("level_art_harness.mjs")
# progress.js pulls audio.js, which pulls loading-audio-ui.js.
MODULES = ["level-art.js", "progress.js", "audio.js", "loading-audio-ui.js"]


def _node(argv: list[str] | None = None) -> str:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    for name in MODULES:
        if not (VIEWER / name).exists():
            raise unittest.SkipTest(f"{name} is not in the tree")
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        for name in MODULES:
            shutil.copyfile(VIEWER / name, work / name)
        (work / "package.json").write_text('{"type":"module"}\n')
        shutil.copyfile(HARNESS, work / "harness.mjs")
        proc = subprocess.run(
            ["node", str(work / "harness.mjs"), *(argv or [])],
            capture_output=True, text=True, timeout=120)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return proc.stdout


def trees() -> list[tuple[str, Path, list[dict]]]:
    """`(mod id, tree dir, maps.json rows)` for every tree on disk, vanilla first."""
    found: list[tuple[str, Path, list[dict]]] = []
    candidates = [("bf1942", MAPS)] + [
        (p.name, p) for p in sorted((MAPS / "mods").glob("*")) if p.is_dir()]
    for mod, tree in candidates:
        index = tree / "maps.json"
        if index.is_file():
            found.append((mod, tree, json.loads(index.read_text(encoding="utf-8"))))
    return found


class LevelArtChainTests(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = json.loads(_node())

    def test_a_path_joins_its_tree(self) -> None:
        r = self.results
        self.assertEqual(r["joinPlain"], "maps/mods/xpack2/raid_on_agheila/load.webp")
        self.assertEqual(r["joinTrailingSlash"], "maps/mods/xpack2/_shared/load/western.webp")
        self.assertEqual(r["joinAbsolute"], "https://x.test/a.webp")
        self.assertEqual(r["joinEmpty"], "")

    def test_a_row_is_found_without_regard_to_case(self) -> None:
        r = self.results
        self.assertEqual(r["rowCase"], "Raid_on_Agheila")
        self.assertIsNone(r["rowMissing"])
        self.assertIsNone(r["rowNullRows"])

    def test_the_chain_is_own_picture_then_vanillas_then_the_defaults(self) -> None:
        r = self.results
        tree = "maps/mods/xpack2/"
        default = r["defaultArt"]
        self.assertEqual(r["ownFirst"], [
            f"{tree}raid_on_agheila/load.webp", f"{tree}{default}", f"maps/{default}"])
        # An inherited level whose row names nothing (the expansions' 23) and
        # one whose tree could not be read both reach vanilla's own picture
        # before any theatre default.
        self.assertEqual(r["inherited"], [
            "maps/_shared/load/western2.webp", f"{tree}{default}", f"maps/{default}"])
        self.assertEqual(r["unreadableTree"][0], "maps/_shared/load/western2.webp")
        self.assertEqual(r["vanillaOnly"], ["maps/_shared/load/western2.webp", f"maps/{default}"])
        self.assertEqual(r["unknownLevel"], [f"{tree}{default}", f"maps/{default}"])

    def test_the_first_picture_that_loads_wins(self) -> None:
        r = self.results
        self.assertEqual(r["firstOfTwo"], "b")
        self.assertIsNone(r["firstNone"])
        self.assertIsNone(r["firstEmpty"])

    def test_a_probe_settles_once_a_url(self) -> None:
        r = self.results
        self.assertTrue(r["imageOk"])
        self.assertFalse(r["imageMissing"])
        self.assertTrue(r["imageSettledOnce"])
        self.assertFalse(r["imageNoUrl"])

    def test_the_overlay_walks_down_the_chain_on_each_404(self) -> None:
        r = self.results
        self.assertEqual(r["overlayChain"], [
            "maps/mods/xpack2/raid_on_agheila/load.webp",
            "maps/_shared/load/western2.webp",
            "maps/mods/xpack2/_shared/load/western.webp",
            "maps/_shared/load/western.webp",
            None,
        ])
        self.assertEqual(r["overlayGaveUp"], "none")

    def test_a_new_load_starts_a_clean_chain(self) -> None:
        r = self.results
        self.assertEqual(r["overlayFresh"], "maps/_shared/load/pacific2.webp")
        self.assertTrue(r["overlayArtCleared"])

    def test_a_failing_fallback_lookup_still_reaches_the_defaults(self) -> None:
        self.assertEqual(
            self.results["overlayThrowingFallback"], "maps/mods/xpack1/_shared/load/western.webp")


@unittest.skipUnless((MAPS / "maps.json").is_file(), "the maps tree is not checked out")
class LoadingPictureOnDiskTests(unittest.TestCase):
    """Declared is on disk, for every level of every tree that is here."""

    def test_every_row_declares_a_loading_block(self) -> None:
        for mod, _, rows in trees():
            with self.subTest(mod=mod):
                bare = [r["name"] for r in rows if not (r.get("loading") or {}).get("background")]
                self.assertEqual(bare, [], f"{mod}: rows with no loading picture")

    def test_every_declared_picture_is_a_file(self) -> None:
        for mod, tree, rows in trees():
            with self.subTest(mod=mod):
                missing = []
                for row in rows:
                    rel = (row.get("loading") or {}).get("background")
                    if not rel:
                        continue
                    path = tree / rel
                    if not path.is_file() or path.stat().st_size == 0:
                        missing.append(f"{row['name']}: {rel}")
                self.assertEqual(missing, [], f"{mod}: declared and not on disk")

    def test_every_tree_carries_the_load_chrome_and_music(self) -> None:
        for mod, tree, rows in trees():
            with self.subTest(mod=mod):
                for name in ("menu_loading.png", "loading_bar.png", "mp_briefing.png"):
                    self.assertTrue((tree / "_shared" / "load" / name).is_file(), name)
                for rel in {(r.get("loading") or {}).get("music") for r in rows} - {None}:
                    self.assertTrue((tree / rel).is_file(), rel)

    def test_the_chain_leads_with_a_file_that_exists_for_every_level(self) -> None:
        by_mod = {mod: (tree, rows) for mod, tree, rows in trees()}
        vanilla_rows = by_mod["bf1942"][1]
        cases = []
        for mod, (tree, rows) in by_mod.items():
            base = "maps" if mod == "bf1942" else f"maps/mods/{mod}"
            slim = [{"name": r["name"], "loading": r.get("loading")} for r in rows]
            chain = [{"base": base, "rows": slim}]
            if mod != "bf1942":
                chain.append({"base": "maps", "rows": [
                    {"name": r["name"], "loading": r.get("loading")} for r in vanilla_rows]})
            for row in rows:
                cases.append({"mod": mod, "level": row["name"], "trees": chain})
        with tempfile.TemporaryDirectory() as tmp:
            cases_file = Path(tmp) / "cases.json"
            cases_file.write_text(json.dumps(cases))
            answers = json.loads(_node([str(cases_file)]))
        self.assertEqual(len(answers), len(cases))
        dead = []
        for answer in answers:
            first = answer["candidates"][0] if answer["candidates"] else None
            if not first or not (VIEWER / first).is_file():
                dead.append(f"{answer['mod']}/{answer['level']}: {first}")
        self.assertEqual(dead, [], "a level whose first candidate is not on disk")

    def test_an_expansion_shows_the_picture_vanilla_shows_for_an_inherited_level(self) -> None:
        by_mod = {mod: rows for mod, _, rows in trees()}
        vanilla = {r["name"].lower(): r for r in by_mod["bf1942"]}
        for mod in ("xpack1", "xpack2"):
            if mod not in by_mod:
                continue
            with self.subTest(mod=mod):
                wrong = []
                for row in by_mod[mod]:
                    inherited = vanilla.get(row["name"].lower())
                    if not inherited:
                        continue
                    got = Path(row["loading"]["background"]).name
                    want = Path(inherited["loading"]["background"]).name
                    if got != want:
                        wrong.append(f"{row['name']}: {got} != {want}")
                self.assertEqual(wrong, [])


if __name__ == "__main__":
    unittest.main()
