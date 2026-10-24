#!/usr/bin/env python3
"""Is a human's recoil drawn from his round's input index? (ledger FA-22)

    python3 lab/recoil_seed_check.py replay_<unix>.ndjson [--pid 0] [--weapon Bar1918]

Reads a REC_FIRE_INDEX recorder's file (each round's launch frame `d` and its
input index `gi`). Between two rounds of one burst the soldier's aim moves by
the first round's recoil ride and nothing else when no look is sent
(`lab/stance_dev_probe.mjs`, `lab/mag_cycle_probe.mjs` hold the trigger with
the look at rest). `BFSoldier::calcRecoil` (lnxded 0x0827e2f0) seeds a
`Random` from `Game::getCurrentInputIndex()` (the call at 0x0827e342) with
the two Schrage steps `getRaw` takes, and draws the pitch, then the yaw, each
`a + r (b - a)` with `r = ((s >> 7 | 1) + 1) 2^-24` (`getContinuousRandom`
0x081e28b0, CRD_UNIFORM). This prints, for each pair of rounds of a burst
(rounds `--gap` ticks apart), the aim's change in yaw and pitch, in degrees,
against the yaw and pitch drawn at the first round's index, and fits the
slope: a seeded draw gives a tight line, any other source a cloud.
"""
import argparse
import json
import math
import sys

UP = {'Bar1918': (0.28, 0.32), 'Colt': (0.4, 0.6)}
LR = {'Bar1918': (-0.2, 0.2), 'Colt': (-0.2, -0.2)}


def schrage(y, a):
    lo = ((y & 0xFFFF) * a) & 0xFFFFFFFF
    hi = ((lo >> 16) + (y >> 16) * a) & 0xFFFFFFFF
    x = ((hi >> 15) + (lo & 0xFFFF) + ((hi & 0x7FFF) << 16)) & 0xFFFFFFFF
    return x - 0x7FFFFFFF if x >= 0x7FFFFFFF else x


def recoil_draws(index, up, lr):
    s = schrage(schrage(index & 0x7FFFFFFF, 0x5E30), 0x661F) & 0x7FFFFFFF
    out = []
    for a, b in (up, lr):
        s = schrage(schrage(s, 0x5E30), 0x661F)
        r = (((s >> 7) | 1) + 1) * 5.9604645e-08
        out.append(a + r * (b - a))
    return out


def angles(d):
    x, y, z = d
    return math.degrees(math.atan2(x, z)), math.degrees(math.asin(max(-1.0, min(1.0, y / math.sqrt(x * x + y * y + z * z)))))


def fit(xs, ys):
    n = len(xs)
    mx, my = sum(xs) / n, sum(ys) / n
    sxx = sum((x - mx) ** 2 for x in xs)
    sxy = sum((x - mx) * (y - my) for x, y in zip(xs, ys))
    syy = sum((y - my) ** 2 for y in ys)
    k = sxy / sxx if sxx else 0.0
    r = sxy / math.sqrt(sxx * syy) if sxx and syy else 0.0
    return k, my - k * mx, r


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument('server')
    ap.add_argument('--pid', type=int, default=0)
    ap.add_argument('--weapon', default='Bar1918')
    ap.add_argument('--gap', type=int, default=4)
    a = ap.parse_args(argv)
    with open(a.server) as fh:
        rows = [json.loads(l) for l in fh if l.strip()]
    f = [r for r in rows if r.get('k') == 'f' and r.get('pid') == a.pid and r.get('w') == a.weapon
         and r.get('gi') is not None and not r.get('fake')]
    f.sort(key=lambda r: (r['t'], r['gi']))
    dy, dp, py, pp = [], [], [], []
    for r0, r1 in zip(f, f[1:]):
        if r1['gi'] - r0['gi'] != a.gap:
            continue
        y0, p0 = angles(r0['d'])
        y1, p1 = angles(r1['d'])
        d_yaw = (y1 - y0 + 180) % 360 - 180
        pitch, yaw = recoil_draws(r0['gi'], UP[a.weapon], LR[a.weapon])
        dy.append(d_yaw)
        dp.append(p1 - p0)
        py.append(yaw)
        pp.append(pitch)
        print(f'{r0["gi"]:6d} -> {r1["gi"]:6d}  aim d_yaw {d_yaw:+8.4f} d_pitch {p1 - p0:+8.4f}   drawn yaw {yaw:+.4f} pitch {pitch:.4f}')
    if len(dy) >= 3:
        k, c, r = fit(py, dy)
        print(f'\nyaw:   d_yaw = {k:+.4f} x drawn {c:+.4f}, r = {r:+.4f} over {len(dy)} pairs')
        k, c, r = fit(pp, dp)
        print(f'pitch: d_pitch = {k:+.4f} x drawn {c:+.4f}, r = {r:+.4f}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
