"""When they have the height, on a jet (`viewer/dogfight-jet-under-the-height.js`,
features/dogfight-lessons-jets/under-the-height.md).

The fights are the lesson's own; the jet file rewrites the words, because on
the F-16 a straight climb under a diver is not the trap it is on a Spitfire.
Every number the jet words make is held here, from the nine starts the
harness flies (`jet_lesson`, three sideways by three speeds) and, for the
Dip, the Flip and the Ninja, from the school's nine starts scored as the
school scores them (`dogfight-measure.js` `STARTS`, `scoreMove`).
"""

from __future__ import annotations

import functools
import json
import re
import shutil
import subprocess
import unittest
from pathlib import Path

from jet_school import jet_lesson, shot_down

TOOLS = Path(__file__).resolve().parent.parent
JET_FILE = TOOLS / "viewer" / "dogfight-jet-under-the-height.js"

# What the harness's summaries do not carry: each fight's timeline read for
# the words' numbers (when you reach their height and their energy, the top
# of the sky, the breaks), and the three moves scored on the jet.
_SCRIPT = r"""
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const [TOOLS, PLANE] = process.argv.slice(1);
const T = path.join(TOOLS, 'tests');
const { installModuleHooks, viewerDir } = await import(pathToFileURL(path.join(TOOLS, 'sim', 'env.mjs')).href);
const viewer = viewerDir(path.join(TOOLS, 'viewer'));
installModuleHooks(viewer);
const load = n => import(pathToFileURL(path.join(viewer, n)).href);
const THREE = await load('vendor/three.module.js');
const { Aircraft } = await load('aircraft.js');
const { runDuel } = await load('dogfight-duel.js');
const { LESSONS, lessonFor, demoSides } = await load('dogfight-lessons.js');
const { STARTS: L9, nudge, scoreMove } = await load('dogfight-measure.js');
const { jetMaker } = await import(pathToFileURL(path.join(T, 'jet_airframes.mjs')).href);
const fixture = JSON.parse(readFileSync(path.join(T, 'fixtures', 'dc-jets.json'), 'utf8'));
const makePlane = jetMaker(THREE, Aircraft, fixture, PLANE);
const L = lessonFor(LESSONS.find(l => l.id === 'under-the-height'), 'jet');
const sep = (a, b) => Math.hypot(a.p[0] - b.p[0], a.p[1] - b.p[1], a.p[2] - b.p[2]);
const r1 = v => Math.round(v * 10) / 10;
const out = { era: L.era ?? null, demos: {}, moves: {} };
for (const id of ['move', 'flat', 'counter']) {
  const demo = L.demos.find(d => d.id === id);
  out.demos[id] = [];
  for (const dx of [-30, 0, 30]) for (const dv of [-3, 0, 3]) {
    const sides = demoSides(L, demo);
    const s = sides[1].start;
    sides[1] = { ...sides[1], start: { ...s, at: [s.at[0] + dx, s.at[1], s.at[2]], speed: s.speed + dv } };
    const r = runDuel({ makePlane, seconds: L.seconds, groundAt: () => 0, sides });
    const [A, B] = r.tracks, n = Math.min(A.length, B.length), last = n - 1;
    const first = i => (i >= 0 ? r1(A[i].t) : null);
    let closest = Infinity, maxLead = -Infinity, maxLeadT = 0, acePeak = 0, aceSlow = Infinity;
    for (let i = 0; i < n; i++) {
      closest = Math.min(closest, sep(A[i], B[i]));
      if (B[i].e - A[i].e > maxLead) { maxLead = B[i].e - A[i].e; maxLeadT = A[i].t; }
      acePeak = Math.max(acePeak, A[i].p[1]);
      if (A[i].t > 15) aceSlow = Math.min(aceSlow, A[i].v);
    }
    // The first time you reach the top of the sky (990 m), and how far you fall in the 8 s after.
    const top = B.findIndex(k => k.p[1] >= 990);
    const fall = top < 0 ? 0 : B[top].p[1] - Math.min(...B.slice(top, top + Math.round(8 / r.dt)).map(k => k.p[1]));
    const breaks = r.events.filter(e => e.side === 1 && e.phase === 'break').map(e => Math.round(e.t / r.dt));
    out.demos[id].push({
      hits: r.hits, aceFired: A.some(k => k.f), closest: Math.round(closest),
      startSep: Math.round(sep(A[0], B[0])), startAbove: Math.round(A[0].p[1] - B[0].p[1]),
      aceTopSpeed: Math.round(Math.max(...A.slice(0, Math.round(12 / r.dt)).map(k => k.v))),
      speedAtTop: top < 0 ? null : Math.round(B[top].v),
      levelT: first(B.findIndex((k, i) => k.p[1] >= A[i].p[1])), evenT: first(B.findIndex((k, i) => k.e >= A[i].e)),
      maxLead: Math.round(maxLead), maxLeadT: r1(maxLeadT), topT: first(top), fall: Math.round(fall),
      peak: Math.round(Math.max(...B.map(k => k.p[1]))),
      height: [Math.round(A[last].p[1]), Math.round(B[last].p[1])], speed: [Math.round(A[last].v), Math.round(B[last].v)],
      lead: Math.round(B[last].e - A[last].e), climbed: Math.round(B[last].p[1] - B[0].p[1]),
      dives: r.events.filter(e => e.side === 0 && e.phase === 'dive').length,
      breaks: breaks.map(i => Math.round(sep(A[i], B[i]))), acePeak: Math.round(acePeak), aceSlow: Math.round(aceSlow),
    });
  }
}
for (const demo of L.demos.filter(d => d.kind)) {
  out.moves[demo.id] = L9.map(st => {
    const sides = demoSides(L, demo);
    sides[1] = { ...sides[1], start: nudge(sides[1].start, st) };
    const r = runDuel({ makePlane, seconds: demo.seconds ?? L.seconds, groundAt: () => 0, sides });
    const s = scoreMove(r, demo.kind, 1);
    const [A, B] = r.tracks;
    const at = ph => { const k = A.find(x => x.ph === ph); return k ? r1(k.t) : null; };
    return { ok: s.ok, t0: s.t0 === null ? null : r1(s.t0), hits: r.hits, aceFired: A.some(k => k.f),
      endRange: s.endRange ?? null, endSpeed: s.endSpeed ?? null, myShot: s.myShot ?? null, sixLost: s.sixLost ?? null,
      flipped: B.some(k => k.ph === 'flip-reverse'), handed: (() => { const k = B.find(x => x.ph === 'find'); return k ? r1(k.t) : null; })(),
      evade: at('evade'), letGo: at('let-go') };
  });
}
console.log(JSON.stringify(out));
"""


@functools.lru_cache(maxsize=None)
def flights(plane: str = "F16") -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    proc = subprocess.run(["node", "--input-type=module", "-e", _SCRIPT, str(TOOLS), plane],
                          capture_output=True, text=True, timeout=900)
    if proc.returncode != 0:
        raise AssertionError(f"under-the-height jet flights failed:\n{proc.stderr[-3000:]}")
    return json.loads(proc.stdout)


def span(runs: list[dict], key: str) -> tuple:
    vals = [r[key] for r in runs]
    return min(vals), max(vals)


class StraightClimbTests(unittest.TestCase):
    """You climb straight: on a jet not the trap, until the top of the sky."""

    @classmethod
    def setUpClass(cls) -> None:
        cls.runs = flights()["demos"]["move"]
        cls.summary = jet_lesson("under-the-height", demo="move")["demos"]["move"]

    def test_the_jet_file_is_laid_over_the_lesson(self) -> None:
        self.assertEqual("jet", flights()["era"])
        self.assertEqual("jet", jet_lesson("under-the-height", demo="move")["era"])

    def test_the_fight_starts_670_m_under_them_and_1_1_km_apart(self) -> None:
        for r in self.runs:
            self.assertTrue(660 <= r["startAbove"] <= 680, r["startAbove"])
            self.assertTrue(1050 <= r["startSep"] <= 1150, r["startSep"])

    def test_the_diver_never_gets_inside_410_m_and_never_fires(self) -> None:
        self.assertEqual(0, shot_down(self.summary, 1))
        self.assertTrue(all(r["hits"] == [0, 0] and r["winner"] is None for r in self.summary))
        self.assertTrue(all(not r["aceFired"] for r in self.runs))
        lo, hi = span(self.runs, "closest")
        self.assertTrue(410 <= lo and hi <= 445, (lo, hi))
        # Their dive at 120 to 130 m/s; you over 120 m/s by the top.
        self.assertTrue(all(120 <= r["aceTopSpeed"] <= 132 for r in self.runs), [r["aceTopSpeed"] for r in self.runs])
        self.assertTrue(all(r["speedAtTop"] > 120 for r in self.runs), [r["speedAtTop"] for r in self.runs])

    def test_at_their_height_in_11_s_their_energy_at_21_and_630_m_more_at_35(self) -> None:
        self.assertTrue(all(10.5 <= r["levelT"] <= 11.2 for r in self.runs), [r["levelT"] for r in self.runs])
        self.assertTrue(all(21 <= r["evenT"] <= 21.6 for r in self.runs), [r["evenT"] for r in self.runs])
        self.assertTrue(all(620 <= r["maxLead"] <= 640 and 34 <= r["maxLeadT"] <= 36 for r in self.runs))

    def test_the_top_of_the_sky_drops_you_330_m_at_21_s(self) -> None:
        self.assertTrue(all(20.5 <= r["topT"] <= 21.2 for r in self.runs), [r["topT"] for r in self.runs])
        self.assertTrue(all(325 <= r["fall"] <= 340 for r in self.runs), [r["fall"] for r in self.runs])
        self.assertTrue(all(r["peak"] < 1040 for r in self.runs))

    def test_at_55_s_slow_and_under_them_with_the_energy_thrown_away(self) -> None:
        for r in self.runs:
            ace_y, you_y = r["height"]
            self.assertTrue(680 <= you_y <= 700, r["height"])
            self.assertTrue(31 <= r["speed"][1] <= 44, r["speed"])
            self.assertTrue(275 <= ace_y - you_y <= 305, r["height"])
            self.assertTrue(-885 <= r["lead"] <= -840, r["lead"])


class FlatTurnTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.runs = flights()["demos"]["flat"]

    def test_safe_three_dives_and_no_fire(self) -> None:
        self.assertTrue(all(r["hits"] == [0, 0] and not r["aceFired"] and r["dives"] == 3 for r in self.runs))

    def test_it_buys_nothing(self) -> None:
        for r in self.runs:
            self.assertTrue(125 <= r["climbed"] <= 128, r["climbed"])
            self.assertEqual(83, r["speed"][1])
            self.assertTrue(-620 <= r["lead"] <= -407, r["lead"])


class ClimbBetweenTests(unittest.TestCase):
    """The counter holds on a jet: never fired at, and well ahead at the end."""

    @classmethod
    def setUpClass(cls) -> None:
        cls.runs = flights()["demos"]["counter"]
        cls.summary = jet_lesson("under-the-height", demo="counter")["demos"]["counter"]

    def test_never_fired_at(self) -> None:
        self.assertTrue(all(r["hits"] == [0, 0] and r["winner"] is None for r in self.summary))
        self.assertTrue(all(not r["aceFired"] for r in self.runs))

    def test_the_break_comes_at_about_490_m(self) -> None:
        for r in self.runs:
            self.assertTrue(2 <= len(r["breaks"]) <= 3, r["breaks"])
            self.assertTrue(475 <= r["breaks"][0] <= 495, r["breaks"])

    def test_your_climb_stays_under_the_top_and_theirs_goes_over_it(self) -> None:
        for r in self.runs:
            self.assertLess(r["peak"], 1000)
            self.assertTrue(1050 <= r["acePeak"] <= 1150, r["acePeak"])
            self.assertTrue(15 <= r["aceSlow"] <= 34, r["aceSlow"])

    def test_it_climbs_680_to_730_m_and_finishes_well_ahead(self) -> None:
        for r in self.runs:
            ace_y, you_y = r["height"]
            self.assertTrue(680 <= r["climbed"] <= 735, r["climbed"])
            self.assertTrue(910 <= you_y <= 965 and 130 <= r["speed"][1] <= 143, (r["height"], r["speed"]))
            self.assertTrue(970 <= r["lead"] <= 1360, r["lead"])
            self.assertTrue(240 <= ace_y <= 640, r["height"])


class MovesTests(unittest.TestCase):
    """The Dip, the Flip and the Ninja on the F-16, and their jet verdicts."""

    @classmethod
    def setUpClass(cls) -> None:
        cls.moves = flights()["moves"]
        text = JET_FILE.read_text()
        cls.verdicts = {m.group(1): (int(m.group(2)), int(m.group(3)))
                        for m in re.finditer(r"(\w+): \{\s*note: '[^']*',\s*verdict: \{ works: (\d+), of: (\d+)", text)}

    def test_each_verdict_is_the_count_flown(self) -> None:
        self.assertEqual({"dip", "flip", "ninja"}, set(self.verdicts))
        for demo, (works, of) in self.verdicts.items():
            runs = self.moves[demo]
            self.assertEqual((works, of), (sum(r["ok"] for r in runs), len(runs)), demo)

    def test_the_dip_gets_clear_every_time(self) -> None:
        runs = self.moves["dip"]
        self.assertTrue(all(r["ok"] and r["hits"] == [0, 0] and not r["aceFired"] for r in runs))
        self.assertTrue(all(26.5 <= r["t0"] <= 38.5 for r in runs), [r["t0"] for r in runs])
        self.assertTrue(all(r["letGo"] is not None and 35.5 <= r["letGo"] <= 54 for r in runs), [r["letGo"] for r in runs])
        self.assertTrue(all(3700 <= r["endRange"] <= 7500 and 127 <= r["endSpeed"] <= 131 for r in runs))

    def test_the_flip_never_finds_a_tail_to_reverse_onto(self) -> None:
        runs = self.moves["flip"]
        self.assertTrue(all(not r["flipped"] and not r["aceFired"] and r["hits"] == [0, 0] for r in runs))
        behind = [r["evade"] for r in runs if r["evade"] is not None]
        self.assertEqual(5, len(behind))
        self.assertTrue(all(29.5 <= t <= 38.5 for t in behind), behind)

    def test_the_ninja_wins_the_energy_but_not_the_shot(self) -> None:
        runs = self.moves["ninja"]
        self.assertTrue(all(not r["aceFired"] and r["hits"][0] == 0 for r in runs))
        handed = [r["handed"] for r in runs if r["handed"] is not None]
        self.assertEqual(8, len(handed))
        self.assertTrue(all(29 <= t <= 58.5 for t in handed), handed)
        shots = [r["myShot"] for r in runs if r["myShot"] > 0]
        self.assertEqual(4, len(shots))
        self.assertLessEqual(max(shots), 0.5)
        self.assertEqual([1, 2], sorted(r["hits"][1] for r in runs if r["hits"][1]))
        tails = [r["sixLost"] for r in runs if r["sixLost"] >= 1]
        self.assertEqual(4, len(tails))
        self.assertTrue(all(1 <= t <= 11 for t in tails), tails)


if __name__ == "__main__":
    unittest.main()
