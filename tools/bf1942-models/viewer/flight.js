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
  // NOT 9.81. `BasicPhysicsSystem`'s constructor (retail client, 0x00578f00)
  // seeds its gravity field with the literal 0xC16BAE14 = -14.7295, and nothing
  // in a map load path ever writes it again: all 31 xrefs to the singleton are
  // accounted for and the only `setGravity` callers are the chat cheats
  // (EarthWalk -10, MoonWalk -1.67, SpaceWalk -0.1) and the console property.
  // `physics.gravity` appears in no vanilla file, so the default is the value.
  //
  // The data agrees once you stop assuming: `setRegulateToLift 4.91` is g/3, not
  // g/2 — 14.7295/3 = 4.9098, which is what 4.91 is a rounding of — and the SBD,
  // which carries three regulators, therefore budgets exactly 1 g of regulated
  // lift. See features/flyable-vehicles/flight-model.md section 2c.
  //
  // Kept local on purpose. `viewer/physics.js` is growing a shared constants
  // module; when it lands this should read from it rather than declaring its own
  // g, and `gunfire.js`'s own GRAVITY with it.
  gravity: 14.7295,
  // The two inner wings are lift *regulators*: `setRegulateToLift 4.91` each, so
  // the pair holds 9.82 — two thirds of g, not all of it. A fighter makes the
  // last third passively, off the +0.5 degree `setPitchOffset` incidence its
  // wingLift surfaces carry (`incidence` below), which is why a Corsair holds
  // altitude hands-off at cruise and sinks when it is slow. The regulators
  // saturate at their +-2 degree travel below `regulatorSpeed`.
  regulateToLift: 4.91,
  // Where 4 (flapLift) x 2 deg x K_LIFT x v stops reaching 4.91 — see the
  // calibration in flight-model.md section 9. Hands-off sink starts higher,
  // near 17 m/s, because the incidence term gives out before the regulators do.
  regulatorSpeed: 12.4,
  // `setPitchOffset`, degrees: the static incidence on every lifting surface
  // (0.5 in 53 of 54 vanilla uses), so a wing lifts at zero body attitude. [data]
  incidence: 0.5,
  // Lift accel per radian of surface angle per (m/s). The lumped whole-aircraft
  // stand-in for the spec's per-surface K_LIFT = 2.83: K_LIFT x the 3.7 of
  // wingLift the Corsair's two outer wings carry at incidence. Calibrated so
  // regulators + incidence come to exactly g at the speed the model cruises at
  // (53.7 m/s), which is the same "level flight is hands-off" target the old
  // 1.4 met when the regulators alone were believed to make 1 g. [free]
  liftSlope: 10.48,
  // rad — per-surface lift saturation. 8 degrees, set so a full back-stick pull
  // at cruise runs into the 6 g ceiling below rather than blowing past it; the
  // old 0.35 was loose against a slope a seventh as stiff. [free]
  aoaClamp: 0.14,
  // Nose rates, not flight-path rates. Expressed here as body rates because
  // this model applies them directly rather than deriving them from each
  // surface's off-centre lift; see the header note. `rollRate` still meets the
  // surveyed 180-220 deg/s at cruise (measured 191). `pitchRate` is left where
  // it was, but the loop it used to imply is gone: at the corrected gravity a
  // Corsair's thrust-to-weight is 1.02, so a 42 deg/s pull from level cruise is
  // energy-limited and hangs before it comes over the top. It loops from a dive
  // entry. flight-model.md section 9b has the energy arithmetic and says which
  // constant to suspect if the real game disagrees.
  rollRate: 200,
  pitchRate: 42,
  yawRate: 16,
  // How hard the airflow pushes the nose back onto the flight path: radians of
  // nose travel per second per radian of flow angle, referenced to cruise.
  //
  // The per-surface model gets this for nothing. The two elevators sit 3.539 m
  // behind the CoM carrying `wingLift 0.5` each and no incidence, so flow that
  // stops coming down the fuselage makes lift on a long lever and `r x F` puts
  // the nose back. A lumped model has to name it, and until it did there was no
  // moment anywhere in this file that could move the nose except the stick.
  //
  // Solved rather than dialled in, and it comes out the same number twice. See
  // flight-model.md section 9d; both are the section 8 surface table and the
  // section 8 inertia estimate, no new data.
  //
  //   aerodynamic:  omega = sqrt(m K sum(wingLift) v* r / I_pitch) = 8.17 rad/s,
  //                 a quarter period of 0.192 s  ->  5.20
  //   stick:        full elevator at cruise should trim to exactly the angle
  //                 AOA_CLAMP saturates at, which is what section 9a sized that
  //                 clamp for:  pitchRate / AOA_CLAMP = 0.733 / 0.14  ->  5.24
  //
  // 7 is where a 0.1 s frame (`map.html` clamps `THREE.Clock` there) starts to
  // over-rotate a tail-slide; 5.24 is inside that with room. [free]
  weathervane: 5.24,
  // The same, in yaw, and it is softer because the aircraft is: the rudder's
  // 2.649 m lever and the body fin's 0.1 m work against a yaw inertia nearly
  // three times the pitch one. omega = 4.36 rad/s -> 2.78. A single gain for
  // both axes would have made a Corsair as stiff in yaw as in pitch, which the
  // surface table plainly says it is not. [free]
  weathervaneYaw: 2.78,
  // Side drag, s^-1. The surfaces mounted rolled -90 degrees — the rudder at
  // `wingLift 1` and the body's vertical fin at 2 — make their lift sideways,
  // and for a small sideslip the airspeed cancels out of it: K_LIFT x wingLift
  // x (u/v) x v is K_LIFT x wingLift x u, a plain rate on the lateral velocity
  // with no speed term left. 2.83 x 3 = 8.49. Without it the aircraft slides
  // through a turn like a hovercraft. [free, but only K_LIFT is free in it]
  slipDamp: 8.49,
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

    // Where the flight path is, relative to where the nose is pointing. Read
    // once: the lift below needs `alpha`, and the nose needs both.
    //
    // `atan2` rather than the `asin` this used to be, because the two disagree
    // exactly where it matters. `asin(-flow . up)` folds at 90 degrees, so an
    // aircraft sliding backwards down its own fuselage reads as zero angle of
    // attack and gets no restoring moment at all; `atan2` reads that as 180
    // degrees and flips it over, which is the only reason backward flight
    // cannot become a resting state. For a nose within a few degrees of the
    // flight path — every ordinary frame — the two are the same number.
    /** Nose to flight path in the symmetry plane, signed, over +-180. */
    let alpha = 0;
    /** The same angle as a wing sees it: folded at +-90, because a surface
     *  flown backwards is at no angle to the flow, not at a huge one. */
    let alphaWing = 0;
    /** Sideslip, the yaw axis's equivalent of `alpha`. */
    let beta = 0;
    if (speed > 1) {
      const flow = s.velocity.clone().divideScalar(speed);
      const ahead = flow.dot(fwd);
      const across = -flow.dot(up);
      alpha = Math.atan2(across, ahead);
      alphaWing = Math.asin(Math.max(-1, Math.min(1, across)));
      beta = Math.atan2(flow.dot(right), ahead);
    }

    // Weathervane, and this is what makes it an aircraft rather than a pointer.
    //
    // The tail surfaces sit 3.5 m behind the CoM (`CorsairFlapTailLeft`, z =
    // -3.539) and the fin behind them, carrying `wingLift` and no incidence:
    // flow that stops coming straight down the fuselage makes lift on a long
    // lever, and pushes the tail back into line. flight-model.md section 4b is
    // the geometry and section 8 step 3 the force; a per-surface model gets the
    // moment out of `r x F` for free. This one has to say it, and before it did
    // there was no moment in the whole model that could move the nose except
    // the stick — so a hard pull left the nose frozen wherever it stopped and
    // the aircraft climbing on a vertical fuselage indefinitely, which is
    // exactly what dfe5bb9's report recorded and could not explain.
    //
    // Linear in airspeed, like every other aerodynamic term here. A stalled
    // aircraft's tail barely works, which is why the nose keeps falling once it
    // has started: the restoring rate grows with the speed the fall is
    // building, not with the speed that was lost.
    if (speed > 1) {
      const vane = speed / k.cruiseSpeed;
      rate.x -= alpha * k.weathervane * vane;
      rate.y -= beta * k.weathervaneYaw * vane;
    }

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

    // Lift, in the two terms the surface table actually has. The regulator pair
    // is the closed loop that makes the aircraft self-levelling, but at 4.91
    // each it only budgets two thirds of g; the rest is passive wing lift, and
    // the angle it works on is the body's angle of attack *plus* the built-in
    // `setPitchOffset` incidence. That second term is what holds a fighter up in
    // level flight, what lets it turn, and what stops it flying when the nose
    // gets too far from the flight path.
    //
    // The angle itself is read above, once, because the nose needs it too.
    // Linear in speed, like the alpha term below and like the per-surface model
    // in the spec: a surface's lift is coefficient x angle x |v|. The regulator
    // reaches its 4.91 target from `regulatorSpeed` up and runs out below it.
    const authority = Math.min(1, speed / k.regulatorSpeed);
    const regulated = k.regulateToLift * 2 * authority;
    const surfaceAngle = alphaWing + THREE.MathUtils.degToRad(k.incidence);
    const alphaLift = k.liftSlope
      * Math.max(-k.aoaClamp, Math.min(k.aoaClamp, surfaceAngle)) * speed;
    // 6 g either way. The ceiling used to be one-sided because the slope was too
    // gentle to reach it pushing over; at the calibrated slope it is not.
    const ceiling = k.gravity * 6;
    accel.addScaledVector(up,
      Math.max(-ceiling, Math.min(regulated + alphaLift, ceiling)));

    accel.y -= k.gravity;
    accel.addScaledVector(s.velocity, -k.drag);

    s.velocity.addScaledVector(accel, dt);

    // Side drag: the fin and the fuselage's flank kill sideways velocity, so
    // the aircraft does not slide through a turn like a hovercraft.
    //
    // ONLY THE LATERAL COMPONENT. This used to lerp the whole velocity onto
    // `fwd * (v . fwd)`, which is not side drag but a kinematic constraint: it
    // welds the flight path to the nose at a 0.45 s time constant, and welding
    // those together deletes the angle of attack, which is the term everything
    // else in this model is made of. The aircraft then flew exactly where it
    // pointed at any speed — it could not sink, could not stall, and when
    // `v . fwd` went negative the same lerp pinned it into backward flight,
    // nose up, falling tail-first at 77 m/s with the fuselage vertical. All
    // three of those were one line.
    //
    // There is no degenerate case left to guard: this is a projection onto a
    // unit axis, so it has no direction to lose when the velocity is small.
    s.velocity.addScaledVector(right, -s.velocity.dot(right) * Math.min(1, k.slipDamp * dt));

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

// --- camera modes ----------------------------------------------------------
//
// BF1942 cycles a vehicle's view on C (`c_PIToggleCameraMode`) and selects one
// directly on F9-F12 (`c_PICameraMode1..4`). Which views a given seat offers is
// data: `SoldierCamera` is the one vanilla template that spells the set out —
// `CVMInside 1, CVMChase 0, CVMFrontChase 0, CVMFlyBy 0, CVMTrace 0,
// CVMExternTrace 0`, an infantryman locked to first person. Vehicle cameras omit
// the flags and get the engine's default cycle.
//
// BE CLEAR ABOUT WHAT IS RECONSTRUCTED AND WHAT IS INVENTED.
//
// Only `cockpit` below is read from data. Its eye point is the `<Vehicle>Camera`
// node's own place in the vehicle (`CorsairCamera` at 0.028/1.202/0.04), its look
// limits are that template's `setMinRotation -70/-40/0` / `setMaxRotation 70/5/0`,
// and the interior mesh swap is its LodObject's `DistCompareSelector`.
//
// `chase`, `front` and `flyby` are OURS. A survey of every `Camera` template in
// vanilla `Objects.rfa` plus thirteen installed mods — ~37,000 `.con` files —
// finds a 13-command vocabulary on that template (setMinRotation, setMaxRotation,
// setMaxSpeed, setAcceleration, setInputToYaw/Pitch/Roll, setPivotPosition,
// toggleMouseLook, OutsideHudOffset, setHasTarget, setContinousRotationSpeed,
// CVM*) and not one distance, offset, lag, spring or damping term among them. The
// `CVM*` flags are booleans: they say a mode exists, never where it sits. So the
// engine's chase framing is a hardcoded constant we cannot read, and every number
// in this section is a viewer choice tuned by eye.
//
// `OutsideHudOffset` is the one per-vehicle datum that mentions the outside view
// at all, and it is not a camera. Vanilla declares it 13 times, aircraft only,
// Corsair `0/-0.4/4.45`. Refractor's +Z is forward (`CorsairEngine`, the
// propeller, sits at z=+4.149; `CorsairRudder` at z=-2.649), so that point is
// 0.3 m *past the propeller hub* — ahead of the aircraft, where a chase camera
// can never be. It anchors the outside-view HUD reticle, exactly as its name
// says, and nothing here uses it.
//
// See `features/flyable-vehicles/camera-modes.md`.

/** The cycle order C walks, matching the game's inside -> outside progression. */
export const CAMERA_MODES = ['cockpit', 'chase', 'front', 'flyby'];

const WORLD_UP = new THREE.Vector3(0, 1, 0);

/**
 * Framing per external mode. Offsets are metres in the *follow frame* (the
 * aircraft's heading with roll removed, see `followFrame`), -Z forward, so a
 * positive `back` is behind the aircraft and a negative one is ahead of it.
 *
 * `tau` is the follow frame's smoothing time constant in seconds — the lag that
 * makes these watchable rather than nauseating.
 */
const CHASE = {
  // Far enough back that the Corsair's 12 m span sits inside the frame, high
  // enough to see over the fuselage at the horizon.
  back: 17, up: 4.2,
  // Aim ahead of the nose rather than at it: the aircraft settles into the lower
  // third and you can see where you are going, which is the whole point of a
  // chase view and what makes it flyable.
  lead: 22,
  // 0.32 s. Long enough that a 200 deg/s full-stick roll is visibly absorbed,
  // short enough that the aircraft never leaves the frame in a hard turn.
  tau: 0.32,
};
const FRONT = {
  // `roughly from the propeller`: the prop disc is 4.15 m ahead of the vehicle
  // origin, so 11 m clears it and still frames the whole aircraft.
  back: -11, up: 1.6,
  // Aim behind the nose so the aircraft fills the frame looking back at you.
  lead: -4,
  // Tighter than the chase. A front camera that lags badly swings wide of the
  // nose and shows the aircraft in profile instead of head-on; a little lag is
  // still wanted, because it is what banks the aircraft across the frame in a
  // turn rather than pivoting it in place.
  tau: 0.18,
};

/**
 * Fly-by compositions, cycled in order so successive plants differ on purpose.
 *
 * `lateral` is the closest-approach distance (the camera plants this far off the
 * flight path), `up` its height relative to the aircraft. The three are a level
 * close pass, a low wide one that throws the aircraft against the sky, and a high
 * one that puts it against the terrain.
 */
const FLYBY_SHOTS = [
  { lateral: 38, up: 5 },
  { lateral: 64, up: -14 },
  { lateral: 46, up: 26 },
];
const FLYBY = {
  // How far ahead to plant, as seconds of flight. The aircraft then takes about
  // this long to arrive, which is the pause that makes it read as a held shot
  // rather than a jump cut.
  lead: 3.2,
  minLead: 70, maxLead: 260,
  // Speed floor for the lead, so a parked or stalled aircraft still plants a
  // camera a sensible distance away instead of on top of itself.
  minSpeed: 35,
  // Re-plant once the aircraft is this far *and receding*. Both terms matter:
  // the plant distance itself is already ~180 m, so a bare distance test would
  // re-plant every frame.
  replant: 300,
  // Never plant inside the terrain or the sea.
  clearance: 4,
};

/** Mouse-look limits per mode, radians. Cockpit's pair is the only one in data. */
const LOOK_LIMITS = {
  // `CorsairCamera`: setMinRotation -70/-40/0, setMaxRotation 70/5/0. [data]
  cockpit: { yaw: Math.PI * 70 / 180, pitchDown: -Math.PI * 40 / 180, pitchUp: Math.PI * 5 / 180 },
  // An external camera orbits rather than swivels a neck, so it gets the full
  // circle and a pitch stopping short of the poles where the frame would flip.
  chase: { yaw: Infinity, pitchDown: -1.2, pitchUp: 1.2 },
  front: { yaw: Infinity, pitchDown: -1.2, pitchUp: 1.2 },
  // Fly-by is a camera on a tripod in the world. It has no operator's head.
  flyby: null,
};

/**
 * The view rig for a flown vehicle: the four modes, and the state that smooths
 * them.
 *
 * Kept out of the page because it needs the vehicle's orientation every frame and
 * nothing else, so a replay viewer or a second page gets it for free. The one
 * thing it cannot know on its own is where the ground is; `groundHeight` is
 * injected the same way `Aircraft.groundHeight` is.
 */
export class VehicleCamera {
  /**
   * @param {Vehicle} vehicle
   * @param {{mode?: string, groundHeight?: (x: number, z: number) => number}} [options]
   */
  constructor(vehicle, options = {}) {
    this.vehicle = vehicle;
    this.mode = options.mode || CAMERA_MODES[0];
    this.groundHeight = options.groundHeight || (() => -Infinity);
    /** Mouse-look offset, radians, clamped per mode by `look()`. */
    this.look = { yaw: 0, pitch: 0 };
    /**
     * The roll-free heading frame the external views hang off, carried between
     * frames. It is the smoothing state *and* the continuity state: a basis
     * rebuilt from scratch each frame would flip as the nose passes vertical,
     * where `fwd x worldUp` degenerates.
     */
    this.follow = new THREE.Quaternion();
    this.followValid = false;
    /** Fly-by: where the tripod is standing, and which composition is next. */
    this.anchor = new THREE.Vector3();
    this.anchored = false;
    this.shot = 0;
    this.side = 1;
    this.pose = {
      position: new THREE.Vector3(),
      quaternion: new THREE.Quaternion(),
    };
    // Scratch, so a per-frame update allocates nothing.
    this._fwd = new THREE.Vector3();
    this._right = new THREE.Vector3();
    this._up = new THREE.Vector3();
    this._offset = new THREE.Vector3();
    this._target = new THREE.Vector3();
    this._basis = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
  }

  /** Does this mode show the first-person interior? Exactly one does. */
  get firstPerson() {
    return this.mode === 'cockpit';
  }

  /** Select a mode by name, or fall back to the cockpit. */
  setMode(mode) {
    if (!CAMERA_MODES.includes(mode)) mode = CAMERA_MODES[0];
    if (mode === this.mode) return this.mode;
    this.mode = mode;
    // A head turned 70 degrees left in the cockpit should not become an orbit
    // 70 degrees round the tail, and an orbit should not survive back into the
    // cockpit as a crick in the pilot's neck. Every mode starts looking forward.
    this.look.yaw = 0;
    this.look.pitch = 0;
    // Re-plant on entering fly-by rather than resuming the tripod the aircraft
    // left behind minutes ago, which would otherwise open on an empty sky.
    if (mode === 'flyby') this.anchored = false;
    this.vehicle.setFirstPerson(this.firstPerson);
    return this.mode;
  }

  /** What C does: the next view round the cycle. */
  cycle() {
    const i = CAMERA_MODES.indexOf(this.mode);
    return this.setMode(CAMERA_MODES[(i + 1) % CAMERA_MODES.length]);
  }

  /** Feed mouse motion in, already scaled to radians. Clamped per mode. */
  turn(dyaw, dpitch) {
    const limit = LOOK_LIMITS[this.mode];
    if (!limit) return;
    this.look.yaw = limit.yaw === Infinity
      ? this.look.yaw + dyaw
      : Math.max(-limit.yaw, Math.min(limit.yaw, this.look.yaw + dyaw));
    this.look.pitch = Math.max(limit.pitchDown,
      Math.min(limit.pitchUp, this.look.pitch + dpitch));
  }

  /**
   * Rebuild the roll-free follow frame from the aircraft's nose, and ease the
   * carried one toward it.
   *
   * This is the anti-nausea mechanism, and it is one decision rather than two.
   * A camera rigidly parented to the airframe inherits a 200 deg/s roll, which
   * is unusable; a camera that merely lags a rigid parent still rolls, just
   * late. So the *target* has the roll taken out of it before any smoothing —
   * the frame keeps the aircraft's heading and pitch and derives its up from
   * world up, which leaves the horizon level while the aircraft rolls inside
   * the frame, where you can actually see it happening.
   *
   * The smoothing on top is then only about lag, and because position hangs off
   * this same frame, one time constant buys both the orientation ease and the
   * positional swing behind the aircraft in a turn.
   *
   * Refractor's own precedent for decoupling a mount from its platform is
   * `setAutomaticYawStabilization` / `setAutomaticPitchStabilization`, 15 live
   * uses in vanilla — all of them pintle MG mounts on open-top vehicles, none of
   * them a camera. The idea is the engine's; pointing it at a camera is ours.
   */
  followFrame(dt) {
    const s = this.vehicle.state;
    this._fwd.set(0, 0, -1).applyQuaternion(s.orientation);
    this._right.crossVectors(this._fwd, WORLD_UP);
    if (this._right.lengthSq() < 1e-6) {
      // Nose within a fraction of a degree of vertical: world up gives no
      // heading at all. Borrow the airframe's own right, which is continuous
      // through the top of a loop and is the only frame available there.
      this._right.set(1, 0, 0).applyQuaternion(s.orientation);
    }
    this._right.normalize();
    this._up.crossVectors(this._right, this._fwd).normalize();
    this._basis.makeBasis(this._right, this._up, this._fwd.clone().negate());
    this._q.setFromRotationMatrix(this._basis);
    if (!this.followValid) {
      this.follow.copy(this._q);
      this.followValid = true;
      return;
    }
    const tau = (this.mode === 'front' ? FRONT : CHASE).tau;
    // Frame-rate independent exponential ease: the fraction of the remaining gap
    // to close this step. A bare `slerp(q, 0.1)` would smooth twice as hard at
    // 120 Hz as at 60.
    this.follow.slerp(this._q, 1 - Math.exp(-dt / Math.max(tau, 1e-4)));
  }

  /**
   * Stand the fly-by camera up somewhere ahead of the aircraft.
   *
   * The rule, so that it reads as a deliberate shot and not a dice roll: plant
   * `lead` seconds of flight ahead along the *heading* (the roll-free frame, so
   * a camera is never planted sideways because the aircraft happened to be
   * inverted), `lateral` metres to one side, and alternate sides each plant so
   * two consecutive fly-bys never mirror each other. The composition rotates
   * through `FLYBY_SHOTS`. Finally lift the anchor clear of the terrain, because
   * a trackside camera buried in a hillside films a hillside.
   */
  plant() {
    const s = this.vehicle.state;
    const shot = FLYBY_SHOTS[this.shot % FLYBY_SHOTS.length];
    this.shot += 1;
    const speed = Math.max(s.velocity.length(), FLYBY.minSpeed);
    const lead = Math.max(FLYBY.minLead, Math.min(FLYBY.maxLead, speed * FLYBY.lead));
    this.anchor.copy(s.position)
      .addScaledVector(this._fwd, lead)
      .addScaledVector(this._right, this.side * shot.lateral);
    this.anchor.y += shot.up;
    const floor = this.groundHeight(this.anchor.x, this.anchor.z);
    if (Number.isFinite(floor)) {
      this.anchor.y = Math.max(this.anchor.y, floor + FLYBY.clearance);
    }
    this.side = -this.side;
    this.anchored = true;
  }

  /**
   * Advance one frame and return the world pose the page should give the camera.
   *
   * @param {number} dt seconds
   * @returns {{position: THREE.Vector3, quaternion: THREE.Quaternion}}
   */
  update(dt) {
    const s = this.vehicle.state;
    const out = this.pose;

    if (this.mode === 'cockpit') {
      // Straight off the `<Vehicle>Camera` node, which is already posed in world
      // space by `applyTransform`. The head offset goes on in the aircraft's own
      // frame so the pilot turns with the plane rather than against it.
      this.vehicle.cameraPose(out);
      if (this.look.yaw || this.look.pitch) {
        out.quaternion.multiply(this._q.setFromEuler(
          new THREE.Euler(this.look.pitch, this.look.yaw, 0, 'YXZ')));
      }
      // Keep the follow frame warm so switching to an external view opens
      // already settled behind the aircraft rather than snapping into place.
      this.followFrame(dt);
      return out;
    }

    this.followFrame(dt);

    if (this.mode === 'flyby') {
      // A planted camera, tracking. Re-plant only once the aircraft is both far
      // away and going further — the anchor starts ~180 m out, so a bare
      // distance test would re-plant on the frame it was planted.
      const receding = this.anchored
        && s.velocity.dot(this._target.subVectors(this.anchor, s.position)) < 0;
      if (!this.anchored
        || (receding && s.position.distanceTo(this.anchor) > FLYBY.replant)) {
        this.plant();
      }
      out.position.copy(this.anchor);
      // Level: a tripod does not roll, so world up, and the aircraft centred.
      this._basis.lookAt(out.position, s.position, WORLD_UP);
      out.quaternion.setFromRotationMatrix(this._basis);
      return out;
    }

    const rig = this.mode === 'front' ? FRONT : CHASE;
    // Orbit the offset inside the follow frame, so the mouse swings the camera
    // around the aircraft and a centred mouse is the framing above.
    this._offset.set(0, rig.up, rig.back)
      .applyEuler(new THREE.Euler(this.look.pitch, this.look.yaw, 0, 'YXZ'))
      .applyQuaternion(this.follow);
    out.position.copy(s.position).add(this._offset);
    // Aim at a point along the *smoothed* heading rather than the live nose, or
    // the aim would reintroduce the high-frequency motion the frame just took
    // out. Up comes from the same frame, which is what holds the horizon level
    // through a roll and stays continuous over the top of a loop.
    this._target.set(0, 0, -rig.lead).applyQuaternion(this.follow).add(s.position);
    this._up.set(0, 1, 0).applyQuaternion(this.follow);
    this._basis.lookAt(out.position, this._target, this._up);
    out.quaternion.setFromRotationMatrix(this._basis);
    return out;
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
