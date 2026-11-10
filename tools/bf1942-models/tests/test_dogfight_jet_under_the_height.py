"""When they have the height, on a jet (`viewer/dogfight-jet-under-the-height.js`,
features/dogfight-lessons-jets/under-the-height.md).

The fights are the lesson's starts and seats against the jet's ace, the same
boom-and-zoomer levelling off under the top of the sky (`jetBoomAndZoom`,
`jetUhAce`, `viewer/dogfight-jet-plan-under-the-height.js`); the jet file
rewrites the words, because on the F-16 a straight climb under a diver is not
the trap it is on a Spitfire.
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
// The ace once off the perch it starts on (896 m on the F-16, 900 on the
// MiG-29): the highest it goes and its slowest from 5 s on, and when it dives.
const aceOf = (A, r) => {
  const off = A.filter(k => k.t >= 5);
  return { aceStart: Math.round(A[0].p[1]), aceRoof: Math.round(Math.max(...off.map(k => k.p[1]))),
           aceSlowest: Math.round(Math.min(...off.map(k => k.v))),
           diveTimes: r.events.filter(e => e.side === 0 && e.phase === 'dive').map(e => r1(e.t)) };
};
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
      // After the top of the sky: how low and how slow you go.
      youLow: top < 0 ? null : Math.round(Math.min(...B.slice(top).map(k => k.p[1]))),
      youSlow: top < 0 ? null : Math.round(Math.min(...B.slice(top).map(k => k.v))),
      ...aceOf(A, r),
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
      evade: at('evade'), letGo: at('let-go'), ...aceOf(A, r) };
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


class TheJetAceTests(unittest.TestCase):
    """The diver respects the top of the sky: from 5 s on (off the perch it
    starts on, 896 m on the F-16, 900 on the MiG-29) it never climbs over
    916 m, under the 1,000 m where a wing stops lifting, and never slows under
    80 m/s, from every start of every demo."""

    def _all(self, plane: str):
        f = flights(plane)
        return [r for d in f["demos"].values() for r in d] + [r for d in f["moves"].values() for r in d]

    def test_the_lesson_flies_the_jet_aces(self) -> None:
        text = JET_FILE.read_text()
        self.assertIn("ace: { plan: 'jetBoomAndZoom' }", text)
        self.assertIn("flyAce: 'jetUhAce'", text)
        self.assertEqual(3, text.count("ace: 'jetUhAce'"))

    def test_never_over_the_perch_and_never_slow_on_the_f16(self) -> None:
        for r in self._all("F16"):
            self.assertEqual(896, r["aceStart"])
            self.assertLessEqual(r["aceRoof"], 896, r["aceRoof"])
            self.assertGreaterEqual(r["aceSlowest"], 80, r["aceSlowest"])

    def test_never_over_the_perch_and_never_slow_on_the_mig29(self) -> None:
        for r in self._all("Mig29"):
            self.assertEqual(900, r["aceStart"])
            self.assertLessEqual(r["aceRoof"], 916, r["aceRoof"])
            self.assertGreaterEqual(r["aceSlowest"], 85, r["aceSlowest"])


class StraightClimbTests(unittest.TestCase):
    """You climb straight: on a jet not the trap, levelled off under the top."""

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

    def test_the_diver_never_gets_inside_280_m_and_never_fires(self) -> None:
        self.assertEqual(0, shot_down(self.summary, 1))
        self.assertTrue(all(r["hits"] == [0, 0] and r["winner"] is None for r in self.summary))
        self.assertTrue(all(not r["aceFired"] for r in self.runs))
        lo, hi = span(self.runs, "closest")
        self.assertTrue(280 <= lo and hi <= 322, (lo, hi))
        # Their dive at 120 to 130 m/s.
        self.assertTrue(all(120 <= r["aceTopSpeed"] <= 132 for r in self.runs), [r["aceTopSpeed"] for r in self.runs])

    def test_at_their_height_in_11_s_and_their_energy_at_16(self) -> None:
        self.assertTrue(all(10.5 <= r["levelT"] <= 11.2 for r in self.runs), [r["levelT"] for r in self.runs])
        self.assertTrue(all(15.5 <= r["evenT"] <= 16.5 for r in self.runs), [r["evenT"] for r in self.runs])

    def test_you_level_off_at_950_m_short_of_the_top(self) -> None:
        # Never into the top of the sky (990 m), so never a fall out of it.
        self.assertTrue(all(r["topT"] is None and r["fall"] == 0 for r in self.runs))
        lo, hi = span(self.runs, "peak")
        self.assertTrue(945 <= lo and hi <= 950, (lo, hi))
        for r in self.runs:
            self.assertTrue(905 <= r["height"][1] <= 950 and 132 <= r["speed"][1] <= 138, (r["height"], r["speed"]))

    def test_they_level_off_at_870_and_never_dive_again(self) -> None:
        lo, hi = span(self.runs, "aceRoof")
        self.assertTrue(868 <= lo and hi <= 872, (lo, hi))
        self.assertGreaterEqual(min(r["aceSlowest"] for r in self.runs), 104)
        self.assertTrue(all(r["diveTimes"] == [0] for r in self.runs))
        lo, hi = span(self.runs, "lead")
        self.assertTrue(99 <= lo and hi <= 180, (lo, hi))


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
            self.assertTrue(-490 <= r["lead"] <= -390, r["lead"])


class ClimbBetweenTests(unittest.TestCase):
    """The counter holds on a jet: never fired at, and over their roof at the end."""

    @classmethod
    def setUpClass(cls) -> None:
        cls.runs = flights()["demos"]["counter"]
        cls.summary = jet_lesson("under-the-height", demo="counter")["demos"]["counter"]

    def test_never_fired_at(self) -> None:
        self.assertTrue(all(r["hits"] == [0, 0] and r["winner"] is None for r in self.summary))
        self.assertTrue(all(not r["aceFired"] for r in self.runs))

    def test_one_dive_broken_at_about_485_m(self) -> None:
        for r in self.runs:
            self.assertEqual(1, r["dives"])
            self.assertEqual(1, len(r["breaks"]), r["breaks"])
            self.assertTrue(480 <= r["breaks"][0] <= 490, r["breaks"])

    def test_they_level_off_at_860_and_you_climb_on_over_them(self) -> None:
        for r in self.runs:
            self.assertTrue(858 <= r["aceRoof"] <= 864, r["aceRoof"])
            self.assertLess(r["peak"], 1000)
            self.assertTrue(23.8 <= r["levelT"] <= 24.2, r["levelT"])

    def test_it_climbs_680_m_and_finishes_ahead_and_above(self) -> None:
        for r in self.runs:
            ace_y, you_y = r["height"]
            self.assertTrue(680 <= r["climbed"] <= 686, r["climbed"])
            self.assertTrue(910 <= you_y <= 916 and 135 <= r["speed"][1] <= 136, (r["height"], r["speed"]))
            self.assertTrue(120 <= r["lead"] <= 130, r["lead"])
            self.assertTrue(48 <= you_y - ace_y <= 57, r["height"])


class MovesTests(unittest.TestCase):
    """The Dip, the Flip and the Ninja on the F-16, and their jet verdicts."""

    @classmethod
    def setUpClass(cls) -> None:
        cls.moves = flights()["moves"]
        text = JET_FILE.read_text()
        cls.verdicts = {m.group(1): (int(m.group(2)), int(m.group(3)))
                        for m in re.finditer(r"(\w+): \{\s*(?:ace: '\w+',\s*)?note: '[^']*',\s*verdict: \{ works: (\d+), of: (\d+)", text)}

    def test_each_verdict_is_the_count_flown(self) -> None:
        self.assertEqual({"dip", "flip", "ninja"}, set(self.verdicts))
        for demo, (works, of) in self.verdicts.items():
            runs = self.moves[demo]
            self.assertEqual((works, of), (sum(r["ok"] for r in runs), len(runs)), demo)

    def test_the_dip_gets_clear_every_time(self) -> None:
        runs = self.moves["dip"]
        self.assertTrue(all(r["ok"] and r["hits"] == [0, 0] and not r["aceFired"] for r in runs))
        self.assertTrue(all(32 <= r["t0"] <= 35.5 for r in runs), [r["t0"] for r in runs])
        self.assertTrue(all(r["letGo"] is not None and 38 <= r["letGo"] <= 44 for r in runs), [r["letGo"] for r in runs])
        self.assertTrue(all(8300 <= r["endRange"] <= 9450 and 128 <= r["endSpeed"] <= 129 for r in runs))

    def test_the_flip_almost_never_finds_a_tail_to_reverse_onto(self) -> None:
        runs = self.moves["flip"]
        self.assertTrue(all(not r["aceFired"] and r["hits"] == [0, 0] for r in runs))
        flipped = [r for r in runs if r["flipped"]]
        self.assertEqual(1, len(flipped))
        self.assertAlmostEqual(29.5, flipped[0]["t0"], delta=0.1)
        self.assertEqual(0, flipped[0]["myShot"])

    def test_the_ninja_wins_the_energy_but_never_the_shot(self) -> None:
        runs = self.moves["ninja"]
        self.assertTrue(all(not r["aceFired"] and r["hits"] == [0, 0] for r in runs))
        handed = [r["handed"] for r in runs if r["handed"] is not None]
        self.assertEqual(9, len(handed))
        self.assertTrue(all(36 <= t <= 41 for t in handed), handed)
        self.assertTrue(all(r["myShot"] == 0 and r["sixLost"] == 0 for r in runs))


class OnTheMig29Tests(unittest.TestCase):
    """The MiG-29 flies the same file: the numbers its write-up quotes."""

    @classmethod
    def setUpClass(cls) -> None:
        cls.f = flights("Mig29")

    def test_nobody_is_fired_at_and_the_moves_count_the_same(self) -> None:
        for id in ("move", "flat", "counter"):
            self.assertTrue(all(r["hits"] == [0, 0] and not r["aceFired"] for r in self.f["demos"][id]), id)
        self.assertEqual({"dip": 9, "flip": 0, "ninja": 0}, {k: sum(r["ok"] for r in v) for k, v in self.f["moves"].items()})

    def test_the_straight_climb_levels_off_and_both_climbs_end_about_even_or_ahead(self) -> None:
        move = self.f["demos"]["move"]
        self.assertTrue(all(r["topT"] is None and r["peak"] <= 976 for r in move))
        lo, hi = span(move, "lead")
        self.assertTrue(-70 <= lo and hi <= 105, (lo, hi))
        lo, hi = span(self.f["demos"]["counter"], "lead")
        self.assertTrue(89 <= lo and hi <= 357, (lo, hi))


if __name__ == "__main__":
    unittest.main()
