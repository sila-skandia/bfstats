// The bots' bodies on the page (lifted out of map.html, features/vehicle-
// instance-refactor Part 2): the same pose-pair + gait-rig treatment remote
// players get (netcode-render.js), one THREE.Group per bot with a cloned
// skinned mesh and an AnimationMixer, drawn where the bot's controller is,
// interpolated between world ticks like the local body.

import * as THREE from 'three';
import { clone as skeletonClone } from './vendor/utils/SkeletonUtils.js';
import { FAMILY_CLIPS, remoteClipFamily } from './remote-gait.js';

/**
 * Built once by the page, where this code used to sit. `page` hands in
 * what it reads of the rest of the page, as getters (a binding the page
 * reassigns is read live):
 * `MODELS_BASE`, `bindDynamicShading`, `bust`, `disposeFootBodyScene`,
 * `footBodyClips`, `footBodyLoader`, `presentAlpha`, `referee`, `world`.
 */
export function createBotVisuals(page) {
  const botBodies = {};

  // --- bot rendering -------------------------------------------------------------
  // Bots get the same pose-pair + gait-rig treatment as remote players
  // (netcode-render.js). Each bot is a THREE.Group with a cloned skinned mesh
  // and an AnimationMixer, positioned at the bot controller's position.

  const BOT_SOLDIER = { 1: 'GermanSoldier', 2: 'USMarineSoldier' };
  const BOT_WEAPON = 'Colt';


  /** Bot pose-pair cache: "SoldierName__Colt" -> { scene, animations }. */
  const botPoseCache = new Map();

  /** The root group all bot visuals hang off. Added to scene in show(). */
  botBodies.botRoot = null;

  /** Per-bot visual state: { group, rig, want, lastSpeed } */
  const botVisuals = new Map();

  async function botPosePair(soldierName, weapon) {
    const key = `${soldierName}__${weapon}`;
    if (!botPoseCache.has(key)) {
      botPoseCache.set(key, page.footBodyLoader
        .loadAsync(`${page.MODELS_BASE}/poses/${key}.pose.glb${page.bust()}`)
        .then(gltf => {
          gltf.scene.traverse(obj => {
            const data = obj.userData || {};
            if (data.effect || data.projectileMesh || data.projectileTrail
                || data.collision || /collision/i.test(obj.name || '')) obj.visible = false;
          });
          return { scene: gltf.scene, animations: gltf.animations ?? [] };
        }).catch(() => null));
    }
    return botPoseCache.get(key);
  }

  /**
   * The bot's gait clips: exactly the set the local and remote bodies bind
   * (`footBodyClips`), so a bot's legs play the same baked walk/run/crouch/crawl
   * clips a human's do.
   *
   * This used to read the manifest as `manifest[weapon].lower`. That is not its
   * shape — it is `{ lower, grips: { grip: file }, weaponGrip: { weapon: grip } }`
   * — so the lookup fell to `manifest[Object.keys(manifest)[0]]`, a string, whose
   * `.lower` is `undefined`. The loader then fetched `poses/undefined`, both
   * halves came back empty, and `buildBotGaitRig` bound only the static poses:
   * every bot slid across the level in the standing pose with its legs still.
   * `footBodyClips` is the resolution the foot body and the remote renderer
   * already share (`foot-gait.js`).
   */
  async function botGaitClips(weapon) {
    return page.footBodyClips(weapon);
  }

  function buildBotGaitRig(scene, poseClips, gaitClips) {
    const mixer = new THREE.AnimationMixer(scene);
    const action = (name, clips) => {
      const clip = THREE.AnimationClip.findByName(clips, name);
      if (!clip) return null;
      const a = mixer.clipAction(clip);
      a.setLoop(THREE.LoopRepeat, Infinity);
      a.play();
      a.setEffectiveWeight(0);
      a.paused = true;
      return a;
    };
    const families = {};
    for (const [family, spec] of Object.entries(FAMILY_CLIPS)) {
      if (spec.pose) {
        const a = action(spec.pose, poseClips);
        if (a) families[family] = [a];
        continue;
      }
      const lower = action(spec.lower, gaitClips);
      const upper = action(spec.upper, gaitClips);
      if (lower && upper) families[family] = [lower, upper];
    }
    return { mixer, families };
  }

  /** The clip family for a bot's live speed and stance: the engine's own speed
   *  bands (`remote-gait.js`), resolved against the families the rig actually
   *  bound, with the same fallback chain a remote soldier gets. */
  function botClipFamily(speed, stance, bound) {
    return remoteClipFamily(speed, {
      crouch: stance === 'crouch',
      prone: stance === 'prone',
    }, bound);
  }

  async function ensureBotVisual(bot) {
    const team = page.world?.player(bot.playerId)?.team ?? 2;
    const soldierName = BOT_SOLDIER[team] ?? BOT_SOLDIER[2];
    let vis = botVisuals.get(bot.playerId);
    if (vis) return vis;

    const group = new THREE.Group();
    group.name = `bot ${bot.name}`;
    group.visible = false;
    botBodies.botRoot.add(group);

    // `feetPrev`/`feetCur` and the yaw pair are the bot's pose at the last two
    // world-tick boundaries (`capturePresentationTick`), which is what the frame
    // blends between: a raw tick position drawn at a display rate above 30 Hz
    // is a man stepping four times a metre, and it read as blur.
    vis = {
      group, rig: null, want: null, lastSpeed: 0, lastPos: null,
      feetPrev: { x: 0, y: 0, z: 0 }, feetCur: { x: 0, y: 0, z: 0 },
      yawPrev: 0, yawCur: 0, snapped: false,
    };
    botVisuals.set(bot.playerId, vis);

    const weapon = bot.kitPrimary ?? BOT_WEAPON;
    let [pair, gaits] = await Promise.all([
      botPosePair(soldierName, weapon),
      botGaitClips(weapon),
    ]);
    if (!pair && weapon !== BOT_WEAPON) {
      [pair, gaits] = await Promise.all([botPosePair(soldierName, BOT_WEAPON), botGaitClips(BOT_WEAPON)]);
    }
    if (!pair) return vis;

    const scene = skeletonClone(pair.scene);
    page.bindDynamicShading(scene);
    const rig = buildBotGaitRig(scene, pair.animations, gaits);
    group.add(scene);
    vis.rig = { scene, mixer: rig.mixer, families: rig.families };

    return vis;
  }

  function updateBotVisuals(dt) {
    if (!page.referee.bots.length) return;
    for (const bot of page.referee.bots) {
      const vis = botVisuals.get(bot.playerId);
      if (!vis?.rig) continue;

      const pos = bot.getPosition();
      if (!pos || !Number.isFinite(pos[0])) continue;

      // A downed bot stays hidden until its respawn timer puts it back; a
      // seated one rides inside its hull.
      if (page.world?.armorOf(bot.playerId)?.destroyed || bot.vehicle) { vis.group.visible = false; continue; }

      vis.group.visible = true;
      // This frame's blend of the last two tick poses, the same `presentAlpha`
      // the local body and the driven vehicle draw at (`capturePresentationTick`).
      const fp = vis.feetPrev, fc = vis.feetCur;
      const a = vis.snapped ? page.presentAlpha : 1;
      vis.group.position.set(
        fp.x + (fc.x - fp.x) * a,
        fp.y + (fc.y - fp.y) * a,
        fp.z + (fc.z - fp.z) * a);

      // The body's yaw is the soldier's yaw and nothing else, exactly as the
      // local third-person body is drawn (`footBody.scene.quaternion`, the
      // "three placement facts" comment): the pose glb is built in the page's
      // own forward convention. The baked half turn the remote renderer applies
      // to a wire pose does NOT belong here; with it in, a bot walked to its
      // objective facing the way it had come.
      const dyaw = wrapYaw(vis.yawCur - vis.yawPrev);
      const yaw = vis.yawPrev + dyaw * a;
      const q = vis.group.quaternion;
      q.setFromEuler(new THREE.Euler(0, yaw, 0, 'YXZ'));

      // The gait speed from the drawn position's change, one pole.
      const drawn = vis.group.position;
      if (!vis.lastPos) vis.lastPos = [drawn.x, drawn.y, drawn.z];
      const dx = drawn.x - vis.lastPos[0];
      const dz = drawn.z - vis.lastPos[2];
      const speed = dt > 0 ? Math.hypot(dx, dz) / dt : 0;
      vis.lastSpeed = vis.lastSpeed + (speed - vis.lastSpeed) * Math.min(1, dt * 6);
      vis.lastPos[0] = drawn.x; vis.lastPos[1] = drawn.y; vis.lastPos[2] = drawn.z;

      // The gait family follows the bot's live speed and stance, the same rule
      // remote soldiers use (`remoteClipFamily`), resolved against what bound.
      const want = botClipFamily(vis.lastSpeed, bot.stance ?? 'stand',
                                 family => !!vis.rig.families[family]);
      if (want !== vis.want) {
        vis.want = want;
        for (const [family, actions] of Object.entries(vis.rig.families)) {
          for (const a of actions) {
            a.setEffectiveWeight(family === want ? 1 : 0);
            if (family === want) {
              a.paused = false;
              a.reset();
              a.play();
            }
          }
        }
      }
      vis.rig.mixer.update(dt);
    }
  }

  /** Wrap to [-pi, pi], for the yaw blend between two tick poses. */
  function wrapYaw(a) {
    return Math.atan2(Math.sin(a), Math.cos(a));
  }

  /**
   * Per world tick, from `capturePresentationTick`: every bot's finished tick
   * pose becomes `feetCur`/`yawCur`, and the previous one `feetPrev`/`yawPrev`,
   * so `updateBotVisuals` can blend by the frame's alpha. A bot that has just
   * (re)spawned snaps rather than sliding across the level from its last
   * position.
   */
  function captureBotPresentationTick(snap) {
    if (!page.referee.bots?.length) return;
    for (const bot of page.referee.bots) {
      const vis = botVisuals.get(bot.playerId);
      if (!vis) continue;
      const s = page.world?.player(bot.playerId)?.soldier;
      if (!s) continue;
      const c = vis.feetCur, p = vis.feetPrev;
      const jump = vis.snapped && Math.hypot(s.x - c.x, s.z - c.z) > 8;
      if (vis.snapped && !snap && !jump) {
        p.x = c.x; p.y = c.y; p.z = c.z;
        vis.yawPrev = vis.yawCur;
      }
      c.x = s.x; c.y = s.y; c.z = s.z;
      vis.yawCur = s.yaw;
      if (!vis.snapped || snap || jump) {
        p.x = c.x; p.y = c.y; p.z = c.z;
        vis.yawPrev = vis.yawCur;
      }
      vis.snapped = true;
    }
  }

  function disposeBotVisuals() {
    for (const vis of botVisuals.values()) {
      botBodies.botRoot.remove(vis.group);
      if (vis.rig?.scene) page.disposeFootBodyScene(vis.rig.scene);
    }
    botVisuals.clear();
  }

  Object.assign(botBodies, {
    botVisuals,
    captureBotPresentationTick,
    disposeBotVisuals,
    ensureBotVisual,
    updateBotVisuals,
  });
  return botBodies;
}
