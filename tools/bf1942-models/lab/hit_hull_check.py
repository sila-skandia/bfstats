#!/usr/bin/env python3
"""Where the server's rounds went against the hull the page held its crosshair
on (`lab/hit_hull_probe.cjs`).

From the probe sidecar's recording: this player's rounds (`f` rows: the
server's eye and direction, written at the block that showed the round) and
the target hull's server track (`s` rows, every block, with its tick). Each
round flies straight at SPEED m/s from the tick before its block's (half a tick
either way); the closest it comes to the hull's origin, and that offset in the
hull's own frame, says whether it could have hit. Hit marks are the server's
word that one did (ledger XHIT-6).

    python3 lab/hit_hull_check.py out.json run.ndjson [--pid N] [--speed 1000]
"""
import argparse
import json
import math

P = 1 / 30


def qrot(q, v):
    x, y, z, w = q
    # v' = q v q*
    ix = w * v[0] + y * v[2] - z * v[1]
    iy = w * v[1] + z * v[0] - x * v[2]
    iz = w * v[2] + x * v[1] - y * v[0]
    iw = -x * v[0] - y * v[1] - z * v[2]
    return [ix * w + iw * -x + iy * -z - iz * -y,
            iy * w + iw * -y + iz * -x - ix * -z,
            iz * w + iw * -z + ix * -y - iy * -x]


def qinv(q):
    return [-q[0], -q[1], -q[2], q[3]]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('probe')
    ap.add_argument('run')
    ap.add_argument('--pid', type=int, default=None)
    ap.add_argument('--speed', type=float, default=1000.0)
    a = ap.parse_args()
    probe = json.load(open(a.probe))
    targets = {int(k): v for k, v in (probe.get('targets') or {}).items()}
    rows = [json.loads(l) for l in open(a.run) if l.strip()]
    pid = a.pid
    if pid is None:
        # The sidecar's own player: the pid of the `control` events it was given.
        hdr = next((r for r in rows if r.get('k') == 'e' and r.get('e') == 'createPlayer'), None)
        pid = hdr.get('pid') if hdr else 0
    tick_at = {}
    track = {i: [] for i in targets}
    for r in rows:
        if r.get('k') == 's' and r.get('tick') is not None:
            tick_at.setdefault(round(r['t'], 3), r['tick'])
            for o in r.get('o', []):
                if o[0] in track:
                    track[o[0]].append((r['tick'], o[1:4], o[4:8]))
    for i in track:
        track[i].sort(key=lambda x: x[0])

    def at(i, tk):
        tr = track[i]
        if not tr or tk < tr[0][0] or tk > tr[-1][0] + 3:
            return None
        for (k0, p0, q0), (k1, p1, q1) in zip(tr, tr[1:]):
            if k0 <= tk <= k1 and k1 > k0:
                u = (tk - k0) / (k1 - k0)
                return [p0[j] + (p1[j] - p0[j]) * u for j in range(3)], q1 if u > 0.5 else q0
        k, p, q = tr[-1]
        return p, q

    fires = [r for r in rows if r.get('k') == 'f' and r.get('pid') == pid and r.get('p') and r.get('d')]
    marks = [r['t'] for r in rows if r.get('k') == 'e' and r.get('e') == 'hitMark']
    print(f'pid {pid}: {len(fires)} rounds with a direction, {len(marks)} hit marks; targets {targets}')
    near = []
    for f in fires:
        tk = tick_at.get(round(f['t'], 3))
        if tk is None:
            continue
        t0 = tk - 0.5
        best = None
        for i in track:
            for step in range(0, 400):
                tau = step * 0.0025
                w = at(i, t0 + tau / P)
                if w is None:
                    break
                pos, q = w
                rp = [f['p'][j] + f['d'][j] * a.speed * tau for j in range(3)]
                dv = [rp[j] - pos[j] for j in range(3)]
                dist = math.sqrt(sum(x * x for x in dv))
                if best is None or dist < best[0]:
                    best = (dist, i, tau, qrot(qinv(q), dv))
        # The lag the aim carried: the track shifted back by `lag` seconds
        # (the hull where it was that long before), the shift that brings the
        # round closest to it.
        lag_best = None
        if best:
            i = best[1]
            for lag_ms in range(0, 401, 10):
                lag = lag_ms / 1000
                for step in range(0, 400):
                    tau = step * 0.0025
                    w = at(i, t0 + (tau - lag) / P)
                    if w is None:
                        break
                    pos, _ = w
                    rp = [f['p'][j] + f['d'][j] * a.speed * tau for j in range(3)]
                    dist = math.dist(rp, pos)
                    if lag_best is None or dist < lag_best[0]:
                        lag_best = (dist, lag)
            near.append((f['t'], *best, lag_best))
    lags = []
    for t, dist, i, tau, local, lag in near:
        mark = any(0 <= m - t <= 1.0 for m in marks)
        lags.append(lag[1])
        print(f'  t {t:8.3f}  {targets[i]:10s} closest {dist:6.2f} m at {tau * 1000:4.0f} ms'
              f'  hull frame x {local[0]:+6.2f} y {local[1]:+6.2f} z {local[2]:+6.2f}'
              f'  | aimed at the hull {lag[1] * 1000:3.0f} ms back: {lag[0]:5.2f} m  {"MARK" if mark else ""}')
    # The page's own record: each burst's lead and the marks that came back
    # within 0.8 s of its release (the probe's clock).
    trig = probe.get('trig') or []
    hits = [r['p'] for r in probe.get('inn', []) if r.get('k') == 'hit']
    by = {}
    for k, t in enumerate(trig):
        if not t.get('on'):
            continue
        off = next((x['p'] for x in trig[k + 1:] if not x.get('on')), t['p'] + 400)
        n = sum(1 for h in hits if t['p'] < h <= off + 800)
        b = by.setdefault(t.get('lead', 0), [0, 0])
        b[0] += 1
        b[1] += n
    for lead in sorted(by):
        print(f'  lead {lead:.2f} s beyond the flight: {by[lead][0]} bursts, {by[lead][1]} marks')
    if lags:
        lags.sort()
        print(f'  aim lag: median {lags[len(lags) // 2] * 1000:.0f} ms (min {lags[0] * 1000:.0f}, max {lags[-1] * 1000:.0f})')


if __name__ == '__main__':
    main()
