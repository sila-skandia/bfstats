// Remaster audio (features/remaster-browser, AUDIO.md): the modern spatial
// chain every placed voice of the page goes through under `?remaster`.
//
// The retail chain stays what it was: DirectSound's amplitude pan at a render
// point (`ds3d-pan.js`), the script's own distance law, and nothing after the
// panner. This module changes none of that until `installRemasterAudio` is
// called, and `page-audio.js` calls it only when `REMASTER_AUDIO` is set
// (`remaster-mode.js`). Installed, it registers itself as `ds3d-pan.js`'s
// spatial hook, and from then on:
//
//   1. every panner `configureDs3dPanner` sets up stands at the voice's real
//      point, height and all, never at a render point, and pans with the
//      model the player's sound options choose (equal power, or the HRTF
//      head with HARDWARE ACCELERATION ticked);
//   2. whatever the panner is connected to, this module puts a voice chain
//      in between: air absorption (a low-pass whose cutoff falls with
//      distance), occlusion (a low-pass and a gain drop, smoothed, from
//      rays against the level's hulls and terrain), and a send into the
//      reverb;
//   3. the reverb is four convolvers, one impulse response per space (open
//      ground, woods, built-up, inside), generated at install from
//      `SPACE_IRS`, and crossfaded by a survey of the listener's
//      surroundings four times a second;
//   4. a soldier's report reaches the listener distance / 343 m/s after the
//      shot (`arrivalDelay`, which `world-fire.js` asks), and a supersonic
//      round that passes near the ear cracks where and when its shock cone
//      touches the ear (`roundFlown`, which `passing-rounds.js` calls).
//
// The chain is inserted by wrapping the panner's own `connect` and
// `disconnect`, so no caller changes how it builds or tears down its graph:
//
//   source -> gain -> panner -> air LP -> occlusion LP -> occlusion gain -> (the caller's node)
//                                  \-> wet (per voice, when the caller's node is the listener's input)
//   (the caller's node) -> tap -> reverb in      (any other node: a patch's bus, after its master)
//   reverb in -> send[space] -> convolver[space] -> return -> listener input
//
// The tap is taken after the caller's node when that node is anything but the
// listener's input, because the node is where a patch's master gain lives
// (`EngineAudio.bus`, a PositionalAudio's gain): a send before it would let a
// muted patch ring in the reverb.

import { configureDs3dPanner, setDs3dSpatialHook } from './ds3d-pan.js';
import {
  CRACK_REACH, OCCLUSION_TAU, OVER_LIFT, SPACES, SPACE_IRS, SPACE_TAU,
  airAbsorptionCutoff, classifySurroundings, crackArrival, crackGain, generateImpulse,
  nWave, occlusionFilter, occlusionFromRays, occlusionPriority, reportDelay, surveyProbe,
  wetSendFor,
} from './remaster-audio-law.js';

/** How often the surroundings are surveyed, Hz. */
export const SURVEY_HZ = 4;
/** How often the occlusion rays are spent, Hz, and how many voices a pass
 *  may ray (each takes one or two hull rays and a terrain march). */
export const OCCLUSION_HZ = 10;
export const OCCLUSION_VOICES = 6;
/** No hull ray past this, m (a terrain march still runs): the static grid's
 *  walk grows with length, and past it the air has taken the top off. */
export const OCCLUSION_RANGE = 300;
/** The reverb's overall return. */
export const REVERB_RETURN = 0.8;
/** The crack's level against the game's own mix. */
export const CRACK_LEVEL = 0.7;

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export class RemasterAudio {
  /**
   * @param {object} opts
   * @param {BaseAudioContext} opts.context
   * @param {AudioNode} opts.input  the listener's input: where the reverb
   *   returns and the node a voice's own wet send is taken for
   * @param {() => number} [opts.master]  0..1, for the crack
   */
  constructor({ context, input, master = () => 1 }) {
    this.ctx = context;
    this.input = input;
    this.master = master;
    this.voices = new Set();
    this.taps = new Map();
    this.ear = null;
    this.env = null;
    this.weights = { open: 1, woods: 0, builtup: 0, inside: 0 };
    this.target = { ...this.weights };
    this.lastProbe = null;
    this.sinceSurvey = Infinity;
    this.sinceOcclusion = Infinity;
    this.stats = { rays: 0, surveys: 0, occlusionPasses: 0, updateMs: 0, frames: 0, cracks: 0 };
    this.crackBuffers = new Map();
    this.disposed = false;
    this.#buildReverb();
    this.#buildBed();
  }

  // --- the reverb -------------------------------------------------------------

  #buildReverb() {
    const ctx = this.ctx;
    this.reverbIn = ctx.createGain();
    this.reverbOut = ctx.createGain();
    this.reverbOut.gain.value = REVERB_RETURN;
    this.reverbOut.connect(this.input);
    this.spaces = {};
    let seed = 11;
    for (const name of SPACES) {
      const [left, right] = generateImpulse(ctx.sampleRate, SPACE_IRS[name], seed++);
      const buffer = ctx.createBuffer(2, left.length, ctx.sampleRate);
      buffer.copyToChannel(left, 0);
      buffer.copyToChannel(right, 1);
      const conv = ctx.createConvolver();
      conv.normalize = false;
      conv.buffer = buffer;
      const send = ctx.createGain();
      send.gain.value = this.weights[name];
      this.reverbIn.connect(send);
      conv.connect(this.reverbOut);
      // A convolver with nothing to do still convolves: a space weighted to
      // nothing for longer than its tail is unplugged (`#gate`).
      const space = { send, conv, seconds: buffer.duration, connected: false, idle: 0 };
      this.spaces[name] = space;
      if (this.weights[name] > 0) { send.connect(conv); space.connected = true; }
    }
  }

  #gate(dt) {
    for (const name of SPACES) {
      const space = this.spaces[name];
      const w = this.weights[name];
      if (w > 1e-3) {
        space.idle = 0;
        if (!space.connected) { space.send.connect(space.conv); space.connected = true; }
      } else if (space.connected) {
        space.idle += dt;
        if (space.idle > space.seconds + 0.5) {
          try { space.send.disconnect(space.conv); } catch (_) {}
          space.connected = false;
        }
      }
    }
  }

  // --- the 2D bed ---------------------------------------------------------------

  /** The level's wind bed is a 2D voice with no place: under a roof it is
   *  the wind outside, muffled; among buildings and trees, a little less of
   *  it. Two nodes for three's `Audio.setFilters`. */
  #buildBed() {
    this.bedLow = this.ctx.createBiquadFilter();
    this.bedLow.type = 'lowpass';
    this.bedLow.frequency.value = 20000;
    this.bedLow.Q.value = 0.5;
    this.bedGain = this.ctx.createGain();
    this.bedLow.connect(this.bedGain);
  }

  bedFilters() { return [this.bedLow, this.bedGain]; }

  // --- voices -------------------------------------------------------------------

  /** `ds3d-pan.js` hands every configured panner here. */
  adopt(panner) {
    if (!panner || panner.__remaster || this.disposed) return panner;
    if (panner.context && panner.context !== this.ctx) return panner;
    if (typeof panner.connect !== 'function') return panner;
    const self = this;
    const connect = panner.connect;
    const disconnect = panner.disconnect;
    const voice = {
      panner, air: null, occ: null, gain: null, wet: null, tap: null, dests: [],
      occlusion: 0, occlusionTarget: 0, rayAge: Infinity, distance: 0, audible: 1,
      cutoff: -1, wetLevel: -1, pos: { x: NaN, y: NaN, z: NaN },
    };
    panner.__remaster = voice;
    this.#watch(voice);
    panner.connect = function remasterConnect(dest, ...rest) {
      // An AudioParam has no `connect`: a modulation edge, left alone.
      if (!dest || typeof dest.connect !== 'function' || self.disposed) {
        return connect.call(panner, dest, ...rest);
      }
      if (!voice.air) {
        self.#build(voice);
        connect.call(panner, voice.air);
      }
      voice.gain.connect(dest, 0, rest[1] ?? 0);
      self.#bind(voice, dest);
      return dest;
    };
    panner.disconnect = function remasterDisconnect(...args) {
      if (args.length === 0) self.#release(voice);
      return disconnect.apply(panner, args);
    };
    return panner;
  }

  /** `ds3d-pan.js` hands the real point of a voice whose panner stands at
   *  its render point (`ds3dTruePoint`), after the panner was put there: the
   *  chain's distance and rays are the real point's. */
  place(panner, x, y, z, snap = false) {
    const voice = panner?.__remaster;
    if (!voice || this.disposed) return;
    voice.pos.x = x; voice.pos.y = y; voice.pos.z = z;
    if (voice.air) this.#place(voice, snap);
  }

  /**
   * Hear where the caller puts the panner, as it puts it. A position param's
   * `.value` reads back the last rendered quantum's, so a pooled slot moved
   * from one shooter to the next this frame would be filtered for the last
   * one's distance through the new report's transient. A jump (`.value =`,
   * `setValueAtTime`: a new source, `snap`) re-places the chain at once; a
   * ramp (a moving source) is only noted, for the next frame.
   */
  #watch(voice) {
    const self = this;
    const p = voice.panner;
    for (const [axis, param] of [['x', p.positionX], ['y', p.positionY], ['z', p.positionZ]]) {
      if (!param) continue;
      const set = param.setValueAtTime;
      const ramp = param.linearRampToValueAtTime;
      if (typeof set === 'function') {
        param.setValueAtTime = function remasterSet(v, t) {
          voice.pos[axis] = v;
          const out = set.call(param, v, t);
          if (voice.air) self.#place(voice, true);
          return out;
        };
      }
      if (typeof ramp === 'function') {
        param.linearRampToValueAtTime = function remasterRamp(v, t) {
          voice.pos[axis] = v;
          return ramp.call(param, v, t);
        };
      }
      const desc = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(param) ?? {}, 'value');
      if (desc?.get && desc?.set) {
        Object.defineProperty(param, 'value', {
          configurable: true,
          get() { return desc.get.call(param); },
          set(v) {
            voice.pos[axis] = v;
            desc.set.call(param, v);
            if (voice.air) self.#place(voice, true);
          },
        });
      }
    }
  }

  /** A panner something connected before it was adopted (three's
   *  PositionalAudio wires its own panner to its gain in its constructor):
   *  wire it again through the chain. */
  reroute(panner, dest) {
    if (!panner?.__remaster || !dest) return;
    try { panner.disconnect(); } catch (_) {}
    panner.connect(dest);
  }

  #build(voice) {
    const ctx = this.ctx;
    voice.air = ctx.createBiquadFilter();
    voice.air.type = 'lowpass';
    // Butterworth: -3 dB at the cutoff, flat below it. At Q 0.5 the corner
    // is -6 dB and the slope starts an octave early, which dulled every
    // voice past 15 m twice what the law asks.
    voice.air.Q.value = Math.SQRT1_2;
    voice.air.frequency.value = 20000;
    voice.occ = ctx.createBiquadFilter();
    voice.occ.type = 'lowpass';
    voice.occ.Q.value = 0.5;
    voice.occ.frequency.value = 20000;
    voice.gain = ctx.createGain();
    voice.air.connect(voice.occ);
    voice.occ.connect(voice.gain);
  }

  #bind(voice, dest) {
    voice.dests.push(dest);
    if (dest === this.input) {
      if (!voice.wet) {
        voice.wet = this.ctx.createGain();
        voice.wet.gain.value = 0;
        voice.air.connect(voice.wet);
        voice.wet.connect(this.reverbIn);
      }
    } else if (!voice.tap) {
      let tap = this.taps.get(dest);
      if (!tap) {
        tap = { node: this.ctx.createGain(), count: 0, dest, level: -1 };
        tap.node.gain.value = 0;
        dest.connect(tap.node);
        tap.node.connect(this.reverbIn);
        this.taps.set(dest, tap);
      }
      tap.count += 1;
      voice.tap = tap;
    }
    this.voices.add(voice);
    this.#place(voice, true);
  }

  #release(voice) {
    if (!this.voices.has(voice) && !voice.air) return;
    this.voices.delete(voice);
    for (const node of [voice.air, voice.occ, voice.gain, voice.wet]) {
      try { node?.disconnect(); } catch (_) {}
    }
    voice.air = voice.occ = voice.gain = voice.wet = null;
    voice.dests = [];
    const tap = voice.tap;
    voice.tap = null;
    if (tap && --tap.count <= 0) {
      try { tap.dest.disconnect(tap.node); } catch (_) {}
      try { tap.node.disconnect(); } catch (_) {}
      this.taps.delete(tap.dest);
    }
  }

  /** A bus of 2D voices the listener carries (the player's own hand
   *  weapon): into the reverb at the near send, after its master. */
  tapBus(node) {
    if (!node || this.taps.has(node) || this.disposed) return;
    const tap = { node: this.ctx.createGain(), count: Infinity, dest: node, level: wetSendFor(1.5) };
    tap.node.gain.value = tap.level;
    node.connect(tap.node);
    tap.node.connect(this.reverbIn);
    this.taps.set(node, tap);
  }

  /** Where a voice stands, from its panner's own position params. */
  #where(voice) {
    const at = voice.pos;
    if (Number.isFinite(at.x) && Number.isFinite(at.y) && Number.isFinite(at.z)) return at;
    const p = voice.panner;
    if (!p.positionX) return null;
    return { x: p.positionX.value, y: p.positionY.value, z: p.positionZ.value };
  }

  #place(voice, snap = false) {
    const at = this.#where(voice);
    const ear = this.ear;
    if (at && ear) {
      voice.at = at;
      voice.distance = Math.hypot(at.x - ear.x, at.y - ear.y, at.z - ear.z);
    }
    const t = this.ctx.currentTime;
    const cutoff = airAbsorptionCutoff(voice.distance);
    if (snap || Math.abs(cutoff - voice.cutoff) > voice.cutoff * 0.03) {
      setParam(voice.air.frequency, cutoff, t, snap ? 0 : 0.05);
      voice.cutoff = cutoff;
    }
    const filter = occlusionFilter(voice.occlusion);
    setParam(voice.occ.frequency, filter.cutoff, t, snap ? 0 : 0.03);
    setParam(voice.gain.gain, filter.gain, t, snap ? 0 : 0.03);
    // The reverb hears round a wall the dry sound does not: the send drops
    // by half what the dry drops (per voice), or a tap after the bus gives
    // back half of what the occlusion took.
    const wet = wetSendFor(voice.distance);
    if (voice.wet) {
      const level = wet * (1 - 0.5 * voice.occlusion);
      if (snap || Math.abs(level - voice.wetLevel) > 0.005) {
        setParam(voice.wet.gain, level, t, snap ? 0 : 0.05);
        voice.wetLevel = level;
      }
    } else if (voice.tap) {
      const level = wet * (1 + 0.5 * voice.occlusion);
      // A new source: the tap is this one's now, not eased from the last.
      if (snap) {
        setParam(voice.tap.node.gain, level, t, 0);
        voice.tap.level = level;
      }
      // One tap, many voices (a patch's groups): the nearest decides.
      if (voice.tap.frameLevel == null || voice.distance < voice.tap.frameDistance) {
        voice.tap.frameLevel = level;
        voice.tap.frameDistance = voice.distance;
      }
    }
  }

  // --- the frame --------------------------------------------------------------------

  /**
   * One frame. `ear` the camera's world point; `env` the level's queries
   * (`remaster-audio-world.js` `remasterWorld`): `castHull`, `groundAt`,
   * `trees`. Either may be null (no level yet): the chain still runs.
   */
  update(dt, ear, env = null) {
    if (this.disposed) return;
    const t0 = now();
    const step = Math.max(0, dt || 0);
    if (ear) this.ear = { x: ear.x, y: ear.y, z: ear.z };
    this.env = env;
    for (const tap of this.taps.values()) { tap.frameLevel = null; tap.frameDistance = Infinity; }

    // Occlusion: a budget of rays, spent on the voices that matter most.
    this.sinceOcclusion += step;
    if (this.ear && env && this.sinceOcclusion >= 1 / OCCLUSION_HZ) {
      this.#occlusionPass(this.sinceOcclusion === Infinity ? 0 : this.sinceOcclusion);
      this.sinceOcclusion = 0;
    }
    const k = step > 0 ? 1 - Math.exp(-step / OCCLUSION_TAU) : 0;
    for (const voice of this.voices) {
      const dest = voice.dests[0];
      voice.audible = dest === this.input ? 1 : Math.abs(dest?.gain?.value ?? 1);
      voice.occlusion += (voice.occlusionTarget - voice.occlusion) * k;
      this.#place(voice);
    }
    const ct = this.ctx.currentTime;
    for (const tap of this.taps.values()) {
      if (tap.frameLevel == null) continue;
      if (Math.abs(tap.frameLevel - tap.level) > 0.005) {
        setParam(tap.node.gain, tap.frameLevel, ct, 0.02);
        tap.level = tap.frameLevel;
      }
    }

    // Surroundings: a survey four times a second, the reverb eased after it.
    this.sinceSurvey += step;
    if (this.ear && env && this.sinceSurvey >= 1 / SURVEY_HZ) {
      this.sinceSurvey = 0;
      this.lastProbe = this.#counted(() => surveyProbe(this.ear, env));
      this.target = classifySurroundings(this.lastProbe);
      this.stats.surveys += 1;
    }
    const ks = step > 0 ? 1 - Math.exp(-step / SPACE_TAU) : 1;
    let logF = 0, gain = 0;
    const bed = { open: [20000, 1], woods: [9000, 0.9], builtup: [14000, 0.85], inside: [1400, 0.5] };
    for (const name of SPACES) {
      this.weights[name] += (this.target[name] - this.weights[name]) * ks;
      setParam(this.spaces[name].send.gain, this.weights[name], ct, 0.05);
      logF += this.weights[name] * Math.log(bed[name][0]);
      gain += this.weights[name] * bed[name][1];
    }
    setParam(this.bedLow.frequency, Math.exp(logF), ct, 0.1);
    setParam(this.bedGain.gain, gain, ct, 0.1);
    this.#gate(step);
    this.stats.frames += 1;
    this.stats.updateMs += now() - t0;
  }

  /** Count the hull rays a query spends (the caller's `castHull` wrapper
   *  bumps `env.rays`). */
  #counted(fn) {
    const env = this.env;
    const before = env?.rays ?? 0;
    const out = fn();
    this.stats.rays += (env?.rays ?? 0) - before;
    return out;
  }

  #occlusionPass(elapsed) {
    const env = this.env;
    const ear = this.ear;
    const ranked = [];
    for (const voice of this.voices) {
      voice.rayAge = Number.isFinite(voice.rayAge) ? voice.rayAge + elapsed : 1;
      // A voice at the ear (an attached cockpit layer, the listener's own
      // hull) is never behind anything.
      if (!voice.at || voice.distance < 2) { voice.occlusionTarget = 0; continue; }
      const score = occlusionPriority(voice.audible, voice.distance, voice.rayAge);
      if (score > 0) ranked.push([score, voice]);
    }
    ranked.sort((a, b) => b[0] - a[0]);
    this.stats.occlusionPasses += 1;
    this.#counted(() => {
      for (let i = 0; i < ranked.length && i < OCCLUSION_VOICES; i++) {
        const voice = ranked[i][1];
        voice.rayAge = 0;
        voice.occlusionTarget = this.occlusionOf(ear, voice.at, env);
      }
    });
  }

  /** 0..1 for a source at `at` heard from `ear`: terrain first (a march),
   *  then the hulls (a straight ray, and one over the source when it hits). */
  occlusionOf(ear, at, env) {
    const dx = at.x - ear.x, dy = at.y - ear.y, dz = at.z - ear.z;
    const d = Math.hypot(dx, dy, dz);
    if (!(d > 2)) return 0;
    if (env.groundAt && terrainBlocks(ear, at, env.groundAt)) return 1;
    if (!env.castHull || d > OCCLUSION_RANGE) return 0;
    // Short of the source by its own size: a hull's voice stands inside it.
    const reach = d - Math.min(4, d * 0.3);
    const direct = env.castHull(ear.x, ear.y, ear.z, dx / d, dy / d, dz / d, reach) != null;
    if (!direct) return 0;
    const oy = dy + OVER_LIFT;
    const od = Math.hypot(dx, oy, dz);
    const over = env.castHull(ear.x, ear.y, ear.z, dx / od, oy / od, dz / od, od - Math.min(4, od * 0.3)) != null;
    return occlusionFromRays(true, over);
  }

  // --- gunfire ------------------------------------------------------------------------

  /** Seconds a report fired at `position` takes to reach the ear. */
  arrivalDelay(position) {
    const ear = this.ear;
    if (!ear || !position) return 0;
    return reportDelay(Math.hypot(position.x - ear.x, position.y - ear.y, position.z - ear.z));
  }

  /**
   * A round left `origin` along unit `dir` at `speed` m/s for `length` m:
   * if its shock passes the ear within `CRACK_REACH`, crack there and then.
   * Returns the scheduled crack ({ when, miss, emit }) or null.
   */
  roundFlown(origin, dir, speed, length) {
    const ear = this.ear;
    if (!ear || this.disposed || !origin || !dir) return null;
    const vx = ear.x - origin[0], vy = ear.y - origin[1], vz = ear.z - origin[2];
    const along = vx * dir[0] + vy * dir[1] + vz * dir[2];
    const miss = Math.hypot(vx - dir[0] * along, vy - dir[1] * along, vz - dir[2] * along);
    if (!(miss <= CRACK_REACH)) return null;
    const arrival = crackArrival(along, miss, speed, length);
    if (!arrival) return null;
    const level = crackGain(miss) * CRACK_LEVEL * this.master();
    if (!(level > 0)) return null;
    const ctx = this.ctx;
    const bucket = Math.min(32, 2 ** Math.round(Math.log2(Math.max(1, miss))));
    let buffer = this.crackBuffers.get(bucket);
    if (!buffer) {
      const data = nWave(ctx.sampleRate, bucket);
      buffer = ctx.createBuffer(1, data.length, ctx.sampleRate);
      buffer.copyToChannel(data, 0);
      this.crackBuffers.set(bucket, buffer);
    }
    const when = ctx.currentTime + arrival.time;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const gain = ctx.createGain();
    gain.gain.value = level;
    const panner = ctx.createPanner();
    configureDs3dPanner(panner);
    panner.distanceModel = 'inverse';
    panner.rolloffFactor = 0;
    // From where the shock left the line: up-range of the ear, toward the gun.
    const ex = origin[0] + dir[0] * arrival.emit;
    const ey = origin[1] + dir[1] * arrival.emit;
    const ez = origin[2] + dir[2] * arrival.emit;
    if (panner.positionX) {
      panner.positionX.value = ex; panner.positionY.value = ey; panner.positionZ.value = ez;
    } else {
      panner.setPosition?.(ex, ey, ez);
    }
    source.connect(gain);
    gain.connect(panner);
    panner.connect(this.input);
    source.onended = () => {
      try { source.disconnect(); gain.disconnect(); panner.disconnect(); } catch (_) {}
    };
    try { source.start(when); } catch (_) { return null; }
    this.stats.cracks += 1;
    return { when, miss, emit: arrival.emit, time: arrival.time };
  }

  // --- the rest ---------------------------------------------------------------------

  snapshot() {
    const frames = Math.max(1, this.stats.frames);
    return {
      context: this.ctx.state,
      voices: this.voices.size,
      taps: this.taps.size,
      weights: { ...this.weights },
      target: { ...this.target },
      probe: this.lastProbe,
      convolvers: SPACES.filter(n => this.spaces[n].connected),
      rays: this.stats.rays,
      surveys: this.stats.surveys,
      occlusionPasses: this.stats.occlusionPasses,
      cracks: this.stats.cracks,
      msPerFrame: this.stats.updateMs / frames,
      occluded: [...this.voices].filter(v => v.occlusion > 0.05).length,
    };
  }

  /** Reset the per-frame cost counters (a measurement's window). */
  resetStats() {
    Object.assign(this.stats, { rays: 0, surveys: 0, occlusionPasses: 0, updateMs: 0, frames: 0 });
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const voice of [...this.voices]) this.#release(voice);
    for (const tap of this.taps.values()) {
      try { tap.dest.disconnect(tap.node); } catch (_) {}
      try { tap.node.disconnect(); } catch (_) {}
    }
    this.taps.clear();
    try { this.reverbOut.disconnect(); } catch (_) {}
  }
}

/** Is the ground above the straight line from `a` to `b` anywhere along it?
 *  Sixteen samples (a hill, not a kerb: half a metre of slack). */
export function terrainBlocks(a, b, groundAt, samples = 16) {
  for (let i = 1; i < samples; i++) {
    const t = i / samples;
    const g = groundAt(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t);
    if (Number.isFinite(g) && g > a.y + (b.y - a.y) * t + 0.5) return true;
  }
  return false;
}

function setParam(param, value, t, tau) {
  if (!param || !Number.isFinite(value)) return;
  if (!(tau > 0)) {
    param.cancelScheduledValues?.(t);
    param.setValueAtTime(value, t);
  } else {
    param.setTargetAtTime(value, t, tau);
  }
}

let installed = null;

/** Build the chain on `context` and make it `ds3d-pan.js`'s spatial hook.
 *  Every panner configured from then on is adopted. */
export function installRemasterAudio(opts) {
  if (installed && installed.ctx === opts.context && !installed.disposed) return installed;
  installed?.dispose();
  installed = new RemasterAudio(opts);
  setDs3dSpatialHook(installed);
  // For a headless check: `__remasterAudio()?.snapshot()`.
  if (typeof window !== 'undefined') window.__remasterAudio = () => remasterAudio();
  return installed;
}

/** Back to the retail chain (a harness's A/B; the page never calls it). */
export function uninstallRemasterAudio() {
  installed?.dispose();
  installed = null;
  setDs3dSpatialHook(null);
}

/** The installed chain, or null under the retail build. */
export function remasterAudio() {
  return installed && !installed.disposed ? installed : null;
}
