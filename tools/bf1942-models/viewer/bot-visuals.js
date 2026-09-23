// The bots' bodies on the page (lifted out of map.html, features/vehicle-
// instance-refactor Part 2): the same pose-pair + gait-rig treatment remote
// players get (netcode-render.js), one THREE.Group per bot with a cloned
// skinned mesh and an AnimationMixer, drawn where the bot's controller is,
// interpolated between world ticks like the local body.
//
// A seated bot is drawn in his seat the way the human's own seat draws him
// (`seat-body.js`, shared with `seat-pose.js`): the seat's pose glb, at the
// SeatObject, hands on the wheel or the gun by the seat's IK, and only where
// the seat reaches a SeatObject (`seatBody`). A tank driver is not drawn and cannot be shot;
// a jeep's passengers and a bare MG's gunner are and can.
//
// A dead bot leaves a corpse. The killing blow picks the engine's death
// (`soldier-death.js`) and the body plays it and holds its last frame for the
// soldier template's `timeToLiveAfterDeath`, whether or not the bot has been
// put back on a flag in the meantime -- the engine's corpse is its own object
// and so is this one. A man killed in his seat slumps where he sat: the seat's
// legs, `Ub_DieInVehicle` over the top.

import * as THREE from 'three';
import { clone as skeletonClone } from './vendor/utils/SkeletonUtils.js';
import { FAMILY_CLIPS, remoteClipFamily } from './remote-gait.js';
import { createSeatBodies, seatAnchor } from './seat-body.js';
import { BOT_BODY_HEIGHT } from './bot-referee.js';
import { PARA_FALLING } from './parachute.js';
import { DIE_CLIPS, DIE_IN_VEHICLE_UPPER, corpseSeconds, deathFamily,
         resolveDeathFamily } from './soldier-death.js';
import { rigCapsules } from './rig-capsules.js';

/**
 * Built once by the page, where this code used to sit. `page` hands in
 * what it reads of the rest of the page, as getters (a binding the page
 * reassigns is read live):
 * `bindDynamicShading`, `bots`, `bust`, `disposeFootBodyScene`,
 * `footBodyClips`, `footBodyLoader`, `MODELS_BASE`, `presentAlpha`, `scene`,
 * `soldierBody`, `vehicles`, `world`.
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
  /** Bot visuals: create the root group now that `scene` exists. Every level
   *  load asks (`show()`); the first one builds it and the rest keep it. */
  botBodies.ensureRoot = () => {
    if (!botBodies.botRoot) {
      botBodies.botRoot = new THREE.Group();
      botBodies.botRoot.name = 'bot-renderers';
      page.scene.add(botBodies.botRoot);
    }
  };

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
          // `extras.weapon` names the welded weapon subtree a death stows.
          return { scene: gltf.scene, animations: gltf.animations ?? [],
                   weaponName: gltf.userData?.weapon ?? null };
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
    const action = (name, clips, once = false) => {
      const clip = THREE.AnimationClip.findByName(clips, name);
      if (!clip) return null;
      const a = mixer.clipAction(clip);
      if (once) { a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; }
      else a.setLoop(THREE.LoopRepeat, Infinity);
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
    // The deaths, one-shots that hold their last frame.
    for (const [family, spec] of Object.entries(DIE_CLIPS)) {
      const lower = action(spec.lower, gaitClips, true);
      const upper = action(spec.upper, gaitClips, true);
      if (lower && upper) families[family] = [lower, upper];
    }
    return { mixer, families };
  }

  /** Put `want` on at full weight from its first frame and everything else at
   *  zero -- the same switch the gait families take. */
  function playFamily(rig, want) {
    for (const [family, actions] of Object.entries(rig.families)) {
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
      bot, group, rig: null, want: null, lastSpeed: 0, lastPos: null,
      feetPrev: { x: 0, y: 0, z: 0 }, feetCur: { x: 0, y: 0, z: 0 },
      yawPrev: 0, yawCur: 0, snapped: false,
      soldierName, clips: [], seat: null, seatLoading: null,
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
    const weaponNode = scene.getObjectByName(pair.weaponName ?? weapon) ?? null;
    vis.rig = { scene, mixer: rig.mixer, families: rig.families, weaponNode };
    vis.clips = gaits;

    return vis;
  }

  // --- seated ---------------------------------------------------------------

  /** Seated bodies (`seat-body.js`): the seat's pose glb, the arm IK, the
   *  slump. The same loader draws remote players in their seats. */
  // Every field read late: the page builds this module before the foot body
  // whose loader it borrows.
  const seatBodies = createSeatBodies({
    get loader() { return page.footBodyLoader; },
    url: (soldierName, pose) =>
      `${page.MODELS_BASE}/poses/${soldierName}__${pose}.pose.glb${page.bust()}`,
    shade: scene => page.bindDynamicShading(scene),
    get parent() { return botBodies.botRoot; },
    dispose: scene => page.disposeFootBodyScene(scene),
  });

  /** The seat `bot` holds, as `{ seat, anchor, rootId }`, or null. */
  function seatOfBot(bot) {
    const handle = page.vehicles?.seatOf(bot.playerId);
    if (!handle) return null;
    const seat = handle.seatInfo(handle.seatId);
    const anchor = seatAnchor(seat);
    return anchor ? { seat, anchor, rootId: handle.rootId } : null;
  }

  const disposeSeat = seat => seatBodies.dispose(seat);

  /** The seated body for the bot's seat this frame, loading it on a change of
   *  seat. False while there is none to draw (yet). */
  function syncSeated(vis, bot, dt) {
    const held = seatOfBot(bot);
    if (!held) { disposeSeat(vis.seat); vis.seat = null; return false; }
    if (vis.seat?.anchor !== held.anchor) {
      disposeSeat(vis.seat);
      vis.seat = null;
      if (vis.seatLoading !== held.anchor) {
        vis.seatLoading = held.anchor;
        seatBodies.load(vis.soldierName, held.seat,
                        { dieClips: vis.clips, rootId: held.rootId }).then(seat => {
          const still = seatOfBot(bot);
          if (!seat) return;
          if (vis.seatLoading !== held.anchor || still?.anchor !== held.anchor
              || botVisuals.get(bot.playerId) !== vis) { disposeSeat(seat); return; }
          vis.seat = seat;
          vis.seatLoading = null;
        });
      }
      return false;
    }
    vis.seat.scene.visible = true;
    seatBodies.step(vis.seat, dt, BOT_BODY_HEIGHT);
    return true;
  }

  /**
   * Where a seated bot's stand-in body is (`referee.bodyAt`), in the
   * `{ x, y, z }`-at-the-feet form a man on foot is: null when his seat draws
   * nobody -- or half of him, whose torso is down a hatch -- and `undefined`
   * for anyone this does not draw seated, which leaves them on their soldier.
   */
  /**
   * A live bot's hit capsules this frame (`rig-capsules.js`): the seat's body
   * when he is drawn in one, his own on foot. Null for a bot not drawn -- the
   * referee then falls back to the stand-in sphere -- and for half a body down
   * a hatch, which `seatedBodyAt` keeps out of reach too.
   */
  botBodies.capsulesOf = playerId => {
    const vis = botVisuals.get(playerId);
    if (!vis) return null;
    const table = page.soldierBody?.collisionBones;
    if (vis.bot?.vehicle) {
      if (!vis.seat || vis.seat.halfBody || !vis.seat.scene.visible) return null;
      return rigCapsules(vis.seat.scene, table);
    }
    if (!vis.rig || !vis.group.visible) return null;
    return rigCapsules(vis.rig.scene, table);
  };

  botBodies.seatedBodyAt = playerId => {
    const vis = botVisuals.get(playerId);
    if (!vis?.bot?.vehicle) return undefined;
    if (!vis.seat || vis.seat.halfBody) return null;
    return vis.seat.body;
  };

  // --- corpses ----------------------------------------------------------------

  /** Bodies left behind: `{ name, family, scene, mixer, ttl, anchor, dispose }`.
   *  The human's seated corpse (`seat-pose.js`) joins the same list through
   *  `addCorpse`, so one clock runs every body down. */
  const corpses = [];
  botBodies.addCorpse = corpse => { corpses.push(corpse); };

  /**
   * The bot has just died: pick the engine's death and leave the body playing
   * it. `opts.seated` is whether he died in his seat (`referee.damageLanded`).
   * The bot's own visual is rebuilt for the respawn, so the corpse keeps its
   * full `CORPSE_SECONDS` however soon he is back.
   */
  botBodies.killBot = (bot, opts = {}) => {
    const vis = botVisuals.get(bot.playerId);
    if (!vis) return null;
    const soldier = page.world?.player(bot.playerId)?.soldier ?? null;
    const family = deathFamily({
      seated: !!opts.seated,
      parachuteOpen: !!soldier?.chute?.open,
      swimming: !!soldier?.swim?.swimming,
      freeFall: soldier?.chute?.state === PARA_FALLING,
      stance: soldier?.stance ?? bot.stance ?? 'stand',
      hit: page.world?.armorOf(bot.playerId)?.lastHit ?? null,
      yaw: vis.yawCur,
    });
    vis.group.visible = false;

    if (family === 'dieInVehicle') {
      const seat = vis.seat;
      vis.seat = null;
      vis.seatLoading = null;
      if (!seat) return family;
      seatBodies.slump(seat);
      corpses.push({ name: bot.playerId, family, scene: seat.scene, mixer: seat.mixer,
                     ttl: corpseSeconds(page.soldierBody), anchor: seat.anchor,
                     dispose: () => disposeSeat(seat) });
      return family;
    }

    disposeSeat(vis.seat);
    vis.seat = null;
    const played = vis.rig ? resolveDeathFamily(family, f => !!vis.rig.families[f]) : null;
    if (!played) return family;
    // The body stays where it was drawn, on the heading it fell on; the group
    // goes to the corpse list and the bot gets a fresh one for the respawn.
    playFamily(vis.rig, played);
    if (vis.rig.weaponNode) vis.rig.weaponNode.visible = false;   // `c_AsmHideWeapon`
    vis.group.visible = true;
    const { group, rig } = vis;
    corpses.push({ name: bot.playerId, family: played, scene: group, mixer: rig.mixer,
                   ttl: corpseSeconds(page.soldierBody), anchor: null,
                   dispose: () => {
                     rig.mixer.stopAllAction();
                     botBodies.botRoot.remove(group);
                     page.disposeFootBodyScene(rig.scene);
                   } });
    botVisuals.delete(bot.playerId);
    ensureBotVisual(bot);
    return played;
  };

  /** The seat anchors a live occupant holds this frame, whose corpse must go:
   *  a new man in the seat is where the old one slumped. */
  function occupiedAnchors() {
    const held = new Set();
    for (const handle of page.vehicles?.seated?.values?.() ?? []) {
      const anchor = seatAnchor(handle.seatInfo(handle.seatId));
      if (anchor) held.add(anchor);
    }
    return held;
  }

  function stepCorpses(dt) {
    if (!corpses.length) return;
    const held = occupiedAnchors();
    for (let i = corpses.length - 1; i >= 0; i--) {
      const c = corpses[i];
      c.ttl -= dt;
      if (c.ttl <= 0 || (c.anchor && held.has(c.anchor))) {
        c.dispose();
        corpses.splice(i, 1);
        continue;
      }
      if (c.anchor) {
        c.anchor.getWorldPosition(c.scene.position);
        c.anchor.getWorldQuaternion(c.scene.quaternion);
      }
      c.mixer.update(dt);
    }
  }

  function updateBotVisuals(dt) {
    stepCorpses(dt);
    if (!page.bots.length) return;
    for (const bot of page.bots) {
      const vis = botVisuals.get(bot.playerId);
      if (!vis?.rig) continue;

      const pos = bot.getPosition();
      if (!pos || !Number.isFinite(pos[0])) continue;

      // A downed bot is his corpse until his respawn timer puts him back; a
      // seated one is drawn in his seat, where the seat draws anybody.
      if (page.world?.armorOf(bot.playerId)?.destroyed) {
        vis.group.visible = false;
        continue;
      }
      if (bot.vehicle) {
        vis.group.visible = false;
        syncSeated(vis, bot, dt);
        continue;
      }
      if (vis.seat) { disposeSeat(vis.seat); vis.seat = null; }
      vis.seatLoading = null;

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
        playFamily(vis.rig, want);
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
    if (!page.bots?.length) return;
    for (const bot of page.bots) {
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
      disposeSeat(vis.seat);
    }
    botVisuals.clear();
    for (const c of corpses) c.dispose();
    corpses.length = 0;
  }

  /** What is drawn, for `window.__botBodies`. */
  function debug() {
    return {
      live: [...botVisuals.values()].map(vis => ({
        id: vis.bot?.playerId ?? null, visible: vis.group.visible, want: vis.want,
        seated: !!vis.seat, seatVisible: !!vis.seat?.scene.visible,
        seatBody: vis.seat?.body ?? null,
      })),
      corpses: corpses.map(c => ({
        name: c.name, family: c.family, ttl: +c.ttl.toFixed(2), seated: !!c.anchor,
        at: c.scene.getWorldPosition(new THREE.Vector3()).toArray().map(v => +v.toFixed(2)),
      })),
    };
  }

  Object.assign(botBodies, {
    botVisuals,
    debug,
    captureBotPresentationTick,
    disposeBotVisuals,
    ensureBotVisual,
    updateBotVisuals,
  });
  return botBodies;
}
