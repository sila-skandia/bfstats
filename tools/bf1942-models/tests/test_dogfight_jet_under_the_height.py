"""When they have the height, on a jet (`viewer/dogfight-lessons/jets/under-the-height.js`,
features/dogfight-lessons-jets/under-the-height.md).

The fights are the lesson's starts and seats against the jet's ace, the same
boom-and-zoomer turning over the top under the roof every jet pilot flies
under (`jetBoomAndZoom`, `jetUhAce`, `viewer/dogfight-lessons/jets/plan-under-the-height.js`,
`underRoof` in `stepPilot`); the jet file rewrites the words, because on the
F-16 a straight climb under a diver is not the trap it is on a Spitfire, and
neither plane can get above the other under the roof.
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

from jet_school import jet_lesson, jet_steps, jet_tops, shot_down

TOOLS = Path(__file__).resolve().parent.parent
JET_FILE = TOOLS / "viewer" / "dogfight-lessons/jets/under-the-height.js"

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
const { STARTS: L9, nudge, scoreMove, noseOf } = await load('dogfight-measure.js');
const { jetMaker } = await import(pathToFileURL(path.join(T, 'jet_airframes.mjs')).href);
const fixture = JSON.parse(readFileSync(path.join(T, 'fixtures', 'dc-jets.json'), 'utf8'));
const makePlane = jetMaker(THREE, Aircraft, fixture, PLANE);
const L = lessonFor(LESSONS.find(l => l.id === 'under-the-height'), 'jet');
const sep = (a, b) => Math.hypot(a.p[0] - b.p[0], a.p[1] - b.p[1], a.p[2] - b.p[2]);
const r1 = v => Math.round(v * 10) / 10;
const out = { era: L.era ?? null, demos: {}, moves: {} };
// The ace once off the perch it starts on (735 m on the F-16, 750 on the
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
    let closest = Infinity, maxLead = -Infinity, maxLeadT = 0, acePeak = 0, aceSlow = Infinity, behind = 0;
    const ang = (a, b) => Math.acos(Math.max(-1, Math.min(1, (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / (Math.hypot(...a) * Math.hypot(...b) || 1)))) * 180 / Math.PI;
    for (let i = 0; i < n; i++) {
      closest = Math.min(closest, sep(A[i], B[i]));
      // The ace behind you, nose on you, inside 450 m (your six, as the school measures it, a little wider).
      const rel = [B[i].p[0] - A[i].p[0], B[i].p[1] - A[i].p[1], B[i].p[2] - A[i].p[2]];
      if (sep(A[i], B[i]) < 450 && ang(noseOf(A[i]), rel) < 30 && ang(noseOf(B[i]), rel) < 60) behind += r.dt;
      if (B[i].e - A[i].e > maxLead) { maxLead = B[i].e - A[i].e; maxLeadT = A[i].t; }
      acePeak = Math.max(acePeak, A[i].p[1]);
      if (A[i].t > 15) aceSlow = Math.min(aceSlow, A[i].v);
    }
    // The first time you reach the top of the sky (990 m), and how far you fall in the 8 s after.
    const top = B.findIndex(k => k.p[1] >= 990);
    const fall = top < 0 ? 0 : B[top].p[1] - Math.min(...B.slice(top, top + Math.round(8 / r.dt)).map(k => k.p[1]));
    const breaks = r.events.filter(e => e.side === 1 && e.phase === 'break').map(e => Math.round(e.t / r.dt));
    // Their first pull out of a dive: when, and how far from you.
    const zoom = r.events.find(e => e.side === 0 && e.phase === 'zoom');
    const zi = zoom ? Math.round(zoom.t / r.dt) : -1;
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
      breaks: breaks.map(i => Math.round(sep(A[i], B[i]))), behind: r1(behind), endSep: Math.round(sep(A[last], B[last])),
      ...(() => { const i = A.findIndex(k => k.f); return { fireT: i < 0 ? null : r1(A[i].t), fireRange: i < 0 ? null : Math.round(sep(A[i], B[i])) }; })(),
      zoomT: zoom ? r1(zoom.t) : null, zoomRange: zi < 0 ? null : Math.round(sep(A[zi], B[zi])),
      zoomAbove: zi < 0 ? null : Math.round(A[zi].p[1] - B[zi].p[1]), acePeak: Math.round(acePeak), aceSlow: Math.round(aceSlow),
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
      endRange: s.endRange ?? null, minRange: s.minRange ?? null, endSpeed: s.endSpeed ?? null, myShot: s.myShot ?? null, sixLost: s.sixLost ?? null,
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
    """The diver stays under the top of the sky: it starts under the roof
    (735 m on the F-16, 750 on the MiG-29) and from 5 s on never climbs over
    780 m on the F-16 (786 on the MiG-29) or slows under 80 m/s, from every
    start of every demo."""

    def _all(self, plane: str):
        f = flights(plane)
        return [r for d in f["demos"].values() for r in d] + [r for d in f["moves"].values() for r in d]

    def test_the_lesson_flies_the_jet_aces_and_the_lessons_dip(self) -> None:
        text = JET_FILE.read_text()
        self.assertIn("ace: { plan: 'jetBoomAndZoom' }", text)
        self.assertIn("flyAce: 'jetUhAce'", text)
        self.assertEqual(3, text.count("ace: 'jetUhAce'"))
        self.assertNotIn("seat:", text)

    def test_under_the_roof_and_never_slow_on_the_f16(self) -> None:
        for r in self._all("F16"):
            self.assertEqual(735, r["aceStart"])
            self.assertLessEqual(r["aceRoof"], 780, r["aceRoof"])
            self.assertGreaterEqual(r["aceSlowest"], 80, r["aceSlowest"])

    def test_under_the_roof_and_never_slow_on_the_mig29(self) -> None:
        for r in self._all("Mig29"):
            self.assertEqual(750, r["aceStart"])
            self.assertLessEqual(r["aceRoof"], 786, r["aceRoof"])
            self.assertGreaterEqual(r["aceSlowest"], 100, r["aceSlowest"])

    def test_nobody_tops_860_m_on_the_f16(self) -> None:
        # Both planes, every demo and move, nine starts: the highest each went.
        tops = jet_tops("F16", "under-the-height")["under-the-height"]
        self.assertEqual({"move", "flat", "counter", "dip", "flip", "ninja"}, set(tops))
        for demo, x in tops.items():
            self.assertLess(max(x["top"]), 860, demo)
            self.assertLessEqual(max(x["top"]), 780, demo)
            self.assertEqual([735, 230], x["start"], demo)
            self.assertEqual([0, 0], x["past"], demo)


class StraightClimbTests(unittest.TestCase):
    """You climb straight: on a jet not the trap it is on a Spitfire, but it
    ends with them behind you and you a little behind on energy."""

    @classmethod
    def setUpClass(cls) -> None:
        cls.runs = flights()["demos"]["move"]
        cls.summary = jet_lesson("under-the-height", demo="move")["demos"]["move"]

    def test_the_jet_file_is_laid_over_the_lesson(self) -> None:
        self.assertEqual("jet", flights()["era"])
        self.assertEqual("jet", jet_lesson("under-the-height", demo="move")["era"])

    def test_the_fight_starts_500_m_under_them_and_1_km_apart(self) -> None:
        for r in self.runs:
            self.assertEqual(504, r["startAbove"])
            self.assertTrue(1035 <= r["startSep"] <= 1060, r["startSep"])

    def test_never_fired_at(self) -> None:
        self.assertEqual(0, shot_down(self.summary, 1))
        self.assertTrue(all(r["hits"] == [0, 0] and r["winner"] is None for r in self.summary))
        self.assertTrue(all(not r["aceFired"] for r in self.runs))

    def test_at_their_height_in_13_5_s_before_their_one_dive_arrives(self) -> None:
        self.assertTrue(all(13.4 <= r["levelT"] <= 13.7 for r in self.runs), [r["levelT"] for r in self.runs])
        for r in self.runs:
            self.assertEqual([10], r["diveTimes"])
            # They pull out at 14 s, 410 to 450 m behind you, a few metres under you.
            self.assertTrue(13.5 <= r["zoomT"] <= 14.0, r["zoomT"])
            self.assertTrue(405 <= r["zoomRange"] <= 450, r["zoomRange"])
            self.assertTrue(-6 <= r["zoomAbove"] < 0, r["zoomAbove"])

    def test_the_energy_for_a_moment_then_them_behind_you(self) -> None:
        for r in self.runs:
            self.assertLessEqual(r["peak"], 780)
            self.assertTrue(70 <= r["maxLead"] <= 92 and 24.9 <= r["maxLeadT"] <= 25.7, (r["maxLead"], r["maxLeadT"]))  # re-pinned 2026-11-12 on retail g and box area (features/retail-parity-cross-check-2026-11-12)
            # Behind you, inside 450 m, nose on you: 8 to 38 s of the fight.
            self.assertTrue(8 <= r["behind"] <= 38.5, r["behind"])
        lo, hi = span(self.runs, "lead")
        self.assertTrue(-86 <= lo and hi <= -11, (lo, hi))  # re-pinned 2026-11-12 on retail g and box area (features/retail-parity-cross-check-2026-11-12)


class FlatTurnTests(unittest.TestCase):
    """Turning flat: the one demo they fire in, and it buys nothing."""

    @classmethod
    def setUpClass(cls) -> None:
        cls.runs = flights()["demos"]["flat"]

    def test_three_or_four_dives_and_shots_in_three(self) -> None:
        self.assertEqual([3] * 4 + [4] * 5, sorted(r["dives"] for r in self.runs))
        fired = [r for r in self.runs if r["aceFired"]]
        self.assertEqual(3, len(fired))
        for r in fired:
            # The third dive, about 41 s in, from 300 to 360 m.
            self.assertTrue(40.0 <= r["fireT"] <= 41.5 and 290 <= r["fireRange"] <= 360, (r["fireT"], r["fireRange"]))
        # One round lands in each of them, and never on a pilot they did not fire at.
        self.assertEqual([0] * 6 + [1] * 3, sorted(r["hits"][0] for r in self.runs))  # re-pinned 2026-11-12 on retail g and box area (features/retail-parity-cross-check-2026-11-12)
        self.assertTrue(all(r["hits"][0] == (1 if r["aceFired"] else 0) for r in self.runs))
        self.assertTrue(all(r["hits"][1] == 0 for r in self.runs))

    def test_it_buys_nothing(self) -> None:
        for r in self.runs:
            self.assertTrue(125 <= r["climbed"] <= 128, r["climbed"])
            self.assertEqual(83, r["speed"][1])
            self.assertTrue(-420 <= r["lead"] <= -340, r["lead"])


class ClimbBetweenTests(unittest.TestCase):
    """The counter holds on a jet: never fired at, never behind you, level at
    the end and a kilometre apart."""

    @classmethod
    def setUpClass(cls) -> None:
        cls.runs = flights()["demos"]["counter"]
        cls.summary = jet_lesson("under-the-height", demo="counter")["demos"]["counter"]

    def test_never_fired_at_and_never_behind_you(self) -> None:
        self.assertTrue(all(r["hits"] == [0, 0] and r["winner"] is None for r in self.summary))
        self.assertTrue(all(not r["aceFired"] and r["behind"] == 0 for r in self.runs))

    def test_one_dive_broken_at_435_to_485_m(self) -> None:
        for r in self.runs:
            self.assertEqual(1, r["dives"])
            self.assertEqual(1, len(r["breaks"]), r["breaks"])
            self.assertTrue(435 <= r["breaks"][0] <= 485, r["breaks"])

    def test_their_height_at_24_to_26_s_and_a_short_lead(self) -> None:
        for r in self.runs:
            self.assertTrue(24.0 <= r["levelT"] <= 26.0, r["levelT"])
            self.assertTrue(40 <= r["maxLead"] <= 90, r["maxLead"])

    def test_level_with_them_a_kilometre_apart(self) -> None:
        for r in self.runs:
            self.assertLessEqual(r["peak"], 780)
            self.assertEqual([767, 768], r["height"])
            self.assertEqual([127, 127], r["speed"])
            self.assertTrue(1 <= r["lead"] <= 2, r["lead"])
            self.assertTrue(1000 <= r["endSep"] <= 1120, r["endSep"])


class MovesTests(unittest.TestCase):
    """The Dip, the Flip and the Ninja on the F-16, and their jet verdicts."""

    @classmethod
    def setUpClass(cls) -> None:
        cls.moves = flights()["moves"]
        text = JET_FILE.read_text()
        # Each move's block, from its name to its verdict's counts.
        cls.verdicts = {m.group(1): (int(m.group(2)), int(m.group(3)))
                        for m in re.finditer(r"\n    (\w+): \{\n(?:(?!\n    \w+: \{).)*?verdict: \{ works: (\d+), of: (\d+)",
                                             text, re.S)}

    def test_each_verdict_is_the_count_flown(self) -> None:
        self.assertEqual({"dip", "flip", "ninja"}, set(self.verdicts))
        for demo, (works, of) in self.verdicts.items():
            runs = self.moves[demo]
            self.assertEqual((works, of), (sum(r["ok"] for r in runs), len(runs)), demo)

    def test_their_guns_never_fire_in_any_move(self) -> None:
        for demo, runs in self.moves.items():
            self.assertTrue(all(not r["aceFired"] and r["hits"][0] == 0 for r in runs), demo)

    def test_the_dip_gets_clear_every_time(self) -> None:
        runs = self.moves["dip"]
        self.assertTrue(all(r["ok"] and r["sixLost"] == 0 for r in runs))
        self.assertTrue(all(35.5 <= r["t0"] <= 62 for r in runs), [r["t0"] for r in runs])
        let_go = [r["letGo"] for r in runs if r["letGo"] is not None]
        self.assertEqual(7, len(let_go))
        self.assertTrue(all(38.5 <= t <= 64.4 for t in let_go), let_go)
        self.assertTrue(all(1045 <= r["endRange"] <= 8749 and 116 <= r["endSpeed"] <= 124 for r in runs),  # re-pinned 2026-11-12 on retail g and box area (features/retail-parity-cross-check-2026-11-12)
                        [(r["endRange"], r["endSpeed"]) for r in runs])
        # Rounds of yours on them in six, 1 to 3.
        landed = sorted(r["hits"][1] for r in runs if r["hits"][1])
        self.assertEqual(6, len(landed))  # re-pinned 2026-11-12 on retail g and box area (features/retail-parity-cross-check-2026-11-12)
        self.assertTrue(1 <= landed[0] and landed[-1] <= 3, landed)

    def test_the_dip_has_its_own_steps_and_each_one_comes(self) -> None:
        card = jet_steps("under-the-height")["steps"]["dip"]
        self.assertEqual(["climb", "break", "dip-run"], [s["phase"] for s in card])
        times = [s["t"] for s in card]
        self.assertTrue(all(t is not None for t in times), card)
        self.assertEqual(sorted(times), times)

    def test_the_flip_never_finds_a_tail_to_reverse_onto(self) -> None:
        self.assertFalse(any(r["flipped"] for r in self.moves["flip"]))

    def test_the_ninja_wins_the_energy_only_once_they_have_let_you_go(self) -> None:
        # Claim rewritten 2026-11-12 on retail g and box area
        # (features/retail-parity-cross-check-2026-11-12): in one start of nine
        # (the sixth) the edge comes at 43.9 s, after they let you go at 40.3 s
        # 2.3 km off, and the dive never starts; in the other eight never. The
        # third start ends with their paths crossing at 21 m on the 90 s
        # clock: on your six 0.13 s, never 1 s.
        runs = self.moves["ninja"]
        handed = [(i, r["handed"], r["letGo"]) for i, r in enumerate(runs) if r["handed"] is not None]
        self.assertEqual([(5, 43.9, 40.3)], handed)
        self.assertTrue(all(r["sixLost"] <= 0.2 for r in runs), [r["sixLost"] for r in runs])
        landed = sorted(r["hits"][1] for r in runs if r["hits"][1])
        self.assertEqual(6, len(landed))
        self.assertTrue(1 <= landed[0] and landed[-1] <= 3, landed)


class OnTheMig29Tests(unittest.TestCase):
    """The MiG-29 flies the same file: the numbers its write-up quotes."""

    @classmethod
    def setUpClass(cls) -> None:
        cls.f = flights("Mig29")

    def test_the_three_demos(self) -> None:
        move, flat, counter = (self.f["demos"][k] for k in ("move", "flat", "counter"))
        for runs in (move, flat, counter):
            self.assertTrue(all(r["hits"] == [0, 0] for r in runs))
        # The ace fires in one flat turn of nine, and misses.
        self.assertEqual(1, sum(r["aceFired"] for r in flat))
        self.assertFalse(any(r["aceFired"] for r in move + counter))
        self.assertTrue(all(5 <= r["lead"] <= 6 and r["height"] == [784, 785] for r in move), [r["lead"] for r in move])
        self.assertTrue(all(3.5 <= r["behind"] <= 6 for r in move), [r["behind"] for r in move])
        self.assertTrue(all(-551 <= r["lead"] <= -442 for r in flat), [r["lead"] for r in flat])
        leads = sorted(r["lead"] for r in counter)
        self.assertEqual(-31, leads[0])  # re-pinned 2026-11-12 on retail g and box area (features/retail-parity-cross-check-2026-11-12)
        self.assertTrue(all(3 <= x <= 4 for x in leads[1:]), leads)
        self.assertTrue(all(r["behind"] == 0 and r["endSep"] >= 2400 for r in counter))

    def test_the_moves_and_the_lessons_own_start(self) -> None:
        moves = self.f["moves"]
        self.assertEqual({"dip": 8, "flip": 0, "ninja": 0}, {k: sum(r["ok"] for r in v) for k, v in moves.items()})
        # From the lesson's own start (the fifth of nine) they get onto your tail.
        own = {k: v[4] for k, v in moves.items()}
        self.assertFalse(own["dip"]["ok"])
        self.assertEqual(6, own["dip"]["hits"][0])
        self.assertEqual(22, own["ninja"]["hits"][0])
        for k, v in moves.items():
            self.assertTrue(all(r["hits"][0] == 0 for i, r in enumerate(v) if i != 4), k)
        self.assertTrue(all(r["endRange"] >= 9000 for i, r in enumerate(moves["dip"]) if i != 4))

    def test_tops(self) -> None:
        tops = jet_tops("Mig29", "under-the-height")["under-the-height"]
        for demo, x in tops.items():
            self.assertLessEqual(max(x["top"]), 786, demo)
            self.assertEqual([750, 270], x["start"], demo)


if __name__ == "__main__":
    unittest.main()
