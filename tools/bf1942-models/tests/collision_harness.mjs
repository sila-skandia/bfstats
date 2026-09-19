// Drives `viewer/collision.js` outside a browser and prints one JSON blob.
//
// `tests/test_collision.py` copies this file and the module it tests into a
// temporary directory (the module keeps its browser-facing `.js` name, which
// node reads as CommonJS, so the copy is renamed `.mjs`) and asserts on the
// output. The module imports nothing, which is what makes this possible and is
// the reason the collision arithmetic lives there rather than in `gunfire.js`.

import {
  buildHeightfield, buildCollisionIndex, WorldCollider,
  impactEffect, materialFamily, WATER_MATERIAL,
} from './collision.mjs';

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

/** The four fields of a three.js Mesh that `collision.js` actually reads. */
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

const cost = all.drainCost();
results.costShape = {
  casts: cost.casts, hasStats: Boolean(cost.statics),
  finite: Number.isFinite(cost.microsPerCast),
};

process.stdout.write(JSON.stringify(results));
