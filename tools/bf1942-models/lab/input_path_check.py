#!/usr/bin/env python3
"""The page's input path over a sidecar session, from its run.ndjson.

`sidecar.mjs` writes one `k:"iq"` row per control-object state it reads (20 a
second while the player is alive; `sidecar/input.mjs` `InputSender.atAck`):

    iq   page words waiting in the sidecar's queue
    sq   records on the wire the server holds unrun (its ActionBuffer, D-2/D-3)
    st   server ticks since the row before that ran none of our records (D-4)
    tr   records the server skipped (D-2's trim), when any
    ld   ms from the acked word reaching the sidecar to the block saying it ran
    hd   ms of that spent in the sidecar's queue

The backlog `iq + sq` is how many ticks every word waits beyond the one that
runs it; starved ticks are the server running zero input for this player.
This prints both over the run, and per window with `--every S`, so a session
the owner played can be read afterwards (did the backlog stand, did a hitch
leave it high, how often the server starved).

    python3 lab/input_path_check.py run.ndjson [--every 60] [--from S] [--to S]
"""
import argparse
import json
from collections import Counter


def rows_of(path):
    out = []
    with open(path) as f:
        for line in f:
            if '"k":"iq"' not in line:
                continue
            try:
                r = json.loads(line)
            except ValueError:
                continue
            if r.get('k') == 'iq':
                out.append(r)
    return out


def quant(xs):
    xs = sorted(x for x in xs if x is not None)
    if not xs:
        return 'n=0'
    n = len(xs)
    pick = lambda f: xs[min(n - 1, int(n * f))]
    return f'n={n} p10 {pick(0.1):.1f} med {xs[n // 2]:.1f} p90 {pick(0.9):.1f} max {xs[-1]:.1f}'


def share(xs):
    c = Counter(xs)
    n = len(xs) or 1
    return ' '.join(f'{k}:{100 * c[k] / n:.1f}%' for k in sorted(c))


def summarise(rows):
    """The numbers one window prints, as a dict (tests read it)."""
    back = [r['iq'] + r['sq'] for r in rows]
    ticks = 0
    prev = None
    for r in rows:
        t = r.get('tick')
        if prev is not None and t is not None and t >= prev:
            ticks += t - prev
        prev = t if t is not None else prev
    starved = sum(r.get('st', 0) for r in rows)
    return {
        'acks': len(rows),
        'ticks': ticks,
        'backlog': Counter(back),
        'iq': Counter(r['iq'] for r in rows),
        'sq': Counter(r['sq'] for r in rows),
        'starved': starved,
        'starvedPct': 100 * starved / ticks if ticks else 0.0,
        'trimmed': sum(r.get('tr', 0) for r in rows),
        'lead': [r['ld'] for r in rows if r.get('ld') is not None],
        'hold': [r['hd'] for r in rows if r.get('hd') is not None],
    }


def report(label, rows):
    s = summarise(rows)
    back = [r['iq'] + r['sq'] for r in rows]
    print(f'{label}: {s["acks"]} acks over {s["ticks"]} server ticks')
    print(f'  backlog iq+sq   {share(back)}  (mean {sum(back) / max(1, len(back)):.2f} words)')
    print(f'  sidecar iq      {share([r["iq"] for r in rows])}')
    print(f'  server sq       {share([r["sq"] for r in rows])}')
    print(f'  starved ticks   {s["starved"]} ({s["starvedPct"]:.2f}%), trimmed {s["trimmed"]}')
    print(f'  word wait ms    {quant(s["lead"])}  (sidecar receipt -> the tick that ran it)')
    print(f'  of it queued ms {quant(s["hold"])}')


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('run')
    ap.add_argument('--every', type=float, default=0, help='also print per window of this many seconds')
    ap.add_argument('--from', dest='t0', type=float, default=None, help='sidecar seconds to start at')
    ap.add_argument('--to', dest='t1', type=float, default=None)
    a = ap.parse_args(argv)
    rows = rows_of(a.run)
    if a.t0 is not None:
        rows = [r for r in rows if r['t'] >= a.t0]
    if a.t1 is not None:
        rows = [r for r in rows if r['t'] <= a.t1]
    if not rows:
        print('no k:"iq" rows (a sidecar from before 2026-10-24, or no page played)')
        return 1
    report(f'{a.run} t {rows[0]["t"]:.0f}-{rows[-1]["t"]:.0f} s', rows)
    if a.every > 0:
        start = rows[0]['t']
        win = []
        for r in rows:
            if r['t'] >= start + a.every and win:
                report(f'  window t {start:.0f}-{start + a.every:.0f} s', win)
                start += a.every * int((r['t'] - start) // a.every)
                win = []
            win.append(r)
        if win:
            report(f'  window t {start:.0f}-{win[-1]["t"]:.0f} s', win)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
