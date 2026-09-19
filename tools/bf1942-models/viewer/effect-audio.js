// The noise an impact makes.
//
// An effect bundle in this engine is a picture and a sound, and until now the
// viewer played only the picture. `_shared/effects.sounds.json` carries the
// other half — every bundle's `loadSoundScript`, parsed, with its samples
// beside `effects.glb` in `_shared/sounds` — and this module plays it at the
// place the effect plays.
//
// Three decisions, each of which had a cheaper wrong answer:
//
// **An explosion is a one-shot patch, so it is `EngineAudio` in one-shot
// mode, not a second player beside it.** A gun `.ssc` and an explosion `.ssc`
// are the same document: layers sequenced off `Time`, distant ones held back
// by `trigger Volume` against a step ramp so they arrive a speed-of-sound
// delay late, distance ramps owning the volume, `stereo` layers unpanned,
// `randomStartPitch` breaking the phase lock. `EngineAudio` already evaluates
// every one of those, and the `oneShotsOnTrigger` mode added for the Sherman's
// cannon is exactly the semantics an explosion wants: hold the one-shots back
// from `start()`, play them from `trigger()`, restart the patch clock so the
// `Time` ramps measure from the bang, re-arm the `trigger Volume` latch for
// one play. Writing a second player would have meant re-deriving all of it and
// then keeping the two in step.
//
// **A patch is pooled per script, not per impact.** 70 sounding impact
// bundles share 38 `.ssc` between them, because every ricochet-with-decal
// defers to the bare ricochet bundle it wraps. Building a graph per hit would
// allocate a panner and eight gains for a sound lasting 200 ms, forty times a
// second under a Thompson. A pool of instances per script, each repositioned
// and re-triggered, allocates once.
//
// **The voice budget is the game's own number.** `.ssc` has no instance-limit
// word at all — a census of every directive in vanilla's 985 scripts finds
// `priority` (4,180 uses, range -12..11) and nothing else that arbitrates. The
// cap lives in the settings: `Sound.setHardwareVoiceLimit 32` in
// `Mods/bf1942/Settings/Default.con`, which is also the `SoundSetup`
// constructor's own default before any `.con` is read (lnxded
// `dice::bf::SoundSetup::SoundSetup` 0x080d51c0, `mov DWORD PTR [ebx+0x50],
// 0x20` at 0x080d520a), with `reserve2dMonoChans 4/4/4` and
// `reserve2dStereoChans 2/2/2` holding six back for non-spatialised playback.
// So 26 spatialised voices, arbitrated by `priority`, is what the engine
// gives a firefight, and it is what this gives one.

import { EngineAudio } from './engine-audio.js';

/** Speed of sound, m/s — what the scripts' own step ramps are measured in. */
export const SPEED_OF_SOUND = 340;

/**
 * Concurrent sources an effect may sum to.
 *
 * 32 hardware voices less the 6 reserved for 2D. The manifest carries both
 * numbers so this is a fallback for a tree published before it did, not a
 * constant anyone should tune.
 */
export const DEFAULT_VOICE_BUDGET = 26;

/**
 * How long after a trigger an instance stays reserved for its own patch.
 *
 * Not a taste setting: a `trigger Volume` layer has not started yet at the
 * moment of the trigger — that is the whole point of it — so an instance whose
 * live-source count is 0 half a second in may still have a 400 m explosion
 * tail due at 1.2 s. The window is read from the script's own step ramps, and
 * this is only the floor under a script that declares none.
 */
const MIN_HOLD = 0.25;

/** `Ramp p1 p2 p3 p4` at `x` — `engine-audio.js`'s own shape, duplicated here
 *  so this module imports nothing but `EngineAudio`. */
function rampAt(params, x) {
  const [a = 0, b = 0, base = 0, delta = 0] = params;
  if (x <= a) return base;
  if (x >= b) return base + delta;
  const span = b - a;
  return span <= 0 ? base + delta : base + delta * ((x - a) / span);
}

/**
 * The last moment any layer of this script can still start, in seconds after
 * the trigger.
 *
 * A `Volume <- Time` ramp that reads zero at t=0 is a delayed start, and its
 * `p2` is when it has finished opening. `e_ExplGas` stacks four of them —
 * 0.3 s at 100 m, 0.55 s at 200 m, 0.75 s at 400 m — which is the engine
 * spending 340 m/s on the layers it wants to arrive late.
 */
export function scriptHold(layers) {
  let hold = MIN_HOLD;
  for (const layer of layers || []) {
    for (const mod of layer.modulators || []) {
      if (mod.dest !== 'volume' || mod.source !== 'time') continue;
      if (mod.envelope !== 'ramp') continue;
      if (rampAt(mod.params, 0) > 0) continue;
      hold = Math.max(hold, (mod.params[1] ?? mod.params[0] ?? 0) + MIN_HOLD);
    }
  }
  return hold;
}

/**
 * How loud this script can be at the listener's distance, before it is built.
 *
 * Used to drop a play that could not be heard anyway rather than spend a voice
 * on it — the `Volume <- Distance` ramp is the script's own answer to "is this
 * audible from there", and a ricochet whose ramp reaches zero at 25 m says so
 * plainly. Returns the loudest layer's gain, because one audible layer is
 * enough to make the patch worth playing.
 */
export function audibleAt(layers, distance) {
  let best = 0;
  for (const layer of layers || []) {
    let gain = layer.volume ?? 1;
    for (const mod of layer.modulators || []) {
      if (mod.dest !== 'volume') continue;
      if (mod.source === 'distance') {
        gain *= mod.envelope === 'linear'
          ? (mod.params[0] ?? 0) + (mod.params[1] ?? 0) * distance
          : rampAt(mod.params, distance);
      }
      // A `Time` gate is a delay, not a verdict on audibility: evaluating it
      // at t=0 would read every delayed distant layer as silent and drop the
      // very explosions this exists to keep.
    }
    if (gain > best) best = gain;
  }
  return best;
}

/** The loudest `priority` in a script — what it bids with for a voice. */
export function scriptPriority(layers) {
  let best = -Infinity;
  for (const layer of layers || []) {
    const p = layer.priority;
    if (typeof p === 'number' && p > best) best = p;
  }
  return best === -Infinity ? 0 : best;
}

/** One pooled patch: an `EngineAudio` and where it currently stands. */
class Slot {
  constructor(audio, script) {
    this.audio = audio;
    this.script = script;
    this.position = { x: 0, y: 0, z: 0 };
    this.quaternion = { x: 0, y: 0, z: 0, w: 1 };
    this.since = Infinity;
    this.priority = 0;
    this.distance = 0;
    this.plays = 0;
  }

  /** Still owed sound? Either something is running, or a delayed layer is due. */
  get busy() {
    return this.audio.sources > 0 || this.since < this.script.hold;
  }
}

/**
 * Every effect sound on the level, pooled and budgeted.
 *
 * `getBuffer(relPath)` is the page's own cache-keyed decoder, shared with the
 * ambient and engine paths so the one-decode-per-wav rule holds across all of
 * them. `listener` is the three.js `AudioListener`; nothing else here knows
 * that three.js exists, which is what lets the module run under node.
 */
export class EffectAudio {
  constructor({ listener, getBuffer, manifest = null,
                headroom = 0.75, budget = null, perScript = 3,
                rand = Math.random } = {}) {
    this.listener = listener;
    this.getBuffer = getBuffer;
    this.headroom = headroom;
    this.rand = rand;
    this.perScript = perScript;
    this.manifest = null;
    // An explicitly passed budget outranks the manifest's: the manifest
    // carries the game's own figure, and a caller that overrides it (a test,
    // or a page deliberately running a smaller mixer) means it.
    this.fixedBudget = typeof budget === 'number' && budget > 0;
    this.budget = this.fixedBudget ? budget : DEFAULT_VOICE_BUDGET;
    this.scripts = new Map();      // script key -> { layers, hold, priority, slots }
    this.bundles = new Map();      // lowercased bundle name -> script key
    this.master = 0;
    this.disposed = false;
    this.listenerPosition = { x: 0, y: 0, z: 0 };
    // Headless checks read these; they are also the only way to tell "the
    // budget held" from "nothing ever asked for a voice".
    this.plays = 0;
    this.dropped = 0;
    this.stolen = 0;
    this.inaudible = 0;
    this.pending = new Map();
    if (manifest) this.setManifest(manifest);
  }

  /** Adopt `_shared/effects.sounds.json`. Decodes nothing; see `prime`. */
  setManifest(manifest) {
    this.manifest = manifest;
    const limit = manifest?.voiceLimit;
    const reserved = manifest?.reserved2d ?? 0;
    if (!this.fixedBudget && typeof limit === 'number' && limit > 0) {
      this.budget = Math.max(1, limit - reserved);
    }
    this.bundles.clear();
    for (const [key, entry] of Object.entries(manifest?.bundles || {})) {
      this.bundles.set(key.toLowerCase(), entry.script);
    }
    this.scripts.clear();
    for (const [key, script] of Object.entries(manifest?.scripts || {})) {
      this.scripts.set(key, {
        key,
        script: script.script,
        layers: script.layers || [],
        hold: scriptHold(script.layers),
        priority: scriptPriority(script.layers),
        slots: [],
      });
    }
  }

  has(name) {
    return !!name && this.bundles.has(String(name).toLowerCase());
  }

  #scriptFor(name) {
    const key = this.bundles.get(String(name || '').toLowerCase());
    return key ? this.scripts.get(key) : undefined;
  }

  /**
   * Decode a bundle's samples and build its first pool slot, if it has none.
   *
   * Asynchronous and fire-and-forget: a hit cannot wait for a fetch, so the
   * first round into a new surface is silent and every one after it is not.
   * Callers that know what is coming (the weapon the player just picked up)
   * can prime ahead of the shot.
   */
  async prime(name) {
    const script = this.#scriptFor(name);
    if (!script || this.disposed) return null;
    if (script.slots.length) return script;
    if (this.pending.has(script.key)) return this.pending.get(script.key);
    const task = this.#grow(script).then(() => script, () => null)
      .finally(() => this.pending.delete(script.key));
    this.pending.set(script.key, task);
    return task;
  }

  async #grow(script) {
    if (this.disposed || script.slots.length >= this.perScript) return null;
    const buffers = new Map();
    for (const layer of script.layers) {
      if (buffers.has(layer.file)) continue;
      buffers.set(layer.file, await this.getBuffer(layer.file));
    }
    if (this.disposed) return null;
    const layers = script.layers.filter(l => buffers.get(l.file));
    if (!layers.length) return null;
    const audio = new EngineAudio(
      { template: script.script, level: 'high' }, layers, buffers,
      this.listener, this.headroom, true, this.rand);
    audio.setMaster(this.master);
    audio.start();
    const slot = new Slot(audio, script);
    script.slots.push(slot);
    return slot;
  }

  /** Live sources across every pooled patch — what the budget is spent on. */
  get sources() {
    let total = 0;
    for (const script of this.scripts.values()) {
      for (const slot of script.slots) total += slot.audio.sources;
    }
    return total;
  }

  /**
   * Play a bundle's sound at a point in the world.
   *
   * Synchronous by design — it is called from the same place the picture
   * starts, and the picture does not wait either. Returns the number of layers
   * that actually started (0 when the pool is cold, the patch is inaudible
   * from here, or the budget refused it).
   */
  play(name, position) {
    const script = this.#scriptFor(name);
    if (!script || this.disposed || !position) return 0;
    const [x, y, z] = position;
    const dx = x - this.listenerPosition.x;
    const dy = y - this.listenerPosition.y;
    const dz = z - this.listenerPosition.z;
    const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);

    // The script's own answer to "can this be heard from there". A ricochet
    // whose distance ramp is spent at 25 m is not worth a voice at 300 m, and
    // the engine's own mixer would have lost it to a nearer sound anyway.
    if (audibleAt(script.layers, distance) <= 0) {
      this.inaudible += 1;
      return 0;
    }

    if (!script.slots.length) {
      this.prime(name);
      this.dropped += 1;
      return 0;
    }

    const slot = this.#claim(script, distance);
    if (!slot) {
      this.dropped += 1;
      return 0;
    }
    slot.position = { x, y, z };
    slot.distance = distance;
    slot.priority = script.priority;
    slot.since = 0;
    slot.plays += 1;
    // Place the patch before triggering it: `EngineAudio` reads a voice's
    // distance out of its panner group, which `update` fills, and a layer
    // triggered at last frame's distance would take the wrong point on its
    // own `Volume <- Distance` ramp — audibly wrong for the first frame of a
    // ricochet that lasts three.
    this.#place(slot, 0);
    const played = slot.audio.trigger();
    this.plays += 1;
    return played;
  }

  /**
   * A slot for this play, growing the pool or stealing a voice as needed.
   *
   * Order: an idle slot of this script; then a new one if the pool is small
   * and the budget allows; then the cheapest slot to steal. "Cheapest" is the
   * engine's own arbitration — lower `priority` first, and between equals the
   * one furthest from the listener, because that is the one whose loss is
   * least audible. A request that outbids nothing is dropped, which is also
   * what a full mixer does.
   */
  #claim(script, distance) {
    // The budget first, and before any slot is looked at. Checking it only
    // when this script's own slots were busy was the first shape of this
    // function and it was wrong in the case that matters: a script with three
    // idle pooled slots would hand one out however full the mixer already
    // was, so the cap bound one bundle at a time instead of the level.
    if (this.sources >= this.budget && !this.#steal(script, distance)) {
      return null;
    }
    for (const slot of script.slots) {
      if (!slot.busy) return slot;
    }
    if (script.slots.length < this.perScript && this.sources < this.budget) {
      // Grow in the background; this play still has to find a slot now.
      this.#grow(script).catch(() => {});
    }
    // Every slot of this script is still sounding. Reuse the oldest and orphan
    // its tail, which is what a held burst on one gun does and what makes a
    // stream of ricochets overlap rather than cut each other off.
    return script.slots.reduce((a, b) => (a.since >= b.since ? a : b));
  }

  /**
   * Free a voice for a play that outbids something already running.
   *
   * The engine's own arbitration: `priority` decides, and between equals the
   * furthest from the listener loses, because that is the one whose loss is
   * least audible. A request that outbids nothing gets nothing — which is
   * also what a full hardware mixer does.
   */
  #steal(script, distance) {
    let victim = null;
    for (const other of this.scripts.values()) {
      for (const slot of other.slots) {
        if (!slot.audio.sources) continue;
        if (slot.priority > script.priority) continue;
        if (slot.priority === script.priority && slot.distance <= distance) continue;
        if (!victim || slot.priority < victim.priority
            || (slot.priority === victim.priority
                && slot.distance > victim.distance)) {
          victim = slot;
        }
      }
    }
    if (!victim) return false;
    victim.audio.silence();
    victim.since = Infinity;
    this.stolen += 1;
    return true;
  }

  #place(slot, dt) {
    slot.audio.update({
      dt,
      position: slot.position,
      quaternion: slot.quaternion,
      listenerPosition: this.listenerPosition,
      // An impact does not rev, dive or accelerate; the only control channel
      // an effect script reads is Distance, and Time off the patch clock.
      rpm: 0, speed: 0, acceleration: 0, diveAngle: 0,
    });
  }

  /** One frame. `listenerPosition` is where the camera's ear is. */
  update(dt, listenerPosition) {
    if (this.disposed) return;
    if (listenerPosition) {
      this.listenerPosition = {
        x: listenerPosition.x, y: listenerPosition.y, z: listenerPosition.z,
      };
    }
    const step = Math.max(dt || 0, 0);
    for (const script of this.scripts.values()) {
      for (const slot of script.slots) {
        slot.since += step;
        // An idle slot still gets a frame: its bus gain has to reach the
        // master it will play at, or the first round out of a cold slot comes
        // in under a ramp that has not finished.
        this.#place(slot, step);
      }
    }
  }

  /** Master gain, 0..1, from the page's sound checkbox and volume slider. */
  setMaster(value) {
    this.master = value;
    for (const script of this.scripts.values()) {
      for (const slot of script.slots) slot.audio.setMaster(value);
    }
  }

  /** Cut everything running without tearing the pool down (a level change). */
  silence() {
    for (const script of this.scripts.values()) {
      for (const slot of script.slots) {
        slot.audio.silence();
        slot.since = Infinity;
      }
    }
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const script of this.scripts.values()) {
      for (const slot of script.slots) slot.audio.dispose();
      script.slots.length = 0;
    }
    this.scripts.clear();
    this.bundles.clear();
  }

  /** What the pool is doing, for headless checks. */
  snapshot() {
    const scripts = [];
    for (const script of this.scripts.values()) {
      if (!script.slots.length) continue;
      scripts.push({
        script: script.script,
        hold: script.hold,
        priority: script.priority,
        slots: script.slots.length,
        plays: script.slots.reduce((n, s) => n + s.plays, 0),
        sources: script.slots.reduce((n, s) => n + s.audio.sources, 0),
      });
    }
    return {
      budget: this.budget,
      sources: this.sources,
      bundles: this.bundles.size,
      plays: this.plays,
      dropped: this.dropped,
      stolen: this.stolen,
      inaudible: this.inaudible,
      scripts,
    };
  }
}
