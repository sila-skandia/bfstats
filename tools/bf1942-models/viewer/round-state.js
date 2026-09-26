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
 *                the table above;
 *  - `tickets`   `{ team1, team2 }`, the level's counts (`scene.json.tickets`,
 *                with its `maxPlayers` when the level's script sets one);
 *  - `rates`     `{ team1, team2 }`, `setTicketLostPerMin` per side;
 *  - `maxPlayers` the server's slot count; both the counts and the rates are
 *                scaled by it over 16, so the default 16 plays them as given;
 *  - `ticketLosePerDeath`  the engine's default 1, or a level's own command.
 *
 * `counts` is keyed by player id: the page's local player, or a bot's. A room
 * does not use any of this — the server owns the round there — so the page
 * simply does not build one.
 */
export function createRoundState({
  settings = null, mode = '', tickets = null, rates = null,
  maxPlayers = TICKET_BASE_PLAYERS, ticketLosePerDeath = 1,
} = {}) {
  const readSettings = typeof settings === 'function' ? settings : () => settings;
  const readMode = typeof mode === 'function' ? mode : () => mode;
  const serverPlayers = clampMaxPlayers(maxPlayers);
  const startPlayers = roundPlayers(serverPlayers, tickets);
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
    /** Seconds each side still owes before its next ticket. */
    countdowns: { 1: 0, 2: 0 },
    /** Whether each side's bleed is running this frame, for the readouts. */
    bleeding: { 1: false, 2: false },
    /** The weight each side held on the last `tick`, for the readouts. */
    held: { 1: 0, 2: 0 },
    lossPerDeath: Number(ticketLosePerDeath) || 0,
    /** A side at zero is out of the round; the engine stops the bleed there and
     *  so does this. */
    over: false,
  };

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

  /** A player's tally, created empty on first use. */
  function tally(playerId) {
    let row = round.counts.get(playerId);
    if (!row) {
      row = {
        playerId, score: 0, kills: 0, deaths: 0, suicides: 0, captures: 0,
        teamKills: 0,
      };
      round.counts.set(playerId, row);
    }
    return row;
  }

  /** Pay `points` into a player's tally. `key` is a table key. */
  function pay(playerId, key, field, points = 1) {
    const row = tally(playerId);
    row[key] += points;
    row.score += round.table[field] ?? 0;
    return row;
  }

  /** Take tickets off a team, never below zero. */
  function spend(team, count) {
    if (team !== 1 && team !== 2 || !(count > 0)) return 0;
    const before = round.tickets[team];
    round.tickets[team] = Math.max(0, before - count);
    if (round.tickets[team] === 0) round.over = true;
    return before - round.tickets[team];
  }

  /** A death, whoever caused it: the dead player's tally and his team's
   *  tickets. `suicide` also counts on his own line. */
  function died(playerId, team, suicide = false) {
    if (playerId == null) return;
    pay(playerId, 'deaths', 'death');
    if (suicide) tally(playerId).suicides += 1;
    spend(team, round.lossPerDeath);
  }

  /** One player killed another. Same team is a team kill: the killer pays the
   *  table's `tk` instead of `kill`, and the victim's death costs the same
   *  tickets either way. */
  function kill({ killer = null, killerTeam = 0, victim = null, victimTeam = 0 }) {
    if (killer == null || killer === victim) return died(victim, victimTeam, true);
    const friendly = killerTeam !== 0 && killerTeam === victimTeam;
    pay(killer, friendly ? 'teamKills' : 'kills', friendly ? 'tk' : 'kill');
    died(victim, victimTeam, false);
  }

  /** A player died with nobody to blame. */
  function suicide({ player = null, team = 0 }) {
    died(player, team, true);
  }

  /** A player was inside a point of his own team when it turned. */
  function capture({ player = null } = {}) {
    if (player == null) return;
    pay(player, 'captures', 'capture');
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
   * spawn groups, which is all of normal play. Two end-of-round rules for a
   * side left with no spawn groups are not modelled (ledger TKT-5): it bleeds
   * at `setTicketLostAtEndPerMin`'s rate whatever the weights once it has
   * nobody alive or nowhere to spawn, and meanwhile its enemy, if it has a
   * live player, has its countdown run at (the weight the side holds) / 100.
   */
  function tick(dt, points) {
    const held = holdWeight(points);
    round.held = held;
    const lost = { 1: 0, 2: 0 };
    if (!(dt > 0)) return lost;
    for (const team of [1, 2]) {
      const enemy = team === 1 ? 2 : 1;
      const running = !round.over && held[enemy] > BLEED_WEIGHT
        && Number.isFinite(intervals[team]) && round.tickets[team] > 0;
      round.bleeding[team] = running;
      if (!running) continue;
      round.countdowns[team] -= dt;
      // A frame long enough to cross the interval more than once spends more
      // than one ticket, which is what the engine's per-frame subtract does.
      while (round.countdowns[team] <= 0) {
        if (!spend(team, 1)) break;
        lost[team] += 1;
        round.countdowns[team] += intervals[team];
      }
    }
    return lost;
  }

  Object.assign(round, { tally, kill, suicide, capture, tick, spend });
  return round;
}
