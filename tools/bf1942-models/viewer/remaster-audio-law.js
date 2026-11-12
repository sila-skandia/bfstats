// Remaster audio (features/remaster-browser, AUDIO.md): the numbers and the
// pure functions behind the modern spatial chain `remaster-audio.js` builds
// under `?remaster`. Nothing here touches Web Audio or the page, so every law
// runs under node (`tests/test_remaster_audio.mjs`).
//
// None of this is the retail game. The retail chain is DirectSound's
// no-virtualization amplitude pan (`ds3d-pan.js`, ledger SND-30) with no
// reverb, no occlusion, no air absorption and no propagation delay for a
// soldier's report. These are a modern game's answers to the same sounds:
// what a listener on a real battlefield would hear, tuned by ear-free
// measurement (the harness renders and the numbers in AUDIO.md).

/** Speed of sound, m/s (dry air at 20 C). */
export const SPEED_OF_SOUND = 343;

// --- distance ---------------------------------------------------------------

/**
 * Air absorption, as one low-pass whose cutoff falls with distance.
 *
 * Real air takes the top off a sound at a rate that grows with frequency
 * (ISO 9613-1, 20 C, 50 % RH: about 0.025 dB/m at 4 kHz and 0.08 dB/m at
 * 8 kHz), so a shot 400 m away has lost 10 dB at 4 kHz and 30 at 8. One
 * 12 dB/octave low-pass cannot follow that curve exactly. The law below is
 * gentler than real air, on purpose: the game's sounds were mixed for a
 * chain with no air at all, and a full ISO filter on them dulled every
 * fight past 50 m (the owner, 2026-11-12: "too muffled... like having
 * headphones on"). So the corner is a Butterworth's -3 dB and it moves
 * late and slowly:
 *
 *   fc(d) = AIR_TOP                                 d <= AIR_NEAR
 *   fc(d) = AIR_TOP * (AIR_NEAR / d) ^ AIR_EXPONENT  beyond, floored at AIR_FLOOR
 *
 * 25 m: 20 kHz (untouched), 50 m: 13 kHz, 100 m: 8.7 kHz, 400 m: 3.8 kHz,
 * 1.2 km and beyond: 2 kHz.
 */
export const AIR_TOP = 20000;
export const AIR_NEAR = 25;
export const AIR_EXPONENT = 0.6;
export const AIR_FLOOR = 2000;

export function airAbsorptionCutoff(distance) {
  const d = Number.isFinite(distance) ? Math.max(0, distance) : 0;
  if (d <= AIR_NEAR) return AIR_TOP;
  return Math.max(AIR_FLOOR, AIR_TOP * (AIR_NEAR / d) ** AIR_EXPONENT);
}

/**
 * How much of a voice goes to the reverb, relative to its dry level.
 *
 * In a real space the reverberant field is nearly the same level everywhere
 * while the direct sound falls 6 dB a doubling, so the farther the source the
 * more of what reaches the ear is reverb. The dry level a voice arrives with
 * is the game's own distance law (the script's ramps and DirectSound's
 * minDistance / d), so the send grows with the square root of distance to
 * give back about half of that fall: 0.15 at 1 m, 0.3 at 10 m, 0.95 at
 * 100 m, capped at 1.05 (from about 120 m). Each space's `level` then sets
 * how reverberant it is on top (a room's return is nine times the field's).
 */
export const WET_AT_10M = 0.3;
export function wetSendFor(distance) {
  const d = Number.isFinite(distance) ? Math.max(0, distance) : 0;
  const k = Math.min(3.5, Math.max(0.5, Math.sqrt(d / 10)));
  return WET_AT_10M * k;
}

// --- occlusion --------------------------------------------------------------

/** An occluded voice's low-pass at full occlusion, Hz, and its gain. A wall
 *  or a hill between the ear and the source takes the top off and about
 *  5 dB with it; diffraction round the edge keeps the bottom. Gentler than
 *  a solid wall measures (700 Hz, 7 dB at first): the hulls are a building's
 *  outline, not its windows and doors, and at 700 Hz every fight behind a
 *  hut sounded like it was under a blanket. */
export const OCCLUDED_CUTOFF = 1500;
export const OCCLUDED_GAIN = 0.55;

/** How quickly a voice's occlusion follows its rays, seconds (time constant). */
export const OCCLUSION_TAU = 0.15;

/**
 * What one survey of a source's line says, as an occlusion amount 0..1.
 * `direct`: the straight line from the ear to the source is blocked.
 * `over`: the line from the ear to a point OVER_LIFT metres above the source
 * is blocked too (null when it was not cast: a terrain block is a hill, and
 * the source stays behind it). A wall the sound can come over, or round,
 * is half.
 */
export const OVER_LIFT = 3;
export function occlusionFromRays(direct, over = null) {
  if (!direct) return 0;
  if (over === false) return 0.5;
  return 1;
}

/** The low-pass cutoff and gain for an occlusion amount, interpolated on a
 *  log-frequency scale so a half-occluded voice is dull, not muffled. */
export function occlusionFilter(amount) {
  const a = Math.min(1, Math.max(0, Number.isFinite(amount) ? amount : 0));
  return {
    cutoff: AIR_TOP * (OCCLUDED_CUTOFF / AIR_TOP) ** a,
    gain: 1 - (1 - OCCLUDED_GAIN) * a,
  };
}

/**
 * The order in which voices get the occlusion rays a survey can spend:
 * audible ones first, nearer before farther, and a voice whose last ray is
 * old climbs the list so a far one is never starved. Pure: the score.
 */
export function occlusionPriority(audible, distance, age) {
  if (!(audible > 0)) return 0;
  const d = Number.isFinite(distance) ? Math.max(0, distance) : 0;
  return audible / (1 + d / 50) * (1 + Math.max(0, age || 0) * 4);
}

// --- surroundings -----------------------------------------------------------

/** The four spaces the reverb chooses between. */
export const SPACES = ['open', 'woods', 'builtup', 'inside'];

/**
 * The impulse response of each space, generated at load (`generateImpulse`):
 * no file is downloaded. Times in seconds, frequencies in Hz.
 *
 *  - `rt60`     time for the diffuse tail to fall 60 dB
 *  - `predelay` before the first sound of the tail
 *  - `onset`    the tail's fade-in, so it grows out of the early reflections
 *  - `early`    discrete reflections: [time, gain, pan -1..1]
 *  - `bright` / `dark`  the tail's low-pass cutoff at its start and its end
 *    (high frequencies die first, as they do in air and on soft surfaces)
 *  - `tail`     the diffuse tail's energy against the taps' (default 1)
 *  - `level`    the return's level, relative to the open field's
 *
 * Open ground: almost nothing. A weak ground bounce at 4 ms and two slaps
 * off a far treeline or hill (140 and 310 ms), over a short dark tail.
 * Woods: no discrete echo, a long dense diffuse tail, the top absorbed by the
 * leaves (Sabine-free: a forest's measured RT60 is 1 to 2 s at mid
 * frequencies; 1.6 here).
 * Built-up: a street between buildings, discrete slaps off the house fronts
 * (18 to 125 ms, alternating sides) and a bright tail of 1.3 s.
 * Inside: a room, dense reflections in the first 12 ms and a short bright
 * tail (0.55 s), the loudest return of the four: at 4 m from a rifle in
 * a room the reverb is 5 dB under the report, where the open field's is 21.
 */
export const SPACE_IRS = {
  open: {
    rt60: 0.7, predelay: 0.002, onset: 0.03, bright: 5000, dark: 1200, level: 0.4,
    early: [[0.004, 0.2, 0], [0.14, 0.3, -0.6], [0.31, 0.18, 0.5]], tail: 0.6,
  },
  woods: {
    rt60: 1.6, predelay: 0.006, onset: 0.06, bright: 4500, dark: 1100, level: 1.4,
    early: [[0.004, 0.3, 0], [0.011, 0.18, -0.4], [0.017, 0.16, 0.5], [0.026, 0.14, -0.2],
            [0.035, 0.12, 0.3], [0.048, 0.1, -0.5]],
  },
  builtup: {
    rt60: 1.3, predelay: 0.008, onset: 0.04, bright: 8000, dark: 2500, level: 2.0,
    early: [[0.018, 0.5, -0.7], [0.031, 0.42, 0.7], [0.047, 0.35, -0.5], [0.066, 0.3, 0.6],
            [0.09, 0.24, -0.6], [0.125, 0.18, 0.5], [0.17, 0.12, -0.3]],
  },
  inside: {
    rt60: 0.55, predelay: 0.001, onset: 0.008, bright: 7000, dark: 3000, level: 3.5,
    early: [[0.002, 0.6, -0.5], [0.0035, 0.55, 0.5], [0.005, 0.5, -0.2], [0.0068, 0.45, 0.3],
            [0.0085, 0.4, -0.6], [0.0105, 0.36, 0.6], [0.012, 0.32, 0]],
  },
};

/** The longest an impulse response runs, s. */
export const IR_MAX_SECONDS = 2.2;

/** A seeded uniform -1..1 source, so the IRs and the tests are repeatable. */
export function noiseSource(seed = 1) {
  let s = (seed >>> 0) || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return (s / 4294967296) * 2 - 1;
  };
}

/**
 * One space's impulse response, two channels of `Float32Array`: decorrelated
 * noise under an exponential decay to -60 dB at `rt60`, low-passed by a
 * one-pole filter whose cutoff glides from `bright` to `dark` across the
 * tail, faded in over `onset`, with the `early` reflections laid on top as
 * single-sample taps panned by equal power. Normalised to unit energy (sum
 * of squares over both channels) times `level`, so the four spaces sit at
 * the loudness their `level` says rather than at whatever their length made.
 */
export function generateImpulse(sampleRate, params, seed = 1) {
  const rate = sampleRate > 0 ? sampleRate : 48000;
  const p = params || SPACE_IRS.open;
  const seconds = Math.min(IR_MAX_SECONDS, p.rt60 * 1.15 + p.predelay);
  const n = Math.max(1, Math.round(seconds * rate));
  const left = new Float32Array(n);
  const right = new Float32Array(n);
  const rand = [noiseSource(seed * 2 + 1), noiseSource(seed * 2 + 7)];
  const decayK = 6.907755 / p.rt60;          // ln(1000): -60 dB at rt60
  const pre = Math.round(p.predelay * rate);
  const lp = [0, 0];
  for (let i = pre; i < n; i++) {
    const t = (i - pre) / rate;
    const env = Math.exp(-decayK * t) * Math.min(1, t / Math.max(1e-4, p.onset));
    const along = Math.min(1, t / p.rt60);
    const fc = p.bright * (p.dark / p.bright) ** along;
    const a = 1 - Math.exp(-2 * Math.PI * fc / rate);
    lp[0] += a * (rand[0]() - lp[0]);
    lp[1] += a * (rand[1]() - lp[1]);
    left[i] = lp[0] * env;
    right[i] = lp[1] * env;
  }
  // The one-pole loses level as it closes; the energy normalisation below
  // puts it back, so only the balance of early and late is set here: the
  // tail's whole energy at `tail` (default 1) against the taps' own gains
  // squared (0.2 for the open field's, 1.5 for the room's).
  let tail = 0;
  for (let i = 0; i < n; i++) tail += left[i] * left[i] + right[i] * right[i];
  const tailScale = tail > 0 ? Math.sqrt((p.tail ?? 1) / tail) : 0;
  for (let i = 0; i < n; i++) { left[i] *= tailScale; right[i] *= tailScale; }
  for (const [time, gain, pan] of p.early || []) {
    const i = Math.round(time * rate);
    if (i < 0 || i >= n) continue;
    const x = (Math.max(-1, Math.min(1, pan)) + 1) / 2;
    left[i] += gain * Math.cos(x * Math.PI / 2);
    right[i] += gain * Math.sin(x * Math.PI / 2);
  }
  let energy = 0;
  for (let i = 0; i < n; i++) energy += left[i] * left[i] + right[i] * right[i];
  const norm = energy > 0 ? (p.level ?? 1) / Math.sqrt(energy) : 0;
  for (let i = 0; i < n; i++) { left[i] *= norm; right[i] *= norm; }
  return [left, right];
}

/**
 * What surrounds the listener, from one survey (`surveyProbe` below makes
 * it): the four spaces' weights, summing to 1.
 *
 * `probe`:
 *  - `overhead`  distance to a hull above the ear (a roof), or null
 *  - `walls`     for each horizontal ray, the distance to the hull it met
 *                within WALL_REACH, or null
 *  - `terrain`   how many horizontal rays met the ground within WALL_REACH
 *                (a cutting, a valley wall: half a building's worth)
 *  - `trees`     placed trees and bushes within TREE_RADIUS of the ear
 *
 * Inside: a roof within ROOF_REACH and walls on most sides close by. A roof
 * with open sides (a hangar, a porch) is half inside, half built-up.
 * Built-up: hulls met on several sides within WALL_REACH. Woods: tree density.
 * Open: what is left.
 */
export const ROOF_REACH = 14;
export const ROOM_REACH = 12;
export const WALL_REACH = 45;
export const TREE_RADIUS = 30;
export function classifySurroundings(probe) {
  const walls = Array.isArray(probe?.walls) ? probe.walls : [];
  const rays = Math.max(1, walls.length);
  const met = walls.filter(d => d != null && d <= WALL_REACH).length;
  const close = walls.filter(d => d != null && d <= ROOM_REACH).length;
  const roofed = probe?.overhead != null && probe.overhead <= ROOF_REACH;
  const terrain = Math.max(0, probe?.terrain || 0);

  let inside = 0;
  if (roofed) {
    const enclosed = close / rays;               // 1: walled on every side
    inside = Math.min(1, Math.max(0, (enclosed - 0.35) / 0.4));
  }
  const sides = (met + 0.5 * terrain) / rays;    // 0..1.5
  let builtup = Math.min(1, Math.max(0, (sides - 0.2) / 0.4));
  if (roofed) builtup = Math.max(builtup, 0.5);
  builtup *= 1 - inside;
  const trees = Math.max(0, probe?.trees || 0);
  let woods = Math.min(1, Math.max(0, (trees - 4) / 12));
  woods *= (1 - inside) * (1 - builtup);
  const open = Math.max(0, 1 - inside - builtup - woods);
  const sum = open + woods + builtup + inside;
  return { open: open / sum, woods: woods / sum, builtup: builtup / sum, inside: inside / sum };
}

/** The horizontal directions a survey casts, as unit [x, z] pairs. */
export const SURVEY_RAYS = 8;
export function surveyDirections(count = SURVEY_RAYS) {
  const out = [];
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2;
    out.push([Math.cos(a), Math.sin(a)]);
  }
  return out;
}

/**
 * One survey around `ear` ({x, y, z}), through the caller's two queries:
 * `castHull(ox, oy, oz, dx, dy, dz, max)` the distance to the first hull
 * (a static: a building, a wall, a bunker) or null, and
 * `groundAt(x, z)` the terrain height or NaN; `trees(x, z, r)` counts the
 * placed trees within r. 1 + SURVEY_RAYS hull rays and as many terrain
 * march probes (4 samples each).
 */
export function surveyProbe(ear, { castHull, groundAt = null, trees = null }) {
  const overhead = castHull ? castHull(ear.x, ear.y + 0.2, ear.z, 0, 1, 0, 40) : null;
  const walls = [];
  let terrain = 0;
  for (const [dx, dz] of surveyDirections()) {
    walls.push(castHull ? castHull(ear.x, ear.y, ear.z, dx, 0, dz, WALL_REACH) : null);
    if (groundAt) {
      for (const s of [6, 15, 28, 45]) {
        const g = groundAt(ear.x + dx * s, ear.z + dz * s);
        if (Number.isFinite(g) && g > ear.y + 1) { terrain += 1; break; }
      }
    }
  }
  return { overhead, walls, terrain, trees: trees ? trees(ear.x, ear.z, TREE_RADIUS) : 0 };
}

/** How quickly the reverb follows a change of surroundings, s. */
export const SPACE_TAU = 0.6;

/** The geometry of a placed template that counts as a tree or a bush. */
export const TREE_PATTERN = /palm|tree|pine|spruce|^eu_asp|aspen|oak|birch|\bfir\b|_fir|beech|elm|poplar|cypress|olive|willow|jungle_plant|bush|hedge|shrub|bamb|forest|conifer|larch|maple|cedar|birk|tanne|fichte/i;
export function isTreeTemplate(name) {
  return typeof name === 'string' && TREE_PATTERN.test(name);
}

// --- the passing round ------------------------------------------------------

/**
 * When a supersonic round's shock reaches the ear, and from where.
 *
 * A round along a straight line at speed v (Mach M = v / c) drags a cone
 * behind it whose half-angle is asin(1 / M). The listener at `along` metres
 * down the line and `miss` metres off it hears the shock that left the line
 * at x = along - miss / sqrt(M^2 - 1), at
 *
 *   t = (along + miss * sqrt(M^2 - 1)) / v
 *
 * seconds after the shot (the first moment the cone's surface touches him),
 * from the direction of that point. A subsonic round has no shock; a shock
 * that would have left the line before the muzzle, or after the round's end,
 * never existed. Returns { time, emit, distance } (the emission point's
 * metres down the line and its distance to the ear), or null.
 */
export function crackArrival(along, miss, speed, length = Infinity, c = SPEED_OF_SOUND, minEmit = 5) {
  if (!(speed > c * 1.02) || !Number.isFinite(along) || !Number.isFinite(miss)) return null;
  const m = Math.max(0, miss);
  const k = Math.sqrt((speed / c) ** 2 - 1);
  const emit = along - m / k;
  if (emit < minEmit || emit > length) return null;
  return { time: (along + m * k) / speed, emit, distance: Math.hypot(along - emit, m) };
}

/** When the muzzle report reaches a listener `distance` metres from the gun. */
export function reportDelay(distance, c = SPEED_OF_SOUND) {
  return Number.isFinite(distance) && distance > 0 ? distance / c : 0;
}

/** The farthest off its line a round is heard to crack, m. */
export const CRACK_REACH = 40;

/**
 * An N-wave's length, s, at `miss` metres: Whitham's far-field law grows it
 * as the fourth root of the distance; a rifle round's is about 0.2 ms at a
 * metre and 0.4 ms at 20.
 */
export function crackDuration(miss) {
  const m = Math.max(0.5, Number.isFinite(miss) ? miss : 1);
  return 0.0002 * m ** 0.25;
}

/** Its level, 0..1: the shock's overpressure falls as miss^-3/4. */
export function crackGain(miss) {
  const m = Math.max(2, Number.isFinite(miss) ? miss : 2);
  return Math.min(1, (2 / m) ** 0.75);
}

/**
 * The crack itself, one channel: an N-wave (a jump up, a straight fall
 * through zero to the same depth, a jump back) of `crackDuration`, its
 * ground reflection `bounce` seconds later at half level and opposite sign
 * softened by two samples, then a 12 ms decaying burst of filtered noise for
 * the whip the ear hears after the snap. Returns a Float32Array.
 */
export function nWave(sampleRate, miss = 5, bounce = 0.004, seed = 3) {
  const rate = sampleRate > 0 ? sampleRate : 48000;
  const dur = crackDuration(miss);
  const n = Math.round(rate * 0.04);
  const out = new Float32Array(n);
  const len = Math.max(2, Math.round(dur * rate));
  const lay = (start, scale) => {
    for (let i = 0; i < len; i++) {
      const j = start + i;
      if (j >= 0 && j < n) out[j] += scale * (1 - (2 * i) / (len - 1));
    }
  };
  lay(Math.round(0.001 * rate), 1);
  lay(Math.round((0.001 + bounce) * rate), -0.45);
  const rand = noiseSource(seed);
  let hp = 0, prev = 0;
  const start = Math.round(0.001 * rate) + len;
  for (let j = start; j < n; j++) {
    const t = (j - start) / rate;
    const x = rand();
    hp = 0.6 * (hp + x - prev);
    prev = x;
    out[j] += 0.18 * hp * Math.exp(-t / 0.004);
  }
  return out;
}
