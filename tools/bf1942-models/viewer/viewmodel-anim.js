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

import { locoClip, stanceClip, stanceFor } from './stance-clips.js';

/**
 * The flat gait -> family table this used to carry, kept for the two callers
 * that only want the standing answer and for the test that pins it.
 *
 * It is no longer what selection uses: crouch and prone mapped to `idle` here,
 * which is exactly the defect — a crouching man played the standing aim, and a
 * stationary crouching man does not even report `gait === 'crouch'`
 * (`soldier.js` `#gaitFor` answers `'stand'` for anything not moving). Stance
 * now comes in beside the gait and `stance-clips.js` resolves both.
 */
export const LOCO_CLIP = {
  run: 'run', walk: 'walk', stand: 'idle', crouch: 'crouchWalk', prone: 'crawl',
};

/**
 * Which arms clip this frame owes.
 *
 * Stance: `stance` ('stand' | 'crouch' | 'prone') joins `gait`, and every
 * family this returns is resolved through `stance-clips.js` against `has` —
 * the predicate saying which families the loaded rig actually baked. A rig
 * published before the stance families existed resolves back to the standing
 * clip down its own chain, so an old `fp.glb` behaves exactly as it did.
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
 *   stance?: string | null | undefined,
 *   has?: ((name: string) => boolean) | null,
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
  const has = typeof s.has === 'function' ? s.has : null;
  const stance = stanceFor(s.gait, s.stance);
  const loco = locoClip(s.gait, s.stance, has) || 'idle';
  // The three action families, resolved for the stance the soldier is in. A
  // crouching man's fire and reload resolve back to the standing families
  // because the engine declares no crouched ones; a prone man's do not.
  const fireClip = stanceClip('fire', stance, has) || 'fire';
  const reloadClip = stanceClip('reload', stance, has) || 'reload';
  const deployClip = stanceClip('deploy', stance, has) || 'deploy';
  const variants = s.fireVariants?.length ? s.fireVariants : null;
  // The fire clip owning the arms right now: the lone fire action of *either*
  // stance family, or whichever variant is mid-swing. Both names are accepted
  // because the stance can change while a one-shot is still clamped — going
  // prone mid-swing must not read as "nothing owns the arms".
  const activeFire = s.active === fireClip || s.active === 'fire'
    || s.active === 'proneFire' || variants?.includes(s.active)
    ? s.active : null;
  const activeReload = s.active === reloadClip || s.active === 'reload'
    || s.active === 'proneReload';
  const activeDeploy = s.active === deployClip || s.active === 'deploy'
    || s.active === 'crouchDeploy' || s.active === 'proneDeploy';
  // Own the arms for the whole magazine timer, not only until LoopOnce
  // clamps. Three.js sets paused after clampWhenFinished, so isRunning()
  // goes false while reloadTime is still counting — falling through to idle
  // mid-reload looked like a missing animation. Prefer isScheduled() (or
  // equivalent) for reloadRunning at the call site.
  if (s.reload > 0) {
    if (!s.reloadPlayed) {
      return { want: reloadClip, markReloadPlayed: true, startReload: true };
    }
    return {
      want: reloadClip,
      // Re-own the reload clip only when the arms were actually taken by
      // something else. Do NOT restart it because the LoopOnce pass ended
      // (`!s.reloadRunning`) while the reload timer is still counting: the
      // clip's span is fitted to reloadTime (1pAnimationsTweaking.con), so a
      // finished pass means the magazine is almost in, and restarting it
      // replays the reload sound that has already played for this magazine.
      // Also re-owned when the stance changed under a running reload: the
      // family the arms hold is no longer the one this stance owes.
      startReload: s.active !== reloadClip,
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
  if (s.reload > 0 && activeReload && s.reloadRunning) {
    return { want: s.active };
  }
  if (activeDeploy && s.deployRunning) return { want: s.active };
  // Looping fire (c_AsmLooping) follows the trigger latch. Checked before the
  // PlayOnce fireRunning keep — Three.js LoopRepeat never clears isRunning().
  if (s.fireLoops && s.firing && s.hasFire) {
    return { want: fireClip, startFire: !s.fireRunning || s.active !== fireClip };
  }
  if (activeFire && s.fireRunning && !s.fireLoops) {
    return { want: activeFire };
  }
  if (activeFire && !s.fireRunning && s.fireReturnsToReload && s.hasReload) {
    return { want: reloadClip, startReload: true };
  }
  // The throw's own returnTo. A rifle's fire state returns to StandReload
  // (ANIM-7, above); a grenade's returns to `Ub_StandResetRaiseWeapon<W>` —
  // it has no reload clip at all, because reloading a grenade *is* raising the
  // next one. Same shape as the rule above, aimed at the deploy family, so the
  // arms bring up grenade two instead of dropping to idle empty-handed.
  if (activeFire && !s.fireRunning && s.fireReturnsToDeploy && s.hasDeploy) {
    return { want: deployClip, startDeploy: true };
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
