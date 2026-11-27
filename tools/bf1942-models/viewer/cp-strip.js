// The control point strip under the minimap: retail's `ControlPoint/
// ControlPoint1..7` (menu/InGame's `ShowControlPoints` row, 620,207 256x16,
// MEME-12), what each slot shows, from the client's own writer (ledger
// HUD-36).
//
// `Score::outputScore` does not list the points one by one. It counts them:
//   - the strip has `Radio/NumberOfControlPoints` slots, the control points
//     whose template is not `unableToChangeTeam` (template byte +600, the byte
//     `ControlPoint::setTeam` refuses a change on; `Radio::
//     initControlPointCoordinates`), so a main base is no slot;
//   - every slot is cleared to 0 (grey), then the first `allied` slots from
//     the left are set to 2 (team 2) and the last `axis` slots from the right
//     to 1 (team 1), where `allied` and `axis` count the capturable points
//     each side holds now.
// So the strip reads as a tug of war: one side's colour grows from each end
// and the neutral points sit in the middle, whatever order the level lists
// its points in. The menu draws seven slots and no more (`ControlPoint%d`,
// 1..7, each shown while its index <= NumberOfControlPoints).
//
// It is up only in Conquest, Co-op and Objective (`getGamePlayMode` 2, 4, 5,
// RADIO-13): CTF (1) and TDM (3) clear `ShowControlPoints`. The full-screen
// map clears it too.

import { GPM_COOP, GPM_CONQUEST, GPM_OBJECTIVE, gamePlayMode } from './announcer.js';

/** The menu's slots, `ControlPoint1..7`. */
export const CP_STRIP_SLOTS = 7;

/**
 * The strip's slots for `controlPoints` (each `{ team, unableToChangeTeam }`)
 * under the level's gameplay layer `mode`: an array of 0 (grey), 1 (team 1)
 * or 2 (team 2), left to right, at most seven long; empty when the mode shows
 * no strip.
 */
export function cpStripSlots(controlPoints, mode) {
  const gpm = typeof mode === 'number' ? mode : gamePlayMode(mode);
  if (gpm !== GPM_CONQUEST && gpm !== GPM_COOP && gpm !== GPM_OBJECTIVE) return [];
  const takeable = (controlPoints || []).filter(cp => cp && !cp.unableToChangeTeam);
  const n = takeable.length;
  const slots = new Array(n).fill(0);
  const allied = takeable.filter(cp => cp.team === 2).length;
  const axis = takeable.filter(cp => cp.team === 1).length;
  for (let i = 0; i < allied; i++) slots[i] = 2;
  for (let i = 0; i < axis; i++) slots[n - 1 - i] = 1;
  return slots.slice(0, CP_STRIP_SLOTS);
}
