// Drives `viewer/soldier-voice-gates.js` under node and prints one JSON blob.
// `tests/test_soldier_voice_gates.py` copies the module in beside it.
import { createVoiceGates, FF_HIT_SOUND_GAP } from './soldier-voice-gates.js';

const r = { gap: FF_HIT_SOUND_GAP };
// "Watch your aim!": a team round on bot 7 at 10 s, again at 12 and 13.01 s;
// another teammate (bot 8) at 12 s has their own stamp; an enemy round and a
// noFFSound round never play.
const g = createVoiceGates(() => 0.5);
r.ff = [
  g.friendlyHit(7, 10, 1, 1),
  g.friendlyHit(7, 12, 1, 1),
  g.friendlyHit(8, 12, 1, 1),
  g.friendlyHit(7, 13.0, 1, 1),
  g.friendlyHit(7, 13.01, 1, 1),
  g.friendlyHit(9, 20, 2, 1),
  g.friendlyHit(9, 20, 1, 1, true),
];
// The grunt: each soldier's own clock, the next threshold 1.0 + 0.2 * rand
// (here 1.1). Bot 7 at 0, 0.5, 1.05, 1.11; bot 8 at 0.5 is not held by bot 7.
const h = createVoiceGates(() => 0.5);
r.hurt = [h.hurt(7, 0), h.hurt(7, 0.5), h.hurt(8, 0.5), h.hurt(7, 1.05), h.hurt(7, 1.11)];
process.stdout.write(JSON.stringify(r));
