// A `.ssc` layer's modulators, evaluated: the `Ramp` and `Linear` envelopes and
// the control sources they read. Split out of `engine-audio.js`, whose header
// says why none of these numbers is hard-coded there.

/** Linear interpolation clamped to 0..1, the shape every `.ssc` ramp has. */
export const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * `Ramp p1 p2 p3 p4 [p5 p6]`, as the client evaluates it (BF1942.exe Ramp
 * ctor 0x00803a10, `getModulation` 0x00803aa0; ledger SSC-7). `p3` at or
 * below p1, `p3 + p4` at or above p2, and between them a curve that p5 picks
 * and p6 shapes (the ctor's defaults: p5 0, p6 1.0):
 *
 *   p5 0  linear  p3 + p4 * (x - p1) / (p2 - p1)
 *   p5 1  quick   p3 + p4 * (1 - ((x - p2) / (p1 - p2)) ^ p6)   (0x00803a70)
 *   p5 2  slow    p3 + p4 * ((x - p1) / (p2 - p1)) ^ p6         (0x00803b33)
 *   other         p3 + p3: the branch adds the local holding p3 to itself
 *                 (0x00803b85), not to a shape value
 *
 * p5 is truncated (ftol 0x00804af0). A p2 under p1 is raised to p1 first
 * (0x00803aaf), and `p1 == p2` is a step that is already up AT p1
 * (0x00803ae2..0x00803af9). `p4` is signed, so a fade-out is a negative
 * delta. Most six-param ramps are engine `Pitch` curves (shape 2).
 */
function rampAt(params, x) {
  const [a = 0, b0 = 0, base = 0, delta = 0, shape = 0, exp = 1] = params;
  const b = b0 < a ? a : b0;
  if (x > a) {
    if (!(x < b)) return base + delta;
    const s = Math.trunc(shape);
    if (s === 0) return base + delta * ((x - a) / (b - a));
    if (s === 1) return base + delta * (1 - ((x - b) / (a - b)) ** exp);
    if (s === 2) return base + delta * ((x - a) / (b - a)) ** exp;
    return base + base;
  }
  return a === b && x >= a ? base + delta : base;
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
    // so feeding the same normalised rpm channel serves both. It is one value
    // in the engine too: `Default` is the object's control slot 0, which an
    // Engine fills with its revs (ledger SND-18). Another object fills it with
    // its own number, `c.default`: a turret's turning rate, a track's nothing.
    case 'default': return c.default ?? c.rpm;
    default: return null;
  }
}

/** One modulator's factor at these controls, or null when its source has no
 *  value here (`controlValue`). */
export function modulatorValue(m, c) {
  const x = controlValue(m.source, c);
  if (x === null || x === undefined) return null;
  return m.envelope === 'linear' ? linearAt(m.params, x) : rampAt(m.params, x);
}

export function modulate(modulators, c, initial) {
  let out = initial;
  for (const m of modulators) {
    const x = controlValue(m.source, c);
    if (x === null || x === undefined) continue;
    out *= m.envelope === 'linear' ? linearAt(m.params, x) : rampAt(m.params, x);
  }
  return out;
}
