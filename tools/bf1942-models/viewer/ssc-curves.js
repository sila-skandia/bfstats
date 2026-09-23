// A `.ssc` layer's modulators, evaluated: the `Ramp` and `Linear` envelopes and
// the control sources they read. Split out of `engine-audio.js`, whose header
// says why none of these numbers is hard-coded there.

/** Linear interpolation clamped to 0..1, the shape every `.ssc` ramp has. */
export const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

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

export function modulate(modulators, c, initial) {
  let out = initial;
  for (const m of modulators) {
    const x = controlValue(m.source, c);
    if (x === null || x === undefined) continue;
    out *= m.envelope === 'linear' ? linearAt(m.params, x) : rampAt(m.params, x);
  }
  return out;
}
