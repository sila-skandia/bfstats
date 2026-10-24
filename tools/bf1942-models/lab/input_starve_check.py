#!/usr/bin/env python3
"""Why each starved server tick ran no page word, from a sidecar session
recorded with `--word-log`.

The sidecar writes a `k:"iq"` row per control state (the server tick it
describes, the newest serial the server has run, `st` the ticks since the row
before that ran none of our records) and, with `--word-log`, a `k:"iw"` row
per record it put on the wire (serial `s`, page seq `q`, `r` when the page's
word reached the sidecar, `l` when it left; both on the rows' `t` clock) and
a `k:"im"` row per merge (`sidecar/input.mjs` `_mergePending`).

Between two rows the server ran the records whose serials lie between their
echoes, one a tick (D-3), and starved `st` ticks (D-4). The ticks are timed
back from the row's arrival (`t`, one tick per tick number; the server reads,
ticks and sends in one frame, D-1), and replayed: a tick runs the oldest of
those records that left the sidecar before it, else it starved, and the
starve is put down to the record that should have run there:

    page     the page's word had not reached the sidecar by the tick (the page
             made it late: a long frame, or a page clock short of the
             server's)
    held     it had reached the sidecar and waited there past the tick (the
             bucket, `_mayRelease`)
    stall    the next record was the sidecar's own idle one: the page had
             sent nothing for a quarter of a second (`idleAfterMs`)
    none     no record at all followed before the next row

    python3 lab/input_starve_check.py run.ndjson [--from S] [--to S] [--lead MS]
"""
import argparse
import bisect
import json
from collections import Counter

P = 1 / 30


def load(path):
    iq, iw, im = [], [], []
    with open(path) as f:
        for line in f:
            if '"k":"i' not in line:
                continue
            try:
                r = json.loads(line)
            except ValueError:
                continue
            k = r.get('k')
            if k == 'iq' and r.get('tick'):
                iq.append(r)
            elif k == 'iw':
                iw.append(r)
            elif k == 'im':
                im.append(r)
    return iq, iw, im


def newer(a, b):
    """Serial a newer than b (16-bit wrap, as input.mjs serialNewer)."""
    return 0 < ((a - b) & 0xFFFF) < 0x8000


def classify(iq, iw, lead=0.002, t_from=None, t_to=None):
    """Per starved tick, the reason; with the totals."""
    words = sorted(iw, key=lambda w: w['l'] if w.get('l') is not None else 0)
    rel_at = [w['l'] for w in words]
    reasons = Counter()
    out = []
    ticks = 0
    for prev, cur in zip(iq, iq[1:]):
        if t_from is not None and cur['t'] < t_from:
            continue
        if t_to is not None and cur['t'] > t_to:
            break
        dt = cur['tick'] - prev['tick']
        if dt <= 0 or dt > 60:
            continue
        ticks += dt
        st = cur.get('st', 0)
        if not st:
            continue
        # Records newer than the previous echo, in serial (= release) order,
        # from those released up to the row's arrival and a little after.
        lo = bisect.bisect_left(rel_at, prev['t'] - 2.0)
        cand = [w for w in words[lo:] if w.get('l') is not None and newer(w['s'], prev['serial'])]
        cand = [w for w in cand if w['l'] <= cur['t'] + 1.0]
        cand.sort(key=lambda w: (w['s'] - prev['serial']) & 0xFFFF)
        run = [w for w in cand if not newer(w['s'], cur['serial'])]
        nxt = [w for w in cand if newer(w['s'], cur['serial'])]
        k = 0
        found = []
        for j in range(prev['tick'] + 1, cur['tick'] + 1):
            T = cur['t'] - (cur['tick'] - j) * P - lead
            if k < len(run) and run[k]['l'] <= T:
                k += 1
                continue
            w = run[k] if k < len(run) else (nxt[0] if nxt else None)
            if w is None:
                why = 'none'
            elif w.get('r') is not None and w['r'] > T:
                why = 'page'
            elif w.get('idle'):
                why = 'stall'
            else:
                why = 'held'
            found.append((j, why, w))
        # The replay's timing is a few ms either way; the row's own count wins.
        while len(found) < st:
            w = run[k] if k < len(run) else (nxt[0] if nxt else None)
            found.append((cur['tick'], 'page' if w is None or (w.get('r') or 0) > cur['t'] - P else 'held', w))
        for j, why, w in found[:st]:
            reasons[why] += 1
            out.append({'t': cur['t'], 'tick': j, 'why': why, 'serial': w['s'] if w else None,
                        'late_ms': round(1000 * ((w.get('r') or w['l']) - (cur['t'] - (cur['tick'] - j) * P)), 1) if w else None})
    return {'ticks': ticks, 'starved': sum(reasons.values()), 'reasons': dict(reasons), 'rows': out}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('path')
    ap.add_argument('--from', dest='t_from', type=float)
    ap.add_argument('--to', dest='t_to', type=float)
    ap.add_argument('--lead', type=float, default=2.0, help='ms between a tick and its row leaving the server')
    ap.add_argument('--list', action='store_true')
    a = ap.parse_args()
    iq, iw, im = load(a.path)
    if not iw:
        print('no k:"iw" rows: run the sidecar with --word-log')
    r = classify(iq, iw, a.lead / 1000, a.t_from, a.t_to)
    pct = 100 * r['starved'] / r['ticks'] if r['ticks'] else 0
    print(f"{a.path}: {r['ticks']} ticks, {r['starved']} starved ({pct:.2f}%), by cause {r['reasons']}, merges {len(im)} ({sum(m['n'] for m in im)} words)")
    late = sorted(x['late_ms'] for x in r['rows'] if x['why'] == 'page' and x['late_ms'] is not None)
    if late:
        print(f"  page-late words: their arrival past the tick, ms: med {late[len(late) // 2]} max {late[-1]}")
    if a.list:
        for x in r['rows']:
            print(f"  t {x['t']:.3f} tick {x['tick']} {x['why']:5s} serial {x['serial']} {x['late_ms']} ms")


if __name__ == '__main__':
    main()
