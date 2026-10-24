#!/usr/bin/env python3
"""Read a `zoom_look_probe.mjs` run: each look phase's change of the server's
aim register (aimA, pitch) and twist (aimB), against what the words asked
for at the hip.

    python3 lab/zoom_look_check.py probe.ndjson

A phase's change is the acked register after the still phase that follows it
less the acked register before it. "asked" is the phase's summed axis (the
law: register -= axis per tick, zoom scaling it); "ratio" is change / asked.
At the hip the ratio is 1; zoomed it is the weapon's zoomFov if the server
scales the axis it receives (the No4's 0.4).
"""
import json
import sys


def main(path):
    with open(path) as f:
        rows = [json.loads(l) for l in f]
    phases, words, cs = [], {}, []
    for r in rows:
        if r['kind'] == 'phase':
            phases.append(r)
        elif r['kind'] == 'word':
            words.setdefault(r['phase'], []).append(r)
        elif r['kind'] == 'cs' and r.get('cls') == 'BFSoldierNetworkable' and r.get('aimA') is not None:
            cs.append(r)

    def reg_at(ms):
        """The registers of the newest control state at or before wall clock
        `ms` (the control state's seq is a 6-bit wrap, so the probe's wall
        clock orders them; a still phase of 30 ticks covers the round trip)."""
        best = None
        for c in cs:
            if c['ms'] > ms:
                break
            best = c
        return best

    out = []
    for i, p in enumerate(phases):
        st = p['st']
        if not (st.get('lookX') or st.get('lookY')):
            continue
        w = words.get(p['phase'], [])
        nxt = words.get(p['phase'] + 1, [])
        if not w or not nxt:
            continue
        before = reg_at(w[0]['ms'])
        after = reg_at(nxt[-1]['ms'])
        if not before or not after:
            continue
        for axis, reg in (('lookY', 'aimA'), ('lookX', 'aimB')):
            v = st.get(axis)
            if not v:
                continue
            asked = v * len(w)
            got = -(after[reg] - before[reg])
            # The server's zoom bit (state bits 0x20) over the phase's words.
            bits = {bool(c['bits'] & 0x20) for c in cs
                    if c.get('bits') is not None and w[0]['ms'] + 200 <= c['ms'] <= w[-1]['ms']}
            out.append({'label': p['label'], 'axis': axis, 'asked': round(asked, 3),
                        'got': round(got, 3), 'ratio': round(got / asked, 3),
                        'zoomBit': sorted(bits)})
    for o in out:
        print(f"{o['label']:<20} {o['axis']}  asked {o['asked']:+8.3f}  server {o['got']:+8.3f}  ratio {o['ratio']:.3f}  zoom bit {o['zoomBit']}")
    return out


if __name__ == '__main__':
    main(sys.argv[1])
