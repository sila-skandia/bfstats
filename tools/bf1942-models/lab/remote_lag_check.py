#!/usr/bin/env python3
"""How far the page's drawn remote aircraft is from the server's, per frame.

Reads `remote_lag_probe.mjs`'s log and, for every drawn frame of an aircraft
moving faster than 20 m/s, compares the drawn pose with the server's own track
(its ghost samples, timed by the block's tick, interpolated):

  present  the server's pose at the frame's moment. The server's clock is the
           page clock minus the least (arrival - tick time) seen: on loopback
           a sample is never early, so the least offset is the trip itself.
  shot     the server's pose at the tick that ran the word the page sent at
           that frame: where a round fired then leaves from, and the moment
           the server tests it against this plane.
  lag      how far back along the server's track the drawn pose sits, seconds
           (the best fit within -1..+0.5 s of the present).

    python3 lab/remote_lag_check.py lag.ndjson
"""
import bisect
import os
import json
import math
import statistics
import sys

TICK = 30.0
# Frames slower than this are left out (an aircraft in flight by default;
# MIN_SPEED=3 takes ground hulls too).
MIN_SPEED = float(os.environ.get('MIN_SPEED', 20))


def load(path):
    rows = [json.loads(l) for l in open(path) if l.strip()]
    return rows


def pct(xs, q):
    xs = sorted(xs)
    if not xs:
        return float('nan')
    return xs[min(len(xs) - 1, int(q * (len(xs) - 1) + 0.5))]


def main(path):
    rows = load(path)
    tracks = {}          # id -> [(t, (x,y,z))]
    offs = []
    for r in rows:
        if r['kind'] == 's' and r.get('tick') is not None:
            t = r['tick'] / TICK
            offs.append(r['p'] / 1000 - t)
            for nid, x, y, z in r['o']:
                tracks.setdefault(nid, []).append((t, (x, y, z)))
    if not offs:
        print('no samples')
        return 1
    off = min(offs)
    for h in tracks.values():
        h.sort()
        # one sample per tick
        uniq = []
        for t, p in h:
            if uniq and abs(uniq[-1][0] - t) < 1e-9:
                uniq[-1] = (t, p)
            else:
                uniq.append((t, p))
        h[:] = uniq
    # word seq -> page time, ack seq -> executing tick time
    sent = sorted((r['p'], r['seq']) for r in rows if r['kind'] == 'sent')
    exec_t = {}
    pending_ack = None
    for r in rows:
        if r['kind'] == 'ack':
            if r.get('tick') is not None:
                exec_t[r['seq']] = r['tick'] / TICK
            else:
                pending_ack = r
        elif r['kind'] == 's' and pending_ack is not None and r.get('tick') is not None:
            if r['p'] - pending_ack['p'] < 5:
                exec_t[pending_ack['seq']] = r['tick'] / TICK
            pending_ack = None
    # Interpolate the acked ticks onto every seq (one word a tick).
    acked = sorted(exec_t.items())
    sent_p = [p for p, _ in sent]

    def exec_of(seq):
        i = bisect.bisect_left(acked, (seq, -1e18))
        cands = [acked[j] for j in (i - 1, i) if 0 <= j < len(acked)]
        if not cands:
            return None
        s0, t0 = min(cands, key=lambda c: abs(c[0] - seq))
        if abs(s0 - seq) > 6:
            return None
        return t0 + (seq - s0) / TICK

    def at(h, t):
        ts = [a for a, _ in h]
        i = bisect.bisect_left(ts, t)
        if i <= 0 or i >= len(h):
            return None
        (ta, pa), (tb, pb) = h[i - 1], h[i]
        if tb - ta > 0.25:
            return None
        k = (t - ta) / (tb - ta)
        return tuple(pa[j] + (pb[j] - pa[j]) * k for j in range(3))

    def dist(a, b):
        return math.dist(a, b)

    res = {'present': [], 'shot': [], 'lag': [], 'speed': [], 'lead': []}
    for r in rows:
        if r['kind'] != 'draw':
            continue
        h = tracks.get(r['id'])
        if not h:
            continue
        s_now = r['p'] / 1000 - off
        pres = at(h, s_now)
        a, b = at(h, s_now - 0.05), at(h, s_now + 0.05)
        if pres is None or a is None or b is None:
            continue
        v = dist(a, b) / 0.1
        if v < MIN_SPEED:
            continue
        drawn = (r['x'], r['y'], r['z'])
        res['present'].append(dist(drawn, pres))
        res['speed'].append(v)
        res['lead'].append(r.get('lead', 0))
        i = bisect.bisect_right(sent_p, r['p']) - 1
        if i >= 0:
            te = exec_of(sent[i][1])
            if te is not None:
                ps = at(h, te)
                if ps is not None:
                    res['shot'].append(dist(drawn, ps))
        best = None
        for k in range(-200, 101):
            tau = s_now + k * 0.005
            q = at(h, tau)
            if q is None:
                continue
            d = dist(q, drawn)
            if best is None or d < best[0]:
                best = (d, s_now - tau)
        if best and best[0] < 3:
            res['lag'].append(best[1])
    # Smoothness: each drawn frame against the straight line through its two
    # neighbours (same aircraft, by page time). Curvature over two 16 ms
    # frames is a few millimetres, so what remains is the drawing's own
    # wobble: a step at a sample, a lead that jumps.
    draws = {}
    for r in rows:
        if r['kind'] == 'draw':
            draws.setdefault(r['id'], []).append((r['p'], (r['x'], r['y'], r['z'])))
    wob = []
    for d in draws.values():
        for (pa, a), (pb, b), (pc, c) in zip(d, d[1:], d[2:]):
            if not (0 < pb - pa < 40 and 0 < pc - pb < 40):
                continue
            if dist(a, c) / ((pc - pa) / 1000) < MIN_SPEED:   # parked or slow
                continue
            k = (pb - pa) / (pc - pa)
            line = tuple(a[j] + (c[j] - a[j]) * k for j in range(3))
            wob.append(dist(b, line) * 1000)
    res['wobble_mm'] = wob
    n = len(res['present'])
    print(f'{n} frames over {MIN_SPEED:.0f} m/s, {len(tracks)} aircraft, '
          f'speed median {statistics.median(res["speed"]) if n else float("nan"):.0f} m/s')
    for key, unit in (('present', 'm'), ('shot', 'm'), ('lag', 's'), ('lead', 's'), ('wobble_mm', 'mm')):
        xs = res[key]
        if xs:
            print(f'  {key:8s} median {statistics.median(xs):7.3f} {unit}   p90 {pct(xs, 0.9):7.3f}   '
                  f'p10 {pct(xs, 0.1):7.3f}   n {len(xs)}')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1]))
