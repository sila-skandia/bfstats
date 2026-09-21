// Drives `viewer/seat-dots.js` outside a browser and prints one JSON blob.
//
// Same shape as the other harnesses here: `tests/test_seat_dots.py` copies the
// viewer module in under its own name, so the file under test is the file the
// page loads, byte for byte. `seat-dots.js` imports nothing at all.

import {
  resolveSeatDots, SEAT_DOT_SLOTS,
  DOT_BLANK, DOT_LOCAL, DOT_EMPTY, DOT_FRIEND, DOT_ENEMY,
} from './seat-dots.js';

const results = {};

// Six placed seats, the Hanomag's own icon positions (test_seats_harness.mjs
// transcribes them from Objects/Vehicles/Land/Hanomag/Objects.con).
const HANOMAG_POS = [
  [39, 75], [40, 65], [30, 59], [41, 55], [20, 49], [31, 45],
];

results.constants = {
  slots: SEAT_DOT_SLOTS,
  blank: DOT_BLANK, local: DOT_LOCAL, empty: DOT_EMPTY,
  friend: DOT_FRIEND, enemy: DOT_ENEMY,
};

// Nobody seated anywhere: every placed seat is the empty dot.
results.allEmpty = resolveSeatDots({ iconPos: HANOMAG_POS })
  .map(d => d.state);

// The local player in the root seat: 1 where he sits, 2 everywhere else.
results.localAtRoot = resolveSeatDots({
  iconPos: HANOMAG_POS, localSeat: 0,
}).map(d => d.state);

// A friend in seat 2: the engine's own `friend` dot.
results.friendAtTwo = resolveSeatDots({
  iconPos: HANOMAG_POS, localSeat: 0,
  occupants: [{ seat: 2, team: 1 }], localTeam: 1,
}).map(d => d.state);

// An enemy in seat 4: the `enemy` dot.
results.enemyAtFour = resolveSeatDots({
  iconPos: HANOMAG_POS, localSeat: 0,
  occupants: [{ seat: 4, team: 2 }], localTeam: 1,
}).map(d => d.state);

// Two occupants, one per side: the Hanomag's full crew, driver local.
results.mixedCrew = resolveSeatDots({
  iconPos: HANOMAG_POS, localSeat: 0,
  occupants: [
    { seat: 1, team: 1 }, { seat: 3, team: 2 }, { seat: 5, team: 1 },
  ],
  localTeam: 1,
}).map(d => d.state);

// The local player's own seat beats an occupant row naming the same seat.
results.localWinsTie = resolveSeatDots({
  iconPos: HANOMAG_POS, localSeat: 2,
  occupants: [{ seat: 2, team: 2 }], localTeam: 1,
}).map(d => d.state);

// Two rows on one seat: the first wins, the answer is stable.
results.firstOccupantWins = resolveSeatDots({
  iconPos: HANOMAG_POS,
  occupants: [
    { seat: 3, team: 1 }, { seat: 3, team: 2 },
  ],
  localTeam: 1,
}).map(d => d.state);

// A seat with no position in its extract is state 0, x/y null -- even when
// an occupant row names it: there is nowhere to draw the dot.
results.unplacedIsBlank = resolveSeatDots({
  iconPos: [null, HANOMAG_POS[1], null, HANOMAG_POS[3], null, null],
  localSeat: 1,
  occupants: [{ seat: 2, team: 1 }, { seat: 4, team: 2 }],
  localTeam: 1,
});

// The local seat itself unplaced: still nothing, and the other seats still
// resolve from their own data.
results.localUnplaced = resolveSeatDots({
  iconPos: [null, HANOMAG_POS[1], HANOMAG_POS[2], null, null, null],
  localSeat: 0,
  occupants: [{ seat: 1, team: 1 }],
  localTeam: 1,
}).map(d => d.state);

// Fewer declared seats than six: the missing slots are blank, not empty.
results.fewerThanSix = resolveSeatDots({
  iconPos: [HANOMAG_POS[0], HANOMAG_POS[1], HANOMAG_POS[2]],
  localSeat: 0,
}).map(d => d.state);

// Team 0 against team 0 reads as the same team: friend, not enemy.
results.zeroTeamMatchesZero = resolveSeatDots({
  iconPos: HANOMAG_POS,
  occupants: [{ seat: 1, team: 0 }],
  localTeam: 0,
}).map(d => d.state);

// A null localSeat with no occupants: the plain empty table.
results.noLocalNoOccupants = resolveSeatDots({
  iconPos: HANOMAG_POS,
}).map(d => d.state);

// The positions ride along untouched, null where unplaced.
results.positions = resolveSeatDots({
  iconPos: [HANOMAG_POS[0], null, HANOMAG_POS[2]],
  localSeat: 0,
}).map(d => [d.x, d.y]);

console.log(JSON.stringify(results));
