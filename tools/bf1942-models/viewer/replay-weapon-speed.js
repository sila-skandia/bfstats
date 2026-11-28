// The muzzle speed of the guns whose rounds a name cannot place, from the
// tree's own weapon table (`damage.json`, replay-accuracy.js `weaponTableFrom`).
//
// The round cam guesses a round's speed from its weapon's name (a rocket 50
// m/s, a barrel 320: replay-roundcam.js `guessSpeed`), which is right for the
// vanilla names and blind to the rest. Secret Weapons' `NatterGuns` fires
// `NatterProjectile` at 200 m/s with a 16 m blast, a rocket by every measure
// and a bullet by its name, so key 6 passed over every Natter shot ("no more
// rockets"), and the bullet time and the chase's standoff were a rifle's.
//
// Only a gun whose round bursts (a blast `radius`) and flies at a speed worth
// watching is kept: a shotgun's 200 m/s pellets or a rifle's 1,000 are bullets
// and stay bullets. Pure: loads under node.

const speeds = new Map();

const lower = s => String(s ?? '').toLowerCase().replace(/_\d+$/, '');

/** Keep the explosive guns of a weapon table (`Map<lower name, { speed,
 *  radius }>`), replacing what was kept. */
export function setWeaponSpeeds(table) {
  speeds.clear();
  if (!table?.forEach) return;
  table.forEach((row, name) => {
    if (row?.radius > 0 && row?.speed > 0) speeds.set(lower(name), row.speed);
  });
}

/** An explosive gun's muzzle speed in m/s, or null for a name the table does
 *  not know as one. */
export function weaponSpeedOf(weapon) {
  return speeds.get(lower(weapon)) ?? null;
}
