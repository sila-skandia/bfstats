#!/usr/bin/env python3
"""Time each tap of `lab/hit_reg_probe.cjs` from the trigger to the crosshair.

Per tap: the first page word after the press, the server tick that ran it
(from the ack whose seq it is, or the first ack past it), the server's first
round the sidecar saw, the hitMark row reaching the page, and the frame where
the HUD's CrossHair/HitIndicationTime rose. Times are page milliseconds from
the press. Below, the input path's standing state: words in flight at each
ack, the sidecar's queue (`iq`), and a page word's time from send to the tick
that ran it (against the fastest block's receipt, so transit counts as zero).

    python3 lab/hit_reg_check.py out.json [more.json ...]
"""
import json
import sys

P = 1000 / 30


def q(xs):
    xs = sorted(x for x in xs if x is not None)
    if not xs:
        return 'n=0'
    n = len(xs)
    return f'n={n} min {xs[0]:.0f} med {xs[n // 2]:.0f} p90 {xs[min(n - 1, int(n * 0.9))]:.0f} max {xs[-1]:.0f}'


def analyse(d):
    out = {o['seq']: o['p'] for o in d['out']}
    seqs = sorted(out)
    inn = d['inn']
    acks = [r for r in inn if r['k'] == 'ack' and r.get('tick') is not None]
    ticked = acks
    off = min(r['p'] - r['tick'] * P for r in ticked)          # tick -> page ms
    soff = min(r['p'] - r['t'] * 1000 for r in inn if r.get('t') is not None)  # sidecar s -> page ms
    pid = d['slot'] - 1 if isinstance(d.get('slot'), int) else None  # rooms are 1.., pids 0..
    rows = []
    for t in d['trig']:
        if not t['on']:
            continue
        first = next((s for s in seqs if out[s] >= t['p']), None)
        run = next((a for a in acks if first is not None and a['seq'] >= first), None)
        fire = next((r for r in inn if r['k'] == 'f' and (pid is None or r.get('pid') == pid)
                     and r['t'] * 1000 + soff >= t['p'] - 5), None)
        hit = next((r for r in inn if r['k'] == 'hit' and t['p'] <= r['p'] < t['p'] + 800), None)
        hud = next((h for h in d.get('hud', []) if t['p'] <= h['p'] < t['p'] + 800), None)
        rows.append({
            'word': out[first] - t['p'] if first else None,
            'ran': run['tick'] * P + off - t['p'] if run else None,
            'round': fire['p'] - t['p'] if fire else None,
            'hit': hit['p'] - t['p'] if hit else None,
            'hud': hud['p'] - t['p'] if hud else None,
        })
    # The input path's state while the taps ran (the walk and the load
    # before them run at other frame rates).
    if d['trig']:
        lo, hi = d['trig'][0]['p'] - 1000, d['trig'][-1]['p'] + 1000
        acks = [a for a in acks if lo <= a['p'] <= hi]
    flight = []
    for a in acks:
        sent = max((s for s in seqs if out[s] <= a['p']), default=None)
        if sent is not None:
            flight.append(sent - a['seq'])
    send_run = [a['tick'] * P + off - out[a['seq']] for a in acks if a['seq'] in out]
    return rows, flight, [a.get('iq') for a in acks], send_run, d.get('pace', [])


def main(paths):
    for path in paths:
        rows, flight, iq, send_run, pace = analyse(json.load(open(path)))
        print(path)
        print(f'  taps {len(rows)}, marked {sum(1 for r in rows if r["hit"] is not None)}')
        for k in ('word', 'ran', 'round', 'hit', 'hud'):
            print(f'  press -> {k:5s} ms  {q([r[k] for r in rows])}')
        print(f'  words in flight at an ack   {q(flight)}')
        print(f'  sidecar queue (iq) at an ack {q(iq)}')
        print(f'  word sent -> tick ran it ms  {q(send_run)}')
        if pace:
            slow = sum(1 for x in pace if x.get('scale') is not None and x['scale'] < 1)
            print(f'  page clock slowed in {slow} of {len(pace)} samples')


if __name__ == '__main__':
    main(sys.argv[1:])
