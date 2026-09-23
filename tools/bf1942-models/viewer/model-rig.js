// The model browser's Refractor rig: every RotationalBundle and drivetrain
// posed from the player inputs it declares, the rate-driven parts that keep
// turning while an input is held, and the tread textures that scroll with
// throttle. The inputs themselves are set by the crew console. Lifted out of
// index.html (features/vehicle-instance-refactor, Part 2c).

import * as THREE from 'three';

// The exporter's synthetic axis for LandingGear retraction: not a player input,
// so its slider runs 0 (deployed, the authored rest pose) to 1 (retracted) and
// interpolates min..max directly instead of splitting the range about 0.
export const GEAR_INPUT = 'c_PILandingGear';

// An axis with no declared range traverses freely; show it over a full circle.
export const FREE_RANGE = 180;

// A player input belongs to a seat. The commander's MG lives inside its own
// PlayerControlObject, so its c_PIMouseLookY is a different mouse from the
// gunner's — keying on the bare input name welds the two together.
export const keyOf = (control, input) => `${control}/${input}`;

/**
 * Built once by the page, where this code used to sit. `page` hands in
 * what it reads of the rest of the page, as getters (a binding the page
 * reassigns is read live):
 * `rememberMap`.
 */
export function createModelRig(page) {
  const rig = {};

  // --- Refractor rig ---------------------------------------------------------
  //
  // A RotationalBundle is not an animation clip. It declares an axis, a range and a
  // player input, and the engine drives it every frame. Rebuilding that here is the
  // whole demonstration: one input can drive several parts on different axes.

  const AXIS = { yaw: 'y', pitch: 'x', roll: 'z' };

  // Same handedness fix the exporter applies to authored rotations: mirroring Z
  // conjugates rotations about X and Y, and leaves those about Z alone.
  const SIGN = { yaw: -1, pitch: -1, roll: 1 };

  const rigged = [];              // { node, base:Quaternion, axes, driver, key }
  const inputValues = new Map();  // "<control>/<input>" -> -1..1
  const rateAngle = new Map();    // same key -> accumulated degrees, for Engines

  function applyRig() {
    for (const part of rigged) {
      const q = part.base.clone();
      for (const [axis, spec] of Object.entries(part.axes)) {
        const key = keyOf(part.control, spec.input);
        let deg;
        if (spec.driver === 'rate') {
          // Throttle sets how fast the drivetrain turns, not where it stops.
          deg = rateAngle.get(`${key}/${axis}`) ?? 0;
        } else if (spec.free) {
          deg = (inputValues.get(key) ?? 0) * FREE_RANGE;
        } else if (spec.input === GEAR_INPUT) {
          // min is the deployed angle, max the retracted one — a pose pair,
          // not an ordered range (a Spitfire leg deploys at 0, retracts to -79).
          const t = inputValues.get(key) ?? 0;
          deg = spec.min + t * (spec.max - spec.min);
        } else {
          const t = inputValues.get(key) ?? 0;
          deg = t < 0 ? -t * spec.min : t * spec.max;
        }
        const e = new THREE.Euler(0, 0, 0);
        e[AXIS[axis]] = THREE.MathUtils.degToRad(deg * SIGN[axis]);
        q.multiply(new THREE.Quaternion().setFromEuler(e));
      }
      part.node.quaternion.copy(q);
    }
  }

  // --- scrolling track textures ----------------------------------------------
  //
  // `ObjectTemplate.setAnimatedTextureSpeed -0.006/0` slides a mesh's UVs along U.
  // It is how a Sherman's tread appears to move: the belt geometry itself is static
  // (that needs the .ske/.skn skinned path), only the texture crawls over it.
  //
  // The declared figure is in UV units per engine tick, which is not a unit this
  // viewer has, so it is scaled to per-second at the engine's 60 Hz assumption and
  // multiplied by throttle — a stationary tank has stationary tracks.
  const TICKS_PER_SECOND = 60;

  const scrolling = [];   // { maps:[Texture], speed:[u,v], control }

  function collectScrolling(root) {
    scrolling.length = 0;
    root.traverse(carrier => {
      const speed = carrier.userData?.animatedTextureSpeed;
      if (!speed) return;
      // A multi-material part arrives as a Group of Meshes, and the glTF node extras
      // land on that Group — so the declaration and the materials are never on the
      // same object. But the Group's direct children also include the part's *child
      // nodes*: a Sherman's 11 road wheels hang off its track. Only the Group's own
      // primitives may scroll, or the whole running gear's texture crawls with it.
      // Our exporter stamps every real part node with templateKind, so anything
      // carrying it is a separate part rather than one of this node's primitives.
      const own = [carrier, ...carrier.children.filter(c => !c.userData?.templateKind)];
      const maps = [];
      own.forEach(obj => {
        if (!obj.isMesh) return;
        // Materials and textures are shared across parts by the exporter's cache and
        // the loader's; offsetting one in place would scroll every part using it.
        const cloned = [obj.material].flat().map(m => {
          const clone = m.clone();
          if (clone.map) {
            clone.map = clone.map.clone();
            clone.map.needsUpdate = true;
            maps.push(clone.map);
          }
          return clone;
        });
        obj.material = cloned.length === 1 ? cloned[0] : cloned;
        for (const m of cloned) page.rememberMap(m);
      });
      if (maps.length) scrolling.push({ maps, speed, control: carrier.userData.control || 'vehicle' });
    });
  }

  function advanceScroll(dt) {
    for (const part of scrolling) {
      const throttle = inputValues.get(keyOf(part.control, 'c_PIThrottle')) ?? 0;
      if (!throttle) continue;
      const [u, v] = part.speed;
      for (const map of part.maps) {
        map.offset.x += u * TICKS_PER_SECOND * throttle * dt;
        map.offset.y += v * TICKS_PER_SECOND * throttle * dt;
      }
    }
  }

  // Rate-driven parts keep turning for as long as the input is held.
  function advanceRates(dt) {
    let moved = false;
    const advanced = new Set();
    for (const part of rigged) {
      for (const [axis, spec] of Object.entries(part.axes)) {
        if (spec.driver !== 'rate') continue;
        const t = inputValues.get(keyOf(part.control, spec.input)) ?? 0;
        if (!t) continue;
        const k = `${keyOf(part.control, spec.input)}/${axis}`;
        if (advanced.has(k)) continue;
        advanced.add(k);
        rateAngle.set(k, (rateAngle.get(k) ?? 0) + t * 360 * dt);
        moved = true;
      }
    }
    if (moved) applyRig();
  }

  /** A freshly loaded model's rig: its bundles and drivetrains, every input
   *  back at rest. */
  function collectRig(root) {
    rigged.length = 0;
    inputValues.clear();
    rateAngle.clear();
    const drivetrains = [];
    root.traverse(obj => {
      const rig = obj.userData?.rig;
      if (!rig?.axes) return;

      const axes = Object.entries(rig.axes);
      const rateAxes = Object.fromEntries(
        axes.filter(([, specification]) => specification.driver === 'rate'));
      const poseAxes = Object.fromEntries(
        axes.filter(([, specification]) => specification.driver !== 'rate'));
      const isDrivetrain = obj.userData.templateKind?.toLowerCase() === 'engine'
        && Object.keys(rateAxes).length;

      if (isDrivetrain) {
        drivetrains.push({
          node: obj,
          axes: rateAxes,
          control: rig.control || 'vehicle',
        });
        if (Object.keys(poseAxes).length) {
          rigged.push({
            node: obj,
            base: obj.quaternion.clone(),
            axes: poseAxes,
            control: rig.control || 'vehicle',
          });
        }
      } else {
        rigged.push({
          node: obj,
          base: obj.quaternion.clone(),
          axes: rig.axes,
          control: rig.control || 'vehicle',
        });
      }
    });
    for (const drivetrain of drivetrains) {
      const springs = [];
      drivetrain.node.traverse(node => {
        if (node !== drivetrain.node
            && node.userData.templateKind?.toLowerCase() === 'spring'
            && node.userData.geometry) {
          springs.push(node);
        }
      });
      if (springs.length) {
        const wheelAxis = Object.values(drivetrain.axes)[0];
        for (const spring of springs) {
          rigged.push({
            node: spring,
            base: spring.quaternion.clone(),
            axes: { pitch: wheelAxis },
            control: drivetrain.control,
          });
        }
      } else if (drivetrain.node.userData.geometry) {
        rigged.push({
          node: drivetrain.node,
          base: drivetrain.node.quaternion.clone(),
          axes: drivetrain.axes,
          control: drivetrain.control,
        });
      }
    }
  }

  /** Set player input `key` (-1..1); applyRig poses the parts it drives. */
  function setInput(key, value) {
    inputValues.set(key, value);
  }

  Object.assign(rig, {
    advanceRates,
    advanceScroll,
    applyRig,
    collectRig,
    collectScrolling,
    inputValues,
    rigged,
    scrolling,
    setInput,
  });
  return rig;
}
