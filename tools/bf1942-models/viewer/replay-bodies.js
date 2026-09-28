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
  bodyAt, controlledAt, lifeAt, nameAt, primaryWeaponFor, recordedDeath, recordedFlight, rootOf, teamAt,
} from './replay-recording.js';
import { motionAt, poseAt } from './replay-kinematics.js';
import { syncReplayCollision } from './replay-gunfire.js';
import { roundIsRecorded } from './replay-props.js';
import { DIE_CLIPS } from './soldier-death.js';
import { SWIM_CLIPS, SWIM_LEAVE_DEPTH } from './swim.js';
import { CHARACTER_HEIGHT } from './soldier-pose.js';
import { PARA_CLIPS } from './parachute.js';
import { EXPLOSION_AIRBORNE, PARACHUTE_AIRBORNE, explosionDeath, explosionFamily } from './knockback.js';

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
    this.snap = true;
  }

  get available() { return Boolean(this.bodies); }

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
    this.bodies?.disposeBotVisuals?.();
    for (const actor of this.actors.values()) {
      actor.lifeNid = null;
      actor.state.dead = false;
      actor.state.falling = false;
      actor.state.down = false;
      actor.firingUntil = -Infinity;
      actor.seat = null;
      actor.reloading = false;
    }
  }

  /** One frame at recording time `t`. */
  update(t, dt, hulls) {
    const { rec } = this.player;
    this.drawn.length = 0;
    const loadouts = this.player.ctx.loadouts?.() ?? null;
    for (const pid of rec.playerNids?.keys() ?? []) {
      const nid = controlledAt(rec, pid, t);
      if (nid === null) continue;
      const actor = this.actorFor(pid, t);
      const life = this.soldierLife(pid, nid, t);
      if (!life) {
        // Nothing of him to draw: spawning, or his body is gone.
        actor.lifeNid = null;
        continue;
      }
      this.bindLife(actor, life, loadouts);
      const replicated = life.replicated.some(([from, to]) => t >= from && t < to);
      const dead = life.diedAt !== undefined && t >= life.diedAt;
      // Where he is: his soldier's recorded pose, or his seat's hull.
      const root = rootOf(rec, nid, t, pid);
      const seated = root && !root.life.soldier && !root.life.camera ? root : null;
      actor.vehicle = seated && !dead ? seated.life.tmpl : null;
      actor.seat = seated && !dead ? { hull: hulls.get(seated.life), index: seated.seat } : null;
      if (actor.seat && !actor.seat.hull) actor.seat = null;
      if (!replicated && !seated && !dead) continue;
      const pose = poseAt(life, t);
      if (!pose) continue;
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
      this.swimState(s, body, life, t, dead || Boolean(seated));
      // A dead man a blast threw, or one riding his canopy down, is still in
      // the air: his body keeps flying as the recording has it, and his
      // corpse is left where it comes to rest.
      const flight = dead ? this.flightOf(life) : null;
      const falling = Boolean(flight) && t < flight.until;
      actor.state.falling = falling;
      this.heldState(s, body, bodyAt(rec, life.nid, t + FLIGHT_LEAD), (dead && !falling) || Boolean(seated), dead);
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
      // A reload is the torso's reload state and nothing else: no round
      // says when a magazine went in, so none played until now.
      const reloading = Boolean(body?.reloading) && !dead;
      if (reloading && !actor.reloading) this.bodies?.botReloaded?.(actor);
      actor.reloading = reloading;
      // His death, when playback walks across it: his cry at the blow, and
      // the renderer's death and body where he comes to rest -- where he
      // fell, or where a flight after his death landed him.
      if (dead && !actor.state.dead) {
        actor.state.dead = true;
        if (this.player.playing && t - life.diedAt < 0.5) {
          this.player.ctx.playSoldierDeathSound?.({ x: s.x, y: s.y + 1.2, z: s.z }, actor.team);
        }
      }
      if (dead && !falling && !actor.state.down) {
        actor.state.down = true;
        const rest = flight ? flight.until : life.diedAt;
        if (this.player.playing && t - rest < 0.5) {
          // The death the engine chose, where the recording has his body's
          // die state or the state a flight landed him in; the renderer's
          // own choice otherwise, and in a seat.
          const family = seated ? undefined
            : DIE_FAMILY.get(flight?.landing) ?? DIE_FAMILY.get(recordedDeath(rec, life.nid, life.diedAt));
          this.bodies?.killBot?.(actor, { seated: Boolean(seated), family });
        }
      }
      if (!dead) {
        actor.state.dead = false;
        actor.state.down = false;
      }
      this.drawn.push(actor);
    }
    if (!this.bodies) return;
    for (const actor of this.drawn) {
      if (!actor.state.dead || actor.state.falling) this.bodies.ensureBotVisual(actor);
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
    for (const actor of this.drawn) {
      // Nobody steps in the air: a thrown man or a parachutist moves fast
      // with nothing under his boots.
      if (!actor.vehicle && !actor.state.dead && !actor.state.soldier.held.airborne) {
        this.player.ctx.footstepTick?.(actor, dt);
      }
    }
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
    if (out) return;
    const now = !explosionFamily(body?.lower) && EXPLOSION_AIRBORNE.has(ahead?.lower) ? ahead : body;
    const lower = now?.lower;
    if (!lower) return;
    const kind = explosionFamily(lower) ? 'explosion' : PARACHUTE_LOWER.has(lower) ? 'parachute' : null;
    if (!kind) return;
    held.kind = kind;
    held.pair.lower = lower;
    held.pair.upper = now.upper;
    held.chuteOpen = kind === 'parachute' && Boolean(now.chuteOpen);
    held.airborne = EXPLOSION_AIRBORNE.has(lower) || PARACHUTE_AIRBORNE.has(lower);
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
    for (const life of rec.lives) {
      if (!life.soldier || life.pid !== pid || life.created > t || t >= life.destroyed) continue;
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
  bindLife(actor, life, loadouts) {
    if (actor.lifeNid === life.nid) return;
    actor.lifeNid = life.nid;
    actor.kit = life.kitTemplate ?? null;
    actor.kitPrimary = primaryWeaponFor(life, loadouts);
    actor.soldierTemplate = life.tmpl || null;
    actor.weaponAi = actor.kitPrimary ? { name: actor.kitPrimary } : null;
    actor.state.dead = false;
    // A pid passes to the next player to join once its own leaves, and a
    // player can change sides between lives: the name tag, his death cry
    // and his uniform follow the life's own player and side.
    const { rec } = this.player;
    actor.name = nameAt(rec, actor.pid, life.created);
    actor.team = life.team || teamAt(rec, actor.pid, life.created) || actor.team;
    actor.state.team = actor.team;
    actor.heldItem = null;
    actor.reloading = false;
    this.bodies?.disposeBotVisual?.(actor.playerId);
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
    this.bodies?.disposeBotVisual?.(actor.playerId);
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
    actor.firingUntil = t + TRIGGER_HOLD;
    this.bodies?.botFired?.(actor);
    const s = actor.state.soldier;
    this.player.ctx.playWorldShot?.(weapon, s.x, s.y + 1.4, s.z);
    this.flash(actor, weapon, f);
  }

  /** The weapon glb's FireArms, once per template: `{ scene }` or null. */
  handGun(weapon) {
    if (!this.hands.has(weapon)) {
      const ctx = this.player.ctx;
      this.hands.set(weapon, ctx.loader.loadAsync(`${ctx.modelsBase}/${weapon}.glb${ctx.bust()}`)
        .then(gltf => {
          ctx.shadeModel?.(gltf.scene);
          return { scene: gltf.scene };
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
