// The round-end debriefing in a replay: the multiplayer plate the game draws
// over the world when a round ends (ledger ROUND-12), built from the
// recording when playback crosses the round's end (`rec.roundEnded`, the
// first gameStatus 2 or 5), with round-end.js's own functions and painter.
//
// What it shows, and where each part comes from:
//
//  - the result, as the local side reads it (ROUND-8, `debriefingOf`): the
//    local side is the followed player's at the end. The winner and the
//    victory type are the server's own where the recording has them (a
//    server recording's gameStatus carries ScoreManager's `winner` and
//    `victory`, ROUND-5, ROUND-6); else the winner is the server log's
//    `bf:winningteam` when one is attached, else the tickets' (a side under
//    one ticket lost, ROUND-2; otherwise the larger share of its starting
//    tickets won, ROUND-3), and the victory type is `victoryTypeOf` over the
//    last tickets' shares (ROUND-6, `ticketSharesOf`). The log's own
//    `bf:victorytype` is not used: the server logs the round before it sets
//    the type, so it reads 4, none, in every logged round (ROUND-13);
//  - the three best players (`bestPlayers`, MEME-26's order) from the
//    replay's board at the end (replay-chapters.js `boardAt`): the server's
//    own counters in a server recording, else the score paid from the
//    recorded events; ping only where the server recorded it, the cell
//    empty otherwise; the medals by rank and side (`medalTexture`);
//  - each side's tickets and flags, the HUD's (`ticket-feed.js`), which the
//    replay's round already moves (replay-round.js).
//
// It stays up until the viewer seeks back before the end or presses a key;
// a seek back past the end shows it again. The win or lose cue plays when
// playback runs into the end, not after a seek.
//
// The top half is pure (no DOM), so `tests/replay_debrief_harness.mjs` runs
// it in node, and the presenter with no page.

import { bestPlayers, createDebriefingPlate, debriefingOf, debriefingVars, debriefingWords } from './round-end.js';
import {
  GAME_PLAY_MODE, TICKET_BASE_PLAYERS, VICTORY, gamePlayModeOf, ticketShare, victoryTypeOf,
} from './round-state.js';
import { boardAt, scoreTableOf } from './replay-chapters.js';
import { teamAt } from './replay-recording.js';
import { serverSlots, ticketsAt } from './replay-round.js';

/** The last tickets of the round: the last `tk` at or before its end. */
function endTickets(rec, timeline = rec.tickets) {
  const end = Number.isFinite(rec.roundEnded) ? rec.roundEnded : rec.duration;
  return ticketsAt(timeline, end);
}

/** Each side's share of its starting tickets at the end (ROUND-3's
 *  `ticketShare`: the count over the start). The start is the round's own
 *  where it can be read: each side's first count once the recording saw the
 *  round begin, else the server log's round start (`roundInit`), else the
 *  level's counts scaled to the server's slots (a co-op round plays another
 *  layer's counts, so this is the last resort), else the most it counted.
 *  Null with no tickets. */
export function ticketSharesOf(rec, { timeline = rec.tickets, levelTickets = null, maxPlayers = TICKET_BASE_PLAYERS,
  log = null } = {}) {
  const last = endTickets(rec, timeline);
  if (!last) return null;
  const covered = rec.roundStarted !== null && rec.roundStarted !== undefined;
  const firsts = [0, 1].map(i => timeline.find(e => e.t >= rec.roundStarted && e.v[i] > 0)?.v[i] ?? 0);
  const init = log?.events?.find(e => e.name === 'roundInit')?.params;
  const logged = [Number(init?.tickets_team1), Number(init?.tickets_team2)];
  const counts = [Number(levelTickets?.team1), Number(levelTickets?.team2)];
  if (!(covered && firsts.every(c => c > 0)) && !logged.every(c => c > 0) && counts.every(c => c > 0)) {
    return { 1: ticketShare(last[0], counts[0], maxPlayers), 2: ticketShare(last[1], counts[1], maxPlayers), tickets: last };
  }
  const start = covered && firsts.every(c => c > 0) ? firsts
    : logged.every(c => c > 0) ? logged
      : [0, 1].map(i => Math.max(0, ...timeline.map(e => e.v[i])));
  if (!start.every(s => s > 0)) return null;
  return { 1: last[0] / start[0], 2: last[1] / start[1], tickets: last };
}

/** The winner the tickets say (ROUND-2, ROUND-3): a side under one ticket
 *  lost, both is a draw (0); otherwise the larger share, equal a draw. */
export function ticketWinner(shares) {
  if (!shares) return null;
  const [a, b] = shares.tickets;
  if (a < 1 && b < 1) return 0;
  if (a < 1) return 2;
  if (b < 1) return 1;
  return shares[1] > shares[2] ? 1 : shares[2] > shares[1] ? 2 : 0;
}

/**
 * The round's result: `{ winner, victory, from: { winner, victory } }`, the
 * sources 'recorded', 'log' or 'tickets'; null when nothing names a winner.
 * `serverRows` is the aligned server log's (replay-server-log.js
 * `serverRows`), `levelTickets` the level's counts (`extras.tickets`).
 */
export function roundResultOf(rec, { serverRows = [], levelTickets = null, log = null, timeline = rec.tickets } = {}) {
  const shares = ticketSharesOf(rec, { timeline, levelTickets, maxPlayers: serverSlots(log, levelTickets), log });
  const recorded = rec.roundResult;
  const logged = serverRows.find(r => r.kind === 'roundstats' && Number.isInteger(r.winner));
  let winner = null;
  let winnerFrom = null;
  if (recorded && Number.isInteger(recorded.winner)) [winner, winnerFrom] = [recorded.winner, 'recorded'];
  else if (logged) [winner, winnerFrom] = [logged.winner, 'log'];
  else {
    const fromTickets = ticketWinner(shares);
    if (fromTickets !== null) [winner, winnerFrom] = [fromTickets, 'tickets'];
  }
  if (winner === null) return null;
  const recordedType = recorded && Number.isInteger(recorded.victory) && recorded.victory !== VICTORY.none
    ? recorded.victory : null;
  if (recordedType !== null && winnerFrom === 'recorded') {
    return { winner, victory: recordedType, from: { winner: winnerFrom, victory: 'recorded' }, shares };
  }
  // A draw is 0 whatever the margin; a winner's class is his margin's.
  const victory = winner === 1 || winner === 2 ? (shares ? victoryTypeOf(winner, shares) : VICTORY.minor) : VICTORY.draw;
  return { winner, victory, from: { winner: winnerFrom, victory: shares ? 'tickets' : 'none' }, shares };
}

/**
 * Everything the plate shows for a replay at its end, pure: `{ end, result,
 * words, players, localTeam, objective }`. `opts`: `followPid`, `kills`
 * (the replay's kill lines), `table` (the score table), `recordingPids`,
 * `serverRows`, `levelTickets`, `log`, `timeline` (the tickets the replay
 * shows), `briefing` (scene.json's). Null when the recording has no end.
 */
export function debriefModel(rec, opts = {}) {
  const end = rec.roundEnded;
  if (!Number.isFinite(end)) return null;
  const result = roundResultOf(rec, opts);
  const localTeam = opts.followPid !== null && opts.followPid !== undefined ? teamAt(rec, opts.followPid, end) || 0 : 0;
  const objective = gamePlayModeOf(rec.modeFile) === GAME_PLAY_MODE.objective;
  const shown = result ? debriefingOf({ winner: result.winner, victoryType: result.victory, localTeam, objective }) : null;
  const words = debriefingWords(shown, opts.briefing ?? null);
  const board = boardAt(rec, opts.kills ?? rec.kills, end, {
    table: opts.table ?? scoreTableOf(rec), recordingPids: opts.recordingPids ?? [],
  });
  // The board is already in the retail order; an unrecorded ping is an
  // empty cell, not a 0 the server never said.
  const top = board.filter(b => b.team === 1 || b.team === 2).slice(0, 3);
  const players = bestPlayers(top).map((p, i) => ({
    ...p, pid: top[i].pid, ping: Number.isFinite(top[i].ping) ? p.ping : '',
  }));
  return { end, result, shown, words, players, localTeam, objective };
}

// --- the page ------------------------------------------------------------------

/** What the plate's ticket cells show, as one comparable string. */
const ticketsKey = t => (t ? `${t.show}|${t.axis}|${t.allied}|${t.axisFlag}|${t.alliedFlag}` : '');

/**
 * The presenter, one per replay. `player` is the ReplayPlayer; its `ctx`
 * may hand in `debriefSpriteUrl(rel)`, `debriefSprite(name)`,
 * `debriefTickets()` (`ticketMemoFor`), `levelBriefing()`,
 * `levelTickets()`, `playRoundMusic(kind)` and `stopRoundMusic()`. Without
 * the sprite URL (node, a page with no HUD pack) it keeps its model and
 * draws nothing.
 */
export class ReplayDebrief {
  constructor(player) {
    this.player = player;
    this.ctx = player.ctx;
    this.shown = false;
    this.dismissed = false;
    this.model = null;
    this.modelKey = null;
    this.music = null;
    this.plate = typeof document !== 'undefined' && this.ctx.debriefSpriteUrl
      ? createDebriefingPlate({
        id: 'replay-debrief',
        stage: this.ctx.stage,
        spriteUrl: rel => this.ctx.debriefSpriteUrl(rel),
        sprite: name => this.ctx.debriefSprite?.(name) ?? null,
      })
      : null;
    this.onKey = e => {
      if (!this.shown || e.repeat) return;
      if (['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) return;
      this.dismiss();
    };
    if (typeof window !== 'undefined') window.addEventListener('keydown', this.onKey, true);
  }

  /** The model for the replay's end, worked out again when whom it follows
   *  (the local side) or the score table changes. */
  modelFor() {
    const p = this.player;
    const table = p.scoreTable?.() ?? null;
    const key = `${p.followPid}|${JSON.stringify(table)}`;
    if (this.model && this.modelKey === key) return this.model;
    this.modelKey = key;
    this.model = debriefModel(p.rec, {
      followPid: p.followPid, kills: p.kills, table: table ?? undefined, recordingPids: p.recordingPids,
      serverRows: p.serverRows, levelTickets: this.ctx.levelTickets?.() ?? null, log: p.log,
      timeline: p.round?.timeline ?? p.rec.tickets, briefing: this.ctx.levelBriefing?.() ?? null,
    });
    return this.model;
  }

  /** The viewer is done with it: down until he seeks back before the end. */
  dismiss() {
    this.dismissed = true;
    this.hide();
  }

  hide() {
    if (!this.shown) return;
    this.shown = false;
    this.plate?.hide();
    if (this.music) {
      this.music = null;
      this.ctx.stopRoundMusic?.();
    }
  }

  /** The plate's variables: the title, and the HUD's ticket counts and
   *  flags as they stand now. */
  varsFor(model) {
    const tickets = this.ctx.debriefTickets?.() ?? null;
    this.ticketsKey = ticketsKey(tickets);
    return debriefingVars(this.plate?.variables?.() ?? null, { title: model.words.title, tickets, startingGame: 2 });
  }

  show(playedInto) {
    const model = this.modelFor();
    if (!model) return;
    this.shown = true;
    this.plate?.show({ vars: this.varsFor(model), players: model.players });
    // The cue once, as the game plays it when the round ends in front of him.
    if (playedInto && model.shown?.music) {
      this.music = model.shown.music;
      this.ctx.playRoundMusic?.(this.music);
    }
  }

  /** One frame at recording time `t`, `prevT` the last frame's. */
  update(t, prevT = t) {
    const end = this.player.rec.roundEnded;
    if (!Number.isFinite(end)) return;
    if (t < end) {
      this.dismissed = false;
      this.hide();
      return;
    }
    if (this.shown) {
      // The counts are the HUD's own (HudTickets__update writes them every
      // frame, ROUND-12): a last count that lands after the end shows.
      if (ticketsKey(this.ctx.debriefTickets?.() ?? null) !== this.ticketsKey && this.plate?.model) {
        this.plate.model.vars = this.varsFor(this.model);
        this.plate.paint();
      }
      return;
    }
    if (this.dismissed) return;
    const playedInto = this.player.playing && prevT < end && t - prevT < 1;
    this.show(playedInto);
  }

  /** What the plate shows, for the test hooks. */
  state() {
    const m = this.shown ? this.model : null;
    return {
      shown: this.shown,
      dismissed: this.dismissed,
      end: this.player.rec.roundEnded,
      title: m?.words.title ?? '',
      result: m?.result ?? null,
      localTeam: m?.localTeam ?? null,
      players: m?.players ?? [],
      music: this.music,
      drawn: Boolean(this.plate?.loaded?.()),
    };
  }

  dispose() {
    this.hide();
    if (typeof window !== 'undefined') window.removeEventListener('keydown', this.onKey, true);
    this.plate?.dispose();
  }
}
