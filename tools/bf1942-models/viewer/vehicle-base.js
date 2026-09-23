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
export const keyOf = (control, input) => `${control}/${input}`;

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
export function axisAngle(spec, input) {
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
