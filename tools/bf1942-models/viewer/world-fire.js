// Gunfire from anyone who is not the local player's own first-person ear.
//
// `playHandFire` is the shooter's path: one muzzle-audible sample, 2D, at the
// shoulder. That is right for the player and wrong for a bot across the field
// — the sample is the *near* pick of a patch whose far layers hand over on
// `Volume <- Distance`, and without them a distant BAR is either a full-volume
// crack in the ear or, once attenuated by a naive distance law, silence where
// the game still has a crackle.
//
// So this module plays the patch the way `vehicle-audio.js` plays a tank's
// coax: `loadEngineAudio` over the `layers` `extract_weapon_sounds` now ships
// beside the first-person pick, one pooled slot per weapon, spatialised at the
// shooter. The one twist is `loop: false` on every layer. A Fire Loop patch is
// authored as a held trigger's continuous rattle; `EngineAudio.trigger` skips
// loops on purpose (a gun's one-shots belong to a round). A bystander hears
// rounds, so each layer is forced to one cycle and every `play` is one
// `trigger` — the near and far samples still hand over on their Distance
// ramps, which is the whole point of shipping them.
//
// A manifest from before `layers` existed gets a single-layer patch built from
// its first-person pick plus a stand-in Distance ramp (see `FALLBACK_RAMP`).
// Attenuation is then the viewer's approximation rather than the script's own
// curve; the entry is marked `fallback: true` in the snapshot so a test can
// tell the two apart. Re-extract the armoury to get the real ramps.
//
// A pooled slot is held for as long as its round sounds: one cycle of a Fire
// Loop patch (every layer authored `loop`, the automatic weapons, whose cycle
// is one round of the rattle: `mp40mlp` 0.089 s against the Mp40's 0.111 s
// between rounds), a second for anything else (a report and its tail). The
// hold used to be a second for every patch, and `prime` never built a slot
// past the first, so a weapon was heard once a second however fast it fired:
// a bot's Mp40 fired 86 rounds in 9.8 s and 76 were dropped, which is the
// "bots fire one bullet at a time" of features/bot-weapons. Held for a cycle,
// one bot's burst plays every round out of one slot, and the pool grows to
// `PER_WEAPON` for that many shooters of the weapon at once.

import { loadEngineAudio, WEAPON_HEADROOM } from './engine-audio.js';

/**
 * A stand-in `Volume <- Distance` for a manifest with no `layers`.
 *
 * Full at the muzzle, gone at 80 m. Not the script's own curve — that is the
 * point of `layers` — but the shape a vanilla hand weapon's near layer
 * actually has (the BAR's near loop dies at 3 m and its far loop at 80), so a
 * tree that has not been re-extracted still behaves like a battlefield rather
 * than like a 2D overlay.
 */
export const FALLBACK_RAMP = { dest: 'volume', source: 'distance',
                               envelope: 'ramp', params: [0, 80, 1, -1] };

/** How many pooled shots per weapon: that many shooters of one weapon heard
 *  at once (a slot plays one shooter's rounds back to back). */
const PER_WEAPON = 3;

/** How long a slot is held after a round of a patch with any one-shot layer:
 *  a report's tail. A Fire Loop patch is held for its own cycle instead. */
const ONE_SHOT_HOLD = 1.0;

/** Past this, `play` drops the shot rather than steal. A firefight of ten
 *  bots must not stack thirty patches through the page's limiter. */
const MAX_LIVE_SHOTS = 12;

class Slot {
  constructor(audio) {
    this.audio = audio;
    this.busyUntil = 0;
    this._pos = { x: 0, y: 0, z: 0 };
    this._quat = { x: 0, y: 0, z: 0, w: 1 };
  }
}

export class WorldFire {
  /**
   * @param {object} opts
   * @param {() => object} opts.listener  `ensureListener()`
   * @param {(relPath: string) => Promise<AudioBuffer|null>} opts.getBuffer
   *   resolves a layer `file` against the sounds tree (`modelSoundBuffer`)
   * @param {object} opts.manifest  `weapons.json`
   * @param {() => number} opts.master  0..1
   * @param {() => number} [opts.rand]
   */
  constructor({ listener, getBuffer, manifest = null, master = () => 1,
                rand = Math.random, now = null }) {
    this.getListener = listener;
    this.getBuffer = getBuffer;
    this.getMaster = master;
    this.rand = rand;
    // Seconds, for the slots' holds; a test hands in its own clock.
    this.now = now ?? (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()) * 0.001);
    this.manifest = null;
    this.weapons = new Map();     // name -> { layers, fallback, slots, pending }
    this.shots = 0;
    this.dropped = 0;
    this.disposed = false;
    if (manifest) this.setManifest(manifest);
  }

  /** Adopt `weapons.json`. Decodes nothing until `prime` or the first shot. */
  setManifest(manifest) {
    this.manifest = manifest;
    this.weapons.clear();
    for (const [name, spec] of Object.entries(manifest?.weapons || {})) {
      const raw = spec?.layers?.length ? spec.layers : (spec?.file ? [{
        // A pre-`layers` manifest: the first-person pick as a single layer,
        // played once per round. `loop` is forced off below either way.
        file: spec.file,
        loop: !!spec.loop,
        volume: spec.volume ?? 1,
        minDistance: 2,
        priority: 0,
        trigger: null,
        stop: null,
        stereo: false,
        doppler: true,
        randomStartPitch: spec.randomStartPitch ?? null,
        relativePosition: null,
        modulators: [FALLBACK_RAMP],
      }] : null);
      if (!raw?.length) continue;
      // One cycle per round: see the module comment. Copied so the manifest
      // on disk keeps the script's own `loop` flag for anything else reading
      // it (the player's `playHandFire` still wants to know).
      const layers = raw.map(layer => ({ ...layer, loop: false }));
      this.weapons.set(name, {
        name,
        layers,
        fallback: !spec?.layers?.length,
        delay: spec?.delay ?? 0,
        // A Fire Loop patch: its slot is held one cycle, not a second.
        loopPatch: raw.every(layer => !!layer.loop),
        hold: null,
        slots: [],
        pending: null,
      });
    }
  }

  has(name) {
    return this.weapons.has(name);
  }

  /** Decode a weapon's samples and build its first pool slot. Fire-and-forget. */
  prime(name) {
    const entry = this.weapons.get(name);
    if (!entry || entry.slots.length || entry.pending || this.disposed) {
      return entry?.pending ?? Promise.resolve(entry ?? null);
    }
    return this.#extend(entry);
  }

  /** One more pool slot for `entry`, up to `PER_WEAPON`. */
  #extend(entry) {
    entry.pending = this.#grow(entry)
      .then(() => entry, () => null)
      .finally(() => { entry.pending = null; });
    return entry.pending;
  }

  async #grow(entry) {
    if (this.disposed || entry.slots.length >= PER_WEAPON) return null;
    const listener = this.getListener?.();
    if (!listener) return null;
    const buffers = new Map();
    for (const layer of entry.layers) {
      if (buffers.has(layer.file)) continue;
      buffers.set(layer.file, await this.getBuffer(layer.file));
    }
    if (this.disposed) return null;
    const layers = entry.layers.filter(l => buffers.get(l.file));
    if (!layers.length) return null;
    const audio = await loadEngineAudio(
      { template: entry.name, level: 'high', layers },
      {
        listener,
        getBuffer: async (relPath) => buffers.get(relPath) ?? this.getBuffer(relPath),
        headroom: WEAPON_HEADROOM,
        oneShotsOnTrigger: true,
        rand: this.rand,
      });
    if (!audio) return null;
    if (this.disposed) {
      audio.dispose();
      return null;
    }
    // The hold: a Fire Loop patch's longest cycle at its slowest start pitch
    // (`randomStartPitch` down), plus the patch's delay.
    if (entry.hold === null) {
      let cycle = 0;
      for (const layer of layers) {
        const down = layer.randomStartPitch?.[1] ?? 0;
        const duration = buffers.get(layer.file)?.duration ?? 0;
        cycle = Math.max(cycle, duration / Math.max(0.5, 1 - down));
      }
      entry.hold = (entry.loopPatch && cycle > 0 ? cycle : ONE_SHOT_HOLD) + (entry.delay || 0);
    }
    audio.setMaster(0);   // silent until a round asks for it
    // `start` is what primes the one-shot pool without playing anything: with
    // `oneShotsOnTrigger` every layer is non-loop after the force-off above,
    // so `start`'s "play the loops now" pass is empty and `trigger` is the
    // only thing that ever makes a noise.
    audio.start();
    const slot = new Slot(audio);
    entry.slots.push(slot);
    return slot;
  }

  /**
   * One round from `name` at `position` (world space, `{x,y,z}`).
   *
   * Fire-and-forget: a shot cannot wait on a decode, so the first round of a
   * weapon is silent and every one after it is not. `prime` ahead of the
   * fight when the shooter's weapon is already known.
   */
  play(name, position) {
    if (this.disposed || !name) return false;
    const entry = this.weapons.get(name);
    if (!entry) return false;
    this.shots += 1;
    const now = this.now();
    let slot = entry.slots.find(s => s.busyUntil <= now);
    if (!slot) {
      if (entry.slots.length < PER_WEAPON && !entry.pending) {
        this.#extend(entry);
      }
      this.dropped += 1;
      return false;
    }
    if (this.liveShots() >= MAX_LIVE_SHOTS) {
      this.dropped += 1;
      return false;
    }
    const listener = this.getListener?.();
    if (!listener) return false;
    if (position) {
      slot._pos.x = position.x; slot._pos.y = position.y; slot._pos.z = position.z;
    }
    slot.audio.setMaster(this.getMaster());
    slot.audio.update({
      dt: 0,
      position: slot._pos,
      quaternion: slot._quat,
      listenerPosition: this.listenerPosition ?? position ?? slot._pos,
    });
    const started = slot.audio.trigger();
    // Held while the round sounds (the header): a Fire Loop patch for one
    // cycle, so the shooter's next round takes the same slot; anything else
    // for a second, enough to keep a report's tail from being stolen.
    slot.busyUntil = now + (entry.hold ?? ONE_SHOT_HOLD + (entry.delay || 0));
    return started > 0;
  }

  liveShots() {
    const now = this.now();
    let n = 0;
    for (const entry of this.weapons.values()) {
      for (const slot of entry.slots) if (slot.busyUntil > now) n += 1;
    }
    return n;
  }

  /** One frame: pan every idle pool slot to its shooter and track the listener. */
  update(dt, listenerPosition) {
    if (this.disposed) return;
    if (listenerPosition) {
      this.listenerPosition = {
        x: listenerPosition.x, y: listenerPosition.y, z: listenerPosition.z,
      };
    }
    const master = this.getMaster();
    for (const entry of this.weapons.values()) {
      for (const slot of entry.slots) {
        slot.audio.setMaster(slot.busyUntil > 0 ? master : 0);
        slot.audio.update({
          dt,
          position: slot._pos,
          quaternion: slot._quat,
          listenerPosition: this.listenerPosition ?? slot._pos,
        });
      }
    }
  }

  dispose() {
    this.disposed = true;
    for (const entry of this.weapons.values()) {
      for (const slot of entry.slots) slot.audio.dispose();
      entry.slots = [];
    }
    this.weapons.clear();
  }

  /** What the pool is doing, for headless checks. */
  snapshot() {
    const weapons = [];
    for (const entry of this.weapons.values()) {
      weapons.push({
        name: entry.name,
        fallback: entry.fallback,
        layers: entry.layers.length,
        hold: entry.hold,
        slots: entry.slots.length,
        voices: entry.slots.reduce((n, s) => n + s.audio.voices, 0),
      });
    }
    return {
      weapons,
      shots: this.shots,
      dropped: this.dropped,
      live: this.liveShots(),
    };
  }
}
