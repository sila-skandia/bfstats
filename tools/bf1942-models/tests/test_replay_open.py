"""`viewer/replay-open.js` under node, through `replay_open_harness.mjs`.

Also what a recording begun after the join says (2026-09-27: one switched on
20 s into a Tobruk round named no level, no server and no player): the level
recognised by its flags (`replay-level.js`), names from its chat and from the
roster bf42plus ea600c1 writes, and a replayed hull in the level's own paint
(`replay-assets.js`).

A recording opened from disk (Open recording, or dropped anywhere on
map.html) is held in the browser only across the reload to
`map.html?mod=<mod>&map=<level>&replay=local:<name>`, so the recording's own
mod, level and game type load behind the loading screen; the page that plays
it lets it go. That rests on what
is read out of the file before any level loads, and on the URL it is played
from; both are pinned here. The picker, the drop, the browser's store and the
loading screen's line are checked in a page (features/round-replay-ux,
"Opening a recording").
"""

from __future__ import annotations

import json
import shutil
import subprocess
import unittest
from pathlib import Path

HARNESS = Path(__file__).resolve().parent / "replay_open_harness.mjs"


def run_harness() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    proc = subprocess.run(["node", str(HARNESS)], capture_output=True, text=True, timeout=120)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


class ReplayOpenTests(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()

    def test_the_date_is_the_recording_pcs_own_clock(self) -> None:
        # The header's `start` names no zone: the page shows its wall clock as
        # written, whatever zone the viewer is in.
        at = self.results["recordedAt"]
        self.assertEqual(at["minutes"], "27 Sep 2026, 14:09")
        self.assertEqual(at["seconds"], "27 Sep 2026, 14:09:21")
        self.assertEqual(at["midnight"], "3 Jan 2026, 00:05")
        for key in ("empty", "missing", "garbage", "badMonth"):
            self.assertEqual(at[key], "", key)

    def test_raw_event_files_name_their_level_mod_and_server(self) -> None:
        # v2 and v3 write the server's info (0x1A), its name (0x1B) and the
        # level (0x36) as raw events.
        for version in ("v2", "v3"):
            info = self.results[version]
            self.assertEqual(info["level"], "wake", version)
            self.assertEqual(info["mode"], "conquest", version)
            self.assertEqual(info["mod"], "bf1942", version)
            self.assertEqual(info["server"], "BF1942 server1", version)
        self.assertEqual(self.results["v2"]["start"], "2026-09-15T21:06:19")

    def test_named_event_files_name_theirs(self) -> None:
        info = self.results["v5"]
        self.assertEqual(info["level"], "anzio")
        self.assertEqual(info["mode"], "coop")
        self.assertEqual(info["mod"], "XPack1")
        self.assertEqual(info["server"], "MoonGamers.com | Est. 2004")
        self.assertEqual(info["version"], 5)

    def test_the_loading_screen_says_when_and_where(self) -> None:
        self.assertEqual(self.results["note"], "Replay  ·  27 Sep 2026, 14:09  ·  MoonGamers.com | Est. 2004")
        self.assertEqual(self.results["noteBare"], "Replay")

    def test_level_names_read_as_words(self) -> None:
        self.assertEqual(self.results["titled"], ["El Alamein", "Wake Island", "Kursk", "Battle of the Bulge"])

    def test_a_kept_recording_is_keyed_by_its_file_name(self) -> None:
        self.assertEqual(self.results["keys"], ["replay_20260927-140921", "REPLAY_1", "my_round_2_", "recording", "a_b_c"])

    def test_it_plays_from_a_url_naming_its_mod_and_level(self) -> None:
        # The page's own side, room, level and game type stay behind: the
        # recording's replace them. Its developer switch carries over.
        href = self.results["href"]
        self.assertEqual(href["path"], "map.html")
        self.assertEqual(href["params"], {
            "mod": "bf1942", "map": "Kursk", "replay": "local:replay_20260927-140921", "dev": "1",
        })
        # Readable as written: the colon is not escaped.
        self.assertIn("replay=local:replay_20260927-140921", href["search"])
        self.assertEqual(self.results["local"], [True, False, False])


class MidRoundRecordingTests(unittest.TestCase):
    """A file the recorder began after the join."""

    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()

    def test_it_names_no_level_mod_or_server(self) -> None:
        summary = self.results["midRound"]["summary"]
        self.assertEqual((summary["level"], summary["mode"], summary["mod"], summary["server"]), ("", "", "", ""))

    def test_its_talkers_are_named_by_their_chat(self) -> None:
        # The side-channel marker is not part of the name, a colon in what he
        # said does not cut it, and the server's own lines name nobody.
        players = self.results["midRound"]["players"]
        self.assertEqual(players["11"], {"name": "Sir Real", "team": 2, "ai": False, "local": False})
        self.assertEqual(players["3"]["name"], "Tim")
        self.assertNotIn("-1", players)
        # The feed's rows carry the names, though the chat comes later.
        self.assertEqual(self.results["midRound"]["rows"], ["Sir Real spawned"])

    def test_a_silent_player_keeps_his_side(self) -> None:
        # Nothing names him; his player records say which side he is on, and
        # whether he is a bot the recording cannot say.
        self.assertEqual(self.results["midRound"]["players"]["255"], {"name": None, "team": 2, "ai": None, "local": False})

    def test_the_recording_player_is_the_one_whose_rounds_are_local(self) -> None:
        self.assertEqual(self.results["midRound"]["recordingPid"], 18)

    def test_the_chat_box_speaker(self) -> None:
        self.assertEqual(self.results["speakers"],
                         ["Name", "Name", "Name", "That's SIR to You", None, None, None, None, None])

    def test_a_file_from_the_fixed_recorder_names_everything(self) -> None:
        held = self.results["held"]
        self.assertEqual(held["summary"]["level"], "Tobruk")
        self.assertEqual(held["summary"]["mode"], "conquest")
        self.assertEqual(held["summary"]["mod"], "bf1942")
        self.assertEqual(held["summary"]["server"], "MoonGamers.com | Est. 2004")
        self.assertEqual(held["players"]["255"], {"name": "James Bamber", "team": 2, "ai": True, "local": False})
        self.assertEqual(held["players"]["18"]["name"], "Recorder")
        self.assertEqual(held["recordingPid"], 18)


class RecogniseLevelTests(unittest.TestCase):
    """`replay-level.js`: the level whose flags are the recording's."""

    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()["recognise"]

    def test_tobruk_by_its_flags(self) -> None:
        # Aberdeen (1 km) is too small to hold flags 2.5 km out and is never
        # read, and once vanilla has it the packs are not read at all.
        tobruk = self.results["tobruk"]
        self.assertEqual(tobruk["found"], {"mod": "bf1942", "level": "Tobruk", "matched": 7, "of": 7})
        self.assertEqual(tobruk["reads"], ["bf1942/El_Alamein", "bf1942/Tobruk"])

    def test_the_mod_it_plays_in_is_looked_at_first(self) -> None:
        self.assertEqual(self.results["packFirst"]["found"]["mod"], "xpack1")
        self.assertEqual(self.results["packFirst"]["reads"], ["xpack1/Anzio", "xpack1/Tobruk"])
        self.assertEqual(self.results["otherMod"]["found"]["mod"], "eod")

    def test_most_of_the_flags_will_do_when_nothing_else_has_as_many(self) -> None:
        self.assertEqual(self.results["oneMoved"]["found"]["level"], "Tobruk")
        self.assertEqual(self.results["oneMoved"]["found"]["matched"], 6)
        self.assertIsNone(self.results["threeMoved"]["found"])
        self.assertIsNone(self.results["tie"]["found"])

    def test_nothing_to_go_on(self) -> None:
        self.assertIsNone(self.results["noFlags"]["found"])
        self.assertIsNone(self.results["overBudget"]["found"])
        self.assertEqual(self.results["overBudget"]["reads"], [])

    def test_scene_json_flags_are_turned_back_into_bf1942s_frame(self) -> None:
        self.assertEqual(run_harness()["levelFlags"], [{"tmpl": "allies_base", "x": 2546.28, "z": 817.94}])


class LevelSkinTests(unittest.TestCase):
    """`replay-assets.js`: a replayed hull dressed the way the level dresses its own."""

    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()

    def test_the_levels_alternative_textures_paint_the_hull(self) -> None:
        # Tobruk's `Texture/Africa`: the hull's `texture/Sherma_I` becomes the
        # level's own texture object; a texture the level reads from
        # `texture/` as the model does is left alone, and so is one a level's
        # variant already carries.
        skins = self.results["skins"]
        self.assertEqual(skins["keys"], ["palm_c", "sherma_i"])
        self.assertEqual(skins["changed"], 1)
        self.assertEqual(skins["hull"], ["texture/Africa/sherma_i.dds", "texture/tankhatch_h.dds",
                                         "bf1942/levels/Kasserine_Pass/AltTextures/sherma_i.dds"])
        self.assertTrue(skins["sameTexture"])

    def test_a_levels_own_variant_is_the_model_it_plays_with(self) -> None:
        self.assertEqual(self.results["modelFiles"], [
            "Sherman.Kasserine_Pass.glb", "Sherman.wreck.Kasserine_Pass.glb", "Sherman.glb", "Sherman.glb", "Tiger.glb",
        ])


if __name__ == "__main__":
    unittest.main()
