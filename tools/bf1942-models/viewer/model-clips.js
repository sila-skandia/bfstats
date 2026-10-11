// The model browser's baked engine clips: the looping spin clips an Engine's
// throttle runs, the ambient rotators that run for good, and the propeller
// blade/blurred-disc pairs the engine switch swaps between. Lifted out of
// index.html (features/vehicle-instance-refactor, Part 2c).

import * as THREE from 'three';
import { revAdvance } from './engine-revs.js';
import {
  ENGINE_TICK_HZ, discAt, engineOfLodPair, lodNodeKey, lodSpinState, poseLodSpin, stepLodSpin, unboundRollAxis,
} from './engine-spin.js';

/**
 * Built once by the page, where this code used to sit. `page` hands in
 * what it reads of the rest of the page, as getters (a binding the page
 * reassigns is read live):
 * `inputValues` (the crew console's levers, `"<control>/<input>"` to -1..1),
 * `invalidate`, `refreshCrew`, `startAnimating`.
 */
export function createEngineClips(page) {
  const engineClips = {};

  // --- baked engine clips -----------------------------------------------------
  //
  // The extractor bakes each Engine's throttle-driven spin (and every
  // `setContinousRotationSpeed` ambient rotator) into looping glTF clips named
  // `spin`, `spin.1`, ... — one clip per rotation period so each loops
  // seamlessly. The viewer just plays them all; parts that must not spin (a
  // Corsair's landing gear shares the propeller's Engine parent) were excluded
  // at bake time via their `hasMobilePhysics` flag.

  engineClips.mixer = null;
  engineClips.clipActions = [];
  // `ambient*` clips are the rotation the engine runs off deltaTime alone —
  // a ship's radar dish, a windmill's sails. They are not throttle-gated in the
  // game and must not be here either, so they are held apart from `spin*` and
  // started once, for good.
  engineClips.ambientActions = [];
  engineClips.engineRunning = false;

  // Names of the nodes the baked clips move, for the station that owns them.
  engineClips.animatedNodes = [];
  // Each propeller's blade mesh and blurred disc, kept as real siblings by
  // `extras.propellerBlur` (assemble.py's `_propeller_blur`) instead of the
  // export picking one. Neither is animation, so `collectAnimations` finds
  // them itself rather than reading them off a clip.
  engineClips.propellerBlurPairs = [];
  /** Whether any pair hangs under an Engine: the model has an engine to run. */
  engineClips.hasEngine = false;

  /**
   * `T1` for an Engine as the browser holds it: `clippedRollAngle /
   * maxRotation.z` (`Engine::handleUpdate`, TANK-12). A bound Engine takes
   * the throttle lever's value the way `Engine::handlePlayerInput` hands it
   * to the roll axis; one that binds nothing sits on the bound its span
   * pins (`engine-spin.js` `unboundRollAxis`), which is how the Flettner's
   * rotors run with no lever at all.
   */
  function throttleTermOf(engine) {
    const data = engine.userData || {};
    const physics = data.physics || {};
    const maxZ = Array.isArray(physics.maxRotation) ? physics.maxRotation[2] : 0;
    const roll = data.rig?.axes?.roll;
    let angle;
    if (roll?.input) {
      const lever = page.inputValues?.get(`${data.rig.control || 'vehicle'}/${roll.input}`) ?? 0;
      const lo = Math.min(roll.min ?? 0, roll.max ?? 0), hi = Math.max(roll.min ?? 0, roll.max ?? 0);
      angle = lever < 0 ? -lever * (roll.min ?? 0) : lever * (roll.max ?? 0);
      angle = Math.max(lo, Math.min(hi, angle));
    } else {
      const axis = unboundRollAxis(physics);
      if (!axis) return 0;
      // The servo has nothing to move (input 0, angle 0); the clip is what
      // acts, in `calculateAndClipAngle`'s order: above the top pulls to the
      // top, else below the bottom lifts to the bottom.
      angle = 0;
      if (angle > axis.max) angle = axis.max;
      else if (angle < axis.min) angle = axis.min;
    }
    return maxZ ? angle / maxZ : 0;
  }

  /**
   * One frame of every pair that hangs under an Engine: the revs the engine
   * would hold (TANK-12's filter on `T1`, nothing loading it) while the
   * engine switch is on and none while it is off (`Engine+0x142` clear), and
   * the tail of `PhysicsEngine::updatePhysics` on them (`engine-spin.js`):
   * the current alternative turns `revs * 20` degrees a tick about its own
   * Z and the disc is current past `comparison^2`. Returns whether any pair
   * is still turning, so the page keeps its frame loop.
   */
  function advanceLods(dt) {
    let moving = false;
    const ticks = Math.max(0, dt) * ENGINE_TICK_HZ;
    for (const pair of engineClips.propellerBlurPairs) {
      if (!pair.engine) continue;
      const revs = engineClips.engineRunning
        ? revAdvance(pair.revs ?? 0, throttleTermOf(pair.engine), 0, ticks) : 0;
      stepLodSpin(pair, revs, ticks);
      pair.static.visible = !discAt(revs, pair.threshold);
      pair.blurred.visible = !pair.static.visible;
      poseLodSpin(pair);
      if (revs !== 0) moving = true;
    }
    return moving;
  }

  function collectAnimations(gltf) {
    engineClips.mixer = null;
    engineClips.clipActions = [];
    engineClips.ambientActions = [];
    engineClips.engineRunning = false;
    engineClips.animatedNodes = [];
    engineClips.propellerBlurPairs = [];
    engineClips.hasEngine = false;
    gltf.scene.traverse(obj => {
      const blur = obj.userData?.propellerBlur;
      if (!blur) return;
      // A second instance's nodes are renamed in the scene document
      // (`Flettner_Rotary_Static_1`): matched on the bare name key.
      const staticKey = lodNodeKey(blur.static), blurredKey = lodNodeKey(blur.blurred);
      const staticNode = obj.children.find(child => lodNodeKey(child.name) === staticKey);
      const blurredNode = obj.children.find(child => lodNodeKey(child.name) === blurredKey);
      if (staticNode && blurredNode) {
        engineClips.propellerBlurPairs.push({
          static: staticNode,
          blurred: blurredNode,
          threshold: blur.comparisons?.[0] ?? 0.07,
          // The Engine it hangs under: the pair is that engine's, turned on
          // its revs (`advanceLods`), not by a baked clip.
          engine: engineOfLodPair(obj),
          ...lodSpinState(staticNode, blurredNode),
        });
      }
    });
    engineClips.hasEngine = engineClips.propellerBlurPairs.some(pair => pair.engine);
    setPropellerBlur(false);
    for (const pair of engineClips.propellerBlurPairs) {
      if (!pair.engine) continue;
      // Engine off: the blade at its authored pose, the disc hidden.
      pair.static.visible = true;
      pair.blurred.visible = false;
      poseLodSpin(pair);
    }
    const clips = gltf.animations || [];
    if (!clips.length) return;
    engineClips.mixer = new THREE.AnimationMixer(gltf.scene);
    for (const clip of clips) {
      const action = engineClips.mixer.clipAction(clip);
      action.setLoop(THREE.LoopRepeat, Infinity);
      if (/^spin(\.\d+)?$/.test(clip.name)) {
        // A pair that hangs under an Engine is turned on that engine's revs
        // (`advanceLods`), as the tail of `PhysicsEngine::updatePhysics`
        // does; the baked clip would also swing whatever else the exporter
        // listed under the Engine (a Mosquito's gear hatches), so it only
        // plays for a model with no engine pair (a legacy asset).
        if (!engineClips.hasEngine) engineClips.clipActions.push(action);
      } else {
        engineClips.ambientActions.push(action);
        action.play();
      }
    }
    // Every track name is "<node name>.quaternion" / ".position".
    engineClips.animatedNodes = [...new Set(clips.flatMap(clip =>
      clip.tracks.map(track => track.name.split('.')[0])))];
  }

  /** Blades stopped (off) or the blurred disc (on) — same gate as `setEngine`,
   *  for a pair that hangs under no Engine. */
  function setPropellerBlur(on) {
    for (const pair of engineClips.propellerBlurPairs) {
      if (pair.engine) continue;
      pair.static.visible = !on;
      pair.blurred.visible = on;
    }
  }

  function setEngine(on) {
    engineClips.engineRunning = Boolean(on);
    setPropellerBlur(engineClips.engineRunning);
    if (!engineClips.engineRunning) {
      // Revs 0, blades at their authored pose (`Engine+0x142` clear).
      for (const pair of engineClips.propellerBlurPairs) {
        if (!pair.engine) continue;
        pair.revs = 0;
        pair.staticAngle = 0;
        pair.blurredAngle = 0;
        pair.static.visible = true;
        pair.blurred.visible = false;
        poseLodSpin(pair);
      }
    }
    if (engineClips.engineRunning && engineClips.hasEngine) page.startAnimating();
    if (!engineClips.mixer) {
      if (engineClips.hasEngine) { page.invalidate(); page.refreshCrew(); }
      return;
    }
    if (engineClips.engineRunning) {
      for (const action of engineClips.clipActions) { action.paused = false; action.play(); }
      page.startAnimating();
    } else {
      // Rewind to the authored pose rather than freezing mid-turn — but only
      // the throttle-gated clips. `mixer.setTime(0)` would drag the ambient
      // rotators back to zero with them and snap a turning radar dish.
      for (const action of engineClips.clipActions) action.reset();
      engineClips.mixer.update(0);
      for (const action of engineClips.clipActions) action.stop();
      page.invalidate();
    }
    page.refreshCrew();
  }

  Object.assign(engineClips, {
    advanceLods,
    collectAnimations,
    setEngine,
  });
  return engineClips;
}
