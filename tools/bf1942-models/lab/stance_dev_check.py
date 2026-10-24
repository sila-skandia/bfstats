#!/usr/bin/env python3
"""Each of a human's rounds: the cone the server drew it in, against the law.

    python3 lab/stance_dev_check.py probe.ndjson replay_<unix>.ndjson [--weapon Bar1918]

Reads `lab/stance_dev_probe.mjs`'s log (every word sent, with its serial,
buttons and axes, and the phase marks) and the REC_FIRE_INDEX recorder's file
of the same run. A round's total is its offset from the launch frame's +Z
fitted to the draw at its own input index (`gi`, ledger DEV-9, DEV-14;
`dev_index_check.py fit_k`). The law is replayed tick by tick over the sent
words, one tick a serial (HandFireArms::updateDeviation, lnxded 0x08293e80,
at the end of BFSoldier::handlePlayerInput 0x08273c70), with the round's
bloom added at its tick (FireArms::Fire, DEV-4). Two readings of the misc
channel's gate are printed side by side:

  * `jump`: raised on the tick whose word carries Action while the soldier
    is armed on the ground (the bool at 0x08274d7d..0x08274d99: Action,
    the 0x3e6 bit 0x40 handleCollision sets, BFSoldier+0x3c8 null);
  * `air`: raised on every tick he is off the ground, taken here as the
    ~21 ticks of PHY-1's 0.70 s of air after the jump word.

The stance is the phase's (the marks); a crouch or a lie takes effect a
second after it is asked for, which the probe waits out.
"""
import argparse
import json
import math
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dev_index_check import fit_k, load, offsets, rounds_of  # noqa: E402

FIRE, ACTION, CROUCH = 1, 2, 1 << 21
CENTRE = 2048
AIR_TICKS = 21

DEV = {
    # viewer/models/<w>.report.json `deviation`, the .con's setXDev words.
    'Bar1918': {'min': 0.75, 'fire': [3.5, 0.25, 0.03], 'mod': [1.0, 0.85, 0.5],
                'turn': [0.0, 0.0, 0.0, 0.0], 'speed': [2.25, 0.2, 0.2, 0.1], 'misc': [2.5, 2.5, 0.1]},
}


class Law:
    def __init__(self, d):
        self.d = d
        self.fire = self.speed = self.turn = self.misc = 0.0
        self.total = 0.0

    @staticmethod
    def _channel(state, cap_a, decay_d, m, acc):
        cap = cap_a * m
        decay = decay_d / m
        if acc == 0:
            return max(state - decay, 0.0)
        if state < cap:
            return min(max(state + m * acc - decay, 0.0), cap)
        return max(state - decay, cap)

    def tick(self, stance, throttle, yaw, jumping):
        d = self.d
        m = d['mod'][('stand', 'crouch', 'prone').index(stance)]
        g = lambda v: 1.0 if abs(v) > 0.01 else 0.0  # noqa: E731
        sp = d['speed']
        self.speed = self._channel(self.speed, sp[0], sp[3], m, m * (sp[1] * g(throttle) + sp[2] * g(yaw)))
        mi = d['misc']
        self.misc = self._channel(self.misc, mi[0], mi[2], m, m * mi[1] * (1.0 if jumping else 0.0))
        self.fire = max(self.fire - d['fire'][2] / m, 0.0)
        self.total = d['min'] + self.fire + self.speed + self.turn + self.misc

    def shot(self):
        f = self.d['fire']
        self.fire = min(self.fire + f[1], f[0])


def axis(code):
    return (code - CENTRE) / 2047.0


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument('probe')
    ap.add_argument('server')
    ap.add_argument('--weapon', default='Bar1918')
    ap.add_argument('--barrel', type=int, default=-1)
    a = ap.parse_args(argv)

    probe = load(a.probe)
    spawn = next(r for r in probe if r['kind'] == 'spawn')
    sent = {r['serial']: r for r in probe if r['kind'] == 'sent'}
    marks = [r for r in probe if r['kind'] == 'mark']
    rows = load(a.server)
    pids = sorted({r['pid'] for r in rows if r.get('k') == 'f' and r.get('id') == spawn['netId']})
    rnds = [r for pid in pids for r in rounds_of(rows, pid)]
    lo, hi = min(sent), max(sent)
    rnds = [r for r in rnds if r.get('gi') is not None and lo <= r['gi'] <= hi]
    # The recorder's file is named for its round's start in unix seconds and
    # its `t` counts from there; keep the rounds inside the probe's own run
    # (two probes on one round reuse serials).
    m = re.search(r'replay_(\d+)', os.path.basename(a.server))
    if m:
        t0, t1 = probe[0]['wall'] / 1000, probe[-1]['wall'] / 1000
        rnds = [r for r in rnds if t0 - 2 <= int(m.group(1)) + r['t'] <= t1 + 2]
    rnds.sort(key=lambda r: r['gi'])
    by_gi = {r['gi']: r for r in rnds}

    def phase_at(ms):
        cur = ''
        for m in marks:
            if m['ms'] <= ms:
                cur = m['label']
        return cur

    def stance_at(label):
        return 'crouch' if label.startswith('crouch') else 'prone' if label.startswith(('prone', 'lie')) else 'stand'

    laws = {'jump': Law(DEV[a.weapon]), 'air': Law(DEV[a.weapon])}
    air_left = 0
    print(f'{len(rnds)} rounds of soldier {spawn["netId"]} (pids {pids}) at serials {lo}..{hi}')
    print(f'{"gi":>6} {"phase":44s} {"server":>7} {"resid":>6} {"jump":>7} {"air":>7}')
    sq = {'jump': [], 'air': []}
    for serial in range(lo, hi + 1):
        w = sent.get(serial)
        b = w['b'] if w else 0
        ax = w['ax'] if w else [CENTRE] * 6
        label = phase_at(w['ms']) if w else ''
        stance = stance_at(label)
        jumped = bool(b & ACTION) and stance == 'stand'
        if jumped:
            air_left = AIR_TICKS
        # A round reads the total the last update stored (DEV-12): the
        # update closes handlePlayerInput, so a round on this tick flies in
        # the previous tick's, and its bloom is in place for this tick's.
        r = by_gi.get(serial)
        if r is not None:
            res, tot = fit_k(offsets(r), (serial + a.barrel) & 0x3FF)
            law = {k: x.total for k, x in laws.items()}
            print(f'{serial:6d} {label[:44]:44s} {tot:7.3f} {res:6.3f} {law["jump"]:7.3f} {law["air"]:7.3f}')
            if res < 0.05:
                for k in sq:
                    sq[k].append(tot - law[k])
            for x in laws.values():
                x.shot()
        laws['jump'].tick(stance, axis(ax[3]), axis(ax[0]), jumped)
        laws['air'].tick(stance, axis(ax[3]), axis(ax[0]), air_left > 0)
        air_left = max(air_left - 1, 0)
    for k, v in sq.items():
        if v:
            n = len(v)
            rms = math.sqrt(sum(x * x for x in v) / n)
            worst = max(v, key=abs)
            print(f'{k:5s}: server - law rms {rms:.4f}, worst {worst:+.3f}, over {n} rounds')
    return 0


if __name__ == '__main__':
    sys.exit(main())
