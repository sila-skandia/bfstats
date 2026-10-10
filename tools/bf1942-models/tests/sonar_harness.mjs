// Drives the sonar and radar scope's rules (`viewer/sonar.js`) outside a
// browser and prints one JSON blob. `tests/test_sonar.py` copies the module
// in, so the file under test is the file the page loads.

import {
  SONAR_FADE_STEP, SONAR_ROTATION_SPEED, SonarScope, seatSonar, sensedObjects, sonarBearing,
} from './sonar.js';

const out = {};
const self = { x: 0, y: 100, z: 0 };
const ids = list => list.map(o => o.id);

// --- what is sensed -----------------------------------------------------------

const objects = [
  { id: 'below', x: 100, y: 20, z: 50 },
  { id: 'level', x: -30, y: 100, z: 10 },
  { id: 'above', x: 10, y: 180, z: 10 },
  { id: 'farBelow', x: 10, y: -301, z: 10 },
  { id: 'edgeBelow', x: 10, y: -300, z: 10 },
  { id: 'wide', x: 400.5, y: 50, z: 0 },
  { id: 'edgeWide', x: 400, y: 50, z: 0 },
];
out.sonar = ids(sensedObjects({ self, radius: 400, objects }));
out.radar = ids(sensedObjects({ self, radius: 400, radarMode: true, objects }));

// --- the bearing --------------------------------------------------------------

out.bearing = {
  northWest: sonarBearing(0, 0, -10, 10),
  northEast: sonarBearing(0, 0, 10, 10),
  southEast: sonarBearing(0, 0, 10, -10),
  southWest: sonarBearing(0, 0, -10, -10),
  nearWest: sonarBearing(0, 0, -1000, 1),
  nearNorth: sonarBearing(0, 0, 1, 1000),
  dueNorth: sonarBearing(0, 0, 0, 10),
  dueEast: sonarBearing(0, 0, 10, 0),
};

// --- the sweep ----------------------------------------------------------------

const scope = new SonarScope();
const target = { id: 't', x: 50, z: 50 };      // north-east: 3 pi / 4
let litAt = -1, goneAt = -1, relitAt = -1, wrappedAt = -1, peak = 0;
for (let i = 1; i <= 600; i++) {
  scope.step(self, [target]);
  const life = scope.blips.get('t');
  if (life !== undefined && litAt < 0) { litAt = i; peak = life; }
  if (litAt > 0 && goneAt < 0 && life === undefined) goneAt = i;
  if (goneAt > 0 && relitAt < 0 && life !== undefined) relitAt = i;
  if (wrappedAt < 0 && i > 1 && scope.sweep === 0) wrappedAt = i;
}
out.sweep = { litAt, goneAt, relitAt, wrappedAt, peak, speed: SONAR_ROTATION_SPEED, fade: SONAR_FADE_STEP };

// A dot is not lit twice while it lives, and nothing on a cardinal line is lit.
const cardinal = new SonarScope();
for (let i = 0; i < 300; i++) cardinal.step(self, [{ id: 'n', x: 0, z: 80 }]);
out.cardinalLit = cardinal.blips.size;

// `update` runs whole map updates at its own rate, whatever the frame rate.
const paced = new SonarScope();
let asked = 0;
for (let i = 0; i < 144; i++) paced.update(1 / 144, () => { asked += 1; return { self, sensed: [] }; });
const stalled = new SonarScope();
out.pacing = { perSecondAt144Hz: asked, afterAStall: stalled.update(30, () => null) };

// --- the seat -----------------------------------------------------------------

const table = { vehicles: [
  { template: 'F-15C', seats: ['F-15C'], radius: 400, radarMode: false },
  { template: 'SA-19_Pantsyr', seats: ['Pantsyr_C3PCO'], radius: 700, radarMode: true },
] };
out.seat = {
  pilot: seatSonar(table, 'f-15c', 'F-15C')?.radius ?? null,
  pantsyrDriver: seatSonar(table, 'SA-19_Pantsyr', 'SA-19_Pantsyr'),
  pantsyrRadar: seatSonar(table, 'SA-19_Pantsyr', 'pantsyr_c3pco')?.radarMode ?? null,
  noTable: seatSonar(null, 'F-15C', 'F-15C'),
  otherHull: seatSonar(table, 'Sherman', 'Sherman'),
};

console.log(JSON.stringify(out));
