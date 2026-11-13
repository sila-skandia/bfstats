// A room's host settings: CREATE GAME's `game.server*` words as the room's
// creator sends them in the join row that makes the room, validated here and
// kept on the room (`room-registry.mjs` `createRoom`, `room.mjs` `settings`).
//
// The defaults are `Setup::initServerSettings`' (lnxded 0x080c09b0, ledger
// NET-21), which a server uses for every word its settings file leaves out:
// spawnTime 20 (0x080c09e6), spawnDelay 3 (0x080c09ed), gameStartDelay 20
// (0x080c09f4), roundStartDelay 10 (0x080c09fb), the friendly-fire and ticket
// percentages 100 (0x080c0a02..0x080c0a10), numberOfRounds 5 (0x080c09df),
// autoBalance 0 (0x080c0a51). The ranges are the CREATE GAME page's own edit
// boxes (`menu/CreateGameMenuPage1` and `Page2`, `main-menu-layout.json`):
// time limit 0..999 minutes, rounds 0..999, spawn time 0..999 s, start delay
// 1..999 s, tickets 10..1000 %, score limit 0..999, friendly fire 0..100 %,
// the team ratio 1..10 a side, the password 30 characters.
//
// A room's own limits, where it differs from a dedicated server: max players
// stops at the lobby's `MAX_PLAYERS` (netcode.js), the page's 2..64 does not
// apply; and the map list holds at most `MAP_LIST_MAX` levels.

import { MAX_PLAYERS } from '../viewer/netcode.js';

export const ROOM_SETTING_DEFAULTS = Object.freeze({
  maxPlayers: MAX_PLAYERS,
  password: '',
  /** `game.serverReservedPassword` / `serverNumReservedSlots` (no CREATE GAME
   *  row; `NetServer::setReservedPassword` 0x08434840 writes both). */
  reservedPassword: '',
  numReservedSlots: 0,
  /** `game.serverGameTime`, minutes; 0 is no limit. */
  gameTime: 0,
  numberOfRounds: 5,
  spawnTime: 20,
  spawnDelay: 3,
  gameStartDelay: 20,
  roundStartDelay: 10,
  /** `game.serverTicketRatio`, a percentage (TKT-1). */
  ticketRatio: 100,
  scoreLimit: 0,
  soldierFriendlyFire: 100,
  vehicleFriendlyFire: 100,
  soldierFriendlyFireOnSplash: 100,
  vehicleFriendlyFireOnSplash: 100,
  /** `game.serverAutoBalanceTeams`. */
  autoBalance: false,
  axisTeamRatio: 1,
  alliedTeamRatio: 1,
  /** The room's bots (`room-bots.mjs`, gap entry 13): `aiSettings.setMaxNBots`
   *  (64 in vanilla's `AIDefault.con`: fill the room) and CREATE GAME's
   *  co-op AI SKILL percentage (75 is `AISettings::reset`'s 0.75, AI-14). */
  numberOfBots: 64,
  coopAiSkill: 75,
  /** `game.setServerWelcomeMessage <id> <text>`: lines a joiner is sent. */
  welcome: [],
  /** The map list, `[{ level, mode }]`; empty is the room's own level. */
  maps: [],
});

/** [min, max] per integer word: the CREATE GAME edit boxes' own ranges. */
export const ROOM_SETTING_RANGES = Object.freeze({
  maxPlayers: [2, MAX_PLAYERS],
  numReservedSlots: [0, MAX_PLAYERS],
  gameTime: [0, 999],
  numberOfRounds: [0, 999],
  spawnTime: [0, 999],
  spawnDelay: [0, 127],
  gameStartDelay: [1, 999],
  roundStartDelay: [0, 999],
  ticketRatio: [10, 1000],
  scoreLimit: [0, 999],
  soldierFriendlyFire: [0, 100],
  vehicleFriendlyFire: [0, 100],
  soldierFriendlyFireOnSplash: [0, 100],
  vehicleFriendlyFireOnSplash: [0, 100],
  axisTeamRatio: [1, 10],
  alliedTeamRatio: [1, 10],
  numberOfBots: [0, 64],
  coopAiSkill: [25, 100],
});

/** `Host/Create/Password` holds 30 characters; `NetServer::setReservedPassword`
 *  refuses more than 32 (`cmpl $0x20` at 0x08434850). */
export const PASSWORD_MAX = 30;
/** A welcome line: `WelcomeMsgEvent`'s `char[64]` (NET-20). */
export const WELCOME_MAX_CHARS = 63;
export const WELCOME_MAX_LINES = 8;
export const MAP_LIST_MAX = 32;

const LEVEL_NAME_OK = /^[A-Za-z0-9_.-]{1,64}$/;
const MODE_NAME_OK = /^[A-Za-z0-9_-]{1,32}$/;

/** A password as the room keeps it: a string with no blank (`ERROR_PASSWORD`,
 *  "BLANK SPACE IS NOT PERMITTED IN PASSWORD!") and no control character, cut
 *  to the field's length; anything else is none. */
export function cleanPassword(value) {
  if (typeof value !== 'string') return '';
  // eslint-disable-next-line no-control-regex
  if (/[\s\x00-\x1f\x7f]/.test(value)) return '';
  return value.slice(0, PASSWORD_MAX);
}

/** One line of text a server sends (a welcome line, `admin.serverMessage`). */
export function cleanLine(value, max = WELCOME_MAX_CHARS) {
  if (typeof value !== 'string') return '';
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\x00-\x1f\x7f]/g, ' ').trim().slice(0, max);
}

function cleanInt(key, value, fallback) {
  const [min, max] = ROOM_SETTING_RANGES[key];
  const n = Math.trunc(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/** A map list as the room keeps it: each row a level the server has, on a
 *  named layer or the level's default. `hasLevel(name)` is the registry's
 *  table; rows it does not know are dropped. */
export function cleanMapList(value, hasLevel = () => true) {
  if (!Array.isArray(value)) return [];
  const out = [];
  for (const row of value) {
    const level = typeof row === 'string' ? row : row?.level;
    if (typeof level !== 'string' || !LEVEL_NAME_OK.test(level) || !hasLevel(level)) continue;
    const mode = typeof row?.mode === 'string' && MODE_NAME_OK.test(row.mode) ? row.mode : null;
    out.push({ level, mode });
    if (out.length >= MAP_LIST_MAX) break;
  }
  return out;
}

/**
 * The settings a create row asked for, over the defaults. Unknown keys are
 * dropped, numbers are truncated and clamped to their word's range, and a
 * value that is not one keeps the default. `friendlyFire` is CREATE GAME's
 * one FRIENDLY FIRE row, which writes all four percentages.
 */
export function sanitizeSettings(raw, { hasLevel = () => true } = {}) {
  const out = { ...ROOM_SETTING_DEFAULTS, welcome: [], maps: [] };
  if (!raw || typeof raw !== 'object') return out;
  if (raw.friendlyFire != null) {
    const ff = cleanInt('soldierFriendlyFire', raw.friendlyFire, 100);
    out.soldierFriendlyFire = out.vehicleFriendlyFire = ff;
    out.soldierFriendlyFireOnSplash = out.vehicleFriendlyFireOnSplash = ff;
  }
  for (const key of Object.keys(ROOM_SETTING_RANGES)) {
    if (raw[key] != null) out[key] = cleanInt(key, raw[key], out[key]);
  }
  out.password = cleanPassword(raw.password);
  out.reservedPassword = cleanPassword(raw.reservedPassword);
  if (!out.reservedPassword) out.numReservedSlots = 0;
  out.numReservedSlots = Math.min(out.numReservedSlots, out.maxPlayers);
  out.autoBalance = raw.autoBalance === true || raw.autoBalance === 1;
  if (Array.isArray(raw.welcome)) {
    out.welcome = raw.welcome.map(line => cleanLine(line)).filter(Boolean).slice(0, WELCOME_MAX_LINES);
  }
  out.maps = cleanMapList(raw.maps, hasLevel);
  return out;
}

/** The four friendly-fire percentages as `friendly-fire.js` `friendlyDamage`
 *  reads them (`FRIENDLY_FIRE_SHIPPED`'s shape). */
export function friendlyFireOf(settings) {
  return {
    soldier: settings.soldierFriendlyFire,
    vehicle: settings.vehicleFriendlyFire,
    soldierSplash: settings.soldierFriendlyFireOnSplash,
    vehicleSplash: settings.vehicleFriendlyFireOnSplash,
  };
}

/** The settings as the authority's rules take them (`authority.mjs`
 *  `ROOM_RULES`' keys and the round's). */
export function rulesOf(settings) {
  return {
    gameStartDelay: settings.gameStartDelay,
    roundStartDelay: settings.roundStartDelay,
    spawnTime: settings.spawnTime,
    spawnDelay: settings.spawnDelay,
    gameTime: settings.gameTime * 60,
    scoreLimit: settings.scoreLimit,
    ticketRatio: settings.ticketRatio,
    numberOfRounds: settings.numberOfRounds,
    autoBalance: settings.autoBalance,
  };
}

/** What every client may know of the settings (the HELLO's `settings`, the
 *  page's SERVER INFO): everything but the passwords. */
export function publicSettings(settings) {
  const { password, reservedPassword, ...rest } = settings;
  return { ...rest, password: !!password, reserved: settings.numReservedSlots > 0 };
}
