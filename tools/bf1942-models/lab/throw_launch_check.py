#!/usr/bin/env python3
"""A thrown round's launch velocity against the law (ledger FA-23, GUN-19).

    python3 lab/throw_launch_check.py probe.ndjson replay_<unix>.ndjson

`probe.ndjson` is `lab/mag_cycle_probe.mjs` run with `PHASES=throw LOG_CS=1`:
every word sent with its serial, and every control state the server sent the
probe with its serial and the soldier body's velocity (`cs`). The server file
is a REC_FIRE_INDEX recorder's: each round's launch frame `d`, its input
index `gi`, and the round's position each tick (`pj`).

`FireArms::fireBarrel` launches `velocity x heat x d` (GUN-14), adds the
root's velocity (`addRootSpeed`, default 1) and `-(2/30) x gravity` on y
(0x0828b386..0x0828b3c4). Per round this prints the fitted launch velocity
(the first samples, gravity on y, semi-implicit: the first step moves
`v + g dt` a tick), the soldier's velocity in the control state for the
round's serial, and what is left once both and the lift are taken off, as
`heat x velocity x d` plus a residual.
"""
import argparse
import json
import math
import re
import os
import sys

G = -14.73
DT = 1 / 30
LIFT = -(2 / 30) * G


def load(path):
    with open(path) as fh:
        return [json.loads(l) for l in fh if l.strip()]


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument('probe')
    ap.add_argument('server')
    ap.add_argument('--velocity', type=float, default=25.0)
    a = ap.parse_args(argv)
    probe = load(a.probe)
    cs = sorted((r['serial'], r['vel']) for r in probe if r['kind'] == 'cs' and r.get('serial') and r.get('vel'))
    sent = [r['serial'] for r in probe if r['kind'] == 'sent']
    lo, hi = min(sent), max(sent)
    rows = load(a.server)
    f = [r for r in rows if r.get('k') == 'f' and 'renade' in r.get('w', '') and lo <= (r.get('gi') or -1) <= hi]
    tracks = {}
    born = {}
    for r in rows:
        if r.get('k') == 'pn':
            for key, _ in r['o']:
                born.setdefault(r['t'], []).append(key)
        if r.get('k') == 'pj':
            for key, x, y, z in r['o']:
                tracks.setdefault(key, []).append((r['t'], x, y, z))
    for r in f:
        key = next((k for t, ks in born.items() if abs(t - r['t']) < 0.02 for k in ks), None)
        tr = tracks.get(key, [])
        tr = [s for s in tr if s[0] >= r['t'] - 1e-3][:4]
        if len(tr) < 3:
            continue
        p0 = r['p']
        # Semi-implicit: x1 = x0 + (v + g dt) dt on y, x0 + v dt across.
        vx = (tr[1][1] - tr[0][1]) / DT
        vz = (tr[1][3] - tr[0][3]) / DT
        dy1 = tr[1][2] - tr[0][2]
        vy = dy1 / DT - G * DT * 2      # v at tr[0], then back one tick to the launch
        vy_launch = (tr[0][2] - p0[1]) / DT - G * DT
        vel = max((c for c in cs if c[0] <= r['gi']), default=(None, [0, 0, 0]))
        sv = vel[1]
        rest = [vx - sv[0], vy_launch - sv[1] - LIFT, vz - sv[2]]
        d = r['d']
        h = sum(x * y for x, y in zip(rest, d)) / a.velocity
        resid = [x - h * a.velocity * y for x, y in zip(rest, d)]
        print(f'gi {r["gi"]}: launch v ({vx:+.3f}, {vy_launch:+.3f}, {vz:+.3f})  soldier v {sv} (serial {vel[0]})  '
              f'heat {h:.4f}  residual ({resid[0]:+.3f}, {resid[1]:+.3f}, {resid[2]:+.3f})')
    return 0


if __name__ == '__main__':
    sys.exit(main())
