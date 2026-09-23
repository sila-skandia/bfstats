"""Run PlaneControl::towardsDirection (0x08629fa0) on concrete inputs in
the x87 emulator (`x87emu.py`) and compare with the port.

    python3 towards_direction_emu.py [N]   # fuzz N random cases (default 300)

`towards(dir, R, U, F, pos, w, p18=.., p1c=.., p20=.., p38=.., p3c=.., p40=..)`
returns the PlayerInput channel writes {0x50 throttle, 0x54 yaw, 0x10c roll,
0x110 pitch} as (value, formula). Engine frame (x right, y up, z forward);
`w` is the angular velocity (IPIMobile vt +0x18). Ledger AI-60.
"""
import math
import os
import struct
import sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from x87emu import Emu, f2i, i2f

import os
import subprocess
HERE = os.path.dirname(os.path.abspath(__file__))
DIS = os.path.join(HERE, 'towards_direction.dis')
if not os.path.exists(DIS):
    out = subprocess.run(['objdump', '-d', '-M', 'intel', '--start-address=0x08629fa0', '--stop-address=0x0862b4a0',
                          '/home/dylan/projects/public/bf42plus/bf1942_lnxded.static'], capture_output=True, text=True).stdout
    open(DIS, 'w').write(out)
FN = 0x08629fa0

# channel indices for the fake ControlInfo template (distinct, < 55)
CH = {0x50: 3, 0x54: 4, 0x10c: 5, 0x110: 6}


def norm(v):
    l = math.sqrt(sum(x * x for x in v))
    return [x / l for x in v] if l > 1e-12 else v


def cross(a, b):
    return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]


def towards(dir_, R, U, F, pos, V, p0c=0.0, p18=1.0, p1c=1.0, p20=0, p38=0.0, p3c=40.0, p40=0,
            ci104=0.3333, ci108=0.9999, symbolic=True, verbose=False):
    e = Emu(DIS)
    e.names = {}
    e.stores = []
    base = 0x20000000

    def alloc(n):
        nonlocal base
        a = base
        base += (n + 15) & ~15
        return a

    def put_vec(v, name):
        a = alloc(16)
        for i, x in enumerate(v):
            e.wf(a + 4 * i, x, None)
            e.names[a + 4 * i] = '%s.%s' % (name, 'xyz'[i])
        return a

    pdir = put_vec(dir_, 'D')
    pM = alloc(64)
    for r, (row, nm) in enumerate(((R, 'R'), (U, 'U'), (F, 'F'), (pos, 'P'))):
        for i in range(3):
            e.wf(pM + 16 * r + 4 * i, row[i], None)
            e.names[pM + 16 * r + 4 * i] = '%s.%s' % (nm, 'xyz'[i])
        e.wf(pM + 16 * r + 12, 1.0 if r == 3 else 0.0, None)
    pV = put_vec(V, 'V')
    pInput = alloc(0x100)
    # isInputMapped reads +0xdc/+0xe0: every channel mapped
    e.w32(pInput + 0xdc, 0xffffffff)
    e.w32(pInput + 0xe0, 0xffffffff)
    # natives
    NATIVE = 0x70000000
    nid = [NATIVE]

    def native(fn):
        a = nid[0]
        nid[0] += 16
        e.natives[a] = fn
        return a

    def n_normalize(em):
        ret = em.pop()
        p = em.r32(em.reg['esp'])
        v = [em.rf(p + 4 * i)[0] for i in range(3)]
        s = [em.rf(p + 4 * i)[1] for i in range(3)]
        l = math.sqrt(sum(x * x for x in v))
        for i in range(3):
            em.wf(p + 4 * i, v[i] / l if l > 0 else v[i], 'n(%s)' % s[i] if not s[i].startswith('n(') else s[i])
        em.reg['eax'] = 0
        em.push(ret)
        em.reg['esp'] += 0  # caller cleans
        # return: pop ret into pc handled by emu: emulate `ret`
        em._native_ret = True

    e.natives[0x8061d10] = None  # placeholder, set below
    tv = {}

    def mk(fn):
        def wrapper(em):
            fn(em)
        return wrapper

    # We implement natives as: on entry the return address is on the stack.
    # Each native pops it and sets the next pc by patching emu.run's nxt: we
    # use a trampoline: natives leave the return address for a synthetic `ret`.
    cnt = {'n': 0, 'c': 0}
    legend = []

    def n_norm(em):
        p = em.r32(em.reg['esp'] + 4)
        v = [em.rf(p + 4 * i) for i in range(3)]
        l = math.sqrt(sum(x[0] ** 2 for x in v))
        cnt['n'] += 1
        nm = {1: 'D', 2: 'Rh'}.get(cnt['n'], 'N%d' % cnt['n'])
        legend.append('%s = normalize(%s)' % (nm, [x[1] for x in v]))
        for i in range(3):
            em.wf(p + 4 * i, v[i][0] / l if l > 0 else v[i][0], '%s.%s' % (nm, 'xyz'[i]))

    def n_cross(em):
        out = em.r32(em.reg['esp'] + 4)
        pa = em.r32(em.reg['esp'] + 8)
        pb = em.r32(em.reg['esp'] + 12)
        a = [em.rf(pa + 4 * i) for i in range(3)]
        b = [em.rf(pb + 4 * i) for i in range(3)]
        c = cross([x[0] for x in a], [x[0] for x in b])
        cnt['c'] += 1
        nm = {1: 'YxF', 2: 'Fh', 3: 'Ul'}.get(cnt['c'], 'C%d' % cnt['c'])
        legend.append('%s = cross(%s, %s)' % (nm, [x[1] for x in a], [x[1] for x in b]))
        for i in range(3):
            em.wf(out + 4 * i, c[i], '%s.%s' % (nm, 'xyz'[i]))
        em.reg['eax'] = out
        em._extra_pop = 4

    def n_exp(em):
        x = em.rf(em.reg['esp'] + 4)
        em.st.insert(0, (math.exp(x[0]), 'exp(%s)' % x[1]))

    def n_log10(em):
        x = em.rf(em.reg['esp'] + 4)
        em.st.insert(0, (math.log10(x[0]) if x[0] > 0 else -math.inf, 'log10(%s)' % x[1]))

    def n_mapped(em):
        em.reg['eax'] = 1

    def n_nop(em):
        pass

    # mobile object
    pMobVt = alloc(0x100)
    pMob = alloc(16)
    e.w32(pMob, pMobVt)

    def n_vel(em):
        em.reg['eax'] = pV

    # control info chain: ci+4 -> x; x+0x20 -> obj; obj vtable +0x98 -> getter returning g; g+8 -> tmpl
    pTmpl = alloc(0x200)
    e.wf(pTmpl + 0x104, ci104, None)
    e.names[pTmpl + 0x104] = 'CI104'
    e.wf(pTmpl + 0x108, ci108, None)
    e.names[pTmpl + 0x108] = 'CI108'
    for off, ch in CH.items():
        e.w32(pTmpl + off, ch)
    pG = alloc(16)
    e.w32(pG + 8, pTmpl)
    pObjVt = alloc(0x100)
    pObj = alloc(16)
    e.w32(pObj, pObjVt)
    pX = alloc(0x40)
    e.w32(pX + 0x20, pObj)
    pCI = alloc(16)
    e.w32(pCI + 4, pX)

    def n_getter(em):
        em.reg['eax'] = pG

    # debug renderer
    pDbgVt = alloc(0x40)
    pDbg = alloc(16)
    e.w32(pDbg, pDbgVt)
    e.w32(0x874fb54, pDbg)
    # wire natives
    table = {0x8061d10: n_norm, 0x83c6e30: n_cross, 0x804b184: n_exp, 0x804b6d4: n_log10, 0x8056210: n_mapped}
    fake = {pMobVt + 0x18: n_vel, pObjVt + 0x98: n_getter, pDbgVt + 0x8: n_nop}
    for k, fn in fake.items():
        a = native(fn)
        e.w32(k, a)
        table[a] = fn

    # emulate natives: the emu pushes the return address then calls natives[tgt](em)
    def make(fn):
        def go(em):
            em._extra_pop = 0
            fn(em)
            ret = em.pop()
            em.reg['esp'] += em._extra_pop
            em._jump = ret
        return go
    for k, fn in table.items():
        e.natives[k] = make(fn)

    # stack + args
    e.reg['esp'] = 0x7f000000
    args = [pdir, f2i(p0c), pInput, pM, f2i(p18), f2i(p1c), p20, pV, pV, pV, pMob, pCI, f2i(p38), f2i(p3c), p40]
    names_args = {8: 'Dp', 0xc: 'p0c', 0x18: 'p18', 0x1c: 'p1c', 0x38: 'p38', 0x3c: 'p3c'}
    for v in reversed(args):
        e.push(v)
    e.push(0xdeadbeef)
    # parameter slot names (ebp = esp - 4 after push ebp)
    ebp = e.reg['esp'] - 4
    for off, nm in names_args.items():
        e.names[ebp + off] = nm
    e.run(FN)
    out = {}
    for off, ch in CH.items():
        v = i2f(e.r32(pInput + ch * 4))
        s = e.sym.get(pInput + ch * 4, '?')
        out[off] = (v, s)
    e.legend = legend
    return out, e




if __name__ == '__main__':
    import random
    from towards_direction_port import towards as port
    n = int(sys.argv[1]) if len(sys.argv) > 1 else 300
    random.seed(7)
    bad = 0
    for i in range(n):
        F = norm([random.gauss(0, 1) for _ in range(3)])
        t = norm([random.gauss(0, 1) for _ in range(3)])
        R = norm(cross(t, F)); U = cross(F, R); R = cross(U, F)
        D = norm([random.gauss(0, 1) for _ in range(3)])
        w = [random.gauss(0, 1.2) for _ in range(3)]
        p1c = random.choice([50.0, 75.0]); p18 = random.uniform(-1.5, 1.5) * p1c
        p20 = random.random() < 0.2; p38 = random.choice([0.0, 0.5, 1.0]); p3c = random.uniform(0, 80)
        p40 = random.random() < 0.7
        o, _ = towards(D, R, U, F, [0, 0, 0], w, p18=p18, p1c=p1c, p20=int(p20), p38=p38, p3c=p3c, p40=int(p40))
        q = port(D, R, U, F, w, p18, p1c, p20, p38, p3c, p40, 0.3333, 0.9999)
        if any(abs(o[k][0] - q[k]) > 2e-4 for k in (0x50, 0x54, 0x10c, 0x110)):
            bad += 1
    print('mismatches', bad, 'of', n)
