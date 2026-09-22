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
    // Land engines (Willy, Sherman, …) author Pitch/Volume on `Default` instead
    // of `Extern #map<Engine::Rpm>` — a survey of Objects.rfa puts 257 land
    // pitch effects on Default vs 206 air pitch effects on Engine::Rpm. The
    // one-shot idiom `Linear p1 0` is still a constant under either reading,
    // so feeding the same normalised rpm channel serves both.
    case 'default': return c.rpm;
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

// The engine bus plays the `.ssc` mix at the volumes it asks for.
//
// It used to be scaled by 0.28 — the worst-case concurrent layer sum of a
// Corsair at full throttle heard from the cockpit (hi 1.0 + veadaurun 0.5 +
// prop 1.0 + two cockpit whines at 0.8 x 0.8 ~= 3.8), on the reasoning that a
// Web Audio graph summing straight into the destination would clip flat.
// Every other vehicle then paid the Corsair's bill, and worst case is not
// what actually arrives: layers that are not in phase do not add in phase.
// Measured on a Sherman, inside, idling, master at 0.7, the whole engine came
// out at a peak of 0.089 and an RMS of 0.0295 — against 0.596/0.185 for the
// BAR in the same scene and 0.0156 for the map's own wind. A tank you are
// sitting in was twice as loud as the weather.
//
// The clipping the constant existed to prevent is real, and it is real
// whatever this number is: the Sherman's cannon, on the *weapon* bus, was
// measured peaking at 1.75. One divisor cannot both leave an idling engine
// audible and hold a 20-layer cannon under full scale. So the clipping is now
// held where it belongs, by a limiter on the listener itself (`map.html`'s
// `ensureListener`), and the bus plays what the script wrote.
const BUS_HEADROOM = 1;

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

// --- coherent duplicates: the car-horn fingerprint --------------------------
//
// **Two voices playing the same decoded buffer, at the same point in space, at
// the same playback rate, are not twice as loud. They are a comb filter.**
// Their phase relationship is fixed for as long as both run, so a looped
// sample's harmonic comb (114 ms of `brownmlp` = 8.8 Hz; `MG42_fire` the same)
// stops being a texture and becomes a pitch. That is the whole of the "the
// tank's machine gun sounds like a car horn" report, and it has now arrived by
// three different routes -- a `stereo` layer's Distance channel frozen at 0, a
// `volume 10` outlier read literally, and (this time) two `Volume <- Distance`
// ramps whose bands simply overlap where the gunner's head is. Guarding each
// route in turn is why it keeps coming back; this guards the fingerprint.
//
// It is never what a script means. A `.ssc` that loads one sample twice at one
// offset is writing a **hand-over** -- `Coaxial_Browning/Sounds/Browning.ssc`
// is `brownmlp` at `Volume <- Distance Ramp 2 2 1 -1` (1 below 2 m) and the
// same `brownmlp` at `Ramp 1 1 0 1` (1 above 1 m), which leaves 1 m..2 m with
// both at full. Exactly one is meant to sound; the driver's camera sits at
// 1.4 m from the coax node, i.e. inside the overlap, every time.
//
// What is emphatically NOT this defect is the same sample stacked at
// *different* pitches, which is how Refractor builds a rich engine: the Willy
// runs two loads of `WillyHiRPM2` at rates 0.40 and 0.875, the T34 two of
// `t34eng2` 0.9% apart. Detuned copies beat and smear each other -- that is
// the authored sound, and the rate test below is what tells the two cases
// apart. 0.4% is comfortably above exact-match (the coax pair measures 0.000%
// apart: no pitch modulator, `dopplerOff`, and no `randomStartPitch` to jitter
// them) and comfortably below the tightest authored detune in vanilla.
const COHERENT_RATE_TOL = 0.004;
// A twin quiet enough to be inaudible is left alone rather than arbitrated:
// -34 dB adds 0.17 dB to its partner and a comb far under the noise floor.
const COHERENT_FLOOR = 0.02;

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
    // Set per frame by `#resolveCoherent`, and reported by `snapshot()` so a
    // headless check can tell "the ramp put this layer at zero" apart from
    // "this layer lost a coherent-duplicate arbitration".
    this.suppressed = false;
  }

  get playing() {
    return this.source !== null;
  }
}

/**
 * Which of two coherent twins keeps its gain: `priority`, then loudness, then
 * declaration order.
 *
 * `priority` is the only word a `.ssc` has for arbitrating between samples
 * (observed range -12..11; the engine mixes into a fixed 32-voice pool and
 * steals by it), so a hand-over that names one half louder-ranked than the
 * other has already said which one it means -- the coaxial Browning's near
 * layer is 10 against the far layer's 8. The remaining tiebreaks only exist so
 * that a set of equals resolves the same way every frame.
 */
function outranks(a, b) {
  const pa = a.layer.priority ?? 0;
  const pb = b.layer.priority ?? 0;
  if (pa !== pb) return pa > pb;
  if (a.targetGain !== b.targetGain) return a.targetGain > b.targetGain;
  return a.index < b.index;
}

/**
 * A running engine patch: its voices, its panners, and the clock it modulates
 * against.
 *
 * Construction builds the graph but starts nothing, so a superseded load can be
 * thrown away without ever having made a sound.
 */
export class EngineAudio {
  /**
   * @param {boolean} [oneShotsOnTrigger] - hold every non-looping layer back
   *   from `start()` and play it from `trigger()` instead. That is what a gun
   *   patch is: its layers are the report of one round, not a machine that
   *   runs while the vehicle exists. An engine patch leaves this false, so its
   *   starter cough still fires the moment the engine does.
   */
  constructor(spec, layers, buffers, listener, headroom = BUS_HEADROOM,
              oneShotsOnTrigger = false, rand = Math.random) {
    this.spec = spec;
    this.headroom = headroom;
    this.listener = listener;
    this.ctx = listener.context;
    this.rand = rand;
    this.disposed = false;
    this.started = false;
    this.released = false;
    this.master = 0;
    // Every source this patch has running, orphans included. A voice slot
    // holds only its *newest* source (`trigger()` deliberately leaves the
    // previous one to play out so a burst stacks), so `voices` undercounts
    // what the mixer is actually summing. A caller with a voice budget to
    // spend needs the real number, which is this one.
    this.live = new Set();
    // The patch clock is the simulation clock, not `ctx.currentTime`. The two
    // diverge whenever the context is suspended — which is exactly the state
    // the page is in before the user has clicked anything — and a `Time` attack
    // ramp read off a frozen clock would hold every layer at zero forever.
    this.elapsed = 0;
    this.oneShotsOnTrigger = !!oneShotsOnTrigger;
    this.sinceRelease = 0;
    // A one-shot requested while the context has not yet resumed (the
    // ordinary state before the page's first gesture) queues at a frozen
    // `currentTime` like every other one requested in the meantime, and the
    // browser starts all of them together the instant the context wakes --
    // ten triggers become twenty sources sounding as one bang. So a one-shot
    // asked for while suspended is simply dropped; `suspended` counts how
    // many, for a headless check to read beside `dropped`. A loop cannot be
    // dropped the same way -- the engine note, or a wreck's fire, has to
    // actually start once the context can render it -- so it is remembered
    // here and started for real by `update()`'s own `#wake`, the first frame
    // it sees the context running.
    this.pendingLoops = new Set();
    this.suspended = 0;

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
      // `stereo` marks a sample for non-spatialised playback (cockpit gun
      // layers): HRTF at 1.2 m is wrong when the data says 2D. Those connect
      // straight to the bus and get no panner — but they still get a group,
      // because `stereo` is about *panning*, not about distance.
      //
      // It used to skip the group entirely and hand the voice a throwaway one
      // frozen at `distance: 0`, and that silently broke every near/far pair
      // whose near half is the stereo one. The pairs are written as a hard
      // hand-over on one number: `mg42.ssc`'s near layer is
      // `Volume <- Distance ramp 1/1/1/-1` (1 below a metre, 0 above) and its
      // far layer the exact complement, `1/1/0/1`. Frozen at zero the near
      // layer read "below a metre" forever, so at the gunner's real 1.4 m
      // *both* halves ran at full gain — two coherent copies of one 114 ms
      // buffer, +6 dB and flanging, which is the drone the "machine gun
      // sounds like a car horn" report was about. Measured on the Sherman's
      // coaxial Browning (whose layers share one sample at identical playback
      // rate, `randomStartPitch` absent): top-8 spectral tonality 0.84
      // doubled against 0.42 single, and the Spitfire's cockpit pair — two
      // *different* samples, and a far pair correctly gated off below 4 m —
      // measures 0.50. That is also why only the tanks were reported: an
      // aircraft's far layers are gated at 4 m and never came in.
      const key = layer.stereo ? `stereo:${offset.join(',')}` : offset.join(',');
      let group = this.groups.get(key);
      if (!group) {
        let panner = null;
        if (!layer.stereo) {
          panner = this.ctx.createPanner();
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
        }
        group = { panner, offset, distance: 0, radial: 0, primed: false };
        this.groups.set(key, group);
      }
      // refDistance tracks the nearest layer in the group; inert while
      // rolloffFactor is 0, but it keeps the node honest if that ever changes.
      if (group.panner) {
        group.panner.refDistance = Math.min(group.panner.refDistance,
                                            layer.minDistance || 1);
      }
      const voice = new Voice(this.ctx, layer, buffers.get(layer.file),
                              group.panner || this.bus);
      voice.group = group;
      // Declaration order, the last tiebreak in a coherent-duplicate contest.
      voice.index = this.voices.length;
      this.voices.push(voice);
    }

    // Twin sets: voices that share one decoded buffer *and* one group, i.e.
    // one sample played from one point in space. Only those can sum
    // coherently, and only sets of two or more are worth a frame's attention,
    // so the overwhelming majority of patches end up with an empty list here
    // and `#resolveCoherent` costs them nothing. See COHERENT_RATE_TOL.
    //
    // Keyed on the offset rather than on the group object, because the two
    // halves of a hand-over deliberately live in *separate* groups at the same
    // offset -- one `stereo`, one spatialised. That is the pair that honks, so
    // it is the pair that has to meet here.
    this.coherent = [];
    const twins = new Map();
    for (const voice of this.voices) {
      const key = `${voice.layer.file}`;
      let byGroup = twins.get(key);
      if (!byGroup) twins.set(key, byGroup = new Map());
      const at = byGroup.get(voice.group.offset.join(',')) || [];
      at.push(voice);
      byGroup.set(voice.group.offset.join(','), at);
    }
    for (const byGroup of twins.values()) {
      for (const set of byGroup.values()) {
        if (set.length > 1) this.coherent.push(set);
      }
    }
    // `trigger Volume` fires on the volume's *first* rise, once. An engine
    // patch is armed from the start; a gun patch only by a round, so nothing
    // sounds when the patch is built and its clock runs past the step ramps.
    for (const voice of this.voices) voice.volumeArmed = !this.oneShotsOnTrigger;

    // `randomPlay 1` closes a patch to say **pick one**, not "play them all",
    // and 244 vanilla scripts say it — 114 of the 136 EffectBundle patches
    // among them. An 8-alternate ricochet played as 8 layers is a wall of
    // noise where the engine plays one crack; three `vefr*.wav` wreck-fire
    // loops played together are a roar where the engine picks a crackle.
    // Layers carry their own patch index, so the grouping needs no second
    // table, and a spec whose layers carry neither key behaves exactly as
    // before: every patch group is "not random" and every voice plays.
    this.patches = new Map();
    for (const voice of this.voices) {
      const key = voice.layer.patch ?? -1;
      let group = this.patches.get(key);
      if (!group) {
        group = { random: false, voices: [] };
        this.patches.set(key, group);
      }
      if (voice.layer.randomPlay) group.random = true;
      group.voices.push(voice);
    }
    this.#rollRandomPlay();
  }

  /**
   * Pick this round's alternate for every `randomPlay` patch.
   *
   * Re-rolled per trigger, which is what makes eight ricochet samples read as
   * eight different ricochets rather than one on repeat. A patch that is not
   * `randomPlay` admits all of its voices.
   */
  #rollRandomPlay() {
    this.chosen = new Set();
    for (const group of this.patches.values()) {
      if (!group.random) {
        for (const voice of group.voices) this.chosen.add(voice);
        continue;
      }
      if (!group.voices.length) continue;
      const pick = Math.min(group.voices.length - 1,
                            Math.floor(this.rand() * group.voices.length));
      this.chosen.add(group.voices[pick]);
    }
  }

  /** Live sources, orphaned tails included — what the mixer is really summing. */
  get sources() {
    return this.live.size;
  }

  /**
   * Live sources **plus** the ones this patch has promised but not yet
   * started: its armed `trigger Volume` layers.
   *
   * A distant explosion layer held back 0.75 s by a step ramp is not a voice
   * yet and is not optional either — the patch that started its near layer
   * has already committed to it. A voice budget spent only against what is
   * currently sounding will therefore be over by exactly the number of
   * delayed layers in flight when they land, which is what a first
   * measurement of a 200-round burst showed (27 live against a cap of 26).
   * Counting the promise is what makes the cap hold.
   */
  get committed() {
    return this.live.size + this.armed;
  }

  /** Armed `trigger Volume` layers: promised, not yet started. */
  get armed() {
    let pending = 0;
    for (const voice of this.voices) {
      if (voice.layer.trigger !== 'volume') continue;
      if (voice.volumeArmed && this.chosen.has(voice)) pending += 1;
    }
    return pending;
  }

  /**
   * Spend every unfired `trigger Volume` latch on this patch.
   *
   * Called by a one-shot caller once the round's own window has passed. Two
   * things go wrong without it, both measured on the page:
   *
   * 1. **A latch that never fires holds a voice reservation forever.** An
   *    `e_ExplGas` played at 4 m arms its 100 m, 200 m and 400 m layers and
   *    none of them ever rises, because their *distance* gates read zero at
   *    4 m. Counted as committed they were three voices of a 26-voice budget
   *    permanently spent — a 200-round burst measured 186 drops against 14
   *    plays with three explosions' worth of dead latches held.
   * 2. **A stale latch fires late.** The layer is gated on distance as well as
   *    time, so a listener who walks into the 100 m band a minute after the
   *    bang would set off an explosion that finished long ago.
   */
  disarmPending() {
    for (const voice of this.voices) {
      if (voice.layer.trigger === 'volume') voice.volumeArmed = false;
    }
  }

  /**
   * Cut every source this patch has running, keeping the graph reusable.
   *
   * This is voice stealing: a caller at its budget silences a patch outright
   * rather than letting the sum grow. `dispose()` is the other half and takes
   * the nodes with it; this one leaves an instance a pool can trigger again.
   *
   * The promises go with the sources. A patch that is cut still holds its
   * armed `trigger Volume` latches, and `EffectAudio` parks a silenced slot at
   * `since = Infinity`, so the window-close that calls `disarmPending` never
   * comes round again for it: the latch stays armed forever. That is both a
   * voice permanently missing from the budget — measured: one `silence()` of
   * an `e_ExplGas` played at 4 m leaves `committed` stuck at 1 through 200
   * frames — and, worse, an explosion that goes off later, when the listener
   * walks into the distance band the cut layer was gated on. Cutting a patch
   * has to cancel what it had promised as well as what it was playing.
   */
  silence() {
    for (const source of [...this.live]) {
      try { source.onended = null; source.stop(); } catch (_) {}
      try { source.disconnect(); } catch (_) {}
    }
    this.live.clear();
    for (const voice of this.voices) voice.source = null;
    // A loop still waiting on the context to wake must not spring to life
    // after the patch it belonged to has been cut -- a level change or a
    // voice steal silencing this patch has to be the end of it, resume or not.
    this.pendingLoops.clear();
    this.disarmPending();
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
      // A `trigger Volume` layer waits for `update`'s gate, never for this.
      if (voice.layer.trigger === 'volume') continue;
      // This round's `randomPlay` pick; every voice of an ordinary patch.
      if (!this.chosen.has(voice)) continue;
      // A gun's one-shots belong to a round, not to the moment the patch was
      // built -- see `oneShotsOnTrigger`. Playing them here is what made every
      // vehicle weapon in the viewer silent: the Sherman's cannon is twenty
      // layers and every one of them is `loop: false`, so `start()` fired the
      // lot once, inaudibly (the patch's master is 0 until the trigger is
      // pulled), `onended` cleared each voice, and there was nothing left
      // running for a gain gate to un-mute ever again.
      if (this.oneShotsOnTrigger && !voice.layer.loop) continue;
      this.#play(voice, t0);
    }
  }

  /**
   * One round: replay every one-shot in this patch from the top.
   *
   * The patch's own clock restarts with it, because a gun `.ssc` sequences
   * itself off `Time` — a Sherman's twenty layers are the muzzle blast, the
   * shell casing, the crew reloading and the breech closing, each with its own
   * ramp measured from the shot. A layer that declares `trigger Volume` is
   * left to `update`'s own gate, which this re-arms for exactly one play.
   *
   * A one-shot already sounding is not cut: the previous source is orphaned to
   * play out while a new one takes the voice's slot, so a burst stacks instead
   * of clipping its own tail. `#play`'s `onended` only clears the slot it
   * still owns, which is what makes that safe.
   *
   * @returns {number} how many layers actually started.
   */
  trigger() {
    if (!this.started || this.disposed || this.released) return 0;
    const now = this.ctx.currentTime;
    this.elapsed = 0;
    // A fresh alternate and a fresh pitch offset per round: `randomStartPitch`
    // is rolled once per *play* in the engine, and a one-shot voice that kept
    // the offset it was built with would give every ricochet in a burst the
    // identical pitch — the flanging `randomStartPitch` exists to prevent.
    this.#rollRandomPlay();
    for (const voice of this.voices) {
      if (voice.layer.loop) continue;
      const [up = 0, down = 0] = voice.layer.randomStartPitch || [];
      if (up || down) voice.jitter = 1 + (this.rand() * (up + down) - down);
    }
    let played = 0;
    for (const voice of this.voices) {
      if (voice.layer.loop) continue;
      if (voice.layer.trigger === 'volume') {
        // Armed only if this round picked it — and explicitly *dis*armed
        // otherwise, or an alternate armed by an earlier round would still be
        // waiting to fire on its own ramp and the pick would leak.
        voice.volumeArmed = this.chosen.has(voice);
        continue;
      }
      if (!this.chosen.has(voice)) continue;
      if (voice.layer.trigger === 'release') continue;
      const previous = voice.source;
      voice.source = null;
      this.#play(voice, now);
      if (voice.source) played += 1;
      else voice.source = previous;
    }
    return played;
  }

  /** Does this patch run on loops, or is it a one-shot event? A gun with no
   *  looping layer at all is silent between rounds, so a caller has no reason
   *  to gate its master on the trigger. */
  get hasLoops() {
    return this.voices.some(voice => voice.layer.loop);
  }

  #play(voice, when) {
    if (!voice.buffer || voice.source) return;
    if (this.ctx.state !== 'running') {
      // See the constructor's note. A loop remembers itself so `#wake` can
      // start it for real once the context is running; a one-shot is simply
      // lost, the same as a round nobody was there to hear.
      if (voice.layer.loop) this.pendingLoops.add(voice);
      else this.suspended += 1;
      return;
    }
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
    this.live.add(source);
    if (!source.loop) {
      source.onended = () => {
        this.live.delete(source);
        if (voice.source === source) voice.source = null;
      };
    }
  }

  /** Master gain, 0..1, from the viewer's sound checkbox and volume slider. */
  setMaster(value) {
    this.master = value;
  }

  /**
   * Start whatever loops piled up while the context could not render them.
   *
   * Polled from `update()`, which already runs every simulation tick, rather
   * than a `statechange` listener: one fewer thing to unregister on
   * `dispose()`, and the check costs nothing once `pendingLoops` is empty,
   * which is every frame after the page's first gesture.
   */
  #wake() {
    if (!this.pendingLoops.size || this.ctx.state !== 'running') return;
    const now = this.ctx.currentTime;
    for (const voice of this.pendingLoops) this.#play(voice, now);
    this.pendingLoops.clear();
  }

  /**
   * One frame.
   *
   * `control` is everything the script's control sources need, in the units the
   * `.ssc` uses: `rpm` normalised 0..1 (engine rotation over `maxRotation.roll`
   * = 5000, which for the viewer's flight model is the already-spooled
   * `state.throttle` rather than the stick), `speed` and `acceleration` in m/s
   * and m/s^2, `diveAngle` normalised, and the source and listener positions in
   * world space. Land `.ssc` scripts bind the same rpm channel as `Default`
   * (see `controlValue`); air scripts use `Engine::Rpm` explicitly.
   */
  update(control) {
    if (this.disposed) return;
    this.#wake();
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
      if (group.panner) this.#placePanner(group.panner, wx, wy, wz, now);
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
      // One voice never plays above unity. `volume` is a 0..1 mixer scalar in
      // every script that means anything by it — of 5,484 layers across the 23
      // vanilla levels, 5,458 are at or below 1 and the remaining 26 are three
      // authoring outliers: `Coaxial_Browning/Sounds/High.ssc` says
      // `volume 10` (Sherman and M10, 25 occurrences) and the KettenKrad's
      // engine-start one-shot says 5. Read literally, 10 put the Sherman's
      // coaxial Browning 20 dB hot: measured pre-limiter peak 5.02 and RMS
      // 1.51, against 0.596/0.185 for the BAR in the same scene, which drove
      // the master limiter 14 dB into 20:1 and flattened a 7.7 Hz periodic
      // comb into the honk the bug report described. Clamped, and with the
      // stereo-distance fix above, the same patch measures peak 0.82 / RMS
      // 0.158 — just under the Spitfire's known-good 0.90/0.250.
      //
      // Clamped here rather than in the extractor deliberately: `volume 10`
      // is what the game's own script says, so the data stays faithful and
      // every already-published maps tree is fixed without a re-extraction.
      // Clamped on the *modulated* result rather than on `layer.volume`, so a
      // ramp that itself overshoots cannot get round it either.
      voice.targetGain = Math.min(1, Math.max(0, volume));
      voice.targetRate = Math.max(0.05, rate);
      voice.suppressed = false;
    }

    // Both passes read `targetGain`, and the arbitration has to land between
    // them: a layer that loses its twin contest must never reach the trigger
    // gate below, or a one-shot would spend its latch on a round nobody hears.
    this.#resolveCoherent();

    for (const voice of this.voices) {
      // `trigger Volume` is the delayed-start gate: the sample waits until its
      // computed volume first goes non-zero. Vanilla uses it with step `Time`
      // ramps to delay distant explosion layers by the speed of sound.
      //
      // First, and once. A step ramp stays at 1 after it trips, so gating on
      // "no source and some volume" replayed the sample every time it ended:
      // a PanzerIV's cannon is 22 such layers, and each one looped its own
      // one-shot for as long as the patch lived. The latch is spent by the
      // play. A gun re-arms it per round in `trigger()`; anything else re-arms
      // when the volume falls back to zero, so the next rise is a new event.
      // A gun deliberately does not re-arm on zero: walking across a layer's
      // distance band long after the shot must not set the shot off again.
      if (voice.layer.trigger === 'volume') {
        if (voice.targetGain <= 0) {
          // Not on a voice the arbitration zeroed: its own volume never fell,
          // so letting the latch re-arm would fire the layer a second time the
          // moment its twin walked out of range.
          if (!this.oneShotsOnTrigger && !voice.suppressed) voice.volumeArmed = true;
        } else if (voice.volumeArmed && this.chosen.has(voice)
                   && this.started && !this.released) {
          voice.volumeArmed = false;
          // Stack on a tail still sounding, the way `trigger()` does.
          const previous = voice.source;
          voice.source = null;
          this.#play(voice, now);
          if (!voice.source) voice.source = previous;
        }
      }

      this.#ramp(voice.gain.gain, voice.targetGain, now, GAIN_TAU);
      if (voice.source) {
        this.#ramp(voice.source.playbackRate, voice.targetRate, now, PITCH_TAU);
      }
    }
    this.#ramp(this.bus.gain, master * this.headroom, now, GAIN_TAU);
  }

  /**
   * Zero every voice that would sum coherently with a louder twin.
   *
   * A twin set is one sample played from one point (built once in the
   * constructor), and within it the only pairs that matter are the ones at the
   * same playback rate -- see COHERENT_RATE_TOL for why that test, and not
   * "same sample", is the line between a hand-over and an authored detune.
   *
   * Pairwise rather than clustered: a set is two voices in every case vanilla
   * ships and five at the very worst (the Sherman cannon's `shrmfire` stack,
   * whose distance bands are mutually exclusive so nothing ever contests).
   *
   * The winner is the one the script itself nominates -- `priority` is the
   * only word a `.ssc` has for arbitration -- then the louder, then the
   * earlier-declared, so the outcome is stable frame to frame and does not
   * depend on iteration order.
   */
  #resolveCoherent() {
    for (const set of this.coherent) {
      for (let i = 0; i < set.length; i++) {
        const a = set[i];
        if (a.targetGain <= COHERENT_FLOOR) continue;
        for (let j = i + 1; j < set.length; j++) {
          const b = set[j];
          if (b.targetGain <= COHERENT_FLOOR) continue;
          const spread = Math.abs(a.targetRate - b.targetRate);
          if (spread > COHERENT_RATE_TOL * Math.max(a.targetRate, b.targetRate)) continue;
          const loser = outranks(a, b) ? b : a;
          loser.targetGain = 0;
          loser.suppressed = true;
          // `a` has just lost; it can contest nothing else in this set.
          if (loser === a) break;
        }
      }
    }
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
    // Orphaned tails first: a voice slot has already let go of them, so the
    // loop below would leave them running on a disconnected graph.
    this.silence();
    for (const voice of this.voices) {
      if (voice.source) {
        try { voice.source.onended = null; voice.source.stop(); } catch (_) {}
        try { voice.source.disconnect(); } catch (_) {}
        voice.source = null;
      }
      try { voice.gain.disconnect(); } catch (_) {}
    }
    for (const group of this.groups.values()) {
      try { group.panner?.disconnect(); } catch (_) {}
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
      // And what the mixer is really summing, orphaned tails included.
      sources: this.live.size,
      // One-shots lost to a suspended context, and loops still waiting for it
      // to wake -- see the constructor's note.
      suspended: this.suspended,
      pendingLoops: this.pendingLoops.size,
      panners: this.groups.size,
      layers: this.voices.map(v => ({
        file: v.layer.file,
        loop: !!v.layer.loop,
        playing: v.playing,
        distance: v.group.distance,
        gain: v.targetGain,
        // Zeroed by `#resolveCoherent` rather than by its own curves: the
        // headless check for the car horn asserts on this.
        suppressed: v.suppressed,
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
                                              headroom = BUS_HEADROOM,
                                              oneShotsOnTrigger = false,
                                              rand = Math.random }) {
  if (!spec || !spec.layers || !spec.layers.length || !listener) return null;
  const buffers = new Map();
  for (const layer of spec.layers) {
    if (buffers.has(layer.file)) continue;
    buffers.set(layer.file, await getBuffer(layer.file));
  }
  const layers = spec.layers.filter(l => buffers.get(l.file));
  if (!layers.length) return null;
  return new EngineAudio(spec, layers, buffers, listener, headroom,
                         oneShotsOnTrigger, rand);
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

/**
 * Look up gun patches by FireArms node name across every vehicle in the
 * report. Bare furniture mounts (Stationary MG42 / Browning) have no Engine
 * entry of their own, so `findWeaponSpecs(template)` is empty — but the same
 * `.ssc` was often extracted next to a tank or ship that carries that gun
 * (Hatsuzuki → `MG42_unlimited`, Sherman → `Browning`).
 *
 * `names` may include `_unlimited` variants; a bare `Browning` layer matches
 * `Browning_unlimited` when the exact name is missing.
 */
export function findWeaponSpecsByFireArms(report, names) {
  const list = report?.sounds?.vehicles;
  if (!list?.length || !names?.length) return [];
  const want = [...new Set(names)];
  const byName = new Map();
  for (const vehicle of list) {
    for (const weapon of vehicle.weapons || []) {
      if (!byName.has(weapon.fireArms)) {
        byName.set(weapon.fireArms, {
          template: vehicle.template,
          engine: weapon.fireArms,
          fireArms: weapon.fireArms,
          script: weapon.script,
          level: vehicle.level,
          layers: weapon.layers,
        });
      }
    }
  }
  const found = [];
  const claimed = new Set();
  for (const name of want) {
    const exact = byName.get(name);
    if (exact) {
      found.push(exact);
      claimed.add(name);
      continue;
    }
    if (name.endsWith('_unlimited')) {
      const bare = byName.get(name.slice(0, -'_unlimited'.length));
      if (bare && !claimed.has(name)) {
        found.push(bare);
        claimed.add(name);
      }
    }
  }
  return found;
}
