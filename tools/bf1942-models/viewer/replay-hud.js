// The followed player's own HUD in first person: the game's crosshair at the
// centre of his view, his health, the ammunition of the weapon in his hands,
// and in a seat the vehicle's icon, health, seats and guns. The page's own
// painter (hud.js over `menu/InGame`'s layout) and its DOM cross draw it;
// this feeds them from the recording in place of the page's soldier
// (features/round-replay-hud).
//
// What is recorded and what is worked out:
//   - where the cross is: the centre of his view, as in the game, and the
//     view is his (replay-camera.js `viewOf`, laid on each round's axis);
//   - his health and a vehicle's: recorded (`a`), exact;
//   - the cross itself: his weapon's or his seat's `setCrossHairType`, and
//     the server's centre point (`gameRules`);
//   - its spread: his weapon's deviation (deviation.js) run over his recorded
//     stance, movement and rounds, or in a seat the gun's (fire-state.js
//     `FireState.spread`) over its recorded rounds;
//   - ammunition: counted down from a full kit at his spawn by his recorded
//     rounds, magazine changes (his torso's reload states) and refills. Exact
//     for a recording player, whose every round and refill the file has; for
//     anyone else an estimate, as a client can miss a remote player's single
//     taps and is told nobody else's refills;
//   - his zoom: the body record's state bit (replay-recording.js
//     `ZOOM_BIT`), the server's for every soldier: the weapon's zoom lens
//     (replay-camera.js) and a scoped rifle's scope in place of the cross;
//   - the hit marks round the cross: not recorded (the server sends them as
//     one bool the recorder does not read), worked out from his rounds and
//     his victims' hit points (replay-hitmarks.js).

import { DeviationModel, TICK_HZ } from './deviation.js';
import { AmmoEntry } from './kit-ammo.js';
import { FireState, crossGunOf } from './fire-state.js';
import { SOLDIER_AMMO_VARS, STANCE_TEXTURE, writeSoldierAmmo } from './soldier-hud.js';
import { ANIM_FLAGS, bodyAt, crewOf, hpAt, latestAt, primaryWeaponFor, teamAt } from './replay-recording.js';
import { motionAt } from './replay-kinematics.js';
import { hitMarkAt, inferHitMarks } from './replay-hitmarks.js';
import { weaponOfProjectile } from './replay-props.js';
import { modelFileStem } from './model-file.js';

/** The longest `spreadAt` runs back, seconds: a mod's weapon whose bloom
 *  hardly decays is taken as settled after this. */
const SPREAD_WINDOW_MAX = 30;

/** Metres a second along or across his heading that read as a movement key
 *  held, for a file with no recorded lower state (deviation.js's gates are on
 *  the key, not the speed). */
const MOVING = 0.5;

/** The `Vehicle/*` and vehicle `Ammo/*` variables a seat feeds, cleared when
 *  the view leaves it (vehicle-hud.js `HUD_VEHICLE_VARS`, the page's own). */
const SEAT_VARS = [
  'Vehicle/ShowVehicleIcon', 'Vehicle/VehicleIcon', 'Vehicle/ShowTurretIcon', 'IconLookRotation',
  'Vehicle/VehicleHitPoints', 'Vehicle/VehicleMaxHitPoints', 'Ammo/NumberOfWeaponIcons',
  'Ammo/PrimaryAmmoIcon', 'Ammo/PrimaryAmmoBar', 'Ammo/PrimaryAmmo', 'Ammo/PrimaryAmmoText',
  'Ammo/MaxPrimaryAmmo', 'Ammo/PrimaryMag', 'Ammo/SecondaryAmmoIcon', 'Ammo/SecondaryAmmoBar',
  'Ammo/SecondaryAmmo', 'Ammo/SecondaryAmmoText', 'Ammo/MaxSecondaryAmmo', 'Ammo/ReloadTime',
  'Ammo/ReloadTimeSecondary', 'Overheat/OverHeat', 'Occupied/OccupiedData',
  ...Array.from({ length: 6 }, (_, i) => [`Vehicle/VehiclePos/VehiclePosX${i + 1}`,
    `Vehicle/VehiclePos/VehiclePosY${i + 1}`]).flat(),
];

/** The soldier-side variables a first person feeds besides the ammo. */
const SOLDIER_VARS = [
  'Soldier/SoldierIcon', 'Soldier/SoldierHealthBarIcon', 'Soldier/SoldierHealthBarFullIcon',
  'Soldier/SoldierHitPoints', 'Soldier/SoldierMaxHitPoints',
];

const lower = s => String(s ?? '').toLowerCase();
const bareName = name => lower(name).replace(/_\d+$/, '');

/** A kit's row in `loadouts.json`, by name whatever its case. */
function kitRowOf(loadouts, kit) {
  const kits = loadouts?.kits;
  if (!kits || !kit) return null;
  return kits[kit] ?? Object.entries(kits).find(([name]) => lower(name) === lower(kit))?.[1] ?? null;
}

/**
 * The weapon in `life`'s hands at `t`: the kit item his body record holds
 * (`st`'s 1-based `itemIndex`, `loadouts.json` `weapons[].slot`), else his
 * kit's primary -- what replay-bodies.js `hold` draws in them.
 */
export function heldWeapon(rec, loadouts, life, t) {
  const item = latestAt(rec.stances?.get(life.nid), t)?.item;
  const weapon = kitRowOf(loadouts, life.kitTemplate)?.weapons?.find(w => w.slot === item)?.weapon;
  return weapon ?? primaryWeaponFor(life, loadouts);
}

/** When `pid` was refilled at a depot: the file's own player's refills, or a
 *  merged file's named ones (replay-merge.js). */
export function refillsOf(rec, pid, recordingPid) {
  return (rec.refills ?? []).filter(r => (r.pid ?? recordingPid) === pid).map(r => r.t);
}

/**
 * What the recording has of `life`'s use of `weapon`: `{ rounds, reloads }`,
 * the times of his rounds of it (`f`) and of the magazine changes his torso
 * began with it (an upper state naming a reload of it, `Ub_StandReloadBar1918`).
 */
export function weaponEvents(rec, life, weapon) {
  const want = lower(weapon);
  const rounds = [];
  for (const f of rec.fires ?? []) {
    if (f.press || f.nid !== life.nid || lower(f.weapon) !== want || f.t < life.created) continue;
    rounds.push(f.t);
  }
  rounds.sort((a, b) => a - b);
  const reloads = [];
  let reloading = false;
  for (const e of rec.stances?.get(life.nid) ?? []) {
    const name = lower(rec.animStates?.[e.upper]?.name);
    const now = name.includes('reload') && name.includes(want);
    if (now && !reloading) reloads.push(e.t);
    reloading = now;
  }
  return { rounds, reloads };
}

/**
 * A weapon's ammunition at `t`, as the engine counts it (kit-ammo.js,
 * hand-fire.js): a full magazine and its spares at his spawn, one round a
 * recorded round, and a magazine change `reloadTime` after it starts -- when
 * his torso enters its reload, or when the magazine runs dry with a spare
 * left -- which throws away what was left in the old one. A depot's refill
 * fills the whole kit and ends a change in progress. `events` is
 * `weaponEvents`' plus `refills` (times); `{ rounds, mags, size, reloading }`.
 */
export function handAmmoAt(events, magazine, t, name = '') {
  const entry = new AmmoEntry(name, magazine);
  if (!Number.isFinite(entry.size)) return { rounds: entry.rounds, mags: entry.mags, size: entry.size, reloading: false };
  const list = [];
  for (const r of events.rounds ?? []) if (r <= t) list.push({ t: r, kind: 0 });
  for (const r of events.reloads ?? []) if (r <= t) list.push({ t: r, kind: 1 });
  for (const r of events.refills ?? []) if (r <= t) list.push({ t: r, kind: 2 });
  list.sort((a, b) => a.t - b.t || a.kind - b.kind);
  const reloadTime = magazine?.reloadTime ?? 2;
  let done = null;   // when the magazine change in progress finishes
  const settle = until => {
    if (done === null || done > until) return;
    done = null;
    if (entry.mags > 0) {
      entry.mags -= 1;
      entry.rounds = entry.size;
    }
  };
  for (const e of list) {
    settle(e.t);
    if (e.kind === 0) {
      entry.rounds = Math.max(0, entry.rounds - 1);
      if (entry.rounds === 0 && entry.mags > 0 && done === null) done = e.t + reloadTime;
    } else if (e.kind === 1) {
      if (done === null && entry.mags > 0 && entry.rounds < entry.size) done = e.t + reloadTime;
    } else {
      entry.refill();
      done = null;
    }
  }
  settle(t);
  return { rounds: entry.rounds, mags: entry.mags, size: entry.size, reloading: done !== null };
}

/**
 * Seconds `deviation`'s dynamic channels take to fall from their caps to
 * nothing, at its slowest stance: how far back `spreadAt` must start to have
 * every round and step that still counts. deviation.js's arithmetic: the fire
 * channel caps at `fire[0]` and loses `fire[2] / M` a tick, the speed, turn
 * and misc channels cap at their first term times M and lose their last over
 * M. A BAR's full bloom (3.5 at 0.03 a tick, standing) is 3.9 s; a
 * Thompson's 1.3.
 */
export function settleTime(deviation) {
  const d = deviation ?? {};
  let worst = 0;
  for (const M of Array.isArray(d.mod) && d.mod.length ? d.mod : [1]) {
    if (!(M > 0)) continue;
    if (d.fire?.[2] > 0) worst = Math.max(worst, ((d.fire[0] ?? 0) * M) / d.fire[2]);
    if (d.speed?.[3] > 0) worst = Math.max(worst, ((d.speed[0] ?? 0) * M * M) / d.speed[3]);
    if (d.turn?.[3] > 0) worst = Math.max(worst, ((d.turn[0] ?? 0) * M * M) / d.turn[3]);
    if (d.misc?.[2] > 0) worst = Math.max(worst, ((d.misc[0] ?? 0) * M * M) / d.misc[2]);
  }
  return Math.min(SPREAD_WINDOW_MAX, worst / TICK_HZ);
}

/**
 * How far `life`'s aim had spread at `t`, degrees, with a weapon whose glb
 * block is `deviation` and whose rounds he fired at `rounds` (times, sorted):
 * the weapon's whole cone, `setMinDev` included (deviation.js
 * `DeviationModel`), run tick by tick from as far back as its channels take
 * to settle (`settleTime`) over his recorded stance, movement keys (his legs'
 * state: walking, running or strafing means the key was down; a jump), and
 * those rounds. The game hands the crosshair this same total
 * (`getMenuCrossHairRadius`, XHIT-14), so a still Thompson's arms stand
 * 2 units apart, not touching (vehicle-hud.js `updateCrosshair`).
 */
export function spreadAt(rec, life, deviation, rounds, t) {
  if (!deviation) return 0;
  const model = new DeviationModel({ deviation });
  const from = Math.max(life.created, t - settleTime(deviation) - 0.25);
  const step = 1 / TICK_HZ;
  const records = rec.stances?.get(life.nid) ?? [];
  let at = -1;       // the body record in force at the tick
  let next = 0;      // the next round
  while (next < rounds.length && rounds[next] <= from) next += 1;
  for (let tick = from + step; tick <= t + 1e-9; tick += step) {
    while (at + 1 < records.length && records[at + 1].t <= tick) at += 1;
    const entry = at >= 0 ? records[at] : null;
    const state = entry ? rec.animStates?.[entry.lower] : null;
    const flags = state?.flags ?? 0;
    const stance = flags & ANIM_FLAGS.LYING ? 'prone' : flags & ANIM_FLAGS.CROUCHING ? 'crouch' : 'stand';
    let throttle = 0;
    let strafe = 0;
    let jumping = false;
    if (state?.name) {
      throttle = /forward|backward/i.test(state.name) ? 1 : 0;
      strafe = /strafe/i.test(state.name) ? 1 : 0;
      jumping = /jump/i.test(state.name);
    } else {
      const motion = motionAt(life, tick);
      if (motion) {
        throttle = Math.abs(motion.forward) > MOVING ? 1 : 0;
        strafe = Math.abs(motion.bodyVelocity[0]) > MOVING ? 1 : 0;
      }
    }
    while (next < rounds.length && rounds[next] <= tick && rounds[next] <= t) {
      model.onShot();
      next += 1;
    }
    model.update(step * 1.000001, { stance, throttle, strafe, jumping });
  }
  return Math.max(0, model.current());
}

/**
 * A seat gun's state at `t` (fire-state.js `FireState`, the page's own): its
 * magazine, spares, reload, heat and cone, run over the rounds its FireArms
 * fired from the hull's spawn (`rounds`, times) at `perPull` rounds a pull.
 * Each recorded round is a pull, and a pull raises the bloom once.
 */
export function gunStateAt(stats, rounds, t, perPull = 1) {
  const state = new FireState(stats);
  let clock = null;
  let last = null;
  for (const r of rounds) {
    if (r > t) break;
    if (clock !== null) state.step(r - clock);
    state.registerShot(perPull);
    clock = r;
    last = r;
  }
  if (clock !== null) state.step(Math.max(0, t - clock));
  return { state, last };
}

/** How ready a seat gun is to fire again, 0 just fired to 1 ready: the last
 *  of its gates to clear (vehicle-hud.js `readyFraction`), its fire rate's
 *  cooldown from the recorded round included. */
function readiness({ state, last }, t) {
  const stats = state.stats;
  let remaining = stats.reloadTime > 0 ? state.reloadRemaining / stats.reloadTime : 0;
  const rate = stats.roundOfFire;
  if (rate > 0 && last !== null) remaining = Math.max(remaining, Math.max(0, 1 / rate - (t - last)) * rate);
  if (state.hasHeat && state.overheatRemaining > 0 && stats.timeDelayOnOverheat > 0) {
    remaining = Math.max(remaining, state.overheatRemaining / stats.timeDelayOnOverheat);
  }
  return 1 - Math.max(0, Math.min(1, remaining));
}

export class ReplayHud {
  constructor(player) {
    this.player = player;
    this.state = null;
    this.data = new Map();      // weapon template -> its glb's weapon block, null, or a Promise
    this.written = null;        // 'foot' | 'seat' | null: which variables the page holds of ours
    this.sightShown = false;    // the page's `replay-sight` class
    this.events = new WeakMap(); // life -> Map<weapon or gun, its recorded rounds (and reloads)>
    this.hitMarks = null;       // pid -> his hit marks' times (replay-hitmarks.js), once
    this.hitMarkFuses = null;   // the projectile table they were worked out with
    this.weapons = undefined;   // weapon -> { speed, projectile }, null until fetched
  }

  /** Each weapon's muzzle velocity and round, `weapons[]` in the models
   *  tree's `damage.json` (the speed the page's drawn round flies at),
   *  fetched once. The marks are worked out again when it lands. */
  weaponTable() {
    if (this.weapons !== undefined) return this.weapons;
    this.weapons = null;
    const ctx = this.player.ctx;
    if (!ctx.modelsBase || typeof fetch !== 'function') return null;
    fetch(`${ctx.modelsBase}/damage.json${ctx.bust?.() ?? ''}`)
      .then(r => (r.ok ? r.json() : null))
      .then(doc => {
        const weapons = new Map();
        for (const w of doc?.weapons ?? []) {
          if (w?.name) weapons.set(lower(w.name), { speed: Number.isFinite(w.velocity) ? w.velocity : null, projectile: lower(w.projectile) });
        }
        if (!weapons.size) return;
        this.weapons = weapons;
        this.hitMarks = null;
      })
      // A tree without one times the marks at a stock speed.
      .catch(() => {});
    return null;
  }

  /** `CrossHair/HitIndicationTime` for `pid` at `t`: his hit marks, worked
   *  out for every player the first time anyone's are asked for. A mark goes
   *  up when the round arrives, at its weapon's muzzle velocity; a flak
   *  shell's fuse comes from the level's projectile table (the page's guns
   *  hold it once the level is built), and the marks are worked out again
   *  when it is. */
  hitMarkOf(pid, t) {
    const weapons = this.weaponTable();
    const fuses = this.player.ctx.guns?.projectileMaterials ?? null;
    if (!this.hitMarks || fuses !== this.hitMarkFuses) {
      const thrown = new Set([...(this.player.networkedRounds ?? [])]
        .map(weaponOfProjectile).filter(Boolean).map(lower));
      const fuseOf = w => {
        const projectile = weapons?.get(w)?.projectile;
        return (projectile && fuses?.[projectile]?.explodeNearEnemyDistance) || null;
      };
      this.hitMarks = inferHitMarks(this.player.rec, { thrown, speedOf: w => weapons?.get(w)?.speed ?? null, fuseOf });
      this.hitMarkFuses = fuses;
    }
    return hitMarkAt(this.hitMarks.get(pid), t);
  }

  /** `weaponEvents` for `life` and `weapon`, gathered once. */
  eventsOf(life, weapon) {
    let byWeapon = this.events.get(life);
    if (!byWeapon) this.events.set(life, byWeapon = new Map());
    const key = lower(weapon);
    if (!byWeapon.has(key)) byWeapon.set(key, weaponEvents(this.player.rec, life, weapon));
    return byWeapon.get(key);
  }

  /** A weapon's glb block (arms-rig.js reads the same `weapon` extras), once
   *  loaded; undefined while it loads. */
  weaponData(name) {
    if (!name) return null;
    const key = lower(name);
    const held = this.data.get(key);
    if (held !== undefined && !(held instanceof Promise)) return held;
    if (held) return undefined;
    const soldiers = this.player.soldiers;
    const ctx = this.player.ctx;
    const load = soldiers?.handGun
      ? soldiers.handGun(name).then(gun => gun?.data ?? null)
      : ctx.loader?.loadAsync?.(`${ctx.modelsBase}/${modelFileStem(name)}.glb${ctx.bust?.() ?? ''}`)
        .then(gltf => gltf?.userData?.weapon ?? gltf?.parser?.json?.extras?.weapon ?? gltf?.scene?.userData?.weapon ?? null);
    if (!load) {
      this.data.set(key, null);
      return null;
    }
    this.data.set(key, load.catch(() => null).then(data => {
      this.data.set(key, data);
      return data;
    }));
    return undefined;
  }

  /** The followed player's HUD at `t`, from what the camera is looking out
   *  of (replay-camera.js `sight`): `{ kind: 'foot' | 'seat', ... }`, or null
   *  when the view is not his first person. */
  update(t) {
    const sight = this.player.camera?.sight ?? null;
    this.state = sight ? this.compute(sight, t) : null;
    // The page's cross stays down in a replay but in his first person
    // (replay-ui.js's style).
    const up = this.state !== null;
    if (up !== this.sightShown && typeof document !== 'undefined') {
      document.documentElement.classList.toggle('replay-sight', up);
      this.sightShown = up;
    }
    return this.state;
  }

  compute(sight, t) {
    const { rec } = this.player;
    const pid = this.player.followPid;
    const team = teamAt(rec, pid, t);
    const loadouts = this.player.ctx.loadouts?.() ?? null;
    if (sight.kind === 'foot') {
      const life = sight.life;
      const weapon = heldWeapon(rec, loadouts, life, t);
      const data = this.weaponData(weapon);
      const body = bodyAt(rec, life.nid, t);
      const events = weapon ? this.eventsOf(life, weapon) : null;
      const refills = refillsOf(rec, pid, this.player.recordingPid);
      return {
        kind: 'foot', pid, team, life, kit: life.kitTemplate ?? null, hitMark: this.hitMarkOf(pid, t),
        stance: body?.stance ?? 'stand',
        zoomed: Boolean(body?.zoomed && data?.zoom), zoom: data?.zoom ?? null,
        hp: hpAt(life, t), maxhp: life.maxhp || null,
        weapon, data: data ?? null,
        ammo: data && events ? handAmmoAt({ ...events, refills }, data.magazine ?? null, t, weapon) : null,
        spread: data && events ? spreadAt(rec, life, data.deviation ?? null, events.rounds, t) : 0,
      };
    }
    const { hull, life, seat } = sight;
    const occupancy = hull?.occupancy;
    if (!occupancy) return null;
    const seatId = hull.seatIdAt(seat) ?? occupancy.rootId;
    const hud = occupancy.hudOf(seatId);
    const rootHud = occupancy.seatInfo(occupancy.rootId)?.hud ?? null;
    // The rest of the crew, for the seat dots: each by his seat's place in
    // the occupancy's own order, on his side then.
    const others = [];
    for (const member of crewOf(rec, life, t)) {
      if (member.pid === pid) continue;
      const at = occupancy.order.indexOf(hull.seatIdAt(member.seat));
      if (at >= 0) others.push({ seat: at, team: teamAt(rec, member.pid, t) });
    }
    const nodes = occupancy.fireArmsNodesOf(seatId);
    const guns = nodes.slice(0, 2).map(node => this.seatGun(hull, life, node, t));
    // The cross opens by the seat's second gun when it has one, a Sherman
    // driver's coax (fire-state.js `crossGunOf`, XHIT-15), as the gun's own
    // cone stood at `t` over its recorded rounds.
    const cross = crossGunOf(nodes);
    const crossGun = cross ? (guns[nodes.indexOf(cross)] ?? this.seatGun(hull, life, cross, t)) : null;
    return {
      kind: 'seat', pid, team, life, hull, seat, seatId, hud, rootHud, hitMark: this.hitMarkOf(pid, t),
      hp: hpAt(life, t), maxhp: life.maxhp || rootHud?.maxHitpoints || null,
      dots: occupancy.seatDotsAt(seatId, others, team),
      turret: occupancy.showsTurretIconAt(seatId, true) ? this.lookRotation(hull) : undefined,
      guns,
      spread: crossGun?.state.spread ?? 0,
      // The soldier in the seat: his stance icon and his health stay up.
      soldier: this.seatedSoldier(pid, t),
    };
  }

  /** Whether `life` looked down his weapon's zoom at `t` (`ZOOM_BIT`), and
   *  the lens it gives, `{ zoomed, fov }`: `fov` the weapon's `zoomFov` in
   *  degrees (a whole field of view, radians in the data: a Thompson's 0.5 is
   *  28.6, a sniper rifle's 0.1 is 5.7; hand-fire.js). For the first-person
   *  camera, which is placed before this HUD's frame. */
  zoomOf(life, t) {
    const { rec } = this.player;
    const weapon = heldWeapon(rec, this.player.ctx.loadouts?.() ?? null, life, t);
    const zoom = this.weaponData(weapon)?.zoom;
    if (!zoom || !bodyAt(rec, life.nid, t)?.zoomed) return { zoomed: false, fov: null };
    return { zoomed: true, fov: zoom.fov > 0 ? (zoom.fov * 180) / Math.PI : null };
  }

  /** `pid`'s living soldier at `t`, as the seat's HUD shows him: `{ stance,
   *  kit, hp, maxhp }`, or null. */
  seatedSoldier(pid, t) {
    let body = null;
    for (const l of this.player.rec.lives) {
      if (!l.soldier || l.pid !== pid || l.created > t || t >= l.destroyed) continue;
      if (l.diedAt !== undefined && t >= l.diedAt) continue;
      if (!body || l.created > body.created) body = l;
    }
    if (!body) return null;
    return { stance: 'stand', kit: body.kitTemplate ?? null, hp: hpAt(body, t), maxhp: body.maxhp || null };
  }

  /** One seat gun's ammunition at `t`, from the rounds its FireArms fired
   *  since the hull's spawn. */
  seatGun(hull, life, node, t) {
    const stats = node?.userData?.fireArms;
    if (!stats) return null;
    const rounds = this.eventsOf(life, bareName(node.name)).rounds;
    const group = hull.groups?.find(g => g.node === node);
    const perPull = stats.asynchronyFire ? 1 : Math.max(1, group?.muzzles?.length ?? stats.muzzles ?? 1);
    const run = gunStateAt(stats, rounds, t, perPull);
    return { stats, state: run.state, ready: readiness(run, t) };
  }

  /** `IconLookRotation`: where the camera looks against the hull he
   *  controls, `atan2(dot(right, look), dot(forward, look))` on the hull's
   *  own axes (vehicle-hud.js, VHUD-9). */
  lookRotation(hull) {
    const cam = this.player.ctx.camera;
    const root = hull.root;
    if (!cam || !root?.matrixWorld) return undefined;
    const e = root.matrixWorld.elements;
    // three's -Z is the hull's forward, +X its right.
    const fx = -e[8], fy = -e[9], fz = -e[10];
    const rx = e[0], ry = e[1], rz = e[2];
    const c = cam.matrixWorld.elements;
    const lx = -c[8], ly = -c[9], lz = -c[10];
    return Math.atan2(rx * lx + ry * ly + rz * lz, fx * lx + fy * ly + fz * lz);
  }

  /** The crosshair `vehicle-hud.js` draws, `{ style, deviation, scoped,
   *  centre }` with `deviation` his weapon's or his seat gun's whole cone in
   *  degrees, or null when the view is not his first person. */
  crosshairAim() {
    const s = this.state;
    if (!s) return null;
    // Dragged off his aim, the centre is not where he looked: no cross.
    if (this.player.camera?.sight?.looking) return { style: null, deviation: 0, scoped: false };
    const centre = this.player.rec.crosshairCentrePoint ?? true;
    if (s.kind === 'foot') {
      // A scoped weapon zoomed draws its scope, not the cross (feed).
      const scoped = Boolean(s.zoomed && s.zoom?.scope);
      return { style: s.data?.crossHair ?? null, deviation: s.spread, scoped, centre };
    }
    return { style: s.hud?.crossHairType ?? null, deviation: s.spread ?? 0, scoped: false, centre };
  }

  /**
   * Write this frame's state into the HUD's variables, after the page's own
   * soldier feed (soldier-hud.js `updateSoldierHud`, which has nobody in the
   * world during a replay and puts the soldier groups down). `art` is the
   * page's: `stanceNation(team)`, `kitHealthArt(team, kit)`,
   * `ammoBarCode(name)`.
   */
  feed(vars, art = {}) {
    const s = this.state;
    const kind = s?.kind ?? null;
    if (this.written && this.written !== kind) this.clear(vars);
    this.written = kind;
    if (!s) return;
    // His hit marks: the layout's crosshair group draws them at its corners,
    // over a scope or no cross at all (XHIT-1), and is up whenever he is in
    // the world (soldier-hud.js, which puts it down in a replay). Dragged off
    // his aim, the centre is not his and they go with the cross.
    if (art.hitMarks?.() ?? true) {
      vars['CrossHair/ShowCrossHair'] = true;
      vars['CrossHair/HitIndicationTime'] = this.player.camera?.sight?.looking ? 0 : s.hitMark ?? 0;
    }
    const soldier = s.kind === 'foot' ? s : s.soldier;
    vars['Soldier/ShowSoldierIcon'] = true;
    const nation = art.stanceNation?.(s.team) ?? (s.team === 1 ? 'ger' : 'us');
    const stance = STANCE_TEXTURE[soldier?.stance ?? 'stand'] || 'standing';
    vars['Soldier/SoldierIcon'] = `Soldier/Icon_${nation}_soldier_${stance}.tga`;
    const kitArt = art.kitHealthArt?.(s.team, soldier?.kit ?? null) ?? null;
    if (kitArt?.healthBarIcon) vars['Soldier/SoldierHealthBarIcon'] = kitArt.healthBarIcon;
    if (kitArt?.healthBarFullIcon) vars['Soldier/SoldierHealthBarFullIcon'] = kitArt.healthBarFullIcon;
    // A soldier the recording never had the hit points of (18 of 214 lives
    // in replay_20260928-133433) shows his spawn's full bar, vanilla's 30
    // (CommonSoldierData.inc, as soldier-hud.js seeds it), not the layout's
    // half-full placeholder.
    const maxhp = soldier?.maxhp > 0 ? soldier.maxhp : 30;
    vars['Soldier/SoldierMaxHitPoints'] = maxhp;
    vars['Soldier/SoldierHitPoints'] = Number.isFinite(soldier?.hp) ? soldier.hp : maxhp;
    if (s.kind === 'foot') {
      vars['Vehicle/ShowVehicleIcon'] = false;
      vars['Weapon/ShowWeaponIcon'] = Boolean(s.weapon);
      // His scope, as the page's own soldier's (soldier-hud.js, SCOPE-1): the
      // layout's crosshair group with the scope overlay in place of the cross,
      // a sniper sight or the binoculars' ring. The page's feed puts the
      // group and its index back down every frame.
      if (s.zoomed && s.zoom?.scope) {
        vars['CrossHair/ShowCrossHair'] = true;
        vars['CrossHair/ScopeIndex'] = 1;
        vars['CrossHair/SniperSight'] = Boolean(s.zoom.sniperSight);
        vars['CrossHair/ScopeIcon'] = s.zoom.icon || 'sniper.tga';
        if (!s.zoom.sniperSight) vars['CrossHair/SightIcon'] = s.zoom.sightIcon || 'scout_ring_128x128.tga';
      }
      if (s.data && s.ammo) writeSoldierAmmo(vars, s.data, s.ammo.rounds, s.ammo.mags);
      else for (const name of SOLDIER_AMMO_VARS) delete vars[name];
      return;
    }
    vars['Weapon/ShowWeaponIcon'] = false;
    for (const name of SOLDIER_AMMO_VARS) delete vars[name];
    this.feedSeat(vars, s, art);
  }

  feedSeat(vars, s, art) {
    const set = (name, value) => {
      if (value === null || value === undefined) delete vars[name];
      else vars[name] = value;
    };
    const hud = s.hud;
    set('Vehicle/ShowVehicleIcon', true);
    set('Vehicle/VehicleIcon', hud?.vehicleIcon ?? null);
    set('Vehicle/ShowTurretIcon', s.turret === undefined ? null : true);
    set('IconLookRotation', s.turret ?? null);
    set('Vehicle/VehicleHitPoints', Number.isFinite(s.hp) ? s.hp : s.rootHud?.hitpoints ?? null);
    set('Vehicle/VehicleMaxHitPoints', s.maxhp ?? s.rootHud?.maxHitpoints ?? null);
    // One array while the dots hold: the painter repaints on a new object
    // (hud.js `_isDirty` compares by identity), as vehicle-hud.js's memo knows.
    const sig = s.dots.map(d => d.state).join(',');
    if (sig !== this.dotSig) {
      this.dotSig = sig;
      this.dotStates = s.dots.map(d => d.state);
    }
    set('Occupied/OccupiedData', this.dotStates);
    for (let i = 0; i < 6; i++) {
      set(`Vehicle/VehiclePos/VehiclePosX${i + 1}`, s.dots[i]?.x ?? null);
      set(`Vehicle/VehiclePos/VehiclePosY${i + 1}`, s.dots[i]?.y ?? null);
    }
    set('Ammo/NumberOfWeaponIcons', hud?.numberOfWeaponIcons
      ?? (hud?.secondaryAmmoIcon || hud?.secondaryAmmoBar ? 2 : 1));
    const code = name => (name == null ? null : art.ammoBarCode?.(name) ?? null);
    set('Ammo/PrimaryAmmoIcon', hud?.primaryAmmoIcon ?? null);
    set('Ammo/PrimaryAmmoBar', code(hud?.primaryAmmoBar));
    set('Ammo/SecondaryAmmoIcon', hud?.secondaryAmmoIcon ?? null);
    set('Ammo/SecondaryAmmoBar', code(hud?.secondaryAmmoBar));
    const [primary, secondary] = s.guns;
    const count = gun => (gun && !gun.state.unlimited ? gun.state.ammo : null);
    set('Ammo/PrimaryAmmo', count(primary));
    set('Ammo/PrimaryAmmoText', count(primary));
    set('Ammo/MaxPrimaryAmmo', primary ? primary.stats.magSize : null);
    set('Ammo/PrimaryMag', primary ? (primary.state.magsLeft === Infinity ? -1 : primary.state.magsLeft) : null);
    set('Ammo/SecondaryAmmo', count(secondary));
    set('Ammo/SecondaryAmmoText', count(secondary));
    set('Ammo/MaxSecondaryAmmo', secondary ? secondary.stats.magSize : null);
    const heated = primary?.state.hasHeat ? primary : secondary?.state.hasHeat ? secondary : null;
    set('Overheat/OverHeat', heated ? heated.state.heat : null);
    set('Ammo/ReloadTime', primary ? primary.ready : null);
    set('Ammo/ReloadTimeSecondary', secondary ? secondary.ready : null);
  }

  /** Take back every variable this wrote: the view has left his eyes. */
  clear(vars) {
    this.dotSig = null;
    for (const name of [...SOLDIER_VARS, ...SOLDIER_AMMO_VARS, ...SEAT_VARS]) delete vars[name];
    vars['Soldier/ShowSoldierIcon'] = false;
    vars['Vehicle/ShowVehicleIcon'] = false;
    vars['Weapon/ShowWeaponIcon'] = false;
    this.written = null;
  }

  dispose(vars = null) {
    if (vars && this.written) this.clear(vars);
    this.state = null;
    if (this.sightShown && typeof document !== 'undefined') document.documentElement.classList.remove('replay-sight');
    this.sightShown = false;
  }
}
