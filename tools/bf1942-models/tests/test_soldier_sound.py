"""A soldier's movement sounds and the mixer's voice pool:
`viewer/soldier-sound.js` (the client's `SoldierSound`, BF1942.exe 0x00572b40
and 0x00572f20) and `viewer/voice-pool.js` (0x007fbdd0), run under node by
`soldier_sound_harness.mjs`."""

from __future__ import annotations

import json
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
VIEWER = ROOT / "viewer"
HARNESS = Path(__file__).with_name("soldier_sound_harness.mjs")


def run_harness() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        for name in ("soldier-sound.js", "voice-pool.js"):
            shutil.copyfile(VIEWER / name, work / name)
        (work / "package.json").write_text('{"type":"module"}\n')
        shutil.copyfile(HARNESS, work / "harness.mjs")
        proc = subprocess.run(["node", str(work / "harness.mjs")],
                              capture_output=True, text=True, timeout=60)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


class SoldierSoundTests(unittest.TestCase):
    r: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.r = run_harness()

    def test_a_trigger_is_the_scripts_place_in_soldiersound_inc(self) -> None:
        # `update` plays script `trigger - 1` (0x00572f64); the 26 loads.
        sst = self.r["SST"]
        self.assertEqual(
            {"Stand": 1, "Walk": 2, "Run": 3, "Jump": 4, "JumpLand": 5, "ToCrouch": 6,
             "FromCrouch": 7, "CrouchMove": 8, "ToCrawl": 9, "StandUp": 10, "CrawlMove": 11,
             "ToSwim": 12, "Swim": 13, "SwimStand": 14, "FromSwim": 15, "HitDamage": 0x13,
             "HealedByMedic": 0x16, "ClimbLadder": 0x17, "Voice": 0x18, "RefillAmmo": 0x1a},
            {k: sst[k] for k in ("Stand", "Walk", "Run", "Jump", "JumpLand", "ToCrouch",
                                 "FromCrouch", "CrouchMove", "ToCrawl", "StandUp", "CrawlMove",
                                 "ToSwim", "Swim", "SwimStand", "FromSwim", "HitDamage",
                                 "HealedByMedic", "ClimbLadder", "Voice", "RefillAmmo")})

    def test_the_cadences_are_soldiersound_incs_and_the_images_defaults(self) -> None:
        v = self.r["VANILLA_FREQUENCIES"]
        self.assertEqual((0.36, 0.017), (v["run"], v["randomRun"]))
        self.assertEqual((0.66, 0.04), (v["walk"], v["randomWalk"]))
        self.assertEqual((0.50, 0.04), (v["crouch"], v["randomCrouch"]))
        self.assertEqual((0.6, 0.3), (v["crawl"], v["randomCrawl"]))
        self.assertEqual((0.46, 0.01), (v["ladder"], v["randomLadder"]))
        self.assertEqual((1, 0.025), (v["swim"], v["randomSwim"]))
        self.assertEqual(1.5, v["stand"])
        # BF1942.exe 0x0095930c..0x0095933c, what a mod that sets none gets.
        e = self.r["ENGINE_FREQUENCIES"]
        self.assertEqual((1.5, 0.37, 0.025, 0.66, 0.04), (e["stand"], e["run"], e["randomRun"],
                                                          e["walk"], e["randomWalk"]))
        for gait in ("swim", "crouch", "crawl", "ladder"):
            self.assertEqual((0.66, 0.025), (e[gait], e["random" + gait.capitalize()]))
        self.assertEqual(1.0, self.r["LAND_GATE"])            # 0x008c53c8
        self.assertEqual(0.65, self.r["CONTACT_NORMAL_Y"])    # lnxded 0x086d2728

    def test_a_gait_steps_at_its_own_cadence_from_the_first_frame(self) -> None:
        # rand 0.5 at 60 frames a second: the interval, to the next frame.
        c = self.r["cadence"]
        for gait, interval in (("run", 0.36 + 0.017 / 2), ("walk", 0.66 + 0.02),
                               ("crouch", 0.50 + 0.02), ("crawl", 0.6 + 0.15),
                               ("swim", 1.0125), ("ladder", 0.465)):
            self.assertEqual(0, c[gait]["first"], gait)
            self.assertGreaterEqual(c[gait]["gap"], interval - 1e-9, gait)
            self.assertLess(c[gait]["gap"], interval + 2 / 60, gait)

    def test_which_patches_each_script_plays(self) -> None:
        # 0x00572f75..0x00572fd4: stop, walk, run and the landing play the
        # material's patch, 8 and 9; the ladder 0, 8 and 9; the rest all.
        c = self.r["cadence"]
        self.assertEqual([0, 8, 9], c["run"]["patches"])
        self.assertEqual([0, 8, 9], c["walk"]["patches"])
        self.assertEqual([0, 8, 9], c["ladder"]["patches"])
        self.assertIsNone(c["crouch"]["patches"])
        self.assertIsNone(c["crawl"]["patches"])
        self.assertIsNone(c["swim"]["patches"])
        self.assertEqual({"sand": 0, "metal": 1, "wood": 2, "concrete": 3, "grass": 4,
                          "gravel": 5, "ice": 6, "frozen": 6, "mud": 7, "water": 10},
                         self.r["MATERIAL_PATCH"])

    def test_the_stop_sounds_once_and_not_within_a_second_and_a_half(self) -> None:
        self.assertEqual([[2, [0, 8, 9]]], self.r["stand"])

    def test_a_stance_change_and_a_heal_sound_on_the_frame_they_start(self) -> None:
        self.assertEqual(
            ["c_SstToCrouch", "c_SstFromCrouch", "c_SstToSwim", "c_SstSwimStand",
             "c_SstHealedByMedic", "c_SstHealedByMedic"],
            [name for name, _ in self.r["oneShots"]])

    def test_a_jump_silences_the_run_until_the_floor_and_lands_on_its_material(self) -> None:
        self.assertEqual(
            [["c_SstJump", None], ["c_SstJumpLand", [2, 8, 9]],
             ["c_SstRun", [2, 8, 9]], ["c_SstRun", [2, 8, 9]]], self.r["jump"])
        # A landing inside a second of the last is silent (0x00572e04).
        self.assertEqual(["c_SstJump"], self.r["jumpAgain"])
        # Only a jump puts a soldier in the air (0x00572e45).
        self.assertEqual(["c_SstRun"], self.r["ledge"])

    def test_the_trigger_a_body_is_in(self) -> None:
        self.assertEqual(
            ["c_SstStand", "c_SstRun", "c_SstWalk", "c_SstToCrouch", "c_SstCrouchMove",
             "c_SstNone", "c_SstToCrawl", "c_SstCrawlMove", "c_SstStandUp", "c_SstStand",
             # The dive and `Lb_LieToStand` declare no trigger; getting up
             # sounds a third of a second on, as `Lb_CrouchToStand`.
             "c_SstNone", "c_SstNone", "c_SstFromCrouch", "c_SstStand",
             "c_SstToCrawl", "c_SstStand", "c_SstJump",
             "c_SstToSwim", "c_SstSwim", "c_SstSwimStand", "c_SstFromSwim",
             # A ladder: the climb states, not the idle ones.
             "c_SstNone", "c_SstClimbLadder", "c_SstNone",
             "c_SstNone"],
            self.r["body"])

    def test_a_recorded_state_names_its_trigger(self) -> None:
        s = self.r["states"]
        self.assertEqual("c_SstCrouchMove", s["crouchForward"])
        self.assertEqual("c_SstClimbLadder", s["ladder"])
        self.assertEqual(0, s["ladderIdle"])
        self.assertEqual(0, s["dive"])
        self.assertEqual(0, s["killed"])
        self.assertEqual("c_SstCrawlMove", s["fromManifest"])
        self.assertEqual(0x17, s["id"])

    def test_the_distance_ramp_is_clamped_at_zero(self) -> None:
        # `Ramp 2 6 1 -1`: full to 2 m, half at 3, silent from 4.
        self.assertEqual([1, 1, 0.5, 0, 0, 0], self.r["ramp"])
        self.assertEqual(1, self.r["noRamp"])

    def test_the_page_runs_the_machine_for_the_player_bots_and_remotes(self) -> None:
        audio = (VIEWER / "page-audio.js").read_text()
        self.assertIn("function soldierSoundTick(owner, view, dt, position = null, armor = null)", audio)
        self.assertIn("soldierSoundTick(bot, recordedView, dt, botSoundAt);", audio)
        self.assertIn("page.soldierSoundTick(soundSoldier, view, dt, null, armor);",
                      (VIEWER / "local-player.js").read_text())
        self.assertIn("ctx.soldierSound?.(s, state, dt);", (VIEWER / "netcode-render.js").read_text())
        self.assertIn("page.remoteSoldierSoundTick?.(s, state, dt)", (VIEWER / "net-room.js").read_text())


class VoicePoolTests(unittest.TestCase):
    r: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.r = run_harness()

    def test_the_pool_is_setchannels_less_the_2d_reserves(self) -> None:
        # SND-44: 4 mono 2D, 2 stereo 2D, the rest 3D; `SoundHigh.con` 32.
        self.assertEqual(32, self.r["sizes"]["default"])
        self.assertEqual({"mono": 4, "stereo": 2, "3d": 26}, self.r["sizes"]["32"])
        self.assertEqual({"mono": 4, "stereo": 2, "3d": 58}, self.r["sizes"]["64"])
        self.assertEqual({"mono": 4, "stereo": 2, "3d": 10}, self.r["sizes"]["16"])
        self.assertEqual(["3d", "mono", "stereo"], self.r["kinds"])

    def test_a_full_pool_offers_only_its_oldest_voice(self) -> None:
        # 0x007fbe80: the first busy voice of the kind, and no other.
        p = self.r["pool"]
        self.assertEqual([True, True], p["full"])
        self.assertTrue(p["lowerRefused"])

    def test_equal_priority_takes_only_a_farther_voice(self) -> None:
        # 0x007fbeea: `fcomp` candidate against asker, `test ah,0x41; jnp`.
        p = self.r["pool"]
        self.assertTrue(p["equalNearerCandidate"])
        self.assertTrue(p["equalSameDistance"])
        self.assertTrue(p["equalFartherCandidate"])
        self.assertEqual(["a"], p["stoppedAfterEqual"])
        self.assertEqual([True, True], p["liveDistance"])

    def test_higher_priority_takes_it_and_its_sound_stops(self) -> None:
        p = self.r["pool"]
        self.assertTrue(p["higherTakes"])
        self.assertEqual(["a", "b"], p["stopped"])
        self.assertTrue(p["afterRelease"])

    def test_a_2d_voice_is_taken_outright(self) -> None:
        # 0x007fbeb2: only a 3D candidate is compared.
        p = self.r["pool"]
        self.assertTrue(p["monoFifth"])
        self.assertTrue(p["stereoThird"])
        self.assertEqual(["m1", "s1"], p["stopped2d"])
        self.assertEqual({"3d": 2, "mono": 4, "stereo": 2}, p["stats"]["busy"])

    def test_every_voice_of_the_page_asks_the_pool(self) -> None:
        engine = (VIEWER / "engine-audio.js").read_text()
        self.assertIn("const pooled = pool.claim(this.#ask(voice, steal));", engine)
        self.assertIn("if (voice.layer.loop) out = this.#loopVoice(voice, out);", engine)
        self.assertIn("const voice = pool.claim({", (VIEWER / "page-audio.js").read_text())
        # A loop still starts at a random point of its buffer (SND-47, kept).
        self.assertIn("const offset = source.loop ? Math.random() * voice.buffer.duration : 0;", engine)


if __name__ == "__main__":
    unittest.main()
