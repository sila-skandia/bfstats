"""The flat scissors on a jet (`viewer/dogfight-jet-scissors.js`,
`viewer/dogfight-jet-plan-scissors.js`; features/dogfight-lessons-jets/scissors.md).

Every number the jet lesson's words make, on the published F-16. The
outcomes come from `jet_school` (the jet harness's nine starts, sideways by
speed). The shape of the braid, and the Dip, the Flip and the Ninja scored
as the school scores them (`dogfight-measure.js` `scoreMove` from its L9
`STARTS`, as `movesOn` does), come from `_measure` below, which loads the
same modules the jet harness loads. Distances and speeds are real (the
F-16's), not the Spitfire's units the plans read.
"""

from __future__ import annotations

import functools
import json
import shutil
import subprocess
import unittest
from pathlib import Path

from jet_school import jet_lesson, shot_down

TOOLS = Path(__file__).resolve().parents[1]

# The braid measured as `scissorsShape` in the school harness measures it
# (crossings across the fight's axis, each heading's swing off it, range,
# heights, speeds, who is ahead), over the jet harness's nine starts; and a
# demo's moves scored from the L9 starts with a few more numbers the words
# quote. `base` flies the lesson as written; `memory` changes the jet
# lesson's memories for one measurement.
_SCRIPT = r"""
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const [TOOLS, CONFIGS] = process.argv.slice(1);
const HERE = path.join(TOOLS, 'tests');
const { installModuleHooks, viewerDir } = await import(pathToFileURL(path.join(TOOLS, 'sim', 'env.mjs')).href);
const viewer = viewerDir(path.join(TOOLS, 'viewer'));
installModuleHooks(viewer);
const load = name => import(pathToFileURL(path.join(viewer, name)).href);
const THREE = await load('vendor/three.module.js');
const { Aircraft } = await load('aircraft.js');
const { runDuel } = await load('dogfight-duel.js');
const { LESSONS, lessonFor, demoSides } = await load('dogfight-lessons.js');
const { JET_LESSONS } = await load('dogfight-jets.js');
const { STARTS, nudge, scoreMove, verdictOf } = await load('dogfight-measure.js');
const { jetMaker } = await import(pathToFileURL(path.join(HERE, 'jet_airframes.mjs')).href);
const fixture = JSON.parse(readFileSync(path.join(HERE, 'fixtures', 'dc-jets.json'), 'utf8'));
const base = LESSONS.find(l => l.id === 'scissors');
const keep = JET_LESSONS.scissors;
const out = [];
for (const cfg of JSON.parse(CONFIGS)) {
  const makePlane = jetMaker(THREE, Aircraft, fixture, cfg.plane ?? 'F16');
  JET_LESSONS.scissors = keep;
  const L = cfg.base ? base : lessonFor(base, 'jet');
  // `memory` changes the jet lesson's memories for one measurement (the
  // merged copies `lessonFor` made, never the lesson's own).
  if (cfg.memory && !cfg.base) for (const side of ['ace', 'you']) L[side] = { ...L[side], memory: { ...L[side].memory, ...cfg.memory[side] } };
  const demo = L.demos.find(d => d.id === cfg.demo);
  const seconds = cfg.seconds ?? demo.seconds ?? L.seconds;
  const rows = [];
  if (cfg.kind === 'shape') {
    for (const dx of [-30, 0, 30]) for (const dv of [-3, 0, 3]) {
      const sides = demoSides(L, demo);
      sides[1] = { ...sides[1], start: { ...sides[1].start, at: [sides[1].start.at[0] + dx, sides[1].start.at[1], sides[1].start.at[2]], speed: sides[1].start.speed + dv } };
      const r = runDuel({ makePlane, seconds, groundAt: () => 0, sides });
      const [A, B] = r.tracks, n = Math.min(A.length, B.length);
      const crossings = []; let last = 0, maxRange = 0, closest = Infinity;
      const off = [0, 0], dy = [0, 0], minV = [Infinity, Infinity], shots = [0, 0], sumV = [0, 0];
      for (let j = 1; j < n; j++) {
        const t = j * r.dt;
        const sgn = Math.sign(B[j].p[0] - A[j].p[0]);
        if (t > 2 && sgn && last && sgn !== last) crossings.push(t);
        if (sgn) last = sgn;
        const R = Math.hypot(B[j].p[0] - A[j].p[0], B[j].p[1] - A[j].p[1], B[j].p[2] - A[j].p[2]);
        if (t > 2) { maxRange = Math.max(maxRange, R); closest = Math.min(closest, R); }
        for (const [i, T] of [[0, A], [1, B]]) {
          const hx = T[j].p[0] - T[j - 1].p[0], hz = T[j].p[2] - T[j - 1].p[2];
          off[i] = Math.max(off[i], Math.abs(Math.atan2(hx, -hz) * 180 / Math.PI));
          dy[i] = Math.max(dy[i], Math.abs(T[j].p[1] - T[0].p[1]));
          if (t > 3) minV[i] = Math.min(minV[i], T[j].v);
          if (t >= 5) sumV[i] += T[j].v;
          if (T[j].o) shots[i] += r.dt;
        }
      }
      const fromFive = n - Math.round(5 / r.dt);
      rows.push({ crossings: crossings.length, gaps: crossings.slice(1).map((t, i) => t - crossings[i]), off, dy, minV,
        meanV: sumV.map(s => s / fromFive), maxRange, closest, youAhead: A[n - 1].p[2] - B[n - 1].p[2],
        apart: Math.hypot(...A[n - 1].p.map((v, j) => v - B[n - 1].p[j])), shots, hits: r.hits, end: r.end });
    }
  } else {
    for (const st of STARTS) {
      const sides = demoSides(L, demo);
      sides[1] = { ...sides[1], start: nudge(sides[1].start, st) };
      const r = runDuel({ makePlane, seconds, groundAt: () => 0, sides });
      const s = scoreMove(r, demo.kind, 1);
      const [A, B] = r.tracks, n = Math.min(A.length, B.length), i0 = Math.round((s.t0 ?? 0) / r.dt);
      const mine = B.slice(i0 + 30, n), his = A.slice(i0 + 30, n);
      let crosses = 0, last = 0;
      for (let j = i0; j < n; j++) { const g = Math.sign(B[j].p[0] - A[j].p[0]); if (g && last && g !== last) crosses++; if (g) last = g; }
      rows.push({ ...s, hits: r.hits, endT: r.end?.t ?? null,
        myMin: Math.min(...mine.map(k => k.v)), myMean: mine.reduce((a, k) => a + k.v, 0) / mine.length,
        hisMean: his.reduce((a, k) => a + k.v, 0) / his.length,
        climbed: B[n - 1].p[1] - B[i0].p[1], over: B[n - 1].p[1] - A[n - 1].p[1], crosses,
        sepFrom12: Math.min(...B.slice(Math.round(12 / r.dt), n).map((k, j) => Math.hypot(...k.p.map((v, m) => v - A[j + Math.round(12 / r.dt)].p[m])))),
        sepTo12: Math.max(...B.slice(Math.round(12 / r.dt), n).map((k, j) => Math.hypot(...k.p.map((v, m) => v - A[j + Math.round(12 / r.dt)].p[m])))) });
    }
    rows.verdict = verdictOf(rows);
  }
  out.push({ rows, verdict: rows.verdict ?? null });
}
console.log(JSON.stringify(out));
"""


@functools.lru_cache(maxsize=None)
def _measure(*configs: str) -> list:
    """Each config (a JSON object) measured: `{"rows": [...], "verdict": ...}`."""
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    payload = "[" + ",".join(configs) + "]"
    proc = subprocess.run(["node", "--input-type=module", "-e", _SCRIPT, str(TOOLS), payload],
                          capture_output=True, text=True, timeout=900, cwd=TOOLS)
    if proc.returncode != 0:
        raise AssertionError(f"scissors measure failed:\n{proc.stderr[-3000:]}")
    return json.loads(proc.stdout)


def measure(**cfg) -> dict:
    return _measure(json.dumps(cfg, sort_keys=True))[0]


def span(values) -> tuple[float, float]:
    values = list(values)
    return min(values), max(values)


class TheBraidOnAJetTests(unittest.TestCase):
    """The scissors itself: both on the brakes, the reversals led by the lag."""

    @classmethod
    def setUpClass(cls) -> None:
        cls.rows = measure(kind="shape", demo="move")["rows"]

    def test_the_paths_braid_along_one_line(self) -> None:
        # The school's shape test, on the jet: crossings at a steady beat,
        # the headings swinging either side of the line and back, close and
        # flat. Its 250 m and 130 m are the Spitfire's size; on the F-16 the
        # braid stays inside 264 m and 62 m, its swing inside 74 degrees.
        for row in self.rows:
            self.assertGreaterEqual(row["crossings"], 8, row)
            self.assertTrue(all(4.4 <= g <= 6.2 for g in row["gaps"]), row)
            self.assertLessEqual(max(row["off"]), 75, row)
            self.assertLessEqual(row["maxRange"], 265, row)
            self.assertGreaterEqual(row["closest"], 20, row)
            self.assertLessEqual(max(row["dy"]), 65, row)
            self.assertGreaterEqual(min(row["minV"]), 34, row)

    def test_both_are_on_the_brakes_and_the_faster_drifts_ahead(self) -> None:
        # "they sit at about 47 m/s, you at 53"
        ace, you = span(r["meanV"][0] for r in self.rows), span(r["meanV"][1] for r in self.rows)
        self.assertTrue(46.5 <= ace[0] and ace[1] < 48.5, ace)
        self.assertTrue(52.5 <= you[0] and you[1] < 53.5, you)
        self.assertTrue(all(130 <= r["youAhead"] <= 160 for r in self.rows), [r["youAhead"] for r in self.rows])

    def test_the_slower_one_gets_the_only_shots(self) -> None:
        # "the slower pilot got the only shots, never more than 0.13 s"
        self.assertTrue(all(r["shots"][1] == 0 for r in self.rows))
        fired = [r["shots"][0] for r in self.rows if r["shots"][0] > 0]
        self.assertEqual(5, len(fired))
        self.assertLessEqual(max(fired), 0.14)
        # "one hit in 45 s, in 3 of 9"
        self.assertEqual(3, sum(1 for r in self.rows if r["hits"] == [1, 0]))
        self.assertTrue(all(r["hits"] in ([0, 0], [1, 0]) for r in self.rows))

    def test_it_is_nobodys_kill(self) -> None:
        runs = jet_lesson("scissors", demo="move")["demos"]["move"]
        self.assertTrue(all(r["winner"] is None for r in runs))
        self.assertEqual([0, 0, 0, 0, 0, 0, 1, 1, 1], [r["hits"][0] for r in runs])

    def test_the_jet_file_is_laid_over_the_lesson(self) -> None:
        self.assertEqual("jet", jet_lesson("scissors", demo="move")["era"])


class WhyTheBraidNeedsBothTests(unittest.TestCase):
    """What the jet does to the Spitfire's scissors, in the story's words."""

    def test_as_written_full_throttle_throws_you_out_in_front(self) -> None:
        # "you weave at 73 to 78 m/s to their 46 to 48 and are 260 to 500 m
        # out in front at 45 s"; and the swing past 100 degrees.
        rows = measure(kind="shape", demo="move", base=True)["rows"]
        ace, you = span(r["meanV"][0] for r in rows), span(r["meanV"][1] for r in rows)
        self.assertTrue(45.5 <= ace[0] and ace[1] < 48.5, ace)
        self.assertTrue(72.5 <= you[0] and you[1] < 78.5, you)
        ahead = span(r["youAhead"] for r in rows)
        self.assertTrue(255 <= ahead[0] and ahead[1] <= 505, ahead)
        self.assertTrue(all(104 <= max(r["off"]) <= 107 for r in rows))
        # Nobody's kill either way.
        base = jet_lesson("scissors", demo="move", base=True)["demos"]["move"]
        self.assertTrue(all(r["winner"] is None and r["hits"][0] <= 3 for r in base))

    def test_reversing_at_the_crossing_swings_past_100_degrees(self) -> None:
        # The jet lesson with the lead taken out: "the weave swings past 100
        # degrees off the line, the passes as close as 3 m".
        rows = measure(kind="shape", demo="move", memory={"ace": {"lead": 0}, "you": {"lead": 0}})["rows"]
        self.assertGreater(max(max(r["off"]) for r in rows), 100)
        self.assertLess(min(r["closest"] for r in rows), 4)


class TheMovesOnAJetTests(unittest.TestCase):
    """The Dip, the Flip and the Ninja, scored from the L9 starts."""

    def test_the_dip_is_shot_down_from_every_start(self) -> None:
        m = measure(kind="move", demo="dip")
        rows = m["rows"]
        self.assertEqual(0, m["verdict"]["works"])
        self.assertTrue(all(r["end"] == "shot down" and r["winner"] == 0 for r in rows))
        # "Out 8 to 9 s in ... shoot you down 15 to 17 s after you left"
        self.assertTrue(all(7.9 <= r["t0"] <= 9.1 for r in rows), [r["t0"] for r in rows])
        self.assertTrue(all(15 <= r["endT"] - r["t0"] <= 17 for r in rows), [r["endT"] - r["t0"] for r in rows])
        # "they sit 250 to 440 m behind you"
        self.assertGreaterEqual(min(r["sepFrom12"] for r in rows), 245)
        self.assertLessEqual(max(r["sepTo12"] for r in rows), 440)
        # And on the jet harness's nine starts too ("in all nine").
        runs = jet_lesson("scissors", demo="dip")["demos"]["dip"]
        self.assertEqual(9, shot_down(runs, 1))

    def test_no_other_way_out_did_better(self) -> None:
        # "Leaving at the first, third or fourth crossing, or diving steeper,
        # did no better (0 of 9)."
        for you in ({"dipAt": 1}, {"dipAt": 3}, {"dipAt": 4}, {"dipDive": -15}):
            m = measure(kind="move", demo="dip", memory={"you": you})
            self.assertEqual(0, m["verdict"]["works"], you)

    def test_the_flip_never_gets_behind_them(self) -> None:
        m = measure(kind="move", demo="flip")
        rows = m["rows"]
        self.assertEqual(0, m["verdict"]["works"])
        self.assertTrue(all(r["bestQuarter"] == 0 for r in rows))
        self.assertTrue(all(r["crosses"] == 3 for r in rows))
        # "you slow to 39 to 42 m/s against their 48 to 49"
        self.assertGreaterEqual(min(r["myMin"] for r in rows), 38.5)
        self.assertLess(max(r["myMean"] for r in rows), 42.5)
        his = span(r["hisMean"] for r in rows)
        self.assertTrue(47.5 <= his[0] and his[1] < 49.5, his)
        # "a snap of 0.2 to 0.27 s in 2 of 9"
        mine = [r["myShot"] for r in rows if r["myShot"] > 0]
        self.assertEqual(2, len(mine))
        self.assertTrue(all(0.19 <= s <= 0.28 for s in mine), mine)
        # "you sink 60 to 71 m, ending 30 to 53 m under them"
        sank = span(-r["climbed"] for r in rows)
        self.assertTrue(59.5 <= sank[0] and sank[1] < 71.5, sank)
        under = span(-r["over"] for r in rows)
        self.assertTrue(29.5 <= under[0] and under[1] < 53.5, under)
        # "They snap you as you cross (0.07 to 0.27 s, in 2 of 9) without a
        # hit, passing as close as 9 m."
        his_shots = [r["hisShot"] for r in rows if r["hisShot"] > 0]
        self.assertEqual(2, len(his_shots))
        self.assertTrue(all(0.06 <= s <= 0.28 for s in his_shots), his_shots)
        self.assertTrue(all(r["hitsOnMe"] == 0 for r in rows))
        self.assertEqual(9, min(r["minRange"] for r in rows))

    def test_the_ninja_wins_the_height_and_no_shot(self) -> None:
        m = measure(kind="move", demo="ninja")
        rows = m["rows"]
        self.assertEqual(0, m["verdict"]["works"])
        # "you climb 460 to 810 m in 20 s and are 250 to 410 m over them at
        # the end in 7 of 9"
        climbed = span(r["climbed"] for r in rows)
        self.assertTrue(455 <= climbed[0] and climbed[1] <= 810, climbed)
        high = [r["over"] for r in rows if r["over"] >= 245]
        self.assertEqual(7, len(high))
        self.assertLessEqual(max(high), 410)
        # "you never come down on them with a shot, and they never get one on you"
        self.assertTrue(all(r["myShot"] == 0 and r["hisShot"] == 0 and r["attacks"] == 0 for r in rows))
        # "Flown on to 40 and 60 s, there is still no attack in any of the nine."
        for seconds in (40, 60):
            longer = measure(kind="move", demo="ninja", seconds=seconds)["rows"]
            self.assertTrue(all(r["attacks"] == 0 for r in longer), seconds)

    def test_the_verdicts_on_screen_are_the_counts(self) -> None:
        jet = jet_lesson("scissors", demo="move")
        self.assertEqual("jet", jet["era"])
        for demo in ("dip", "flip", "ninja"):
            self.assertEqual(0, measure(kind="move", demo=demo)["verdict"]["works"], demo)


if __name__ == "__main__":
    unittest.main()
