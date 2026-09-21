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
 * Fire selection: a weapon's fire state is usually one clip (`fire`), but the
 * knife's aim state registers five of them (`1pFireKnife1..5` — ANIM-6's
 * `addAnimation ... c_AsmRandom`, the engine picks `rand() % n` per entry into
 * the state) and the extractor bakes them as `fire1..fireN`. `fireVariants`
 * carries those names. With variants, `want` names whichever variant currently
 * owns the arms (`fire3`), which map.html plays like any other action; the
 * per-round pick itself belongs to the shot path (`onShot`), not here —
 * selection re-rolling dice every held-trigger frame would rewind a swing
 * mid-arc. `hasFire` covers both shapes, and every rule below that used to
 * compare `active === 'fire'` now accepts a variant too, so a swing keeps the
 * arms until its one-shot clamps and a release drops back to loco through the
 * same path a rifle's does.
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
 *   fireReturnsToDeploy: boolean,
 *   firing: boolean,
 *   hasFire: boolean,
 *   hasReload: boolean,
 *   hasDeploy: boolean,
 *   gait: string | null | undefined,
 *   fidget: string | null,
 *   fidgetRunning: boolean,
 *   fidgetDue: boolean,
 *   fidgetPick: string | null,
 *   fireVariants?: string[] | null,
 * }} s
 * @returns {{
 *   want: string,
 *   markReloadPlayed?: boolean,
 *   startReload?: boolean,
 *   startFire?: boolean,
 *   startDeploy?: boolean,
 *   stopLoopFire?: boolean,
 *   startFidget?: boolean,
 *   endFidget?: boolean,
 * }}
 */
export function wantViewmodelClip(s) {
  const loco = LOCO_CLIP[s.gait] || 'idle';
  const variants = s.fireVariants?.length ? s.fireVariants : null;
  // The fire clip owning the arms right now: the lone `fire` action, or
  // whichever variant is mid-swing.
  const activeFire = s.active === 'fire' || variants?.includes(s.active)
    ? s.active : null;
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
      // Re-own the reload clip only when the arms were actually taken by
      // something else. Do NOT restart it because the LoopOnce pass ended
      // (`!s.reloadRunning`) while the reload timer is still counting: the
      // clip's span is fitted to reloadTime (1pAnimationsTweaking.con), so a
      // finished pass means the magazine is almost in, and restarting it
      // replays the reload sound that has already played for this magazine.
      startReload: s.active !== 'reload',
    };
  }
  // Hold the reload clip on the arms only while the reload is actually in
  // progress. The un-gated keep-alive below used to keep the reload clip (and
  // its looped audio, where the animation carries a sound channel) owning the
  // arms even after an ammo box's `refillAmmo` set `reload = 0` mid-pass with
  // ammo already restored to full -- the guns froze mid-reload forever,
  // repeatedly replaying the reload sound. Gating on `reload > 0` makes the
  // reload end exactly when the magazine is seated: a normal reload returns
  // to loco as the timer completes, and an ammo-box top-up that cancels the
  // timer drops straight back to idle so the sound stops.
  if (s.reload > 0 && s.active === 'reload' && s.reloadRunning) {
    return { want: 'reload' };
  }
  if (s.active === 'deploy' && s.deployRunning) return { want: 'deploy' };
  // Looping fire (c_AsmLooping) follows the trigger latch. Checked before the
  // PlayOnce fireRunning keep — Three.js LoopRepeat never clears isRunning().
  if (s.fireLoops && s.firing && s.hasFire) {
    return { want: 'fire', startFire: !s.fireRunning };
  }
  if (activeFire && s.fireRunning && !s.fireLoops) {
    return { want: activeFire };
  }
  if (activeFire && !s.fireRunning && s.fireReturnsToReload && s.hasReload) {
    return { want: 'reload', startReload: true };
  }
  // The throw's own returnTo. A rifle's fire state returns to StandReload
  // (ANIM-7, above); a grenade's returns to `Ub_StandResetRaiseWeapon<W>` —
  // it has no reload clip at all, because reloading a grenade *is* raising the
  // next one. Same shape as the rule above, aimed at the deploy family, so the
  // arms bring up grenade two instead of dropping to idle empty-handed.
  if (activeFire && !s.fireRunning && s.fireReturnsToDeploy && s.hasDeploy) {
    return { want: 'deploy', startDeploy: true };
  }
  // Trigger up while a LoopRepeat fire action is still scheduled: selection
  // returns loco (idle when gait is stand), and the mixer must freeze/stop
  // fire — see map.html playViewmodelClip / stopLoopFire handling.
  if (s.fireLoops && s.fireRunning && !s.firing) {
    return { want: loco, stopLoopFire: true };
  }
  // Entering the fire state anew is never selection's call for a one-shot —
  // the shot path (`onShot`) restarts the clip per round, and re-rolling the
  // pick here every held-trigger frame would rewind a swing mid-arc. `fire`
  // state entry on the looper path above is the engine's own transition;
  // everything a variant weapon owes selection is the keep and the release.
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
