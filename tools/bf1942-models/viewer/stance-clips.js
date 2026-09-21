// Which upper-body clip family a stance owes, and what to play when the rig
// does not carry it.
//
// The engine has no "stance modifier" on an animation: crouching and lying are
// their own upper-body states with their own clips, declared per weapon in
// `AnimationStates.con`. Surveyed over vanilla's 1,458-state machine (the
// survey script is in this stream's feature doc), all 28 weapons that declare
// `Ub_StandAim<W>` also declare, each with a 1P clip:
//
//   Ub_Crouch<W>            the same `1PStandAim<W>.baf` at the crouch rate
//                           (Thompson 0.33 against standing's 0.1, so the sway
//                           over the sights is 3.3x faster crouched)
//   Ub_CrouchForward<W>     the same `1pRun<W>.baf` at the crouch-walk rate
//   Ub_CrouchRaiseWeapon<W> the crouched draw-in
//   Ub_Lie<W>               a dedicated `1pLieAim<W>.baf`
//   Ub_LieForward<W>        a dedicated `1pCrawl<W>.baf`
//   Ub_LieFire<W>           a dedicated `1PLieFire<W>.baf`
//   Ub_LieReload<W>         a dedicated `1PLieReload<W>.baf`
//   Ub_LieRaiseWeapon<W>    the prone draw-in
//
// Two absences in that list are the data's, not an oversight of the survey,
// and the chains below reproduce them rather than invent a clip:
//
//   * **There is no crouch fire and no crouch reload.** No vanilla weapon
//     declares `Ub_CrouchFire<W>` or `Ub_CrouchReload<W>`; a crouching man
//     fires and reloads on the standing states. So `crouch` -> `fire` is not a
//     fallback, it is the engine.
//   * **Crouch has one movement clip, not two.** `Ub_CrouchForward<W>` is the
//     only forward crouch state — there is no crouch-run — so walk and run
//     while crouched land on the same family.
//
// Everything here is name resolution over what a rig actually baked, so it is
// free of `three` and of the DOM and `tests/stance_clips_harness.mjs` runs the
// real thing under node. A rig published before those families were baked (or
// a mod's rig that never had them) resolves down its chain to a standing clip.
// That is what the viewer already did in every stance but one: a **moving**
// crouched or prone soldier used to fall on `idle` (the old flat table sent
// both gaits there) and now falls on `walk`. It is the right clip to fall on
// -- `Ub_CrouchForward<W>` and the standing walk are the same `1pRun<W>.baf`
// -- but it is a change, and it is the only one an un-re-extracted rig sees.

export const STANCE_STAND = 'stand';
export const STANCE_CROUCH = 'crouch';
export const STANCE_PRONE = 'prone';

/**
 * Role -> stance -> the families to try, best first.
 *
 * The last entry of every chain is a family the very first viewmodel export
 * carried, so a chain can never resolve to nothing on a rig that has arms at
 * all.
 */
export const STANCE_CHAINS = Object.freeze({
  idle: Object.freeze({
    stand: Object.freeze(['idle']),
    crouch: Object.freeze(['crouch', 'idle']),
    prone: Object.freeze(['prone', 'idle']),
  }),
  walk: Object.freeze({
    stand: Object.freeze(['walk', 'idle']),
    crouch: Object.freeze(['crouchWalk', 'walk', 'idle']),
    prone: Object.freeze(['crawl', 'walk', 'idle']),
  }),
  run: Object.freeze({
    stand: Object.freeze(['run', 'walk', 'idle']),
    // No crouch-run state exists; crouched movement is one family.
    crouch: Object.freeze(['crouchWalk', 'walk', 'idle']),
    prone: Object.freeze(['crawl', 'walk', 'idle']),
  }),
  fire: Object.freeze({
    stand: Object.freeze(['fire']),
    // The engine's own: a crouching man fires on the standing state.
    crouch: Object.freeze(['fire']),
    prone: Object.freeze(['proneFire', 'fire']),
  }),
  reload: Object.freeze({
    stand: Object.freeze(['reload']),
    crouch: Object.freeze(['reload']),
    prone: Object.freeze(['proneReload', 'reload']),
  }),
  deploy: Object.freeze({
    stand: Object.freeze(['deploy']),
    crouch: Object.freeze(['crouchDeploy', 'deploy']),
    prone: Object.freeze(['proneDeploy', 'deploy']),
  }),
});

/** The three stances, for a caller normalising something looser. */
export function normaliseStance(stance) {
  return stance === STANCE_CROUCH || stance === STANCE_PRONE
    ? stance : STANCE_STAND;
}

/**
 * `soldier.gait` -> the role its clip plays, and the stance it implies.
 *
 * `soldier.js`'s `#gaitFor` answers `'stand'` for *any* stationary soldier,
 * crouched and prone included — it exists to pick a row of the view-bob table,
 * which is only ever consulted while moving. So a stationary crouched man
 * reads `gait === 'stand'`, and the stance has to come from `soldier.stance`.
 * That is precisely why the viewer used to play the standing aim while
 * crouched and still: the gait said 'stand' and nothing else was asked.
 */
export function locoRole(gait) {
  if (gait === 'run') return 'run';
  if (gait === 'walk') return 'walk';
  // 'crouch' and 'prone' are the moving gaits of those stances.
  if (gait === STANCE_CROUCH || gait === STANCE_PRONE) return 'walk';
  return 'idle';
}

/** The stance a gait proves, falling back to what the soldier reports. */
export function stanceFor(gait, stance) {
  if (gait === STANCE_CROUCH) return STANCE_CROUCH;
  if (gait === STANCE_PRONE) return STANCE_PRONE;
  return normaliseStance(stance);
}

/**
 * The family to play for `role` in `stance`, given what the rig baked.
 *
 * `has` is `(name) => boolean`. Returns the first candidate `has` accepts, or
 * the chain's last entry when it accepts none — a caller with no rig at all
 * gets a name rather than null, and `playViewmodelClip` is already a no-op for
 * a family it does not hold.
 *
 * With no `has` at all the chain's **head** is returned, i.e. the family the
 * engine would play: a caller that does not know what is baked is asking what
 * the stance owes, not what a particular file happens to carry.
 */
export function stanceClip(role, stance, has) {
  const chain = STANCE_CHAINS[role]?.[normaliseStance(stance)]
    ?? STANCE_CHAINS[role]?.stand;
  if (!chain) return null;
  if (typeof has !== 'function') return chain[0];
  for (const name of chain) if (has(name)) return name;
  return chain[chain.length - 1];
}

/**
 * The locomotion clip for a gait/stance pair: `locoRole` then `stanceClip`.
 * This is what replaced the flat `LOCO_CLIP` table, which mapped both
 * `crouch` and `prone` to `idle`.
 */
export function locoClip(gait, stance, has) {
  return stanceClip(locoRole(gait), stanceFor(gait, stance), has);
}

/**
 * The fire one-shot variants that belong to `base` (`fire1..fireN` for
 * `fire`, `proneFire1..` for `proneFire`), picked out of the rig's baked
 * names and ordered by their index.
 *
 * The knife's aim state registers five swings (ANIM-6's `c_AsmRandom`) and the
 * exporter bakes them as `<family><n>`; the prone family is registered the
 * same way where a weapon has one.
 */
export function fireVariantsFor(base, names) {
  if (!base || !names) return [];
  const prefix = base.length;
  return names
    .filter(name => name.startsWith(base) && /^\d+$/.test(name.slice(prefix)))
    .sort((a, b) => Number(a.slice(prefix)) - Number(b.slice(prefix)));
}
