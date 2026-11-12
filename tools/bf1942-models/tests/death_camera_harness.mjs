// Drives `viewer/death-camera.js` under node and prints one JSON blob.
// `tests/test_death_camera.py` copies the module in beside it.
import {
  deathShot, nextFollowed, createDeathCamera, stepDeathCamera, toggleDeathCamera, deathCameraLines,
} from './death-camera.js';

const r = {};
const at = { x: 10, y: 5, z: -3 };
const round = v => v.map(c => +c.toFixed(4));
const shot = t => { const s = deathShot(t, at); return { eye: round(s.eye), up: round(s.up) }; };
r.shot = { t0: shot(0), t1_5: shot(1.5), t3: shot(3), t7: shot(7) };
r.floored = round(deathShot(0, at, 20).eye);

// The player list, in its own order: 1 an enemy, 2 a bot, 3 dead, 4 and 6
// living human teammates, 5 the dead player himself.
const list = [
  { id: 1, team: 1, alive: true, ai: false, x: 0, y: 0, z: 0 },
  { id: 2, team: 2, alive: true, ai: true, x: 0, y: 0, z: 0 },
  { id: 3, team: 2, alive: false, ai: false, x: 0, y: 0, z: 0 },
  { id: 4, team: 2, alive: true, ai: false, x: 40, y: 2, z: 7 },
  { id: 5, team: 2, alive: true, ai: false, x: 0, y: 0, z: 0 },
  { id: 6, team: 2, alive: true, ai: false, x: 0, y: 0, z: 0 },
];
r.next = {
  none: nextFollowed(list, -1, 5, 2),
  after4: nextFollowed(list, 4, 5, 2),
  after6: nextFollowed(list, 6, 5, 2),
  backwards: nextFollowed(list, -1, 5, 2, true),
  botsOnly: nextFollowed([list[1]], -1, 5, 2),
};

// The clock: nobody followed until past 10 s, then 4; 4 dies and the shot
// restarts over him.
const cam = createDeathCamera(at);
const ride = [];
for (const t of [5, 5, 0.5]) ride.push(stepDeathCamera(cam, t, list, 5, 2)?.id ?? null);
const dead4 = list.map(p => (p.id === 4 ? { ...p, alive: false } : p));
ride.push(stepDeathCamera(cam, 0.1, dead4, 5, 2)?.id ?? null);
r.ride = { ids: ride, t: +cam.t.toFixed(3), at: cam.at, followed: cam.followed };
// Single player: every teammate a bot, so the shot holds past 10 s.
const sp = createDeathCamera(at);
r.sp = stepDeathCamera(sp, 30, [list[1]], 5, 2);
// C: the next teammate, the clock to 10.
const c = createDeathCamera(at);
r.toggle = { found: toggleDeathCamera(c, list, 5, 2), followed: c.followed, t: c.t };
toggleDeathCamera(c, list, 5, 2);
r.toggle.second = c.followed;
r.lines = deathCameraLines({ name: 'Pat', hp: 15, maxHp: 30 }, {}, 'C');
process.stdout.write(JSON.stringify(r));
