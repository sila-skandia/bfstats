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

export { CAMERA_MODES, DEFAULT_CAMERA_MODES, FixedSubject, VehicleCamera } from './vehicle-camera.js';

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

// The propeller's own two numbers — the file's own constants, like world.js's
// STICK_RATE, not restated data: the engine carries no idle-RPM or spool
// constant in any vanilla template (complete Camera/Engine vocabulary
// surveyed in flyable-vehicles/input-and-cockpit.md). Degrees per second.
//
//   idle  — a boarded engine turns the blades over at ~2 rev/s with the
//           throttle shut; the blurred disc never shows for it (the swap
//           stays keyed on the spooling `state.throttle` at the stamped
//           0.07 comparison, so idle is always blade-visible).
//   full  — the long-standing 6 rev/s at full throttle, unchanged.
//   spool — exponential chase constants; up is the engine-start wind-up,
//           down the longer windmill decay after the throttle shuts.
const PROP_IDLE_RATE = 720;
const PROP_FULL_RATE = 2160;
const PROP_SPOOL_UP = 0.8;
const PROP_SPOOL_DOWN = 2.0;

/** A node name's match key: lowercased, with the scene document's
 *  duplicate-instance suffix dropped (`MustangPropellerBlurred_1` and the
 *  spec's authored `MustangPropellerBlurred` are the same node). The scene
 *  glb renames every second instance of a name; every data spec — the
 *  propeller-blur stamp, the cockpit `lodAlternative`, a spec's `replaces`
 *  list — spells the authored one. Map.html keeps the same law as
 *  `bareFireArmsName`; this is that helper's flight-side twin. */
export const nodeNameKey = name =>
  String(name || '').toLowerCase().replace(/_\d+$/, '');

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
    // An Engine's spin is declared on the Engine and NEVER happens there.
    //
    // This is a fact about the class hierarchy, not a heuristic.
    // `EngineTemplate` derives from `RotationalBundleTemplate`, which is the
    // only reason a `.con` may write `setInputToRoll c_PIThrottle` on an Engine
    // at all — but the object it creates is a `PhysicsEngine` deriving from
    // `PhysicsNode`, not from `RotationalBundle`.
    // `RotationalBundle::handleUpdate` is the one place those numbers become a
    // transform, and `PhysicsEngine` does not inherit it. The tail of
    // `PhysicsEngine::updatePhysics` (`0x0057bfb0`) instead pushes a rotation
    // speed into exactly one object through two interface queries: the
    // propeller. See `features/bf1942-engine-reference/symbols.json`.
    //
    // So rotating the Engine node — which is where the rig extra sits — is
    // never right. A Corsair's landing gear, wheels and bay hatches hang off
    // its Engine, and spinning the node swings all nineteen of them around the
    // prop shaft.
    //
    // `assemble.py` decides which children the spin reaches (it needs the same
    // answer to bake clips for the model browser), stamps them
    // `spinsWithEngine`, and lists them on the Engine as `spinsChildren` —
    // **emitted even when empty**, which is what lets these three cases be told
    // apart rather than collapsed into one fallback:
    //
    //   named children      spin exactly those
    //   present but empty   the Engine reaches no drawn geometry at all
    //                       (Willy, KettenKrad, Elco80). Spin nothing.
    //   absent              the asset predates the field. Spin nothing, which
    //                       costs a stationary propeller on an old scene and
    //                       is the only option that cannot be wrong.
    const named = node.userData?.spinsChildren;
    this.spun = [];
    if (Array.isArray(named)) {
      for (const name of named) {
        const found = node.children.find(child => child.name === name)
          || node.getObjectByName(name);
        if (found && found !== node) this.spun.push(found);
      }
    } else {
      for (const child of node.children) {
        if (child.userData?.spinsWithEngine) this.spun.push(child);
      }
    }
    this.spunBases = this.spun.map(n => n.quaternion.clone());
  }
}

/**
 * Whether an `extras.propellerBlur` stamp is really the blade/blur swap.
 *
 * `assemble.py` recognises the pair by name — a LodObject whose two
 * alternatives end `Static` and `Blurred` — and vanilla breaks that
 * convention exactly once: the bf109's *cockpit* LodObject calls its
 * alternatives `bf109CockpitStatic` (the fuselage) and `bf109CockpitBlurred`
 * (the 1P interior) where the other eleven aircraft say
 * `...CockpitExternal` / `...CockpitInternal`. Nothing about it is a
 * propeller, and it is the node the cockpit graft lands on, so a scene baked
 * before the exporter learned the difference hands the viewer a "propeller
 * pair" whose blurred half is the pilot's own cockpit.
 *
 * The engine itself never confused the two, and the selector is how it tells
 * them apart: a propeller is a `CompareSelector` against engine input (0.07
 * or 0.08 on all 59 pairs across the installed mods), while a cockpit is a
 * `DistCompareSelector` against the 0.5 occupancy scalar `CockpitSwap` is
 * built on. So the kind is the gate, not the name.
 *
 * Without this the bf109's interior was bound to the throttle: below half
 * power `updateRig` hid the grafted cockpit and showed the fuselage, and the
 * pilot flew looking at the *outside* of his own aeroplane from 0.7 m — the
 * blurred brown smear the bug report called a low-fidelity HUD. Above half
 * power it snapped to the real cockpit, because that is where the propeller
 * swap put it.
 *
 * Fixed in `con.is_propeller_blur_pair` too, so a fresh extract carries no
 * such stamp; this keeps every already-published asset tree right without a
 * re-extraction.
 */
function isPropellerBlurPair(spec) {
  const kind = String(spec?.selectorKind || '').toLowerCase();
  // An asset published before the exporter recorded the kind at all is taken
  // at its word: the false positive is one known node, the silent loss of
  // every blurred disc would not be.
  return !kind || kind === 'compareselector';
}

// Replay and model-browser consumers that clone a whole `models/<Template>.glb`
// need the same gate (replay.js), so it is part of the module's surface. The
// doc comment above carries the reasoning; read it there.
export { isPropellerBlurPair };

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
    // The interior's rigged nodes as the glb authored them, read now because
    // this is the only moment they are certain to be at rest. A swap outlives
    // the `Vehicle` that grafted it (`cockpitGrafts`), and the next one would
    // otherwise index a steering wheel left hard over by the last driver and
    // take that for its neutral — see `RiggedPart` on compounding.
    this.rest = new Map();
    for (const node of interior) {
      node.traverse(obj => {
        if (obj.userData?.rig?.axes) this.rest.set(obj, obj.quaternion.clone());
      });
    }
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

/**
 * One graft per vehicle node, however many `Vehicle`s are built on it.
 *
 * The interior is grafted into the *node's* tree, and the node outlives every
 * `Vehicle` that drives it: map.html drops its occupancy on the way out of a
 * seat, so each E back into the same jeep constructs another `Vehicle` on the
 * same node. When the fetch belonged to the instance, every one of them
 * fetched `<Control>.cockpit.glb` again and grafted another interior beside
 * the last — whose `CockpitSwap` had died with its `Vehicle`, so it stayed
 * hidden in the tree for good with its GPU half live. On a Willys that was 6
 * geometries and 4 textures per enter/exit cycle, a second steering wheel in
 * `parts`, and a fetch, a parse and a warm-up that bought nothing.
 *
 * Holds the promise of the node's `CockpitSwap[]`, so a seat retaken while
 * the first fetch is still in the air waits on it rather than racing it.
 * Weak, so a level switch takes the entry with the node.
 */
const cockpitGrafts = new WeakMap();

function eachGpuResource(obj, visit) {
  if (obj.geometry) visit(obj.geometry);
  for (const material of [obj.material].flat().filter(Boolean)) {
    visit(material);
    for (const value of Object.values(material)) if (value?.isTexture) visit(value);
  }
}

/**
 * Give back what is left of a cockpit glb once its interior has been grafted.
 *
 * Only the flown seat's swaps are taken, so a B17's file leaves four gunner
 * stations behind, and the page's `prepare` hook has already uploaded their
 * textures along with everyone else's. Nothing will ever draw them. A texture
 * the grafted interior shares with the remainder is the interior's to keep.
 */
function disposeRemainder(root, swaps) {
  const kept = new Set();
  for (const swap of swaps) {
    for (const node of swap.interior) {
      node.traverse(obj => eachGpuResource(obj, resource => kept.add(resource)));
    }
  }
  root.traverse(obj => eachGpuResource(obj, resource => {
    if (!kept.has(resource)) resource.dispose();
  }));
}

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
    /** Propeller angular speed, degrees/s; chases the idled-engine target
     *  with spool inertia (see `advancePropeller`). */
    this.propRpm = 0;
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

    /**
     * The WorldCollider (collision.js), used for hull-vs-statics sweeps. Optional:
     * the flight harness stands the vehicle up without a scene, so this stays null
     * unless the page hands one in. When set, `GroundVehicle`/`TrackedVehicle`
     * sweep against static hulls so a jeep can't drive through a wall.
     */
    this.collider = options.collider || null;

    this.parts = [];
    this.cameraNode = null;
    this.propellerBlurPairs = [];
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
      : this.loadCockpit(options.modelsBase, options.prepareCockpit);
  }

  /**
   * Fetch this vehicle's first-person interior and graft it on — once per
   * node, not once per `Vehicle` (`cockpitGrafts`).
   *
   * A vehicle with no cockpit export is not an error: most ground vehicles
   * have no `1P_*` mesh at all, and an asset tree published before cockpits
   * existed has none for anything. Either way the 404 leaves the vehicle
   * exactly as it was.
   */
  async loadCockpit(modelsBase, prepare = null) {
    let graft = cockpitGrafts.get(this.node);
    if (!graft) {
      graft = this.fetchCockpit(modelsBase, prepare);
      cockpitGrafts.set(this.node, graft);
    }
    return this.adoptCockpit(await graft);
  }

  /** The fetch and the graft behind `loadCockpit`: this node's swaps, which
   *  is none at all for a vehicle with no interior. */
  async fetchCockpit(modelsBase, prepare) {
    const base = modelsBase || defaultModelsBase();
    const url = new URL(`${this.control}.cockpit.glb`, base).href;
    try {
      const gltf = await cockpitLoader.loadAsync(url);
      // `prepare` gets the detached interior before the swap first shows it:
      // map.html links its programs and uploads its textures there, so the
      // first cockpit frame is not also a link (features/mesh-viewer-
      // performance, rule 6). A failure costs that head start, not the cockpit.
      if (prepare) await Promise.resolve().then(() => prepare(gltf.scene)).catch(() => {});
      const swaps = this.graftCockpit(gltf.scene);
      disposeRemainder(gltf.scene, swaps);
      return swaps;
    } catch {
      // Nothing was grafted, so nothing is remembered: a fetch that failed
      // for the network's reasons is asked again by the next `Vehicle` here.
      cockpitGrafts.delete(this.node);
      return [];
    }
  }

  /**
   * Move the interior out of the cockpit glb and into this vehicle's own tree.
   *
   * Matching is by node name, which works because the cockpit export is the
   * same template walk pruned rather than a separate authoring of the same
   * geometry: `lodCorsairCockpit` means the same node in both files, at the
   * same place, so the interior lands where the engine puts it without this
   * module knowing a single offset. The match is bare, not exact: the scene
   * document renames every second instance of a name (`lodMustangCockpit_1`),
   * the fetched glb always spells the authored name, and an exact compare
   * left the second Mustang of a level with no interior at all — the same
   * rename the audio gate tripped on (`bareFireArmsName` in map.html).
   *
   * Only the flown seat's swaps are taken. A B17 ships five — the pilot's
   * cockpit plus a 1P mesh for each gunner station's turret and gun — and each
   * carries the `control` of the nested PlayerControlObject it belongs to.
   * Grafting another seat's would hang a Browning in mid-air behind the pilot.
   * When seat switching arrives, the filter is where it changes.
   */
  graftCockpit(root) {
    const byName = new Map();
    this.node.traverse(obj => {
      if (obj.name && !byName.has(nodeNameKey(obj.name))) {
        byName.set(nodeNameKey(obj.name), obj);
      }
    });

    const sources = [];
    root.traverse(obj => {
      if (obj.userData?.lodAlternative) sources.push(obj);
    });
    const swaps = [];
    for (const source of sources) {
      const spec = source.userData.lodAlternative;
      if ((source.userData.control || '') !== this.control) continue;
      const host = byName.get(nodeNameKey(source.name));
      if (!host) continue;
      // `children` is live while reparenting, so snapshot it first.
      const interior = [...source.children];
      for (const child of interior) host.add(child);
      const hidden = (spec.replaces || [])
        .map(name => byName.get(nodeNameKey(name)))
        .filter(Boolean);
      swaps.push(new CockpitSwap(host, interior, hidden, spec));
    }
    return swaps;
  }

  /**
   * Take the node's graft as this `Vehicle`'s own — the one it just made, or
   * the one a `Vehicle` before it on the same node left in the tree.
   */
  adoptCockpit(swaps) {
    if (!swaps.length) return null;
    this.swaps = swaps;

    // The grafted subtree brings its own rig extras (the SBD's gunner mount is
    // a RotationalBundle), so re-index rather than leaving them frozen.
    this.collect();
    // An inherited interior was already in the tree when the constructor
    // indexed it, wherever the last driver left it. Rest is what the swap
    // read off the glb.
    for (const swap of swaps) {
      for (const part of this.parts) {
        const rest = swap.rest.get(part.node);
        if (rest) part.base.copy(rest);
      }
    }
    this.setFirstPerson(this.firstPerson);
    // The graft reparents nodes and the swap only toggles `visible`; neither
    // composes a matrix. The interior arrives whole seconds after the
    // seat was taken, and a seat vacated in the meantime is back in
    // freezeStatics' frozen set (map.html), whose per-frame walk is a no-op --
    // so the interior would keep the cockpit glb's own world matrix, which on
    // Wake left `CorsairCockpitInternal` 1,441 m from its own seat, hidden but
    // one `setFirstPerson(true)` away from being drawn there, and reported by
    // `__matrixDrift` ever after. Compose it once here, where the graft
    // happens (features/mesh-viewer-performance, rule 2).
    this.node.updateMatrixWorld(true);
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
    // The servo list is derived from `parts`, so it dies with this index.
    this._servos = null;
    this.parts.length = 0;
    this.propellerBlurPairs.length = 0;
    this.node.traverse(obj => {
      const data = obj.userData || {};
      if (data.rig?.axes) this.parts.push(indexed.get(obj) || new RiggedPart(obj, data.rig));
      // `CorsairCamera`: an empty node the exporter stamps with
      // `templateKind: "Camera"` and `cameraView`, sitting at the pilot's eye
      // point in the vehicle's own frame. That is first person, for free.
      if (!this.cameraNode && (data.cameraView || data.templateKind === 'Camera')) {
        this.cameraNode = obj;
      }
      // `_propeller_blur` in assemble.py stamps the wrapper LodObject with
      // both children's names and the engine's own swap point (`comparisons`,
      // from `addLodComparison 0.07` — uniform across every vanilla
      // propeller, but read rather than assumed). Both meshes are real
      // siblings under `obj`, kept apart from every other LodObject this
      // export collapses to one alternative.
      //
      // `isPropellerBlurPair` is the guard against the one vanilla LodObject
      // that wears the naming convention without being a propeller — see
      // there. It matters here and not at export time only because the
      // cockpit graft is what completes the pair: before it, the blurred half
      // does not exist in this tree and no pair is built at all.
      //
      // The children are matched on the bare name key, not exactly: a second
      // instance's nodes are renamed in the scene document
      // (`MustangPropellerStatic_1`) while the stamp spells the authored
      // name, and an exact compare silently collected no pair — the flown
      // second aircraft never swapped blade for disc, and flew showing the
      // parked blade the level-load pass had left it with.
      if (data.propellerBlur && isPropellerBlurPair(data.propellerBlur)) {
        const staticKey = nodeNameKey(data.propellerBlur.static);
        const blurredKey = nodeNameKey(data.propellerBlur.blurred);
        const staticNode = obj.children.find(child => nodeNameKey(child.name) === staticKey);
        const blurredNode = obj.children.find(child => nodeNameKey(child.name) === blurredKey);
        if (staticNode && blurredNode) {
          this.propellerBlurPairs.push({
            static: staticNode,
            blurred: blurredNode,
            threshold: data.propellerBlur.comparisons?.[0] ?? 0.07,
          });
        }
      }
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
   *
   * ONE SERVO PER COMMANDED SURFACE, NOT ONE PER PART. The key is
   * control/input/axis on purpose — a mirrored pair is commanded together, and
   * `applyRig` gets the mirroring from each part's own `direction` — but that
   * means several parts share an entry. Walking parts and stepping on each
   * visit moved the Corsair's two elevators' shared entry twice a frame, so it
   * travelled at 120 deg/s against a declared `setMaxSpeed 60`, and a B17's
   * four-part gear at four times its own. Collect first, step once.
   *
   * `extraServos` is for servos that belong to no rig part — an `Aircraft`'s
   * lift regulators have no player input and, like its meshless body fin, may
   * have no node either. They win on a collision, so a physics table overrides
   * the rig's copy of an axis it also owns.
   */
  servoAxes() {
    if (this._servos) return this._servos;
    const servos = new Map(this.extraServos || []);
    for (const part of this.parts) {
      for (const [axis, spec] of Object.entries(part.axes)) {
        if (spec.driver === 'rate') continue;
        const key = `${keyOf(part.control, spec.input)}/${axis}`;
        if (!servos.has(key)) servos.set(key, spec);
      }
    }
    this._servos = servos;
    return servos;
  }

  advanceSurfaces(dt) {
    const { surfaces } = this.state;
    for (const [key, spec] of this.servoAxes()) {
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

  /**
   * Accumulate the propeller.
   *
   * The Engine template's roll axis spans -3000..5000 with `setMaxSpeed 500`,
   * which the assembler's `browse_rig` already classifies as a `rate` driver:
   * throttle sets how fast the drivetrain turns, not where it stops.
   */
  advancePropeller(dt) {
    // An idling engine turns its propeller. Retail: board a plane and the
    // blades are already turning over slowly long before any throttle — the
    // "idle" state the blur swap sits at the far end of. The idled rate chases
    // its target with inertia, so the boarding spin-up reads as an
    // acceleration rather than the previous hard cut (rate was exactly zero
    // at rest throttle, then the spooling throttle's disc arrived within
    // spool*0.07 = 0.7 s of W).
    const target = PROP_IDLE_RATE
      + this.state.throttle * (PROP_FULL_RATE - PROP_IDLE_RATE);
    const gap = target - this.state.propRpm;
    const tau = gap > 0 ? PROP_SPOOL_UP : PROP_SPOOL_DOWN;
    this.state.propRpm += gap * Math.min(1, dt / tau);
    this.state.propellerAngle += this.state.propRpm * dt;
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
      //
      // `part.spun` never contains `part.node` — see `RiggedPart` — so this
      // cannot reach the Engine's own subtree, and an Engine that reaches no
      // drawn geometry simply poses nothing here.
      part.spun.forEach((node, i) => {
        node.quaternion.copy(spin).multiply(part.spunBases[i]);
      });
    }
    // The blade mesh and the blurred disc are siblings under the same spun
    // node, so nothing above has to know two meshes exist — only which one is
    // drawn. `threshold` is the engine's own `addLodComparison`, not a guess.
    for (const pair of this.propellerBlurPairs) {
      const blurred = this.state.throttle > pair.threshold;
      pair.static.visible = !blurred;
      pair.blurred.visible = blurred;
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
// NOT PROVISIONAL ANY MORE. Everything below is the arithmetic the retail
// client runs, read out of it function by function, driving the `.con` files'
// own per-surface numbers. There is no whole-aircraft lift slope, no commanded
// body rate, no weathervane gain and no side-drag rate: roll authority, pitch
// trim, yaw stability, aerodynamic damping and the stall all emerge from the
// surface table, which is how DICE tuned these aircraft and why the `.con`
// files contain no "roll rate" number anywhere.
//
// Addresses are the retail client catalogued in
// `features/bf1942-engine-reference` (sha256 60c9452d..., subsystem `physics`);
// `features/flyable-vehicles/flight-model.md` section 2d carries the
// reconstructions in full, with the Linux dedicated server's twins.
//
// Frame, measured off the extracted Wake scene rather than assumed: the
// Corsair's propeller sits at local z = -4.15 and its rudder at z = +2.65, and
// its left wing at x = -4.13 against the right at x = +4.16. So the vehicle's
// own frame is -Z forward, +Y up, +X starboard — the ordinary glTF convention,
// because the exporter's Z mirror has already resolved Refractor's handedness.
// Every table below is authored in *Refractor's* frame (+Z nose) so it can be
// diffed against the `.con` line by line, and mirrored on the way in.
const FORWARD = new THREE.Vector3(0, 0, -1);
const UP = new THREE.Vector3(0, 1, 0);
/** The hinge. Every aircraft surface in vanilla swings on its local pitch axis. */
const HINGE = new THREE.Vector3(1, 0, 0);

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;

const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

/**
 * Gravity. NOT 9.81.
 *
 * `BasicPhysicsSystem::BasicPhysicsSystem` (client `0x00578f00`) seeds its
 * gravity field with the literal 0xC16BAE14 = -14.7295379, and nothing in a map
 * load path ever writes it again: all 31 xrefs to the singleton are accounted
 * for and the only `setGravity` callers are the chat cheats (EarthWalk -10,
 * MoonWalk -1.67, SpaceWalk -0.1) and the console property. `physics.gravity`
 * appears in no vanilla file, so the default is the value.
 *
 * Kept local on purpose. `viewer/physics.js` is growing a shared constants
 * module; when it lands this should read from it rather than declaring its own
 * g, and `gunfire.js`'s own GRAVITY with it.
 */
export const GRAVITY = 14.7295379;

/**
 * Where the air runs out. `airDensityZeroAtHeight`, +0x30 of the same
 * constructor, 1000.0 and authored by no vanilla file.
 *
 * `PhysicsWing::updatePhysics` multiplies every surface's lift by
 * `1 - clamp(y/this, 0, 1)`, so a wing makes nothing at all at 1000 m: a hard
 * service ceiling, and the only altitude effect in the model that reduces
 * anything. `PhysicsEngine::updatePhysics` reads the same number but puts it
 * somewhere else entirely — see `Aircraft.step`.
 */
const AIR_DENSITY_ZERO_AT_HEIGHT = 1000;

/** The tail constant of `calculateLift` (client `0x008feb30`). */
const LIFT_SCALE = 0.0025;

/**
 * 1/9.82, the constant `PhysicsWing` and `PhysicsSpring` both normalise by.
 *
 * The engine multiplies authored coefficients by `getGravity() * -0.101833`,
 * which at the shipped g is a flat x1.49995. Whoever wrote it was expressing
 * "in units of gravity" against a g of 9.82 that the engine no longer runs at.
 */
const GRAVITY_NORMALISER = 0.101833;

/** Per-surface saturation, m/s^2. `PhysicsWing::updatePhysics`. */
const SURFACE_LIFT_CLAMP = 200;

/** A submerged surface makes ten times the lift. Same function. */
const SUBMERGED_MEDIUM = 10;

/** `0.1 * |throttle|`: the part of thrust that does not fade with speed. */
const ENGINE_IDLE = 0.1;

/** `PhysicsEngine::getCurrentRatio`, `0x0057bd90`: `3.5 * setDifferential / curve`. */
const ENGINE_RATIO_SCALE = 3.5;

/**
 * The gear-ratio curve entry every aircraft samples.
 *
 * `getCurrentRatio` divides by `lerp(gearRatioCurve, (gear/numberOfGears)*100)`.
 * `Engine`'s constructor (`0x0057bc50`) writes `gear = 1` and nothing in the
 * whole binary ever writes it again — there is no gear-shifting code in the
 * retail client, only a `Gear: %d` debug readout — and no aircraft authors
 * `setNumberOfGears`, whose default is 1. So the index is 100 every time.
 *
 * `EngineTemplate`'s constructor (`0x005715d0`) hard-codes the curve as six
 * control points, (0, 1.00) (20, 3.50) (40, 2.20) (60, 1.50) (80, 1.10)
 * (100, 0.94), piecewise-linearly filled. There is no `.con` binding for it and
 * no "curve" string anywhere in the binary, so this is not overridable data.
 */
const GEAR_RATIO = 0.94;

/**
 * Sub-steps per frame, and the floor on their rate.
 *
 * The engine's own positional integrator (`0x00578aa0`, read
 * instruction-by-instruction) is semi-implicit Euler in four fixed sub-steps of
 * dt/4, so four is not a number we chose. The 240 Hz floor is: `map.html`
 * clamps `THREE.Clock` at 0.1 s, and a per-surface model is stiff — the
 * Corsair's pitch mode is near 8 rad/s — so a 0.1 s frame gets 24 sub-steps
 * rather than four long ones, and the model steps identically at 1/60, 1/30
 * and 0.1.
 */
const SUBSTEPS = 4;
const SUBSTEP_RATE = 240;

/** How fast the undercarriage takes roll out of a vehicle on its wheels. */
const GROUND_LEVEL_TAU = 0.15;

/**
 * THE lift equation, whole. `dice::ref2::world::calculateLift`, client
 * `0x0057fa90`, matched instruction-for-instruction against the Linux
 * dedicated server's `0x0824eb20`.
 *
 * ```c
 * float calculateLift(const Vec3& vel, const Vec3& surfaceUp, float coeff) {
 *     float len = |vel|;  if (len == 0) return 0;
 *     float s = clamp(dot(vel/len, surfaceUp), -1, 1);
 *     float a = asin(s) * 57.29578;                      // DEGREES
 *     float c = (fabs(a) >= 45) ? 0
 *             : (a >= 0) ? a*(45 - a)/506.25 : a*(45 + a)/506.25;
 *     return (0.75*c + 0.25*s) * len*len * coeff * 0.0025;
 * }
 * ```
 *
 * Three things in it are the whole flight model. The speed exponent is **2**,
 * not 1 — flight-model.md section 9c item 1, settled. The coefficient curve
 * peaks at exactly 1.0 at 22.5 degrees and is hard zero past +-45, which is the
 * engine's entire stall model and the reason nothing in the data declares one.
 * And the returned number is an **acceleration**: the caller hands it to
 * `addAccelerationAtAbsolutePosition`, which is why `setRegulateToLift 4.91`
 * can be compared against it directly and why it reads as g/3.
 *
 * Sign: the caller applies `-lift * surfaceUp`, so a positive return is a
 * push along -surfaceUp. Flow arriving from below a wing gives `s < 0` and
 * therefore lift upward.
 *
 * Small-angle slope, worth having for arithmetic done against this file:
 * 0.75*45/506.25 + 0.25*pi/180 = 0.07103 per degree = 4.0699 per radian.
 *
 * @param {THREE.Vector3} velocity flow at the surface, world frame
 * @param {THREE.Vector3} surfaceUp unit normal of the surface, world frame
 * @param {number} coeff (setWingLift + setFlapLift) * g/9.82
 * @returns {number} m/s^2, to be applied along -surfaceUp
 */
export function calculateLift(velocity, surfaceUp, coeff) {
  const len = velocity.length();
  if (len === 0) return 0;
  const s = clamp(velocity.dot(surfaceUp) / len, -1, 1);
  const a = Math.asin(s) * DEG;
  const c = Math.abs(a) >= 45 ? 0
    : a >= 0 ? a * (45 - a) / 506.25 : a * (45 + a) / 506.25;
  return (0.75 * c + 0.25 * s) * len * len * coeff * LIFT_SCALE;
}

/**
 * Principal inertia from the mesh bounding box and `inertiaModifier`.
 *
 * The modifier triple is [data] and is yaw/pitch/roll.
 *
 * Two laws, chosen by `spec.inertiaLaw`:
 *
 *  - `'box'` (the default, and what every aircraft in this file is calibrated
 *    against) divides by **12**: the textbook solid box. [free]
 *  - `'geometry'` divides by **3**, which is the engine's own
 *    `getGeometryInertia` (lnxded `0x08253930`, client `0x0053fc30`,
 *    collision-response.md §4.2): `Ix = (DY²+DZ²)/3`, `Iy = (DZ²+DX²)/3`,
 *    `Iz = (DX²+DY²)/3` off the object's geometry bounding box, **four times** a
 *    solid box's inertia per unit mass, and the only inertia the engine has.
 *    `rigid-body.js`'s `boxInertia` and `ground.js`'s vehicle tables already use
 *    it; a ship uses it because a 115 m hull turning on a quarter of its real
 *    inertia pirouettes.
 *
 * Mass cancels out of the rotation either way — the engine's `Δω` divides a
 * per-mass torque by a per-mass inertia and `mass never enters rotation` —
 * so it is carried here only to keep `_torque = _moment * mass` unchanged.
 *
 * @param {number} mass kg
 * @param {[number, number, number]} size span (x), height (y), length (z), metres
 * @param {[number, number, number]} modifier `inertiaModifier`, yaw/pitch/roll
 * @param {'box'|'geometry'} law which divisor
 */
function boxInertia(mass, size, modifier, law = 'box') {
  const [w, h, l] = size;
  const [yaw, pitch, roll] = modifier;
  const divisor = law === 'geometry' ? 3 : 12;
  return {
    x: mass * (l * l + h * h) / divisor * pitch,
    y: mass * (w * w + l * l) / divisor * yaw,
    z: mass * (w * w + h * h) / divisor * roll,
  };
}

/**
 * One `Wing` template, as the arithmetic the engine does with it.
 *
 * Authored in Refractor's own frame (x right, y up, **z nose**) so the tables
 * below can be read against `Physics.con` and `Objects.con` line by line; the
 * constructor mirrors Z into the glb frame the extracted scenes are in, which
 * negates the rotations about X and Y and leaves the one about Z alone — the
 * same conjugation `bf42/gltf.py`'s `quat_from_ypr` applies to the meshes.
 */
class Surface {
  constructor(spec) {
    this.id = spec.id;
    const lift = (spec.wingLift || 0) + (spec.flapLift || 0);

    /**
     * `PhysicsWing::updatePhysics`, `0x0057fbf0`:
     * `coeff = (setWingLift + setFlapLift) * getGravity() * -0.101833`.
     *
     * The two authored values are **summed into one coefficient**. There is no
     * `flapLift x deflection` term anywhere in the update path — this corrects
     * flight-model.md section 4a, and it is why a rudder (`wingLift 0 /
     * flapLift 2`) and a body fin (`2 / 0`) behave identically to the force
     * term.
     */
    this.coeff = lift * GRAVITY * GRAVITY_NORMALISER;

    /**
     * ...and this is where the two values *are* told apart.
     * `Wing::handleUpdate` (Linux `0x08250950`, disassembled) poses the surface
     * at `rotateXDeg(deflection * flapLift/(wingLift + flapLift) - pitchOffset)`
     * composed with its bundle transform. So `setFlapLift` is the moving share
     * of one surface's area: a ship rudder (0/2) swings all of it, a body fin
     * (2/0) none, a Corsair elevator (0.5/0.5) half — 20 degrees of hinge is
     * ten degrees of aerodynamic angle.
     */
    this.flapShare = lift > 0 ? (spec.flapLift || 0) / lift : 0;

    /**
     * `setPitchOffset`, degrees — and it is a real rest incidence, not only the
     * regulator's reference. Same instruction: the angle handed to
     * `rotateXDeg` is the deflection term **minus** pitchOffset, at every
     * update, for every Wing. That closes flight-model.md's open question, and
     * it is what the 53-of-54 uniformity and the one deliberate 0 on the
     * Katyusha rocket's fin were always saying.
     */
    this.pitchOffset = spec.pitchOffset || 0;

    // `applyPoint = addTemplate position + setPositionOffset`, both parent
    // frame. The regulators' offsets negate their attach positions exactly, so
    // sustaining lift lands on the CoM and pitches nothing.
    const [ax, ay, az] = spec.attach || [0, 0, 0];
    const [ox, oy, oz] = spec.offset || [0, 0, 0];
    this.apply = new THREE.Vector3(ax + ox, ay + oy, -(az + oz));

    // `mountQuaternion` is the same rotation already conjugated: a spec built
    // from an extracted scene reads the node's own glb quaternion, which IS
    // `Ry(-yaw)Rx(-pitch)Rz(roll)` because `bf42/gltf.py` applied the mirror at
    // export. Spelling the Euler triple out is for the hand-written tables
    // below, which are read against `Physics.con`.
    const [yaw, pitch, roll] = spec.mount || [0, 0, 0];
    this.mount = spec.mountQuaternion
      ? new THREE.Quaternion(...spec.mountQuaternion).normalize()
      : new THREE.Quaternion().setFromEuler(
        new THREE.Euler(-pitch * RAD, -yaw * RAD, roll * RAD, 'YXZ'));
    // The -90 roll on every rudder and vertical fin turns its lift sideways
    // through the same formula. Nothing here special-cases them.
    this.rest = this.mount.clone().multiply(
      new THREE.Quaternion().setFromAxisAngle(HINGE, this.pitchOffset * RAD));

    this.regulateToLift = spec.regulateToLift || 0;
    this.wingToRegulatorRatio = spec.wingToRegulatorRatio ?? 1;

    // Shaped exactly as a rig axis, so `advanceSurfaces` servos it and
    // `axisAngle` reads it: the physics surface and the visible node are then
    // the same state and cannot drift. A regulator takes no player input, so it
    // gets a synthetic one the `c_PI*` namespace can never collide with.
    this.axis = {
      input: spec.input || `c_Regulator:${spec.id}`,
      min: spec.min ?? 0,
      max: spec.max ?? 0,
      free: false,
      maxSpeed: spec.maxSpeed ?? 0,
      direction: spec.direction ?? 1,
      driver: 'position',
    };
    /** Filled in by the `Aircraft`, which is what knows the control name. */
    this.key = '';
  }

  /** The surface's normal in the body frame, at a hinge angle in degrees. */
  orient(deflectionDeg, out) {
    // glb rotations about the hinge are the negation of Refractor's, so the
    // engine's `deflection*flapShare - pitchOffset` comes over with its sign
    // flipped. A positive `setPitchOffset` therefore tilts the surface's normal
    // forward, which is the sign that makes incidence lift.
    return out.copy(this.mount).multiply(_hinge.setFromAxisAngle(
      HINGE, (this.pitchOffset - deflectionDeg * this.flapShare) * RAD));
  }
}

// Scratch. A per-surface model runs eight lift evaluations per sub-step and up
// to 24 sub-steps a frame, so none of this may allocate.
const _hinge = new THREE.Quaternion();
const _qs = new THREE.Quaternion();
const _qi = new THREE.Quaternion();
const _spin = new THREE.Quaternion();
const _up = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _r = new THREE.Vector3();
const _flow = new THREE.Vector3();
const _force = new THREE.Vector3();
const _arm = new THREE.Vector3();
const _accel = new THREE.Vector3();
const _moment = new THREE.Vector3();
const _torque = new THREE.Vector3();
const _omega = new THREE.Vector3();
const _iw = new THREE.Vector3();
const _gyro = new THREE.Vector3();
const _axis = new THREE.Vector3();
const _refFlow = new THREE.Vector3();
const _g1 = new THREE.Vector3();
const _g2 = new THREE.Vector3();
const _g3 = new THREE.Vector3();
const _g4 = new THREE.Vector3();
const _basis = new THREE.Matrix4();

/**
 * The Corsair, entirely from data.
 *
 * Body from `Objects/Vehicles/Air/Corsair/Objects.con`, surfaces and engine
 * from its `Physics.con`, attach positions and mount rotations from the
 * `CorsairComplex` bundle. The only [free] number in it is `size`, which feeds
 * the solid-box inertia estimate.
 */
export const CORSAIR = {
  mass: 2500,               // [data]
  drag: 0.0652,             // linear, s^-1 — dragAccel = -drag*v [data]
  gravity: GRAVITY,
  inertiaModifier: [1.05, 0.850, 0.94],   // yaw/pitch/roll [data]
  // Mesh bounding box: span 12.5 m, height 3.1 m, length 10.2 m. [free]
  size: [12.5, 3.1, 10.2],
  // Wheels-down ride height, for the heightfield clamp.
  groundClearance: 1.2,
  // `setMaxSpeed 500` over the engine's 5000-degree accumulator is a tenth of
  // the range per second: a ten-second spool from idle to full. [data]
  throttleRate: 0.1,
  // Gear is not a player input; it retracts on altitude and engine input
  // thresholds. See input-and-cockpit.md. [data]
  gearUpAltitude: 25,
  gearDownAltitude: 23,
  engines: [
    // `CorsairEngine`, attached to `CorsairComplex` at the propeller hub — and
    // that is where its thrust is applied, not at the CoM.
    { id: 'engine', position: [0.02, 0.446, 4.149],
      differential: 5, noPropellerEffectAtSpeed: 70 },
  ],
  // id | attach | setPositionOffset | setRotation | range | maxSpeed |
  // sign(setAcceleration) | input | setWingLift | setFlapLift | setPitchOffset
  surfaces: [
    { id: 'ailL', node: 'CorsairFlapLeftOuter',
      attach: [-4.129, 0.064, 1.114], offset: [0.5, 0, -0.90], mount: [8, 0, -8.999],
      min: -30, max: 30, maxSpeed: 120, direction: -1, input: 'c_PIRoll',
      wingLift: 1.85, flapLift: 1.7, pitchOffset: 0.5 },
    { id: 'ailR', node: 'CorsairFlapRightOuter',
      attach: [4.156, 0.082, 1.124], offset: [-0.5, 0, -0.90], mount: [-8.999, 0, 8],
      min: -30, max: 30, maxSpeed: 120, direction: 1, input: 'c_PIRoll',
      wingLift: 1.85, flapLift: 1.7, pitchOffset: 0.5 },
    { id: 'elevL', node: 'CorsairFlapTailLeft',
      attach: [-1.124, 0.812, -3.539], offset: [0.5, 0, 0],
      min: -10, max: 20, maxSpeed: 60, direction: -1, input: 'c_PIPitch',
      wingLift: 0.5, flapLift: 0.5 },
    { id: 'elevR', node: 'CorsairFlapTailRight',
      attach: [1.146, 0.812, -3.539], offset: [-0.5, 0, 0],
      min: -10, max: 20, maxSpeed: 60, direction: -1, input: 'c_PIPitch',
      wingLift: 0.5, flapLift: 0.5 },
    { id: 'rud', node: 'CorsairRudder',
      attach: [0.03, 1.88, -2.649], offset: [0, -0.5, 0], mount: [0, 0, -89.999],
      min: -15, max: 15, maxSpeed: 60, direction: 1, input: 'c_PIYaw',
      wingLift: 1.0, flapLift: 1.0 },
    // The lift regulators: input-less, at the CoM, servoed against
    // `setRegulateToLift` — which is 4.91 in all 27 vanilla uses and is also
    // `WingTemplate`'s own constructor default (Linux `0x082514c0`, +0x1cc =
    // 0x409d1eb8). g/3, and a fighter carries two of the three.
    { id: 'regL', node: 'CorsairFlapLeftMiddle',
      attach: [-2.563, -0.134, 0.895], offset: [2.564, 0.135, -0.895], mount: [9, 0, -5.999],
      min: -2, max: 2, maxSpeed: 30, direction: 1,
      wingLift: 0, flapLift: 4, pitchOffset: 0.5,
      regulateToLift: 4.91, wingToRegulatorRatio: 1 },
    { id: 'regR', node: 'CorsairFlapRightMiddle',
      attach: [2.52, -0.144, 0.895], offset: [-2.52, 0.145, -0.895], mount: [-8.999, 0, 6],
      min: -2, max: 2, maxSpeed: 30, direction: 1,
      wingLift: 0, flapLift: 4, pitchOffset: 0.5,
      regulateToLift: 4.91, wingToRegulatorRatio: 1 },
    // Meshless, input-less, 0.1 m behind the CoM, mounted on its side: the
    // weathervane. A lumped model has to name a gain for this; a per-surface
    // one gets it out of `r x F` for nothing.
    { id: 'fin', node: 'CorsairBodyWingVertical',
      attach: [0, 0, 0], offset: [0, 0, -0.1], mount: [0, 0, -89.999],
      wingLift: 2, flapLift: 0 },
  ],
};

/** Physics tables by `control` name. One so far; the survey has 13. */
const SPECS = { Corsair: CORSAIR };

/** An aircraft: a `Vehicle` plus the model that turns inputs into state. */
export class Aircraft extends Vehicle {
  /**
   * @param {{spec?: object, modelsBase?: string, cockpit?: boolean}} [options]
   */
  constructor(node, parent, options = {}) {
    super(node, parent, options);
    this.spec = options.spec || SPECS[this.control] || CORSAIR;
    this.surfaces = this.spec.surfaces.map(spec => new Surface(spec));
    for (const surface of this.surfaces) {
      surface.key = `${keyOf(this.control, surface.axis.input)}/pitch`;
    }
    this.extraServos = this.surfaces.map(surface => [surface.key, surface.axis]);
    this._servos = null;
    this.engines = this.spec.engines.map(engine => ({
      id: engine.id,
      // `ObjectTemplate.engineType`, carried because `waterGate` splits on its
      // bit 3 and the two rules are opposites: without it a ship's screw, which
      // is authored BELOW the waterline, would take the aircraft rule and have
      // its throttle zeroed every step.
      engineType: engine.engineType ?? null,
      position: new THREE.Vector3(
        engine.position[0], engine.position[1], -engine.position[2]),
      // `getCurrentRatio` = 3.5 * setDifferential / gearRatioCurve[100].
      // `setTorque` is NOT in it: it only scales `getCurrentTorque`, whose one
      // caller in the whole binary is `feedbackLoop`, which spends it on the
      // RPM accumulator behind the engine sound.
      ratio: ENGINE_RATIO_SCALE * engine.differential / GEAR_RATIO,
      // `setTorque`, carried for the ONE thing it does to the simulation:
      // `getCurrentTorque()` divides the gearbox's load by it (TANK-13), so on
      // a vehicle whose rev state is modelled it sets the top speed. Unused by
      // an aircraft here, which has no rev state.
      torque: engine.torque,
      differential: engine.differential,
      fadeSpeed: engine.noPropellerEffectAtSpeed,
    }));
    this.inertia = boxInertia(this.spec.mass, this.spec.size,
                              this.spec.inertiaModifier, this.spec.inertiaLaw);
    this.groundHeight = () => -Infinity;
    // Below this a surface is in the water and makes ten times the lift.
    // Off by default: the page that knows where the sea is should say so.
    this.waterHeight = -Infinity;
    // Airborne-from-rest would just belly-flop; a plane parked on the strip has
    // its gear down and no airspeed, which is the honest starting state.
    this.state.inputs.set('c_PILandingGear', 0);
  }

  /** Where a surface's hinge has actually got to, degrees. */
  deflection(surface) {
    return axisAngle(surface.axis, this.state.surfaces.get(surface.key) ?? 0);
  }

  /**
   * The throttle one engine may use this step, or `null` for "no thrust".
   *
   * `PhysicsEngine::updatePhysics` tests the engine node's own world height
   * against the water level and then splits on `engineType & 8`
   * (`0x0824cc89`/`0x0824d047`). An aircraft has that bit clear, and its rule is
   * the one implemented here: **below the waterline the throttle is zeroed** —
   * a ditched plane's propeller stops pulling. A ship has it set and gets the
   * mirror, which `ship.js` overrides in.
   *
   * `waterHeight` is -Infinity until the page says where the sea is, so on a
   * land map this is never taken.
   */
  waterGate(_engine, worldY) {
    return worldY < this.waterHeight ? 0 : this.state.throttle;
  }

  /**
   * Accelerations and moments that are neither a surface's nor an engine's.
   *
   * Nothing for an aircraft: `PhysicsSpring` is stood in for by `settle` and
   * there is no third node type on a plane. A `FloatingBundle` is one
   * (`ship.js`), and so would a `LandingGear` be if it made force.
   */
  bodyForces(_accel, _moment, _h) {}

  /**
   * `Engine::handleUpdate` (`0x0823e120`), once per engine tick.
   *
   * Nothing for an aircraft. The engine runs the gearbox for every engine type
   * — the rev filter, its 1.2 clamp and the load feedback are all
   * type-independent — but `flight.js`'s aircraft model was measured and
   * calibrated against the pedal reaching the thrust law directly, so putting
   * the filter in front of it would move every number in `test_flight.py`
   * without a measurement to move them to. It is a divergence, and it is
   * written down as one in this file's header rather than fixed here.
   * `ship.js` implements it, because for a ship the load feedback IS the top
   * speed.
   */
  advanceEngines(_dt) {}

  /**
   * `PhysicsEngine::feedbackLoop` (`0x0824c850`), once per engine per thrust
   * evaluation, with `K` before the ratio.
   *
   * Nothing for an aircraft, for the same reason `advanceEngines` is nothing:
   * with no rev state there is no load to accumulate into.
   */
  noteThrust(_engine, _k, _throttle) {}

  /**
   * Body drag, added to the accumulator.
   *
   * `-drag * v`, which is what this file has always done and is **not** the
   * engine's law: `PhysicsNode` takes the box form
   * (`accel += -drag*|relV|/mass * (Ax*proj0 + Ay*proj1 + Az*proj2)`,
   * physics.md §3), quadratic in speed and area-scaled. The linear form is a
   * fitted stand-in whose coefficient came out of the Corsair's measured
   * terminal speeds, and replacing it is a flight-model job, not this stream's.
   * `ship.js` runs the box law, because a ship's terminal speed is nothing at
   * all without the submerged drag multiplier.
   */
  applyDrag(_accel, _h, _moment) {
    _accel.addScaledVector(this.state.velocity, -this.spec.drag);
  }

  /**
   * `medium`: the one multiplier on a surface's lift.
   *
   * `1 - clamp(y/1000, 0, 1)` in air, flat 10 below the water surface. Both
   * from `PhysicsWing::updatePhysics`. The first is a hard service ceiling —
   * at 1000 m a Refractor wing makes nothing whatever — and the second is why
   * a ship's `HullWing` steers at all.
   */
  medium(y) {
    if (y < this.waterHeight) return SUBMERGED_MEDIUM;
    return 1 - clamp(y / AIR_DENSITY_ZERO_AT_HEIGHT, 0, 1);
  }

  /**
   * The lift regulator's servo command, once per frame.
   *
   * `PhysicsWing::updatePhysics`, the branch gated on the template's
   * regulate-enabled flag:
   *
   * ```
   * refFlow = parentForward * |v|
   * command = clamp((calculateLift(refFlow, surfaceUp, coeff)
   *                  + calculateNeutralLift(refFlow, -setPitchOffset, coeff)
   *                    * setWingToRegulatorRatio
   *                  + setRegulateToLift) * getGravity() * 0.101833, -1, +1)
   * ```
   *
   * Two things follow, and both are load-bearing. The reference flow is the
   * *body's forward axis*, not the real one — so the regulator is a
   * speed-scheduled trim device and knows nothing about angle of attack; it
   * cannot save a stalled aircraft, and it goes on making lift when the nose is
   * nowhere near the flight path. And `calculateNeutralLift` (client
   * `0x00580280`) is the surface's own undeflected lift at its authored
   * incidence, so `setWingToRegulatorRatio` is a feed-forward that discounts
   * it. Equilibrium is exactly "this surface holds `setRegulateToLift`".
   *
   * The command is an *input* in -1..1, not an angle: it lands in the same slot
   * a player input would and the ordinary +-2 degree servo chases it at
   * `setMaxSpeed 30`. So the loop is proportional, and it saturates.
   */
  regulate() {
    const s = this.state;
    const speed = s.velocity.length();
    _fwd.copy(FORWARD).applyQuaternion(s.orientation);
    _refFlow.copy(_fwd).multiplyScalar(speed);
    for (const surface of this.surfaces) {
      if (!surface.regulateToLift) continue;
      surface.orient(this.deflection(surface), _qs);
      _up.copy(UP).applyQuaternion(_qs.premultiply(s.orientation));
      const lift = calculateLift(_refFlow, _up, surface.coeff);
      _up.copy(UP).applyQuaternion(_qs.copy(surface.rest).premultiply(s.orientation));
      const neutral = calculateLift(_refFlow, _up, surface.coeff);
      this.setInput(surface.axis.input, clamp(
        (lift + neutral * surface.wingToRegulatorRatio + surface.regulateToLift)
        * -this.spec.gravity * GRAVITY_NORMALISER, -1, 1));
    }
  }

  /**
   * One step. Order matters: the regulator reads where the surfaces are, the
   * surfaces then move toward their commands, and only then does the model read
   * them — so a slammed stick still takes the config's declared time to become
   * a control moment.
   */
  integrate(dt) {
    const s = this.state;
    const k = this.spec;
    if (this.autoFirstPerson && !this.firstPerson) this.setFirstPerson(true);

    // Throttle spools rather than steps. `throttleMin` is 0 for an aircraft —
    // a propeller does not run backwards — and -1 for a ship, whose Engine
    // declares `setMinRotation 0/0/-4000` and whose `K = 0.1*|throttle| + e*|e|`
    // is signed, so a negative throttle is astern.
    const wanted = clamp(this.input('c_PIThrottle'), k.throttleMin ?? 0, 1);
    const gap = wanted - s.throttle;
    const spool = k.throttleRate * dt;
    s.throttle = Math.abs(gap) <= spool ? wanted : s.throttle + Math.sign(gap) * spool;
    // `Engine::handleUpdate`'s own slot in the tick: the gearbox runs ONCE per
    // engine tick, on the load the previous tick's `feedbackLoop` calls left,
    // and then clears that load — which is why it cannot live in `step()`
    // beside the sub-steps. Empty for an aircraft, whose throttle this file
    // has always fed to the thrust law directly; a ship's rev state is
    // `ship.js`'s (`engine-revs.js`, ledger TANK-12/TANK-13).
    this.advanceEngines(dt);
    this.advancePropeller(dt);

    const steps = Math.max(SUBSTEPS, Math.round(dt * SUBSTEP_RATE));
    const h = dt / steps;
    for (let i = 0; i < steps; i++) this.step(h);
    s.airspeed = s.velocity.length();

    // Gear is automatic in the real game, on altitude thresholds.
    const floor = this.groundHeight(s.position.x, s.position.z);
    const agl = s.position.y - (Number.isFinite(floor) ? floor : 0);
    const gear = this.input('c_PILandingGear');
    if (gear < 1 && agl > k.gearUpAltitude) this.setInput('c_PILandingGear', 1);
    else if (gear > 0 && agl < k.gearDownAltitude) this.setInput('c_PILandingGear', 0);

    this.applyTransform();
    this.applyRig();
  }

  /** One sub-step of the rigid body. */
  step(h) {
    const s = this.state;
    const k = this.spec;

    // The servos run here rather than once a frame, and they have to. The
    // regulator is a proportional loop closed through a rate-limited servo, and
    // its gain is about 3: given a whole 0.1 s browser frame the servo can cross
    // its entire +-2 degree range in one step, the loop goes bang-bang, and the
    // aircraft trims somewhere else. Stepping it with the sub-step makes the
    // trim the same at 1/60, 1/30 and 0.1, which is also what the engine does —
    // `Wing::handleUpdate` and `PhysicsWing::updatePhysics` are the same tick.
    this.regulate();
    this.advanceSurfaces(h);

    _accel.set(0, 0, 0);
    _moment.set(0, 0, 0);

    // Every surface, including the ones that take no input. The fin and the
    // regulators are why an aircraft that has never touched a control still
    // weathervanes and still holds itself up.
    for (const surface of this.surfaces) {
      surface.orient(this.deflection(surface), _qs);
      _up.copy(UP).applyQuaternion(_qs.premultiply(s.orientation));
      _r.copy(surface.apply).applyQuaternion(s.orientation);
      // The flow AT THE SURFACE, not at the centre of mass. This term is the
      // whole of aerodynamic damping: a rolling aircraft gives its ailerons a
      // vertical velocity component and their own lift opposes the roll.
      _flow.copy(s.velocity).add(_arm.crossVectors(s.angularVelocity, _r));
      const lift = calculateLift(_flow, _up, surface.coeff)
        * this.medium(s.position.y + _r.y);
      const a = -clamp(lift, -SURFACE_LIFT_CLAMP, SURFACE_LIFT_CLAMP);
      _force.copy(_up).multiplyScalar(a);
      _accel.add(_force);
      // Applied at the surface's own world position, so the off-centre ones
      // make the pitch, roll and yaw moments. This is the line that replaces
      // every commanded body rate the model used to carry.
      _moment.add(_arm.crossVectors(_r, _force));
    }

    // Thrust. `PhysicsEngine::updatePhysics`, `0x0057bfb0`:
    //
    //   rho = 1 - clamp(y/airDensityZeroAtHeight, 0, 1)
    //   e   = throttle - rho*(vel . fwd)/setNoPropellerEffectAtSpeed
    //   K   = 0.1*|throttle| + e*|e|
    //   F   = fwd * K * getCurrentRatio()
    //
    // `e*|e|` is a SIGNED SQUARE, not the linear fade this file used to carry,
    // and it goes negative above the fade speed: a propeller past
    // `setNoPropellerEffectAtSpeed` is a powerful airbrake, which is what caps
    // a dive far below `g/drag`. And `rho` multiplies only the *speed* term, so
    // thrust does not fade with altitude — it grows, because a high aircraft's
    // propeller does not know how fast it is going. The 1000 m ceiling is a
    // lift ceiling only.
    _fwd.copy(FORWARD).applyQuaternion(s.orientation);
    const along = s.velocity.dot(_fwd);
    for (const engine of this.engines) {
      _r.copy(engine.position).applyQuaternion(s.orientation);
      // The water gate. `engineType` bit 3 (`c_ETShip` = 9, `c_ETTorpedo` =
      // 0x19) versus bit 3 clear (`c_ETPlane` = 1) picks opposite rules at
      // `0x0824cc89`/`0x0824d047`, and an aircraft's is "an engine under water
      // makes no thrust". `waterGate` answers for both; the default is an
      // aircraft's, so nothing here changes for one.
      const throttle = this.waterGate(engine, s.position.y + _r.y);
      if (throttle === null) continue;
      const rho = 1 - clamp((s.position.y + _r.y) / AIR_DENSITY_ZERO_AT_HEIGHT, 0, 1);
      const e = throttle - rho * along / engine.fadeSpeed;
      const k = ENGINE_IDLE * Math.abs(throttle) + e * Math.abs(e);
      const a = k * engine.ratio;
      // `PhysicsEngine::feedbackLoop(K*fwd, fwd)` at `0x0824cfc1`, whose one
      // effect that survives the tick is the load the gearbox reads next tick.
      // Empty for an aircraft: `flight.js` feeds the pedal straight through, so
      // there is no rev state for a load to pull down.
      this.noteThrust(engine, k, throttle);
      _force.copy(_fwd).multiplyScalar(a);
      _accel.add(_force);
      // At the engine node, not the centre of mass — a nacelle 0.45 m above the
      // CoM and four nacelles out on a B17's wings.
      _moment.add(_arm.crossVectors(_r, _force));
    }

    // Anything the body carries that is neither a surface nor an engine. Empty
    // for an aircraft; a ship's eight `FloatingBundle`s are here, and because
    // they land in `_moment` as well their differing depths are what rights the
    // hull (`ship.js`).
    this.bodyForces(_accel, _moment, h);

    _accel.y -= k.gravity;
    this.applyDrag(_accel, h, _moment);

    // Angular, in the body frame, which is the only one the inertia tensor is
    // diagonal in. The gyroscopic term matters here: a Corsair's yaw inertia is
    // nearly three times its pitch one.
    _qi.copy(s.orientation).invert();
    _torque.copy(_moment).applyQuaternion(_qi).multiplyScalar(k.mass);
    _omega.copy(s.angularVelocity).applyQuaternion(_qi);
    const I = this.inertia;
    _iw.set(I.x * _omega.x, I.y * _omega.y, I.z * _omega.z);
    _gyro.crossVectors(_omega, _iw);
    _omega.x += (_torque.x - _gyro.x) / I.x * h;
    _omega.y += (_torque.y - _gyro.y) / I.y * h;
    _omega.z += (_torque.z - _gyro.z) / I.z * h;
    const rate = _omega.length();
    if (rate > 1e-9) {
      _axis.copy(_omega).divideScalar(rate);
      s.orientation.multiply(_spin.setFromAxisAngle(_axis, rate * h)).normalize();
    }
    s.angularVelocity.copy(_omega).applyQuaternion(s.orientation);

    s.velocity.addScaledVector(_accel, h);
    s.position.addScaledVector(s.velocity, h);

    // Ground. Real collision against buildings is a separate problem; this is
    // only the heightfield and the sea, so the plane cannot fall through Wake.
    const floor = this.groundHeight(s.position.x, s.position.z);
    if (Number.isFinite(floor) && s.position.y < floor + k.groundClearance) {
      s.position.y = floor + k.groundClearance;
      if (s.velocity.y < 0) s.velocity.y = 0;
      s.grounded = true;
      this.settle(h);
    } else {
      s.grounded = false;
    }
  }

  /**
   * What the undercarriage does that the aerodynamics cannot.
   *
   * Refractor stands a parked aircraft on three `Spring` wheels
   * (`CorsairWheelLeft`, `setStrength 24 / setDamping 12`, through
   * `PhysicsSpring::updatePhysics` at `0x0057f0d0`); modelling those is a
   * separate job — flight-model.md section 7 item 6. Two of their effects are
   * load-bearing for a takeoff and are stood in for here: the wheels hold the
   * wings level, and they stop the nose digging into the strip.
   *
   * Pitch-*up* is left entirely alone, and deliberately: rotation is the
   * aircraft turning about its main wheels under elevator authority, and a
   * ground constraint that damped it would mean an aircraft that can never
   * leave the ground.
   */
  settle(h) {
    const s = this.state;
    _g1.copy(FORWARD).applyQuaternion(s.orientation);
    const digging = _g1.y < 0;
    if (digging) _g1.y = 0;
    if (_g1.lengthSq() < 1e-9) return;
    _g1.normalize();
    _g2.crossVectors(_g1, UP);
    if (_g2.lengthSq() < 1e-6) return;
    _g2.normalize();
    _g3.crossVectors(_g2, _g1).normalize();
    _basis.makeBasis(_g2, _g3, _g4.copy(_g1).negate());
    _qs.setFromRotationMatrix(_basis);
    s.orientation.slerp(_qs, 1 - Math.exp(-h / GROUND_LEVEL_TAU));

    _qi.copy(s.orientation).invert();
    _omega.copy(s.angularVelocity).applyQuaternion(_qi);
    _omega.z *= Math.exp(-h / GROUND_LEVEL_TAU);
    if (digging && _omega.x < 0) _omega.x = 0;
    s.angularVelocity.copy(_omega).applyQuaternion(s.orientation);
  }

  /** Park the aircraft on the strip at its spawn, nose level, and step out. */
  reset() {
    if (this.autoFirstPerson) this.setFirstPerson(false);
    const s = this.state;
    s.velocity.set(0, 0, 0);
    s.angularVelocity.set(0, 0, 0);
    s.throttle = 0;
    s.airspeed = 0;
    s.propellerAngle = 0;
    s.propRpm = 0;
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
