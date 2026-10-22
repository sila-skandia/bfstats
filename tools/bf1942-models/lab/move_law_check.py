#!/usr/bin/env python3
"""Replay the move-law probe's input words through the server's per-tick soldier law.

    python3 lab/move_law_check.py [probe.ndjson[.gz]] [--start SERIAL] [--end SERIAL]
                       [--resync] [--no-walkforce] [--drag K] [--foot 1.0] [--verbose]
                       [--heightmap Heightmap.raw --materialmap Materialmap.raw]

The log is lab/move_law_probe.mjs's (vanilla Wake, 2026-10-22); the default is
the trimmed copy in tests/fixtures/move_law_wake.ndjson.gz, whose terrain window
is tests/fixtures/move_law_wake_terrain.json.gz (move_law_terrain.py). The page's
own SoldierBody is held to the same server by tests/test_move_law.py.

Measured: with --resync (the server's state put back at every ack) the law is
inside ~1 mm of the server per acknowledged tick in the ramp up, the steady
run, every ramp down, the strafe, the back and the walk; the serial-1018 step
(+0.5 m in x, velocity unchanged) is a static push-out this replay does not
model and re-anchors over. Run2 (phase 15-16) carries the prone dive, which
this replay does not model either.

The law (lnxded addresses; see the report for what is read and what is inferred):

  tick(word):                                    one PlayerInput per 1/30 s tick (LOOP-1)
    handlePlayerInput 0x08273c70
      ramp_f, ramp_s = applyMovementFactors(input, 20, 12, ramp)        0x082807a0
      vf = sign(r)*r^2 * directionalSpeed[pose*2 + (ramp_f<=0)] * S      0x082747c6..0x08274828   r = ramp/127
      vs = sign(r)*r^2 * strafeSpeed[pose]                                0x0827487b..
      walk && pose==0: both * 1/3                                         0x08274850
      vCmd = fwdRow*vf + rightRow*vs ; |vCmd| capped to the UNRAMPED table speed   (0x082748..)
      if resp+0xa4 == 0: acc += 0.75*vCmd   (no x30)                      0x08274a09
      resp.setSurfacePositionalSpeed(vCmd)                                0x08274e2f (vt+0x74)
    PhysicsNode::updatePhysics 0x082543d0  (the soldier is a PhysicsNode: CID 0x9493 test at 0x0825440x)
      [box drag, Advanced: tiny for a soldier]
      v += acc*dt ; v += fr*dt ; pos += v*dt ; acc = (0,g,0) ; fr = 0     0x08253570
    ResponsePhysics::checkVsTerrain 0x0825a960 (5 vertices for a soldier; modelled as one, 1 m under origin)
      depth = vy - h(x,z) ; if depth <= 0:
        speed = v ; if |v|^2 >= 0.1: BFSoldier::handleCollision -> resp+0x98 = most upward N  0x0827d3b0
        impulseOn 0x08258900: posAdj (+)= -depth*N ; spdAdj (+)= -(v.N)N ; count++ ; A = mean friction
    solveImpulse 0x08258d30: pos += posAdj ; acc += spdAdj*30*(1+e)*0.5      (e = 0)
    addFriction 0x0825b6e0 (soldier arm):
      lo = A*4.8*9.82/30*Ny^5 ; hi = A*7.2*9.82/30*Ny^5   (Ny from +0x98; 0 if no handleCollision)
      V = v - vCmd ; V.y += g/30 ; Vt = V - N(V.N)/(N.N)
      acc += -resistance*Vt
      dV = -Vt ; latched: |dV|>hi -> unlatch, dV scaled to lo ; else full
                 unlatched: |dV|>lo -> dV scaled to lo ; else latch
      fr = 30*dV   (PhysicsNode::addFrictionAtAbsolutePosition 0x08254e50, running mean)
      clear count (+0xa4), N, averages, surface speed
"""
import gzip, json, math, sys, os, argparse, statistics
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from move_law_terrain import Terrain

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_LOG = os.path.join(HERE, '..', 'tests', 'fixtures', 'move_law_wake.ndjson.gz')
TERRAIN = None


def height_normal(x, z):
    return TERRAIN.height_normal(x, z)


def material(x, z):
    return TERRAIN.material(x, z)

DT = 1.0 / 30.0
G = -14.73                       # 1.5 * -9.82, physics.md section 2
DIR_SPEED = [6, 4, 2, 2, 1, 1]   # 0x0872edec
STRAFE_SPEED = [4, 2, 1]         # 0x0872ee04
WALK = 1.0 / 3.0                 # 0x0872ee10
ACC, DEC = 20, 12                # 0x0872ee14 / 0x0872ee18
# MaterialManager.materialFriction / materialResistance (vanilla materialManagerdefine.con)
FRICTION = {0: 1.0, 1: 0.1, 2: 0.8, 3: 0.8, 4: 1.0, 5: 0.8, 6: 0.5, 7: 0.5, 8: 1.1, 9: 0.8,
            10: 0.8, 11: 0.8, 12: 0.6, 13: 1.0, 14: 1.0, 15: 1.1}
RESIST = {0: 0.02, 1: 0.1, 2: 0.06, 3: 0.08, 4: 0.04, 5: 0.06, 6: 0.1, 7: 0.08, 8: 0.02, 9: 0.05,
          10: 0.05, 11: 0.04, 12: 0.01, 13: 0.02, 14: 0.02, 15: 0.01}
SOLDIER_MAT = 40                 # setSkeletonCollisionBone materials 40..42: undefined -> material 0


def apply_movement_factors(inp, state):
    if inp == 0 and state != 0:
        return max(state - DEC, 0) if state > 0 else min(state + DEC, 0)
    if inp > 0:
        return min(max(state, 0) + ACC, 127)
    if inp < 0:
        return max(min(state, 0) - ACC, -127)
    return state


def quat_rows(q):
    x, y, z, w = q
    # rows of the rotation matrix (row-vector convention): row0 = right, row2 = forward
    r0 = (1 - 2*(y*y + z*z), 2*(x*y + z*w), 2*(x*z - y*w))
    r2 = (2*(x*z + y*w), 2*(y*z - x*w), 1 - 2*(x*x + y*y))
    return r0, r2


def dot(a, b): return a[0]*b[0] + a[1]*b[1] + a[2]*b[2]
def add(a, b): return (a[0]+b[0], a[1]+b[1], a[2]+b[2])
def sub(a, b): return (a[0]-b[0], a[1]-b[1], a[2]-b[2])
def mul(a, s): return (a[0]*s, a[1]*s, a[2]*s)
def norm(a): return math.sqrt(dot(a, a))


def set_adjust(cur, val):
    if cur == 0: return val
    if (cur > 0) != (val > 0): return cur + val
    return val if abs(val) > abs(cur) else cur


class Soldier:
    def __init__(self, pos, vel, args):
        self.pos = tuple(pos); self.v = tuple(vel)
        self.acc = (0.0, G, 0.0); self.fr = (0.0, 0.0, 0.0)
        self.ramp_f = 0; self.ramp_s = 0; self.latch = True
        self.contacts_last = 0
        self.a = args
        self.vpost = self.v
        self.surf_last = (0.0, 0.0, 0.0)

    def tick(self, st, rot):
        a = self.a
        # ---- handlePlayerInput -------------------------------------------------------
        fwd_in = (1 if st.get('forward') else 0) - (1 if st.get('back') else 0)
        str_in = st.get('strafe', 0) or 0
        self.ramp_f = apply_movement_factors(fwd_in, self.ramp_f)
        self.ramp_s = apply_movement_factors(str_in, self.ramp_s)
        pose = 1 if (st.get('crouch') and a.crouch_pose) else 0
        rf = self.ramp_f * 0.007874016; rs = self.ramp_s * 0.007874016
        table = DIR_SPEED[pose*2 + (1 if self.ramp_f <= 0 else 0)] * a.S
        if a.linear_ramp:     # the PHY-6 reading (ramp/127, not squared): refuted by the data
            vf = rf * table; vs = rs * STRAFE_SPEED[pose]
        else:                 # sign(r)*r*r, 0x08274807..0x0827482c
            vf = math.copysign(rf*rf, rf) * table if rf else 0.0
            vs = math.copysign(rs*rs, rs) * STRAFE_SPEED[pose] if rs else 0.0
        if st.get('walk') and pose == 0:
            vf *= WALK; vs *= WALK
        right, forward = quat_rows(rot)
        cmd = add(mul(forward, vf), mul(right, vs * a.strafe_sign))
        if dot(cmd, cmd) > table*table:
            cmd = mul(cmd, table / norm(cmd))
        if a.walkforce and (self.contacts_last == 0 or a.walkforce_always):
            self.acc = add(self.acc, mul(cmd, 0.75))
        surf = cmd
        self.surf_last = cmd
        # ---- PhysicsNode::updatePhysics ------------------------------------------------
        if a.drag:
            # updatePositionalDragAdvanced 0x08252f50: k = -drag*|v|/mass, areas on the
            # object's own rows (right, up, forward); ObjectTemplate.drag 1.0, mass 100
            sp = norm(self.v); k = -a.drag * sp / a.mass
            up = (0.0, 1.0, 0.0)
            for row, area in ((right, a.area_x), (up, a.area_y), (forward, a.area_z)):
                self.acc = add(self.acc, mul(row, k * area * dot(self.v, row)))
        self.v = add(self.v, mul(self.acc, DT))
        self.v = add(self.v, mul(self.fr, DT))
        self.pos = add(self.pos, mul(self.v, DT))
        self.acc = (0.0, G, 0.0); self.fr = (0.0, 0.0, 0.0)
        self.vpost = self.v
        self.resolve(surf)

    def resolve(self, surf):
        a = self.a
        self.latch_before = self.latch
        self.pos_pre = self.pos
        # ---- checkVsTerrain (one vertex, a.foot under the origin) ---------------------
        x, y, z = self.pos
        h, n = height_normal(x, z)
        depth = (y - a.foot) - h
        self.contacts_last = 0
        if depth > 0:
            return
        self.contacts_last = 1
        tmat = material(x, z)
        A = 0.5 * (FRICTION.get(SOLDIER_MAT, 1.0) + FRICTION.get(tmat, 1.0))
        res = 0.5 * (RESIST.get(SOLDIER_MAT, 0.02) + RESIST.get(tmat, 0.02))
        speed = self.v
        N = n if dot(speed, speed) >= 0.1 else (0.0, 0.0, 0.0)
        pos_adj = mul(n, -depth)
        k = -dot(speed, n) / dot(n, n)
        spd_adj = mul(n, k)
        # ---- solveImpulse ----------------------------------------------------------------
        self.pos = add(self.pos, pos_adj)
        if any(pos_adj):
            self.acc = add(self.acc, mul(spd_adj, 30 * 0.5 * (1 + a.elasticity)))
        # ---- addFriction (soldier arm) ---------------------------------------------------
        ny = N[1]
        lo = A * 4.8 * 9.82 / 30 * ny**5
        hi = A * 7.2 * 9.82 / 30 * ny**5
        V = sub(speed, surf); V = (V[0], V[1] + G / 30, V[2])
        nn = dot(N, N)
        Vt = sub(V, mul(N, dot(V, N) / nn)) if nn != 0 else V
        if res > 0 and a.resistance:
            self.acc = add(self.acc, mul(Vt, -res))
        dV = mul(Vt, -1)
        m2 = dot(dV, dV)
        if self.latch:
            if m2 > hi*hi and m2 > 1.0000001e-06:
                self.latch = False
                dV = mul(dV, abs(hi) / math.sqrt(m2))
                m2b = dot(dV, dV)
                if m2b > lo*lo and m2b > 1.0000001e-06:
                    dV = mul(dV, abs(lo) / math.sqrt(m2b))
        else:
            if m2 > lo*lo and m2 > 1.0000001e-06:
                dV = mul(dV, abs(lo) / math.sqrt(m2))
            else:
                self.latch = True
        self.fr = mul(dV, 30.0)


def load(path):
    opener = gzip.open if path.endswith('.gz') else open
    rows = [json.loads(l) for l in opener(path, 'rt')]
    words = {r['serial']: r for r in rows if r['kind'] == 'word'}
    states = []
    pos = vel = rot = None
    for r in rows:
        if r['kind'] != 'cs' or r.get('cls') != 'BFSoldierNetworkable':
            continue
        if r.get('pos'): pos = r['pos']
        if r.get('vel'): vel = r['vel']
        if r.get('rot'): rot = r['rot']
        states.append((r['serial'], tuple(pos), tuple(vel), tuple(rot)))
    return words, states


PHASES = {0: 'idle', 1: 'run', 2: 'stop', 3: 'tap', 4: 'tap-stop', 5: 'strafe', 6: 'strafe-stop',
          7: 'back', 8: 'back-stop', 9: 'walk', 10: 'walk-stop', 11: 'crouch', 12: 'crouch-fwd',
          13: 'crouch-stop', 14: 'stand', 15: 'run2', 16: 'run2-stop'}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('path', nargs='?', default=DEFAULT_LOG)
    ap.add_argument('--heightmap', help="the level's whole Heightmap.raw (default: the fixture's window)")
    ap.add_argument('--materialmap', help="the level's whole Materialmap.raw, with --heightmap")
    ap.add_argument('--start', type=int, default=730)
    ap.add_argument('--end', type=int, default=1460)
    ap.add_argument('--resync', action='store_true', help='reset to the server state at every ack (per-tick error only)')
    ap.add_argument('--no-walkforce', dest='walkforce', action='store_false')
    ap.add_argument('--gated-walkforce', dest='walkforce_always', action='store_false',
                    help='gate 0.75*vCmd on last tick having no contact (the reading the data refutes)')
    ap.add_argument('--no-resistance', dest='resistance', action='store_false')
    ap.add_argument('--drag', type=float, default=1.0, help='ObjectTemplate.drag (CommonSoldierData.inc: 1.0); 0 = off')
    ap.add_argument('--mass', type=float, default=100.0)
    # Fitted from retail air data (canopy, free fall, bail-out; 2026-10-22):
    # viewer/soldier-locomotion.js SOLDIER_DRAG_AREAS.
    ap.add_argument('--area-x', type=float, default=1.14, help='(pi/4)*DY*DZ, fitted from retail air data')
    ap.add_argument('--area-y', type=float, default=0.50, help='(pi/4)*DX*DZ, fitted from retail air data')
    ap.add_argument('--area-z', type=float, default=1.14, help='(pi/4)*DX*DY, fitted from retail air data')
    ap.add_argument('--phase-resync', action='store_true', help='reset to the server state at the first ack of each phase')
    ap.add_argument('--foot', type=float, default=1.0)
    ap.add_argument('--S', type=float, default=1.0)
    ap.add_argument('--elasticity', type=float, default=0.0)
    ap.add_argument('--strafe-sign', type=float, default=1.0)
    ap.add_argument('--no-crouch-pose', dest='crouch_pose', action='store_false', help='ignore crouch (pose is really the animation state, PHY-8)')
    ap.add_argument('--verbose', '-v', action='store_true')
    ap.add_argument('--linear-ramp', action='store_true')
    ap.add_argument('--reanchor', type=float, default=0.2, help='metres; 0 = never')
    a = ap.parse_args()
    global TERRAIN
    TERRAIN = (Terrain.from_raw(a.heightmap, a.materialmap) if a.heightmap
               else Terrain.from_fixture())
    words, states = load(a.path)
    byser = {s[0]: s for s in states}
    first = min((s for s in states if s[0] >= a.start), key=lambda s: s[0])
    sold = Soldier(first[1], first[2], a)
    sold.pos = add(first[1], mul(first[2], DT * 0.5))   # an estimate of the pre-resolve position
    sold.resolve((0.0, 0.0, 0.0))
    sold.pos = first[1]
    rot = first[3]
    errs = {}
    subs = {}
    ser = first[0]
    last_phase = None
    resync_next = False
    if a.verbose:
        print(' serial ph  word      pred(x,y,z)                 server(x,y,z)            dH(mm)  dY(mm)   vpred(z)  vserv(z)')
    while ser < a.end:
        ser += 1
        w = words.get(ser)
        st = w['st'] if w else {}
        if ser in byser and byser[ser][3]: rot = byser[ser][3]
        sold.tick(st, rot)
        if ser in byser:
            _, p, v, r = byser[ser]
            ph0 = w['phase'] if w else -1
            def resync_here():
                # networked pos is post-resolve, networked vel pre-resolve: rebuild the
                # pre-resolve position by moving our own by the post-resolve difference
                sold.pos = add(sold.pos_pre, sub(p, sold.pos)); sold.v = v; sold.vpost = v
                sold.acc = (0.0, G, 0.0); sold.fr = (0.0, 0.0, 0.0)
                sold.latch = sold.latch_before
                sold.resolve(sold.surf_last); sold.pos = p
            if a.phase_resync and ph0 != last_phase:
                last_phase = ph0
                resync_here()
                continue
            dh = math.hypot(sold.pos[0] - p[0], sold.pos[2] - p[2]) * 1000
            dy = (sold.pos[1] - p[1]) * 1000
            if a.reanchor and dh > a.reanchor * 1000:
                # a position step the networked velocity does not show (serial 1018: +0.48 m in x
                # with vel unchanged): not physics. Move our state by it and do not score the ack.
                print('  re-anchor at %d: server stepped %.3f m with no velocity change' % (ser, dh / 1000))
                off = sub(p, sold.pos); sold.pos = p; sold.pos_pre = add(sold.pos_pre, off)
                continue
            ph = w['phase'] if w else -1
            errs.setdefault(ph, []).append(dh)
            # sub-phases of the first run: ramp up = its first 8 words, steady = the rest
            if ph == 1:
                sub_key = 'run: ramp up (739-746)' if ser <= 746 else 'run: steady (747-798)'
            elif ph in (2, 4, 6, 8, 10):
                sub_key = 'ramp down (all releases)'
            elif ph in (5, 7, 9):
                sub_key = {5: 'strafe right', 7: 'back', 9: 'walk forward'}[ph]
            else:
                sub_key = None
            if sub_key: subs.setdefault(sub_key, []).append(dh)
            if a.verbose:
                print('%6d %2d %-9s (%.3f %.3f %.3f)  (%.3f %.3f %.3f)  %6.1f  %6.1f   %6.3f %6.3f  %6.3f %6.3f' % (
                    ser, ph, ''.join(k[0] for k, val in st.items() if val), *sold.pos, *p, dh, dy,
                    sold.vpost[0], sold.vpost[2], v[0], v[2]))
            if a.resync:
                resync_here()
    print('\nhorizontal error per acknowledged serial (mm), by phase:')
    print('  phase              n   median     max')
    for ph in sorted(errs):
        e = errs[ph]
        print('  %2d %-12s %5d  %7.1f  %7.1f' % (ph, PHASES.get(ph, '?'), len(e), statistics.median(e), max(e)))
    print('\nsummary (mm):')
    for k in ['run: ramp up (739-746)', 'run: steady (747-798)', 'ramp down (all releases)', 'strafe right', 'back', 'walk forward']:
        if k in subs:
            e = subs[k]
            print('  %-26s n=%3d  median %6.1f  max %6.1f' % (k, len(e), statistics.median(e), max(e)))


if __name__ == '__main__':
    main()
