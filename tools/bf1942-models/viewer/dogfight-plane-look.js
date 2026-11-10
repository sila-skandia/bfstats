// The theatre's fighters drawn the way the game draws them
// (features/dogfight-school, "The planes' own propellers and tracers"):
// the propeller turned on the engine's revs by the engine's own tail
// (`engine-spin.js`, ledger PHY-30), the blades swapped for the blurred disc
// past the selector's comparison, and the guns' rounds as the gun's own
// tracer streak (`TLight_m1` on every vanilla fighter), stretched the
// engine's way (ledger TRC-1..TRC-3) on every `interval`-th round of the
// gun's real rate of fire, with nothing drawn between them.
//
// A two-seater's gunner (`dogfight-gunners.js`) fires their own gun: its
// rounds carry `gunner` and `weapon`, and are drawn as that FireArms' own
// streak (`tracerGunOf(root, weapon)`), counted on that gun's own interval.
//
// A duel (`dogfight-duel.js`) fires a round a tick while the trigger is
// down, 30 a second; the gun fires `roundOfFire` (12 for a Spitfire's or a
// 109's guns). So the drawn rounds are the duel's rounds that fall on the
// gun's own cadence, and of those every `interval`-th carries a tracer.

import * as THREE from 'three';
import { discAt, ENGINE_TICK_HZ, engineOfLodPair, lodNodeKey, lodSpinState, poseLodSpin,
         stepLodSpin } from './engine-spin.js';
import { tracerGeometry, tracerMaterial } from './round-visuals.js';

/** The streak's cross-section never drawn thinner than this on screen
 *  (`projectile-flight.js` `TRACER_MIN_SCREEN_PX`). */
const MIN_SCREEN_PX = 2.5;
/** The engine's flat cross-section scale on a tracer mesh (TRC-1). */
const ACROSS = 10;
/** A vanilla MG's gun, for a drawn fighter that carries none. */
const VANILLA = { rate: 12, interval: 3, scaler: 50, speed: 400 };

/**
 * Every propeller pair under an Engine in `root`, ready to turn: the
 * static blades and the blurred disc the glb keeps as siblings
 * (`extras.propellerBlur`), as `model-clips.js` collects them.
 */
export function propellersOf(root) {
  const pairs = [];
  root?.traverse(obj => {
    const blur = obj.userData?.propellerBlur;
    if (!blur) return;
    const engine = engineOfLodPair(obj);
    if (!engine) return;
    const staticKey = lodNodeKey(blur.static), blurredKey = lodNodeKey(blur.blurred);
    const staticNode = obj.children.find(c => lodNodeKey(c.name) === staticKey);
    const blurredNode = obj.children.find(c => lodNodeKey(c.name) === blurredKey);
    if (!staticNode || !blurredNode) return;
    pairs.push({ static: staticNode, blurred: blurredNode, engine,
                 threshold: blur.comparisons?.[0] ?? 0.07, ...lodSpinState(staticNode, blurredNode) });
  });
  return pairs;
}

/**
 * Turn the pairs `seconds` of the fight on with the engine at `revs`: the
 * current alternative turns `revs * 20` degrees an engine tick, and the
 * disc shows past `comparison^2`. Paused (`seconds` 0) they hold still.
 */
export function turnPropellers(pairs, revs, seconds) {
  const ticks = Math.max(0, seconds) * ENGINE_TICK_HZ;
  for (const pair of pairs) {
    stepLodSpin(pair, revs, ticks);
    const disc = discAt(revs, pair.threshold);
    pair.static.visible = !disc;
    pair.blurred.visible = disc;
    poseLodSpin(pair);
  }
}

/** A node's template name: the glb's scene-wide suffix (`_1`) taken off. */
const bareName = name => String(name ?? '').replace(/_\d+$/, '');

/** Whether a round is a gunner's (`dogfight-fight.js`, a recorded gunner's
 *  shot), not the pilot's. */
export const isGunnerRound = r => r.gunner !== undefined && r.gunner !== null && r.gunner !== false;

/**
 * The gun of `root` that fires tracers, as the theatre needs it: its
 * baked streak (`userData.tracerMesh`, null for the stand-in), the streak's
 * cross-section and tail in its own metres, and the data that size and
 * space it. A fighter with none gets the vanilla MG and the stand-in.
 * `weapon` names one FireArms (a gunner's, by its template): that gun's own,
 * or the vanilla MG's when the model has no such gun with a tracer.
 */
export function tracerGunOf(root, weapon = null) {
  let gun = null;
  const want = weapon ? bareName(weapon).toLowerCase() : null;
  root?.traverse(obj => {
    const stats = obj.userData?.fireArms;
    if (gun || !stats?.tracer || !(stats.velocity > 0)) return;
    if (want && bareName(obj.name).toLowerCase() !== want) return;
    let template = null;
    obj.traverse(n => { if (!template && n.userData?.tracerMesh) template = n; });
    gun = {
      template,
      rate: stats.roundOfFire > 0 ? stats.roundOfFire : VANILLA.rate,
      interval: Math.max(1, Math.round(stats.tracer.interval ?? VANILLA.interval)),
      scaler: stats.tracer.scaler > 0 ? stats.tracer.scaler : VANILLA.scaler,
      speed: stats.velocity,
    };
  });
  gun ??= { template: null, ...VANILLA };
  let width = 0, tail = 0;
  gun.template?.traverse(part => {
    if (!part.isMesh || !part.geometry) return;
    if (!part.geometry.boundingBox) part.geometry.computeBoundingBox();
    const box = part.geometry.boundingBox;
    width = Math.max(width, box.max.x - box.min.x, box.max.y - box.min.y);
    tail = Math.max(tail, box.max.z);
  });
  // The streak's length: |v| / tracerScaler along its own Z (TRC-1).
  return { ...gun, width: width || 0.02, tail, length: gun.speed / gun.scaler };
}

/**
 * The duel's rounds that carry a tracer: per gun, the first round of each
 * of the gun's own shots (`rate` a second), and of those every
 * `interval`-th, counted on across bursts as the gun's round-robin is.
 * `guns` is one `tracerGunOf` a side; `gunnerLook(r)` the look of a
 * gunner's round (`isGunnerRound`), counted apart from the pilot's guns
 * (a gunner's rounds come at their gun's own rate already).
 */
export function tracerRounds(rounds, guns, gunnerLook = null) {
  const out = new Set();
  const last = new Map(), count = new Map();
  for (const r of rounds) {
    const gunner = isGunnerRound(r);
    const g = gunner ? (gunnerLook?.(r) ?? guns[r.side]) : guns[r.side];
    if (!g) continue;
    const key = gunner ? `${r.side}:${r.weapon ?? r.gunner}` : `${r.side}`;
    const shot = gunner ? r.t : Math.floor(r.t * g.rate + 1e-6);
    if (!gunner && shot === last.get(key)) continue;
    last.set(key, shot);
    const n = count.get(key) ?? 0;
    if (n % g.interval === 0) out.add(r);
    count.set(key, n + 1);
  }
  return out;
}

/** A streak of `gun`'s, its materials its own so each fades apart. */
export function makeTracer(gun) {
  if (!gun.template) {
    const mesh = new THREE.Mesh(tracerGeometry, tracerMaterial);
    mesh.userData.fade = [];
    mesh.frustumCulled = false;
    return mesh;
  }
  const mesh = gun.template.clone();
  const fade = [];
  mesh.traverse(part => {
    part.visible = true;
    part.frustumCulled = false;
    if (!part.isMesh) return;
    part.material = [part.material].flat().map(m => {
      const c = m.clone();
      c.transparent = true;
      if (c.userData?.additive) { c.blending = THREE.AdditiveBlending; c.depthWrite = false; }
      fade.push({ material: c, opacity: c.opacity });
      return c;
    });
    if (part.material.length === 1) part.material = part.material[0];
  });
  mesh.userData.fade = fade;
  return mesh;
}

const _back = new THREE.Vector3();

/**
 * Pose a streak with its round at `head` flying along unit `dir`, having
 * flown `travelled` metres: the engine's (10, 10, |v| / scaler), the tail
 * grown out of the muzzle, all of it times `scale` (the theatre's draw
 * scale, so it keeps its size against the fighters drawn bigger than life).
 * Its cross-section is held at a couple of pixels and dimmed by as much, as
 * the world's tracers are; in a diagram view (`scale` > 1) it keeps a third
 * of its light, so a burst reads from a kilometre off. `metresPerPx` is
 * what one pixel spans at `distance` from the eye.
 */
export function poseTracer(mesh, gun, head, dir, travelled, scale, metresPerPx) {
  mesh.position.copy(head);
  // The glb's forward is -Z, its tail at +Z: aim +Z a step back down the line.
  mesh.lookAt(_back.copy(head).sub(dir));
  if (!gun.template) {
    // The stand-in is centred: hang it half a length behind the round.
    const length = Math.min(gun.length, Math.max(0.5, travelled)) * scale;
    mesh.position.addScaledVector(dir, -length / 2);
    mesh.scale.set(scale * 8, scale * 8, length);
    return;
  }
  const length = (gun.tail > 0 ? Math.min(gun.length, Math.max(1e-3, travelled / gun.tail)) : gun.length) * scale;
  const real = ACROSS * scale;
  const floor = metresPerPx > 0 ? (metresPerPx * MIN_SCREEN_PX) / gun.width : 0;
  const across = Math.max(real, floor);
  mesh.scale.set(across, across, length);
  const cover = Math.max(real / across, scale > 1 ? 0.35 : 0);
  for (const f of mesh.userData.fade) f.material.opacity = f.opacity * cover;
}
