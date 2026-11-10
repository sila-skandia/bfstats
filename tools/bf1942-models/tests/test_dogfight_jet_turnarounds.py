"""The Immelmann and the split-S on a jet (features/dogfight-lessons-jets/turnarounds.md).

Every number the jet lesson's words make (`viewer/dogfight-jet-turnarounds.js`),
held on the F-16 from the nine starts. The demos' plain results come from
`jet_lesson`; what each turnaround costs (the ace's height and speed through
it), the Dip, Flip and Ninja as the school scores them over its `STARTS`,
and the lone turnarounds the story quotes (a flat turn round, an Immelmann
from 190 to 770 m, a split-S from 380 to 640 m) come from `FLY` below, which
flies the same airframes through the same modules.
"""

from __future__ import annotations

import functools
import json
import shutil
import subprocess
import unittest
from pathlib import Path

from jet_school import jet_lesson, jet_tops, shot_down

TOOLS = Path(__file__).resolve().parents[1]

# The lesson's demos with the ace's turnaround measured, the moves scored over
# the school's STARTS, and lone turnarounds flown by the lesson's own phases.
FLY = r"""
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const TOOLS = process.env.TA_TOOLS, PLANE = process.env.TA_PLANE;
const { installModuleHooks, viewerDir } = await import(pathToFileURL(path.join(TOOLS, 'sim', 'env.mjs')).href);
const viewer = viewerDir(path.join(TOOLS, 'viewer'));
installModuleHooks(viewer);
const load = name => import(pathToFileURL(path.join(viewer, name)).href);
const THREE = await load('vendor/three.module.js');
const { Aircraft } = await load('aircraft.js');
const { runDuel } = await load('dogfight-duel.js');
const { LESSONS, lessonFor, demoSides } = await load('dogfight-lessons.js');
const { STARTS, nudge, scoreMove, noseOf } = await load('dogfight-measure.js');
const { PLANS, INTENTS, go, heading } = await load('dogfight-pilot.js');
const { hardTurn, dot, bankOf } = await load('dogfight-flight.js');
const { jetMaker } = await import(pathToFileURL(path.join(TOOLS, 'tests', 'jet_airframes.mjs')).href);
const fixture = JSON.parse(readFileSync(path.join(TOOLS, 'tests', 'fixtures', 'dc-jets.json'), 'utf8'));
const makePlane = jetMaker(THREE, Aircraft, fixture, PLANE);
const L = lessonFor(LESSONS.find(l => l.id === 'turnarounds'), 'jet');
const DEG = 180 / Math.PI, r1 = v => Math.round(v * 10) / 10;
const GRID = []; for (const dx of [-30, 0, 30]) for (const dv of [-3, 0, 3]) GRID.push({ dx, dv });
const sep = (r, i) => Math.hypot(...r.tracks[0][i].p.map((v, j) => v - r.tracks[1][i].p[j]));
const turnedBy = (a, b) => { const n = noseOf(a), m = noseOf(b);
  return Math.round(Math.acos(Math.max(-1, Math.min(1, (n[0] * m[0] + n[2] * m[2]) / (Math.hypot(n[0], n[2]) * Math.hypot(m[0], m[2]))))) * DEG); };

/** A turnaround in a track: which, its height and speed in and out. */
function turn(T, dt, kinds = ['immelmann', 'split'], ends = ['top', 'run', 'attack', 'chase']) {
  const i0 = T.findIndex(k => kinds.includes(k.ph));
  if (i0 < 0) return { kind: null };
  const kind = T[i0].ph;
  let e = T.findIndex((k, i) => i > i0 && ends.includes(k.ph));
  const done = e >= 0;
  if (!done) e = T.length - 1;
  let up = -1e9, down = -1e9, vmin = 1e9;
  for (let i = i0; i <= e; i++) { up = Math.max(up, T[i].p[1] - T[i0].p[1]); down = Math.max(down, T[i0].p[1] - T[i].p[1]); vmin = Math.min(vmin, T[i].v); }
  const i4 = Math.min(T.length - 1, e + Math.round(4 / dt));
  return { kind, done, t0: r1(T[i0].t), dur: r1(T[e].t - T[i0].t), y0: Math.round(T[i0].p[1]), v0: Math.round(T[i0].v),
    vEnd: Math.round(T[e].v), dyEnd: Math.round(T[e].p[1] - T[i0].p[1]), up: Math.round(up), down: Math.round(down), vmin: Math.round(vmin), turned: turnedBy(T[e], T[i0]),
    dy4: Math.round(T[i4].p[1] - T[i0].p[1]), v4: Math.round(T[i4].v) };
}

const out = { demos: {}, moves: {}, solo: [], verdicts: Object.fromEntries(L.demos.filter(d => d.kind).map(d => [d.id, d.verdict])) };
for (const demo of L.demos) {
  out.demos[demo.id] = GRID.map(st => {
    const sides = demoSides(L, demo), s1 = sides[1].start;
    sides[1] = { ...sides[1], start: { ...s1, at: [s1.at[0] + st.dx, s1.at[1], s1.at[2]], speed: s1.speed + st.dv } };
    const r = runDuel({ makePlane, seconds: demo.seconds ?? L.seconds, groundAt: () => 0, sides });
    const n = Math.min(r.tracks[0].length, r.tracks[1].length);
    let closest = 1e9; for (let i = 0; i < n; i++) closest = Math.min(closest, sep(r, i));
    const Y = r.tracks[1];
    return { ace: turn(r.tracks[0], r.dt), you: { y0: Math.round(Y[0].p[1]), vmin: Math.round(Math.min(...Y.map(k => k.v))), shot: r1(Y.filter(k => k.o).length * r.dt) },
      hisShot: r1(r.tracks[0].filter(k => k.o).length * r.dt), closest: Math.round(closest), hits: r.hits };
  });
  if (!demo.kind) continue;
  out.moves[demo.id] = STARTS.map(st => {
    const sides = demoSides(L, demo);
    sides[1] = { ...sides[1], start: nudge(sides[1].start, st) };
    const r = runDuel({ makePlane, seconds: demo.seconds ?? L.seconds, groundAt: () => 0, sides });
    const at = t => Math.round(sep(r, Math.min(Math.round(t / r.dt), r.tracks[0].length - 1, r.tracks[1].length - 1)));
    const events = r.events.filter(e => e.phase !== 'kill').map(e => ({ side: e.side, t: r1(e.t), phase: e.phase, range: at(e.t) }));
    return { ...scoreMove(r, demo.kind, 1), ace: turn(r.tracks[0], r.dt), events };
  });
}

// Lone turnarounds: level at full throttle, then at 0.2 s the lesson's own
// phases (`PLANS.turnarounds`), or a flat turn at full pull to the reverse.
PLANS.taJetSolo = {
  title: 'solo', first: 'wait', says: PLANS.turnarounds.says,
  step(c) {
    const { me, mem } = c;
    if (mem.phase === 'wait') {
      if (mem.t < 0.2) return { pitch: 0, roll: 0, rudder: 0, throttle: 1 };
      mem.h0 = heading(me.velocity); mem.loopPhi = undefined; mem.loopLast = undefined; mem.rollSide = 1;
      go(c, mem.kind);
    }
    if (mem.phase === 'flat') {
      if (dot(heading(me.velocity), mem.h0) < -0.985) go(c, 'top');
      else return { ...hardTurn(me, 1), throttle: 1 };
    }
    if (mem.phase === 'top' || mem.phase === 'attack') { mem.phase = 'top'; return { pitch: 0, roll: 0, rudder: 0, throttle: 1 }; }
    return PLANS.turnarounds.step(c);
  },
};
INTENTS.taJetSolo = { wait: 'setup', flat: 'setup' };
// Immelmanns from 192 to 745 m real (150 to 600 and 768 at the Spitfire's
// size, paced and bent over by `pacedHeight`: no paced start reaches 760).
const SOLO = [['flat', 300, 75], ...[150, 200, 250, 300, 350, 400, 450, 500, 600, 768].flatMap(y => [45, 60, 75].map(v => ['immelmann', y, v])),
  ...[45, 60, 75].map(v => ['split', 300, v]), ['split', 350, 75], ['split', 400, 75], ['split', 500, 75]];
for (const [kind, y, speed] of SOLO) {
  const r = runDuel({ makePlane, seconds: 14, groundAt: () => 0, sides: [
    { plan: 'taJetSolo', start: { at: [0, y, 0], headingDeg: 0, speed }, memory: { kind } },
    { plan: 'turnaroundsLetGo', start: { at: [3000, 700, 3000], headingDeg: 90, speed: 60 } }] });
  const T = r.tracks[0];
  const t = turn(T, r.dt, [kind], ['top', 'run']);
  let peak = 0; for (const k of T) peak = Math.max(peak, k.p[1] - T[0].p[1]);
  out.solo.push({ kind, y, speed, height: Math.round(T[0].p[1]), out: Math.round(T.at(-1).p[1] - T[0].p[1]), peak: Math.round(peak), ...t });
}
// The Ninja diving sooner, as their wings pass 90 degrees rolled (the
// verdict line's "Diving sooner, as they roll over").
const ninja = L.demos.find(d => d.id === 'ninja');
PLANS.taJetNinjaSooner = { ...PLANS.taNinja, step(c) {
  if (c.mem.phase === 'wait' && Math.abs(bankOf(c.him.orientation).bank) > 90 && c.g.above < -20) { c.mem.taAim = undefined; go(c, 'dive'); }
  return PLANS.taNinja.step(c);
} };
INTENTS.taJetNinjaSooner = INTENTS.taNinja;
out.sooner = STARTS.map(st => {
  const sides = demoSides(L, ninja);
  sides[1] = { ...sides[1], plan: 'taJetNinjaSooner', start: nudge(sides[1].start, st) };
  const r = runDuel({ makePlane, seconds: ninja.seconds ?? L.seconds, groundAt: () => 0, sides });
  return { ...scoreMove(r, 'ninja', 1), why: r.end?.why ?? null, winner: r.end?.winner ?? null };
});
console.log(JSON.stringify(out));
"""


@functools.lru_cache(maxsize=None)
def flown(plane: str = "F16") -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    proc = subprocess.run(["node", "--input-type=module", "-e", FLY], capture_output=True, text=True, timeout=900,
                          env={**__import__("os").environ, "TA_TOOLS": str(TOOLS), "TA_PLANE": plane})
    if proc.returncode != 0:
        raise AssertionError(proc.stderr[-3000:])
    return json.loads(proc.stdout)


def between(case: unittest.TestCase, values, lo, hi, what: str) -> None:
    values = list(values)
    case.assertTrue(all(lo <= v <= hi for v in values), f"{what}: {values} not in {lo}..{hi}")


def solo(kind: str, y: int, speed: int | None = None) -> list[dict]:
    return [s for s in flown()["solo"] if s["kind"] == kind and s["y"] == y and (speed is None or s["speed"] == speed)]


class TurnaroundsOnAJetTests(unittest.TestCase):
    """The F-16, nine starts each (`viewer/dogfight-jet-turnarounds.js`)."""

    @classmethod
    def setUpClass(cls) -> None:
        cls.runs = jet_lesson("turnarounds")["demos"]
        cls.f = flown()

    # -- the Immelmann ---------------------------------------------------------

    def test_the_immelmann_costs_a_jet_twelve_metres_a_second_for_130_metres(self) -> None:
        ace = [r["ace"] for r in self.f["demos"]["immelmann-counter"]]
        self.assertTrue(all(a["kind"] == "immelmann" and a["done"] for a in ace))
        between(self, (a["v0"] for a in ace), 95, 95, "in at")
        between(self, (a["vEnd"] for a in ace), 83, 83, "over the top at")
        between(self, (a["up"] for a in ace), 130, 130, "climbed")
        between(self, (a["dur"] for a in ace), 4.8, 4.8, "seconds")
        between(self, (a["turned"] for a in ace), 165, 175, "turned round")
        # Never slow: their slowest is 69 m/s; 4 s on, 89 m/s and over 100 m up.
        between(self, (a["vmin"] for a in ace), 69, 69, "slowest")
        between(self, (a["v4"] for a in ace), 89, 89, "4 s on")
        between(self, (a["dy4"] for a in ace), 101, 110, "4 s on, up")

    def test_a_flat_turn_round_is_quicker_and_slower(self) -> None:
        (flat,) = solo("flat", 300)
        self.assertEqual(96, flat["v0"])
        self.assertEqual(3.0, flat["dur"])
        self.assertEqual(79, flat["vEnd"])
        self.assertLessEqual(abs(flat["dyEnd"]), 10)

    def test_low_down_a_lone_immelmann_is_round_and_comes_out_fast(self) -> None:
        low = [s for y in (150, 200, 250, 300, 350) for s in solo("immelmann", y)]
        self.assertEqual([192, 256, 320, 384, 448], sorted({round(s["height"] / 64) * 64 for s in low}))
        self.assertTrue(all(s["done"] for s in low))
        between(self, (s["dur"] for s in low), 4.4, 6.3, "takes, 190 to 450 m")
        between(self, (s["up"] for s in low), 108, 149, "climbs, 190 to 450 m")
        between(self, (s["vEnd"] for s in low), 73, 86, "out at, 190 to 450 m")
        # "from 450 m the loop is still round in 5 to 6 seconds"
        between(self, (s["dur"] for s in solo("immelmann", 350)), 5.1, 6.3, "takes from 450 m")
        # From 60 m/s it comes out faster.
        self.assertTrue(all(s["vEnd"] > s["v0"] for s in low if s["speed"] == 45))

    def test_high_up_the_roof_caps_the_immelmanns_pull(self) -> None:
        # "From 510 m it goes over only if they pull up slow, at 60 to 80 m/s
        # (round in 6 to 7 seconds, 155 to 165 m up); at cruising speed the
        # pull is held back and they never go over." (The roof,
        # `dogfight-jet-ceiling.js` `underRoof`, caps the pull of a loop whose
        # top it predicts over 800 m.)
        slow = [s for s in solo("immelmann", 400) if s["speed"] < 75]
        self.assertTrue(all(s["height"] == 512 and s["done"] and s["v0"] in (61, 79) for s in slow), slow)
        between(self, (s["dur"] for s in slow), 6.2, 6.7, "takes from 510 m, slow")
        between(self, (s["up"] for s in slow), 155, 165, "climbs from 510 m, slow")
        between(self, (s["turned"] for s in slow), 178, 179, "round from 510 m, slow")
        (fast,) = solo("immelmann", 400, 75)
        self.assertEqual(97, fast["v0"])
        self.assertFalse(fast["done"])
        # "From 580 m up no loop goes over at all: they climb straight ahead to
        # 768 m, level off there, and 14 seconds later are still flying away
        # at 125 to 127 m/s."
        high = [fast] + [s for y in (450, 500, 600, 768) for s in solo("immelmann", y)]
        self.assertEqual({512, 576, 635, 704, 745}, {s["height"] for s in high})
        self.assertTrue(all(not s["done"] and s["turned"] <= 1 for s in high), high)
        between(self, (s["height"] + s["peak"] for s in high), 768, 769, "levelled at")
        between(self, (s["vEnd"] for s in high), 125, 127, "14 s on")

    def test_chasing_them_up_you_keep_your_speed_and_get_a_snap(self) -> None:
        demo = self.f["demos"]["immelmann"]
        between(self, (r["you"]["vmin"] for r in demo), 66, 68, "your slowest")
        between(self, (r["you"]["shot"] for r in demo), 0, 0.1, "your fire that lands")
        between(self, (r["closest"] for r in demo), 50, 54, "closest")
        runs = self.runs["immelmann"]
        self.assertTrue(all(r["winner"] is None for r in runs))
        between(self, (r["hits"][1] for r in runs), 0, 3, "your hits")
        self.assertTrue(all(r["hits"][0] == 0 for r in runs))

    def test_meeting_the_top_is_a_head_on_snap_and_they_fire_nothing(self) -> None:
        demo = self.f["demos"]["immelmann-counter"]
        between(self, (r["you"]["shot"] for r in demo), 0.2, 0.7, "your fire that lands")
        between(self, (r["closest"] for r in demo), 23, 43, "closest")
        self.assertTrue(all(r["hisShot"] == 0 for r in demo))
        runs = self.runs["immelmann-counter"]
        self.assertTrue(all(r["winner"] is None for r in runs))
        between(self, (r["hits"][1] for r in runs), 0, 5, "your hits")
        self.assertTrue(all(r["hits"][0] == 0 for r in runs))

    # -- the split-S -----------------------------------------------------------

    def test_the_split_s_trades_163_metres_for_38_metres_a_second(self) -> None:
        ace = [r["ace"] for r in self.f["demos"]["split"]]
        self.assertTrue(all(a["kind"] == "split" and a["done"] for a in ace))
        between(self, (a["v0"] for a in ace), 58, 59, "in at")
        between(self, (a["y0"] for a in ace), 589, 589, "from")
        between(self, (a["down"] for a in ace), 163, 164, "lost")
        between(self, (a["vEnd"] for a in ace), 96, 96, "out at")
        between(self, (a["dur"] for a in ace), 5.3, 5.3, "seconds")
        between(self, (a["turned"] for a in ace), 179, 180, "turned round")
        # Let go: nobody fires, and you were 115 m above them.
        between(self, (r["you"]["y0"] - r["ace"]["y0"] for r in self.f["demos"]["split"]), 115, 115, "you above them")
        runs = self.runs["split"]
        self.assertTrue(all(r["winner"] is None and r["hits"] == [0, 0] for r in runs))
        self.assertTrue(all(r["shots"] == [0, 0] for r in runs))

    def test_from_the_lessons_own_stage_a_jet_is_too_fast_to_split_s(self) -> None:
        base = flown_base()
        self.assertTrue(all(r["ace"]["kind"] == "immelmann" and r["ace"]["v0"] >= 104 for r in base["split"]))

    def test_from_cruising_speed_the_split_s_buys_almost_nothing(self) -> None:
        cruise = solo("split", 350) + solo("split", 400) + solo("split", 500)
        between(self, (s["v0"] for s in cruise), 97, 97, "in at")
        between(self, (s["vEnd"] for s in cruise), 91, 101, "out at")

    def test_the_split_s_needs_500_metres(self) -> None:
        low = solo("split", 300)
        self.assertTrue(all(s["height"] == 384 for s in low))
        between(self, (180 - s["turned"] for s in low), 40, 50, "short of round from 380 m")
        (high,) = solo("split", 400)
        self.assertGreaterEqual(high["turned"], 176)

    # -- the Dip, the Flip and the Ninja ---------------------------------------

    def test_the_dip_works_in_all_nine(self) -> None:
        moves = self.f["moves"]["dip"]
        self.assertEqual(9, sum(m["ok"] for m in moves))
        self.assertTrue(all(m["hisShot"] == 0 and m["hitsOnMe"] == 0 for m in moves))
        def first(m, side, phase):
            return next(e for e in m["events"] if e["side"] == side and e["phase"] == phase)
        between(self, (first(m, 0, "rollout")["range"] for m in moves), 277, 342, "they roll out from you")
        between(self, (first(m, 0, "chase")["range"] for m in moves), 257, 263, "they chase from")
        between(self, (first(m, 0, "let-go")["range"] for m in moves), 634, 704, "they let go at")
        between(self, (first(m, 0, "let-go")["t"] for m in moves), 17.5, 17.9, "they let go")
        between(self, (m["endRange"] for m in moves), 2937, 3081, "apart at 32 s")

    def test_the_flip_meets_them_coming_back_over_you(self) -> None:
        moves = self.f["moves"]["flip"]
        self.assertEqual(0, sum(m["ok"] for m in moves))
        climbs = [next(e for e in m["events"] if e["side"] == 1 and e["phase"] == "flip-climb") for m in moves]
        between(self, (e["t"] for e in climbs), 9.7, 10.2, "round at")
        between(self, (e["range"] for e in climbs), 114, 193, "round from them")
        # They see you and turn on you (a break, or straight at you) within 3.5 s.
        for m, c in zip(moves, climbs):
            turn_on = next(e for e in m["events"] if e["side"] == 0 and e["phase"] in ("evade", "attack") and e["t"] > c["t"])
            self.assertLessEqual(turn_on["t"] - c["t"], 3.5)
        between(self, (m["myShot"] for m in moves), 0, 0.1, "your fire that lands")
        between(self, (m["hitsOnHim"] for m in moves), 0, 2, "your hits")
        between(self, (m["hitsOnMe"] for m in moves), 0, 2, "their hits")

    def test_the_ninja_arrives_after_the_split_s(self) -> None:
        moves = self.f["moves"]["ninja"]
        self.assertEqual(0, sum(m["ok"] for m in moves))
        self.assertTrue(all(m["ace"]["kind"] == "split" for m in moves))
        dives = [next(e for e in m["events"] if e["side"] == 1 and e["phase"] == "dive") for m in moves]
        between(self, (e["t"] for e in dives), 3.5, 3.7, "dive at")
        between(self, (e["range"] for e in dives), 237, 298, "dive from")
        outs = [next(e for e in m["events"] if e["side"] == 1 and e["phase"] == "dip-out") for m in moves]
        between(self, (o["t"] - d["t"] for o, d in zip(outs, dives)), 1.4, 1.6, "off them after")
        between(self, (m["minRange"] for m in moves), 145, 227, "closest")
        self.assertTrue(all(m["myShot"] == 0 and m["hisShot"] == 0 for m in moves))
        # "Diving sooner, as they roll over, put you in front of them as they
        # came out: shot down in all nine."
        sooner = self.f["sooner"]
        self.assertEqual(0, sum(m["ok"] for m in sooner))
        self.assertTrue(all(m["why"] == "shot down" and m["winner"] == 0 for m in sooner), sooner)

    def test_the_verdicts_are_the_counts(self) -> None:
        for demo, verdict in self.f["verdicts"].items():
            self.assertEqual(9, verdict["of"], demo)
            self.assertEqual(verdict["works"], sum(m["ok"] for m in self.f["moves"][demo]), demo)
        self.assertEqual({"dip": 9, "flip": 0, "ninja": 0}, {d: v["works"] for d, v in self.f["verdicts"].items()})

    def test_nobody_is_shot_down_in_the_demos(self) -> None:
        for demo, runs in self.runs.items():
            self.assertEqual(0, shot_down(runs, 0) + shot_down(runs, 1), demo)

    def test_nobody_goes_over_the_roof(self) -> None:
        tops = jet_tops("F16", "turnarounds")["turnarounds"]
        for demo, x in tops.items():
            self.assertLess(max(x["top"]), 860, demo)
            self.assertEqual([0, 0], x["past"], demo)
        # The Flip's turning fight is the highest; the lesson's Immelmanns
        # top out at 479 to 535 m.
        self.assertEqual(780, max(max(x["top"]) for x in tops.values()))
        self.assertEqual([479, 535], tops["immelmann"]["top"])

    def test_the_jet_file_is_laid_over_the_lesson(self) -> None:
        self.assertEqual("jet", jet_lesson("turnarounds")["era"])
        self.assertIsNone(jet_lesson("turnarounds", base=True)["era"])


class TurnaroundsOnTheMig29Tests(unittest.TestCase):
    """The MiG-29 (pace 1.5) flies the same file. Its Immelmanns in the Dip
    and the Flip start at 455 to 456 m and 119 m/s, where the roof caps the
    pull: the ace never goes over, and climbs away straight ahead."""

    @classmethod
    def setUpClass(cls) -> None:
        cls.f = flown("Mig29")

    def test_the_dip_works_because_they_never_turn_round(self) -> None:
        self.assertEqual({"dip": 9, "flip": 0, "ninja": 0}, {d: sum(m["ok"] for m in ms) for d, ms in self.f["moves"].items()})
        for demo in ("dip", "flip"):
            ace = [m["ace"] for m in self.f["moves"][demo]]
            between(self, (a["y0"] for a in ace), 455, 456, f"{demo}: from")
            self.assertTrue(all(a["kind"] == "immelmann" and not a["done"] for a in ace), demo)
            between(self, (a["up"] for a in ace), 323, 329, f"{demo}: climbs")
            between(self, (a["vmin"] for a in ace), 107, 107, f"{demo}: slowest")
        dip = self.f["moves"]["dip"]
        self.assertTrue(all(m["hitsOnMe"] == 0 and m["hisShot"] == 0 for m in dip))
        between(self, (m["endRange"] for m in dip), 2000, 2778, "apart at 32 s")

    def test_the_demos(self) -> None:
        imm = [r["ace"] for r in self.f["demos"]["immelmann"]]
        between(self, (a["y0"] for a in imm), 414, 414, "from")
        between(self, (a["up"] for a in imm), 183, 183, "climbs")
        between(self, (a["vEnd"] for a in imm), 94, 94, "out at")
        between(self, (a["turned"] for a in imm), 168, 168, "round")
        counter = [r["ace"] for r in self.f["demos"]["immelmann-counter"]]
        between(self, (a["up"] for a in counter), 190, 190, "counter: climbs")
        between(self, (r["hits"][1] for r in self.f["demos"]["immelmann-counter"]), 4, 13, "counter: your hits")
        split = [r["ace"] for r in self.f["demos"]["split"]]
        between(self, (a["y0"] for a in split), 669, 669, "split-S from")
        between(self, (a["down"] for a in split), 226, 226, "lost")
        between(self, (a["vEnd"] for a in split), 117, 117, "out at")
        runs = jet_lesson("turnarounds", plane="Mig29")["demos"]
        for demo, rs in runs.items():
            self.assertEqual(0, shot_down(rs, 0) + shot_down(rs, 1), demo)

    def test_lone_immelmanns(self) -> None:
        low = [s for y in (150, 200, 250, 300) for s in solo_on(self.f, "immelmann", y)]
        self.assertEqual({225, 300, 375, 450}, {s["height"] for s in low})
        self.assertTrue(all(s["done"] for s in low))
        high = [s for y in (350, 400, 450, 500, 600, 768) for s in solo_on(self.f, "immelmann", y)]
        self.assertTrue(all(not s["done"] and s["turned"] <= 6 for s in high), high)
        between(self, (s["height"] + s["peak"] for s in high), 769, 783, "levelled at")

    def test_under_the_roof(self) -> None:
        tops = jet_tops("Mig29", "turnarounds")["turnarounds"]
        self.assertEqual(784, max(max(x["top"]) for x in tops.values()))
        self.assertTrue(all(x["past"] == [0, 0] for x in tops.values()))


def solo_on(f: dict, kind: str, y: int) -> list[dict]:
    return [s for s in f["solo"] if s["kind"] == kind and s["y"] == y]


@functools.lru_cache(maxsize=None)
def flown_base() -> dict:
    """The split demo from the lesson's own stage, on the F-16."""
    script = FLY.replace("lessonFor(LESSONS.find(l => l.id === 'turnarounds'), 'jet')",
                         "LESSONS.find(l => l.id === 'turnarounds')").replace("for (const demo of L.demos)",
                                                                              "for (const demo of L.demos.filter(d => d.id === 'split'))")
    script = script.split("// Lone turnarounds")[0] + "console.log(JSON.stringify(out));"
    proc = subprocess.run(["node", "--input-type=module", "-e", script], capture_output=True, text=True, timeout=900,
                          env={**__import__("os").environ, "TA_TOOLS": str(TOOLS), "TA_PLANE": "F16"})
    if proc.returncode != 0:
        raise AssertionError(proc.stderr[-3000:])
    return json.loads(proc.stdout)["demos"]


if __name__ == "__main__":
    unittest.main()
