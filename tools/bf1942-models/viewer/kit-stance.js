// The kit inspector's stances: the three one-pose clips a pose glb carries,
// their buttons, and the blend between them. Lifted out of kits.html
// (features/vehicle-instance-refactor, Part 2d).

import * as THREE from 'three';

/**
 * Built once by the page, where this code used to sit. `page` hands in
 * what it reads of the rest of the page, as getters (a binding the page
 * reassigns is read live):
 * `current`, `startAnimating`, `writeHash`.
 */
export function createKitStance(page) {
  // --- Stances ---------------------------------------------------------------
  // Lifted from poses.html: stances are constant one-pose clips in the glb and
  // the switch blends their weights. A kit part parented to a bone rides the
  // blend for free, which is the whole reason it is parented rather than welded.
  const STANCE_KEYS = ['stand', 'crouch', 'lie'];
  const STANCE_BLEND_MS = 450;
  let stance = 'stand';
  let mixer = null;
  let stanceActions = {};
  let stanceBlend = null;

  const kitStance = {
    // The stance on show (or asked for, before a figure is up).
    get stance() { return stance; },
    // The figure's mixer, for the frame loop to advance; null when the glb
    // carries no stance clips.
    get mixer() { return mixer; },
    // Whether a blend is under way, for the frame loop's keep-going test.
    get blending() { return stanceBlend !== null; },
  };

  const stanceButtons = [...document.querySelectorAll('[data-stance]')];

  function updateStanceButtons() {
    for (const button of stanceButtons) {
      button.disabled = page.current ? !stanceActions[button.dataset.stance] : true;
      button.classList.toggle('active', button.dataset.stance === stance);
    }
  }

  function setStance(next) {
    if (!STANCE_KEYS.includes(next) || next === stance) return;
    if (page.current && !stanceActions[next]) return;
    stance = next;
    updateStanceButtons();
    page.writeHash();
    if (!mixer || !stanceActions[next]) return;
    // Not crossFadeTo: its fade scales the action's own weight and these idle
    // stances sit at weight 0, so the incoming pose would never appear.
    stanceBlend = {
      from: Object.fromEntries(Object.entries(stanceActions)
        .map(([name, action]) => [name, action.getEffectiveWeight()])),
      start: performance.now(),
    };
    page.startAnimating();
  }

  function advanceStanceBlend(now) {
    if (!stanceBlend) return false;
    const t = Math.min((now - stanceBlend.start) / STANCE_BLEND_MS, 1);
    const eased = t * t * (3 - 2 * t);
    for (const [name, action] of Object.entries(stanceActions))
      action.setEffectiveWeight(
        THREE.MathUtils.lerp(stanceBlend.from[name], name === stance ? 1 : 0, eased));
    if (t < 1) return false;
    stanceBlend = null;
    return true;
  }

  for (const button of stanceButtons)
    button.addEventListener('click', () => setStance(button.dataset.stance));

  /** Ask for a stance before the figure that will wear it has loaded (a deep
   *  link); binding the figure falls back to standing if it lacks the clip. */
  function presetStance(next) {
    stance = next;
  }

  /** Build the mixer on the figure just put on stage (`page.current`), from
   *  its clips, at the current stance's weight. */
  function bindFigure(animations) {
    mixer = null;
    stanceActions = {};
    stanceBlend = null;
    for (const name of STANCE_KEYS) {
      const clip = THREE.AnimationClip.findByName(animations ?? [], name);
      if (!clip) continue;
      mixer ??= new THREE.AnimationMixer(page.current);
      const action = mixer.clipAction(clip);
      action.play();
      action.setEffectiveWeight(0);
      stanceActions[name] = action;
    }
    if (!stanceActions[stance]) stance = 'stand';
    stanceActions[stance]?.setEffectiveWeight(1);
    mixer?.update(0);
    updateStanceButtons();
  }

  Object.assign(kitStance, {
    advanceStanceBlend,
    bindFigure,
    presetStance,
    setStance,
  });
  return kitStance;
}
