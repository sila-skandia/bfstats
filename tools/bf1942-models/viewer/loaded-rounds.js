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
// It does not take the muzzle's aim. The second token of `addFireArmsPosition`
// is the direction the fired round leaves, not the pose of the hanging dummy:
// the F-14B's and AV-8B's Mk 83s release at `0/35/0` (35 degrees down) and
// hang level on the pylon, the C-47's supply box drops at -90 and sits flat.
// So the muzzle's rotation is cancelled on the clone and the dummy lies in the
// rack's own frame; `spawnProjectile` still aims the fired round along the
// muzzle. Every other rack in the installed trees carries a toe-in or spread
// of 2.1 degrees or less there (the AIM-9s, the rocket rails), which the same
// rule drops. Raised rails (the Katyusha, the Wurfgerat 40) are raised by a
// parent node, not by the muzzle, so they stay raised. Ledger FA-5.
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
  const barrels = muzzles.length ? muzzles : [gun];
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
export function syncLoadedRounds(gun, roundsLeft) {
  const rounds = loadedRoundsOf(gun);
  if (!rounds.length) return rounds;
  const magSize = gun.userData?.fireArms?.magSize;
  const unlimited = magSize == null || magSize < 0 || !(roundsLeft < Infinity);
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
