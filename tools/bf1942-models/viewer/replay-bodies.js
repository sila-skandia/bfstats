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
import { bodyAt, controlledAt, lifeAt, primaryWeaponFor, recordedDeath, rootOf } from './replay-recording.js';
import { poseAt } from './replay-kinematics.js';
import { syncReplayCollision } from './replay-gunfire.js';
import { DIE_CLIPS } from './soldier-death.js';
import { SWIM_CLIPS } from './swim.js';

/** The pose glb's root carries a baked half turn a vehicle's does not
 *  (README §12, measured 180.00 degrees off at two spawn instants); the
 *  renderer's own yaw convention is the pose glb's. */
const SOLDIER_YAW_FLIP = new THREE.Quaternion(0, 1, 0, 0);

/** How long the torso holds its fire after a recorded shot, seconds: long
 *  enough for the half-body machine to see the trigger. */
const TRIGGER_HOLD = 0.25;

/** A recorded die state's death family, for the deaths the body renderer
 *  has clips of (`bot-visuals.js` `CORPSE_CLIPS`). */
const DIE_FAMILY = new Map([
  ...Object.entries(DIE_CLIPS).map(([family, clips]) => [clips.lower, family]),
  [SWIM_CLIPS.swimDie.lower, 'swimDie'],
]);

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
    const self = this;
    this.shim = {
      get bots() { return self.drawn; },
      world: {
        player: id => self.soldiers.get(id) ?? null,
        armorOf: id => {
          const s = self.soldiers.get(id);
          return s ? { destroyed: s.dead, lastHit: null } : null;
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

  /** The actor for `pid`, made on first sight. */
  actorFor(pid) {
    let actor = this.actors.get(pid);
    if (actor) return actor;
    const info = this.player.rec.players.get(pid);
    const id = `replay:${pid}`;
    const soldier = { team: info?.team ?? 2, soldier: { x: 0, y: 0, z: 0, yaw: 0, stance: 'stand', body: { stateSpeed: 1 }, swimClips: () => null }, dead: false };
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
      const actor = this.actorFor(pid);
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
      // His death, when playback walks across it: the renderer plays the
      // engine's death for how he stood and leaves the body.
      if (dead && !actor.state.dead) {
        actor.state.dead = true;
        if (this.player.playing && t - life.diedAt < 0.5) {
          // The death the engine chose, where the recording has his body's
          // die state; the renderer's own choice otherwise, and in a seat.
          const family = seated ? undefined : DIE_FAMILY.get(recordedDeath(rec, life.nid, life.diedAt));
          this.bodies?.killBot?.(actor, { seated: Boolean(seated), family });
          this.player.ctx.playSoldierDeathSound?.({ x: s.x, y: s.y + 1.2, z: s.z }, actor.team);
        }
      }
      if (!dead) actor.state.dead = false;
      this.drawn.push(actor);
    }
    if (!this.bodies) return;
    for (const actor of this.drawn) {
      if (!actor.state.dead) this.bodies.ensureBotVisual(actor);
    }
    // Whoever the recording has nothing of this frame (out of the client's
    // range, spawning, gone) is not drawn at his last pose.
    const shown = new Set(this.drawn.map(a => a.playerId));
    for (const [id, vis] of this.bodies.botVisuals ?? []) {
      if (shown.has(id)) continue;
      vis.group.visible = false;
      if (vis.seat?.scene) vis.seat.scene.visible = false;
    }
    // The renderer blends between two tick poses; the replay hands it one a
    // frame, so the blend is always at its end. A seek snaps rather than
    // blending across the jump, and so does the first frame.
    this.bodies.captureBotPresentationTick?.(this.snap);
    this.snap = false;
    this.bodies.updateBotVisuals(dt);
    for (const actor of this.drawn) {
      if (!actor.vehicle && !actor.state.dead) this.player.ctx.footstepTick?.(actor, dt);
    }
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
    // A player can change sides between lives; the name tag, his death cry
    // and his uniform follow the life's own side.
    actor.team = life.team || actor.team;
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
    if (!group) return;
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
