"""`viewer/hud-pack.js` -- which interface pack a page draws with.

Driven headless by `hud_pack_harness.mjs`, the same way the other viewer
modules are tested here.

The rule the module exists for is one line: a pack-relative path that a mod's
`pack.json` lists comes from that mod's directory, and everything else comes
from vanilla's. The tests below are all about what that has to be true of --
that vanilla costs no request, that an absent or broken pack degrades to
vanilla rather than to nothing, and that a mod that overrides a manifest still
inherits the files beside it.
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
HARNESS = Path(__file__).with_name("hud_pack_harness.mjs")
MODULES = {"hud-pack.js": VIEWER / "hud-pack.js"}


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


class HudPackTests(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()

    # ---- vanilla is untouched --------------------------------------------

    def test_vanilla_has_no_mod_directory(self) -> None:
        bases = self.results["bases"]
        self.assertIsNone(bases["vanilla"])
        self.assertIsNone(bases["empty"])
        self.assertIsNone(bases["missing"])

    def test_every_vanilla_path_is_the_one_the_page_always_used(self) -> None:
        v = self.results["vanilla"]
        self.assertEqual("maps/_shared/hud/hud.json", v["hudJson"])
        self.assertEqual("maps/_shared/hud/conp_us.png", v["sprite"])
        self.assertEqual("maps/_shared/hud/fonts/trebuchet_ms14.png", v["font"])
        self.assertEqual("maps/_shared/hud/menu/menu-layout.json", v["menu"])
        self.assertEqual("fonts/bf1942", v["consoleFont"])
        self.assertFalse(v["owns"])

    def test_vanilla_fetches_nothing_to_resolve_its_pack(self) -> None:
        # The whole design has to cost nothing on the tree that is already
        # published; a `pack.json` request for vanilla would be pure waste.
        self.assertEqual(0, self.results["load"]["vanillaFetches"])
        self.assertEqual("maps/_shared/hud/conp_us.png",
                         self.results["load"]["vanillaSprite"])

    # ---- a mod pack holds only its own -----------------------------------

    def test_a_mod_directory_sits_inside_its_own_level_tree(self) -> None:
        self.assertEqual("maps/mods/eod/_shared/hud",
                         self.results["bases"]["eod"])

    def test_a_listed_file_comes_from_the_mod(self) -> None:
        x = self.results["xpack1"]
        self.assertEqual("maps/mods/xpack1/_shared/hud/hud.json", x["hudJson"])
        self.assertEqual("maps/mods/xpack1/_shared/hud/conp_fre.png",
                         x["ownSprite"])
        self.assertTrue(x["ownsOverridden"])

    def test_an_unlisted_file_comes_from_vanilla(self) -> None:
        x = self.results["xpack1"]
        self.assertEqual("maps/_shared/hud/conp_us.png", x["inheritedSprite"])
        self.assertEqual("maps/_shared/hud/spawn-layout.json",
                         x["inheritedLayout"])
        self.assertEqual("maps/_shared/hud/hud-layout.json",
                         x["inheritedHudLayout"])
        self.assertFalse(x["ownsInherited"])

    def test_overriding_a_manifest_does_not_drag_its_neighbours_along(self) -> None:
        # Road to Rome's `hud.json` is its own (it names 27 added sprites)
        # while every font beside it is still vanilla's. A whole-directory
        # switch would have broken exactly this.
        x = self.results["xpack1"]
        self.assertTrue(x["hudJson"].startswith("maps/mods/"))
        self.assertEqual("maps/_shared/hud/fonts/trebuchet_ms14.png",
                         x["inheritedFont"])

    def test_the_menu_subtree_resolves_file_by_file_too(self) -> None:
        x = self.results["xpack1"]
        self.assertEqual("maps/mods/xpack1/_shared/hud/menu/menu-levels.json",
                         x["ownMenuFile"])
        self.assertEqual(
            "maps/mods/xpack1/_shared/hud/menu/textures/background.png",
            x["ownMenuTexture"])
        self.assertEqual("maps/_shared/hud/menu/menu-layout.json",
                         x["inheritedMenuLayout"])

    def test_a_mod_with_no_font_rfa_keeps_vanillas_console_face(self) -> None:
        self.assertEqual("fonts/bf1942", self.results["xpack1"]["consoleFont"])

    def test_a_mod_that_ships_a_console_face_gets_its_own(self) -> None:
        c = self.results["withConsole"]
        self.assertEqual("maps/mods/fhsw/_shared/hud/console/bf1942",
                         c["consoleFont"])
        self.assertEqual("maps/mods/fhsw/_shared/hud/console/bf1942.png",
                         c["png"])

    # ---- degrading ---------------------------------------------------------

    def test_a_pack_that_404s_resolves_everything_to_vanilla(self) -> None:
        # A mod tree uploaded before any of this existed.
        self.assertEqual("maps/_shared/hud/conp_us.png",
                         self.results["load"]["missingPack"])

    def test_a_pack_that_is_not_json_resolves_everything_to_vanilla(self) -> None:
        self.assertEqual("maps/_shared/hud/conp_us.png",
                         self.results["load"]["brokenPack"])

    def test_a_manifest_with_no_usable_files_list_is_not_a_crash(self) -> None:
        d = self.results["degenerate"]
        self.assertEqual("maps/_shared/hud/hud.json", d["nullManifest"])
        self.assertEqual("maps/_shared/hud/hud.json", d["noFiles"])
        self.assertEqual("maps/_shared/hud/hud.json", d["filesNotAnArray"])
        self.assertEqual(0, d["emptyFiles"])

    def test_a_loaded_pack_still_inherits_what_it_does_not_list(self) -> None:
        load = self.results["load"]
        self.assertEqual("maps/mods/eod/_shared/hud/conp_us.png",
                         load["eodSprite"])
        self.assertEqual("maps/_shared/hud/conp_can.png", load["eodInherited"])

    # ---- details that bite -------------------------------------------------

    def test_a_leading_dot_slash_does_not_make_a_second_key(self) -> None:
        s = self.results["sloppy"]
        for key in ("listedWithDot", "lookupWithDot", "lookupWithSlash"):
            self.assertEqual("maps/mods/eod/_shared/hud/conp_us.png",
                             s[key], key)

    def test_a_page_one_directory_down_prefixes_every_path(self) -> None:
        r = self.results["root"]
        self.assertEqual(
            "../maps/mods/eod/_shared/hud/menu/menu-levels.json", r["own"])
        self.assertEqual("../maps/_shared/hud/menu/menu-layout.json",
                         r["inherited"])
        self.assertEqual("../fonts/bf1942", r["consoleFont"])
        self.assertEqual("../maps/mods/eod/_shared/hud",
                         self.results["bases"]["eodFromPlay"])

    def test_the_pack_manifest_is_fetched_once_per_mod_from_its_own_dir(self) -> None:
        urls = self.results["load"]["urls"]
        self.assertIn("maps/mods/eod/_shared/hud/pack.json", urls)
        self.assertIn("maps/mods/gone/_shared/hud/pack.json", urls)

    def test_the_cache_buster_reaches_the_manifest_but_not_the_paths(self) -> None:
        # `bust()` is appended by each caller at the point of fetch, the way
        # every other URL on the page is built; the resolver must not bake it
        # into the path or the sprite cache would miss on every load.
        urls = self.results["load"]["urls"]
        self.assertIn("maps/mods/eod/_shared/hud/pack.json?t=1", urls)
        self.assertEqual("maps/mods/eod/_shared/hud/conp_us.png",
                         self.results["load"]["bustedSprite"])


if __name__ == "__main__":
    unittest.main()
