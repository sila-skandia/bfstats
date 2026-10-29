// Recorded soldiers, drawn by the playable map's own soldier bodies.
//
// A replayed player is handed to the same renderer that draws the map's bots
// (`bot-visuals.js`, one instance of it the replay owns): his side's uniform,
// his own kit's weapon in his hands and its packs on his bones, the half-body
// machine walking and running him at his recorded speed, the torso firing when
// the recording says he fired, the engine's death when he died and the corpse
// where he fell, and his body in his seat when he rode in a hull the seat
// draws. He is fed through the renderer's own inputs: an actor object standing
// where a bot controller would (`getPosition`, `stance`, `isFiring`, `vehicle`,
// `kit`), a world shim answering `player(id).soldier` and `armorOf(id)` from
// the recording, and a seat lookup into the replayed hulls.
//
// His rounds are the page's too: a clone of his weapon's own glb (the FireArms
// the pose glb does not carry, exactly what `bot-rounds.js` does for a bot),
// laid at his drawn weapon and fired down the recorded direction through the
// page's `GunFire` -- flash, casing, tracer, a rocket that flies -- marked as
// the replay's so nothing it hits is billed. The report is the world path
// (`playWorldShot`, the fire patch's near/far layers at the shooter), and his
// boots are the bots' own footstep clock.

import * as THREE from 'three';
import { clone as skeletonClone } from './vendor/utils/SkeletonUtils.js';
import {
  bodyAt, controlledAt, hpAt, isReplicated, kitAt, latestIndex, lifeAt, nameAt, primaryWeaponFor, recordedDeath,
  recordedFlight, rootOf, soldierLivesOf, stateEntries, teamAt,
} from './replay-recording.js';
import { motionAt, poseAt } from './replay-kinematics.js';
import { settledTime } from './replay-recording.js';
import { syncReplayCollision } from './replay-gunfire.js';
import { roundIsRecorded } from './replay-props.js';
import { DIE_CLIPS, corpseSeconds } from './soldier-death.js';
import { SWIM_CLIPS, SWIM_LEAVE_DEPTH } from './swim.js';
import { CHARACTER_HEIGHT } from './soldier-pose.js';
import { PARA_CLIPS } from './parachute.js';
import { EXPLOSION_AIRBORNE, PARACHUTE_AIRBORNE, explosionDeath, explosionFamily } from './knockback.js';
import { loadFirst, weaponUrls } from './pose-bases.js';
import { wearPagePaint } from './level-skin.js';
import { modelFileStem } from './model-file.js';
import {
  ROCKETEERING_AIRBORNE, ROCKETEERING_LOWER, replayBurning, rocketeeringClip,
} from './rocket-pack.js';
import { RocketFlames, packNodeOf } from './rocket-flame.js';

/** The pose glb's root carries a baked half turn a vehicle's does not
 *  (README §12, measured 180.00 degrees off at two spawn instants); the
 *  renderer's own yaw convention is the pose glb's. */
const SOLDIER_YAW_FLIP = new THREE.Quaternion(0, 1, 0, 0);

/** How long the torso holds its fire after a recorded shot, seconds: long
 *  enough for the half-body machine to see the trigger. */
const TRIGGER_HOLD = 0.25;

/** A recorded die state's death family, for the deaths the body renderer
 *  has clips of (`bot-visuals.js` `CORPSE_CLIPS`): `handleDamage`'s, and the
 *  states a thrown body or a dead parachutist comes to rest in. */
const DIE_FAMILY = new Map([
  ...Object.entries(DIE_CLIPS).map(([family, clips]) => [clips.lower, family]),
  [SWIM_CLIPS.swimDie.lower, 'swimDie'],
  ['Lb_ExplosionLandFront', explosionDeath('Lb_ExplosionLandFront')],
  ['Lb_ExplosionLandBack', explosionDeath('Lb_ExplosionLandBack')],
  [PARA_CLIPS.deadLanded.lower, 'parachuteDeadLanded'],
]);

/**
 * A hit he lives through. `BFSoldier::handleDamage` (lnxded `0x08270980`),
 * whenever the Armor is not destroyed by the blow, plays sound trigger 0x13
 * (`c_SstHitDamage`, the hurt grunt; ledger FF-6) and sets the torso, and
 * only the torso, to `Ub_HitChestStand` / `Ub_HitBackStand` (standing),
 * `...Crouch` (crouched) or `Ub_HitLie` (lying): a one-shot that returns to
 * the aim (`extract_pose.py` `HIT_STATES`). None of it was drawn or heard in
 * a replay: the death had its cry (`playSoldierDeathSound`) and the page's
 * own bots their grunt (`onHurt`), a replayed soldier's hurt nothing.
 * Recording 8t224pppqe (Berlin, 2026-10-29): BF6 knifes Player at 86.90 s,
 * Player's soldier 891 drops 30 -> 14 hit points in that sample (`a`, last
 * hitter pid 1) and is recorded in `Ub_HitChestStand` 86.90-87.93 s over
 * `Lb_StandRelax`; the replay played neither the flinch nor the grunt.
 *
 * The trigger is the hit points, not a round: a knife's `KnifeProjectile`
 * lives inside one server tick and that stab has no `pn`/`pd` at all, a
 * fall or a blast has no round either, and `handleDamage` runs for each of
 * them. A drop under `HURT_MIN` is no blow (FF-1: direct damage is given
 * only above 0.01). The torso's state is the recording's where the file has
 * body states: the engine skips it during a blast's flight and while the
 * weapon is not ready (a reload), and the file then holds no hit state, so
 * none is drawn. A file without body states (v3) takes the chest state of
 * his stance.
 */
const HURT_MIN = 0.01;
/** Seconds after the drop a frame may still take it: a frame that lands
 *  later (a seek, a stall) is not the blow's moment. */
const HURT_FRESH = 0.5;
/** Seconds after the drop the recorded torso state is looked for: the hit
 *  points and the state come in the same sample (8t224pppqe: both at
 *  86.90 s), a sample of slack for a recorder that splits them. */
const HURT_STATE_LEAD = 0.1;
const HIT_STATE = /^Ub_Hit(Chest|Back)(Stand|Crouch)$|^Ub_HitLie$/;
const STANCE_HIT = { stand: 'Ub_HitChestStand', crouch: 'Ub_HitChestCrouch', prone: 'Ub_HitLie' };

/** The parachute's lower states (`parachute.js` `PARA_CLIPS`): the fall, the
 *  opening, the glide, the landing and the two deaths. */
const PARACHUTE_LOWER = new Set(Object.values(PARA_CLIPS).map(clips => clips.lower));

/** Seconds a blast's flight comes on the record after his samples leave the
 *  ground: the recorder writes the state it finds a sample later
 *  (replay_20260927-140921: one body is moving at 13 to 18 m/s from 30.78 s
 *  and `Lb_ExplosionForward` is recorded at 30.88 s; another 69.33 and
 *  69.43 s). The engine enters it on the tick his speed passes 8 m/s, so the
 *  replay takes it a sample early rather than run his legs for the tenth of
 *  a second between. */
const FLIGHT_LEAD = 0.1;

/** A live swim state's family, by the lower state that plays it (swim.js
 *  `SWIM_CLIPS`; the swim death is a death, not a swim). */
const SWIM_FAMILY = new Map(Object.entries(SWIM_CLIPS)
  .filter(([family]) => family !== 'swimDie')
  .map(([family, clips]) => [clips.lower, family]));

/** Metres a second along his heading a swimmer the file has no body state
 *  for must make to be drawn swimming rather than afloat. */
const SWIM_STROKE = 0.5;

/** When the recording has a soldier object's body go: its destroy, else
 *  (a server recorder's file, which writes no DestroyObject, only a `d` when
 *  the object leaves the world) the end of its last span in scope; Infinity
 *  when the file has neither. */
function bodyEnd(life) {
  if (life.destroyed !== Infinity) return life.destroyed;
  return life.replicated[life.replicated.length - 1]?.[1] ?? Infinity;
}

/** Seconds before a death his seat is read at: the death row and the
 *  control row handing him his camera share an instant. */
const SEAT_LOOKBACK = 1e-3;

const _q = new THREE.Quaternion();
const _euler = new THREE.Euler(0, 0, 0, 'YXZ');
const _minusZ = new THREE.Vector3(0, 0, -1);

/** Hide what the soldier's pose already draws: every mesh of the weapon glb
 *  that is not an emitter, a muzzle or a round's template (bot-rounds.js). */
function hideDrawnWeapon(root) {
  const keep = obj => {
    for (let n = obj; n && n !== root.parent; n = n.parent) {
      const d = n.userData ?? {};
      if (d.effect || d.muzzle || d.projectileMesh || d.projectileTrail || d.tracerMesh) return true;
    }
    return false;
  };
  root.traverse(obj => {
    if (obj.userData?.collision || /collision/i.test(obj.name || '') || (obj.isMesh && !keep(obj))) obj.visible = false;
  });
}

/**
 * The soldiers of one replay. `bodies` is a `createBotVisuals` instance built
 * over `shim` (map.html `makeReplayBodies`), so every read the renderer makes
 * of "the world" and "the bots" lands here.
 */
export class ReplaySoldiers {
  constructor(player) {
    this.player = player;
    const ctx = player.ctx;
    this.actors = new Map();      // pid -> actor
    this.drawn = [];              // the actors the renderer draws this frame
    this.soldiers = new Map();    // actor id -> the shim's soldier record
    this.hands = new Map();       // weapon template -> Promise<{ scene }|null>
    this.guns = new Map();        // actor id + weapon -> { root, groups }
    this.flights = new Map();     // soldier life -> recordedFlight(...) after his death
    // The bodies on foot lying now: soldier life -> { scene, pid }. Each is
    // drawn while the recording has that soldier object in scope and goes on
    // its recorded destroy (`lyingBodies`).
    this.lying = new Map();
    // Per soldier life, the seat he died in (`seatOfDeath`), once.
    this.deathSeats = new Map();
    const self = this;
    this.shim = {
      get bots() { return self.drawn; },
      world: {
        player: id => self.soldiers.get(id) ?? null,
        // A dead man still in the air is drawn by his body, not his corpse.
        armorOf: id => {
          const s = self.soldiers.get(id);
          return s ? { destroyed: s.dead && !s.falling, lastHit: null } : null;
        },
      },
      vehicles: {
        seatOf: id => self.seatOf(id),
        seated: new Map(),
      },
      presentAlpha: 1,
      soldierTemplateFor: ({ team } = {}) => (team === 1 ? 'JapaneseSoldier' : 'USMarineSoldier'),
      get camera() { return ctx.camera; },
      get scene() { return ctx.scene; },
      bust: () => ctx.bust(),
      get MODELS_BASE() { return ctx.modelsBase; },
    };
    this.bodies = ctx.makeReplayBodies ? ctx.makeReplayBodies(this.shim) : null;
    this.bodies?.ensureRoot?.();
    // The rocket packs' flames (`rocket-flame.js`), keyed by pid.
    this.flames = new RocketFlames(ctx.effects ?? null);
    this.snap = true;
    // From a `jump` to the next `reset`: the timeline is being dragged.
    this.dragging = false;
  }

  get available() { return Boolean(this.bodies); }

  /**
   * `pid`'s drawn pelvis, into `out`: his corpse while it lies, else his
   * living body (the death cam's first frame runs before this frame's death
   * is drawn, and the corpse is the same group); null when neither is drawn.
   * The page's own death cam looks at the drawn pelvis too (soldier-view.js
   * `corpseCentre`): a body falling back lies up to 3 m from his recorded
   * place.
   */
  pelvisOf(pid, out) {
    const id = `replay:${pid}`;
    const actor = this.actors.get(pid);
    const scene = this.bodies?.corpseOf?.(id)
      ?? (actor && !actor.state.dead ? this.bodies?.botVisuals?.get(id)?.group : null);
    if (!scene?.visible) return null;
    const pelvis = scene.getObjectByName('Bip01_Pelvis') ?? scene.getObjectByName('Bip01 Pelvis');
    return pelvis ? pelvis.getWorldPosition(out) : null;
  }

  /** The actor for `pid`, made on first sight at recording time `t`. */
  actorFor(pid, t) {
    let actor = this.actors.get(pid);
    if (actor) return actor;
    const { rec } = this.player;
    const info = { name: nameAt(rec, pid, t), team: teamAt(rec, pid, t) || null };
    const id = `replay:${pid}`;
    // The whole-body state a blast or a bail-out holds him in, as the
    // recording has it (`heldState`): `pair` is the recorded lower and upper
    // states, and `stowed` his weapon put away whatever they say; `kind`
    // whose they are.
    const held = {
      kind: null, pair: { lower: null, upper: null, stowed: false }, chuteOpen: false, airborne: false,
    };
    const soldier = {
      team: info?.team ?? 2,
      soldier: {
        x: 0, y: 0, z: 0, yaw: 0, stance: 'stand', body: { stateSpeed: 1 },
        // His swim state, as the page's own soldier carries it (swim.js
        // `SwimState`): read by the renderer's swim clips and its death.
        swim: { swimming: false, family: null },
        swimClips(dead = false) {
          if (dead) return this.swim.swimming ? SWIM_CLIPS.swimDie : null;
          return this.swim.family ? SWIM_CLIPS[this.swim.family] : null;
        },
        held,
        // A blast's states (knockback.js), which the renderer reads beside
        // the swim; and his chute, in the shape the page's own soldier
        // carries it (parachute.js `Parachute`: `open`, `clips`).
        explosionClips: () => (held.kind === 'explosion' ? held.pair : null),
        chute: {
          get open() { return held.kind === 'parachute' && held.chuteOpen; },
          clips: () => (held.kind === 'parachute' ? held.pair : null),
        },
      },
      dead: false,
      // Dead, and his body still in the air (`recordedFlight`).
      falling: false,
      // His corpse has been left (or his death walked past without one).
      down: false,
    };
    this.soldiers.set(id, soldier);
    actor = {
      playerId: id,
      pid,
      name: info?.name ?? `player ${pid}`,
      team: info?.team ?? 2,
      kit: null,
      kitPrimary: null,
      soldierTemplate: null,
      stance: 'stand',
      isFiring: false,
      vehicle: null,
      weaponAi: null,
      lifeNid: null,
      firingUntil: -Infinity,
      getPosition: () => [soldier.soldier.x, soldier.soldier.y, soldier.soldier.z],
      state: soldier,
    };
    this.actors.set(pid, actor);
    return actor;
  }

  /** The seat an actor rides in, in the shape `bot-visuals.js` asks of the
   *  page's vehicle registry: `{ seatId, rootId, seatInfo(id) }`. */
  seatOf(id) {
    const actor = [...this.actors.values()].find(a => a.playerId === id);
    const seat = actor?.seat;
    if (!seat) return null;
    const hull = seat.hull;
    const seatId = hull.seatIdAt(seat.index);
    if (!seatId) return null;
    return {
      seatId,
      rootId: hull.occupancy.rootId,
      seatInfo: sid => hull.occupancy.seatInfo(sid),
    };
  }

  /** Forget every drawn body and corpse: a seek. They rebuild from the
   *  recording as the frames need them. */
  reset() {
    this.snap = true;
    this.dragging = false;
    this.flames.clearAll();
    this.lying.clear();
    this.bodies?.disposeBotVisuals?.();
    for (const actor of this.actors.values()) {
      actor.lifeNid = null;
      this.forget(actor);
    }
  }

  /**
   * A seek while the timeline is dragged, one every step: the corpses go and
   * every man is placed afresh, but on the body he has, moved there. A man
   * in another life or holding another item keeps it until the drag lets go
   * (`bindLife`, `hold`), and nobody dies on the way, cry, fall and corpse
   * (`place`): the renderer hides the living body of a man the recording
   * has dead. Bodies built again at every step were most of a drag's frame;
   * the seek it ends on is a `reset`, which builds each as he is.
   */
  jump() {
    if (!this.bodies?.disposeCorpses) {
      this.reset();
      return;
    }
    this.snap = true;
    this.dragging = true;
    this.flames.clearAll();
    this.lying.clear();
    this.bodies.disposeCorpses();
    for (const actor of this.actors.values()) this.forget(actor);
  }

  /** What `place` works out again from the recording at a new instant. */
  forget(actor) {
    actor.state.dead = false;
    actor.state.falling = false;
    actor.state.down = false;
    actor.firingUntil = -Infinity;
    actor.seat = null;
    actor.reloading = false;
  }

  /** One frame at recording time `t`. Each man is placed on his own: one
   *  whose record throws is left out of this frame (the player's guard warns
   *  once), and everyone after him is still placed and drawn. */
  update(t, dt, hulls) {
    const { rec } = this.player;
    this.drawn.length = 0;
    const loadouts = this.player.ctx.loadouts?.() ?? null;
    if (loadouts && !this.warming) this.warming = this.warmKits(loadouts);
    const guard = this.player.guard ?? null;
    for (const pid of rec.playerNids?.keys() ?? []) {
      const nid = controlledAt(rec, pid, t);
      if (nid === null) continue;
      const actor = this.actorFor(pid, t);
      let drawn = false;
      const place = () => { drawn = this.place(actor, pid, nid, t, hulls, loadouts); };
      if (guard) guard.item(`player ${pid}'s soldier`, actor, place);
      else place();
      if (drawn) this.drawn.push(actor);
    }
    if (!this.bodies) return;
    for (const actor of this.drawn) {
      if (actor.state.dead && !actor.state.falling) continue;
      if (guard) guard.item(`player ${actor.pid}'s body`, actor, () => this.bodies.ensureBotVisual(actor));
      else this.bodies.ensureBotVisual(actor);
    }
    // Whoever the recording has nothing of this frame (out of the client's
    // range, spawning, gone) is not drawn at his last pose.
    const shown = new Set(this.drawn.map(a => a.playerId));
    for (const [id, vis] of this.bodies.botVisuals ?? []) {
      if (shown.has(id)) continue;
      vis.group.visible = false;
      if (vis.seat?.scene) vis.seat.scene.visible = false;
      if (vis.canopy?.scene) vis.canopy.scene.visible = false;
    }
    // The renderer blends between two tick poses; the replay hands it one a
    // frame, so the blend is always at its end. A seek snaps rather than
    // blending across the jump, and so does the first frame.
    this.bodies.captureBotPresentationTick?.(this.snap);
    this.snap = false;
    this.bodies.updateBotVisuals(dt);
    this.lyingBodies(t, hulls);
    this.updateFlames();
    for (const actor of this.drawn) {
      // Nobody steps in the air: a thrown man or a parachutist moves fast
      // with nothing under his boots.
      if (actor.vehicle || actor.state.dead || actor.state.soldier.held.airborne) continue;
      if (guard) guard.item(`player ${actor.pid}'s footsteps`, actor, () => this.player.ctx.footstepTick?.(actor, dt));
      else this.player.ctx.footstepTick?.(actor, dt);
    }
  }

  /**
   * Every item each soldier life of the file carries, in every kit it holds
   * (`life.kits`, `kitAt`), as `[soldier template, team, weapon]`, once per
   * pair, in the order the lives were created.
   */
  kitItems(loadouts) {
    const { rec } = this.player;
    const kits = loadouts?.kits ?? {};
    const byLower = new Map(Object.entries(kits).map(([name, entry]) => [name.toLowerCase(), entry]));
    const seen = new Set();
    const out = [];
    const lives = (rec.lives ?? []).filter(life => life.soldier)
      .sort((a, b) => (a.created ?? 0) - (b.created ?? 0));
    for (const life of lives) {
      const team = life.team || teamAt(rec, life.pid, life.created) || 2;
      const names = life.kits?.length ? life.kits.map(k => k.tmpl) : [life.kitTemplate];
      for (const name of names) {
        const entry = name ? (kits[name] ?? byLower.get(name.toLowerCase())) : null;
        for (const w of entry?.weapons ?? []) {
          if (!w?.weapon) continue;
          const key = `${life.tmpl ?? ''}|${team}|${w.weapon}`.toLowerCase();
          if (seen.has(key)) continue;
          seen.add(key);
          out.push([life.tmpl || null, team, w.weapon]);
        }
      }
    }
    return out;
  }

  /**
   * Load, once and in the background, the pose and gait pair of every item
   * in every replayed soldier's kits (`kitItems`), so a weapon change finds
   * its body in the cache. A change is drawn when the new item's body has
   * loaded (`hold`, bot-visuals.js `followHeld`), and the draw that goes with
   * it is a third of a second: on a cold load of 8t224pppqe the knife's body
   * at 27.00 arrived after the draw was over, so the knife came up with no
   * draw at all. Three at a time, so the first frames' own bodies are not
   * queued behind the whole round's. A pair that will not load is simply not
   * warmed; the swap asks for it again.
   */
  async warmKits(loadouts) {
    const warm = this.bodies?.warmHeld;
    // `&nowarm` leaves the cache cold, to check a late body against.
    const off = typeof location !== 'undefined' && /[?&]nowarm\b/.test(location.search ?? '');
    if (!warm || off) return 0;
    const queue = this.kitItems(loadouts);
    this.warmed = { total: queue.length, done: 0 };
    const worker = async () => {
      while (queue.length) {
        const [soldier, team, weapon] = queue.shift();
        try { await warm(soldier, team, weapon); } catch { /* a nicety */ }
        this.warmed.done++;
      }
    };
    await Promise.all([worker(), worker(), worker()]);
    return this.warmed.done;
  }

  /**
   * The bodies, as the server has them: a dead man's soldier object lies
   * until the server's DestroyObject for it (`timeToLiveAfterDeath`, 10 s,
   * DIE-9) and is drawn only while it is in this client's scope. A body
   * scoped out (a `d` row: ghost action 3 on the wire, the object disabled
   * in a bf42plus client's registry) is hidden and shown again when it comes
   * back (`o`); the replay drew it for its whole corpse clock (7 such
   * scope-outs in sidecar-2026-10-24-11-53-03). A respawn is a new soldier
   * object, so a man killed again inside his first body's 10 s has two
   * lying. A body never in scope is never drawn (1468 in
   * replay_20261007-064429 lay at his spawn point, where the replay had
   * him). A file with no scope rows at all (no `o`) keeps every body drawn,
   * and a body whose end is not recorded lies for the corpse clock. A server
   * recorder's `d` is the object gone from the world (`bodyEnd`). A dead man
   * a blast threw is his own body until it lands (`place`), and is hidden
   * out of scope too. A man killed in a seat stays in it, slumped, as the
   * seat's child (DIE-11), for as long as the server keeps his soldier
   * (`seatedEnd`, `bodyShown`).
   *
   * Every body that should lie at `t` is drawn, whatever the playback did to
   * get there: one whose death playback walked across is the renderer's own
   * (`place`, the death played), and any other -- after a seek, or a body
   * that first comes into scope after its man is back -- is laid already
   * down (`layCorpse`, the death held at its end) where the recording has it.
   */
  lyingBodies(t, hulls = null) {
    this.hasScope ??= this.player.rec.lives.some(l => l.replicated.length > 0);
    const inScope = life => !this.hasScope || isReplicated(life, t);
    for (const actor of this.drawn) {
      if (!actor.state.dead || !actor.state.falling || !actor.life || inScope(actor.life)) continue;
      const vis = this.bodies?.botVisuals?.get(actor.playerId);
      if (vis) vis.group.visible = false;
    }
    if (!this.dragging && this.bodies?.layCorpse) {
      for (const life of this.deadLives()) {
        if (life.diedAt > t) break;
        if (this.lying.has(life) || !this.bodyShown(life, t)) continue;
        this.layBody(life, t, hulls);
      }
    }
    for (const [life, body] of this.lying) {
      if (!body.scene.parent) { this.lying.delete(life); continue; }   // taken by a clock
      if (t >= this.bodyEndOf(life) || t < life.diedAt) {
        this.bodies?.disposeCorpse?.(body.scene);
        this.lying.delete(life);
        continue;
      }
      body.scene.visible = this.bodyShown(life, t);
    }
  }

  /** Every soldier life with a death, in the order they died (once). */
  deadLives() {
    this.deadList ??= this.player.rec.lives
      .filter(l => l.soldier && Number.isFinite(l.diedAt))
      .sort((a, b) => a.diedAt - b.diedAt);
    return this.deadList;
  }

  /**
   * The hull and seat `life`'s man died in, as `rootOf` gives one, or null
   * for a death on foot: what he controlled just before his death row (a
   * seat, or the hull itself).
   */
  seatOfDeath(life) {
    if (!this.deathSeats.has(life)) {
      const { rec } = this.player;
      const at = life.diedAt - SEAT_LOOKBACK;
      const nid = Number.isFinite(life.diedAt) ? controlledAt(rec, life.pid, at) : null;
      let root = nid !== null && nid !== life.nid ? rootOf(rec, nid, at, life.pid) : null;
      // Out again since he got in: an ExitVehicle with no control row after
      // it leaves the seat as what he controls (pid 205 got out of 9180 at
      // 27.995 and died on foot at 59.988 in sidecar-2026-10-24-11-53-03).
      // A seat switch is an exit and an enter on one instant: not out.
      // A v4 file's own seat rows are samples and can lag the exit (pid 10
      // out of his PanzerIV at 1281.453 and killed at 1281.523, its last
      // seat row at 1277.835, replay_20261007-064429).
      if (root) {
        const since = (rec.playerNids?.get(life.pid) ?? []).filter(c => c.t <= at).pop()?.t ?? -Infinity;
        if ((rec.exits ?? []).some(e => e.pid === life.pid && e.t > since && e.t <= at)) root = null;
      }
      this.deathSeats.set(life, root && !root.life.soldier && !root.life.camera ? root : null);
    }
    return this.deathSeats.get(life);
  }

  /**
   * When a body in a seat goes: its soldier's destroy, never past its hull's
   * (a hull that blew up with him took his soldier too: 654 was made again 4 s
   * after its man died in a Daihatsu that blew up, with no DestroyObject of
   * its own, sidecar-2026-10-24-14-21-07). A file with no destroys (a server
   * recorder's: a seat's child is never in it either) keeps the corpse clock,
   * and none when the hull's hit points were gone at his death.
   */
  seatedEnd(life) {
    const seat = this.seatOfDeath(life);
    // A server recorder's lives end when another object takes the id, not
    // on a DestroyObject: its file has none.
    const destroys = !/^server-replay-recorder/.test(this.player.rec.recorder ?? '');
    let end = destroys && life.destroyed !== Infinity ? life.destroyed : life.diedAt + corpseSeconds(null);
    if (!destroys && seat.life.hp.length && !(hpAt(seat.life, life.diedAt + 0.5) > 0)) end = life.diedAt;
    return Math.min(end, seat.life.destroyed);
  }

  /** When `life`'s body goes (`bodyEnd`, `seatedEnd`); the corpse clock from
   *  where it came to rest when the file has neither. */
  bodyEndOf(life) {
    if (this.seatOfDeath(life)) return this.seatedEnd(life);
    const end = bodyEnd(life);
    if (end !== Infinity) return end;
    return (this.flightOf(life)?.until ?? life.diedAt) + corpseSeconds(null);
  }

  /**
   * Whether `life`'s body is drawn at `t`: down (a thrown man is his own
   * body until he lands), not gone, and in scope. A body in a seat is in
   * scope as the sidecar's ghost scope has its soldier; a bf42plus client's
   * registry and a server recorder hold no seat's child, so there it is
   * drawn while its hull is (a child of a hull out of scope is disabled with
   * it: 5823's M3A1 left replay_20261007-064429's registry at 735.91 and its
   * gunner died in it at 743.25).
   */
  bodyShown(life, t) {
    if (t < life.diedAt || t >= this.bodyEndOf(life)) return false;
    const seat = this.seatOfDeath(life);
    if (seat) {
      if (this.player.rec.recorder === 'sidecar') return isReplicated(life, t);
      return !this.hasScope || isReplicated(seat.life, t);
    }
    const flight = this.flightOf(life);
    if (flight && t < flight.until) return false;
    if (this.hasScope && !isReplicated(life, t)) return false;
    return true;
  }

  /** Lay `life`'s body, already down, where the recording has it at `t`. */
  layBody(life, t, hulls) {
    const { rec } = this.player;
    const loadouts = this.player.ctx.loadouts?.() ?? null;
    const pid = life.pid;
    const team = life.team || teamAt(rec, pid, life.created) || 2;
    const spec = {
      name: `replay:${pid}`, team, soldierTemplate: life.tmpl || null, kit: kitAt(life, t),
      weapon: primaryWeaponFor(life, loadouts, t),
    };
    const seat = this.seatOfDeath(life);
    if (seat) {
      const hull = hulls?.get(seat.life);
      const seatId = hull?.seatIdAt?.(seat.seat);
      if (!seatId) return;   // the hull is not drawn: asked again next frame
      spec.seat = { seatInfo: hull.occupancy.seatInfo(seatId), rootId: hull.occupancy.rootId };
    } else {
      const pose = poseAt(life, settledTime(life, t));
      if (!pose || !pose.p.every(Number.isFinite) || !pose.q.every(Number.isFinite)) return;
      _q.set(pose.q[0], pose.q[1], pose.q[2], pose.q[3]).multiply(SOLDIER_YAW_FLIP);
      _euler.setFromQuaternion(_q, 'YXZ');
      Object.assign(spec, { x: pose.p[0], y: pose.p[1], z: pose.p[2], yaw: _euler.y });
      const flight = this.flightOf(life);
      spec.family = DIE_FAMILY.get(flight?.landing) ?? DIE_FAMILY.get(recordedDeath(rec, life.nid, life.diedAt));
      spec.stance = bodyAt(rec, life.nid, life.diedAt - SEAT_LOOKBACK)?.stance ?? 'stand';
    }
    const scene = this.bodies.layCorpse(spec);
    if (scene) this.lying.set(life, { scene, pid, seated: Boolean(seat) });
  }

  /** The bodies drawn this frame, by soldier netId (tests): those lying, on
   *  the ground or in a seat, and the dead still in the air. */
  debugBodies() {
    const out = [...this.lying].filter(([, b]) => b.scene.visible && b.scene.parent)
      .map(([life, b]) => ({ id: life.nid, pid: b.pid, died: life.diedAt, seated: b.seated }));
    for (const actor of this.drawn) {
      if (!actor.state.dead || !actor.state.falling || !actor.life) continue;
      if (this.bodies?.botVisuals?.get(actor.playerId)?.group?.visible) {
        out.push({ id: actor.life.nid, pid: actor.pid, died: actor.life.diedAt });
      }
    }
    return out;
  }

  /** Each drawn flier's pack on or off: the flame, on the pack's own node,
   *  while the replay says he is burning. A man not drawn, dead or off the
   *  pack puts his out. */
  updateFlames() {
    const seen = new Set();
    for (const actor of this.drawn) {
      const held = actor.state.soldier.held;
      if (!held?.rocket || actor.state.dead) continue;
      const group = this.bodies?.botVisuals?.get(actor.playerId)?.group;
      const node = group ? packNodeOf(group) : null;
      if (!node) continue;
      seen.add(actor.pid);
      this.flames.set(actor.pid, node, held.burning);
      // The pack's report (patch 0 of its script) as a burn starts, from the
      // pack his kit row names.
      if (held.burning && !actor.rocketBurning && this.player.playing && !this.dragging) {
        const template = this.player.ctx.loadouts?.()?.kits?.[actor.kit]?.activeParts?.[0]?.template;
        const s = actor.state.soldier;
        if (template) this.player.ctx.playWorldShot?.(template, s.x, s.y + 1.2, s.z, actor);
      }
      actor.rocketBurning = held.burning;
    }
    for (const pid of [...this.flames.flames.keys()]) {
      if (!seen.has(pid)) {
        this.flames.clear(pid);
        const actor = this.actors.get(pid);
        if (actor) actor.rocketBurning = false;
      }
    }
  }

  /** `actor`, the soldier of `pid` who controls `nid`, placed at `t`: true
   *  when he is drawn this frame. */
  place(actor, pid, nid, t, hulls, loadouts) {
    const { rec } = this.player;
    const life = this.soldierLife(pid, nid, t);
    if (!life) {
      // Nothing of him to draw: spawning, or his body is gone.
      actor.lifeNid = null;
      actor.life = null;
      return false;
    }
    this.bindLife(actor, life, loadouts, t);
    actor.life = life;
    const replicated = life.replicated.some(([from, to]) => t >= from && t < to);
    const dead = life.diedAt !== undefined && t >= life.diedAt;
    // Where he is: his soldier's recorded pose, or his seat's hull.
    const root = rootOf(rec, nid, t, pid);
    const seated = root && !root.life.soldier && !root.life.camera ? root : null;
    actor.vehicle = seated && !dead ? seated.life.tmpl : null;
    actor.seat = seated && !dead ? { hull: hulls.get(seated.life), index: seated.seat } : null;
    if (actor.seat && !actor.seat.hull) actor.seat = null;
    if (!replicated && !seated && !dead) return false;
    // Just out of a vehicle, his first samples are where he got in: he is
    // drawn where the recording next has him (replay-recording.js
    // `settledTime`), not streaked across the level to it.
    const pose = poseAt(life, settledTime(life, t));
    // A pose that is not all numbers draws nothing, and the renderer and
    // the name tags read him from it.
    if (!pose || !pose.p.every(Number.isFinite) || !pose.q.every(Number.isFinite)) return false;
    const s = actor.state.soldier;
    s.x = pose.p[0]; s.y = pose.p[1]; s.z = pose.p[2];
    _q.set(pose.q[0], pose.q[1], pose.q[2], pose.q[3]).multiply(SOLDIER_YAW_FLIP);
    _euler.setFromQuaternion(_q, 'YXZ');
    s.yaw = _euler.y;
    // A v4 recording carries his body's own animation states: the stance
    // is the lower state's flags, the fire the upper state, and the item
    // in his hands the one the server says he holds.
    const body = bodyAt(rec, life.nid, t);
    actor.stance = body?.stance ?? 'stand';
    s.stance = actor.stance;
    // The engine's own lower and upper states, which the renderer plays the
    // gait and the stance changes from where it can name them
    // (`remote-gait.js` `recordedGait`, `recordedStanceEntry`) rather than
    // guess them from the drawn speed and the stance flag.
    actor.recordedLower = body?.lower ?? null;
    actor.recordedUpper = body?.upper ?? null;
    // How long he has been in each, so a body that loads after a state began
    // (the knife's body, after its 0.33 s draw has started) goes in where the
    // recording stands rather than from the top or not at all.
    const since = body ? stateEntries(rec, life.nid, t) : null;
    actor.recordedLowerAt = since ? Math.max(0, t - since.lower) : 0;
    actor.recordedUpperAt = since ? Math.max(0, t - since.upper) : 0;
    // A weapon change while the timeline is dragged waits for the drag to
    // let go, as a new life does (`bindLife`, `jump`).
    actor.swapDeferred = this.dragging;
    this.swimState(s, body, life, t, dead || Boolean(seated));
    // A dead man a blast threw, or one riding his canopy down, is still in
    // the air: his body keeps flying as the recording has it, and his
    // corpse is left where it comes to rest.
    const flight = dead ? this.flightOf(life) : null;
    const falling = Boolean(flight) && t < flight.until;
    actor.state.falling = falling;
    this.heldState(s, body, bodyAt(rec, life.nid, t + FLIGHT_LEAD), (dead && !falling) || Boolean(seated), dead);
    // Burning, from the heights of his own samples (`replayBurning`): the
    // recording carries no trigger and no heat, and the flame and the burst's
    // report are what a replay can show of them.
    if (s.held.rocket && !dead) {
      const before = poseAt(life, t - 0.1);
      const now = poseAt(life, t);
      const after = poseAt(life, t + 0.1);
      s.held.burning = Boolean(before && now && after
        && replayBurning(before.p[1], now.p[1], after.p[1], 0.1));
    }
    actor.isFiring = t < actor.firingUntil || Boolean(body?.firing);
    if (body?.item) this.hold(actor, body.item, loadouts);
    // A weapon with no round to record (an engineer's wrench, a medic's
    // pack) fires by the recorded torso state alone. The engine enters its
    // one-shot fire state again on every round while the trigger is down,
    // and the recorder only writes a change, so a fire the torso has
    // finished starts over for as long as the recording still says fire.
    if (body?.firing && !dead && !this.recordsRounds(actor.weaponAi?.name)) {
      this.bodies?.botFireHeld?.(actor);
    }
    // A stab is the torso's alternate-fire state: the recording writes a
    // state when it changes, so one entry is one thrust.
    const stabbing = Boolean(body?.stabbing) && !dead;
    if (stabbing && actor.stabState !== body.upper) this.bodies?.botStabbed?.(actor);
    actor.stabState = stabbing ? body.upper : null;
    // A reload is the torso's reload state and nothing else: no round
    // says when a magazine went in, so none played until now.
    const reloading = Boolean(body?.reloading) && !dead;
    if (reloading && !actor.reloading) this.bodies?.botReloaded?.(actor);
    actor.reloading = reloading;
    // A blow he lives through: his grunt, and his torso's flinch.
    this.hurt(actor, life, body, t, dead, Boolean(seated));
    // His death, when playback walks across it: his cry at the blow, and
    // the renderer's death and body where he comes to rest -- where he
    // fell, or where a flight after his death landed him.
    // The seat he died in, if he died in one: his body stays there (DIE-11).
    const deathSeat = dead ? this.seatOfDeath(life) : null;
    if (dead && !actor.state.dead) {
      actor.state.dead = true;
      if (this.player.playing && !this.dragging && t - life.diedAt < 0.5) {
        this.player.ctx.playSoldierDeathSound?.({ x: s.x, y: s.y + 1.2, z: s.z }, actor.team);
        // His side's death tier (`soldier-armor-effects.js`: Desert Combat's
        // dropped helmet), at his feet and with the speed he died at. A
        // client effect, so the recording never carries it.
        if (!seated && !deathSeat) {
          const v = motionAt(life, life.diedAt)?.velocity;
          this.player.ctx.playSoldierDeathEffects?.({ x: s.x, y: s.y, z: s.z, yaw: s.yaw }, actor.team,
            v ? { x: v[0], y: v[1], z: v[2] } : null);
        }
      }
    }
    if (dead && !falling && !actor.state.down) {
      actor.state.down = true;
      const rest = flight ? flight.until : life.diedAt;
      // Or a body that first comes into this client's scope lying: a man
      // killed out of it, whose body the server then scopes in
      // (replay_20261024-161456: 3517 died at 1364.31, in scope at 1366.59).
      const arrived = isReplicated(life, rest) ? undefined
        : life.replicated.find(([from]) => from > rest)?.[0];
      const fresh = t - rest < 0.5 || (arrived !== undefined && t - arrived < 0.5);
      if (this.player.playing && !this.dragging && fresh && t < this.bodyEndOf(life)) {
        // The death the engine chose, where the recording has his body's
        // die state or the state a flight landed him in; the renderer's
        // own choice otherwise, and in a seat (`Ub_DieInVehicle`, the seat
        // body he was drawn in slumping where it sits).
        const family = deathSeat ? undefined
          : DIE_FAMILY.get(flight?.landing) ?? DIE_FAMILY.get(recordedDeath(rec, life.nid, life.diedAt));
        // Every body lies until `lyingBodies` takes it away: its destroy, or
        // the corpse clock where the file has none (`bodyEndOf`).
        // A body with no rig loaded yet leaves none, and `corpseOf` then
        // still names his last life's: `lyingBodies` lays that one down.
        const before = this.bodies?.corpseOf?.(actor.playerId) ?? null;
        this.bodies?.killBot?.(actor, { seated: Boolean(deathSeat), family, ttl: Infinity });
        const scene = this.bodies?.corpseOf?.(actor.playerId);
        if (scene && scene !== before) this.lying.set(life, { scene, pid, seated: Boolean(deathSeat) });
      }
    }
    if (!dead) {
      actor.state.dead = false;
      actor.state.down = false;
    }
    return true;
  }

  /**
   * The whole-body state a blast or a bail-out holds him in at `t`, onto the
   * stand-in soldier: the recorded lower and upper states while the lower is
   * one of the explosion states (`knockback.js`) or the parachute's
   * (`parachute.js`), and the chute's own state bit. The renderer holds his
   * legs in the lower one by name, as it holds a swimmer's
   * (`SoldierActions.followHeld`). A flight is taken from `ahead`, the body
   * a sample on, while the record has not reached it (`FLIGHT_LEAD`). A dead
   * man still in the air holds no weapon, whatever the state says
   * (`Lb_ParachuteDie` declares no `c_AsmHideWeapon`): his kit has dropped,
   * and every corpse is drawn without it (`killBot`). Nothing while he rides
   * a seat or lies dead, and nothing in a file without body states (v3).
   */
  heldState(soldier, body, ahead, out, dead = false) {
    const held = soldier.held;
    held.kind = null;
    held.pair.lower = null;
    held.pair.upper = null;
    held.pair.stowed = Boolean(dead);
    held.chuteOpen = false;
    held.airborne = false;
    held.rocket = false;
    held.burning = false;
    if (out) return;
    const now = !explosionFamily(body?.lower) && EXPLOSION_AIRBORNE.has(ahead?.lower) ? ahead : body;
    const lower = now?.lower;
    if (!lower) return;
    const rocketeering = ROCKETEERING_LOWER.has(lower);
    const kind = explosionFamily(lower) ? 'explosion'
      : PARACHUTE_LOWER.has(lower) || rocketeering ? 'parachute' : null;
    if (!kind) return;
    held.kind = kind;
    // A flier on the rocket pack is in the parachute's glide clip under the
    // pack's own state name (`rocket-pack.js` `ROCKETEERING_ALIAS`), with no
    // canopy: the state's bit 0x10 (`setIsParachuting`) is not set.
    held.pair.lower = rocketeeringClip(lower);
    held.pair.upper = now.upper ? rocketeeringClip(now.upper) : now.upper;
    held.chuteOpen = kind === 'parachute' && !rocketeering && Boolean(now.chuteOpen);
    held.airborne = EXPLOSION_AIRBORNE.has(lower) || PARACHUTE_AIRBORNE.has(lower)
      || ROCKETEERING_AIRBORNE.has(lower);
    held.rocket = rocketeering;
  }

  /**
   * The blow playback has just walked across, if he lived through it
   * (`HURT_MIN`): his hurt grunt at his head, in his side's tongue, and the
   * torso's hit state on his drawn body (`botHit`). Each hit point entry is
   * taken once, as playback crosses it; a seek or a drag across one, a new
   * life, or a frame long after it plays nothing.
   */
  hurt(actor, life, body, t, dead, seated) {
    const i = latestIndex(life.hp, t);
    const seen = actor.hpSeen ??= { life: null, i: -1 };
    const was = seen.life === life ? seen.i : null;
    seen.life = life;
    seen.i = i;
    if (was === null || i <= was || dead) return;
    if (!this.player.playing || this.dragging) return;
    let drop = null;
    for (let k = Math.max(was + 1, 1); k <= i; k++) {
      const before = life.hp[k - 1].hp;
      const after = life.hp[k].hp;
      if (before - after > HURT_MIN && after > 0) drop = life.hp[k];
    }
    if (!drop || t - drop.t > HURT_FRESH) return;
    const s = actor.state.soldier;
    this.player.ctx.playSoldierHurtSound?.({ x: s.x, y: s.y + 1.2, z: s.z }, actor.team);
    if (seated) return;
    // His own view shakes (`CstHitShake`), drawn when he is the one followed
    // in first person (replay-camera.js `hurt`). In a seat the seat's own
    // trigger takes the machine every frame (`Camera::getTransformation`).
    this.player.camera?.hurt?.(actor.pid);
    let name = null;
    if (body) {
      const later = bodyAt(this.player.rec, life.nid, drop.t + HURT_STATE_LEAD);
      name = [body.upper, later?.upper].find(u => u && HIT_STATE.test(u)) ?? null;
    } else {
      name = STANCE_HIT[actor.stance] ?? STANCE_HIT.stand;
    }
    if (name) this.bodies?.botHit?.(actor, name);
  }

  /** Where `life`'s body went through the air after his death, once per
   *  life (`recordedFlight`), or null. */
  flightOf(life) {
    if (!this.flights.has(life)) {
      this.flights.set(life, recordedFlight(this.player.rec, life.nid, life.diedAt));
    }
    return this.flights.get(life);
  }

  /**
   * His swim state at `t`, onto the stand-in soldier: whether he swims and the
   * family of `SWIM_CLIPS` his body plays. A v4 file records it, the lower
   * state his body entered. A file without body states has the engine's own
   * test (`BFSoldier::updateSwimming`, swim.js) on his origin, a metre over the
   * feet he is drawn at: swimming while it is more than the leave depth under
   * the water, where a swimmer's is pinned 0.4 m under the surface; forward or
   * back as he moved along his heading, afloat when he did not.
   */
  swimState(soldier, body, life, t, out) {
    const swim = soldier.swim;
    swim.swimming = false;
    swim.family = null;
    if (out) return;
    if (body) {
      if (body.swimming) swim.family = SWIM_FAMILY.get(body.lower) ?? 'swimFloat';
    } else {
      const water = this.player.ctx.waterLevel?.();
      if (!Number.isFinite(water) || water - (soldier.y + CHARACTER_HEIGHT) <= SWIM_LEAVE_DEPTH) return;
      const v = motionAt(life, t)?.velocity ?? [0, 0, 0];
      const along = v[0] * Math.sin(soldier.yaw) + v[2] * Math.cos(soldier.yaw);
      swim.family = along > SWIM_STROKE ? 'swimForward' : along < -SWIM_STROKE ? 'swimBackward' : 'swimFloat';
    }
    swim.swimming = Boolean(swim.family);
  }

  /** The soldier life `pid` stands in at `t`: the one he controls, or the one
   *  he last controlled while he rides a seat or lies dead. */
  soldierLife(pid, nid, t) {
    const { rec } = this.player;
    const own = lifeAt(rec, nid, t);
    if (own?.soldier) return own;
    let best = null;
    for (const life of soldierLivesOf(rec, pid)) {
      if (life.created > t || t >= life.destroyed) continue;
      if (!best || life.created > best.created) best = life;
    }
    return best;
  }

  /**
   * A new soldier life for the actor: his uniform and kit, and a fresh body
   * for them.
   *
   * Whatever body he has is the last life's. The one he died in went to the
   * corpse list, and `killBot` built him another straight away, in the kit he
   * died with; so did a stretch with nothing of him to draw, which leaves no
   * life bound at all. Kept, it carried the old kit's weapon into the new
   * life: at 112.9 s of replay_20260927-140921 a medic killed with his Mp18,
   * drawn with the bazooka of the AT kit he had died in, until a seek built
   * him afresh.
   */
  bindLife(actor, life, loadouts, t) {
    if (actor.lifeNid === life.nid) {
      this.bindKit(actor, life, loadouts, t);
      return;
    }
    actor.lifeNid = life.nid;
    actor.kit = kitAt(life, t);
    actor.kitPrimary = primaryWeaponFor(life, loadouts, t);
    actor.soldierTemplate = life.tmpl || null;
    actor.weaponAi = actor.kitPrimary ? { name: actor.kitPrimary } : null;
    actor.state.dead = false;
    // A new life has not lain down yet: a man this client never saw alive
    // (spawned and killed out of its scope) kept the last life's `down` and
    // his body was never laid (3517 in replay_20261024-161456).
    actor.state.down = false;
    actor.state.falling = false;
    // A pid passes to the next player to join once its own leaves, and a
    // player can change sides between lives: the name tag, his death cry
    // and his uniform follow the life's own player and side.
    const { rec } = this.player;
    actor.name = nameAt(rec, actor.pid, life.created);
    actor.team = life.team || teamAt(rec, actor.pid, life.created) || actor.team;
    actor.state.team = actor.team;
    actor.heldItem = null;
    actor.heldWeapon = undefined;
    actor.reloading = false;
    // Built afresh when the drag lets go (`jump`).
    if (!this.dragging) this.bodies?.disposeBotVisual?.(actor.playerId);
  }

  /**
   * The kit he carries at `t` within one life: a kit taken off the ground
   * swaps every item, so his body is rebuilt holding the new kit's weapon and
   * wearing its parts, forward or backward across the pickup (a seek). The
   * swap goes the way a weapon change does (`hold`, bot-visuals.js
   * `followHeld`): the body he has stays drawn until the new one is built.
   */
  bindKit(actor, life, loadouts, t) {
    const kit = kitAt(life, t);
    if (kit === actor.kit) return;
    actor.kit = kit;
    actor.kitPrimary = primaryWeaponFor(life, loadouts, t);
    actor.weaponAi = actor.kitPrimary ? { name: actor.kitPrimary } : null;
    actor.heldItem = null;
    actor.heldWeapon = actor.kitPrimary ?? undefined;
  }

  /**
   * Whether the recording writes this weapon's rounds (`f`, v4 on): every
   * weapon that launches something does, whoever fires it. The wrench, the
   * medic's pack and the plunger launch nothing, so their fire is only ever
   * the soldier's recorded torso state.
   */
  recordsRounds(weapon) {
    if (!weapon) return true;
    this.roundWeapons ??= new Set(this.player.rec.fires
      .filter(f => !f.press && f.weapon).map(f => f.weapon.toLowerCase()));
    return this.roundWeapons.has(weapon.toLowerCase());
  }

  /**
   * The item a v4 recording says he holds (the kit's 1-based `itemIndex`,
   * `loadouts.json` `weapons[].slot`): a pistol, a grenade, the knife. His
   * body is rebuilt holding it -- the pose pair is per weapon -- and only when
   * it changes.
   *
   * Rebuilt the way a bot's is when it changes weapon (`bot-visuals.js`
   * `followHeld`, through `heldWeapon`): the body he has stays drawn until the
   * one holding the new item has loaded, and that one goes on from the old
   * one's pose and states (`rig.adopt`). His body used to be thrown away on
   * the spot and built from nothing: on 8t224pppqe (berlin, pid 1 "BF6") he
   * draws his knife in mid-jump at 27.00, and the page drew no body at all
   * until 27.30 -- however long the knife's pose took to fetch -- then a new
   * one on `stand.lower` / `stand.upper` from the skeleton's rest pose, with
   * its speed estimate back at 0: a man standing in the air, flashing in
   * between, then walking, then running at 27.46 as the estimate caught up.
   * The recording says `Lb_RunJump` throughout, under
   * `Ub_StandRaiseWeaponKnifeAxis` (the draw) and then the stab.
   */
  hold(actor, item, loadouts) {
    if (actor.heldItem === item) return;
    actor.heldItem = item;
    const kit = actor.kit ? (loadouts?.kits?.[actor.kit] ?? Object.entries(loadouts?.kits ?? {})
      .find(([name]) => name.toLowerCase() === actor.kit.toLowerCase())?.[1]) : null;
    const weapon = kit?.weapons?.find(w => w.slot === item)?.weapon ?? null;
    if (!weapon || weapon === actor.kitPrimary) return;
    actor.kitPrimary = weapon;
    actor.weaponAi = { name: weapon };
    actor.heldWeapon = weapon;
  }

  /**
   * A recorded shot from `pid`'s hand weapon: the torso's fire, the flash and
   * the round from his weapon's own FireArms, and the report at the shooter.
   * `f` is the recording's shot: `pos` and `dir` in BF1942's frame.
   */
  fire(pid, f, t) {
    const actor = this.actors.get(pid);
    if (!actor || actor.state.dead) return;
    // A v4 shot names the weapon; v3's names the soldier it came from, and
    // then the weapon is the one in his hands, his kit's primary.
    const weapon = f.weapon && !/soldier/i.test(f.weapon) ? f.weapon : actor.kitPrimary;
    // A stab's round (its own FireArms, `fireDelay` after the press) comes
    // while his torso is in the alternate fire's state, whose thrust is
    // already playing (`botStabbed`): the rifle's fire would cut it off.
    if (!actor.stabState) {
      actor.firingUntil = t + TRIGGER_HOLD;
      this.bodies?.botFired?.(actor);
    }
    const s = actor.state.soldier;
    this.player.ctx.playWorldShot?.(weapon, s.x, s.y + 1.4, s.z, actor);
    // Watched through his eyes, the round leaves his eye and flashes at the
    // weapon in his hands (replay-viewmodel.js), not at his hidden body's.
    if (this.player.viewmodel?.fire(pid, weapon, f)) return;
    this.flash(actor, weapon, f);
  }

  /** The weapon glb's FireArms and its weapon block (magazine, deviation,
   *  crosshair, HUD art: the extras arms-rig.js reads as `hw.data`), once per
   *  template: `{ scene, data }` or null. */
  handGun(weapon) {
    if (!this.hands.has(weapon)) {
      const ctx = this.player.ctx;
      // The mod's tree, then vanilla's: a mod's hand weapons are mostly vanilla's.
      this.hands.set(weapon, loadFirst(ctx.loader, weaponUrls(ctx.modelsBase, weapon, ctx.bust()))
        .then(gltf => {
          ctx.shadeModel?.(gltf.scene);
          const data = gltf.userData?.weapon ?? gltf.parser?.json?.extras?.weapon ?? gltf.scene?.userData?.weapon ?? null;
          return { scene: gltf.scene, data };
        })
        .catch(() => null));
    }
    return this.hands.get(weapon);
  }

  /** Fire `weapon`'s round from where the actor's drawn weapon is, down the
   *  recorded direction: the weapon glb's own flash, casing and round, laid on
   *  the drawn weapon exactly as `bot-rounds.js` lays a bot's. */
  async flash(actor, weapon, f) {
    const guns = this.player.ctx.guns;
    if (!guns || !weapon) return;
    const key = `${actor.playerId}|${weapon}`;
    let held = this.guns.get(key);
    if (!held) {
      const hand = await this.handGun(weapon);
      if (!hand) return;
      held = this.guns.get(key);
      if (!held) {
        const root = skeletonClone(hand.scene);
        root.name = `replay round ${actor.playerId} ${weapon}`;
        hideDrawnWeapon(root);
        // The level's paint (`level-skin.js`, ledger LOAD-3), on the
        // materials every clone of the weapon shares.
        void wearPagePaint(root);
        this.player.root.add(root);
        const ray = { origin: new THREE.Vector3(), dir: new THREE.Vector3(0, 0, -1) };
        const groups = guns.collect(root, {
          replace: false, speedScale: 1, maxRange: 1200, roundLifetime: 'data', aimRay: () => ray,
        });
        for (const group of groups) {
          group.replay = true;
          group.firer = actor.playerId;
          group.weapon = weapon;
          group.view = 'third';
        }
        held = { root, groups, ray };
        this.guns.set(key, held);
      }
    }
    const group = held.groups.find(g => (g.stats?.input || 'c_PIFire') === 'c_PIFire') ?? held.groups[0];
    // A grenade, mine or pack is the recording's own object (replay-props.js):
    // one the page threw as well would lie for its whole authored fuse.
    if (!group || roundIsRecorded(group, this.player.networkedRounds)) return;
    const s = actor.state.soldier;
    const vis = this.bodies?.botVisuals?.get(actor.playerId);
    const node = vis?.group?.visible ? vis.rig?.weaponNode ?? null : null;
    if (Array.isArray(f.dir) && Math.hypot(f.dir[0], f.dir[1], f.dir[2]) > 0.1) {
      held.ray.dir.set(f.dir[0], f.dir[1], -f.dir[2]).normalize();
    } else {
      held.ray.dir.set(-Math.sin(s.yaw), 0, -Math.cos(s.yaw));
    }
    if (node) {
      node.updateWorldMatrix(true, false);
      node.matrixWorld.decompose(held.root.position, held.root.quaternion, held.root.scale);
      held.ray.origin.copy(held.root.position);
    } else {
      held.ray.origin.set(s.x, s.y + 1.4, s.z);
      held.root.position.copy(held.ray.origin);
      held.root.quaternion.setFromUnitVectors(_minusZ, held.ray.dir);
      held.root.scale.set(1, 1, 1);
    }
    // The round leaves where the server fired it when the row says (a
    // sidecar's or a v4 recorder's `p`: the eye, ledger XHIT-18), the flash
    // staying on the drawn weapon; a v3 press's `pos` is his origin, not a
    // launch point, and a row without one keeps the weapon's.
    if (!f.press && Array.isArray(f.pos) && f.pos.length >= 3 && f.pos.every(Number.isFinite)) {
      held.ray.origin.set(f.pos[0], f.pos[1], -f.pos[2]);
    }
    held.root.updateMatrixWorld(true);
    syncReplayCollision(this.player);
    guns.fireShot(group);
  }

  dispose() {
    this.bodies?.disposeBotVisuals?.();
    const guns = this.player.ctx.guns;
    for (const held of this.guns.values()) {
      for (const group of held.groups) guns?.release(group);
      held.root.parent?.remove(held.root);
    }
    this.guns.clear();
    this.drawn.length = 0;
  }
}
