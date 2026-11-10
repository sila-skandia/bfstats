"""Up and over on a jet (features/dogfight-lessons-jets/up-and-over.md).

The Spitfire's lesson rests on the follower running out of speed going up. A
jet does not, and neither does the jet's ace: they go over the top while the
air still holds them (`jetUpAndOver`, `jetUoAce`, `jetUoAceSharp` in
`viewer/dogfight-jet-plan-up-and-over.js`, over `dogfight-jet-ceiling.js`) and
come straight back down. The lesson's words (`viewer/dogfight-jet-up-and-over.js`)
say what that fight does, every number in them held here. The Dip is the shot
as they pull, then past them as they come back down and away (`jetUoDip`).
Every jet pilot flies under the roof (`stepPilot`, `underRoof`), so the
follower levels off under the top of the sky too; the ace opts its pull, its
loop and its recovery out of it (`roof: false`).

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
                           str(TOOLS / "viewer" / "dogfight-jet-up-and-over.js")],
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
            self.assertLess(r["acePeak"], 845, r["acePeak"])
        # Never slower than 76 m/s after its first top, but in one Dip start
        # (its zoom after the pass slows it to 45 m/s, and it noses down for
        # speed: the recovery, out of the roof) and one Flip start (65 m/s).
        slow = sorted(r["aceSlow"] for r in fights + moves)
        self.assertTrue(44 <= slow[0] < 46, slow[0])
        self.assertTrue(64.5 <= slow[1] < 66, slow[1])
        self.assertGreaterEqual(slow[2], 75.5)
        dip = sorted(r["aceSlow"] for r in measure("F16")["moves"]["dip"])
        self.assertEqual(slow[0], dip[0])

    def test_the_loop_and_the_top_on_the_mig29(self) -> None:
        fights, moves = self._all("Mig29")
        for r in fights:
            self.assertTrue(772 <= r["top"][0] <= 777, r["top"])
        for r in moves:
            self.assertTrue(772 <= r["aceTop"] <= 777, r["aceTop"])
        for r in fights + moves:
            self.assertLess(r["acePeak"], 855, r["acePeak"])
            self.assertGreaterEqual(r["aceSlow"], 57, r["aceSlow"])

    def test_nobody_tops_860_m(self) -> None:
        # The harness's own nine starts, every demo and move: the highest
        # either plane went, real metres. The F-16's 840 and the MiG-29's 852
        # are both planes levelled off by the roof, not the ace's loop.
        for plane, cap in (("F16", 845), ("Mig29", 855)):
            tops = jet_tops(plane, LESSON)[LESSON]
            self.assertEqual({"move", "counter", "dip", "flip", "ninja"}, set(tops))
            for demo, t in tops.items():
                self.assertLess(max(t["top"]), cap, (plane, demo, t))
                self.assertEqual([0, 0], t["past"], (plane, demo, t))

    def test_the_ace_opts_out_of_the_roof_only_where_it_means_to(self) -> None:
        # The pull, the loop (and its back half on their back), the recovery.
        src = (TOOLS / "viewer" / "dogfight-jet-plan-up-and-over.js").read_text()
        self.assertNotIn("underRoof(", src)
        self.assertEqual(4, src.count("roof: false }"))
        self.assertIn("const OVER_AT = 550;", src)

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
    """Story, third paragraph: following them up gets you nothing, and gives
    them a pass as they come over."""

    @classmethod
    def setUpClass(cls) -> None:
        cls.runs = measure()["fights"]["move"]

    def test_you_level_off_under_the_top_slow(self) -> None:
        # "49 to 58 m under them as they go over"
        lo, hi = span(r["underAtTop"] for r in self.runs)
        self.assertTrue(48.5 <= lo and hi <= 58.5, (lo, hi))
        # "you level off under the top of the sky, at 785 to 835 m"
        lo, hi = span(r["yourTop"] for r in self.runs)
        self.assertTrue(784 <= lo and hi <= 835.5, (lo, hi))
        # "down to 30 to 53 m/s"
        lo, hi = span(r["yourSlowestClimb"] for r in self.runs)
        self.assertTrue(29.5 <= lo and hi <= 53, (lo, hi))

    def test_they_get_a_pass_and_nobody_is_shot_down(self) -> None:
        # "they hit you once 9 s in from five of the nine starts (and once
        # more 33 s in, in one of them)"
        hit = [r["aceHits"] for r in self.runs if r["aceHits"]]
        self.assertEqual(5, len(hit))
        for h in hit:
            self.assertAlmostEqual(9.2, h[0], delta=0.2)
        self.assertEqual([1, 1, 1, 1, 2], sorted(len(h) for h in hit))
        self.assertAlmostEqual(33, max(h[-1] for h in hit), delta=0.5)
        # "the only round you landed, in two of the nine, was fired before
        # they pulled up"
        yours = [r["yourHits"] for r in self.runs if r["yourHits"]]
        self.assertEqual(2, len(yours))
        self.assertTrue(all(len(h) == 1 and h[0] < 1.5 for h in yours), yours)
        for r in self.runs:
            self.assertIsNone(r["winner"])
        runs = jet_lesson(LESSON, demo="move")["demos"]["move"]
        self.assertEqual(0, shot_down(runs, 0) + shot_down(runs, 1))
        self.assertEqual([1, 1, 0, 0, 0, 1, 1, 2, 0], [r["hits"][0] for r in runs])


class FollowingShallowOnAJetTests(unittest.TestCase):
    """Counter story: the shot is the pull, not the top."""

    @classmethod
    def setUpClass(cls) -> None:
        cls.runs = measure()["fights"]["counter"]

    def test_the_shot_comes_as_they_pull(self) -> None:
        pulled = [r for r in self.runs if any(t > r["pullAt"] for t in r["yourHits"])]
        self.assertEqual(7, len(pulled))
        for r in pulled:
            burst = [t for t in r["yourHits"] if 4.6 <= t <= 5.8]
            self.assertTrue(6 <= len(burst) <= 12, r["yourHits"])
            # "as their nose comes up through 62 to 65 degrees they fly through
            # your sight 390 to 430 m out"
            self.assertTrue(61.5 <= r["firstHit"]["hisPitch"] <= 65.5, r["firstHit"])
            self.assertTrue(385 <= r["firstHit"]["range"] <= 430, r["firstHit"])
            self.assertNotIn("shoot", r["phases"])
        # "in the other two, 30 m to the right and as fast or 3 m/s faster, it never came"
        missed = [(r["dx"], r["dv"]) for r in self.runs if r not in pulled]
        self.assertEqual([(30, 0), (30, 3)], missed)

    def test_their_guns_find_you_twice_and_one_burst_is_not_enough(self) -> None:
        # "Their guns found you twice in the nine: 3 hits 13 s in, and 1 hit 45 s in"
        hit = {(r["dx"], r["dv"]): r["aceHits"] for r in self.runs if r["aceHits"]}
        self.assertEqual({(30, -3), (30, 3)}, set(hit))
        self.assertEqual(3, len(hit[(30, 3)]))
        self.assertAlmostEqual(13.2, hit[(30, 3)][0], delta=0.2)
        self.assertEqual(1, len(hit[(30, -3)]))
        self.assertAlmostEqual(45, hit[(30, -3)][0], delta=0.3)
        for r in self.runs:
            self.assertIsNone(r["winner"])
        runs = jet_lesson(LESSON, demo="counter")["demos"]["counter"]
        self.assertEqual([13, 8, 8, 7, 7, 7, 8, 1, 1], [r["hits"][1] for r in runs])
        self.assertEqual(0, shot_down(runs, 0) + shot_down(runs, 1))

    def test_climb_on_and_you_level_off_at_830_m(self) -> None:
        # "climb on after them and you level off at about 830 m, under the top
        # of the sky, slow"
        lo, hi = span(r["yourTop"] for r in self.runs)
        self.assertTrue(825 <= lo and hi <= 835, (lo, hi))
        self.assertLess(max(r["yourSlowestClimb"] for r in self.runs), 42)


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
        let_go = []
        for r in runs:
            self.assertAlmostEqual(725, r["aceTop"], delta=3)
            self.assertEqual(["chase", "dip-shot", "dip-pass", "dip-run"], [ph for _, ph in r["you"]])
            passed = next(t for t, ph in r["you"] if ph == "dip-pass")
            self.assertAlmostEqual(9, passed, delta=0.4)
            # "the pass carries you up to about 780 m, where you level off
            # slow, 24 to 34 m/s"
            self.assertTrue(778 <= r["yourTop"] <= 785, r["yourTop"])
            self.assertTrue(24 <= r["yourSlowAfter"] <= 34.5, r["yourSlowAfter"])
            let_go.append(next(t for t, ph in r["ace"] if ph == "let-go"))
            # "at 35 s you are 1.85 to 1.96 km apart and opening"
            self.assertTrue(1850 <= r["endRange"] <= 1965 and r["opening"] > 0, r["endRange"])
        # "They turn round at you and let you go 17 to 18 s in (in one, after
        # chasing you for 7 s, 26 s in)"
        late = [t for t in let_go if t > 18]
        self.assertEqual(1, len(late))
        self.assertTrue(all(17 <= t <= 18 for t in let_go if t <= 18), let_go)
        chased = next(r for r in runs if any(ph == "chase" for _, ph in r["ace"]))
        chase = next(t for t, ph in chased["ace"] if ph == "chase")
        self.assertTrue(6.5 <= late[0] - chase <= 7.5 and 25.5 <= late[0] <= 26, (chase, late))

    def test_the_flip_is_flown_and_never_gets_behind_them_in_time(self) -> None:
        runs = self.m["moves"]["flip"]
        # "You slow to 54 m/s levelling off at 690 to 700 m, 9 s in"
        for r in runs:
            self.assertTrue(9.1 <= r["t0"] <= 9.5, r["t0"])
            self.assertTrue(690 <= r["yourHeightAt0"] <= 700, r["yourHeightAt0"])
        # "you get in behind them in only two of the nine, 23 to 27 s later"
        behind = [r["flipAt"] - r["t0"] for r in runs if r["flipAt"] is not None]
        self.assertEqual(2, len(behind))
        self.assertTrue(all(23 <= t <= 27 for t in behind), behind)

    def test_the_ninja_climbs_on_alone(self) -> None:
        runs = self.m["moves"]["ninja"]
        self.assertTrue(all("ninja-shoot" not in [ph for _, ph in r["you"]] for r in runs))
        # "You land a round in two of the nine; they never hit you"
        self.assertEqual([1, 1], [r["hitsOnHim"] for r in runs if r["hitsOnHim"]])
        self.assertTrue(all(r["hitsOnMe"] == 0 for r in runs))
        # "level off at about 830 m, under the top of the sky, slowing to 25 to 60 m/s"
        lo, hi = span(r["yourTop"] for r in runs)
        self.assertTrue(825 <= lo and hi <= 835, (lo, hi))
        lo, hi = span(r["yourSlowAfter"] for r in runs)
        self.assertTrue(24.5 <= lo and hi <= 60.5, (lo, hi))


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
        self.assertIn("in five of nine", line)

    def test_no_word_says_you_go_up_alone_past_the_roof(self) -> None:
        # Before the roof your seat coasted on up to 1,150 to 1,590 m.
        text = json.dumps(words())
        for gone in ("1,150", "1,290", "1,320", "1,590", "2.3 to 2.9 km"):
            self.assertNotIn(gone, text)

    def test_the_dip_steps_are_the_phases_flown(self) -> None:
        steps = [s["phase"] for s in words()["demos"]["dip"]["steps"]["steps"]]
        self.assertEqual(["chase", "dip-shot", "dip-pass", "dip-run"], steps)


class OnTheMig29Tests(unittest.TestCase):
    """The same fight on the MiG-29 (pace 1.5): the same lesson, its loop
    under 800 m too."""

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
            self.assertIsNone(r["winner"])

    def test_following_up_and_following_shallow(self) -> None:
        move = self.m["fights"]["move"]
        self.assertEqual(2, sum(1 for r in move if r["aceHits"]))
        self.assertTrue(all(r["yourHits"] == [] for r in move))
        counter = [len(r["yourHits"]) for r in self.m["fights"]["counter"]]
        self.assertEqual([8, 8, 11, 3, 3, 1, 1, 0, 1], counter)
        self.assertEqual(1, sum(1 for r in self.m["fights"]["counter"] if r["aceHits"]))

    def test_the_moves(self) -> None:
        self.assertEqual({"dip": 9, "flip": 0, "ninja": 0}, {k: v["works"] for k, v in self.m["verdicts"].items()})
        dip = self.m["moves"]["dip"]
        self.assertTrue(all(r["hitsOnMe"] == 0 for r in dip))
        lo, hi = span(r["endRange"] for r in dip)
        self.assertTrue(2050 <= lo and hi <= 3750, (lo, hi))
        # Your own seat stays faster on the MiG-29: 60 m/s or more in the Dip.
        self.assertGreaterEqual(min(r["yourSlowAfter"] for r in dip), 60)


if __name__ == "__main__":
    unittest.main()
