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
    if (!side || !playing) return out;
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
    return out;
  }
}
