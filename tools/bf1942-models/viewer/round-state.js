/**
 * The round's score and its two ticket counters.
 *
 * What the engine pays for each thing a player does is
 * `Bf1942/Game/ScoreManagerSettings*.con` in the mod's `Game.rfa`, one file per
 * gameplay mode, read into the pack as `score-settings.json`
 * (`extract_score_settings.py`). Vanilla's three files and the `ScoreManager`
 * constructor's defaults for the keys they leave out are both below.
 *
 * The tickets are three mechanisms, all read out of the Linux server:
 *
 *  - the round starts each side at `Game.setNumberOfTickets` times the
 *    server's max players over 16, truncated (`gamaStatusFirstPreGame`,
 *    ledger TKT-1). The level's count, which `scene.json.tickets` carries, is
 *    written for a 16-player server: Wake co-op's 100 starts a 32-player
 *    server at 200 and an 8-player one at 50 (measured on the parity lab);
 *  - a death costs the dead player's team `setTicketLosePerDeath` tickets
 *    (`GameServer::killPlayer` reads the field, `TeamScore::subTicket` spends
 *    it; the constructor sets it to 1 and no shipped level declares the
 *    command);
 *  - and a team bleeds one ticket per `60 / (rate * maxPlayers / 16)` seconds,
 *    where `rate` is its own `Game.setTicketLostPerMin`
 *    (`scene.json.tickets.lossPerMin`), while the ENEMY's summed `areaValue`
 *    over the points it holds is greater than 99. The rate is scaled when the
 *    level's script runs (`setTicketLostPerMin`, TKT-4), so a round bleeds
 *    out in the same time on any size of server; only deaths cost more of a
 *    small server's tickets.
 *
 * `maxPlayers` is the slot count of the server the round is played on, which
 * `game.serverMaxPlayers` sets on a dedicated server (TKT-2). Which one a
 * viewer round stands for is the page's call (`map.html` `ROUND_MAX_PLAYERS`).
 *
 * That last number is the one worth stating plainly, because it is not a flag
 * count. `GameServer::gameStatusPlaying` sums `ControlPoint::getAreaValueTeam1`
 * / `getAreaValueTeam2` (each point's `ObjectTemplate.areaValue`, which
 * `scene.json.controlPoints[].areaValue` carries) over the points each side
 * holds and compares each sum with the literal 99. On the shipped levels the
 * weight of a whole map is around 100 to 180, so the rule reads as "you bleed
 * once the enemy holds nearly everything" — which on the assault maps is the
 * first frame of the round. Berlin is the example: the Germans start holding
 * the two open points (30 each) plus their own HQ (50), 110 in all, so the
 * Russians bleed 5 a minute from the start until the weight drops under 99.
 *
 * The round's end is the server's too (`features/round-end-winner-screen`,
 * ledger ROUND-1..ROUND-9). `GameServer::gameStatusPlaying` decides a winner
 * every tick: in Conquest and Co-op a side under one ticket loses (both at
 * once is a draw); past the time limit the larger share of its starting
 * tickets wins there, and the larger team score in CTF and TDM; and
 * `GameServer::handleScore` ends a CTF round the moment a side's flag
 * captures reach the score limit. The winner goes to
 * `ScoreManager::setWinner`, which also counts the round on that side's
 * rounds-won line, and the status to EndGame, where every score and every
 * bot stops. How decisively it was won is the victory type, from the margin
 * between the two sides' ticket shares against `game.setMinorVictory` and
 * `setMajorVictory`. A multiplayer server restarts the map
 * `setTimeBeforeRestartMap` seconds later (10 by default); a single-player
 * one waits for the debriefing's REPLAY or ABORT.
 *
 * ObjectiveMode (game play mode 5) is decided by its objectives
 * (`objectives.js`, ledger OBJ-1..OBJ-6), never by tickets (ROUND-2): a
 * Composite or a Timer that is done wins the round for its side, a total
 * victory. Its tickets are a scoreboard of the objectives (OBJ-5): the
 * defender starts on a flat 100 whatever the level sets, each side's real
 * count pays for its deaths only as `objectiveManager` says (an attacker's
 * by default, a defender's only with `defenderLoseTicketsOnDeath`), and what
 * the HUD shows is the real count scaled by how far the enemy's root
 * objective has got, `trunc(real * (1 - completion))`.
 *
 * Pure: no `three`, no DOM, no page. `tests/round_state_harness.mjs` drives it.
 */

/** What `ScoreManager::ScoreManager` (`0x08161440`) sets, for the keys a mod's
 *  settings file leaves out. A mod that ships no file at all gets these. */
export const SCORE_DEFAULTS = Object.freeze({
  kill: 3, death: -1, capture: 20, attack: 5, defence: 5, tk: -3,
  objective: 5, objectivetk: -15,
});

/** The enemy weight above which a side bleeds: `cmp [ebp-0x1dc],0x63`. */
export const BLEED_WEIGHT = 99;

/** Tickets a minute a side with no spawn groups bleeds at the end of a round
 *  (`GameServer+0x1ec`): `GameServer::init` writes 1000.0 raw (0x08131d34);
 *  only `game.setTicketLostAtEndPerMin` scales it by max players / 16
 *  (0x081537f0), and no shipped level declares it (ledger TKT-8). */
export const TICKETS_LOST_AT_END_PER_MIN = 1000;

/** `Game::getGamePlayMode` (`+0x10`): what `stringToGPM` makes of a mode's
 *  name (ledger RADIO-13). Instant Battle plays Conquest's rules on the
 *  level's `SinglePlayer<Side>.con` (the client's `setGamePlayMode(2)`,
 *  0x0044eb19). */
export const GAME_PLAY_MODE = Object.freeze({
  ctf: 1, conquest: 2, tdm: 3, coop: 4, objective: 5,
});

/** The game play mode a layer or game type name stands for: `Ctf` 1, `Tdm`
 *  3, `ObjectiveMode` 5, `CoOp` and its `SinglePlayer` layer 4, anything
 *  else Conquest's 2, which is `stringToGPM`'s own fallback. */
export function gamePlayModeOf(mode) {
  const name = String(mode ?? '').trim().toLowerCase();
  if (name === 'ctf') return GAME_PLAY_MODE.ctf;
  if (name === 'tdm') return GAME_PLAY_MODE.tdm;
  if (name === 'objectivemode' || name === 'objective') return GAME_PLAY_MODE.objective;
  if (name === 'coop' || name === 'singleplayer') return GAME_PLAY_MODE.coop;
  return GAME_PLAY_MODE.conquest;
}

/** Whether a mode runs the control-point bleed and weighs its time limit and
 *  victory type in ticket shares: the `mode == 2 || 4 || 5` block of
 *  `gameStatusPlaying` (0x08151bb5). */
export function ticketsDecide(gpm) {
  return gpm === GAME_PLAY_MODE.conquest || gpm === GAME_PLAY_MODE.coop
    || gpm === GAME_PLAY_MODE.objective;
}

/** Whether a side out of tickets ends the round: Conquest and Co-op only
 *  (`cmp eax,2` / `cmp eax,4` at 0x08151549..0x08151558, ledger ROUND-2).
 *  ObjectiveMode bleeds but ends when an objective's `TeamWinsAward` names a
 *  winner, which the viewer does not model. */
export function ticketsEnd(gpm) {
  return gpm === GAME_PLAY_MODE.conquest || gpm === GAME_PLAY_MODE.coop;
}

/** The medals `GameServer::giveMedal` (0x081533f0, ledger ROUND-9) hands out
 *  at the end of a round, in the order of `getPlayersSortedByScore`: the
 *  first player one gold (`BFPlayer+0xe8`), the second one silver (`+0xec`),
 *  the third one bronze (`+0xf0`). */
export const MEDALS = Object.freeze(['gold', 'silver', 'bronze']);

/** `ScoreManager::setVictoryType`'s values. `none` is what `reset` writes
 *  (0x08161bf0) and what the debriefing refuses to build on. */
export const VICTORY = Object.freeze({
  draw: 0, minor: 1, major: 2, total: 3, none: 4,
});

/** `game.setMinorVictory 0.40` / `setMajorVictory 0.80`, vanilla's
 *  `Bf1942/Game/Init.con`; no installed mod's `Game.rfa` sets its own. */
export const MINOR_VICTORY = 0.40;
export const MAJOR_VICTORY = 0.80;

/** Seconds from the end of a round to the next: `GameServer::init` writes
 *  10.0 to both restart timers (`+0x218`, `+0x21c`), and
 *  `setTimeBeforeRestartMap` (0x0813da60) clamps a server's own to 1..30. */
export const RESTART_DELAY = 10;

export function clampRestartDelay(value, fallback = RESTART_DELAY) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(30, Math.max(1, n));
}

/** The share of its starting tickets a side still has, as the time-limit
 *  and victory-type arithmetic takes it: `tickets / (count * ratio *
 *  maxPlayers * 0.0625)` over the RAW count (0x081517bc..0x081517e9), not the
 *  truncated start, so a full side reads a hair over 1 on an odd server. */
export function ticketShare(tickets, count, maxPlayers = TICKET_BASE_PLAYERS) {
  const whole = Number(count) * clampMaxPlayers(maxPlayers) * 0.0625;
  return whole > 0 ? Number(tickets) / whole : 0;
}

/**
 * How decisively `winner` won, from the two sides' ticket shares
 * (0x08151842..0x0815187c): the margin is the winner's share less the
 * loser's (0 when the loser is ahead), then 1 below `minor`, 2 from `minor`
 * up to below `major`, 3 from `major` on (`fucompp` with the threshold on
 * top: an equal margin reads as the larger class). A draw is 0.
 */
export function victoryTypeOf(winner, shares, minor = MINOR_VICTORY, major = MAJOR_VICTORY) {
  if (winner !== 1 && winner !== 2) return VICTORY.draw;
  const own = Number(shares?.[winner]) || 0;
  const other = Number(shares?.[winner === 1 ? 2 : 1]) || 0;
  const margin = own >= other ? own - other : 0;
  if (!(minor <= margin)) return VICTORY.minor;
  if (!(major <= margin)) return VICTORY.major;
  return VICTORY.total;
}

/** `ScoreMsg`, as `GameServer::handleScore` (0x0814ac90) logs it and
 *  `ScoreManager::scoreEvent` (0x081617c0) pays it: 0 FlagCapture pays the
 *  table's `capture`, 1 Attack its `attack`, 2 Defence its `defence`. A
 *  Conquest point taken is an Attack (`ControlPoint::handleFrameUpdate`,
 *  `push 0x1` at 0x08283d5c), a CTF flag picked up is too, a flag brought
 *  home is a FlagCapture and one returned is a Defence (`Flag::handleDrop`,
 *  `Flag::handleUpdate`). */
export const SCORE_MSG = Object.freeze({
  flagCapture: 0, attack: 1, defence: 2, kill: 3, death: 4, deathNoMsg: 5,
  tk: 6, spawned: 7, objective: 8, objectiveTk: 9,
});

/** The server size the level's ticket numbers are written for: both halves of
 *  the arithmetic multiply by `maxPlayers * 0.0625`. It is also what
 *  `GameServer::init` (0x08131cd0) sets before a host's own count replaces it,
 *  so a round that names no server keeps the level's numbers as they are. */
export const TICKET_BASE_PLAYERS = 16;

/** The engine's ceiling on max players: `setMaxNrOfPlayers` (0x08153790) and
 *  vanilla's `game.serverMaxPlayers` both clamp to 64. */
export const MAX_PLAYERS_LIMIT = 64;

/** A player count as the engine holds it: a whole number from 1 to 64. Anything
 *  that is not a positive number answers `fallback`. */
export function clampMaxPlayers(value, fallback = TICKET_BASE_PLAYERS) {
  const n = Math.trunc(Number(value));
  if (!(n > 0)) return fallback;
  return Math.min(MAX_PLAYERS_LIMIT, n);
}

/**
 * The players a round's STARTING tickets are scaled by. A level's mode script
 * may set its own with `game.maxNrOfPlayers` (`scene.json.tickets.maxPlayers`:
 * Kasserine Pass co-op's 18), which replaces the server's count before the
 * round starts. Every shipped script sets it after its bleed lines, so the
 * bleed keeps the server's count (`bleedInterval`).
 */
export function roundPlayers(maxPlayers, tickets = null) {
  const server = clampMaxPlayers(maxPlayers);
  return clampMaxPlayers(tickets?.maxPlayers, server);
}

/**
 * A side's starting tickets: `trunc(count * maxPlayers * 0.0625)`, the
 * truncating `fistp` of `gamaStatusFirstPreGame` (0x08150710). The engine also
 * multiplies by the ticket ratio (`game.serverTicketRatio / 100`), which the
 * viewer has no setting for; at 100 it is 1.
 */
export function startingTickets(count, maxPlayers = TICKET_BASE_PLAYERS) {
  const n = Number(count);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.trunc(n * clampMaxPlayers(maxPlayers) * 0.0625);
}

/** Seconds between a bleeding side's tickets: `60 / (rate * maxPlayers *
 *  0.0625)`, the countdown `setTicketLostPerMin` (0x08153820) seeds.
 *  `Infinity` when the level declared no rate for the side. */
export function bleedInterval(rate, maxPlayers = TICKET_BASE_PLAYERS) {
  const perMinute = Number(rate) * clampMaxPlayers(maxPlayers) * 0.0625;
  return perMinute > 0 ? 60 / perMinute : Infinity;
}

/**
 * A level's tickets as a round on a `maxPlayers` server starts them: the two
 * counts scaled for the round start and the two rates for the bleed. The rest
 * of the object is copied, and the copy is fresh, so a caller that spends from
 * it (the room server's authority) never writes into the level's own data.
 */
export function scaleTickets(tickets, maxPlayers = TICKET_BASE_PLAYERS) {
  if (!tickets || typeof tickets !== 'object') return tickets ?? null;
  const players = roundPlayers(maxPlayers, tickets);
  const server = clampMaxPlayers(maxPlayers);
  const out = { ...tickets };
  for (const key of ['team1', 'team2']) {
    if (tickets[key] != null) out[key] = startingTickets(tickets[key], players);
  }
  if (tickets.lossPerMin && typeof tickets.lossPerMin === 'object') {
    out.lossPerMin = { ...tickets.lossPerMin };
    for (const key of ['team1', 'team2']) {
      const rate = Number(tickets.lossPerMin[key]);
      if (Number.isFinite(rate)) out.lossPerMin[key] = rate * server * 0.0625;
    }
  }
  return out;
}

/** The suffix the settings file for a gameplay mode carries: `Ctf` ->
 *  `ScoreManagerSettingsCtf.con`. A mode with no file of its own uses the base
 *  one, which is what `Conquest`, `ObjectiveMode` and `SinglePlayer` do in
 *  vanilla. */
export function scoreSettingsFile(mode) {
  return `scoremanagersettings${mode || ''}.con`.toLowerCase();
}

/** The score table for a mode: the mode's own file over the base file over the
 *  constructor's defaults.
 *
 *  `settings` is the pack's `score-settings.json` (or null when the pack
 *  carries none, which is the mod packs' case: every shipped mod's table is
 *  vanilla's, so `extract_hud_mods.py` writes them no file and the pack
 *  resolver falls back here). */
export function scoreTable(settings, mode = '') {
  const files = settings?.files ?? {};
  const named = (want) => {
    for (const [name, values] of Object.entries(files)) {
      if (name.toLowerCase() === want && values && typeof values === 'object') return values;
    }
    return null;
  };
  const table = { ...SCORE_DEFAULTS };
  for (const source of [named('scoremanagersettings.con'), named(scoreSettingsFile(mode))]) {
    if (!source) continue;
    for (const [key, value] of Object.entries(source)) {
      const n = Number(value);
      if (Number.isFinite(n)) table[String(key).toLowerCase()] = n;
    }
  }
  return table;
}

/** The weight each side holds, from a list of `{ team, areaValue }` control
 *  points. A neutral point (team 0, or no team) counts for nobody, which is
 *  what the engine's `getAreaValueTeam1/2` pair does with an unowned point. */
export function holdWeight(points) {
  const held = { 1: 0, 2: 0 };
  for (const point of points ?? []) {
    const team = point?.team;
    if (team !== 1 && team !== 2) continue;
    const value = Number(point.areaValue);
    if (Number.isFinite(value)) held[team] += value;
  }
  return held;
}

/**
 * The live round. `options`:
 *
 *  - `settings`  the pack's `score-settings.json`, or a function answering it
 *                (the page's pack lands after the level does);
 *  - `mode`      the level's gameplay mode, or a function answering it, for
 *                the table above and for which rules end the round
 *                (`gamePlayModeOf`);
 *  - `tickets`   `{ team1, team2 }`, the level's counts (`scene.json.tickets`,
 *                with its `maxPlayers` when the level's script sets one);
 *  - `rates`     `{ team1, team2 }`, `setTicketLostPerMin` per side;
 *  - `maxPlayers` the server's slot count; both the counts and the rates are
 *                scaled by it over 16, so the default 16 plays them as given;
 *  - `ticketLosePerDeath`  the engine's default 1, or a level's own command;
 *  - `scoreLimit` `game.serverScoreLimit`: flag captures in CTF, team score in
 *                TDM; 0, the shipped `ServerSettings.con`, is no limit;
 *  - `gameTime`  the round's time limit in seconds (`game.serverGameTime` is
 *                minutes; `Setup::startHostGame` multiplies by 60 before
 *                `setGameInfo`); 0 is none, the shipped value;
 *  - `minorVictory` / `majorVictory`  the victory-type thresholds;
 *  - `restartDelay` seconds from EndGame to the restart on a multiplayer
 *                server; `singlePlayer` true keeps the round in EndGame until
 *                the page restarts it, as `gameStatusEndGame` does with
 *                `Setup+0x15c` (the `game.gameMode` word) at 0;
 *  - `atEndRate` tickets a minute a side with no spawn groups bleeds at the
 *                end of a round (`TICKETS_LOST_AT_END_PER_MIN`);
 *  - `objectives` an ObjectiveMode layer's live objectives
 *                (`objectives.js` `createObjectives`), or null. Read only
 *                while the mode is ObjectiveMode: its defender, its death
 *                rule and its roots' completion drive the tickets there.
 *
 * `counts` is keyed by player id: the page's local player, or a bot's. In a
 * room the page builds none: the server owns the round there, and its
 * authority (`server/authority.mjs`) plays this same one for the tickets.
 */
export function createRoundState({
  settings = null, mode = '', tickets = null, rates = null,
  maxPlayers = TICKET_BASE_PLAYERS, ticketLosePerDeath = 1,
  scoreLimit = 0, gameTime = 0,
  minorVictory = MINOR_VICTORY, majorVictory = MAJOR_VICTORY,
  restartDelay = RESTART_DELAY, singlePlayer = false, objectives = null,
  atEndRate = TICKETS_LOST_AT_END_PER_MIN,
} = {}) {
  const readSettings = typeof settings === 'function' ? settings : () => settings;
  const readMode = typeof mode === 'function' ? mode : () => mode;
  const serverPlayers = clampMaxPlayers(maxPlayers);
  const startPlayers = roundPlayers(serverPlayers, tickets);
  const counts = { 1: Number(tickets?.team1), 2: Number(tickets?.team2) };
  const round = {
    /** Team 1 is Axis and team 2 Allied, the reading the rest of the viewer
     *  uses. Both are whole tickets. */
    tickets: {
      1: startingTickets(tickets?.team1, startPlayers),
      2: startingTickets(tickets?.team2, startPlayers),
    },
    /** The server's slot count, and the count the starting tickets were
     *  scaled by (they differ only where the level's script sets its own). */
    maxPlayers: serverPlayers,
    startPlayers,
    /** One tally per player, created on first use. */
    counts: new Map(),
    /** Each side's `TeamScore`: the round's summed points (`+0x20`, what the
     *  time limit weighs in CTF and TDM) and the counters `scoreEvent` keeps
     *  beside them, flag captures (`+8`, what the CTF counter shows and the
     *  score limit reads) among them. */
    teams: { 1: emptyTeamScore(), 2: emptyTeamScore() },
    /** Rounds each side has won on this server (`setWinner` adds one at
     *  `ScoreManager + team * 0x50 + 0x5c`, which `reset` never clears): the
     *  score board's `Scoreboard/AxisRoundWon` and `AlliedRoundWon`. */
    roundsWon: { 1: 0, 2: 0 },
    /** Seconds each side still owes before its next ticket. */
    countdowns: { 1: 0, 2: 0 },
    /** Whether each side's bleed is running this frame, for the readouts. */
    bleeding: { 1: false, 2: false },
    /** The weight each side held on the last `tick`, for the readouts. */
    held: { 1: 0, 2: 0 },
    lossPerDeath: Number(ticketLosePerDeath) || 0,
    scoreLimit: Math.max(0, Math.trunc(Number(scoreLimit) || 0)),
    gameTime: Math.max(0, Number(gameTime) || 0),
    minorVictory: Number.isFinite(Number(minorVictory)) ? Number(minorVictory) : MINOR_VICTORY,
    majorVictory: Number.isFinite(Number(majorVictory)) ? Number(majorVictory) : MAJOR_VICTORY,
    restartDelay: clampRestartDelay(restartDelay),
    singlePlayer: !!singlePlayer,
    /** 'playing' or 'endGame' (`Game+0x58`: 1 or 2). */
    status: 'playing',
    /** Seconds the round has been playing, for the time limit. */
    clock: 0,
    /** 1, 2, 0 for a draw; null while the round plays. */
    winner: null,
    /** `VICTORY`; `none` until the round ends. */
    victoryType: VICTORY.none,
    /** Why it ended: 'tickets', 'time' or 'score'. */
    endReason: null,
    /** Seconds left before a multiplayer server restarts the map; Infinity on
     *  a single-player one and while the round plays. */
    restartIn: Infinity,
    /** How many times the round has been restarted on this level. */
    restarts: 0,
    /** A side at zero is out of the round; the engine stops the bleed there and
     *  so does this. True from the end of the round on (`status` EndGame). */
    over: false,
    /** ObjectiveMode's real counts (`dice::bf::normalTicketCount`, OBJ-5):
     *  what the deaths and the bleed spend, while `tickets` is what the HUD
     *  shows. Null in every other mode, where the two are one. */
    real: null,
    /** The layer's objectives, when it is ObjectiveMode's. */
    objectives,
  };

  function emptyTeamScore() {
    return { score: 0, kills: 0, deaths: 0, captures: 0, attacks: 0, defences: 0, teamKills: 0 };
  }

  /** The score table, resolved on read so that a settings file arriving after
   *  the level (the pack is fetched in parallel with it) still counts: the
   *  page hands in a function, and every award after the fetch uses the real
   *  numbers. Memoised on what it was resolved from, since `pay` reads it on
   *  every award. */
  let tableSource = null, tableMode = null, table = scoreTable(null, '');
  Object.defineProperty(round, 'table', {
    get() {
      const source = readSettings();
      const wanted = readMode() || '';
      if (source !== tableSource || wanted !== tableMode) {
        tableSource = source;
        tableMode = wanted;
        table = scoreTable(source, wanted);
      }
      return table;
    },
  });
  /** The round's `Game::getGamePlayMode`, read live like the table. */
  Object.defineProperty(round, 'gamePlayMode', {
    get() { return gamePlayModeOf(readMode()); },
  });

  /** Seconds between tickets while a side's bleed runs, `Infinity` when the
   *  level declared no rate for it. */
  const intervals = { 1: Infinity, 2: Infinity };
  for (const team of [1, 2]) {
    const rate = Number(team === 1 ? rates?.team1 : rates?.team2);
    // The engine builds the countdown as 60 / (maxPlayers * 0.0625 * rate)
    // when the level's script runs. `GameServer::init` writes 16 there, but a
    // host's `setGameInfo` has replaced it with the server's own count by then
    // (TKT-2, TKT-4), and a script's later `game.maxNrOfPlayers` does not
    // reach it. A rate of zero means the level declared no bleed for that
    // side, and an infinite interval is exactly "never".
    intervals[team] = bleedInterval(rate, serverPlayers);
    round.countdowns[team] = intervals[team];
  }

  /** The at-end rate's interval (`60 / +0x1ec`). */
  const atEndInterval = 60 / (Number(atEndRate) > 0 ? Number(atEndRate) : TICKETS_LOST_AT_END_PER_MIN);

  /**
   * The four flags `gameStatusPlaying` sets for the end of a round (TKT-5):
   * "no live player" starts 1 for both sides and is cleared, at the first
   * living player of a side, only on a frame where some side holds no spawn
   * group; "nowhere to spawn" is read only for a side that holds none.
   */
  function endOfRoundFlags(sides) {
    const noGroups = { 1: false, 2: false };
    const noLive = { 1: true, 2: true };
    const cantSpawn = { 1: false, 2: false };
    if (!sides) return { any: false, noGroups, noLive, cantSpawn };
    for (const team of [1, 2]) noGroups[team] = Number(sides[team]?.groups) === 0;
    const any = noGroups[1] || noGroups[2];
    if (any) {
      for (const team of [1, 2]) {
        noLive[team] = !sides[team]?.alive;
        cantSpawn[team] = noGroups[team] && !sides[team]?.canGet;
      }
    }
    return { any, noGroups, noLive, cantSpawn };
  }

  /** A player's tally, created empty on first use. */
  function tally(playerId) {
    let row = round.counts.get(playerId);
    if (!row) {
      row = {
        playerId, score: 0, kills: 0, deaths: 0, suicides: 0, captures: 0,
        teamKills: 0, attacks: 0, defences: 0, flags: 0, objectives: 0,
        objectiveTks: 0, team: 0,
      };
      round.counts.set(playerId, row);
    }
    return row;
  }

  const playing = () => round.status === 'playing';

  /** The live objectives, while the round is ObjectiveMode's. */
  const objectiveMode = () => round.gamePlayMode === GAME_PLAY_MODE.objective
    && !!round.objectives;

  /**
   * ObjectiveMode's start (OBJ-5): `gamaStatusFirstPreGame` (0x08150710)
   * sets the defender's tickets to a flat 100 after the level's own counts
   * (`push 0x64` at 0x08150885), and keeps both as the real counts. Run at
   * the round's start and again after each restart, which goes back through
   * the pre-game state (`resetTimers` 0x08157790 writes status 3).
   */
  function objectiveStart() {
    if (!objectiveMode()) { round.real = null; return; }
    const defender = Number(round.objectives.defender);
    if (defender === 1 || defender === 2) round.tickets[defender] = 100;
    round.real = { 1: round.tickets[1], 2: round.tickets[2] };
    showObjectiveTickets();
  }

  /** What the HUD shows of the real counts (0x08151f56..0x0815206c): each
   *  side's count times one less the completion of the OTHER side's root
   *  objective, truncated (`fistp` under the truncating control word). */
  function showObjectiveTickets() {
    if (!round.real) return;
    const objectives = round.objectives;
    for (const team of [1, 2]) {
      const enemy = team === 1 ? 2 : 1;
      const done = Number(objectives?.rootCompletion?.(enemy)) || 0;
      round.tickets[team] = Math.max(0, Math.trunc(round.real[team] * (1 - done)));
    }
  }

  /** Whether a death costs its side a ticket. Everywhere but ObjectiveMode it
   *  does; there `killPlayer` (0x0814ddd0) spends a defender's only with
   *  `defenderLoseTicketsOnDeath` (`objectiveManager+0x28`, off by default)
   *  and anyone else's only with `attackerLoseTicketsOnDeath` (`+0x29`, on). */
  function deathCosts(team) {
    if (!objectiveMode()) return true;
    const objectives = round.objectives;
    return team === Number(objectives.defender)
      ? !!objectives.defenderLoseTicketsOnDeath
      : objectives.attackerLoseTicketsOnDeath !== false;
  }

  /** Pay `points` into a player's tally. `key` is a table key. `team` is the
   *  player's side, when the caller knows it: the points go on that side's
   *  `TeamScore` too (`scoreEvent` adds them at `team * 0x50 + 0x30`).
   *  Nothing is paid once the round has ended: `scoreEvent` returns at once
   *  while the status is EndGame (0x081617e2). */
  function pay(playerId, key, field, points = 1, team = 0) {
    if (!playing()) return tally(playerId);
    const row = tally(playerId);
    if (team === 1 || team === 2) row.team = team;
    row[key] += points;
    const value = round.table[field] ?? 0;
    row.score += value;
    const side = row.team === 1 || row.team === 2 ? round.teams[row.team] : null;
    if (side) {
      side.score += value;
      if (key in side) side[key] += points;
    }
    return row;
  }

  /** Take tickets off a team, never below zero. The round is not decided
   *  here: `killPlayer` spends outside the status loop, and the next
   *  `gameStatusPlaying` pass (`tick`) reads the counts, after its own bleed
   *  has run for both sides, which is what makes two sides out on one tick a
   *  draw rather than a win for whichever bled second. */
  function spend(team, count) {
    if (team !== 1 && team !== 2 || !(count > 0)) return 0;
    // ObjectiveMode spends the real counts; the HUD's follow on the next tick.
    const counts = round.real ?? round.tickets;
    const before = counts[team];
    counts[team] = Math.max(0, before - count);
    return before - counts[team];
  }

  /** A death, whoever caused it: the dead player's tally and his team's
   *  tickets. `suicide` also counts on his own line. */
  function died(playerId, team, suicide = false) {
    if (playerId == null) return;
    pay(playerId, 'deaths', 'death', 1, team);
    if (suicide && playing()) tally(playerId).suicides += 1;
    if (playing() && deathCosts(team)) spend(team, round.lossPerDeath);
  }

  /** One player killed another. Same team is a team kill: the killer pays the
   *  table's `tk` instead of `kill`, and the victim's death costs the same
   *  tickets either way. */
  function kill({ killer = null, killerTeam = 0, victim = null, victimTeam = 0 }) {
    if (killer == null || killer === victim) return died(victim, victimTeam, true);
    const friendly = killerTeam !== 0 && killerTeam === victimTeam;
    pay(killer, friendly ? 'teamKills' : 'kills', friendly ? 'tk' : 'kill', 1, killerTeam);
    died(victim, victimTeam, false);
  }

  /** A player died with nobody to blame. */
  function suicide({ player = null, team = 0 }) {
    died(player, team, true);
  }

  /** A player was inside a point of his own team when it turned. The engine
   *  scores it as an Attack, the table's `attack` (`SCORE_MSG`), not its
   *  `capture`, which is the CTF flag's; `captures` still counts the point
   *  on his line. */
  function capture({ player = null, team = 0 } = {}) {
    if (player == null || !playing()) return;
    pay(player, 'captures', 'attack', 1, team);
    tally(player).attacks += 1;
    if (round.teams[tally(player).team]) round.teams[tally(player).team].attacks += 1;
  }

  /**
   * A CTF score (`ctf.js`): `msg` is `SCORE_MSG.flagCapture` (a flag brought
   * home: the table's `capture`, one on the side's flag captures), `attack`
   * (the enemy flag picked up) or `defence` (the own flag returned). Checks
   * the score limit after paying, as `handleScore` does: CTF on flag
   * captures, TDM on team score, team 1 first.
   */
  function flagScore({ player = null, team = 0, msg = SCORE_MSG.flagCapture } = {}) {
    if (player == null || !playing()) return;
    // `pay` counts a key the side's TeamScore shares (`attacks`, `defences`)
    // on the side as well; the flag captures are the side's `captures`
    // (`TeamScore+8`, CTF-6) under the player's own `flags`.
    if (msg === SCORE_MSG.flagCapture) {
      pay(player, 'flags', 'capture', 1, team);
      if (round.teams[team]) round.teams[team].captures += 1;
    } else if (msg === SCORE_MSG.attack) {
      pay(player, 'attacks', 'attack', 1, team);
    } else if (msg === SCORE_MSG.defence) {
      pay(player, 'defences', 'defence', 1, team);
    }
    checkScoreLimit();
  }

  /** `handleScore`'s tail (0x0814ad35..0x0814adf0): with a score limit set,
   *  CTF ends on a side's flag captures (`TeamScore+8`, unsigned compare) and
   *  TDM on its team score (`+0x20`); team 1 is asked first; victory type 1. */
  function checkScoreLimit() {
    if (!playing() || !(round.scoreLimit > 0)) return;
    const gpm = round.gamePlayMode;
    let key = null;
    if (gpm === GAME_PLAY_MODE.ctf) key = 'captures';
    else if (gpm === GAME_PLAY_MODE.tdm) key = 'score';
    if (!key) return;
    if (round.teams[1][key] >= round.scoreLimit) endRound(1, VICTORY.minor, 'score');
    else if (round.teams[2][key] >= round.scoreLimit) endRound(2, VICTORY.minor, 'score');
  }

  /**
   * An objective's pay (`objectives.js`, OBJ-3): `kind` 'objective' is
   * `ScoreMsg` 8, the table's `objective`, for a destroyer of the
   * objective's own side; 'objectiveTk' is 9, its `objectiveTK`, for anyone
   * else.
   */
  function objectiveScore({ player = null, team = 0, kind = 'objective' } = {}) {
    if (player == null || !playing()) return;
    if (kind === 'objectiveTk') pay(player, 'objectiveTks', 'objectivetk', 1, team);
    else pay(player, 'objectives', 'objective', 1, team);
  }

  /** `TeamWinsAward::give` (0x08310c20): the objective's side wins, a total
   *  victory, and the status goes to EndGame. */
  function objectiveWin(team) {
    if (team !== 1 && team !== 2) return;
    endRound(team, VICTORY.total, 'objective');
  }

  /** Each side's share of its starting tickets (`ticketShare`). ObjectiveMode
   *  weighs its real counts: the time limit is tested after they are put back
   *  and before the HUD's are made (0x081514c6, 0x0815155e). */
  function shares() {
    const live = round.real ?? round.tickets;
    return {
      1: ticketShare(live[1], counts[1], startPlayers),
      2: ticketShare(live[2], counts[2], startPlayers),
    };
  }

  /** The ticket law of `gameStatusPlaying` (0x08151549..0x0815155e,
   *  0x08151b24), for the modes that end on tickets (`ticketsEnd`: Conquest
   *  and Co-op, ROUND-2): a side under one ticket loses, both at once is a
   *  draw. */
  function decideOnTickets() {
    if (!playing() || !ticketsEnd(round.gamePlayMode)) return;
    const out1 = round.tickets[1] < 1;
    const out2 = round.tickets[2] < 1;
    if (!out1 && !out2) return;
    const winner = out1 && out2 ? 0 : (out1 ? 2 : 1);
    endRound(winner, null, 'tickets');
  }

  /** The time limit (0x0815155e..0x08151a8f): the larger ticket share wins in
   *  the ticket modes, the larger team score in CTF and TDM; equal is a draw. */
  function decideOnTime() {
    if (!playing() || !(round.gameTime > 0) || !(round.clock > round.gameTime)) return;
    if (ticketsDecide(round.gamePlayMode)) {
      const s = shares();
      const winner = s[1] > s[2] ? 1 : (s[2] > s[1] ? 2 : 0);
      endRound(winner, null, 'time');
      return;
    }
    const a = round.teams[1].score, b = round.teams[2].score;
    endRound(a > b ? 1 : (b > a ? 2 : 0), null, 'time');
  }

  /**
   * The round is over: `setWinner`, then `setGameStatus(EndGame)`, then the
   * victory type. In the ticket modes a winner's type is his margin in ticket
   * shares (`victoryTypeOf`); CTF and TDM write 1, and a draw 0, in every
   * mode. `type` forces one (the score limit's 1).
   */
  function endRound(winner, type = null, reason = null) {
    if (!playing()) return;
    round.winner = winner;
    if (winner === 1 || winner === 2) round.roundsWon[winner] += 1;
    round.status = 'endGame';
    round.over = true;
    round.endReason = reason;
    if (type != null) {
      round.victoryType = type;
    } else if (winner !== 1 && winner !== 2) {
      round.victoryType = VICTORY.draw;
    } else if (ticketsDecide(round.gamePlayMode)) {
      round.victoryType = victoryTypeOf(winner, shares(), round.minorVictory, round.majorVictory);
    } else {
      round.victoryType = VICTORY.minor;
    }
    for (const team of [1, 2]) round.bleeding[team] = false;
    round.restartIn = round.singlePlayer ? Infinity : round.restartDelay;
  }

  /**
   * One frame of the bleed. `dt` is seconds and `points` the control points as
   * `{ team, areaValue }` (the page's `extras.controlPoints`, whose `team`
   * `hoistCaptureFlag` keeps in step with the world's flags).
   *
   * Returns `{ 1, 2 }`, the tickets each side lost this frame. Both teams can
   * bleed in the same frame on a level whose weight sums are both over 99,
   * which no shipped level reaches but the arithmetic allows.
   *
   * The countdown runs in real time, the engine's rule while both sides have
   * spawn groups, which is all of normal play, and a shut gate refills it, so
   * each bleed's first ticket comes a whole interval after it starts (TKT-4).
   *
   * `sides`, when the page passes it, is what `gameStatusPlaying` counts for
   * the end of a round (TKT-5, TKT-8): `{ 1: { groups, canGet, alive }, 2 }`,
   * the spawn groups the side holds that still have a point, whether any other
   * side's group with a point could become its own (`groupEnableToChangeTeam`
   * set), and whether it has a living player. While both sides hold a group
   * nothing changes. Once one holds none, the two flags are read: that side,
   * with nobody alive or nowhere to spawn, bleeds whatever the weights, at the
   * at-end rate (`TICKETS_LOST_AT_END_PER_MIN`); otherwise, as the other side
   * does while it has a living player, its countdown runs at the enemy's
   * weight / 100 a second instead of one, still only past 99. Without `sides`
   * (the runner, an old caller) the round plays normal play's rule only.
   *
   * CTF and TDM have no bleed (the weight block runs for modes 2, 4 and 5
   * only). After the bleed the round is decided on tickets and on the time
   * limit; once it is over, only the restart countdown runs.
   */
  function tick(dt, points, sides = null) {
    const held = holdWeight(points);
    round.held = held;
    const lost = { 1: 0, 2: 0 };
    if (!(dt > 0)) return lost;
    if (!playing()) {
      if (Number.isFinite(round.restartIn)) round.restartIn = Math.max(0, round.restartIn - dt);
      return lost;
    }
    round.clock += dt;
    // ObjectiveMode's objectives run their frame while the round plays
    // (`Objective::handleUpdate` returns unless the status is 1); one done
    // may end the round here, and nothing below runs once it has.
    if (objectiveMode()) round.objectives.tick?.(dt);
    if (!playing()) return lost;
    const bleeds = ticketsDecide(round.gamePlayMode);
    const live = round.real ?? round.tickets;
    const end = endOfRoundFlags(sides);
    round.endOfRound = end.any ? end : null;
    for (const team of [1, 2]) {
      const enemy = team === 1 ? 2 : 1;
      // 0x08151c98..0x08151d05 (team 2), 0x08151e22..0x08151e45 (team 1).
      const stranded = end.noGroups[team] && (end.noLive[team] || end.cantSpawn[team]);
      const gate = stranded || held[enemy] > BLEED_WEIGHT;
      const running = bleeds && playing() && gate
        && Number.isFinite(intervals[team]) && live[team] > 0;
      round.bleeding[team] = running;
      if (!running) {
        // The engine writes `60 / rate` back on every frame the gate is shut
        // (team 1 `0x08152100`, team 2 `0x0815218c`; ledger TKT-4): a bleed
        // that stops keeps nothing of the interval it had run down.
        round.countdowns[team] = intervals[team];
        continue;
      }
      // Normal play's "no live player" flags stay at their initial 1, so
      // the plain `dt`; the weighted run is for a side whose flags were read
      // and came out alive, with somewhere to spawn.
      const plain = stranded || end.noLive[team] || end.cantSpawn[team];
      round.countdowns[team] -= plain ? dt : held[enemy] * dt / 100;
      const interval = stranded ? atEndInterval : intervals[team];
      // A frame long enough to cross the interval more than once spends more
      // than one ticket, which is what the engine's per-frame subtract does.
      while (round.countdowns[team] <= 0) {
        if (!spend(team, 1)) break;
        lost[team] += 1;
        round.countdowns[team] += interval;
      }
    }
    showObjectiveTickets();
    decideOnTickets();
    decideOnTime();
    return lost;
  }

  /**
   * `giveMedal`'s three (ROUND-9): every player sorted by score, best first,
   * and the first three given gold, silver and bronze. `roster` names the
   * players the page knows, `{ id, team }`, so one who never scored (and so
   * has no tally) still stands in the list; it is optional. How the engine's
   * `getPlayersSortedByScore` orders a tie is not read: here the earlier
   * tally keeps its place. Read before `restart`, which wipes the tallies.
   * Returns `[{ playerId, team, medal, score }]`, at most three.
   */
  function medals(roster = []) {
    const rows = new Map();
    for (const row of round.counts.values()) rows.set(row.playerId, row);
    for (const entry of roster ?? []) {
      if (entry?.id == null) continue;
      const row = rows.get(entry.id);
      if (!row) rows.set(entry.id, { playerId: entry.id, team: entry.team ?? 0, score: 0 });
      else if (!(row.team === 1 || row.team === 2) && (entry.team === 1 || entry.team === 2)) {
        rows.set(entry.id, { ...row, team: entry.team });
      }
    }
    return [...rows.values()]
      .sort((a, b) => b.score - a.score)
      .slice(0, MEDALS.length)
      .map((row, i) => ({ playerId: row.playerId, team: row.team, medal: MEDALS[i], score: row.score }));
  }

  /** Whether a multiplayer server's restart timer has run out. */
  function restartDue() {
    return round.status === 'endGame' && round.restartIn <= 0;
  }

  /**
   * `GameServer::restartMap` (0x08157cb0) for the score: every side back to
   * its starting tickets (`round(N * ratio * players/16)`, the start's own
   * arithmetic), the score wiped (`ScoreManager` vt+100) and every player's
   * stats reset (`BFPlayer::resetStats`), the bleed countdowns refilled and
   * the round playing again. The rounds won survive: `reset` does not touch
   * them.
   */
  function restart() {
    round.tickets[1] = startingTickets(counts[1], startPlayers);
    round.tickets[2] = startingTickets(counts[2], startPlayers);
    // `restartMap` destroys every objective and `ObjectiveManager::reset`
    // runs (OBJ-6); their spawners stand fresh ones up.
    round.objectives?.reset?.();
    objectiveStart();
    round.counts.clear();
    round.teams = { 1: emptyTeamScore(), 2: emptyTeamScore() };
    for (const team of [1, 2]) {
      round.countdowns[team] = intervals[team];
      round.bleeding[team] = false;
    }
    round.status = 'playing';
    round.over = false;
    round.clock = 0;
    round.winner = null;
    round.victoryType = VICTORY.none;
    round.endReason = null;
    round.restartIn = Infinity;
    round.restarts += 1;
  }

  Object.assign(round, {
    tally, kill, suicide, capture, flagScore, objectiveScore, objectiveWin,
    tick, spend, endRound, restart, restartDue, shares, medals,
  });
  objectiveStart();
  return round;
}
