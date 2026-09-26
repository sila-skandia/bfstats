/**
 * The level ambience law (`viewer/area-sound.js`, features/ambient-sound-parity).
 *
 * Owner's report: "on Wake all I can hear is crashing waves no matter where I
 * am". The page played every shoreline at `volume * ramp` with no fall-off,
 * so Wake's coastline (`minDistance 1`, ramp 40 m -> 80 m) sat at 0.6 across
 * the whole atoll. Retail stands an AreaObject's voice on the nearest point of
 * its closed outline, stops it beyond `triggerRadius` (lnxded
 * `AreaObject::handleFrameUpdate` 0x08269f30), and lets DirectSound take
 * `minDistance / d` off it (ledger SND-6).
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  emitterAt, loudestEmitter, nearestOnOutline, distanceVolume, isBed, isAreaOutline,
} from '../viewer/area-sound.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const close = (a, b, eps = 1e-6, msg = '') => assert.ok(Math.abs(a - b) <= eps, `${msg} ${a} != ${b}`);

// A 100 m square coastline at sea level 95, Wake's script numbers.
const square = {
  name: 'island', kind: 'area', loop: true, volume: 0.6, minDistance: 1,
  triggerRadius: 40, distanceVolume: [40, 80, 1, -1],
  points: [[0, 95, 0], [100, 95, 0], [100, 95, 100], [0, 95, 100]],
};

// 1. The voice stands on the outline, at the object's height, measured in XZ.
{
  const at = emitterAt(square, { x: 50, y: 97, z: 10 });
  close(at.x, 50); close(at.z, 0); close(at.y, 95);
  const d = Math.hypot(10, 2);
  close(at.distance, d);
  close(at.gain, 0.6 / d, 1e-9, 'volume * ramp(1) * minDistance/d');
}

// 2. The outline is closed: the last point runs back to the first.
{
  const hit = nearestOnOutline(square.points, -5, 50);
  close(hit.x, 0); close(hit.z, 50); close(hit.distance2d, 5);
}

// 3. Beyond the trigger radius (in XZ) the engine stops the voice.
assert.equal(emitterAt(square, { x: 50, y: 97, z: 45 }), null, 'island interior, 45 m from any shore');
assert.equal(emitterAt(square, { x: -41, y: 95, z: 50 }), null, 'out at sea, 41 m off');
assert.ok(emitterAt(square, { x: -39, y: 95, z: 50 }), '39 m off is inside the radius');
// ...and the height of the listener is not part of that test, only of `d`.
assert.ok(emitterAt(square, { x: 50, y: 400, z: 30 }), 'a plane overhead is still inside it');

// 4. Fewer than three points: the engine never runs the loop.
assert.equal(nearestOnOutline(square.points.slice(0, 2), 0, 0), null);

// 5. The ramp multiplies the fall-off, evaluated at the 3D distance.
{
  const wide = { ...square, triggerRadius: 1000, distanceVolume: [10, 30, 1, -1] };
  const at = emitterAt(wide, { x: 50, y: 95, z: -20 });
  close(at.gain, 0.6 * 0.5 * (1 / 20), 1e-9);
  // No ramp at all: the fall-off alone.
  const bare = { ...wide, distanceVolume: null };
  close(emitterAt(bare, { x: 50, y: 95, z: -20 }).gain, 0.6 / 20, 1e-9);
  // Inside minDistance DirectSound does not boost.
  close(emitterAt({ ...bare, minDistance: 8 }, { x: 50, y: 95, z: -4 }).gain, 0.6, 1e-9);
}

// 6. `volume 10` (Peenemunde's and Telemark's Ocean.wav) never plays above
// unity -- the same clamp every other voice gets (engine-audio.js).
close(emitterAt({ ...square, volume: 10, minDistance: 8 }, { x: 50, y: 95, z: -2 }).gain, 1, 1e-9);

// 7. An older scene.json (no kind, radius, minDistance or ramp) still falls
// off: minDistance defaults to DirectSound's own 1 m, its near/far ramp holds.
{
  const legacy = { name: 'island1', volume: 0.6, nearDistance: 40, farDistance: 80,
    points: square.points };
  assert.ok(isAreaOutline(legacy));
  const at = emitterAt(legacy, { x: 50, y: 95, z: -30 });
  close(at.gain, 0.6 / 30, 1e-9);
  close(distanceVolume(legacy, 60), 0.5);
  assert.equal(isAreaOutline({ points: [[0, 0, 0]] }), false);
}

// 8. A point emitter: no radius, falls off from its own point.
{
  const radar = { kind: 'point', loop: true, volume: 1, minDistance: 5,
    distanceVolume: [5, 40, 1, -1], points: [[0, 10, 0]] };
  close(emitterAt(radar, { x: 0, y: 10, z: 3 }).gain, 1);
  close(emitterAt(radar, { x: 0, y: 10, z: 22.5 }).gain, 0.5 * 5 / 22.5, 1e-9);
  close(emitterAt(radar, { x: 0, y: 10, z: 100 }).gain, 0);
}

// 9. One-shots are events, not beds (e_Barbwire's scrape).
assert.equal(isBed({ loop: false }), false);
assert.equal(isBed({}), true, 'older data has no loop flag; keep it');

// 10. A group plays its loudest member.
{
  const far = { ...square, points: square.points.map(([x, y, z]) => [x + 60, y, z]) };
  const hit = loudestEmitter([far, square], { x: -10, y: 95, z: 50 });
  assert.equal(hit.area, square);
}

// 11. Every shipped vanilla level's emitters obey the law: never above
// volume * min(1, minDistance / d), silent beyond an AreaObject's radius.
const maps = path.join(here, '..', 'viewer', 'maps');
let swept = 0;
if (fs.existsSync(maps)) {
  for (const level of fs.readdirSync(maps)) {
    const file = path.join(maps, level, 'scene.json');
    if (!fs.existsSync(file)) continue;
    const areas = JSON.parse(fs.readFileSync(file, 'utf8')).sounds?.areas ?? [];
    for (const area of areas) {
      const [x, y, z] = area.points[0];
      for (const d of [2, 5, 20, 45, 90, 200]) {
        const ear = { x: x - d, y: y + 1.7, z };
        const at = emitterAt(area, ear);
        if (!at) continue;
        const cap = Math.min(1, area.volume ?? 1)
          * Math.min(1, (area.minDistance ?? 1) / Math.max(at.distance, 1e-9));
        assert.ok(at.gain <= cap + 1e-9, `${level}/${area.name} at ${d} m: ${at.gain} > ${cap}`);
        if (isAreaOutline(area) && area.triggerRadius != null) {
          assert.ok(Math.hypot(ear.x - at.x, ear.z - at.z) < area.triggerRadius);
        }
        swept++;
      }
    }
  }
}

// 12. Wake itself, when extracted: no surf at the airfield (82 m from any
// shore), and at the landing beach the waves are down with the wind, not 0.6.
const wake = path.join(maps, 'wake', 'scene.json');
if (fs.existsSync(wake)) {
  const scene = JSON.parse(fs.readFileSync(wake, 'utf8'));
  const waves = scene.sounds.areas.filter(a => /water_waves/i.test(a.file));
  const cp = name => scene.controlPoints.find(c => c.name === name).position;
  const [ax, ay, az] = cp('The_Airfield');
  assert.equal(loudestEmitter(waves, { x: ax, y: ay + 1.7, z: az })?.gain ?? 0, 0, 'airfield hears no surf');
  const [bx, by, bz] = cp('The_beach');
  const beach = loudestEmitter(waves, { x: bx, y: by + 1.7, z: bz });
  assert.ok(beach && beach.gain > 0 && beach.gain < 0.1, `beach surf ${beach?.gain}`);
}

console.log(`area-sound: ok (${swept} shipped emitter/distance pairs swept)`);
