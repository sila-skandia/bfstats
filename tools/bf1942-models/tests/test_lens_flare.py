"""`viewer/lens-flare.js` -- the sun flare's placement, driven headless by
`lens_flare_harness.mjs`.

The parsing side is in `tests/test_level.py` (`LensFlareParsingTests`) and the
export side in `extract_map.py`'s `write_lens_flare`. This covers the draw.

The one thing worth reading twice: **vanilla ships none of the flare
textures**. Every `.rfa` in this installation (1,775 of them) was searched by
stem, and the five names all 21 vanilla declarations use -- `ring3`, `ring4`,
`ring5`, `sunflare7`, `sunflare9` -- exist only in
`Mods/bfheroes/Archives/Texture.rfa` and inside
`Mods/bf1918/Archives/bf1942/levels/montblainville.rfa`. The client draws
those sprites with its default texture (the first test below); a mod level
that ships its own art draws that.

The placement is inferred, not decompiled; the module's header says so, says
what supports it, and says where anyone re-deriving it should start.
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
HARNESS = Path(__file__).with_name("lens_flare_harness.mjs")
MODULES = {"lens-flare.js": VIEWER / "lens-flare.js"}


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


class LensFlareDrawTests(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()

    def test_a_vanilla_level_draws_its_missing_art_as_the_default_texture(self) -> None:
        # The client's TextureManager cannot open these five names either, and
        # binds texture/defaultTexture in their slots (getTexture 0x00643040,
        # stored by 0x0056fb10); the flare pass 0x005707d0 draws every slot
        # with no test of what it holds.
        self.assertEqual(["texture/defaultTexture"], self.results["textures"]["vanillaFiles"])
        self.assertTrue(self.results["textures"]["vanillaDrawable"])
        # Until it is painted (the page paints it at once) nothing draws.
        self.assertEqual([], self.results["vanillaDraws"])
        drawn = self.results["vanillaDefault"]
        self.assertEqual(3, len(drawn))
        self.assertEqual({"texture/defaultTexture"}, {s["file"] for s in drawn})
        # Sized by the default texture's own 128 px: ring3's 0.5 is 64 px.
        self.assertEqual([256, 384, 64], [s["size"] for s in drawn])
        self.assertTrue(all(s["additive"] for s in drawn))

    def test_the_default_texture_is_the_installs(self) -> None:
        # texture/defaultTexture.dds in the vanilla texture archive: 128 x 128,
        # every texel (76, 72, 74, 255).
        d = self.results["defaultTexture"]
        self.assertEqual("texture/defaultTexture", d["name"])
        self.assertEqual(128, d["size"])
        self.assertEqual([76, 72, 74, 255], d["rgba"])
        self.assertEqual("texture/defaultTexture", d["named"])
        self.assertIsNone(d["unnamed"])

    def test_a_mod_level_that_ships_the_art_draws_every_sprite(self) -> None:
        self.assertTrue(self.results["textures"]["modDrawable"])
        self.assertEqual(3, len(self.results["modDraws"]))

    def test_coronas_draw_first_and_sit_on_the_sun(self) -> None:
        # A corona is the glow around the light itself, so it is at the sun
        # whatever its `scale` says -- vanilla's are 1 and 5, and the second
        # read as a position would be off screen.
        [corona, *flares] = self.results["modDraws"]
        self.assertEqual("flare/sunflare7.png", corona["file"])
        self.assertEqual(900, corona["x"])
        self.assertEqual(200, corona["y"])
        self.assertEqual(3, len(self.results["modDraws"]))
        self.assertEqual(2, len(flares))

    def test_a_ghost_is_placed_along_the_sun_to_centre_axis_by_its_scale(self) -> None:
        # centre (500, 300), sun (900, 200).
        # scale  1   -> on the sun,       (900, 200)
        # scale -1.5 -> mirrored past it, (500 - 600, 300 + 150) = (-100, 450)
        by_file = {s["file"]: s for s in self.results["modDraws"]}
        self.assertEqual((900, 200),
                         (by_file["flare/ring3.png"]["x"], by_file["flare/ring3.png"]["y"]))
        self.assertEqual((-100, 450),
                         (by_file["flare/ring5.png"]["x"], by_file["flare/ring5.png"]["y"]))

    def test_size_multiplies_the_textures_own_pixels(self) -> None:
        # `LittleDot` really is little: `ring3.tga` is 16x16 and its flare is
        # size 0.5, so 8 px. Read as a fraction of the viewport instead, the
        # 128x128 `sunflare9` at size 5 would be five screens across.
        by_file = {s["file"]: s for s in self.results["modDraws"]}
        self.assertEqual(8, by_file["flare/ring3.png"]["size"])     # 16 * 0.5
        self.assertEqual(96, by_file["flare/ring5.png"]["size"])    # 32 * 3
        self.assertEqual(256, by_file["flare/sunflare7.png"]["size"])  # 128 * 2

    def test_nothing_draws_when_the_sun_is_behind_or_the_canvas_is_empty(self) -> None:
        for key in ("hidden", "zeroCanvas", "noData", "fullyOccluded", "undecoded"):
            with self.subTest(key):
                self.assertEqual([], self.results[key])

    def test_occlusion_scales_every_sprites_alpha(self) -> None:
        full = [s["color"][3] for s in self.results["modDraws"]]
        half = self.results["halfOccluded"]
        self.assertEqual(len(full), len(half))
        for expected, got in zip(full, half):
            self.assertAlmostEqual(expected / 2, got, places=4)

    def test_dist_fade_scale_dims_only_the_flares_that_declare_it(self) -> None:
        # The corona has no `distFadeScale`, so it is untouched; `ring5`
        # declares 1 and is halved at a half-screen offset; `ring3` declares
        # none and is untouched.
        full = [s["color"][3] for s in self.results["modDraws"]]
        faded = self.results["distFaded"]
        self.assertAlmostEqual(full[0], faded[0], places=4)
        self.assertAlmostEqual(full[1] / 2, faded[1], places=4)
        self.assertAlmostEqual(full[2], faded[2], places=4)

    def test_a_zero_size_sprite_is_skipped(self) -> None:
        # Vanilla's flare index 4 is `setFlareSize 0 4` -- declared and then
        # turned off rather than deleted.
        self.assertEqual(["flare/sunflare7.png", "flare/ring5.png"],
                         self.results["zeroSize"])

    def test_every_vanilla_flare_blends_additively(self) -> None:
        # `setFlareSrcBlend BMSourceAlpha` + `setFlareDestBlend BMOne` on all
        # 91 vanilla flare declarations and all 36 corona ones.
        a = self.results["additive"]
        self.assertTrue(a["bmone"])
        self.assertTrue(a["lowercase"])
        self.assertFalse(a["other"])
        self.assertFalse(a["missing"])

    def test_the_last_declared_slot_never_draws(self) -> None:
        """LOAD-30: the flare pass's loop runs to (flareCount + coronaCount) - 1.

        The vertex vector is resized once in the LensFlare ctor to that many
        quads of four 40-byte vertices (client 0x00570f44 -> 0x00570df0 ->
        0x00570d40) and nothing appends, so the draw pass's
        `(end - begin) / 0xA0` is the slot count and its loop
        (0x005708a7) stops one short; the ctor stores the same count - 1 at
        +0x114. The array is flares then coronas: `setFlareSize(v, i)` is
        bounds-checked against flareCount and writes `array[i]`,
        `setCoronaSize(v, i)` against coronaCount and writes
        `array[flareCount + i]` (lnxded 0x08212720, 0x08212990).
        """
        slots = self.results["lastSlot"]
        # Wake declares and ships 5 flares and 2 coronas: the second corona is
        # the slot the loop never reaches.
        self.assertEqual({"flares": 5, "coronas": 1}, slots["wake"])
        # Guadalcanal declares two coronas and ships none. The lost slot is one
        # the tree never exported, so nothing the page holds is dropped.
        self.assertEqual({"flares": 1, "coronas": 0}, slots["guadalcanal"])
        # With no corona declared the last flare is the slot that goes.
        self.assertEqual({"flares": 1, "coronas": 0}, slots["flaresOnly"])
        # A scene with no counts falls back to what it ships.
        self.assertEqual({"flares": 2, "coronas": 1}, slots["noCounts"])
        self.assertEqual({"flares": 0, "coronas": 0}, slots["empty"])
        # ring5, ring3 and sunflare7 are the three distinct files Wake's
        # drawn slots name; the dropped corona adds none of its own.
        self.assertEqual(3, slots["wakeFiles"])


if __name__ == "__main__":
    unittest.main()
