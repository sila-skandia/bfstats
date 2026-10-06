"""Which vehicle guns fire from the seat's camera (`viewer/camera-dof.js`),
driven headless by `camera_dof_harness.mjs`.

The rule is `FireArms::Fire`'s (lnxded 0x0828a090): with the template's
`fireInCameraDof` byte set (+0x264, tested at 0x0828a1c1) the round is launched
from the firing player's camera (`BFPlayer::getCamera` 0x08054ce0), otherwise
from the FireArms' own transform. The retail archives set it on the coaxial and
stationary MGs and never on a tank's main gun, so a coax lands under the
crosshair and a cannon lands where its barrel points.

The exporter writes the word on every FireArms node (`bf42/assemble.py`
`_fire_arms`), and the viewer's name table answers only for a glb baked before
it did. The install-gated cases below export Desert Combat's T-72 and M2A3,
whose NSVT, coax and TOW set the word under names no vanilla gun has, and
check the table against the word for every vanilla, XPack1 and XPack2 gun.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from extract_models import (  # noqa: E402
    DEFAULT_GAME_DIR,
    add_level_objects,
    build_library,
    build_pools,
    discover_levels,
    mod_chain,
)

HARNESS = Path(__file__).with_name("camera_dof_harness.mjs")


def run_harness(*glbs: Path) -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    proc = subprocess.run(["node", str(HARNESS), *map(str, glbs)],
                          capture_output=True, text=True, timeout=120)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


def _chain(mod: str) -> list[Path] | None:
    game = Path(os.path.expanduser(str(DEFAULT_GAME_DIR)))
    if not (game / "Mods" / mod).is_dir():
        return None
    return mod_chain(game, mod)


def _library(chain: list[Path]):
    """The exporter's own library: the chain's objects and every level's."""
    meshes, textures, objects, _game = build_pools(chain, [])
    add_level_objects(objects, discover_levels(chain), chain)
    return meshes, textures, objects, build_library(objects)


class CameraDofTests(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()

    def test_coaxial_and_pintle_mgs_fire_from_the_camera(self) -> None:
        fires = self.results["fires"]
        self.assertTrue(fires["coaxBaked"])      # the level bake's `_1` suffix
        self.assertTrue(fires["coaxModel"])
        self.assertTrue(fires["shermanCoax"])
        self.assertTrue(fires["pintle"])
        self.assertTrue(fires["grantGun"])       # XPack1's one tank gun that does

    def test_main_guns_and_wing_guns_fire_from_their_barrels(self) -> None:
        fires = self.results["fires"]
        self.assertFalse(fires["t34Cannon"])
        self.assertFalse(fires["tigerCannon"])
        self.assertFalse(fires["shermanCannon"])
        self.assertFalse(fires["wingGuns"])
        self.assertFalse(fires["unnamed"])

    def test_an_exported_word_beats_the_table(self) -> None:
        fires = self.results["fires"]
        self.assertTrue(fires["declaredOn"])
        self.assertFalse(fires["declaredOff"])

    def test_the_camera_is_the_seat_that_owns_the_gun(self) -> None:
        camera = self.results["camera"]
        self.assertEqual("T34Camera", camera["coax"])
        self.assertEqual("T34Camera2", camera["hullMg"])
        self.assertIsNone(camera["orphan"])


@unittest.skipIf(_chain("DesertCombat") is None, "no Desert Combat install")
class ExportedWordTests(unittest.TestCase):
    """DC's T-72 and M2A3, exported now. Before the word was exported every
    one of these guns answered from the name table, which has none of them,
    so their rounds left the barrel."""

    guns: dict

    @classmethod
    def setUpClass(cls) -> None:
        from bf42.assemble import Assembler
        meshes, textures, objects, library = _library(_chain("DesertCombat"))
        assembler = Assembler(meshes, textures, objects, library, max_texture=16)
        with tempfile.TemporaryDirectory() as tmp:
            paths = []
            for name in ("T72", "M2A3"):
                glb, _report = assembler.export(name)
                paths.append(Path(tmp) / f"{name}.glb")
                paths[-1].write_bytes(glb)
            cls.guns = run_harness(*paths)["glbs"]

    def test_the_t72_mgs_fire_from_their_seat_cameras(self) -> None:
        t72 = self.guns["T72.glb"]
        self.assertEqual({"exported": True, "fires": True, "firesBeforeExport": False,
                          "camera": "T72Camera2"}, t72["NSVT"])
        self.assertEqual({"exported": True, "fires": True, "firesBeforeExport": False,
                          "camera": "T72Camera"}, t72["Iraqi_coaxialMG"])

    def test_the_m2a3_tow_fires_from_the_gunners_camera(self) -> None:
        self.assertEqual({"exported": True, "fires": True, "firesBeforeExport": False,
                          "camera": "M2A3_Camera"}, self.guns["M2A3.glb"]["M2A3_TOW"])

    def test_the_main_guns_are_written_false_and_keep_their_barrels(self) -> None:
        for glb, gun in (("T72.glb", "T72GunBarrel"), ("M2A3.glb", "M2A3_GunBarrel")):
            self.assertIs(False, self.guns[glb][gun]["exported"])
            self.assertFalse(self.guns[glb][gun]["fires"])


@unittest.skipIf(_chain("bf1942") is None, "no BF1942 install")
class FallbackTableTests(unittest.TestCase):
    """The name table is what an old glb gets, so for the three packs it was
    surveyed from it must say what the exported word says, gun for gun."""

    def test_the_table_agrees_with_the_word_on_every_vanilla_gun(self) -> None:
        table = set(run_harness()["table"])
        for mod in ("bf1942", "XPack1", "XPack2"):
            chain = _chain(mod)
            if chain is None:
                continue
            *_pools, library = _library(chain)
            guns = [t for t in library.objects.values()
                    if t.kind.lower() == "firearms" and t.projectile_template]
            with self.subTest(mod=mod):
                self.assertGreater(len(guns), 50)
                self.assertEqual(
                    sorted(t.name for t in guns if t.fire_in_camera_dof),
                    sorted(t.name for t in guns if t.name.lower() in table))


if __name__ == "__main__":
    unittest.main()
