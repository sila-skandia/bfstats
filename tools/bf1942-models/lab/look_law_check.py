#!/usr/bin/env python3
"""Replay a look_law_probe.mjs log through two on-foot yaw laws and diff each
against the server's own view at every acknowledged serial.

  python3 lab/look_law_check.py probe.ndjson [--lo -14 --hi 20]

The server's view is the body yaw minus 3 x the twist register (aimB), both
from the control-object state the server sends this connection. The two laws:

  literal  BFSoldier::handlePlayerInput's yaw lines (lnxded 0x08273c70, as
           mouse-input.js's SOLDIER_MOVING_TURN comment reads them):
             twist -= d, clamped to [lo, hi]
             if the twist stayed inside the clamp (bounds inclusive) and no
               throttle/strafe input: d = 0
             body += 3 d
             if moving and twist != 0: body -= 3 twist; twist = 0
  page     world-soldier-tick.js before 2026-10-22: view += 3 d, x2 when this
           tick's word moves.
  viewer   `soldierYawStep` from viewer/mouse-input.js itself, run under node:
           what the page turns by now (pass --viewer).

Measured on the lab (Wake, US assault kit, 2026-10-21): the literal law with
lo -14, hi 20 tracks the server to 0.002 deg over 553 acks; the page law
drifts 3-4.5 deg at every clamp crossing and every move press made with the
twist on its clamp.
"""
import argparse, json, math

def dec(n):  # PlayerAction::get 0x0815c5a0
    return round((((2 * n) / 4095) - 1) * 16 * 100) / 100

def wrap(d):
    return (d + 180) % 360 - 180

ap = argparse.ArgumentParser()
ap.add_argument('log')
ap.add_argument('--lo', type=float, default=-14.0)
ap.add_argument('--hi', type=float, default=20.0)
ap.add_argument('--viewer', action='store_true', help="also replay through the viewer's own soldierYawStep")
a = ap.parse_args()

rows = [json.loads(l) for l in open(a.log)]
sent = {r['serial']: r for r in rows if r['kind'] == 'sent'}
words = {r['serial']: r for r in rows if r['kind'] == 'word'}
state = {'rot': None, 'aimB': None}
acks = []
for c in rows:
    if c['kind'] != 'cs' or not c['ok'] or c['cls'] != 'BFSoldierNetworkable':
        continue
    for k in state:
        if c.get(k) is not None:
            state[k] = c[k]
    if state['rot'] is None or state['aimB'] is None or not c['serial']:
        continue
    x, y, z, w = state['rot']
    body = math.degrees(math.atan2(2 * (x * z + w * y), 1 - 2 * (x * x + y * y)))
    acks.append((c['serial'], body, state['aimB']))
acks = [k for k in acks if k[0] >= min(words)]
if len(acks) < 2:
    raise SystemExit('no acknowledged soldier states with a known twist')

serial, body, tw = acks[0]
# The register moves in the axis's 0.01 steps; the wire's 16-bit reading of it
# is a hair off, which would put a whole-step walk a hair past the clamp.
tw = round(tw, 2)
page = body - 3 * tw
worst = {'literal': 0.0, 'page': 0.0}
steps = []
for target, sbody, stw in acks[1:]:
    while serial < target:
        serial += 1
        wd = words.get(serial)
        if not wd or serial not in sent:
            continue
        d = dec(sent[serial]['axes'][4])
        moving = bool(wd['st'].get('forward') or wd['st'].get('strafe'))
        nt = tw - d
        inside = a.lo <= nt <= a.hi
        nt = max(a.lo, min(a.hi, nt))
        if inside and not moving:
            d_body = 0
        else:
            d_body = d
        body += 3 * d_body
        tw = nt
        if moving and tw != 0:
            body -= 3 * tw
            tw = 0
        page += 3 * d * (2 if moving else 1)
    server = sbody - 3 * stw
    el = abs(wrap(body - 3 * tw - server))
    ep = abs(wrap(page - server))
    worst['literal'] = max(worst['literal'], el)
    worst['page'] = max(worst['page'], ep)
    if ep > 0.05 and (not steps or abs(ep - steps[-1][1]) > 0.05):
        steps.append((target, round(ep, 2)))
if a.viewer:
    import subprocess, os
    here = os.path.dirname(os.path.abspath(__file__))
    seq = []
    for k in sorted(words):
        if k in sent:
            seq.append([k, dec(sent[k]['axes'][4]), bool(words[k]['st'].get('forward') or words[k]['st'].get('strafe'))])
    js = """
import { soldierYawStep } from '%s';
const [start, tw0, acks, seq] = JSON.parse(process.argv[1]);
const by = new Map(seq.map(([k, d, m]) => [k, [d, m]]));
let s = start, tw = tw0, view = 0, worst = 0;
for (const [target, sv] of acks) {
  while (s < target) { s++; const w = by.get(s); if (!w) continue; const r = soldierYawStep(tw, w[0], w[1]); tw = r.twist; view += r.view; }
  const e = Math.abs(((view - sv) %% 360 + 540) %% 360 - 180); if (e > worst) worst = e;
}
console.log(worst.toFixed(3));
""" % os.path.join(here, '..', 'viewer', 'mouse-input.js')
    s0, b0, t0 = acks[0]
    rel = [[k, (b - 3 * t) - (b0 - 3 * t0)] for k, b, t in acks[1:]]
    out = subprocess.run(['node', '--input-type=module', '-e', js, json.dumps([s0, round(t0, 2), rel, seq])],
                         capture_output=True, text=True)
    print('viewer soldierYawStep: max |viewer - server|', (out.stdout.strip() or out.stderr.strip()), 'deg')
tws = [k[2] for k in acks]
print(f'server twist range {min(tws):.2f} .. {max(tws):.2f} (clamp used {a.lo} .. {a.hi})')
print(f"{len(acks)} acks; max |literal - server| {worst['literal']:.3f} deg; "
      f"max |page law - server| {worst['page']:.3f} deg")
print('page law error steps (serial, accumulated deg):', steps)
