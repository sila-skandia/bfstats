// Where a tank is hit, for the tank school's MATCHUP (features/battle-schools,
// tank-matchup.md section 1): each face of a hull priced by the other tank's
// gun, the shots that price means, and the shots to kill from each bearing.
//
// The pricing is the engine's direct-hit law, the same arithmetic the model
// browser's armour inspector uses (`armour-damage.js`): `materialDamage(att) x
// damageMod(att group, the struck face's def group) x angleFactor` (DMG-3,
// DMG-4; a pair with no table cell does nothing, DMG-1). A tank shell has no
// distance falloff. The faces are the glb's collision meshes, each carrying
// its `defenseMaterial` (bf1942-3d-models, "Collision and armour
// inspection"), which turn with their parts (a turret's with the turret).
//
// `bearingShots` casts rays at the hull the way `tanks-engine.md` "Expected
// shots to kill" did: a grid across the silhouette from each bearing, the
// first collision face each ray meets priced at its own angle, the hits
// averaged; shots are `ceil(HP / mean)`, and the best spot `ceil(HP / max)`.

import * as THREE from 'three';
import { damageMath, shotsFor } from './armour-damage.js';
import { angleFactor } from './crash-damage.js';

/** Bands of shots to kill, most dangerous first, in the site's tints (the
 *  model browser's armour ramp: kill, busy, khaki, olive, poor grey). */
export const BANDS = [
  { id: 'one', label: '1 shot', max: 1, color: '#d65a5a' },
  { id: 'two', label: '2', max: 2, color: '#c5a23a' },
  { id: 'three', label: '3', max: 3, color: '#8a8a6a' },
  { id: 'five', label: '4 to 5', max: 5, color: '#7d8849' },
  { id: 'more', label: '6 or more', max: Infinity, color: '#5c5c5c' },
];
export const IMMUNE = { id: 'immune', label: 'no damage', color: '#262626' };

/** The band for `shots` (null: the face takes nothing). */
export function bandOf(shots) {
  if (!(shots > 0)) return IMMUNE;
  return BANDS.find(b => shots <= b.max);
}

/** What vanilla's tank faces are called (the Damage System tutorial's
 *  names, `proving-ground-page.js` `materialName`). */
export function faceName(material) {
  const named = { 46: 'Running gear', 47: 'Light armour', 50: 'Rear armour', 51: 'Side armour', 52: 'Front armour',
                  53: 'Heavy armour', 54: 'Heaviest armour' };
  return named[material] ?? `Material ${material}`;
}

/** `price(defMaterial)`: a square hit's damage from a round of `attMaterial`,
 *  or 0 where the pair has no cell. */
export function pricer(tables, attMaterial) {
  const { headOnFor } = damageMath(tables);
  const weapon = { material: attMaterial };
  return def => headOnFor(weapon, def) ?? 0;
}

/** The hull's collision meshes: `{ mesh, material }` for each, from the glb's
 *  collision layer (`geometry.userData.collision`, `defenseMaterial`). */
export function collisionFaces(root) {
  const out = [];
  root.traverse(o => {
    if (!o.isMesh || !o.geometry?.userData?.collision) return;
    const material = o.geometry.userData.defenseMaterial;
    out.push({ mesh: o, material: Number.isFinite(Number(material)) ? Number(material) : null });
  });
  return out;
}

/** The template's own `angleMod` (0 where it authors none, DMG-4). */
export function angleModOf(root) {
  let physics = null;
  root.traverse(o => { if (!physics && o.userData?.physics) physics = o.userData.physics; });
  const v = Number(physics?.angleMod ?? NaN);
  return Number.isFinite(v) ? v : 0;
}

/**
 * Shots to kill from each bearing: `{ [bearing]: { mean, max, shots,
 * bestShots, area } }`. Bearing 0 is from straight ahead, 90 from the right,
 * 180 from behind; `elevation` lifts the shooter (degrees). `root` stands at
 * its rest pose; its world matrices are used as they are.
 */
export function bearingShots(root, price, hitpoints, { bearings = [0, 30, 60, 90, 120, 150, 180], elevation = 0, step = 0.15 } = {}) {
  const tris = worldTriangles(root);
  if (!tris.length) return null;
  const box = new THREE.Box3();
  for (const t of tris) box.expandByPoint(t.a).expandByPoint(t.b).expandByPoint(t.c);
  const centre = box.getCenter(new THREE.Vector3());
  const R = box.getSize(new THREE.Vector3()).length() / 2 + 0.5;
  const angleMod = angleModOf(root);
  const ray = new THREE.Ray();
  const point = new THREE.Vector3();
  const out = {};
  for (const az of bearings) {
    const a = az * Math.PI / 180, el = elevation * Math.PI / 180;
    const from = new THREE.Vector3(Math.sin(a) * Math.cos(el), Math.sin(el), -Math.cos(a) * Math.cos(el));
    const dir = from.clone().negate();
    const up = Math.abs(dir.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
    const r1 = new THREE.Vector3().crossVectors(dir, up).normalize();
    const r2 = new THREE.Vector3().crossVectors(r1, dir);
    const n = Math.ceil(R / step);
    let sum = 0, max = 0, hits = 0;
    // The grid sits half a step off the hull's middle, so no ray runs
    // exactly along a plate's edge.
    for (let i = -n; i < n; i++) {
      for (let k = -n; k < n; k++) {
        ray.origin.copy(centre).addScaledVector(from, R * 2).addScaledVector(r1, (i + 0.5) * step).addScaledVector(r2, (k + 0.5) * step);
        ray.direction.copy(dir);
        let best = null, bestT = Infinity;
        for (const t of tris) {
          // Either winding: a hull's collision mesh is not always wound outward.
          if (!ray.intersectTriangle(t.a, t.b, t.c, false, point)) continue;
          const d = point.distanceToSquared(ray.origin);
          if (d < bestT) { bestT = d; best = t; }
        }
        if (!best) continue;
        const d = price(best.material) * angleFactor(Math.abs(best.normal.dot(dir)), angleMod);
        sum += d; max = Math.max(max, d); hits++;
      }
    }
    const mean = hits ? sum / hits : 0;
    out[az] = {
      mean: Math.round(mean * 10) / 10,
      max: Math.round(max * 10) / 10,
      shots: shotsFor(hitpoints, mean),
      bestShots: shotsFor(hitpoints, max),
      area: Math.round(hits * step * step * 10) / 10,
    };
  }
  return out;
}

/** Every collision triangle of the hull in world space, with its face's
 *  material and unit normal. Reads the geometry itself, so it works on the
 *  page's meshes and on the room server's stand-ins alike. */
export function worldTriangles(root) {
  root.updateMatrixWorld(true);
  const out = [];
  for (const { mesh, material } of collisionFaces(root)) {
    const pos = mesh.geometry.attributes?.position;
    if (!pos) continue;
    const idx = mesh.geometry.index;
    const count = idx ? idx.count : pos.count;
    const v = i => new THREE.Vector3().fromBufferAttribute(pos, idx ? idx.getX(i) : i).applyMatrix4(mesh.matrixWorld);
    for (let i = 0; i + 2 < count; i += 3) {
      const a = v(i), b = v(i + 1), c = v(i + 2);
      const normal = new THREE.Vector3().crossVectors(b.clone().sub(a), c.clone().sub(a));
      if (normal.lengthSq() < 1e-12) continue;
      out.push({ a, b, c, material, normal: normal.normalize() });
    }
  }
  return out;
}

/** The faces a hull shows, with what a square hit on each costs and the
 *  shots that makes: `[{ material, name, damage, shots, band }]`, most
 *  dangerous first, one row per material. */
export function faceTable(root, price, hitpoints) {
  const seen = new Map();
  for (const { material } of collisionFaces(root)) {
    if (material == null || seen.has(material)) continue;
    const damage = price(material);
    if (!(damage > 0)) continue;
    const shots = shotsFor(hitpoints, damage);
    seen.set(material, { material, name: faceName(material), damage: Math.round(damage * 10) / 10, shots, band: bandOf(shots) });
  }
  return [...seen.values()].sort((a, b) => a.shots - b.shots || b.damage - a.damage);
}
