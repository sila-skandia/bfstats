// The level's wind bed (`EnvironmentSound.load`), and the one rule every
// script voice's level starts from. Pure: no `three`, no Web Audio, so
// `tests/test_environment_sound.mjs` runs it in node.
//
// Read from the client (ledger SND-11, SND-27, SND-28;
// features/sound-mix-parity/README.md):
//
//   - A sample's `volume` is clamped to 0..1 before anything reads it
//     (0x008024f0). `volume 80` (FH Road to Ramelle's bed) is `volume 1`.
//     DirectSound can only attenuate, and the wrapper clamps again on the way
//     in (0x00837600). The default is 1 (the sample's constructor, 0x00803770).
//   - The bed is one ordinary sound built from the script and attached to the
//     listener (`EnvironmentSound.load`, 0x00537550), so it has no place and
//     no fall-off. It is in the same volume group as every gun and engine
//     (`Default`): the game has no separate ambience level.
//   - Each frame (0x005375e0) the bed is triggered while the local player is
//     on foot, or in a seat whose SeatObject says `c_SeatIsOutside`, and
//     released in any other seat: a tank's hull, a cockpit, a seat with no
//     SeatObject at all.

import { SEAT_FLAG_BITS, SEAT_IS_OUTSIDE, seatBody } from './seat-ik.js';

/** A script's `volume` as the engine plays it: 0..1, 1 when absent. */
export function scriptVolume(volume) {
  const v = Number(volume);
  if (volume == null || !Number.isFinite(v)) return 1;
  return Math.min(1, Math.max(0, v));
}

/**
 * Whether the bed sounds for a listener in `seat`: the local player's seat
 * (a `seat-survey.js` seat, with the `seatObjects` its PlayerControlObject
 * reaches), or null on foot.
 */
export function environmentPlays(seat) {
  if (!seat) return true;
  return (seatBody(seat.seatObjects).mask & SEAT_FLAG_BITS[SEAT_IS_OUTSIDE]) !== 0;
}
