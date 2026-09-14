// The engine note of a flown vehicle, played from its own `.ssc`.
//
// A Refractor engine sound is not a sample that gets louder. It is a stack of
// loops that crossfade and re-pitch against one normalised control channel,
// `Engine::Rpm`, and the crossfade is authored data rather than engine
// behaviour: `Objects/Vehicles/Air/Corsair/Sounds/EngineLow.ssc` says in so
// many words that `mstngnrun` fades 1 -> 0 over Rpm 0 -> 0.6 while
// `mstngnrunmed` rises over the same span and falls again by 0.99, and that
// each layer sweeps its own sample from playback rate 0.70 to 1.00 across its
// own band. At a handover the outgoing layer is at rate 1.0 and the incoming
// one restarts the climb near 0.8, which is the gear-change-like rise you hear
// when a Corsair spools up.
//
// So this module hard-codes none of those numbers. `extract_map.py` ships the
// parsed script — every layer with its own modulator list — and the code below
// evaluates the same curves the engine evaluates. A Zero, a Sherman or a
// destroyer needs no new code here, only its own `.ssc`; and when the data says
// something surprising (the Corsair's right cockpit layer pitches off
// *acceleration*, not speed) the surprise survives the trip instead of being
// smoothed away by a reimplementation.
//
// Three rules carried over from the map-ambience "hall echo" postmortem
// (`features/bf1942-3d-models/map-sounds.md`, commit 319a794), because every
// one of them is a way for layered loops to go wrong:
//
//   1. One decode per wav. The caller passes its own cache-keyed loader; two
//      decodes of one file start 50-200 ms apart and read as slapback.
//   2. One voice per role, created once. The core loops never stop while the
//      engine runs — muting a layer with `stop()` and restarting it later
//      desyncs its loop phase against the others and combs on the way back in.
//      Gain is the only mute.
//   3. Nothing starts during an async gap. Loading is inert; `start()` is a
//      separate, synchronous call the caller makes only after checking that its
//      own generation counter still holds.

/** Linear interpolation clamped to 0..1, the shape every `.ssc` ramp has. */
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * `Ramp p1 p2 p3 p4`: `p3` at or below p1, `p3 + p4` at or above p2, linear
 * between. `p4` is signed, so a fade-out is a negative delta rather than a
 * reversed pair, and `p1 == p2` is a step. Six-param ramps occur (573 in
 * vanilla); the surplus pair's meaning is unresolved and treating them as
 * four-param reproduces the audible design, so it is ignored here too.
 */
function rampAt(params, x) {
  const [a = 0, b = 0, base = 0, delta = 0] = params;
  if (x <= a) return base;
  if (x >= b) return base + delta;
  const span = b - a;
  return span <= 0 ? base + delta : base + delta * ((x - a) / span);
}

/** `Linear p1 p2`: `p1 + p2 * x`. With source Default and p2 = 0, a constant. */
function linearAt(params, x) {
  return (params[0] ?? 0) + (params[1] ?? 0) * x;
}

/**
 * The runtime value of a `controlSource`, or null when we cannot supply it.
 *
 * Null matters: an unknown source must leave the destination alone rather than
 * evaluate its ramp at zero, which for a rising volume ramp would silence the
 * layer outright. `TimeRelease` is null until the patch is actually released
 * for the same reason — its ramp is a 1 -> 0 fade that would otherwise be sat
 * at full attenuation the whole time the engine is running.
 */
function controlValue(source, c) {
  switch (source) {
    case 'engine::rpm': return c.rpm;
    case 'engine::diveangle': return c.diveAngle;
    case 'speed': return c.speed;
    case 'acceleration': return c.acceleration;
    case 'distance': return c.distance;
    case 'time': return c.time;
    case 'timerelease': return c.released ? c.timeRelease : null;
    // `Default` is a constant for the one-shot idiom; the handful of car
    // scripts that ramp on it are unresolved and none of them are vehicles the
    // viewer flies.
    case 'default': return 1;
    default: return null;
  }
}

function modulate(modulators, c, initial) {
  let out = initial;
  for (const m of modulators) {
    const x = controlValue(m.source, c);
    if (x === null || x === undefined) continue;
    out *= m.envelope === 'linear' ? linearAt(m.params, x) : rampAt(m.params, x);
  }
  return out;
}

// Worst-case concurrent layer sum for a Corsair at full throttle heard from
// the cockpit: hi 1.0 + veadaurun 0.5 + prop 1.0 + two cockpit whines at
// 0.8 x 0.8 ~= 3.8. The .ssc mix is authored against a game mixer with its own
// headroom; a Web Audio graph summing straight into the destination would clip
// flat. Scaling the whole bus keeps every per-voice gain reporting the value
// its script asks for, which is what makes the crossfade checkable.
const BUS_HEADROOM = 0.28;

// A gun patch is a far shorter stack and needs its own figure, or the engine's
// eleven-layer divisor would bury it. `CorsairMG.ssc` has four layers split
// into a near pair and a far pair by their own `Volume <- Distance` ramps, so
// only two are ever up: CAMG1 + CAMG2 at 0.7 each in the cockpit, the two
// distant layers at 1.0 each outside 4 m. 0.75 puts the close pair's 1.4 at
// 1.05 — level with what the engine bus peaks at, which for something as
// transient as gunfire is what makes it read as sitting on top of the engine
// rather than under it.
export const WEAPON_HEADROOM = 0.75;

// Speed of sound, m/s, for the doppler shift the engine loops keep (they are
// the samples that pointedly do *not* set `dopplerOff`; gunfire and the
// start/stop one-shots do). Clamped hard: a hard manoeuvre past the listener
// otherwise chipmunks the whole mix for a frame.
const SPEED_OF_SOUND = 340;
const DOPPLER_MIN = 0.85;
const DOPPLER_MAX = 1.2;

// De-zippering time constants. Gain moves quickly; pitch is deliberately
// slower, echoing the engine's global `Sound.setPitchChangeRate 15`, which
// slews pitch no matter what a script asks for.
const GAIN_TAU = 0.05;
const PITCH_TAU = 0.1;

// Below this an AudioParam write is not worth an automation event.
const EPSILON = 1e-4;

/** One `load` from the script: a buffer, a gain, and where it points. */
class Voice {
  constructor(ctx, layer, buffer, panner) {
    this.layer = layer;
    this.buffer = buffer;
    this.panner = panner;
    this.gain = ctx.createGain();
    this.gain.gain.value = 0;
    this.gain.connect(panner);
    this.source = null;
    this.volumeMods = (layer.modulators || []).filter(m => m.dest === 'volume');
    this.pitchMods = (layer.modulators || []).filter(m => m.dest === 'pitch');
    // `randomStartPitch a/b` is a two-sided per-play pitch offset, and it is
    // DICE's own anti-phasing fix: without it two Corsairs running the same
    // loop lock together and flange instead of beating like two engines.
    const [up = 0, down = 0] = layer.randomStartPitch || [];
    this.jitter = 1 + (Math.random() * (up + down) - down);
    this.targetGain = 0;
    this.targetRate = 1;
  }

  get playing() {
    return this.source !== null;
  }
}

/**
 * A running engine patch: its voices, its panners, and the clock it modulates
 * against.
 *
 * Construction builds the graph but starts nothing, so a superseded load can be
 * thrown away without ever having made a sound.
 */
export class EngineAudio {
  constructor(spec, layers, buffers, listener, headroom = BUS_HEADROOM) {
    this.spec = spec;
    this.headroom = headroom;
    this.listener = listener;
    this.ctx = listener.context;
    this.disposed = false;
    this.started = false;
    this.released = false;
    this.master = 0;
    // The patch clock is the simulation clock, not `ctx.currentTime`. The two
    // diverge whenever the context is suspended — which is exactly the state
    // the page is in before the user has clicked anything — and a `Time` attack
    // ramp read off a frozen clock would hold every layer at zero forever.
    this.elapsed = 0;
    this.sinceRelease = 0;

    this.bus = this.ctx.createGain();
    this.bus.gain.value = 0;
    this.bus.connect(listener.getInput());

    // One panner per distinct `relativePosition`. The Corsair's eleven layers
    // collapse to three: nine at the engine node and the two cockpit whines at
    // +-0.9 m, which is the stereo width you hear in first person.
    this.groups = new Map();
    this.voices = [];
    for (const layer of layers) {
      const offset = layer.relativePosition || [0, 0, 0];
      const key = offset.join(',');
      let group = this.groups.get(key);
      if (!group) {
        const panner = this.ctx.createPanner();
        panner.panningModel = 'HRTF';
        panner.distanceModel = 'inverse';
        panner.refDistance = layer.minDistance || 1;
        // The script's own `Volume <- Distance` ramp owns distance volume
        // exclusively, exactly as the map's area sounds do. Leaving the
        // panner's inverse curve on would attenuate a second time, on a
        // different law, and the two would disagree about where a plane
        // becomes inaudible. Panning is for direction only.
        panner.rolloffFactor = 0;
        panner.connect(this.bus);
        group = { panner, offset, distance: 0, radial: 0, primed: false };
        this.groups.set(key, group);
      }
      // refDistance tracks the nearest layer in the group; inert while
      // rolloffFactor is 0, but it keeps the node honest if that ever changes.
      group.panner.refDistance = Math.min(group.panner.refDistance,
                                          layer.minDistance || 1);
      const voice = new Voice(this.ctx, layer, buffers.get(layer.file), group.panner);
      voice.group = group;
      this.voices.push(voice);
    }
  }

  /**
   * Trigger the patch: every loop starts now and keeps running until dispose.
   *
   * All loops share one start time so their phases are fixed relative to each
   * other, and each gets a random offset into its own buffer so two aircraft
   * are never phase-locked. Layers that declare `trigger Release` are the
   * shut-down sounds and wait for `release()`.
   */
  start() {
    if (this.started || this.disposed) return;
    this.started = true;
    const t0 = this.ctx.currentTime;
    for (const voice of this.voices) {
      if (voice.layer.trigger === 'release') continue;
      this.#play(voice, t0);
    }
  }

  #play(voice, when) {
    if (!voice.buffer || voice.source) return;
    const source = this.ctx.createBufferSource();
    source.buffer = voice.buffer;
    source.loop = !!voice.layer.loop;
    source.playbackRate.value = voice.targetRate;
    source.connect(voice.gain);
    // A loop starts at a random point in its own buffer; a one-shot has to
    // start at its beginning or the starter cough loses its transient.
    const offset = source.loop ? Math.random() * voice.buffer.duration : 0;
    try {
      source.start(when, offset);
    } catch (_) {
      return;
    }
    voice.source = source;
    if (!source.loop) {
      source.onended = () => {
        if (voice.source === source) voice.source = null;
      };
    }
  }

  /** Master gain, 0..1, from the viewer's sound checkbox and volume slider. */
  setMaster(value) {
    this.master = value;
  }

  /**
   * One frame.
   *
   * `control` is everything the script's control sources need, in the units the
   * `.ssc` uses: `rpm` normalised 0..1 (engine rotation over `maxRotation.roll`
   * = 5000, which for the viewer's flight model is the already-spooled
   * `state.throttle` rather than the stick), `speed` and `acceleration` in m/s
   * and m/s^2, `diveAngle` normalised, and the source and listener positions in
   * world space.
   */
  update(control) {
    if (this.disposed) return;
    const dt = Math.max(control.dt || 0, 0);
    this.elapsed += dt;
    if (this.released) this.sinceRelease += dt;

    const { position, quaternion, listenerPosition } = control;
    const now = this.ctx.currentTime;

    for (const group of this.groups.values()) {
      const [ox, oy, oz] = group.offset;
      // Rotate the voice offset into world space by the vehicle's orientation.
      // Done by hand rather than through a Vector3 so a frame costs no
      // allocations, and because this module deliberately owes three.js
      // nothing but the listener.
      let wx = position.x, wy = position.y, wz = position.z;
      if (ox || oy || oz) {
        const { x: qx, y: qy, z: qz, w: qw } = quaternion;
        const tx = 2 * (qy * oz - qz * oy);
        const ty = 2 * (qz * ox - qx * oz);
        const tz = 2 * (qx * oy - qy * ox);
        wx += ox + qw * tx + qy * tz - qz * ty;
        wy += oy + qw * ty + qz * tx - qx * tz;
        wz += oz + qw * tz + qx * ty - qy * tx;
      }
      const dx = wx - listenerPosition.x;
      const dy = wy - listenerPosition.y;
      const dz = wz - listenerPosition.z;
      const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
      // Radial velocity from the change in distance rather than from the two
      // velocity vectors: it is one subtraction, and it picks up a moving
      // listener for free. The first frame has no previous distance to
      // difference against — taking it against the initial zero reads as a
      // 250 m/s recession and starts every layer a clamped doppler minimum
      // below pitch, which is audible as a lurch on engine start.
      group.radial = dt > 0 && group.primed ? (distance - group.distance) / dt : 0;
      group.primed = true;
      group.distance = distance;
      this.#placePanner(group.panner, wx, wy, wz, now);
    }

    const base = {
      rpm: clamp01(control.rpm ?? 0),
      speed: control.speed ?? 0,
      acceleration: control.acceleration ?? 0,
      diveAngle: clamp01(control.diveAngle ?? 0),
      time: this.elapsed,
      timeRelease: this.sinceRelease,
      released: this.released,
      distance: 0,
    };
    const master = this.master;

    for (const voice of this.voices) {
      base.distance = voice.group.distance;
      const volume = modulate(voice.volumeMods, base, voice.layer.volume ?? 1);
      let rate = modulate(voice.pitchMods, base, 1) * voice.jitter;
      if (voice.layer.doppler) {
        const shift = SPEED_OF_SOUND / (SPEED_OF_SOUND + voice.group.radial);
        rate *= Math.min(DOPPLER_MAX, Math.max(DOPPLER_MIN, shift));
      }
      voice.targetGain = Math.max(0, volume);
      voice.targetRate = Math.max(0.05, rate);

      // `trigger Volume` is the delayed-start gate: the sample waits until its
      // computed volume first goes non-zero. Vanilla uses it with step `Time`
      // ramps to delay distant explosion layers by the speed of sound.
      if (!voice.source && voice.layer.trigger === 'volume'
          && voice.targetGain > 0 && this.started && !this.released) {
        this.#play(voice, now);
      }

      this.#ramp(voice.gain.gain, voice.targetGain, now, GAIN_TAU);
      if (voice.source) {
        this.#ramp(voice.source.playbackRate, voice.targetRate, now, PITCH_TAU);
      }
    }
    this.#ramp(this.bus.gain, master * this.headroom, now, GAIN_TAU);
  }

  #ramp(param, value, now, tau) {
    if (Math.abs(param.value - value) < EPSILON) return;
    // Never `.value =` on a running graph: a step on a gain or a rate is a
    // zipper click. setTargetAtTime is the same de-zippering three.js's own
    // Audio.setVolume does.
    param.setTargetAtTime(value, now, tau);
  }

  #placePanner(panner, x, y, z, now) {
    if (panner.positionX) {
      // A ramp over one frame rather than a jump, matching three.js's
      // PositionalAudio. Web Audio's panner has no doppler of its own, so
      // moving it discontinuously costs nothing but a click in the HRTF
      // convolution, which this avoids.
      const end = now + (this.listener.timeDelta || 1 / 60);
      panner.positionX.linearRampToValueAtTime(x, end);
      panner.positionY.linearRampToValueAtTime(y, end);
      panner.positionZ.linearRampToValueAtTime(z, end);
    } else {
      panner.setPosition(x, y, z);
    }
  }

  /**
   * Release the patch: the engine is shutting down.
   *
   * Every layer carries a `Volume <- TimeRelease` ramp of 1 -> 0 over 0.2 s, so
   * the fade falls out of `update` once `released` is set; all this has to do
   * is start the shut-down one-shots that were waiting for it.
   */
  release() {
    if (this.released || this.disposed || !this.started) return;
    this.released = true;
    this.sinceRelease = 0;
    const now = this.ctx.currentTime;
    for (const voice of this.voices) {
      if (voice.layer.trigger === 'release') this.#play(voice, now);
    }
  }

  /** Tear the graph down. Idempotent, and safe to call mid-release. */
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const voice of this.voices) {
      if (voice.source) {
        try { voice.source.onended = null; voice.source.stop(); } catch (_) {}
        try { voice.source.disconnect(); } catch (_) {}
        voice.source = null;
      }
      try { voice.gain.disconnect(); } catch (_) {}
    }
    for (const group of this.groups.values()) {
      try { group.panner.disconnect(); } catch (_) {}
    }
    try { this.bus.disconnect(); } catch (_) {}
    this.voices.length = 0;
    this.groups.clear();
  }

  /**
   * What the graph is doing, for headless checks.
   *
   * Reports both the value the curves asked for and the value the AudioParam
   * has reached: headless Chromium will not let anyone listen, so the crossfade
   * has to be asserted on the numbers, and a suspended context freezes
   * `currentTime` so the node values lag the targets by design.
   */
  snapshot() {
    return {
      template: this.spec.template,
      level: this.spec.level,
      started: this.started,
      released: this.released,
      elapsed: this.elapsed,
      master: this.master,
      busGain: this.bus.gain.value,
      // The count that must not drift: a duplicated voice is the 319a794 bug.
      voices: this.voices.filter(v => v.playing).length,
      panners: this.groups.size,
      layers: this.voices.map(v => ({
        file: v.layer.file,
        loop: !!v.layer.loop,
        playing: v.playing,
        distance: v.group.distance,
        gain: v.targetGain,
        playbackRate: v.targetRate,
        jitter: v.jitter,
        nodeGain: v.gain.gain.value,
        nodeRate: v.source ? v.source.playbackRate.value : null,
      })),
    };
  }
}

/**
 * Decode a vehicle's engine layers and build its graph, without starting it.
 *
 * `getBuffer` is the caller's cache-keyed loader — sharing it is what keeps the
 * one-decode-per-wav rule true across the ambient and engine paths, and it is
 * why the Corsair's two cockpit layers share a single decoded `b17hirpm.wav`
 * instead of two copies drifting apart.
 */
export async function loadEngineAudio(spec, { listener, getBuffer,
                                              headroom = BUS_HEADROOM }) {
  if (!spec || !spec.layers || !spec.layers.length || !listener) return null;
  const buffers = new Map();
  for (const layer of spec.layers) {
    if (buffers.has(layer.file)) continue;
    buffers.set(layer.file, await getBuffer(layer.file));
  }
  const layers = spec.layers.filter(l => buffers.get(l.file));
  if (!layers.length) return null;
  return new EngineAudio(spec, layers, buffers, listener, headroom);
}

/**
 * The engine sound for one vehicle out of a level report, by template name.
 *
 * The report keys on the template the spawner actually resolved to, which is
 * how a Wake scene ends up with both `corsair` and `sbd`; the match is
 * case-insensitive because `ObjectSpawnTemplates.con` is.
 */
export function findEngineSpec(report, template) {
  const list = report?.sounds?.vehicles;
  if (!list || !template) return null;
  const want = template.toLowerCase();
  return list.find(v => (v.template || '').toLowerCase() === want) || null;
}

/**
 * The gun patches for one vehicle, in the same shape `loadEngineAudio` takes.
 *
 * The extractor hangs weapons off the vehicle that carries them, so this is the
 * engine lookup plus one hop. `engine` is set to the FireArms name because that
 * is what the field means to every caller — the node the voices belong on — and
 * for a gun that is the gun.
 */
export function findWeaponSpecs(report, template) {
  const vehicle = findEngineSpec(report, template);
  if (!vehicle?.weapons?.length) return [];
  return vehicle.weapons.map(weapon => ({
    template,
    engine: weapon.fireArms,
    fireArms: weapon.fireArms,
    script: weapon.script,
    level: vehicle.level,
    layers: weapon.layers,
  }));
}
