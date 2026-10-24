#!/usr/bin/env python3
"""Read `lab/input_pace_probe.mjs` runs: press to the tick that ran it, the
backlog, starvation and the recovery after each stall.

Per press: the first word made after it, and the tick that ran that word,
timed as the first ack whose serial reaches it, less one tick per record
sent after it up to that serial (records are run one a tick, D-3). The
backlog `iq + sq` and the starved ticks are the sidecar's own (`atAck`).

    python3 lab/input_pace_check.py run.json [more.json ...]
"""
import bisect
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

P = 1000 / 30


def q(xs):
    xs = sorted(x for x in xs if x is not None)
    if not xs:
        return 'n=0'
    n = len(xs)
    return f'n={n} p10 {xs[int(n * 0.1)]:.0f} med {xs[n // 2]:.0f} p90 {xs[min(n - 1, int(n * 0.9))]:.0f} max {xs[-1]:.0f}'


def share(xs):
    from collections import Counter
    c = Counter(xs)
    n = len(xs) or 1
    return ' '.join(f'{k}:{100 * c[k] / n:.0f}%' for k in sorted(c))


def analyse(d):
    acks = sorted((a for a in d['acks'] if a.get('tick')), key=lambda a: a['at'])
    sent = sorted(x['serial'] for x in d['sent'])
    out = {'pressWord': [], 'pressRan': [], 'wordRan': []}
    aser = [a['serial'] for a in acks]
    for w in d['words']:
        # The record that carried this word: itself, or the merge it went into.
        i = bisect.bisect_left(sent, w['serial'])
        if i >= len(sent):
            continue
        carrier = sent[i]
        k = next((j for j, a in enumerate(acks) if a['serial'] >= carrier and a['at'] >= w['at']), None)
        if k is None:
            continue
        a = acks[k]
        later = bisect.bisect_right(sent, a['serial']) - bisect.bisect_right(sent, carrier)
        ran = a['at'] - later * P
        out['wordRan'].append(ran - w['at'])
        if w.get('press') is not None:
            out['pressWord'].append(w['at'] - w['press'])
            out['pressRan'].append(ran - w['press'])
    t0 = acks[0]['at'] if acks else 0
    settled = [a for a in acks if a['at'] > t0 + 3000]   # past the join's first seconds
    out['backlog'] = [a['iq'] + a['sq'] for a in settled]
    ticks = (settled[-1]['tick'] - settled[0]['tick']) if len(settled) > 1 else 0
    out['ticks'] = ticks
    out['starved'] = sum(a['st'] for a in settled)
    stall_win = [(s['at'], s['at'] + s['ms'] + 250) for s in d.get('stalls', [])]
    in_stall = lambda t: any(lo <= t <= hi for lo, hi in stall_win)
    out['starvedOutside'] = sum(a['st'] for a in settled if not in_stall(a['at']))
    rec = []
    for s in d.get('stalls', []):
        end = s['at'] + s['ms']
        after = [a for a in acks if a['at'] >= end]
        t_ok = None
        for i, a in enumerate(after):
            if a['iq'] + a['sq'] <= 1 and all(b['iq'] + b['sq'] <= 1 for b in after[i:] if b['at'] < a['at'] + 1000):
                t_ok = a['at'] - end
                break
        rec.append(t_ok)
    out['recover'] = rec
    out['lead'] = [a['ld'] for a in settled if a.get('ld') is not None]
    return out


def starve_causes(d):
    """Each starved tick put down to its word (`input_starve_check.py`'s
    replay), from the probe's own word log: made (`words[].at`), released
    (`sent[].at`), on one clock."""
    import input_starve_check as sc
    made = {w['serial']: w['at'] for w in d['words']}
    iq = [{'t': a['at'] / 1000, 'tick': a['tick'], 'serial': a['serial'], 'st': a['st']}
          for a in sorted(d['acks'], key=lambda a: a['at']) if a.get('tick')]
    iw = [{'s': x['serial'], 'r': made.get(x['serial'], x['at']) / 1000, 'l': x['at'] / 1000, 'idle': bool(x.get('idle'))}
          for x in d['sent']]
    t0 = iq[0]['t'] + 3 if iq else None
    return sc.classify(iq, iw, 0.002, t0, None)


def main(paths):
    for path in paths:
        d = json.load(open(path))
        r = analyse(d)
        print(path, d.get('mode'))
        print(f'  press -> word ms      {q(r["pressWord"])}')
        print(f'  press -> server ran   {q(r["pressRan"])}')
        print(f'  word -> server ran    {q(r["wordRan"])}')
        print(f'  acked word wait ms    {q(r["lead"])}')
        print(f'  backlog iq+sq         {share(r["backlog"])}  mean {sum(r["backlog"]) / max(1, len(r["backlog"])):.2f}')
        pct = 100 * r['starved'] / r['ticks'] if r['ticks'] else 0
        pct2 = 100 * r['starvedOutside'] / r['ticks'] if r['ticks'] else 0
        print(f'  starved ticks         {r["starved"]} ({pct:.2f}%), outside stalls {r["starvedOutside"]} ({pct2:.2f}%) of {r["ticks"]}')
        if d.get('merges') is not None:
            c = starve_causes(d)
            print(f'  starved by cause      {c["reasons"]} (replayed {c["starved"]} of the rows\' count), merges {len(d.get("merges") or [])}')
        fm = sorted(d.get('frameMs') or [])
        if fm:
            print(f'  frame ms              med {fm[len(fm) // 2]:.1f} p99 {fm[min(len(fm) - 1, int(len(fm) * 0.99))]:.1f} max {fm[-1]:.1f}')
        if r['recover']:
            never = sum(1 for x in r['recover'] if x is None)
            print(f'  stalls {len(r["recover"])}: backlog <= 1 after ms {q(r["recover"])}, never {never}')
        if d.get('pace'):
            print(f'  pacer at the end      {d["pace"]}  sender {d.get("path")}')


if __name__ == '__main__':
    main(sys.argv[1:])
