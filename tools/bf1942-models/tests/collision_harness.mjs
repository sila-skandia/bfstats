// Drives the collider (`viewer/world-collider.js` and the modules it is built
// from) outside a browser and prints one JSON blob.
//
// `tests/test_collision.py` copies this file and the modules it tests into a
// temporary directory (under their own `.js` names, beside a `package.json`
// that makes node read them as modules) and asserts on the output. The modules
// import nothing but each other, which is what makes this possible and is the
// reason the collision arithmetic lives there rather than in `gunfire.js`.

import { buildHeightfield } from './heightfield.js';
import { buildCollisionIndex } from './static-index.js';
import { buildDrivableMask } from './drivable-mask.js';
import { WorldCollider } from './world-collider.js';
import {
  impactEffect, materialFamily, footstepMaterial, WATER_MATERIAL,
} from './collision-materials.js';

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

/** The four fields of a three.js Mesh that the collider actually reads. */
function fakeMesh(positions, { index = null, material = 0, matrix = IDENTITY,
                               collision = true, kind = '' } = {}) {
  const node = {
    isMesh: true,
    name: kind || 'mesh',
    parent: null,
    children: [],
    userData: collision ? { collision: true } : { kind },
    matrixWorld: { elements: matrix },
    geometry: {
      attributes: {
        position: {
          array: Float32Array.from(positions),
          count: positions.length / 3,
        },
      },
      index: index ? { array: Uint32Array.from(index), count: index.length } : null,
      userData: { defenseMaterial: material, collision },
    },
    traverse(fn) { fn(node); for (const c of node.children) c.traverse(fn); },
  };
  return node;
}

/** Six decimals is plenty and it keeps the JSON readable. */
function round(v, places = 3) {
  if (!Number.isFinite(v)) return v;
  const k = 10 ** places;
  return Math.round(v * k) / k;
}

function group(children) {
  const node = {
    children, parent: null, userData: {},
    traverse(fn) { fn(node); for (const c of children) c.traverse(fn); },
  };
  for (const c of children) c.parent = node;
  return node;
}

// A 16 m world on a 4 m lattice, sloping y = x / 4 — flat at the origin corner
// and 4 m up at x = 16. Emitted as loose triangles the way a terrain tile is.
function slopeTile(worldSize = 16, spacing = 4) {
  const positions = [];
  const h = (x) => x / 4;
  for (let iz = 0; iz < worldSize / spacing; iz++) {
    for (let ix = 0; ix < worldSize / spacing; ix++) {
      const x0 = ix * spacing, x1 = x0 + spacing;
      const z0 = -iz * spacing, z1 = z0 - spacing;
      positions.push(x0, h(x0), z0, x1, h(x1), z0, x1, h(x1), z1);
      positions.push(x0, h(x0), z0, x1, h(x1), z1, x0, h(x0), z1);
    }
  }
  return fakeMesh(positions, { collision: false, kind: 'terrain' });
}

/** A vertical quad at x = plane, spanning y 0..10 and z -10..0. Zero thickness. */
function wall(plane, material) {
  return fakeMesh(
    [plane, 0, 0, plane, 0, -10, plane, 10, -10, plane, 10, 0],
    { index: [0, 1, 2, 0, 2, 3], material });
}

const results = {};

// --- the heightfield -------------------------------------------------------

const terrain = slopeTile();
const field = buildHeightfield([terrain], { worldSize: 16, dim: 4 });
results.heightfield = {
  dim: field.dim,
  spacing: field.spacing,
  coverage: field.coverage,
  atOrigin: field.height(0, 0),
  atMidCell: field.height(2, -2),      // bilinear: halfway up one 4 m cell
  atFarEdge: field.height(16, -16),
  offGrid: field.height(-5, 0),        // outside the lattice
};
// Inferred rather than declared: a caller with no `dim` in scene.json.
results.inferredDim = buildHeightfield([terrain], { worldSize: 16 }).dim;

field.setMaterials(Uint8Array.from(
  // 4x4 of ids, row-major by iz: left half dry sand (10), right half rock (12).
  [10, 10, 12, 12, 10, 10, 12, 12, 10, 10, 12, 12, 10, 10, 12, 12]), 4, 4);
results.terrainMaterial = {
  nearOrigin: field.material(1, -1),
  farSide: field.material(13, -13),
};

// --- terrain and water -----------------------------------------------------

const dry = new WorldCollider({ heightfield: field });
results.terrainHit = dry.cast(2, 10, -2, 0, -1, 0, 20);
results.terrainHit = results.terrainHit && {
  t: results.terrainHit.t, y: results.terrainHit.y,
  kind: results.terrainHit.kind, material: results.terrainHit.material,
};
// Fired upward from above the ground: nothing to hit.
results.upwardMiss = dry.cast(2, 10, -2, 0, 1, 0, 20) === null;
// Fired from below the surface — spawned inside a hill. Left alone rather than
// deleted at the muzzle.
results.undergroundIgnored = dry.cast(2, -5, -2, 0, -1, 0, 20) === null;
// Flat and level, skimming into rising ground: the sweep has to find it even
// though neither endpoint is inside anything vertical.
const skim = dry.cast(0, 1.2, -2, 1, 0, 0, 16);
results.skimHit = skim && { t: skim.t, x: skim.x, kind: skim.kind };

const sea = new WorldCollider({ heightfield: field, waterLevel: 2 });
const splash = sea.cast(2, 10, -2, 0, -1, 0, 20);
results.waterHit = splash && {
  t: splash.t, y: splash.y, kind: splash.kind, material: splash.material,
};
// Over the high end of the slope the ground is above the sea, so the ground
// wins even though the water plane is crossed too.
const land = sea.cast(15, 10, -2, 0, -1, 0, 20);
results.landBeatsWater = land && { kind: land.kind, y: land.y };
results.waterMaterialId = WATER_MATERIAL;
// Already underwater: no ceiling hit.
results.submergedIgnored = sea.cast(2, 1, -2, 0, -1, 0, 20)?.kind !== 'water';

// --- static hulls ----------------------------------------------------------

const near = wall(8, 92);          // concrete
const far = wall(12, 85);          // metal
const root = group([near, far]);
const statics = buildCollisionIndex(root, { ownerRoots: [near, far] });
results.index = {
  triangles: statics.count,
  cells: statics.cols * statics.rows,
  entries: statics.cellItems.length,
};

const world = new WorldCollider({ statics });
// The tunnelling test: one 16 m step, a zero-thickness wall 8 m in. A point
// test at the new position lands at x = 16 and sees nothing.
const struck = world.cast(0, 5, -5, 1, 0, 0, 16, -1);
results.sweptWall = struck && {
  t: struck.t, x: struck.x, material: struck.material, kind: struck.kind,
  owner: struck.owner,
};
// Nearest of the two, not whichever the grid reached first.
results.nearestWins = struck && struck.material === 92;
// The firing object's own hull is skipped, so the round reaches the second wall.
const through = world.cast(0, 5, -5, 1, 0, 0, 16, statics.ownerOf(near));
results.ownerSkipped = through && { t: through.t, material: through.material };
// A faded wreck: disable the near wall and the round reaches the far one.
statics.disableOwner(statics.ownerOf(near));
const pastDisabled = world.cast(0, 5, -5, 1, 0, 0, 16, -1);
results.disabledOwnerSkipped = pastDisabled && {
  material: pastDisabled.material, owner: pastDisabled.owner,
};
statics.enableOwner(statics.ownerOf(near));
const restored = world.cast(0, 5, -5, 1, 0, 0, 16, -1);
results.disabledOwnerRestored = restored && restored.material === 92;
// A shoved vehicle: the near wall (baked at x = 8) now stands 3 m further on.
// The index is not rebuilt; the collider asks again in the wall's baked frame.
{
  const owner = statics.ownerOf(near);
  // Column-major rigid transforms: baked -> world is +3 on x, and back.
  const fwd = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 3, 0, 0, 1];
  const inv = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -3, 0, 0, 1];
  world.setMovedOwner(owner, fwd, inv, 11, 5, -5, 8);
  const moved = world.cast(0, 5, -5, 1, 0, 0, 16, -1);
  results.movedOwnerCast = moved && {
    t: moved.t, x: moved.x, material: moved.material, owner: moved.owner,
    normal: [moved.nx, moved.ny, moved.nz],
  };
  // Its old place is empty: a 10 m segment no longer finds anything at x = 8.
  results.movedOwnerOldPlaceEmpty = world.cast(0, 5, -5, 1, 0, 0, 10, -1) === null;
  // The body query follows it too: a 0.5 m sphere stops half a metre short of x = 11.
  const swept = world.sweepSphere(0, 5, -5, 1, 0, 0, 16, 0.5, -1);
  results.movedOwnerSweep = swept && { t: swept.t, x: swept.x, px: swept.px, owner: swept.owner };
  // Its own rounds still skip it.
  const own = world.cast(0, 5, -5, 1, 0, 0, 16, owner);
  results.movedOwnerSkipsSelf = own && own.material;
  // Turned a quarter turn about y (baked x -> world -z, baked z -> world x):
  // the wall now lies in the plane z = -8 over x in [-10, 0], and a round
  // fired along -z from (-5, 5, 0) meets it 8 m out, normal facing the round.
  const turnFwd = [0, 0, -1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1];
  const turnInv = [0, 0, 1, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 0, 1];
  world.setMovedOwner(owner, turnFwd, turnInv, -5, 5, -8, 8);
  const turned = world.cast(-5, 5, 0, 0, 0, -1, 16, -1);
  results.movedOwnerTurned = turned && {
    t: turned.t, z: turned.z, owner: turned.owner, normal: [turned.nx, turned.ny, turned.nz],
  };
  world.clearMovedOwner(owner);
  // A simulated body's own hull sweep leaves other bodies to the contact
  // solver: with the near wall marked as a body the sweep reaches the far one.
  statics.setBodyOwner(owner, true);
  const past = world.sweepSphere(0, 5, -5, 1, 0, 0, 16, 0.5, -1, true);
  results.bodySweepSkipsBodies = past && { x: past.x, owner: past.owner };
  const still = world.sweepSphere(0, 5, -5, 1, 0, 0, 16, 0.5, -1);
  results.soldierSweepStillHitsBodies = still && { x: still.x, owner: still.owner };
  statics.setBodyOwner(owner, false);
  const back = world.cast(0, 5, -5, 1, 0, 0, 16, -1);
  results.movedOwnerCleared = back && { x: back.x, material: back.material };
}
// Short of the wall: no hit, and the segment length is respected.
results.shortOfWall = world.cast(0, 5, -5, 1, 0, 0, 4, -1) === null;
// Backwards.
results.behindMiss = world.cast(0, 5, -5, -1, 0, 0, 16, -1) === null;
// The normal faces the incoming round rather than the quad's winding.
results.facingNormal = struck && [struck.nx, struck.ny, struck.nz];

// --- the swept sphere ------------------------------------------------------

// The body query rather than the round query: a 0.5 m sphere stops half a metre
// short of the same wall a ray stops on, and the owner skip works the same way.
const swept = world.sweepSphere(0, 5, -5, 1, 0, 0, 16, 0.5, -1);
results.sweptSphere = swept && {
  t: swept.t, x: swept.x, nx: swept.nx, px: swept.px,
  material: swept.material, owner: swept.owner, kind: swept.kind,
};
const sweptThrough = world.sweepSphere(0, 5, -5, 1, 0, 0, 16, 0.5,
                                       statics.ownerOf(near));
results.sweptOwnerSkipped = sweptThrough && {
  t: sweptThrough.t, material: sweptThrough.material,
};
// Radius zero degenerates to the ray, which is the sanity check that the two
// narrowphases agree.
const sweptRay = world.sweepSphere(0, 5, -5, 1, 0, 0, 16, 0, -1);
results.sweptZeroRadiusMatchesTheRay = sweptRay && sweptRay.t;
// A sphere with no statics to sweep has nothing to say.
results.sweptWithoutStatics =
  new WorldCollider({ heightfield: field }).sweepSphere(
    0, 5, -5, 1, 0, 0, 16, 0.5) === null;

// Terrain, water and hulls together: the wall is nearer than the ground, so it
// has to win, and the grid must not be asked past it.
const all = new WorldCollider({ heightfield: field, waterLevel: 2, statics });
const mixed = all.cast(0, 5, -5, 1, 0, 0, 16, -1);
results.mixedKind = mixed && mixed.kind;
results.surfaceHeight = {
  overLand: all.surfaceHeight(16, -8),
  overSea: all.surfaceHeight(0, -8),
};

// --- drivable decks (bridges / repair bays) --------------------------------
//
// The deck fixture is a level of its own: flat ground at y = 0 over 64 m, with
// a repair bay (a sloped approach ramp onto a flat pad, walled on three sides)
// and an arched bridge (a humped span with a real underside and two parapets).
// Both are named to match the drivable heuristic; a building roof beside them is
// not, and must never lift anything.
//
// Everything asserted here was WRONG under the height raster this replaced: a
// sloped ramp triangle wrote its mean height flat across its whole XZ box (so
// the ramp was a step at the wrong height, which is how a tank ended up
// submerged in a repair pad), a span's underside has exactly the footprint of
// its road so the largest-face rule could pick either, and the query had no
// notion of the asker's height so anything under a bridge was lifted onto it.
{
  const flat = [];
  for (let iz = 0; iz < 16; iz++) {
    for (let ix = 0; ix < 16; ix++) {
      const x0 = ix * 4, x1 = x0 + 4;
      const z0 = -iz * 4, z1 = z0 - 4;
      flat.push(x0, 0, z0, x1, 0, z0, x1, 0, z1);
      flat.push(x0, 0, z0, x1, 0, z1, x0, 0, z1);
    }
  }
  const ground = buildHeightfield([fakeMesh(flat, { collision: false, kind: 'terrain' })],
                                  { worldSize: 64 });

  const quad = (a, b, c, d, kind) => fakeMesh([...a, ...b, ...c, ...d],
    { index: [0, 1, 2, 0, 2, 3], kind });

  // A repair bay: pad top at y = 1, x 10..20, z -10..0; a 4 m approach ramp
  // rising from the ground at x = 6 to the pad at x = 10; vertical walls closing
  // the other three sides. The ramp is the "little incline" a vehicle drives up.
  const bay = group([
    quad([10, 1, 0], [20, 1, 0], [20, 1, -10], [10, 1, -10], 'RepairBay'),
    quad([6, 0, 0], [10, 1, 0], [10, 1, -10], [6, 0, -10], 'RepairBay'),
    quad([20, 0, 0], [20, 1, 0], [20, 1, -10], [20, 0, -10], 'RepairBay'),
    quad([10, 0, 0], [20, 0, 0], [20, 1, 0], [10, 1, 0], 'RepairBay'),
    quad([10, 0, -10], [20, 0, -10], [20, 1, -10], [10, 1, -10], 'RepairBay'),
  ]);

  // An arched bridge across z = -20..-40 at x = 30..40: five road segments
  // rising 4 -> 6 -> 7 -> 6 -> 4, an underside a metre below each of them, and a
  // parapet along each side standing 2 m above the road.
  const arch = [4, 6, 7, 6, 4];
  const spanParts = [];
  for (let i = 0; i < 4; i++) {
    const zA = -20 - i * 5, zB = zA - 5;
    const yA = arch[i], yB = arch[i + 1];
    // Road surface.
    spanParts.push(quad([30, yA, zA], [40, yA, zA], [40, yB, zB], [30, yB, zB], 'Bridge'));
    // Underside, a metre below it — the face the old raster could pick instead.
    spanParts.push(quad([30, yA - 1, zA], [40, yA - 1, zA],
                        [40, yB - 1, zB], [30, yB - 1, zB], 'Bridge'));
    // Parapets: vertical strips either side, road + 2.
    spanParts.push(quad([30, yA, zA], [30, yA + 2, zA],
                        [30, yB + 2, zB], [30, yB, zB], 'Bridge'));
    spanParts.push(quad([40, yA, zA], [40, yA + 2, zA],
                        [40, yB + 2, zB], [40, yB, zB], 'Bridge'));
  }
  const bridge = group(spanParts);

  // A building beside them: a flat roof at y = 9 and the wall under it, neither
  // drivable by name. A roof must never be a ride surface and a wall must never
  // stop being one, whatever the gate is set to.
  const hut = group([
    quad([50, 9, -2], [58, 9, -2], [58, 9, -10], [50, 9, -10], 'Building'),
    quad([50, 0, -2], [50, 9, -2], [50, 9, -10], [50, 0, -10], 'Building'),
  ]);

  const level = group([bay, bridge, hut]);
  const deckStatics = buildCollisionIndex(level, { ownerRoots: [bay, bridge, hut] });
  const mask = buildDrivableMask(level);
  const world = new WorldCollider({ heightfield: ground, statics: deckStatics,
                                    drivableMask: mask });

  // Which triangles the index marked drivable: the bay's and the bridge's, never
  // the hut's. This is the mask both the deck ray and the hull sweep read.
  let drivableTris = 0;
  for (let i = 0; i < deckStatics.count; i++) {
    if (deckStatics.drivable[i]) drivableTris++;
  }

  // The ramp, sampled every half metre from the ground to the pad. Under an
  // exact query this is a straight line of gradient 1/4 with no steps in it.
  const rampProfile = [];
  for (let x = 6; x <= 11.0001; x += 0.5) {
    rampProfile.push(round(world.surfaceHeight(x, -5, 2.5), 4));
  }
  // The arch, along the middle of the road. Its own slope is 1/5, so no step
  // between neighbours may be bigger than that plus rounding.
  const archProfile = [];
  for (let z = -20; z >= -40.0001; z -= 1) {
    archProfile.push(round(world.surfaceHeight(35, z, 12), 4));
  }

  results.decks = {
    built: mask !== null,
    drivableTris,
    hutTrisDrivable: (() => {
      // The hut is owner 2; none of its triangles may be marked.
      let n = 0;
      for (let i = 0; i < deckStatics.count; i++) {
        if (deckStatics.owners[i] === 2 && deckStatics.drivable[i]) n++;
      }
      return n;
    })(),
    rampProfile,
    archProfile,
    // The pad's flat top, from a wheel reference just above it.
    padTop: round(world.surfaceHeight(15, -5, 2.0), 4),
    // The crown of the arch, and a point on its rising flank.
    archCrown: round(world.surfaceHeight(35, -30, 12), 4),
    archFlank: round(world.surfaceHeight(35, -25, 12), 4),
    // The underside (6 at the crown) must never be the answer from above it.
    archNotUnderside: world.surfaceHeight(35, -30, 12) > 6.5,
    // The parapet cap (9 at the crown) must never be the answer either.
    archNotParapetCap: round(world.surfaceHeight(30.2, -30, 12), 4),
    // From UNDER the bridge the deck is not there at all: the surface is the
    // ground, and the deck query itself declines.
    fromUnderBridge: round(world.surfaceHeight(35, -30, 1.5), 4),
    deckFromUnderBridge: Number.isFinite(world.deckHeight(35, -30, 1.5)),
    // A roof is never a ride surface, however high the asker starts.
    overHutRoof: round(world.surfaceHeight(54, -6, 20), 4),
    deckOverHutRoof: Number.isFinite(world.deckHeight(54, -6, 20)),
    // Off every deck, open ground answers and no ray is cast.
    openGround: round(world.surfaceHeight(2, -2, 2), 4),
    // Height-awareness at the bay: a wheel reference a step above the ground
    // finds the 1 m pad from beside it, one below the pad does not.
    padFromBelowLip: Number.isFinite(world.deckHeight(15, -5, 0.4)),
    padFromAboveLip: Number.isFinite(world.deckHeight(15, -5, 1.4)),
    // Without a reference height NOTHING sees a deck — this is the opt-in that
    // keeps soldiers, aircraft, boats and cameras on terrain and sea alone.
    padWithoutReference: round(world.surfaceHeight(15, -5), 4),
    bridgeWithoutReference: round(world.surfaceHeight(35, -30), 4),
  };

  // The deck's contact normal comes off the hit triangle, not a finite
  // difference: level on the pad, tilted up the ramp, tilted along the arch.
  const n = [0, 0, 0];
  results.deckNormals = {
    onPad: world.deckNormal(15, -5, 2.0, n) && n.map(v => round(v, 3)),
    onRamp: (() => {
      const got = world.deckNormal(8, -5, 3.0, n);
      return got && n.map(v => round(v, 3));
    })(),
    onArchFlank: (() => {
      const got = world.deckNormal(35, -25, 12, n);
      return got && n.map(v => round(v, 3));
    })(),
    // Open ground has no deck normal, so the caller keeps the heightfield's.
    onOpenGround: world.deckNormal(2, -2, 2, n),
    // And nothing under the bridge does either.
    underBridge: world.deckNormal(35, -30, 1.5, n),
  };

  // The hull sweep's deck gate. A vehicle hull is a fat sphere centred barely a
  // metre off the ground, so it is inside whatever horizontal surface it stands
  // on; the gate is what stops a deck reading as a wall. Defaults must leave the
  // level exactly as it was (a soldier, a round, a body).
  const R = 1.8;
  const at = (x, y, z, dx, dy, dz, dist, stepTop, floorCos) => {
    const len = Math.hypot(dx, dy, dz);
    return world.sweepSphere(x, y, z, dx / len, dy / len, dz / len, dist, R, -1, false,
                             stepTop, floorCos);
  };
  results.deckSweep = {
    // Driving east into the bay's ramp at ground level: ungated this is a dead
    // stop (the old edge-hang), gated it is a slope the wheels climb.
    rampUngated: at(4, 0.6, -5, 1, 0, 0, 8, -Infinity, 2) !== null,
    rampGated: at(4, 0.6, -5, 1, 0, 0, 8, 0 + 1.0, 0.5) === null,
    // On the pad, settling as it drives along it: ungated the road under the
    // hull is a contact on the first tick, which is the "welded to the deck"
    // bug; gated it is a floor and the sweep is silent.
    onPadUngated: at(12, 1.6, -5, 1, -0.3, 0, 6, -Infinity, 2) !== null,
    onPadGated: at(12, 1.6, -5, 1, -0.3, 0, 6, 1.0 + 1.0, 0.5) === null,
    // A parapet is still a wall from the road: it rises 2 m above the support,
    // well past the step, and it is vertical.
    parapetGated: at(36, 8, -30, -1, 0, 0, 8, 7 + 1.0, 0.5) !== null,
    // And so is the hut's wall, which is not drivable at all and cannot be gated
    // away however generous the gate.
    hutWallGated: at(46, 2, -6, 1, 0, 0, 8, 100, 0) !== null,
  };
}

// --- effect selection ------------------------------------------------------

const effects = { 236: { 1: 'e_waterimpact', 10: 'GroundExplDry', 92: 'Exp2CascadesStone' } };
results.effects = {
  water: impactEffect(effects, 236, 1),
  sand: impactEffect(effects, 236, 10),
  concrete: impactEffect(effects, 236, 92),
  unknownPair: impactEffect(effects, 236, 55),
  unknownAttacker: impactEffect(effects, 999, 1),
  noTable: impactEffect(null, 236, 1),
};
results.families = [1, 10, 50, 85, 80, 92].map(materialFamily);
results.footstepMaterials = {
  grass: footstepMaterial(2),
  mud: footstepMaterial(6),
  gravel: footstepMaterial(8),
  ice: footstepMaterial(9),
  sand: footstepMaterial(10),
  rock: footstepMaterial(12),
  pavedRoad: footstepMaterial(15),
  wood: footstepMaterial(80),
  metal: footstepMaterial(85),
  concrete: footstepMaterial(101),
};

const cost = all.drainCost();
results.costShape = {
  casts: cost.casts, hasStats: Boolean(cost.statics),
  finite: Number.isFinite(cost.microsPerCast),
};

process.stdout.write(JSON.stringify(results));
