// The followed player's weapon in first person: his arms and the weapon in
// his hands as the game drew them over his view (features/round-replay-hud).
// The rig is the page's own (arms-rig.js: `<Soldier>__<Weapon>.fp.glb`, his
// side's sleeves around the weapon, hung off the camera where the engine
// hangs it and drawn in its own pass over the frame); this poses it from the
// recording.
//
// What the arms play is recorded. The body record's upper state (`st`) is
// the engine's own animation state machine's, and every upper state a weapon
// declares names its first-person clip: the aim's sway, the run, crouched
// and lying, the raise, the reload, the idle fidgets, the knife's five
// swings. The rig bakes those clips (extract_viewmodel.py `FAMILIES`), so
// the arms are the recorded state's clip, blended in at that state's own
// rate (`setMorphFactor`, a weight per second) over the pose the arms held
// when it came. The shots are his rounds (`f`), exact where the 10 Hz
// records catch a burst's fire state only now and then. A state that
// declares no first-person clip (a stance change, a hit) leaves the arms
// where they were; a lower state that puts the weapon away (swimming, a
// ladder, a chute: `c_AsmHideWeapon`) takes them off the screen.
//
// All of it is a function of the recording's clock: a seek, a pause and a
// speed change need nothing, the arms are posed at `t` every frame. Only the
// zoom's lean into the sights and the arms' lens ease a frame at a time, as
// the page's own soldier's do (hand-fire.js).

import * as THREE from 'three';
import { createArmsRig } from './arms-rig.js';
import { heldWeapon } from './replay-hud.js';
import { ANIM_FLAGS, bodyAt } from './replay-recording.js';
import { roundIsRecorded } from './replay-props.js';
import { syncReplayCollision } from './replay-gunfire.js';
import { FOV_DEG as FOOT_FOV } from './soldier.js';

/** The lower state's `c_AsmHideWeapon` (the anim table's flag bit 2): no item
 *  in his hands while he swims, climbs, hangs under a chute, sits in a seat
 *  or dies (hand-weapon.js `itemsLocked`). */
const HIDE_WEAPON = 0x2;

/** Rigs kept loaded: the weapons last in his hands, and last in the hands of
 *  whoever was watched before. One is about 2.5 MB. */
const KEEP_RIGS = 6;

/** A rig that would not load is asked for again after this, milliseconds:
 *  a request lost while the level was still coming down is not a weapon
 *  missing for the rest of the replay. */
const RETRY_AFTER = 10000;

/** Rounds no further apart than this many of his weapon's own intervals (1 /
 *  `roundOfFire`) are one hold of the trigger: a looping fire clip runs on
 *  through them. Further apart, each is a tap. */
const BURST_INTERVALS = 1.6;

/** Seconds a recorded fire state may lie from one of his rounds and be that
 *  round's: a record either way. One no round explains is a shot of its own
 *  (a round the recording client was never told of). */
const FIRE_MATCH = 0.15;

/** A blend this light is dropped: the arms' blend history is walked back
 *  until what is left weighs less. */
const WEIGHT_FLOOR = 0.01;
const BLEND_DEPTH = 8;

/** The engine's blend rates (arms-rig.js): a state's `setMorphFactor` is the
 *  weight it gains a second, 1000 or more is a cut, and a rig whose extras
 *  predate the field takes the constructor's 5. */
const MORPH_DEFAULT = 5;
const MORPH_SNAP = 1000;

/** The zoom's per-frame easing, the page's own soldier's (hand-fire.js
 *  `VIEW_EASE`, `FOV_SNAP`; `BFSoldier::handleVisualUpdate`, no dt). */
const VIEW_EASE = 0.25;
const FOV_EASE = 0.3;
const FOV_SNAP = 0.001;

/**
 * A recorded upper state's family (`Ub_<Family><Weapon>[n]`) to the rig's
 * clip family (extract_viewmodel.py `FAMILIES`). The states that play one of
 * the baked clips at another rate go to the family nearest it: a turn on the
 * spot plays the run clip at 0.7, which the walk's 0.5 is nearer than the
 * run's 1.41; a strafe, a backward run and a running jump play it at the
 * run's rate; lying, a turn plays the crawl. `Ub_Stand<W>` has a clip of
 * its own (`1PStand<W>`, never baked) and takes the aim's. A number on the
 * end picks one of several registered states: the fidgets (`idle1..3`) and
 * the knife's swings (`fire1..5`).
 */
const ARMS_FAMILY = new Map(Object.entries({
  StandAim: 'idle', Stand: 'idle', Idle: 'idle',
  WalkForward: 'walk', WalkBackward: 'walk', Turn: 'walk', StandJump: 'walk',
  RunForward: 'run', RunBackward: 'run', StrafeLeft: 'run', StrafeRight: 'run',
  RunJump: 'run', RunJumpBackward: 'run',
  Fire: 'fire', StandReload: 'reload', StandRaiseWeapon: 'deploy',
  Crouch: 'crouch', CrouchForward: 'crouchWalk', CrouchBackward: 'crouchWalk',
  CrouchStrafeLeft: 'crouchWalk', CrouchStrafeRight: 'crouchWalk', CrouchTurn: 'crouchWalk',
  CrouchRaiseWeapon: 'crouchDeploy',
  Lie: 'prone', LieForward: 'crawl', LieBackward: 'crawl', LieStrafeLeft: 'crawl',
  LieStrafeRight: 'crawl', LieTurnLeft: 'crawl', LieTurnRight: 'crawl',
  LieFire: 'proneFire', LieReload: 'proneReload', LieRaiseWeapon: 'proneDeploy',
}));

/** The families whose record is a shot, not a state to hold: the fire is his
 *  rounds' (`armsTrack`). */
const FIRE_FAMILIES = new Set(['fire', 'proneFire']);

/** What a rig without a family plays instead, until one it has: the stance
 *  families fall back to the standing ones (stance-clips.js), a numbered
 *  variant to its family. A rig with none of them (a grenade's reload) holds
 *  what its arms were doing. */
const FALLBACK = {
  crouch: 'idle', crouchWalk: 'walk', walk: 'idle', run: 'walk', prone: 'idle', crawl: 'walk',
  proneFire: 'fire', proneReload: 'reload', crouchDeploy: 'deploy', proneDeploy: 'deploy',
};

const lower = s => String(s ?? '').toLowerCase();

/** The aim family of a stance, for the arms between his shots. */
const aimOf = stance => (stance === 'prone' ? 'prone' : stance === 'crouch' ? 'crouch' : 'idle');

/** The weapons a recording's state table declares states for, longest name
 *  first (`K98Sniper` before `K98`), as the suffixes its upper states carry
 *  (`Ub_StandAim<W>`). */
const weaponsOfTable = new WeakMap();
export function stateWeapons(rec) {
  const table = rec.animStates;
  if (!table) return [];
  let list = weaponsOfTable.get(table);
  if (!list) {
    const found = new Set();
    for (const state of Object.values(table)) {
      const name = state?.name ?? '';
      if (name.startsWith('Ub_StandAim') && name.length > 'Ub_StandAim'.length) found.add(name.slice('Ub_StandAim'.length));
    }
    list = [...found].sort((a, b) => b.length - a.length);
    weaponsOfTable.set(table, list);
  }
  return list;
}

/**
 * A recorded upper state as the arms read it: `{ family, n, weapon }` for a
 * state of a weapon (`Ub_LieFireMp40` is `proneFire` of `Mp40`,
 * `Ub_IdleMp402` the second `idle` fidget, `Ub_FireKnifeAllies3` the third
 * swing), `family` null for one that plays no clip of the rig's (a stance
 * change, `Ub_CrouchToLieKnifeAllies`); null for a state of no weapon (a
 * swim, a ladder, a hit). The number is matched after the weapon, whose own
 * name may end in digits (`Mp40`).
 */
export function armsStateOf(name, weapons) {
  if (typeof name !== 'string' || !name.startsWith('Ub_')) return null;
  const body = name.slice(3);
  for (const weapon of weapons) {
    const at = body.lastIndexOf(weapon);
    if (at <= 0) continue;
    const tail = body.slice(at + weapon.length);
    if (tail && !/^\d+$/.test(tail)) continue;
    const family = ARMS_FAMILY.get(body.slice(0, at)) ?? null;
    return { family, n: tail ? Number(tail) : 0, weapon };
  }
  return null;
}

/** The family the rig plays for `family` (with variant `n`): the family
 *  itself, its variant, or down its fallbacks; null when the rig has none. */
export function resolveFamily(family, n, has) {
  if (!family) return null;
  if (n > 0 && has(`${family}${n}`)) return `${family}${n}`;
  for (let f = family; f; f = FALLBACK[f]) if (has(f)) return f;
  return null;
}

/** The index of the last entry of `list` (sorted on `key`) at or before
 *  `t`, or -1. */
function lastAt(list, t, key = 'start') {
  let lo = 0;
  let hi = list.length - 1;
  if (hi < 0 || list[0][key] > t) return -1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (list[mid][key] <= t) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/**
 * The arms' track for `life` with `weapon` in his hands, on a rig that has
 * the families `has` accepts and plays them for `clip(family)` =
 * `{ duration, loop, morph }`: `{ base, fires, throws }`.
 *
 * `base` is what the arms hold between shots, `[{ start, family, hidden }]`
 * from his body records: the recorded state's family, or `hidden` while his
 * lower state puts the weapon away. A record of a fire state is the stance's
 * aim here; the fire itself is `fires`, `[{ start, end, family, loop }]`
 * from his rounds of the weapon: a looping fire clip (the Thompson's, the
 * Mp40's) is one segment a burst, from its first round to one interval after
 * its last; a clip played once (a rifle's bolt, a throw, a swing) is one a
 * round, from the click (a throw's round leaves `fireDelay` after it) for its
 * own length. `throws`, `[{ start }]`, are when a thrown weapon left his
 * hand, for the `hideDuringFireTime` the weapon is out of it.
 */
export function armsTrack(rec, life, weapon, { has, clip, data = null, weapons = stateWeapons(rec) }) {
  const created = life.created ?? -Infinity;
  const destroyed = life.destroyed ?? Infinity;
  const records = (rec.stances?.get(life.nid) ?? []).filter(e => e.t >= created && e.t < destroyed);
  const wanted = lower(weapon);
  const base = [];
  const fireRecords = [];     // [{ t, n, stance }]: where a recorded fire state of it began
  let family = null;
  let hidden = true;
  let firing = false;
  for (const entry of records) {
    const lowerState = rec.animStates?.[entry.lower];
    const flags = lowerState?.flags ?? 0;
    const stance = flags & ANIM_FLAGS.LYING ? 'prone' : flags & ANIM_FLAGS.CROUCHING ? 'crouch' : 'stand';
    const hide = Boolean(flags & HIDE_WEAPON);
    const state = armsStateOf(rec.animStates?.[entry.upper]?.name, weapons);
    let want = family;
    const fire = Boolean(state && FIRE_FAMILIES.has(state.family));
    if (fire) {
      // Another weapon's fire (a medic pack used) is none of this one's.
      if (!firing && lower(state.weapon) === wanted) fireRecords.push({ t: entry.t, n: state.n, stance });
      want = resolveFamily(aimOf(stance), 0, has) ?? family;
    } else if (state?.family) {
      want = resolveFamily(state.family, state.n, has) ?? family;
    }
    firing = fire;
    // A new entry where the family changes, or the weapon goes away or
    // comes back.
    if (hide !== hidden || want !== family) {
      base.push({ start: entry.t, family: want, hidden: hide });
      family = want;
      hidden = hide;
    }
  }

  // His rounds of it, as the clicks that fired them.
  const delay = data?.throw?.fireDelay > 0 ? data.throw.fireDelay : 0;
  const shots = [];
  const throws = [];
  for (const f of rec.fires ?? []) {
    if (f.press || f.nid !== life.nid || lower(f.weapon) !== wanted || f.t < created || f.t >= destroyed) continue;
    shots.push({ at: Math.max(created, f.t - delay), n: 0, stance: null });
    if (data?.throw) throws.push({ start: f.t });
  }
  shots.sort((a, b) => a.at - b.at);
  throws.sort((a, b) => a.start - b.start);
  // Each recorded fire state is a round's, whose swing it names: the record
  // comes up to a sample after the click. One no round explains is a shot
  // of its own.
  const unexplained = [];
  for (const r of fireRecords) {
    let best = null;
    for (let i = Math.max(0, lastAt(shots, r.t - FIRE_MATCH - 0.1, 'at')); i < shots.length; i++) {
      const s = shots[i];
      if (s.at > r.t + FIRE_MATCH) break;
      if (s.at >= r.t - FIRE_MATCH - 0.1 && (!best || Math.abs(s.at - r.t) < Math.abs(best.at - r.t))) best = s;
    }
    if (best) {
      best.n = best.n || r.n;
      best.stance = r.stance;
    } else {
      unexplained.push({ at: r.t, n: r.n, stance: r.stance });
    }
  }
  shots.push(...unexplained);
  shots.sort((a, b) => a.at - b.at);

  const stanceAt = t => {
    const i = lastAt(records, t, 't');
    const flags = i >= 0 ? rec.animStates?.[records[i].lower]?.flags ?? 0 : 0;
    return flags & ANIM_FLAGS.LYING ? 'prone' : flags & ANIM_FLAGS.CROUCHING ? 'crouch' : 'stand';
  };
  const interval = data?.roundOfFire > 0 ? 1 / data.roundOfFire : 0.1;
  const fires = [];
  let swing = 0;
  for (let i = 0; i < shots.length; i++) {
    const shot = shots[i];
    const stance = shot.stance ?? stanceAt(shot.at);
    const n = shot.n || (has('fire1') ? (swing++ % countVariants(has, 'fire')) + 1 : 0);
    const name = resolveFamily(stance === 'prone' ? 'proneFire' : 'fire', n, has);
    if (!name) continue;
    const c = clip(name);
    const next = shots[i + 1]?.at ?? Infinity;
    const last = fires[fires.length - 1];
    if (c.loop) {
      // One hold of the trigger: the clip runs on from the burst's first
      // round, and lets go an interval after its last.
      if (last?.loop && last.family === name && shot.at - last.lastShot <= BURST_INTERVALS * interval) {
        last.lastShot = shot.at;
        last.end = Math.min(next, shot.at + interval);
        continue;
      }
      fires.push({ start: shot.at, end: Math.min(next, shot.at + interval), family: name, loop: true, lastShot: shot.at });
    } else {
      fires.push({ start: shot.at, end: Math.min(next, shot.at + c.duration), family: name, loop: false, lastShot: shot.at });
    }
  }
  return { base, fires, throws };
}

/** How many numbered variants of `family` a rig has (`fire1..fireN`). */
function countVariants(has, family) {
  let n = 0;
  while (has(`${family}${n + 1}`)) n += 1;
  return Math.max(1, n);
}

/**
 * What holds the arms at `t` on `track`: `{ family, took, clipStart, loop }`
 * (`took` when it took them, `clipStart` where its clip's clock starts: a
 * shot's or burst's first round, a body state's first record; `loop` a
 * shot's, null for the body's, whose clip says), `{ hidden: true, took }`
 * while the weapon is away, or null before his first record.
 */
export function armsHolderAt(track, t) {
  const b = track.base[lastAt(track.base, t)] ?? null;
  if (!b) return null;
  if (b.hidden || !b.family) return { hidden: true, took: b.start };
  const f = track.fires[lastAt(track.fires, t)] ?? null;
  if (f && t < f.end) return { family: f.family, took: f.start, clipStart: f.start, loop: f.loop };
  // Out of a shot the arms go back to what the body holds, from the shot's
  // end; a one-shot of the body's (a reload, a raise, a fidget) keeps its own
  // clock.
  const took = f && f.end > b.start ? f.end : b.start;
  return { family: b.family, took, clipStart: b.start, loop: null };
}

/**
 * The arms' pose at `t`: `[{ family, time, weight }]`, the clips to play and
 * how much of each, the weights summing to 1, or null while the weapon is
 * away. `clip(family)` is `{ duration, loop, morph }`. The holder at `t`
 * blends in at its morph rate over the pose the arms held when it took them,
 * which is the pose at that moment, blends and all, as the engine blends into
 * a state from whatever the skeleton holds.
 */
export function armsPose(track, t, clip) {
  const holder = armsHolderAt(track, t);
  if (!holder || holder.hidden) return null;
  const out = [];
  let budget = 1;
  let at = t;
  let h = holder;
  for (let depth = 0; h && !h.hidden && depth < BLEND_DEPTH && budget > WEIGHT_FLOOR; depth++) {
    const c = clip(h.family);
    const morph = c.morph > 0 ? c.morph : MORPH_DEFAULT;
    const w = morph >= MORPH_SNAP ? 1 : Math.min(1, Math.max(0, (at - h.took) * morph));
    // The body's loops keep one phase through whatever interrupts them; a
    // burst's loop and every one-shot run from their own start.
    const loop = h.loop ?? c.loop;
    const run = at - (h.loop === null && loop ? 0 : h.clipStart ?? 0);
    const time = c.duration > 0
      ? (loop ? ((run % c.duration) + c.duration) % c.duration : Math.min(c.duration, Math.max(0, run)))
      : 0;
    const weight = budget * w;
    const same = out.find(o => o.family === h.family);
    if (same) same.weight += weight;
    else if (weight > 0) out.push({ family: h.family, time, weight });
    budget -= weight;
    if (w >= 1) break;
    at = h.took;
    h = armsHolderAt(track, at - 1e-6);
  }
  if (!out.length) return null;
  const total = out.reduce((sum, o) => sum + o.weight, 0);
  for (const o of out) o.weight /= total;
  return out;
}

/** Whether a thrown weapon is out of his hand at `t`: its
 *  `hideDuringFireTime` after it left (hand-fire.js `hideFire`). */
export function thrownAt(track, t, hide) {
  if (!(hide > 0)) return false;
  const i = lastAt(track.throws, t);
  return i >= 0 && t - track.throws[i].start < hide;
}

export class ReplayViewmodel {
  constructor(player) {
    this.player = player;
    const ctx = player.ctx;
    this.warmups = {};
    // The page's own rig machinery, an instance of the replay's: its own
    // near scene and camera, so nothing here touches the page's soldier.
    const warmups = this.warmups;
    this.arms = createArmsRig({
      get camera() { return ctx.camera; },
      get loader() { return ctx.loader; },
      get MODELS_BASE() { return ctx.modelsBase; },
      bust: () => ctx.bust?.() ?? '',
      isCollision: obj => (ctx.isCollision ? ctx.isCollision(obj)
        : Boolean(obj.userData?.collision || /collision/i.test(obj.name || ''))),
      warmSubtree: (root, cam, target) => ctx.warmSubtree?.(root, cam, target) ?? Promise.resolve(),
      warmups,
      optPilot: { checked: false },
      aircraft: null,
      car: null,
      soldier: null,
      weaponToken: 0,
    });
    this.rigs = new Map();       // rig key -> entry
    this.clock = 0;              // use counter, for the rigs kept
    this.shown = null;           // this frame's `{ pid, life, weapon, entry }`
    this.eased = null;           // `{ life, entry, fov, pos }`: the zoom's ease
    this.disposed = false;
  }

  /** The rig for `weapon` in `soldier`'s sleeves: loaded once, and kept
   *  while it is among the `KEEP_RIGS` last used. */
  rigFor(weapon, soldier) {
    const file = this.arms.viewmodelRigFor(weapon, soldier);
    const key = lower(file ?? `bare:${weapon}`);
    let entry = this.rigs.get(key);
    if (entry?.status === 'failed' && Date.now() - entry.failedAt > RETRY_AFTER) {
      this.rigs.delete(key);
      entry = null;
    }
    if (!entry) {
      entry = { key, weapon, soldier, status: 'loading', used: 0, tracks: new WeakMap() };
      this.rigs.set(key, entry);
      this.load(entry);
    }
    entry.used = ++this.clock;
    this.trim(entry);
    return entry;
  }

  async load(entry) {
    try {
      const fetched = await this.arms.fetchRig(entry.weapon, entry.soldier);
      if (this.disposed || this.rigs.get(entry.key) !== entry) return;
      if (!fetched) {
        entry.status = 'failed';
        entry.failedAt = Date.now();
        return;
      }
      this.warmups.rig = null;
      const mounted = this.arms.mountRig(fetched.gltf, fetched.fp, entry.weapon, 0);
      Object.assign(entry, mounted);
      // Each family's length, loop and blend rate (hand-weapon.js `clips`).
      entry.clips = fetched.fp ? mounted.doc?.clips ?? null : null;
      entry.rig.visible = false;
      entry.has = name => Object.hasOwn(mounted.actions, name);
      entry.clipInfo = new Map();
      entry.active = new Set();
      entry.group = this.collect(entry);
      entry.status = 'warming';
      const warm = this.warmups.rig ?? Promise.resolve();
      warm.catch(() => {}).then(() => {
        if (entry.status === 'warming') entry.status = 'ready';
      });
    } catch (error) {
      entry.status = 'failed';
      entry.failedAt = Date.now();
      console.warn(`replay: the ${entry.weapon} in first person is left out`, error);
    }
  }

  /** The rig's FireArms, indexed by the page's guns as the page's own
   *  soldier's are: its flash lives in the rig, drawn in the near pass, and
   *  its rounds leave the eye (`fireInCameraDof`). */
  collect(entry) {
    const guns = this.player.ctx.guns;
    if (!guns?.collect || !entry.data) return null;
    const ray = { origin: new THREE.Vector3(), dir: new THREE.Vector3(0, 0, -1) };
    entry.ray = ray;
    const groups = guns.collect(entry.rig, {
      replace: false, speedScale: 1, maxRange: 1200, roundLifetime: 'data', aimRay: () => ray,
    });
    for (const group of groups) {
      group.replay = true;
      group.view = 'first';
      group.weapon = entry.weapon;
    }
    entry.groups = groups;
    return groups.find(g => (g.stats?.input || 'c_PIFire') === 'c_PIFire') ?? groups[0] ?? null;
  }

  /** Take the rigs used longest ago down, never `keep`. */
  trim(keep) {
    while (this.rigs.size > KEEP_RIGS) {
      let oldest = null;
      for (const entry of this.rigs.values()) {
        if (entry !== keep && (!oldest || entry.used < oldest.used)) oldest = entry;
      }
      if (!oldest) return;
      this.rigs.delete(oldest.key);
      this.release(oldest);
    }
  }

  release(entry) {
    entry.status = 'gone';
    const guns = this.player.ctx.guns;
    for (const group of entry.groups ?? []) guns?.release?.(group);
    if (entry.rig) this.arms.disposeRig(entry);
    if (this.eased?.entry === entry) this.eased = null;
  }

  /** A family's clip on `entry`'s rig: `{ duration, loop, morph }`. */
  clipOf(entry, family) {
    let info = entry.clipInfo.get(family);
    if (!info) {
      const action = entry.actions?.[family];
      const meta = entry.clips?.[family] ?? {};
      info = {
        duration: action?.getClip().duration ?? meta.duration ?? 0,
        loop: action ? action.loop === THREE.LoopRepeat : Boolean(meta.loop),
        morph: meta.morphFactor ?? MORPH_DEFAULT,
      };
      entry.clipInfo.set(family, info);
    }
    return info;
  }

  /** `life`'s arms track on `entry`'s rig, built once. */
  trackOf(entry, life, weapon) {
    let track = entry.tracks.get(life);
    if (!track) {
      track = armsTrack(this.player.rec, life, weapon, {
        has: entry.has ?? (() => false),
        clip: family => this.clipOf(entry, family),
        data: entry.data,
      });
      entry.tracks.set(life, track);
    }
    return track;
  }

  update(t) {
    const player = this.player;
    const sight = player.camera?.sight;
    let show = null;
    if (sight?.kind === 'foot' && sight.life) {
      const life = sight.life;
      const weapon = heldWeapon(player.rec, player.ctx.loadouts?.() ?? null, life, t);
      if (weapon) {
        const entry = this.rigFor(weapon, life.tmpl);
        if (entry.status === 'ready') show = { pid: player.followPid, life, weapon, entry };
      }
    }
    this.shown = null;
    for (const entry of this.rigs.values()) {
      if (entry.rig && entry !== show?.entry) entry.rig.visible = false;
    }
    if (!show) return;
    const { entry, life } = show;
    const body = bodyAt(player.rec, life.nid, t);
    const zoomed = Boolean(body?.zoomed && entry.data?.zoom);
    this.ease(entry, life, zoomed);
    // A scoped rifle looked down is the scope, and no rifle (hand-fire.js).
    let visible = !(zoomed && entry.data.zoom.scope);
    if (entry.mixer) {
      const track = this.trackOf(entry, life, show.weapon);
      const pose = armsPose(track, t, family => this.clipOf(entry, family));
      if (!pose) visible = false;
      else this.apply(entry, pose);
      if (entry.weaponNode && entry.data?.throw) {
        entry.weaponNode.visible = !thrownAt(track, t, entry.data.throw.hideDuringFireTime);
      }
    } else if (body && (player.rec.animStates?.[latestLower(player.rec, life.nid, t)]?.flags ?? 0) & HIDE_WEAPON) {
      visible = false;
    }
    entry.rig.visible = visible;
    if (visible) this.shown = show;
  }

  /** The zoom's two eases (hand-fire.js): the arms' lens toward the weapon's
   *  `soldierFov`, the rig toward its zoom pose. A new life or rig starts
   *  where it is. */
  ease(entry, life, zoomed) {
    const target = zoomed ? entry.data.zoom.soldierFov ?? 1 : 1;
    const at = zoomed ? entry.viewZoom : entry.viewHip;
    const e = this.eased;
    if (!e || e.life !== life || e.entry !== entry) {
      this.eased = { life, entry, fov: target, pos: { ...at } };
    } else {
      e.fov = Math.abs(target - e.fov) <= FOV_SNAP ? target : e.fov + (target - e.fov) * FOV_EASE;
      e.pos.x += (at.x - e.pos.x) * VIEW_EASE;
      e.pos.y += (at.y - e.pos.y) * VIEW_EASE;
      e.pos.z += (at.z - e.pos.z) * VIEW_EASE;
    }
    const pos = this.eased.pos;
    entry.rig.position.set(pos.x, pos.y, pos.z);
  }

  /** The pose's clips on the rig's mixer, each at its own time and weight;
   *  every other action stopped. */
  apply(entry, pose) {
    const live = new Set();
    for (const { family, time, weight } of pose) {
      const action = entry.actions[family];
      if (!action) continue;
      live.add(family);
      action.enabled = true;
      action.paused = false;
      action.setEffectiveTimeScale(1);
      action.setEffectiveWeight(weight);
      action.time = time;
      if (!action.isScheduled()) action.play();
    }
    for (const family of entry.active) {
      if (!live.has(family)) entry.actions[family]?.stop();
    }
    entry.active = live;
    entry.mixer.update(0);
  }

  /**
   * A round of `pid`'s, when it is his first person being watched and the
   * weapon is up: fired from his eye (the recorded origin, where the game
   * fired it), down the recorded axis, flashed at the rig's own muzzle. False
   * otherwise, and the round goes the third person's way
   * (replay-bodies.js), as does anything thrown or laid, which the
   * recording draws.
   */
  fire(pid, weapon, f) {
    const shown = this.shown;
    if (!shown || shown.pid !== pid || f.nid !== shown.life.nid || lower(weapon) !== lower(shown.weapon)) return false;
    const { entry } = shown;
    const guns = this.player.ctx.guns;
    const group = entry.group;
    if (!guns || !group || !entry.ray || roundIsRecorded(group, this.player.networkedRounds)) return false;
    const cam = this.player.ctx.camera;
    if (Array.isArray(f.pos) && f.pos.every(Number.isFinite)) entry.ray.origin.set(f.pos[0], f.pos[1], -f.pos[2]);
    else cam.getWorldPosition(entry.ray.origin);
    if (Array.isArray(f.dir) && Math.hypot(f.dir[0], f.dir[1], f.dir[2]) > 0.1) {
      entry.ray.dir.set(f.dir[0], f.dir[1], -f.dir[2]).normalize();
    } else {
      cam.getWorldDirection(entry.ray.dir);
    }
    group.firer = `replay:${pid}`;
    syncReplayCollision(this.player);
    guns.fireShot(group);
    return true;
  }

  /** The near pass (hand-weapon.js `renderViewmodel`): the rig drawn over
   *  the frame just rendered, on cleared depth, through the weapon's own
   *  first-person lens (`set1pFov`) times the zoom's. */
  render() {
    const entry = this.shown?.entry;
    const ctx = this.player.ctx;
    const renderer = ctx.renderer;
    if (!entry?.rig?.visible || !renderer) return;
    const { vmScene, vmCamera, vmHemi, vmSun } = this.arms;
    const cam = ctx.camera;
    vmScene.fog = ctx.scene?.fog ?? null;
    const lights = ctx.lights?.() ?? {};
    if (lights.hemi) {
      vmHemi.color.copy(lights.hemi.color);
      vmHemi.groundColor.copy(lights.hemi.groundColor);
      vmHemi.intensity = lights.hemi.intensity;
      vmHemi.position.copy(lights.hemi.position);
    }
    if (lights.sun) {
      vmSun.color.copy(lights.sun.color);
      vmSun.intensity = lights.sun.intensity;
      vmSun.position.copy(lights.sun.position);
    }
    vmCamera.matrixWorld.copy(cam.matrixWorld);
    vmCamera.matrixWorldInverse.copy(cam.matrixWorld).invert();
    const lens = entry.fov1p ? (entry.fov1p * 180) / Math.PI : FOOT_FOV;
    vmCamera.fov = lens * (this.eased?.entry === entry ? this.eased.fov : 1);
    vmCamera.aspect = cam.aspect;
    vmCamera.near = 0.1;
    vmCamera.far = cam.far;
    vmCamera.updateProjectionMatrix();
    const autoClear = renderer.autoClear;
    renderer.autoClear = false;
    renderer.clearDepth();
    renderer.render(vmScene, vmCamera);
    renderer.autoClear = autoClear;
  }

  /** A seek: the zoom's ease starts where the new instant is. */
  snap() {
    this.eased = null;
  }

  dispose() {
    this.disposed = true;
    for (const entry of this.rigs.values()) this.release(entry);
    this.rigs.clear();
    this.shown = null;
  }
}

/** The lower state index in force for `nid` at `t`. */
function latestLower(rec, nid, t) {
  const list = rec.stances?.get(nid);
  const i = list ? lastAt(list, t, 't') : -1;
  return i >= 0 ? list[i].lower : null;
}
