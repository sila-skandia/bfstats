// Two voices of one sample, at one point, at one rate: the arbitration that
// keeps them from summing into a comb. Split out of `engine-audio.js`, which
// builds a patch's twin sets once and resolves them every frame; the vehicle
// rack (`vehicle-audio.js`) settles the twins between patches
// (`resolveAcross`).

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
 * Twin sets: voices that share one decoded buffer *and* one group, i.e.
 * one sample played from one point in space. Only those can sum
 * coherently, and only sets of two or more are worth a frame's attention,
 * so the overwhelming majority of patches end up with an empty list here
 * and `resolveCoherent` costs them nothing. See COHERENT_RATE_TOL.
 *
 * Keyed on the offset rather than on the group object, because the two
 * halves of a hand-over deliberately live in *separate* groups at the same
 * offset -- one `stereo`, one spatialised. That is the pair that honks, so
 * it is the pair that has to meet here.
 */
export function coherentSets(voices) {
  const coherent = [];
  const twins = new Map();
  for (const voice of voices) {
    const key = `${voice.layer.file}`;
    let byGroup = twins.get(key);
    if (!byGroup) twins.set(key, byGroup = new Map());
    const at = byGroup.get(voice.group.offset.join(',')) || [];
    at.push(voice);
    byGroup.set(voice.group.offset.join(','), at);
  }
  for (const byGroup of twins.values()) {
    for (const set of byGroup.values()) {
      if (set.length > 1) coherent.push(set);
    }
  }
  return coherent;
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
export function resolveCoherent(coherent) {
  for (const set of coherent) {
    for (let i = 0; i < set.length; i++) {
      const a = set[i];
      if (a.targetGain <= COHERENT_FLOOR) continue;
      for (let j = i + 1; j < set.length; j++) {
        const b = set[j];
        if (b.targetGain <= COHERENT_FLOOR) continue;
        if (!sameRate(a, b)) continue;
        const loser = outranks(a, b) ? b : a;
        loser.targetGain = 0;
        loser.suppressed = true;
        // `a` has just lost; it can contest nothing else in this set.
        if (loser === a) break;
      }
    }
  }
}

/** One rate as far as a comb is concerned: see COHERENT_RATE_TOL. */
function sameRate(a, b) {
  return Math.abs(a.targetRate - b.targetRate)
    <= COHERENT_RATE_TOL * Math.max(a.targetRate, b.targetRate);
}

// --- between patches: the fourth route --------------------------------------
//
// A patch settles its own twins, and a hull is several patches. The PanzerIV's
// coaxial MG42 and its cupola MG42 are two FireArms, each with its own
// `mg42.ssc`, and both play `MG42_fire`. With the driver and the cupola gunner
// firing together (Bocage, replay_20260928-133433 at 3:04) the two loops
// summed into the horn, and neither patch could see the other's voice. The
// Sherman's coaxial and turret Brownings share `brownmlp` the same way.
// Reported 2026-09-29, the fourth route to the one event.
//
// Between patches "one point" stops mattering. A Web Audio panner delays
// nothing, so two copies of one loop keep the same fixed random phase offset
// wherever they stand; where they stand only decides how much of each reaches
// each ear, which is how deep the comb is. So the contest here is one decoded
// buffer at one rate, anywhere on the rack, and the louder copy (the one the
// listener mostly hears anyway) keeps its gain. `sound_coherence_measure.cjs
// bocage sherman Coaxial_browning+Browning 16`, ten renders: each patch alone
// 53.4..86.1 tonality, arbitrated 61.4..62.4.
//
// Loops only. A one-shot starts at the head of its buffer (`#play`), so two
// patches' copies of one shot are sample-aligned when they are one event and
// two events when they are not. Two tanks firing a second apart are two bangs,
// and muting the first one's tail would lose one.

/**
 * How much louder a copy must be to take the voice from the one that held it
 * last frame, about 2 dB. Without it two guns at near-equal loudness hand the
 * voice back and forth as the camera moves, and every hand-over is a
 * crossfade with both copies partly up: the comb again, a tenth of a second
 * at a time.
 */
const HOLD = 1.25;

/**
 * Zero every looping voice that would sum coherently with a louder copy in
 * another patch.
 *
 * `patches` are `EngineAudio`s that have run `evaluate` this frame and not yet
 * `apply`. A patch with its master at 0 (a gun nobody is firing, a hull out of
 * earshot) contests nothing: its loops run silent, and a silent copy must
 * never mute a sounding one. Voices one patch has already arbitrated away stay
 * out, and two copies inside one patch are that patch's business
 * (`resolveCoherent`): a spread it authors at two offsets survives here too.
 *
 * The winner is the loudest as heard (script gain, fall-off and bus), with
 * last frame's winner held (`HOLD`), then the order the patches came in. A copy
 * 34 dB or more under its rival is left alone, as `COHERENT_FLOOR` leaves a
 * quiet twin alone inside a patch.
 */
export function resolveAcross(patches) {
  const byBuffer = new Map();
  patches.forEach((patch, order) => {
    const bus = (patch.master ?? 0) * (patch.headroom ?? 1);
    for (const voice of patch.voices ?? []) {
      const held = voice.held;
      voice.held = false;
      if (!(bus > 0) || !voice.layer.loop || !voice.source || !voice.buffer
          || voice.suppressed) continue;
      const out = voice.targetGain * voice.rolloff * bus;
      if (!(out > 0)) continue;
      let set = byBuffer.get(voice.buffer);
      if (!set) byBuffer.set(voice.buffer, set = []);
      set.push({ voice, out, rank: held ? out * HOLD : out, order });
    }
  });
  for (const set of byBuffer.values()) {
    set.sort((a, b) => (b.rank - a.rank) || (a.order - b.order)
      || (a.voice.index - b.voice.index));
    const kept = [];
    for (const entry of set) {
      const rival = kept.find(k => k.order !== entry.order && sameRate(k.voice, entry.voice));
      if (rival && entry.out > COHERENT_FLOOR * rival.out) {
        entry.voice.targetGain = 0;
        entry.voice.suppressed = true;
        continue;
      }
      entry.voice.held = true;
      kept.push(entry);
    }
  }
}
