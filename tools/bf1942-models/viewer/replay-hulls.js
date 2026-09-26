// Recorded vehicles, presented by the playable map's own vehicle code.
//
// A replayed hull is the same object the map drives: the template's model
// (`models/<Template>.glb`, the assembler's own output, rigs and all), its seat
// table (`seats.js` `VehicleOccupancy`), the drivetrain class that seat table
// classifies it to (`Aircraft`, `GroundVehicle`, `TrackedVehicle`, `Ship`),
// its gun groups on the page's `GunFire`, its voice on the page's vehicle
// audio rack and its damage tiers through the page's `EffectPlayer`. What is
// different is who writes the state: not the physics, the recording. Each
// frame the recorded pose goes into the drive's `VehicleState` and the drive
// presents it (`Vehicle.presentKinematic`): the propeller spools and spins and
// swaps to its disc, the gear folds away on the aircraft's own thresholds, the
// wheels roll at the hull's speed and the steering, flaps and rudders follow
// the turn it made.
//
// What the recording does not carry is derived from what it does
// (`replay-kinematics.js`): the throttle from the speed and the climb, a land
// engine's revs from its gearbox, the stick from the turn. A v4 recording's
// engine records replace the derived throttle. The crew comes from every
// player's controlled object (`crewOf`): the engine note plays while someone
// holds the root seat, the guns sound while anyone is aboard, and a round
// fires through the seat's own gun group when the recording says the seat
// fired.

import * as THREE from 'three';
import { VehicleOccupancy } from './seats.js';
import { SEAT_GUN_OPTIONS } from './vehicle-instance.js';
import { activeTier, deathTier } from './vehicle-damage.js';
import { crewOf, engineAt, hpAt, isReplicated, latestAt } from './replay-recording.js';
import {
  aboveGround, aircraftStick, aircraftThrottle, groundRevs, groundSteer, matchJointNodes, motionAt,
  shipThrottle,
} from './replay-kinematics.js';

const _world = new THREE.Quaternion();
const _parent = new THREE.Quaternion();
const _at = new THREE.Vector3();
const _toRoot = new THREE.Matrix4();

/** Seconds a part's first sight may precede its hull's life: both come from
 *  one sample, but the life starts at its root's first record. */
const PART_LEAD = 1;

/** Out-of-range objects are drawn in this: announced and placed, not updated. */
const ghostMaterial = new THREE.MeshBasicMaterial({
  color: 0x9aa666, transparent: true, opacity: 0.2, depthWrite: false,
});

/** A kill this recent (recording seconds) still earns its explosion when
 *  playback crosses it; a seek past it lands on the wreck without one. */
const DEATH_WINDOW = 0.5;

/** Fighters' top speed where the airframe carries no AI data (`maxSpeed 60`
 *  for the four vanilla fighters, ledger AI-75). */
const AIR_VMAX = 60;

/** Seconds of presentation a hull is given on its first frame after a seek:
 *  longer than every spool and servo in the game, so it starts settled. */
const SETTLE = 5;

/** The template's own root node inside a `models/<Template>.glb` scene: the
 *  one node the assembler stamps `templateKind`. */
function vehicleRoot(scene) {
  if (scene.userData?.templateKind) return scene;
  return scene.children.find(child => child.userData?.templateKind) ?? scene.children[0] ?? scene;
}

export class ReplayHull {
  /**
   * @param {object} player  the ReplayPlayer (its `ctx`, `rec`, `showGhosts`)
   * @param {object} life    the recorded life
   * @param {THREE.Object3D} scene  a skeleton-safe clone of the template's glb
   * @param {THREE.Object3D|null} wreck  a clone of its `.wreck.glb`, or null
   */
  constructor(player, life, scene, wreck) {
    this.player = player;
    this.life = life;
    const ctx = player.ctx;
    this.group = new THREE.Group();
    this.group.name = `replay ${life.tmpl} ${life.nid}`;
    this.group.visible = false;
    this.scene = scene;
    this.root = vehicleRoot(scene);
    this.group.add(scene);
    this.wreck = wreck;
    if (wreck) {
      wreck.visible = false;
      this.group.add(wreck);
    }
    this.meshes = [];
    this.group.traverse(obj => { if (obj.isMesh) this.meshes.push({ mesh: obj, material: obj.material }); });
    this.ghost = false;
    this.hp = null;

    // The seat table and the drivetrain its root classifies to: the page's
    // classes, so a replayed Corsair is the flown Corsair's rig.
    this.occupancy = new VehicleOccupancy(this.root, ctx.vehicleClasses ?? {});
    this.kind = this.occupancy.rootKind;
    this.drive = null;
    if (ctx.vehicleClasses) {
      try {
        this.drive = this.occupancy.ensureDrive(null, {
          cockpit: false,
          groundHeight: ctx.groundHeight,
          waterLevel: ctx.waterLevel?.(),
        }) ?? null;
      } catch (error) {
        console.warn(`replay: no drive for ${life.tmpl}`, error);
        this.drive = null;
      }
    }
    if (this.drive) {
      // A replayed hull is always watched from outside: its cockpit is never
      // the camera's.
      this.drive.autoFirstPerson = false;
      this.drive.setFirstPerson?.(false);
      // The gear's altitude test reads the ground, which an `Aircraft` is
      // handed after it is built (map.html `buildHullDrive` does the same).
      if (this.kind === 'air' && ctx.groundHeight) this.drive.groundHeight = ctx.groundHeight;
    }

    // The guns, collected the way a seat collects them, and marked as the
    // replay's: a round they fire draws and sounds but never bills a hit
    // (map.html's `guns.onImpact`), because the recording's hit points are
    // the truth.
    this.groups = [];
    if (ctx.guns) {
      try {
        this.groups = ctx.guns.collect(this.root, { ...SEAT_GUN_OPTIONS, replace: false });
      } catch (error) {
        console.warn(`replay: no guns for ${life.tmpl}`, error);
      }
      for (const group of this.groups) {
        group.replay = true;
        group.firer = `replay:${life.nid}`;
        // The group's own launch (a coaxial gun's seat camera), kept for the
        // shots that carry no recorded ray.
        group.ownAimRay = group.aimRay ?? null;
      }
    }

    // The damage tiers the template authored (`addArmorEffect`), read off the
    // same `armor` extras the level's own hulls carry.
    this.effects = Array.isArray(this.root.userData?.armor?.effects) ? this.root.userData.armor.effects : [];
    this.tier = null;
    this.tierHandles = [];
    this.anchors = new Map();

    this.audioKey = `replay:${life.nid}`;
    this.claimed = null;       // null, 'guns' or 'engine'
    this.cut = false;
    this.prevForward = 0;
    this.forwardAccel = 0;
    this.lastHp = null;
    this.lastT = null;
    this.crew = [];
  }

  /** The seat id at a recorded seat index (the root seat first, then the
   *  nested PlayerControlObjects in the order the server numbered them). */
  seatIdAt(index) {
    return this.occupancy.order[index] ?? null;
  }

  setGhost(ghost) {
    if (this.ghost === ghost) return;
    this.ghost = ghost;
    for (const { mesh, material } of this.meshes) mesh.material = ghost ? ghostMaterial : material;
  }

  /** The frame at recording time `t`. */
  update(t, dt) {
    const { life, player } = this;
    const ctx = player.ctx;
    const alive = t >= life.created && t < life.destroyed;
    if (!alive) {
      this.hide();
      return;
    }
    const replicated = isReplicated(life, t);
    if (!replicated && !player.showGhosts) {
      this.hide();
      return;
    }
    const motion = motionAt(life, t);
    if (!motion) {
      this.hide();
      return;
    }
    this.group.visible = true;
    this.setGhost(!replicated);

    const hp = hpAt(life, t);
    this.hp = hp;
    const wrecked = hp !== null && hp <= 0;
    this.crew = wrecked ? [] : crewOf(player.rec, life, t);
    const driven = this.crew.some(c => c.seat === 0);

    // Forward acceleration, one pole: the take-off roll and the climb-out are
    // what the throttle estimate reads it for.
    const step = this.lastT === null ? 0 : t - this.lastT;
    if (step > 0 && step < 0.5) {
      const accel = (motion.forward - this.prevForward) / step;
      this.forwardAccel += (accel - this.forwardAccel) * Math.min(1, step * 3);
    } else {
      this.forwardAccel = 0;
    }
    this.prevForward = motion.forward;

    this.present(motion, t, dt, driven && replicated && !wrecked);
    this.applyWreck(wrecked);
    this.updateTier(t, hp, wrecked, replicated);
    // The engine sounds while it runs: the recorded running flag where the
    // recording has one (the engine starts on a driver's entry and stops on
    // his exit or its damage), else while someone holds the root seat.
    const running = this.engine ? this.engine.running && !this.engine.disabled : driven;
    this.updateAudio(running && replicated && !wrecked, this.crew.length > 0 && replicated && !wrecked, wrecked);
    this.lastHp = hp;
    this.lastT = t;
  }

  /** The pose, and every rig the drive runs over it. */
  present(motion, t, dt, running) {
    const drive = this.drive;
    const [px, py, pz] = motion.position;
    const [qx, qy, qz, qw] = motion.quaternion;
    if (!drive) {
      // A hull with no drivetrain (an AA gun, a Defgun, a static MG) is a
      // pose and its guns.
      this.root.position.set(px, py, pz);
      this.root.quaternion.set(qx, qy, qz, qw);
      this.root.updateMatrixWorld(true);
      this.engine = null;
      this.applyJoints(t);
      return;
    }
    const s = drive.state;
    s.position.set(px, py, pz);
    s.orientation.set(qx, qy, qz, qw);
    s.velocity.set(motion.velocity[0], motion.velocity[1], motion.velocity[2]);
    s.angularVelocity.set(motion.angular[0], motion.angular[1], motion.angular[2]);
    // A v4 recording carries the engine itself: the PhysicsEngine's revs,
    // which are what the engine plays its note from and spins its propeller
    // with (`PhysicsEngine::updatePhysics`), in place of every estimate below.
    const recorded = engineAt(this.player.rec, this.life.nid, t);
    this.engine = recorded;
    const ctx = this.player.ctx;
    let throttle = 0;
    if (this.kind === 'air') {
      const stick = running ? aircraftStick(motion.bodyRates) : { pitch: 0, roll: 0, yaw: 0 };
      drive.setInput('c_PIPitch', stick.pitch);
      drive.setInput('c_PIRoll', stick.roll);
      drive.setInput('c_PIYaw', stick.yaw);
      const clearance = drive.spec?.groundClearance ?? 1.2;
      const agl = aboveGround(motion.position, ctx.groundHeight);
      throttle = recorded ? Math.min(1, recorded.revs) : aircraftThrottle({
        crewed: running,
        airborne: agl > clearance + 1.5,
        speed: motion.speed,
        forwardAccel: this.forwardAccel,
        climb: motion.velocity[1],
        vmax: drive.spec?.maxSpeed ?? AIR_VMAX,
      });
    } else if (this.kind === 'ship') {
      drive.setInput('c_PIYaw', running ? groundSteer(motion.bodyRates[1], motion.forward) : 0);
      throttle = recorded ? Math.min(1, recorded.revs) : shipThrottle({ crewed: running, forward: motion.forward });
    } else {
      drive.setInput('c_PIYaw', running ? groundSteer(motion.bodyRates[1], motion.forward) : 0);
      drive.setInput('c_PIThrottle', running ? Math.sign(motion.forward) * Math.min(1, Math.abs(this.forwardAccel)) : 0);
      throttle = recorded ? Math.min(1.2, recorded.revs) : groundRevs(drive.engine, motion.forward, running);
    }
    // The first frame after a seek (or of a life) starts from the settled
    // state rather than spooling up from a cold engine: a plane met in the
    // middle of a dive is at full power, not idling.
    drive.presentKinematic(this.lastT === null ? SETTLE : dt, throttle);
    this.applyJoints(t);
  }

  /**
   * The moving parts a v5 recording carries (`j`): each networked
   * RotationalBundle's rotation relative to the root object -- a turret's
   * traverse, a gun's elevation, a pintle MG's mount -- put on the node of the
   * same name (among several, the one where the recording places the part),
   * after the rig has posed everything else. The parts are this life's: a
   * root id a respawn reuses brings new parts. A v3 recording has none, and
   * its turrets stay where the rig leaves them.
   */
  applyJoints(t) {
    const parts = this.player.rec.joints?.get(this.life.nid);
    if (!parts?.size) return;
    if (!this.jointNodes) {
      const { created, destroyed } = this.life;
      const mine = [...parts]
        .filter(([, part]) => part.since === undefined || (part.since >= created - PART_LEAD && part.since < destroyed))
        .map(([key, part]) => ({ key, part, name: String(part.name || '').toLowerCase(), pos: part.pos ?? null }));
      this.root.updateMatrixWorld(true);
      _toRoot.copy(this.root.matrixWorld).invert();
      const nodes = [];
      this.root.traverse(obj => {
        if (obj === this.root) return;
        const name = String(obj.name || '').replace(/_\d+$/, '').toLowerCase();
        if (!name) return;
        obj.getWorldPosition(_at).applyMatrix4(_toRoot);
        nodes.push({ node: obj, name, pos: [_at.x, _at.y, _at.z] });
      });
      const match = matchJointNodes(mine, nodes);
      const depth = node => { let d = 0; for (let n = node; n && n !== this.root; n = n.parent) d++; return d; };
      this.jointNodes = mine.filter(j => match.has(j.key))
        .map(j => ({ part: j.part, node: nodes[match.get(j.key)].node }))
        .sort((a, b) => depth(a.node) - depth(b.node));
    }
    if (!this.jointNodes.length) return;
    const rootQ = this.root.quaternion;
    for (const { part, node } of this.jointNodes) {
      const key = latestAt(part.keys, t);
      if (!key) continue;
      // The recorder's quaternion is BF1942's; the viewer's is (-x, -y, z, w),
      // and the map is a homomorphism, so a relative rotation converts the
      // same way an absolute one does.
      _world.set(-key.q[0], -key.q[1], key.q[2], key.q[3]).premultiply(rootQ);
      node.parent.getWorldQuaternion(_parent);
      node.quaternion.copy(_parent.invert().multiply(_world));
      node.updateMatrixWorld(true);
    }
  }

  /** The wreck model in place of the hull, on the hull's pose. */
  applyWreck(wrecked) {
    if (!this.wreck) return;
    this.wreck.visible = wrecked;
    this.scene.visible = !wrecked;
    if (wrecked) {
      this.wreck.position.copy(this.root.position);
      this.wreck.quaternion.copy(this.root.quaternion);
    }
  }

  /** An `addArmorEffect` offset as a node on the hull, so the effect rides
   *  with it (vehicle-wrecks.js's `damageAnchor`). */
  anchor(name, offset) {
    let node = this.anchors.get(name);
    if (!node) {
      node = new THREE.Object3D();
      node.name = `damage:${name}`;
      this.root.add(node);
      this.anchors.set(name, node);
    }
    node.position.set(offset?.[0] || 0, offset?.[1] || 0, offset?.[2] || 0);
    return node;
  }

  stopTier() {
    for (const handle of this.tierHandles) handle.stop?.();
    this.tierHandles.length = 0;
    this.tier = null;
  }

  /**
   * The template's smoke and fire at the recorded hit points (ARM-1: a live
   * object re-evaluates its tier every tick), and its death -- the explosion
   * the template authored for tier 0 -- when playback crosses the kill.
   */
  updateTier(t, hp, wrecked, replicated) {
    const fx = this.player.ctx.effects;
    if (!fx?.play || !this.effects.length) return;
    const tier = replicated && !wrecked && hp !== null ? activeTier(this.effects, hp) : null;
    const key = tier ? tier.threshold : null;
    if (key !== this.tier) {
      for (const handle of this.tierHandles) handle.stop?.();
      this.tierHandles.length = 0;
      this.tier = key;
      if (tier) {
        for (const name of tier.names) {
          const entry = this.effects.find(e => e.effect === name && e.hp === tier.threshold);
          const handle = fx.play(name, { attach: { object: this.anchor(name, entry?.offset) } });
          if (handle) this.tierHandles.push(handle);
        }
      }
    }
    const killedNow = wrecked && this.lastHp !== null && this.lastHp > 0
      && this.lastT !== null && t - this.lastT < DEATH_WINDOW && t >= this.lastT;
    if (killedNow) {
      const at = this.root.getWorldPosition(new THREE.Vector3());
      const death = deathTier(this.effects, {});
      const names = death?.names?.length ? death.names : ['e_ExplGas'];
      for (const name of names) fx.play(name, { position: [at.x, at.y, at.z], normal: [0, 1, 0] });
    }
  }

  /** The hull's voice on the page's rack: the engine while someone drives,
   *  the guns while anyone is aboard, silence once it is a wreck. */
  updateAudio(engine, guns, wrecked) {
    const ctx = this.player.ctx;
    if (wrecked) {
      if (!this.cut && this.claimed) ctx.cutVehicleAudio?.(this.root);
      this.cut = true;
      this.claimed = null;
      return;
    }
    this.cut = false;
    const want = engine && this.drive ? 'engine' : guns ? 'guns' : null;
    if (want === this.claimed) return;
    if (!want) {
      ctx.releaseVehicleAudio?.(this.audioKey, this.root);
    } else {
      ctx.claimVehicleAudio?.(this.audioKey, this.root, want === 'engine' ? this.drive : null, this.groups);
    }
    this.claimed = want;
  }

  /**
   * One round, through the hull's own gun group, so the flash, the tracer,
   * the shell and the report are the ones the map fires.
   *
   * A v4 shot names its FireArms (`weapon`, the template the group's node is
   * named after) and the ray the engine fired it along (`pos`/`dir`,
   * BF1942's frame), so exactly that gun fires, along exactly that ray,
   * whatever its turret was drawn doing. A v3 press names only the seat and
   * the trigger (`kind` 2 the alternate), and the seat's guns on that
   * trigger fire down their own barrels.
   */
  fire(seat, kind, shot = null) {
    const guns = this.player.ctx.guns;
    if (!guns || !this.groups.length) return false;
    let pick = [];
    const bare = name => String(name || '').replace(/_\d+$/, '').toLowerCase();
    if (shot?.weapon) {
      const want = bare(shot.weapon);
      pick = this.groups.filter(g => bare(g.node?.name) === want);
    }
    if (!pick.length) {
      const seatId = this.seatIdAt(seat) ?? this.occupancy.rootId;
      const nodes = new Set(this.occupancy.fireArmsNodesOf(seatId));
      const input = kind === 2 ? 'c_PIAltFire' : 'c_PIFire';
      const candidates = this.groups.filter(g => (g.stats?.input || 'c_PIFire') === input);
      const own = candidates.filter(g => nodes.has(g.node));
      pick = own.length ? own : (seat === 0 ? candidates : []);
    }
    for (const group of pick) {
      if (Array.isArray(shot?.pos) && Array.isArray(shot?.dir)) {
        const origin = new THREE.Vector3(shot.pos[0], shot.pos[1], -shot.pos[2]);
        const dir = new THREE.Vector3(shot.dir[0], shot.dir[1], -shot.dir[2]).normalize();
        group.aimRay = () => ({ origin, dir });
      } else {
        group.aimRay = group.ownAimRay ?? null;
      }
      guns.fireShot(group);
    }
    return pick.length > 0;
  }

  hide() {
    this.group.visible = false;
    this.stopTier();
    if (this.claimed) {
      this.player.ctx.releaseVehicleAudio?.(this.audioKey, this.root);
      this.claimed = null;
    }
    this.lastT = null;
  }

  dispose() {
    this.hide();
    const guns = this.player.ctx.guns;
    for (const group of this.groups) guns?.release(group);
    this.groups.length = 0;
    this.group.parent?.remove(this.group);
  }
}
