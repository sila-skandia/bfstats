"""Single player's spawn time: 3 s by default, adjustable (the owner's choice).

A DEPARTURE FROM RETAIL, on purpose (2026-11-12): retail makes every dead
player wait for the 20 s reinforcement wave (SPAWN-35); the owner wants single
player faster. Instant Battle, the campaign and the headless runner use a flat
wait, `viewer/spawn-timer.js` `singlePlayerSpawnParams` (the law's own
waves-off branch), set on the Instant Battle screen's SPAWN TIME trough
(`viewer/play/bot-settings.js`) and carried as `map.html` `?spawnTime=`. A
room keeps retail's wave (`tests/test_room.py`).

The wave law's own harnesses are run again with the page / host naming the
single-player parameters (`SP_SPAWN_SECONDS`).
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from test_spawn_timer import run_harness as run_law  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
TESTS = ROOT / "tests"
# watches: tools/bf1942-models/server/*.mjs
VIEWER = ROOT / "viewer"


def run(harness: str, seconds: str | None) -> dict:
    env = dict(os.environ)
    env.pop("SP_SPAWN_SECONDS", None)
    if seconds is not None:
        env["SP_SPAWN_SECONDS"] = seconds
    proc = subprocess.run(["node", str(TESTS / harness)], capture_output=True, text=True,
                          timeout=120, env=env)
    if proc.returncode != 0:
        raise AssertionError(proc.stderr)
    return json.loads(proc.stdout)


@unittest.skipIf(shutil.which("node") is None, "node is not installed")
class SinglePlayerSpawnLawTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.r = run_law()["singlePlayer"]

    def test_the_default_is_three_seconds_and_the_range_thirty(self) -> None:
        self.assertEqual(3, self.r["seconds"])
        self.assertEqual(30, self.r["max"])
        self.assertEqual({"spawnTime": 0, "spawnDelay": 3}, self.r["params"])

    def test_a_setting_is_whole_seconds_from_0_to_30(self) -> None:
        # null, '', 'x' -> the default; 0 is a choice; 7.4 -> 7; clamped.
        self.assertEqual([3, 3, 3, 0, 0, 7, 30, 0], self.r["clamp"])

    def test_the_wait_is_flat_wherever_the_wave_clock_is(self) -> None:
        self.assertEqual([3, 3, 3, 3, 3], self.r["waits"])
        self.assertEqual(113, self.r["ready"])
        self.assertEqual([3, 1, 0, 0], self.r["left"])
        self.assertEqual("TIME TO SPAWN: 2", self.r["line"])

    def test_an_override_reaches_the_law(self) -> None:
        self.assertEqual(7, self.r["seven"])
        self.assertEqual(0, self.r["zero"])
        self.assertEqual(3, self.r["teamKill"])


@unittest.skipIf(shutil.which("node") is None, "node is not installed")
class SinglePlayerBotRespawnTests(unittest.TestCase):
    def test_bots_stand_three_seconds_after_a_death_by_default(self) -> None:
        r = run("bot_respawn_wave_harness.mjs", "default")
        self.assertEqual(3, r["at10"]["waitAtDeath"])
        self.assertAlmostEqual(13, r["at10"]["stood"], delta=0.05)
        self.assertAlmostEqual(49, r["at46"]["stood"], delta=0.05)
        # A death no hit path saw: the wait runs from the tick that finds it.
        self.assertAlmostEqual(83, r["unseen"]["stood"], delta=0.1)

    def test_the_chosen_time_reaches_the_bots(self) -> None:
        r = run("bot_respawn_wave_harness.mjs", "7")
        self.assertEqual(7, r["at46"]["waitAtDeath"])
        self.assertAlmostEqual(53, r["at46"]["stood"], delta=0.05)

    def test_a_host_that_names_nothing_keeps_retails_wave(self) -> None:
        r = run("bot_respawn_wave_harness.mjs", None)
        self.assertEqual(15, r["at10"]["waitAtDeath"])
        self.assertAlmostEqual(25, r["at10"]["stood"], delta=0.05)


@unittest.skipIf(shutil.which("node") is None, "node is not installed")
class SinglePlayerPlayerRespawnTests(unittest.TestCase):
    def test_the_player_waits_three_seconds_by_default(self) -> None:
        r = run("spawning_wave_harness.mjs", "default")
        self.assertEqual("TIME TO SPAWN: 3", r["deathAt10"]["plate"])
        # Died at 10, committed at 13: the wait is spent as they commit.
        self.assertAlmostEqual(13, r["commitAt13"]["stoodAt"], delta=0.1)
        # SUICIDE at 40 is a death too: 3 s, not the window at 50.
        self.assertAlmostEqual(3, r["suicide"]["left"], delta=0.05)
        self.assertAlmostEqual(43, r["suicide"]["stoodAt"], delta=0.1)

    def test_the_chosen_time_reaches_the_player_and_the_plate(self) -> None:
        r = run("spawning_wave_harness.mjs", "7")
        self.assertEqual("TIME TO SPAWN: 7", r["deathAt10"]["plate"])
        c = r["commitAt13"]
        self.assertTrue(c["waiting"])
        self.assertAlmostEqual(4, c["left"], delta=0.05)
        self.assertAlmostEqual(17, c["stoodAt"], delta=0.1)
        self.assertAlmostEqual(47, r["suicide"]["stoodAt"], delta=0.1)

    def test_a_room_still_waits_for_its_servers_word(self) -> None:
        r = run("spawning_wave_harness.mjs", "7")
        self.assertTrue(r["room"]["waiting"])
        self.assertTrue(r["room"]["stoodAfterWait"])


class SinglePlayerSpawnWiringTests(unittest.TestCase):
    """The value's path: the screen's trough -> `?spawnTime=` -> the page's
    player and bots; the runner; and nothing of it in a room."""

    def test_the_room_server_never_reads_the_single_player_time(self) -> None:
        for path in (ROOT / "server").rglob("*.mjs"):
            if "node_modules" in path.parts:
                continue
            text = path.read_text()
            self.assertNotIn("singlePlayerSpawn", text, path.name)
            self.assertNotIn("SINGLE_PLAYER_SPAWN", text, path.name)
        authority = (ROOT / "server" / "authority.mjs").read_text()
        self.assertIn("spawnWait(round.clock, { teamKills", authority)

    def test_the_relay_fallback_keeps_retails_wave(self) -> None:
        room = (VIEWER / "net-room.js").read_text()
        self.assertIn("{ spawnTime: DEFAULT_SPAWN_TIME, spawnDelay: DEFAULT_SPAWN_DELAY }", room)

    def test_the_page_hands_the_time_to_its_player_and_its_bots(self) -> None:
        page = (VIEWER / "map.html").read_text()
        self.assertIn("singlePlayerSpawnSeconds(params.get('spawnTime')", page)
        self.assertEqual(2, page.count("spawnParams: () => SP_SPAWN_PARAMS,"))
        self.assertIn("page.spawnParams?.()", (VIEWER / "spawning.js").read_text())
        self.assertIn("env.spawnParams?.()", (VIEWER / "bot-referee.js").read_text())

    def test_the_screen_sends_and_remembers_it(self) -> None:
        screen = (VIEWER / "play" / "skirmish.js").read_text()
        self.assertIn("url.searchParams.set('spawnTime', String(state.spawnSeconds));", screen)
        self.assertIn("localStorage.setItem(SINGLE_PLAYER_SPAWN_KEY", screen)
        self.assertIn("spawnSeconds: storedSpawnSeconds(),", screen)

    def test_the_runner_plays_the_same_time(self) -> None:
        match = (ROOT / "sim" / "match.mjs").read_text()
        self.assertIn("spawnParams: () => this.spawnParams,", match)
        self.assertIn("M.singlePlayerSpawnParams?.(spawnSeconds ?? undefined)", match)

    def test_the_bot_judges_stay_on_the_wave_their_bars_were_recorded_under(self) -> None:
        # sim/baselines/*.json were recorded on retail's 20 s wave: botbatch's
        # runs and pagematch's page must play it too, or a level is judged
        # against a bar of another spawn law.
        batch = (ROOT / "sim" / "botbatch.mjs").read_text()
        self.assertIn("'--spawn-time', 'wave'", batch)
        page_match = (ROOT / "sim" / "pagematch.mjs").read_text()
        self.assertIn("q.set('spawnTime', 'wave')", page_match)
        page = (VIEWER / "map.html").read_text()
        self.assertIn("params.get('spawnTime') === 'wave' ? null", page)

    @unittest.skipIf(shutil.which("node") is None, "node is not installed")
    def test_the_trough_is_a_third_control_in_whole_seconds(self) -> None:
        script = """
          const here = process.argv[1];
          const b = await import(here + '/viewer/play/bot-settings.js');
          const r = b.spawnTimeRect();
          const mid = b.hitBotSettings(r[0] + r[2] / 2, r[1] + 2);
          process.stdout.write(JSON.stringify({
            rect: r, same: [b.botCountRect()[0], b.botCountRect()[2], b.botCountRect()[3]],
            mid, seconds: [0, 0.1, 0.5, 1].map(b.fracToSpawnSeconds),
            count: b.hitBotSettings(b.botCountRect()[0] + 1, b.botCountRect()[1] + 1).kind,
            skill: b.hitBotSettings(b.botSkillRect()[0] + 1, b.botSkillRect()[1] + 1).kind,
          }));
        """
        proc = subprocess.run(["node", "--input-type=module", "-e", script, str(ROOT)],
                              capture_output=True, text=True, timeout=60)
        if proc.returncode != 0:
            raise AssertionError(proc.stderr)
        r = json.loads(proc.stdout)
        # The neighbours' own trough: same left edge, width and height.
        self.assertEqual(r["same"], [r["rect"][0], r["rect"][2], r["rect"][3]])
        self.assertEqual("spawnTime", r["mid"]["kind"])
        self.assertEqual([0, 3, 15, 30], r["seconds"])
        self.assertEqual(["botCount", "botSkill"], [r["count"], r["skill"]])


if __name__ == "__main__":
    unittest.main()
