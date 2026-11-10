// The plans the jet lessons add to the school's pilots
// (features/dogfight-lessons-jets): one file a lesson,
// `dogfight-jet-plan-<id>.js`, each registering its plans on `PLANS` and
// their phases on `INTENTS` (`dogfight-pilot.js`) when it loads. Imported by
// `dogfight-duel.js`, so every duel, fight and live pilot has them; the
// lesson files themselves (`dogfight-jet-<id>.js`) stay data.
//
// A jet plan is written in the Spitfire's units like every other: the duel
// shows a jet's pilot the fight at the Spitfire's size (`pilotView`).

import './dogfight-jet-plan-boom-and-zoom.js';
import './dogfight-jet-plan-under-the-height.js';
import './dogfight-jet-plan-up-and-over.js';
import './dogfight-jet-plan-out-of-the-lock.js';
import './dogfight-jet-plan-on-his-tail.js';
import './dogfight-jet-plan-break-turn.js';
import './dogfight-jet-plan-scissors.js';
import './dogfight-jet-plan-turnarounds.js';
import './dogfight-jet-plan-the-circle.js';
