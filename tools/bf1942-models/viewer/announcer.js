/* The side's announcer: the voice lines `Bf1942/Game/GamePlay.ssc` plays by
 * itself, with nobody pressing a key.
 *
 * The client loads the script into `BfMenu+0x6f4` with the local team's radio
 * language (0x006A5BB0, the same reload that carries `MenuRadioSound.ssc`)
 * and triggers its patches by index. Patches 0 and 1, a control point won
 * and lost, are `capture.js`'s. This module decides the other three, from
 * the rules read out of BF1942.exe (ledger RADIO-9..RADIO-11):
 *
 *   2  AutoLoseTickets  "We are taking heavy casualties". 0x006E3760 (team 1)
 *      and 0x006E3680 (team 2), called every drawn frame from the map's draw
 *      (0x0046E19F / 0x0046E1B2) with a per-side flag: the ENEMY's summed
 *      area value over the points it holds is at least 100 (0x0046CA36..
 *      0x0046CA54; team 2's own `areaValueTeam2` at 0x00544FF0 feeds team
 *      1's flag), or in Objective mode the side has 10 tickets or fewer
 *      (0x0046CA5A..0x0046CA86). Only in Conquest, Co-op and Objective
 *      (`Game::getGamePlayMode` 2, 4, 5; 0x006E36D0..0x006E36F6). The local
 *      side's flag plays the line once when it turns on; it can play again
 *      only after the flag has been off (latch `+0x30`).
 *   3  TicketLow  "We are running low on reinforcements". 0x006E3840, every
 *      drawn frame (0x006E3BE0 from the HUD update 0x006AD0A0) with the local
 *      side's tickets over `Game::getNumberOfTickets`, its starting count:
 *      once when the share is in (0.05, 0.2] (0.2 at 0x008EAF70, 0.05 at
 *      0x00925A08), re-armed only above 0.2 (latch `+0x2f`, cleared at
 *      0x006E3ADB). Only while the round is playing (`getGameStatus` 1) and
 *      not in Objective mode, whose low-ticket cue is the heartbeat alone.
 *   4  LeavingCombat  "Warning, deserters will be shot". The map's draw
 *      (0x0046DC62..0x0046DD2B): once the whole seconds spent outside the
 *      combat area are above zero, once per excursion (latch `BfMenu+0x6c8`,
 *      re-armed while they are zero). The HUD's countdown appears on the
 *      same frame.
 *
 * The same HUD call (0x006E3840) also drives `Bf1942/Game/Heartbeats.ssc`
 * (`BfMenu+0x6FC`, one patch: `heartbeatloop.wav`, `loop`, `stereo`, its
 * Pitch and Volume each an identity `Ramp 0 1 0 1` on the map channels
 * `HeartBeat::Pitch` and `HeartBeat::Volume`). `heartbeatLevel` is that
 * branch (ledger RADIO-14), and `frame` leaves its answer in `heartbeat`.
 *
 * Imports nothing and touches no page, so `tests/announcer_harness.mjs` runs
 * the bytes the page loads.
 */

/** `GamePlay.ssc` patch indices, in file order (the engine plays by index). */
export const GAIN_CONTROL_POINT = 0;
export const LOSE_CONTROL_POINT = 1;
export const AUTO_LOSE_TICKETS = 2;
export const TICKET_LOW = 3;
export const LEAVING_COMBAT = 4;

/** `dice::bf::GamePlayMode` (`stringToGPM` 0x08060620): CTF 1, Conquest 2,
 *  TDM 3, Co-op 4, Objective 5. */
export const GPM_CTF = 1;
export const GPM_CONQUEST = 2;
export const GPM_TDM = 3;
export const GPM_COOP = 4;
export const GPM_OBJECTIVE = 5;

/** The engine's game play mode for a level's gameplay layer (`extras.
 *  gameplayMode`: `Conquest`, `Ctf`, `Tdm`, `SinglePlayer`, `CoOp`,
 *  `ObjectiveMode`). A layer the page cannot name plays as Conquest, the
 *  engine's own default (`GPM_CQ`). */
export function gamePlayMode(layer) {
  const m = String(layer || '').toLowerCase();
  if (m.includes('ctf') || m.includes('capturetheflag')) return GPM_CTF;
  if (m.includes('tdm') || m.includes('teamdeathmatch')) return GPM_TDM;
  if (m.includes('objective')) return GPM_OBJECTIVE;
  if (m.includes('coop') || m.includes('singleplayer')) return GPM_COOP;
  return GPM_CONQUEST;
}

/** The weight an enemy must hold for the AutoLoseTickets flag: `cmp ...,
 *  0x64; setge` at 0x0046CA3E..0x0046CA4A. */
export const HEAVY_CASUALTIES_WEIGHT = 100;
/** Objective mode's flag instead: tickets `<= 10` (0x0046CA2F, 0x0046CA74). */
export const OBJECTIVE_LOW_TICKETS = 10;
/** TicketLow's band over the starting count. */
export const TICKET_LOW_HIGH = 0.2;
export const TICKET_LOW_FLOOR = 0.05;

/** The heartbeat's bands over the starting count (0x006E392B..0x006E3A69):
 *  `[lowest share, level]`, each band `[low, next band's low)`, the first
 *  ending under 0.05 and the last above 0. The level goes to both map
 *  channels, so with the script's identity ramps it is the loop's gain and
 *  its playback rate: a slow, quiet beat at 4 % that quickens and swells.
 *  The compiled chain also holds a 0.5 band at [0.04, 0.05) that the 0.4
 *  test before it always takes (0x006E3962 repeats 0x006E392B's compares),
 *  so 0.5 never sounds. */
export const HEARTBEAT_BANDS = [[0.04, 0.4], [0.03, 0.6], [0.02, 0.7], [0.01, 0.8], [0, 1.0]];
/** Objective mode's heartbeat: at or under 10 tickets, level `1 - 0.1 x
 *  tickets` (0x006E3B4A..0x006E3BAB; 10.0f at 0x008DBE18, 0.1f at 0x008C53CC). */
export const HEARTBEAT_OBJECTIVE_TICKETS = 10;

/**
 * The heartbeat's level for the local side this frame, or null when it is
 * stopped (the script's `vt+0x14`, every patch released). While it has a
 * level the client starts the loop if it is not already sounding (a looping
 * patch ignores a trigger while latched, SND-14) and sets both channels to
 * the level, every frame.
 *
 * The share is the float the client stores (`fst DWORD` at 0x006E38A7) and
 * the bands are doubles, so 4/100 is 0.039999999f, under 0.04: the 0.6 band.
 * A float share is never exactly 0.05. At no tickets it stops.
 */
export function heartbeatLevel({ mode = GPM_CONQUEST, tickets = 0, start = 0 } = {}) {
  const left = Math.max(0, Number(tickets) || 0);
  if (mode === GPM_OBJECTIVE) {
    if (!(left <= HEARTBEAT_OBJECTIVE_TICKETS)) return null;
    return Math.fround(1 - Math.fround(0.1) * left);
  }
  const share = Math.fround(left / Number(start));
  if (!(share < TICKET_LOW_FLOOR) || !(share > 0)) return null;
  for (const [low, level] of HEARTBEAT_BANDS) {
    if (share >= low) return level;
  }
  return null;
}

/** Vanilla's tree, where `maps/_shared/voices/heartbeatloop.mp3` lives. */
export const VANILLA_SHARED = 'maps/_shared';

/**
 * Where the heartbeat loop is fetched from: `shared` is the tree's `_shared`
 * directory and `sounds` its `voices/radio-sounds.json` (null when it has
 * none). The engine opens `@ROOT/Sound/@RTD/heartbeatloop.wav` through the
 * mod's path chain, which ends at bf1942. A tree whose manifest carries
 * `heartbeat` had its own chain's sample written beside it by
 * `extract_radio.py`; one listing the stem under `unresolved` has no file,
 * and the engine drops a load whose file is absent (RADIO-6), so the loop is
 * silent. A tree extracted before the heartbeat was (2026-10-22) carries no
 * copy: every installed chain falls through to vanilla's script and sample,
 * byte for byte (measured 2026-10-27), so it fetches vanilla's file directly
 * rather than asking its own tree for one it does not have (a 404 a load).
 */
export function heartbeatUrls(shared, sounds, stem = 'heartbeatloop') {
  const own = sounds?.heartbeat;
  if (own) {
    const name = own.stem ?? stem;
    if ((sounds.unresolved ?? []).includes(name)) return [];
    return [`${shared}/voices/${name}.mp3`];
  }
  return [`${VANILLA_SHARED}/voices/${stem}.mp3`];
}

/**
 * One side's announcer state. `frame(state)` is one drawn frame and returns
 * the `GamePlay.ssc` patches to trigger, in the order the client triggers
 * them (the map's draw, then the HUD update):
 *
 *   mode         `GamePlayMode` (1..5)
 *   team         the local player's side, 1 or 2; 0 while he has none
 *   playing      the round is running (`Game::getGameStatus() == 1`)
 *   held         `{ 1, 2 }` summed area values held (`round-state.js`
 *                `holdWeight`)
 *   tickets      `{ 1, 2 }` current counts
 *   start        `{ 1, 2 }` the counts the round started with
 *   outsideFor   seconds the local player has spent outside the combat area
 */
export class GameplayAnnouncer {
  constructor() { this.reset(); }

  reset() {
    this.heavyLatch = false;      // +0x30 of the flag object
    this.lowLatch = false;        // +0x2f
    this.leavingArmed = false;    // BfMenu+0x6c8, set on the first frame inside
    /** The heartbeat after the last frame: null stopped, else its level. */
    this.heartbeat = null;
  }

  /** The AutoLoseTickets flag for `team` (0x0046CA22..0x0046CA86). */
  static heavyCasualties(team, { mode, held, tickets } = {}) {
    if (mode === GPM_OBJECTIVE) return Number(tickets?.[team]) <= OBJECTIVE_LOW_TICKETS;
    const enemy = team === 1 ? 2 : 1;
    return Number(held?.[enemy]) >= HEAVY_CASUALTIES_WEIGHT;
  }

  frame(state = {}) {
    const out = [];
    const { mode = GPM_CONQUEST, team = 0, playing = true } = state;
    const side = team === 1 || team === 2;
    // The map's draw: LeavingCombat first. The whole seconds are the float
    // truncated (0x00804AF0), so the line and the warning come a second
    // after the player steps out.
    const outside = Math.trunc(Number(state.outsideFor) || 0) > 0;
    if (!side || !outside) {
      this.leavingArmed = true;
    } else if (this.leavingArmed) {
      out.push(LEAVING_COMBAT);
      this.leavingArmed = false;
    }
    // Both ticket lines wait for a running round: the flags' own gate is the
    // menu state `BfMenu+0x100 == 3` (0x006E36A0), which clears them,
    // TicketLow's is `getGameStatus() == 1` (0x006E387C).
    // The heartbeat: with no side the client never makes the HUD call
    // (0x006E3CF0 / 0x006E3D95), so it keeps whatever it had; the round's end
    // stops it, the debriefing releasing the script (0x006AADEF, reached on
    // `getGameStatus() == 2` from 0x00446CD7).
    if (!side) return out;
    if (!playing) { this.heartbeat = null; return out; }
    // Then the flag, which reaches the latch only for the local side and only
    // in the modes that bleed.
    if (mode === GPM_CONQUEST || mode === GPM_COOP || mode === GPM_OBJECTIVE) {
      if (!GameplayAnnouncer.heavyCasualties(team, state)) {
        this.heavyLatch = false;
      } else if (!this.heavyLatch) {
        out.push(AUTO_LOSE_TICKETS);
        this.heavyLatch = true;
      }
    }
    // The HUD update: TicketLow, not in Objective.
    const start = Number(state.start?.[team]);
    if (mode !== GPM_OBJECTIVE && start > 0) {
      const share = Math.max(0, Number(state.tickets?.[team]) || 0) / start;
      // The two compares at 0x006E38AB / 0x006E38BC: above 0.2 re-arms, at
      // or under it and above 0.05 plays; at or under 0.05 is the heartbeat's.
      if (share > TICKET_LOW_HIGH) {
        this.lowLatch = false;
      } else if (share > TICKET_LOW_FLOOR && !this.lowLatch) {
        out.push(TICKET_LOW);
        this.lowLatch = true;
      }
    }
    this.heartbeat = heartbeatLevel({ mode, tickets: state.tickets?.[team], start });
    // At no tickets the stop branch also clears both heavy-casualties latches
    // (0x006E3AC8 / 0x006E3AD1 call the flag functions with false).
    if (mode !== GPM_OBJECTIVE && start > 0 && !(Number(state.tickets?.[team]) > 0)) {
      this.heavyLatch = false;
    }
    return out;
  }
}
