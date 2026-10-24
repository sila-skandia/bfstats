#!/usr/bin/env python3
"""Each of a human's rounds on the tick of the word that fired it.

    python3 lab/mag_cycle_check.py probe.ndjson replay_<unix>.ndjson

Reads `lab/mag_cycle_probe.mjs`'s log (every word sent, with its serial and
buttons; the phase marks) and the REC_FIRE_INDEX recorder's file of the same
run. Prints, per phase, each round's weapon and input index (`gi`, ledger
DEV-14: the serial of the word whose tick fired it), the ticks since the
round before, the ticks since the phase's last press (reload or item), and
the run of rounds between gaps longer than the weapon's cycle: a magazine.
"""
import argparse
import json
import os
import re
import sys

FIRE, RELOAD, MENU2, MENU3 = 1, 1 << 16, 1 << 7, 1 << 8


def load(path):
    with open(path) as fh:
        return [json.loads(line) for line in fh if line.strip()]


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument('probe')
    ap.add_argument('server')
    a = ap.parse_args(argv)
    probe = load(a.probe)
    spawn = next(r for r in probe if r['kind'] == 'spawn')
    sent = {r['serial']: r for r in probe if r['kind'] == 'sent'}
    marks = [r for r in probe if r['kind'] == 'mark']
    lo, hi = min(sent), max(sent)
    m = re.search(r'replay_(\d+)', os.path.basename(a.server))
    t0, t1 = probe[0]['wall'] / 1000, probe[-1]['wall'] / 1000
    rows = [r for r in load(a.server) if r.get('k') == 'f' and r.get('id') == spawn['netId']
            and r.get('gi') is not None and lo <= r['gi'] <= hi
            and (not m or t0 - 2 <= int(m.group(1)) + r['t'] <= t1 + 2)]
    rows.sort(key=lambda r: r['gi'])

    def phase_at(serial):
        w = sent.get(serial)
        cur = ''
        for mk in marks:
            if w and mk['ms'] <= w['ms']:
                cur = mk['label']
        return cur

    # The presses: the first word of each run of a button.
    presses = []
    prev = 0
    for serial in range(lo, hi + 1):
        b = sent[serial]['b'] if serial in sent else 0
        for bit, name in ((RELOAD, 'reload'), (MENU2, 'item 2'), (MENU3, 'item 3'), (FIRE, 'fire')):
            if b & bit and not prev & bit:
                presses.append((serial, name))
        prev = b
    print(f'{len(rows)} rounds of soldier {spawn["netId"]} at serials {lo}..{hi}')
    last = None
    run = 0
    phase = None
    for r in rows:
        p = phase_at(r['gi'])
        if p != phase:
            phase = p
            print(f'\n== {p}')
        gap = r['gi'] - last['gi'] if last else None
        if last and (gap > 8 or r['w'] != last['w']):
            print(f'   -- {run} rounds of {last["w"]}')
            run = 0
        run += 1
        before = [x for x in presses if x[0] <= r['gi'] and x[1] != 'fire']
        since = f'{r["gi"] - before[-1][0]:4d} after {before[-1][1]}' if before else ''
        fires = [x for x in presses if x[0] <= r['gi'] and x[1] == 'fire']
        sincefire = r['gi'] - fires[-1][0] if fires else None
        print(f'{r["gi"]:6d} {r["w"]:10s} gap {gap if gap is not None else "-":>4}  {since:22s} fire-press +{sincefire}')
        last = r
    print(f'   -- {run} rounds of {last["w"] if last else "-"}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
