// Drives `viewer/body-contact.js` outside a browser and prints one JSON blob.
// The module imports nothing, so — like `armor_harness.mjs` — this is the
// whole harness: a minimal fake `body` (the duck-typed interface from
// `IMPLEMENTATION.md`'s "Shared interfaces", plus `boundingRadius`, which
// this module also reads — see `body-contact.js`'s header) and hand-picked
// geometry small enough to check every number by hand. Every expectation
// asserted in `test_body_contact.py` traces to `collision-response.md` §5.2,
// §5.3, §5.5 or §6 (cited inline below), never to this module's own output.
import {
  setAdjust, shares, LOW_SNAP_SHARE_B,
  Response, CollisionPart, probe, collidePair, collideBodies,
} from './body-contact.mjs';

const out = {};

// --- a minimal fake body -----------------------------------------------

function identity() { return [[1, 0, 0], [0, 1, 0], [0, 0, 1]]; }

class FakeBody {
  constructor({ mass, isStatic = false, pos = [0, 0, 0], v = [0, 0, 0], w = [0, 0, 0],
                axes = identity(), sleeping = false, boundingRadius = 1 }) {
    this.mass = mass;
    this.isStatic = isStatic;
    this.pos = pos.slice();
    this.axes = axes.map((r) => r.slice());
    this.v = v.slice();
    this.w = w.slice();
    this.sleeping = sleeping;
    this.boundingRadius = boundingRadius;
    this.translateCalls = [];
    this.accelCalls = [];
    this.woken = false;
  }
  wake() { this.woken = true; this.sleeping = false; }
  tangentSpeed(p, out) {
    // v + w x (p - pos) — both fixtures below use w = 0, so this is just v,
    // but implemented in full so a future fixture can exercise spin.
    const rx = p[0] - this.pos[0], ry = p[1] - this.pos[1], rz = p[2] - this.pos[2];
    const cx = this.w[1] * rz - this.w[2] * ry;
    const cy = this.w[2] * rx - this.w[0] * rz;
    const cz = this.w[0] * ry - this.w[1] * rx;
    out[0] = this.v[0] + cx; out[1] = this.v[1] + cy; out[2] = this.v[2] + cz;
    return out;
  }
  translate(dp) {
    this.pos[0] += dp[0]; this.pos[1] += dp[1]; this.pos[2] += dp[2];
    this.translateCalls.push([dp[0], dp[1], dp[2]]);
  }
  addAccelerationAt(p, a) {
    this.accelCalls.push({ p: [p[0], p[1], p[2]], a: [a[0], a[1], a[2]] });
  }
  addAcceleration(a) { this.accelCalls.push({ p: null, a: [a[0], a[1], a[2]] }); }
  addFrictionAt() { /* friction pass, not this module's concern */ }
}

function handlers({ onCollision = () => true, log = null } = {}) {
  return {
    onCollision(self, other, vRel, normal, pos, matSelf, matOther) {
      if (log) {
        log.push({
          self: self.tag, other: other.tag,
          vRel: [vRel[0], vRel[1], vRel[2]], normal: [normal[0], normal[1], normal[2]],
          pos: [pos[0], pos[1], pos[2]], matSelf, matOther,
        });
      }
      return onCollision(self, other, vRel, normal, pos, matSelf, matOther);
    },
    materialValues() { return { friction: 1.0, elasticity: 0, resistance: 0.01 }; },
  };
}

// --- 1. setAdjust truth table (§6.3, C3/V0) -----------------------------

out.setAdjust = {
  empty: setAdjust(0, 5),
  emptyNegative: setAdjust(0, -3),
  emptyZero: setAdjust(0, 0),
  positivePositiveKeepsLarger: setAdjust(2, 5),
  positivePositiveKeepsLargerReversed: setAdjust(5, 2),
  positiveNegativeAdds: setAdjust(5, -2),
  positiveZeroAdds: setAdjust(5, 0),
  negativeNegativeKeepsLargerMagnitude: setAdjust(-2, -5),
  negativeNegativeKeepsLargerMagnitudeReversed: setAdjust(-5, -2),
  negativePositiveAdds: setAdjust(-5, 2),
  negativeZeroAdds: setAdjust(-5, 0),
};

// --- 2. shares (§6.1, C1/V0/V3) ------------------------------------------

out.shares = {
  equalMasses: shares(2500, 2500),                 // [0.5, -0.5]
  jeepVsSherman: shares(2500, 25000),               // s = 25000/27500 = 0.909...
  staticFaceSide: shares(2500, 1e12),               // s ~ 1, high snap -> [1, 0]
  staticVertexSide: shares(1e12, 2500),             // s ~ 0, low snap -> [0, LOW_SNAP_SHARE_B]
  highSnapBoundary: shares(1, 100),                 // s = 100/101 = 0.9901.. > 0.95
  lowSnapBoundary: shares(100, 1),                  // s = 1/101 = 0.0099.. < 0.05
  noNodeA: shares(2500, 2500, false, true),
  noNodeB: shares(2500, 2500, true, false),
  LOW_SNAP_SHARE_B,
};

// --- 3. corner drop: unit cube A falls onto a static flat box B (§5.5, §6.2) --
//
// A's whole collision layer is a single vertex at its own local origin (so
// A's root world position IS the probed corner); B is a static, large flat
// face at world y = 0, normal (0,1,0). A starts under the surface (having
// crossed it this tick) so the probe's one-tick-back start point is above
// the plane and the current point is below it — see body-contact.js's own
// `checkFaceAndEdgeCollision` for why that is what makes `e`/`s` come out
// signed the way the assertions below expect.
//
// Hand-derived (dt = 1/30, bodyA.v = (0,-3,0)):
//   relV = (0,-3,0) - (0,0,0) = (0,-3,0)
//   S = bodyA.pos - relV*dt = (0,-0.05,0) - (0,-0.1,0) = (0, 0.05, 0)
//   E = bodyA.pos (single vertex at local origin) = (0, -0.05, 0)
//   face plane y=0: e = E.y - 0 = -0.05 (depth); t = s/(-dn) with
//     s = S.y - 0 = 0.05, dn = dot(n,E-S) = -0.1, t = 0.05/0.1 = 0.5
//   hit = S + t*(E-S) = (0, 0.05 - 0.05, 0) = (0, 0, 0)

function bigFlatFace(materialId) {
  return {
    layers: [{
      vertices: new Float32Array([-50, 0, -50, 50, 0, -50, 50, 0, 50, -50, 0, 50]),
      vertexMaterials: new Uint16Array([0, 0, 0, 0]),
      faces: new Uint32Array([0, 1, 2, 0, 2, 3]),
      faceMaterials: new Uint16Array([materialId, materialId]),
      normals: new Float32Array([0, 1, 0, 0, 1, 0]),
      min: new Float32Array([-50, 0, -50]),
      max: new Float32Array([50, 0, 50]),
    }],
    radius: 70,
  };
}

function singleVertexShape(vertexMaterial, radius = 0.1) {
  return {
    layers: [{
      vertices: new Float32Array([0, 0, 0]),
      vertexMaterials: new Uint16Array([vertexMaterial]),
      faces: new Uint32Array([]),
      faceMaterials: new Uint16Array([]),
      normals: new Float32Array([]),
      min: new Float32Array([0, 0, 0]),
      max: new Float32Array([0, 0, 0]),
    }],
    radius,
  };
}

function cornerDropScene() {
  const bodyA = new FakeBody({ mass: 2500, pos: [0, -0.05, 0], v: [0, -3, 0], boundingRadius: 1 });
  const bodyB = new FakeBody({ mass: 1e12, isStatic: true, pos: [0, 0, 0], boundingRadius: 70 });
  const partA = new CollisionPart({ body: bodyA, shape: singleVertexShape(5), response: new Response(), isRoot: true });
  const partB = new CollisionPart({ body: bodyB, shape: bigFlatFace(20), response: new Response(), isRoot: true });
  partA.tag = 'A'; partB.tag = 'B';
  return { bodyA, bodyB, partA, partB };
}

{
  const { bodyA, bodyB, partA, partB } = cornerDropScene();
  const log = [];
  const applied = collidePair(partA, partB, 1 / 30, 1.0, handlers({ log }));
  out.cornerDrop = {
    applied,
    handlerLog: log,
    responseA: {
      posAdjust: partA.response.posAdjust, speedAdjust: partA.response.speedAdjust,
      count: partA.response.count, avgNormal: partA.response.avgNormal,
    },
    responseB: {
      posAdjust: partB.response.posAdjust, speedAdjust: partB.response.speedAdjust,
      count: partB.response.count,
    },
    bodyAStillMoving: bodyA.translateCalls.length === 0,   // collidePair never moves bodies itself
    bodyBStillMoving: bodyB.translateCalls.length === 0,
  };
}

// Same scene, but the first handler call vetoes the contact: no response on
// either side, and the mirror call never happens.
{
  const { partA, partB } = cornerDropScene();
  const log = [];
  const applied = collidePair(partA, partB, 1 / 30, 1.0, handlers({ log, onCollision: () => false }));
  out.cornerDropVetoed = {
    applied,
    handlerCallCount: log.length,
    responseAUntouched: partA.response.count === 0 &&
      partA.response.posAdjust.every((x) => x === 0) && partA.response.speedAdjust.every((x) => x === 0),
    responseBUntouched: partB.response.count === 0,
  };
}

// --- 4. relative speed^2 <= 0.1: no handler calls, response still applied ---
//
// A shallower fall than the corner-drop scene, so the closing speed squared
// (0.0625) sits under the 0.1 handler gate but the probe still finds a
// contact: `S.y = A.pos.y - relV.y*dt = -0.001 + 0.25/30 ~= 0.00733` (above
// the plane) and `E.y = A.pos.y = -0.001` (below it) — the segment still
// crosses y=0, unlike a naive velocity-only scale-down of the first scene
// (which would leave both endpoints on the same side and find no hit at
// all).

{
  const bodyA = new FakeBody({ mass: 2500, pos: [0, -0.001, 0], v: [0, -0.25, 0], boundingRadius: 1 });
  const bodyB = new FakeBody({ mass: 1e12, isStatic: true, pos: [0, 0, 0], boundingRadius: 70 });
  const partA = new CollisionPart({ body: bodyA, shape: singleVertexShape(5), response: new Response(), isRoot: true });
  const partB = new CollisionPart({ body: bodyB, shape: bigFlatFace(20), response: new Response(), isRoot: true });
  partA.tag = 'A'; partB.tag = 'B';
  const log = [];
  const applied = collidePair(partA, partB, 1 / 30, 1.0, handlers({ log }));
  out.lowRelSpeed = {
    vRelSq: 0.25 * 0.25,
    applied,
    handlerCallCount: log.length,
    responseAApplied: partA.response.count === 1 && !partA.response.posAdjust.every((x) => x === 0),
  };
}

// --- 5. two similar-size bodies: both directions, 0.5 each (§6.4, §12) -----
//
// Head-on along x, equal mass, equal bounding radius (well within the 4x
// ratio, so `collideBodies` — exercised below in `collideBodies` too, but
// tested numerically here via the two direction calls directly — runs both
// directions at weight 0.5). Both bodies expose a single probe vertex AND a
// small face (1 triangle) sharing that same vertex as one corner — see the
// harness header note above `threeVertexLayer` for why a hit landing
// exactly on a triangle corner still counts (`hasNeg && hasPos` can never
// both be true when two of the three edge tests are exactly zero).
//
// Hand-derived, dt = 1/30:
//   bodyA.pos=(-0.04,0,0) v=(1.5,0,0); bodyB.pos=(0.04,0,0) v=(-1.5,0,0)
//   A's vertex (local 0.05,0,0) -> world (0.01,0,0); B's face plane local
//   x=-0.05 -> world x=-0.01: overlap depth 0.02 either way (symmetric).
//   relV (dir 1, A vertex vs B face) = (3,0,0); baseCandidate (unshared) =
//     -(relV.n/n.n)*n with n=(-1,0,0) -> (-3,0,0)
//   shares(2500,2500) = [0.5,-0.5]; weight 0.5 each direction ->
//     weighted share on A from EITHER direction = 0.25 (dir1: shareA*w;
//     dir2: shareB*w using the mirrored vRel — same sign, see the module's
//     own derivation in its header/report) -> both contribute (-0.75,0,0)
//     to A's speedAdjust candidate; setAdjust keeps the larger magnitude of
//     two same-sign values, i.e. does NOT sum them -> final (-0.75,0,0).
//   solve(): elasticity 0 -> accel = speedAdjust * 30 * 1 * 0.5 = -11.25;
//     accel*dt = -0.375 = -(1/4)*rawShare(0.5)*closingSpeed(3) — "a quarter
//     of the share", matching collision-response.md §6.4's inferred note.

function headOnFace(localX, normalSign, materialId) {
  const nx = normalSign;
  return {
    layers: [{
      // 3 vertices (< MIN_VERTEX_COUNT): vertex 0 is both the probe point
      // AND one corner of this part's own face (used when it plays the face
      // role instead) — a hit landing exactly on that shared corner still
      // counts (two of the three edge cross-products come out exactly 0,
      // and zero can never disagree in sign with the third — see F11 /
      // `checkFaceAndEdgeCollision`'s "zero counts as inside").
      vertices: new Float32Array([localX, 0, 0, localX, 1, 1, localX, -1, 1]),
      vertexMaterials: new Uint16Array([materialId, materialId, materialId]),
      faces: new Uint32Array([0, 1, 2]),
      faceMaterials: new Uint16Array([materialId]),
      normals: new Float32Array([nx, 0, 0]),
      min: new Float32Array([localX, -1, 0]),
      max: new Float32Array([localX, 1, 1]),
    }],
    radius: 0.1,
  };
}

function headOnScene(radiusA = 1, radiusB = 1) {
  const bodyA = new FakeBody({ mass: 2500, pos: [-0.04, 0, 0], v: [1.5, 0, 0], boundingRadius: radiusA });
  const bodyB = new FakeBody({ mass: 2500, pos: [0.04, 0, 0], v: [-1.5, 0, 0], boundingRadius: radiusB });
  const partA = new CollisionPart({ body: bodyA, shape: headOnFace(0.05, 1, 11), response: new Response(), isRoot: true });
  const partB = new CollisionPart({ body: bodyB, shape: headOnFace(-0.05, -1, 22), response: new Response(), isRoot: true });
  partA.tag = 'A'; partB.tag = 'B';
  return { bodyA, bodyB, partA, partB };
}

{
  const { bodyA, bodyB, partA, partB } = headOnScene();
  const dt = 1 / 30;
  collidePair(partA, partB, dt, 0.5, handlers());   // direction 1: A vertex, B face
  collidePair(partB, partA, dt, 0.5, handlers());   // direction 2: B vertex, A face

  const rootA = partA.response, rootB = partB.response;
  // Snapshot before `solve()`, which zeroes posAdjust/speedAdjust once applied.
  const speedAdjustA = rootA.speedAdjust.slice(), speedAdjustB = rootB.speedAdjust.slice();
  const posAdjustANonZero = !rootA.posAdjust.every((x) => x === 0);

  const posA = [0, 0, 0]; partA.worldPos(posA);
  const posB = [0, 0, 0]; partB.worldPos(posB);
  rootA.solve(bodyA, posA, rootA);
  rootB.solve(bodyB, posB, rootB);

  out.symmetricBothDirections = {
    countA: rootA.count, countB: rootB.count,        // 2 each: both directions landed a hit
    speedAdjustA, speedAdjustB,
    posAdjustAWasNonZero: posAdjustANonZero,
    bodyATranslated: bodyA.translateCalls.length === 1,
    bodyBTranslated: bodyB.translateCalls.length === 1,
    accelA: bodyA.accelCalls.length === 1 ? bodyA.accelCalls[0].a : null,
    accelB: bodyB.accelCalls.length === 1 ? bodyB.accelCalls[0].a : null,
    impliedVelocityChangeA: bodyA.accelCalls.length === 1 ? bodyA.accelCalls[0].a[0] * dt : null,
  };
}

// --- 6. one body 5x the other's bounding radius: one direction only --------
//
// `collideBodies` applies the broadphase filters `collidePair` itself
// skips (part radius >= 0.45, at least one side with >= 4 raw col0
// vertices) — reuse the "three vertex" scene's B face (4 vertices, part
// radius 12) so this pair clears both, and give A the root bounding radius
// ratio (1 vs 5) that selects a single direction (§5.3).

{
  const bodyA = new FakeBody({ mass: 2500, pos: [-0.04, 0, 0], v: [1.5, 0, 0], boundingRadius: 1 });
  const bodyB = new FakeBody({ mass: 2500, pos: [0.04, 0, 0], v: [-1.5, 0, 0], boundingRadius: 5 });
  const partA = new CollisionPart({ body: bodyA, shape: headOnFace(0.05, 1, 11), response: new Response(), isRoot: true });
  const partB = new CollisionPart({ body: bodyB, shape: bigYFace(-0.05, -1, 22), response: new Response(), isRoot: true });
  partA.tag = 'small'; partB.tag = 'big';
  const log = [];
  collideBodies([partA, partB], 1 / 30, handlers({ log }));
  out.fiveXLargerOneDirection = {
    countA: partA.response.count, countB: partB.response.count,   // 1 each: exactly one direction ran
    // `collidePair(vertexPart, facePart, ...)` calls the vertex part's own
    // handler first — the log's first entry names whichever part supplied
    // the probed vertex, independent of the parts array's own A/B order.
    firstHandlerSelf: log[0].self,
  };
}

// --- 7. static B: A takes everything, via the full collideBodies pipeline --

{
  const { bodyA, partA, partB } = cornerDropScene();
  collideBodies([partA, partB], 1 / 30, handlers());
  out.staticBTakesEverything = {
    responseACount: partA.response.count,
    responseAPosAdjust: partA.response.posAdjust,
    responseBUntouched: partB.response.count === 0 &&
      partB.response.posAdjust.every((x) => x === 0),
    bodyAUnmoved: bodyA.translateCalls.length === 0,   // collideBodies doesn't call solve
  };
}

// --- 8. a 3-vertex layer probes only vertex 0 (§5.5: "if n<4, n=1") --------

function threeVertexLayer() {
  return {
    layers: [{
      // Three vertices at the same x/z, different y — vertex 1 and 2 sit
      // squarely inside B's big face too, so if the probe tested them the
      // count below would come out 3, not 1.
      vertices: new Float32Array([0.05, 0, 0, 0.05, 2, 0, 0.05, 4, 0]),
      vertexMaterials: new Uint16Array([5, 6, 7]),
      faces: new Uint32Array([]),
      faceMaterials: new Uint16Array([]),
      normals: new Float32Array([]),
      min: new Float32Array([0.05, 0, 0]),
      max: new Float32Array([0.05, 4, 0]),
    }],
    radius: 0.1,
  };
}

function bigYFace(localX, normalSign, materialId) {
  const nx = normalSign;
  return {
    layers: [{
      vertices: new Float32Array([localX, -10, -1, localX, 10, -1, localX, 10, 5, localX, -10, 5]),
      vertexMaterials: new Uint16Array([0, 0, 0, 0]),
      faces: new Uint32Array([0, 1, 2, 0, 2, 3]),
      faceMaterials: new Uint16Array([materialId, materialId]),
      normals: new Float32Array([nx, 0, 0, nx, 0, 0]),
      min: new Float32Array([localX, -10, -1]),
      max: new Float32Array([localX, 10, 5]),
    }],
    radius: 12,
  };
}

{
  const bodyA = new FakeBody({ mass: 2500, pos: [-0.04, 0, 0], v: [1.5, 0, 0], boundingRadius: 1 });
  const bodyB = new FakeBody({ mass: 2500, pos: [0.04, 0, 0], v: [-1.5, 0, 0], boundingRadius: 1 });
  const partA = new CollisionPart({ body: bodyA, shape: threeVertexLayer(), response: new Response(), isRoot: true });
  const partB = new CollisionPart({ body: bodyB, shape: bigYFace(-0.05, -1, 33), response: new Response(), isRoot: true });
  const hits = [];
  const count = probe(partA, partB, 1 / 30, hits);
  out.threeVertexProbesOnlyVertexZero = {
    count,
    vertexIndex: count > 0 ? hits[0].vertexIndex : null,
    depth: count > 0 ? hits[0].depth : null,
  };
}

// --- 9. solve() is a no-op when posAdjust is zero --------------------------

{
  const body = new FakeBody({ mass: 2500, pos: [0, 0, 0] });
  const r = new Response();
  const result = r.solve(body, [0, 0, 0], r);
  out.solveNoop = {
    result,
    translateCalls: body.translateCalls.length,
    accelCalls: body.accelCalls.length,
  };
}

// --- 10. spring kind returns the clamped push, does not move the body -----

{
  const body = new FakeBody({ mass: 100, pos: [0, 0, 0] });
  const r = new Response('spring');
  r.posAdjust[1] = 0.8;
  r.avgNormal[1] = 1;
  const root = new Response('body');
  root.posAdjust[1] = 0.3;

  const result = r.solve(body, [0, 0, 0], root);
  out.springSolve = {
    result,                                 // expect [0, 0.5, 0]
    translateCalls: body.translateCalls.length,
    accelCalls: body.accelCalls.length,
    posAdjustClearedAfter: r.posAdjust,
  };

  // Clamp ceiling: pushes further than 1 clamp to 1.
  const r2 = new Response('spring');
  r2.posAdjust[1] = 5;
  r2.avgNormal[1] = 1;
  const root2 = new Response('body');
  out.springSolveClampHigh = r2.solve(body, [0, 0, 0], root2);

  // Clamp floor: a root that has already moved further than this part clamps to 0.
  const r3 = new Response('spring');
  r3.posAdjust[1] = 0.2;
  r3.avgNormal[1] = 1;
  const root3 = new Response('body');
  root3.posAdjust[1] = 0.9;
  out.springSolveClampLow = r3.solve(body, [0, 0, 0], root3);
}

// --- 11. checkFaceAndEdgeCollision's third axis-selection branch (F11) -----
//
// F11's 2-D point-in-triangle test picks (x,z) when |n.y|>=0.7 (every "drop"
// scene above: normal (0,1,0)), or (y,z) when |n.z|<=0.3 (every "headOn"
// scene above: normal (+-1,0,0), nz=0) -- nothing above exercises the third
// ("else") branch, (x,y), which fires when neither threshold is met.
//
// Triangle v0=(0,0,0), v1=(2,0,0), v2=(0,1.6,-1.2), normal (0,0.6,0.8):
// any=0.6 (<0.7) and anz=0.8 (not <=0.3) -> else branch. v0 and v1 share
// y=0,z=0, so projecting onto the WRONG axis pair (y,z) collapses the
// triangle to a degenerate sliver (v0 and v1 land on the same point) --
// a probed vertex placed just past v1 (outside the real 3-D triangle) must
// be rejected by the correct (x,y) projection, but a broken axis choice
// that degenerates to (y,z) reports it as a hit instead (verified by
// deliberately mutating the axis selection and re-running this exact scene
// during review: correct -> 0 hits, mutated -> 1 hit).

function tiltedTriFace(materialId) {
  return {
    layers: [{
      vertices: new Float32Array([0, 0, 0, 2, 0, 0, 0, 1.6, -1.2]),
      vertexMaterials: new Uint16Array([0, 0, 0]),
      faces: new Uint32Array([0, 1, 2]),
      faceMaterials: new Uint16Array([materialId]),
      normals: new Float32Array([0, 0.6, 0.8]),
      min: new Float32Array([-5, -5, -5]),
      max: new Float32Array([5, 5, 5]),
    }],
    radius: 5,
  };
}

{
  const bodyB = new FakeBody({ mass: 1e12, isStatic: true, pos: [0, 0, 0], boundingRadius: 5 });
  const partB = new CollisionPart({ body: bodyB, shape: tiltedTriFace(20), response: new Response() });

  // Inside the triangle (u=0.5, w=0.3 in the (v1,v2) basis): expect a hit,
  // hand-derived exactly like the corner-drop scene (depth -0.05, hit at the
  // probed point, world normal == the supplied face normal since B is
  // axis-aligned at the origin).
  const bodyAIn = new FakeBody({ pos: [0.5, 0.21, -0.22], v: [0, -1.8, -2.4] });
  const partAIn = new CollisionPart({ body: bodyAIn, shape: singleVertexShape(5), response: new Response(), isRoot: true });
  const hitsIn = [];
  const countIn = probe(partAIn, partB, 1 / 30, hitsIn);

  // Outside the triangle (past v1's u=2 edge along the same u axis): no hit.
  const bodyAOut = new FakeBody({ pos: [3, -0.03, -0.04], v: [0, -1.8, -2.4] });
  const partAOut = new CollisionPart({ body: bodyAOut, shape: singleVertexShape(5), response: new Response(), isRoot: true });
  const hitsOut = [];
  const countOut = probe(partAOut, partB, 1 / 30, hitsOut);

  out.thirdAxisSelectionBranch = {
    insideCount: countIn,
    insideNormal: countIn === 1 ? hitsIn[0].normal : null,
    insideDepth: countIn === 1 ? hitsIn[0].depth : null,
    insidePos: countIn === 1 ? hitsIn[0].pos : null,
    outsideCount: countOut,
  };
}

// --- 12. hot-path scratch reuse doesn't leak state across calls ------------
//
// body-contact.js's fix: probe/collidePair/collideBodies/solve preallocate
// their scratch instead of allocating per call (module report, "hot-path
// allocation"). The risk that fix introduces is stale data leaking between
// calls via the shared buffers -- these scenes exercise exactly that.

// 12a. solve()'s non-spring branch reuses one scratch pair (point, accel)
// across every Response instance instead of allocating fresh arrays; prove
// that by checking two consecutive calls hand the SAME array references to
// addAccelerationAt (a body that captures the reference, not a copy) while
// still computing distinct, correct values each time.
{
  class RefCapturingBody {
    constructor(pos) { this.pos = pos; this.translateCalls = []; this.accelCalls = []; }
    translate(dp) { this.pos[0] += dp[0]; this.pos[1] += dp[1]; this.pos[2] += dp[2]; this.translateCalls.push(dp); }
    addAccelerationAt(p, a) { this.accelCalls.push({ p, a, pSnapshot: [p[0], p[1], p[2]], aSnapshot: [a[0], a[1], a[2]] }); }
  }
  const body = new RefCapturingBody([0, 0, 0]);
  const r1 = new Response('body');
  r1.posAdjust = [1, 0, 0];
  r1.speedAdjust = [2, 0, 0];
  r1.avgRelPos = [0, 1, 0];
  r1.solve(body, [10, 0, 0], r1);

  const r2 = new Response('body');
  r2.posAdjust = [0, 0, 1];
  r2.speedAdjust = [0, 0, 4];
  r2.avgRelPos = [0, 0, 2];
  r2.solve(body, [0, 0, 20], r2);

  out.solveScratchReuse = {
    sameArrayReusedForPoint: body.accelCalls[0].p === body.accelCalls[1].p,
    sameArrayReusedForAccel: body.accelCalls[0].a === body.accelCalls[1].a,
    // Despite reusing the buffer, each call's SNAPSHOT (taken synchronously,
    // like a real addAccelerationAt implementation would) is correct and
    // independent of the other call.
    firstPointSnapshot: body.accelCalls[0].pSnapshot,   // [10,0,0]+[0,1,0] = [10,1,0]
    firstAccelSnapshot: body.accelCalls[0].aSnapshot,   // [2,0,0]*30*0.5 = [30,0,0]
    secondPointSnapshot: body.accelCalls[1].pSnapshot,  // [0,0,20]+[0,0,2] = [0,0,22]
    secondAccelSnapshot: body.accelCalls[1].aSnapshot,  // [0,0,4]*30*0.5 = [0,0,60]
  };
}

// 12b. collideBodies pools its body->parts grouping and direction-plan
// scratch across calls (once per tick in real use). Call it twice in the
// SAME tick-shaped invocation with THREE distinct bodies -- so the pool
// holds more than one group and more than one direction-plan entry at once
// -- then call it again with a DIFFERENT, disjoint set of bodies and check
// the second call's results reflect only the second scene, not leftover
// state from the first (which would show up as extra/wrong contacts).
{
  function makeStaticFloorPair(xOffset) {
    const bodyA = new FakeBody({ mass: 2500, pos: [xOffset, -0.05, 0], v: [0, -3, 0], boundingRadius: 1 });
    const bodyB = new FakeBody({ mass: 1e12, isStatic: true, pos: [xOffset, 0, 0], boundingRadius: 70 });
    const partA = new CollisionPart({ body: bodyA, shape: singleVertexShape(5), response: new Response(), isRoot: true });
    const partB = new CollisionPart({ body: bodyB, shape: bigFlatFace(20), response: new Response(), isRoot: true });
    return { bodyA, bodyB, partA, partB };
  }

  // First tick: three bodies (two falling onto two separate static floors,
  // sharing none of the same body objects) -- exercises groupCount > 2 and
  // more than one direction-plan entry within a single collideBodies call.
  const sceneA1 = makeStaticFloorPair(0);
  const sceneA2 = makeStaticFloorPair(100);
  const partsTick1 = [sceneA1.partA, sceneA1.partB, sceneA2.partA, sceneA2.partB];
  collideBodies(partsTick1, 1 / 30, handlers());

  // Second tick: an entirely different pair of bodies. If pooled group/
  // direction scratch leaked, this could see extra hits from tick 1's
  // bodies or apply results to the wrong response.
  const sceneB = makeStaticFloorPair(0);
  const total = collideBodies([sceneB.partA, sceneB.partB], 1 / 30, handlers());

  out.collideBodiesPoolReuse = {
    tick1SceneAHits: sceneA1.partA.response.count,
    tick1SceneBHits: sceneA2.partA.response.count,
    tick2Total: total,
    tick2Hits: sceneB.partA.response.count,       // must be 1, not accumulated with tick 1's state
    tick2PosAdjust: sceneB.partA.response.posAdjust,
  };
}

process.stdout.write(JSON.stringify(out, null, 2));
