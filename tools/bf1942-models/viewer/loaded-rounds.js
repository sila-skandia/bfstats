// The rounds a rack carries in view: a `visibleDummyProjectileTemplate` drawn
// at every `addFireArmsPosition` while the magazine still holds a round for
// it, and gone from the pylon once that barrel has fired.
//
// That is the game's own word for what hangs under a wing. A FireArms with
// the word shows one dummy per barrel position: vanilla's Katyusha has six
// rockets on its rails (`KatyushaFireArmsBundle`, six `addFireArmsPosition`
// lines, `magSize 6`) and the Fletcher's depth charges sit on her stern
// racks; Desert Combat's AV-8A hangs four AIM-9s (`AV8AAim9Rack`), the F-14B
// its Sidewinders and Mk 83s, the A-10 its bombs. A FireArms without the
// word draws nothing on the aircraft: vanilla's Stuka, BF109 and Zero carry
// their bombs unseen (`StukaBombRack` names no dummy), which is how retail
// draws them too.
//
// The exporter bakes the dummy once per rack, as a hidden `<rack> projectile`
// node tagged `projectileMesh` (`assemble.py`, "baked once as a hidden tagged
// node so mesh/materials/textures ride the ordinary GLB path"), and the
// viewer clones that node for each round it fires (`round-launch.js`
// `spawnProjectile`). Nothing drew the loaded ones. This module does: one
// clone per muzzle, parented to the muzzle so it sits where the round leaves,
// with the body's own baked rotation kept (the same "rotated body inside an
// aimed container" `spawnProjectile` builds).
//
// Where each dummy hangs is the engine's `FireArms::createAllDummyProjectiles`
// (lnxded `0x0828c380`, ledger FA-5): one dummy per `addFireArmsPosition`,
// placed at that position with no rotation; and for a rack that declares no
// position, ONE dummy at the FireArms' own origin, wherever its
// `projectilePosition` is. `projectilePosition` is only where the fired round
// is released. The exporter falls back to a single muzzle AT
// `projectilePosition` for such a rack, so the dummy goes on the rack there,
// not on the muzzle (`barrelsDeclared`). That is the Elco80's and Type 38's
// `FloatingMineLauncher`: the loaded mine sits on the stern deck, and the
// round drops 2 m further aft. Hung on the muzzle it floated 2 m off the
// stern at the waterline, and a Short's viewer took it for a bullet that fell
// short. The Fletcher's and Hatsuzuki's depth charges (1 m aft), and the
// Aichival-T's and SBD-T's torpedoes (1 m and 0.6 m low), were misplaced the
// same way.
//
// It does not take the muzzle's aim. The second token of `addFireArmsPosition`
// is the direction the fired round leaves, not the pose of the hanging dummy:
// the F-14B's and AV-8B's Mk 83s release at `0/35/0` (35 degrees down) and
// hang level on the pylon, the C-47's supply box drops at -90 and sits flat.
// So the muzzle's rotation is cancelled on the clone and the dummy lies in the
// rack's own frame; `spawnProjectile` still aims the fired round along the
// muzzle. Every other rack in the installed trees carries a toe-in or spread
// of 2.1 degrees or less there (the AIM-9s, the rocket rails), which the same
// rule drops; the engine never applies that rotation to a dummy (FA-5).
// Raised rails (the Katyusha, the Wurfgerat 40) are raised by a parent node,
// not by the muzzle, so they stay raised.
//
// Which rack qualifies is read off the bake, not guessed from a name: the
// `projectileMesh` extras carry the template the drawn body came from, and
// `fireArms.projectile.template` the round's own. They differ exactly when
// the body is the `visibleDummyProjectileTemplate` (`Aim9Dummy` for `Aim9`,
// `KatyushaRocketDummy` for `KatyushaRocket`); they are the same name when
// the exporter fell back to the projectile's own geometry (`DiveBomberBomb`),
// and the engine draws nothing for that case.
//
// Which dummies hide is the magazine's doing: `spent = magSize - roundsLeft`
// barrels have fired since the last reload, and a salvo fires its barrels in
// order from the first (`bomb-release.js` `salvo`, `nextBarrel`), so the
// first `spent` positions are empty. A reload fills the magazine and every
// pylon with it. A rack with more rounds than positions (`numOfMag`) shows
// its positions again on each reload, which is as far as the data goes.
//
// Framework-free bar `clone()` and `visible`, which the harness's plain
// `THREE.Object3D`s have; `tests/loaded_rounds_harness.mjs` runs it under node.

/** The `userData` mark a loaded round carries: `{ barrel }`. */
export const LOADED_ROUND_KEY = 'loadedRound';

function walk(node, visit) {
  if (!node) return;
  visit(node);
  const children = node.children;
  if (!children) return;
  for (const child of children) walk(child, visit);
}

/**
 * Whether this FireArms node draws its loaded rounds: its baked body is a
 * `visibleDummyProjectileTemplate`, named differently from the round itself.
 */
export function drawsLoadedRounds(gun) {
  const stats = gun?.userData?.fireArms;
  const round = stats?.projectile?.template;
  if (!round) return false;
  const body = bodyOf(gun);
  const dummy = body?.userData?.projectileMesh?.template;
  return !!dummy && dummy !== round;
}

/** The rack's hidden baked body (`<rack> projectile`), or null. */
function bodyOf(gun) {
  let found = null;
  walk(gun, node => {
    if (!found && node !== gun && node.userData?.projectileMesh) found = node;
  });
  return found;
}

/** The rack's muzzles in barrel order (`<rack> muzzle N`, `muzzle.index`). */
function muzzlesOf(gun) {
  const out = [];
  walk(gun, node => {
    if (node !== gun && node.userData?.muzzle) out.push(node);
  });
  return out.sort((a, b) => (a.userData.muzzle.index ?? 0) - (b.userData.muzzle.index ?? 0));
}

/**
 * Whether the rack's muzzles are its own `addFireArmsPosition` lines, so a
 * dummy hangs at each, or the one muzzle the exporter falls back to at
 * `projectilePosition` (`assemble.py` `_fire_arms`), where the round is
 * released and no dummy hangs.
 *
 * A bake from 2026-11-09 on says so (`fireArms.barrelsDeclared`). An older
 * one is read from what it does carry: more than one muzzle is declared, and
 * so is a single muzzle with a `projectilePosition` written beside it (the
 * exporter writes that only when the barrels are declared), one with an aim
 * of its own (the fallback muzzle is never turned: FHSW's
 * `SdKfz251RRocket1`..`6` declare one toed-in rail each), or one off the
 * rack's centreline (FH's copies of the same rails are unturned but sit at
 * the same ±0.25 m, and every `projectilePosition` a fallback came from in
 * the published trees is on the centreline). What is left is taken for the
 * fallback; a muzzle at the rack's origin is the same either way. The
 * published trees were scanned against this on 2026-11-09 (ledger FA-5,
 * `features/plane-bombs-and-torpedoes/BUILD.md` section 9).
 */
export function barrelsDeclared(gun, muzzles = muzzlesOf(gun)) {
  const stats = gun?.userData?.fireArms;
  if (typeof stats?.barrelsDeclared === 'boolean') return stats.barrelsDeclared;
  if (muzzles.length !== 1) return muzzles.length > 1;
  if (stats?.projectilePosition) return true;
  const [muzzle] = muzzles;
  const q = muzzle.quaternion;
  if (q && Math.abs(q.w) < 1 - 1e-9) return true;
  return Math.abs(muzzle.position?.x ?? 0) > 1e-4;
}

/** The loaded-round nodes under `gun`, in barrel order. */
export function loadedRoundsOf(gun) {
  const out = [];
  walk(gun, node => {
    if (node !== gun && node.userData?.[LOADED_ROUND_KEY]) out.push(node);
  });
  return out.sort((a, b) => a.userData[LOADED_ROUND_KEY].barrel - b.userData[LOADED_ROUND_KEY].barrel);
}

/**
 * Dress one rack: a clone of its baked body under each muzzle, visible.
 * Idempotent — a muzzle already carrying its round is left as it is, so a
 * seat re-entered keeps the pylons the last exit left. Returns the rack's
 * loaded-round nodes, all of them, or an empty list for a rack that draws
 * none.
 */
export function mountLoadedRounds(gun) {
  if (!drawsLoadedRounds(gun)) return [];
  const body = bodyOf(gun);
  const muzzles = muzzlesOf(gun);
  // A rack that declares no `addFireArmsPosition` hangs its one dummy at its
  // own origin, not at the muzzle the exporter put at `projectilePosition`.
  const barrels = muzzles.length && barrelsDeclared(gun, muzzles) ? muzzles : [gun];
  barrels.forEach((muzzle, barrel) => {
    const have = (muzzle.children || []).some(child => child.userData?.[LOADED_ROUND_KEY]);
    if (have) return;
    const round = body.clone();
    round.name = `${gun.name} round ${barrel + 1}`;
    // Not a `projectileMesh`: that is the firing payload `idleFirePose` puts
    // out and `GunFire.collect` hides, and this is the opposite thing, a
    // body that shows while nobody is firing.
    round.userData = { [LOADED_ROUND_KEY]: { barrel } };
    round.position.set(0, 0, 0);
    // Undo the muzzle's aim: the dummy hangs in the rack's frame. A rack with
    // no muzzles of its own (`barrels` is the gun) has no aim to undo.
    if (muzzle !== gun && muzzle.quaternion) {
      round.quaternion.copy(muzzle.quaternion).invert().multiply(body.quaternion);
    }
    round.visible = true;
    walk(round, node => { node.visible = true; });
    muzzle.add(round);
  });
  return loadedRoundsOf(gun);
}

/**
 * Show the rounds the magazine still holds. `roundsLeft` is `FireState.ammo`,
 * Infinity for a gun this page keeps no magazine for (the model browser's
 * turntable, a replayed hull), which shows every pylon full.
 */
export function syncLoadedRounds(gun, roundsLeft, fireTimerRunning = false) {
  const rounds = loadedRoundsOf(gun);
  if (!rounds.length) return rounds;
  const arms = gun.userData?.fireArms;
  const magSize = arms?.magSize;
  const unlimited = magSize == null || magSize < 0 || !(roundsLeft < Infinity);
  // A plain single-barrel weapon (fewer than two `addFireArmsPosition`, no
  // `disableWhenFired`): the dummy goes out as the round leaves
  // (`fireBarrel` clears its drawn bit) and is drawn again when the fire
  // timer ends, once the magazine has charged the next round -- before any
  // reload (`FireArms::fireFinished` 0x08288470, 0x08288569..0x0828860e:
  // `updateFlags(2, 0)`; FA-28). One that says `disableWhenFired` keeps it
  // away until the reload ends (`ReloadFinished` 0x08289e70).
  if (rounds.length < 2 && !arms?.disableWhenFired && !unlimited) {
    rounds[0].visible = roundsLeft > 0 && !fireTimerRunning;
    return rounds;
  }
  const spent = unlimited ? 0 : Math.max(0, Math.min(rounds.length, magSize - roundsLeft));
  for (const round of rounds) {
    round.visible = round.userData[LOADED_ROUND_KEY].barrel >= spent;
  }
  return rounds;
}

/**
 * Every rack under `root` dressed and full: a level's parked vehicles at
 * load, and a fresh object off the ObjectSpawner, whose magazines are new
 * (`idleFireState`). Returns how many rounds are on show.
 */
export function restoreLoadedRounds(root) {
  let shown = 0;
  walk(root, node => {
    if (!node.userData?.fireArms) return;
    for (const round of mountLoadedRounds(node)) {
      round.visible = true;
      shown += 1;
    }
  });
  return shown;
}
