// Every occupied vehicle's own noise: the engine note of whoever is driving
// and the report of every gun aboard, heard from the page's camera.
//
// Until now this page built one engine and one set of gun patches, for the
// seat the local player held — the FPOV assumption. A bot that took the
// driver's seat of a Sherman drove in silence: `botEnterVehicle` built its
// drivetrain and collected its guns, and nothing ever asked `engine-audio.js`
// about it. The `.ssc` data was never the problem. A land engine's layers
// carry `Volume <- Distance` ramps written for a listener standing off the
// hull, an aircraft's guns hand over from `CAMG1/CAMG2` to `CAMGdist/BFMGdist`
// at 4 m so a chase camera hears the same gun as the cockpit, and `#play`
// starts every loop at a random point in its own buffer specifically so two
// Corsairs do not lock together. The machinery is multi-vehicle already; the
// page only ever gave it one.
//
// So this module is the rack: one entry per **vehicle**, claimed by the seats
// that are occupied on it. The driver's claim carries the drivetrain (and so
// the hull's Engine `.ssc`); every claim's gun groups gate that hull's gun
// patches. Two Shermans are two entries and two engine notes; a driver and a
// hull gunner in one Sherman are one entry and one note. The listener is the
// camera, wherever it is — first person, chase, fly-by, or standing on a hill
// watching a bot's tank cross a field. Distance is the data's own job
// (`Volume <- Distance`), exactly as it already is for the map's area sounds.
//
// What is NOT here, and why:
//
//   * **Hand weapons.** A bot's rifle is a different path (`playHandFire` and
//     `handFireBus`) and is still the local player's alone. Bots report their
//     shots to each other as AI hearing (`onShotFired`); the page does not yet
//     play them into the room.
//   * **Empty hulls.** An unoccupied vehicle has no drivetrain and no trigger,
//     so it has nothing to say. Its engine is off.
//   * **Voice arithmetic beyond the cap.** The cap is a budget, not a
//     reproduction of the engine's own 32-voice pool. See `MAX_LIVE_VEHICLES`.
//
// The coherence invariant of `engine-audio.js` holds across this rack without
// extra work: two voices only contest when they are the same sample, at the
// same point, at the same rate, and two hulls are never at the same point.

import {
  loadEngineAudio, findEngineSpec, findWeaponSpecs,
  findWeaponSpecsByFireArms, WEAPON_HEADROOM,
} from './engine-audio.js';

/**
 * How many occupied hulls keep a sounding graph at once.
 *
 * A Sherman's engine is 11 loops and its coax another couple of voices; five
 * live hulls is already sixty-odd buffer sources. Beyond this the *nearest*
 * hulls keep their patches and the rest are held silent (master 0) — a bot
 * convoy crossing a valley is three engines, not eleven.
 *
 * Not the engine's own mixer size. DICE packs a fixed 32-voice pool; Web
 * Audio has no such limit and this cap is about CPU and the page's limiter,
 * measured against what a level with a dozen bot-driven vehicles actually
 * asks for.
 */
export const MAX_LIVE_VEHICLES = 5;

/**
 * Past this a hull is held at master 0 even when it has a live graph.
 *
 * 300 m is beyond the longest `Volume <- Distance` ramp in the vanilla set
 * (the aircraft gun far layers end at 250). The loops stay warm — starting
 * and stopping a loop re-rolls its phase against the other layers of the
 * same patch — so a hull that drifts back into range comes up without a
 * rebuild.
 */
export const AUDIBLE_RANGE = 300;

// The longest shut-down one-shot in the vanilla set is willyenginestp at
// 1.94 s; the loops are gone 0.2 s in. Same number the single-seat path used.
export const RELEASE_MS = 2400;

const ACCEL_SMOOTHING = 5;          // 1/s

/** A FireArms node name with the scene-wide instance suffix taken off.
 *
 *  The exporter numbers the second and later copy of a vehicle across the
 *  whole level, and the numbering reaches every node inside it: the first
 *  BF109 on Kasserine fires `BF109Guns`, the second fires `BF109Guns_1`.
 *  Sound specs are per template and only ever carry the bare name. */
export function bareFireArmsName(name) {
  return String(name || '').replace(/_\d+$/, '');
}

/** Every FireArms node name under `root`, bare of the instance suffix. */
export function listSeatFireArms(root) {
  if (!root) return [];
  const names = new Set();
  root.traverse(obj => {
    if (obj.userData?.fireArms && obj.name) {
      names.add(bareFireArmsName(obj.name));
    }
  });
  return [...names];
}

/** The FireArms node under `root` a spec's bare name refers to. */
export function fireArmsNode(root, fireArms) {
  if (!root || !fireArms) return null;
  const exact = root.getObjectByName(fireArms);
  if (exact) return exact;
  let found = null;
  root.traverse(obj => {
    if (!found && obj.name && bareFireArmsName(obj.name) === fireArms) found = obj;
  });
  return found;
}

/**
 * One sounding hull. Claimed by every occupied seat on it; built once.
 *
 * `claims` is seatKey -> `{ drive, groups }`. A hull's engine comes from
 * whichever claim holds a drivetrain (there is at most one — the driver); its
 * gun patches are built once per FireArms node and gated by the union of
 * every claim's gun groups.
 */
class VehicleAudio {
  constructor(key) {
    this.key = key;
    this.node = null;
    this.claims = new Map();
    this.engineAudio = null;
    this.engineNode = null;
    this.weapons = [];
    this.built = false;
    this.building = false;
    this.want = true;
    this.engineMissing = false;
    // `Acceleration` is a control source in its own right — the Corsair's
    // right cockpit whine pitches off it — and the flight model publishes
    // velocity, not acceleration. Differenced and one-pole smoothed, per
    // hull, because two aircraft accelerating together must not share one
    // filter state.
    this.prevVelocity = null;
    this.accel = 0;
    this.worldPos = null;
    this.worldQuat = null;
  }

  get drive() {
    for (const claim of this.claims.values()) {
      if (claim.drive) return claim.drive;
    }
    return null;
  }

  /** Every gun group every seat aboard can fire. */
  get groups() {
    const list = [];
    for (const claim of this.claims.values()) {
      for (const group of claim.groups || []) list.push(group);
    }
    return list;
  }

  dispose() {
    this.engineAudio?.dispose();
    this.engineAudio = null;
    for (const weapon of this.weapons) weapon.audio.dispose();
    this.weapons = [];
    this.engineNode = null;
    this.built = false;
    this.prevVelocity = null;
    this.accel = 0;
  }

  release() {
    this.engineAudio?.release();
    for (const weapon of this.weapons) weapon.audio.release();
  }
}

/**
 * Every occupied hull's audio, built and torn down as crews board and leave.
 *
 * The host (map.html) owns the listener, the decode cache and the report; this
 * owns the graphs, their controls and the budget. `claim` is fire-and-forget
 * async — the caller does not await it — and a `releaseClaim` during a load is
 * what the generation counter is for.
 */
export class VehicleAudioRack {
  /**
   * @param {object} opts
   * @param {() => object} opts.listener  `ensureListener()`, may return null
   *   before the first gesture.
   * @param {(dir: string, relPath: string) => Promise<AudioBuffer|null>} opts.getBuffer
   * @param {() => object} opts.report   `() => extras`, the level report whose
   *   `.sounds.vehicles` the spec helpers read
   * @param {() => string} opts.dir      `() => currentDir`, for `getBuffer`
   * @param {() => number} opts.master  0..1, the page's own volume
   */
  constructor({ listener, getBuffer, report, dir, master = () => 1 }) {
    this.getListener = listener;
    this.getBuffer = getBuffer;
    this.getReport = typeof report === 'function' ? report : () => report;
    this.getDir = typeof dir === 'function' ? dir : () => dir;
    this.getMaster = master;
    this.vehicles = new Map();
    this.generation = 0;
    this.disposed = false;
  }

  /**
   * A seat came aboard `node`. Builds the hull's patches when there is
   * budget, or records the want and builds it when a nearer hull gives up its
   * slot.
   *
   * `claim` is `{ seatKey, node, template, drive, groups }`. `drive` is the
   * seat's drivetrain (null for a bare gun/seat root or a passenger); only a
   * driven seat carries an engine note. `groups` are the gun groups this seat
   * fires — `vehicleGuns` + `mannedGuns` for the player, `vehicle.groups` +
   * `vehicle.manned` for a bot.
   */
  claim(claim) {
    if (this.disposed || !claim?.node || !claim.seatKey) return;
    const key = claim.node.uuid || claim.node.name || claim.seatKey;
    let entry = this.vehicles.get(key);
    if (!entry) {
      entry = new VehicleAudio(key);
      entry.node = claim.node;
      this.vehicles.set(key, entry);
    }
    entry.want = true;
    entry.claims.set(claim.seatKey, {
      drive: claim.drive ?? null,
      groups: claim.groups ?? [],
    });
    // A driver arriving after a gunner has to be able to add the engine the
    // gunner's build skipped: tear down and let `_rebalance` rebuild with
    // the drive in place. Everything else goes through `_rebalance`, which
    // is the one place the live-hull budget is enforced.
    if (claim.drive && entry.built && !entry.engineAudio && !entry.engineMissing) {
      entry.dispose();
    }
    this._rebalance();
  }

  /** A seat left, or its crew died. The hull stays sounding while anyone
   *  remains aboard; the last one off releases, then tears down after the
   *  shut-down tail, exactly as the single-seat `stopEngineAudio` did. */
  releaseClaim(seatKey, node) {
    const key = node?.uuid || node?.name;
    const entry = (key && this.vehicles.get(key))
      || [...this.vehicles.values()].find(v => v.claims.has(seatKey));
    if (!entry) return;
    entry.claims.delete(seatKey);
    if (entry.claims.size > 0) return;
    entry.want = false;
    entry.release();
    const gen = this.generation;
    setTimeout(() => {
      if (gen !== this.generation) return;
      const live = this.vehicles.get(entry.key);
      if (!live || live.want || live.claims.size > 0) return;
      live.dispose();
      this.vehicles.delete(entry.key);
      this._rebalance();
    }, RELEASE_MS);
  }

  /** A level change: everything, now. */
  dispose() {
    this.disposed = true;
    this.generation++;
    for (const entry of this.vehicles.values()) entry.dispose();
    this.vehicles.clear();
  }

  /**
   * Give the nearest `MAX_LIVE_VEHICLES` wanted hulls a graph and hold the
   * rest. Called on every claim/release. A hull that has already been built
   * and falls out of the front of the queue is held at master 0 rather than
   * torn down — starting and stopping a loop re-rolls its phase against the
   * other layers of the same patch — so the budget caps *new* graphs and a
   * returning neighbour comes up without a rebuild.
   */
  _rebalance(listenerPos = null) {
    if (this.disposed) return;
    const want = [...this.vehicles.values()].filter(v => v.want);
    const at = listenerPos ?? this._listenerPos();
    want.sort((a, b) => this._distance(a, at) - this._distance(b, at));
    let slot = 0;
    for (const entry of want) {
      if (entry.built || entry.building) {
        slot += 1;
        continue;
      }
      if (slot < MAX_LIVE_VEHICLES) {
        this._build(entry);
        slot += 1;
      }
    }
  }

  _listenerPos() {
    const listener = this.getListener?.();
    const pos = listener?.position ?? listener?.context?.listener?.position;
    if (!pos) return null;
    return { x: pos.x ?? 0, y: pos.y ?? 0, z: pos.z ?? 0 };
  }

  _distance(entry, at) {
    if (!at || !entry.node) return 0;
    if (entry.node.updateWorldMatrix) entry.node.updateWorldMatrix(true, false);
    const e = entry.node.matrixWorld?.elements;
    if (!e) return 0;
    const dx = e[12] - at.x, dy = e[13] - at.y, dz = e[14] - at.z;
    return Math.hypot(dx, dy, dz);
  }

  /** Build one hull's engine and gun patches. Generation-guarded. */
  async _build(entry) {
    if (this.disposed || entry.built || entry.building || !entry.want) return;
    const gen = this.generation;
    const node = entry.node;
    const template = node?.userData?.control || node?.name;
    const report = this.getReport();
    entry.building = true;
    try {
      const listener = this.getListener?.();
      if (!listener || !node) return;

      // The engine. A bare gun/seat root, or a hull nobody drives, has no
      // live drivetrain and therefore no Engine `.ssc` of its own — the
      // driver's claim is the one that carries the hull's note.
      let engineAudio = null;
      let engineNode = null;
      let engineMissing = false;
      if (entry.drive) {
        const spec = findEngineSpec(report, template);
        if (spec) {
          // The voices hang off the `Engine` node the script is bound to, not
          // the vehicle origin: on a Corsair that is the propeller hub at
          // z -4.15, four metres ahead of the pilot's ear.
          engineNode = node.getObjectByName(spec.engine) || node;
          const built = await loadEngineAudio(spec, {
            listener,
            getBuffer: (relPath) => this.getBuffer(this.getDir(), relPath),
          });
          if (built) engineAudio = built;
        } else {
          // A stale scene.json and a vehicle with no Engine script are
          // otherwise indistinguishable. The guns are not the engine's to
          // lose (D6 in features/vehicle-sound-coverage): fall through and
          // build whatever gun patches the FireArms names can find.
          console.info(`no engine sound for ${template}: re-extract this map if it `
                       + 'predates the vehicle-sound pipeline');
          engineMissing = true;
        }
      }

      // The guns. Keyed on the vehicle's template first, then — for a bare
      // furniture mount, or a template missing from the report — on the
      // FireArms node names the scene itself carries.
      let specs = findWeaponSpecs(report, template);
      if (!specs.length) {
        const arms = listSeatFireArms(node);
        specs = findWeaponSpecsByFireArms(report, arms).map(found => {
          const local = arms.find(a => a === found.fireArms
                                       || a === `${found.fireArms}_unlimited`);
          return local ? { ...found, fireArms: local } : found;
        });
      }
      const weapons = [];
      for (const spec of specs) {
        const audio = await loadEngineAudio(spec, {
          listener,
          getBuffer: (relPath) => this.getBuffer(this.getDir(), relPath),
          // The gun bus keeps its own scale — measured against the hand
          // weapon it is already where it should be (D5's whole lesson).
          headroom: WEAPON_HEADROOM,
          // A gun patch is the report of one round, so its one-shots wait for
          // `trigger()` instead of firing once at setup and leaving nothing
          // behind to un-mute.
          oneShotsOnTrigger: true,
        });
        if (audio) {
          weapons.push({
            spec,
            audio,
            // The voices belong on the gun, not the vehicle origin: a
            // Corsair's guns are 2.2 m out each wing.
            node: fireArmsNode(node, spec.fireArms) || node,
          });
        }
      }

      // Decoding took several awaits; anything could have happened.
      if (gen !== this.generation || this.disposed || !entry.want
          || this.vehicles.get(entry.key) !== entry) {
        engineAudio?.dispose();
        for (const weapon of weapons) weapon.audio.dispose();
        return;
      }

      if (engineAudio) {
        engineAudio.setMaster(this.getMaster());
        engineAudio.start();
      }
      for (const weapon of weapons) {
        weapon.audio.setMaster(0);   // silent until the trigger is pulled
        weapon.audio.start();
      }
      entry.engineAudio = engineAudio;
      entry.engineNode = engineNode;
      entry.engineMissing = engineMissing;
      entry.weapons = weapons;
      entry.built = true;
      const state = entry.drive?.state;
      if (state?.velocity) {
        entry.prevVelocity = {
          x: state.velocity.x, y: state.velocity.y, z: state.velocity.z,
        };
      }
    } finally {
      entry.building = false;
    }
  }

  /**
   * The gun patch bolted to the FireArms node this group fires, or null.
   *
   * Matched on node identity first — two Shermans carry the same bare
   * `Coaxial_browning` name and a suffix-stripping fallback would hand both
   * groups the first one's patch — then on the bare name, which is what
   * catches a group whose node was rebuilt.
   */
  weaponFor(groupNode) {
    if (!groupNode) return null;
    for (const entry of this.vehicles.values()) {
      for (const weapon of entry.weapons) {
        if (weapon.node === groupNode) return weapon;
      }
    }
    const name = groupNode.name;
    const bare = bareFireArmsName(name);
    for (const entry of this.vehicles.values()) {
      for (const weapon of entry.weapons) {
        if (weapon.spec.fireArms === name || weapon.spec.fireArms === bare) {
          return weapon;
        }
      }
    }
    return null;
  }

  /** Pull the trigger on `groupNode`'s patch, if this rack holds one. */
  trigger(groupNode) {
    this.weaponFor(groupNode)?.audio.trigger();
  }

  /** One frame. `listenerPosition` is the camera. */
  update(dt, listenerPosition) {
    if (this.disposed) return;
    const master = this.getMaster();
    const at = listenerPosition
      ? { x: listenerPosition.x, y: listenerPosition.y, z: listenerPosition.z }
      : this._listenerPos();
    for (const entry of this.vehicles.values()) {
      if (!entry.built) continue;
      const near = at ? this._distance(entry, at) <= AUDIBLE_RANGE : true;
      const entryMaster = near ? master : 0;
      if (entry.engineAudio) {
        entry.engineAudio.setMaster(entryMaster);
        entry.engineAudio.update(this._engineControl(entry, dt, listenerPosition));
      }
      for (const weapon of entry.weapons) {
        const group = this._firingGroup(entry, weapon.spec.fireArms);
        // A gain gate is only meaningful for a patch that has something
        // running to gate. A gun built entirely out of one-shots is silent
        // between rounds on its own.
        weapon.audio.setMaster(
          weapon.audio.hasLoops && !group?.firing ? 0 : entryMaster);
        this._weaponControl(weapon, dt, listenerPosition);
      }
    }
  }

  /** Every `.ssc` control source one hull's engine is worth this frame. */
  _engineControl(entry, dt, listenerPosition) {
    const state = entry.drive?.state;
    if (entry.worldPos === null) {
      // Lazily allocated: most hulls are cold most of the time and a Vector3
      // each would be pure waste. Plain objects are enough — EngineAudio
      // reads `.x/.y/.z` and nothing else.
      entry.worldPos = { x: 0, y: 0, z: 0 };
      entry.worldQuat = { x: 0, y: 0, z: 0, w: 1 };
    }
    if (entry.engineNode) {
      if (entry.engineNode.updateWorldMatrix) {
        entry.engineNode.updateWorldMatrix(true, false);
      }
      const e = entry.engineNode.matrixWorld?.elements;
      if (e) {
        entry.worldPos.x = e[12]; entry.worldPos.y = e[13]; entry.worldPos.z = e[14];
        quatFromElements(e, entry.worldQuat);
      }
    }
    let speed = 0;
    let diveAngle = 0;
    if (state) {
      const v = state.velocity;
      speed = state.airspeed || (v ? Math.hypot(v.x, v.y, v.z) : 0);
      if (dt > 0 && v && entry.prevVelocity) {
        const a = Math.hypot(v.x - entry.prevVelocity.x,
                             v.y - entry.prevVelocity.y,
                             v.z - entry.prevVelocity.z) / dt;
        entry.accel += (a - entry.accel) * Math.min(1, dt * ACCEL_SMOOTHING);
        entry.prevVelocity.x = v.x;
        entry.prevVelocity.y = v.y;
        entry.prevVelocity.z = v.z;
      }
      // `Engine::DiveAngle` is read as the sine of the flight path's descent
      // angle — 1 straight down, 0.2 about 12 degrees nose-down. Inferred,
      // not read out of the data (same as the single-seat path).
      if (speed > 1 && v) diveAngle = Math.max(0, -v.y / speed);
    }
    return {
      dt,
      // The already-spooled engine value, NOT the stick. Aircraft chase the
      // pedal at Physics.con's slew rate; cars write gearbox revs; tanks
      // write the feedbackLoop load reading. Land `.ssc` scripts read the
      // same value as controlSource Default.
      rpm: state ? state.throttle : 0,
      speed,
      acceleration: entry.accel,
      diveAngle,
      position: entry.worldPos,
      quaternion: entry.worldQuat,
      listenerPosition,
    };
  }

  /** A gun patch needs none of the engine's rpm/speed/dive plumbing. */
  _weaponControl(weapon, dt, listenerPosition) {
    if (!weapon._pos) {
      weapon._pos = { x: 0, y: 0, z: 0 };
      weapon._quat = { x: 0, y: 0, z: 0, w: 1 };
    }
    if (weapon.node?.updateWorldMatrix) weapon.node.updateWorldMatrix(true, false);
    const e = weapon.node?.matrixWorld?.elements;
    if (e) {
      weapon._pos.x = e[12]; weapon._pos.y = e[13]; weapon._pos.z = e[14];
      quatFromElements(e, weapon._quat);
    }
    weapon.audio.update({
      dt,
      position: weapon._pos,
      quaternion: weapon._quat,
      listenerPosition,
    });
  }

  /**
   * The live gun group this patch belongs to, tolerating the instance suffix.
   * The hull's own claimed groups first — two Shermans must not gate each
   * other's coax — then the page's player groups, which is what the
   * single-seat path consulted.
   */
  _firingGroup(entry, fireArms) {
    const want = bareFireArmsName(fireArms);
    const matches = group => group && bareFireArmsName(group.node?.name) === want;
    return entry.groups.find(matches)
      || (this.playerGroups || []).find(matches)
      || null;
  }

  /** What the rack is doing, for headless checks. */
  snapshot() {
    const vehicles = [];
    for (const entry of this.vehicles.values()) {
      vehicles.push({
        key: entry.key,
        want: entry.want,
        built: entry.built,
        building: entry.building,
        template: entry.node?.userData?.control || entry.node?.name || null,
        driven: !!entry.drive,
        claims: entry.claims.size,
        engine: entry.engineAudio ? entry.engineAudio.snapshot() : null,
        weapons: entry.weapons.map(w => ({
          fireArms: w.spec.fireArms,
          node: w.node?.name ?? null,
          ...w.audio.snapshot(),
        })),
      });
    }
    return {
      vehicles,
      live: vehicles.filter(v => v.built).length,
      maxLive: MAX_LIVE_VEHICLES,
    };
  }
}

/** A column-major THREE matrix's upper 3x3, as a quaternion. */
function quatFromElements(m, out) {
  const t = m[0] + m[5] + m[10];
  let x, y, z, w;
  if (t > 0) {
    const s = Math.sqrt(t + 1) * 2;
    w = 0.25 * s;
    x = (m[6] - m[9]) / s; y = (m[8] - m[2]) / s; z = (m[1] - m[4]) / s;
  } else if (m[0] > m[5] && m[0] > m[10]) {
    const s = Math.sqrt(1 + m[0] - m[5] - m[10]) * 2;
    w = (m[6] - m[9]) / s; x = 0.25 * s;
    y = (m[4] + m[1]) / s; z = (m[8] + m[2]) / s;
  } else if (m[5] > m[10]) {
    const s = Math.sqrt(1 + m[5] - m[0] - m[10]) * 2;
    w = (m[8] - m[2]) / s; x = (m[4] + m[1]) / s;
    y = 0.25 * s; z = (m[9] + m[6]) / s;
  } else {
    const s = Math.sqrt(1 + m[10] - m[0] - m[5]) * 2;
    w = (m[1] - m[4]) / s; x = (m[8] + m[2]) / s;
    y = (m[9] + m[6]) / s; z = 0.25 * s;
  }
  out.x = x; out.y = y; out.z = z; out.w = w;
  return out;
}
