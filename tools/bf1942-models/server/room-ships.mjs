// A room's ships: the page's floating and drive law (`viewer/ship.js`,
// `ship-law.js`, `body-float.js`; ledger PHY-3, SHIP-1.., SHIPLAW-1..4,
// SUB-1..) stepped by the room server as its land hulls are, and the decks
// that carry what stands on them.
//
// Until 2026-11-13 the room drove no ship: `mountIntoSeat` granted a drive
// to air, ground and tank roots only, so a helmsman's page sailed its own
// copy alone and every other page, and the server, kept her at her pad. The
// ships' landing craft and deck aircraft stayed baked into their ships, so
// nobody could take one, and Wake's Axis bots swam from their carriers.
//
// What this module is, each piece the page's own law by the page's own code:
//
//   * the load: every floating hull put at its closed-form draft before the
//     index bakes it (`hull-bodies.js` `floatPlacedVehicles`), its deck spawn
//     points carried with it (`rebaseDeckSpawns`), on a copy of the points
//     that is this room's own (the level's report is shared by its rooms);
//   * the drive: one `Ship` a hull, kept for the hull's life, grounded on her
//     own col0 (`ship-spec.js` `hullCollisionKeel`/`hullCollisionLayers`)
//     against the sea bed and its normal, as `map.html` `buildHullDrive` and
//     `hull-bodies.js` `adoptDrivenBody` arrange it. The World steps her from
//     the helmsman's input word (`world-vehicle-tick.js`: throttle, yaw, and
//     the pitch a submarine's dive planes and a landing craft's ramp bind);
//   * the helm let go: an empty PlayerControlObject keeps its physics in the
//     engine, so she runs on with her controls at zero (`World.coastHull`)
//     until she is at rest. The page stops her dead where her driver left her
//     (`releaseDrivenBody`); the room is the authority, and every page draws
//     the room's pose;
//   * the decks: the top of a ship's hull under a point, in her live frame
//     (`shipDeckAt`, the col1 the statics index holds; `col0DeckAt`, the
//     col0 an aircraft's wheels meet, COL-6), handed to an aircraft's drive
//     as its floor and to the parked bodies as their ground, with the deck's
//     own point speed (`getTangentSpeed`, COL-30/COL-31, `deck-carry.js`). A
//     soldier needs none of it: the collider is told where each hull is every
//     tick (`level-instance.mjs` `publishHullPoses`) and `soldier-resolve.js`
//     stands and carries him on it.
//
//   * going down: a hull that crosses into critical is sent 0x14, and each of
//     her floats takes a sink rate (`FloatingBundle::handleMessage`
//     0x082402b0, HP-13, SHIP-4). Under a drive it is the drive's
//     (`Ship.armSinking`); lying with nobody at the helm it is a
//     `FloatingHull` of her own, the page's `stepSinkingHulls`. Her deck
//     points and whoever stands on her go down with her.
//
// Not here: a land hull on a deck (`landOnShipDecks`), and a flying boat
// moored on the sea (`floatsOnTheSea`, BF1918's Felixstowe).

import * as THREE from 'three';

import { equilibriumRootY, floatNodesOf, localiseFloats, FloatingHull } from '../viewer/body-float.js';
import { DECK_STEP_UP } from '../viewer/ground-contact.js';
import { classifyRoot } from '../viewer/seats.js';
import { hullCollisionKeel, hullCollisionLayers, rootCollisionPart } from '../viewer/ship-spec.js';
import { spawnHoldOf } from '../viewer/spawned-craft.js';
import { describeVehicleParts } from '../viewer/vehicle-bodies.js';
import { writeBodyPose } from './level-bodies.mjs';

/** How far under its query height a ship's deck is looked for (`hull-bodies.js`). */
const SHIP_DECK_REACH = 6;
/** A deck face is no steeper than this (`ground-contact.js` `DECK_FLOOR_COS`). */
const SHIP_DECK_FLOOR_COS = 0.5;
/** How far under a parked body's vertex a deck still holds it (`hull-bodies.js`). */
const SHIP_DECK_BODY_REACH = 1.5;
/** Air kept under the lowest hull vertex of an aircraft on a deck (`hull-bodies.js`). */
const HULL_DECK_MARGIN = 0.05;

const _m = new THREE.Matrix4();
const _inv = new THREE.Matrix4();
const _local = new THREE.Matrix4();
const _p = new THREE.Vector3();
const _d = new THREE.Vector3();
const _n = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _normal = [0, 1, 0];

const seaHulls = new WeakMap();

/** A floating hull (`hull-bodies.js` `isSeaHull`): `VCSea`, unless its own
 *  engines make it a land vehicle (Desert Combat's Forklift). */
export function isSeaHull(node) {
  if (node?.userData?.physics?.vehicleCategory !== 'VCSea') return false;
  if (!seaHulls.has(node)) {
    const kind = classifyRoot(node);
    seaHulls.set(node, kind !== 'ground' && kind !== 'tank');
  }
  return seaHulls.get(node);
}

/** A world matrix onto a node. */
function setNodeWorld(node, m) {
  if (node.parent) {
    node.parent.updateWorldMatrix(true, false);
    _local.multiplyMatrices(_inv.copy(node.parent.matrixWorld).invert(), m);
  } else {
    _local.copy(m);
  }
  _local.decompose(node.position, node.quaternion, _s);
  node.updateMatrix();
  node.updateMatrixWorld(true);
}

/**
 * The room's copy of a layer's report, with deck points of its own: each
 * `vehicleSoldierSpawns` row copied with its `position`, so a ship under way
 * in one room moves no other room's points. The flags the World builds hold
 * these rows (`spawn-flags.js`: a ship flag's ring IS its point's array), so
 * writing a point in place moves the spawn, the bots' pick and the ring.
 * The report itself when the layer carries no such point.
 */
export function ownDeckPoints(extras) {
  const points = extras?.vehicleSoldierSpawns;
  if (!Array.isArray(points) || !points.length) return extras;
  return { ...extras, vehicleSoldierSpawns: points.map(spawn => (Array.isArray(spawn?.position)
    ? { ...spawn, position: spawn.position.slice(), deckBake: (spawn.deckBake ?? spawn.position).slice() }
    : spawn)) };
}

/**
 * The load's half (`hull-bodies.js` `floatPlacedVehicles`): every floating
 * hull of `ownerRoots` at the draft its float nodes hold it at
 * (`equilibriumRootY`, only `y` moves), every deck aircraft back on its
 * spawner's pose on her (`pinHeldCraft`), and the layer's deck points carried
 * through the move (`rebaseDeckSpawns`). Before the collision index bakes
 * the scene. Returns the hosts: `floatHosts` (each with the pose its points
 * were baked against) and `deckHosts` (those and the sea hulls that never
 * move, PHY-17, whose top is a deck all the same).
 */
export function floatSeaHulls(ownerRoots, waterLevel, extras) {
  const floatHosts = [];
  const deckHosts = [];
  if (!Number.isFinite(waterLevel)) return { floatHosts, deckHosts };
  for (const node of ownerRoots) {
    if (!node || !isSeaHull(node)) continue;
    const floats = floatNodesOf(node);
    let radius = 0;
    for (const float of floats) radius = Math.max(radius, Math.hypot(float.offsetX, float.offsetZ));
    if (node.userData?.physics?.hasMobilePhysics === false) {
      deckHosts.push({ node, radius });
      continue;
    }
    if (!floats.length) continue;
    node.updateWorldMatrix(true, false);
    const authored = node.matrixWorld.elements;
    const host = {
      node,
      authored: [authored[12], authored[13], authored[14]],
      authoredInverse: node.matrixWorld.clone().invert(),
      radius,
      template: String(node.userData?.control ?? node.name ?? '').toLowerCase(),
      // A landing craft one of the ships launched: never a deck point's host.
      launched: Boolean(node.userData?.heldSpawner),
      points: [],
    };
    floatHosts.push(host);
    deckHosts.push(host);
    const y = equilibriumRootY(floats, waterLevel);
    if (!Number.isFinite(y)) continue;
    node.position.y += y - authored[13];
    node.updateMatrix();
    node.updateMatrixWorld(true);
  }
  // The deck aircraft go with their ships, before the index bakes them.
  for (const node of ownerRoots) {
    const hold = node ? spawnHoldOf(node) : null;
    if (!hold?.host || hold.released) continue;
    hold.host.updateWorldMatrix(true, false);
    setNodeWorld(node, _m.multiplyMatrices(hold.host.matrixWorld, hold.local));
  }
  for (const spawn of extras?.vehicleSoldierSpawns ?? []) {
    if (!spawn?.position || !spawn.deckBake) continue;
    const host = deckSpawnHost(floatHosts, spawn);
    if (host) host.points.push(spawn);
  }
  for (const host of floatHosts) rebaseHostPoints(host);
  return { floatHosts, deckHosts };
}

/** The hull a baked deck point belongs to (`hull-bodies.js` `deckSpawnHost`):
 *  the ship of its template nearest it, never a launched landing craft; by
 *  position alone when no hull carries its name. */
function deckSpawnHost(floatHosts, spawn) {
  const [x, , z] = spawn.deckBake;
  const named = String(spawn.vehicle ?? '').toLowerCase();
  let host = null, best = Infinity, byName = false;
  for (const candidate of floatHosts) {
    if (candidate.launched) continue;
    const d = Math.hypot(x - candidate.authored[0], z - candidate.authored[2]);
    if (d > candidate.radius + 40) continue;
    const match = named !== '' && candidate.template === named;
    if (byName && !match) continue;
    if (match && !byName) { byName = true; best = Infinity; }
    if (d < best) { best = d; host = candidate; }
  }
  return host;
}

/** A host's deck points where she is now: each baked point through the
 *  inverse of the pose it was baked against and her live matrix, which is
 *  what `BFSpawnPoint::spawn` 0x08163d70 reads (SPAWN-4). In place. */
function rebaseHostPoints(host) {
  if (!host.points.length) return;
  host.node.updateWorldMatrix(true, false);
  for (const spawn of host.points) {
    _p.fromArray(spawn.deckBake).applyMatrix4(host.authoredInverse).applyMatrix4(host.node.matrixWorld);
    spawn.position[0] = +_p.x.toFixed(3);
    spawn.position[1] = +_p.y.toFixed(3);
    spawn.position[2] = +_p.z.toFixed(3);
  }
}

/** A hull's col0 vertices (its `body` parts), in the body frame, flat
 *  (`hull-bodies.js` `hullVertices`). */
function hullVertices(spec) {
  const out = [];
  for (const desc of spec?.parts || []) {
    if (desc.kind !== 'body') continue;
    const v = desc.shape?.layers?.[0]?.vertices;
    if (!v) continue;
    const rot = desc.rot, o = desc.offset;
    for (let i = 0; i < v.length; i += 3) {
      out.push(o[0] + v[i] * rot[0][0] + v[i + 1] * rot[1][0] + v[i + 2] * rot[2][0],
               o[1] + v[i] * rot[0][1] + v[i + 1] * rot[1][1] + v[i + 2] * rot[2][1],
               o[2] + v[i] * rot[0][2] + v[i + 1] * rot[1][2] + v[i + 2] * rot[2][2]);
    }
  }
  return out;
}

/**
 * One room's ships.
 *
 * @param {object} data   the room's LevelData (`collisionMeshes`, `damageTables`)
 * @param {object} hosts  `floatSeaHulls`'s answer for this room's scene
 */
export function createRoomShips(data, { floatHosts, deckHosts }) {
  let collider = null;
  let world = null;
  let instance = null;
  const hostOf = new Map(floatHosts.map(host => [host.node, host]));
  /** The hulls whose drive is running with nobody at the helm. */
  const coasting = new Map();   // entry -> drive
  /** The hosts that moved this tick and owe their points a rebase. */
  const stirred = new Set();

  // --- a hull's own description -------------------------------------------------

  const specs = new WeakMap();
  /** A ship's spec for the body world (`hull-bodies.js` `seaHullSpec`): her
   *  parts and the root part her depth under the sea is taken on. */
  function specOf(node) {
    if (specs.has(node)) return specs.get(node);
    const spec = describeVehicleParts(node, data.collisionMeshes);
    if (spec) spec.waterPart = rootCollisionPart(spec.parts, node);
    specs.set(node, spec ?? null);
    return spec ?? null;
  }

  // --- the decks ----------------------------------------------------------------

  const owners = new WeakMap();
  const ownerOf = node => {
    let owner = owners.get(node);
    if (owner === undefined) {
      owner = collider?.statics?.ownerOf?.(node) ?? -1;
      owners.set(node, owner);
    }
    return owner;
  };
  const _ray = { t: 0, x: 0, y: 0, z: 0, nx: 0, ny: 1, nz: 0, dx: 0, dy: -1, dz: 0,
                 material: 0, kind: '', owner: -1, triangle: -1 };
  const shipDeck = { y: -Infinity, nx: 0, ny: 1, nz: 0, material: 0, owner: -1, host: null };

  /** The top of a ship's own hull under (x, z), at or below `fromY` and at
   *  most `reach` under it, or null (`hull-bodies.js` `shipDeckAt`): each
   *  hull whose footprint (x, z) is in, against that owner's triangles alone,
   *  in her baked frame once she has moved. Valid until the next call. */
  function shipDeckAt(x, z, fromY, reach = SHIP_DECK_REACH, skipOwner = -1) {
    shipDeck.y = -Infinity;
    const statics = collider?.statics;
    if (!statics?.cast || !deckHosts.length || !Number.isFinite(fromY)) return null;
    for (const host of deckHosts) {
      const e = host.node.matrixWorld.elements;
      const dx = x - e[12], dz = z - e[14];
      const r = host.radius + 40;
      if (dx * dx + dz * dz > r * r) continue;
      const owner = ownerOf(host.node);
      if (owner < 0 || owner === skipOwner) continue;
      const moved = collider.moved?.get(owner);
      let hit;
      if (moved) {
        const m = moved.inv;
        _ray.dx = -m[4]; _ray.dy = -m[5]; _ray.dz = -m[6];
        hit = statics.cast(
          m[0] * x + m[4] * fromY + m[8] * z + m[12],
          m[1] * x + m[5] * fromY + m[9] * z + m[13],
          m[2] * x + m[6] * fromY + m[10] * z + m[14],
          _ray.dx, _ray.dy, _ray.dz, reach, -1, _ray, owner);
      } else {
        _ray.dx = 0; _ray.dy = -1; _ray.dz = 0;
        hit = statics.cast(x, fromY, z, 0, -1, 0, reach, -1, _ray, owner);
      }
      if (!hit) continue;
      let nx = hit.nx, ny = hit.ny, nz = hit.nz;
      if (moved) {
        const f = moved.fwd;
        const wx = f[0] * nx + f[4] * ny + f[8] * nz;
        const wy = f[1] * nx + f[5] * ny + f[9] * nz;
        const wz = f[2] * nx + f[6] * ny + f[10] * nz;
        nx = wx; ny = wy; nz = wz;
      }
      if (ny < SHIP_DECK_FLOOR_COS) continue;
      const y = fromY - hit.t;
      if (y <= shipDeck.y) continue;
      shipDeck.y = y;
      shipDeck.nx = nx; shipDeck.ny = ny; shipDeck.nz = nz;
      shipDeck.material = hit.material;
      shipDeck.owner = owner;
      shipDeck.host = host;
    }
    return shipDeck.y > -Infinity ? shipDeck : null;
  }

  /** A host's col0 triangles in her own frame, cached (`col0TrianglesOf`). */
  function col0TrianglesOf(host) {
    if (host.col0Tris !== undefined) return host.col0Tris;
    host.col0Tris = null;
    const spec = specOf(host.node);
    const tris = [];
    for (const part of spec?.parts ?? []) {
      if (part.kind === 'spring') continue;
      const layer = part.shape?.layers?.[0];
      if (!layer?.faces?.length) continue;
      const v = layer.vertices, rot = part.rot, o = part.offset;
      const at = i => [
        o[0] + v[3 * i] * rot[0][0] + v[3 * i + 1] * rot[1][0] + v[3 * i + 2] * rot[2][0],
        o[1] + v[3 * i] * rot[0][1] + v[3 * i + 1] * rot[1][1] + v[3 * i + 2] * rot[2][1],
        o[2] + v[3 * i] * rot[0][2] + v[3 * i + 1] * rot[1][2] + v[3 * i + 2] * rot[2][2]];
      for (let f = 0; f < layer.faces.length; f += 3) {
        const a = at(layer.faces[f]), b = at(layer.faces[f + 1]), c = at(layer.faces[f + 2]);
        const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
        const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
        const len = Math.hypot(n[0], n[1], n[2]);
        if (!(len > 1e-12)) continue;
        tris.push({ a, e1, e2, n: n.map(x => x / len), material: layer.faceMaterials?.[f / 3] ?? 0 });
      }
    }
    host.col0Tris = tris.length ? tris : null;
    return host.col0Tris;
  }

  const col0Deck = { y: -Infinity, nx: 0, ny: 1, nz: 0, material: 0, host: null };

  /** The highest upward col0 face of a ship's deck under (x, z) below
   *  `fromY`, by her live pose, or null (`hull-bodies.js` `col0DeckAt`): what
   *  an aircraft's wheels meet (COL-6). Valid until the next call. */
  function col0DeckAt(x, z, fromY, reach = SHIP_DECK_REACH) {
    let best = null;
    for (const host of deckHosts) {
      const e = host.node.matrixWorld.elements;
      const dx = x - e[12], dz = z - e[14];
      const r = host.radius + 40;
      if (dx * dx + dz * dz > r * r) continue;
      const tris = col0TrianglesOf(host);
      if (!tris) continue;
      const m = host.node.matrixWorld;
      _inv.copy(m).invert();
      const p = _p.set(x, fromY, z).applyMatrix4(_inv);
      const d = _d.set(0, -1, 0).transformDirection(_inv);
      for (const t of tris) {
        // Moller-Trumbore, the ray down from `fromY` in the ship's frame.
        const px = d.y * t.e2[2] - d.z * t.e2[1], py = d.z * t.e2[0] - d.x * t.e2[2], pz = d.x * t.e2[1] - d.y * t.e2[0];
        const det = t.e1[0] * px + t.e1[1] * py + t.e1[2] * pz;
        if (Math.abs(det) < 1e-12) continue;
        const inv = 1 / det;
        const sx = p.x - t.a[0], sy = p.y - t.a[1], sz = p.z - t.a[2];
        const u = (sx * px + sy * py + sz * pz) * inv;
        if (u < 0 || u > 1) continue;
        const qx = sy * t.e1[2] - sz * t.e1[1], qy = sz * t.e1[0] - sx * t.e1[2], qz = sx * t.e1[1] - sy * t.e1[0];
        const w = (d.x * qx + d.y * qy + d.z * qz) * inv;
        if (w < 0 || u + w > 1) continue;
        const dist = (t.e2[0] * qx + t.e2[1] * qy + t.e2[2] * qz) * inv;
        if (dist < 0 || dist > reach) continue;
        const y = fromY - dist;
        if (best && y <= best.y) continue;
        _n.set(t.n[0], t.n[1], t.n[2]).transformDirection(m);
        if (_n.y < 0) _n.negate();
        if (_n.y < SHIP_DECK_FLOOR_COS) continue;
        best = col0Deck;
        best.y = y; best.nx = _n.x; best.ny = _n.y; best.nz = _n.z; best.material = t.material;
        best.host = host;
      }
    }
    return best;
  }

  /** A ship's velocity at world point `p`, into `out` (`getTangentSpeed`
   *  0x08254b90, v + w x (p - c)): from her drive while it runs, else zero. */
  function pointVelocity(hostNode, p, out) {
    out[0] = 0; out[1] = 0; out[2] = 0;
    const entry = entryOfRoot(hostNode);
    const drive = entry ? runningDriveOf(entry) : null;
    const going = drive ? null : hostOf.get(hostNode)?.sinking?.body;
    if (going) {
      const rx = p[0] - going.pos[0], ry = p[1] - going.pos[1], rz = p[2] - going.pos[2];
      out[0] = going.v[0] + going.w[1] * rz - going.w[2] * ry;
      out[1] = going.v[1] + going.w[2] * rx - going.w[0] * rz;
      out[2] = going.v[2] + going.w[0] * ry - going.w[1] * rx;
      return out;
    }
    const s = drive?.state;
    if (!s?.velocity) return out;
    const w = s.angularVelocity;
    const rx = p[0] - s.position.x, ry = p[1] - s.position.y, rz = p[2] - s.position.z;
    out[0] = s.velocity.x + (w ? w.y * rz - w.z * ry : 0);
    out[1] = s.velocity.y + (w ? w.z * rx - w.x * rz : 0);
    out[2] = s.velocity.z + (w ? w.x * ry - w.y * rx : 0);
    return out;
  }

  const entries = new WeakMap();
  /** The table row whose hull is `node` (the table only ever grows). */
  function entryOfRoot(node) {
    let entry = entries.get(node);
    if (entry === undefined) {
      entry = instance?.table?.find?.(e => e.root === node) ?? null;
      if (entry || instance) entries.set(node, entry);
    }
    return entry ?? null;
  }

  /** The drive stepping `entry`'s hull this tick: her helmsman's, or the one
   *  running on with nobody at the helm. */
  function runningDriveOf(entry) {
    if (entry.driver != null) return world?.player(entry.driver)?.vehicle ?? null;
    return coasting.get(entry) ?? null;
  }

  /** One side of a material pair (`hull-bodies.js` `deckMaterialField`). */
  function deckMaterialField(id, field, ctorDefault) {
    const materials = data.damageTables?.materials;
    if (!materials) return field === 'resistance' ? 0.02 : ctorDefault;
    const rec = materials[id] ?? materials[String(id)] ?? materials[0] ?? materials['0'];
    const v = rec?.[field];
    return v == null ? ctorDefault : v;
  }

  const _deckAt = [0, 0, 0];

  /**
   * An aircraft's drive given the ships' decks for its floor
   * (`hull-bodies.js` `aircraftOnShipDecks`): on the per-tick law its wheels
   * meet a deck's col0 with the deck's own material and point speed
   * (`aircraftLawOnShipDecks`, AIRGND-5), else the hull top with the lift
   * that keeps its propeller out of the deck. Idempotent.
   */
  function aircraftOnDecks(vehicle, spec = null) {
    if (!deckHosts.length) return;
    if (vehicle?.node?.userData?.physics?.vehicleCategory !== 'VCAir') return;
    if (typeof vehicle.groundHeight !== 'function' || !vehicle.state?.position) return;
    const base = vehicle.groundHeight.shipDeckBase ?? vehicle.groundHeight;
    const from = fromY => (Number.isFinite(fromY) ? fromY : vehicle.state.position.y + 0.5);
    if (!vehicle.groundLaw) {
      const hull = hullVertices(spec);
      const floor = (x, z, fromY) => {
        const ground = base(x, z, fromY);
        const deck = shipDeckAt(x, z, vehicle.state.position.y + 0.5, SHIP_DECK_REACH);
        if (!deck || deck.y <= ground) return ground;
        return deck.y + hullLift(vehicle, hull);
      };
      floor.shipDeckBase = base;
      vehicle.groundHeight = floor;
      return;
    }
    const floor = (x, z, fromY) => {
      const ground = base(x, z, fromY);
      const deck = col0DeckAt(x, z, from(fromY));
      return deck && deck.y > ground ? deck.y : ground;
    };
    floor.shipDeckBase = base;
    vehicle.groundHeight = floor;
    const baseNormal = vehicle.deckNormal?.shipDeckBase ?? vehicle.deckNormal ?? null;
    const normal = (x, z, fromY, out) => {
      const deck = col0DeckAt(x, z, from(fromY));
      if (deck && deck.y > base(x, z, fromY)) {
        out[0] = deck.nx; out[1] = deck.ny; out[2] = deck.nz;
        return true;
      }
      return baseNormal ? baseNormal(x, z, fromY, out) : false;
    };
    normal.shipDeckBase = baseNormal;
    vehicle.deckNormal = normal;
    vehicle.deckVelocity = (x, y, z, fromY, out) => {
      const deck = col0DeckAt(x, z, from(fromY));
      if (!deck || !(deck.y > base(x, z, fromY))) return false;
      _deckAt[0] = x; _deckAt[1] = y; _deckAt[2] = z;
      pointVelocity(deck.host.node, _deckAt, out);
      return true;
    };
    const baseFriction = vehicle.surfaceFriction?.shipDeckBase ?? vehicle.surfaceFriction ?? null;
    if (!baseFriction) return;
    const onDeck = (x, z, fromY) => {
      const deck = col0DeckAt(x, z, Number.isFinite(fromY) ? fromY + 0.5 : vehicle.state.position.y + 0.5);
      return deck && deck.y > base(x, z, fromY) ? deck : null;
    };
    const friction = (x, z, fromY) => {
      const deck = onDeck(x, z, fromY);
      return deck ? deckMaterialField(deck.material, 'friction', 1.0) : baseFriction(x, z, fromY);
    };
    friction.resistance = (x, z, fromY) => {
      const deck = onDeck(x, z, fromY);
      if (deck) return deckMaterialField(deck.material, 'resistance', 0.01);
      return baseFriction.resistance ? baseFriction.resistance(x, z, fromY) : undefined;
    };
    friction.shipDeckBase = baseFriction;
    vehicle.surfaceFriction = friction;
  }

  /** How far a deck lifts an aircraft over its clearance so no hull vertex is
   *  under it (`hull-bodies.js` `hullLift`). */
  function hullLift(vehicle, hull) {
    if (!hull.length) return 0;
    const q = vehicle.state.orientation;
    const clearance = vehicle.spec?.groundClearance ?? 0;
    const m10 = 2 * (q.x * q.y + q.w * q.z), m11 = 1 - 2 * (q.x * q.x + q.z * q.z), m12 = 2 * (q.y * q.z - q.w * q.x);
    let lowest = 0;
    for (let i = 0; i < hull.length; i += 3) {
      const y = m10 * hull[i] + m11 * hull[i + 1] + m12 * hull[i + 2];
      if (y < lowest) lowest = y;
    }
    return Math.max(0, -lowest + HULL_DECK_MARGIN - clearance);
  }

  /**
   * A body terrain that also stands a vertex on a ship's hull top
   * (`hull-bodies.js` `withShipDecks`): a deck aircraft its spawner has let
   * go, parked on the deck, meets her as an object at the relative speed
   * (`body-ground.js` `terrainContact`, COL-31). The terrain itself on a
   * level with no deck.
   */
  function withDecks(ground) {
    if (!deckHosts.length || !ground) return ground;
    const deckAt = (x, z, y) => {
      if (!Number.isFinite(y)) return null;
      const d = shipDeckAt(x, z, y + DECK_STEP_UP, DECK_STEP_UP + SHIP_DECK_BODY_REACH);
      return d && d.y > ground.height(x, z, y) ? d : null;
    };
    return {
      ...ground,
      height: (x, z, y) => deckAt(x, z, y)?.y ?? ground.height(x, z, y),
      normal: (x, z, out, y) => {
        const d = deckAt(x, z, y);
        if (!d) return ground.normal(x, z, out, y);
        out[0] = d.nx; out[1] = d.ny; out[2] = d.nz;
        return out;
      },
      material: (x, z, y) => deckAt(x, z, y)?.material ?? ground.material(x, z, y),
      surfaceVelocity: (x, y, z, vy, out) => {
        const d = deckAt(x, z, vy);
        if (!d?.host) return false;
        _deckAt[0] = x; _deckAt[1] = y; _deckAt[2] = z;
        pointVelocity(d.host.node, _deckAt, out);
        return true;
      },
    };
  }

  // --- the drive ----------------------------------------------------------------

  /** `hull-bodies.js` `seabedFriction`: the mean of the hull's own material
   *  (the table's default 1.0) and the bottom's, read raw off the heightfield
   *  (`impulseOn` 0x08258900). */
  let frictionTable;
  function seabedFriction(x, z) {
    if (frictionTable === undefined) {
      frictionTable = null;
      const materials = data.damageTables?.materials;
      if (materials) {
        frictionTable = new Float32Array(Math.max(1, ...Object.keys(materials).map(Number)) + 1).fill(1);
        for (const [id, m] of Object.entries(materials)) {
          const n = Number(id);
          if (Number.isFinite(n) && n >= 0 && n < frictionTable.length && Number.isFinite(m?.friction)) {
            frictionTable[n] = m.friction;
          }
        }
      }
    }
    const id = collider?.heightfield?.material?.(x, z);
    const bottom = frictionTable && Number.isInteger(id) && id >= 0 && id < frictionTable.length
      ? frictionTable[id] : 1;
    return 0.5 * (1 + bottom);
  }

  /**
   * `entry`'s helm taken by `playerId` through `occ` (a fresh occupancy of
   * her root): her one `Ship`, built the first time and kept, on the sea bed
   * and its normal (`map.html` `buildHullDrive`), grounded on her own col0
   * and adopted by the body world (`hull-bodies.js` `adoptDrivenBody`). A
   * hull still running from her last helmsman is taken as she goes. Returns
   * the drive, or null for a hull no `Ship` can be built for.
   */
  function takeHelm(entry, occ, makeDrive) {
    let drive = entry.shipDrive ?? null;
    if (drive) {
      occ.drive = drive;
      if (coasting.delete(entry)) world.stopCoasting(drive);
    } else {
      drive = makeDrive();
      if (!drive) return null;
      drive.groundHeight = (x, z) => {
        const h = collider?.heightfield?.height(x, z);
        return Number.isFinite(h) ? h : -Infinity;
      };
      drive.groundNormal = (x, z, out) => {
        const n = collider?.heightfield?.normal;
        if (!n) { out.set(0, 1, 0); return out; }
        n.call(collider.heightfield, x, z, _normal);
        out.set(_normal[0], _normal[1], _normal[2]);
        return out;
      };
      drive.seabedFriction = seabedFriction;
      drive.autoFirstPerson = false;
      const spec = entry.owner >= 0 ? specOf(entry.root) : null;
      if (spec) {
        if ('sampleKeel' in drive) drive.sampleKeel = hullCollisionKeel(spec);
        drive.useHullUnderside?.(hullCollisionLayers(spec));
      }
      entry.shipDrive = drive;
    }
    const spec = entry.owner >= 0 ? specOf(entry.root) : null;
    if (spec && !world.bodyWorld?.get(entry.owner)?.driven) {
      world.adoptDriven(entry.owner, drive, spec);
      // A sleeping root's parts are not tested (TANK-20,
      // `ResponsePhysicsManager::update`): her law keeps the root's own
      // sleep counter (`ship-law.js`), so a ship lying still with a crew
      // aboard costs no probe of the fleet moored round her (4.6 ms a tick
      // for the Shokaku at her pad on Wake). The page's body never sleeps.
      const driven = world.bodyWorld?.get(entry.owner)?.driven;
      if (driven && drive.law) {
        Object.defineProperty(driven, 'sleeping', {
          configurable: true,
          get: () => drive.law.sleepiness <= 0 && !drive.aground,
        });
      }
      // Out of the static index at once, not at the end of her first tick
      // under way: a hull that probed its own baked triangles would shove
      // itself (`hull-bodies.js` `adoptDrivenBody`).
      instance.publishHullNode?.(entry.owner);
    }
    return drive;
  }

  /** Drives to put back on the World's coasting list (`leaveHelm`). */
  const again = [];

  /** The helm let go: her controls at zero, her drive running on until she
   *  is at rest (`World.coastHull`), then scenery where she stopped. */
  function leaveHelm(entry, drive) {
    if (!drive) return;
    for (const channel of ['c_PIThrottle', 'c_PIYaw', 'c_PIPitch', 'c_PIFire', 'c_PIAltFire']) {
      drive.setInput?.(channel, 0);
    }
    coasting.set(entry, drive);
    const down = () => {
      // A hull going down never comes to rest: her floats wake her root
      // every tick (0x0824da20), so her drive goes on stepping her. Put
      // back on the list at the end of the tick, not from inside its walk.
      if (drive.sinking && coasting.get(entry) === drive) { again.push([drive, down]); return; }
      coasting.delete(entry);
      rest(entry, drive);
    };
    world.coastHull(drive, down);
  }

  /** At rest: no speed left on the drive, and out of the body world, whose
   *  collider keeps her hull where she lies. */
  function rest(entry, drive) {
    drive.state.velocity?.set(0, 0, 0);
    drive.state.angularVelocity?.set(0, 0, 0);
    drive.applyTransform?.();
    stirred.add(entry.root);
    if (world.bodyWorld?.get(entry.owner)?.driven) world.bodyWorld.remove(entry.owner);
  }

  /** `entry` is out of the world or stood up fresh on her pad
   *  (`room-pads.mjs`): no drive of the old hull runs on. */
  function forget(entry) {
    const drive = coasting.get(entry);
    if (drive) { coasting.delete(entry); world.stopCoasting(drive); }
    if (entry.shipDrive && world?.bodyWorld?.get(entry.owner)?.driven?.vehicle === entry.shipDrive) {
      world.bodyWorld.remove(entry.owner);
    }
    entry.shipDrive = null;
    const host = hostOf.get(entry.root);
    if (host) { host.sinking = null; stirred.add(entry.root); }
  }

  // --- going down ---------------------------------------------------------------

  /** A `FloatingHull` for a ship nobody is sailing (`hull-bodies.js`
   *  `armSinkingHull`): her floats on a rigid body at her pose, armed. */
  function armHull(host) {
    const floats = floatNodesOf(host.node);
    if (!floats.length) return null;
    host.node.updateWorldMatrix(true, false);
    const e = host.node.matrixWorld.elements;
    const axes = [[e[0], e[1], e[2]], [e[4], e[5], e[6]], [e[8], e[9], e[10]]];
    const physics = host.node.userData?.physics || {};
    const size = new THREE.Box3().setFromObject(host.node).getSize(new THREE.Vector3());
    let radius = 0;
    for (const float of floats) radius = Math.max(radius, Math.hypot(float.offsetX, float.offsetY, float.offsetZ));
    const hull = new FloatingHull({
      floats: localiseFloats(floats, axes),
      mass: physics.mass || 1, drag: physics.drag || 0,
      box: [size.x, size.y, size.z],
      inertiaModifier: physics.inertiaModifier || [1, 1, 1],
      waterLevel: collider?.waterLevel ?? 0,
      boundingRadius: radius,
      position: [e[12], e[13], e[14]], axes,
    });
    hull.arm();
    return hull;
  }

  /**
   * Once a tick: every floating hull whose Armor has crossed into critical
   * (`vehicle-damage.js` `criticalFlagged`, the 0x14 byte: a hull destroyed
   * in one blow from above its threshold is sent 0x15 alone and stays
   * afloat). Under a drive, the drive is armed and steps her; else she has a
   * `FloatingHull`, stepped here. A helm taken on a hull already going down
   * takes her float offsets with it.
   */
  function stepSinking() {
    for (const host of floatHosts) {
      const entry = entryOfRoot(host.node);
      if (entry?.live === false) continue;
      const owner = entry?.owner ?? ownerOf(host.node);
      const drive = entry ? runningDriveOf(entry) : null;
      if (drive) {
        if (host.sinking) {
          drive.armSinking?.(host.sinking.floats.map(float => float.sinkOffset || 0));
          host.sinking = null;
        } else if (!drive.sinking && world.vehicleDamage?.get(owner)?.criticalFlagged) {
          drive.armSinking?.();
        }
        continue;
      }
      if (!host.sinking) {
        if (!world.vehicleDamage?.get(owner)?.criticalFlagged) continue;
        host.sinking = armHull(host);
        if (!host.sinking) continue;
      }
      host.sinking.step();
      writeBodyPose(host.node, host.sinking.body);
      instance.publishHullNode?.(owner);
      stirred.add(host.node);
    }
  }

  /**
   * A craft a ship's spawner has just stood (`room-pads.mjs` `standUp`, at
   * the spawner's pose): a landing craft at its own draft, as the load puts
   * one (the page's `refloatHull`); an aircraft back on the spawner's hold
   * (`spawnObject` 0x083140a0 sets the hold on every spawn). Then told to
   * the collider, whose index has it where the level baked it.
   */
  function launched(entry) {
    const node = entry.root;
    if (isSeaHull(node)) {
      const floats = floatNodesOf(node);
      node.updateWorldMatrix(true, false);
      const y = floats.length && Number.isFinite(collider?.waterLevel) ? equilibriumRootY(floats, collider.waterLevel) : NaN;
      if (Number.isFinite(y)) {
        node.position.y += y - node.matrixWorld.elements[13];
        node.updateMatrix();
        node.updateMatrixWorld(true);
      }
      const host = hostOf.get(node);
      if (host) host.sinking = null;
    } else {
      const rec = instance?.held?.records.find(r => r.node === node);
      if (rec) { rec.released = false; rec.hostAt = null; }
    }
    instance?.publishHullNode?.(entry.owner);
  }

  /** Where `entry`'s hull is for the wire when the body world holds nothing
   *  for it (a ship at rest is scenery): its node's own pose, or null for a
   *  hull the body world answers for. */
  function poseOf(entry) {
    if (!entry?.root || world?.bodyWorld?.get(entry.owner)) return null;
    // ...or a craft a ship's spawner holds, which has no body while held
    // (`held-craft.mjs`).
    if (!isSeaHull(entry.root) && !hostOf.has(spawnHoldOf(entry.root)?.host)) return null;
    entry.root.updateWorldMatrix(true, false);
    entry.root.matrixWorld.decompose(_p, _q, _s);
    return { x: _p.x, y: _p.y, z: _p.z, q: [_q.x, _q.y, _q.z, _q.w] };
  }

  /** The end of a tick: the deck points of every ship that moved. */
  function step() {
    if (!instance) return;
    for (const [drive, down] of again.splice(0)) world.coastHull(drive, down);
    stepSinking();
    for (const entry of instance.table) {
      if (entry.shipDrive && runningDriveOf(entry) === entry.shipDrive) stirred.add(entry.root);
    }
    if (!stirred.size) return;
    for (const node of stirred) {
      const host = hostOf.get(node);
      if (host) rebaseHostPoints(host);
    }
    stirred.clear();
  }

  return {
    floatHosts, deckHosts,
    /** The level's collider, once it is built. */
    bind(c) { collider = c; },
    /** The room's instance, once it stands: its world and its table. */
    attach(inst) {
      instance = inst;
      world = inst.world;
      if (floatHosts.length && world) {
        const next = world.onTick;
        world.onTick = () => { step(); next?.(); };
      }
    },
    isShip: entry => !!entry?.root && isSeaHull(entry.root),
    specOf, takeHelm, leaveHelm, forget, launched, poseOf, runningDriveOf,
    shipDeckAt, col0DeckAt, pointVelocity, aircraftOnDecks, withDecks,
    get coasting() { return coasting.size; },
    /** Whether `entry`'s hull is going down. */
    sinking: entry => !!(entry?.shipDrive?.sinking || hostOf.get(entry?.root)?.sinking),
  };
}
