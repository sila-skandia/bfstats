// A room's bots: online co-op (gap audit entry 13). The page's own referee
// (`viewer/bot-referee.js`, the code single player and the headless runner
// `sim/match.mjs` run) inside the room's World, each bot a player of the room
// with a slot of its own, so every client draws it as it draws a remote human.
//
// RETAIL'S RULE, read on the dedicated server (lnxded.static):
//
//   * the top-up, `GameServer::gameStatusPlaying` 0x08150df0, every tick: on
//     an AI level (`+0x64`, 0x08150e7b) with auto-spawn on (`+0x468`,
//     0x08150e85), while the player count (`+0x18`, humans and bots: `createPlayer`
//     0x08131379 raises it for both) is under the server's max players (`+0x1c`;
//     `cmp %eax,0x18(%ecx); jge` at 0x08150e95) and `IAISettings::getMaxNBots`
//     (`+0x8`, 0x08483a30) is not `BotManager::getBotCount` (0x08150ec1), a bot
//     is created on the side `PlayerManager::getTeamToAddPlayer(r1, r2)`
//     names (vt+0x60 with `+0x2bc`/`+0x2c0`, 0x08150ee3; SIDE-6) and handed to
//     `IAIMain::activateBot` (vt+0x10, 0x08150f27); the loop runs again in the
//     same tick (0x08150f49);
//   * a human always gets in: `createPlayer` 0x081310e0 refuses only when the
//     HUMAN count (`+0x14`, raised for a non-AI player alone, 0x0813136f) has
//     reached max players (0x081310fb), so a server full of bots still seats
//     him and holds one player over its max;
//   * the removal, `GameServer::killPlayer` 0x0814d920, on an AI level when a
//     bot dies (BFPlayer vt+0x5c, 0x0814dc9f) outside game status 2 and 5:
//     while the player count less the bots already queued to go (`+0x478`'s
//     length) is over max players (`cmp %ecx,0x18(%eax); jbe` at 0x0814dd15)
//     and the dead bot's side is not the side `getTeamToAddPlayer` would add
//     to (0x0814dd3e..0x0814dd46), `IAIMain::deactivateBot(playerId)` (vt+0x18,
//     0x0814dd64) takes it out and it is queued for destruction. No other
//     caller deactivates a bot: a living bot is never kicked;
//   * how many: `aiSettings.setMaxNBots` (0x08483e60), 64 in vanilla's
//     `AIDefault.con`, so a vanilla co-op server fills itself to max players;
//     the skill is `aiSettings.setBotSkill`, 0.75 from `AISettings::reset`
//     (AI-14). `game.serverCoopAiSkill` / `serverCoopCpu` are stored and
//     reported only (AI-22);
//   * a bot's death waits for the reinforcement wave like anyone's (SPAWN-35),
//     and `listPlayers` prints ` is an AI bot.` for it (CON-24).
//
// WHAT A ROOM DOES DIFFERENTLY, each for a stated reason:
//
//   * the wire has 16 slots (`netcode.js` `MAX_PLAYERS`), so a room whose 16
//     are all held cannot seat a human "one over": the room then takes a bot
//     out at once (`makeRoom`), the heavier side's, a dead one first. With a
//     slot free it is retail's rule: the bot goes at its next death;
//   * bots run only while a human is in the room, and never over the room's
//     and the node's caps (`BOT_LIMITS`, measured: production is one 4-CPU
//     node every room shares). Retail's server runs them with nobody on;
//   * CREATE GAME's AI SKILL row sets the bots' skill, which retail's own row
//     never did (AI-22);
//   * a bot's bullet is the referee's resolved round, as on the page and in
//     the runner; its rocket, rifle grenade or thrown weapon is a round the
//     room flies, with its blast (`room-guns.mjs` `launchBotRound`, the
//     referee's `env.launchRound`), as the page's `bot-rounds.js` flies it;
//   * a bot's hull fires: a seat's guns are the room's own `GunFire`
//     (`room-guns.mjs`, 2026-11-13), the rounds flown and priced on the
//     server, and the bots take the hulls the room can drive (`policy.
//     vehicles`; the server's default, `--bot-vehicles off` keeps them on
//     foot) through the room's own seat law (`buildUnits`). Measured on
//     Berlin, 15 bots and one standing human, 200 s, eight runs each way,
//     the bots' rounds on the stand-in body: 25 kills a run on foot (11 to
//     42) and 22 with the hulls (10 to 30); on the capsules (`capsulesOf`
//     below, the default since) with the aim on the sensed bone
//     (`bot-plans.js` `aimPoint`): 30 on foot (15 to 43). The same
//     number of flags taken either way, at 0.8 ms a tick against 2.7. Before
//     the room had guns the hulls made 7. What is left between the two is
//     the engine's own trigger: a seated bot fires only while its round
//     would land within the plan's precision of its target
//     (`BAPCConPrecision`, 0.4 m for a soldier), which its servo holds on
//     about a tick in ten (`BOT_SEAT_AIM_THINK_TICKS`).
//
// The referee and the bot code are loaded on demand (`loadBotModules`): a
// room without bots never imports them.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { MAX_PLAYERS } from '../viewer/netcode.js';
import { Armor } from '../viewer/armor.js';
import { flagSide } from '../viewer/spawn-flags.js';
import { teamToAddPlayer } from '../viewer/team-to-add.js';
import { FRIENDLY_FIRE_SHIPPED, friendlyDamage } from '../viewer/friendly-fire.js';
import { eventRow } from './room-wire.mjs';
import { FIRE_EVENT_COOLDOWN_S } from './room-rules.mjs';
import { readGlb } from './glb-tree.mjs';
import { VehicleOccupancy } from '../viewer/seats.js';
import { seatAnchor } from '../viewer/seat-body.js';
import { Aircraft } from '../viewer/aircraft.js';
import { GroundVehicle } from '../viewer/wheeled-vehicle.js';
import { TrackedVehicle } from '../viewer/tracked-vehicle.js';
import { Ship } from '../viewer/ship.js';

/** `aiSettings.setMaxNBots 64`, vanilla's `AIDefault.con`: more than any
 *  room's slots, so the default is "fill the room", as a vanilla co-op
 *  server fills itself. */
export const RETAIL_MAX_N_BOTS = 64;
/** `AISettings::reset` 0x08484450 writes botSkill 0.75 (AI-14). */
export const RETAIL_BOT_SKILL = 0.75;

/**
 * The caps, from the measurement in `tests/room_bots_cost.mjs` (the report
 * `features/retail-inverse-gap-audit-2026-11-12`, entry 13, has the table):
 * `perRoom` bots in one room, `node` bots over every room of the process.
 */
export const BOT_LIMITS = Object.freeze({ perRoom: 15, node: 32 });

/**
 * How often a room's bot thinks: every `BOT_THINK_TICKS`-th 30 Hz tick, each
 * on a tick of its own (its slot's), with the time since its last turn as its
 * `dt`. The page's bots think once a frame at whatever rate the page draws
 * (`referee.tick(dt)`), so the bot code already takes any step; the room
 * takes 10 Hz because the node is shared. Retail's AI is paced too, by a time
 * budget (`ai::Scheduler::run` 0x08606120, AI-135). The rounds, the
 * magazines, the respawn wave and the seats still run every tick, and the
 * world steps every bot's body every tick on the word it last wrote.
 */
export const BOT_THINK_TICKS = 3;

/**
 * A bot in a seat with a target thinks every tick. Its look is a rate
 * (`bot-aim.js` `lookAtCounts`: the servo turns `count x maxSpeed` deg/s) and
 * its trigger is `BAPCConPrecision` (0x0854b570, `bot-plans.js`
 * `execTrigger`): down only while the round would land within the plan's
 * precision of the target, 0.4 m for a soldier. Steering that servo at 10 Hz
 * left the barrel circling the target: measured on Berlin (15 bots, 200 s),
 * a seated bot in its Fire behaviour had the trigger down on 5% of its ticks
 * and a hull room made 20 kills a run; every tick it is 10% and 27. With no
 * target it drives on the room's pace like anyone.
 */
export const BOT_SEAT_AIM_THINK_TICKS = 1;

/** The door radius of a hull that declares none (`vehicle-entry.js`). */
const ENTRY_RADIUS_FALLBACK = 3.0;
/** The kinds of unit a room's bots take: what the room can drive
 *  (`level-instance.mjs` `mountIntoSeat`; a ship since `room-ships.mjs`). An
 *  emplaced gun fires now (`room-guns.mjs`) and is still left out: measured
 *  on Berlin with them in (15 bots, 200 s, four runs) it was 21, 29, 1 and
 *  20 kills, the 1 a run where over half the bots sat at a gun with nobody
 *  in its arc. */
const ROOM_UNIT_KINDS = new Set(['ground', 'tank', 'air', 'ship']);
const DRIVE_CLASSES = { Aircraft, GroundVehicle, TrackedVehicle, Ship };

/** A soldier's hit points when the kit names none (`authority.mjs`). */
const SOLDIER_MAX_HP_FALLBACK = 30;
/** The stand-in a round with no material is priced at (`sim/level.mjs`). */
const STAND_IN_DAMAGE = 30;

let modules = null;
/** The bot code, loaded once a process: the referee and what a bot needs
 *  made around it. Resolves null where the viewer has no bot code to load. */
export function loadBotModules() {
  modules ??= (async () => {
    const [referee, bot, names, barrels, crash, projectile, items, deviation, nav, units, doors] = await Promise.all([
      import('../viewer/bot-referee.js'), import('../viewer/bot.js'), import('../viewer/bot-names.js'),
      import('../viewer/bot-barrels.js'), import('../viewer/crash-damage.js'),
      import('../viewer/projectile-damage.js'), import('../viewer/random-items.js'),
      import('../viewer/bot-deviation.js'), import('../viewer/nav-baked.js'),
      import('../viewer/bot-units.js'), import('../viewer/entry-points.js'),
    ]);
    const navGrid = await import('../viewer/nav-grid.js');
    return {
      createBotReferee: referee.createBotReferee, BOT_BODY_MATERIAL: referee.BOT_BODY_MATERIAL,
      BotController: bot.BotController,
      levelNameLists: names.levelNameLists, createBotNamer: names.createBotNamer,
      botWeaponData: barrels.botWeaponData,
      roundAttackerMaterial: crash.roundAttackerMaterial, materialDamage: crash.materialDamage,
      damageModifier: crash.damageModifier, damageFactor: projectile.damageFactor,
      resolveKitRow: items.resolveKitRow, rollKit: items.rollKit,
      footInputIndex: deviation.footInputIndex, readSearchMaps: nav.readSearchMaps,
      createBotUnits: units.createBotUnits,
      buildNavMap: navGrid.buildNavMap, OUTSIDE_MAP_MATERIAL: navGrid.OUTSIDE_MAP_MATERIAL,
      listEntryPoints: doors.listEntryPoints, boundingRadius: doors.boundingRadius,
    };
  })().catch(error => {
    console.error(`room bots: the bot code did not load (${error.message})`);
    return null;
  });
  return modules;
}

/** Whether a layer has bot data: the level's own strategic areas, or a
 *  generated layer (`ai.generated`, `sim/botgen.mjs`). A layer with neither
 *  gets no bots: they would have no orders. */
export function layerHasBotData(extras) {
  const ai = extras?.ai;
  return !!(ai && ((Array.isArray(ai.strategicAreas) && ai.strategicAreas.length > 0) || ai.generated));
}

/** The room's two bot settings, which ride the create row with the host's
 *  (`room-settings.mjs`): `numberOfBots` 0..64 (retail's `setMaxNBots`,
 *  default 64: fill the room) and `coopAiSkill` 25..100 (the AI SKILL row's
 *  percentage; 75 is the engine's 0.75). */
export function botSettingsOf(settings) {
  const n = settings?.numberOfBots, k = settings?.coopAiSkill;
  return {
    numberOfBots: Number.isFinite(n) ? Math.max(0, Math.min(RETAIL_MAX_N_BOTS, Math.trunc(n))) : RETAIL_MAX_N_BOTS,
    coopAiSkill: Number.isFinite(k) ? Math.max(25, Math.min(100, Math.trunc(k))) : Math.round(RETAIL_BOT_SKILL * 100),
  };
}

// --- a level's bot data ---------------------------------------------------------

const levelData = new WeakMap();

/**
 * What a level's bots are made from, read once a level out of its trees
 * (`LevelData.paths`, the page's own files): the kits and their AI weapons
 * (`_shared/loadouts.json`, the page's `botKitFor`), each weapon's fire data
 * out of its model glb (`botWeaponData`), a round's price (`damage.json`, the
 * page's `botRoundDamage`, DMG-1, DMG-3), the names (`_shared/bot-names.json`,
 * AI-134) and the baked search maps (`pathfinding/`, AI-102). The headless
 * runner reads the same (`sim/level.mjs` `realLevel`).
 */
export function botDataFor(level, M) {
  let data = levelData.get(level);
  if (data) return data;
  const paths = level.paths ?? null;
  const loadouts = level.loadouts ?? null;
  const levelKits = loadouts?.levels?.[level.name] ?? loadouts?.levels?.[String(level.name).toLowerCase()] ?? null;
  const readJson = file => {
    try { return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null; } catch { return null; }
  };

  const kitFor = (team, random = Math.random) => {
    const slots = levelKits?.[team]?.slots;
    const names = (Array.isArray(slots) ? slots : Object.values(slots ?? {})).filter(Boolean);
    if (!names.length) return null;
    const kitName = names[Math.floor(random() * names.length)];
    const row = loadouts?.kits?.[kitName];
    if (!row) return null;
    const kit = M.resolveKitRow(row, M.rollKit(row));
    const items = [...(kit.items ?? [])];
    if (kit.primary) items.sort((a, b) => (a === kit.primary ? -1 : 0) - (b === kit.primary ? -1 : 0));
    const weapons = items.map(item => {
      const ai = loadouts?.aiWeapons?.[item];
      return ai ? { ...ai, name: item } : null;
    }).filter(Boolean);
    return { name: kitName, primary: kit.primary ?? items[0] ?? null, weapons };
  };
  const maxHp = kitName => {
    const hp = loadouts?.kits?.[kitName]?.maxHitpoints;
    return Number.isFinite(hp) ? hp : SOLDIER_MAX_HP_FALLBACK;
  };

  // Weapon fire data from the model glbs' JSON chunks, case-folded, the
  // mod's tree before the vanilla one.
  const modelIndex = new Map();
  for (const dir of [...(paths?.modelsDirs ?? [])].reverse()) {
    let entries = [];
    try { entries = readdirSync(dir); } catch { /* a tree without models */ }
    for (const f of entries) if (f.endsWith('.glb')) modelIndex.set(f.slice(0, -4).toLowerCase(), join(dir, f));
    // The published tree keeps each glb once, by content, under `glbs/`, and
    // names it in `models.json` (`viewer/glb-store.js`, features/mesh-asset-size):
    // a name with no file of its own is its row's blob.
    for (const row of readJson(join(dir, 'models.json')) ?? []) {
      const key = String(row?.glb ?? '').replace(/\.glb$/i, '').toLowerCase();
      if (!key || !row.sha || modelIndex.has(key) || !paths.glbsDir) continue;
      const blob = join(paths.glbsDir, `${row.sha}.glb`);
      if (existsSync(blob)) modelIndex.set(key, blob);
    }
  }
  const fireCache = new Map();
  const weaponFire = name => {
    if (!name) return null;
    if (fireCache.has(name)) return fireCache.get(name);
    let fire = null;
    try {
      const file = modelIndex.get(String(name).toLowerCase());
      fire = file ? M.botWeaponData(readGlb(file).json, name)?.data ?? null : null;
    } catch { fire = null; }
    fireCache.set(name, fire);
    return fire;
  };

  const damage = level.damageTables ?? null;
  const tableGuns = damage ? {
    materials: damage.materials ?? null,
    modifiers: damage.modifiers ?? null,
    projectileEntry(spec) {
      const table = damage.projectiles;
      return table && spec?.template ? table[String(spec.template).toLowerCase()] ?? null : null;
    },
    attackerMaterial(spec) {
      if (!spec) return null;
      if (Number.isFinite(spec.material)) return spec.material;
      const entry = this.projectileEntry(spec);
      return Number.isFinite(entry?.material) ? entry.material : null;
    },
  } : null;
  const roundDamage = (fire, material = M.BOT_BODY_MATERIAL, distance = 0) => {
    const projectile = fire?.round ?? fire?.projectile;
    const spec = typeof projectile === 'string' ? { template: projectile } : projectile ?? null;
    const falloff = M.damageFactor(spec?.damage, distance);
    const attacker = tableGuns?.materials ? M.roundAttackerMaterial(tableGuns, spec) : null;
    if (attacker === null) return STAND_IN_DAMAGE * falloff;
    const mod = tableGuns.modifiers ? M.damageModifier(tableGuns, attacker, material) : 1;
    return M.materialDamage(tableGuns, attacker) * mod * falloff;
  };

  const names = paths ? readJson(join(paths.sharedDir, 'bot-names.json')) : null;
  const vehicleAi = paths ? readJson(join(paths.sharedDir, 'vehicle-ai.json')) : null;
  let searchMaps = null;
  if (paths?.levelDir) {
    try {
      searchMaps = M.readSearchMaps(paths.levelDir, f => (existsSync(f) ? readFileSync(f) : null));
    } catch { searchMaps = null; }
  }
  data = {
    kitFor, maxHp, weaponFire, roundDamage, searchMaps, vehicleAi,
    /** A weapon's model glb, for the round the room flies (`room-guns.mjs`). */
    weaponFile: name => modelIndex.get(String(name ?? '').toLowerCase()) ?? null,
    /** Every weapon of the level's kits read now (a glb's JSON chunk each),
     *  so the first top-up reads no file inside a tick. */
    warm() {
      for (const side of Object.values(levelKits ?? {})) {
        const slots = side?.slots;
        for (const kitName of (Array.isArray(slots) ? slots : Object.values(slots ?? {}))) {
          for (const item of loadouts?.kits?.[kitName]?.items ?? []) weaponFire(item);
        }
      }
    },
    nameLists: names ? M.levelNameLists(names, level.name) : null,
  };
  levelData.set(level, data);
  return data;
}

/** level -> layer name -> a WeakRef of its infantry map. */
const navGrids = new WeakMap();

/**
 * A layer's infantry navigation map, built once and shared by every room of
 * the level that plays the layer. It is the map `referee.spawn` builds
 * (`buildNavMap` over the collider, seeded from every soldier spawn, the
 * outside-map material blocked, AI-27): 2048 x 2048 cells on a vanilla level,
 * 0.2 to 0.3 s of one core and 36 MB, the same for every room because the
 * statics and the terrain are the level's. Held weakly: it goes when the last
 * room using it does.
 */
function navGridFor(room, M) {
  const level = room.levelData;
  const world = room.world;
  const key = room.mode() ?? '';
  let byMode = navGrids.get(level);
  if (!byMode) navGrids.set(level, byMode = new Map());
  const held = byMode.get(key)?.deref();
  if (held) return held;
  const seeds = [];
  for (const flag of world.flags ?? []) {
    for (const spawn of flag.spawns ?? []) if (spawn?.position) seeds.push([spawn.position[0], spawn.position[2]]);
  }
  const grid = M.buildNavMap(world.collider, world.extras?.worldSize || 2048, {
    waterLevel: world.collider?.waterLevel, seeds, impassableMaterial: M.OUTSIDE_MAP_MATERIAL });
  byMode.set(key, new WeakRef(grid));
  return grid;
}

/** level -> layer name -> a WeakRef of its hull maps' holder. */
const hullMaps = new WeakMap();

/** A Map a room's own reset does not empty (`bot-units.js` `reset` clears
 *  its maps for a level change; a room's level never changes, and the maps
 *  are every room's of the level). */
class LevelMaps extends Map {
  clear() {}
}

/** The hull maps of a room's level and layer, `{ vehicle, water, byMap }`
 *  (`bot-units.js` `navVehicle`, `navWater`, `navByMap`): each built by the
 *  first room whose bots ask for it. Held by the rooms' units, so it goes
 *  when the last of them does. */
function hullMapsFor(room) {
  const level = room.levelData;
  const key = room.mode() ?? '';
  let byMode = hullMaps.get(level);
  if (!byMode) hullMaps.set(level, byMode = new Map());
  const held = byMode.get(key)?.deref();
  if (held) return held;
  const maps = { vehicle: null, water: new LevelMaps(), byMap: new LevelMaps() };
  byMode.set(key, new WeakRef(maps));
  return maps;
}

// --- one room's bots ------------------------------------------------------------

/**
 * @param {object} options
 * @param {object} options.room     the Room
 * @param {object} [options.policy] the process's half (`room-registry.mjs`):
 *   `{ enabled, perRoom, node, used() }`. Absent or `enabled` false: no bots.
 */
export function createRoomBots({ room, policy = null }) {
  const world = room.world;
  const extras = room.instance.extras;
  /** The host's two words, read live (an admin may change them). */
  const want = () => botSettingsOf(room.host?.settings);
  const enabled = !!policy?.enabled && layerHasBotData(extras);
  /** slot -> { bot, name, team }. */
  const slots = new Map();
  let M = null;
  let referee = null;
  let data = null;
  let namer = null;
  /** The world `referee.spawn` is shown (`buildReferee`): this room's, one
   *  metre wide, so the map it builds there costs nothing. */
  let spawning = false;
  const facade = {
    get extras() { return { ...world.extras, worldSize: 1 }; },
    get flags() { return world.flags; },
    get collider() { return world.collider; },
    get players() { return world.players; },
    player: id => world.player(id),
    armorOf: id => world.armorOf(id),
  };
  /** slot -> the input word its bot last wrote. */
  const words = new Map();
  const NO_LOOK = Object.freeze({ x: 0, y: 0 });
  const thinkTicks = Math.max(1, Math.trunc(policy?.thinkTicks ?? BOT_THINK_TICKS));
  const seatThinkTicks = Math.max(1, Math.trunc(policy?.seatThinkTicks ?? Math.min(thinkTicks, BOT_SEAT_AIM_THINK_TICKS)));
  /** The referee's `units` (`buildUnits`), null on a level with no hull the
   *  room can seat a bot in. */
  let units = null;
  let created = 0;
  /** The referee's CPU milliseconds and the ticks it ran, and the navigation
   *  map's build, for the cost check (`tests/room_bots_cost.mjs`). */
  const cost = { ms: 0, ticks: 0, navMs: 0 };

  const ready = enabled ? loadBotModules().then(async loaded => {
    if (!loaded) return false;
    M = loaded;
    data = botDataFor(room.levelData, M);
    data.warm();
    // The law of which rounds are flown (`room-guns.mjs`, `bot-rounds.js`).
    await room.guns?.loadBotLaw();
    // The referee and its map, now: off the room's tick and ahead of the
    // first bot (the pre-game is still running), so the first top-up is a
    // tick like any other and trips no stall collapse.
    try { buildReferee(); } catch (error) {
      console.error(`room ${room.code}: bots off, the referee did not build (${error.message})`);
      referee = null;
      return false;
    }
    return true;
  }) : Promise.resolve(false);

  const skill = () => want().coopAiSkill / 100;
  const perRoomCap = () => Math.max(0, Math.min(want().numberOfBots, policy?.perRoom ?? BOT_LIMITS.perRoom));
  const humans = () => room.players.size;
  const total = () => humans() + slots.size;
  const maxPlayers = () => Math.min(MAX_PLAYERS, room.capacity());
  const sideCounts = () => {
    let one = 0, two = 0;
    for (const c of room.players.values()) { if (c.team === 1) one++; else if (c.team === 2) two++; }
    for (const b of slots.values()) { if (b.team === 1) one++; else if (b.team === 2) two++; }
    return [one, two];
  };
  /** `getTeamToAddPlayer(r1, r2)` over every player, human and bot (SIDE-6). */
  const teamToAdd = () => {
    const [one, two] = sideCounts();
    return teamToAddPlayer(one, two, room.host.settings.axisTeamRatio,
                           room.host.settings.alliedTeamRatio, room.random);
  };
  /** A free slot, from the top: humans fill from 1, so a roster reads humans
   *  first. Null with all 16 held. */
  const freeSlot = () => {
    for (let slot = MAX_PLAYERS; slot >= 1; slot--) {
      if (!room.players.has(slot) && !slots.has(slot)) return slot;
    }
    return null;
  };
  const send = (type, row) => room.broadcast(eventRow(type, room.tick, row), null);

  // --- the referee (`sim/match.mjs` `refereeEnv`, with the room's own books) ---

  function buildReferee() {
    if (data.searchMaps && world.collider && !world.collider.searchMaps) {
      world.collider.searchMaps = data.searchMaps;
    }
    const fireAt = new Map();
    // Each bot's last input word, kept as it is written (`bot-aim.js`
    // `writeInput`), for the ticks between its turns (`tickBot`).
    const setInput = world.setInput.bind(world);
    world.setInput = (id, input, look, seq) => {
      if (slots.has(id)) words.set(id, input);
      return setInput(id, input, look, seq);
    };
    const bonesOf = player => room.guns?.soldierBones(player) ?? null;
    referee = M.createBotReferee({
      world: () => (spawning ? facade : world),
      // The respawn wave runs on the room's round clock, under the host's
      // spawn time and delay (SPAWN-35), as a human's does (`authority.mjs`).
      roundClock: () => room.authority.round?.clock,
      spawnParams: () => ({ spawnTime: room.authority.rules.spawnTime,
                            spawnDelay: room.authority.rules.spawnDelay }),
      get friendlyFire() { return room.host?.friendlyFire?.() ?? FRIENDLY_FIRE_SHIPPED; },
      // The hulls a bot can take: the room's own table (`buildUnits`).
      get units() { return units; },
      // A seated man is a body only where his seat reaches a SeatObject
      // (SEAT-37, `room-hits.mjs` `splashTargets`' own test), at its anchor.
      // A bot's bullet (the referee's resolved ray) meets the body a human's
      // round meets: the engine's capsules on the soldier's skeleton in his
      // stance (`room-guns.mjs` `capsulesOf`), and the bot aims at one of
      // that skeleton's bones (`bonesOf`, AI-123). Retail's bots shoot at
      // the same body the humans hit, and so do the page's and the headless
      // runner's (`server/soldier-capsules.mjs` `createStanceBodies` is the
      // runner's body too). Measured on Berlin, 15 bots on foot, 200 s,
      // eight runs: 30 kills a run, against 25 on the stand-in sphere (0.6 m
      // about a metre up, an invention twice a body's silhouette). For a
      // day the capsules made 10: the bots still aimed a metre over the
      // feet, clear over a man lying down. `policy.capsuleRays` false puts
      // a bot's rounds and aim back on the stand-in to measure.
      capsulesOf: policy?.capsuleRays !== false ? (id => room.guns?.capsulesOf(id) ?? null) : null,
      // The bones a bot's sense rays and aim pick among (the referee puts the
      // hook on each bot's senses).
      soldierBones: bonesOf,
      seatedBodyAt: id => {
        const occ = world.player(id)?.occupancy;
        const seat = occ?.seatInfo?.(occ.activeSeatId);
        const anchor = seat?.seatObjects?.length ? seatAnchor(seat) : null;
        if (!anchor?.matrixWorld) return null;
        occ.root?.updateMatrixWorld?.(true);
        const e = anchor.matrixWorld.elements;
        return { x: e[12], y: e[13] - 1, z: e[14] };
      },
      // The pacing (`BOT_THINK_TICKS`): a bot thinks on its own tick of the
      // cycle, over the time since it last did.
      tickBot: (bot, dt, now) => {
        bot._roomOwed = (bot._roomOwed ?? 0) + dt;
        const every = bot.vehicle && bot.firingTarget != null ? seatThinkTicks : thinkTicks;
        if ((room.tick + bot.playerId) % every !== 0) {
          // Between its turns the body runs on the word it last wrote: the
          // world holds an unsequenced word for one step only (the page
          // writes one a frame), so the room writes it again, with no mouse
          // (the turn was the think's own) and no second jump.
          // In a seat the look is a rate, not a turn (`bot-aim.js`
          // `lookAtCounts`: a turret's servo turns `count x maxSpeed`
          // deg/s), so it is held with the word: sent as nothing, a bot's
          // turret turned on one tick in three and its shells landed 50 m
          // and more off the target it had been tracking for a minute.
          const word = words.get(bot.playerId);
          if (word) {
            setInput(bot.playerId, word.jump ? { ...word, jump: false } : word,
                     bot.vehicle ? { x: bot.lookX ?? 0, y: bot.lookY ?? 0 } : NO_LOOK);
          }
          return;
        }
        const owed = bot._roomOwed;
        bot._roomOwed = 0;
        bot.tick(owed, now);
      },
      groundAt: (x, z) => room.instance.groundHeightAt(x, z),
      armorFor: bot => new Armor(data.maxHp(bot.kit)),
      roundDamage: (stats, material, distance) => data.roundDamage(stats, material, distance),
      // The room's authority owns the control points (`captureFlags`).
      captureEnabled: () => false,
      // A round left a bot's weapon: the `fire` row every client draws a
      // remote's shot from, at the humans' own throttle.
      onShot: bot => {
        const now = room.now();
        if (now < (fireAt.get(bot.playerId) ?? 0)) return;
        fireAt.set(bot.playerId, now + FIRE_EVENT_COOLDOWN_S * 1000);
        send('fire', { slot: bot.playerId });
      },
      onReload: (bot, weapon) => { if (weapon) send('reload', { slot: bot.playerId, weapon: String(weapon) }); },
      // Every hit is billed here, a bot's or a human's, on the Armor the
      // authority's death decree reads; `lastHit` names the killer by slot,
      // as `room-hits.mjs` leaves it.
      damageTarget: (hit, bot, at) => {
        hurt(hit.targetId, hit.damage, bot.playerId, at, { weapon: bot.weaponAi?.name ?? bot.kitPrimary ?? null, dist: hit.dist });
        return true;
      },
      // A rocket, a rifle grenade or a thrown weapon is a round the room
      // flies, with its blast (`room-guns.mjs` `launchBotRound`).
      launchRound: (bot, stats) => room.guns?.launchBotRound(bot, stats, data.weaponFile) ?? false,
      onDeath: bot => { bot._roomDeathSeen = true; },
      onRespawned: bot => {
        bot._roomDeathSeen = false;
        room.authority.dead.delete(bot.playerId);
        send('spawn', { slot: bot.playerId });
      },
    });
    if (policy?.vehicles === true) buildUnits();
    const started = performance.now();
    // The strategic AI and the covers, with no bot yet: each is added as the
    // top-up makes it (`addBot`). `spawn` also builds the infantry map, the
    // one slow step; it is handed a world one metre wide for that (`facade`)
    // and the level's shared map is put in its place (`navGridFor`), which
    // every later reader takes off `referee.navGrid`.
    spawning = true;
    try {
      referee.spawn({ count: 0, botSkill: skill(), teams: [1, 2], kitFor: () => null });
    } finally { spawning = false; }
    referee.navGrid = navGridFor(room, M);
    cost.navMs = performance.now() - started;
    namer = data.nameLists ? M.createBotNamer({ lists: data.nameLists, random: room.random }) : null;
  }

  // --- the hulls (`bot-units.js` over the room's own vehicle table) -----------
  //
  // The page's bots take a hull through its `VehicleRegistry`; a room seats
  // every player through `LevelInstance.mountIntoSeat` (one occupancy a
  // player, one drive a hull, on the server's own bodies), so the registry
  // `bot-units.js` asks is that law's, and a bot's seat goes out as the
  // `seatEnter` / `seatExit` rows a human's does.

  function buildUnits() {
    const instance = room.instance;
    if (!data.vehicleAi?.vehicles || !instance.table?.length) return;
    const entryByRoot = new Map(instance.table.map(entry => [entry.root, entry]));
    const surveys = new WeakMap();
    const surveyOf = entry => {
      let s = surveys.get(entry);
      if (!s) {
        const occ = new VehicleOccupancy(entry.root, DRIVE_CLASSES);
        s = { occ, order: occ.order, rootId: occ.rootId, kind: occ.rootKind };
        surveys.set(entry, s);
      }
      return s;
    };
    const views = new Map();
    const instanceView = entry => ({
      root: entry.root,
      get rootKind() { return surveyOf(entry).kind; },
      get drive() { return entry.driver != null ? world.player(entry.driver)?.vehicle ?? null : null; },
      // A seat's own guns, as the room flies them (`room-guns.mjs`).
      groupsOf: seatId => ({
        driven: [],
        manned: (surveyOf(entry).occ.fireArmsNodesOf?.(seatId) ?? [])
          .map(node => room.guns?.gunGroupOf(node, entry)).filter(Boolean),
      }),
    });
    const seatView = (slot, entry, occ) => ({
      root: entry.root, playerId: slot, instance: instanceView(entry),
      get seatId() { return occ.activeSeatId; },
      get drive() { return world.player(slot)?.vehicle ?? null; },
      get turret() { return occ.turret; },
      isActiveRoot: () => occ.activeSeatId === occ.rootId,
      groups: { get driven() { return world.player(slot)?.groups ?? []; },
                get manned() { return world.player(slot)?.manned ?? []; } },
      exitLocationNode: () => occ.exitLocationNode(),
    });
    const usable = entry => !!entry && entry.live !== false
      && !world.vehicleDamage?.get(entry.owner)?.destroyed;
    const registry = {
      holder(node, seatId) {
        for (const [id, p] of world.players) {
          if (p.occupancy?.root === node && p.occupancy.activeSeatId === seatId) return id;
        }
        return null;
      },
      driverOf: node => entryByRoot.get(node)?.driver ?? null,
      teamOf(node) {
        for (const p of world.players.values()) {
          if (p.occupancy?.root === node && (p.team === 1 || p.team === 2)) return p.team;
        }
        return entryByRoot.get(node)?.keptTeam ?? 0;
      },
      instanceOf: node => (entryByRoot.has(node) ? instanceView(entryByRoot.get(node)) : null),
      enter(node, seatId, slot, { requireDrive = false } = {}) {
        const entry = entryByRoot.get(node);
        if (!usable(entry)) return null;
        const index = surveyOf(entry).order.indexOf(seatId);
        if (index < 0 || (requireDrive && entry.driver != null)) return null;
        const mounted = instance.mountIntoSeat(world, slot, entry, index);
        if (!mounted) return null;
        if (requireDrive && !mounted.vehicle) {
          instance.unmountFromSeat(world, slot, entry);
          return null;
        }
        send('seatEnter', { slot, vehicle: entry.id, seat: index });
        const view = seatView(slot, entry, mounted.occupancy);
        views.set(slot, view);
        return view;
      },
      leave(slot) {
        const occ = world.player(slot)?.occupancy;
        views.delete(slot);
        const entry = occ ? entryByRoot.get(occ.root) : null;
        if (!entry) return;
        const seat = occ.order.indexOf(occ.activeSeatId);
        instance.unmountFromSeat(world, slot, entry);
        send('seatExit', { slot, vehicle: entry.id, seat: seat >= 0 ? seat : 0 });
      },
      switchSeat(slot, seatId) {
        const occ = world.player(slot)?.occupancy;
        const entry = occ ? entryByRoot.get(occ.root) : null;
        if (!entry) return null;
        const index = occ.order.indexOf(seatId);
        if (index < 0 || !instance.switchSeat(world, slot, entry, index)) return null;
        send('seatEnter', { slot, vehicle: entry.id, seat: index });
        return views.get(slot) ?? null;
      },
      seatOf: slot => (world.player(slot)?.occupancy ? views.get(slot) ?? null : null),
    };
    let doors = null;
    const radii = new WeakMap();
    const collectDoors = () => {
      doors = [];
      for (const entry of instance.table) {
        if (!usable(entry) || !entry.root) continue;
        if (!radii.has(entry.root)) radii.set(entry.root, M.boundingRadius(entry.root));
        const control = entry.root.userData?.control || entry.template || 'vehicle';
        for (const door of M.listEntryPoints(entry.root, ENTRY_RADIUS_FALLBACK)) {
          doors.push({ node: door.node, vehicle: entry.root, control, seatId: door.seatId,
                       radius: door.radius, hullRadius: radii.get(entry.root) });
        }
      }
      return doors;
    };
    const botUnits = M.createBotUnits({
      world: () => world,
      referee: () => referee,
      vehicles: registry,
      aiUrl: () => null,
      entryPoints: recollect => (recollect || !doors ? collectDoors() : doors),
      currentRoot: () => instance.root ?? instance.table,
      vehicleSpawnActive: node => usable(entryByRoot.get(node)),
      collider: () => world.collider,
      localPlayerId: null,
    });
    // `loadAi` is a fetch; the tree's file is already read (`sim/stage.mjs`).
    botUnits.ai = new Map(Object.entries(data.vehicleAi.vehicles).map(([k, v]) => [k.toLowerCase(), { name: k, ...v }]));
    botUnits.aiMod = data.vehicleAi.mod ?? null;
    botUnits.aiRadio = Array.isArray(data.vehicleAi.radio) ? data.vehicleAi.radio : null;
    // The hulls' navigation maps are the level's, as the infantry's is
    // (`navGridFor`): built once and shared by every room playing the layer.
    // A map is 9 bytes a square metre, 144 MB on a 4 km level, and a room of
    // its own copies was what the room cap could not hold
    // (`room-registry.mjs` `BOT_TIERS`).
    const shared = hullMapsFor(room);
    botUnits.navByMap = shared.byMap;
    botUnits.navWater = shared.water;
    Object.defineProperty(botUnits, 'navVehicle', {
      configurable: true, enumerable: true,
      get: () => shared.vehicle,
      // A room's reset is not the level's: the maps stay for the others.
      set: nav => { if (nav) shared.vehicle = nav; },
    });
    units = Object.create(botUnits);
    // `--bot-ships off` (`policy.ships`): the bots leave the ships alone,
    // as they did before the room sailed any (`room-ships.mjs`).
    // `policy.kinds`: the only kinds this room's bots take, where the cap
    // gave the room a lower tier (ships alone on Midway).
    const ships = policy?.ships !== false;
    const only = Array.isArray(policy?.kinds) ? new Set(policy.kinds) : null;
    units.candidates = () => botUnits.candidates()
      .filter(c => ROOM_UNIT_KINDS.has(c.kind) && (ships || c.kind !== 'ship') && (!only || only.has(c.kind)));
  }

  /**
   * `amount` HP off `slot`'s Armor by `attacker` (a slot): the seam every
   * soldier hit in a room with bots lands through, a bot's round and a
   * human's reported one (`room-hits.mjs`). A bot told of it reacts and, when
   * it killed him, is parked for the wave (`referee.damageLanded`); the
   * authority's decree makes the death (`killed`, the ticket, the score).
   * Returns the HP lost.
   */
  function hurt(slot, amount, attacker = null, at = null, opts = {}) {
    const player = world.player(slot);
    const armor = player?.armor;
    if (!armor || armor.destroyed || room.authority.dead.has(slot) || !(amount > 0)) return 0;
    const lost = armor.damage(amount);
    armor.lastHit = attacker;
    if (slots.has(slot) && referee) referee.damageLanded(slot, lost, attacker, at, opts);
    return lost;
  }

  function addBot(team) {
    const slot = freeSlot();
    if (slot == null) return null;
    const index = created++;
    const teamFlags = world.flags.filter(f => flagSide(f) === team && !f.captureOnly && !f.inactive && !f.enterOnly);
    const flag = teamFlags.length ? teamFlags[index % teamFlags.length] : null;
    const spawnIndex = teamFlags.length ? Math.floor(index / teamFlags.length) : index;
    const player = world.addBotPlayer(slot, { team, flag, spawnIndex });
    if (!player) return null;
    const kit = data.kitFor(team, room.random);
    const name = namer ? namer(team) : `Bot ${slot}`;
    const soldier = player.soldier;
    const bot = new M.BotController({
      playerId: slot, world, botSkill: skill(), name,
      spawnPos: soldier ? [soldier.x, soldier.y, soldier.z] : null,
      weapons: kit?.weapons ?? null,
      viewDistance: extras?.ai?.settings?.viewDistance ?? null,
    });
    bot.kit = kit?.name ?? null;
    bot.kitPrimary = kit?.primary ?? null;
    // `referee.spawn`'s own per-bot half, for a bot made after it.
    bot.lives = 0;
    bot.inputIndex = M.footInputIndex(slot, 0);
    bot.navGrid = referee.navGrid;
    bot.covers = referee.covers;
    bot.unitInfoOf = id => referee.unitInfo(id);
    bot.vehicleCandidates = [];
    bot.holdFire = true;
    referee.strategy?.addBot(slot, team);
    world.setPlayerArmor(slot, new Armor(data.maxHp(bot.kit)));
    const names = new Set((bot.weapons ?? []).map(w => w.name).filter(Boolean));
    if (bot.kitPrimary) names.add(bot.kitPrimary);
    for (const weapon of names) {
      const fire = data.weaponFire(weapon);
      if (fire) bot.setWeaponData(weapon, fire);
    }
    referee.bots.push(bot);
    slots.set(slot, { bot, name, team });
    // The roster row a human's join sends, with the bot's mark (CON-24).
    send('join', { slot, text: name, team, bot: true });
    send('spawn', { slot });
    return slot;
  }

  function removeBot(slot) {
    const row = slots.get(slot);
    if (!row) return false;
    const { bot, name } = row;
    try { if (bot.vehicle) referee.leaveVehicle(bot, { killed: true }); } catch { /* the seat is gone with him */ }
    referee.strategy?.removeBot?.(slot);
    room.guns?.forgetBot(slot);
    const at = referee.bots.indexOf(bot);
    if (at >= 0) referee.bots.splice(at, 1);
    slots.delete(slot);
    words.delete(slot);
    room.authority.forget?.(slot);
    room.authority.dead.delete(slot);
    room.stats.forget(slot);
    world.removePlayer(slot);
    send('leave', { slot, text: name, bot: true });
    return true;
  }

  /** The bot a full slot table gives up for a human: the heavier side's, a
   *  dead one before a living one, the newest first. */
  function pickToRemove() {
    const [one, two] = sideCounts();
    const heavy = one === two ? 0 : (one > two ? 1 : 2);
    let best = null, bestScore = -1;
    for (const [slot, row] of slots) {
      const score = (heavy === 0 || row.team === heavy ? 2 : 0)
        + (world.armorOf(slot)?.destroyed ? 1 : 0);
      if (score > bestScore) { best = slot; bestScore = score; }
    }
    return best;
  }

  /** Before a human's join takes a slot: with all 16 held, one bot goes now
   *  (the header's first departure). True when a slot is free. */
  function makeRoom() {
    if (freeSlot() != null) return true;
    const slot = pickToRemove();
    return slot != null && removeBot(slot);
  }

  /** After the world's step and before the authority's: the bots' tick
   *  (`sim/match.mjs` `step`: `world.step`, `referee.tick`). Only while the
   *  round plays: `gameStatusPlaying` is where retail tops up and spawns. */
  function step(dt) {
    if (!referee || !slots.size) return;
    if (room.authority.round?.status !== 'playing') return;
    // The process's own CPU time (user + system), which a busy node does
    // not stretch as it stretches the wall clock.
    const started = process.cpuUsage();
    referee.tick(dt);
    const spent = process.cpuUsage(started);
    cost.ms += (spent.user + spent.system) / 1000;
    cost.ticks++;
  }

  /** After the authority's step: the deaths it decreed, the removal and the
   *  top-up, retail's two rules (the header). */
  function afterAuthority() {
    if (!enabled || !M) return;
    // Nobody to play with: the bots go, and come back with the next human.
    if (!humans()) {
      for (const slot of [...slots.keys()]) removeBot(slot);
      return;
    }
    const status = room.authority.round?.status;
    if (referee) {
      for (const [slot, row] of [...slots]) {
        const bot = row.bot;
        // A side the auto-balance or a restart moved is the world's to say.
        const armor = world.armorOf(slot);
        if (!armor?.destroyed) { bot._roomDead = false; continue; }
        if (bot._roomDead) continue;
        bot._roomDead = true;
        // A death no bot's round made (a human's blast, a hull, the sea):
        // the referee parks him for the wave as it does its own kills.
        if (!bot._roomDeathSeen) referee.damageLanded(slot, 0, armor.lastHit ?? null, null, { environment: true });
        // The round's end clears the world: everyone stands up together
        // when the next one plays (ROUND-14 writes the pre-game into every
        // player's wait).
        if (status !== 'playing') { bot._respawnForce = true; continue; }
        // `killPlayer`'s removal: over max players, and not on the side the
        // next player would be added to.
        if (total() > maxPlayers() && row.team !== teamToAdd()) removeBot(slot);
      }
    }
    if (status !== 'playing') return;
    // The top-up, as many as it takes in one tick.
    while (total() < maxPlayers() && slots.size < perRoomCap()
           && (policy?.used?.() ?? slots.size) < (policy?.node ?? BOT_LIMITS.node)) {
      if (!referee) break;
      if (addBot(teamToAdd()) == null) break;
    }
  }

  return {
    enabled, ready, slots, cost,
    has: slot => slots.has(slot),
    get count() { return slots.size; },
    get referee() { return referee; },
    get units() { return units; },
    sideCounts, makeRoom, step, afterAuthority, hurt,
    /** HP a blast already took off `slot` (`room-hits.mjs` `applyBlast`): a
     *  bot is told, as `hurt` tells it of a round. */
    landed(slot, lost, attacker = null, at = null) {
      if (referee && slots.has(slot) && lost > 0) referee.damageLanded(slot, lost, attacker, at, { splash: true });
    },
    /** The HELLO's rows for the bots: slot, name, side, the mark. */
    rosterRows() {
      return [...slots].map(([slot, row]) => ({ slot, name: row.name, team: row.team, bot: true }));
    },
    /** What every client may know: the two settings and the caps in force. */
    publicSettings() {
      return { ...want(), botCap: enabled ? perRoomCap() : 0, botData: layerHasBotData(extras) };
    },
    /** A human's radio message, handed to the bots as `GameServer::
     *  radioMessage` hands it to the AI (0x0813a26a, `referee.radioMessage`). */
    onRadio(id, message) {
      if (referee && slots.size) referee.radioMessage(id, message);
    },
    /** A human's Use met a seat a bot holds (`playerRequestPlayerControlObject`). */
    requestSeat(team, holder) {
      return referee && slots.has(holder) ? referee.requestSeat(team, holder) : false;
    },
    /** The room is going (a level change, the registry's drop). */
    clear() {
      for (const slot of [...slots.keys()]) removeBot(slot);
    },
  };
}
