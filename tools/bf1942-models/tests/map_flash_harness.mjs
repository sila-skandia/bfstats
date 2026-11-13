// Drives `viewer/map-flash.js` outside a browser.
import { createMapFlash, RADIO_FLASH_COUNT, PLAYER_BLINK_ON, PLAYER_BLINK_PERIOD, FLASH_TINT } from './map-flash.js';

const out = { count: RADIO_FLASH_COUNT, on: PLAYER_BLINK_ON, period: PLAYER_BLINK_PERIOD, tint: FLASH_TINT };
{
  const f = createMapFlash();
  f.add('slot:5');
  out.litAtStart = f.lit('slot:5');
  out.otherLit = f.lit('slot:6');
  // 30 Hz frames: lit through 1.0 s, dark until the clock passes 2.0 s.
  const trace = [];
  let t = 0, blinks = 0, was = true, goneAt = null;
  for (let i = 0; i < 30 * 20; i++) {
    f.update(1 / 30);
    t += 1 / 30;
    const lit = f.lit('slot:5');
    if (lit && !was) blinks++;
    was = lit;
    if (i === 14) out.litAtHalf = lit;          // 0.5 s
    if (i === 44) out.litAtOneAndHalf = lit;    // 1.5 s
    if (i === 62) { out.litAfterCycle = lit; out.leftAfterCycle = f.blinksLeft('slot:5'); }
    if (goneAt === null && !f.listed('slot:5')) goneAt = t;
  }
  out.relit = blinks;          // lit again after each of the first six dark halves
  out.goneAt = Math.round(goneAt * 10) / 10;
  out.keyEmpty = f.key();
}
{
  // A count of 0 never blinks; a second call keeps the larger count.
  const f = createMapFlash();
  f.add('a', 0);
  out.zero = f.listed('a');
  f.add('b', 3); f.add('b', 7); f.add('b', 2);
  out.larger = f.blinksLeft('b');
  out.key = f.key();
  // `Game.setRadioFlashTime 2`.
  f.setCount(2); f.add('c');
  out.setCount = f.blinksLeft('c');
}
console.log(JSON.stringify(out));
