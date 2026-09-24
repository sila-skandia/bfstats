// Drives `viewer/body-statics.js` outside a browser and prints one JSON blob.
//
// `body-statics.js` imports `body-contact.js` (for `Response`'s accumulators
// and the `shares` rule) and nothing else, so `test_body_statics.py` copies
// both in beside this file and rewrites the import. Everything the module
// asks of the static world arrives through the `FakeStatics` adapter below,
// whose geometry is one axis-aligned plane per fixture so that every expected
// number can be derived by hand from
// `features/bf1942-engine-reference/subsystems/collision-response.md` §5.3,
// §5.5, §6.1 and §6.3.
import { Response, CollisionPart, shares } from './body-contact.mjs';
import { collideWithStatics, staticShare, STATIC_MASS } from './body-statics.mjs';

const out = {};

function identity() { return [[1, 0, 0], [0, 1, 0], [0, 0, 1]]; }

// --- a body, the duck-typed interface `body-contact.js` documents ----------

class FakeBody {
  constructor({ mass = 2500, pos = [0, 0, 0], v = [0, 0, 0], w = [0, 0, 0],
                sleeping = false, boundingRadius = 2 } = {}) {
    this.mass = mass;
    this.isStatic = false;
    this.pos = pos.slice();
    this.axes = identity();
    this.v = v.slice();
    this.w = w.slice();
    this.sleeping = sleeping;
    this.boundingRadius = boundingRadius;
    this.translateCalls = [];
    this.accelCalls = [];
  }
  wake() { this.sleeping = false; }
  tangentSpeed(p, o) {
    const rx = p[0] - this.pos[0], ry = p[1] - this.pos[1], rz = p[2] - this.pos[2];
    o[0] = this.v[0] + (this.w[1] * rz - this.w[2] * ry);
    o[1] = this.v[1] + (this.w[2] * rx - this.w[0] * rz);
    o[2] = this.v[2] + (this.w[0] * ry - this.w[1] * rx);
    return o;
  }
  translate(dp) {
    this.pos[0] += dp[0]; this.pos[1] += dp[1]; this.pos[2] += dp[2];
    this.translateCalls.push([dp[0], dp[1], dp[2]]);
  }
  addAccelerationAt(p, a) { this.accelCalls.push({ p: p.slice(), a: a.slice() }); }
  addAcceleration() {}
  addFrictionAt() {}
}

/**
 * The static world as one plane, plus a log of every question asked.
 *
 * `plane` is `{ axis, at, sign }`: the plane `axis = at`, whose outward side
 * (the side a body approaches from) is `sign`. A ray crossing it from the
 * `sign` side reports the crossing point, the material, and the normal
 * pointing back the way the ray came — which is what `WorldCollider`'s own
 * two-sided triangle test does (see the module header's divergence note).
 */
class FakeStatics {
  constructor({ plane = null, material = 45, near = true, support = null } = {}) {
    this.plane = plane;
    this.material = material;
    this._near = near;
    this.support = support;
    this.casts = [];
    this.nearCalls = [];
    this.hit = { t: 0, x: 0, y: 0, z: 0, nx: 0, ny: 0, nz: 0, material: 0, owner: -1 };
  }
  near(x, y, z, dx, dy, dz, dist, radius, owner, stepTop) {
    this.nearCalls.push({ x, y, z, dx, dy, dz, dist, radius, owner, stepTop });
    return this._near;
  }
  supportY(x, z, fromY) {
    this.supportAsked = { x, z, fromY };
    return this.support === null ? NaN : this.support;
  }
  cast(ox, oy, oz, dx, dy, dz, maxDist, owner, stepTop) {
    this.casts.push({ o: [ox, oy, oz], d: [dx, dy, dz], maxDist, owner, stepTop });
    if (!this.plane) return null;
    const { axis, at, sign } = this.plane;
    const o = [ox, oy, oz][axis], d = [dx, dy, dz][axis];
    if (d === 0) return null;
    const t = (at - o) / d;
    if (!(t > 1e-6 && t <= maxDist)) return null;
    // Only from the outward side: the ray has to be heading into the plane.
    if (Math.sign(o - at) !== sign) return null;
    const h = this.hit;
    h.t = t;
    h.x = ox + dx * t; h.y = oy + dy * t; h.z = oz + dz * t;
    h.nx = 0; h.ny = 0; h.nz = 0;
    h[['nx', 'ny', 'nz'][axis]] = sign;    // back toward the ray's start
    h.material = this.material;
    h.owner = 7;
    return h;
  }
}

/** `contactMaterialValues`' shape, with the section 9.4 defaults. */
function handlers(extra = {}) {
  return {
    materialValues: () => ({ friction: 1.0, elasticity: 0, resistance: 0.01 }),
    ...extra,
  };
}

/** One collidable hull part whose layer 0 is the given local vertices. */
function part(body, vertices, { materials = null, offset = [0, 0, 0] } = {}) {
  const n = vertices.length / 3;
  const p = new CollisionPart({
    body,
    shape: {
      layers: [{
        vertices: Float32Array.from(vertices),
        vertexMaterials: Uint16Array.from(materials || new Array(n).fill(60)),
        faces: new Uint32Array(0), faceMaterials: new Uint16Array(0),
        normals: new Float32Array(0),
        min: [-9, -9, -9], max: [9, 9, 9],
      }],
      radius: 2,
    },
    response: new Response('body', 1),
    isRoot: true, offset, kind: 'body',
  });
  p.owner = 3;
  return p;
}

const TICK = 1 / 30;

// --- 1. the mass share against a static (section 6.1) ----------------------
//
// A static object's node reports mass 1e12, so `s = 1e12 / (2500 + 1e12)` is
// past the 0.95 snap and the moving body takes the whole correction.
out.share = {
  staticMass: STATIC_MASS,
  jeep: staticShare(2500),
  battleship: staticShare(35e6),
  // The inherited divergence: with the static as A, `shareB` is the ported
  // -1.0 and not the binary's +1.0 (section 6.1, "sic").
  lowSnapB: shares(STATIC_MASS, 2500)[1],
};

// --- 2. a jeep hull into a wall (sections 5.5, 6.2, 6.3, 6.4) --------------
//
// One vertex at local (0, 0, -2), body at the origin doing 10 m/s along -Z,
// a wall at z = -2.1 whose outward side is +Z. The probe runs from
// `pos - v*dt = (0, 0, 0.3333)` to the vertex at (0, 0, -2), crosses z = -2.1
// ... it does not: the vertex has not reached the wall. Move the body to
// z = -0.2 so the vertex sits at -2.2, 0.1 m past the wall:
//
//   S = (0, 0, -0.2) - (0, 0, -10)/30 = (0, 0, 0.13333)
//   E = (0, 0, -2.2)
//   n = (0, 0, +1)            back toward S
//   P = (0, 0, -2.1)
//   depth = (E - P) . n = -0.1
//   posAdjust = -depth * n = (0, 0, +0.1)
//   vRel = (0, 0, -10) at the contact; speedAdjust = -(vRel.n)n = (0, 0, +10)
//   solve: translate (0,0,0.1); accel = speedAdjust * 30 * (1 + 0) / 2
//        = (0, 0, 150) at P
{
  const body = new FakeBody({ pos: [0, 0, -0.2], v: [0, 0, -10] });
  const p = part(body, [0, 0, -2]);
  const statics = new FakeStatics({ plane: { axis: 2, at: -2.1, sign: 1 } });
  const applied = collideWithStatics([p], statics, TICK, handlers());
  const r = p.response;
  const rec = {
    applied,
    casts: statics.casts.length,
    castOrigin: statics.casts[0].o,
    posAdjust: r.posAdjust.slice(),
    speedAdjust: r.speedAdjust.slice(),
    avgNormal: r.avgNormal.slice(),
    avgRelPos: r.avgRelPos.slice(),
    count: r.count,
    friction: r.friction,
  };
  const pos = [0, 0, 0];
  p.worldPos(pos);
  r.solve(body, pos, r);
  rec.translate = body.translateCalls.slice();
  rec.accel = body.accelCalls.slice();
  rec.bodyPos = body.pos.slice();
  out.wall = rec;
}

// --- 3. a side-on ram carries no friction (section 8) ---------------------
//
// The same contact: the averaged normal is horizontal, so `N.y` is 0 and the
// Coulomb budget `mu * N.y * |g|` it hands the friction pass is 0. A contact
// on a horizontal face (a crate top) hands over `N.y = 1`.
{
  const side = new FakeBody({ pos: [0, 0, -0.2], v: [0, 0, -10] });
  const sp = part(side, [0, 0, -2]);
  collideWithStatics([sp], new FakeStatics({ plane: { axis: 2, at: -2.1, sign: 1 } }),
    TICK, handlers());
  // The vertex sits at y = -0.2, 0.05 m into a horizontal face at -0.15.
  const top = new FakeBody({ pos: [0, 0.3, 0], v: [0, -10, 0] });
  const tp = part(top, [0, -0.5, 0]);
  collideWithStatics([tp], new FakeStatics({ plane: { axis: 1, at: -0.15, sign: 1 } }),
    TICK, handlers());
  out.frictionNormals = {
    sideNy: sp.response.avgNormal[1],
    topNy: tp.response.avgNormal[1],
  };
}

// --- 4. the probe spans the whole tick (section 5.5's anti-tunnelling) -----
//
// A body doing 150 m/s covers 5 m in a tick. The probe starts 5 m back, so a
// wall the vertex has already passed through is still found.
{
  const body = new FakeBody({ pos: [0, 0, -5], v: [0, 0, -150] });
  const p = part(body, [0, 0, -0.5]);
  const statics = new FakeStatics({ plane: { axis: 2, at: -2, sign: 1 } });
  const applied = collideWithStatics([p], statics, TICK, handlers());
  out.tunnel = {
    applied,
    castOrigin: statics.casts[0].o,
    maxDist: statics.casts[0].maxDist,
    // The wall is 3.5 m behind the vertex, so the push-out is that deep.
    posAdjust: p.response.posAdjust.slice(),
  };
}

// --- 5. the gates: sleeping, the broadphase, the owner --------------------
{
  const asleep = new FakeBody({ pos: [0, 0, -0.2], v: [0, 0, -10], sleeping: true });
  const ap = part(asleep, [0, 0, -2]);
  const s1 = new FakeStatics({ plane: { axis: 2, at: -2.1, sign: 1 } });
  const sleepApplied = collideWithStatics([ap], s1, TICK, handlers());

  const awake = new FakeBody({ pos: [0, 0, -0.2], v: [0, 0, -10] });
  const bp = part(awake, [0, 0, -2]);
  const s2 = new FakeStatics({ plane: { axis: 2, at: -2.1, sign: 1 }, near: false });
  const nearApplied = collideWithStatics([bp], s2, TICK, handlers());

  const third = new FakeBody({ pos: [0, 0, -0.2], v: [0, 0, -10] });
  const cp = part(third, [0, 0, -2]);
  const s3 = new FakeStatics({ plane: { axis: 2, at: -2.1, sign: 1 }, support: 1.25 });
  collideWithStatics([cp], s3, TICK, handlers());

  out.gates = {
    sleepApplied, sleepCasts: s1.casts.length,
    nearApplied, nearCasts: s2.casts.length, nearAsked: s2.nearCalls.length,
    owner: s3.casts[0].owner,
    // `supportY` + the kerb allowance is what a drivable deck's lip is gated
    // against; 1.25 + 1.0.
    stepTop: s3.casts[0].stepTop,
  };
}

// --- 6. the handler and the 0.1 threshold (section 6.2) -------------------
{
  // Fast: the handler runs, and a false return skips the response entirely.
  const veto = new FakeBody({ pos: [0, 0, -0.2], v: [0, 0, -10] });
  const vp = part(veto, [0, 0, -2], { materials: [61] });
  const seen = [];
  const vetoApplied = collideWithStatics(
    [vp], new FakeStatics({ plane: { axis: 2, at: -2.1, sign: 1 }, material: 90 }), TICK,
    handlers({ onStatic: (partArg, vRel, normal, pos, matSelf, matOther) => {
      seen.push({ matSelf, matOther, vRel: vRel.slice(), normal: normal.slice(),
                  pos: pos.slice() });
      return false;
    } }));

  // Slow: below |vRel|^2 = 0.1 the handler is not called and the response
  // still runs (a resting contact costs no `handleCollision`).
  const slow = new FakeBody({ pos: [0, 0, -2.05], v: [0, 0, -0.3] });
  const sp = part(slow, [0, 0, -0.1]);
  let called = 0;
  const slowApplied = collideWithStatics(
    [sp], new FakeStatics({ plane: { axis: 2, at: -2.1, sign: 1 } }), TICK,
    handlers({ onStatic: () => { called++; return true; } }));

  out.handler = {
    vetoApplied, seen, vetoPosAdjust: vp.response.posAdjust.slice(),
    slowApplied, slowCalled: called,
    slowPosAdjust: sp.response.posAdjust.slice(),
  };
}

// --- 6b. an Obstacle's own handler (section 6.2, `Obstacle::handleCollision`
// 0x08315e10): against anything but a soldier it returns false, so a hull
// at speed passes barbed wire; at rest the handlers are skipped and the
// wire still pushes, as any static does.
{
  const obstacleStatics = (obstacle) => {
    const s = new FakeStatics({ plane: { axis: 2, at: -2.1, sign: 1 } });
    s.asked = [];
    s.obstacle = owner => { s.asked.push(owner); return obstacle; };
    return s;
  };
  const fast = new FakeBody({ pos: [0, 0, -0.2], v: [0, 0, -10] });
  const fp = part(fast, [0, 0, -2]);
  const fs = obstacleStatics(true);
  const fastApplied = collideWithStatics([fp], fs, TICK, handlers({ onStatic: () => true }));

  const slow = new FakeBody({ pos: [0, 0, -2.05], v: [0, 0, -0.3] });
  const sp = part(slow, [0, 0, -0.1]);
  const ss = obstacleStatics(true);
  const slowApplied = collideWithStatics([sp], ss, TICK, handlers());

  const wall = new FakeBody({ pos: [0, 0, -0.2], v: [0, 0, -10] });
  const wp = part(wall, [0, 0, -2]);
  const ws = obstacleStatics(false);
  const wallApplied = collideWithStatics([wp], ws, TICK, handlers());

  out.obstacle = {
    fastApplied, fastAsked: fs.asked, fastPosAdjust: fp.response.posAdjust.slice(),
    slowApplied, slowAsked: ss.asked.length,
    wallApplied,
  };
}

// --- 7. every vertex is probed, and one hit per vertex accumulates --------
//
// `setAdjust` keeps the larger of two same-sign contributions rather than
// stacking them (section 6.3), so two vertices through the same wall do not
// double the push-out.
{
  const body = new FakeBody({ pos: [0, 0, -0.2], v: [0, 0, -10] });
  const p = part(body, [-0.5, 0, -2, 0.5, 0, -2, -0.5, 0.4, -2, 0.5, 0.4, -2]);
  const statics = new FakeStatics({ plane: { axis: 2, at: -2.1, sign: 1 } });
  const applied = collideWithStatics([p], statics, TICK, handlers());
  out.manyVertices = {
    applied, casts: statics.casts.length,
    posAdjust: p.response.posAdjust.slice(),
    count: p.response.count,
  };
}

// --- 8. a three-vertex part is a single probe (section 5.5's n < 4) -------
{
  const body = new FakeBody({ pos: [0, 0, -0.2], v: [0, 0, -10] });
  const p = part(body, [0, 0, -2, 0.3, 0, -2, -0.3, 0, -2]);
  const statics = new FakeStatics({ plane: { axis: 2, at: -2.1, sign: 1 } });
  collideWithStatics([p], statics, TICK, handlers());
  out.threeVertices = { casts: statics.casts.length };
}

process.stdout.write(JSON.stringify(out, null, 2));
