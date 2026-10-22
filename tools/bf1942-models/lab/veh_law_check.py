#!/usr/bin/env python3
"""Replay a vehicle probe's words through the engine's per-tick ground-vehicle law (lnxded).

    python3 lab/veh_law_check.py [probe.ndjson.gz] [--terrain T.json.gz]
                                 [--start S] [--end S] --mode free|step|horizon [--h 30] [-v]

The default log is tests/fixtures/tank_law_wake.ndjson.gz: lab/veh_law_probe.mjs
driving a Sherman on vanilla Wake (2026-10-22), its control states re-decoded
whole from the raw hex; its terrain window is tests/fixtures/
tank_law_wake_terrain.json.gz. The page's own TrackedVehicle is held to the same
server by tests/test_tank_law.py. Ledger TANK-18..TANK-24.

Measured (--mode step, every ack re-seeded): 0.2-0.4 mm median, under 1.1 mm
worst, a tick in every phase; vertical under 1 mm; yaw 0.01 degrees. --mode free
from the seat (--start 2115) holds 1-2 mm through the throttle and drifts to
about 25 mm by the end (a slow yaw drift in the long turn, 0.03 degrees/s).

free    : seed from the server's control state at --start, then open loop on the words
step    : re-seed at every ack, predict the next (the per-tick law error)
horizon : from every ack run --h ticks open loop, score the ack it lands on

One server tick for a driven c_ETTank (Sherman), in order (R = read in the decompile/objdump,
M = fixed by the lab data, I = inferred):
 1 Engine::handleUpdate 0x0823e120 (R)
     input = round(((2n/4095-1)*16)*100)/100 (PlayerAction::get 0x0815c5a0, R: a key is 1.00)
     calculateAndClipAngle 0x081d7490 automaticReset: angle -> input*maxRotation at |accel|/s,
       clipped; roll(z)=throttle, x=yaw.  T1 = angle.z/maxRot.z, steer(+0xb0) = angle.x/maxRot.x
     brake byte +0xb4 = (P<-0.1 & revs>0) | (P>0.1 & revs<0)
     revs += 0.05*((T1 - L) - 0.5*revs), clamp [-1, 1.2]; gear++ if revs>gearUp & b==0; gear-- if revs<gearDown
     L (+0xa4) := 0
 3 performMobilePhysicsUpdate 0x08147470 (R): post-order, children before parents
     PhysicsSpring::updatePhysics 0x0824ddd0 (R): D = anchor - wheel (= -push), Dprev kept;
       if awake: wheel snapped to rest, a = -(1.5*k*D + c*(D - Dprev)*30) at (anchor - rootPos)
     PhysicsEngine::updatePhysics 0x0824cbb0 (R): |revs| >= 0.05 wakes the root, then returns (type&1 clear)
     root PhysicsNode::updatePhysics 0x082543d0 (R): wake test |acc|^2>=2.5 | |v|^2>=0.25 | |w|^2>=0.25
       else sleepiness-- (100 ticks); asleep: zero v,w,acc,fr and return (no gravity)
       box drag (drag 2, mass 25000, Sherman_Hull_M1 box); v += acc dt; v += fr dt; x += v dt
       w += proj_rows(racc+rfr) dt / (I_row*mod), I = box/3; rows rotated about w by |w| dt
       acc = (0,-14.73,0), fr = rfr = racc = 0
 6 rpm.update(dt, vehicle) 0x0825d0b0 (R): a part is detected only if its node is awake (a wheel's
     node copied the root's sleepiness in step 3, before the engine's wake: M)
     checkVsTerrain 0x0825a960: wheel col0 vertex 0 (3-vertex mesh = one probe), depth = y - h,
       C = (x,h,z), speed = getTangentSpeed(C) = v + w x (C - rootPos); impulseOn 0x08258900:
       A = (1.0 + fric(mat)) / 2, res = (0.01 + res(mat)) / 2   (wheel material 178: friction 1.0, M;
       resistance 0.01, M)   terrain material = trunc(x/4), trunc(z/4) (PatchTerrain::getMaterial
       0x083d6800 fldcw 0x0c.., R; the round() reading misses the 0.95 mean at the pad, M)
     solveImpulse 0x08258d30 Spring branch: wheel += N*clamp(-depth,0,1); no velocity change
     addFriction 0x0825b6e0: lo = A*1.5*9.82/30*N.y, hi = 1.5 lo; V = speed + (0, g/30, 0);
       Vt = V - N(V.N); acc += -res*Vt (sum); EngineGrip: T = ratio*diffRPM(side)*fwd (fwd = the
       track's row 2) made tangent; dV = T - Vt (brake: T = 0); latch: latched & |dV|>hi -> unlatch,
       clamp lo; not latched & |dV|>lo -> clamp lo, else latch; feedbackLoop 0x0824c850
       L = max(L, dV.fwd*ratio/torque(revs)) (revs>=0); fr = running mean of 30 dV at C + push;
       |speed|^2 > 0.1 wakes the root
Wire (control-object state): hull vecA v, vecB w, vecC acc, vecD racc, vecE fr, vecF rfr, flag
isSleeping (SimpleObjectNetworkable::updateStateMask 0x08235ee0 -> PhysicsNode vt +0x38..+0x84, R);
Engine revs/angles/L at x1.25 (writeSignedFloat max dropped); Spring rel pos and Dprev at 0.002.
"""
import gzip, json, math, sys, os, argparse, statistics
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from move_law_terrain import Terrain
FIXTURES = os.path.join(HERE, '..', 'tests', 'fixtures')
LOG = os.path.join(FIXTURES, 'tank_law_wake.ndjson.gz')
TERRAIN = os.path.join(FIXTURES, 'tank_law_wake_terrain.json.gz')
_T = None


def height_normal(x, z):
    return _T.height_normal(x, z)


def material(x, z):
    # TRUNCATED x/4, z/4 (PatchTerrain::getMaterial 0x083d6800, TERR-17): four
    # tank wheels straddling a cell edge read two materials (fr 13.99 = mean A 0.95)
    return _T._material(int(math.floor(x / 4.0)), int(math.floor(z / 4.0)))

DT = 1.0 / 30.0
G = -14.73
FRICTION = {}
RESIST = {}


def dot(a, b): return a[0]*b[0] + a[1]*b[1] + a[2]*b[2]
def add(a, b): return (a[0]+b[0], a[1]+b[1], a[2]+b[2])
def sub(a, b): return (a[0]-b[0], a[1]-b[1], a[2]-b[2])
def mul(a, s): return (a[0]*s, a[1]*s, a[2]*s)
def cross(a, b): return (a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0])
def norm(a): return math.sqrt(dot(a, a))
def proj(v, axis):
    d = dot(axis, axis)
    return mul(axis, dot(v, axis) / d) if d != 0 else (0.0, 0.0, 0.0)


def quat_rows(q):
    x, y, z, w = q
    r0 = (1 - 2*(y*y + z*z), 2*(x*y + z*w), 2*(x*z - y*w))
    r1 = (2*(x*y - z*w), 1 - 2*(x*x + z*z), 2*(y*z + x*w))
    r2 = (2*(x*z + y*w), 2*(y*z - x*w), 1 - 2*(x*x + y*y))
    return [r0, r1, r2]


def body_to_world(M, p):  # row-vector convention: world = x*row0 + y*row1 + z*row2
    return add(add(mul(M[0], p[0]), mul(M[1], p[1])), mul(M[2], p[2]))


def world_to_body(M, v):
    return (dot(v, M[0]), dot(v, M[1]), dot(v, M[2]))


def rotate_about(v, u, ang):
    c, s = math.cos(ang), math.sin(ang)
    return add(add(mul(v, c), mul(cross(u, v), s)), mul(u, dot(u, v) * (1 - c)))


def otd(points, default=1.0):
    """OverTimeDistribution::generateDistribution 0x081e7830: 101 slots, piecewise linear."""
    v = [default] * 101
    auth = sorted(points)
    for i, x in auth: v[i] = x
    for (i0, x0), (i1, x1) in zip(auth, auth[1:]):
        for j in range(i0 + 1, i1): v[j] = ((i1 - j) * x0 + (j - i0) * x1) / (i1 - i0)
    lo = auth[0][0]
    for j in range(0, lo): v[j] = ((lo - j) * default + j * auth[0][1]) / lo
    return v


RATIO_CURVE = otd([(20, 3.5), (40, 2.2), (60, 1.5), (80, 1.1), (100, 0.94)])
TORQUE_CURVE = otd([(0, 0.70), (10, 0.80), (30, 0.90), (60, 1.00), (85, 0.85), (100, 0.70)])


def lerp_curve(c, idxf):
    i = int(idxf); f = idxf - i
    if i >= 100: return c[100]
    return c[i] + (c[i+1] - c[i]) * f


SHERMAN = dict(
    mass=25000.0, drag=2.0, box=((-1.23426, -0.60473, -2.76936), (1.2559, 0.99259, 2.99345)),
    inertia_mod=(1.0, 1.0, 1.0),
    engine=dict(type=6, minRot=(-1, 0, -1), maxRot=(1, 0, 1), maxSpeed=(4, 0, 10), accel=(4, 0, 10),
                autoReset=True, torque=4.0, diff=4.0, gears=5, gearUp=0.95, gearDown=0.45, gearChangeTime=0.05),
    # driven springs: rest position in the root frame, side (relative x to the track), probe vertex
    springs=[dict(name='L3f', rest=(-1.008, -0.679, 1.2), side=-0.999),
             dict(name='L3r', rest=(-1.008, -0.679, -1.249), side=-0.999),
             dict(name='R3f', rest=(1.01, -0.679, 1.2), side=1.0),
             dict(name='R3r', rest=(1.01, -0.679, -1.249), side=1.0)],
    spring_k=18.0, spring_c=4.0, wheel_vertex=(0.0, -0.30432, 0.00084), wheel_mat_friction=1.0, wheel_mat_resist=0.01,
    spring_order=None,
)


class Engine:
    def __init__(self, spec):
        self.s = spec
        self.ang = [0.0, 0.0, 0.0]
        self.revs = 0.0; self.gear = 1; self.b = 0.0; self.L = 0.0; self.brake = 0; self.steer = 0.0
        self.running = True

    def servo(self, axis, inp):
        s = self.s
        if s['maxSpeed'][axis] == 0: return
        acc = s['accel'][axis]
        if acc == 0: return
        tgt = (inp if acc > 0 else -inp) * s['maxRot'][axis]
        a = self.ang[axis]
        if tgt > a:
            a = a + abs(acc) * DT
            if not (a < tgt): a = tgt
        elif tgt < a:
            a = a - abs(acc) * DT
            if not (tgt < a): a = tgt
        mn, mx = s['minRot'][axis], s['maxRot'][axis]
        if a > mx: a = mx
        elif a < mn: a = mn
        self.ang[axis] = a

    def handle_update(self, throttle, yaw):
        s = self.s
        self.servo(0, yaw); self.servo(2, throttle)
        T1 = self.ang[2] / s['maxRot'][2]
        self.steer = self.ang[0] / s['maxRot'][0] if s['maxRot'][0] >= 0 and s['maxRot'][0] != 0 else 0.0
        if self.b > 0:
            self.b -= DT / s['gearChangeTime']
            if self.b < 0: self.b = 0.0
        P = throttle
        r = self.revs
        if P < -0.1: self.brake = 1 if r > 0 else (1 if (P > 0.1 and r < 0) else 0)
        else: self.brake = 1 if (P > 0.1 and r < 0) else 0
        r = r + 0.05 * ((T1 - self.L) - 0.5 * r)
        if not self.running: r = 0.0
        r = min(1.2, max(-1.0, r))
        self.revs = r
        if r > s['gearUp'] and self.b == 0 and self.gear < s['gears']: self.gear += 1
        if self.revs < s['gearDown'] and self.gear > 1: self.gear -= 1
        self.Lprev = self.L
        self.L = 0.0

    def ratio(self):
        s = self.s
        idxf = self.gear / s['gears'] * 100
        return 3.5 * s['diff'] / lerp_curve(RATIO_CURVE, idxf)

    def torque(self):
        return lerp_curve(TORQUE_CURVE, min(abs(self.revs), 1.0) * 100) * self.s['torque']

    def diff_rpm(self, side):
        r = self.revs
        if self.s['type'] & 4:
            if side == 0: return r
            f = (1 - 1.5 * self.steer) if side > 0 else (1 + 1.5 * self.steer)
            return max(-1.0, min(1.0, f * r))
        return r

    def feedback(self, dv, fwd):
        L0 = dot(dv, fwd) * self.ratio() / self.torque()
        if self.s['type'] & 2: L0 = max(-1.0, min(1.0, L0))
        if self.s['type'] & 4:
            if self.revs >= 0:
                if L0 >= self.L: self.L = L0
            else:
                if L0 <= self.L: self.L = L0


class Hull:
    def __init__(self, spec, args):
        self.s = spec; self.a = args
        self.P = (0, 0, 0); self.M = [(1, 0, 0), (0, 1, 0), (0, 0, 1)]
        self.v = (0, 0, 0); self.w = (0, 0, 0)
        self.acc = (0, G, 0); self.racc = (0, 0, 0); self.fr = (0, 0, 0); self.rfr = (0, 0, 0); self.nfr = 0
        self.eng = Engine(spec['engine'])
        n = len(spec['springs'])
        self.push = [(0.0, 0.0, 0.0)] * n     # wheel displacement from rest (world), solveImpulse's
        self.Dprev = [(0.0, 0.0, 0.0)] * n
        self.latch = [bool(args.latch0)] * n
        self.sleepiness = 100
        self.wheels_awake = True
        b0, b1 = spec['box']
        self.D = (b1[0]-b0[0], b1[1]-b0[1], b1[2]-b0[2])
        DX, DY, DZ = self.D
        self.I = ((DY*DY + DZ*DZ) / 3, (DZ*DZ + DX*DX) / 3 * args.iyscale, (DX*DX + DY*DY) / 3)
        self.diag = {}

    # --- step 1 -----------------------------------------------------------------
    def tick(self, throttle, yaw):
        self.eng.handle_update(throttle, yaw)
        self.physics()
        self.collide()

    # --- step 3 -----------------------------------------------------------------
    def physics(self):
        s = self.s
        # springs first (performMobilePhysicsUpdate 0x08147470 recurses into children before
        # the node; the springs hang under the Engine, so they run before its wake)
        self.wheels_awake = self.sleepiness > 0  # a spring copies the root's sleepiness here
        for i, sp in enumerate(s['springs']):
            D = mul(self.push[i], -1.0)          # anchor - wheel, the wheel having been pushed
            Dp = self.Dprev[i]
            self.Dprev[i] = D
            if self.sleepiness <= 0: continue    # asleep: D stored, no force, the wheel stays put
            self.push[i] = (0.0, 0.0, 0.0)       # snapped back to rest
            k, c = s['spring_k'], s['spring_c']
            a = mul(add(mul(D, 1.5 * k), mul(sub(D, Dp), c / DT)), -1.0)
            arm = body_to_world(self.M, sp['rest'])
            self.acc = add(self.acc, a)
            self.racc = add(self.racc, cross(arm, a))
        # PhysicsEngine::updatePhysics 0x0824cbb0: |revs| >= 0.05 wakes the root
        if abs(self.eng.revs) >= 0.05 and self.sleepiness >= 0: self.sleepiness = 100
        # root sleep bookkeeping (0x082543d0): acc as it stands, then v, then w
        if self.sleepiness >= 0:
            if dot(self.acc, self.acc) >= 2.5 or dot(self.v, self.v) >= 0.25 or dot(self.w, self.w) >= 0.25:
                self.sleepiness = 100
            elif self.sleepiness > 0:
                self.sleepiness -= 1
        if self.sleepiness <= 0:
            self.v = (0, 0, 0); self.w = (0, 0, 0)
            self.acc = (0, 0, 0); self.racc = (0, 0, 0); self.fr = (0, 0, 0); self.rfr = (0, 0, 0); self.nfr = 0
            return
        # root integrate
        if self.a.drag:
            self.box_drag()
        acc = self.acc
        if dot(acc, acc) > 1e6: acc = mul(acc, 1000 / norm(acc))
        fr = self.fr
        if dot(fr, fr) > 62500: fr = (0, 0, 0)
        self.v = add(self.v, mul(acc, DT)); self.v = add(self.v, mul(fr, DT))
        self.P = add(self.P, mul(self.v, DT))
        racc = self.racc
        if dot(racc, racc) > 1e6: racc = mul(racc, 1000 / norm(racc))
        Tpre = add(racc, self.rfr)
        rfr = self.rfr if dot(self.rfr, self.rfr) <= 40000 else (0, 0, 0)
        Tpost = add(racc, rfr)
        mod = s['inertia_mod']
        dw = add(add(mul(proj(Tpre, self.M[2]), DT / (mod[2] * self.I[2])),
                     mul(proj(Tpost, self.M[1]), DT / (mod[1] * self.I[1]))),
                 mul(proj(Tpost, self.M[0]), DT / (mod[0] * self.I[0])))
        self.w = add(self.w, dw)
        wl = norm(self.w)
        if wl * wl > 1e-6:
            u = mul(self.w, 1 / wl)
            ang = wl * DT * self.a.rotsign
            self.M = [rotate_about(r, u, ang) for r in self.M]
        self.acc = (0, G, 0); self.racc = (0, 0, 0); self.fr = (0, 0, 0); self.rfr = (0, 0, 0); self.nfr = 0

    def box_drag(self):
        s = self.s
        DX, DY, DZ = self.D
        A0, A1, A2 = 3.14 * 0.25 * DY * DZ, 3.14 * 0.25 * DX * DZ, 3.14 * 0.25 * DX * DY
        k = -s['drag'] * norm(self.v) / s['mass']
        for row, A in ((self.M[2], A2), (self.M[1], A1), (self.M[0], A0)):
            self.acc = add(self.acc, mul(proj(self.v, row), k * A))
        kw = -s['drag'] * norm(self.w) / s['mass']
        for row, A in ((self.M[0], A1 + A2), (self.M[1], A0 + A2), (self.M[2], A0 + A1)):
            self.racc = add(self.racc, mul(proj(self.w, row), kw * A))

    # --- step 6 -----------------------------------------------------------------
    def tangent(self, p):
        return add(self.v, cross(self.w, sub(p, self.P)))

    def collide(self):
        s = self.s; e = self.eng
        contacts = []
        # (the hull part follows the root's sleepiness, each wheel the copy its spring took)
        for i, sp in enumerate(s['springs']):
            if not self.wheels_awake:            # a sleeping part is not detected (rpm.update 0x0825d0b0)
                self.latch[i] = False
                contacts.append(None)
                continue
            wheel = add(self.P, body_to_world(self.M, sp['rest']))
            vert = add(wheel, body_to_world(self.M, s['wheel_vertex']))
            h, n = height_normal(vert[0], vert[2])
            depth = vert[1] - h
            if depth > 0:
                self.latch[i] = False if self.a.unlatch_air else self.latch[i]
                contacts.append(None)
                continue
            C = (vert[0], h, vert[2])
            spd = self.tangent(C)
            tm = material(vert[0], vert[2])
            A = 0.5 * (s['wheel_mat_friction'] + FRICTION.get(tm, 1.0))
            res = 0.5 * (s['wheel_mat_resist'] + RESIST.get(tm, 0.02))
            contacts.append(dict(i=i, wheel=wheel, C=C, rel=sub(C, wheel), n=n, depth=depth, spd=spd, A=A, res=res))
        # resolve: solveImpulse (spring branch) then addFriction, per part
        self.diag = dict(dv=[], cnt=0)
        for c in contacts:
            if c is None: continue
            i = c['i']; sp = s['springs'][i]; n = c['n']
            push_s = min(1.0, max(0.0, -c['depth'] * dot(n, n)))
            self.push[i] = mul(n, push_s)
            wheel_now = add(c['wheel'], self.push[i])
            # addFriction 0x0825b6e0, EngineGrip arm
            lo = c['A'] * 1.5 * 9.82 / 30 * n[1]
            hi = c['A'] * 2.25 * 9.82 / 30 * n[1]
            V = c['spd']; V = (V[0], V[1] + G / 30, V[2])
            Vt = sub(V, proj(V, n))
            if c['res'] > 0 and self.a.resistance:
                self.acc = add(self.acc, mul(Vt, -c['res']))
            fwd = self.M[2]
            if e.brake == 0:
                sc = e.ratio() * e.diff_rpm(sp['side'])
                T1 = mul(fwd, sc * (1 - 0.5 * e.b))
                T2 = mul(proj(Vt, fwd), 0.5 * e.b)
                T = add(T1, T2)
                T = sub(T, proj(T, n))
            else:
                T = (0.0, 0.0, 0.0)
            dV = sub(T, Vt)
            m2 = dot(dV, dV)
            if self.latch[i]:
                if m2 > hi * hi and m2 > 1.0000001e-06:
                    self.latch[i] = False
                    dV = mul(dV, abs(hi) / math.sqrt(m2))
                    m2b = dot(dV, dV)
                    if m2b > lo * lo and m2b > 1.0000001e-06:
                        dV = mul(dV, abs(lo) / math.sqrt(m2b))
            else:
                if m2 > lo * lo and m2 > 1.0000001e-06:
                    dV = mul(dV, abs(lo) / math.sqrt(m2))
                else:
                    self.latch[i] = True
            e.feedback(dV, fwd)
            f = mul(dV, 30.0)
            p = add(wheel_now, c['rel'])
            nn = self.nfr
            self.fr = mul(add(mul(self.fr, nn), f), 1 / (nn + 1))
            self.rfr = mul(add(mul(self.rfr, nn), cross(sub(p, self.P), f)), 1 / (nn + 1))
            self.nfr += 1
            self.diag['dv'].append(dV)
            if dot(c['spd'], c['spd']) > 0.1 and self.sleepiness >= 0: self.sleepiness = 100
        self.diag['cnt'] = self.nfr

    def seed(self, st, prev_rot=None, sleep_in=None):
        self.P = tuple(st['pos']); self.M = quat_rows(st['rot'])
        self.v = tuple(st['v'] or (0, 0, 0)); self.w = tuple(st['w'] or (0, 0, 0))
        self.acc = tuple(st['acc'] or (0, G, 0)); self.racc = tuple(st['racc'] or (0, 0, 0))
        self.fr = tuple(st['fr'] or (0, 0, 0)); self.rfr = tuple(st['rfr'] or (0, 0, 0))
        self.nfr = 0
        # the static latch is hidden per-wheel state: a tick whose mean friction request sat inside
        # the kinetic budget left the wheels latched (heuristic; 0.8*0.491 = the smallest budget)
        if self.a.latch0 >= 0:
            self.latch = [norm(self.fr) / 30.0 < 0.95 * 0.8 * 1.5 * 9.82 / 30] * len(self.latch) if self.a.latch0 == 2 else [bool(self.a.latch0)] * len(self.latch)
        self.sleepiness = 0 if st.get('sleep') else self.a.seed_sleepiness
        # the sleep countdown is hidden state: when the server falls asleep within 100 ticks of
        # the seed while standing still, the counter at the seed was the ticks left
        if not st.get('sleep') and sleep_in is not None: self.sleepiness = sleep_in
        sp = st.get('springs') or []
        for i, spec in enumerate(self.s['springs']):
            j = self.a.spring_map[i] if self.a.spring_map else i
            if j < len(sp) and sp[j].get('rel') is not None:
                rel = sp[j]['rel']
                # rel is the wheel's position relative to its parent (the track); rest in track frame
                rest_t = self.a.rest_track[i]
                d_body = sub(tuple(rel), rest_t)
                d = body_to_world(self.M, d_body)
                # 2 mm quantisation: keep only the part along the ground normal the push lies on
                wheel = add(self.P, body_to_world(self.M, spec['rest']))
                vert = add(wheel, body_to_world(self.M, self.s['wheel_vertex']))
                _, n = height_normal(vert[0], vert[2])
                self.push[i] = mul(n, max(0.0, dot(d, n))) if self.a.project_seed else d
                dp = tuple(sp[j]['dprev'])
                self.Dprev[i] = mul(n, dot(dp, n)) if self.a.project_seed else dp
        en = (st.get('engines') or [{}])[0]
        if 'revs' in en: self.eng.revs = en['revs'] * self.a.revscale
        if 'gear' in en: self.eng.gear = en['gear'] + self.a.gearoff
        if 'a4' in en: self.eng.L = en['a4'] * self.a.lscale
        if 'a10c' in en: self.eng.ang[2] = en['a10c'] * self.a.angscale
        if 'a104' in en: self.eng.ang[0] = en['a104'] * self.a.angscale
        if 'b0' in en: self.eng.steer = en['b0']


def load(path):
    rows = [json.loads(l) for l in gzip.open(path, 'rt')]
    words = {r['serial']: r for r in rows if r['kind'] == 'word'}
    phases = {r['phase']: r['name'] for r in rows if r['kind'] == 'phase'}
    states = [r for r in rows if r['kind'] == 'cs']
    for st in states:
        st['engines'] = [st['engine']]
    return words, states, phases


def word_axes(w):
    st = w['st'] if w else {}
    q = 1.0  # PlayerAction::get 0x0815c5a0: round(((2n/4095 - 1)*16)*100)/100, so 2175 -> 1.00
    thr = (q if st.get('forward') else 0) - (q if st.get('back') else 0)
    yaw = (q if st.get('right') else 0) - (q if st.get('left') else 0)
    return thr, yaw


def yaw_of(M):
    return math.degrees(math.atan2(M[2][0], M[2][2]))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('path', nargs='?', default=LOG)
    ap.add_argument('--terrain', default=TERRAIN)
    ap.add_argument('--start', type=int, default=None)
    ap.add_argument('--end', type=int, default=None)
    ap.add_argument('--mode', default='free')
    ap.add_argument('--h', type=int, default=30)
    ap.add_argument('--iyscale', type=float, default=1.0)
    ap.add_argument('-v', '--verbose', action='store_true')
    ap.add_argument('--no-drag', dest='drag', action='store_false')
    ap.add_argument('--no-resistance', dest='resistance', action='store_false')
    ap.add_argument('--rotsign', type=float, default=1.0)
    ap.add_argument('--revscale', type=float, default=1.25)
    ap.add_argument('--lscale', type=float, default=1.25)
    ap.add_argument('--angscale', type=float, default=1.25)
    ap.add_argument('--gearoff', type=int, default=0)
    ap.add_argument('--unlatch-air', action='store_true')
    ap.add_argument('--seed-sleepiness', type=int, default=100)
    ap.add_argument('--latch0', type=int, default=2, help='seed latch: 0 off, 1 on, 2 from the seed tick friction')
    ap.add_argument('--raw-seed', dest='project_seed', action='store_false')
    ap.add_argument('--no-seed-engine', action='store_true')
    a = ap.parse_args()
    global _T
    _T = Terrain.from_fixture(a.terrain)
    doc = json.load(gzip.open(a.terrain, 'rt'))
    FRICTION.update({int(k): v for k, v in doc['materialFriction'].items()})
    RESIST.update({int(k): v for k, v in doc['materialResistance'].items()})
    spec = SHERMAN
    a.spring_map = None
    # rest positions in the track frame (what SpringNetworkable sends) per driven spring
    a.rest_track = [(-0.999, 0.12, 1.2), (-0.999, 0.12, -1.249), (1.0, 0.12, 1.2), (1.0, 0.12, -1.249)]
    words, states, phases = load(a.path)
    byser = {}
    for st in states: byser[st['serial']] = st
    sers = sorted(byser)
    first_word = min(words)
    start = a.start if a.start is not None else first_word
    end = a.end if a.end is not None else max(words) + 1
    s0 = max(s for s in sers if s <= start)
    def sleep_in(s):
        for k in range(s + 1, s + 102):
            st = byser.get(k)
            if st is None: continue
            if st.get('sleep'): return k - s - 1
            if norm(st['v'] or (0, 0, 0)) > 0.05: return None
        return None
    hull = Hull(spec, a)
    hull.seed(byser[s0], sleep_in=sleep_in(s0))
    errs = {}
    if a.mode == 'horizon':
        # from every ack, run a.h ticks open loop and score the ack that lands there
        for s_start in sers:
            if s_start < start or s_start + a.h >= end: continue
            tgt = s_start + a.h
            if tgt not in byser: continue
            h = Hull(spec, a); h.seed(byser[s_start], sleep_in=sleep_in(s_start))
            for ser in range(s_start + 1, tgt + 1):
                thr, yaw = word_axes(words.get(ser)); h.tick(thr, yaw)
            st = byser[tgt]; p = st['pos']
            dh = math.hypot(h.P[0] - p[0], h.P[2] - p[2]) * 1000
            dy = abs(h.P[1] - p[1]) * 1000
            dyaw = abs((yaw_of(h.M) - yaw_of(quat_rows(st['rot'])) + 180) % 360 - 180)
            w0 = words.get(tgt); ph = w0['phase'] if w0 else -1
            errs.setdefault(ph, []).append((dh, dy, dyaw))
        hull = None
    ser = s0
    if a.verbose and hull:
        print(' serial ph    dH(mm)  dY(mm)  dyaw(deg)  vpred  vsrv   revs(p/s)  gear(p/s)  cnt')
    while hull and ser < end:
        ser += 1
        w = words.get(ser)
        thr, yaw = word_axes(w)
        hull.tick(thr, yaw)
        if ser in byser:
            st = byser[ser]
            p = st['pos']
            dh = math.hypot(hull.P[0] - p[0], hull.P[2] - p[2]) * 1000
            dy = (hull.P[1] - p[1]) * 1000
            Ms = quat_rows(st['rot'])
            dyaw = (yaw_of(hull.M) - yaw_of(Ms) + 180) % 360 - 180
            ph = w['phase'] if w else -1
            errs.setdefault(ph, []).append((dh, abs(dy), abs(dyaw)))
            en = (st.get('engines') or [{}])[0]
            if a.verbose:
                vs = st['v'] or (0, 0, 0)
                print('%6d %2d %9.1f %7.1f %8.3f  %6.3f %6.3f  %5.3f/%5.3f  %d/%s  %d  fr=%s/%s' % (
                    ser, ph, dh, dy, dyaw, norm(hull.v), norm(vs), hull.eng.revs, en.get('revs', 0) * a.revscale,
                    hull.eng.gear, en.get('gear'), hull.diag.get('cnt', 0),
                    tuple(round(x, 3) for x in hull.fr), tuple(round(x, 3) for x in (st['fr'] or (0, 0, 0)))))
            if a.mode == 'step':
                hull.seed(st, sleep_in=sleep_in(ser))
    print('\nper-ack error by phase (median / p90 / max):')
    print('  phase                 n   horiz mm                vert mm              yaw deg')
    for ph in sorted(errs):
        e = errs[ph]
        def q(k):
            xs = sorted(x[k] for x in e)
            return xs[len(xs)//2], xs[int(len(xs)*0.9)], xs[-1]
        print('  %2d %-16s %4d  %7.1f %7.1f %8.1f   %6.1f %6.1f %6.1f   %6.2f %6.2f %6.2f' % (
            ph, phases.get(ph, '?'), len(e), *q(0), *q(1), *q(2)))


if __name__ == '__main__':
    main()
