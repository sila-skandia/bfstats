// A room's host half: its settings (`room-settings.mjs`), its admin and the
// `admin.*` words, the votes (`room-votes.mjs`), the bans, the join gate
// (password, reserved slots, bans), the welcome lines, auto-balance, and the
// map list with its round count. `room.mjs` builds one per room and routes
// its join, leave, tick and the `vote` / `admin` action rows here.
//
// Retail, read from lnxded.static:
//
// * the join gate, `NetServer::handleConnectRequest` (0x08436909..): the
//   password must match the server's (`checkPassword` 0x08436630, an empty
//   server password passes anyone) or, with reserved slots, the reserved one
//   (`checkReservedPassword` 0x084366c0), else the connect is denied 0x1e
//   (0x08436a8d). A reserved-password joiner takes a reserved slot
//   (`+0xe0`, the free ones, decremented at 0x08436d27); anyone else must
//   fit under `maxPlayers` less the free reserved slots (0x08436a74..
//   0x08436a87), denied 2 (full, 0x08436aa8) when none is kept free and 0x1e
//   when one is;
// * the welcome lines, `GameServer::authentificationOk` 0x08139ad4..
//   0x08139b40: after the map list and the database, one `WelcomeMsgEvent`
//   (0x0811f8c0, NET-20) per `Setup::getServerWelcomeMessage(i)`
//   (0x080c7bb0), `i` under `Setup+0x318`;
// * a kick, `kickPlayer(int, bool)` 0x08148d40, queues the id; the queue's
//   drain `kickPlayers` 0x08148b20 says "Player %s was kicked from the
//   server." (0x086c06a0) to everyone as the server (`say(-1, ...)`,
//   vt+0x464) and drops the connection. `banPlayer(int, const string&)`
//   0x08148f60 adds the address to the ban list with its timeout word and
//   kicks; `admin.serverMessage` is `say(-1, text, false, true)`
//   (0x0813a090);
// * auto-balance, the tail of `killPlayer` 0x0814dc02..0x0814dc90: with
//   `autoBalanceTeam` (`+0x1d0`) on and the round not ended (status not 2,
//   not 5), a death whose sides differ by more than one moves the dead
//   player to `getTeamToAddPlayer(ratio1, ratio2)` (vt+0x60, the team
//   ratios `+0x2bc` / `+0x2c0`) through `setTeam` (vt+0x144);
// * the rounds, `gameStatusEndGame` 0x08152ca0: when the restart countdown
//   (`+0x21c`) is out, more than one round left (`+0x2f4`, set with
//   `+0x2f0` by `setNrOfRounds` 0x0813dc90) and no forced next level
//   (`+0x467`) restarts the map and counts one off (0x08153356..0x08153369);
//   otherwise the server loads `Setup::nextLevelInMaplist(true)`
//   (0x080bff80): the level `setNextLevel` named, else the entry after the
//   current one in the map list, the first after the last;
// * `changeMap(int)` 0x081496b0: the map list's entry by index,
//   `setNextLevel` then `runNextLevel` at once.
//
// A room's own, where it has no retail answer: bans are kept by player name
// and by the id the page sends with its join (a room sees no address behind
// the site's proxy), and the admin is the connection that made the room,
// known again after a level change by the key its HELLO carried.

import { randomBytes } from 'node:crypto';
import { MSG_CLOSED } from '../viewer/netcode.js';
import { teamToAddPlayer } from '../viewer/team-to-add.js';
import { encodeJsonMsg, eventRow } from './room-wire.mjs';
import {
  ROOM_SETTING_RANGES, cleanLine, cleanMapList, cleanPassword, friendlyFireOf,
  publicSettings, rulesOf, sanitizeSettings, WELCOME_MAX_LINES,
} from './room-settings.mjs';
import { createRoomVotes, defaultVoteSettings, VOTE_OPTION, VOTE_TYPE } from './room-votes.mjs';

/** A chat line's length on the wire (`admin.serverMessage`). */
const MESSAGE_MAX = 200;
const CLIENT_ID_OK = /^[A-Za-z0-9_-]{8,64}$/;

/** The integer words `admin.*` and `game.server*` set on a live room, by the
 *  key the page sends (`console-commands.js`). */
const LIVE_INT_KEYS = new Set(Object.keys(ROOM_SETTING_RANGES));

/**
 * @param {object} ctx
 * @param {object} ctx.room        the Room
 * @param {object} [ctx.settings]  a create row's settings, raw
 * @param {object} [ctx.base]      the server's own defaults under them
 * @param {(name) => boolean} [ctx.hasLevel]  the registry's level table
 * @param {(entry) => boolean} [ctx.changeLevel]  the registry's level swap:
 *                                 `{ level, mode }`, true when it was made
 * @param {object} [ctx.carry]     what a level change hands the next room:
 *                                 `{ settings, voteSettings, bans, adminKey }`
 */
export function createRoomHost(ctx) {
  const { room } = ctx;
  const hasLevel = ctx.hasLevel ?? (() => true);
  const settings = ctx.carry?.settings
    ?? { ...sanitizeSettings(ctx.settings, { hasLevel }), ...definedOnly(ctx.base, ctx.settings) };
  const voteSettings = ctx.carry?.voteSettings ?? defaultVoteSettings();
  /** key (`name:<lowercased>` or `id:<client id>`) -> { name, until }, where
   *  `until` is 'round' (a passed kick vote's "Round") or 'perm'. */
  const bans = ctx.carry?.bans ?? new Map();
  const adminKey = ctx.carry?.adminKey ?? randomBytes(12).toString('hex');
  /** Rounds left on this level (`GameServer+0x2f4`). */
  let roundsLeft = settings.numberOfRounds;
  /** `Setup::setNextLevel`'s entry, or null for the map list's own order. */
  let nextLevel = null;
  /** `+0x467`: the next level is forced (`admin.runNextLevel`). */
  let forceNext = false;
  /** The connection whose join made the room, until it has joined. */
  let creator = null;

  const nowS = () => room.now() / 1000;

  const votes = createRoomVotes({
    settings: voteSettings,
    now: nowS,
    players: () => room.players.values(),
    mapCount: () => mapList().length,
    onRow: row => sendVote(row),
    say,
    // `banPlayer(target, "Round")` (0x08149eda..0x08149f04).
    onKick: slot => kick(slot, { ban: 'round' }),
    onMap: index => changeMap(index),
  });

  /** A VoteEvent goes to everyone; the client shows a team kick only to the
   *  target's side (`GameClient::handleVoteEvent`), so the room sends it to
   *  that side alone. */
  function sendVote(row) {
    const bytes = encodeJsonMsg(eventRow('vote', room.tick, row));
    for (const connection of room.players.values()) {
      if (row.kind === VOTE_TYPE.teamKick && connection.team !== row.team) continue;
      connection.peer.send(bytes);
    }
  }

  /** A line from the server: to one slot (`sayClient`) or, with null, to
   *  everyone (`say(-1, ...)`). The page prints a `chat` row with no slot as
   *  the server's. */
  function say(slot, text) {
    const bytes = encodeJsonMsg(eventRow('chat', room.tick, { text: String(text) }));
    if (slot == null) {
      for (const connection of room.players.values()) connection.peer.send(bytes);
      return;
    }
    room.players.get(slot)?.peer.send(bytes);
  }

  /** The map list: the creator's, or the room's one level. */
  function mapList() {
    return settings.maps.length ? settings.maps : [{ level: room.level(), mode: room.mode() }];
  }
  const sameEntry = (a, b) => a && b && String(a.level).toLowerCase() === String(b.level).toLowerCase()
    && (a.mode == null || b.mode == null
      || String(a.mode).toLowerCase() === String(b.mode).toLowerCase());
  const currentEntry = () => ({ level: room.level(), mode: room.mode() });
  const mapIndex = () => mapList().findIndex(entry => sameEntry(entry, currentEntry()));

  /** `Setup::nextLevelInMaplist(true)`. */
  function nextInList() {
    if (nextLevel) return nextLevel;
    const list = mapList();
    const at = mapIndex();
    return list[(at + 1) % list.length] ?? list[0];
  }

  /** Load `entry`: another level or layer is the registry's swap; the level
   *  the room is on starts its rounds over in place. Returns whether the
   *  room was swapped (and is no longer the live one). */
  function loadLevel(entry) {
    nextLevel = null;
    forceNext = false;
    clearRoundBans();
    if (!entry || sameEntry(entry, currentEntry()) || !ctx.changeLevel) {
      roundsLeft = settings.numberOfRounds;
      const won = room.authority.round?.roundsWon;
      if (won) { won[1] = 0; won[2] = 0; }
      return false;
    }
    return ctx.changeLevel(entry) === true;
  }

  /** `changeMap(int)`: the list's entry, now. */
  function changeMap(index) {
    const entry = mapList()[index];
    if (!entry) return false;
    if (!loadLevel(entry)) room.authority.restart?.();
    return true;
  }

  function clearRoundBans() {
    for (const [key, ban] of bans) if (ban.until === 'round') bans.delete(key);
  }

  const banKeys = (name, id) => {
    const keys = [`name:${String(name ?? '').trim().toLowerCase()}`];
    if (typeof id === 'string' && CLIENT_ID_OK.test(id)) keys.push(`id:${id}`);
    return keys;
  };

  /** `kickPlayer` / `banPlayer` on a slot: the ban first, the closed row to
   *  the player, the slot out of the room, the socket closed, and the line
   *  `kickPlayers` says to everyone left. */
  function kick(slot, { ban = null } = {}) {
    const connection = room.players.get(slot);
    if (!connection) return false;
    const name = connection.name;
    if (ban) for (const key of banKeys(name, connection.clientId)) bans.set(key, { name, until: ban });
    connection.peer.send(encodeJsonMsg({ code: ban ? 'banned' : 'kicked' }, MSG_CLOSED));
    room.leave(connection);
    connection.peer.close(4001, ban ? 'banned' : 'kicked');
    say(null, `Player ${name} was kicked from the server.`);
    return true;
  }

  // --- the admin words -------------------------------------------------------

  const slotArg = value => {
    const n = Number(value);
    if (Number.isInteger(n) && room.players.has(n)) return n;
    const want = String(value ?? '').trim().toLowerCase();
    if (!want) return null;
    for (const [slot, c] of room.players) if (String(c.name).toLowerCase() === want) return slot;
    return null;
  };

  const entryArg = (value, mode) => {
    const n = Number(value);
    if (String(value ?? '').trim() !== '' && Number.isInteger(n)) return mapList()[n] ?? null;
    return cleanMapList([{ level: String(value ?? ''), mode: mode ?? null }], hasLevel)[0] ?? null;
  };

  /** One live setting (`admin.timeLimit`, `game.serverSoldierFriendlyFire`
   *  and the rest): kept, and handed to whoever plays it. */
  function setSetting(key, value) {
    const rules = room.authority.rules;
    const round = room.authority.round;
    if (LIVE_INT_KEYS.has(key)) {
      const [min, max] = ROOM_SETTING_RANGES[key];
      const n = Math.trunc(Number(value));
      if (!Number.isFinite(n)) return false;
      settings[key] = Math.min(max, Math.max(min, n));
      Object.assign(rules, rulesOf(settings));
      if (key === 'gameTime' && round) round.gameTime = settings.gameTime * 60;
      if (key === 'scoreLimit' && round) round.scoreLimit = settings.scoreLimit;
      // `setNrOfRounds` writes the count and the rounds left together.
      if (key === 'numberOfRounds') roundsLeft = settings.numberOfRounds;
      return true;
    }
    const bool = value === true || value === 1 || value === '1' || value === 'true';
    switch (key) {
      case 'friendlyFire': {
        for (const k of ['soldierFriendlyFire', 'vehicleFriendlyFire',
                         'soldierFriendlyFireOnSplash', 'vehicleFriendlyFireOnSplash']) setSetting(k, value);
        return true;
      }
      case 'password': settings.password = cleanPassword(String(value ?? '')); return true;
      case 'reservedPassword': settings.reservedPassword = cleanPassword(String(value ?? '')); return true;
      case 'autoBalance': settings.autoBalance = bool; rules.autoBalance = bool; return true;
      case 'tkPunishMode': rules.tkPunishMode = bool; return true;
      case 'nrOfTKToKick': {
        const n = Number(value);
        if (!Number.isFinite(n) || n < 0) return false;
        rules.nrOfTKToKick = n;
        return true;
      }
      case 'tkSpawnPenalty': {
        const n = Number(value);
        if (!Number.isFinite(n) || n < 0) return false;
        rules.tkSpawnPenalty = n;
        return true;
      }
      case 'enableMapVote': voteSettings.enabled[0] = bool; return true;
      case 'enableKickPlayerVote': voteSettings.enabled[1] = bool; return true;
      case 'enableKickTeamPlayerVote': voteSettings.enabled[2] = bool; return true;
      case 'voteMapMajority': case 'voteKickPlayerMajority': case 'voteKickTeamPlayerMajority': {
        const n = Number(value);
        if (!Number.isFinite(n) || n < 0 || n > 1) return false;
        voteSettings.majority[['voteMapMajority', 'voteKickPlayerMajority',
                               'voteKickTeamPlayerMajority'].indexOf(key)] = n;
        return true;
      }
      case 'votingTime': {
        const n = Number(value);
        if (!Number.isFinite(n) || n <= 0) return false;
        voteSettings.votingTime = n;
        return true;
      }
      case 'welcome': {
        // `game.setServerWelcomeMessage <id> <text>`.
        const id = Math.trunc(Number(value?.id));
        if (!Number.isInteger(id) || id < 0 || id >= WELCOME_MAX_LINES) return false;
        settings.welcome[id] = cleanLine(String(value?.text ?? ''));
        for (let i = 0; i < settings.welcome.length; i++) settings.welcome[i] ??= '';
        return true;
      }
      default: return false;
    }
  }

  /** An `admin` action row, from the room's admin alone; anyone else is told
   *  nothing happened, as a retail client without the remote-admin password
   *  is. Returns whether the word did something. */
  function onAdmin(connection, row) {
    const reply = text => say(connection.slot, text);
    if (!connection.admin) {
      reply('Admin: this room is not yours to administer.');
      return false;
    }
    const cmd = String(row?.cmd ?? '').toLowerCase();
    const args = Array.isArray(row?.args) ? row.args : [];
    switch (cmd) {
      case 'kickplayer': case 'kickplayerbyname': case 'banplayer': {
        const slot = slotArg(args[0]);
        if (slot == null) { reply('Admin: no such player.'); return false; }
        return kick(slot, { ban: cmd === 'banplayer' ? 'perm' : null });
      }
      case 'clearbanlist': bans.clear(); return true;
      case 'listbannedaddresses': {
        const names = [...new Set([...bans.values()].map(b => b.name))];
        reply(names.length ? `Banned: ${names.join(', ')}` : 'Banned: nobody');
        return true;
      }
      case 'changemap': {
        const entry = entryArg(args[0], typeof args[1] === 'string' ? args[1] : null);
        if (!entry) { reply('Admin: no such map.'); return false; }
        if (!loadLevel(entry)) room.authority.restart?.();
        return true;
      }
      case 'setnextlevel': {
        const entry = entryArg(args[0], typeof args[1] === 'string' ? args[1] : null);
        if (!entry) { reply('Admin: no such map.'); return false; }
        nextLevel = entry;
        return true;
      }
      case 'runnextlevel': {
        forceNext = true;
        if (!loadLevel(nextInList())) room.authority.restart?.();
        return true;
      }
      case 'restartmap': room.authority.restart?.(); return true;
      case 'servermessage': {
        const text = cleanLine(String(args.join(' ')), MESSAGE_MAX);
        if (!text) return false;
        say(null, text);
        return true;
      }
      case 'set': {
        const ok = setSetting(String(args[0] ?? ''), args[1]);
        if (!ok) reply('Admin: that setting was not taken.');
        else room.broadcastToAll(eventRow('settings', room.tick, { settings: publicSettings(settings) }));
        return ok;
      }
      default:
        reply('Admin: unknown word.');
        return false;
    }
  }

  /** A `vote` action row: `{ kind, target, option }` (`castVote`). */
  function onVote(connection, row) {
    const kind = row?.kind;
    const option = row?.option === VOTE_OPTION.no ? VOTE_OPTION.no : VOTE_OPTION.yes;
    return votes.cast(kind, connection.slot, row?.target, option);
  }

  return {
    settings,
    voteSettings,
    votes,
    bans,
    say,
    kick,
    onAdmin,
    onVote,
    mapList,
    mapIndex,
    get roundsLeft() { return roundsLeft; },
    /** The registry names the connection whose join row made the room. */
    setCreator(connection) { creator = connection; },

    /** The authority's rules from the settings. */
    rules: () => rulesOf(settings),
    /** The friendly-fire percentages `room-hits.mjs` prices with. */
    friendlyFire: () => friendlyFireOf(settings),

    /** The join gate (see the header). Returns the refusal's code, or null;
     *  marks the connection's admin, reserved slot and client id. */
    mayJoin(connection, { name, password = '', admin = null, id = null } = {}) {
      connection.admin = false;
      connection.reserved = false;
      connection.clientId = typeof id === 'string' && CLIENT_ID_OK.test(id) ? id : null;
      for (const key of banKeys(name, connection.clientId)) if (bans.has(key)) return 'banned';
      const given = typeof password === 'string' ? password : '';
      const pw = !settings.password || given === settings.password;
      const reservedOn = settings.numReservedSlots > 0 && !!settings.reservedPassword;
      const rs = reservedOn && given === settings.reservedPassword;
      // The creator set the password, and comes back after a level change
      // with the key their HELLO carried: neither is asked for it.
      const isAdmin = creator === connection || (typeof admin === 'string' && admin === adminKey);
      if (!isAdmin && (reservedOn ? !(pw || rs) : !pw)) return 'bad_password';
      let held = 0;
      for (const c of room.players.values()) if (c.reserved) held++;
      const free = reservedOn ? Math.max(0, settings.numReservedSlots - held) : 0;
      if (rs && free > 0) {
        if (room.players.size >= settings.maxPlayers) return 'room_full';
        connection.reserved = true;
      } else if (room.players.size + free >= settings.maxPlayers) {
        return free > 0 ? 'reserved_slots' : 'room_full';
      }
      // The creator, or the creator back after a level change.
      connection.admin = isAdmin;
      if (creator === connection) creator = null;
      return null;
    },

    /** What the HELLO adds for `connection`. */
    hello(connection) {
      const list = mapList();
      return {
        settings: publicSettings(settings),
        maps: list.map(entry => ({ level: entry.level, mode: entry.mode })),
        mapIndex: mapIndex(),
        admin: !!connection.admin,
        ...(connection.admin ? { adminKey } : {}),
        votes: [VOTE_TYPE.map, VOTE_TYPE.kick, VOTE_TYPE.teamKick]
          .map(type => votes.state(type, connection.team)).filter(Boolean),
        voteSettings: { enabled: [...voteSettings.enabled], votingTime: voteSettings.votingTime },
      };
    },

    /** The welcome lines, after the handshake (`WelcomeMsgEvent`). */
    welcome(connection) {
      settings.welcome.forEach((text, id) => {
        if (text) connection.peer.send(encodeJsonMsg(eventRow('welcome', room.tick, { id, text })));
      });
    },

    forget(slot) { votes.forget(slot); },

    /** Once a tick: the votes' clocks. */
    step() { votes.step(); },

    /** The dead player `slot` under auto-balance (`killPlayer`'s tail). */
    autoBalance(slot) {
      if (!settings.autoBalance) return false;
      const connection = room.players.get(slot);
      if (!connection) return false;
      let one = 0, two = 0;
      for (const c of room.players.values()) { if (c.team === 1) one++; else if (c.team === 2) two++; }
      if (Math.abs(one - two) <= 1) return false;
      const team = teamToAddPlayer(one, two, settings.axisTeamRatio, settings.alliedTeamRatio, room.random);
      if (team === connection.team) return false;
      connection.team = team;
      const player = room.world.player(slot);
      if (player) player.team = team;
      room.broadcast(eventRow('team', room.tick, { slot, team, autoBalance: true }), null);
      return true;
    },

    /** The restart countdown is out (`gameStatusEndGame`): true when the
     *  room went to another level instead of restarting this one. */
    roundsOver() {
      clearRoundBans();
      if (roundsLeft > 1 && !forceNext) {
        roundsLeft -= 1;
        return false;
      }
      return loadLevel(nextInList());
    },

    /** What a level change hands the room that replaces this one. */
    carry: () => ({ settings, voteSettings, bans, adminKey }),
  };
}

/** The keys of `base` the create row did not set itself: a server operator's
 *  own defaults (`RoomServerCore`'s `rules`) under a creator's settings. */
function definedOnly(base, raw) {
  const out = {};
  for (const [key, value] of Object.entries(base ?? {})) {
    if (raw && raw[key] != null) continue;
    if (key in ROOM_SETTING_RANGES && Number.isFinite(value)) out[key] = value;
  }
  return out;
}
