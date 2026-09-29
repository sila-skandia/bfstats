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
// fired. A gun's traverse and elevation are a v5 recording's parts; without
// them, where its rounds went and a v4 file's decoded parts (`replay-aim.js`)
// aim it on the seat's own rig.

import * as THREE from 'three';
import { VehicleOccupancy } from './seats.js';
import { DRIVE_KINDS } from './seat-survey.js';
import { spawnedCraftUnder } from './spawned-craft.js';
import { SEAT_GUN_OPTIONS } from './vehicle-instance.js';
import { activeTier, deathTier } from './vehicle-damage.js';
import {
  crewOf, engineAt, hpAt, isReplicated, latestIndex, poseHeld, sampleInto, sampleRoom,
} from './replay-recording.js';
import { syncReplayCollision } from './replay-gunfire.js';
import { roundIsRecorded } from './replay-props.js';
import {
  aboveGround, aircraftStick, aircraftThrottle, groundRevs, groundSteer, matchJointNodes, motionAt,
  shipThrottle,
} from './replay-kinematics.js';
import {
  bracket, decodeKeyedParts, directionAt, lateTurn, matchPart, partAim, shotInHull,
} from './replay-aim.js';

const _world = new THREE.Quaternion();
const _next = new THREE.Quaternion();
const _parent = new THREE.Quaternion();
const _at = new THREE.Vector3();
const _toRoot = new THREE.Matrix4();
const _aim = new THREE.Vector3();
const _hullQ = new THREE.Quaternion();
const _muzzleQ = new THREE.Quaternion();
const _gunQ = new THREE.Quaternion();
const _gunAt = new THREE.Vector3();
const _launchQ = new THREE.Quaternion();
const _gunForward = new THREE.Vector3();
/** A moving part's samples around the instant, read without making them
 *  (replay-recording.js `sampleInto`). */
const jointRoom = sampleRoom();

/** Degrees a second a gun turns between two rounds where its axis declares
 *  no `setMaxSpeed`: the order of a manned gun's (a Sherman tower's 35, a
 *  Defgun's 90). */
const AIM_RATE = 45;

/** A FireArms' name as a recorded round spells it: the scene's duplicate
 *  suffix dropped, lower case. */
const bareName = name => String(name || '').replace(/_\d+$/, '').toLowerCase();

/** The seat whose FireArms `node` is, or null. */
function seatOfGun(occupancy, node) {
  for (const [id, seat] of occupancy.survey.seats) {
    if (seat.fireArms.includes(node)) return id;
  }
  return null;
}

/** A gun group's line of fire, as the map fires it (round-launch.js): its
 *  first muzzle's -Z, or for a `fireInCameraDof` gun its seat camera's, turned
 *  as the muzzle is turned on the gun (gun-groups.js `cameraLaunch`). */
function lineOfFire(group) {
  const muzzle = group.muzzles?.[0] ?? group.node;
  const camera = group.cameraNode ?? null;
  return out => {
    muzzle.getWorldQuaternion(_muzzleQ);
    if (camera) {
      _muzzleQ.premultiply(group.node.getWorldQuaternion(_gunQ).invert());
      _muzzleQ.premultiply(camera.getWorldQuaternion(_gunQ));
    }
    return out.set(0, 0, -1).applyQuaternion(_muzzleQ);
  };
}

/** The gun of those named `weapon` whose FireArms sits nearest `pos` (the
 *  hull's frame): a destroyer's mounts share one name. */
function nearestGun(guns, weapon, pos) {
  const want = bareName(weapon);
  let best = null;
  let bestDistance = Infinity;
  for (const gun of guns) {
    if (gun.name !== want) continue;
    const d = pos ? Math.hypot(gun.at[0] - pos[0], gun.at[1] - pos[1], gun.at[2] - pos[2]) : 0;
    if (d < bestDistance) {
      best = gun;
      bestDistance = d;
    }
  }
  return best;
}

/** How fast an axis turns a gun between rounds, deg/s. */
const turnRate = axis => Math.abs(axis.spec?.maxSpeed || 0) || AIM_RATE;

/** Seconds a part's first sight may precede its hull's life: both come from
 *  one sample, but the life starts at its root's first record. */
const PART_LEAD = 1;

/** A hull somebody has taken out of range is drawn in this, where it was last
 *  seen (`poseHeld`). */
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

/**
 * How long a gun keeps sounding past its last recorded round: this many
 * rounds at its own rate of fire, and never less than `SOUND_HOLD_MIN`
 * seconds. Every aircraft and hull machine gun's patch runs on loops, which
 * the rack sounds only while the gun fires (`group.firing`, the trigger, in
 * play). A replayed gun has no trigger, only its rounds, and the client fires
 * a remote player's gun at its own cadence (El Zilcho's `ZeroGuns` every
 * 0.1 s at 6:20 of replay_20260927-203459, which played in silence): a round
 * and a half bridges a burst and lets the loop stop when the rounds do.
 */
const SOUND_HOLD_ROUNDS = 1.5;
const SOUND_HOLD_MIN = 0.2;

/** The template's own root node inside a `models/<Template>.glb` scene: the
 *  one node the assembler stamps `templateKind`. */
function vehicleRoot(scene) {
  if (scene.userData?.templateKind) return scene;
  return scene.children.find(child => child.userData?.templateKind) ?? scene.children[0] ?? scene;
}

/**
 * What a template's hull is (`rootKind`: air, ship, tank, ground, gun), read
 * off its model the way a `ReplayHull` reads its own clone: the craft its
 * spawners launch taken off first. The replay builds a hull only when the
 * round first has it (replay.js `buildHull`); who flies is asked of every
 * hull of the round long before that. A throwaway copy, never the cached
 * model, is the one taken apart.
 */
export function modelKind(model, classes = {}) {
  const root = vehicleRoot(model.clone());
  for (const craft of spawnedCraftUnder(root)) craft.parent?.remove(craft);
  return new VehicleOccupancy(root, classes).rootKind;
}

/**
 * The launch of a recorded shot, as the `aimRay` contract `round-launch.js`
 * reads: `node` is the FireArms that fired and `shot` the recording's
 * `p`/`d`, the weapon's own transform when the engine fired it (BF1942's
 * frame).
 *
 * The engine fires each barrel from its own `addFireArmsPosition` in that
 * frame (`FireArms::fireBarrel`), so every barrel keeps its muzzle's offset
 * from the weapon, taken off the hull as it is drawn and turned by whatever
 * lies between the drawn gun and the recorded one -- nothing on an airframe,
 * which is drawn on the same recorded pose; the traverse on a turret the
 * drawing has not turned. Launching every barrel from the recorded point put
 * a Stuka's two bombs, 6.6 m apart under its wings, into one.
 */
export function recordedLaunch(node, shot) {
  const origin = new THREE.Vector3(shot.pos[0], shot.pos[1], -shot.pos[2]);
  const dir = new THREE.Vector3(shot.dir[0], shot.dir[1], -shot.dir[2]).normalize();
  node.updateWorldMatrix(true, false);
  const base = node.getWorldPosition(new THREE.Vector3());
  // The FireArms node's forward is its gun's: glTF -Z, BF1942's +Z.
  _gunForward.set(0, 0, -1).applyQuaternion(node.getWorldQuaternion(_launchQ));
  const turn = new THREE.Quaternion().setFromUnitVectors(_gunForward, dir);
  const ray = { origin: new THREE.Vector3(), dir };
  return muzzle => {
    ray.origin.copy(origin);
    if (muzzle && muzzle !== node) {
      muzzle.updateWorldMatrix(true, false);
      ray.origin.add(muzzle.getWorldPosition(_gunAt).sub(base).applyQuaternion(turn));
    }
    return ray;
  };
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
    // A ship's model carries the craft its spawners launch baked under it --
    // the Enterprise's Corsair, SBD and two LCVPs, a Hatsuzuki's two
    // Daihatsus -- which a level detaches as vehicles of their own
    // (spawned-craft.js). Each is a life of its own in the recording, drawn
    // where the recording has it; left on the ship it was a second copy,
    // frozen on her deck, and its seats were counted among hers.
    for (const craft of spawnedCraftUnder(this.root)) craft.parent?.remove(craft);
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
    // Whether anyone can move it: a hull with no drivetrain (a flak gun, a
    // Defgun) stands where it was made, manned or not.
    this.movable = DRIVE_KINDS.includes(this.kind) || Boolean(player.rec.engines?.has(life.nid));
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

    // The hull's recorded velocity, the viewer's frame: what its rounds leave
    // with on top of their own, as a flown seat's guns do (vehicle-instance.js).
    // A bomb rack's `velocity 0` is nothing but this, so without it a replayed
    // Stuka's bomb dropped straight down from a standstill, nose to the ground.
    this.velocity = new THREE.Vector3();
    // The guns, collected the way a seat collects them, and marked as the
    // replay's: a round they fire draws and sounds but never bills a hit
    // (map.html's `guns.onImpact`), because the recording's hit points are
    // the truth.
    this.groups = [];
    if (ctx.guns) {
      try {
        this.groups = ctx.guns.collect(this.root, {
          ...SEAT_GUN_OPTIONS, replace: false, platformVelocity: () => this.velocity,
        });
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
    // Whether `hide` has put it away since it was last drawn: the replay
    // skips a hull that is put away and outside its life (replay.js
    // `updateHull`). A new one is drawn or put away on its first frame.
    this.putAway = false;
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
    // Out of range, a hull nobody has driven since the recording last had it
    // is where it was, and is drawn as it is. Only one somebody has taken out
    // of sight is a guess: a ghost where it was last seen.
    const ghost = !replicated && this.movable && !poseHeld(player.rec, life, t);
    if (ghost && !player.showGhosts) {
      this.hide();
      return;
    }
    const motion = motionAt(life, t);
    if (!motion) {
      this.hide();
      return;
    }
    this.group.visible = true;
    this.putAway = false;
    this.setGhost(ghost);
    this.velocity.set(motion.velocity[0], motion.velocity[1], motion.velocity[2]);

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

    // A v4 recording carries the engine itself (`present`). It runs where
    // the recording says it does (it starts on a driver's entry and stops on
    // his exit or its damage), else while someone holds the root seat: its
    // note plays and its propeller turns only then.
    const live = replicated && !wrecked;
    this.engine = this.drive ? engineAt(player.rec, life.nid, t) : null;
    const running = live && (this.engine ? this.engine.running && !this.engine.disabled : driven);
    this.present(motion, t, dt, driven && live, running);
    this.applyWreck(wrecked);
    this.updateTier(t, hp, wrecked, replicated);
    // A gun's report sounds while its recorded rounds leave (`holdSound`),
    // and only while the replay runs: a paused replay's guns fall silent.
    const playback = player.feedRate?.() > 0;
    for (const group of this.groups) group.sounding = playback && t < (group.soundUntil ?? -Infinity);
    this.updateAudio(running, this.crew.length > 0 && live, wrecked);
    this.lastHp = hp;
    this.lastT = t;
  }

  /** The pose, and every rig the drive runs over it: `crewed` while someone
   *  holds the root seat, `running` while the engine runs. */
  present(motion, t, dt, crewed, running) {
    const drive = this.drive;
    const [px, py, pz] = motion.position;
    const [qx, qy, qz, qw] = motion.quaternion;
    if (!drive) {
      // A hull with no drivetrain (an AA gun, a Defgun, a static MG) is a
      // pose and its guns.
      this.root.position.set(px, py, pz);
      this.root.quaternion.set(qx, qy, qz, qw);
      this.root.updateMatrixWorld(true);
      this.applyJoints(t);
      this.applyAim(t);
      return;
    }
    const s = drive.state;
    s.position.set(px, py, pz);
    s.orientation.set(qx, qy, qz, qw);
    s.velocity.set(motion.velocity[0], motion.velocity[1], motion.velocity[2]);
    s.angularVelocity.set(motion.angular[0], motion.angular[1], motion.angular[2]);
    // A v4 recording carries the engine itself (`update`): the
    // PhysicsEngine's revs, which are what the engine plays its note from and
    // spins its propeller with (`PhysicsEngine::updatePhysics`), in place of
    // every estimate below.
    const recorded = this.engine;
    const ctx = this.player.ctx;
    let throttle = 0;
    if (this.kind === 'air') {
      const stick = crewed ? aircraftStick(motion.bodyRates) : { pitch: 0, roll: 0, yaw: 0 };
      drive.setInput('c_PIPitch', stick.pitch);
      drive.setInput('c_PIRoll', stick.roll);
      drive.setInput('c_PIYaw', stick.yaw);
      const clearance = drive.spec?.groundClearance ?? 1.2;
      const agl = aboveGround(motion.position, ctx.groundHeight);
      throttle = recorded ? Math.min(1, recorded.revs) : aircraftThrottle({
        crewed,
        airborne: agl > clearance + 1.5,
        speed: motion.speed,
        forwardAccel: this.forwardAccel,
        climb: motion.velocity[1],
        vmax: drive.spec?.maxSpeed ?? AIR_VMAX,
      });
    } else if (this.kind === 'ship') {
      drive.setInput('c_PIYaw', crewed ? groundSteer(motion.bodyRates[1], motion.forward) : 0);
      throttle = recorded ? Math.min(1, recorded.revs) : shipThrottle({ crewed, forward: motion.forward });
    } else {
      drive.setInput('c_PIYaw', crewed ? groundSteer(motion.bodyRates[1], motion.forward) : 0);
      drive.setInput('c_PIThrottle', crewed ? Math.sign(motion.forward) * Math.min(1, Math.abs(this.forwardAccel)) : 0);
      throttle = recorded ? Math.min(1.2, recorded.revs) : groundRevs(drive.engine, motion.forward, crewed);
    }
    // The first frame after a seek (or of a life) starts from the settled
    // state rather than spooling up from a cold engine: a plane met in the
    // middle of a dive is at full power, not idling. A parked plane's
    // propeller is still until its engine starts, and one out of range or
    // wrecked winds down: its last recorded revs are not being updated.
    drive.presentKinematic(this.lastT === null ? SETTLE : dt, running ? throttle : 0, running);
    this.applyJoints(t);
    this.applyAim(t);
  }

  /**
   * The moving parts a v5 recording carries (`j`): each networked
   * RotationalBundle's rotation relative to the root object -- a turret's
   * traverse, a gun's elevation, a pintle MG's mount -- put on the node of the
   * same name (among several, the one where the recording places the part),
   * after the rig has posed everything else. The parts are this life's: a
   * root id a respawn reuses brings new parts. A v3 or v4 recording has none
   * to put on nodes, and its guns are aimed from what it does carry
   * (`applyAim`).
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
      if (latestIndex(part.keys, t) < 0) continue;
      // Eased into the next sample over its last tenth of a second, as the
      // hull's own pose is (`sampleAt`): held and stepped at 10 Hz, a fast
      // traverse jumped and lagged a sample behind its rounds.
      const { a, b, k } = sampleInto(part, t, jointRoom);
      // The recorder's quaternion is BF1942's; the viewer's is (-x, -y, z, w),
      // and the map is a homomorphism, so a relative rotation converts the
      // same way an absolute one does.
      _world.set(-a.q[0], -a.q[1], a.q[2], a.q[3]);
      if (b) _world.slerp(_next.set(-b.q[0], -b.q[1], b.q[2], b.q[3]), k);
      _world.premultiply(rootQ);
      node.parent.getWorldQuaternion(_parent);
      node.quaternion.copy(_parent.invert().multiply(_world));
      node.updateMatrixWorld(true);
    }
  }

  /**
   * Every gun a seat's aim rig turns: its group, its seat and the seat's rig
   * (`rigFor`, the rig the mouse drives in play), the node its line of fire
   * hangs from, and where its FireArms sits on the hull.
   */
  aimedGuns() {
    this.root.updateMatrixWorld(true);
    _toRoot.copy(this.root.matrixWorld).invert();
    const guns = [];
    for (const group of this.groups) {
      const seatId = seatOfGun(this.occupancy, group.node);
      const rig = seatId === null ? null : this.occupancy.rigFor(seatId);
      const reference = group.cameraNode ?? group.muzzles?.[0] ?? group.node;
      if (!rig?.chainOf(reference).length) continue;
      group.node.getWorldPosition(_at).applyMatrix4(_toRoot);
      guns.push({
        group, seatId, rig, reference, line: lineOfFire(group),
        name: bareName(group.node.name), at: [_at.x, _at.y, _at.z], shots: [],
      });
    }
    return guns;
  }

  /**
   * Where each aimed seat's gun pointed over this life, from a recording
   * whose parts cannot be put on nodes (`replay-aim.js`): a track of
   * directions in the hull's frame per seat, the seats outermost first (a
   * cupola MG rides the tower its driver turns). A v4 file's decoded part
   * where it carries one of the seat's guns, sampled every tenth of a
   * second; else the rounds the seat's guns fired, each on the gun nearest
   * where it left among those of its name.
   */
  buildAims() {
    const { life } = this;
    const rec = this.player.rec;
    const guns = this.aimedGuns();
    if (!guns.length) return [];
    for (const f of rec.fires) {
      if (f.press || f.nid !== life.nid || f.t < life.created || f.t >= life.destroyed) continue;
      const shot = shotInHull(life, f);
      const gun = shot && nearestGun(guns, f.weapon, shot.pos);
      if (gun) gun.shots.push({ ...shot, gun });
    }
    const runs = (rec.keyedParts?.get(life.nid) ?? [])
      .filter(run => run.t >= life.created - PART_LEAD && run.t < life.destroyed);
    const parts = runs.length ? decodeKeyedParts(runs) : [];
    const seats = new Map();
    for (const gun of guns) {
      if (!gun.shots.length) continue;
      if (!seats.has(gun.seatId)) seats.set(gun.seatId, []);
      seats.get(gun.seatId).push(gun);
    }
    const aims = [];
    for (const [seatId, seatGuns] of seats) {
      let aim = null;
      for (const gun of seatGuns) {
        const match = matchPart(parts, gun.shots);
        if (match && (!aim || match.error < aim.error)) {
          aim = { dense: true, gun, error: match.error, samples: partAim(parts[match.part], match.sense) };
        }
      }
      if (!aim) {
        const gun = seatGuns.reduce((most, g) => (g.shots.length > most.shots.length ? g : most));
        aim = { dense: false, gun, samples: seatGuns.flatMap(g => g.shots).sort((a, b) => a.t - b.t) };
      }
      const { rig } = aim.gun;
      aims.push({ ...aim, seatId, rig, chain: rig.chainOf(aim.gun.reference) });
    }
    const order = this.occupancy.order;
    return aims.sort((a, b) => order.indexOf(a.seatId) - order.indexOf(b.seatId));
  }

  /** `gun`'s line of fire laid along `dir` (the hull's frame) on its rig. */
  layGun(rig, gun, dir) {
    _aim.set(dir[0], dir[1], dir[2]).applyQuaternion(this.root.getWorldQuaternion(_hullQ));
    rig.pointAlong(_aim, gun.line, gun.reference);
  }

  /**
   * The guns laid where the recording says they pointed at `t`, after the
   * drive's rig has posed every turret at rest. A decoded part's track is
   * followed as recorded; a track of rounds holds each round's aim and
   * turns to the next as late as the axis's own speed allows (`lateTurn`).
   * Before a seat's first aim its gun is at rest. A v5 file's parts, where
   * the hull has them, are the truth and nothing is derived.
   */
  applyAim(t) {
    if (this.jointNodes?.length) return;
    // Built once, on the first frame the hull is shown: the rigs take their
    // rest pose from the nodes, which are at rest then.
    this.aims ??= this.buildAims();
    for (const aim of this.aims) {
      const { chain, rig } = aim;
      if (aim.dense) {
        const dir = directionAt(aim.samples, t);
        if (dir) this.layGun(rig, aim.gun, dir);
        else for (const { axis } of chain) axis.hold(0);
      } else {
        const { a, b } = bracket(aim.samples, t);
        const anglesOf = shot => {
          this.layGun(rig, shot.gun, shot.dir);
          return chain.map(({ axis }) => axis.angle);
        };
        const from = a ? anglesOf(a) : chain.map(() => 0);
        const to = b ? anglesOf(b) : from;
        chain.forEach(({ axis }, i) => {
          const turn = { start: a?.t, free: axis.spec.free };
          axis.hold(b ? lateTurn(from[i], to[i], t, b.t, turnRate(axis), turn) : from[i]);
        });
      }
      for (const { axis } of chain) {
        for (const peer of axis.peers) peer.node.updateMatrixWorld(true);
      }
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
   * whatever its turret was drawn doing -- and of several mounts sharing the
   * name (a destroyer's), the one nearest where the round left, the mount
   * the aim lays for it (`buildAims`). One Hatsuzuki round used to flash all
   * three of its guns. A v3 press names only the seat and the trigger (`kind`
   * 2 the alternate), and the seat's guns on that trigger fire down their
   * own barrels.
   */
  fire(seat, kind, shot = null) {
    const guns = this.player.ctx.guns;
    if (!guns || !this.groups.length) return false;
    syncReplayCollision(this.player);
    let pick = [];
    if (shot?.weapon) {
      const want = bareName(shot.weapon);
      pick = this.groups.filter(g => bareName(g.node?.name) === want);
      if (pick.length > 1) pick = [this.nearestGroup(pick, shot)];
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
      this.holdSound(group, shot?.t ?? this.player.time);
      // A PT boat's floating mine is the recording's own object
      // (replay-props.js), not a round for the page to lay again.
      if (roundIsRecorded(group, this.player.networkedRounds)) continue;
      // Its rounds skip this hull (`dynamicCast`). Pinned to the collider the
      // guns hold now: `projectile-flight.js` `gunOwner` re-reads the owner
      // from the level's index whenever the collider has changed since, and
      // a replayed hull is not in it.
      group.owner = this.ownerTag;
      group.ownerFor = guns.collider;
      if (Array.isArray(shot?.pos) && Array.isArray(shot?.dir)) {
        group.aimRay = recordedLaunch(group.node, shot);
      } else {
        group.aimRay = group.ownAimRay ?? null;
      }
      guns.fireShot(group);
    }
    return pick.length > 0;
  }

  /** Keep `group`'s report sounding past a recorded round at recording time
   *  `t` (`SOUND_HOLD_ROUNDS`); the rack reads `group.sounding`, which
   *  `update` raises from this. */
  holdSound(group, t) {
    const rate = group.stats?.roundOfFire || 0;
    const hold = Math.max(SOUND_HOLD_MIN, rate > 0 ? SOUND_HOLD_ROUNDS / rate : 0);
    group.soundUntil = Math.max(group.soundUntil ?? -Infinity, t + hold);
  }

  /** A seek: no gun is sounding from a round the clock has jumped away from.
   *  The rounds fired just before the new instant hold it again. */
  resetSound() {
    for (const group of this.groups) {
      group.soundUntil = -Infinity;
      group.sounding = false;
    }
  }

  /** Of `groups`, one name on several mounts, the one whose FireArms sits
   *  nearest where the recorded round left, in the hull's frame. */
  nearestGroup(groups, shot) {
    const inHull = shotInHull(this.life, shot);
    if (!inHull?.pos) return groups[0];
    this.root.updateMatrixWorld(true);
    _toRoot.copy(this.root.matrixWorld).invert();
    const mounts = groups.map(group => {
      group.node.getWorldPosition(_at).applyMatrix4(_toRoot);
      return { group, name: bareName(group.node.name), at: [_at.x, _at.y, _at.z] };
    });
    return nearestGun(mounts, shot.weapon, inHull.pos)?.group ?? groups[0];
  }

  hide() {
    this.group.visible = false;
    this.putAway = true;
    this.velocity.set(0, 0, 0);
    for (const group of this.groups) group.sounding = false;
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
