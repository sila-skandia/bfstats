// The page's sound: the listener and its limiter, the level's ambience and
// area sounds, the sound buffers, the vehicle audio rack every occupied hull
// claims a voice in, the world's gunfire for anyone not at the player's own
// shoulder, the soldiers' footsteps, grunts and the hit indicator, and the
// mix (`updateAudio`). Lifted out of map.html (features/vehicle-instance-
// refactor Part 2); `engine-audio.js`, `vehicle-audio.js`, `world-fire.js` and
// `effect-audio.js` stay the voices.

import * as THREE from 'three';
import { WEAPON_HEADROOM } from './engine-audio.js';
import { VehicleAudioRack } from './vehicle-audio.js';
import { WorldFire } from './world-fire.js';
import { footstepMaterial } from './collision-materials.js';

/**
 * Built once by the page, where this code used to sit. `page` hands in
 * what it reads of the rest of the page, as getters (a binding the page
 * reassigns is read live):
 * `aircraft`, `AUDIO_OFF`, `bust`, `camera`, `car`, `currentDir`,
 * `currentRoot`, `effectAudio`, `ensureHandFireBus`, `extras`,
 * `handFireBus`, `mannedGuns`, `MAPS_BASE`, `MODELS_BASE`, `occupancy`, `optPilot`,
 * `optSound`, `optSoundVol`, `scene`, `soldier`, `vehicleGuns`, `view`,
 * `weaponSoundsManifest`.
 */
export function createPageAudio(page) {
  const pageAudio = {};

  pageAudio.audioListener = null;
  pageAudio.audioLoader = null;
  pageAudio.ambientAudio = null;
  pageAudio.activeAreaAudios = [];
  const audioBufferCache = new Map();
  // Bumped by disposeSounds; an async setupSounds captures the value after its
  // own dispose and bails if a later dispose/setup has superseded it, so a
  // rapid map switch can never leak a loop that dispose can't reach.
  pageAudio.soundsGeneration = 0;

  /** The master limiter, installed by `ensureListener` below. */
  pageAudio.audioLimiter = null;

  /**
   * The one AudioListener every player on this page hangs off, with a limiter
   * between it and the speakers.
   *
   * The limiter is why the buses can play the `.ssc` mix at the volumes it
   * writes. Web Audio sums into the destination and clips flat there, so before
   * this the engine and weapon buses each carried a fixed divisor to keep the
   * worst case under full scale — and paid for it everywhere else: a Sherman
   * idling, from inside, peaked at 0.089 against the BAR's 0.596 and the map's
   * own wind at 0.0156, while the same tank's cannon still came out at 1.75 and
   * clipped anyway. A single divisor cannot do both jobs; a limiter does the
   * one job it was ever really for, and only when a sound actually asks for
   * more than the output has.
   *
   * Set as a limiter rather than a compressor: `knee 0` and `ratio 20` make it
   * flat below the threshold and a ceiling above it, so nothing under -1 dBFS
   * is touched at all. The 3 ms attack catches a cannon's own transient; the
   * 150 ms release is long enough not to pump the ambient bed between rounds of
   * a machine gun and short enough to let go before the next shot.
   */
  function ensureListener() {
    if (page.AUDIO_OFF) return null;
    if (!pageAudio.audioListener) {
      pageAudio.audioListener = new THREE.AudioListener();
      page.camera.add(pageAudio.audioListener);
      pageAudio.audioLoader = new THREE.AudioLoader();
      const ctx = pageAudio.audioListener.context;
      try {
        const limiter = ctx.createDynamicsCompressor();
        limiter.threshold.value = -1;
        limiter.knee.value = 0;
        limiter.ratio.value = 20;
        limiter.attack.value = 0.003;
        limiter.release.value = 0.15;
        // three parents the listener's gain straight onto the destination in
        // its constructor; this re-routes that one edge and nothing else, so
        // every player that asks for `getInput()` still finds the same node.
        pageAudio.audioListener.gain.disconnect();
        pageAudio.audioListener.gain.connect(limiter);
        limiter.connect(ctx.destination);
        pageAudio.audioLimiter = limiter;
      } catch {
        // A context with no compressor node is still a context: the graph keeps
        // its direct edge and the mix simply clips the way it used to.
        pageAudio.audioListener.gain.connect(ctx.destination);
      }
    }
    return pageAudio.audioListener;
  }

  function ensureAudioContext() {
    if (!ensureListener()) return;
    // Autoplay policy: a context created before any click starts suspended and
    // stays that way until a gesture resumes it. Every caller of this is a real
    // user gesture; the catch is for the ones that are not.
    if (pageAudio.audioListener.context && pageAudio.audioListener.context.state === 'suspended') {
      pageAudio.audioListener.context.resume().catch(() => {});
    }
  }

  /**
   * Decoded wav, cached on the un-busted path.
   *
   * The cache key must not carry `bust()`: with it, the dev origin re-keyed and
   * re-decoded the same wav on every call, and the sequential decode stagger
   * started identical loops 50-200 ms apart — a permanent slapback echo. bust()
   * stays on the fetch URL only. Ambient, area and engine sound all come through
   * here so the one-decode-per-wav rule holds across all three.
   */
  async function soundBuffer(dir, relPath) {
    if (page.AUDIO_OFF) return null;
    const key = `${dir}/${relPath}`;
    if (audioBufferCache.has(key)) return audioBufferCache.get(key);
    ensureListener();
    // The pending decode is what goes in the cache, not just the finished
    // buffer. Two setups that overlap — the pilot box ticked, unticked and
    // ticked again while the first load is still awaiting — otherwise both miss
    // and fetch the same wav twice, which is the one-decode-per-wav rule the
    // hall-echo postmortem left behind (features/bf1942-3d-models/map-sounds.md).
    // A failed load drops out of the cache again so a later attempt can retry.
    const pending = pageAudio.audioLoader.loadAsync(`${page.MAPS_BASE}/${key}${page.bust()}`)
      .catch(e => {
        console.warn(`Could not load sound ${key}:`, e);
        audioBufferCache.delete(key);
        return null;
      });
    audioBufferCache.set(key, pending);
    return pending;
  }

  /**
   * Same cache, models tree: the hand-weapon fire samples live under
   * `models/sounds/`, not in any map directory. The `models:` prefix keeps the
   * key out of the `${dir}/${relPath}` namespace above — a map directory cannot
   * contain a colon, so the two families can never collide in the cache.
   */
  async function modelSoundBuffer(relPath) {
    if (page.AUDIO_OFF) return null;
    const key = `models:${relPath}`;
    if (audioBufferCache.has(key)) return audioBufferCache.get(key);
    ensureListener();
    // The pending decode, for the reason soundBuffer gives above.
    const pending = pageAudio.audioLoader.loadAsync(`${page.MODELS_BASE}/${relPath}${page.bust()}`)
      .catch(e => {
        console.warn(`Could not load sound ${key}:`, e);
        audioBufferCache.delete(key);
        return null;
      });
    audioBufferCache.set(key, pending);
    return pending;
  }

  function disposeSounds() {
    pageAudio.soundsGeneration++;
    disposeEngineAudio();
    // Bots' gunfire goes with the level too, but not with a single wreck:
    // `killOccupantInWreck` also runs `disposeEngineAudio`, and a bot's rifle
    // must outlive the player's own hull.
    pageAudio.worldFire?.dispose();
    pageAudio.worldFire = null;
    // Every pooled effect voice, armed latch and looping wreck fire, gone —
    // called from both of `show()`'s own teardown points (directly, and again
    // through `setupSounds`), so a level change is the one place the whole
    // pool is guaranteed to hit zero committed voices, whatever handle chain
    // did or did not run for the level being left. `silence()` keeps the pool
    // itself — its scripts, its decoded buffers — so the next level's impacts
    // do not re-decode anything.
    page.effectAudio.silence();
    if (pageAudio.ambientAudio) {
      try {
        if (pageAudio.ambientAudio.isPlaying) pageAudio.ambientAudio.stop();
        pageAudio.ambientAudio.disconnect();
      } catch (_) {}
      pageAudio.ambientAudio = null;
    }
    for (const item of pageAudio.activeAreaAudios) {
      try {
        if (item.sound.isPlaying) item.sound.stop();
        item.sound.disconnect();
        if (item.anchor) page.scene.remove(item.anchor);
      } catch (_) {}
    }
    pageAudio.activeAreaAudios = [];
  }

  // A depot's give sound, once `setupSounds` has pulled it out of the ambience:
  // the decoded sample and the context time its last play runs until.
  pageAudio.supplyGive = null;
  const _depotPos = new THREE.Vector3();

  /** Where this level's SupplyDepot nodes stand, for telling a depot's give
   *  sound from real building ambience. One walk per level load. */
  function supplyDepotPositions() {
    const out = [];
    page.currentRoot?.traverse(obj => {
      if (obj.userData?.templateKind !== 'SupplyDepot') return;
      obj.getWorldPosition(_depotPos);
      out.push({ x: _depotPos.x, z: _depotPos.z });
    });
    return out;
  }

  /** The refill report: one pass of the sample per give that gave something,
   *  never stacked on a pass still sounding. */
  function playSupplyGive() {
    if (!pageAudio.supplyGive || !pageAudio.audioListener || masterVolume() <= 0) return;
    const ctx = pageAudio.audioListener.context;
    if (ctx.state !== 'running' || ctx.currentTime < pageAudio.supplyGive.until) return;
    const source = ctx.createBufferSource();
    source.buffer = pageAudio.supplyGive.buffer;
    source.connect(page.ensureHandFireBus(ctx));
    source.onended = () => { try { source.disconnect(); } catch (_) {} };
    try { source.start(); } catch (_) { return; }
    pageAudio.supplyGive.until = ctx.currentTime + pageAudio.supplyGive.buffer.duration;
  }

  async function setupSounds(report, dir) {
    disposeSounds();
    const gen = pageAudio.soundsGeneration;
    const cfg = report.sounds;
    if (!cfg || page.AUDIO_OFF) return;

    ensureListener();
    const getBuffer = (relPath) => soundBuffer(dir, relPath);

    // Ambient atmospheric sound
    if (cfg.ambient && cfg.ambient.file) {
      const buf = await getBuffer(cfg.ambient.file);
      if (gen !== pageAudio.soundsGeneration) return;
      if (buf) {
        pageAudio.ambientAudio = new THREE.Audio(pageAudio.audioListener);
        pageAudio.ambientAudio.setBuffer(buf);
        pageAudio.ambientAudio.setLoop(true);
        const master = page.optSound.checked ? parseFloat(page.optSoundVol.value) : 0;
        pageAudio.ambientAudio.setVolume((cfg.ambient.volume ?? 0.6) * master);
        try { pageAudio.ambientAudio.play(); } catch (_) {}
      }
    }

    // Shorelines and positional area sounds. One looping voice per unique wave
    // file: several areas sharing Water_waves.wav used to get one loop each, and
    // two loops of the same sample audible at once through separate HRTF panners
    // reads as a hall echo, not louder surf. updateAudio moves the single
    // anchor to the closest point across every polyline in the group.
    // Flags join the area pool as one-point emitters. They group by file like
    // everything else, so every flag on the map shares a single looping voice
    // anchored at whichever one is nearest — which is the same reason the
    // shorelines do it, and the reason five flags do not phase against each
    // other. `flag.ssc` supplies the near/far ramp the group already honours.
    const areaList = [...(cfg.areas || [])];
    const flags = cfg.flags;
    if (flags && flags.file && flags.positions?.length) {
      for (const point of flags.positions) {
        areaList.push({
          name: 'flag',
          file: flags.file,
          points: [point],
          volume: flags.volume ?? 1.0,
          nearDistance: flags.nearDistance ?? flags.minDistance ?? 4.0,
          farDistance: flags.farDistance ?? 15.0,
        });
      }
    }

    // A SupplyDepot's sound script is its *give* sound — `Ammorefill.wav`, heard
    // while the depot is actually handing over ammunition — and every scene.json
    // extracted before the extractor learnt that ships it as building ambience:
    // one for-ever loop beside each of vanilla's 621 ammo boxes and airfield
    // depots. Those areas are taken out of the pool here, so published trees are
    // right without a re-extract, and their sample becomes `supplyGive`, played
    // from the depot's own give (`supplyTarget.refillAmmo`).
    pageAudio.supplyGive = null;
    const depotAt = supplyDepotPositions();
    const isDepotGive = area => {
      if (!/_static$/i.test(area.name || '') || area.points?.length !== 1) return false;
      if (!depotAt.length) return /ammorefill/i.test(area.file || '');
      const [x, , z] = area.points[0];
      return depotAt.some(d => (d.x - x) ** 2 + (d.z - z) ** 2 < 36);
    };
    let giveFile = null;
    for (let i = areaList.length - 1; i >= 0; i--) {
      if (!isDepotGive(areaList[i])) continue;
      giveFile = giveFile || areaList[i].file;
      areaList.splice(i, 1);
    }
    if (giveFile) {
      const buffer = await getBuffer(giveFile);
      if (gen !== pageAudio.soundsGeneration) return;
      if (buffer) pageAudio.supplyGive = { buffer, until: 0 };
    }

    if (areaList.length > 0) {
      const groups = new Map();
      for (const area of areaList) {
        if (!area.file || !area.points || area.points.length === 0) continue;
        const key = area.file.toLowerCase();
        if (!groups.has(key)) groups.set(key, { file: area.file, areas: [] });
        groups.get(key).areas.push(area);
      }

      for (const group of groups.values()) {
        const buf = await getBuffer(group.file);
        if (gen !== pageAudio.soundsGeneration) return;
        if (!buf) continue;

        const first = group.areas[0];
        const anchor = new THREE.Object3D();
        anchor.position.set(first.points[0][0], first.points[0][1], first.points[0][2]);
        page.scene.add(anchor);

        const sound = new THREE.PositionalAudio(pageAudio.audioListener);
        sound.setBuffer(buf);
        sound.setLoop(true);
        sound.setRefDistance(first.nearDistance || 40.0);
        // The manual .ssc near/far ramp in updateAudio owns distance volume
        // exclusively; rolloff 0 disables the panner's own inverse-distance
        // curve so the two attenuations don't multiply. setMaxDistance is not
        // called — it only applies to the 'linear' distance model, so it was
        // inert here anyway. HRTF panning is kept for direction.
        sound.setRolloffFactor(0);
        anchor.add(sound);

        pageAudio.activeAreaAudios.push({ anchor, sound, areas: group.areas });
        try { sound.play(); } catch (_) {}
      }
    }
    updateAudio();
  }
  /** The rack. Built once at first use; `disposeSounds` disposes it on a level
   *  change and the next claim rebuilds. */
  pageAudio.vehicleAudio = null;

  function ensureVehicleAudio() {
    if (pageAudio.vehicleAudio && !pageAudio.vehicleAudio.disposed) return pageAudio.vehicleAudio;
    pageAudio.vehicleAudio = new VehicleAudioRack({
      listener: () => ensureListener(),
      getBuffer: (dir, relPath) => soundBuffer(dir, relPath),
      report: () => page.extras ?? null,
      dir: () => page.currentDir,
      master: () => masterVolume(),
    });
    return pageAudio.vehicleAudio;
  }

  /** A seat came aboard a hull (the player's mount, or a bot's). */
  function claimVehicleAudio(seatKey, node, drive, groups) {
    if (page.AUDIO_OFF || !node) return;
    ensureAudioContext();
    const rack = ensureVehicleAudio();
    rack.claim({
      seatKey,
      node,
      template: node.userData?.control || node.name,
      drive: drive ?? null,
      groups: groups ?? [],
    });
  }

  /** A seat left. The hull keeps sounding while anyone remains aboard. */
  function releaseVehicleAudio(seatKey, node) {
    pageAudio.vehicleAudio?.releaseClaim(seatKey, node);
  }

  function disposeEngineAudio() {
    pageAudio.vehicleAudio?.dispose();
    pageAudio.vehicleAudio = null;
  }

  /**
   * Gunfire from anyone who is not the player's own first-person ear.
   *
   * `playHandFire` stays the shooter's path (one muzzle pick, 2D, at the
   * shoulder). A bot across the field needs the whole fire patch — the near and
   * far layers hand over on `Volume <- Distance` — spatialised at the shooter,
   * which is what `world-fire.js` plays out of the `layers` the weapon
   * extractor now ships beside the first-person pick. Built lazily off the same
   * `weapons.json` the hand path already fetches.
   */
  pageAudio.worldFire = null;

  async function ensureWorldFire() {
    if (pageAudio.worldFire && !pageAudio.worldFire.disposed) return pageAudio.worldFire;
    if (page.AUDIO_OFF) return null;
    const manifest = await page.weaponSoundsManifest();
    if (!manifest) return null;
    if (pageAudio.worldFire && !pageAudio.worldFire.disposed) return pageAudio.worldFire;
    ensureAudioContext();
    pageAudio.worldFire = new WorldFire({
      listener: () => ensureListener(),
      getBuffer: (relPath) => modelSoundBuffer(relPath.startsWith('sounds/')
        ? relPath : `sounds/${relPath}`),
      manifest,
      master: () => masterVolume(),
    });
    return pageAudio.worldFire;
  }

  /** One round from a bot's hand weapon, at the bot. Fire-and-forget. */
  function playWorldShot(weaponName, x, y, z) {
    if (!weaponName || page.AUDIO_OFF) return;
    ensureWorldFire().then(fire => {
      fire?.play(weaponName, { x, y, z });
    });
  }

  function masterVolume() {
    return page.optSound.checked ? parseFloat(page.optSoundVol.value) : 0;
  }

  // Sitting in a vehicle, its engine is essentially all you can hear — the map's
  // wind and surf do not compete with a radial a metre in front of your knees.
  // Ducking the ambience is how to get there. It used to be the ONLY way to get
  // there, because the engine bus was pinned at a divisor fitted to a Corsair;
  // it no longer is (`engine-audio.js`'s `BUS_HEADROOM`, and the limiter in
  // `ensureListener`), and the duck is now what it says it is rather than a way
  // round a mix that could not be turned up. Eased rather than switched, or
  // entering and leaving the cockpit pops.
  const AMBIENT_DUCK = 0.12;
  const AMBIENT_DUCK_TAU = 0.4;
  pageAudio.ambientDuck = 1;
  const _ear = new THREE.Vector3();
  const _facing = new THREE.Vector3();

  /** The seat the listener's camera belongs to, for the rack's
   *  `setAttachToListener` test (SND-2): the hull, the PlayerControlObject
   *  the player sits in, and whether the view is the Inside one (mode 3). */
  function listenerSeat() {
    const seat = page.occupancy;
    const view = page.view;
    if (!seat || !view) return null;
    return { root: seat.root, rootId: seat.rootId, seatId: seat.activeSeatId, inside: !!view.inside };
  }

  function updateAudio(dt = 0) {
    const master = masterVolume();
    const duckTarget = (page.optPilot.checked && (page.aircraft || page.car)) ? AMBIENT_DUCK : 1;
    pageAudio.ambientDuck += (duckTarget - pageAudio.ambientDuck)
      * (dt > 0 ? Math.min(1, dt / AMBIENT_DUCK_TAU) : 1);
    // The listener is the camera (the client's own rule, SND-5: 0x00537390
    // places DirectSound's listener on the local player's camera transform).
    const ear = page.camera.getWorldPosition(_ear);
    const facing = page.camera.getWorldDirection(_facing);
    // Every claimed hull at once: the player's own, and every bot-driven one
    // within earshot. The rack holds the far ones at master 0 and evaluates
    // each patch's own `Volume <- Distance` ramps against the camera.
    if (pageAudio.vehicleAudio) {
      pageAudio.vehicleAudio.playerGroups = [...(page.vehicleGuns ?? []), ...(page.mannedGuns ?? [])];
      pageAudio.vehicleAudio.listenerSeat = listenerSeat();
      pageAudio.vehicleAudio.update(dt, ear, facing);
    }
    // Bots' rounds: every pooled patch measured from the camera, and its clock
    // run, which is what brings a round's delayed layers due (bug A).
    pageAudio.worldFire?.update(dt, ear, facing);
    if (page.handFireBus) {
      // The hand-shot bus tracks the master like the engine bus does, and is
      // deliberately not ducked: the duck exists so a cockpit engine drowns the
      // surf, and the weapon at your own shoulder is the one thing louder.
      const target = master * WEAPON_HEADROOM;
      if (Math.abs(page.handFireBus.gain.value - target) > 1e-4) {
        page.handFireBus.gain.setTargetAtTime(
          target, pageAudio.audioListener.context.currentTime, 0.05);
      }
    }
    if (pageAudio.ambientAudio) {
      const base = page.extras.sounds?.ambient?.volume ?? 0.6;
      pageAudio.ambientAudio.setVolume(base * master * pageAudio.ambientDuck);
    }

    if (pageAudio.activeAreaAudios.length === 0) return;

    const camPos = page.camera.position;
    for (const item of pageAudio.activeAreaAudios) {
      // Closest point to the camera across every polyline in the group; the
      // area that produced it supplies the near/far ramp and base volume.
      let bestArea = item.areas[0];
      let bx = bestArea.points[0][0], by = bestArea.points[0][1], bz = bestArea.points[0][2];
      let minD2 = Infinity;

      for (const area of item.areas) {
        const pts = area.points;
        if (pts.length === 1) {
          const dist2 = (camPos.x - pts[0][0]) ** 2 + (camPos.y - pts[0][1]) ** 2 + (camPos.z - pts[0][2]) ** 2;
          if (dist2 < minD2) {
            minD2 = dist2;
            bx = pts[0][0]; by = pts[0][1]; bz = pts[0][2];
            bestArea = area;
          }
          continue;
        }
        for (let i = 0; i < pts.length - 1; i++) {
          const p1 = pts[i];
          const p2 = pts[i + 1];
          const dx = p2[0] - p1[0];
          const dy = p2[1] - p1[1];
          const dz = p2[2] - p1[2];
          const len2 = dx * dx + dy * dy + dz * dz;
          let t = len2 > 0 ? ((camPos.x - p1[0]) * dx + (camPos.y - p1[1]) * dy + (camPos.z - p1[2]) * dz) / len2 : 0;
          if (t < 0) t = 0;
          else if (t > 1) t = 1;
          const qx = p1[0] + t * dx;
          const qy = p1[1] + t * dy;
          const qz = p1[2] + t * dz;
          const dist2 = (camPos.x - qx) ** 2 + (camPos.y - qy) ** 2 + (camPos.z - qz) ** 2;
          if (dist2 < minD2) {
            minD2 = dist2;
            bx = qx; by = qy; bz = qz;
            bestArea = area;
          }
        }
      }

      item.anchor.position.set(bx, by, bz);

      const dist = Math.sqrt(minD2);
      const near = bestArea.nearDistance || 40.0;
      const far = bestArea.farDistance || 80.0;
      let ramp = 0.0;
      if (dist <= near) {
        ramp = 1.0;
      } else if (dist < far) {
        const denom = Math.max(far - near, 0.001);
        ramp = 1.0 - (dist - near) / denom;
      }
      item.sound.setVolume((bestArea.volume ?? 0.6) * ramp * master * pageAudio.ambientDuck);
    }
  }

  /**
   * A bot's own bootfalls, for a listener who is not wearing them.
   *
   * The player's steps come off `soldier.drainFootstepEvents()`, a clock in the
   * first-person soldier. A bot has no such body, so the cadence is driven here
   * from how far the controller actually moved. The periods are the engine's,
   * verbatim from `Objects/Soldiers/Common/Sounds/SoldierSound.inc`:
   * `setRunFrequency 0.36`, `setWalkFrequency 0.66` (the crawl's 0.6 and the
   * crouch's 0.50 are not distinguished here — a bot's gait is its speed).
   * Positional, so a squad crossing a field is a line of small boots rather
   * than one 2D overlay; `handleSoldierFootstep` does the surface pick.
   */
  const BOT_GAIT_RUN = 0.36;
  const BOT_GAIT_WALK = 0.66;
  function botFootstepTick(bot, dt) {
    if (bot.vehicle || page.AUDIO_OFF || masterVolume() <= 0) return;
    const at = bot.getPosition();
    const prev = bot._stepFrom;
    bot._stepFrom = [at[0], at[1], at[2]];
    if (!prev) return;
    const dx = at[0] - prev[0], dy = at[1] - prev[1], dz = at[2] - prev[2];
    const speed = Math.hypot(dx, dy, dz) / Math.max(dt, 1e-6);
    if (speed < 0.4) { bot._stepPhase = 0; return; }
    const period = speed > 3 ? BOT_GAIT_RUN : BOT_GAIT_WALK;
    bot._stepPhase = (bot._stepPhase ?? Math.random()) + dt / period;
    if (bot._stepPhase < 1) return;
    bot._stepPhase -= 1;
    handleSoldierFootstep(
      { x: at[0], y: at[1], z: at[2], gait: speed > 3 ? 'run' : 'walk' },
      { x: at[0], y: at[1], z: at[2] });
  }

  // --- soldier footsteps, damage direction & hurt audio ------------------------

  pageAudio.soldierSoundsIndex = null;
  pageAudio.lastHurtSoundTime = 0;
  pageAudio.lastWorldHurtSoundTime = 0;

  function soldierSoundsManifest() {
    if (!pageAudio.soldierSoundsIndex) {
      pageAudio.soldierSoundsIndex = fetch(`${page.MODELS_BASE}/sounds/soldier.json${page.bust()}`)
        .then(r => (r.ok ? r.json() : null))
        .catch(() => null)
        .then(doc => { if (!doc) pageAudio.soldierSoundsIndex = null; return doc; });
    }
    return pageAudio.soldierSoundsIndex;
  }

  /**
   * One soldier sample. `position` is world space when the sound belongs to
   * someone other than the listener's own body — a bot's footstep or his hurt
   * grunt. Omitted (or null) is the first-person ear: 2D, at the shoulder, the
   * way the player's own feet have always played. The soldier manifest carries
   * no `Volume <- Distance` ramps (it is foley, not a sound script), so a
   * positional voice takes the panner's own inverse curve with a 1 m reference
   * and a 40 m cut, which is the band a boot actually reaches across.
   */
  function playSoldierOneShot(buffer, volume = 1, pitchJitter = 0.03, delay = 0,
                              position = null) {
    if (!buffer || !pageAudio.audioListener || masterVolume() <= 0) return;
    const ctx = pageAudio.audioListener.context;
    if (ctx.state === 'suspended') return;
    if (position) {
      // Beyond the panner's own 40 m cut a bot's foley is ~-32 dB; skip the
      // voice entirely. Twelve bots walking was a hundred one-shot panners a
      // second, most of them built for nobody.
      const e = pageAudio.audioListener.matrixWorld?.elements;
      if (e) {
        const dx = e[12] - position.x, dy = e[13] - position.y, dz = e[14] - position.z;
        if (dx * dx + dy * dy + dz * dz > 1600) return;
      }
    }
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    if (pitchJitter > 0) {
      source.playbackRate.value = 1 + (Math.random() * 2 - 1) * pitchJitter;
    }
    const gain = ctx.createGain();
    gain.gain.value = Math.min(Math.max(volume, 0), 1) * masterVolume() * WEAPON_HEADROOM;
    source.connect(gain);
    let panner = null;
    if (position) {
      panner = ctx.createPanner();
      panner.panningModel = 'HRTF';
      panner.distanceModel = 'inverse';
      panner.refDistance = 1;
      panner.maxDistance = 40;
      panner.rolloffFactor = 1;
      panner.positionX.value = position.x;
      panner.positionY.value = position.y;
      panner.positionZ.value = position.z;
      gain.connect(panner);
    }
    (panner ?? gain).connect(pageAudio.audioListener.getInput());
    source.onended = () => {
      try {
        source.disconnect();
        gain.disconnect();
        panner?.disconnect();
      } catch (_) {}
    };
    const when = delay > 0 ? ctx.currentTime + delay : 0;
    try { source.start(when); } catch (_) {}
  }

  // The footstep's own cast record, reused. It used to borrow the soldier's
  // (`soldier._hit`), which soldier.js fills for its own casts.
  const footstepHit = {
    t: 0, x: 0, y: 0, z: 0, nx: 0, ny: 1, nz: 0,
    dx: 0, dy: -1, dz: 0, material: 0, kind: '', owner: -1, triangle: -1,
  };

  async function handleSoldierFootstep(step, position = null) {
    if (page.AUDIO_OFF || masterVolume() <= 0) return;
    const manifest = await soldierSoundsManifest();
    if (!manifest) return;

    let matId = 0;
    const collider = page.soldier?.collider;
    if (collider) {
      let onStatic = false;
      let best = -Infinity;
      if (collider.statics) {
        const record = footstepHit;
        record.dx = 0; record.dy = -1; record.dz = 0;
        const hit = collider.statics.cast(step.x, step.y + 0.5, step.z, 0, -1, 0, 1.0, -1, record);
        if (hit) {
          best = hit.y;
          matId = hit.material;
          onStatic = true;
        }
      }
      const ground = collider.surfaceHeight ? collider.surfaceHeight(step.x, step.z) : NaN;
      if (!onStatic || (Number.isFinite(ground) && ground >= best)) {
        matId = collider.heightfield?.material ? collider.heightfield.material(step.x, step.z) : 0;
      }
    }

    const matName = footstepMaterial(matId);
    const triggerName = step.gait === 'run' ? 'c_SstRun' : 'c_SstWalk';
    const trigger = manifest.triggers?.[triggerName];
    if (!trigger?.patches) return;

    const surfacePatch = trigger.patches.find(p => p.material === matName) || trigger.patches[0];
    if (surfacePatch?.layers?.length) {
      const choice = surfacePatch.layers[Math.floor(Math.random() * surfacePatch.layers.length)];
      const buf = await modelSoundBuffer(`sounds/${choice.sample}.mp3`);
      if (buf) playSoldierOneShot(buf, choice.volume ?? 1, 0.03, 0, position);
    }

    const fabricPatch = trigger.patches.find(p => p.material === 'fabric');
    if (fabricPatch?.layers?.length) {
      const choice = fabricPatch.layers[Math.floor(Math.random() * fabricPatch.layers.length)];
      const buf = await modelSoundBuffer(`sounds/${choice.sample}.mp3`);
      if (buf) playSoldierOneShot(buf, (choice.volume ?? 1) * 0.5, 0.03, choice.at ?? 0.2, position);
    }

    const harnessPatch = trigger.patches.find(p => p.material === 'harness');
    if (harnessPatch?.layers?.length) {
      const choice = harnessPatch.layers[Math.floor(Math.random() * harnessPatch.layers.length)];
      const buf = await modelSoundBuffer(`sounds/${choice.sample}.mp3`);
      if (buf) playSoldierOneShot(buf, (choice.volume ?? 1) * 0.4, 0.03, choice.at ?? 0.1, position);
    }
  }


  async function playSoldierHurtSound(isFriendlyFire = false, position = null) {
    if (page.AUDIO_OFF || masterVolume() <= 0) return;
    const now = performance.now() * 0.001;
    // Two cooldowns: the listener's own grunt and the world's. A shared one
    // meant a bot hit a second after the player took a round played nothing.
    const last = position ? pageAudio.lastWorldHurtSoundTime : pageAudio.lastHurtSoundTime;
    if (now - last < 0.9) return;
    if (position) pageAudio.lastWorldHurtSoundTime = now;
    else pageAudio.lastHurtSoundTime = now;

    const manifest = await soldierSoundsManifest();
    if (!manifest) return;
    const triggerName = isFriendlyFire ? 'c_SstFFHitDamage' : 'c_SstHitDamage';
    const trigger = manifest.triggers?.[triggerName];
    const patch = trigger?.patches?.[0];
    if (!patch?.layers?.length) return;
    const choice = patch.layers[Math.floor(Math.random() * patch.layers.length)];
    const buf = await modelSoundBuffer(`sounds/${choice.sample}.mp3`);
    if (buf) playSoldierOneShot(buf, choice.volume ?? 0.7, 0.05, 0, position);
  }

  Object.assign(pageAudio, {
    audioBufferCache,
    botFootstepTick,
    claimVehicleAudio,
    disposeEngineAudio,
    disposeSounds,
    ensureAudioContext,
    ensureListener,
    ensureWorldFire,
    handleSoldierFootstep,
    masterVolume,
    modelSoundBuffer,
    playSoldierHurtSound,
    playSoldierOneShot,
    playSupplyGive,
    playWorldShot,
    releaseVehicleAudio,
    setupSounds,
    soundBuffer,
    updateAudio,
  });
  return pageAudio;
}
