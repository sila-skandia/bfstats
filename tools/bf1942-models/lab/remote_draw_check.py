#!/usr/bin/env python3
"""How far the page's drawn remote soldiers and turning parts are from the
server's, per frame, at the frame's own render time.

Reads `remote_draw_probe.mjs`'s log. For every drawn frame it takes the
render time `t` the client drew at and puts the drawn pose against the
server's own track at that time (its samples, timed by the block's tick,
interpolated between the two that embrace `t`; frames whose `t` the server's
track does not yet embrace are left out). Per law (`new`, and `old` when the
probe ran one):

  soldier yaw   degrees between the drawn body facing and the server's
  soldier aim   degrees between the drawn aim register and the server's
                (the register as of each block, lerped between blocks)
  part          degrees between a drawn turning part and the server's, for
                parts turning faster than 5 deg/s at that moment
  ahead         the share of frames drawn past the newest sample the client
                had (extrapolated), and the render lead the client reported
  clock         the render time against retail's at the same moment: the
                last control state's (tick + words in flight) / 30, run on
                by the page time since, less interpolationTime (P-6); with
                the seconds of the run it was more than 30 ms off

    python3 lab/remote_draw_check.py draw.ndjson
"""
import bisect
import json
import math
import sys

TICK = 30.0


def pct(xs, q):
    xs = sorted(xs)
    if not xs:
        return float('nan')
    return xs[min(len(xs) - 1, int(q * (len(xs) - 1) + 0.5))]


def wrap(d):
    return (d + 180.0) % 360.0 - 180.0


def page_q(qx, qy, qz, qw):
    return (-qx, -qy, qz, qw)


def soldier_yaw(q):
    x, y, z, w = q
    yaw = math.degrees(math.atan2(2 * (w * y + x * z), 1 - 2 * (x * x + y * y))) + 180
    return wrap(yaw)


def q_angle(a, b):
    d = abs(sum(i * j for i, j in zip(a, b)))
    return math.degrees(2 * math.acos(min(1.0, d)))


def nlerp(a, b, k):
    if sum(i * j for i, j in zip(a, b)) < 0:
        b = tuple(-v for v in b)
    q = tuple(i + (j - i) * k for i, j in zip(a, b))
    n = math.sqrt(sum(v * v for v in q)) or 1
    return tuple(v / n for v in q)


def embrace(times, t):
    i = bisect.bisect_right(times, t)
    if i == 0 or i >= len(times):
        return None
    a, b = i - 1, i
    gap = times[b] - times[a]
    if not 0 < gap <= 0.5:
        return None
    return a, b, (t - times[a]) / gap


def summary(name, xs):
    if not xs:
        return f'{name}: none'
    return (f'{name}: n={len(xs)} p50 {pct(xs, .5):.2f} p90 {pct(xs, .9):.2f} '
            f'p99 {pct(xs, .99):.2f} max {max(xs):.1f} mean {sum(xs) / len(xs):.3f}')


def main(path):
    rows = [json.loads(l) for l in open(path) if l.strip()]
    tracks = {}   # nid -> [(t, x, z, yaw)]
    aims = {}     # nid -> [(t, pitch)] changes
    parts = {}    # (root, nid) -> [(t, q)]
    names = {}    # (root, name) -> nid
    arrive = {}   # nid -> [(p, t)] when each sample arrived
    for r in rows:
        k = r['kind']
        if k == 's' and r.get('tick') is not None:
            t = r['tick'] / TICK
            for nid, x, z, qx, qy, qz, qw in r['o']:
                tracks.setdefault(nid, []).append((t, x, -z, soldier_yaw(page_q(qx, qy, qz, qw))))
                arrive.setdefault(nid, []).append((r['p'], t))
        elif k == 'st' and r.get('tick') is not None:
            t = r['tick'] / TICK
            for nid, pitch, twist in r['o']:
                aims.setdefault(nid, []).append((t, pitch))
        elif k == 'j' and r.get('tick') is not None:
            t = r['tick'] / TICK
            for root, nid, qx, qy, qz, qw in r['o']:
                parts.setdefault((root, nid), []).append((t, page_q(qx, qy, qz, qw)))
                arrive.setdefault((root, nid), []).append((r['p'], t))
        elif k == 'jn':
            for root, nid, name in r['o']:
                names[(root, name)] = nid
    for d in (tracks, aims, parts):
        for key, h in d.items():
            h.sort(key=lambda e: e[0])
            dedup = []
            for e in h:
                if dedup and dedup[-1][0] == e[0]:
                    dedup[-1] = e
                else:
                    dedup.append(e)
            d[key] = dedup

    def aim_asof(nid, t):
        h = aims.get(nid)
        if not h:
            return None
        i = bisect.bisect_right([e[0] for e in h], t + 1e-6) - 1
        return h[max(0, i)][1]

    arrive_p = {key: ([e[0] for e in sorted(h)], [e[1] for e in sorted(h)]) for key, h in arrive.items()}

    def newest_at(key, p):
        ps, ts = arrive_p.get(key, ([], []))
        i = bisect.bisect_right(ps, p)
        return max(ts[:i]) if i else None

    res = {}
    leads = {}
    for r in rows:
        if r['kind'] == 'lead':
            leads.setdefault(r['law'], []).append(r['lead'])
        if r['kind'] == 'draw':
            t = r['t']
            # the soldier this slot is: the track nearest the drawn spot at t
            best = None
            for nid, h in tracks.items():
                times = [e[0] for e in h]
                e = embrace(times, t)
                if not e:
                    continue
                a, b, kk = e
                x = h[a][1] + (h[b][1] - h[a][1]) * kk
                z = h[a][2] + (h[b][2] - h[a][2]) * kk
                dist = math.hypot(x - r['x'], z - r['z'])
                if dist < 3 and (best is None or dist < best[0]):
                    yaw = h[a][3] + wrap(h[b][3] - h[a][3]) * kk
                    pa, pb = aim_asof(nid, h[a][0]), aim_asof(nid, h[b][0])
                    aim = None if pa is None else pa + (pb - pa) * kk
                    best = (dist, nid, yaw, aim)
            if not best:
                continue
            _, nid, yaw, aim = best
            s = res.setdefault(r['law'], {'yaw': [], 'aim': [], 'part': [], 'partBehind': [], 'ahead': [0, 0]})
            s['yaw'].append(abs(wrap(r['yaw'] - yaw)))
            if aim is not None:
                s['aim'].append(abs(r['aim'] - aim))
            na = newest_at(nid, r['p'])
            if na is not None:
                s['ahead'][0] += t > na
                s['ahead'][1] += 1
        elif r['kind'] == 'part':
            t = r['t']
            s = res.setdefault(r['law'], {'yaw': [], 'aim': [], 'part': [], 'partBehind': [], 'ahead': [0, 0]})
            for name, *q in r['parts']:
                nid = names.get((r['id'], name))
                h = parts.get((r['id'], nid))
                if not h:
                    continue
                times = [e[0] for e in h]
                e = embrace(times, t)
                if not e:
                    continue
                a, b, kk = e
                speed = q_angle(h[a][1], h[b][1]) / (h[b][0] - h[a][0])
                if speed < 5:
                    continue
                truth = nlerp(h[a][1], h[b][1], kk)
                err = q_angle(tuple(q), truth)
                s['part'].append(err)
                na = newest_at((r['id'], nid), r['p'])
                if na is not None and t < na:
                    s['partBehind'].append(err)
    acks = [r for r in rows if r['kind'] == 'ack' and r.get('tick') is not None]
    acks.sort(key=lambda r: r['p'])
    ack_p = [r['p'] for r in acks]
    first = min((r['p'] for r in rows if 'p' in r), default=0)
    for law in sorted({r.get('law', 'new') for r in rows if r['kind'] == 'clock'}):
        errs, off = [], []
        for r in rows:
            if r['kind'] != 'clock' or r.get('law', 'new') != law:
                continue
            i = bisect.bisect_right(ack_p, r['p']) - 1
            if i < 0:
                continue
            a = acks[i]
            retail = (a['tick'] + max(0, a['sent'] - a['seq'])) / TICK + (r['p'] - a['p']) / 1000 - 0.1
            e = r['t'] - retail
            errs.append(abs(e))
            if abs(e) > 0.03:
                off.append(((r['p'] - first) / 1000, e))
        print(f'[{law}] ' + summary('clock vs retail, s', errs))
        spans = []
        for o in off:
            if spans and o[0] - spans[-1][1][0] <= 0.1:
                spans[-1][1] = o
            else:
                spans.append([o, o])
        for a, b in spans[:20]:
            print(f'  off by > 30 ms from {a[0]:.1f} s to {b[0]:.1f} s ({a[1]:+.3f} .. {b[1]:+.3f})')
    for law, s in sorted(res.items()):
        lead = leads.get(law, [])
        ahead = s['ahead']
        print(f'[{law}] lead p50 {pct(lead, .5):.3f} s; soldier frames past the newest sample '
              f'{ahead[0]}/{ahead[1]}')
        print('  ' + summary('soldier yaw', s['yaw']))
        print('  ' + summary('soldier aim', s['aim']))
        print('  ' + summary('part (moving)', s['part']))
        print('  ' + summary('part (moving), drawn before the newest sample', s['partBehind']))
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1]))
