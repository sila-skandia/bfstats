// The dogfight school's lessons as a jet flies them
// (features/dogfight-lessons-jets): one file a lesson, `<id>.js`,
// each the changes that lesson needs on an airframe paced as a jet
// (`dogfight-duel.js` `fitAirframe`), or null where it is flown as written.
//
// A lesson's jet file exports `{ note, seconds, ace, you, demos, ... }`:
// whatever it gives replaces the lesson's own (`dogfight-lessons.js`
// `lessonFor`). `ace` and `you` are merged over the lesson's, a demo by its
// id over the lesson's demo; `note` is what the nine flights on the F-16
// showed, in a sentence or two, and is drawn above the story under the
// words ON A JET (so it does not open with them).
//
// These files are data and import nothing: the Range loads the lesson book
// before the rest of the school. A plan a jet lesson needs of its own goes
// in `plan-<id>.js` (`plans.js`), which is loaded
// with the pilots.
//
// Starts and every number a plan reads stay in the Spitfire's units: the
// duel makes a jet's fight larger by its pace and shows its pilot the fight
// at the Spitfire's size (`pilotView`).

import boomAndZoom from './boom-and-zoom.js';
import underTheHeight from './under-the-height.js';
import upAndOver from './up-and-over.js';
import outOfTheLock from './out-of-the-lock.js';
import onHisTail from './on-his-tail.js';
import breakTurn from './break-turn.js';
import scissors from './scissors.js';
import turnarounds from './turnarounds.js';
import theCircle from './the-circle.js';

/** Each lesson's jet changes, by lesson id; null or absent: as written. */
export const JET_LESSONS = {
  'boom-and-zoom': boomAndZoom,
  'under-the-height': underTheHeight,
  'up-and-over': upAndOver,
  'out-of-the-lock': outOfTheLock,
  'on-his-tail': onHisTail,
  'break-turn': breakTurn,
  'scissors': scissors,
  'turnarounds': turnarounds,
  'the-circle': theCircle,
};
