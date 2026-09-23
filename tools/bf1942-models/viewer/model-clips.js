// The model browser's baked engine clips: the looping spin clips an Engine's
// throttle runs, the ambient rotators that run for good, and the propeller
// blade/blurred-disc pairs the engine switch swaps between. Lifted out of
// index.html (features/vehicle-instance-refactor, Part 2c).

import * as THREE from 'three';

/**
 * Built once by the page, where this code used to sit. `page` hands in
 * what it reads of the rest of the page, as getters (a binding the page
 * reassigns is read live):
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

  function collectAnimations(gltf) {
    engineClips.mixer = null;
    engineClips.clipActions = [];
    engineClips.ambientActions = [];
    engineClips.engineRunning = false;
    engineClips.animatedNodes = [];
    engineClips.propellerBlurPairs = [];
    gltf.scene.traverse(obj => {
      const blur = obj.userData?.propellerBlur;
      if (!blur) return;
      const staticNode = obj.children.find(child => child.name === blur.static);
      const blurredNode = obj.children.find(child => child.name === blur.blurred);
      if (staticNode && blurredNode) engineClips.propellerBlurPairs.push({ static: staticNode, blurred: blurredNode });
    });
    setPropellerBlur(false);
    const clips = gltf.animations || [];
    if (!clips.length) return;
    engineClips.mixer = new THREE.AnimationMixer(gltf.scene);
    for (const clip of clips) {
      const action = engineClips.mixer.clipAction(clip);
      action.setLoop(THREE.LoopRepeat, Infinity);
      if (/^spin(\.\d+)?$/.test(clip.name)) {
        engineClips.clipActions.push(action);
      } else {
        engineClips.ambientActions.push(action);
        action.play();
      }
    }
    // Every track name is "<node name>.quaternion" / ".position".
    engineClips.animatedNodes = [...new Set(clips.flatMap(clip =>
      clip.tracks.map(track => track.name.split('.')[0])))];
  }

  /** Blades stopped (off) or the blurred disc (on) — same gate as `setEngine`. */
  function setPropellerBlur(on) {
    for (const pair of engineClips.propellerBlurPairs) {
      pair.static.visible = !on;
      pair.blurred.visible = on;
    }
  }

  function setEngine(on) {
    engineClips.engineRunning = Boolean(on);
    setPropellerBlur(engineClips.engineRunning);
    if (!engineClips.mixer) return;
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
    collectAnimations,
    setEngine,
  });
  return engineClips;
}
