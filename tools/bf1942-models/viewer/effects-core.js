// The Refractor effect system's arithmetic, with no renderer attached.
//
// What an EffectBundle does when it plays was read out of the engine — the
// Linux dedicated server's named code and the retail client's stripped code,
// side by side; the addresses are in
// `features/bf1942-engine-reference/subsystems/projectiles-and-impacts.md`.
// This module is that reading as functions: how a CRD random variable is
// sampled, how the bundle's frame is stood up on a surface normal, how an
// emitter's clock spaces its spawns, where in the frame a particle starts and
// with what velocity, and how it falls, slows, scales and fades. `effects.js`
// gives these three.js meshes; nothing here imports anything, so
// `tests/effects_harness.mjs` can run it under node and assert on numbers.

// The world's downward acceleration. `BasicPhysicsSystem`'s constructor
// (client 0x00578f00) writes -14.73, not -9.81; `physics.js` owns the same
// constant, but this module keeps its own copy so it stays import-free.
export const GRAVITY = -14.73;

// A mesh particle's `PointPhysicsNode` mass, hardcoded 1.0 in the node's own
// constructor and never touched by `Particle::Particle` (EMT-5, verify-r8.md
// R8-11: both overloads fully disassembled, zero `setMass` calls in either).
// `physics.js`'s `PointBody` defaults `mass` too, for the same reason.
const PARTICLE_MASS = 1.0;

// Wind, a world property beside gravity that the same drag law is relative
// to (`physics.js`'s `WIND` constant) — zero in every vanilla level (no
// `.con` word sets a world wind), so this module keeps a bare zero rather
// than threading a vector through `spawnParticle`/`integrateParticle` for a
// case no authored effect exercises.
const DRAG_WIND = 0;

/**
 * Sample a CRD random variable `[dist, a, b, mirror]`.
 *
 * `Random::getContinuousRandom` (lnxded 0x081e28b0) and the emitter's inline
 * copy (0x081e2f10): NONE is `a`; UNIFORM is `a + r(b - a)` with `r` in
 * (0, 1] — the two numbers are the ends, in the order written, so
 * `CRD_UNIFORM/15/1/0` runs 15 down to 1; EXPONENTIAL is `-a ln r`; NORMAL is
 * `a + b N(0,1)`. The mirror flag flips the sign with probability one half
 * (0x081e3037: `r > 0.5 ? -x : x`), which is how one `positionalSpeedInRight
 * CRD_UNIFORM/0/3/1` spreads a burst to both sides.
 */
export function sampleCrd(crd, rand = Math.random) {
  if (crd == null) return 0;
  if (typeof crd === 'number') return crd;
  const [dist, a, b, mirror] = crd;
  let value;
  switch (dist) {
    case 'u': { const r = 1 - rand(); value = a + r * (b - a); break; }
    case 'e': { const r = Math.max(1 - rand(), 1e-7); value = -a * Math.log(r); break; }
    case 'g': value = a + b * gaussian(rand); break;
    default: value = a;
  }
  if (mirror && rand() > 0.5) value = -value;
  return value;
}

/** Box-Muller, one draw. `Random::getNormal` caches the second; this does not. */
export function gaussian(rand = Math.random) {
  let u = 0;
  while (u === 0) u = rand();
  const v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** Piecewise-linear sample of an over-time ramp at `phase` (0..100). */
export function sampleCurve(points, phase) {
  if (!points || !points.length) return null;
  if (phase <= points[0][0]) return points[0].slice(1);
  for (let i = 1; i < points.length; i++) {
    if (phase <= points[i][0]) {
      const [t0, ...v0] = points[i - 1];
      const [t1, ...v1] = points[i];
      const k = t1 === t0 ? 1 : (phase - t0) / (t1 - t0);
      return v0.map((v, j) => v + (v1[j] - v) * k);
    }
  }
  return points[points.length - 1].slice(1);
}

/**
 * `sampleCurve` without the arrays: writes the components into `out` and
 * returns how many it wrote, or -1 for the `null` the allocating form returns.
 *
 * Same arithmetic, term for term — `tests/effects_harness.mjs` asserts the two
 * agree on the end branches, the interior branch and a multi-component ramp.
 * It exists because the allocating form is on the per-particle-per-frame path
 * (`evalParticleInto` below and `integrateParticle`'s three ramps), where each
 * call was three fresh arrays: the two rest-element destructures and the `map`
 * (features/mesh-viewer-performance, rule 5).
 *
 * `out` is the caller's scratch and is valid only until its next call — never
 * hold it. `sampleCurve` stays the export for everything else.
 */
export function sampleCurveInto(points, phase, out) {
  if (!points || !points.length) return -1;
  const first = points[0];
  if (phase <= first[0]) return fill(out, first);
  for (let i = 1; i < points.length; i++) {
    const b = points[i];
    if (phase <= b[0]) {
      const a = points[i - 1];
      const k = b[0] === a[0] ? 1 : (phase - a[0]) / (b[0] - a[0]);
      // The allocating form maps over `v0`, so the component count is the
      // EARLIER point's, and a shorter later point makes `v1[j]` undefined and
      // the result NaN. Kept exactly, NaN included, rather than quietly fixed.
      for (let j = 1; j < a.length; j++) out[j - 1] = a[j] + (b[j] - a[j]) * k;
      out.length = a.length - 1;
      return a.length - 1;
    }
  }
  return fill(out, points[points.length - 1]);
}

/** `point.slice(1)` — the components without the phase — in place. `out` is
 *  truncated to the count so a component this ramp does not carry reads
 *  `undefined`, the same thing it reads off `sampleCurve`'s shorter array,
 *  rather than the last call's leftover. */
function fill(out, point) {
  for (let j = 1; j < point.length; j++) out[j - 1] = point[j];
  out.length = point.length - 1;
  return point.length - 1;
}

// One scratch for every ramp sampled on the per-frame path. Safe to share:
// `integrateParticle` and `evalParticleInto` never nest, and each consumes a
// sample before taking the next.
const _curve = [];

function norm(v) {
  const l = Math.hypot(v[0], v[1], v[2]);
  return l > 1e-12 ? [v[0] / l, v[1] / l, v[2] / l] : null;
}
function cross(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
// Refractor's world is Z-forward and the exporter mirrors Z into glTF, so
// every cross product here is taken on the Refractor side of that mirror and
// the result mirrored back — otherwise the frame's handedness flips and Right
// comes out on the left.
const mirror = (v) => [v[0], v[1], -v[2]];

/**
 * The frame an impact effect is stood up in: `{right, up, dof}`, Refractor
 * axes (X right, Y up, Z forward), given and returned in the viewer's
 * glTF-handed world.
 *
 * `Game::playCollisionEffect` (client 0x0040e590, lnxded 0x0805de20) writes
 * the surface normal into the fresh object's Up row and calls
 * `makeOrthonormalBasis` (client 0x0040e360, lnxded 0x08061bd0): Right =
 * Up x DOF (DOF being the object's own, which for a just-created object is
 * the world's +Z), then DOF = Right x Up, then Right = Up x DOF again. So the
 * bullet hole lies flat in the surface and the burst's forward axis is the
 * projection of world forward onto the surface. A wall facing exactly along
 * the world axis leaves the engine's cross product zero and its call failing;
 * this falls back to world +X there, which is the one departure and the
 * reason it is named.
 */
export function basisFromNormal(normal) {
  const up = norm(mirror(normal));
  if (!up) return null;
  let right = norm(cross(up, [0, 0, 1]));
  if (!right) right = norm(cross(up, [1, 0, 0]));
  const dof = norm(cross(right, up));
  right = norm(cross(up, dof));
  return { right: mirror(right), up: mirror(up), dof: mirror(dof) };
}

/** The same frame from an explicit forward and up (an attached trail's). */
export function basisFromAxes(dof, up) {
  const d = norm(mirror(dof));
  let u = norm(mirror(up));
  if (!d) return null;
  if (!u || Math.abs(d[0] * u[0] + d[1] * u[1] + d[2] * u[2]) > 0.999) {
    u = Math.abs(d[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  }
  const right = norm(cross(u, d));
  const upOrtho = norm(cross(d, right));
  return { right: mirror(right), up: mirror(upOrtho), dof: mirror(d) };
}

/**
 * Roll a frame about its own DOF by `degrees` — `dice::ref2::roll`
 * (lnxded 0x08061df0) rotating about matrix row 2. This is what
 * `startRotation` does to an emitter's frame per spawn; the data writes it in
 * degrees (`CRD_UNIFORM/1/360/0`).
 */
export function rollBasis(basis, degrees) {
  if (!degrees) return basis;
  const t = degrees * Math.PI / 180;
  const c = Math.cos(t), s = Math.sin(t);
  const { right, up, dof } = basis;
  return {
    dof,
    right: [right[0] * c + up[0] * s, right[1] * c + up[1] * s, right[2] * c + up[2] * s],
    up: [up[0] * c - right[0] * s, up[1] * c - right[1] * s, up[2] * c - right[2] * s],
  };
}

/** `a·right + b·up + c·dof`, as a fresh array. */
export function inFrame(basis, r, u, d) {
  const { right, up, dof } = basis;
  return [
    right[0] * r + up[0] * u + dof[0] * d,
    right[1] * r + up[1] * u + dof[1] * d,
    right[2] * r + up[2] * u + dof[2] * d,
  ];
}

// How long an emitter waits between spawns when its intensity is zero: the
// engine's `calcInvItensity` answers 100 s for a non-finite reciprocal.
const IDLE_INTERVAL = 100;

/**
 * One emitter's clock.
 *
 * `Emitter::handleUpdate` (lnxded 0x081e3200): the delay counts down first;
 * then a lifetime sampled from `timeToLive` runs, during which a spawn falls
 * due every `|1 / intensity|` seconds — the reciprocal, unsigned, of an
 * intensity resampled per spawn (`calcInvItensity`, 0x081e2f10) and scaled by
 * the emitter's own speed over `IntensityAtSpeed` when that is set. A looping
 * emitter resamples and starts over when its lifetime ends; any other stops.
 *
 * The first spawn is due at once. That is the one rule here settled by data
 * rather than by reading the code: the decal emitters declare `intensity 2`
 * over `timeToLive 0.1`, one fifth of a spawn by the arithmetic, and every hit
 * in the reference recording leaves a hole.
 *
 * Two edges (ledger EMT-2, re-read 2026-09-16): when a `delay` runs out
 * mid-tick, `age` grows by the delay's own pre-tick value, not by the
 * leftover past zero (0x081e32ae-0x081e32ce) — the tail of that tick, past
 * where the delay hit zero, is simply not simulated, so the clock
 * permanently lags real time by that much. And the burst ends at
 * `age >= timeToLive` (0x081e3305): a burst is no longer alive on the exact
 * tick `age` reaches `timeToLive`, not one tick later.
 */
export class EmitterClock {
  constructor(spec, rand = Math.random) {
    this.spec = spec;
    this.rand = rand;
    this.delay = Math.max(0, sampleCrd(spec.delay, rand));
    this.ttl = sampleCrd(spec.timeToLive, rand);
    this.age = 0;
    this.next = 0;
    this.done = false;
    this.stopped = false;
    this.spawned = 0;
  }

  interval(speed) {
    let intensity = sampleCrd(this.spec.intensity, this.rand);
    const atSpeed = this.spec.intensityAtSpeed;
    if (atSpeed > 1e-7) intensity *= speed / atSpeed;
    const inv = Math.abs(1 / intensity);
    return Number.isFinite(inv) ? inv : IDLE_INTERVAL;
  }

  /** Advance by `dt`; returns how many particles fall due this step. */
  step(dt, speed = 0) {
    if (this.done || this.stopped) return 0;
    if (this.delay > 0) {
      const preDelay = this.delay;
      this.delay -= dt;
      if (this.delay > 0) return 0;
      // Emitter::handleUpdate (0x081e32ae-0x081e32ce): the tick the delay
      // runs out advances age by the delay's own pre-tick value, not by the
      // leftover past zero — the rest of this tick's dt is never simulated.
      dt = preDelay;
      this.delay = 0;
    }
    this.age += dt;
    let count = 0;
    // A ttl of -1 (`CRD_NONE/-1/0/0`, the trails) lives as long as its parent.
    // Otherwise the burst ends at age >= timeToLive (0x081e3305), not after.
    const alive = this.ttl < 0 || this.age < this.ttl;
    while (alive && this.age >= this.next && count < 64) {
      count++;
      this.next += this.interval(speed);
    }
    if (!alive) {
      if (this.spec.looping) {
        this.ttl = sampleCrd(this.spec.timeToLive, this.rand);
        this.age = 0;
        this.next = 0;
      } else {
        this.done = true;
      }
    }
    this.spawned += count;
    return count;
  }
}

/**
 * A freshly spawned particle, in world space.
 *
 * Position: the emitter's origin plus `relativePosition` along the (rolled)
 * frame's DOF/Up/Right. Velocity: `positionalSpeed` along the same axes,
 * plus the emitter's own velocity times `emitterSpeedScale` when
 * `addEmitterSpeed` is set — the rocket trail's puffs inherit 50 m/s and
 * `drag 20` stops them, which is the trail. Every scalar is a fresh CRD draw.
 */
export function spawnParticle(spec, basis, origin, emitterVelocity, rand = Math.random) {
  const p = spec.particle;
  const frame = rollBasis(basis, sampleCrd(spec.startRotation, rand));
  const rel = spec.relativePosition || {};
  const spd = spec.positionalSpeed || {};
  const offset = inFrame(frame, sampleCrd(rel.right, rand), sampleCrd(rel.up, rand),
                         sampleCrd(rel.dof, rand));
  const velocity = inFrame(frame, sampleCrd(spd.right, rand), sampleCrd(spd.up, rand),
                           sampleCrd(spd.dof, rand));
  if (spec.addEmitterSpeed && emitterVelocity) {
    const k = spec.emitterSpeedScale ?? 1;
    velocity[0] += emitterVelocity[0] * k;
    velocity[1] += emitterVelocity[1] * k;
    velocity[2] += emitterVelocity[2] * k;
  }
  const ttl = Math.max(sampleCrd(p.timeToLive, rand), 0.01);
  return {
    kind: p.kind,
    spec: p,
    position: [origin[0] + offset[0], origin[1] + offset[1], origin[2] + offset[2]],
    velocity,
    frame,
    age: 0,
    ttl,
    // The particle's own base numbers, drawn once; the ramps multiply them.
    size: p.size ? sampleCrd(p.size, rand) : 1,
    gravity: p.gravityModifier ? sampleCrd(p.gravityModifier, rand) : (p.kind === 'mesh' && !p.debris ? 0 : 1),
    drag: p.drag ? sampleCrd(p.drag, rand) : 0,
    rotation: sampleCrd(p.initRotation, rand),
    spin: sampleCrd(p.rotationSpeed, rand),
    xy: p.xySizeRatio ? sampleCrd(p.xySizeRatio, rand) : 1,
    // EMT-5: the bounding radius `integrateParticle`'s drag law needs,
    // `pi * r^2` standing in for the body's frontal area. Only a `kind
    // === 'mesh'` particle has a `PointPhysicsNode` at all (R8-16..18); its
    // radius is the mesh's own local bounding box, `effects.js` computing
    // `length(boundsMax)` once per template from the real exported geometry
    // when the effect library loads (R8-13/14) — not a CRD, not resampled
    // here. Left at 0 for a sprite (no physics body to report one, R8-16) or
    // a mesh whose geometry did not resolve; `integrateParticle` treats 0 as
    // "unknown" and falls back rather than silently dropping all drag.
    radius: p.radius || 0,
    // Texture-atlas flipbooks (ledger SPR-6): a sprite with more than one
    // `numAnimationFrames` rolls its starting frame and its speed once per
    // particle, the same as `initRotation`/`rotationSpeed`
    // (`geom::ParticleSystem::addParticle`, client 0x0060a680). Zero on
    // every other particle, so `integrateParticle` can skip the whole thing
    // with one comparison.
    animFrame: p.numAnimationFrames > 1 ? sampleCrd(p.initAnimationFrame, rand) : 0,
    animSpeed: p.numAnimationFrames > 1 ? sampleCrd(p.animationSpeed, rand) : 0,
  };
}

/**
 * Move a particle by `dt`: gravity (`gravityModifier`, ramped by
 * `gravityModifierOverTime` — `Particle::handleUpdate`, lnxded 0x0820ad20,
 * feeds the product to the body each tick) and drag.
 *
 * EMT-5 (verify-r8.md, both binaries): a mesh particle's body is a
 * `PointPhysicsNode`, and `PointPhysicsNode::updatePositionalDragSimple`
 * (client 0x00578990, lnxded 0x08255fc0, byte-identical) is
 *
 *     accel -= (scale*v - wind) * pi * r^2 * drag / mass
 *
 * — wind-relative and scaled by frontal area over mass, not the plain
 * `-drag*v` this used to assume. `physics.js`'s `applyDrag` is the same law
 * for the rest of the viewer; this module keeps its own copy (see
 * `PARTICLE_MASS`/`DRAG_WIND` above) so it stays import-free. Two of the
 * three unknowns that blocked this are now closed: mass is always 1.0
 * (R8-11, `PARTICLE_MASS`) and `r` is the spawned particle's own `radius`
 * (R8-13/14, set in `spawnParticle`). The third, `scale` — `1 +
 * 24*min(underWater/r, 1)` — stays at its dry value of 1: what field the
 * engine's `underWater` actually reads is still open (`physics.js`'s own
 * `DRAG_SUBMERSION_SCALE` note; every caller in this viewer passes 0), and
 * `DRAG_WIND` is 0 on every vanilla level, so this reduces to the drag-only
 * ODE `dv/dt = -k v` with `k = pi * r^2 * drag` (mass dropped).
 *
 * The multiplicative decay below (`v *= e^(-k dt)`) is that ODE's own exact
 * closed form, but it is not literally what `PointBody`'s own `applyDrag` +
 * `integrate` compute (`physics.js`, same `0x00578990`/`0x00578aa0` engine
 * addresses): the engine evaluates the drag acceleration *once* per whole
 * tick from the pre-tick velocity, then applies it over four `dt/4`
 * semi-implicit sub-steps — algebraically a single forward-Euler step for
 * velocity, `v' = v(1 - k dt)`, not `v e^{-k dt}`. The two agree to first
 * order in `k dt` and diverge beyond it (a 2nd-order term); for every real
 * mesh-particle `drag`/`radius` pair surveyed (`Fx_RichoStoneDecal`-scale
 * props at a 60 Hz step, `k dt` ~ 0.02) the difference is under 0.03% per
 * tick, so this is a deliberate choice, not an oversight: the exact-ODE form
 * also stays bounded and non-oscillating for any `dt` (a dropped frame's
 * large `dt` cannot flip `v`'s sign the way forward-Euler's `(1 - k dt)` can
 * once `k dt > 2`), which matters more for a browser than exact parity with
 * the engine's own discrete stepping. `PointBody` (`physics.js`) is the
 * class to use where bit-exact engine parity actually matters (e.g. replay).
 * A `kind !== 'mesh'` particle (a sprite) has no `PointPhysicsNode` at all
 * (R8-16..18) and this law is not shown to apply to it — see `SPR-3`'s
 * still-open consumption path — so it
 * keeps the old bare-`drag` exponential, an explicit approximation, not the
 * engine's proven behaviour. The same fallback covers a mesh particle whose
 * `radius` did not resolve (0): better an approximate drag than none.
 */
export function integrateParticle(p, dt, gravity = GRAVITY) {
  p.age += dt;
  const phase = Math.min(p.age / p.ttl, 1) * 100;
  // The three ramps below go through `sampleCurveInto`: this runs per live
  // particle per frame and the allocating form was three arrays a call
  // (features/mesh-viewer-performance, rule 5). `_curve` is consumed on the
  // line after each sample and never held.
  let g = p.gravity;
  const gRamp = sampleCurveInto(p.spec.gravityModifierOverTime, phase, _curve);
  if (gRamp >= 0) g *= _curve[0];
  let drag = p.drag;
  const dRamp = sampleCurveInto(p.spec.dragOverTime, phase, _curve);
  if (dRamp >= 0) drag *= _curve[0];
  const v = p.velocity;
  if (g) v[1] += gravity * g * dt;
  if (drag > 0) {
    const k = p.kind === 'mesh' && p.radius > 0
      ? Math.PI * p.radius * p.radius * drag / PARTICLE_MASS
      : drag;
    const decay = Math.exp(-k * dt);
    v[0] = DRAG_WIND + (v[0] - DRAG_WIND) * decay;
    v[1] = DRAG_WIND + (v[1] - DRAG_WIND) * decay;
    v[2] = DRAG_WIND + (v[2] - DRAG_WIND) * decay;
  }
  p.position[0] += v[0] * dt;
  p.position[1] += v[1] * dt;
  p.position[2] += v[2] * dt;
  if (p.spin) p.rotation += p.spin * dt;
  // Flipbook advance (ledger SPR-6): `draw` (client 0x0060a0e0, the block at
  // 0x0060a5c4-0x0060a60e) adds `animationSpeed * animationSpeedOverTime(phase)
  // * dt / numAnimationFrames` to the particle's frame position every call —
  // frames per second, not phase-indexed like a lookup table, and in frame
  // units (not full cycles: dividing by the frame count happens once, here,
  // not twice). `p.animFrame` is left exactly as `FUN_00609ea0` seeds it
  // (the raw `initAnimationFrame`, e.g. 8 of 16 for `fx_expl_core`) until the
  // first call that has a frame count to divide by.
  if (p.spec.numAnimationFrames > 1) {
    const ramp = sampleCurveInto(p.spec.animationSpeedOverTime, phase, _curve);
    p.animFrame += p.animSpeed * (ramp >= 0 ? _curve[0] : 1) * dt / p.spec.numAnimationFrames;
  }
  return p.age < p.ttl;
}

/**
 * What a particle looks like right now: `{scale, xy, color, opacity, rotation}`.
 *
 * Sprites: size x `sizeOverTime`, colour and alpha from `colorRGBAOverTime`
 * (0..255), the quad spun by `initRotation + rotationSpeed t` degrees.
 * Meshes: `sizeModifier` set means scale = size x sizeOverTime x
 * sizeModifier, unset means the authored mesh size; alpha from
 * `alphaOverTime` (0..1), sent to the mesh the way the engine sends it to
 * `IStandardMesh::setAlpha` — and the decal's own `alphaTestRef 0.5` then
 * cuts it off at half, so a hole fades to 50% and vanishes, which is the
 * engine's behaviour too, not a shortcut.
 */
export function evalParticle(p) {
  const spec = p.spec;
  const phase = Math.min(p.age / p.ttl, 1) * 100;
  const ramp = sampleCurve(spec.sizeOverTime, phase);
  const size = ramp ? ramp[0] : 1;
  let scale;
  if (p.kind === 'sprite') {
    scale = [p.size * size, p.size * size, 1];
    const xyRamp = sampleCurve(spec.xySizeRatioOverTime, phase);
    const xy = p.xy * (xyRamp ? xyRamp[0] : 1);
    if (xy !== 1) scale[0] *= xy;
  } else if (spec.sizeModifier && (spec.sizeModifier[0] || spec.sizeModifier[1] || spec.sizeModifier[2])) {
    const m = spec.sizeModifier;
    scale = [p.size * size * m[0], p.size * size * m[1], p.size * size * m[2]];
  } else {
    scale = [1, 1, 1];
  }
  let color = null;
  let opacity = 1;
  const rgba = sampleCurve(spec.colorRGBAOverTime, phase);
  if (rgba) {
    color = [rgba[0] / 255, rgba[1] / 255, rgba[2] / 255];
    opacity = rgba[3] / 255;
  }
  const alpha = sampleCurve(spec.alphaOverTime, phase);
  if (alpha) opacity *= alpha[0];
  return { scale, color, opacity, rotation: p.rotation, phase };
}

// `evalParticleInto`'s answer, one record for the whole module. `color` is
// either `_look.rgb` or null, the same two states `evalParticle` returns.
const _look = { scale: [0, 0, 0], rgb: [0, 0, 0], color: null, opacity: 1, rotation: 0, phase: 0 };

/**
 * `evalParticle` without the ten objects: the same record, filled in place.
 *
 * `EffectPlayer.#draw` reads every field and keeps none, once per live particle
 * per frame — 190 of them under a Bazooka's `e_rocketFume` — and the allocating
 * form built a `scale` array, usually a `color` array, a result object and up
 * to four ramp samples of three arrays each for it (rule 5). Same arithmetic,
 * term for term; `tests/effects_harness.mjs` asserts the two agree.
 *
 * THE RETURNED RECORD AND ITS `scale`/`color` ARRAYS ARE MODULE SCRATCH and
 * are valid only until the next call — never hold one past the statement that
 * reads it, the way `hud.js`'s `SEAT_DOT_AT` is documented. `evalParticle`
 * stays the export for every caller that wants its own object.
 */
export function evalParticleInto(p) {
  const spec = p.spec;
  const phase = Math.min(p.age / p.ttl, 1) * 100;
  const n = sampleCurveInto(spec.sizeOverTime, phase, _curve);
  const size = n >= 0 ? _curve[0] : 1;
  const scale = _look.scale;
  if (p.kind === 'sprite') {
    scale[0] = p.size * size; scale[1] = p.size * size; scale[2] = 1;
    const xyn = sampleCurveInto(spec.xySizeRatioOverTime, phase, _curve);
    const xy = p.xy * (xyn >= 0 ? _curve[0] : 1);
    if (xy !== 1) scale[0] *= xy;
  } else if (spec.sizeModifier
             && (spec.sizeModifier[0] || spec.sizeModifier[1] || spec.sizeModifier[2])) {
    const m = spec.sizeModifier;
    scale[0] = p.size * size * m[0];
    scale[1] = p.size * size * m[1];
    scale[2] = p.size * size * m[2];
  } else {
    scale[0] = 1; scale[1] = 1; scale[2] = 1;
  }
  _look.color = null;
  let opacity = 1;
  const rgban = sampleCurveInto(spec.colorRGBAOverTime, phase, _curve);
  if (rgban >= 0) {
    _look.rgb[0] = _curve[0] / 255;
    _look.rgb[1] = _curve[1] / 255;
    _look.rgb[2] = _curve[2] / 255;
    _look.color = _look.rgb;
    opacity = _curve[3] / 255;
  }
  const alphan = sampleCurveInto(spec.alphaOverTime, phase, _curve);
  if (alphan >= 0) opacity *= _curve[0];
  _look.opacity = opacity;
  _look.rotation = p.rotation;
  _look.phase = phase;
  return _look;
}

/**
 * The square grid a flipbook sprite's frames sit in: `{columns, rows, cell}`
 * (`rows` always equals `columns`, `cell` the fraction of the texture one
 * frame occupies on each axis).
 *
 * `SpriteParticleNewTemplate::makeScript` reads `numAnimationFrames` as a
 * plain count, and `draw` (client 0x0060a0e0, 0x0060a56a-0x0060a5c1) turns it
 * into a column count with `FSQRT` then round-to-nearest (`FUN_00804af0`, the
 * compiler's float-to-int helper — not sqrt itself), bumped up by one when
 * the frame count does not divide evenly by it; there is no second dimension
 * computed anywhere in the function, so rows is the same number, and the
 * texture's own width/height are never read — the grid is square from the
 * frame count alone, not the texture's aspect ratio. `e_ExplAni06` (16
 * frames, `fx_expl_core`'s texture) and `e_FireEngine256` (16 frames, the
 * aircraft-fire templates) are both 256x256 — a clean 4x4 — and
 * `e_Blood_subtl` (4 frames) is 64x64, a 2x2, consistent with the rule on
 * every flipbook texture checked.
 */
export function atlasGrid(numAnimationFrames) {
  if (!numAnimationFrames || numAnimationFrames <= 1) return null;
  let columns = Math.round(Math.sqrt(numAnimationFrames));
  if (numAnimationFrames % columns !== 0) columns += 1;
  return { columns, rows: columns, cell: 1 / columns };
}

/**
 * `p`'s current flipbook frame, wrapped into `[0, numAnimationFrames)`.
 *
 * Where the accumulated frame position (`p.animFrame`, advanced in
 * `integrateParticle`) is turned into a cell was not found: `draw`'s one call
 * that takes the particle's render record — `RendPCDX8` vtable +0x90, client
 * 0x00667830 — turned out to be point-size bucketing
 * (`FUN_0062ce00`, a size-sorted linked-list insert), not the quad/UV
 * builder, and that builder was not located (open, see the doc). Every
 * vanilla template that uses `numAnimationFrames` (29 checked, `fx_expl_core`
 * through the aircraft engine fires) advances at most 4.4 frames over its own
 * particle's lifetime and never reaches the far end of its strip within it,
 * so wrap vs. clamp makes no observed difference on real data; this wraps,
 * the ordinary choice for a looping flipbook texture.
 */
export function frameIndex(p) {
  const frames = p.spec.numAnimationFrames;
  if (!frames || frames <= 1) return 0;
  const n = Math.floor(p.animFrame) % frames;
  return n < 0 ? n + frames : n;
}

/**
 * Damage falloff by distance — `Projectile::getDamage` (client 0x00542e80,
 * lnxded 0x0831f3c0): full out to `distToStartLoseDamage`, a straight line
 * down to `minDamage` (a fraction of full) at `distToMinDamage`, flat after.
 * Skipped entirely when `minDamage` is 1 or the start distance is 0.
 */
export function damageFactor(damage, distance) {
  if (!damage) return 1;
  const min = damage.minDamage ?? 1;
  const start = damage.distToStartLoseDamage ?? 0;
  const end = damage.distToMinDamage ?? 0;
  if (min >= 1 || start <= 0 || distance <= start) return 1;
  if (distance >= end || end <= start) return min;
  return min + (1 - min) * (end - distance) / (end - start);
}

/**
 * Engine `ProjectileTemplate` default splash radius when the `.con` omits
 * `radius` — the constructor's own `0x41200000` (lnxded 0x0831f9b3), and it is
 * load-bearing: six vanilla tank rounds (Sherman, Tiger, PanzerIV, T34,
 * T34-85, Chi-ha) declare no radius at all and every one of them splashes at
 * 10 m. HP-9.
 */
export const DEFAULT_SPLASH_RADIUS = 10;

/**
 * A projectile's radius as the engine holds it: truncated **toward zero**.
 *
 * HP-9. `ProjectileTemplate.radius` is a console **`int`** — the parser is
 * `istream >> int` (lnxded 0x082df83f) and the value is `fild`ed into the
 * float field (0x082df8ef) — so the truncation happens at PARSE and a
 * fractional radius never reaches the engine at all. `bf42/con.py` now does
 * the same, so a freshly extracted glb arrives already integral; this is the
 * defence for glbs baked before that, which may still carry `17.63`.
 *
 * The consequence that matters: with the engine's strictly `radius > d` gate
 * (0x08156655) and `d >= 0`, a radius below 1 truncates to 0 and means **no
 * splash at all**. DC's `50calSniper_Projectile radius 0.25` is the real case;
 * 384 templates across the installed mods author a fractional radius.
 */
export function truncateRadius(radius) {
  return Number.isFinite(radius) ? Math.trunc(radius) : radius;
}

/**
 * The distance an explosion measures to a victim, with the **Y term alone**
 * scaled by `YModOnExplosion`.
 *
 * HP-9, `handleExplosionOnObject` 0x081565c2-0x08156646: the position is the
 * victim's **transform origin** (`getPos`, IObject vtable +0x38 at
 * 0x081565c2) — not a bounding box, not the nearest surface, so a tank is not
 * hurt less for being caught on the far corner of its hull — and only `dy` is
 * multiplied (0x08156613). Engine default for the field is 1.0.
 *
 * What the scale buys, on the data: 629 of the 642 `YModOnExplosion`
 * declarations surveyed across the installed mods are `2.0` and every one of
 * those sits on a bomb. Doubling the vertical term halves a bomb's effective
 * vertical reach, which is how the game stops a 20 m airburst from killing
 * everyone on the floor below it.
 */
export function blastDistance(dx, dy, dz, yMod = 1) {
  const y = dy * (Number.isFinite(yMod) && yMod > 0 ? yMod : 1);
  return Math.sqrt(dx * dx + y * y + dz * dz);
}

/**
 * How far off the struck surface an **impact** explosion is centred: 0.1 m
 * along the collision normal.
 *
 * `GameServer::handleCollisionForProjectile` computes the explosion position
 * as `hitPos + 0.1 * normal` before handing it to `handleExplosion`: the
 * constant is loaded at lnxded 0x08153f5e from `ds:0x086b1ca0`
 * (`cdcccc3d` = 0.1f), multiplied into all three components of the normal at
 * 0x08153f6b-0x08153f73, added to the hit position at 0x08153f82-0x08153f8f,
 * and pushed as the blast centre at 0x08154026/0x08154030/0x08154037. The same
 * shape appears in the function's other two collision blocks, at 0x0815434e
 * and 0x081546f2.
 *
 * Two things it is NOT. It is not applied to the **collision effect** — that
 * is played at 0x08153e5b, before any of this, on the raw hit point. And it is
 * not applied to the **end-of-life** explosion, which stands on the
 * projectile's own `getPos()` with no offset at all (`startEndEffect`
 * 0x0831f747).
 *
 * Numerically it is small — 0.1 m out of a 10 to 30 m radius is well under 1%
 * of the falloff — but it is free and it is read, and it is always *away* from
 * whatever was struck, so the victim that took the direct hit is the one it
 * shades.
 */
export const IMPACT_BLAST_OFFSET = 0.1;

/**
 * Splash half of a projectile's damage block, or null when this round has no
 * area pass at all.
 *
 * **The engine has two explosions, and `damageType` alone does not say which a
 * round gets** (HP-9d):
 *
 *     impact, at the moment of collision:
 *         damageType === 1 && hasCollisionEffect        (0x08153e79 / 0x08153ea9)
 *     end of life, when timeToLive or the fuse runs out:
 *         damageType === 1 || damageType === 4          (0x0831f6bb / 0x0831f6c0)
 *
 * `hasCollisionEffect` is the **impact-versus-fuse discriminator**, not a
 * splash-capability flag, and the difference is the whole grenade. Requiring it
 * for splash generally — which an earlier research pass recommended and a
 * verifier refuted — would silently delete grenade, explosives-pack, satchel
 * and landmine splash, the most-used splash damage in the game. In vanilla
 * exactly three of the 28 `damageType 1` projectiles omit it
 * (`ExpPackProjectile`, `GrenadeAlliesProjectile`, `GrenadeAxisProjectile`),
 * and `LandmineProjectile` is `damageType 4`. Surveyed over every installed
 * mod's `objects*.rfa`: 3,161 `damageType 1` templates, 2,935 of them with the
 * flag, and 46 `damageType 4`.
 *
 * `damageType 4` explodes **only** at end of life, never on impact. Do not
 * read that as "so a `damageType 4` round rests where it lands and bursts
 * there" — whether a round survives contact at all is a **third** question,
 * and `diesOnContact` below is the one that answers it. Vanilla's three flak
 * shells are `damageType 4` *with* the flag set, and the flag is not dead on
 * them: it kills them on contact, with no explosion of either kind.
 *
 * Returns `{ material2, radius, damageType, hasCollisionEffect, yMod, impact,
 * endOfLife }`. `material2 -1` is the authored "no splash" (fighter MGs).
 *
 * **One radius, and it is the integer** — this is the easy thing to get wrong.
 * The ledger says the end-of-life path passes an *untruncated* radius
 * (0x0831f73e), and that is true of the code: the impact path re-truncates at
 * 0x08153f23-0x08153f58 and the end-of-life path does not. But that second
 * truncation is a **no-op in practice**, because the property is a console
 * `int` and the real truncation already happened at parse (0x082df83f). So
 * both paths see the same integer, and "untruncated" describes an absent
 * instruction rather than a surviving fraction: DC's
 * `50calSniper_Projectile radius 0.25` is 0 to the fuse path as surely as to
 * the impact path, and handing the fuse path 0.25 would resurrect a splash the
 * engine never has. `truncateRadius` is therefore applied once, here, for
 * both.
 *
 * Two fields an older baked glb will not carry, and what is assumed for it:
 * a missing `damageType` keeps being treated as **1**, the way this function
 * always has; and a missing `hasCollisionEffect` is treated as **true**, i.e.
 * impact-capable, because that is what 2,935 of 3,161 templates are and
 * assuming false would delete splash from every round in an old extract.
 * Both assumptions vanish the moment the scene is re-extracted.
 */
export function splashSpec(damage) {
  if (!damage) return null;
  const material2 = damage.material2;
  if (!(Number.isFinite(material2) && material2 >= 0)) return null;
  const damageType = damage.damageType ?? 1;
  if (damageType !== 1 && damageType !== 4) return null;
  const radius = truncateRadius(
    Number.isFinite(damage.radius) ? damage.radius : DEFAULT_SPLASH_RADIUS);
  const hasCollisionEffect = damage.hasCollisionEffect ?? true;
  const yMod = Number.isFinite(damage.yModOnExplosion) && damage.yModOnExplosion > 0
    ? damage.yModOnExplosion : 1;
  // The gate is strictly `radius > d` with `d >= 0`, so a zero radius reaches
  // nothing and is not a splash at all — on either path.
  if (!(radius > 0)) return null;
  const impact = damageType === 1 && !!hasCollisionEffect;
  const endOfLife = damageType === 1 || damageType === 4;
  if (!impact && !endOfLife) return null;
  return { material2, radius, damageType, hasCollisionEffect, yMod, impact, endOfLife };
}

/**
 * Does this round die the moment it touches anything?
 *
 * `Projectile::handleCollision` (lnxded 0x0831ee80) asks two questions and
 * recycles the round if either answers yes:
 *
 *     0x0831ef4b  cmp BYTE [tmpl+0x1a7],0   ; dieAfterColl     -> jne kill
 *     0x0831ef54  cmp BYTE [tmpl+0x1a4],0   ; hasCollisionEffect -> jne kill
 *
 * The kill is `Projectile::resetProjectile` (0x0831e720, called at
 * 0x0831f00a). It sets the round's detonate latch (`Projectile+0x10d`) and
 * despawns it, and it does **not** call `startEndEffect` — so a round that
 * dies this way never gets an end-of-life explosion, and a later `detonate()`
 * finds the latch already set and returns.
 *
 * This is the word that was missing, and the flak shells are why it matters.
 * `AA_Allies_Projectile`, `Carrier_AA_Projectile` and `Flak38_Projectile` are
 * `damageType 4` — no impact explosion, gate 0x08153e79 — but all three set
 * `hasCollisionEffect 1` (two also set `dieAfterColl 1`). So a flak round that
 * touches an aircraft, the ground or a wall is **deleted, silently**: it takes
 * its direct hit and plays its collision effect (`Game::playCollisionEffect`
 * runs at 0x08153e5b, before the explosion gate), and that is all. Reading the
 * flag as "dead on a type-4 round" and letting the shell rest where it landed
 * to burst on its fuse hands a 20 m, material2-199 blast to every AA gun
 * firing at the ground.
 *
 * Only a round with NEITHER word survives contact. In vanilla that is exactly
 * the four fuse weapons — `GrenadeAlliesProjectile`, `GrenadeAxisProjectile`,
 * `ExpPackProjectile` and `LandmineProjectile`, all four `hasCollisionEffect
 * 0` and `dieAfterColl 0`.
 *
 * Absent on an older baked glb: `hasCollisionEffect` defaults to **true** (the
 * same assumption `splashSpec` makes, and the safe one — it keeps a tank shell
 * ending at the wall), `dieAfterColl` to the engine's own **false**.
 *
 * Two further words in the same chain are read but not modelled here, and
 * named so the next reader does not rediscover them: `isSticky`
 * (`ProjectileTemplate+0x1ab`, tested 0x0831ef16) attaches the round to what
 * it struck and disables its physics, and `detonateOnWaterCollision` (+0x1ac,
 * tested 0x0831f3ae) is what lets a water contact be handled at all — without
 * it `handleCollision` returns immediately on water. Neither is set by any
 * vanilla projectile.
 */
export function diesOnContact(damage) {
  if (!damage) return true;
  return !!(damage.hasCollisionEffect ?? true) || !!damage.dieAfterColl;
}

/**
 * A **fuse** round: one whose only explosion is the end-of-life one, and
 * which lives through a contact to reach it.
 *
 * Three conditions, and the third is the one that is easy to drop:
 *
 *   1. it has an end-of-life explosion (`damageType` 1 or 4);
 *   2. it has NO impact explosion (so `hasCollisionEffect` is clear, or the
 *      type is 4);
 *   3. it SURVIVES contact (`diesOnContact` is false).
 *
 * In vanilla exactly four templates answer all three —
 * `GrenadeAlliesProjectile`, `GrenadeAxisProjectile`, `ExpPackProjectile` and
 * `LandmineProjectile`. The three flak shells pass 1 and 2 and fail 3, which
 * is the whole reason the third condition exists.
 */
export function isFuseRound(damage) {
  const splash = splashSpec(damage);
  return !!(splash && !splash.impact && splash.endOfLife) && !diesOnContact(damage);
}

/**
 * The viewer's own recycling ceiling for a round that is still **flying**.
 *
 * Nothing vanilla flies for twenty seconds; a mod round with a huge
 * `timeToLive` and a slow muzzle would otherwise sail on forever. It is a
 * viewer guard, not an engine number.
 */
export const FLIGHT_TTL_CEILING = 20;

/** Fallback when a projectile spec carries no `timeToLive` at all. */
export const DEFAULT_TIME_TO_LIVE = 10;

/**
 * How long the viewer lets a round live: its authored fuse for a **fuse**
 * round, the flight ceiling for everything else.
 *
 * The distinction only started to matter when the fuse began firing a blast.
 * `ExpPackProjectile` authors `timeToLive 240` and `LandmineProjectile` 360,
 * and the engine really does detonate them then — `Projectile::handleUpdate`
 * (lnxded 0x0831e940) calls `detonate` (0x0831e680) at the end of the fuse,
 * which is where `startEndEffect` comes from. Clamping those to 20 s does not
 * make them expire early in some harmless cosmetic sense, the way it did when
 * `timeToLive` only recycled a mesh: it drops 12 m and 4 m of real splash on
 * the player twenty seconds after he puts the charge down.
 *
 * The ceiling's own reason does not apply to a fuse round anyway. Such a round
 * comes to rest, stops moving and stops sweeping, and costs one pooled mesh
 * while its fuse runs down. What the ceiling is there to catch is a round that
 * never stops travelling.
 *
 * Same principle as the range cap in `advance`: a guard the viewer invented
 * must not invent a blast with it.
 */
export function roundTimeToLive(timeToLive, damage) {
  const authored = timeToLive || DEFAULT_TIME_TO_LIVE;
  return isFuseRound(damage) ? authored : Math.min(authored, FLIGHT_TTL_CEILING);
}

/**
 * Splash HP: `materialDamage(att2) * damageMod(att2, splashMaterial) * (1 - d/radius)`.
 * Same formula as `bf42/damage.py` `splash_damage`. Returns 0 when the tables
 * have no entry for the pairing (a Sherman splash vs tank armour).
 *
 * The falloff is the engine's exact law (HP-9, confirmed 2026-09-19):
 * `t = clamp((radius - d) * (1/radius), 0, 1)`, with `A = 1/radius` computed
 * once by `handleExplosion` (0x08156f5c) and pushed at both call sites, and
 * the cutoff a strict `radius > d` (0x08156655) — so both of the engine's own
 * clamps are dead and the `Math.max(0, ...)` below is belt and braces.
 *
 * Three things about the geometry, which are easy to assume wrongly:
 *
 *   - the distance is to the victim's **transform origin**, not to a bounding
 *     box and not to the nearest surface (`blastDistance` above);
 *   - only the **Y** term is scaled, by `YModOnExplosion`, default 1.0;
 *   - there is **no occlusion at all** for anything that is not a soldier. A
 *     tank behind a wall takes the full falloff.
 *
 * `exposure` is the one term this cannot compute. For a **soldier** victim the
 * engine replaces the seeded `1.0` (0x08156505) with what
 * `checkForHitOnSoldier` (0x08156eb6) returns at 0x08156ece, and short-circuits
 * the whole victim when it comes back `0.0` (0x08156ede) — that is the engine's
 * cover model, and it is soldier-only. The viewer has no equivalent: it has no
 * per-limb soldier collision volumes and no ray budget to sample them per
 * blast, so callers pass 1 and a soldier in cover takes full splash here where
 * the game would give him some or all of it back. Named rather than silently
 * folded in, so the gap is visible in the one place it is wrong.
 */
export function splashDamage(material2, splashMaterial, distance, radius,
                             materials, modifiers, exposure = 1) {
  if (!(radius > 0) || !(distance >= 0) || distance >= radius) return 0;
  if (!(exposure > 0)) return 0;
  const base = materials?.[material2]?.damage ?? materials?.[String(material2)]?.damage;
  if (!(base > 0)) return 0;
  const attGroup = materials?.[material2]?.attGroup
    ?? materials?.[String(material2)]?.attGroup
    ?? material2;
  const defGroup = materials?.[splashMaterial]?.defGroup
    ?? materials?.[String(splashMaterial)]?.defGroup
    ?? splashMaterial;
  const mod = modifiers?.[attGroup]?.[defGroup]
    ?? modifiers?.[String(attGroup)]?.[String(defGroup)]
    ?? modifiers?.[attGroup]?.[String(defGroup)]
    ?? modifiers?.[String(attGroup)]?.[defGroup];
  // DMG-1, and do not "fix" this. The engine's fallback for a pair with no
  // cell is `MaterialManager+0x24` (`defaultDamageMod`), and that field is
  // **0.0 for the life of the process**: both constructors write 0
  // (0x0817485e, 0x0817491e), its setter (0x08176190) is a vtable slot nothing
  // calls, and the complete registered MaterialManager name block has no
  // console property for it — so no mod can set it either. An unlisted
  // material pair really does mean no damage. A research pass recommended
  // returning the field instead; a verifier refuted it, and acting on it would
  // either change nothing or introduce a bug.
  if (mod == null) return 0;
  return base * mod * exposure * Math.max(0, 1 - distance / radius);
}
