// The page's sound: the listener and its limiter, the level's ambience and
// area sounds, the sound buffers, the vehicle audio rack every occupied hull
// claims a voice in, the world's gunfire for anyone not at the player's own
// shoulder, the soldiers' footsteps, grunts and the hit indicator, and the
// mix (`updateAudio`). Lifted out of map.html (features/vehicle-instance-
// refactor Part 2); `engine-audio.js`, `vehicle-audio.js`, `world-fire.js` and
// `effect-audio.js` stay the voices.

import * as THREE from 'three';
import { WEAPON_HEADROOM, distanceRolloff } from './engine-audio.js';
import { modulate } from './ssc-curves.js';
import { configureDs3dPanner, standDs3dPanner } from './ds3d-pan.js';
import { VehicleAudioRack } from './vehicle-audio.js';
import { WorldFire } from './world-fire.js';
import { footstepMaterial } from './collision-materials.js';
import { emitterAt, isBed, loudestEmitter } from './area-sound.js';
import { environmentPlays, scriptVolume } from './environment-sound.js';
import { entryInMode } from './game-modes.js';
import { ScrapeVoices } from './obstacle.js';
import { nationStems } from './radio.js';
import { decodeGapless, gaplessAudioLoader } from './gapless-decode.js';
import { createVoiceGates } from './soldier-voice-gates.js';
import {
  MATERIAL_PATCH, SST, SoldierSound, SoldierSoundState, VANILLA_FREQUENCIES,
  distanceGain, triggerName, triggerOfState,
} from './soldier-sound.js';
import { voiceKind, voicePoolOf } from './voice-pool.js';

/** `SoldierRefillAmmo.ssc`'s HIGH patch, as read from vanilla's Objects.rfa:
 *  `minDistance 5` and the `Volume <- Distance` ramp `10 15 1 -1`. */
export const REFILL_MIN_DISTANCE = 5;
export const REFILL_DISTANCE_RAMP = [10, 15, 1, -1];

/** The refill one-shot's level at `distance` metres: the script's distance
 *  ramp times DirectSound's `min(1, minDistance / d)` (ledger SND-6). */
export function refillVolumeAt(distance) {
  const ramp = modulate([{ source: 'distance', envelope: 'ramp', params: REFILL_DISTANCE_RAMP }],
    { distance }, 1);
  return ramp * distanceRolloff(distance, REFILL_MIN_DISTANCE);
}

/** A place a panner can take: Web Audio throws on a position that is not all
 *  numbers, and a one-shot at no position is better not played than a frame
 *  that stops (a replayed man whose record is broken, a camera that is). */
const placeable = p => Number.isFinite(p?.x) && Number.isFinite(p?.y) && Number.isFinite(p?.z);

/**
 * Built once by the page, where this code used to sit. `page` hands in
 * what it reads of the rest of the page, as getters (a binding the page
 * reassigns is read live):
 * `AUDIO_OFF`, `audioLatencyHint` (null, or the context's `latencyHint`), `bust`, `camera`, `currentDir`,
 * `currentRoot`, `deployTeamId`, `effectAudio`, `ensureHandFireBus`, `extras`, `fireStates`,
 * `handFireBus`, `mannedGuns`, `MAPS_BASE`, `MODELS_BASE`, `occupancy`,
 * `scene`, `soldier`, `soundMaster` (OPTIONS > SOUND's MASTER VOLUME and
 * DISABLE ALL SOUNDS as one 0..1 gain, `sound-options.js`), `teamNation`, `vehicleGuns`,
 * `view`, `weaponSoundsManifest`.
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
      // A phone replay's context is made with a larger output buffer
      // (`replay-phone.js` `audioLatencyHint`). This is the first place the
      // page makes three's shared context, so it is set before anything asks.
      if (page.audioLatencyHint != null) {
        try {
          const Ctor = globalThis.AudioContext ?? globalThis.webkitAudioContext;
          THREE.AudioContext.setContext(new Ctor({ latencyHint: page.audioLatencyHint }));
        } catch (e) {
          console.warn('page audio: the default latency, as this browser refused', page.audioLatencyHint, e);
        }
      }
      pageAudio.audioListener = new THREE.AudioListener();
      page.camera.add(pageAudio.audioListener);
      // Not three's `AudioLoader`: a browser that ignores an MP3's gapless
      // header (Safari) hands back the encoder's padding with the samples,
      // and the heartbeat's loop wrapped through it (`gapless-decode.js`).
      const listener = pageAudio.audioListener;
      pageAudio.audioLoader = gaplessAudioLoader(() => listener.context);
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
    const t0 = performance.now();
    pendingLoads.set(key, t0);
    const pending = fetchAndDecode(key, `${page.MAPS_BASE}/${key}${page.bust()}`)
      .catch(e => {
        console.warn(`Could not load sound ${key}:`, e);
        // Only this load's own entry: a forgotten one may already have been
        // replaced by the retry's, which must stay the one decode of it.
        if (audioBufferCache.get(key) === pending) audioBufferCache.delete(key);
        return null;
      })
      .finally(() => { if (pendingLoads.get(key) === t0) pendingLoads.delete(key); });
    audioBufferCache.set(key, pending);
    return pending;
  }

  /**
   * One sample, fetched and decoded on the listener's context. Not three's
   * `AudioLoader`: its `FileLoader` shares one in-flight request between
   * every ask for the same URL, and with no cache-bust (any origin but the
   * dev one) a retry after a stalled request joined that same request and
   * stalled with it. This one can be aborted (`forgetSound`).
   */
  const loadControllers = new Map();
  async function fetchAndDecode(key, url) {
    const ctl = typeof AbortController === 'function' ? new AbortController() : null;
    if (ctl) loadControllers.set(key, ctl);
    try {
      const reply = await fetch(url, ctl ? { signal: ctl.signal } : undefined);
      if (!reply.ok) throw new Error(`HTTP ${reply.status} for ${url}`);
      const bytes = await reply.arrayBuffer();
      const ctx = ensureListener()?.context ?? THREE.AudioContext.getContext();
      // Cut to the wav's own frames: a loop wraps at the buffer's end, and a
      // buffer Safari left carrying the MP3 encoder's padding put 30 to 50 ms
      // of near-silence into every pass of every loop (`gapless-decode.js`).
      return await decodeGapless(ctx, bytes);
    } finally {
      if (ctl && loadControllers.get(key) === ctl) loadControllers.delete(key);
    }
  }

  /** Drop a load that is taking too long from the cache, so the next ask
   *  starts a fresh request; the stalled one is aborted. */
  function forgetSound(key) {
    audioBufferCache.delete(key);
    pendingLoads.delete(key);
    const ctl = loadControllers.get(key);
    loadControllers.delete(key);
    try { ctl?.abort(); } catch { /* a nicety */ }
  }

  const pendingLoads = new Map();
  /** Loads still in flight, oldest first: `[{ key, ms }]`. */
  pageAudio.pendingSounds = () => [...pendingLoads]
    .map(([key, t0]) => ({ key, ms: Math.round(performance.now() - t0) }));

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
    const pending = fetchAndDecode(key, `${page.MODELS_BASE}/${relPath}${page.bust()}`)
      .catch(e => {
        console.warn(`Could not load sound ${key}:`, e);
        // Only this load's own entry: a forgotten one may already have been
        // replaced by the retry's, which must stay the one decode of it.
        if (audioBufferCache.get(key) === pending) audioBufferCache.delete(key);
        return null;
      });
    audioBufferCache.set(key, pending);
    return pending;
  }

  function disposeSounds() {
    pageAudio.soundsGeneration++;
    disposeEngineAudio();
    // Bots' gunfire goes with the level too, but not with a single wreck:
    // `killOccupantInWreck` cuts only its own hull (`cutVehicleAudio`), and a
    // bot's rifle must outlive the player's own hull.
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
    pageAudio.scrape = null;
  }

  // --- barbed wire's scrape ------------------------------------------------
  //
  // `e_Barbwire.ssc`, the one-shot a wire's `e_Barbwire` child plays when the
  // wire is messaged: by a soldier's or a vehicle's contact
  // (`BFSoldier::handleCollision` 0x0827d3b0, `PlayerControlObject::
  // handleCollision` 0x08318b00; `obstacle.js`). The level ships it as a
  // one-point, non-looping static script per wire (`<template>_static`),
  // which `setupSounds` keeps out of the bed pool and hands to this instead.
  // `randomPlay 1` picks one of its samples each play; `randomStartPitch`
  // jitters the rate; volume, `minDistance` and the 3..4 m `Volume <-
  // Distance` ramp are `area-sound.js`'s `emitterAt`, the same law the beds
  // use. One voice per wire at a time (`ScrapeVoices`, INFERRED; the .ssc rule).
  pageAudio.scrape = null;
  /** Wires matched to their script, by obstacle id: area or null. */
  const scrapeAreaOf = new Map();
  /** A one-shot static script whose point is within this of the wire's
   *  origin is that wire's (the extractor puts it there, plus the sample's
   *  own `relativePosition` height, which barbed wire does not set). */
  const SCRAPE_MATCH = 0.5;

  function scrapeAreaFor(ev) {
    const scrape = pageAudio.scrape;
    if (!scrape) return null;
    if (scrapeAreaOf.has(ev.id)) return scrapeAreaOf.get(ev.id);
    const o = ev.origin ?? [ev.x, ev.y, ev.z];
    let best = null;
    let bestD = SCRAPE_MATCH * SCRAPE_MATCH;
    for (const area of scrape.areas) {
      const [x, y, z] = area.points[0];
      const d = (x - o[0]) ** 2 + (y - o[1]) ** 2 + (z - o[2]) ** 2;
      if (d <= bestD) { bestD = d; best = area; }
    }
    scrapeAreaOf.set(ev.id, best);
    return best;
  }

  /**
   * One message to a wire (a `report.obstacles` entry of the world's step):
   * start its scrape unless its last one is still sounding. Returns whether
   * a voice started, for the test hook.
   */
  function playObstacleScrape(ev) {
    const scrape = pageAudio.scrape;
    if (!scrape || !ev || page.AUDIO_OFF || !pageAudio.audioListener) return false;
    const ctx = pageAudio.audioListener.context;
    const area = scrapeAreaFor(ev);
    if (!area) return false;
    const files = Array.isArray(area.randomPlay) && area.randomPlay.length
      ? area.randomPlay : [area.file];
    const file = files[Math.floor(Math.random() * files.length)];
    const buffer = scrape.buffers.get(file);
    if (!buffer) return false;
    const [up = 0, down = 0] = area.randomStartPitch || [];
    const rate = 1 + (Math.random() * (up + down) - down);
    const now = ctx.currentTime;
    if (!scrape.voices.touch(ev.id, now, buffer.duration / rate)) return false;
    scrape.started++;
    if (ctx.state !== 'running' || masterVolume() <= 0) return true;
    const e = pageAudio.audioListener.matrixWorld?.elements;
    const ear = e ? { x: e[12], y: e[13], z: e[14] } : { x: 0, y: 0, z: 0 };
    const at = emitterAt(area, ear);
    if (!at || !(at.gain > 0) || !placeable(at)) return true;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = rate;
    const gain = ctx.createGain();
    gain.gain.value = at.gain * masterVolume();
    const panner = ctx.createPanner();
    // `emitterAt` owns the distance law, as it does for the beds.
    panner.distanceModel = 'linear';
    panner.rolloffFactor = 0;
    standDs3dPanner(panner, e, at.x, at.y, at.z);
    source.connect(gain);
    gain.connect(panner);
    panner.connect(pageAudio.audioListener.getInput());
    source.onended = () => {
      try { source.disconnect(); gain.disconnect(); panner.disconnect(); } catch (_) {}
    };
    try { source.start(); } catch (_) {}
    return true;
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

  /**
   * `SoldierRefillAmmo.ssc`: a soldier's own refill, which his client plays
   * when a depot resupplies him (`BFSoldier::triggerRefillAmmoSound`, lnxded
   * 0x0827ebc0, told by SpecialGameEvent 0), played for a replayed player at
   * `position` (replay.js). The script's HIGH patch (vanilla
   * `Objects/Soldiers/Common/Sounds/SoldierRefillAmmo.ssc`, read 2026-11-12):
   * `Ammorefill.wav`, `minDistance 5`, a 5 % pitch jitter, and a `Volume <-
   * Distance` ramp `10 15 1 -1` (full to 10 m, gone at 15 m). On top of the
   * ramp the voice falls off as DirectSound's `min(1, 5 / d)` like every 3D
   * voice (ledger SND-6, `distanceRolloff`): 0.5 at 10 m, 0.2 at 12.5 m. The
   * wave is the one the levels' depots ship, so a level
   * whose own depot gave it this page already holds it (`supplyGive`), and
   * any other finds it in its tree's shared sounds.
   */
  async function playRefillSound(position) {
    if (page.AUDIO_OFF || !placeable(position) || masterVolume() <= 0) return;
    ensureListener();
    const buffer = pageAudio.supplyGive?.buffer
      ?? await soundBuffer(page.currentDir, '../_shared/sounds/Ammorefill.mp3');
    const ctx = pageAudio.audioListener?.context;
    if (!buffer || !ctx || ctx.state !== 'running') return;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = 1 + (Math.random() * 2 - 1) * 0.05;
    const e = pageAudio.audioListener.matrixWorld?.elements;
    const d = e ? Math.hypot(e[12] - position.x, e[13] - position.y, e[14] - position.z) : 0;
    const level = refillVolumeAt(d);
    if (!(level > 0)) return;
    const gain = ctx.createGain();
    gain.gain.value = level * masterVolume() * WEAPON_HEADROOM;
    // The level is the script's and DirectSound's, worked out above at the
    // voice's true distance; the panner only places it (it stands at the
    // render point, not the real one), so it attenuates nothing itself.
    const panner = ctx.createPanner();
    panner.distanceModel = 'inverse';
    panner.refDistance = 1;
    panner.rolloffFactor = 0;
    standDs3dPanner(panner, e, position.x, position.y, position.z);
    source.connect(gain);
    gain.connect(panner);
    panner.connect(pageAudio.audioListener.getInput());
    source.onended = () => {
      try { source.disconnect(); gain.disconnect(); panner.disconnect(); } catch (_) {}
    };
    try { source.start(); } catch (_) {}
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
        const master = masterVolume();
        // The script's volume as the engine plays it: 0..1 (SND-27). FH writes
        // 80 on Road to Ramelle's bed, which read literally was +38 dB into
        // the limiter, and everything else on the page went down under it.
        pageAudio.ambientAudio.setVolume(
          scriptVolume(cfg.ambient.volume) * master * pageAudio.bedGate);
        try { pageAudio.ambientAudio.play(); } catch (_) {}
      }
    }

    // Shorelines and positional area sounds. One looping voice per unique wave
    // file: several areas sharing Water_waves.wav used to get one loop each, and
    // two loops of the same sample audible at once through separate panners
    // reads as a hall echo, not louder surf. updateAudio moves the single
    // anchor to whichever emitter in the group is loudest (`area-sound.js`).
    // One-shot scripts on statics (barbed wire's scrape) are events, not beds,
    // and stay out of the pool.
    // Flags join the area pool as one-point emitters. They group by file like
    // everything else, so every flag on the map shares a single looping voice
    // anchored at whichever one is nearest — which is the same reason the
    // shorelines do it, and the reason five flags do not phase against each
    // other. `flag.ssc` supplies the near/far ramp the group already honours.
    // An emitter on a static this mode does not place (its `modes` leaves the
    // mode out) went with the node in `pruneToMode`, so its sound goes too.
    const areaList = (cfg.areas || []).filter(area => entryInMode(area, report.gameplayMode));
    const flags = cfg.flags;
    if (flags && flags.file && flags.positions?.length) {
      for (const point of flags.positions) {
        areaList.push({
          name: 'flag',
          file: flags.file,
          points: [point],
          kind: 'point',
          loop: true,
          volume: flags.volume ?? 1.0,
          minDistance: flags.minDistance,
          distanceVolume: flags.distanceVolume,
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

    // The one-shot static scripts (barbed wire's scrape): events, played by
    // `playObstacleScrape` when the wire is messaged.
    scrapeAreaOf.clear();
    const scrapeAreas = areaList.filter(a => a.file && !isBed(a) && a.points?.length === 1);
    if (scrapeAreas.length) {
      const buffers = new Map();
      const files = new Set();
      for (const a of scrapeAreas) {
        files.add(a.file);
        for (const f of a.randomPlay || []) files.add(f);
      }
      for (const f of files) {
        const buf = await getBuffer(f);
        if (gen !== pageAudio.soundsGeneration) return;
        if (buf) buffers.set(f, buf);
      }
      pageAudio.scrape = { areas: scrapeAreas, buffers, voices: new ScrapeVoices(), started: 0 };
    }

    if (areaList.length > 0) {
      const groups = new Map();
      for (const area of areaList) {
        if (!area.file || !area.points || area.points.length === 0 || !isBed(area)) continue;
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
        // updateAudio owns distance volume exclusively -- DirectSound's
        // minDistance / d and the script's ramp, both from `area-sound.js` --
        // so the panner's own inverse-distance curve is off (rolloff 0) and
        // the two attenuations never multiply. The panner is kept for
        // direction, as DirectSound's amplitude pan (`ds3d-pan.js`); it
        // stands at the emitter itself, on Web Audio's equal-power curve,
        // which is a few dB wider than DirectSound's at a wide angle.
        sound.setRolloffFactor(0);
        configureDs3dPanner(sound.panner);
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

  /**
   * Every vehicle's engine and gun patches for this tree
   * (`_shared/vehicle-sounds.json`, extract_vehicle_sounds.py), as a level
   * report (`{ sounds: { vehicles } }`) whose sample paths are a level's own
   * (`../_shared/sounds/...`): what the rack falls back to for a template the
   * level's `scene.json` does not place. A round replay's server can spawn any
   * (MoonGamers' Midway: Elco80 and Type38 PT boats and their rafts,
   * Kubelwagens, Stationary MG42s, a B17), and each was silent. Fetched once
   * per tree, on first need; null where the tree has no table.
   */
  const sharedVehicleSoundsByUrl = new Map();
  function sharedVehicleSounds() {
    const url = `${page.MAPS_BASE}/_shared/vehicle-sounds.json`;
    if (!sharedVehicleSoundsByUrl.has(url)) {
      // A request that never answers is given up after 30 s and, like any
      // other failed request (not a 404, which is an answer), forgotten so
      // the next build asks again (features/vehicle-sound-coverage
      // 2026-10-28).
      const signal = globalThis.AbortSignal?.timeout?.(30000);
      sharedVehicleSoundsByUrl.set(url, fetch(`${url}${page.bust()}`, signal ? { signal } : undefined)
        .then(r => (r.ok ? r.json() : null))
        .then(doc => (Array.isArray(doc?.vehicles) ? { sounds: { vehicles: doc.vehicles } } : null))
        .catch(e => {
          console.warn('Could not load the shared vehicle sound table:', e);
          sharedVehicleSoundsByUrl.delete(url);
          return null;
        }));
    }
    return sharedVehicleSoundsByUrl.get(url);
  }

  function ensureVehicleAudio() {
    if (pageAudio.vehicleAudio && !pageAudio.vehicleAudio.disposed) return pageAudio.vehicleAudio;
    pageAudio.vehicleAudio = new VehicleAudioRack({
      listener: () => ensureListener(),
      getBuffer: (dir, relPath) => soundBuffer(dir, relPath),
      // A sample the rack's build deadline gave up on: the next build asks
      // the server again rather than awaiting the same stalled load.
      forget: (dir, relPath) => forgetSound(`${dir}/${relPath}`),
      report: () => page.extras ?? null,
      shared: () => sharedVehicleSounds(),
      dir: () => page.currentDir,
      master: () => masterVolume(),
      // A seated gun's magazine change, off its `FireState` (SND-17).
      reloadOf: node => page.fireStates?.get(node)?.reloadRemaining ?? 0,
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

  /** One destroyed hull's engine and guns, silent now; every other hull on
   *  the rack -- the bots' -- keeps its claims. */
  function cutVehicleAudio(node) {
    pageAudio.vehicleAudio?.cut(node);
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

  /** One round from a bot's hand weapon, at the bot. Fire-and-forget.
   *  `owner` stands for the shooter (the bot, a replayed soldier): his rounds
   *  share one patch and so one clock (`world-fire.js`, ledger SND-33). */
  function playWorldShot(weaponName, x, y, z, owner = null) {
    if (!weaponName || page.AUDIO_OFF) return;
    ensureWorldFire().then(fire => {
      fire?.play(weaponName, { x, y, z }, owner);
    });
  }

  /**
   * Decode `weaponName`'s samples ahead of its first round. `WorldFire.play`
   * drops a round whose weapon has no slot yet (a bot's first shot of a fight
   * is one of many); the player's own stab is one press, so `hand-weapon.js`
   * primes its report as the weapon is raised. A property of `playWorldShot`
   * so every surface that already carries the one carries the other.
   * `{ edges: false }` primes the report alone, not its Reload and eject
   * slots: the replay primes every weapon a recording fires as it opens, and
   * plays no magazine change.
   */
  playWorldShot.prime = (weaponName, { edges = true } = {}) => {
    if (!weaponName || page.AUDIO_OFF) return Promise.resolve(null);
    return ensureWorldFire().then(fire => (edges ? fire?.primeWeapon(weaponName) : fire?.prime(weaponName)) ?? null,
      () => null);
  };

  /** A bot's magazine change, at the bot: the weapon's Reload slot (SND-17). */
  function playWorldReload(weaponName, x, y, z, owner = null) {
    if (!weaponName || page.AUDIO_OFF) return;
    ensureWorldFire().then(fire => {
      fire?.playReload(weaponName, { x, y, z }, owner);
    });
  }

  /** A bot's clip leaving his rifle, at the bot: the weapon's eject slot
   *  (`FireArms::EjectClip`, ledger FA-7, SND-35). */
  function playWorldEject(weaponName, x, y, z, owner = null) {
    if (!weaponName || page.AUDIO_OFF) return;
    ensureWorldFire().then(fire => {
      fire?.playEject(weaponName, { x, y, z }, owner);
    });
  }

  // The `Default` volume group every voice of the game sits in (SND-28):
  // OPTIONS > SOUND's MASTER VOLUME, 0 with DISABLE ALL SOUNDS.
  function masterVolume() {
    return page.soundMaster();
  }

  // The wind bed sounds while the player is on foot or in a seat that is
  // outside (a jeep, a hatch gun), and is released in any other seat: the
  // client's own per-frame rule for `EnvironmentSound` (SND-11, 0x005375e0).
  // The engine stops and starts it outright; the short ease here is only so
  // a Web Audio gain does not click. The placed ambience (shorelines,
  // buildings, flags) is ordinary world voices and has no such rule.
  const BED_GATE_TAU = 0.08;
  pageAudio.bedGate = 1;
  pageAudio.quietWorld = false;
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
    const occupancy = page.occupancy;
    const seat = occupancy?.activeSeatId != null
      ? (occupancy.seatInfo?.(occupancy.activeSeatId) ?? {}) : null;
    // `quietWorld`: the level's own sounds off (the wind bed and the placed
    // ambience), for a view of two planes alone (the dogfight school on a
    // fight's map, features/dogfight-recordings).
    const gateTarget = !pageAudio.quietWorld && environmentPlays(seat) ? 1 : 0;
    pageAudio.bedGate += (gateTarget - pageAudio.bedGate)
      * (dt > 0 ? Math.min(1, dt / BED_GATE_TAU) : 1);
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
      // The hand-shot bus tracks the master like the engine bus does.
      const target = master * WEAPON_HEADROOM;
      if (Math.abs(page.handFireBus.gain.value - target) > 1e-4) {
        page.handFireBus.gain.setTargetAtTime(
          target, pageAudio.audioListener.context.currentTime, 0.05);
      }
    }
    if (pageAudio.ambientAudio) {
      const base = scriptVolume(page.extras.sounds?.ambient?.volume);
      pageAudio.ambientAudio.setVolume(base * master * pageAudio.bedGate);
    }

    if (pageAudio.activeAreaAudios.length === 0) return;

    // Each group's loudest emitter, measured from the camera the way the game
    // measures it (`area-sound.js`): an AreaObject's voice at the nearest
    // point of its closed outline in XZ, stopped beyond its trigger radius;
    // every voice falling off as minDistance / d with the script's own
    // distance ramp on top. `ear` is the camera's world point (SND-5).
    for (const item of pageAudio.activeAreaAudios) {
      const hit = loudestEmitter(item.areas, ear);
      if (hit) item.anchor.position.set(hit.x, hit.y, hit.z);
      item.sound.setVolume((hit && !pageAudio.quietWorld ? hit.gain : 0) * master);
    }
  }

  /**
   * A soldier's movement sounds for this frame: their `SoldierSound`
   * (`soldier-sound.js`, BF1942.exe 0x00572f20) fed the trigger their body is
   * in, and whatever it fires played from `soldier.json`.
   *
   * `owner` is any object that lives as long as the soldier (the machine is
   * kept against it). `view` is the body this frame (`SoldierSoundState`), or
   * `{ state }`, a replayed soldier's recorded lower-body state by name.
   * `view.grounded`: the body stands on a floor (`setMaterial`'s contact),
   * or null for a body that cannot say; `view.ticked` false on a frame its
   * physics did not run.
   * `view.x/y/z`: the feet. `position`: where a listener who is not this
   * soldier hears it, or null for the listener's own body. `armor`: their hit
   * points; a rise is the heal `handleDamage` raises `c_SstHealedByMedic` on.
   *
   * Cost: one small object per soldier and a few compares a frame; a sample
   * is only looked up on the frames a sound fires.
   */
  const soldierSounds = new WeakMap();
  pageAudio.soldierSoundLog = [];
  function soldierSoundTick(owner, view, dt, position = null, armor = null) {
    // Run whatever the volume: the machine is a soldier's state, and a page
    // that is muted (or a headless check) still reads what it fired.
    if (!owner || !view || page.AUDIO_OFF) return null;
    const manifest = pageAudio.soldierSoundsDoc;
    if (manifest === undefined) { soldierSoundsManifest(); return null; }
    if (!manifest) return null;
    let entry = soldierSounds.get(owner);
    if (!entry || entry.manifest !== manifest) {
      entry = {
        manifest,
        machine: new SoldierSound(manifest.frequencies ?? VANILLA_FREQUENCIES),
        state: new SoldierSoundState(),
        armor: null, hp: 0,
      };
      soldierSounds.set(owner, entry);
    }
    const step = Number.isFinite(dt) && dt > 0 ? Math.min(dt, 0.25) : 0;
    let trigger = view.state !== undefined
      ? triggerOfState(view.state, manifest.states ?? null)
      : entry.state.trigger(view, step);
    // The heal: hit points that rose on a living soldier since the last frame.
    if (armor) {
      const hp = armor.hitPoints ?? 0;
      if (entry.armor === armor && entry.hp > 0 && hp > entry.hp + 1e-6 && !armor.destroyed
          && !view.quiet) {
        trigger = SST.HealedByMedic;
      }
      entry.armor = armor;
      entry.hp = hp;
    }
    // `setMaterial`, the floor contact that lands a jump. A body that says
    // when it stands on something is believed once it has left the ground
    // (the frame a jump starts it still stands there); one that cannot say
    // (a recorded state, `grounded: null`) has landed when its jump state ends.
    if (trigger === SST.Jump && entry.trigger !== SST.Jump) entry.takeoff = true;
    else if (trigger !== SST.Jump) entry.takeoff = false;
    entry.trigger = trigger;
    let contact;
    if (view.grounded == null) contact = trigger !== SST.Jump;
    else {
      if (!view.grounded) entry.takeoff = false;
      // `handleCollision` runs in the physics tick: one contact a tick, not
      // one a frame.
      contact = view.grounded && view.ticked !== false && !entry.takeoff;
    }
    if (contact) entry.machine.setMaterial(null);
    const out = entry.machine.update(step, trigger);
    if (!out) return null;
    const log = pageAudio.soldierSoundLog;
    log.push({ name: out.name, own: !position, t: performance.now(),
               patches: out.patches ? out.patches.slice() : null });
    if (log.length > 128) log.splice(0, log.length - 128);
    if (masterVolume() > 0) {
      // A patch triggered again starts its samples over: a layer still
      // waiting on its `Volume <- Time` gate from the trigger before never
      // sounds (the patch's clock went back to zero), one already playing
      // plays out (SND-14). A jump that lands inside its own state is
      // triggered again every other frame until the state ends.
      const batches = entry.batches ??= new Map();
      const before = batches.get(out.name);
      if (before) {
        before.cancelled = true;
        const now = pageAudio.audioListener?.context?.currentTime ?? 0;
        for (const pending of before.voices) if (pending.at > now) pending.handle.stop();
      }
      const batch = { cancelled: false, voices: [] };
      batches.set(out.name, batch);
      playSoldierScript(manifest, out, view, position, batch);
    }
    return out;
  }

  /** A simulated soldier of the page (`soldier.js`, the player or a bot) as
   *  the view `soldierSoundTick` reads. Reused: one per call site is enough. */
  function soldierSoundView(soldier, view = {}) {
    const body = soldier.body;
    const chute = soldier.chute;
    view.state = undefined;
    view.stance = soldier.stance ?? 'stand';
    view.gait = soldier.gait ?? 'stand';
    view.swim = soldier.swim?.swimming ? (soldier.swim.family ?? null) : null;
    view.climbing = !!soldier.climb?.active;
    view.climbY = soldier.climb?.ly ?? 0;
    view.jumping = !!body?.lowerBody?.jumping;
    // The dive is the state speed the stance change set (`soldier.js`
    // `#applyStance`); a lie-down that is not one is the backward `Lb_StandToLie`.
    view.dive = (body?.stateSpeed ?? 1) > 1;
    view.backward = !view.dive;
    // Under a canopy or in the free fall the lower body is in the
    // parachute's states, whose sounds `handleParachuteEvent` plays.
    view.quiet = !!(chute && (chute.open || chute.falling || chute.state === 'falling'));
    view.grounded = !!soldier.grounded;
    const ticks = soldier.clock?.ticks;
    view.ticked = ticks === undefined || ticks !== soldier._soundTicks;
    soldier._soundTicks = ticks;
    view.x = soldier.x; view.y = soldier.y; view.z = soldier.z;
    return view;
  }

  const botSoundView = {};
  const botSoundAt = { x: 0, y: 0, z: 0 };
  const recordedView = { state: null, grounded: null, x: 0, y: 0, z: 0 };
  /**
   * A bot's or a replayed soldier's movement sounds, for a listener who is
   * not wearing them. A bot of the page has a simulated soldier and is read
   * like the player; a replayed soldier names the engine's own lower-body
   * state (`recordedLower`), which is the trigger's source in the game.
   */
  function botFootstepTick(bot, dt) {
    if (page.AUDIO_OFF) return;
    if (bot.vehicle) return;
    const at = bot.getPosition?.();
    if (!at) return;
    botSoundAt.x = at[0]; botSoundAt.y = at[1]; botSoundAt.z = at[2];
    if (!soldierAudible(botSoundAt)) return;
    if (bot.recordedLower !== undefined) {
      recordedView.state = bot.recordedLower;
      recordedView.x = at[0]; recordedView.y = at[1]; recordedView.z = at[2];
      soldierSoundTick(bot, recordedView, dt, botSoundAt);
      return;
    }
    const soldier = page.botSoldier?.(bot) ?? null;
    if (!soldier) return;
    const view = soldierSoundView(soldier, botSoundView);
    const armor = page.botArmor?.(bot) ?? null;
    if (armor?.destroyed) view.quiet = true;
    soldierSoundTick(bot, view, dt, botSoundAt, armor);
  }

  /** The loudest any movement layer reaches: `SoldierRun.ssc` and the swim
   *  entry ramp to zero by 30 m (`Ramp 10 30 1 -1` is silent at 20). Past it
   *  a soldier's machine is not run at all. */
  const SOLDIER_SOUND_RANGE = 30;
  function soldierAudible(position) {
    const e = pageAudio.audioListener?.matrixWorld?.elements;
    if (!e) return true;
    const dx = e[12] - position.x, dy = e[13] - position.y, dz = e[14] - position.z;
    return dx * dx + dy * dy + dz * dz <= SOLDIER_SOUND_RANGE * SOLDIER_SOUND_RANGE;
  }

  /**
   * A remote soldier of a room. `s` is the renderer's record (`want`, the
   * clip family it drew, `remote-gait.js`), `state` the snapshot row: the
   * stance bits, the swim state and the feet. The wire carries no jump and
   * no ladder, so a remote has neither sound; a lie-down is taken for the
   * dive, which is what the engine enters unless the soldier backs up.
   */
  const REMOTE_GAITS = new Set(['stand', 'walk', 'run', 'crouch', 'crouchwalk', 'prone', 'crawl']);
  const REMOTE_MOVING = { walk: 'walk', run: 'run', crouchwalk: 'crouch', crawl: 'prone' };
  const remoteView = {};
  const remoteAt = { x: 0, y: 0, z: 0 };
  function remoteSoldierSoundTick(s, state, dt) {
    if (page.AUDIO_OFF || !s || !state) return;
    remoteAt.x = state.x; remoteAt.y = state.y; remoteAt.z = state.z;
    if (!placeable(remoteAt) || !soldierAudible(remoteAt)) return;
    const v = remoteView;
    const family = s.want ?? 'stand';
    v.state = undefined;
    v.stance = state.prone ? 'prone' : state.crouch ? 'crouch' : 'stand';
    v.swim = state.swim ?? null;
    v.gait = REMOTE_MOVING[family] ?? 'stand';
    v.climbing = false;
    v.climbY = 0;
    v.jumping = false;
    v.dive = true;
    v.backward = false;
    // A blast's flight, a canopy, a death: states with sounds of their own.
    v.quiet = !v.swim && !REMOTE_GAITS.has(family);
    v.grounded = true;
    v.ticked = true;
    v.x = state.x; v.y = state.y; v.z = state.z;
    soldierSoundTick(s, v, dt, remoteAt, null);
  }

  // --- soldier footsteps, damage direction & hurt audio ------------------------

  pageAudio.soldierSoundsIndex = null;
  // Each soldier's own grunt and "Watch your aim!" clocks (`soldier-voice-gates.js`).
  pageAudio.voiceGates = createVoiceGates();

  // A tree that has no `soldier.json` answers 404 for good: remembered per
  // models base, so every footstep of a round does not ask again. Anything
  // else that comes back empty (a network hiccup, a fetch that lost the load
  // storm) is still asked again next time.
  pageAudio.soldierSoundsMissing = null;

  function soldierSoundsManifest() {
    const base = page.MODELS_BASE;
    if (pageAudio.soldierSoundsBase !== undefined && pageAudio.soldierSoundsBase !== base) {
      // Another tree: its own manifest, asked for afresh.
      pageAudio.soldierSoundsIndex = null;
      pageAudio.soldierSoundsDoc = undefined;
      pageAudio.soldierSoundsBase = undefined;
    }
    if (pageAudio.soldierSoundsMissing === base) return Promise.resolve(null);
    if (!pageAudio.soldierSoundsIndex) {
      pageAudio.soldierSoundsIndex = fetch(`${base}/sounds/soldier.json${page.bust()}`)
        .then(r => {
          if (r.status === 404) pageAudio.soldierSoundsMissing = base;
          return r.ok ? r.json() : null;
        })
        .catch(() => null)
        .then(doc => {
          if (!doc) pageAudio.soldierSoundsIndex = null;
          // The answered manifest, for the per-frame path that cannot wait:
          // undefined until a fetch has answered, null for a tree with none.
          if (doc || pageAudio.soldierSoundsMissing === base) {
            pageAudio.soldierSoundsDoc = doc;
            pageAudio.soldierSoundsBase = base;
          }
          return doc;
        });
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
   *
   * Returns a handle whose `stop()` fades the voice out over 50 ms, for a
   * layer that belongs to a state the soldier can leave (the free-fall wind);
   * `loop` keeps it going until then.
   */
  function playSoldierOneShot(buffer, volume = 1, pitchJitter = 0.03, delay = 0,
                              position = null, loop = false, { priority = 0, ranged = false } = {}) {
    if (!buffer || !pageAudio.audioListener || masterVolume() <= 0) return null;
    const ctx = pageAudio.audioListener.context;
    if (ctx.state === 'suspended') return null;
    if (position && !placeable(position)) return null;
    let distance = 0;
    if (position) {
      const e = pageAudio.audioListener.matrixWorld?.elements;
      if (e) distance = Math.hypot(e[12] - position.x, e[13] - position.y, e[14] - position.z);
    }
    // `ranged`: the caller applied the layer's own `Volume <- Distance` ramp,
    // which is what bounds it in the game.
    if (position && !ranged) {
      // DELIBERATE, not retail (a voice has no maximum distance, SND-6): past
      // 40 m a bot's foley is ~-32 dB and the page skips the voice entirely. Twelve bots walking was a hundred one-shot panners a
      // second, most of them built for nobody.
      const e = pageAudio.audioListener.matrixWorld?.elements;
      if (e) {
        const dx = e[12] - position.x, dy = e[13] - position.y, dz = e[14] - position.z;
        if (dx * dx + dy * dy + dz * dz > 1600) return null;
      }
    }
    // A voice of the pool (`voice-pool.js`, ledger SND-39): none free and
    // nothing to take, and the sound does not play.
    const pool = voicePoolOf(ctx);
    let source = null;
    let gain = null;
    const voice = pool.claim({
      kind: voiceKind(!!position, buffer.numberOfChannels),
      priority,
      distance,
      stop: () => {
        try { source.onended = null; source.stop(); } catch (_) {}
        try { source.disconnect(); gain.disconnect(); } catch (_) {}
      },
    });
    if (!voice) return null;
    source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = loop;
    if (pitchJitter > 0) {
      source.playbackRate.value = 1 + (Math.random() * 2 - 1) * pitchJitter;
    }
    gain = ctx.createGain();
    gain.gain.value = Math.min(Math.max(volume, 0), 1) * masterVolume() * WEAPON_HEADROOM;
    source.connect(gain);
    let panner = null;
    if (position) {
      panner = ctx.createPanner();
      panner.distanceModel = 'inverse';
      panner.refDistance = 1;
      panner.maxDistance = 40;
      panner.rolloffFactor = 1;
      standDs3dPanner(panner, pageAudio.audioListener.matrixWorld?.elements,
                      position.x, position.y, position.z);
      gain.connect(panner);
    }
    (panner ?? gain).connect(pageAudio.audioListener.getInput());
    source.onended = () => {
      pool.release(voice);
      try {
        source.disconnect();
        gain.disconnect();
        panner?.disconnect();
      } catch (_) {}
    };
    const when = delay > 0 ? ctx.currentTime + delay : 0;
    try { source.start(when); } catch (_) { pool.release(voice); }
    return {
      stop() {
        const now = ctx.currentTime;
        try {
          gain.gain.setValueAtTime(gain.gain.value, now);
          gain.gain.linearRampToValueAtTime(0, now + 0.05);
          source.stop(now + 0.06);
        } catch (_) {}
      },
    };
  }

  // The footstep's own cast record, reused. It used to borrow the soldier's
  // (`soldier._hit`), which soldier.js fills for its own casts.
  const footstepHit = {
    t: 0, x: 0, y: 0, z: 0, nx: 0, ny: 1, nz: 0,
    dx: 0, dy: -1, dz: 0, material: 0, kind: '', owner: -1, triangle: -1,
  };

  /** The patch of the floor under (x, y, z): `addMaterialToSound`'s index
   *  for the material a cast down finds (`soldier-sound.js` `MATERIAL_PATCH`). */
  function floorPatchAt(x, y, z) {
    let matId = 0;
    const collider = page.soldier?.collider;
    if (collider) {
      let onStatic = false;
      let best = -Infinity;
      if (collider.statics) {
        const record = footstepHit;
        record.dx = 0; record.dy = -1; record.dz = 0;
        const hit = collider.statics.cast(x, y + 0.5, z, 0, -1, 0, 1.0, -1, record);
        if (hit) {
          best = hit.y;
          matId = hit.material;
          onStatic = true;
        }
      }
      const ground = collider.surfaceHeight ? collider.surfaceHeight(x, z) : NaN;
      if (!onStatic || (Number.isFinite(ground) && ground >= best)) {
        matId = collider.heightfield?.material ? collider.heightfield.material(x, z) : 0;
        // Wading: the sea over the ground they stand on is the floor's material.
        const terrain = collider.heightfield?.height ? collider.heightfield.height(x, z) : NaN;
        if (collider.waterLevel != null && Number.isFinite(terrain) && collider.waterLevel > terrain
            && !onStatic) {
          return MATERIAL_PATCH.water;
        }
      }
    }
    return MATERIAL_PATCH[footstepMaterial(matId)] ?? 0;
  }

  /**
   * What `SoldierSound::update` triggers: `out.patches` of the script, or all
   * of them. A patch plays every layer it loads, or one of them when its last
   * load carries `randomPlay 1` (SND-15); `silence.wav` is a load that plays
   * nothing. Each layer starts at its `Volume <- Time` gate (`at`) at the
   * script's own volume times its `Volume <- Distance` ramp.
   */
  async function playSoldierScript(manifest, out, at, position = null, batch = null) {
    const script = manifest.triggers?.[out.name];
    if (!script?.patches?.length) return;
    let indices = out.patches;
    if (indices) {
      // The stored material is the floor of the last contact, which for a
      // body on the ground is the floor under it now.
      indices = [floorPatchAt(at.x, at.y, at.z), ...indices.slice(1)];
    } else {
      indices = script.patches.map((_, i) => i);
    }
    let distance = 0;
    if (position) {
      const e = pageAudio.audioListener?.matrixWorld?.elements;
      if (e) distance = Math.hypot(e[12] - position.x, e[13] - position.y, e[14] - position.z);
    }
    for (const index of indices) {
      const patch = script.patches[index];
      if (!patch?.layers?.length) continue;
      const layers = patch.randomPlay
        ? [patch.layers[Math.floor(Math.random() * patch.layers.length)]]
        : patch.layers;
      for (const layer of layers) {
        if (layer.silent) continue;
        const volume = (layer.volume ?? 1) * distanceGain(layer.distance, distance);
        if (!(volume > 0)) continue;
        const buf = await modelSoundBuffer(`sounds/${layer.sample}.mp3`);
        if (batch?.cancelled) return;
        if (buf) {
          const delay = layer.at ?? 0;
          const handle = playSoldierOneShot(buf, volume, 0.03, delay, position, false,
                                            { priority: layer.priority ?? 0, ranged: !!layer.distance });
          if (handle && batch && delay > 0) {
            batch.voices.push({ handle, at: (pageAudio.audioListener?.context?.currentTime ?? 0) + delay });
          }
        }
      }
    }
  }

  /** A step at a place, by gait: the path a caller with no soldier of its own
   *  still has (`c_SstRun` or `c_SstWalk`'s material patch, cloth and harness). */
  async function handleSoldierFootstep(step, position = null) {
    if (page.AUDIO_OFF || masterVolume() <= 0) return;
    const manifest = await soldierSoundsManifest();
    if (!manifest) return;
    const trigger = step.gait === 'run' ? SST.Run
      : step.gait === 'crouch' ? SST.CrouchMove
        : step.gait === 'prone' ? SST.CrawlMove : SST.Walk;
    const material = trigger === SST.Run || trigger === SST.Walk;
    await playSoldierScript(manifest, {
      name: triggerName(trigger),
      patches: material ? [0, 8, 9] : null,
    }, step, position);
  }


  /**
   * One of the soldier's own `@Language` lines -- a grunt, a death, the
   * free-fall scream -- in `nation`'s tongue.
   *
   * `extract_soldier_voices.py` lays them out beside the radio's, under
   * `_shared/voices/<nation>/`, because the engine loads them from
   * `Sound/@RTD/@Language/` and `@Language` is the speaker's side
   * (`setRadioLanguage`): a Marine swears in UsEnglish, a German in German. A
   * mod tree borrows vanilla's folder, and a tree extracted before any of this
   * falls back to the one language `soldier.json` resolved.
   */
  /** `_shared/voices/soldier-voices.json` (`extract_soldier_voices.py`): which
   *  of the soldier's own lines each language ships. */
  function soldierVoicesIndex() {
    if (pageAudio.soldierVoicesIndex === undefined) {
      const shared = page.MAPS_BASE === 'maps' ? 'maps/_shared' : `${page.MAPS_BASE}/_shared`;
      pageAudio.soldierVoicesIndex = fetch(`${shared}/voices/soldier-voices.json${page.bust()}`)
        .then(r => (r.ok ? r.json() : null)).catch(() => null);
    }
    return pageAudio.soldierVoicesIndex;
  }

  /**
   * The stems a random pick rolls over for `nation`: RADIO-6 drops a load whose
   * file the language does not ship before the roll, so a patch never goes
   * silent for want of a file. BF1918's Romanian, Greek and Senegalese
   * soldiers ship `Dying1..8` where the patch names `Dying1..11`.
   */
  async function shippedStems(stems, nation) {
    if (!nation || nation === 'unknown' || !stems?.length) return stems;
    const index = await soldierVoicesIndex();
    const kept = nationStems(index, { stems }, nation);
    return kept.length ? kept : stems;
  }

  const missingSoldierVoices = new Set();
  async function soldierVoiceBuffer(stem, nation) {
    if (page.AUDIO_OFF || !stem || nation === false) return null;
    ensureListener();
    const shared = page.MAPS_BASE === 'maps' ? 'maps/_shared' : `${page.MAPS_BASE}/_shared`;
    const dirs = [];
    if (nation && nation !== 'unknown') {
      dirs.push(`${shared}/voices/${nation}`);
      if (shared !== 'maps/_shared') dirs.push(`maps/_shared/voices/${nation}`);
    }
    for (const dir of dirs) {
      const url = `${dir}/${stem}.mp3`;
      if (missingSoldierVoices.has(url)) continue;
      const key = `voices:${url}`;
      let pending = audioBufferCache.get(key);
      if (!pending) {
        pending = pageAudio.audioLoader.loadAsync(`${url}${page.bust()}`).catch(() => {
          // Remembered, not retried: a tongue this tree does not carry would
          // otherwise be fetched again on every grunt.
          missingSoldierVoices.add(url);
          audioBufferCache.delete(key);
          return null;
        });
        audioBufferCache.set(key, pending);
      }
      const buffer = await pending;
      if (buffer) return buffer;
    }
    return modelSoundBuffer(`sounds/${stem}.mp3`);
  }

  /** The local soldier's side, as a voice folder. */
  function localNation() {
    return (page.teamVoice ?? page.teamNation)?.(page.deployTeamId) ?? null;
  }

  /**
   * The hurt grunt (`c_SstHitDamage`), of soldier `key`: their own
   * `SoldierSound` clock, 1.0 to 1.2 s between two (`soldier-voice-gates.js`).
   * Until 2026-11-12 every world soldier shared one 0.9 s clock, so two bots
   * hit within it gave one grunt. `cooled` false skips it: a replay's grunts
   * come one per recorded blow (replay-bodies.js `hurt`), and one grenade that
   * hurts three men is three grunts (8t224pppqe at 154.93 s). `isFriendlyFire`
   * is the old caller's word and plays the grunt alone: "Watch your aim!" is a
   * round's touch, not damage (`playFriendlyHitSound`).
   */
  async function playSoldierHurtSound(isFriendlyFire = false, position = null, nation = undefined,
                                      cooled = true, key = null) {
    if (page.AUDIO_OFF || masterVolume() <= 0) return;
    const now = performance.now() * 0.001;
    if (cooled && !pageAudio.voiceGates.hurt(key ?? (position ? 'world' : 'local'), now)) return;
    await playSoldierTrigger('c_SstHitDamage', position, nation);
  }

  /**
   * "Watch your aim!" (`c_SstFFHitDamage`): a round of `roundTeam` touched
   * soldier `key` of `soldierTeam`, damaged or not (`BFSoldier::projectileHit`
   * lnxded 0x0827ea20; `soldier-voice-gates.js`). Played at the soldier, in
   * their own side's tongue; the human's own (`position` null) at the ear.
   */
  function playFriendlyHitSound(key, roundTeam, soldierTeam, position = null, nation = undefined) {
    const now = performance.now() * 0.001;
    if (!pageAudio.voiceGates.friendlyHit(key, now, roundTeam, soldierTeam)) return false;
    if (page.AUDIO_OFF || masterVolume() <= 0) return true;
    playSoldierTrigger('c_SstFFHitDamage', position, nation);
    return true;
  }

  async function playSoldierTrigger(triggerName, position, nation) {
    const manifest = await soldierSoundsManifest();
    if (!manifest) return;
    const trigger = manifest.triggers?.[triggerName];
    const patch = trigger?.patches?.[0];
    if (!patch?.layers?.length) return;
    const speaker = nation === undefined ? (position ? null : localNation()) : nation;
    const shipped = new Set(await shippedStems(patch.layers.map(l => l.sample), speaker));
    const layers = patch.layers.filter(l => shipped.has(l.sample));
    const choice = layers[Math.floor(Math.random() * layers.length)];
    const buf = await soldierVoiceBuffer(choice.sample, speaker);
    if (buf) playSoldierOneShot(buf, choice.volume ?? 0.7, 0.05, 0, position);
  }

  /**
   * `c_SstKilled`: `SoldierKilled.ssc`'s `randomPlay 1` over `Dying1..8`, the
   * last word. A man who rides a free fall into the ground without pulling
   * the cord hears this -- it is the fall that kills him, not a landing
   * sound; `SoldierParachuteLand.ssc` does not ship (see `parachute.js`).
   */
  const DYING_STEMS = ['Dying1', 'Dying2', 'Dying3', 'Dying4', 'Dying5', 'Dying6', 'Dying7', 'Dying8'];
  async function playSoldierDeathSound(position = null, nation = undefined) {
    if (page.AUDIO_OFF || masterVolume() <= 0) return;
    const manifest = await soldierSoundsManifest();
    const layers = manifest?.triggers?.c_SstKilled?.patches?.[0]?.layers;
    const speaker = nation === undefined ? (position ? null : localNation()) : nation;
    const stems = await shippedStems(layers?.length ? layers.map(l => l.sample) : DYING_STEMS, speaker);
    const stem = stems[Math.floor(Math.random() * stems.length)];
    const buf = await soldierVoiceBuffer(stem, speaker);
    if (buf) playSoldierOneShot(buf, 1, 0.09, 0, position);
  }

  // --- the bail-out -------------------------------------------------------------
  //
  // `parachute.js` names each trigger at the moment the engine fires it; this
  // plays them at the listener's own ear. `c_SstFallingHigh` belongs to the
  // free-fall animation state, so its layers -- the two looping winds, the
  // whooshes at 1.2 and 2.3 s, the scream at 3.3 and the 11.5 s egg -- live
  // exactly as long as the state does: pulling the cord, landing, dying into
  // another state or a respawn cuts them. The canopy's crack is its own
  // script and plays out whatever happens next.

  /** The running `c_SstFallingHigh` layers, each a `playSoldierOneShot` handle. */
  pageAudio.fallVoices = [];
  /** Bumped whenever the fall script is cut, so a buffer that finishes
   *  decoding after the fall ended does not start into silence. */
  pageAudio.fallGeneration = 0;

  function stopFallSound() {
    pageAudio.fallGeneration++;
    for (const voice of pageAudio.fallVoices) voice.stop();
    pageAudio.fallVoices.length = 0;
  }

  async function handleParachuteEvent(event) {
    if (event.type === 'state') {
      if (event.state !== 'falling') stopFallSound();
      return;
    }
    if (event.type !== 'sound' || !event.sample || page.AUDIO_OFF || masterVolume() <= 0) return;
    if (event.trigger === 'c_SstFallingHigh') {
      const generation = pageAudio.fallGeneration;
      const buf = event.voice
        ? await soldierVoiceBuffer(event.sample, localNation())
        : await modelSoundBuffer(`sounds/${event.sample}.mp3`);
      if (!buf || generation !== pageAudio.fallGeneration) return;
      const voice = playSoldierOneShot(buf, event.volume ?? 1, 0, 0, null, !!event.loop);
      if (voice) pageAudio.fallVoices.push(voice);
      return;
    }
    // `c_SstOpenParachute`: one of three, each with its own `Volume <- Time`
    // gate, so the crack lands a third of a second after the pull.
    const buf = await modelSoundBuffer(`sounds/${event.sample}.mp3`);
    if (buf) playSoldierOneShot(buf, event.volume ?? 1, 0, event.at ?? 0);
  }

  // --- the end of a round: the win and lose cues -----------------------------
  //
  // The debriefing plays `BfMenu::setMusic(3)` when the local side won and
  // `setMusic(5)` when it lost, once per round, and nothing on a draw (ledger
  // ROUND-8). The cues are the mod's `Game.setWinMusicFilename` /
  // `setLoseMusicFilename` (`extract_menu_music.py`: `music/win.mp3` and
  // `music/lose.mp3` under the tree's `_shared`), streamed, not looped; a mod
  // tree without its own falls back to vanilla's recording, which is what
  // Desert Combat ships anyway.
  pageAudio.roundMusic = null;

  /** Play the `win` or `lose` cue. Resolves to the URL that played, or null
   *  (sound off, the cue missing in both trees, the browser refusing). */
  async function playRoundMusic(kind) {
    stopRoundMusic();
    if (page.AUDIO_OFF || (kind !== 'win' && kind !== 'lose')) return null;
    const volume = masterVolume();
    if (!(volume > 0)) return null;
    const shared = page.MAPS_BASE === 'maps' ? ['maps/_shared'] : [`${page.MAPS_BASE}/_shared`, 'maps/_shared'];
    for (const dir of shared) {
      const url = `${dir}/music/${kind}.mp3`;
      const audio = new Audio(`${url}${page.bust()}`);
      audio.loop = false;
      audio.volume = Math.min(1, volume);
      pageAudio.roundMusic = { kind, url: null, audio };
      try {
        await audio.play();
        if (pageAudio.roundMusic?.audio !== audio) return null;   // stopped meanwhile
        pageAudio.roundMusic.url = url;
        return url;
      } catch (error) {
        if (pageAudio.roundMusic?.audio !== audio) return null;
        // A 404 is a media error: try the next tree. A refused autoplay is
        // not, and no other tree will fare better.
        if (error?.name === 'NotAllowedError') { pageAudio.roundMusic = null; return null; }
      }
    }
    pageAudio.roundMusic = null;
    return null;
  }

  /** Stop the cue (the next round has started, or another cue replaces it). */
  function stopRoundMusic() {
    const playing = pageAudio.roundMusic;
    pageAudio.roundMusic = null;
    if (!playing?.audio) return;
    try { playing.audio.pause(); } catch (_) { /* nothing to stop */ }
    playing.audio.removeAttribute('src');
  }

  Object.assign(pageAudio, {
    audioBufferCache,
    botFootstepTick,
    voicePoolStats: () => (pageAudio.audioListener
      ? voicePoolOf(pageAudio.audioListener.context).stats() : null),
    remoteSoldierSoundTick,
    soldierSoundTick,
    soldierSoundView,
    claimVehicleAudio,
    cutVehicleAudio,
    disposeEngineAudio,
    disposeSounds,
    ensureAudioContext,
    ensureListener,
    ensureWorldFire,
    handleParachuteEvent,
    handleSoldierFootstep,
    masterVolume,
    modelSoundBuffer,
    playSoldierDeathSound,
    playSoldierHurtSound,
    playFriendlyHitSound,
    playObstacleScrape,
    playRefillSound,
    playRoundMusic,
    playSoldierOneShot,
    playSupplyGive,
    playWorldShot,
    playWorldReload,
    playWorldEject,
    releaseVehicleAudio,
    setupSounds,
    soundBuffer,
    stopFallSound,
    stopRoundMusic,
    updateAudio,
  });
  return pageAudio;
}
