// Drives `viewer/contact-response.js` outside a browser and prints one JSON blob.
//
// The module imports nothing, so `tests/test_contact_response.py` copies it in
// under its own name and node runs the file the page loads, byte for byte.

import {
  SIM_HZ, SIM_DT, CONTACT_GRAVITY, STATIC_FRICTION_FACTOR, DEFAULT_FRICTION,
  DEFAULT_ELASTICITY, DEFAULT_RESISTANCE, NO_MATERIAL_TABLE, GRENADE_MATERIAL,
  REST_SPEED, materialProperty, contactPair, normalRestitution, applyContact,
  FuseRoundBody,
} from './contact-response.js';

const results = {};

results.constants = {
  simHz: SIM_HZ, simDt: SIM_DT, gravity: CONTACT_GRAVITY,
  staticFactor: STATIC_FRICTION_FACTOR,
  defaults: { friction: DEFAULT_FRICTION, elasticity: DEFAULT_ELASTICITY,
              resistance: DEFAULT_RESISTANCE },
  noTable: NO_MATERIAL_TABLE, grenadeMaterial: GRENADE_MATERIAL,
  restSpeed: REST_SPEED,
};

// The vanilla numbers, as `damage.json` carries them after this round's
// extractor change. 0 is "Default", 3 "Juicy grass", 12 "Rock", 70 "Grenades".
const MATERIALS = {
  '0': { friction: 1.0, elasticity: 0.0, resistance: 0.02 },
  '1': { friction: 0.1, elasticity: 0.0, resistance: 0.1 },
  '3': { friction: 0.8, elasticity: 0.0, resistance: 0.08 },
  '12': { friction: 0.6, elasticity: 0.0, resistance: 0.01 },
  '70': { friction: 2.0, elasticity: 2.0, resistance: 2.0 },
  '195': { friction: 1.0, elasticity: 0.0, resistance: 0.01, damage: 1 },
};

results.lookup = {
  grenadeElasticity: materialProperty(MATERIALS, 70, 'elasticity'),
  grassElasticity: materialProperty(MATERIALS, 3, 'elasticity'),
  // 232 is the landmine's collision-vertex material and vanilla never defines
  // it, so it falls through to material 0, NOT to the constructor defaults.
  undefinedFriction: materialProperty(MATERIALS, 232, 'friction'),
  undefinedResistance: materialProperty(MATERIALS, 232, 'resistance'),
  undefinedElasticity: materialProperty(MATERIALS, 232, 'elasticity'),
  // 195 is the explosives pack's; it IS defined here, with its own resistance.
  expackResistance: materialProperty(MATERIALS, 195, 'resistance'),
  noTable: materialProperty(null, 3, 'friction'),
  // No material 0 either: the accessor's `fld1`.
  noZero: materialProperty({ '9': { friction: 0.5 } }, 232, 'friction'),
};

// A `damage.json` extracted BEFORE this round: `friction` and nothing else.
// The engine cannot produce a Material missing a word, so the miss chain must
// not be run on one -- `fld1` there would make every elasticity 1.0 and every
// resistance 1.0, which turns the landmine into a grenade and over-damps the
// lot. The constructor defaults are the honest answer.
const STALE_MATERIALS = {
  '0': { friction: 1.0 }, '3': { friction: 0.8 }, '70': { friction: 2.0 },
};

results.staleTable = {
  friction: materialProperty(STALE_MATERIALS, 3, 'friction'),
  grenadeElasticity: materialProperty(STALE_MATERIALS, 70, 'elasticity'),
  grassResistance: materialProperty(STALE_MATERIALS, 3, 'resistance'),
  undefinedElasticity: materialProperty(STALE_MATERIALS, 232, 'elasticity'),
  grenadeOnGrass: contactPair(STALE_MATERIALS, 70, 3),
  landmineOnGrass: contactPair(STALE_MATERIALS, 232, 3),
};

results.pairs = {
  grenadeOnGrass: contactPair(MATERIALS, 70, 3),
  grenadeOnRock: contactPair(MATERIALS, 70, 12),
  landmineOnGrass: contactPair(MATERIALS, 232, 3),
  expackOnGrass: contactPair(MATERIALS, 195, 3),
  grenadeOnGrenade: contactPair(MATERIALS, 70, 70),
};

results.restitution = {
  zero: normalRestitution(0),
  one: normalRestitution(1),
  two: normalRestitution(2),
  three: normalRestitution(3),
  grenadeOnGrass: normalRestitution(contactPair(MATERIALS, 70, 3).elasticity),
  landmineOnGrass: normalRestitution(contactPair(MATERIALS, 232, 3).elasticity),
};

// --- one contact, in isolation ---------------------------------------------

function oneContact(material, ground, velocity, normal, latched = false) {
  const v = { ...velocity };
  const p = { x: 0, y: 0, z: 0 };
  const pair = contactPair(MATERIALS, material, ground);
  const out = applyContact(v, p, { ...normal, depth: 0 }, pair, { latched });
  return { velocity: v, pair, latched: out.latched, tangentSpeed: out.tangentSpeed };
}

const FLAT = { nx: 0, ny: 1, nz: 0 };
const WALL = { nx: -1, ny: 0, nz: 0 };

results.singleContact = {
  // A grenade arriving at 10 m/s down and 15 m/s forward on flat ground.
  grenadeFlat: oneContact(70, 3, { x: 15, y: -10, z: 0 }, FLAT),
  // The same arrival for a landmine (material 232 -> material 0, e = 0).
  landmineFlat: oneContact(232, 3, { x: 15, y: -10, z: 0 }, FLAT),
  // A grenade into a vertical wall: N.y = 0, so no Coulomb budget at all.
  grenadeWall: oneContact(70, 12, { x: 12, y: -3, z: 0 }, WALL),
  landmineWall: oneContact(232, 12, { x: 12, y: -3, z: 0 }, WALL),
  // The push-out: depth -0.25 along the normal.
  pushOut: (() => {
    const v = { x: 0, y: -1, z: 0 };
    const p = { x: 5, y: 5, z: 5 };
    applyContact(v, p, { ...FLAT, depth: -0.25 }, contactPair(MATERIALS, 70, 3));
    return p;
  })(),
  degenerateNormal: (() => {
    const v = { x: 1, y: 2, z: 3 };
    const out = applyContact(v, null, { nx: 0, ny: 0, nz: 0, depth: 0 },
                             contactPair(MATERIALS, 70, 3));
    return { velocity: v, ...out };
  })(),
};

// --- a whole throw ----------------------------------------------------------

// A flat world at y = 0 with an optional vertical wall at x = wallX, and an
// optional slope. `probe` has `WorldCollider.cast`'s return shape.
function world({ groundY = 0, material = 3, wallX = null, slope = 0 } = {}) {
  const heightAt = (x) => groundY + slope * x;
  // Unit normal of the plane y = groundY + slope*x is (-slope, 1, 0)/len.
  const len = Math.hypot(slope, 1);
  const nx = -slope / len, ny = 1 / len;
  return (ox, oy, oz, dx, dy, dz, maxDist) => {
    let best = null;
    if (wallX !== null && dx !== 0) {
      const t = (wallX - ox) / dx;
      if (t >= 0 && t <= maxDist) {
        best = { t, x: wallX - Math.sign(dx) * 1e-4, y: oy + dy * t, z: oz + dz * t,
                 nx: -Math.sign(dx), ny: 0, nz: 0, material: 12, kind: 'object' };
      }
    }
    // Plane crossing, only from above.
    const f0 = oy - heightAt(ox);
    const f1 = (oy + dy * maxDist) - heightAt(ox + dx * maxDist);
    if (f0 > 0 && f1 <= 0) {
      const t = maxDist * (f0 / (f0 - f1));
      if (!best || t < best.t) {
        const x = ox + dx * t, z = oz + dz * t;
        best = { t, x, y: heightAt(x), z, nx, ny, nz: 0,
                 material, kind: 'terrain' };
      }
    }
    return best;
  };
}

function throwRound(material, options = {}) {
  const {
    from = { x: 0, y: 1.6, z: 0 },
    velocity = { x: 18, y: 4, z: 0 },
    seconds = 3,
    ...worldOptions
  } = options;
  const probe = world(worldOptions);
  const body = new FuseRoundBody({ material, materials: MATERIALS });
  const p = { ...from };
  const v = { ...velocity };
  const trail = [];
  const frames = Math.round(seconds * 60);
  for (let i = 0; i < frames; i++) {
    body.step(1 / 60, p, v, probe);
    if (i % 15 === 0) trail.push({ t: +((i + 1) / 60).toFixed(3),
                                   x: +p.x.toFixed(4), y: +p.y.toFixed(4) });
    if (body.resting) break;
  }
  return {
    rest: { x: +p.x.toFixed(4), y: +p.y.toFixed(4), z: +p.z.toFixed(4) },
    speed: +Math.hypot(v.x, v.y, v.z).toFixed(5),
    resting: body.resting,
    contacts: body.contacts,
    latched: body.latched,
    trail,
  };
}

results.flatGround = {
  grenade: throwRound(70),
  landmine: throwRound(232),
  expack: throwRound(195),
};

results.againstWall = {
  // Thrown flat into a wall 6 m away; the round must not pass it and must end
  // at its foot, not stuck in the air where it touched.
  grenade: throwRound(70, { wallX: 6, velocity: { x: 20, y: 1, z: 0 },
                            from: { x: 0, y: 1.6, z: 0 }, seconds: 4 }),
  landmine: throwRound(232, { wallX: 6, velocity: { x: 20, y: 1, z: 0 },
                              from: { x: 0, y: 1.6, z: 0 }, seconds: 4 }),
};

results.downSlope = {
  // A 20% downhill (about 11 degrees) and a 100% one (45 degrees), dropped
  // from rest so the only thing that can move it is gravity against friction.
  grenadeGentle: throwRound(70, { slope: -0.2, velocity: { x: 0, y: 0, z: 0 },
                                  from: { x: 0, y: 0.5, z: 0 }, seconds: 3 }),
  grenadeSteep: throwRound(70, { slope: -1.0, velocity: { x: 0, y: 0, z: 0 },
                                 from: { x: 0, y: 0.5, z: 0 }, seconds: 3 }),
  landmineGentle: throwRound(232, { slope: -0.2, velocity: { x: 0, y: 0, z: 0 },
                                    from: { x: 0, y: 0.5, z: 0 }, seconds: 3 }),
  landmineSteep: throwRound(232, { slope: -1.0, velocity: { x: 0, y: 0, z: 0 },
                                   from: { x: 0, y: 0.5, z: 0 }, seconds: 3 }),
};

// What the viewer did before: stop dead at the first contact. Same throw, for
// the measurement the feature doc quotes.
results.stopDead = (() => {
  const probe = world({});
  const p = { x: 0, y: 1.6, z: 0 };
  const v = { x: 18, y: 4, z: 0 };
  for (let i = 0; i < 180; i++) {
    const speed = Math.hypot(v.x, v.y, v.z);
    const travel = speed / 60;
    const hit = probe(p.x, p.y, p.z, v.x / speed, v.y / speed, v.z / speed, travel);
    if (hit) return { x: +hit.x.toFixed(4), y: +hit.y.toFixed(4), frames: i + 1 };
    v.y += -CONTACT_GRAVITY / 60;
    p.x += v.x / 60; p.y += v.y / 60; p.z += v.z / 60;
  }
  return null;
})();

// The fixed step must not resample: the same throw at 30, 60 and 144 Hz has to
// land in the same place, because every budget in `applyContact` is per tick.
results.frameRate = (() => {
  const out = {};
  for (const hz of [30, 60, 144]) {
    const probe = world({});
    const body = new FuseRoundBody({ material: 70, materials: MATERIALS });
    const p = { x: 0, y: 1.6, z: 0 };
    const v = { x: 18, y: 4, z: 0 };
    for (let i = 0; i < hz * 3; i++) {
      body.step(1 / hz, p, v, probe);
      if (body.resting) break;
    }
    out[hz] = { x: +p.x.toFixed(3), y: +p.y.toFixed(3), resting: body.resting };
  }
  return out;
})();

process.stdout.write(JSON.stringify(results, null, 2));
