"""`viewer/kit-icon.js` -- which packed sprite a kit's own photograph
resolves to.

Driven headless by `kit_icon_harness.mjs`, the same way the other viewer
modules are tested here (`test_hud_pack_js.py` is the closest sibling).

The rule this exists for: `_shared/loadouts.json`'s `kitIcon.icon` is the raw
`ObjectTemplate.setKitIcon` path, and `extract_hud_pack.py`'s
`dir_glob_renames` only qualifies a photograph with its own directory when
two files under `Kits/` collide on the same basename (Eve of Destruction's
nation subdirectories; vanilla's flat root never does). The reader has to
try both the qualified and the bare name because it cannot know, without the
pack in hand, which one a given icon actually got.
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
HARNESS = Path(__file__).with_name("kit_icon_harness.mjs")
MODULES = {"kit-icon.js": VIEWER / "kit-icon.js"}


def run_harness() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    for source in MODULES.values():
        if not source.exists():
            raise unittest.SkipTest(f"{source.name} is not in the tree")
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        for name, source in MODULES.items():
            shutil.copyfile(source, work / name)
        (work / "package.json").write_text('{"type":"module"}\n')
        shutil.copyfile(HARNESS, work / "harness.mjs")
        proc = subprocess.run(
            ["node", str(work / "harness.mjs")],
            capture_output=True, text=True, timeout=120)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


class KitIconCandidatesTests(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()

    def test_a_nation_subdirectory_path_tries_the_qualified_name_first(self) -> None:
        self.assertEqual(
            ["arvn_at_selected", "at_selected"],
            self.results["candidates"]["eodNested"])

    def test_a_root_level_path_qualifies_with_kits_but_that_is_never_real(self) -> None:
        # Computed uniformly (no special case for the `Kits/` root), but a
        # candidate qualified with "kits" itself is never something the
        # extractor actually writes -- `resolveKitIcon` falls through to the
        # second candidate every time for one of these.
        self.assertEqual(
            ["kits_icon_antitank_allies_selected",
             "icon_antitank_allies_selected"],
            self.results["candidates"]["vanillaRoot"])

    def test_a_unique_root_icon_has_the_same_two_candidates(self) -> None:
        self.assertEqual(
            ["kits_icon_assault_breda_axis_selected",
             "icon_assault_breda_axis_selected"],
            self.results["candidates"]["xpack1Patch"])
        self.assertEqual(
            ["kits_kit_alliesassault_bren", "kit_alliesassault_bren"],
            self.results["candidates"]["xpack2Own"])

    def test_casing_never_changes_the_candidates(self) -> None:
        self.assertEqual(
            ["nva_assault_selected", "assault_selected"],
            self.results["candidates"]["upperCase"])

    def test_backslashes_are_normalised_like_the_other_readers(self) -> None:
        self.assertEqual(self.results["candidates"]["eodNested"],
                         self.results["candidates"]["backslashes"])

    def test_a_path_with_no_directory_has_only_the_bare_name(self) -> None:
        self.assertEqual(["at_selected"], self.results["candidates"]["bare"])

    def test_a_path_with_no_extension_is_not_truncated(self) -> None:
        self.assertEqual(
            ["arvn_at_selected", "at_selected"],
            self.results["candidates"]["noExt"])

    def test_degenerate_input_is_an_empty_list_not_a_crash(self) -> None:
        d = self.results["degenerate"]
        self.assertEqual([], d["empty"])
        self.assertEqual([], d["nullish"])
        self.assertEqual([], d["undef"])
        self.assertEqual([], d["number"])


class ResolveKitIconTests(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()

    def test_a_collision_resolves_to_its_qualified_sprite(self) -> None:
        self.assertEqual("nva_at_selected", self.results["resolve"]["eodQualified"])

    def test_vanilla_resolves_to_the_bare_sprite(self) -> None:
        self.assertEqual("icon_antitank_allies_selected",
                         self.results["resolve"]["vanillaBare"])

    def test_a_unique_mod_icon_resolves_to_the_bare_sprite(self) -> None:
        r = self.results["resolve"]
        self.assertEqual("icon_assault_breda_axis_selected", r["xpack1"])
        self.assertEqual("kit_alliesassault_bren", r["xpack2"])

    def test_an_icon_the_pack_does_not_have_resolves_to_null(self) -> None:
        self.assertIsNone(self.results["resolve"]["missing"])

    def test_no_icon_at_all_resolves_to_null(self) -> None:
        self.assertIsNone(self.results["resolve"]["noIcon"])
        self.assertIsNone(self.results["resolve"]["noIconUndefined"])


if __name__ == "__main__":
    unittest.main()
