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
function weapon({ barrels = 1, size = 8, stats = {} } = {}) {
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
  pods: { barrels: 2, size: 8, stats: { asynchronyFire: true } },
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

console.log(JSON.stringify(out));
