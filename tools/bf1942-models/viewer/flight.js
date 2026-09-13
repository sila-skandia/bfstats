// Flying a Refractor vehicle that is already standing in an extracted map.
//
// The map scene already contains real vehicles: `extract_map.py` resolves every
// `ObjectSpawner` to the template its team actually gets and assembles it with
// the same assembler the model browser uses, so a Wake scene ships a Corsair at
// its spawn point with its cockpit mesh, its camera node, and a `rig` extra on
// every input-driven part. Nothing here extracts anything; it drives what is
// already in the glb.
//
// Three layers, with a deliberate seam between them, because the end goal is
// replaying captured rounds rather than only flying locally:
//
//   input source  ->  VehicleState  ->  presentation (rig, camera, audio)
//
// `VehicleState` is the only thing the presentation layer reads. A replay can
// write it directly, or write `inputs` and let the flight model integrate; the
// control surfaces, the cockpit camera and the engine note cannot tell the
// difference and must never learn to.

import * as THREE from 'three';
import { GLTFLoader } from './vendor/loaders/GLTFLoader.js';

// --- Refractor rig ---------------------------------------------------------
//
// Ported from the model browser's rig runtime (`index.html`, `--- Refractor
// rig ---`). A RotationalBundle is not an animation clip: it declares an axis,
// a range and a player input, and the engine drives it every frame.

const AXIS = { yaw: 'y', pitch: 'x', roll: 'z' };

// Same handedness fix the exporter applies to authored rotations: mirroring Z
// conjugates rotations about X and Y and leaves those about Z alone.
const SIGN = { yaw: -1, pitch: -1, roll: 1 };

const GEAR_INPUT = 'c_PILandingGear';

// An axis with no declared range traverses freely; show it over a full circle.
const FREE_RANGE = 180;

// A player input belongs to a seat, not to a vehicle: a bomber's rear gunner
// has his own `c_PIMouseLookY`. Keying on the bare input name welds them.
const keyOf = (control, input) => `${control}/${input}`;

/**
 * The signed direction an axis deflects for a positive input.
 *
 * This is the whole aileron story. `CorsairFlapLeftOuter` and
 * `CorsairFlapRightOuter` declare identical `setMinRotation 0/-30/0`,
 * `setMaxRotation 0/30/0`, `setMaxSpeed 0/120/0` and the same
 * `setInputToPitch c_PIRoll`. The *only* thing that makes one go up while the
 * other goes down is the sign of `setAcceleration` — `0/-120/0` on the left,
 * `0/120/0` on the right. The elevators, which must move together, both carry
 * `0/-60/0`.
 *
 * So the mirroring is authored config, not engine behaviour. Our extractor used
 * to drop it — `con.py` parsed setMinRotation/setMaxRotation/setMaxSpeed and had
 * no setAcceleration case — which welded every aileron pair into deflecting the
 * same way. It now emits `direction` per axis. A scene extracted before that
 * simply has no `direction`, reads as +1, and behaves as it did before.
 */
function axisDirection(spec) {
  if (typeof spec.direction === 'number' && spec.direction !== 0) {
    return Math.sign(spec.direction);
  }
  if (typeof spec.acceleration === 'number' && spec.acceleration !== 0) {
    return Math.sign(spec.acceleration);
  }
  return 1;
}

/** Degrees a position-driven axis sits at, for a deflection in -1..1. */
function axisAngle(spec, input) {
  const t = input * axisDirection(spec);
  if (spec.free) return t * FREE_RANGE;
  // min is the deployed pose and max the retracted one — a pose pair, not an
  // ordered range (a Spitfire leg deploys at 0 and retracts to -79). Gear runs
  // 0..1, never -1..1, so it interpolates rather than splitting about zero.
  if (spec.input === GEAR_INPUT) return spec.min + input * (spec.max - spec.min);
  return t < 0 ? -t * spec.min : t * spec.max;
}

/**
 * A part whose declared rig we drive, with the rest pose it was authored in.
 * The base quaternion must be captured before anything touches the node, or
 * every re-attach compounds the previous frame's deflection.
 */
class RiggedPart {
  constructor(node, rig) {
    this.node = node;
    this.base = node.quaternion.clone();
    this.axes = rig.axes;
    this.control = rig.control || 'vehicle';
    // An Engine's spin is declared on the Engine but does not happen there.
    // Refractor stops it at every `hasMobilePhysics 1` boundary — a Corsair's
    // landing gear hangs off its Engine without turning with the propeller —
    // so rotating the Engine node, which is where the rig sits, would swing
    // the gear, the wheels and the bay hatches around the prop shaft.
    //
    // `assemble.py` already decides which children the spin reaches (it needs
    // the same answer to bake clips for the model browser) and stamps them
    // `spinsWithEngine`. Collect them, and fall back to the node itself, which
    // is right for an Engine that *is* the propeller — a carrier's screws —
    // and for scenes extracted before the flag existed.
    this.spun = [];
    for (const child of node.children) {
      if (child.userData?.spinsWithEngine) this.spun.push(child);
    }
    if (!this.spun.length) this.spun.push(node);
    this.spunBases = this.spun.map(n => n.quaternion.clone());
  }
}

// --- cockpit interior ------------------------------------------------------
//
// A vehicle glb has no inside. `1P_Corsair` and the fuselage that hides it are
// two alternatives of one LodObject, so the ordinary export picks the fuselage
// and `assemble.py` skips every `1P*` mesh outright — see
// `geometry_is_first_person` there for the three reasons, all of which still
// hold for a browse thumbnail and for a baked level.
//
// So the interior ships as its own file, `models/<Control>.cockpit.glb`, built
// by `extract_models.py --cockpit`. It is a graft rather than a model: the same
// template walk, pruned to the branches that reach first-person geometry, so
// every node above the interior keeps the name and the local transform it has
// in the ordinary export. Attaching it is therefore a name match and a
// reparent — no offsets to maintain in two places.
//
// A separate file rather than an extra node in the vehicle, for three reasons:
// a level bake would otherwise carry an interior for all 32 of Wake's spawners
// when at most one is ever flown; the browse thumbnails and the shipped map
// scenes stay byte-identical, so nothing has to be re-extracted; and a
// flythrough that never enters the cockpit never pays for it.

/**
 * One LodObject whose first-person alternative has been grafted onto the
 * flown vehicle — Refractor's cockpit swap, reproduced.
 *
 * The engine picks between the alternatives with a `LodSelectorTemplate`, and
 * `assemble.py` stamps the declared thresholds on the node. For the 33 vanilla
 * cockpits they are strikingly uniform: `DistCompareSelector`, exterior first,
 * interior second, `addLodComparison 0.5` against what can only be a 0/1
 * "the observer is the occupant, in inside view" scalar. The companion
 * `addLodDistance` is not the deciding term — it runs from 0.5 m on the M10 to
 * 200 m on the battleship gun, tracking the size of the object rather than any
 * view, and the Chi-ha omits it entirely. It reads as a precondition on the
 * occupancy test, and it cannot veto for an observer sitting at the eye point.
 *
 * So the comparison is the gate, and for a viewer with exactly one observer
 * that gate is simply: are we in the cockpit.
 */
class CockpitSwap {
  constructor(host, interior, hidden, spec) {
    this.host = host;
    this.interior = interior;
    this.hidden = hidden;
    this.spec = spec;
  }

  apply(firstPerson) {
    for (const node of this.interior) node.visible = firstPerson;
    for (const node of this.hidden) node.visible = !firstPerson;
  }
}

/**
 * Where `<Control>.cockpit.glb` lives, given no word from the page.
 *
 * `mods.js` puts a mod's assets in a sibling subtree of vanilla's classic one,
 * `models/mods/<id>/`, and carries the choice in `?mod=`. Reading that here
 * rather than importing `selectMod` keeps this module out of the nav-drawing
 * business; a page that resolves the mod properly can pass `modelsBase` and
 * override it.
 */
function defaultModelsBase() {
  const mod = new URLSearchParams(location.search).get('mod');
  const path = mod && mod !== 'bf1942' ? `models/mods/${mod}/` : 'models/';
  return new URL(path, import.meta.url).href;
}

const cockpitLoader = new GLTFLoader();

// --- the vehicle -----------------------------------------------------------

/**
 * Everything the presentation layer is allowed to read.
 *
 * Kept as plain data rather than as `Object3D` transforms precisely so a replay
 * frame can overwrite it wholesale. `inputs` is the commanded stick position in
 * -1..1 per `c_PI*` name; `surfaces` is where those surfaces have actually got
 * to, which lags `inputs` because the engine rate-limits deflection.
 */
export class VehicleState {
  constructor() {
    this.position = new THREE.Vector3();
    this.orientation = new THREE.Quaternion();
    this.velocity = new THREE.Vector3();
    this.angularVelocity = new THREE.Vector3();
    /** Commanded input, -1..1 (or 0..1 for gear/throttle). */
    this.inputs = new Map();
    /** Actual surface deflection, -1..1, rate-limited toward `inputs`. */
    this.surfaces = new Map();
    /** Propeller revolutions accumulated, degrees. */
    this.propellerAngle = 0;
    /** 0..1, what the engine note and the propeller blur key off. */
    this.throttle = 0;
    this.airspeed = 0;
    this.grounded = false;
    this.destroyed = false;
  }
}

/**
 * One flyable vehicle: the scene node, its rig, its cockpit camera, its state.
 *
 * Construction is cheap and synchronously side-effect free apart from the
 * reparent, so a replay can instantiate several and step them all. The one
 * asynchronous thing it starts is the cockpit fetch; await `cockpitReady` if
 * you need the interior in a particular frame (a screenshot does, a player
 * does not — it pops in a few hundred ms after entering the seat).
 */
export class Vehicle {
  /**
   * @param {THREE.Object3D} node   the assembled vehicle root from the map glb
   * @param {THREE.Object3D} parent where to reparent it to (usually the scene)
   * @param {{modelsBase?: string, cockpit?: boolean}} [options]
   */
  constructor(node, parent, options = {}) {
    this.node = node;
    this.state = new VehicleState();
    this.control = node.userData?.control || node.name || 'vehicle';

    // Reparent out of the `spawners` group, preserving the world transform.
    // Two reasons, both load-bearing: `applyVisibility()` sets
    // `spawnersRoot.visible = optVehicles.checked`, so the plane you are flying
    // would vanish when that box is unticked; and it per-child distance-culls
    // against the *camera*, which in a cockpit view is the plane itself.
    if (parent && node.parent !== parent) {
      node.updateWorldMatrix(true, false);
      const world = node.matrixWorld.clone();
      parent.add(node);
      node.matrix.copy(world);
      node.matrix.decompose(node.position, node.quaternion, node.scale);
    }
    // A spawner vehicle beyond the draw distance was already switched off by
    // the viewer's per-vehicle cull, and once it leaves `spawners` nothing will
    // ever switch it back on. Taking ownership means taking it off every
    // visibility list, so it has to be made visible explicitly.
    node.visible = true;

    this.state.position.copy(node.position);
    this.state.orientation.copy(node.quaternion);
    // The spawn pose, kept so `reset()` can put the plane back on the strip.
    node.userData.spawnPosition = node.position.clone();
    node.userData.spawnOrientation = node.quaternion.clone();

    this.parts = [];
    this.cameraNode = null;
    this.propellerNodes = [];
    this.collect();

    // Occupying a seat is what the cockpit swap keys off, and the only reason
    // to build a `Vehicle` is that someone is now sitting in it.
    this.firstPerson = true;
    // Whether being driven counts as being in the cockpit.
    //
    // The engine's own gate is an occupancy scalar, and a page with a single
    // camera has no other way to express it: `map.html` has one view, the
    // pilot's, and nothing on the vehicle can see its "pilot the plane" tick
    // box. So stepping the flight model means occupied and `reset()` means the
    // seat was vacated — which keeps a plane you have stopped flying from
    // sitting on the strip with its fuselage swapped out.
    //
    // A page that grows a chase camera knows better than this and should turn
    // it off, then drive `setFirstPerson` from its own camera mode.
    this.autoFirstPerson = true;
    this.swaps = [];
    this.cockpitReady = options.cockpit === false
      ? Promise.resolve(null)
      : this.loadCockpit(options.modelsBase);
  }

  /**
   * Fetch this vehicle's first-person interior and graft it on.
   *
   * A vehicle with no cockpit export is not an error: most ground vehicles
   * have no `1P_*` mesh at all, and an asset tree published before cockpits
   * existed has none for anything. Either way the 404 leaves the vehicle
   * exactly as it was.
   */
  async loadCockpit(modelsBase) {
    const base = modelsBase || defaultModelsBase();
    const url = new URL(`${this.control}.cockpit.glb`, base).href;
    try {
      const gltf = await cockpitLoader.loadAsync(url);
      return this.attachCockpit(gltf.scene);
    } catch {
      return null;
    }
  }

  /**
   * Move the interior out of the cockpit glb and into this vehicle's own tree.
   *
   * Matching is by node name, which works because the cockpit export is the
   * same template walk pruned rather than a separate authoring of the same
   * geometry: `lodCorsairCockpit` means the same node in both files, at the
   * same place, so the interior lands where the engine puts it without this
   * module knowing a single offset.
   *
   * Only the flown seat's swaps are taken. A B17 ships five — the pilot's
   * cockpit plus a 1P mesh for each gunner station's turret and gun — and each
   * carries the `control` of the nested PlayerControlObject it belongs to.
   * Grafting another seat's would hang a Browning in mid-air behind the pilot.
   * When seat switching arrives, the filter is where it changes.
   */
  attachCockpit(root) {
    const byName = new Map();
    this.node.traverse(obj => {
      if (obj.name && !byName.has(obj.name)) byName.set(obj.name, obj);
    });

    const sources = [];
    root.traverse(obj => {
      if (obj.userData?.lodAlternative) sources.push(obj);
    });
    for (const source of sources) {
      const spec = source.userData.lodAlternative;
      if ((source.userData.control || '') !== this.control) continue;
      const host = byName.get(source.name);
      if (!host) continue;
      // `children` is live while reparenting, so snapshot it first.
      const interior = [...source.children];
      for (const child of interior) host.add(child);
      const hidden = (spec.replaces || [])
        .map(name => byName.get(name))
        .filter(Boolean);
      this.swaps.push(new CockpitSwap(host, interior, hidden, spec));
    }
    if (!this.swaps.length) return null;

    // The grafted subtree brings its own rig extras (the SBD's gunner mount is
    // a RotationalBundle), so re-index rather than leaving them frozen.
    this.collect();
    this.setFirstPerson(this.firstPerson);
    return this;
  }

  /** Show the interior or the exterior, at every grafted LodObject. */
  setFirstPerson(on) {
    this.firstPerson = !!on;
    for (const swap of this.swaps) swap.apply(this.firstPerson);
    return this.firstPerson;
  }

  /**
   * Index the rig parts, the cockpit camera and the propeller.
   *
   * Re-entrant: the cockpit arrives after the aircraft may already be flying,
   * and a `RiggedPart` captures its node's rest pose on construction. Building
   * a fresh one for a surface that is currently deflected would bake that
   * deflection in as the new neutral, so parts already indexed are kept.
   */
  collect() {
    const indexed = new Map(this.parts.map(part => [part.node, part]));
    this.parts.length = 0;
    this.propellerNodes.length = 0;
    this.node.traverse(obj => {
      const data = obj.userData || {};
      if (data.rig?.axes) this.parts.push(indexed.get(obj) || new RiggedPart(obj, data.rig));
      // `CorsairCamera`: an empty node the exporter stamps with
      // `templateKind: "Camera"` and `cameraView`, sitting at the pilot's eye
      // point in the vehicle's own frame. That is first person, for free.
      if (!this.cameraNode && (data.cameraView || data.templateKind === 'Camera')) {
        this.cameraNode = obj;
      }
      if (/propeller/i.test(obj.name || '')) this.propellerNodes.push(obj);
    });
  }

  input(name) {
    return this.state.inputs.get(name) ?? 0;
  }

  setInput(name, value) {
    this.state.inputs.set(name, value);
  }

  /**
   * Move each surface toward its commanded input at the rate the config allows.
   *
   * `setMaxSpeed` is in degrees per second over the part's own range, so the
   * normalised rate is maxSpeed divided by the half-range the input spans.
   * `setAutomaticReset 1` is what centres a stick surface when you let go; a
   * landing gear has it 0 and simply holds wherever it was commanded.
   */
  advanceSurfaces(dt) {
    const { surfaces } = this.state;
    for (const part of this.parts) {
      for (const [axis, spec] of Object.entries(part.axes)) {
        if (spec.driver === 'rate') continue;
        const key = `${keyOf(part.control, spec.input)}/${axis}`;
        const target = this.input(spec.input);
        const current = surfaces.get(key) ?? 0;
        if (current === target) continue;
        const span = spec.free
          ? FREE_RANGE
          : Math.max(Math.abs(spec.min ?? 0), Math.abs(spec.max ?? 0)) || 1;
        const rate = Math.abs(spec.maxSpeed || span) / span;
        const step = rate * dt;
        const delta = target - current;
        surfaces.set(key, Math.abs(delta) <= step ? target : current + Math.sign(delta) * step);
      }
    }
  }

  /**
   * Accumulate the propeller.
   *
   * The Engine template's roll axis spans -3000..5000 with `setMaxSpeed 500`,
   * which the assembler's `browse_rig` already classifies as a `rate` driver:
   * throttle sets how fast the drivetrain turns, not where it stops.
   */
  advancePropeller(dt) {
    this.state.propellerAngle += this.state.throttle * 360 * 6 * dt;
  }

  /** Write the rig onto the scene graph. Read-only with respect to state. */
  applyRig() {
    const { surfaces } = this.state;
    for (const part of this.parts) {
      // Position axes pose the part itself; a rate axis is an Engine's spin and
      // lands on whichever children it actually reaches (see `RiggedPart`).
      const q = part.base.clone();
      const spin = new THREE.Quaternion();
      let spinning = false;
      for (const [axis, spec] of Object.entries(part.axes)) {
        const e = new THREE.Euler(0, 0, 0);
        if (spec.driver === 'rate') {
          e[AXIS[axis]] = THREE.MathUtils.degToRad(this.state.propellerAngle * SIGN[axis]);
          spin.multiply(new THREE.Quaternion().setFromEuler(e));
          spinning = true;
          continue;
        }
        const key = `${keyOf(part.control, spec.input)}/${axis}`;
        e[AXIS[axis]] = THREE.MathUtils.degToRad(
          axisAngle(spec, surfaces.get(key) ?? 0) * SIGN[axis]);
        q.multiply(new THREE.Quaternion().setFromEuler(e));
      }
      part.node.quaternion.copy(q);
      if (!spinning) continue;
      // Pre-multiplied: the spin is about the Engine's axis, which the child
      // sees outside its own authored rotation. Same convention as the baked
      // clips' `frame: "parent"`.
      part.spun.forEach((node, i) => {
        if (node === part.node) node.quaternion.copy(q).multiply(spin);
        else node.quaternion.copy(spin).multiply(part.spunBases[i]);
      });
    }
  }

  /** Push `state` onto the scene node. */
  applyTransform() {
    this.node.position.copy(this.state.position);
    this.node.quaternion.copy(this.state.orientation);
    this.node.updateMatrixWorld(true);
  }

  /**
   * The cockpit eye pose, in world space.
   *
   * Falls back to a point above and behind the vehicle when the template has no
   * camera node, which is most ground vehicles and every ship.
   */
  cameraPose(target = { position: new THREE.Vector3(), quaternion: new THREE.Quaternion() }) {
    if (this.cameraNode) {
      this.cameraNode.getWorldPosition(target.position);
      this.cameraNode.getWorldQuaternion(target.quaternion);
    } else {
      target.position.set(0, 3, -12).applyQuaternion(this.state.orientation).add(this.state.position);
      target.quaternion.copy(this.state.orientation);
    }
    return target;
  }
}

// --- flight model ----------------------------------------------------------
//
// PROVISIONAL. The authoritative parameter semantics are being established in
// `features/flyable-vehicles/flight-model.md`; in particular it is not yet
// settled whether the engine derives roll torque *aerodynamically* from the
// asymmetric lift of deflected ailerons or applies angular rate directly from
// the input and merely animates the surfaces. This implements the latter,
// because it is the behaviour a 2002 arcade flight model almost certainly had
// and because it is stable at 60 Hz without an implicit solver. Swapping it is
// contained to `Aircraft.integrate` — nothing outside reads anything but
// `VehicleState`.
//
// Frame, measured off the extracted Wake scene rather than assumed: the
// Corsair's propeller sits at local z = -4.15 and its rudder at z = +2.65, and
// its left wing at x = -4.13 against the right at x = +4.16. So the vehicle's
// own frame is -Z forward, +Y up, +X starboard — the ordinary glTF convention,
// because the exporter's Z mirror has already resolved Refractor's handedness.
const FORWARD = new THREE.Vector3(0, 0, -1);
const UP = new THREE.Vector3(0, 1, 0);
const RIGHT = new THREE.Vector3(1, 0, 0);

/**
 * Corsair numbers. Every one of these is either read from `Physics.con` or
 * marked as a fitted stand-in awaiting the flight-model research.
 */
export const CORSAIR = {
  thrust: 15,             // m/s^2 peak — `setTorque 15` [data]
  // `setNoPropellerEffectAtSpeed 70`: thrust fades linearly to nothing at this
  // airspeed, which is what actually sets top speed rather than any declared
  // maximum. Level flight settles near 55 m/s once drag matches the faded
  // thrust — the raft declares 15 here, the PT boat 150, a rocket 1000. [data]
  thrustFadeSpeed: 70,
  cruiseSpeed: 55,        // where faded thrust balances drag; control authority reference
  drag: 0.0652,           // linear, s^-1 [data]
  gravity: 9.81,
  // The two inner wings are lift *regulators*: `setRegulateToLift 4.91` on each
  // — exactly g/2, so the pair holds precisely 1 g and the aircraft flies on
  // rails. They saturate at their +-2 degree travel, and below roughly 25 m/s
  // they can no longer find the lift. That is BF1942's entire stall model.
  regulateToLift: 4.905,
  stallSpeed: 25,
  // Lift accel per radian of angle of attack per (m/s). K_LIFT in the spec,
  // calibrated so the regulators saturate at the stall speed. [free]
  liftSlope: 1.4,
  aoaClamp: 0.35,         // rad — per-surface lift saturation [free]
  // Tuning targets from the surveyed data: full-stick roll 180-220 deg/s at
  // cruise, sustained loop about 40 deg/s. Expressed here as body rates
  // because this model applies them directly rather than deriving them from
  // each surface's off-centre lift; see the header note.
  rollRate: 200,
  pitchRate: 42,
  yawRate: 16,
  // `setMaxSpeed 500` over the engine's 5000-degree accumulator is a tenth of
  // the range per second, i.e. a ten-second spool from idle to full.
  throttleRate: 0.1,
  // Gear is not a player input. It retracts on altitude and engine input
  // thresholds; see input-and-cockpit.md.
  gearUpAltitude: 25,
  gearDownAltitude: 23,
};

/** An aircraft: a `Vehicle` plus the model that turns inputs into state. */
export class Aircraft extends Vehicle {
  /**
   * @param {{spec?: object, modelsBase?: string, cockpit?: boolean}} [options]
   */
  constructor(node, parent, options = {}) {
    super(node, parent, options);
    this.spec = options.spec || CORSAIR;
    this.groundHeight = () => -Infinity;
    // Airborne-from-rest would just belly-flop; a plane parked on the strip has
    // its gear down and no airspeed, which is the honest starting state.
    this.state.inputs.set('c_PILandingGear', 0);
  }

  /**
   * One step. Order matters: surfaces move toward their command first, then the
   * model reads where the surfaces *actually* are, so a slammed stick still
   * takes the config's declared time to become a control moment.
   */
  integrate(dt) {
    const s = this.state;
    const k = this.spec;
    if (this.autoFirstPerson && !this.firstPerson) this.setFirstPerson(true);
    this.advanceSurfaces(dt);

    // Throttle spools rather than steps.
    const wanted = Math.max(0, Math.min(1, this.input('c_PIThrottle')));
    const gap = wanted - s.throttle;
    const spool = k.throttleRate * dt;
    s.throttle = Math.abs(gap) <= spool ? wanted : s.throttle + Math.sign(gap) * spool;
    this.advancePropeller(dt);

    const fwd = FORWARD.clone().applyQuaternion(s.orientation);
    const up = UP.clone().applyQuaternion(s.orientation);
    const right = RIGHT.clone().applyQuaternion(s.orientation);

    // Body rates from where the surfaces have actually got to. Authority scales
    // with airspeed: a stationary plane's stick does nothing, which is why you
    // have to roll down the strip before you can rotate.
    const speed = s.velocity.length();
    s.airspeed = speed;
    // Control authority scales with airspeed: a parked plane's stick does
    // nothing, which is why you have to roll down the strip before you can
    // rotate. Referenced to cruise, so full-stick at cruise gives the surveyed
    // roll and pitch rates.
    const q = Math.min(1.4, (speed / k.cruiseSpeed) ** 2);
    const deflect = input => {
      // Surfaces are keyed per control/input/axis; any one of a mirrored pair
      // reports the same magnitude, so the first match is the deflection.
      for (const [key, value] of s.surfaces) {
        if (key.includes(`/${input}/`)) return value;
      }
      return 0;
    };
    const rate = new THREE.Vector3(
      THREE.MathUtils.degToRad(-deflect('c_PIPitch') * k.pitchRate) * q,
      THREE.MathUtils.degToRad(-deflect('c_PIYaw') * k.yawRate) * q,
      THREE.MathUtils.degToRad(-deflect('c_PIRoll') * k.rollRate) * q,
    );
    s.angularVelocity.copy(rate);
    if (rate.lengthSq() > 0) {
      const spin = new THREE.Quaternion().setFromEuler(
        new THREE.Euler(rate.x * dt, rate.y * dt, rate.z * dt, 'XYZ'));
      s.orientation.multiply(spin).normalize();
    }

    // Forces.
    const accel = new THREE.Vector3();

    // Thrust fades to nothing at `setNoPropellerEffectAtSpeed`, so top speed is
    // where the faded thrust meets linear drag rather than a declared cap.
    const forwardSpeed = s.velocity.dot(fwd);
    const fade = Math.max(0, Math.min(1, 1 - forwardSpeed / k.thrustFadeSpeed));
    accel.addScaledVector(fwd, k.thrust * s.throttle * fade);

    // Lift: the regulator pair holding 1 g, plus what angle of attack adds. The
    // regulator is what makes the aircraft self-levelling; the alpha term is
    // what lets it turn, and what makes it stop flying when the nose gets too
    // far from the flight path.
    let alpha = 0;
    if (speed > 1) {
      const flow = s.velocity.clone().divideScalar(speed);
      alpha = Math.asin(Math.max(-1, Math.min(1, -flow.dot(up))));
    }
    const authority = Math.min(1, (speed / k.stallSpeed) ** 2);
    const regulated = k.regulateToLift * 2 * authority;
    const alphaLift = k.liftSlope
      * Math.max(-k.aoaClamp, Math.min(k.aoaClamp, alpha)) * speed;
    accel.addScaledVector(up, Math.min(regulated + alphaLift, k.gravity * 6));

    accel.y -= k.gravity;
    accel.addScaledVector(s.velocity, -k.drag);

    s.velocity.addScaledVector(accel, dt);

    // A wing only makes lift along its own direction of travel; without this
    // the plane slides sideways through a turn like a hovercraft. Bleeding the
    // lateral component toward the nose is the cheap stand-in for side drag.
    if (speed > 1) {
      const along = fwd.clone().multiplyScalar(s.velocity.dot(fwd));
      s.velocity.lerp(along.setLength(Math.max(along.length(), 0.001)), Math.min(1, 2.2 * dt));
    }

    s.position.addScaledVector(s.velocity, dt);

    // Ground. Real collision against buildings is a separate problem; this is
    // only the heightfield and the sea, so the plane cannot fall through Wake.
    const floor = this.groundHeight(s.position.x, s.position.z);
    if (Number.isFinite(floor) && s.position.y < floor + 1.2) {
      s.position.y = floor + 1.2;
      if (s.velocity.y < 0) s.velocity.y = 0;
      s.grounded = true;
    } else {
      s.grounded = false;
    }

    // Gear is automatic in the real game, on altitude thresholds.
    const agl = s.position.y - (Number.isFinite(floor) ? floor : 0);
    const gear = this.input('c_PILandingGear');
    if (gear < 1 && agl > k.gearUpAltitude) this.setInput('c_PILandingGear', 1);
    else if (gear > 0 && agl < k.gearDownAltitude) this.setInput('c_PILandingGear', 0);

    this.applyTransform();
    this.applyRig();
  }

  /** Park the aircraft on the strip at its spawn, nose level, and step out. */
  reset() {
    if (this.autoFirstPerson) this.setFirstPerson(false);
    const s = this.state;
    s.velocity.set(0, 0, 0);
    s.throttle = 0;
    s.airspeed = 0;
    s.propellerAngle = 0;
    s.surfaces.clear();
    s.inputs.clear();
    s.inputs.set('c_PILandingGear', 0);
    s.position.copy(this.node.userData.spawnPosition || s.position);
    s.orientation.copy(this.node.userData.spawnOrientation || s.orientation);
  }
}

// --- discovery -------------------------------------------------------------

/**
 * Vehicles in a loaded map scene that we could plausibly fly or drive.
 *
 * The exporter groups spawned vehicles under a `spawners` node and stamps each
 * with `templateKind: "PlayerControlObject"` and a `control` naming the
 * template, so this needs no per-map table.
 */
export function findVehicles(root) {
  const found = [];
  root.traverse(obj => {
    if (obj.userData?.templateKind !== 'PlayerControlObject') return;
    // Only spawner-placed vehicles; the stationary Defguns and Brownings that
    // share the class are map furniture.
    let parent = obj.parent;
    while (parent && parent.name !== 'spawners') parent = parent.parent;
    if (!parent) return;
    found.push(obj);
  });
  return found;
}

/** The first vehicle whose control name matches, e.g. `Corsair`. */
export function findVehicle(root, name) {
  return findVehicles(root).find(
    obj => (obj.userData?.control || obj.name || '').toLowerCase() === name.toLowerCase(),
  ) || null;
}
