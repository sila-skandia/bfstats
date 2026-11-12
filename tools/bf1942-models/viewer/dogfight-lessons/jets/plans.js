// The plans the jet lessons add to the school's pilots
// (features/dogfight-lessons-jets): one file a lesson,
// `plan-<id>.js`, each registering its plans on `PLANS` and
// their phases on `INTENTS` (`dogfight-pilot.js`) when it loads. Imported by
// `dogfight-duel.js`, so every duel, fight and live pilot has them; the
// lesson files themselves (`<id>.js`) stay data.
//
// A jet plan is written in the Spitfire's units like every other: the duel
// shows a jet's pilot the fight at the Spitfire's size (`pilotView`).

import './plan-boom-and-zoom.js';
import './plan-under-the-height.js';
import './plan-up-and-over.js';
import './plan-out-of-the-lock.js';
import './plan-on-his-tail.js';
import './plan-break-turn.js';
import './plan-scissors.js';
import './plan-turnarounds.js';
import './plan-the-circle.js';
