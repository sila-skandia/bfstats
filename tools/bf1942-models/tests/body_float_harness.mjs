// Drives `viewer/body-float.js` outside a browser and prints one JSON blob.
//
// The module imports nothing, so this runs against the real file copied in
// beside it by `test_body_float.py`.
//
// Every fleet number below is the authored `.con` data, typed in from
// `features/bf1942-ships-research-2026-09-22/README.md` §1.5's table (each
// hull's `Physics.con` `setHullHeight` / `setFloatMaxLift` / `setFloatMinLift`
// and its `Objects.con` `addTemplate` y offset) — NOT read back out of a glb or
// out of this module's own output. `test_body_float.py` derives the expected
// equilibria from the closed form itself and compares.
import {
  GRAVITY, BUOYANCY_DIVISOR, LIFT_NORMALISER, EQUILIBRIUM_SUM,
  DAMPING_AREA_SCALE, DAMPING_LERP_TOP, SUBMERSION_FLOOR,
  submersion, floatLift, floatAcceleration, floatSupport, equilibriumRootY,
  sinkRate, floatNodesOf, localiseFloats, FloatingHull,
} from './body-float.js';

const out = { constants: {
  GRAVITY, BUOYANCY_DIVISOR, LIFT_NORMALISER, EQUILIBRIUM_SUM,
  DAMPING_AREA_SCALE, DAMPING_LERP_TOP, SUBMERSION_FLOOR,
} };

const WATER = 20;

/** One template repeated N times at a single height: every vanilla capital ship. */
const uniform = (n, offsetY, hullHeight, minLift, maxLift, sinkingSpeedMod = 0) =>
  Array.from({ length: n }, () => ({
    offsetY, hullHeight, floatMinLift: minLift, floatMaxLift: maxLift,
    sinkingSpeedMod,
  }));

const FLEET = {
  // ship:            N  relY    H    min     max
  Fletcher:   uniform(8,  7.5,  20,  2,      2),
  Hatsuzuki:  uniform(8,  9.5,  10,  2,      2),
  Enterprise: uniform(8, 14.8,  17,  7,      7),
  Shokaku:    uniform(8, 11.0,  15,  5,      5),
  PrinceOW:   uniform(8, 14.0,  17,  2,      2),
  Yamato:     uniform(8, 10.5,  10,  6,      6),
  Gato:       uniform(8,  2.0,   3.3, 0.8275, 1.6275),
  Sub7C:      uniform(8,  2.0,   4.3, 0.8275, 1.6275),
};

// --- (a) the pieces of the law ------------------------------------------------

out.submersion = {
  // A Fletcher float node at the equilibrium the closed form predicts.
  fletcherAtDraft: submersion(27.725, 20, WATER),
  // ... and at its authored pad, 0.2 m higher.
  fletcherAtPad: submersion(27.9371, 20, WATER),
  // At the waterline exactly: -1.
  atWaterline: submersion(WATER, 20, WATER),
  // At the reference plane: 0.
  atReference: submersion(WATER + 20, 20, WATER),
  // `sinkOffset` lowers the reference plane, so it deepens `f`.
  withSinkOffset: submersion(27.725, 20, WATER, 1),
};

out.lift = {
  // t saturates for any ship whose draft exceeds a metre and whose angle is 0.
  fletcher: floatLift(-0.61375, 20, 0, 2, 2),
  // A Gato 0.5 m down with no trim: t = 0.5, the midpoint of the pair.
  gatoHalfMetre: floatLift(-0.5 / 3.3, 3.3, 0, 0.8275, 1.6275),
  // A Gato with a 5 m dive setpoint, sitting at 5.5 m: t = 0.5 again. The
  // node's stored angle is MINUS the bundle's angle_Y, so angle_Y 5 is -5 here.
  gatoDiveSetpoint: floatLift(-5.5 / 3.3, 3.3, -5, 0.8275, 1.6275),
  // Unclamped `f` drives `t`: a Gato at 40 m still reads t = 1 with no trim.
  gatoDeepNoTrim: floatLift(-40 / 3.3, 3.3, 0, 0.8275, 1.6275),
};

out.acceleration = {
  // At rest, at the draft, one Fletcher node.
  fletcherAtDraft: floatAcceleration(FLEET.Fletcher[0], {
    nodeY: 27.725, waterLevel: WATER, drag: 3, mass: 2500000, areaXZ: 2507 }),
  // Above the reference plane: no force at all, and no damping either.
  aboveReference: floatAcceleration(FLEET.Fletcher[0], {
    nodeY: WATER + 25, waterLevel: WATER, verticalSpeed: -5,
    drag: 3, mass: 2500000, areaXZ: 2507 }),
  // The damping coefficient's sign, either side of f = -1/24.
  dampingDeep: floatAcceleration(FLEET.Fletcher[0], {
    nodeY: WATER + 20 - 0.5 * 20, waterLevel: WATER, verticalSpeed: 1,
    drag: 3, mass: 2500000, areaXZ: 2507 })
    - floatAcceleration(FLEET.Fletcher[0], {
      nodeY: WATER + 20 - 0.5 * 20, waterLevel: WATER, verticalSpeed: 0,
      drag: 3, mass: 2500000, areaXZ: 2507 }),
  dampingSliver: floatAcceleration(FLEET.Fletcher[0], {
    nodeY: WATER + 20 - 0.01 * 20, waterLevel: WATER, verticalSpeed: 1,
    drag: 3, mass: 2500000, areaXZ: 2507 })
    - floatAcceleration(FLEET.Fletcher[0], {
      nodeY: WATER + 20 - 0.01 * 20, waterLevel: WATER, verticalSpeed: 0,
      drag: 3, mass: 2500000, areaXZ: 2507 }),
};

// --- (b) the closed-form equilibrium -----------------------------------------

out.equilibrium = {};
out.support = {};
for (const [name, floats] of Object.entries(FLEET)) {
  const y = equilibriumRootY(floats, WATER);
  out.equilibrium[name] = y;
  // The proof that it IS the law's fixed point: the vertical accelerations of
  // every node, summed, against |g|.
  let sum = 0;
  for (const float of floats) {
    sum += floatAcceleration(float, {
      nodeY: y + float.offsetY, waterLevel: WATER, verticalSpeed: 0,
      drag: 3, mass: 2500000, areaXZ: 2507 });
  }
  out.support[name] = { support: floatSupport(floats, y, WATER), netWithGravity: sum + GRAVITY };
}

// A Gato with a dive setpoint settles at `depth = angle_Y + 0.5`.
out.dive = {};
for (const angleY of [0, 5, 10, 20, 50]) {
  const y = equilibriumRootY(FLEET.Gato, WATER, { angle: -angleY });
  // depth = -f*H measured at the node
  const nodeY = y + 2.0;
  out.dive[angleY] = { rootY: y, depth: -submersion(nodeY, 3.3, WATER) * 3.3 };
}

// A hull whose float nodes cannot carry it, whatever the depth.
out.cannotFloat = equilibriumRootY(
  [{ offsetY: 0, hullHeight: 4, floatMinLift: 1, floatMaxLift: 1 }], WATER);

// --- (c) why the iterative settle is not used --------------------------------
//
// The exact law at 1/30 s from each ship's own authored Midway pad, hull drag
// and mass, with the destroyer hull's measured bounding-box footprint
// (18.73 x 133.86 m). One body, one degree of freedom (heave): the whole fleet
// is eight nodes at one height, so pitch and roll never enter.
function settle(floats, { padY, drag, mass, areaXZ, ticks, dt = 1 / 30 }) {
  let y = padY, vy = 0;
  const trace = [];
  for (let tick = 1; tick <= ticks; tick++) {
    let a = GRAVITY;
    for (const float of floats) {
      a += floatAcceleration(float, { nodeY: y + float.offsetY, waterLevel: WATER,
        verticalSpeed: vy, drag, mass, areaXZ });
    }
    vy += a * dt;
    y += vy * dt;
    if (tick === 300) trace.push({ tick, y });
  }
  return { y, vy, at300: trace[0]?.y ?? null };
}

out.settle = {
  fletcher: settle(FLEET.Fletcher, {
    padY: 20.4371, drag: 3, mass: 2500000, areaXZ: 18.73 * 133.86, ticks: 300 }),
  hatsuzuki: settle(FLEET.Hatsuzuki, {
    padY: 20.4371, drag: 0.92, mass: 2500000, areaXZ: 18.73 * 133.86, ticks: 300 }),
  fletcherLong: settle(FLEET.Fletcher, {
    padY: 20.4371, drag: 3, mass: 2500000, areaXZ: 18.73 * 133.86, ticks: 3000 }),
};

// --- (d) the sink rate --------------------------------------------------------

out.sink = {
  // A bow-starboard node on a destroyer-sized hull, and a stern-port one.
  bow: sinkRate({ sinkingSpeedMod: 1 }, { offsetX: 5, offsetZ: 50, boundingRadius: 70 }),
  stern: sinkRate({ sinkingSpeedMod: 1 }, { offsetX: -5, offsetZ: -50, boundingRadius: 70 }),
  centre: sinkRate({ sinkingSpeedMod: 1 }, { offsetX: 0, offsetZ: 0, boundingRadius: 70 }),
  // `sinkingSpeedMod 0` is "never sinks" — both rafts.
  raft: sinkRate({ sinkingSpeedMod: 0 }, { offsetX: 0, offsetZ: 2, boundingRadius: 5 }),
  // The LCVP's odd floater out, at 7.
  lcvpFast: sinkRate({ sinkingSpeedMod: 7 }, { offsetX: 0, offsetZ: 0, boundingRadius: 5 }),
};

// --- (e) reading float nodes off a node tree ---------------------------------

/** The duck-typed slice of a three.js node the module touches. */
const fakeNode = (name, kind, physics, world, children = []) => ({
  name, userData: { templateKind: kind, physics }, children,
  matrixWorld: { elements: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, ...world, 1] },
  updateWorldMatrix() {},
});

const hullPhysics = { hullHeight: 20, floatMaxLift: 2, floatMinLift: 2, sinkingSpeedMod: 1 };
const tree = fakeNode('Fletcher', 'PlayerControlObject', { mass: 2500000 },
  [100, 20.4371, -50], [
    fakeNode('Fletcher_Floater', 'FloatingBundle', hullPhysics, [98, 27.9371, 0]),
    fakeNode('Fletcher_Engine', 'Engine', { engineType: 'c_ETShip' }, [100, 16.4, -90]),
    fakeNode('Fletcher_Tower', 'Bundle', null, [100, 25, -50], [
      fakeNode('Fletcher_Floater', 'FloatingBundle', hullPhysics, [102, 27.9371, -100]),
    ]),
  ]);
out.floatNodes = floatNodesOf(tree).map(f => ({
  name: f.node.name, hullHeight: f.hullHeight,
  floatMinLift: f.floatMinLift, floatMaxLift: f.floatMaxLift,
  sinkingSpeedMod: f.sinkingSpeedMod,
  offsetX: f.offsetX, offsetY: f.offsetY, offsetZ: f.offsetZ,
}));
out.floatNodesEmpty = floatNodesOf(
  fakeNode('Willy', 'PlayerControlObject', { mass: 1200 }, [0, 0, 0])).length;


// --- (f) a hull going down ----------------------------------------------------
//
// A Fletcher, eight `Fletcher_Floater` at relY 7.5 with `sinkingSpeedMod 1`,
// hull box 18.73 x 12 x 133.86, bounding radius 70 -- and `arm()`, which is
// `FloatingBundle::handleMessage`'s `0x14` branch.
{
  const world = [];
  for (const [x, z] of [[-1.999, -50], [2, -50], [-4.999, -17], [5, -17],
                        [-4.999, 17], [5, 17], [-1.999, 50], [2, 50]]) {
    world.push({ hullHeight: 20, floatMinLift: 2, floatMaxLift: 2,
                 sinkingSpeedMod: 1, offsetX: x, offsetY: 7.5, offsetZ: z });
  }
  const identity = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  const make = () => new FloatingHull({
    floats: localiseFloats(world, identity),
    mass: 2500000, drag: 3, box: [18.73, 12, 133.86], boundingRadius: 70,
    waterLevel: WATER, position: [0, 20.225, 0], axes: identity,
  });

  // Undamaged: she floats, ten seconds of it.
  const afloat = make();
  for (let i = 0; i < 300; i++) afloat.step();
  out.hullAfloat = { y: afloat.body.pos[1], armed: afloat.armed,
                     offsets: afloat.floats.map(f => f.sinkOffset) };

  // Armed, and then a minute of it.
  const sinking = make();
  const armedTwice = [sinking.arm(), sinking.arm()];
  out.hullRates = sinking.floats.map(f => ({ z: f.local[2], rate: f.sinkRate }));
  const trace = [];
  for (let i = 1; i <= 1800; i++) {
    sinking.step();
    if (i % 300 === 0) {
      trace.push({ tick: i, y: +sinking.body.pos[1].toFixed(3),
                   // The hull's own forward axis: its y component IS the trim.
                   noseY: +sinking.body.axes[2][1].toFixed(5) });
    }
  }
  out.hullSinking = { armedTwice, trace,
                      y: sinking.body.pos[1], awake: !sinking.body.sleeping };

  // `sinkingSpeedMod 0` on every node -- a raft. Armed, and it does not move.
  const raft = new FloatingHull({
    floats: localiseFloats(world.map(f => ({ ...f, sinkingSpeedMod: 0 })), identity),
    mass: 2500000, drag: 3, box: [18.73, 12, 133.86], boundingRadius: 70,
    waterLevel: WATER, position: [0, 20.225, 0], axes: identity,
  });
  raft.arm();
  for (let i = 0; i < 1800; i++) raft.step();
  out.raft = { y: raft.body.pos[1], rates: raft.floats.map(f => f.sinkRate) };
}

console.log(JSON.stringify(out));
