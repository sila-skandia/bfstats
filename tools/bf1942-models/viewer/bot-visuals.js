// The bots' bodies on the page (lifted out of map.html, features/vehicle-
// instance-refactor Part 2): the same pose-pair + gait-rig treatment remote
// players get (netcode-render.js), one THREE.Group per bot with a cloned
// skinned mesh and an AnimationMixer, drawn where the bot's controller is,
// interpolated between world ticks like the local body.
//
// The body is the engine's two half-body machines (`soldier-actions.js`):
// the legs play the gait, the stance transitions between standing, crouching
// and lying (the dive, the long way down through the crouch, getting up), and
// the torso the same transitions' upper halves, the fire on every round and
// the reload while the magazine goes in, each state entered with the engine's
// morph from wherever the bones stood (features/bot-body-animation).
//
// He wears his side's uniform and his kit: the level's soldier template for
// his team (`kit-loadout.js` `soldierTemplateFor`: British on El Alamein's
// Allied side, Japanese on Wake's Axis) holding his kit's primary, with the
// kit's helmet and packs on his bones (`soldier-dress.js`) -- on foot, in his
// seat and as a corpse.
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
import { DIE_CLIPS, corpseSeconds, deathFamily, resolveDeathFamily } from './soldier-death.js';
import { SWIM_CLIPS, switchFamily } from './swim.js';
import { rigCapsules } from './rig-capsules.js';
import { FAMILY_HALVES, MorphBlend, SoldierActions, VANILLA_STATES } from './soldier-actions.js';
import { weaponNodeOf, wornSlots } from './soldier-dress.js';
import { createPoseComposer } from './pose-compose.js';
import { outfitCandidates } from './kit-graft.js';

/**
 * Built once by the page, where this code used to sit. `page` hands in
 * what it reads of the rest of the page, as getters (a binding the page
 * reassigns is read live):
 * `bindDynamicShading`, `bots`, `bust`, `disposeFootBodyScene`,
 * `footBodyClips`, `footBodyLoader`, `footStateMachine`, `MODELS_BASE`,
 * `presentAlpha`, `scene`, `soldierBody`, `soldierDress`,
 * `soldierTemplateFor`, `vehicles`, `world`.
 */
export function createBotVisuals(page) {
  const botBodies = {};

  // --- bot rendering -------------------------------------------------------------
  // Bots get the same pose-pair + gait-rig treatment as remote players
  // (netcode-render.js). Each bot is a THREE.Group with a cloned skinned mesh
  // and an AnimationMixer, positioned at the bot controller's position.

  /** Every death a bot's body can play: `soldier-death.js`'s, and the swim
   *  death `handleDamage` takes first for a man in the water (`0x08270c63`,
   *  `Lb_DieSwim` / `Ub_DieSwim`, baked into `swim.gait.glb`). */
  const CORPSE_CLIPS = Object.freeze({ ...DIE_CLIPS, swimDie: SWIM_CLIPS.swimDie });

  // The templates the bots wore before they wore the level's: the fallback
  // for a maps tree whose `_shared/loadouts.json` does not know the level, and
  // for a level template with no pose glb for the kit's weapon.
  const BOT_SOLDIER = { 1: 'GermanSoldier', 2: 'USMarineSoldier' };
  const BOT_WEAPON = 'Colt';


  /** Bot poses: the split tree's recipe + rig + weapon where the tree has
   *  them, the monolithic `.pose.glb` where it does not (`pose-compose.js`).
   *  The composer caches, and the rigs and weapons behind it are cached for
   *  the whole page, so the cache that used to live here is gone. */
  const botPoses = createPoseComposer({
    loader: () => page.footBodyLoader,
    modelsBase: () => page.MODELS_BASE,
    bust: () => page.bust(),
    shade: node => page.bindDynamicShading(node),
  });

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
    return botPoses.pose(soldierName, weapon);
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

  /**
   * The soldier template a bot of `team` wears on this level: the level's own
   * `game.setTeamSkin` (`kit-loadout.js` `soldierTemplateFor`, which falls
   * back by nation where the loadouts do not know the level), else the
   * template the bots always wore.
   */
  function soldierFor(team) {
    return page.soldierTemplateFor?.({ team }) ?? BOT_SOLDIER[team] ?? BOT_SOLDIER[2];
  }

  // --- the two half-bodies ---------------------------------------------------

  /** The nodes a clip's tracks drive, found on `scene`. */
  function trackNodes(scene, clip) {
    const nodes = [];
    const seen = new Set();
    for (const track of clip?.tracks ?? []) {
      const { nodeName } = THREE.PropertyBinding.parseTrackName(track.name);
      if (seen.has(nodeName)) continue;
      seen.add(nodeName);
      const node = THREE.PropertyBinding.findNode(scene, nodeName);
      if (node) nodes.push(node);
    }
    return nodes;
  }

  /**
   * The engine's body: one action per baked clip, two halves with a current
   * action each and the engine's morph over their own bones, and the
   * `SoldierActions` machine choosing what each half plays. `weapon` is the
   * one welded into the hand, whose own rate a grip's clip is scaled to
   * (`gaits.json` `stateMachine.weaponSpeeds`). Null when the tree carries no
   * stance halves (`stand.lower` / `stand.upper`), which `buildStillRig`
   * then draws the way the bots always were.
   */
  function buildHalfBodyRig(scene, clips, weapon, stateMachine) {
    const byName = new Map(clips.map(c => [c.name, c]));
    const standLower = byName.get(FAMILY_HALVES.stand.lower);
    const standUpper = byName.get(FAMILY_HALVES.stand.upper);
    if (!standLower || !standUpper) return null;
    const mixer = new THREE.AnimationMixer(scene);
    const speeds = stateMachine?.weaponSpeeds?.[weapon] ?? {};
    const clipless = stateMachine?.clipless ?? {};

    /** A clip's time scale for this weapon: its baked length times the rate
     *  the weapon's own state plays it at. */
    const timeScale = name => {
      const clip = byName.get(name);
      const speed = speeds[name] ?? clip?.userData?.speed;
      return clip && Number.isFinite(speed) && speed !== 0 && clip.duration > 0
        ? clip.duration * Math.abs(speed) : 1;
    };
    const info = name => {
      const data = byName.get(name)?.userData;
      if (data && Object.keys(data).length) return data;
      return clipless[name] ?? VANILLA_STATES[name] ?? null;
    };

    const actions = new Map();
    for (const clip of clips) {
      if (actions.has(clip.name)) continue;
      const a = mixer.clipAction(clip);
      const loops = info(clip.name)?.loop ?? /\.(lower|upper)$/.test(clip.name);
      if (loops) a.setLoop(THREE.LoopRepeat, Infinity);
      else { a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; }
      a.play();
      a.setEffectiveWeight(0);
      a.paused = true;
      actions.set(clip.name, a);
    }

    const halves = {
      lower: { action: null, blend: new MorphBlend(trackNodes(scene, standLower)) },
      upper: { action: null, blend: new MorphBlend(trackNodes(scene, standUpper)) },
    };
    const anim = new SoldierActions({
      has: name => actions.has(name),
      info,
      duration: name => {
        const clip = byName.get(name);
        return clip ? clip.duration / timeScale(name) : 0;
      },
    });

    /** Switch a half to `name`: the old action out, the new one from its
     *  first frame at the weapon's rate, the morph started from the bones as
     *  they stand. */
    function enter(halfName, name, morph) {
      const half = halves[halfName];
      const next = actions.get(name);
      if (!next) return;
      half.blend.enter(morph);
      if (half.action && half.action !== next) {
        half.action.setEffectiveWeight(0);
        half.action.paused = true;
      }
      next.reset();
      next.paused = false;
      next.timeScale = timeScale(name);
      next.setEffectiveWeight(1);
      next.play();
      half.action = next;
    }

    /** One frame: the machine's entries, the mixer, the morph. */
    function step(input, dt) {
      for (const e of anim.update(input, dt)) enter(e.half, e.name, e.morph);
      mixer.update(dt);
      halves.lower.blend.update(dt);
      halves.upper.blend.update(dt);
    }

    return {
      kind: 'halves', scene, mixer, actions, halves, anim, step,
      families: Object.fromEntries(Object.entries(FAMILY_HALVES)
        .filter(([, h]) => actions.has(h.lower) && actions.has(h.upper))
        .map(([family, h]) => [family, [actions.get(h.lower), actions.get(h.upper)]])),
      hasDeath: family => !!CORPSE_CLIPS[family]
        && actions.has(CORPSE_CLIPS[family].lower) && actions.has(CORPSE_CLIPS[family].upper),
    };
  }

  /**
   * The body as the bots were drawn before the stance halves were baked:
   * whole-body families switched at full weight, the static poses of the
   * pose glb for standing, crouching and lying. What a tree with no gait
   * bundles (a mod's) still gets.
   */
  function buildStillRig(scene, poseClips, gaitClips) {
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
    for (const [family, spec] of Object.entries(CORPSE_CLIPS)) {
      const lower = action(spec.lower, gaitClips, true);
      const upper = action(spec.upper, gaitClips, true);
      if (lower && upper) families[family] = [lower, upper];
    }
    // The swim states, whole-body pairs (`swim.gait.glb`): the entry and the
    // exit play once and hold, the float and the strokes loop.
    for (const [family, spec] of Object.entries(SWIM_CLIPS)) {
      if (families[family]) continue;
      const once = family === 'swimStart' || family === 'swimEnd';
      const lower = action(spec.lower, gaitClips, once);
      const upper = action(spec.upper, gaitClips, once);
      if (lower && upper) families[family] = [lower, upper];
    }
    const rig = { kind: 'still', scene, mixer, families, want: null,
                  hasDeath: family => !!families[family] };
    rig.step = ({ family }, dt) => {
      if (family && family !== rig.want) {
        const was = rig.want;
        rig.want = family;
        switchFamily(rig.families, was, family);
      }
      mixer.update(dt);
    };
    return rig;
  }

  /** Put `want` on at full weight from its first frame and everything else at
   *  zero -- the still rig's whole switch. */
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
      soldierName: soldierFor(team), weapon: null, kit: bot.kit ?? null,
      clips: [], seat: null, seatLoading: null,
      // The stance the last world tick left, and the changes since the frame
      // last looked (`captureBotPresentationTick`).
      stanceTick: null, stanceEvents: [], reloading: false, reloadLeft: 0, shots: 0,
    };
    botVisuals.set(bot.playerId, vis);

    // The level's soldier holding the kit's primary; the old template for a
    // pair the tree has no pose for; the pistol last, as it always was.
    const tries = outfitCandidates({
      levelSoldier: vis.soldierName, fallbackSoldier: BOT_SOLDIER[team] ?? BOT_SOLDIER[2],
      primary: bot.kitPrimary ?? BOT_WEAPON, pistol: BOT_WEAPON,
    });
    let pair = null;
    let weapon = null;
    for (const [soldier, held] of tries) {
      pair = await botPosePair(soldier, held);
      if (pair) { vis.soldierName = soldier; weapon = held; break; }
    }
    if (!pair || botVisuals.get(bot.playerId) !== vis) return vis;
    const [gaits, stateMachine] = await Promise.all([
      botGaitClips(weapon),
      page.footStateMachine?.() ?? null,
    ]);
    if (botVisuals.get(bot.playerId) !== vis) return vis;

    const scene = skeletonClone(pair.scene);
    page.bindDynamicShading(scene);
    const rig = buildHalfBodyRig(scene, gaits, weapon, stateMachine)
      ?? buildStillRig(scene, pair.animations, gaits);
    group.add(scene);
    rig.weaponNode = weaponNodeOf(scene, pair.weaponName ?? weapon);
    vis.rig = rig;
    vis.weapon = weapon;
    vis.clips = gaits;
    // The kit on his bones, and on nobody else's if he is gone by then.
    page.soldierDress?.dress(scene, vis.kit, () => vis.rig?.scene === scene)
      .catch(err => console.warn(`bot kit for ${bot.name}:`, err));

    return vis;
  }

  // --- seated ---------------------------------------------------------------

  /** Seated bodies (`seat-body.js`): the seat's pose glb, the arm IK, the
   *  slump. The same loader draws remote players in their seats. */
  const seatBodies = createSeatBodies({
    pose: (soldierName, pose) => botPoses.seat(soldierName, pose),
    shade: scene => page.bindDynamicShading(scene),
    get parent() { return botBodies.botRoot; },
    dispose: scene => page.disposeFootBodyScene(scene),
    get dresser() { return page.soldierDress ?? null; },
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
                        { dieClips: vis.clips, rootId: held.rootId, kit: vis.kit }).then(seat => {
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

  // --- fire and reload ----------------------------------------------------

  /**
   * A round left `bot`'s weapon (the referee's `onShot`, once per round). The
   * torso plays the fire -- when the weapon firing is the one in his drawn
   * hands; a grenade thrown by a man drawn holding his rifle would swing the
   * rifle.
   */
  botBodies.botFired = bot => {
    const vis = botVisuals.get(bot?.playerId);
    if (!vis?.rig?.anim || bot.vehicle) return;
    const firing = bot.weaponAi?.name ?? null;
    if (firing && vis.weapon && firing.toLowerCase() !== vis.weapon.toLowerCase()) return;
    vis.shots++;
    vis.rig.anim.fire();
  };

  /** The bot's magazine for the weapon in his hands (`bot-referee.js`
   *  `magazineTick`): a reload that has just begun starts the torso's -- the
   *  clock coming off zero, or starting over (a fresh magazine change begun
   *  on the frame the last one ended). */
  function watchReload(vis, bot) {
    const name = bot.weaponAi?.name ?? null;
    const mag = name ? bot._mags?.get?.(name) : null;
    const left = mag && mag.reloadLeft > 0 ? mag.reloadLeft : 0;
    const began = left > 0 && (!vis.reloading || left > vis.reloadLeft + 1e-6);
    if (began && (!vis.weapon || name.toLowerCase() === vis.weapon.toLowerCase())) {
      vis.rig.anim?.reload();
    }
    vis.reloading = left > 0;
    vis.reloadLeft = left;
  }

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
    const played = vis.rig ? resolveDeathFamily(family, f => vis.rig.hasDeath(f)) : null;
    if (!played) return family;
    // The body stays where it was drawn, on the heading it fell on; the group
    // goes to the corpse list and the bot gets a fresh one for the respawn.
    // The half-body rig carries the fall in from wherever the bones stood
    // (`setMorphFactor 20` on the die states), the still rig cuts to it.
    const { group, rig } = vis;
    if (rig.anim) rig.anim.die(CORPSE_CLIPS[played].lower, CORPSE_CLIPS[played].upper);
    else playFamily(rig, played);
    if (rig.weaponNode) rig.weaponNode.visible = false;   // `c_AsmHideWeapon`
    vis.group.visible = true;
    corpses.push({ name: bot.playerId, family: played, scene: group, mixer: rig.mixer,
                   step: dt => rig.step({}, dt),
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
      if (c.step) c.step(dt);
      else c.mixer.update(dt);
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
        vis.stanceEvents.length = 0;
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
      const stance = vis.stanceTick ?? bot.stance ?? 'stand';
      const gait = botClipFamily(vis.lastSpeed, stance,
                                 family => !!vis.rig.families[family]);
      // In the water the swim state holds both halves instead: the bot's own
      // `SwimState` (`swim.js`, run by his soldier's body every tick off his
      // throttle) says which of the engine's five states he is in, and the
      // half-body machine enters it by name (`SoldierActions.followSwim`).
      const swim = swimPairOf(bot);
      const swimWant = swim ? swimFamilyOf(swim, vis.rig) : null;
      const want = swimWant ?? gait;
      vis.want = want;
      // `c_AsmHideWeapon`: every lower swim state declares it, and the pose
      // glb welds the rifle to the hand whatever the clip does.
      if (vis.rig.weaponNode) vis.rig.weaponNode.visible = !swimWant;
      if (vis.rig.anim) {
        // The stance changes the ticks caught, in order: each starts the
        // engine's transition on both halves.
        for (const e of vis.stanceEvents) {
          vis.rig.anim.stanceChanged(e.from, e.to, {
            backward: e.backward,
            family: botClipFamily(0, e.to, family => !!vis.rig.families[family]),
          });
        }
        watchReload(vis, bot);
      }
      vis.stanceEvents.length = 0;
      vis.rig.step({ stance, family: want, trigger: !!bot.isFiring && !swimWant,
                     swim: swimWant ? swim : null }, dt);
    }
  }

  /** The swim state's clip pair for `bot`'s soldier this tick, or null dry. */
  function swimPairOf(bot) {
    const soldier = page.world?.player(bot.playerId)?.soldier;
    return soldier?.swimClips?.(false) ?? null;
  }

  /** The swim family `pair` is, when this rig can draw it; null when it cannot
   *  (a tree published before `swim.gait.glb`), which leaves him on his gait. */
  function swimFamilyOf(pair, rig) {
    const family = Object.keys(SWIM_CLIPS).find(f => SWIM_CLIPS[f].lower === pair.lower);
    if (!family) return null;
    if (rig.kind === 'halves') {
      return rig.actions.has(pair.lower) && rig.actions.has(pair.upper) ? family : null;
    }
    return rig.families[family] ? family : null;
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
   *
   * The stance is read here too, at the tick that changed it: `soldier.js`
   * `#applyStance` decides a stand-to-prone is the dive (`setStateSpeed 6`)
   * unless the forward input was negative, and the body's `stateSpeed` still
   * says which on the tick it happened.
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

      const stance = s.stance ?? 'stand';
      if (vis.stanceTick && stance !== vis.stanceTick && !snap && !jump) {
        const dive = (s.body?.stateSpeed ?? 1) > 1;
        vis.stanceEvents.push({
          from: vis.stanceTick, to: stance,
          backward: vis.stanceTick === 'stand' && stance === 'prone' && !dive,
        });
      }
      vis.stanceTick = stance;
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
        soldier: vis.soldierName, weapon: vis.weapon, kit: vis.kit,
        rig: vis.rig?.kind ?? null,
        lower: vis.rig?.anim?.lower.name ?? null, upper: vis.rig?.anim?.upper.name ?? null,
        stance: vis.stanceTick, shots: vis.shots, reloading: vis.reloading,
        worn: vis.rig ? wornSlots(vis.rig.scene) : {},
        seated: !!vis.seat, seatVisible: !!vis.seat?.scene.visible,
        seatWorn: vis.seat ? wornSlots(vis.seat.scene) : null,
        seatBody: vis.seat?.body ?? null,
      })),
      corpses: corpses.map(c => ({
        name: c.name, family: c.family, ttl: +c.ttl.toFixed(2), seated: !!c.anchor,
        worn: wornSlots(c.scene),
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
