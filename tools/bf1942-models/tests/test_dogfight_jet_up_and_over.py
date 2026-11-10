"""Up and over on a jet (features/dogfight-lessons-jets/up-and-over.md).

The Spitfire's lesson rests on the follower running out of speed going up. A
jet does not: the fight is flown as written on the F-16 and the lesson's words
(`viewer/dogfight-jet-up-and-over.js`) say what it does, every number in them
held here. The Dip is re-flown as the shot as they pull, then straight on under
them (`jetUoDip`, `viewer/dogfight-jet-plan-up-and-over.js`).

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

from jet_school import jet_lesson, shot_down

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
    const top = A.reduce((b, k, i) => (k.p[1] > A[b].p[1] ? i : b), 0);
    const climb = A.slice(0, top).filter(k => pitch(k) > 60);
    const pull = A.filter(k => k.ph === 'pull');
    const at1000 = A.find(k => k.p[1] >= 1000);
    const back = A.find((k, i) => i > top && k.p[1] < 700);
    const yours = hitTimes(r, 1), first = yours.length ? Math.round(yours[0] / r.dt) : null;
    return {
      dx, dv, hits: r.hits, winner: r.end?.winner ?? null, aceHits: hitTimes(r, 0), yourHits: yours,
      pullAt: pull[0].t, pullPitch: Math.max(...pull.map(pitch)),
      climbSpeed: [Math.min(...climb.map(k => k.v)), Math.max(...climb.map(k => k.v))],
      at1000: [at1000.t, at1000.v], top: [A[top].p[1], A[top].t], backUnder700: back ? back.t : null,
      yourTop: Math.max(...B.map(k => k.p[1])), underAtTop: A[top].p[1] - B[top].p[1],
      yourSlowestClimb: Math.min(...B.slice(0, Math.round(20 / r.dt)).map(k => k.v)),
      firstHit: first === null ? null : { range: sep(A, B, first), hisPitch: pitch(A[first]), myPitch: pitch(B[first]) },
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
    return { ...s, yourHeightAt0: B[i0].p[1], aceTop: Math.max(...A.map(k => k.p[1])),
             aceTopAt: A.reduce((b, k) => (k.p[1] > b.p[1] ? k : b)).t,
             yourHitsAfter: hitTimes(r, 1).filter(t => t >= s.t0), ace: ev(0), you: ev(1) };
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


class TheClimbOnAJetTests(unittest.TestCase):
    """Story, second paragraph: a jet does not run out of speed going up."""

    @classmethod
    def setUpClass(cls) -> None:
        cls.runs = measure()["fights"]["move"] + measure()["fights"]["counter"]

    def test_they_keep_their_speed_all_the_way_up(self) -> None:
        for r in self.runs:
            self.assertAlmostEqual(1.5, r["pullAt"], delta=0.05)
            self.assertAlmostEqual(76, r["pullPitch"], delta=0.5)
            # "never drops below 77 m/s", "88 m/s when it reaches 1,000 m, 10 s after the pull"
            self.assertGreaterEqual(r["climbSpeed"][0], 76.5)
            self.assertAlmostEqual(88, r["at1000"][1], delta=0.5)
            self.assertAlmostEqual(10, r["at1000"][0] - r["pullAt"], delta=0.5)

    def test_the_air_runs_out_at_a_thousand_metres(self) -> None:
        # "in BF1942 a wing makes half its lift at 500 m and none at all at 1,000 m"
        src = (TOOLS / "viewer" / "aircraft.js").read_text()
        self.assertIn("const AIR_DENSITY_ZERO_AT_HEIGHT = 1000;", src)
        self.assertIn("return 1 - clamp(y / AIR_DENSITY_ZERO_AT_HEIGHT, 0, 1);", src)

    def test_they_go_on_up_and_take_eleven_seconds_to_fall_back(self) -> None:
        for r in self.runs:
            # "They go on up to 1,180 m ... and take 11 s to fall back under 700 m."
            self.assertAlmostEqual(1180, r["top"][0], delta=5)
            self.assertAlmostEqual(11, r["backUnder700"] - r["top"][1], delta=0.5)


class FollowingThemUpOnAJetTests(unittest.TestCase):
    """Story, third paragraph: following them up gets nobody anything."""

    @classmethod
    def setUpClass(cls) -> None:
        cls.runs = measure()["fights"]["move"]

    def test_you_do_not_hang_and_go_on_up_after_them(self) -> None:
        lo, hi = span(r["underAtTop"] for r in self.runs)
        self.assertGreaterEqual(lo, 92.5)
        self.assertLessEqual(hi, 110.5)
        self.assertGreaterEqual(min(r["yourSlowestClimb"] for r in self.runs), 39.5)
        lo, hi = span(r["yourTop"] for r in self.runs)
        self.assertGreaterEqual(lo, 1110)
        self.assertLessEqual(hi, 1265)

    def test_nobody_lands_a_round_on_the_climb(self) -> None:
        for r in self.runs:
            self.assertIsNone(r["winner"])
            self.assertEqual([], r["aceHits"])
            # Two starts land one round in the opening chase, before the pull.
            self.assertTrue(all(t < r["pullAt"] for t in r["yourHits"]), r["yourHits"])
        runs = jet_lesson(LESSON, demo="move")["demos"]["move"]
        self.assertEqual([[0, 0]] * 7 + [[0, 1]] * 2, [r["hits"] for r in runs])
        # Flown as written: the jet file changes only its words, and the
        # follower never hangs.
        self.assertTrue(all("hang" not in r["phases"][1] for r in runs))
        self.assertEqual(runs, jet_lesson(LESSON, demo="move", base=True)["demos"]["move"])


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
            # The follower never takes the "shoot as they hang" phase: they never slow.
            self.assertNotIn("shoot", r["phases"])
        # "in the other two, 30 m to the right and as fast or 3 m/s faster, it never came"
        missed = [(r["dx"], r["dv"]) for r in self.runs if r not in pulled]
        self.assertEqual([(30, 0), (30, 3)], missed)

    def test_their_guns_never_touch_you_and_one_burst_is_not_enough(self) -> None:
        for r in self.runs:
            self.assertEqual([], r["aceHits"])
            self.assertIsNone(r["winner"])
        runs = jet_lesson(LESSON, demo="counter")["demos"]["counter"]
        self.assertEqual([12, 8, 8, 7, 7, 7, 6, 1, 1], [r["hits"][1] for r in runs])
        self.assertEqual(0, shot_down(runs, 0))

    def test_keep_after_them_and_you_follow_them_up_too(self) -> None:
        # "to 1,110 to 1,240 m"
        lo, hi = span(r["yourTop"] for r in self.runs)
        self.assertGreaterEqual(lo, 1110)
        self.assertLessEqual(hi, 1242)


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

    def test_the_dip_shoots_then_runs_on_under_them(self) -> None:
        runs = self.m["moves"]["dip"]
        self.assertTrue(all(r["ok"] and r["hitsOnMe"] == 0 for r in runs))
        hits = [len(r["yourHitsAfter"]) for r in runs]
        self.assertEqual(10, max(hits))
        self.assertEqual(1, hits.count(0))
        for r in runs:
            self.assertAlmostEqual(1180, r["aceTop"], delta=5)
            self.assertAlmostEqual(14.7, r["aceTopAt"], delta=0.3)
            chase = next(t for t, ph in r["ace"] if ph == "chase")
            let_go = next(t for t, ph in r["ace"] if ph == "let-go")
            self.assertAlmostEqual(6, let_go - chase, delta=0.3)
            self.assertAlmostEqual(20.7, let_go, delta=0.05)
            self.assertTrue(1900 <= r["endRange"] <= 2100 and r["opening"] > 0, r["endRange"])
            self.assertEqual(["chase", "dip-shot", "dip-run"], [ph for _, ph in r["you"]])

    def test_the_flip_comes_late_and_high(self) -> None:
        runs = self.m["moves"]["flip"]
        lo, hi = span(r["t0"] for r in runs)
        self.assertGreaterEqual(lo, 16.5)
        self.assertLessEqual(hi, 22.5)
        lo, hi = span(r["yourHeightAt0"] for r in runs)
        self.assertGreaterEqual(lo, 1075)
        self.assertLessEqual(hi, 1290)
        self.assertLessEqual(max(r["bestQuarter"] for r in runs), 0.95)
        self.assertTrue(all(r["hitsOnMe"] == 0 and r["yourHitsAfter"] == [] for r in runs))

    def test_the_ninja_never_gets_its_shot_over_the_top(self) -> None:
        runs = self.m["moves"]["ninja"]
        self.assertTrue(all(r["hitsOnMe"] == 0 for r in runs))
        self.assertTrue(all("ninja-shoot" not in [ph for _, ph in r["you"]] for r in runs))
        self.assertEqual(2, sum(1 for r in runs if r["attacks"] >= 1))
        landed = [r["yourHitsAfter"] for r in runs if r["yourHitsAfter"]]
        self.assertEqual(1, len(landed))
        self.assertEqual(3, len(landed[0]))
        self.assertAlmostEqual(48.7, landed[0][0], delta=0.1)
        self.assertEqual(8, sum(1 for r in runs if "leave" in [ph for _, ph in r["you"]]))


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


class OnTheMig29Tests(unittest.TestCase):
    """The same fight on the MiG-29 (pace 1.5): the same lesson."""

    def test_the_mig_goes_up_the_same_way(self) -> None:
        m = measure("Mig29")
        for r in m["fights"]["move"]:
            self.assertEqual([], r["aceHits"])
            self.assertEqual([], r["yourHits"])
            self.assertGreaterEqual(r["climbSpeed"][0], 97)
            self.assertGreater(r["top"][0], 1250)
        counter = [len(r["yourHits"]) for r in m["fights"]["counter"]]
        self.assertTrue(all(1 <= n <= 11 for n in counter), counter)
        self.assertEqual({"dip": 9, "flip": 0, "ninja": 0}, {k: v["works"] for k, v in m["verdicts"].items()})


if __name__ == "__main__":
    unittest.main()
