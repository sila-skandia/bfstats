// Turn decoded ghost blocks into v5 recording rows the replay viewer reads
// (viewer/replay-recording.js): k:"o" when an object comes into scope, k:"d"
// when it leaves (ghost action 3), k:"s" transform samples, k:"st" soldier
// state rows, k:"a" hull hit points, and k:"f" a round leaving a vehicle gun.
//
// Shared by the live sidecar (sidecar.mjs) and the offline rebuild
// (rebuild.mjs), so both write the same file from the same records.

import { SoldierStateTracker } from './soldier-ghost.mjs';
import { fireLagFor } from './ghost/children.mjs';
import { TICKETS } from './ghost/score-manager.mjs';

export class GhostWriter {
  // write(row) appends one recording row; objInfo is netId -> {tid, tmpl, team}.
  constructor({ write, objInfo }) {
    this.write = write;
    this.objInfo = objInfo;
    this.stance = new SoldierStateTracker();
    this.inScope = new Set();
    this.hp = new Map();       // netId -> last hit points written
    this.cpTeam = new Map();   // control point netId -> last side written
    this.tickets = [null, null];
    this.ticketsKey = null;
    this.mags = new Map();     // `${netId}:${fireArmsIndex}` -> last magA
    this.occupant = new Map(); // controlled netId -> pid
    this.seated = new Map();   // controlled netId -> [{ t, pid | null }], for a backdated round
    this.soldier = new Map();  // pid -> his on-foot soldier's netId
    this.camera = new Map();   // pid -> his free camera's netId (createPlayer)
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
    } else if (row.e === 'control') {
      if (row.netId != null && row.netId !== this.camera.get(row.pid)) this.soldier.set(row.pid, row.netId);
      else this.soldier.delete(row.pid);
    } else if (row.e === 'destroyPlayer') {
      this.soldier.delete(row.pid);
    } else if (row.e === 'exitVehicle' && !row.flag && this.soldier.has(row.pid)) {
      extra.push({ e: 'control', pid: row.pid, netId: this.soldier.get(row.pid), derived: 1 });
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

  block(t, records) {
    const moved = [];
    const stances = [];
    const hps = [];
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
        this.write({ k: 'o', t, id: shown, tid: inf.tid, tmpl: inf.tmpl, team: inf.team });
      }
      if (r.pos) {
        this.stats.samples++;
        const q = r.rot || [0, 0, 0, 1];
        moved.push([r.netId, +r.pos[0].toFixed(2), +r.pos[1].toFixed(2), +r.pos[2].toFixed(2),
          +q[0].toFixed(4), +q[1].toFixed(4), +q[2].toFixed(4), +q[3].toFixed(4)]);
      }
      if (!r.body) continue;
      if (r.cls === 'BFSoldierNetworkable') {
        const row = this.stance.update(r.netId, r.body);
        if (row) { this.stats.stances++; stances.push(row); }
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
        continue;
      }
      // A control point's side (ControlPointNetworkable's team field): the
      // replay's `cp` row, which it reads as the flag's state and captures.
      if (r.cls === 'ControlPointNetworkable' && r.body.team != null && this.cpTeam.get(r.netId) !== r.body.team) {
        this.cpTeam.set(r.netId, r.body.team);
        const inf = this.objInfo.get(r.netId);
        this.write({ k: 'e', t, e: 'cp', id: r.netId, team: r.body.team, ...(inf?.tmpl ? { tmpl: inf.tmpl, name: inf.tmpl } : {}) });
        continue;
      }
      if (r.cls === 'SimpleObjectNetworkable' && r.body.hp != null && this.hp.get(r.netId) !== r.body.hp) {
        this.hp.set(r.netId, r.body.hp);
        this.stats.hp++;
        hps.push([r.netId, r.body.hp]);
      }
      if (r.cls === 'SimpleObjectNetworkable' || r.cls === 'Seat') this._fires(t, r);
    }
    if (moved.length) this.write({ k: 's', t, o: moved });
    if (stances.length) this.write({ k: 'st', t, o: stances });
    if (hps.length) this.write({ k: 'a', t, a: hps });
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
      if (prev == null || c.magA >= prev) continue;
      const rounds = Math.min(prev - c.magA, 10);
      const at = +(t - fireLagFor(tmpl, seat, fi - 1)).toFixed(3);
      const pid = this._occupantAt(r.netId, at);
      for (let i = 0; i < rounds; i++) {
        this.stats.fires++;
        // With the gunner known, the viewer finds the seat through him
        // (controlledAt -> rootOf); otherwise it is the hull's own gun.
        const row = pid != null ? { k: 'f', t: at, pid } : { k: 'f', t: at, id: root };
        if (kind === 2) row.alt = 1;
        if (pid == null && seat) continue; // a seat's round with nobody known in it has no gun to leave
        this.write(row);
      }
    }
  }
}
