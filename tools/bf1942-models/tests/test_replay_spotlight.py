"""The replay's spotlight on a kill (replay-spotlight-fights.js and the page
side, replay-spotlight.js): the round's fights, the one a kill ended, which
side is whose, the rounds that passed between two things and each hit's
recorded drop.

One node run (`replay_spotlight_harness.mjs`), many assertions. The cases are
small recordings written line by line in the harness.

Why it exists. The owner's asks (2026-11-12): a match-up that froze two that
fought and took them apart, then the two brought to the front while the round
played, then, of that: "the fact it highlights the opponent is nice. It means
you could zoom in on just that kill", a button on a kill that "just clips in
before the kill and highlights the two opponents", and last "get rid of the
break down, and turn spotlight on by default". Spotlight rests on these
functions: which fight a kill ended, who was in it, which rounds were theirs,
which drop each hit took. features/replay-spotlight.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import unittest
from pathlib import Path

HARNESS = Path(__file__).resolve().parent / "replay_spotlight_harness.mjs"
VIEWER = Path(__file__).resolve().parents[1] / "viewer"

_cache: dict | None = None


def run_harness() -> dict:
    global _cache
    if _cache is not None:
        return _cache
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    proc = subprocess.run(["node", str(HARNESS)], capture_output=True, text=True, timeout=120)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    _cache = json.loads(proc.stdout)
    return _cache


class FightTests(unittest.TestCase):
    """A Sherman and a Tiger 200 m apart: three rounds from the Sherman (a
    hit, one 5 m wide, one 30 m wide), one from the Tiger that kills it."""

    @classmethod
    def setUpClass(cls) -> None:
        cls.duel = run_harness()["duel"]

    def test_one_fight_with_the_followed_player_first(self) -> None:
        d = self.duel
        self.assertEqual(d["fights"], 1)
        self.assertEqual((d["a"], d["b"]), ("Sherman", "Tiger"))
        self.assertEqual(d["hits"], {"a": 1, "b": 1})
        self.assertTrue(d["kill"])
        self.assertEqual(d["killer"], "Tiger")

    def test_the_rounds_between_them(self) -> None:
        rounds = self.duel["rounds"]
        # The round 30 m wide is not one fired at him.
        self.assertEqual([(r["by"], r["kind"]) for r in rounds], [("a", "hit"), ("a", "near"), ("b", "hit")])
        self.assertAlmostEqual(rounds[1]["miss"], 5.1, delta=0.2)

    def test_each_hit_is_checked_against_its_own_drop(self) -> None:
        rounds = self.duel["rounds"]
        self.assertEqual(rounds[0]["drop"], 33)
        self.assertEqual(rounds[2]["drop"], 100)

    def test_their_hit_points(self) -> None:
        # The Tiger before and after the Sherman's hit; the Sherman dead.
        self.assertEqual(self.duel["health"], [{"hp": 100, "max": 100}, {"hp": 67, "max": 100}, {"hp": 0, "max": 100}])

    def test_its_label(self) -> None:
        self.assertEqual(self.duel["label"], {"who": "Ann", "what": "Sherman", "soldier": False})


class DropTests(unittest.TestCase):
    def test_two_rounds_on_one_drop_give_it_to_the_first(self) -> None:
        self.assertEqual(run_harness()["twice"], [{"kind": "hit", "drop": 30}, {"kind": "hit", "drop": None}])


class InferredHitTests(unittest.TestCase):
    def test_a_round_through_the_hull_before_an_unclaimed_drop_is_its_hit(self) -> None:
        # The dummy beside it is not a round at all.
        self.assertEqual(run_harness()["inferred"], [
            {"weapon": "ShermanGunBarrel", "kind": "hit", "inferred": True, "drop": 60},
        ])


class FootTests(unittest.TestCase):
    def test_a_soldier_against_a_tank_is_his_soldier_against_the_hull(self) -> None:
        self.assertEqual(run_harness()["foot"], [{"a": "soldier", "b": "Tiger", "hits": {"a": 1, "b": 0}, "kill": True}])


class EpisodeTests(unittest.TestCase):
    """The round's fights, for the spotlight on a kill (2026-11-12, the owner:
    Spotlight on a kill "just clips in before the kill and highlights the two
    opponents"). The Sherman and the Tiger meet twice, 50 s apart; a Panther
    hits the Sherman once in between."""

    @classmethod
    def setUpClass(cls) -> None:
        cls.e = run_harness()["episodes"]

    def test_the_same_two_meeting_again_is_another_fight(self) -> None:
        self.assertEqual([(f["pair"], f["first"], f["last"], f["kill"]) for f in self.e["list"]],
                         [("Sherman-Tiger", 10, 10, False), ("Panther-Sherman", 13, 13, False), ("Sherman-Tiger", 60, 62.8, True)])

    def test_a_kill_finds_the_fight_it_ended(self) -> None:
        self.assertTrue(self.e["ofKill"])
        # The timeline's mark is the kill line's time, give or take.
        self.assertTrue(self.e["ofKillNear"])
        self.assertIsNone(self.e["ofKillWrongVictim"])
        self.assertIsNone(self.e["ofKillWrongTime"])

    def test_sides(self) -> None:
        self.assertEqual(self.e["orientedA"], "Sherman")
        self.assertEqual(self.e["orientedKiller"], "Tiger")
        self.assertTrue(self.e["hasAnn"])
        self.assertFalse(self.e["hasOde"])


class WiringTests(unittest.TestCase):
    """On by default (2026-11-12): every kill in the timeline has Spotlight, no
    switch under the bar's menu, and the frame gets the spotlight's pass."""

    def test_every_kill_has_spotlight_and_the_frame_its_pass(self) -> None:
        replay = (VIEWER / "replay.js").read_text()
        ui = (VIEWER / "replay-ui.js").read_text()
        timeline = (VIEWER / "replay-timeline.js").read_text()
        self.assertIn("new ReplaySpotlight(this)", replay)
        self.assertIn("this.withSpotlight(s => s.update(t, dt))", replay)
        self.assertIn("player.spotlight?.render()", replay)
        self.assertIn("if (!this.spotlight?.dimmed) this.ui.timeline.capture(canvas);", replay)
        self.assertIn("el('button', 'rp-tip-shot rp-tip-spotlight', 'Spotlight')", timeline)
        self.assertIn("spotlight.light(ch.t, ch.victim)", timeline)
        self.assertIn("if ((ch.kind === 'kill' || ch.kind === 'teamkill') && spotlight) {", timeline)
        # No switch, and nothing of the match-up's breakdown left.
        self.assertNotIn("Spotlight", ui.split("buildMore()")[1].split("toggleMore()")[0])
        for name in ("replay-matchup.js", "replay-matchup-view.js", "replay-matchup-live.js", "replay-matchup-strike.js"):
            self.assertFalse((VIEWER / name).exists(), name)
        self.assertNotIn("matchup", replay.lower())
        self.assertNotIn("matchup", ui.lower())

    def test_the_spotlight_lets_go_after_the_kill(self) -> None:
        live = (VIEWER / "replay-spotlight.js").read_text()
        # From before the kill and its round; let go a few seconds after it.
        self.assertIn("this.pin = { raw, kill, from: kill.t, until: kill.t + HOLD, faced: false };", live)
        self.assertIn("Math.min(kill.t - SPOT_LEAD, killer ? killer.f.t - SPOT_ROUND_LEAD : Infinity)", live)
        self.assertIn("if (pin && (t > pin.until || t < pin.from - 1)) this.pin = null;", live)
        # The rounds are the shot lines' tracers.
        self.assertIn("new Tracers(", live)
        self.assertIn("new Tracers(", (VIEWER / "replay-shotlines.js").read_text())

    def test_the_spotlight_puts_the_frame_back(self) -> None:
        live = (VIEWER / "replay-spotlight.js").read_text()
        # The two are lent to the pass's own scene, never re-parented, and
        # everything the pass changes on the page's renderer is put back.
        self.assertIn("spot.children = [...this.lightsOf(scene), ...this.rootsOf(fight, this.player.time), gl.tracers.group];", live)
        self.assertIn("spot.matrixWorldAutoUpdate = false;", live)
        self.assertNotIn(".add(gl.tracers.group)", live)
        block = live[live.index("    } finally {"):live.index("    return true;\n  }\n\n  dispose()")]
        for restore in ("spot.children = []", "renderer.shadowMap.autoUpdate = saved.shadowAuto", "renderer.shadowMap.needsUpdate = saved.shadowNeeds",
                        "renderer.autoClear = saved.autoClear", "renderer.info.autoReset = saved.infoReset"):
            self.assertIn(restore, block)


if __name__ == "__main__":
    unittest.main()
