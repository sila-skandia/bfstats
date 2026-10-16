// Turn decoded ghost blocks into v5 recording rows the replay viewer reads
// (viewer/replay-recording.js): k:"o" when an object comes into scope, k:"d"
// when it leaves (ghost action 3), k:"s" transform samples, k:"st" soldier
// state rows, k:"a" hull hit points, and k:"f" a round leaving a vehicle gun.
//
// Shared by the live sidecar (sidecar.mjs) and the offline rebuild
// (rebuild.mjs), so both write the same file from the same records.

import { SoldierStateTracker } from './soldier-ghost.mjs';
import { fireLagFor, gunFor, hullFor, jointPartsFor } from './ghost/children.mjs';
import { ROUNDS_WON, TICKETS } from './ghost/score-manager.mjs';
import { STAT_FIELDS } from './ghost/player.mjs';
import { cpNameOf } from './game-tables.mjs';

// The named stats a k:"ps" row carries besides `sc` (the score) and `md` (the
// medals): every counter of BFPlayer's stat block and the ping.
export const PLAYER_STATS = ['kills', 'deaths', 'teamKills', 'captures', 'attacks', 'defences',
  'objectives', 'objectiveTeamKills', 'ping'];

export class GhostWriter {
  // write(row) appends one recording row; objInfo is netId -> {tid, tmpl, team}.
  constructor({ write, objInfo, cpNames = {} }) {
    this.write = write;
    this.objInfo = objInfo;
    this.cpNames = cpNames;    // control point template -> the name the game prints
    this.stance = new SoldierStateTracker();
    this.inScope = new Set();
    this.hp = new Map();       // netId -> last hit points written
    this.cpTeam = new Map();   // control point netId -> last side written
    this.tickets = [null, null];
    this.ticketsKey = null;
    this.result = [0, 0];       // the ScoreManager's winner and victory type (+0x5c, +0x5d)
    this.roundsWon = [0, 0];    // each side's rounds won (ints 10 and 21)
    this.resultKey = null;
    this.playerPid = new Map(); // a BFPlayer's netId -> pid (createPlayer)
    this.playerKey = new Map(); // pid -> last 'ps' row written
    this.mags = new Map();     // `${netId}:${fireArmsIndex}` -> last magA
    this.lastStep = new Map(); // same key -> time of the last round counted
    this.jointState = new Map(); // `${root}:${seat}:${i}` -> { x, y } angles in degrees
    this.jointNamed = new Set();
    this.jointLast = new Map();
    this.occupant = new Map(); // controlled netId -> pid
    this.seated = new Map();   // controlled netId -> [{ t, pid | null }], for a backdated round
    this.soldier = new Map();  // pid -> his on-foot soldier's netId
    this.camera = new Map();   // pid -> his free camera's netId (createPlayer)
    this.poses = new Map();    // netId -> [[t, pos, rot]], the last few seconds, to aim a backdated round
    this.heat = new Map();     // soldier netId -> his state bits' round counter (bits 8-10)
    this.aims = new Map();     // `${root}:${seat}` -> [[t, yaw, pitch]] in degrees, same
    this.stats = { objects: 0, samples: 0, stances: 0, hp: 0, fires: 0, scopeOuts: 0 };
  }

  // Event rows, for who sits where: a gun's round is credited to its gunner.
  // Returns the event rows to write after this one: getting out of a vehicle
  // hands the player back his soldier. The server sends no SetDefaultVehicle
  // for that (a bf42plus recording carries it in its k:"p" control rows), so
  // without one the viewer keeps him in the hull he left and never draws him
  // on foot (controlledAt in viewer/replay-recording.js). `derived` marks a
  // row the server never sent.
  note(row, t = row?.t) {
    if (!row) return [];
    const extra = [];
    if (row.e === 'createPlayer') {
      if (row.camNetId != null) this.camera.set(row.pid, row.camNetId);
      if (row.netId != null) this.playerPid.set(row.netId, row.pid);
    } else if (row.e === 'control') {
      if (row.netId != null && row.netId !== this.camera.get(row.pid)) this.soldier.set(row.pid, row.netId);
      else this.soldier.delete(row.pid);
    } else if (row.e === 'destroyPlayer') {
      this.soldier.delete(row.pid);
    } else if (row.e === 'exitVehicle' && !row.flag && this.soldier.has(row.pid)) {
      extra.push({ e: 'control', pid: row.pid, netId: this.soldier.get(row.pid), derived: 1 });
    }
    // A map reset (ResetMapEvent) empties this client's ghost scope: right
    // after it the server sends every object still in scope a full body again
    // (Wake, 2026-10-16: the Defguns' 265-bit bodies 90 ms after the reset),
    // and an object out of scope then gets nothing and no action 3. Left in
    // scope here, the bot's Corsair stayed parked on the page while the
    // client saw it fly; closed here, a full body reopens what is still near.
    if (row.e === 'raw' && row.name === 'ResetMap') {
      for (const id of this.inScope) { this.stats.scopeOuts++; this.write({ k: 'd', t, id }); }
      this.inScope.clear();
    }
    if (row.e === 'enterVehicle' || row.e === 'control') {
      this._leave(row.pid, t);
      if (row.netId != null) this._sit(row.netId, row.pid, t);
    } else if (row.e === 'exitVehicle' || row.e === 'destroyPlayer') {
      this._leave(row.pid, t);
    }
    return extra;
  }

  _sit(nid, pid, t) {
    this.occupant.set(nid, pid);
    if (!this.seated.has(nid)) this.seated.set(nid, []);
    this.seated.get(nid).push({ t, pid });
  }

  _leave(pid, t) {
    for (const [nid, p] of this.occupant) {
      if (p !== pid) continue;
      this.occupant.delete(nid);
      this.seated.get(nid)?.push({ t, pid: null });
    }
  }

  // Who sat in `nid` at time `t`.
  _occupantAt(nid, t) {
    let pid = null;
    for (const s of this.seated.get(nid) ?? []) {
      if (!(s.t <= t)) break;
      pid = s.pid;
    }
    return pid;
  }

  // `tick` is the server's own tick for the block (the ghost header's u32,
  // 30 a second): the time the samples describe, which the arrival time is
  // not. The server sends 20 blocks a second over its 30 ticks, so blocks are
  // one and two ticks apart in turn while they arrive evenly.
  block(t, records, tick = null) {
    const moved = [];
    const stances = [];
    const hps = [];
    const joints = [];
    const named = [];
    for (const r of records) {
      // Action 3: the server took the object out of this client's scope, and
      // the client disables it (GhostManager::readData 0x08141ed0 calls
      // disableObject; action 1 on an out-of-scope descriptor calls
      // enableObject). The viewer closes its replicated span on k:"d".
      if (r.action === 3) {
        if (this.inScope.delete(r.netId)) { this.stats.scopeOuts++; this.write({ k: 'd', t, id: r.netId }); }
        continue;
      }
      if (r.action !== 1) continue;
      // A seat is drawn as part of its hull (the viewer resolves a seat id to
      // its root, rootOf), so it gets no k:"o" of its own: one would make it a
      // life with no transform, and a gunner would be put back where he was.
      // A seat in scope keeps its hull drawn: the server scopes a hull and
      // its seats separately (a gunner's .50 stays in scope while the
      // unmanned hull drops out), but the gun is on the hull and the replay
      // shows it there, at the hull's last pose.
      const shown = r.seat ? r.seat.root : r.netId;
      if (!this.inScope.has(shown) && (!r.seat || this.objInfo.has(shown))) {
        this.inScope.add(shown);
        const inf = this.objInfo.get(shown) || { tid: 0, tmpl: '', team: 0 };
        this.stats.objects++;
        this.write({ k: 'o', t, id: shown, tid: inf.tid, tmpl: inf.tmpl, team: inf.team, ...(r.cls && !r.seat ? { cls: r.cls } : {}) });
      }
      if (r.pos) {
        this.stats.samples++;
        const q = r.rot || [0, 0, 0, 1];
        pushRecent(this.poses, r.netId, [t, r.pos, q], t);
        moved.push([r.netId, +r.pos[0].toFixed(2), +r.pos[1].toFixed(2), +r.pos[2].toFixed(2),
          +q[0].toFixed(4), +q[1].toFixed(4), +q[2].toFixed(4), +q[3].toFixed(4)]);
      }
      if (!r.body) continue;
      if (r.cls === 'BFSoldierNetworkable') {
        const row = this.stance.update(r.netId, r.body);
        if (row) { this.stats.stances++; stances.push(row); }
        this._handFire(t, r);
        if (r.body.hp != null && this.hp.get(r.netId) !== r.body.hp) {
          this.hp.set(r.netId, r.body.hp);
          this.stats.hp++;
          hps.push([r.netId, r.body.hp]);
        }
        continue;
      }
      // Both sides' tickets (the ScoreManager's ints 9 and 20): the replay's
      // `tk` row, written when either moves.
      if (r.cls === 'ScoreManager') {
        for (const [team, i] of Object.entries(TICKETS)) if (r.body.ints[i] != null) this.tickets[team - 1] = r.body.ints[i];
        const key = this.tickets.join(',');
        if (key !== this.ticketsKey && this.tickets.every((v) => v != null)) {
          this.ticketsKey = key;
          this.write({ k: 'tk', t, v: [...this.tickets] });
        }
        // The round's result: setWinner (0x08161b80) writes +0x5c and
        // setVictoryType (0x08161be0) +0x5d, and setNetUpdate (0x08162770)
        // reads mask bits 22 and 23 into exactly those two bytes
        // (0x08162d82..0x08162db1); ints 10 and 21 land on +0xac and +0xfc,
        // setWinner's `team * 0x50 + 0x5c` rounds-won counters. A 3-bit signed
        // read holds `none` (4) as -4, hence the & 7.
        if (r.body.bytes?.[0] != null) this.result[0] = r.body.bytes[0] & 7;
        if (r.body.bytes?.[1] != null) this.result[1] = r.body.bytes[1] & 7;
        for (const [team, i] of Object.entries(ROUNDS_WON)) if (r.body.ints[i] != null) this.roundsWon[team - 1] = r.body.ints[i];
        const result = `${this.result}|${this.roundsWon}`;
        if (result !== this.resultKey) {
          this.resultKey = result;
          this.write({ k: 'win', t, w: this.result[0], vt: this.result[1], rw: [...this.roundsWon] });
        }
        continue;
      }
      // A player's stats and medals (BFPlayer::setNetUpdate 0x08053a40): the
      // stat block ScoreManager::scoreEvent (0x081617c0) counts into, +0xc0
      // the sum of every event's points, +0x94 the ping (ghost/player.mjs, THE
      // STAT BLOCK), and +0xe8 / +0xec / +0xf0 the gold, silver and bronze
      // counters GameServer::giveMedal (0x081533f0) raises at the round's end.
      // A body carries only the fields that changed; resetStats (0x080556e0)
      // zeroes the block at a round start and the zeros are sent like any
      // other change. One row whenever any of them moves: `sc` and `md` as
      // before, the rest by name (PLAYER_STATS).
      if (r.cls === 'BFPlayer' && this.playerPid.has(r.netId)) {
        const pid = this.playerPid.get(r.netId);
        const prev = this.playerKey.get(pid) ?? { sc: 0, md: [0, 0, 0], ...Object.fromEntries(PLAYER_STATS.map((k) => [k, 0])) };
        const now = {
          sc: r.body[STAT_FIELDS.score] ?? prev.sc,
          md: [r.body.score_e8 ?? prev.md[0], r.body.score_ec ?? prev.md[1], r.body.score_f0 ?? prev.md[2]],
        };
        for (const k of PLAYER_STATS) now[k] = r.body[STAT_FIELDS[k]] ?? prev[k];
        if (now.sc !== prev.sc || now.md.some((v, i) => v !== prev.md[i]) || PLAYER_STATS.some((k) => now[k] !== prev[k])) {
          this.playerKey.set(pid, now);
          this.write({ k: 'ps', t, pid, ...now, md: [...now.md] });
        }
        continue;
      }
      // A control point's side (ControlPointNetworkable's team field): the
      // replay's `cp` row, which it reads as the flag's state and captures.
      if (r.cls === 'ControlPointNetworkable' && r.body.team != null && this.cpTeam.get(r.netId) !== r.body.team) {
        this.cpTeam.set(r.netId, r.body.team);
        const inf = this.objInfo.get(r.netId);
        this.write({ k: 'e', t, e: 'cp', id: r.netId, team: r.body.team, ...(inf?.tmpl ? { tmpl: inf.tmpl, name: cpNameOf(this.cpNames, inf.tmpl) ?? inf.tmpl } : {}) });
        continue;
      }
      if (r.cls === 'SimpleObjectNetworkable' && r.body.hp != null && this.hp.get(r.netId) !== r.body.hp) {
        this.hp.set(r.netId, r.body.hp);
        this.stats.hp++;
        hps.push([r.netId, r.body.hp]);
      }
      if (r.cls === 'SimpleObjectNetworkable' || r.cls === 'Seat') { this._joints(t, r, joints, named); this._fires(t, r); }
    }
    if (moved.length) this.write({ k: 's', t, ...(Number.isInteger(tick) ? { tick } : {}), o: moved });
    if (stances.length) this.write({ k: 'st', t, o: stances });
    if (hps.length) this.write({ k: 'a', t, a: hps });
    if (named.length) this.write({ k: 'jn', t, o: named });
    if (joints.length) this.write({ k: 'j', t, o: joints });
  }

  // A turret's traverse and a gun's elevation (the R children's angles,
  // RotationalBundleNetworkable: angleX/Y/Z = readSignedFloat(16) * 180), as
  // the replay's joint rows, so its guns fire from where they point. The
  // quaternions are BF1942's frame, relative to the root, as bf42plus writes
  // them: a yaw part turns about Y by angleX (the con's yaw, which the viewer
  // turns by Ry(-yaw) after its own z flip), a pitch part by angleY about X on
  // top of the yaw part before it.
  _joints(t, r, joints, named) {
    const root = r.seat ? r.seat.root : r.netId;
    const seat = r.seat ? r.seat.seat : 0;
    const tmpl = this.objInfo.get(root)?.tmpl ?? null;
    const parts = jointPartsFor(tmpl, seat);
    if (!parts) return;
    const bundles = (r.body.children || []).filter((c) => c.type === 'R');
    let yaw = null;
    let prevQ = null;
    const aimKey = `${root}:${seat}`;
    parts.forEach(([name, role, rest = 0], i) => {
      const values = bundles[i]?.values ?? [];
      const key = `${root}:${seat}:${i}`;
      const st = this.jointState.get(key) ?? { x: 0, y: 0 };
      if (values[0] != null) st.x = values[0] * 180;
      if (values[1] != null) st.y = values[1] * 180;
      this.jointState.set(key, st);
      const rad = Math.PI / 180;
      // Each part rides the one before it (a gun base on its tower, a
      // Daihatsu's outer ramp leaf on its inner one), so its rotation from
      // the root is the previous part's times its own: the outer leaf ends
      // at 65 + 180 = 245 deg, the client's -115.
      let local;
      if (role === 'yaw') { yaw = rest + st.x; local = [0, Math.sin(yaw * rad / 2), 0, Math.cos(yaw * rad / 2)]; }
      else local = [Math.sin(st.y * rad / 2), 0, 0, Math.cos(st.y * rad / 2)];
      const q = prevQ ? qMul(prevQ, local) : local;
      prevQ = q;
      const nid = 1000 + seat * 10 + i;
      if (!this.jointNamed.has(`${root}:${nid}`)) { this.jointNamed.add(`${root}:${nid}`); named.push([root, nid, name]); }
      const row = [root, nid, ...q.map((v) => +v.toFixed(4))];
      const k2 = row.join(',');
      if (this.jointLast.get(`${root}:${nid}`) === k2) return;
      this.jointLast.set(`${root}:${nid}`, k2);
      joints.push(row);
    });
    // The seat's aim as of this record (its yaw part's traverse and its pitch
    // part's elevation), for the rounds it fires.
    const yawSt = this.jointState.get(`${root}:${seat}:0`), pitchSt = this.jointState.get(`${root}:${seat}:1`);
    pushRecent(this.aims, aimKey, [t, yawSt?.x ?? 0, pitchSt?.y ?? 0], t);
  }

  // A round from a soldier's hand weapon. The kit's FireArms is ghosted
  // only on pickup, so no counter reaches other clients; what does is the
  // three bits 8-10 of the soldier's state bits, which jump up on each round
  // (to 7, or by one or more on a quick follow-up) and decay by one or two a
  // tick after. Every rise is a round: the client's own four Type99 rounds at
  // 90.83, 92.95, 93.09 and 93.23 s are the four rises, each 0.1 s before
  // (Wake, 2026-10-16), the same lead its vehicle rounds have.
  _handFire(t, r) {
    const bits = r.body.stateBits;
    if (bits == null) return;
    const heat = (bits >> 8) & 7;
    const prev = this.heat.get(r.netId);
    this.heat.set(r.netId, heat);
    if (prev == null || heat <= prev) return;
    const pid = this._occupantAt(r.netId, t);
    if (pid == null) return;
    const row = { k: 'f', t, pid, id: r.netId };
    const pose = recentAt(this.poses.get(r.netId), t);
    if (pose) {
      // From the soldier's chest along his facing, tilted by his aim pitch
      // (aimA, degrees, up positive): the client's own rounds leave 0.65 m
      // above his position along q * (0, sin pitch, cos pitch).
      const [, pos, q] = pose;
      const pitch = (this.stance.last.get(r.netId)?.pitch ?? 0) * Math.PI / 180;
      const d = qRotate(q, [0, Math.sin(pitch), Math.cos(pitch)]);
      row.p = [pos[0], pos[1] + 0.65, pos[2]].map((v) => +v.toFixed(3));
      row.d = d.map((v) => +v.toFixed(3));
    }
    this.stats.fires++;
    this.write(row);
  }

  // Where a round from `root`'s seat left and which way, at time `at`: the
  // hull's pose then, turned by the seat's traverse and elevation, from its
  // pitch part's pivot. The client writes the same pair (`p`, `d`): a
  // Sherman's shell from ShermanGunBase's place along the gun, a Zero's from
  // the hull's origin along its nose. null while the hull's pose is unknown.
  _muzzle(root, seat, tmpl, at) {
    const pose = recentAt(this.poses.get(root), at);
    if (!pose) return null;
    const [, pos, qHull] = pose;
    const parts = jointPartsFor(tmpl, seat) ?? [];
    const aim = parts.length ? recentAt(this.aims.get(`${root}:${seat}`), at) : null;
    const rest = parts[0]?.[2] ?? 0;
    const yaw = (aim?.[1] ?? 0), pitch = aim?.[2] ?? 0;
    const rad = Math.PI / 180;
    // The gun's frame in the hull's: Ry(rest + traverse) * Rx(elevation), as
    // the joint rows write it.
    const a = (rest + yaw) * rad / 2, b = pitch * rad / 2;
    const qGun = [Math.cos(a) * Math.sin(b), Math.sin(a) * Math.cos(b), -Math.sin(a) * Math.sin(b), Math.cos(a) * Math.cos(b)];
    const d = qRotate(qMul(qHull, qGun), [0, 0, 1]);
    const pv = hullFor(tmpl)?.parts ?? {};
    const yawPv = parts[0] ? pv[parts[0][0]] : null, pitchPv = parts[1] ? pv[parts[1][0]] : null;
    let local = [0, 0, 0];
    if (yawPv && pitchPv) {
      // The pitch part rides the yaw part: its pivot turns with the traverse.
      const ay = yaw * rad / 2;
      const off = qRotate([0, Math.sin(ay), 0, Math.cos(ay)], [pitchPv[0] - yawPv[0], pitchPv[1] - yawPv[1], pitchPv[2] - yawPv[2]]);
      local = [yawPv[0] + off[0], yawPv[1] + off[1], yawPv[2] + off[2]];
    } else if (pitchPv || yawPv) local = pitchPv || yawPv;
    const w = qRotate(qHull, local);
    const r3 = (v) => v.map((x) => +x.toFixed(3));
    return { p: r3([pos[0] + w[0], pos[1] + w[1], pos[2] + w[2]]), d: r3(d) };
  }

  // A FireArms child's magA is a round counter: it steps down once per round
  // (a Chi-ha's main gun 31 -> 30 on each shell, the M3A1 .50's 501 -> 496),
  // and up on a reload or the counter's wrap. Each step down is a k:"f",
  // dated one round interval before the step (children.mjs fireLagFor): the
  // counter moves when the gun is ready again, not when the round leaves.
  // The viewer sorts its rounds, so a backdated row may follow later ones.
  _fires(t, r) {
    const root = r.seat ? r.seat.root : r.netId;
    const seat = r.seat ? r.seat.seat : 0;
    const tmpl = this.objInfo.get(root)?.tmpl ?? null;
    let fi = 0;
    for (const c of r.body.children || []) {
      if (c.type !== 'F') continue;
      const key = `${r.netId}:${fi}`;
      const kind = fi === 0 ? 1 : 2; // a hull's second gun is its alternate trigger (the coaxial MG)
      fi++;
      if (c.magA == null) continue;
      const prev = this.mags.get(key);
      this.mags.set(key, c.magA);
      if (prev == null || c.magA === prev) continue;
      const lag = fireLagFor(tmpl, seat, fi - 1);
      // Only a step down is a round. The counter also jumps back up (the
      // M3A1 .50 501 -> 497 -> 501, a Zero's 901 -> 895 -> 901, a Sherman's
      // 30 -> 31 between shells), and that rise is not a round: the client's
      // own recording of the same burst has a round for every step down and
      // none for the rises (a Zero's five rounds against five steps down and
      // two rises, a Sherman's three shells against three steps down and two
      // rises; Wake, 2026-10-16). Counting the rise added a phantom shell.
      if (c.magA > prev) continue;
      const gun = gunFor(tmpl, seat, fi - 1);
      const rounds = Math.min(Math.max(1, Math.round((prev - c.magA) / gun.muzzles)), 10);
      this.lastStep.set(key, t);
      const at = +(t - lag).toFixed(3);
      const pid = this._occupantAt(r.netId, at);
      const muzzle = this._muzzle(root, seat, tmpl, at);
      for (let i = 0; i < rounds; i++) {
        this.stats.fires++;
        // With the gunner known, the viewer finds the seat through him
        // (controlledAt -> rootOf); otherwise it is the hull's own gun. The
        // gun's name, its muzzle and the round's direction are the client's
        // own fields (`w`, `p`, `d`), so the round flies where it was aimed.
        const row = pid != null ? { k: 'f', t: at, pid, id: root } : { k: 'f', t: at, id: root };
        if (gun.name) row.w = gun.name;
        if (muzzle) { row.p = muzzle.p; row.d = muzzle.d; }
        if (kind === 2) row.alt = 1;
        if (pid == null && seat) continue; // a seat's round with nobody known in it has no gun to leave
        this.write(row);
      }
    }
  }
}

// Keep the last few seconds of a per-object history (poses, aims), enough for
// a round dated one interval back (a tank gun's 2.86 s).
const HISTORY = 6;
function pushRecent(map, key, entry, t) {
  if (!map.has(key)) map.set(key, []);
  const l = map.get(key);
  l.push(entry);
  while (l.length > 2 && l[0][0] < t - HISTORY) l.shift();
}
// The entry in force at `t`: the last at or before it, else the first after.
function recentAt(list, t) {
  if (!list?.length) return null;
  let best = null;
  for (const e of list) { if (e[0] <= t + 1e-6) best = e; else break; }
  return best ?? list[0];
}
function qMul(a, b) {
  const [ax, ay, az, aw] = a, [bx, by, bz, bw] = b;
  return [aw * bx + ax * bw + ay * bz - az * by, aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw, aw * bw - ax * bx - ay * by - az * bz];
}
function qRotate(q, v) {
  const [x, y, z, w] = q, [vx, vy, vz] = v;
  const tx = 2 * (y * vz - z * vy), ty = 2 * (z * vx - x * vz), tz = 2 * (x * vy - y * vx);
  return [vx + w * tx + (y * tz - z * ty), vy + w * ty + (z * tx - x * tz), vz + w * tz + (x * ty - y * tx)];
}
