"""OPTIONS > VIDEO's settings: `viewer/video-settings.js` and the page systems
that take them, under node through `video_settings_harness.mjs`.

features/video-options. The sentence these tests defend:

    every VIDEO OPTIONS row this site draws hands the viewer the number the
    game's own video apply hands the engine for it, and with nothing chosen
    the viewer draws what it drew before the rows existed.

The numbers are the ledger's VID rows (BF1942.exe 1.61): GRAPHICS QUALITY's
LOD percent and billboard scale, EFFECTS QUALITY's emitter intensity scale,
TEXTURE QUALITY's mip skip and bias, VIEW DISTANCE's percentage and the fog
it resets, and the three presets, which are the game's own Video*.con files.
"""

from __future__ import annotations

import json
import re
import shutil
import subprocess
import unittest
from pathlib import Path

HARNESS = Path(__file__).resolve().parent / "video_settings_harness.mjs"
SETTINGS = Path.home() / ".wine/drive_c/EA Games/Battlefield 1942/Mods/bf1942/Settings/Default"

# `game.set*` word -> the settings field it writes (0x006aefd0..0x006af0c0).
WORDS = {
    "setgraphicsquality": "graphicsQuality",
    "seteffectsquality": "effectsQuality",
    "setenvironmentmapping": "environmentMapping",
    "setlightmaps": "lightmaps",
    "setdetailtexture": "textureQuality",
    "setmenuviewdistance": "viewDistance",
}
BOOLS = {"environmentMapping", "lightmaps"}


def run_harness() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    proc = subprocess.run(["node", str(HARNESS)], capture_output=True, text=True, timeout=60)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


def read_preset(path: Path) -> dict:
    out = {}
    for line in path.read_text(errors="replace").splitlines():
        m = re.match(r"\s*game\.(\w+)\s+(\S+)", line)
        if m and m.group(1).lower() in WORDS:
            field = WORDS[m.group(1).lower()]
            value = int(m.group(2))
            out[field] = bool(value) if field in BOOLS else value
    return out


class VideoSettingsTests(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()

    def test_the_presets_are_the_games_files(self) -> None:
        if not SETTINGS.is_dir():
            self.skipTest("BF1942 is not installed")
        for level, name in (("1", "VideoLow.con"), ("2", "VideoMedium.con"), ("3", "VideoHigh.con")):
            with self.subTest(name):
                self.assertEqual(read_preset(SETTINGS / name), self.results["presets"][level])

    def test_nothing_chosen_is_high_and_the_old_look(self) -> None:
        r = self.results
        self.assertEqual(3, r["defaultPerformance"])
        d = r["defaults"]
        self.assertEqual(1, r["graphics"][str(d["graphicsQuality"])]["lodPercent"])
        self.assertEqual(1, r["effects"][str(d["effectsQuality"])])
        self.assertEqual({"mipSkip": 0, "lodBias": 0}, r["texture"][str(d["textureQuality"])])
        self.assertEqual(100, d["viewDistance"])
        self.assertEqual(100, d["renderScale"])
        self.assertTrue(d["environmentMapping"] and d["lightmaps"])

    def test_the_engine_numbers(self) -> None:
        r = self.results
        # 0x006b0e0d..0x006b0e82: renderer vt+0x188, TreeRenderer vt+0x68,
        # LodObject's distance factor.
        self.assertEqual({"1": [0.6, 1, 0.3], "2": [0.8, 1.5, 0.5], "3": [1, 2, 1]},
                         {k: [v["lodPercent"], v["billboardDistanceScale"], v["lodObjectFactor"]]
                          for k, v in r["graphics"].items()})
        # 0x006b0ea3..0x006b0edf: game +0x4cc.
        self.assertEqual({"1": 0.3, "2": 0.5, "3": 1}, r["effects"])
        # The jump table at 0x006aefb8.
        self.assertEqual([3, 2, 1, 0, 0], [r["texture"][str(q)]["mipSkip"] for q in range(1, 6)])
        self.assertEqual([0, 0, 0, 0, -1.5], [r["texture"][str(q)]["lodBias"] for q in range(1, 6)])

    def test_a_change_is_kept_and_told(self) -> None:
        c = self.results["change"]
        self.assertEqual(1, c["stored"]["graphicsQuality"])
        self.assertEqual(80, c["stored"]["viewDistance"])
        self.assertEqual({"graphicsQuality": 1, "viewDistance": 80}, c["told"])
        # A mix no preset matches is CUSTOM, and is CUSTOM's to bring back.
        self.assertEqual(0, c["performance"])
        self.assertEqual(1, c["custom"]["graphicsQuality"])
        self.assertEqual({"performance": 2, "graphicsQuality": 2, "viewDistance": 100, "custom": 1},
                         self.results["medium"])
        self.assertEqual({"performance": 0, "graphicsQuality": 1, "viewDistance": 80},
                         self.results["customBack"])
        self.assertIsNone(self.results["cleared"])

    def test_storage_that_refuses_or_holds_junk_gives_the_defaults(self) -> None:
        r = self.results
        defaults = dict(r["defaults"], custom=None)
        self.assertEqual(defaults, r["throwing"]["read"])
        self.assertEqual("ok", r["throwing"]["write"])
        self.assertEqual(1, r["throwing"]["change"])
        self.assertEqual(defaults, r["junk"])
        # Out of range is brought into it; the edit box takes 50..100.
        c = r["clamped"]
        self.assertEqual((3, 50, 1, 100, True), (c["graphicsQuality"], c["viewDistance"],
                                                c["textureQuality"], c["renderScale"], c["environmentMapping"]))

    def test_view_distance_and_its_fog(self) -> None:
        v = self.results["viewDistance"]
        self.assertEqual((375, 250), (v["wake75"], v["wake50"]))
        # FOG-4: a quarter and all of it, each 50 m less past a 200 m view.
        self.assertEqual({"start": 43.75, "end": 325}, v["fogAt375"])
        self.assertEqual({"start": 37.5, "end": 150}, v["fogAt150"])
        # At 100 % the law gives what the exporter writes for Wake (75..450).
        self.assertEqual({"start": 75, "end": 450}, v["fogAt500"])

    def test_graphics_quality_moves_the_lod_swaps(self) -> None:
        lod = self.results["lod"]
        # LOD 1 holds at 60 m at both; at 110 m HIGH still draws LOD 1 and LOW
        # has swapped to LOD 2 (0.6 x 120^2 < 110^2 - 3^2).
        self.assertEqual([1, 1], lod["high"])
        self.assertEqual([1, 2], lod["low"])
        self.assertEqual([0.8, 1], lod["live"])

    def test_effects_quality_thins_every_emitter(self) -> None:
        e = self.results["emitter"]
        self.assertEqual({"high": 20, "medium": 10, "low": 6, "restored": 1}, e)

    def test_texture_quality_and_render_scale(self) -> None:
        self.assertEqual([{"minLod": 3, "anisotropy": None}, {"minLod": 2, "anisotropy": None},
                          {"minLod": 1, "anisotropy": None}, {"minLod": 0, "anisotropy": None},
                          {"minLod": 0, "anisotropy": 16}], self.results["textureState"])
        self.assertEqual({"base1": 1, "half": 1, "big": 3, "cap": 4}, self.results["pixelRatio"])

    def test_the_reflection_stage_has_a_live_switch(self) -> None:
        self.assertEqual({"switch": 1, "gated": True}, self.results["envmap"])


if __name__ == "__main__":
    unittest.main()
