"""Run CommonControls::actionStatusDecision (0x0860fbe0) on concrete inputs in
the x87 emulator (`x87emu.py`) and compare it with the viewer's port
(`tools/bf1942-models/viewer/bot-vehicle.js actionStatusDecision`).

    python3 action_status_emu.py [N]     # fuzz N random cases per state

The function's own code runs, and so do the leaves it calls that are plain
arithmetic (`getIntersection` 0x08612210, `getNormal`, `pos3ToPos2XZ`,
`vec3ToVec2XZ`, `BaseVector2::normalize`, `BAPAMoveTo::setStatus`). The
calls into the world are natives fed from the case:

  * `CommonControls::getBox` 0x08612060 -> the case's box (min, max; the
    centre is `(min + max) / 2`, as `AIPathfinding::getBox` 0x0847d140
    writes it), or a failure;
  * `checkLineAgainstObjects` 0x0860f7c0 -> the run as given, cut to the
    case's first-object distance, and false when the (cut) run is shorter
    than the hull's radius (the function's own two early outs);
  * the Information / Mobile / Physical virtuals: position, the 3D
    forward, the 3D velocity, the speed, the radius, and the Mobile
    template's +0xc (the turn radius).

Ledger AI-85.
"""
import json
import math
import os
import random
import subprocess
import sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from x87emu import Emu, f2i, i2f

HERE = os.path.dirname(os.path.abspath(__file__))
BIN = '/home/dylan/projects/public/bf42plus/bf1942_lnxded.static'
DIS = os.path.join(HERE, 'action_status.dis')
RANGES = [(0x0860fbe0, 0x08612060), (0x08612210, 0x086124e0), (0x08658680, 0x086587a0),
          (0x083b99d0, 0x083b9a60), (0x085407b0, 0x085407d0)]
if not os.path.exists(DIS):
    out = []
    for a, b in RANGES:
        out.append(subprocess.run(['objdump', '-d', '-M', 'intel', '--start-address=%#x' % a,
                                   '--stop-address=%#x' % b, BIN], capture_output=True, text=True).stdout)
    open(DIS, 'w').write('\n'.join(out))
FN = 0x0860fbe0


def decide(state, dir2, pos, fwd, vel, speed, radius, turn_radius, box=None, cut=None):
    """One call. `dir2`, `pos`: (x, z); `fwd`, `vel`: (x, y, z), engine frame;
    `box`: ((minx, minz), (maxx, maxz)) or None for a failed getBox; `cut`:
    the first object's distance along any run checkLine is asked about.
    Returns (ok, newState, drive, angle, sign)."""
    e = Emu(DIS, symbolic=False)
    e.names = {}
    e.stores = []
    base = [0x20000000]

    def alloc(n):
        a = base[0]
        base[0] += (n + 15) & ~15
        return a

    def put(vals):
        a = alloc(4 * len(vals) + 4)
        for i, x in enumerate(vals):
            e.wf(a + 4 * i, float(x), None)
        return a

    natives = {}
    nid = [0x70000000]

    def native(fn, extra_pop=0):
        a = nid[0]
        nid[0] += 16

        def go(em):
            fn(em)
            ret = em.pop()
            em.reg['esp'] += extra_pop
            em._jump = ret
        e.natives[a] = go
        return a

    def arg(em, i):
        return em.r32(em.reg['esp'] + 4 + 4 * i)

    def argf(em, i):
        return i2f(arg(em, i))

    # --- objects ---
    pPos3 = put([pos[0], 0.0, pos[1]])
    pVel = put(vel)
    pTmpl = alloc(0x40)
    e.wf(pTmpl + 0xc, turn_radius, None)
    pPlug = alloc(0x20)
    e.w32(pPlug + 0x14, pTmpl)
    pXvt = alloc(0x200)
    pX = alloc(0x10)
    e.w32(pX, pXvt)
    pA = alloc(0x40)
    e.w32(pA + 0x20, pX)
    pMobVt = alloc(0x40)
    pMob = alloc(0x10)
    e.w32(pMob, pMobVt)
    e.w32(pMob + 4, pA)
    pPhysVt = alloc(0x40)
    pPhys = alloc(0x10)
    e.w32(pPhys, pPhysVt)
    pInfoVt = alloc(0x40)
    pInfo = alloc(0x40)
    e.w32(pInfo, pInfoVt)
    e.w32(pInfo + 0x24, pPhys)
    e.w32(pInfo + 0x2c, pMob)
    pBotVt = alloc(0x200)
    pBot = alloc(0x10)
    e.w32(pBot, pBotVt)

    def n_getpos(em):
        em.reg['eax'] = pPos3

    def n_getdir(em):                       # returns a Vec3 through the hidden pointer
        out = arg(em, 0)
        for i in range(3):
            em.wf(out + 4 * i, float(fwd[i]), None)
        em.reg['eax'] = out

    def n_radius(em):
        em.st.insert(0, (float(radius), 'r'))

    def n_speed(em):
        em.st.insert(0, (float(speed), 'v'))

    def n_vel(em):
        em.reg['eax'] = pVel

    def n_plug(em):
        em.reg['eax'] = pPlug

    def n_nop(em):
        em.reg['eax'] = 0

    e.w32(pInfoVt + 0x1c, native(n_getpos))
    e.w32(pInfoVt + 0x2c, native(n_getdir, extra_pop=4))
    e.w32(pPhysVt + 0x28, native(n_radius))
    e.w32(pMobVt + 0x1c, native(n_speed))
    e.w32(pMobVt + 0x14, native(n_vel))
    e.w32(pXvt + 0x98, native(n_plug))
    e.w32(pBotVt + 0x124, native(n_nop))

    def n_alloc(em):
        em.reg['eax'] = alloc(16)

    def n_getbox(em):
        pmin, pmax, pc = arg(em, 2), arg(em, 3), arg(em, 4)
        if box is None:
            em.reg['eax'] = 0
            return
        (x0, z0), (x1, z1) = box
        for p, v in ((pmin, (x0, z0)), (pmax, (x1, z1)), (pc, ((x0 + x1) * 0.5, (z0 + z1) * 0.5))):
            em.wf(p, float(v[0]), None)
            em.wf(p + 4, float(v[1]), None)
        em.reg['eax'] = 1

    def n_checkline(em):
        prun, pout, pdist = arg(em, 3), arg(em, 4), arg(em, 5)
        rx, rz = em.rf(prun)[0], em.rf(prun + 4)[0]
        ln = math.hypot(rx, rz)
        # `radius <= |run|` or out (0x0860f7c0); a first object inside the
        # run cuts it, and a cut inside the radius is out.
        if not (radius <= ln):
            em.reg['eax'] = 0
            return
        ux, uz = rx / ln, rz / ln
        if cut is not None and cut < ln:
            ln = cut
            if cut < radius:
                em.reg['eax'] = 0
                return
        em.wf(pout, ln * ux, None)
        em.wf(pout + 4, ln * uz, None)
        em.wf(pdist, ln, None)
        em.reg['eax'] = 1

    def n_acos(em):
        x = argf(em, 0)
        em.st.insert(0, (math.acos(max(-1.0, min(1.0, x))), 'acos'))

    table = {0x80d43a0: n_alloc, 0x80d2440: n_nop, 0x869a69a: n_nop, 0x08612060: n_getbox,
             0x0860f7c0: n_checkline, 0x0804b1e4: n_acos}
    for k, fn in table.items():
        def go(em, fn=fn):
            fn(em)
            ret = em.pop()
            em._jump = ret
        e.natives[k] = go

    pDir = put(dir2)
    pMove = alloc(0x80)
    e.w32(pMove + 0x60, state)
    p5, p6, p7 = alloc(16), alloc(16), alloc(16)
    e.wf(p5, 99.0, None)
    e.wf(p6, 99.0, None)
    e.wf(p7, 99.0, None)
    e.reg['esp'] = 0x7f000000
    for v in reversed([pBot, pInfo, pDir, pMove, p5, p6, p7]):
        e.push(v)
    e.push(0xdeadbeef)
    e.run(FN, max_steps=200000)
    ok = e.reg['eax'] & 0xff
    return ok, e.r32(pMove + 0x60), e.rf(p5)[0], e.rf(p6)[0], e.rf(p7)[0]


def random_case(rng, state):
    """A random call. Half the cases are 'tight': a small box, a slow hull
    and a target about abeam, which is where states 2..7 live."""
    tight = rng.random() < 0.5
    yaw = rng.uniform(-math.pi, math.pi)
    fwd = (math.sin(yaw), 0.0, math.cos(yaw))
    if tight:
        a = yaw + rng.choice([-1, 1]) * rng.uniform(math.radians(60), math.radians(180))
    else:
        a = rng.uniform(-math.pi, math.pi)
    dir2 = (math.sin(a), math.cos(a)) if rng.random() > 0.03 else (0.0, 0.0)
    pos = (rng.uniform(-20, 20), rng.uniform(-20, 20))
    s = rng.choice([0.0, rng.uniform(-6, 6)]) if not tight else rng.uniform(-1.5, 1.5)
    vel = (fwd[0] * s + rng.gauss(0, 0.3), 0.0, fwd[2] * s + rng.gauss(0, 0.3))
    speed = math.hypot(vel[0], vel[2])
    radius = rng.uniform(1.5, 4.0) if not tight else rng.uniform(0.3, 1.5)
    turn = rng.uniform(3.0, 12.0)
    span = 30 if not tight else rng.uniform(1.0, 8.0)
    if rng.random() < 0.08:
        box = None
    else:
        w0, w1 = rng.uniform(0.2, span), rng.uniform(0.2, span)
        h0, h1 = rng.uniform(0.2, span), rng.uniform(0.2, span)
        box = ((pos[0] - w0, pos[1] - h0), (pos[0] + w1, pos[1] + h1))
    cut = rng.choice([None, None, rng.uniform(0.5, 20)])
    return dict(state=state, dir2=dir2, pos=pos, fwd=fwd, vel=vel, speed=speed, radius=radius,
                turn_radius=turn, box=box, cut=cut)


if __name__ == '__main__':
    n = int(sys.argv[1]) if len(sys.argv) > 1 else 200
    rng = random.Random(11)
    cases = []
    for st in range(10):
        for _ in range(n):
            c = random_case(rng, st)
            ok, ns, drive, ang, sgn = decide(**c)
            c['out'] = dict(ok=ok, state=ns, drive=drive, angle=ang, sign=sgn)
            cases.append(c)
    out = os.path.join(HERE, '..', '..', '..', 'tools', 'bf1942-models', 'tests', 'fixtures',
                       'action_status_cases.json')
    if '--write' in sys.argv:
        json.dump(cases, open(out, 'w'), indent=None, separators=(',', ':'))
        print('wrote', len(cases), 'cases to', os.path.normpath(out))
    else:
        from collections import Counter
        print(Counter((c['state'], c['out']['state'], c['out']['drive']) for c in cases))
