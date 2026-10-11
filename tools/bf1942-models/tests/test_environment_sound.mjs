/**
 * The wind bed's law and the mix's one scale (`viewer/environment-sound.js`,
 * features/sound-mix-parity; ledger SND-11, SND-27, SND-28).
 *
 * Owner's report: the weapons can hardly be heard and the background drowns
 * everything, FH Road to Ramelle the worst. Its bed says `volume 80`, the page
 * played that as a gain of 80, and the limiter took the rest of the mix down
 * under it. The engine clamps a sample's volume to 0..1.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { environmentPlays, scriptVolume } from '../viewer/environment-sound.js';
import { WEAPON_HEADROOM } from '../viewer/engine-audio.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const viewer = path.join(here, '..', 'viewer');

// 1. A script volume is 0..1 (client 0x008024f0), 1 when the script has none.
assert.equal(scriptVolume(80), 1, 'Road to Ramelle');
assert.equal(scriptVolume(300), 1, 'FinnWars');
assert.equal(scriptVolume(1.4), 1, 'Aberdeen');
assert.equal(scriptVolume(0.6), 0.6, 'windcalm on Bocage');
assert.equal(scriptVolume(0), 0);
assert.equal(scriptVolume(-2), 0);
assert.equal(scriptVolume(undefined), 1, 'the sample constructor default');
assert.equal(scriptVolume(null), 1);
assert.equal(scriptVolume(NaN), 1);

// 2. The bed plays on foot and in an outside seat, and nowhere else
//    (client 0x005375e0).
const seatObject = (...flags) => ({ userData: { seat: { flags } } });
assert.equal(environmentPlays(null), true, 'on foot');
assert.equal(environmentPlays({ seatObjects: [] }), false,
  'a seat with no SeatObject: the Sherman driver');
assert.equal(environmentPlays({}), false);
assert.equal(environmentPlays({ seatObjects: [seatObject('c_SeatShowHalfBodySoldier')] }), false,
  'a cockpit');
assert.equal(environmentPlays({
  seatObjects: [seatObject('c_SeatShowFullBodySoldier', 'c_SeatIsOutside')],
}), true, 'a jeep');
assert.equal(environmentPlays({ seatObjects: [seatObject('c_seatisoutside')] }), true,
  'the word in any case');

// 3. Guns, effects and soldiers play on the scale the bed and the engines do:
//    the client has one volume group for all of them (SND-28).
assert.equal(WEAPON_HEADROOM, 1);

// 4. The page plays the bed through both rules and no longer ducks the
//    placed ambience.
const page = fs.readFileSync(path.join(viewer, 'page-audio.js'), 'utf8');
const beds = page.match(/ambientAudio\.setVolume\([\s\S]*?\);/g) ?? [];
assert.equal(beds.length, 2, 'the bed is set at load and each frame');
for (const call of beds) {
  assert.match(call, /scriptVolume\(|base \*/, call);
  assert.match(call, /bedGate/, call);
}
assert.match(page, /const base = scriptVolume\(/);
assert.doesNotMatch(page, /ambientDuck|AMBIENT_DUCK/);

// 5. Every shipped bed, in every extracted tree, comes out at or below 1.
const maps = path.join(viewer, 'maps');
let checked = 0;
if (fs.existsSync(maps)) {
  const roots = [maps];
  const mods = path.join(maps, 'mods');
  if (fs.existsSync(mods)) {
    for (const mod of fs.readdirSync(mods)) roots.push(path.join(mods, mod));
  }
  for (const root of roots) {
    for (const level of fs.readdirSync(root)) {
      const file = path.join(root, level, 'scene.json');
      if (!fs.existsSync(file)) continue;
      let scene;
      try { scene = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { continue; }
      const bed = scene.sounds?.ambient;
      if (!bed) continue;
      const v = scriptVolume(bed.volume);
      assert.ok(v >= 0 && v <= 1, `${file}: ${bed.volume} -> ${v}`);
      checked += 1;
    }
  }
}

console.log(`environment sound: ok (${checked} shipped beds)`);
