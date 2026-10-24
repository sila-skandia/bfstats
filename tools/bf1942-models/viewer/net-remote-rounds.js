// Another player's rounds on the live page: the weapon glb's own muzzle flash
// and round (tracer), fired from where he stands down where he faces, as the
// replay lays a recorded soldier's (replay-bodies.js `flash`) and bot-rounds.js
// a bot's. A real server sends a client no shot, so the sidecar's 'shot' rows
// (a fire state, a held trigger) are what drive this.
//
// The rounds are the server's business: each group is marked `replay`, which
// map.html's `guns.onImpact` skips, so a remote round draws its impact and
// bills nothing on this page.

import * as THREE from 'three';
import { clone as skeletonClone } from './vendor/utils/SkeletonUtils.js';
import { loadFirst, weaponUrls } from './pose-bases.js';
import { wearPagePaint } from './level-skin.js';
import { fireCycle } from './fire-timer.js';
import { EYE_HEIGHT } from './soldier-pose.js';

const _minusZ = new THREE.Vector3(0, 0, -1);

/** Hide what the soldier's pose already draws: every mesh of the weapon glb
 *  that is not an emitter, a muzzle or a round's template (replay-bodies.js
 *  keeps the same rule). Exported for `net-server-rounds.js`, which lays the
 *  same kind of invisible copy of a vehicle to light its gun. */
export function hideDrawnWeapon(root) {
  const keep = obj => {
    for (let n = obj; n && n !== root.parent; n = n.parent) {
      const d = n.userData ?? {};
      if (d.effect || d.muzzle || d.projectileMesh || d.projectileTrail || d.tracerMesh) return true;
    }
    return false;
  };
  root.traverse(obj => {
    if (obj.userData?.collision || /collision/i.test(obj.name || '') || (obj.isMesh && !keep(obj))) obj.visible = false;
  });
}

/**
 * ctx: { scene, loader, modelsBase, bust: () => string, guns: () => Guns,
 *        shadeModel? }. Returns { fire(owner, weapon, at, yawRad, pitchRad,
 *        from?, pooled?, line?: { origin, dir } in the page's frame),
 *        altName(weapon), cycle(owner, weapon),
 *        dispose() }.
 */
export function createRemoteRounds(ctx) {
  const hands = new Map();   // weapon -> Promise<{ scene } | null>
  const held = new Map();    // `${owner}|${weapon}` -> { root, groups, ray }
  let fired = 0;             // rounds and flashes drawn, for `__net()`
  const missed = new Map();  // weapon -> rounds not drawn (no glb, no FireArms)
  const miss = weapon => missed.set(weapon, (missed.get(weapon) ?? 0) + 1);

  function handGun(weapon) {
    if (!hands.has(weapon)) {
      hands.set(weapon, loadFirst(ctx.loader, weaponUrls(ctx.modelsBase, weapon, ctx.bust()))
        .then(gltf => { ctx.shadeModel?.(gltf.scene); return { scene: gltf.scene }; })
        .catch(() => null));
    }
    return hands.get(weapon);
  }

  async function fire(owner, weapon, at, yaw, pitch = 0, from = null, pooled = null, line = null) {
    const guns = ctx.guns();
    if (!guns || !weapon || !at) return false;
    const key = `${owner}|${weapon}`;
    let h = held.get(key);
    if (!h) {
      const hand = await handGun(weapon);
      if (!hand) { miss(weapon); return false; }
      h = held.get(key);
      if (!h) {
        const root = skeletonClone(hand.scene);
        root.name = `remote round ${owner} ${weapon}`;
        hideDrawnWeapon(root);
        // The level's paint (`level-skin.js`, ledger LOAD-3), on the
        // materials every clone of the weapon shares.
        void wearPagePaint(root);
        ctx.scene.add(root);
        const ray = { origin: new THREE.Vector3(), dir: new THREE.Vector3(0, 0, -1) };
        const groups = guns.collect(root, {
          replace: false, speedScale: 1, maxRange: 1200, roundLifetime: 'data', aimRay: () => ray,
        });
        for (const group of groups) {
          group.replay = true;           // drawn, never billed (map.html guns.onImpact)
          group.firer = owner;
          group.weapon = weapon;
          group.view = 'third';
        }
        h = { root, groups, ray };
        held.set(key, h);
      }
    }
    const group = h.groups.find(g => (g.stats?.input || 'c_PIFire') === 'c_PIFire') ?? h.groups[0];
    if (!group) { miss(weapon); return false; }
    // His camera (ledger VIEW-14): his view yaw along (sin yaw, 0, cos yaw)
    // (net-sidecar.js soldierYawPitch, the body plus the twist) and his view
    // pitch, from his eye, `setPoseCameraPos` over his origin for his stance.
    // A sidecar's round row (`line`, net-hand-rounds.js) is the server's own
    // line: its direction, and its launch point moved with the drawn man.
    const cp = Math.cos(pitch);
    if (line?.dir) h.ray.dir.set(line.dir.x, line.dir.y, line.dir.z).normalize();
    else h.ray.dir.set(Math.sin(yaw) * cp, Math.sin(pitch), Math.cos(yaw) * cp).normalize();
    // The flash on the gun in his hands when the drawn body can say where
    // that is, else at his eye: drawn at the eye, which is also his head, an
    // SMG flashed out of the man's throat (live, 2026-10-17). The round
    // leaves the server's point when the row gives one (the eye, ledger
    // VIEW-14 and XHIT-18), else the flash's.
    if (from) h.ray.origin.set(from.x, from.y, from.z);
    else if (line?.origin) h.ray.origin.set(line.origin.x, line.origin.y, line.origin.z);
    else h.ray.origin.set(at.x, at.y + EYE_HEIGHT[at.prone ? 2 : at.crouch ? 1 : 0], at.z);
    h.root.position.copy(h.ray.origin);
    if (line?.origin) h.ray.origin.set(line.origin.x, line.origin.y, line.origin.z);
    h.root.quaternion.setFromUnitVectors(_minusZ, h.ray.dir);
    h.root.scale.set(1, 1, 1);
    h.root.updateMatrixWorld(true);
    // The server flies some rounds itself and ghosts them to us
    // (`net-server-rounds.js`): one of ours beside it is a second grenade,
    // and the page's flew at the throw's first frame while the server's left
    // his hand at the end of the wind-up, so a remote appeared to throw
    // twice (live, 2026-10-17). The muzzle is still lit.
    if (pooled?.(group.stats?.projectile?.template)) guns.flash(group);
    else guns.fireShot(group);
    fired++;
    return true;
  }

  /**
   * The name of the FireArms `weapon` carries on the right button (a
   * bayonet's stab, a commando knife's: `setInputFire c_PIAltFire`), which
   * `weapons.json` keys its report by, as the player's own stab plays it
   * (`hand-weapon.js`); null for a weapon with none.
   */
  async function altName(weapon) {
    const hand = weapon ? await handGun(weapon) : null;
    let name = null;
    hand?.scene.traverse(obj => {
      if (!name && String(obj.userData?.fireArms?.input ?? '').toLowerCase() === 'c_pialtfire') {
        name = obj.userData.name ?? obj.name ?? null;
      }
    });
    return name;
  }

  /**
   * Seconds between a held trigger's rounds for `owner`'s `weapon`: its
   * primary FireArms' `roundOfFire` on the engine's whole 1/30 s ticks
   * (`fire-timer.js`, GUN-13), so a held Greasegun is every 4th tick. Null
   * until his first round has loaded the weapon.
   */
  function cycle(owner, weapon) {
    const h = held.get(`${owner}|${weapon}`);
    const group = h?.groups.find(g => (g.stats?.input || 'c_PIFire') === 'c_PIFire') ?? h?.groups[0];
    return group?.stats ? fireCycle(group.stats.roundOfFire) : null;
  }

  function dispose() {
    const guns = ctx.guns();
    for (const h of held.values()) {
      for (const group of h.groups) guns?.release?.(group);
      h.root.parent?.remove(h.root);
    }
    held.clear();
  }

  return { fire, altName, cycle, dispose, debug: () => ({ held: held.size, fired, missed: Object.fromEntries(missed) }) };
}
