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
 * }} s
 * @returns {{
 *   want: string,
 *   markReloadPlayed?: boolean,
 *   startReload?: boolean,
 *   startFire?: boolean,
 *   stopLoopFire?: boolean,
 * }}
 */
export function wantViewmodelClip(s) {
  const loco = LOCO_CLIP[s.gait] || 'idle';
  if (s.reload > 0 && !s.reloadPlayed) {
    return { want: 'reload', markReloadPlayed: true, startReload: true };
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
  return { want: loco };
}
