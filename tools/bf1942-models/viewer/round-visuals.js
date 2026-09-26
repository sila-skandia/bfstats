// What a `GunFire` draws around its rounds that is not the round itself: the
// stand-in tracer streak and its materials, the trail puffs a projectile drags,
// and the debug impact markers. Split out of `gunfire.js`; every function takes
// the `GunFire` instance (`guns`) whose scene, camera and pools it works on.

import * as THREE from 'three';

const MAX_TRAIL_PUFFS = 96;
// How long an impact stand-in lives, by surface family. The authored bundles
// declare `timeToLive CRD_NONE/1.8/0/0` almost uniformly; these are shorter
// because a flat billboard holding for 1.8 s reads as a decal, not a burst.
const IMPACT_TTL = 0.45;
const IMPACT_WATER_TTL = 0.8;
const MAX_IMPACTS = 48;

// Fallback streak, for a GLB baked before the tracer mesh was exported. The
// game's own `TLight_m1` is a tapered 0.0061 m spike trailing 1 m behind the
// round, scaled bodily by the projectile's `tracerScaler` (50 for every vanilla
// MG) — so the real thing is 0.3 m across, not 0.02. Two centimetres at the
// Corsair's 116 m convergence subtends a quarter of a pixel at 60 deg FOV over
// 1100 px, which is exactly the "barely visible little lines" this replaced.
export const tracerGeometry = new THREE.CylinderGeometry(0.01, 0.01, 1, 6, 1, true);
tracerGeometry.rotateX(Math.PI / 2);   // length along Z so lookAt aims it
export const tracerMaterial = new THREE.MeshBasicMaterial({
  color: 0xffd9a0, transparent: true, opacity: 0.9,
  blending: THREE.AdditiveBlending, depthWrite: false,
});
// Legacy manifests only (fireArms.projectile still a bare template name):
// rounds between tracers show as a dim streak. Typed manifests draw nothing
// between tracer rounds, like the game.
export const shellMaterial = new THREE.MeshBasicMaterial({
  color: 0xc9b89a, transparent: true, opacity: 0.4,
  blending: THREE.AdditiveBlending, depthWrite: false,
});

// The impact stand-in — a debug affordance, off by default.
//
// Refractor answers "what does this hit look like" out of the MaterialManager:
// `setEffectTemplate` names one of 73 authored EffectBundles per (attacker,
// defender) pair, and `collision.js` resolves the name. Playing the bundle
// itself needs its emitters, sprites and sounds baked into the level glb the
// way the muzzle flashes already are, and that is an extractor job this pass
// did not do — see the "still missing" section of
// `features/bf1942-3d-models/projectile-collision.md`.
//
// So: one soft additive puff, expanding and fading, stood up on the surface
// normal, tinted by the material family the hit resolved to. It is a marker
// that the round stopped and where, not a reconstruction of the effect — and
// against the game's authored bursts it reads as an invented puff, so it is
// drawn only when `impactMarkers` is set (`?impacts=debug` on the map page).
// The hit itself is always recorded, and the resolved bundle name rides along
// on the impact record so a check can assert the *selection* is right even
// when nothing is drawn.
const IMPACT_TINTS = {
  ground: 0xc8ab7a,   // dust off dirt and sand
  water:  0xdff0ff,   // spray
  stone:  0xbdb6ab,   // grit and concrete dust
  metal:  0xffc98a,   // sparks
  wood:   0xa8834f,   // splinters
  armour: 0xffd07a,   // the armour flash bundles are all fire-coloured
};

let impactTexture = null;
function softDisc() {
  // A radial falloff drawn once. Additive, so the centre is the bright core
  // and the rim goes to black rather than to transparent.
  if (impactTexture) return impactTexture;
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(
    size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.35, 'rgba(255,255,255,0.55)');
  gradient.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  impactTexture = new THREE.CanvasTexture(canvas);
  impactTexture.colorSpace = THREE.SRGBColorSpace;
  return impactTexture;
}

const impactGeometry = new THREE.PlaneGeometry(1, 1);

/** Piecewise-linear sample of an over-time ramp at `phase` (0..100). */
export function sampleCurve(points, phase) {
  if (phase <= points[0][0]) return points[0].slice(1);
  for (let i = 1; i < points.length; i++) {
    if (phase <= points[i][0]) {
      const [t0, ...v0] = points[i - 1];
      const [t1, ...v1] = points[i];
      const k = t1 === t0 ? 1 : (phase - t0) / (t1 - t0);
      return v0.map((v, j) => v + (v1[j] - v) * k);
    }
  }
  return points[points.length - 1].slice(1);
}

/**
 * Parent a spawned mesh into the world, on the world's own layer.
 *
 * A round belongs to the world the moment it leaves the gun, and `guns.scene`
 * is the world scene — but a clone carries its template's `layers`, and a
 * first-person hand weapon's template is a node inside the arms rig, which
 * map.html puts wholesale on `VIEWMODEL_LAYER` so the near pass can draw it
 * over cleared depth. A grenade cloned from there is added to the world scene
 * and then drawn by nobody: the world camera's mask does not include layer 1
 * and the near camera only renders `vmScene`. That is the whole reason a
 * thrown grenade exploded where you threw it without ever being seen, and the
 * same silence hid the bazooka's rocket body (its smoke trail is separate
 * sprites spawned here, which is why nobody noticed).
 *
 * Every spawn path goes through this, so the rule is stated once: whatever is
 * parented into the world scene is visible to a default camera. Pooled meshes
 * are re-adopted rather than trusted — a pool outlives the weapon it came
 * from, and re-equipping re-clones from a fresh rig.
 */
export function adopt(guns, mesh) {
  mesh.traverse(obj => obj.layers.set(0));
  guns.scene.add(mesh);
}

export function spawnPuff(guns, shot) {
  if (guns.puffs.length >= MAX_TRAIL_PUFFS) return;
  const group = shot.group;
  let mesh = group.puffPool.pop();
  const materials = [];
  if (mesh) {
    mesh.traverse(part => {
      if (part.isMesh) materials.push(...[part.material].flat());
    });
  } else {
    // Clone materials so each puff fades on its own; the baked quad's
    // material is shared through the exporter's cache.
    mesh = group.trailQuad.clone();
    mesh.traverse(part => {
      if (!part.isMesh) return;
      const cloned = [part.material].flat().map(m => {
        const clone = m.clone();
        guns.onMaterial?.(clone);
        materials.push(clone);
        return clone;
      });
      part.material = cloned.length === 1 ? cloned[0] : cloned;
    });
  }
  mesh.visible = true;
  mesh.position.copy(shot.mesh.position);
  mesh.quaternion.copy(guns.camera.quaternion);
  adopt(guns, mesh);
  guns.puffs.push({
    mesh, materials, spec: shot.trail, age: 0, pool: group.puffPool,
  });
}

export function spawnImpact(guns, hit, family) {
  if (!guns.impactMarkers) return;
  if (guns.impacts.length >= MAX_IMPACTS) return;
  let mesh = guns.impactPool.pop();
  if (!mesh) {
    mesh = new THREE.Mesh(impactGeometry, new THREE.MeshBasicMaterial({
      map: softDisc(), transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    }));
    guns.onMaterial?.(mesh.material);
  }
  mesh.material.color.setHex(IMPACT_TINTS[family] ?? IMPACT_TINTS.ground);
  mesh.material.opacity = 1;
  mesh.visible = true;
  // Lifted off the surface along its normal, the way the engine lifts its own
  // ricochet decals (`relativePositionInUp 0.001` on every `Richo*Decal`
  // emitter) — just further, because this is a billboard and not a decal.
  mesh.position.set(hit.x + hit.nx * 0.15,
                    hit.y + hit.ny * 0.15,
                    hit.z + hit.nz * 0.15);
  mesh.quaternion.copy(guns.camera.quaternion);
  mesh.scale.setScalar(0.4);
  adopt(guns, mesh);
  guns.impacts.push({
    mesh, age: 0,
    ttl: hit.kind === 'water' ? IMPACT_WATER_TTL : IMPACT_TTL,
    // Spray stands taller than dust; both are markers, neither is authored.
    grow: hit.kind === 'water' ? 5 : 3,
  });
}

/** Age, grow and fade every trail puff; retire the spent ones. True while any live. */
export function advancePuffs(guns, dt) {
  let active = false;
  for (let i = guns.puffs.length - 1; i >= 0; i--) {
    const puff = guns.puffs[i];
    puff.age += dt;
    const spec = puff.spec || {};
    const ttl = spec.timeToLive || 1;
    if (puff.age >= ttl) {
      guns.scene.remove(puff.mesh);
      puff.mesh.visible = false;
      puff.pool.push(puff.mesh);
      guns.puffs.splice(i, 1);
      continue;
    }
    active = true;
    const phase = (puff.age / ttl) * 100;
    const size = spec.sizeOverTime
      ? sampleCurve(spec.sizeOverTime, phase)[0]
      : (spec.size ?? 1);
    puff.mesh.scale.setScalar(Math.max(size, 1e-4));
    puff.mesh.quaternion.copy(guns.camera.quaternion);
    if (spec.colorOverTime) {
      const [r, g, b, a] = sampleCurve(spec.colorOverTime, phase);
      for (const material of puff.materials) {
        // Gamma-space, as the engine drew it; see `effects.js`.
        material.color.setRGB(r / 255, g / 255, b / 255, THREE.SRGBColorSpace);
        material.opacity = a / 255;
      }
    } else {
      for (const material of puff.materials) {
        material.opacity = 1 - phase / 100;
      }
    }
  }
  return active;
}

/** Age, grow and fade every impact marker; retire the spent ones. True while any live. */
export function advanceImpacts(guns, dt) {
  let active = false;
  for (let i = guns.impacts.length - 1; i >= 0; i--) {
    const impact = guns.impacts[i];
    impact.age += dt;
    if (impact.age >= impact.ttl) {
      guns.scene.remove(impact.mesh);
      impact.mesh.visible = false;
      guns.impactPool.push(impact.mesh);
      guns.impacts.splice(i, 1);
      continue;
    }
    active = true;
    const phase = impact.age / impact.ttl;
    // Fast out, slow fade: the burst is over long before the dust is.
    impact.mesh.scale.setScalar(0.4 + impact.grow * Math.sqrt(phase));
    impact.mesh.material.opacity = (1 - phase) ** 2;
    impact.mesh.quaternion.copy(guns.camera.quaternion);
  }
  return active;
}
