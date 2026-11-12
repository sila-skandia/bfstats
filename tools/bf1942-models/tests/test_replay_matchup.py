"""The replay's match-up (replay-matchup.js): the fights near the playhead,
the rounds that passed between two things, each hit's recorded drop, where
one was seen from the other, the soldier's body part a drop names, what one
gun does to a hull's armour, and the words the panel says.

One node run (`replay_matchup_harness.mjs`), many assertions. The cases are
small recordings written line by line in the harness.

Why it exists. The owner's ask (2026-11-12): freeze a replayed round on two
things that fought, take them apart side by side and show where each was
vulnerable to the other, the way History's *Dogfights* paused a fight to
compare the two planes. Then, the same day: the freeze made them scrub to
the exact moment, so the mode plays on with the fight at the playhead
brought to the front, and a kill opens the breakdown. The page side
(replay-matchup-view.js, replay-matchup-live.js) rests on these functions:
which two fought and when, which rounds were theirs, which drop each hit is
checked against. features/replay-matchup.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import unittest
from pathlib import Path

HARNESS = Path(__file__).resolve().parent / "replay_matchup_harness.mjs"
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

    def test_the_playhead_inside_the_fight_is_the_moment(self) -> None:
        self.assertEqual(self.duel["moment"], 13)

    def test_from_outside_the_fight_the_moment_is_just_before_its_kill(self) -> None:
        self.assertAlmostEqual(self.duel["momentFromAfar"], 14.65, places=2)

    def test_nothing_past_the_window(self) -> None:
        self.assertEqual(self.duel["nothingFar"], 0)

    def test_the_rounds_between_them(self) -> None:
        rounds = self.duel["rounds"]
        # The round 30 m wide is not one fired at him.
        self.assertEqual([(r["by"], r["kind"]) for r in rounds], [("a", "hit"), ("a", "near"), ("b", "hit")])
        self.assertAlmostEqual(rounds[1]["miss"], 5.1, delta=0.2)

    def test_each_hit_is_checked_against_its_own_drop(self) -> None:
        rounds = self.duel["rounds"]
        self.assertEqual(rounds[0]["drop"], 33)
        self.assertEqual(rounds[2]["drop"], 100)

    def test_the_tallies(self) -> None:
        self.assertEqual(self.duel["tallyA"], {"fired": 2, "hit": 1, "glanced": 0, "missed": 1, "dealt": 33})
        self.assertEqual(self.duel["tallyB"], {"fired": 1, "hit": 1, "glanced": 0, "missed": 0, "dealt": 100})

    def test_where_each_was_seen_from(self) -> None:
        # Both face BF1942's +z: the Sherman is behind the Tiger, the Tiger
        # dead ahead of the Sherman.
        self.assertEqual(self.duel["seenByA"]["bearing"], 180)
        self.assertEqual(self.duel["seenByB"]["bearing"], 0)
        self.assertEqual(self.duel["seenByA"]["range"], 200)

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


class BodyPartTests(unittest.TestCase):
    """A Thompson's prices: head 15, chest 9, limbs 5."""

    @classmethod
    def setUpClass(cls) -> None:
        cls.parts = run_harness()["parts"]

    def test_a_drop_names_the_part_that_costs_it(self) -> None:
        self.assertEqual(self.parts["chest"], "chest")
        self.assertEqual(self.parts["head"], "head")

    def test_a_drop_no_part_costs_names_none(self) -> None:
        self.assertIsNone(self.parts["none"])

    def test_a_killing_drop_names_a_part_only_when_one_alone_costs_that(self) -> None:
        self.assertIsNone(self.parts["killedAny"])
        self.assertEqual(self.parts["killedHead"], "head")


class ArmourTests(unittest.TestCase):
    def test_what_a_gun_does_to_a_hull(self) -> None:
        a = run_harness()["armour"]
        self.assertEqual((a["immune"], a["of"], a["from"]), (3, 5, "100 mm"))
        self.assertEqual(a["hurtList"], [33, 39])

    def test_no_from_when_a_thicker_plate_still_gives(self) -> None:
        a = run_harness()["armourMixed"]
        self.assertEqual((a["immune"], a["from"]), (1, None))

    def test_plates_named_by_thickness(self) -> None:
        self.assertEqual(run_harness()["plateMm"], [7.5, 150, None])


class WordsTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.h = run_harness()

    def test_aspects(self) -> None:
        self.assertEqual(self.h["aspects"], [
            "head on", "from the front right quarter", "from the front left quarter", "from the right side",
            "from the left side", "from the rear right quarter", "from behind",
        ])

    def test_a_side_in_words(self) -> None:
        self.assertEqual(self.h["words"], [
            "Ann fired 6 rounds at Kai: 2 did damage, 3 struck and did none and 1 missed.",
            "Their hits took 76.2 of Kai's hit points.",
            "Their 75 mm L37,5A gun does nothing to 16 of the 25 armour materials on the King Tiger: every plate from 100 mm up.",
            "From 312 m they saw Kai head on, and 22% of what they could see was armour their gun gets through; "
            "6 hits there destroy it from full health.",
        ])

    def test_nothing_seen_is_said_so(self) -> None:
        self.assertEqual(self.h["wordsNothing"], ["Kai fired nothing at Ann that the recording saw."])

    def test_the_ending(self) -> None:
        self.assertEqual(self.h["ending"], "Kai killed Ann (Tiger).")

    def test_no_verdict_and_no_he(self) -> None:
        # The panel says what happened, never who should have won, and calls
        # players they.
        words = " ".join(self.h["words"]) + " " + self.h["ending"]
        for banned in ("should have won", "never stood a chance", "winner", " he ", " his ", " him "):
            self.assertNotIn(banned, words)


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
    """Opt-in from the replay's controls: a switch on the bar's menu, nothing
    else running until it is on; with it on, kills in the timeline get
    Spotlight and the frame gets its pass."""

    def test_the_menu_switch_and_the_frame_hooks(self) -> None:
        view = (VIEWER / "replay-matchup-view.js").read_text()
        replay = (VIEWER / "replay.js").read_text()
        ui = (VIEWER / "replay-ui.js").read_text()
        timeline = (VIEWER / "replay-timeline.js").read_text()
        self.assertIn("menuItem?.('', 'matchup', 'Spotlight', '', () => this.toggle(), () => this.on)", view)
        self.assertIn("new ReplayMatchup(this)", replay)
        self.assertIn("this.withMatchup(m => m.update(t, dt))", replay)
        self.assertIn("player.matchup?.renderSpot()", replay)
        self.assertIn("if (!this.matchup?.dimmed) this.ui.timeline.capture(canvas);", replay)
        self.assertIn("menuItem(className, icon, text, key, onClick, check = false)", ui)
        self.assertIn("typeof check === 'function'", ui)
        self.assertIn("player.matchup?.key(e, once)", ui)
        self.assertIn("this.player.matchup.spotlightKill(ch.t, ch.victim)", timeline)
        self.assertIn("el('button', 'rp-tip-shot rp-tip-matchup', 'Spotlight')", timeline)
        # Nothing runs until it is on, and the timeline's button only then.
        self.assertIn("if (!this.on) return;", view)
        self.assertIn("this.player.matchup?.on ? 'm' : ''", timeline)

    def test_the_spotlight_lets_go_after_the_kill(self) -> None:
        live = (VIEWER / "replay-matchup-live.js").read_text()
        # From before the kill and its round; let go a few seconds after it.
        self.assertIn("this.pin = { raw, kill, from: kill.t, until: kill.t + HOLD, faced: false };", live)
        self.assertIn("Math.min(kill.t - SPOT_LEAD, killer ? killer.f.t - SPOT_ROUND_LEAD : Infinity)", live)
        self.assertIn("if (pin && (t > pin.until || t < pin.from - 1)) this.pin = null;", live)
        # The rounds are the shot lines' tracers.
        self.assertIn("new Tracers(", live)
        self.assertIn("new Tracers(", (VIEWER / "replay-shotlines.js").read_text())

    def test_the_spotlight_puts_the_frame_back(self) -> None:
        live = (VIEWER / "replay-matchup-live.js").read_text()
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
