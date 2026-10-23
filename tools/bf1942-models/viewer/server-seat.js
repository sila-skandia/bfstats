// What the page does with the local player's seat when a real server's row
// ends it (`net-room.js`, the sidecar's `onevent`). The page never decides a
// seat against a real server (`room.serverSeats`); it follows the server's
// rows, and three of them end a seat without an exit row of their own:
//
// - his own death (`killed`, ScoreMsg 4 or 5): the server's exit row comes
//   after it, and a dead man firing from his seat until it did was the live
//   PanzerIV of 2026-10-17;
// - the hull he sits in destroyed (`vehicleGone`, DestroyObject): the object
//   and its seats are gone, so there is nothing to sit in. Left in, the page
//   drove its copy of a hull that no longer existed;
// - the round restarted (`levelChange` with `same`, GameStatus 3 after 1 or
//   2): `restartMap` kills everyone and re-makes every hull (ROUND-10), and
//   the page starts the round over as a page that joined now would.
//
// The exit is quiet in every case (no Use goes back to the server: it moved
// him already). Kept pure so `tests/sidecar_round_restart_harness.mjs` drives
// the same decisions over a recorded session.

const NONE = Object.freeze({ leave: false, die: false, restart: false });

/**
 * `row` is one of the sidecar client's page rows; `me` says who the page is:
 * `slot` its room slot, `occupies(id)` whether its seat is on server hull
 * `id` (asked before the page forgets the hull's binding).
 */
export function seatPlanForRow(row, { slot = null, occupies = () => false } = {}) {
  if (!row || typeof row !== 'object') return NONE;
  if (row.type === 'killed' && slot != null && row.slot === slot) return { leave: true, die: true, restart: false };
  if (row.type === 'vehicleGone' && row.vehicle != null && occupies(row.vehicle)) {
    return { leave: true, die: false, restart: false };
  }
  if (row.type === 'levelChange' && row.same) return { leave: true, die: false, restart: true };
  return NONE;
}
