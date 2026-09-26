// The world's player records: a human's or a bot's record built around a
// Soldier, and putting either on a flag's spawn. Plain functions of the
// `World` (world.js), which delegates its methods here.

import { Soldier, pickSpawn, spawnYaw } from './soldier.js';

/**
 * A new player: a Soldier built the engine's way and parked on the first
 * spawn the given team/flag owns, plus the per-player input queue. The
 * page passes its own team (`deployTeamId`), or a specific flag it has
 * already chosen in its deploy UI, and the group for a vehicle-borne flag.
 * Returns the player record; the page reads `soldierOf(id)` for the camera.
 */
export function addPlayer(world, playerId, { team = null, flag = null, spawnIndex = 0, group = null } = {}) {
  const soldier = new Soldier({ collider: world.collider, worldSize: world.extras?.worldSize || 0 });
  const player = {
    id: playerId,
    team: team ?? flag?.team ?? null,
    soldier,
    armor: null,
    spawnIndex,
    flag: null,
    spawn: null,
    // occupied vehicle state, mounted by the page (setPlayerVehicle)
    occupancy: null,
    vehicle: null,
    kind: null,
    groups: [],
    manned: [],
    gate: { blocked: false, rotationalScale: 1 },
    stick: { roll: 0, pitch: 0 },
    // world position, page-fed for a bare seat (no drivetrain to hold one)
    position: null,
    supply: { team: null, refillAmmo: null },
    supplyResult: { gaveAmmo: false, healed: false },
    // the input word, engine-FIFO semantics (see the header):
    buffer: [],              // sequenced packets, appended, cap 4 drop-oldest
    pending: null,           // the page's un-sequenced freshest state (0-1)
    held: null,              // that state, for the rest of its frame's ticks
    lastSeen: -1,            // highest sequence accepted (receive dedupe)
    last: null,              // the entry the last tick consumed (or idle)
    lookApplied: { yaw: 0, pitch: 0 },
  };
  world.players.set(playerId, player);
  if (flag || team !== null) world.spawnPlayer(playerId, { flag, group });
  return player;
}

/**
 * Add a bot player to the world with a full Soldier, spawned on the given
 * flag's spawn points. Bots go through the same soldier tick as humans —
 * the world steps them, they move, they can cap flags.
 * Returns the player record.
 */
export function addBotPlayer(world, playerId, { team = null, flag = null, spawnIndex = 0 } = {}) {
  const soldier = new Soldier({ collider: world.collider, worldSize: world.extras?.worldSize || 0 });
  const player = {
    id: playerId,
    team: team ?? null,
    soldier,
    armor: null,
    spawnIndex,
    flag: null,
    spawn: null,
    occupancy: null,
    vehicle: null,
    kind: null,
    groups: [],
    manned: [],
    gate: { blocked: false, rotationalScale: 1 },
    stick: { roll: 0, pitch: 0 },
    position: null,
    supply: { team: null, refillAmmo: null },
    supplyResult: { gaveAmmo: false, healed: false },
    buffer: [],
    pending: null,
    held: null,
    lastSeen: -1,
    last: null,
    lookApplied: { yaw: 0, pitch: 0 },
  };
  world.players.set(playerId, player);
  if (flag || team !== null) world.spawnPlayer(playerId, { flag, group: team });
  return player;
}

/**
 * Put the player on the next of a flag's spawn points (the page's deploy
 * screen picks the flag; `advance` walks the list), exactly as the page's
 * `spawnAtFlag` used to: pickSpawn, then the soldier's own spawn at the
 * spawn's yaw. Returns `{ flag, spawn }`, or null when the flag has no
 * spawn left to offer.
 */
export function spawnPlayer(world, playerId, { flag = null, advance = false, group = null } = {}) {
  const player = world.players.get(playerId);
  if (!player) return null;
  const flags = world.flags;
  const side = player.team === 1 || player.team === 2;
  // A side with no flag of its own at the start (Omaha's Allies, whose deck
  // spawns ride a hull the level does not give us) goes to a neutral flag
  // before an enemy one.
  const pick = flag ?? (side
    ? flags.find(f => f.team === player.team) ?? flags.find(f => f.team !== 1 && f.team !== 2)
    : flags[0]);
  if (!pick && !flags.length) return null;
  const target = pick ?? flags[0];
  if (advance) player.spawnIndex++;
  const spawn = pickSpawn(target, player.spawnIndex, {
    groundAt: world.groundHeight,
    group: target.vehicle ? (group ?? player.team) : null,
    // The collider, so a point inside a model is walked past rather than
    // stood on (`spawn-safety.js`). Absent on a page with no world
    // geometry, and then the pick is the authored point as before.
    world: world.collider,
  });
  if (!spawn) return null;
  player.soldier ??= new Soldier({ collider: world.collider, worldSize: world.extras?.worldSize || 0 });
  player.soldier.collider = world.collider;
  player.soldier.spawn(
    spawn.position[0], spawn.position[1], spawn.position[2], spawnYaw(spawn));
  // A side's flag decides the side (the deploy screen's other-side spawn
  // switches it); a neutral flag never does, or a side standing on Omaha's
  // beach would become team 0, which no side-keyed table carries.
  if (target.team === 1 || target.team === 2) player.team = target.team;
  player.flag = target;
  player.spawn = spawn;
  return { flag: target, spawn };
}
