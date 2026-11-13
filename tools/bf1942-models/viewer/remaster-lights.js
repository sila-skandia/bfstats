// Remaster mode's short-lived lights (features/remaster-browser), as tables
// and pure functions: which effect bundle lights its surroundings, how
// strongly, for how long. remaster-renderer.js owns the lights themselves.
//
// A surface takes these lights as a lift over its own combine
// (remaster-materials.js `FLASH_LIFT`): 1 is what a face square to the sun
// takes from the sun, so with the sun's strength S a light of I candela
// lifts a face d metres off by I / (S d^2). On Wake S is 7.3: a tank gun's
// 90 cd doubles the hull's brightness 3.5 m from the muzzle and lifts the
// ground 8 m off by a fifth, for an eighth of a second.

/**
 * A gun's flash is sized by the gun. Every muzzle bundle once took the
 * rifle's light (1.2 cd over 8 m for a twentieth of a second), a tank's main
 * gun included. A rifle stays a lift, not a floodlight (at 70 cd the
 * player's own bleached the sand at their feet white). A round's impact
 * (`e_ExplDrySand`, `e_ExplWindow`, ricochets) is dust, not fire, and lights
 * nothing: matched first and dropped. `burst` is the width in metres of the
 * hot disc drawn at the muzzle itself.
 */
export const FLASH_KINDS = [
  { test: /expl(drysand|frozensnow|window|small)|collision|richo|ricoch|scrap/i, intensity: 0 },
  { test: /bomb|granadeexpl|groundexpl|waterexpl|expl(armor|bazooka|boatarmor|gas|ani)|torpedo/i, intensity: 150, range: 60, life: 0.45, color: 0xffb070 },
  // A tank's main gun, a self-propelled gun's, a coastal or a ship's gun.
  { test: /muzz(panz|sexton|priest|defgun)/i, intensity: 90, range: 30, life: 0.13, color: 0xffc080, burst: 2.8 },
  // An anti-aircraft gun, a heavy machine gun, a bomber's turret.
  { test: /muzz(aagun|heavy|b17)/i, intensity: 16, range: 14, life: 0.07, color: 0xffc890, burst: 1.3 },
  { test: /muzz/i, intensity: 1.2, range: 8, life: 0.05, color: 0xffc890 },
];

/** The flash an effect bundle makes, or null when it lights nothing. */
export function flashKind(name) {
  if (!name) return null;
  const kind = FLASH_KINDS.find(k => k.test.test(name));
  return kind?.intensity ? kind : null;
}

/**
 * Fires: a burning vehicle's bundle (`e_PanzFire`, `e_WillyFire`,
 * `e_CorsairFire`) and the plain `e_fire4` burn for as long as their run
 * lives, and light what is around them with a flame's unsteady light. A
 * Spitfire's scrap (`e_scrapmetal_Spitfire`) and a gun's flash are not fires.
 */
export const FIRE = { test: /^(?!.*(scrap|muzz)).*fire\d*$/i, intensity: 40, range: 26, color: 0xff8a3c, reach: 160 };

export const isFire = name => FIRE.test.test(name || '');

/** A flame's light at `t` seconds: a slow breath and two quicker flutters, never out. */
export function fireFlicker(t) {
  return 0.72 + 0.16 * Math.sin(t * 7.3) + 0.08 * Math.sin(t * 17.1 + 1.3) + 0.04 * Math.sin(t * 31.7);
}
