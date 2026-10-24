#!/usr/bin/env python3
"""Read `seat_swing_probe.cjs` output: the page's turret against the server's
at every acknowledged tick, during and after fast swings, on first boarding
and after getting out and back in.

Two measures per ack:

* `deltas`: per rig axis, the server's angle at the acked tick less the
  page's own angle at that same tick (net-room.js `correctSeatAim`), the
  page's prediction error in the rig's own numbers, before the ack closes it;
* `drawn`: per rig node, the angle between the page's DRAWN part (its
  rotation relative to the hull root) and the server's part of the same name
  (the sidecar's joint row from the same control state). This sees what the
  numbers cannot: a rig whose zero is not the part's rest. The server's row
  is the acked tick and the page's the present, so it is read only with the
  hand still for a second (the gun at rest on both sides).

Rows are split by phase (first boarding, after re-entering) and by whether
the hand moved in the last 0.5 s ("swinging") or has been still for a
second ("still").

    python3 lab/seat_swing_check.py out.json [--rows]
"""
import json
import statistics
import sys


def pct(xs, q):
    xs = sorted(xs)
    return xs[min(len(xs) - 1, int(q * (len(xs) - 1) + 0.5))] if xs else float('nan')


def main(argv):
    d = json.load(open(argv[1]))
    show = '--rows' in argv
    frames, acks = d['frames'], d['acks']
    marks = d.get('marks') or []
    # Everything after getting out is the second boarding's (the rig is
    # rebuilt the moment he is back in, before the probe marks it).
    reenter = next((m['p'] for m in marks if m['what'] == 'exit'), None)
    moving = [f['p'] for f in frames if f['dx'] or f['dy']]
    names = [a[0] for a in frames[0]['axes']] if frames else []

    def since_move(p):
        last = None
        for m in moving:
            if m <= p:
                last = m
            else:
                break
        return (p - last) if last is not None else 1e9

    out = {}
    for a in acks:
        phase = 'reentered' if reenter is not None and a['p'] >= reenter else 'first'
        sm = since_move(a['p'])
        motion = 'swinging' if sm < 500 else ('still' if sm > 1000 else 'settling')
        ds = a.get('deltas') or []
        dr = a.get('drawn') if isinstance(a.get('drawn'), list) else None
        if show:
            print('%9.1f %-9s %-8s deltas %s drawn %s' % (a['p'], phase, motion,
                  ' '.join('%+.3f' % x for x in ds), dr))
        g = out.setdefault((phase, motion), {'delta': [[] for _ in names], 'drawn': [[] for _ in names]})
        for k in range(len(names)):
            if k < len(ds) and ds[k] is not None:
                g['delta'][k].append(abs(ds[k]))
            if dr and k < len(dr) and isinstance(dr[k], (int, float)):
                g['drawn'][k].append(dr[k])
    # The drawn view against the rig's numbers: with the hull still, the
    # view's heading plus the traverse, and its pitch plus the elevation,
    # are constants of the seat; a step between boardings is a rig whose
    # zero is not the parts' rest.
    for phase in ('first', 'reentered'):
        ys, ps = [], []
        for a in acks:
            ph = 'reentered' if reenter is not None and a['p'] >= reenter else 'first'
            if ph != phase or not a.get('cam') or since_move(a['p']) < 1000:
                continue
            rows = {r['axis']: r for r in (a.get('rows') or [])}
            if 'yaw' in rows:
                ys.append(((a['cam'][0] + rows['yaw']['page']) + 180) % 360 - 180)
            if 'pitch' in rows:
                ps.append(a['cam'][1] + rows['pitch']['page'])
        if ys:
            print('%-9s view heading + traverse: median %.3f (spread %.3f, n %d)' % (phase, statistics.median(ys), pct(ys, 0.9) - pct(ys, 0.1), len(ys)))
        if ps:
            print('%-9s view pitch + elevation:  median %.3f (spread %.3f, n %d)' % (phase, statistics.median(ps), pct(ps, 0.9) - pct(ps, 0.1), len(ps)))
    print('acks', len(acks), 'fixes', d.get('fixes'))
    for (phase, motion), g in sorted(out.items()):
        for k, n in enumerate(names):
            xs = g['delta'][k]
            if xs:
                print('%-9s %-8s %-5s numbers |err| n %4d median %.4f p90 %.4f p99 %.4f max %.4f  over 0.1: %d' % (
                    phase, motion, n, len(xs), statistics.median(xs), pct(xs, 0.9), pct(xs, 0.99), max(xs),
                    sum(1 for x in xs if x > 0.1)))
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
