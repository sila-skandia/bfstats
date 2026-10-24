#!/usr/bin/env python3
"""Replay the jump-law probe's words through the server's per-tick soldier law, jump included.

    python3 lab/jump_law_check.py [probe.ndjson[.gz]] [--lock-stand 28] [--lock-run N]
                       [--offset 0] [--free] [--verbose]

The log is lab/jump_law_probe.mjs's (vanilla Wake, team 2, spawn group 1). The
ground law is move_law_check.py's (PHY-34), imported; this adds the jump
(PHY-1) and its gate, and scores the feet against the server at every
acknowledged serial with the server's state put back at each ack (--free: one
uncorrected run per phase instead).

The jump, per tick (lnxded BFSoldier::handlePlayerInput 0x08273c70):

  taken iff  c_PIAction is down in THIS tick's word (a level, not an edge)
             and the pose flags have neither crouch nor prone (0x60)
             and the arming bit 0x40 is set: the previous tick's
                 BFSoldier::handleCollision (|v|^2 >= 0.1) met a normal.y > 0.1
                 not on Water (0x0827d566)
             and BFSoldier::getSoundTrigger() != c_SstJump (4): the lower body
                 is not still in a jump state (Lb_StandJump, Lb_RunJump,
                 Lb_RunJumpBackward; AnimationStatesJump.con)
  then       acc += ((0, K*N.y*6.0, 0) - 0.25*vCmd) * 30 ; vCmd = 0
             K = min(1 + dot(normalise(vCmd, y=0), N), 1)

The lock (how long the jump state lasts) is measured, in ticks from the jump
tick: --lock-stand / --lock-run / --lock-back.
"""
import argparse, gzip, json, math, os, statistics, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import move_law_check as M
from move_law_terrain import Terrain

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_LOG = os.path.join(HERE, '..', 'tests', 'fixtures', 'jump_law_wake.ndjson.gz')
JUMP = 6.0
KICK = 0.25


# The lower body's locomotion states (animations/AnimationStatesLower.con and
# AnimationStatesJump.con, vanilla), each with its ordered input transitions
# (channel tests, first match wins; AnimationState::checkTransitions 0x0832a0f0)
# and the state it returns to when none matches. A taken transition is chased
# through the new state's own list in the same call
# (AnimationStateMachineInstance::checkTransitions 0x0832b570 recurses), so a
# press of jump from any standing gait ends in a jump state. The jump states
# are one-shots: no input transitions; their clip runs out after 1/|speed| s
# (3pAnimationsTweaking.con: Lb_StandJump 1.10, Lb_RunJump 1.18,
# Lb_RunJumpBackward -1.20) and hands over by addTransitionWhenDone.
def _t(thr=None, yaw=None, mx=None, walk=None, act=None):
    def test(i):
        for key, rng in (('thr', thr), ('yaw', yaw), ('mx', mx), ('walk', walk), ('act', act)):
            if rng is None: continue
            v = i[key]
            if v < rng[0] or v > rng[1]: return False
        return True
    return test
POS = (0.5, 1); NEG = (-1, -0.5); ON = (0.5, 1)
LOWER = {
    'stand':   ([(_t(thr=POS), 'runF'), (_t(thr=NEG), 'runB'), (_t(mx=(-1, -0.01)), 'turnL'),
                 (_t(mx=(0.01, 1)), 'turnR'), (_t(yaw=(-1, -0.01)), 'strafeL'), (_t(yaw=(0.01, 1)), 'strafeR'),
                 (_t(act=ON), 'jStand')], 'stand'),
    'walkF':   ([(_t(act=ON), 'jStand'), (_t(thr=POS, walk=ON), 'walkF'), (_t(thr=(-9999, -0.5), walk=ON), 'walkB'),
                 (_t(thr=POS), 'runF'), (_t(thr=NEG), 'runB'), (_t(yaw=(0.5, 1), walk=ON), 'walkF'),
                 (_t(yaw=(-1, -0.5), walk=ON), 'walkF')], 'stand'),
    'walkB':   ([(_t(act=ON), 'jStand'), (_t(thr=POS, walk=ON), 'walkF'), (_t(thr=(-9999, -0.5), walk=ON), 'walkB'),
                 (_t(thr=POS), 'runF'), (_t(thr=NEG), 'runB')], 'stand'),
    'runF':    ([(_t(act=ON), 'jRun'), (_t(walk=ON), 'walkF'), (_t(thr=POS), 'runF')], 'stand'),
    'runB':    ([(_t(act=ON), 'jBack'), (_t(walk=ON), 'walkB'), (_t(thr=NEG), 'runB')], 'stand'),
    'turnL':   ([(_t(act=ON), 'jStand'), (_t(thr=POS), 'runF'), (_t(thr=NEG), 'runB'), (_t(yaw=(-1, -0.01)), 'strafeL'),
                 (_t(yaw=(0.01, 1)), 'strafeR'), (_t(mx=(-1, -0.01)), 'turnL')], 'stand'),
    'turnR':   ([(_t(act=ON), 'jStand'), (_t(thr=POS), 'runF'), (_t(thr=NEG), 'runB'), (_t(yaw=(-1, -0.01)), 'strafeL'),
                 (_t(yaw=(0.01, 1)), 'strafeR'), (_t(mx=(0.01, 1)), 'turnR')], 'stand'),
    'strafeL': ([(_t(act=ON), 'jRun'), (_t(yaw=(-1, -0.01), walk=ON), 'walkF'), (_t(thr=POS), 'runF'), (_t(thr=NEG), 'runB'),
                 (_t(yaw=(-1, -0.01)), 'strafeL'), (_t(mx=(-1, -0.01)), 'turnL'), (_t(mx=(0.01, 1)), 'turnR')], 'stand'),
    'strafeR': ([(_t(act=ON), 'jRun'), (_t(yaw=(0.5, 1), walk=ON), 'walkF'), (_t(thr=POS), 'runF'), (_t(thr=NEG), 'runB'),
                 (_t(yaw=(0.01, 1)), 'strafeR'), (_t(mx=(-1, -0.01)), 'turnL'), (_t(mx=(0.01, 1)), 'turnR')], 'stand'),
}
JUMP_STATES = {'jStand': (1.10, 'stand'), 'jRun': (1.18, 'runF'), 'jBack': (-1.20, 'runB')}


class Lower:
    def __init__(self, rate=1.0):
        self.state = 'stand'; self.fresh = True; self.phase = 0.0; self.rate = rate

    def trigger(self):
        return 'jump' if self.state in JUMP_STATES else 'other'

    def transitions(self, thr, yaw, mx, walk, act):
        if self.state in JUMP_STATES: return
        i = {'thr': thr, 'yaw': yaw, 'mx': mx, 'walk': 1.0 if walk else 0.0, 'act': 1.0 if act else 0.0}
        for _ in range(8):
            if self.state in JUMP_STATES: return
            trans, ret = LOWER[self.state]
            nxt = next((to for test, to in trans if test(i)), ret)
            if nxt == self.state: return
            self.state = nxt; self.fresh = True

    def update(self, dt):
        if self.state not in JUMP_STATES:
            self.fresh = False; return
        speed, done = JUMP_STATES[self.state]
        if self.fresh:
            self.fresh = False
            self.phase = 1.0 if speed < 0 else 0.0
            return
        self.phase += dt * speed * self.rate
        if self.phase > 1.0 or self.phase < 0.0:
            self.state = done; self.fresh = True


class Jumper(M.Soldier):
    def __init__(self, pos, vel, args):
        super().__init__(pos, vel, args)
        self.armed = True
        self.N = (0.0, 1.0, 0.0)
        self.lower = Lower(args.rate)
        self.jumped_at = []
        self.tick_no = 0
        self.crouched = False

    def tick(self, st, rot):
        a = self.a
        self.tick_no += 1
        fwd_in = (1 if st.get('forward') else 0) - (1 if st.get('back') else 0)
        str_in = st.get('strafe', 0) or 0
        self.ramp_f = M.apply_movement_factors(fwd_in, self.ramp_f)
        self.ramp_s = M.apply_movement_factors(str_in, self.ramp_s)
        pose = 1 if self.crouched else 0
        rf = self.ramp_f * 0.007874016; rs = self.ramp_s * 0.007874016
        table = M.DIR_SPEED[pose*2 + (1 if self.ramp_f <= 0 else 0)]
        vf = math.copysign(rf*rf, rf) * table if rf else 0.0
        vs = math.copysign(rs*rs, rs) * M.STRAFE_SPEED[pose] if rs else 0.0
        if st.get('walk') and pose == 0:
            vf *= M.WALK; vs *= M.WALK
        right, forward = M.quat_rows(rot)
        cmd = M.add(M.mul(forward, vf), M.mul(right, vs))
        if M.dot(cmd, cmd) > table*table:
            cmd = M.mul(cmd, table / M.norm(cmd))
        want = bool(st.get('jump'))
        locked = self.lower.trigger() == 'jump'
        if want and pose == 0 and self.armed and not locked:
            N = self.N
            h = math.hypot(cmd[0], cmd[2])
            d = (cmd[0]/h, 0.0, cmd[2]/h) if h > 1e-9 else (0.0, 0.0, 0.0)
            K = min(1 + M.dot(d, N), 1.0)
            self.acc = M.add(self.acc, M.mul(M.sub((0.0, K*N[1]*JUMP, 0.0), M.mul(cmd, KICK)), 30.0))
            self.jumped_at.append(self.tick_no)
            cmd = (0.0, 0.0, 0.0)
        else:
            self.acc = M.add(self.acc, M.mul(cmd, 0.75))
        # the lower body's transitions on this word, then its clock
        if pose == 0:
            self.lower.transitions(fwd_in, str_in, st.get('lookX', 0) or 0, bool(st.get('walk')), want)
        self.lower.update(M.DT)
        # the stance the word asks for lands after this tick's input (measured)
        self.crouched = bool(st.get('crouch'))
        self.surf_last = cmd
        sp = M.norm(self.v); k = -a.drag * sp / a.mass
        for row, area in ((right, a.area_x), ((0.0, 1.0, 0.0), a.area_y), (forward, a.area_z)):
            self.acc = M.add(self.acc, M.mul(row, k * area * M.dot(self.v, row)))
        self.v = M.add(self.v, M.mul(self.acc, M.DT))
        self.v = M.add(self.v, M.mul(self.fr, M.DT))
        self.pos = M.add(self.pos, M.mul(self.v, M.DT))
        self.acc = (0.0, M.G, 0.0); self.fr = (0.0, 0.0, 0.0)
        self.vpost = self.v
        self.resolve(cmd)

    def resolve(self, surf):
        super().resolve(surf)
        # arming: handleCollision ran (|v|^2 >= 0.1) on an upward normal, not Water
        x, y, z = self.pos
        if self.contacts_last:
            h, n = M.height_normal(x, z)
            speed = self.vpost
            ran = M.dot(speed, speed) >= 0.1
            self.armed = ran and n[1] > 0.1 and M.material(x, z) != 1
            if ran: self.N = n
        else:
            self.armed = False


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


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument('path', nargs='?', default=DEFAULT_LOG)
    ap.add_argument('--terrain', default=None, help='terrain fixture (default: move_law_wake_terrain.json.gz)')
    ap.add_argument('--rate', type=float, default=1.03, help='the jump clips\' clock against 30 Hz ticks (fitted)')
    ap.add_argument('--offset', type=int, default=0, help='apply each word this many ticks late')
    ap.add_argument('--free', action='store_true')
    ap.add_argument('--verbose', '-v', action='store_true')
    ap.add_argument('--json', action='store_true')
    a = ap.parse_args(argv)
    for k, v in dict(walkforce=True, walkforce_always=True, resistance=True, drag=1.0, mass=100.0,
                     area_x=1.14, area_y=0.50, area_z=1.14, foot=1.0, S=1.0, elasticity=0.0,
                     strafe_sign=1.0, crouch_pose=True, linear_ramp=False).items():
        setattr(a, k, v)
    M.TERRAIN = Terrain.from_fixture(a.terrain) if a.terrain else Terrain.from_fixture()
    words, states = load(a.path)
    byser = {s[0]: s for s in states}
    sers = sorted(byser)
    first_word = min(words)
    start = max(s for s in sers if s < first_word)
    end = max(words) + 30
    s0 = byser[start]
    sold = Jumper(s0[1], s0[2], a)
    sold.pos = M.add(s0[1], M.mul(s0[2], M.DT * 0.5))
    sold.resolve((0.0, 0.0, 0.0))
    sold.pos = s0[1]
    rot = s0[3]
    errs = {}; rows_out = []
    server_jumps = []
    ser = start
    last_phase = None
    while ser < end:
        ser += 1
        w = words.get(ser - a.offset)
        st = w['st'] if w else {}
        if ser in byser and byser[ser][3]: rot = byser[ser][3]
        sold.tick(st, rot)
        if ser not in byser:
            continue
        _, p, v, r = byser[ser]
        ph = w['phase'] if w else 'tail'
        if a.free and ph != last_phase:
            last_phase = ph
            sold.pos = M.add(sold.pos_pre, M.sub(p, sold.pos)); sold.v = v; sold.vpost = v
            sold.acc = (0.0, M.G, 0.0); sold.fr = (0.0, 0.0, 0.0)
            sold.resolve(sold.surf_last); sold.pos = p
            continue
        dy = (sold.pos[1] - p[1]) * 1000
        dh = math.hypot(sold.pos[0] - p[0], sold.pos[2] - p[2]) * 1000
        errs.setdefault(ph, []).append((dh, dy))
        rows_out.append((ser, ph, w['i'] if w else -1, st.get('jump', False), sold.pos[1], p[1], dy, dh, sold.vpost[1], v[1]))
        if a.verbose:
            print('%5d %-10s %3d %s  y %.4f srv %.4f  dy %8.1f  dh %6.1f  vy %+.3f srv %+.3f' % rows_out[-1][:2] + rows_out[-1][2:] if False else
                  '%5d %-10s %3d %s  y %.4f srv %.4f  dy %8.1f  dh %6.1f  vy %+.3f srv %+.3f' % (
                      ser, ph, w['i'] if w else -1, 'J' if st.get('jump') else ' ', sold.pos[1], p[1], dy, dh, sold.vpost[1], v[1]))
        if not a.free:
            sold.pos = M.add(sold.pos_pre, M.sub(p, sold.pos)); sold.v = v; sold.vpost = v
            sold.acc = (0.0, M.G, 0.0); sold.fr = (0.0, 0.0, 0.0)
            sold.latch = sold.latch_before
            sold.resolve(sold.surf_last); sold.pos = p
    out = {}
    for ph, e in errs.items():
        ys = sorted(abs(x[1]) for x in e); hs = sorted(x[0] for x in e)
        out[ph] = {'n': len(e), 'dyMedian': ys[len(ys)//2], 'dyMax': ys[-1], 'dhMedian': hs[len(hs)//2], 'dhMax': hs[-1]}
    if a.json:
        print(json.dumps({'phases': out, 'jumps': len(sold.jumped_at)}))
    else:
        print('phase        n  |dy| med   max (mm)   dh med   max')
        for ph, s in out.items():
            print('%-10s %4d  %7.1f %8.1f   %6.1f %6.1f' % (ph, s['n'], s['dyMedian'], s['dyMax'], s['dhMedian'], s['dhMax']))
        print('jumps taken by the law:', len(sold.jumped_at))
    return out


if __name__ == '__main__':
    main()
