// The grip inspector's `?shots` hooks: `window.__poseInspector`, which the
// headless screenshot harness drives. Lifted out of poses.html
// (features/vehicle-instance-refactor, Part 2d).

import * as THREE from 'three';

/**
 * Installed once by the page, once the pose manifest has loaded. `page` hands
 * in what it reads of the rest of the page, as getters (a binding the page
 * reassigns is read live):
 * `activeGait`, `current`, `eachAction`, `gaitActions`, `gaitInfo`,
 * `manifest`, `mixer`, `motion`, `select`, `setMotion`, `setStance`,
 * `settleWeights`, `stance`, `stanceActions`, `startAnimating`, `statusLine`.
 */
export function installPoseTestHooks(page) {
  // Deterministic hooks for the headless screenshot harness.
  window.__poseInspector = {
    manifest: page.manifest,
    get stance() { return page.stance; },
    get motion() { return page.motion; },
    get gait() { return page.activeGait(); },
    get gaitInfo() { return page.gaitInfo; },
    get status() { return page.statusLine.textContent; },
    stances: () => Object.keys(page.stanceActions),
    gaits: () => Object.keys(page.gaitActions),
    // What the mixer is actually applying, for a headless check that the
    // gait is playing rather than merely loaded.
    weights: () => {
      const out = {};
      page.eachAction((name, action) => {
        const w = action.getEffectiveWeight();
        if (w > 0.001) out[name] = +w.toFixed(3);
      });
      return out;
    },
    // Bone world positions, so a test can assert the figure actually moves
    // between two samples of the same gait.
    bone(name) {
      let found = null;
      page.current?.traverse(obj => {
        if (!found && obj.name === name.replace(/ /g, '_')) found = obj;
      });
      return found ? found.getWorldPosition(new THREE.Vector3()).toArray() : null;
    },
    // One full lower-body cycle sampled at fixed phases, independent of
    // frame timing: settle the weights, park both halves at an exact clip
    // time, apply, read. Deterministic — it never waits on the render loop
    // or on a crossfade — so the same call reproduces the same numbers and
    // two builds can be compared against each other rather than eyeballed.
    sampleCycle(bones, steps = 12) {
      const gait = page.activeGait();
      if (!gait || !page.mixer) return null;
      page.settleWeights();
      const halves = Object.values(page.gaitActions[gait]);
      const wasPaused = halves.map(action => action.paused);
      const period = page.gaitActions[gait].lower.getClip().duration;
      const out = [];
      for (let i = 0; i < steps; i++) {
        const t = (i / steps) * period;
        for (const action of halves) {
          action.paused = true;
          action.time = t % action.getClip().duration;
        }
        page.mixer.update(0);
        page.current.updateMatrixWorld(true);
        const row = { t: +t.toFixed(4) };
        for (const name of bones) row[name] = this.bone(name)?.map(v => +v.toFixed(4));
        out.push(row);
      }
      halves.forEach((action, i) => { action.paused = wasPaused[i]; });
      page.startAnimating();
      return { gait, period, samples: out };
    },
    setStance: page.setStance,
    setMotion: page.setMotion,
    select(soldier, weapon) {
      page.select(soldier, weapon);
    },
  };
}
