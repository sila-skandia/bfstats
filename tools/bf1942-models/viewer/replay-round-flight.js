// A recorded round's flight, for the replay's spotlight (features/
// replay-spotlight): where it is a moment after it left, on the server's law
// (tank-ballistics.js: muzzle speed plus the firing hull's own velocity,
// FA-23's lift, IMP-8's first tick without gravity), and the gun's speed and
// gravity that law needs.

import * as THREE from 'three';
import { GRAVITY } from './physics.js';
import { TICK, ROOT_LIFT } from './tank-ballistics.js';
import { bare } from './replay-spotlight-fights.js';

const viewVector = v => [v[0], v[1], -v[2]];

/**
 * The round a gun fires: `{ speed, gravity }`. A hull's guns are read off its
 * own model (the FireArms node of the round's weapon, the projectile the
 * assembler resolved for it), a soldier's off the level's weapon table.
 * Null when neither names the weapon.
 */
export function roundOf(player, shooter, weapon) {
  const key = bare(weapon);
  if (!key) return null;
  const cache = (player.spotlightRounds ??= new Map());
  const id = `${shooter?.tmpl ?? ''}|${key}`;
  if (cache.has(id)) return cache.get(id);
  const model = shooter && !shooter.soldier ? player.hullModels?.get(shooter.tmpl)?.normal : null;
  let fa = null;
  model?.traverse(o => {
    if (fa || !o.userData?.fireArms || bare(o.name) !== key) return;
    fa = o.userData.fireArms;
  });
  const table = player.hud?.weaponTable?.()?.get(key) ?? null;
  let round = null;
  if (fa) {
    const gravity = Number(fa.projectile?.gravity);
    round = { speed: Number(fa.velocity) > 0 ? Number(fa.velocity) : table?.speed ?? null, gravity: Number.isFinite(gravity) ? gravity : 1 };
  } else if (table) {
    round = { speed: table.speed, gravity: 1 };
  }
  // A weapon table not landed yet is asked again next time.
  if (!round && !player.hud?.weaponTable?.()) return null;
  cache.set(id, round);
  return round;
}

/** The round's flight, view frame: `at(dt)` where it is `dt` seconds after
 *  it left. `platform` is the firing hull's velocity, which the round
 *  carries (FA-23). */
export function flightOf(f, round, platform = null) {
  const o = viewVector(f.pos);
  const d = viewVector(f.dir);
  const n = Math.hypot(...d) || 1;
  const speed = round?.speed > 0 ? round.speed : 400;
  const gm = Number.isFinite(round?.gravity) ? round.gravity : 1;
  const g = GRAVITY * gm;
  const v = [d[0] / n * speed + (platform?.[0] ?? 0), d[1] / n * speed + (platform?.[1] ?? 0) + (gm > 0 ? ROOT_LIFT : 0),
    d[2] / n * speed + (platform?.[2] ?? 0)];
  const y = t => (!(gm > 0) ? v[1] * t : t <= TICK ? v[1] * t
    : 0.375 * g * TICK * TICK + (v[1] - 0.875 * g * TICK) * t + 0.5 * g * t * t);
  return {
    speed,
    at: (t, out = new THREE.Vector3()) => out.set(o[0] + v[0] * t, o[1] + y(t), o[2] + v[2] * t),
  };
}
