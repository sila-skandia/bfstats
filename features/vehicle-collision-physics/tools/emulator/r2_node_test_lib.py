import sys, math, random, struct
sys.path.insert(0, __import__('os').path.dirname(__import__('os').path.abspath(__file__)))
from r2_emu import *

NODE_CTOR = 0x08252b70
BPS_CTOR  = 0x08251e20
UPDATE    = 0x082543d0
ADD_ACC_ABS = 0x08255110
ADD_FRIC_ABS = 0x08254e50
ADD_SPEED_ABS = 0x08254c70
TANGENT = 0x08254b90
G_BPS = 0x0871dc30

def le32(v): return struct.pack('<I', v & 0xffffffff)

def build(e, bbox_min, bbox_max, classid=0x1234, flags=0x2090400):
    obj = e.alloc(0x110); node = e.alloc(0x98); geom = e.alloc(0x10); bbox = e.alloc(0x18)
    tmpl = e.alloc(0x10)
    e.wf(bbox, list(bbox_min) + list(bbox_max))
    # stubs
    ret_imm = lambda v: e.code(b'\xb8' + le32(v) + b'\xc3')
    this_plus = lambda off: e.code(b'\x8b\x44\x24\x04' + b'\x05' + le32(off) + b'\xc3')
    set_pos = e.code(b'\x8b\x44\x24\x04\x8b\x54\x24\x08'
                     b'\x8b\x0a\x89\x88' + le32(0xa4) +
                     b'\x8b\x4a\x04\x89\x88' + le32(0xa8) +
                     b'\x8b\x4a\x08\x89\x88' + le32(0xac) + b'\xc3')
    set_mat = e.code(b'\x56\x57\x8b\x7c\x24\x0c\x81\xc7' + le32(0x74) +
                     b'\x8b\x74\x24\x10\xb9\x10\x00\x00\x00\xfc\xf3\xa5\x5f\x5e\xc3')
    trap = e.code(b'\xf4')
    # geometry vtable: +0x1c -> bbox
    gvt = e.alloc(0x40); e.w32(gvt, [trap] * 16); e.w32(gvt + 0x1c, [ret_imm(bbox)])
    e.w32(geom, [gvt])
    # template vtable: +0xc -> class id
    tvt = e.alloc(0x40); e.w32(tvt, [trap] * 16); e.w32(tvt + 0xc, [ret_imm(classid)])
    e.w32(tmpl, [tvt])
    # object vtable
    ovt = e.alloc(0x100); e.w32(ovt, [trap] * 64)
    e.w32(ovt + 0x28, [ret_imm(geom)])
    e.w32(ovt + 0x38, [this_plus(0xa4)])
    e.w32(ovt + 0x3c, [set_pos])
    e.w32(ovt + 0x40, [this_plus(0x74)])
    e.w32(ovt + 0x44, [set_mat])
    e.w32(obj, [ovt]); e.w32(obj + 4, [flags]); e.w32(obj + 0x4c, [tmpl]); e.w32(obj + 0x50, [0])
    e.w32(obj + 0x60, [node]); e.w32(obj + 0xd4, [0])
    e.call(NODE_CTOR, [node])
    e.w32(node + 0xc, [obj])
    return obj, node

def setup_bps(e):
    b = e.alloc(0x40); e.call(BPS_CTOR, [b]); e.w32(G_BPS, [b]); return b

# ---------- python model of my reading ----------
def cross(a, b): return [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]]
def dot(a, b): return sum(x*y for x, y in zip(a, b))
def add(a, b): return [x+y for x, y in zip(a, b)]
def sub(a, b): return [x-y for x, y in zip(a, b)]
def mul(a, s): return [x*s for x in a]

def rot_rows(M, n, ang):
    # Rodrigues on each row (3x3), translation untouched
    c, s = math.cos(ang), math.sin(ang)
    out = [r[:] for r in M]
    for i in range(3):
        r = M[i][:3]
        rr = add(add(mul(r, c), mul(cross(n, r), s)), mul(n, dot(n, r) * (1 - c)))
        out[i][:3] = rr
    return out

class Model:
    def __init__(s, M, bmin, bmax):
        s.M = [row[:] for row in M]; s.v = [0,0,0]; s.w = [0,0,0]
        s.acc = [0,0,0]; s.racc = [0,0,0]; s.fr = [0,0,0]; s.rfr = [0,0,0]; s.n = 0
        s.com = [0,0,0]; s.imod = [1,1,1]; s.gmod = 1.0; s.sleep = 100
        D = sub(bmax, bmin)
        s.I = [(D[1]**2 + D[2]**2)/3, (D[0]**2 + D[2]**2)/3, (D[0]**2 + D[1]**2)/3]
    def pos(s): return s.M[3][:3]
    def addAcc(s, p, a):
        s.acc = add(s.acc, a); r = sub(sub(p, s.pos()), s.com); s.racc = add(s.racc, cross(r, a))
    def addFric(s, p, f):
        k = 1.0/(s.n+1)
        s.fr = mul(add(mul(s.fr, s.n), f), k)
        r = sub(p, s.pos()); s.rfr = mul(add(mul(s.rfr, s.n), cross(r, f)), k); s.n += 1
    def addSpeed(s, p, dv):
        s.v = add(s.v, dv); s.w = add(s.w, cross(sub(p, s.pos()), dv))
    def tangent(s, p): return add(s.v, cross(s.w, sub(p, s.pos())))
    def update(s, dt, g=-14.73):
        # wake test (root, non soldier)
        if s.sleep >= 0:
            if dot(s.acc, s.acc) >= 2.5 or dot(s.v, s.v) >= 0.25 or dot(s.w, s.w) >= 0.25: s.sleep = 100
            elif s.sleep > 0: s.sleep -= 1
        if s.sleep <= 0:
            s.v=[0,0,0]; s.w=[0,0,0]; s.acc=[0,0,0]; s.racc=[0,0,0]; s.fr=[0,0,0]; s.rfr=[0,0,0]; s.n=0
            return
        # (drag omitted: drag = 0 in this test)
        a2 = dot(s.acc, s.acc)
        if a2 > 1e6: s.acc = mul(s.acc, 1000/math.sqrt(a2))
        if dot(s.fr, s.fr) > 62500: s.fr = [0,0,0]
        s.v = add(s.v, mul(s.acc, dt)); s.v = add(s.v, mul(s.fr, dt))
        s.M[3][:3] = add(s.pos(), mul(s.v, dt))
        s.acc = [0,0,0]; s.fr = [0,0,0]
        # rotational
        r2 = dot(s.racc, s.racc)
        if r2 > 1e6: s.racc = mul(s.racc, 1000/math.sqrt(r2))
        Tpre = add(s.racc, s.rfr)
        if dot(s.rfr, s.rfr) > 40000: s.rfr = [0,0,0]
        Tpost = add(s.racc, s.rfr)
        dw = [0,0,0]
        for axis, T in ((2, Tpre), (1, Tpost), (0, Tpost)):
            e_ = s.M[axis][:3]; l2 = dot(e_, e_)
            if l2 == 0: continue
            proj = mul(e_, dot(T, e_)/l2)
            dw = add(dw, mul(proj, dt/(s.imod[axis]*s.I[axis])))
        s.w = add(s.w, dw)
        w2 = dot(s.w, s.w)
        if w2 > 1.0000001e-06:
            wl = math.sqrt(w2); s.M = rot_rows(s.M, mul(s.w, 1/wl), dt*wl)
        s.racc=[0,0,0]; s.rfr=[0,0,0]; s.n=0
        s.acc[1] += g*s.gmod

def readnode(e, node, obj):
    return dict(v=e.rf(node+0x10,3), w=e.rf(node+0x1c,3), acc=e.rf(node+0x28,3), racc=e.rf(node+0x34,3),
                fr=e.rf(node+0x40,3), rfr=e.rf(node+0x4c,3), n=e.rf(node+0x64,1)[0],
                sleep=e.r32(node+0x94)[0], M=e.rf(obj+0x74,16))

def main():
    random.seed(7)
    e = Emu(); setup_bps(e)
    bmin, bmax = [-1.0,-0.5,-2.0], [1.2,0.9,2.5]
    obj, node = build(e, bmin, bmax)
    # initial transform: rotated + translated
    M0 = [[1,0,0,0],[0,1,0,0],[0,0,1,0],[10,20,30,1]]
    M0 = rot_rows(M0, [0.6,0.0,0.8], 0.7)
    flat = [x for r in M0 for x in r]
    e.wf(obj+0x74, flat)
    e.wf(node+0x68, [0.0])            # drag = 0 -> skip drag block
    com = [0.1,-0.2,0.3]; imod=[1.5,0.7,2.0]
    e.wf(node+0x70, com); e.wf(node+0x7c, imod)
    m = Model(M0, bmin, bmax); m.com = com; m.imod = imod
    vec = lambda v: (lambda a: (e.wf(a, v), a)[1])(e.alloc(12))
    worst = 0.0
    dt = 1.0/30.0
    for tick in range(40):
        for k in range(random.randint(0,3)):
            p = [10+random.uniform(-2,2), 20+random.uniform(-2,2), 30+random.uniform(-2,2)]
            a = [random.uniform(-20,20) for _ in range(3)]
            e.call(ADD_ACC_ABS, [node, vec(p), vec(a)]); m.addAcc(p, a)
        for k in range(random.randint(0,3)):
            p = [m.pos()[0]+random.uniform(-2,2), m.pos()[1]+random.uniform(-2,2), m.pos()[2]+random.uniform(-2,2)]
            f = [random.uniform(-10,10) for _ in range(3)]
            e.call(ADD_FRIC_ABS, [node, vec(p), vec(f)]); m.addFric(p, f)
        if tick == 5:
            p = add(m.pos(), [0.5,0.2,-1]); dv=[1,2,3]
            e.call(ADD_SPEED_ABS, [node, vec(p), vec(dv)]); m.addSpeed(p, dv)
        e.call(UPDATE, [node, fbits(dt)])
        m.update(dt)
        st = readnode(e, node, obj)
        errs = [max(abs(x-y) for x,y in zip(st['v'], m.v)), max(abs(x-y) for x,y in zip(st['w'], m.w)),
                max(abs(x-y) for x,y in zip(st['M'], [x for r in m.M for x in r])),
                max(abs(x-y) for x,y in zip(st['acc'], m.acc))]
        worst = max(worst, *errs)
        if tick % 8 == 0 or tick == 39:
            print('tick', tick, 'v', ['%.4f'%x for x in st['v']], 'w', ['%.4f'%x for x in st['w']], 'err', '%.2e' % max(errs), 'sleep', st['sleep'], m.sleep)
    # tangent speed
    p = add(m.pos(), [1.0,-2.0,0.5]); out = e.alloc(12)
    e.call(TANGENT, [out, node, vec(p)])
    print('tangent emu', e.rf(out,3), 'model', m.tangent(p))
    print('worst abs err', worst)

