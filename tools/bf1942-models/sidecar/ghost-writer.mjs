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
// The soldier's camera off his body (BFSoldier::handleUpdate 0x08271f68,
// ledger VIEW-14): degrees of view pitch per degree of the aimA register, and
// degrees of view yaw per unit of the twist (rotateYDeg(-3 x twist), whose
// positive turn is toward +x here).
export const VIEW_PITCH_PER_AIM = 2.5;
export const VIEW_TWIST_PER_AIM = 3;

// The soldier's eye over his origin by pose, up his body's axis: the
// template's `setPoseCameraPos` that `BFSoldier::handleUpdate` eases the
// camera toward (ledger VIEW-14). The lab's fireBarrel frames sit there to
// the millimetre, prone ones turned with the body on a slope.
export const EYE_HEIGHT = { stand: 0.65, crouch: 0.12, prone: -0.7 };
// An upper-body state that fires (`Ub_Fire`, `Ub_LieFireNo4Sniper`, ...),
// as the page reads it (net-sidecar.js isFireState).
const FIRE_STATE = /^Ub_(Lie|Crouch)?Fire/;

// How many ticks ago a round left, from the recoil counter `counter` seen
// `ticks` after the last state, when it is not that state's count run down:
// 19 - k for a weapon that goes back, 7 - k for one that keeps its kick, the
// round k ticks back (0 <= k < ticks). `goBack` is the soldier's weapon as his
// last round read it, preferred when both fit (only a counter of 7 or less
// seen 13 or more ticks on). Returns { k, goBack } or null when neither fits.
export function recoilAgo(counter, ticks, goBack = null) {
  const fits = [[19 - counter, true], [7 - counter, false]]
    .filter(([k]) => k >= 0 && k < ticks).map(([k, back]) => ({ k, goBack: back }));
  if (!fits.length) return null;
  return fits.find((x) => x.goBack === goBack) ?? fits.sort((x, y) => x.k - y.k)[0];
}

// animName for GhostWriter from a run's `anim` table ([[index, name, ...]]),
// read through `table()` each time so a table replaced at a level change is
// the one used.
export function animNamer(table) {
  let seen = null, byIndex = new Map();
  return (i) => {
    const tb = table();
    if (tb !== seen) { seen = tb; byIndex = new Map((Array.isArray(tb) ? tb : []).map((e) => [e[0], e[1]])); }
    return byIndex.get(i) ?? '';
  };
}

export const PLAYER_STATS = ['kills', 'deaths', 'teamKills', 'captures', 'attacks', 'defences',
  'objectives', 'objectiveTeamKills', 'ping'];

/**
 * The ammunition of the guns of the object this client controls (a driven
 * hull's, or a gunner's seat's), from its control-object state:
 * `[[gunTemplate, rounds, magazines], ...]` per FireArms child in the
 * template's order, or null when it has none. The server writes a FireArms's
 * loaded magazine's rounds and how many magazines it holds, each plus one
 * (`FireArmsNetworkable::updateStateMask` 0x08228d10 takes `mags[0]` and the
 * vector's size; `getNetUpdate` 0x08228e50 writes them, a -1 template bound
 * leaving the field out), and the client's `setNetUpdate` (0x08228f70)
 * resizes its own magazine vector to the count and sets the loaded one to
 * the rounds: the client's gun holds what the server's does (ledger
 * SEAT-36). A state carries a field only when the networkable sends it, so
 * each is carried forward from `prev` (this function's last answer for the
 * same object). `tmpl`/`seat` name the hull and the seat (0 for the hull's
 * own guns) for the gun's name (children.mjs `gunFor`).
 */
export function controlMagazines(children, tmpl, seat = 0, prev = null) {
  const fires = Array.isArray(children) ? children.filter((x) => x?.type === 'F') : [];
  if (!fires.length) return null;
  return fires.map((f, i) => {
    const before = prev?.[i] ?? null;
    const rounds = Number.isFinite(f.magA) ? f.magA - 1 : (before?.[1] ?? null);
    const mags = Number.isFinite(f.magB) ? f.magB - 1 : (before?.[2] ?? null);
    return [gunFor(tmpl, seat, i).name ?? before?.[0] ?? null, rounds, mags];
  });
}

export class GhostWriter {
  // write(row) appends one recording row; objInfo is netId -> {tid, tmpl, team}.
  // animName(i) names an animation state (the run's `anim` table), for a
  // soldier's stance and fire state; without it every soldier is standing.
  constructor({ write, objInfo, cpNames = {}, animName = null }) {
    this.write = write;
    this.animName = animName;
    this.objInfo = objInfo;
    this.cpNames = cpNames;    // control point template -> the name the game prints
    this.stance = new SoldierStateTracker();
    this.inScope = new Set();
    this.hp = new Map();       // netId -> last hit points written
    this.cpTeam = new Map();   // control point netId -> last side written
    this.spawnGroups = null;   // the spawn manager's table, [[team, active, qx, qz]] by group ordinal
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
    this.engineState = new Map(); // `${netId}:${engineIndex}` -> { revs, running, gear }
    this.jointNamed = new Set();
    this.jointLast = new Map();
    this.occupant = new Map(); // controlled netId -> pid
    this.seated = new Map();   // controlled netId -> [{ t, pid | null }], for a backdated round
    this.soldier = new Map();  // pid -> his on-foot soldier's netId
    this.camera = new Map();   // pid -> his free camera's netId (createPlayer)
    this.poses = new Map();    // netId -> [[t, pos, rot]], the last few seconds, to aim a backdated round
    this.fireTrack = new Map(); // soldier netId -> his last state, for his rounds (_handFire)
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
    // A new level (or a rejoin of this one) sends the spawn manager whole
    // again, and that first send must be written even where it matches the
    // last level's: the page and the live snapshot dropped the old table.
    if (row.e === 'setLevel') this.spawnGroups = null;
    if (row.e === 'createPlayer') {
      if (row.camNetId != null) this.camera.set(row.pid, row.camNetId);
      if (row.netId != null) this.playerPid.set(row.netId, row.pid);
      // What he controls as we join (`vehNetId`), which the replay and the
      // page both read as his control (replay-recording.js, net-sidecar.js):
      // a player already alive when the sidecar joins gets no control event
      // until he next spawns or boards, and his rounds had no one to be
      // credited to (Midway, 2026-10-24: 500 of a bot's rounds dropped).
      if (row.vehNetId && row.vehNetId !== row.camNetId) {
        this.soldier.set(row.pid, row.vehNetId);
        this._leave(row.pid, t);
        this._sit(row.vehNetId, row.pid, t);
      }
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
      for (const id of this.inScope) { this.stats.scopeOuts++; this.write({ k: 'd', t, id }); this.hp.delete(id); }
      this.inScope.clear();
    }
    // A destroyed object takes its scope with it. The client's scope flag is a
    // byte of the object's own networkable (`GhostManager::readData`: action 3
    // clears `+0xc` at 0x08141fae, the first action 1 after it calls
    // `enableObject` and sets it at 0x08142151), and DestroyObject deletes
    // that object. A CreateObject under the same netId (a round restart
    // re-makes every hull so, ROUND-10) is a fresh object, created disabled,
    // that its first ghost record turns on. Left in scope here, the
    // recreated hull's first record wrote no k:"o", and the page, which
    // closes the span on destroyObject, never drew it again (Wake,
    // 2026-10-24: the airfield Sherman a bot drove off after the restart).
    // The span closes here, with a k:"d" as a scope-out writes: an action 3
    // the server sends for the same object afterwards finds it out of scope
    // and writes nothing more (the Corsair of the compare fixture got both;
    // 532 at the restart got no action 3 at all).
    if (row.e === 'destroyObject' && row.netId != null) {
      if (this.inScope.delete(row.netId)) { this.stats.scopeOuts++; this.write({ k: 'd', t, id: row.netId }); }
      this.hp.delete(row.netId);
      this.poses.delete(row.netId);
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
    const engines = [];
    for (const r of records) {
      // Action 3: the server took the object out of this client's scope, and
      // the client disables it (GhostManager::readData 0x08141ed0 calls
      // disableObject; action 1 on an out-of-scope descriptor calls
      // enableObject). The viewer closes its replicated span on k:"d".
      if (r.action === 3) {
        if (this.inScope.delete(r.netId)) { this.stats.scopeOuts++; this.write({ k: 'd', t, id: r.netId }); }
        // The live snapshot drops an object's k:"a" with its k:"d"
        // (live-snapshot.mjs), so the next hit points for it are written
        // again even when unchanged: the hull a player takes the wheel of is
        // scoped out that tick, and its hit points come on in his control
        // state only (`controlHp`). Deduplicated against the value from
        // before the scope-out, a page that joined later never got them.
        this.hp.delete(r.netId);
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
        // Millimetres, the wire's own resolution (a position's compressed
        // vector is scale 0.001, wire.md section 16). Centimetres put up to
        // 0.3 m/s of noise on the velocity a page extrapolates a hull along
        // from two samples a tick apart (net-sidecar.js clientClockLead).
        moved.push([r.netId, +r.pos[0].toFixed(3), +r.pos[1].toFixed(3), +r.pos[2].toFixed(3),
          +q[0].toFixed(4), +q[1].toFixed(4), +q[2].toFixed(4), +q[3].toFixed(4)]);
      }
      if (!r.body) continue;
      if (r.cls === 'BFSoldierNetworkable') {
        const row = this.stance.update(r.netId, r.body);
        if (row) { this.stats.stances++; stances.push(row); }
        this._handFire(t, r, tick);
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
        // The respawn wait (+0x8c, ghost/player.mjs): the server's own TIME TO
        // SPAWN, whole seconds. Only once a body has carried it.
        const sw = r.body.spawnWait ?? prev.sw;
        if (sw != null) now.sw = sw;
        if (now.sc !== prev.sc || now.sw !== prev.sw || now.md.some((v, i) => v !== prev.md[i]) || PLAYER_STATS.some((k) => now[k] !== prev[k])) {
          this.playerKey.set(pid, now);
          this.write({ k: 'ps', t, pid, ...now, md: [...now.md] });
        }
        continue;
      }
      // The spawn manager's groups (ghost/spawn-manager.mjs): the whole table
      // whenever any entry moves, so a row is the state and a page joining
      // later needs only the newest (live-snapshot.mjs). Rare: a flag changing
      // hands, a ship's ring stepping a byte (16 m on a 4 km level), a group's
      // last point going down.
      if (r.cls === 'SpawnPointManager') {
        const n = r.body.n;
        if (!this.spawnGroups || this.spawnGroups.length !== n) this.spawnGroups = Array.from({ length: n }, () => [0, 0, 0, 0]);
        let changed = false;
        for (const [i, team, active, qx, qz] of r.body.rows) {
          const g = this.spawnGroups[i];
          if (g[0] !== team || g[1] !== active || g[2] !== qx || g[3] !== qz) { this.spawnGroups[i] = [team, active, qx, qz]; changed = true; }
        }
        if (changed) this.write({ k: 'e', t, e: 'spawnGroups', netId: r.netId, n, g: this.spawnGroups.map((g) => [...g]) });
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
      if (r.cls === 'SimpleObjectNetworkable' || r.cls === 'Seat') { this._joints(t, r, joints, named); this._fires(t, r); this._engines(t, r, engines); }
    }
    if (moved.length) this.write({ k: 's', t, ...(Number.isInteger(tick) ? { tick } : {}), o: moved });
    if (stances.length) this.write({ k: 'st', t, o: stances });
    if (hps.length) this.write({ k: 'a', t, a: hps });
    if (named.length) this.write({ k: 'jn', t, o: named });
    if (joints.length) this.write({ k: 'j', t, o: joints });
    if (engines.length) this.write({ k: 'g', t, o: engines });
  }

  /**
   * A hull's engines, as the recorder's own `g` rows
   * (`[root, revs, throttle, flags, gear, engine]`, flags 1 running /
   * 2 disabled): the revs a propeller, rotor or screw turns on, one entry per
   * `E` child in template tree order.
   *
   * These are on the wire, not derived. `EngineNetworkable::updateStateMask`
   * (0x08227620) puts `PhysicsEngine+0xa0` -- the same float the server
   * recorder reads as revs -- under mask bit 0x080, its `+0xb4` running flag
   * under 0x004 and its `+0xbc` gear under 0x008, and `setNetUpdate`
   * (0x08227da0) writes each back to the offset it came from. The tail of
   * `PhysicsEngine::updatePhysics` then rolls the Engine's first child
   * LodObject by `revs * 20` degrees a tick from it (PHY-30). So a retail
   * client is TOLD a remote aircraft's propeller speed.
   *
   * The figure is 80% of the server's and is passed on as it arrives: the
   * writer is `writeSignedFloat(revs, 12, 1.25)` (0x083da220), which divides
   * by max, and the reader `readSignedFloat(int, float)` (0x083da200) drops
   * max and returns `2u-1` in [-1, 1]. Measured over a live El Alamein round
   * (2026-10-18): parked aircraft at 0.000, flying ones to 0.96, which is the
   * engine's 1.2 revs clamp (TANK-12) over 1.25, and never above it.
   *
   * There is no throttle servo on the wire, so the `g` row's throttle is
   * null: a replay of a sidecar recording reads revs, which is what turns
   * the blades.
   */
  // The hit points of the hull this client drives, from its control-object
  // state. The server ghosts nothing back about an object a client controls
  // (wire.md section 41), so while a player drives a hull its hit points
  // reach him only here: the hull body's mask 0x10, written in every full
  // state and in a delta when they change (lab, 2026-10-25: an M3A1 driven
  // on Wake carried hp in 169 of 169 states). Without it the page's copy of
  // the hull he drove kept its own full bar, burned for nobody, and was
  // never repaired. Written as the ghost's own k:"a" row, deduplicated
  // against it, so the page and a recording read one stream.
  controlHp(t, netId, hp) {
    if (!Number.isInteger(netId) || !Number.isFinite(hp) || this.hp.get(netId) === hp) return false;
    this.hp.set(netId, hp);
    this.stats.hp++;
    this.write({ k: 'a', t, a: [[netId, hp]] });
    return true;
  }

  _engines(t, r, out) {
    const root = r.seat ? r.seat.root : r.netId;
    let ei = 0;
    for (const c of r.body.children || []) {
      if (c.type !== 'E') continue;
      const i = ei++;
      if (c.revs == null && c.running == null && c.disabled == null && c.gear == null) continue;
      const key = `${r.netId}:${i}`;
      const prev = this.engineState.get(key) ?? { revs: 0, wire: null, disabled: false, gear: 0 };
      const revs = c.revs ?? prev.revs;
      // Mask bit 0x004 is sent only when it CHANGES, so an engine already
      // turning when this client joined never sends one: rebuilding a live
      // El Alamein round, every aircraft that reached 0.96 revs had no
      // running row in the whole session. Where the wire has not said, the
      // revs say it -- they are held at 0 while `Engine+0x142` is clear
      // (PHY-14), so an engine with revs is a running engine. The wire's own
      // word is kept apart from that reading, so one row of revs 0 early on
      // cannot latch "stopped" over a bit the server never sent.
      const now = { revs, wire: c.running ?? prev.wire, disabled: c.disabled ?? prev.disabled, gear: c.gear ?? prev.gear };
      now.running = now.wire ?? (revs !== 0);
      // A body carries only what changed, and revs move every tick a hull is
      // under power: the 0.001 gate keeps a parked field's engines off the
      // recording the way the recorder's own 0.01 does, without losing a
      // blade's acceleration.
      if (Math.abs(now.revs - prev.revs) < 0.001 && now.running === prev.running
          && now.disabled === prev.disabled && now.gear === prev.gear) continue;
      this.engineState.set(key, now);
      out.push([root, +now.revs.toFixed(3), null, (now.running ? 1 : 0) | (now.disabled ? 2 : 0), now.gear, i]);
    }
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
  // only on pickup, so no counter reaches other clients. What does is bits
  // 8-12 of the soldier's state bits: his recoil ride's counter (BFSoldier
  // +0x544, `recoil.js`), which `getRecoilState` (0x0827e280) packs there
  // while the held weapon has a recoil force and clears when it has none.
  // `calcRecoil` arms it at the round, 20 for a weapon that goes back after
  // its kick and 8 for one that keeps it, and `handlePlayerInput` takes one
  // off every tick from that same tick on, so the round's own tick shows 19
  // or 7 and the count then falls one a tick (lab, wire.md section 44: the
  // BAR 7, 6, ... 0; the Thompson and the Garand 19 ... 0; the No4Sniper, which
  // has no recoil, 0 throughout). So a round is a state whose count is not
  // the last one run down by the ticks between, and the count says how many
  // ticks ago it left. The writer read only bits 8-10 and took every rise for
  // a round, which wrote three for each round of a weapon that goes back, at
  // the low bits' wraps (the lab's Thompson: 148 rows for 58 rounds). A
  // weapon with no recoil (a sniper rifle) is read off his upper body
  // entering a fire state instead, when the animation table is known.
  //
  // The line is the server's (lab, 2026-10-25, 221 rounds against the
  // recorder's fireBarrel frames): `FireArms::Fire` reads the camera as the
  // previous tick's `handleUpdate` left it (ledger VIEW-14, XHIT-12), so the
  // view of the tick before the round's, before that round's kick and before
  // that tick's look; and the eye is his `setPoseCameraPos` for the pose in
  // his body's frame (0.65 standing, 0.12 crouched, -0.7 prone, eased half
  // way a tick), not 0.65 up the world's axis.
  _handFire(t, r, tick) {
    const last = this.stance.last.get(r.netId);
    const bits = last?.bits ?? r.body.stateBits;
    const P = this.fireTrack.get(r.netId);
    const lower = this.animName?.(last?.lower) ?? '';
    const upper = this.animName?.(last?.upper) ?? '';
    const stance = /Lie|Crawl/.test(lower) ? 'prone' : /Crouch/.test(lower) ? 'crouch' : 'stand';
    const tk = Number.isInteger(tick) ? tick : null;
    const cur = {
      tick: tk, pos: r.pos ?? P?.pos ?? null, q: r.rot ?? P?.q ?? null,
      pitch: last?.pitch ?? 0, twist: last?.twist ?? 0, stance, fire: FIRE_STATE.test(upper),
      eye: EYE_HEIGHT[stance], counter: bits != null ? (bits >> 8) & 0x1f : (P?.counter ?? 0), goBack: P?.goBack ?? null, prev: P ?? null,
    };
    if (P?.tick != null && tk != null && tk > P.tick) cur.eye = EYE_HEIGHT[stance] + (P.eye - EYE_HEIGHT[stance]) * 0.5 ** (tk - P.tick);
    this.fireTrack.set(r.netId, cur);
    if (P?.prev) P.prev.prev = null; // two states back is all a round reads
    if (!P) return;
    const ticks = P.tick != null && tk != null ? tk - P.tick : null;
    let ago = null; // ticks from the round's tick to this state's
    if (ticks == null) {
      // No server tick to count with: a rise is a round.
      if (cur.counter > P.counter) ago = 0;
    } else if (ticks > 0 && cur.counter > 0 && cur.counter !== Math.max(0, P.counter - ticks)) {
      const fit = recoilAgo(cur.counter, ticks, P.goBack);
      if (fit) { ago = fit.k; cur.goBack = fit.goBack; }
    }
    if (ago == null && ticks !== 0 && cur.counter === 0 && P.counter === 0 && cur.fire && !P.fire) ago = 0;
    if (ago == null) return;
    const pid = this._occupantAt(r.netId, t);
    if (pid == null) return;
    const row = { k: 'f', t: ticks != null ? +(t - ago / 30).toFixed(3) : t, pid, id: r.netId };
    const line = this._handLine(P, cur, ago);
    if (line) { row.p = line.p; row.d = line.d; }
    this.stats.fires++;
    this.write(row);
  }

  // Where the server's round left and which way, `ago` ticks before `cur`:
  // his view and eye on the tick before the round's, which falls between
  // the last state `P` and this one. This state is read as little as can
  // be: it carries the round's own kick, and the look of the ticks after.
  // A soldier who was still at `P` (no recoil ride running, and he had not
  // moved or turned since the state before) stayed so until shortly before
  // this state: a change would have gone out in the next block, and blocks
  // are one or two ticks apart. So his aim is `P`'s, and his body is taken
  // between the two (in practice `P`'s). One who was moving keeps moving as
  // he moved into `P`, from the state before it: his body, his twist and his
  // pitch run on at that rate (the pitch only when no recoil rode it, since
  // a ride is not a steady rate). Interpolating toward this state instead
  // drew a strafer who turned back at the round 40 mrad off (lab,
  // 2026-10-25), and a busy server's states for a soldier are several ticks
  // apart (Tobruk, 2026-10-24: 5 to 8 while his recoil counter ran down
  // every tick), so a rate is all the record says there too.
  _handLine(P, cur, ago) {
    if (!P.pos || !P.q || !cur.q || !cur.pos) return null;
    if (P.tick == null || cur.tick == null) return this._lineFrom(cur.pos, cur.q, cur.pitch, cur.twist, cur.eye);
    const T = cur.tick - ago - 1;
    const PP = P.prev;
    const near = (u, v, e) => u && v && u.every((x, i) => Math.abs(x - v[i]) <= e);
    const still = P.counter === 0 && PP != null && near(P.pos, PP.pos, 0.002) && near(P.q, PP.q, 0.0005)
      && (PP.counter > 0 || (Math.abs(P.pitch - PP.pitch) < 0.002 && Math.abs(P.twist - PP.twist) < 0.002));
    const a = still ? Math.max(P.tick, cur.tick - 2) : P.tick;
    const f = T > a && cur.tick > a ? Math.min(1, (T - a) / (cur.tick - a)) : 0;
    let q = qNlerp(P.q, cur.q, f);
    let pos = P.pos.map((v, i) => v + (cur.pos[i] - v) * f);
    let twist = P.twist + (cur.twist - P.twist) * f;
    if (!still && T > P.tick && PP?.tick != null && PP.q && PP.pos && P.tick - PP.tick > 0 && P.tick - PP.tick <= 8) {
      const g = (T - P.tick) / (P.tick - PP.tick);
      q = qNlerp(PP.q, P.q, 1 + g);
      pos = P.pos.map((v, i) => v + (v - PP.pos[i]) * g);
      twist = P.twist + (P.twist - PP.twist) * g;
    }
    let pitch = P.pitch;
    if (T > a && !still && PP?.tick != null && P.counter === 0 && PP.counter === 0 && P.tick - PP.tick > 0 && P.tick - PP.tick <= 8) {
      pitch += (P.pitch - PP.pitch) / (P.tick - PP.tick) * (T - a);
    }
    const target = EYE_HEIGHT[T > a ? cur.stance : P.stance];
    const eye = target + (P.eye - target) * 0.5 ** Math.max(0, T - P.tick);
    return this._lineFrom(pos, q, pitch, twist, eye);
  }

  // Down his camera (ledger VIEW-14): from his eye `eye` up his body's own
  // axis, along the body turned by the camera's rotateYDeg(-3 x twist) and
  // rotateXDeg(-2.5 x aimA) (BFSoldier::handleUpdate 0x08271f68). The
  // register is not the view: read as one, a page shot 10 degrees of
  // register up a slope was written 10 degrees up where the server fired
  // it 25.
  _lineFrom(pos, q, aim, twist, eye) {
    const pitch = aim * VIEW_PITCH_PER_AIM * Math.PI / 180;
    const yaw = -twist * VIEW_TWIST_PER_AIM * Math.PI / 180;
    const d = qRotate(q, [Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)]);
    const up = qRotate(q, [0, eye, 0]);
    return { p: pos.map((v, i) => +(v + up[i]).toFixed(3)), d: d.map((v) => +v.toFixed(4)) };
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
function qNlerp(a, b, f) {
  if (f === 0) return a;
  const s = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3] < 0 ? -1 : 1;
  const q = a.map((v, i) => v + (s * b[i] - v) * f);
  const n = Math.hypot(...q) || 1;
  return q.map((v) => v / n);
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
