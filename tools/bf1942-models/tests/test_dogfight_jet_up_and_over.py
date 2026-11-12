"""Up and over on a jet (features/dogfight-lessons-jets/up-and-over.md).

The Spitfire's lesson rests on the follower running out of speed going up. A
jet does not, and neither does the jet's ace: they go over the top while the
air still holds them (`jetUpAndOver`, `jetUoAce`, `jetUoAceSharp` in
`viewer/dogfight-lessons/jets/plan-up-and-over.js`, over `dogfight-jet-ceiling.js`) and
come straight back down. The lesson's words (`viewer/dogfight-lessons/jets/up-and-over.js`)
say what that fight does, every number in them held here. The Dip is the shot
as they pull, then past them as they come back down and away (`jetUoDip`).
Every jet pilot flies under the roof (`stepPilot`, `underRoof`), which caps
a pull toward the sky near the top and takes the throttle off a nose well over
the climb it allows; the ace opts its pull, its loop and its recovery out of
it (`roof: false`) and climbs off a pounce at 35 degrees at most.

`move` and `counter` are flown from the harness's nine starts (your start x
-30/0/+30 m by speed -3/0/+3 m/s, `dogfight_jet_harness.mjs`); the Dip, the
Flip and the Ninja from the school's own nine (`dogfight-measure.js`
`STARTS`), scored as the school scores them (`scoreMove`, `movesOn`). The
measures the harness does not print (the climb, the tops, when the hits land)
come from `MEASURE` below, which flies the same fights on the same airframes.
"""

from __future__ import annotations

import functools
import json
import shutil
import subprocess
import unittest
from pathlib import Path

from jet_school import jet_lesson, jet_tops, shot_down

TOOLS = Path(__file__).resolve().parent.parent
LESSON = "up-and-over"

# The fights again, measured: per start the climb, the tops and the hits (move,
# counter), the score and where it began (dip, flip, ninja), and the verdicts.
MEASURE = r"""
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const TOOLS = process.argv[1], PLANE = process.argv[2];
const { installModuleHooks, viewerDir } = await import(pathToFileURL(path.join(TOOLS, 'sim', 'env.mjs')).href);
const viewer = viewerDir(path.join(TOOLS, 'viewer'));
installModuleHooks(viewer);
const load = name => import(pathToFileURL(path.join(viewer, name)).href);
const THREE = await load('vendor/three.module.js');
const { Aircraft } = await load('aircraft.js');
const { runDuel } = await load('dogfight-duel.js');
const { LESSONS, lessonFor, demoSides } = await load('dogfight-lessons.js');
const { STARTS, nudge, scoreMove, movesOn } = await load('dogfight-measure.js');
const { pitchOf } = await load('dogfight-flight.js');
const { jetMaker } = await import(pathToFileURL(path.join(TOOLS, 'tests', 'jet_airframes.mjs')).href);
const fixture = JSON.parse(readFileSync(path.join(TOOLS, 'tests', 'fixtures', 'dc-jets.json'), 'utf8'));
const makePlane = jetMaker(THREE, Aircraft, fixture, PLANE);
const L = lessonFor(LESSONS.find(l => l.id === 'up-and-over'), 'jet');
const pitch = k => pitchOf({ x: k.q[0], y: k.q[1], z: k.q[2], w: k.q[3] });
const sep = (A, B, i) => Math.hypot(...A[i].p.map((v, j) => v - B[i].p[j]));
const hitTimes = (r, side) => r.rounds.filter(x => x.hit && x.side === side).map(x => x.hitT);
// The ace's first top (the highest point before the first fall once over
// the top), the highest it ever goes, and its slowest from that top on.
const aceOf = A => {
  let i = Math.max(0, A.findIndex(k => k.ph === 'over'));
  while (i + 1 < A.length && A[i + 1].p[1] >= A[i].p[1]) i++;
  return { top: i, peak: Math.max(...A.map(k => k.p[1])), slow: Math.min(...A.slice(i).map(k => k.v)) };
};
const out = { plane: PLANE, fights: {}, moves: {}, verdicts: null };
const GRID = [];
for (const dx of [-30, 0, 30]) for (const dv of [-3, 0, 3]) GRID.push({ dx, dv });
for (const id of ['move', 'counter']) {
  const demo = L.demos.find(d => d.id === id);
  out.fights[id] = GRID.map(({ dx, dv }) => {
    const sides = demoSides(L, demo);
    sides[1] = { ...sides[1], start: nudge(sides[1].start, { dx, dv }) };
    const r = runDuel({ makePlane, seconds: demo.seconds ?? L.seconds, groundAt: () => 0, sides });
    const [A, B] = r.tracks;
    const ace = aceOf(A);
    const climb = A.slice(0, ace.top).filter(k => pitch(k) > 60);
    const pull = A.filter(k => k.ph === 'pull');
    const over = A.find(k => k.ph === 'over');
    const yours = hitTimes(r, 1), first = yours.length ? Math.round(yours[0] / r.dt) : null;
    const pounce = A.find((k, i) => i > ace.top && k.ph === 'pounce');
    return {
      dx, dv, hits: r.hits, winner: r.end?.winner ?? null, aceHits: hitTimes(r, 0), yourHits: yours,
      pullAt: pull[0].t, pullPitch: Math.max(...pull.map(pitch)),
      climbSpeed: [Math.min(...climb.map(k => k.v)), Math.max(...climb.map(k => k.v))],
      overAt: [over.t, over.p[1], over.v, pitch(over)], top: [A[ace.top].p[1], A[ace.top].t, A[ace.top].v],
      pounceAt: pounce ? pounce.t : null, acePeak: ace.peak, aceSlow: ace.slow,
      yourTop: Math.max(...B.map(k => k.p[1])), underAtTop: A[ace.top].p[1] - B[ace.top].p[1],
      yourSlowestClimb: Math.min(...B.slice(0, Math.round(20 / r.dt)).map(k => k.v)),
      firstHit: first === null ? null : { range: sep(A, B, first), hisPitch: pitch(A[first]), myPitch: pitch(B[first]) },
      closest: Math.min(...A.map((_, i) => sep(A, B, i))),
      phases: [...new Set(r.events.filter(e => e.side === 1).map(e => e.phase))],
    };
  });
}
for (const d of L.demos.filter(d => d.kind)) {
  out.moves[d.id] = STARTS.map(st => {
    const sides = demoSides(L, d);
    sides[1] = { ...sides[1], start: nudge(sides[1].start, st) };
    const r = runDuel({ makePlane, seconds: d.seconds ?? L.seconds, groundAt: () => 0, sides });
    const s = scoreMove(r, d.kind, 1);
    const [A, B] = r.tracks;
    const i0 = Math.round(s.t0 / r.dt);
    const ev = side => r.events.filter(e => e.side === side).map(e => [e.t, e.phase]);
    const ace = aceOf(A);
    return { ...s, yourHeightAt0: B[i0].p[1], aceTop: A[ace.top].p[1], aceTopAt: A[ace.top].t,
             acePeak: ace.peak, aceSlow: ace.slow,
             yourTop: Math.max(...B.map(k => k.p[1])), yourSlowEnd: Math.min(...B.slice(-Math.round(10 / r.dt)).map(k => k.v)),
             yourHitsAfter: hitTimes(r, 1).filter(t => t >= s.t0), ace: ev(0), you: ev(1),
             yourSlowAfter: s.t0 === null ? null : Math.min(...B.slice(i0).map(k => k.v)) };
  });
}
out.verdicts = await movesOn(L, { makePlane, runDuel, demoSides });
console.log(JSON.stringify(out));
"""


@functools.lru_cache(maxsize=None)
def measure(plane: str = "F16") -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    proc = subprocess.run(["node", "--input-type=module", "-e", MEASURE, str(TOOLS), plane],
                          capture_output=True, text=True, timeout=900)
    if proc.returncode != 0:
        raise AssertionError(f"up-and-over measure failed:\n{proc.stderr[-3000:]}")
    return json.loads(proc.stdout)


@functools.lru_cache(maxsize=None)
def words() -> dict:
    """The jet file's words, as the page gets them."""
    script = ("import { pathToFileURL } from 'node:url';"
              "const m = await import(pathToFileURL(process.argv[1]).href);"
              "console.log(JSON.stringify(m.default));")
    proc = subprocess.run(["node", "--input-type=module", "-e", script,
                           str(TOOLS / "viewer" / "dogfight-lessons/jets/up-and-over.js")],
                          capture_output=True, text=True, timeout=60)
    if proc.returncode != 0:
        raise AssertionError(proc.stderr)
    return json.loads(proc.stdout)


def span(values) -> tuple[float, float]:
    values = list(values)
    return min(values), max(values)


class TheJetAceTests(unittest.TestCase):
    """The ace respects the top of the sky: over the top at 550 m, the loop
    under 800 m, nobody over 860 m, from every start of every demo."""

    def _all(self, plane: str):
        m = measure(plane)
        return m["fights"]["move"] + m["fights"]["counter"], [r for d in m["moves"].values() for r in d]

    def test_the_lesson_flies_the_jet_aces(self) -> None:
        w = words()
        self.assertEqual("jetUpAndOver", w["ace"]["plan"])
        self.assertEqual("jetUoAce", w["flyAce"])
        self.assertEqual({"jetUoAceSharp"}, {w["demos"][d]["ace"] for d in ("dip", "flip", "ninja")})

    def test_the_loop_and_the_top_on_the_f16(self) -> None:
        fights, moves = self._all("F16")
        for r in fights:
            self.assertAlmostEqual(725, r["top"][0], delta=3)
            self.assertGreaterEqual(r["climbSpeed"][0], 71)
        for r in moves:
            self.assertAlmostEqual(725, r["aceTop"], delta=3)
        for r in fights + moves:
            self.assertLess(r["acePeak"], 775, r["acePeak"])
            # Never slower than 44 m/s after its first top: slower than 58
            # m/s and not diving, it noses down for speed (the recovery).
            self.assertGreaterEqual(r["aceSlow"], 44, r["aceSlow"])

    def test_the_loop_and_the_top_on_the_mig29(self) -> None:
        fights, moves = self._all("Mig29")
        for r in fights:
            self.assertTrue(772 <= r["top"][0] <= 777, r["top"])
        for r in moves:
            self.assertTrue(772 <= r["aceTop"] <= 777, r["aceTop"])
        for r in fights + moves:
            self.assertLess(r["acePeak"], 815, r["acePeak"])
            self.assertGreaterEqual(r["aceSlow"], 63, r["aceSlow"])

    def test_nobody_tops_860_m(self) -> None:
        # The harness's own nine starts, every demo and move: the highest
        # either plane went, real metres.
        for plane, cap in (("F16", 810), ("Mig29", 835)):
            tops = jet_tops(plane, LESSON)[LESSON]
            self.assertEqual({"move", "counter", "dip", "flip", "ninja"}, set(tops))
            for demo, t in tops.items():
                self.assertLess(max(t["top"]), cap, (plane, demo, t))
                self.assertEqual([0, 0], t["past"], (plane, demo, t))

    def test_the_ace_opts_out_of_the_roof_only_where_it_means_to(self) -> None:
        # The pull, the loop and the recovery; the zoom back up is capped.
        src = (TOOLS / "viewer" / "dogfight-lessons/jets/plan-up-and-over.js").read_text()
        self.assertNotIn("underRoof(", src)
        self.assertEqual(3, src.count("roof: false }"))
        self.assertIn("const OVER_AT = 550;", src)
        self.assertIn("const ZOOM_MAX = 35;", src)

    def test_the_ceiling_is_read_over_the_pace_the_context_gives(self) -> None:
        # "1,000 m real is 781 in the F-16 pilot's numbers and 667 in the MiG-29's"
        src = (TOOLS / "viewer" / "dogfight-jet-ceiling.js").read_text()
        self.assertIn("export const LIFT_CEILING = 1000;", src)
        self.assertIn("c.pace", src)
        self.assertNotIn("1.28", src.split("export const LIFT_CEILING")[1])


class TheClimbOnAJetTests(unittest.TestCase):
    """Story, second paragraph: a jet does not run out of speed going up, and
    goes over the top while the air still holds it."""

    @classmethod
    def setUpClass(cls) -> None:
        cls.runs = measure()["fights"]["move"] + measure()["fights"]["counter"]

    def test_they_keep_their_speed_all_the_way_up(self) -> None:
        for r in self.runs:
            self.assertAlmostEqual(1.5, r["pullAt"], delta=0.05)
            # "with its nose over 60 degrees the F-16 never drops below 71 m/s"
            self.assertGreater(r["pullPitch"], 60)
            self.assertGreaterEqual(r["climbSpeed"][0], 71)

    def test_the_air_runs_out_at_a_thousand_metres(self) -> None:
        # "in BF1942 a wing makes half its lift at 500 m and none at all at 1,000 m"
        src = (TOOLS / "viewer" / "aircraft.js").read_text()
        self.assertIn("const AIR_DENSITY_ZERO_AT_HEIGHT = 1000;", src)
        self.assertIn("return 1 - clamp(y / AIR_DENSITY_ZERO_AT_HEIGHT, 0, 1);", src)

    def test_over_the_top_at_550_m_and_725_m_at_the_top(self) -> None:
        for r in self.runs:
            t, y, _, _ = r["overAt"]
            # "go over the top at 550 m, 4 s later"
            self.assertAlmostEqual(550, y, delta=5)
            self.assertAlmostEqual(4.2, t - r["pullAt"], delta=0.3)
            # "a loop that tops out at 725 m at 76 m/s, 9 s in"
            top_y, top_t, top_v = r["top"]
            self.assertAlmostEqual(725, top_y, delta=3)
            self.assertAlmostEqual(9, top_t, delta=0.3)
            self.assertAlmostEqual(76, top_v, delta=1)
            # "and brings them straight back down at you"
            self.assertIsNotNone(r["pounceAt"])
            self.assertLessEqual(r["pounceAt"], 12.5)


class FollowingThemUpOnAJetTests(unittest.TestCase):
    """Story, third paragraph: following them up, the follower ends up slow."""

    @classmethod
    def setUpClass(cls) -> None:
        cls.runs = measure()["fights"]["move"]

    def test_you_run_out_of_air_and_speed(self) -> None:
        # "55 to 62 m under them as they go over"
        lo, hi = span(r["underAtTop"] for r in self.runs)
        self.assertTrue(54.5 <= lo and hi <= 62.5, (lo, hi))
        # "into the thin air at 770 to 790 m"
        lo, hi = span(r["yourTop"] for r in self.runs)
        self.assertTrue(770 <= lo and hi <= 790, (lo, hi))
        # "your speed runs out: 18 to 27 m/s"
        lo, hi = span(r["yourSlowestClimb"] for r in self.runs)
        self.assertTrue(18 <= lo and hi <= 27, (lo, hi))

    def test_they_come_round_and_hit_you_but_nobody_is_shot_down(self) -> None:
        # "in four of the nine they came round and hit you, 4 or 5 times about
        # 31 s in from three of them"
        hit = [r["aceHits"] for r in self.runs if r["aceHits"]]
        self.assertEqual([1, 4, 5, 5], sorted(len(h) for h in hit))
        self.assertTrue(all(30.5 <= t <= 31.5 for h in hit for t in h), hit)
        # "the only round you landed, in two of the nine, was fired before
        # they pulled up"
        yours = [r["yourHits"] for r in self.runs if r["yourHits"]]
        self.assertEqual(2, len(yours))
        self.assertTrue(all(len(h) == 1 and h[0] < 1.5 for h in yours), yours)
        for r in self.runs:
            self.assertIsNone(r["winner"])
        runs = jet_lesson(LESSON, demo="move")["demos"]["move"]
        self.assertEqual(0, shot_down(runs, 0) + shot_down(runs, 1))
        self.assertEqual([0, 0, 1, 0, 0, 0, 4, 5, 5], [r["hits"][0] for r in runs])


class FollowingShallowOnAJetTests(unittest.TestCase):
    """Counter story: the shot is the pull, not the top."""

    @classmethod
    def setUpClass(cls) -> None:
        cls.runs = measure()["fights"]["counter"]

    def test_the_shot_comes_as_they_pull(self) -> None:
        pulled = [r for r in self.runs if any(t > r["pullAt"] for t in r["yourHits"])]
        self.assertEqual(7, len(pulled))
        for r in pulled:
            self.assertTrue(all(4.6 <= t <= 5.8 for t in r["yourHits"]), r["yourHits"])
            self.assertTrue(6 <= len(r["yourHits"]) <= 12)
            # "as their nose comes up through 62 to 65 degrees they fly through
            # your sight 390 to 430 m out"
            self.assertTrue(61.5 <= r["firstHit"]["hisPitch"] <= 65.5, r["firstHit"])
            self.assertTrue(385 <= r["firstHit"]["range"] <= 430, r["firstHit"])
            self.assertNotIn("shoot", r["phases"])
        # "in the other two, 30 m to the right and as fast or 3 m/s faster, it never came"
        missed = [(r["dx"], r["dv"]) for r in self.runs if r not in pulled]
        self.assertEqual([(30, 0), (30, 3)], missed)

    def test_their_guns_never_touch_you_and_one_burst_is_not_enough(self) -> None:
        # "Their guns never touched you in the nine."
        for r in self.runs:
            self.assertEqual([], r["aceHits"])
            self.assertIsNone(r["winner"])
        runs = jet_lesson(LESSON, demo="counter")["demos"]["counter"]
        self.assertEqual([12, 8, 8, 7, 7, 7, 6, 1, 1], [r["hits"][1] for r in runs])
        self.assertEqual(0, shot_down(runs, 0) + shot_down(runs, 1))

    def test_climb_on_and_you_go_up_under_the_top(self) -> None:
        # "climb on after them and you go up to 715 to 805 m"
        lo, hi = span(r["yourTop"] for r in self.runs)
        self.assertTrue(713 <= lo and hi <= 805, (lo, hi))


class TheMovesOnAJetTests(unittest.TestCase):
    """The Dip, the Flip and the Ninja: each jet verdict is what was flown."""

    @classmethod
    def setUpClass(cls) -> None:
        cls.m = measure()
        cls.w = words()

    def test_every_verdict_is_the_count_flown(self) -> None:
        for demo, v in self.m["verdicts"].items():
            jet = self.w["demos"][demo]["verdict"]
            self.assertEqual((jet["works"], jet["of"]), (v["works"], v["of"]), demo)
        self.assertEqual({"dip": 9, "flip": 0, "ninja": 0}, {k: v["works"] for k, v in self.m["verdicts"].items()})

    def test_the_dip_shoots_passes_them_and_runs(self) -> None:
        runs = self.m["moves"]["dip"]
        self.assertTrue(all(r["ok"] and r["hitsOnMe"] == 0 for r in runs))
        hits = [len(r["yourHitsAfter"]) for r in runs]
        self.assertEqual(10, max(hits))
        self.assertEqual(1, hits.count(0))
        let_go, chased = [], []
        for r in runs:
            self.assertAlmostEqual(725, r["aceTop"], delta=3)
            self.assertEqual(["chase", "dip-shot", "dip-pass", "dip-run"], [ph for _, ph in r["you"]])
            passed = next(t for t, ph in r["you"] if ph == "dip-pass")
            self.assertAlmostEqual(9, passed, delta=0.4)
            # "go no higher than 755 m and never slower than 55 m/s"
            self.assertLessEqual(r["yourTop"], 755, r["yourTop"])
            self.assertGreaterEqual(r["yourSlowAfter"], 55, r["yourSlowAfter"])
            go = next(t for t, ph in r["ace"] if ph == "let-go")
            let_go.append(go)
            chase = next((t for t, ph in r["ace"] if ph == "chase"), None)
            if chase is not None and chase < go:
                chased.append(go - chase)
            # "at 35 s you are 1.3 to 3.8 km apart and opening"
            self.assertTrue(1300 <= r["endRange"] <= 3800 and r["opening"] > 0, r["endRange"])
        # "chase you for 7 to 12 s and let you go 24 to 30 s in (in one they
        # break round at you and let you go 18 s in)"
        self.assertEqual(8, len(chased))
        self.assertTrue(all(7 <= t <= 12.5 for t in chased), chased)
        early = [t for t in let_go if t < 20]
        self.assertEqual(1, len(early))
        self.assertAlmostEqual(18, early[0], delta=0.5)
        self.assertTrue(all(24 <= t <= 30 for t in let_go if t >= 20), let_go)

    def test_the_flip_is_flown_and_never_fires(self) -> None:
        runs = self.m["moves"]["flip"]
        # "You slow to 54 m/s at 665 to 710 m, 9 s in"
        for r in runs:
            self.assertTrue(8.5 <= r["t0"] <= 9.8, r["t0"])
            self.assertTrue(665 <= r["yourHeightAt0"] <= 710, r["yourHeightAt0"])
            # "you fall to 10 to 19 m/s"
            self.assertTrue(9.5 <= r["yourSlowAfter"] <= 19, r["yourSlowAfter"])
            self.assertEqual(0, r["myShot"])
        # "in behind them in only two of the nine, 8 and 17 s later"
        behind = sorted(r["flipAt"] - r["t0"] for r in runs if r["flipAt"] is not None)
        self.assertEqual(2, len(behind))
        self.assertAlmostEqual(8.5, behind[0], delta=0.6)
        self.assertAlmostEqual(17.4, behind[1], delta=0.6)

    def test_the_ninja_climbs_on_alone(self) -> None:
        runs = self.m["moves"]["ninja"]
        self.assertTrue(all("ninja-shoot" not in [ph for _, ph in r["you"]] for r in runs))
        # "You never land a round; in two of the nine they hit you, 2 and 3 times"
        self.assertTrue(all(r["hitsOnHim"] == 0 for r in runs))
        self.assertEqual([2, 3], sorted(r["hitsOnMe"] for r in runs if r["hitsOnMe"]))
        # "level off at 755 to 775 m, under the top of the sky, never slower than 55 m/s"
        lo, hi = span(r["yourTop"] for r in runs)
        self.assertTrue(753 <= lo and hi <= 775, (lo, hi))
        self.assertGreaterEqual(min(r["yourSlowAfter"] for r in runs), 55)


class TheWordsOnAJetTests(unittest.TestCase):
    def test_the_jet_file_is_laid_over_the_lesson(self) -> None:
        self.assertEqual("jet", jet_lesson(LESSON, demo="move")["era"])
        self.assertIsNone(jet_lesson(LESSON, demo="move", base=True)["era"])

    def test_the_words_are_plain_and_say_they(self) -> None:
        text = json.dumps(words())
        for word in (" he ", " him ", " his ", " He ", " His ", "himself"):
            self.assertNotIn(word, text)
        self.assertFalse(words()["note"].upper().startswith("ON A JET"))
        self.assertTrue(text.isascii())

    def test_the_survival_line_follows_from_the_moves(self) -> None:
        line = words()["survival"]["line"]
        self.assertIn("9 of 9", line)
        self.assertIn("(0 of 9)", line)
        self.assertIn("6 to 12 hits in seven of nine", line)
        self.assertIn("in four of nine", line)

    def test_no_word_from_a_roof_that_is_gone(self) -> None:
        # Before any roof your seat coasted on up to 1,150 to 1,590 m; under
        # the first one it was held nose up, slow, at 780 to 835 m.
        text = json.dumps(words())
        for gone in ("1,150", "1,290", "1,320", "1,590", "2.3 to 2.9 km", "1.85 to 1.96", "24 to 34", "30 to 53", "Level off"):
            self.assertNotIn(gone, text)

    def test_the_dip_steps_are_the_phases_flown(self) -> None:
        steps = [s["phase"] for s in words()["demos"]["dip"]["steps"]["steps"]]
        self.assertEqual(["chase", "dip-shot", "dip-pass", "dip-run"], steps)


class OnTheMig29Tests(unittest.TestCase):
    """The same fight on the MiG-29 (pace 1.5): the same lesson, its loop
    under 800 m too, and following them up is the Spitfire's trap again."""

    @classmethod
    def setUpClass(cls) -> None:
        cls.m = measure("Mig29")

    def test_the_mig_goes_up_and_over_the_same_way(self) -> None:
        for r in self.m["fights"]["move"] + self.m["fights"]["counter"]:
            self.assertGreaterEqual(r["climbSpeed"][0], 90.5)
            # The pull is out of the roof: up to 53 degrees, over at 551 m,
            # the top at 774 m 7.7 s in.
            self.assertAlmostEqual(53, r["pullPitch"], delta=1)
            self.assertAlmostEqual(550, r["overAt"][1], delta=5)
            self.assertTrue(772 <= r["top"][0] <= 777 and 7.5 <= r["top"][1] <= 8, r["top"])
            self.assertIsNotNone(r["pounceAt"])

    def test_following_up_you_hang_and_are_shot_down(self) -> None:
        move = self.m["fights"]["move"]
        self.assertTrue(all(r["yourHits"] == [] for r in move))
        hung = [r for r in move if "hang" in r["phases"]]
        self.assertEqual(7, len(hung))
        self.assertTrue(all(r["yourSlowestClimb"] < 27 for r in hung))
        runs = jet_lesson(LESSON, plane="Mig29", demo="move")["demos"]["move"]
        self.assertEqual(4, shot_down(runs, 1))
        self.assertEqual(0, shot_down(runs, 0))

    def test_following_shallow(self) -> None:
        counter = [len(r["yourHits"]) for r in self.m["fights"]["counter"]]
        self.assertEqual([8, 8, 11, 3, 3, 1, 1, 0, 1], counter)
        runs = jet_lesson(LESSON, plane="Mig29", demo="counter")["demos"]["counter"]
        self.assertEqual(1, shot_down(runs, 1))

    def test_the_moves(self) -> None:
        self.assertEqual({"dip": 9, "flip": 0, "ninja": 0}, {k: v["works"] for k, v in self.m["verdicts"].items()})
        dip = self.m["moves"]["dip"]
        self.assertTrue(all(r["hitsOnMe"] == 0 for r in dip))
        lo, hi = span(r["endRange"] for r in dip)
        self.assertTrue(3300 <= lo and hi <= 6200, (lo, hi))
        self.assertGreaterEqual(min(r["yourSlowAfter"] for r in dip), 90)


if __name__ == "__main__":
    unittest.main()
