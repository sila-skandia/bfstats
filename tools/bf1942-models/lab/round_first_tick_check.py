#!/usr/bin/env python3
"""Does a round fall on the tick it is launched? (ledger FA-23)

    python3 lab/round_first_tick_check.py replay_<unix>.ndjson [--min-samples 5]

Reads a server recorder file: each round's launch `f` (its point `p`, the
weapon `w`) and its flight (`pn` births, `pj` places a tick apart). For each
flight with a launch at its birth, the per-tick vertical speeds
`(y[k+1] - y[k]) * 30`, the first measured from the launch point. A body
whose gravity is seeded into the accumulator at the end of each tick (the
engine's `PhysicsNode::updatePhysics`, COL-8) moves its launch velocity
unchanged on the first tick and loses `g dt` on every tick after; one that
takes gravity before it moves (the page's `advanceProjectiles` until
2026-10-25) loses it on the first tick too. Printed per weapon: the first
step's drop against the second's, in m/s (`g dt` = 0.491).
"""
import argparse
import json
import sys
from collections import defaultdict

G_DT = 14.73 / 30


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument('server')
    ap.add_argument('--min-samples', type=int, default=5)
    a = ap.parse_args(argv)
    rows = [json.loads(l) for l in open(a.server) if l.strip()]
    births = []
    for r in rows:
        if r.get('k') == 'pn':
            for key, tmpl in r['o']:
                births.append((r['t'], key, tmpl))
    fires = [r for r in rows if r.get('k') == 'f' and not r.get('fake')]
    tracks = defaultdict(list)
    for r in rows:
        if r.get('k') == 'pj':
            for key, x, y, z in r['o']:
                tracks[key].append((r['t'], y))
    out = defaultdict(list)
    for t, key, tmpl in births:
        f = min((x for x in fires if abs(x['t'] - t) < 0.02), key=lambda x: abs(x['t'] - t), default=None)
        if f is None:
            continue
        tr = [s for s in tracks.get(key, []) if t - 1e-3 <= s[0] <= t + 0.2][:a.min_samples]
        if len(tr) < a.min_samples:
            continue
        ys = [f['p'][1]] + [y for _, y in tr]
        v = [(b - c) * 30 for c, b in zip(ys, ys[1:])]
        out[(f.get('w'), tmpl)].append((v[0] - v[1], v[1] - v[2]))
    for (w, tmpl), pairs in sorted(out.items(), key=lambda kv: -len(kv[1])):
        n = len(pairs)
        d01 = sum(p[0] for p in pairs) / n
        d12 = sum(p[1] for p in pairs) / n
        print(f'{w or "-":24s} {tmpl:32s} n={n:4d}  drop launch->1 {d01:+.3f}  1->2 {d12:+.3f}   (g dt {G_DT:.3f})')
    return 0


if __name__ == '__main__':
    sys.exit(main())
