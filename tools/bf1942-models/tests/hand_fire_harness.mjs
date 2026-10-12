// Drives `hand-fire.js`'s page hooks outside a browser and prints one JSON
// blob: what a pull of the hand weapon is charged (`guns.onShot` with the
// `salvo()` answer, ledger BOMB-1 / BOMB-13), what it tells `salvo()` its
// magazine holds (`guns.roundsLeft`, BOMB-5), and when a dry magazine may be
// changed (`startReload`, BODY-7).
//
// `createHandFire` is built over a stub page: only the hooks it installs at
// construction and the two functions it returns are driven, so nothing of the
// page's rendering, sound or bots is needed.

import { createHandFire } from './hand-fire.js';
import { salvo } from './bomb-release.js';

function stubPage(hw) {
  return {
    guns: { onShot: null, bodyCast: () => null, setFiring() {} },
    fireStates: new WeakMap(),
    get handWeapon() { return hw; },
    isExplosives: () => false,
    itemsLocked: () => false,
    packThrown() {},
    vehicleAudio: null,
    soldier: null,
    params: new URLSearchParams(''),
  };
}

/** A hand weapon of `barrels` barrels and `size` rounds, its round fired. */
function weapon({ barrels = 1, size = 8, stats = { blastAmmoCount: false } } = {}) {
  const group = { node: {}, stats: { ...stats }, muzzles: Array.from({ length: barrels }, () => ({})) };
  return {
    name: 'gun', group, rounds: size, mags: 4, reload: 0, cool: 0,
    throwBegun: true,             // the report and the clip are not what is tested
    data: { roundOfFire: 2, magazine: { size, reloadTime: 3 } },
    model: { onShot() {} },
  };
}

/** One pull through `gunfire.js`'s own order: `salvo()` then `onShot`. */
function pull(page, hw) {
  const answer = salvo(hw.group.muzzles.length, {
    asynchronyFire: !!hw.group.stats.asynchronyFire,
    blastAmmoCount: !!hw.group.stats.blastAmmoCount,
    roundsLeft: page.guns.roundsLeft(hw.group),
    nextBarrel: 0,
  });
  page.guns.onShot(hw.group, answer.rounds);
  return answer.barrels.length;
}

const out = {};
for (const [name, spec] of Object.entries({
  rifle: { barrels: 1, size: 30 },
  // FH's and FHSW's multi-barrel hand weapons: no `asynchronyFire`, no
  // `blastAmmoCount`, a round a barrel.
  twin: { barrels: 2, size: 8 },
  pods: { barrels: 2, size: 8, stats: { asynchronyFire: true, blastAmmoCount: false } },
  // An export from before BOMB-13: no `blastAmmoCount` key, one round a pull.
  legacy: { barrels: 8, size: 8, stats: {} },
  // Desert Combat's Remington: eight pellets, one shell.
  shotgun: { barrels: 8, size: 8, stats: { blastAmmoCount: true } },
  unlimited: { barrels: 2, size: Infinity },
})) {
  const hw = weapon(spec);
  const page = stubPage(hw);
  createHandFire(page);
  const barrels = pull(page, hw);
  const first = hw.rounds;
  hw.cool = 0;
  const left = page.guns.roundsLeft(hw.group);
  out[name] = { barrels, roundsAfterOne: first, roundsLeft: left };
}
// The twin down to its last round: BOMB-5's partial salvo, one barrel.
{
  const hw = weapon({ barrels: 2, size: 1 });
  const page = stubPage(hw);
  createHandFire(page);
  out.twinLast = { barrels: pull(page, hw), roundsAfter: hw.rounds };
}
// A gun the hand does not hold still answers from its `FireState`, or
// unlimited without one.
{
  const hw = weapon();
  const page = stubPage(hw);
  createHandFire(page);
  const seat = { node: {}, stats: {}, muzzles: [{}] };
  page.fireStates.set(seat.node, { unlimited: false, ammo: 42 });
  out.seat = { withState: page.guns.roundsLeft(seat),
               without: page.guns.roundsLeft({ node: {}, stats: {}, muzzles: [{}] }) };
}

// A dry magazine waits for the last round's fire cycle (BODY-7).
{
  const hw = weapon({ size: 1 });
  const page = stubPage(hw);
  const fire = createHandFire(page);
  pull(page, hw);                       // `onShot` sets `cool` to 1 / roundOfFire
  const coolAfterShot = hw.cool;
  const duringCycle = fire.startReload();
  hw.cool = 0;
  const afterCycle = fire.startReload();
  out.reload = { coolAfterShot, duringCycle, afterCycle, reloadTime: hw.reload };
}

// `allowReloadOnEmptyClipOnly` (FA-6): the Garand's clip is changed only once
// it is spent; the same magazine without the word changes when asked.
{
  const ask = (reloadOnEmptyOnly, rounds) => {
    const hw = weapon({ size: 8 });
    if (reloadOnEmptyOnly !== undefined) hw.data.magazine.reloadOnEmptyOnly = reloadOnEmptyOnly;
    hw.rounds = rounds;
    const fire = createHandFire(stubPage(hw));
    return { started: fire.startReload(), reload: hw.reload };
  };
  out.emptyOnly = {
    partClip: ask(true, 5), lastRound: ask(true, 1), dry: ask(true, 0),
    plainPartClip: ask(undefined, 5), declaredOff: ask(false, 5),
  };
}

// A magazine run dry (FA-7, BODY-7): only `autoReload` changes it unasked,
// and the Garand's clip goes first, `ejectClipTime` before any reload.
{
  const run = (words, seconds = 2) => {
    const hw = weapon({ size: 8 });
    Object.assign(hw.data.magazine, words);
    hw.rounds = 0;
    hw.ammo = { clipIn: true };
    let ejects = 0;
    hw.fire = { playEject() { ejects += 1; }, playReload() {} };
    const fire = createHandFire(stubPage(hw));
    const dt = 1 / 30;
    let reloadAt = null, askedDuringEject = null;
    for (let t = 0; t < seconds; t += dt) {
      if (hw.eject > 0 && askedDuringEject === null) askedDuringEject = fire.startReload();
      fire.stepDryMagazine(hw, hw.data.magazine, dt);
      if (hw.reload > 0 && reloadAt === null) reloadAt = +t.toFixed(2);
    }
    const asked = hw.reload > 0 ? null : fire.startReload();
    return { ejects, reloadAt, askedDuringEject, clipIn: hw.ammo.clipIn, askedAfter: asked };
  };
  out.dry = {
    thompson: run({}),                                   // no word: the engine's 0
    bazooka: run({ autoReload: true }),
    garand: run({ autoReload: false, reloadOnEmptyOnly: true, ejectClipTime: 0.6 }),
    autoEject: run({ autoReload: true, ejectClipTime: 0.6 }),
  };
  // The fire cycle of the last round runs out first.
  const hw = weapon({ size: 8 });
  Object.assign(hw.data.magazine, { autoReload: true });
  hw.rounds = 0; hw.cool = 0.5; hw.ammo = { clipIn: true };
  const fire = createHandFire(stubPage(hw));
  fire.stepDryMagazine(hw, hw.data.magazine, 1 / 30);
  out.dry.duringCycle = hw.reload;
}

console.log(JSON.stringify(out));
