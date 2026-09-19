// Viewmodel upper-body clip selection for on-foot fire / reload / loco.
//
// Kept pure so the BAR/Thompson release bug (LoopRepeat `isRunning()` stays
// true forever, so a `fireRunning` keep-alive must not outrank the trigger
// latch) can be asserted without booting map.html. Engine notes: ANIM-7
// (PlayOnce → returnTo StandReload), CS-6 (Ub fire shake is the clip / upper
// machine — not cool-gated locomotion bob).
//
// A second half of the same bug lives in map.html `playViewmodelClip`: idle's
// morphFactor is ~0.7 (~1.4 s settle). crossFadeFrom keeps LoopRepeat fire
// evaluating at declining weight for that whole settle, so stationary release
// still shakes. Walk/reload look fine because walk replaces the motion and
// reload snaps (morphFactor >= 1000 → from.stop()). map.html must freeze or
// stop the fire action when `stopLoopFire` is set (timeScale 0, then fade).

export const LOCO_CLIP = {
  run: 'run', walk: 'walk', stand: 'idle', crouch: 'idle', prone: 'idle',
};

/**
 * Which arms clip this frame owes.
 *
 * @param {{
 *   reload: number,
 *   reloadPlayed: boolean,
 *   reloadRunning: boolean,
 *   deployRunning: boolean,
 *   active: string | null,
 *   fireRunning: boolean,
 *   fireLoops: boolean,
 *   fireReturnsToReload: boolean,
 *   firing: boolean,
 *   hasFire: boolean,
 *   hasReload: boolean,
 *   gait: string | null | undefined,
 *   fidget: string | null,
 *   fidgetRunning: boolean,
 *   fidgetDue: boolean,
 *   fidgetPick: string | null,
 * }} s
 * @returns {{
 *   want: string,
 *   markReloadPlayed?: boolean,
 *   startReload?: boolean,
 *   startFire?: boolean,
 *   stopLoopFire?: boolean,
 *   startFidget?: boolean,
 *   endFidget?: boolean,
 * }}
 */
export function wantViewmodelClip(s) {
  const loco = LOCO_CLIP[s.gait] || 'idle';
  // Own the arms for the whole magazine timer, not only until LoopOnce
  // clamps. Three.js sets paused after clampWhenFinished, so isRunning()
  // goes false while reloadTime is still counting — falling through to idle
  // mid-reload looked like a missing animation. Prefer isScheduled() (or
  // equivalent) for reloadRunning at the call site.
  if (s.reload > 0) {
    if (!s.reloadPlayed) {
      return { want: 'reload', markReloadPlayed: true, startReload: true };
    }
    return {
      want: 'reload',
      startReload: s.active !== 'reload' || !s.reloadRunning,
    };
  }
  if (s.active === 'reload' && s.reloadRunning) return { want: 'reload' };
  if (s.active === 'deploy' && s.deployRunning) return { want: 'deploy' };
  // Looping fire (c_AsmLooping) follows the trigger latch. Checked before the
  // PlayOnce fireRunning keep — Three.js LoopRepeat never clears isRunning().
  if (s.fireLoops && s.firing && s.hasFire) {
    return { want: 'fire', startFire: !s.fireRunning };
  }
  if (s.active === 'fire' && s.fireRunning && !s.fireLoops) {
    return { want: 'fire' };
  }
  if (s.active === 'fire' && !s.fireRunning && s.fireReturnsToReload && s.hasReload) {
    return { want: 'reload', startReload: true };
  }
  // Trigger up while a LoopRepeat fire action is still scheduled: selection
  // returns loco (idle when gait is stand), and the mixer must freeze/stop
  // fire — see map.html playViewmodelClip / stopLoopFire handling.
  if (s.fireLoops && s.fireRunning && !s.firing) {
    return { want: loco, stopLoopFire: true };
  }
  // The idle fidgets (ANIM-6): the aim state registers Ub_Idle<W>1..3, its
  // 4-7 s dwell timer picks one at random, and each one-shot returns to the
  // aim state through addTransitionWhenDone. Only the aim state's own timer
  // fires — the fidget states register none — so a fidget owns the arms from
  // `idle` only, fire/reload/moving interrupt it exactly like the engine's
  // input transitions leave it, and its finish (LoopOnce clamp →
  // fidgetRunning false) sends the arms back to idle, where the caller
  // re-arms a fresh dwell.
  if (s.fidget && s.active === s.fidget) {
    if (s.fidgetRunning) return { want: s.fidget };
    return { want: loco, endFidget: true };
  }
  if (s.fidgetDue) return { want: s.fidgetPick, startFidget: true };
  return { want: loco };
}
