// A bot's rocket launcher, flown: the round the human's Bazooka fires
// (`gunfire.js`), with its rocket body, trail and rear blast, its impact
// explosion and its splash through `vehicle-hits.js` `applyVehicleHit`, in
// place of the referee's instant ray (bot-referee.js `resolveShot`), which
// meets soldier bodies only and so drew nothing and could not hurt a hull.
// The owner's report (features/bot-weapons): "Projectiles from bazookas
// don't show when fired from bots. you hear the sound but no visual."
//
// Which rounds: a hand weapon whose FireArms launches a drawn body that is
// not a fuse round -- the Bazooka and the Panzershreck in vanilla (a `shell`
// with `hasCollisionEffect` and `damageType 1`, the impact blast). A
// grenade is a fuse round thrown on a lob the bots' aim does not compute,
// and a bullet has no body to draw; both stay the referee's.
//
// Each bot holds one gun group per such weapon, collected off a clone of the
// weapon's own glb (`models/<Weapon>.glb`: the FireArms, its muzzle, the
// `e_rocketFumeBack` blast, the rocket body and trail sprite; the pose glb
// the bot is drawn with carries only the drawn weapon). The group is tagged
// with whose round it is (`group.firer`, which vehicle-hits.js `roundFirer`
// reads for the kill credit, the friendly-fire price and the hull's
// attacker) and with what (`group.weapon`, the kill line's word), and is
// fired by `guns.fireShot` down an `aimRay` the bot's own aim hands it: the
// eye along its facing (`fireInCameraDof`, as the human's), rolled into its
// deviation cone as `resolveShot` rolls a bullet (`rollCone`). The clone is
// this module's, never parented into the bot's drawn body (`bot-visuals.js`,
// disposed with his corpse): at each shot it is laid where his weapon node
// is, so the rear blast leaves the tube.
//
// PARITY DEPARTURE, labelled: the engine's `Aimer` drops a round onto its
// target (`BAPAAimAtObject::getAimVec` 0x0853b820); the page's infantry aim
// is the straight line to the target (bot-plans.js `execMouseTurretAimAt`),
// so a rocket fired at range falls short by its gravity (`gravityModifier
// 0.2`: about 0.5 m at 30 m, 1.5 m at 50 m). Open in features/bot-weapons.

import * as THREE from 'three';
import { clone as skeletonClone } from './vendor/utils/SkeletonUtils.js';
import { rollCone } from './bot-referee.js';
import { isFuseRound } from './effects-core.js';

const DEG_TO_RAD = Math.PI / 180;
const _minusZ = new THREE.Vector3(0, 0, -1);

/**
 * Whether a FireArms (a node's `extras.fireArms`) launches a drawn round
 * that is not a fuse round: a rocket launcher's.
 */
export function launchesDrawnRound(fireArms) {
  const p = fireArms?.projectile;
  if (!p || typeof p !== 'object') return false;
  if (p.kind !== 'shell' && p.kind !== 'rocket') return false;
  return !isFuseRound(p.damage);
}

/**
 * Built once by the page. `page` hands in, as getters: `bindDynamicShading`,
 * `botVisuals` (bot-visuals.js, for the drawn weapon node), `bust`, `guns`,
 * `isCollision`, `loader`, `MODELS_BASE`, `scene`, `world`.
 */
export function createBotRounds(page) {
  const botRounds = {};
  /** Per weapon template: `{ fireArms, scene, failed }`, `scene` the loaded
   *  glb's once it lands. Kept across levels: a weapon is a weapon. */
  const templates = new Map();
  /** Per bot and weapon: `{ root, group, ray }`. */
  const held = new Map();
  let holder = null;

  /**
   * A bot weapon's fire data has been read (map.html `botWeaponData`):
   * `fireArms` is its glb's FireArms block. A rocket launcher's glb is
   * loaded now, so the bot's first round already flies.
   */
  botRounds.noteWeapon = (name, fireArms) => {
    if (!name || templates.has(name) || !launchesDrawnRound(fireArms)) return;
    const entry = { fireArms, scene: null, failed: false };
    templates.set(name, entry);
    page.loader.loadAsync(`${page.MODELS_BASE}/${name}.glb${page.bust()}`)
      .then(gltf => { entry.scene = gltf.scene; })
      .catch(err => {
        entry.failed = true;
        console.warn(`[bots] ${name}: no round to fly (${err?.message ?? err}); resolved as a ray`);
      });
  };

  /** Hide what the bot's pose already draws: every mesh that is not an
   *  emitter, a muzzle or a round's template. */
  function hideDrawnWeapon(root) {
    const keep = obj => {
      for (let n = obj; n && n !== root.parent; n = n.parent) {
        const d = n.userData ?? {};
        if (d.effect || d.muzzle || d.projectileMesh || d.projectileTrail || d.tracerMesh) return true;
      }
      return false;
    };
    root.traverse(obj => {
      if (page.isCollision?.(obj) || (obj.isMesh && !keep(obj))) obj.visible = false;
    });
  }

  function groupFor(bot, name, entry) {
    const key = `${bot.playerId}\u0000${name}`;
    let h = held.get(key);
    // A level change clears every gun (`level-load.js`); a group no longer
    // indexed is rebuilt.
    if (h && page.guns.groups.includes(h.group)) return h;
    if (h) { holder?.remove(h.root); held.delete(key); }
    const root = skeletonClone(entry.scene);
    root.name = `bot round ${bot.playerId} ${name}`;
    hideDrawnWeapon(root);
    page.bindDynamicShading?.(root);
    const ray = { origin: new THREE.Vector3(), dir: new THREE.Vector3(0, 0, -1) };
    const playerId = bot.playerId;
    const [group] = page.guns.collect(root, {
      replace: false,          // every other gun on the page stays indexed
      speedScale: 1,           // the real 50 m/s, as the human's
      maxRange: 1200,
      roundLifetime: 'data',
      aimRay: () => ray,
      platformVelocity: () => page.world?.player(playerId)?.soldier?.body?.velocity ?? null,
    });
    if (!group) return null;
    group.firer = playerId;
    group.weapon = name;
    if (!holder) {
      holder = new THREE.Group();
      holder.name = 'bot rounds';
    }
    if (holder.parent !== page.scene) page.scene.add(holder);
    holder.add(root);
    h = { root, group, ray };
    held.set(key, h);
    return h;
  }

  /** Lay the clone where the bot's drawn weapon is, else on the aim ray. */
  function place(h, bot) {
    const vis = page.botVisuals?.get(bot.playerId);
    const node = vis?.group?.visible ? vis.rig?.weaponNode ?? null : null;
    if (node) {
      node.updateWorldMatrix(true, false);
      node.matrixWorld.decompose(h.root.position, h.root.quaternion, h.root.scale);
    } else {
      h.root.position.copy(h.ray.origin);
      h.root.quaternion.setFromUnitVectors(_minusZ, h.ray.dir);
      h.root.scale.set(1, 1, 1);
    }
    h.root.updateMatrixWorld(true);
  }

  /**
   * One round from `bot`'s held weapon (the referee's `env.launchRound`):
   * true when it is a rocket launcher whose round is now in flight, false to
   * leave the round to the referee.
   */
  botRounds.launch = bot => {
    const name = bot.weaponAi?.name ?? null;
    const entry = name ? templates.get(name) : null;
    if (!entry?.scene || !page.guns) return false;
    const h = groupFor(bot, name, entry);
    if (!h) return false;
    const { origin, dir } = bot.aimRay();
    const len = Math.hypot(dir[0], dir[1], dir[2]) || 1;
    const [x, y, z] = rollCone([dir[0] / len, dir[1] / len, dir[2] / len], (bot.aimDeviation ?? 0) * DEG_TO_RAD);
    h.ray.origin.set(origin[0], origin[1], origin[2]);
    h.ray.dir.set(x, y, z);
    place(h, bot);
    page.guns.fireShot(h.group);
    return true;
  };

  /** A level is going: every bot's group with it. Rounds in the air are the
   *  guns' own to clear. */
  botRounds.reset = () => {
    for (const h of held.values()) {
      page.guns?.release(h.group);
      holder?.remove(h.root);
    }
    held.clear();
  };

  /** What is held, for a headless check. */
  botRounds.debug = () => ({
    templates: [...templates].map(([name, t]) => ({ name, loaded: !!t.scene, failed: t.failed })),
    held: [...held].map(([key, h]) => ({
      key: key.replace('\u0000', ' '), firer: h.group.firer, weapon: h.group.weapon, shots: h.group.shots,
      inFlight: page.guns?.liveProjectiles(h.group) ?? 0,
    })),
  });

  return botRounds;
}
