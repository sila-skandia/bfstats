// The EffectBundles an object carries and the engine runs by itself: a tank
// track's dust, a wheel's spray, a boat's bow wave and wake, a burning
// building's smoke, a factory chimney, a mod's rain and snow boxes.
//
// The vehicle and level bakes hang a node for each at its placement
// (`extras.effect: { kind: 'bundle' }`, `bf42/assemble.py`
// `_effect_bundle_node`), and `idle-vehicle.js` keeps that node dark: what it
// holds are the emitters' parked template quads. This module runs the bundle
// of the same name out of the effect library (`extract_effects.py`
// `effect_names_for_hosts`) as an attached `EffectPlayer` run, started and
// stopped by the engine's three rules:
//
//   - `EffectBundle::init` (lnxded 0x081e0ed0) starts a bundle that has an
//     Emitter child with `startAtCreation 1` (`EmitterTemplate+0x13c`, tested
//     at 0x081e0f73). A placed static's smoke runs from level start.
//   - `Spring::init` (0x0824f590) stops every EffectBundle child of a Spring,
//     and `Spring::handleUpdate` (0x0824f6b0) starts one when the material
//     the wheel stands on (`Spring::handleCollision` 0x0824f9b0 stores it at
//     +0x10c) comes into the bundle's `addWorkOnMaterial` list
//     (`EffectBundleTemplate+0x170`, read at 0x0824f77f) and stops it when
//     the material leaves the list or the wheel leaves the ground. A bundle
//     on a Spring with no list never runs.
//   - `EffectBundle::handleUpdate` (0x081e1680) runs a bundle whose
//     `minDistanceUnderwaterSurface` is 0 or more (`+0x150`, default -1) only
//     while its own depth, the water level less its y, is inside
//     `[min, max]` (`+0x150`, `+0x154`; started at 0x081e17b7, stopped at
//     0x081e1740), and `handleMessage` (0x081e1460) ignores every start and
//     stop sent to such a bundle, the Spring's included.
//
// How hard it emits is the emitters' own business (`effects-core.js`
// `EmitterClock`): `intensityAtSpeed` scales the rate by the host's speed at
// the emitter, which `EffectPlayer.advance` reads off the attached node's
// motion, and OPTIONS > VIDEO's EFFECTS QUALITY scales every rate (VID-2).
//
// Ours, and labelled where they stand: the wheel's contact is a height test
// against the terrain (the page has no Spring collision for a hull nobody
// drives), a run on a host that is not moving is put away when none of its
// emitters could spawn there, and a run is put away past the bundle's
// `lodDistance`.
//
// Framework-free: no `three`, so `tests/ambient_effects_harness.mjs` drives
// it under plain node. Cost: `update` looks at a slice of the hosts each
// frame so that every host is seen ten times a second, about 30 nodes a frame
// on Wake's 270; each look is one world-matrix refresh and one height lookup.

import { WATER_MATERIAL } from './collision-materials.js';

/** An emitter's `lodDistance` when its template names none: the
 *  `EmitterTemplate` constructor's 300.0 (lnxded 0x081e5c5e, 0x43960000). */
export const DEFAULT_EMITTER_LOD = 300;
/** How often every host's gate is looked at, seconds. Ours: the engine looks
 *  every tick; a tenth of a second is under what a dust trail shows. */
export const GATE_INTERVAL = 0.1;
/** m/s. A host slower than this is at rest. Ours: an emitter that sets
 *  `intensityAtSpeed` spawns once every 3 s or less often below it. */
export const REST_SPEED = 0.2;
/** Metres a wheel's axle may stand over the ground, past its own radius, and
 *  still be on it. Ours: it stands in for `Spring::handleCollision`, and
 *  covers the spring's travel. */
export const SPRING_CONTACT_SLACK = 0.35;
/** A dummy spring's reach when it has no mesh to measure. Ours. */
export const DEFAULT_WHEEL_RADIUS = 0.5;
/** How far past its `lodDistance` a running bundle is kept, as a factor, so a
 *  camera on the line does not start and stop it every look. Ours. */
const LOD_HYSTERESIS = 1.1;

/** The template a baked node was made from: the glb's own name for it
 *  (`GLTFLoader` keeps it in `userData.name`), the scene loader having
 *  numbered every second copy (`e_wdustPanz_7`). */
const templateName = node => node.userData?.name ?? String(node.name ?? '').replace(/_\d+$/, '');
const isSpring = node => String(node?.userData?.templateKind ?? '').toLowerCase() === 'spring';

/**
 * How the engine starts `bundle` (an `EffectLibrary` entry) hung on a node
 * whose parent is, or is not, a Spring. Null for a bundle that waits for a
 * message (a gun's flash) or can never run where it hangs.
 *
 * `{ kind: 'auto' | 'spring' | 'water', materials, min, max, lod, loops,
 *    needsSpeed }`.
 */
export function bundleGate(bundle, onSpring) {
  const info = bundle?.node?.userData?.effectBundle ?? {};
  const emitters = bundle?.emitters ?? [];
  if (!emitters.length) return null;
  let lod = 0;
  let loops = false;
  let creates = false;
  let needsSpeed = true;
  for (const { spec } of emitters) {
    lod = Math.max(lod, spec.lodDistance > 0 ? spec.lodDistance : DEFAULT_EMITTER_LOD);
    if (spec.looping) loops = true;
    if (spec.startAtCreation) creates = true;
    if (!(spec.intensityAtSpeed > 1e-7)) needsSpeed = false;
  }
  const min = info.minDistanceUnderwaterSurface;
  const base = { materials: null, min: -1, max: -1, lod, loops, needsSpeed };
  if (Number.isFinite(min) && min >= 0) {
    const max = Number.isFinite(info.maxDistanceUnderwaterSurface)
      ? info.maxDistanceUnderwaterSurface : -1;
    return { ...base, kind: 'water', min, max };
  }
  if (onSpring) {
    const materials = info.workOnMaterials;
    if (!Array.isArray(materials) || !materials.length) return null;
    return { ...base, kind: 'spring', materials: new Set(materials) };
  }
  return creates ? { ...base, kind: 'auto' } : null;
}

/** Half the height of a wheel's own mesh, or null when it has none. */
function wheelRadius(node) {
  const geometry = node?.geometry;
  if (!geometry) return null;
  if (!geometry.boundingBox) geometry.computeBoundingBox?.();
  const box = geometry.boundingBox;
  if (!box) return null;
  const r = 0.5 * Math.max(box.max.y - box.min.y, box.max.z - box.min.z);
  return r > 0.05 ? r : null;
}

function refresh(node) {
  node.updateWorldMatrix?.(true, false);
  return node.matrixWorld.elements;
}

/** The level's group of vehicles (`extract_map.py` names it). */
const VEHICLES_GROUP = 'spawners';

/** The hull `node` rides: the node under the level's vehicles group that
 *  holds it, or null for a placed static's. */
function hullOf(node) {
  for (let at = node; at?.parent; at = at.parent) {
    if (String(at.parent.name).toLowerCase() === VEHICLES_GROUP) return at;
  }
  return null;
}

/** Whether anything from `node` up to its `hull` is switched off: a wrecked
 *  hull, a vehicle its pad has not stood up, the far alternative of a
 *  LodObject. Not asked of a placed static: the level switches those off
 *  past their own draw distance, which is not the smoke's (`lodDistance`). */
function hiddenUpTo(node, hull) {
  for (let at = node; at; at = at.parent) {
    if (at.visible === false) return true;
    if (at === hull) break;
  }
  return false;
}

export class AmbientEffects {
  /**
   * @param {object} options
   * @param {object} options.effects   the page's `EffectPlayer`
   * @param {() => object|null} options.ground  the level's collider:
   *   `{ heightfield: { height(x, z), material?(x, z) }, waterLevel }`
   * @param {() => number[]|null} [options.eye]  the camera's world position
   */
  constructor({ effects, ground = () => null, eye = () => null } = {}) {
    this.effects = effects;
    this.ground = ground;
    this.eye = eye;
    this.hosts = [];
    this.cursor = 0;
    this.debt = 0;
    this.enabled = true;
    // Looked at, started, stopped: for the readout and the tests.
    this.looks = 0;
    this.starts = 0;
    this.stops = 0;
  }

  /** Forget every host and stop what runs: a level change. */
  clear() {
    for (const host of this.hosts) this.#stop(host);
    this.hosts.length = 0;
    this.cursor = 0;
  }

  /**
   * Take every baked bundle node under `root` as a host. The gate is settled
   * on the first look, once the effect library is in (`bundleGate`). A node
   * already held is left alone, so a respawned hull keeps its hosts.
   * Returns how many were added.
   */
  adopt(root) {
    const held = new Set(this.hosts.map(h => h.node));
    let added = 0;
    const visit = node => {
      if (node.userData?.effect?.kind === 'bundle') {
        if (!held.has(node)) {
          this.hosts.push({
            node, name: templateName(node), gate: undefined, library: null, handle: null,
            spent: false, last: null, radius: undefined, hull: hullOf(node),
          });
          added++;
        }
        return;   // a bundle's own children are its emitters' parked quads
      }
      const children = node.children;
      if (children) for (const child of children) visit(child);
    };
    if (root) visit(root);
    return added;
  }

  /** The level's own root: everything before it goes. */
  adoptLevel(root) {
    this.clear();
    return this.adopt(root);
  }

  stats() {
    let running = 0;
    const kinds = { auto: 0, spring: 0, water: 0, none: 0, pending: 0 };
    for (const host of this.hosts) {
      if (host.handle) running++;
      if (host.gate === undefined) kinds.pending++;
      else kinds[host.gate?.kind ?? 'none']++;
    }
    return { hosts: this.hosts.length, running, ...kinds,
             looks: this.looks, starts: this.starts, stops: this.stops };
  }

  /** Look at this frame's share of the hosts. */
  update(dt) {
    const n = this.hosts.length;
    if (!n || !(dt > 0)) return;
    const library = this.effects?.library;
    if (!library) return;
    this.debt += Math.min(dt, GATE_INTERVAL) * n / GATE_INTERVAL;
    let due = Math.min(n, Math.floor(this.debt));
    this.debt -= due;
    const ground = this.ground?.() ?? null;
    const eye = this.eye?.() ?? null;
    while (due-- > 0) {
      if (this.cursor >= this.hosts.length) this.cursor = 0;
      this.#look(this.hosts[this.cursor++], library, ground, eye);
    }
  }

  /** Every host at once: a test's, and a page's after a seek. */
  lookAll() {
    const library = this.effects?.library;
    if (!library) return;
    const ground = this.ground?.() ?? null;
    const eye = this.eye?.() ?? null;
    for (const host of this.hosts) this.#look(host, library, ground, eye);
  }

  #look(host, library, ground, eye) {
    this.looks++;
    // The library the gate was read from: a level's own bundles go in front
    // of the mod's after the level is up, and a name can change hands.
    const bundle = library.get(host.name);
    if (host.library !== bundle) {
      host.library = bundle;
      host.gate = bundle ? bundleGate(bundle, isSpring(host.node.parent)) : null;
      if (host.gate && host.handle) this.#stop(host);
    }
    const gate = host.gate;
    if (!gate || !this.enabled) { if (host.handle) this.#stop(host); return; }
    // A run that ended by itself (no looping emitter) or was swept away with
    // the level's particles (`EffectPlayer.clear`).
    if (host.handle && host.handle.run && host.handle.run.alive === false) {
      host.handle = null;
      if (!gate.loops) host.spent = true;
    }
    if (host.spent) return;
    const want = this.#wants(host, gate, ground, eye);
    if (want && !host.handle) this.#start(host);
    else if (!want && host.handle) this.#stop(host);
  }

  #wants(host, gate, ground, eye) {
    const node = host.node;
    if (host.hull && hiddenUpTo(node.parent, host.hull)) return false;
    const e = refresh(node);
    const x = e[12], y = e[13], z = e[14];
    // How far it moved since the last look, for the rest gate.
    const last = host.last ??= { x, y, z, moving: false };
    const moved = Math.hypot(x - last.x, y - last.y, z - last.z);
    last.moving = moved > REST_SPEED * GATE_INTERVAL;
    last.x = x; last.y = y; last.z = z;
    if (eye) {
      const reach = gate.lod * (host.handle ? LOD_HYSTERESIS : 1);
      if (Math.hypot(x - eye[0], y - eye[1], z - eye[2]) > reach) return false;
    }
    const water = ground?.waterLevel;
    if (gate.kind === 'water') {
      // `EffectBundle::handleUpdate`: depth = water level - y, running while
      // min <= depth <= max, and never over the water (0x081e1716).
      if (!Number.isFinite(water)) return false;
      const depth = water - y;
      if (depth < 0 || depth < gate.min || depth > gate.max) return false;
      return !gate.needsSpeed || last.moving;
    }
    if (gate.kind === 'spring') {
      if (gate.needsSpeed && !last.moving) return false;
      const field = ground?.heightfield;
      if (!field?.height) return false;
      const spring = node.parent;
      const s = refresh(spring);
      const sx = s[12], sy = s[13], sz = s[14];
      if (host.radius === undefined) host.radius = wheelRadius(spring) ?? DEFAULT_WHEEL_RADIUS;
      const reach = host.radius + SPRING_CONTACT_SLACK;
      const floor = field.height(sx, sz);
      let material = -1;
      if (Number.isFinite(water) && floor < water) {
        // The sea lies over the ground here: the wheel meets the water first.
        if (sy - water <= reach) material = WATER_MATERIAL;
      } else if (Number.isFinite(floor) && sy - floor <= reach) {
        material = field.material ? field.material(sx, sz) : 0;
      }
      return gate.materials.has(material);
    }
    return true;   // 'auto'
  }

  #start(host) {
    // `view: 'third'`: the first-person flag gates an emitter only where the
    // soldier's own tree gave it a field of view (`setFirstPersonFov`,
    // EMT-12), which no vehicle's or static's emitter is under. The driver
    // sees their own tracks' dust from the seat (`Em_wDust` is
    // `showInThirdPerson 1`, skipped only for an emitter with that FOV: the
    // Mac client's `Emitter::handleUpdate`, `+0x10c > 0` and `+0x460`).
    const handle = this.effects.play(host.name, {
      attach: { object: host.node }, ambient: true, view: 'third',
    });
    if (!handle) { host.spent = !host.gate.loops; return; }
    host.handle = handle;
    this.starts++;
  }

  #stop(host) {
    if (!host.handle) return;
    try { host.handle.stop(); } catch (_) {}
    host.handle = null;
    this.stops++;
  }
}
