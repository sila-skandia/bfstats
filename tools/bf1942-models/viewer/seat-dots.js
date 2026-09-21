/* The six seat-occupancy dots: which state each one draws, and where.
 *
 * The engine's own table, read by VHUD-2 off `BfOccupiedVehicleData`'s
 * vtable (`0x0093f300`, raw bytes): one shared object backs all six HUD
 * leaves, and its five-entry icon table is
 *
 *   0  draws nothing
 *   1  vehicledot_local
 *   2  vehicledot_empty
 *   3  vehicledot_friend
 *   4  vehicledot_enemy
 *
 * `hud.js` owns the drawing; this module owns the states. The question VHUD-2
 * left open was which live state a given seat resolves to, and the answer is
 * the seat's occupant, read the way the engine's own occupant list is read:
 * the seat you sit in is `local`, a seat another player of your team sits in
 * is `friend`, a seat an enemy team's player sits in is `enemy`, and a seat
 * nobody sits in is `empty`. There is no other relationship the table has a
 * word for, so nothing here is a guess dressed as engine behaviour: every
 * state is either the local player's own seat, a named occupant's team, or
 * nobody.
 *
 * A seat whose extract carries no `setVehicleIconPos` is state **0** — the
 * table's own "draws nothing" — and not a 1/2/3/4 with a null position. Every
 * PlayerControlObject in the game declares the word (19,085 of 19,089
 * declarations across 18 installs), so the only way to reach this is a scene
 * baked before `con.py` learned it, and for that scene there is no place to
 * put the dot: `hud-layout.json`'s own rects are the variables' authored
 * placeholders, a 5px diagonal staircase, not six seat positions. Six dots in
 * the wrong place assert a seat layout the data does not have.
 *
 * Pure on purpose: no `three`, no DOM, so `tests/seat_dots_harness.mjs` can
 * drive it under node the way the other viewer modules are driven.
 */

export const DOT_BLANK = 0;
export const DOT_LOCAL = 1;
export const DOT_EMPTY = 2;
export const DOT_FRIEND = 3;
export const DOT_ENEMY = 4;

/** The layout has six `occupied-seat` leaves and the engine six
 *  `VehiclePosX1..6`/`Y1..6` pairs; seats past the sixth get no dot. */
export const SEAT_DOT_SLOTS = 6;

/**
 * Resolve the six dot states for one vehicle.
 *
 * `iconPos` is the six `setVehicleIconPos` pairs in the vehicle's own survey
 * order (a pair or `null` per slot); `localSeat` the local player's seat
 * position, 0-based, or `null` when nobody local is seated; `occupants` the
 * OTHER players' seats as `{ seat, team }` rows, `seat` the same 0-based
 * position and `team` the server's team id (1 Axis, 2 Allied); `localTeam`
 * the local player's own team id.
 *
 * Precedence, per slot: no position beats everything (state 0, nothing to
 * draw); the local player's own seat beats any occupant row naming the same
 * seat; of several occupant rows on one seat the first wins, so a caller that
 * iterates a stable order gets a stable answer.
 */
export function resolveSeatDots(
  { iconPos = [], localSeat = null, occupants = [], localTeam = 0 } = {},
) {
  const dots = [];
  for (let i = 0; i < SEAT_DOT_SLOTS; i++) {
    const pos = iconPos[i];
    const placed = Array.isArray(pos)
      && typeof pos[0] === 'number' && typeof pos[1] === 'number';
    let state;
    if (!placed) {
      state = DOT_BLANK;
    } else if (i === localSeat) {
      state = DOT_LOCAL;
    } else {
      const occupant = occupants.find(o => o && o.seat === i);
      state = occupant
        ? (occupant.team === localTeam ? DOT_FRIEND : DOT_ENEMY)
        : DOT_EMPTY;
    }
    dots.push({
      state,
      x: placed ? pos[0] : null,
      y: placed ? pos[1] : null,
    });
  }
  return dots;
}
