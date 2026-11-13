// bot-portal.js against hand-worked numbers. Prints one JSON object.
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const V = pathToFileURL(path.join(HERE, '..', 'viewer', 'bot-portal.js')).href;
const P = await import(V);
const I = [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1];
const out = {};
// A door on x = 0..2, y = 0..2 at z = 0 facing -z in the game frame (normal (0,0,-1)); the page's frame flips z.
const door = [1, 1, 0, 0, 0, -1, -1, 1, 0, 2];
const w = P.portalInWorld(door, I);
out.world = { centre: w.centre, normal: w.normal, left: w.left, right: w.right };
// Two doors: the key is 0.3 |P - bot| + |Q - target| + R + L.
const near = [1, 1, 0, 0, 0, -1, -1, 1, 0, 2];
const far = [41, 1, 0, 0, 0, -1, -1, 1, 0, 2];
const weapon = { minRange: 5, maxRange: 25 };
out.pick = P.attackPortal({ botPosition: [1, 1, 15], targetPosition: [1, 1, -3], weapon, planes: [far, near], matrix: I });
out.none = P.attackPortal({ botPosition: [0, 0, 0], targetPosition: [0, 0, 0], weapon, planes: [], matrix: I });
out.tie = P.attackPortal({ botPosition: [1, 1, 15], targetPosition: [1, 1, -3], weapon, planes: [near, near], matrix: I });
// A lopsided span raises the key by R + L.
out.lopsided = P.attackPortal({ botPosition: [1, 1, 15], targetPosition: [1, 1, -3], weapon,
  planes: [[1, 1, 0, 0, 0, -1, -1, 5, 0, 2], near], matrix: I });
out.weight = [1, 2, 4].map(p => P.portalStateWeight(p));
// Firing position: the stretch 5..25 m out along the normal, all free.
const free = (a, b) => [a[0], a[1]];
const fp = P.portalFiringPosition({ portal: w, weapon, firstValid: (a, b) => a, lastClear: (a, b) => b, random: () => 0.5 });
out.firing = { position: fp.position, direction: fp.direction };
out.refused = P.portalFiringPosition({ portal: w, weapon, firstValid: () => null, lastClear: free, random: () => 0 });
out.look = P.portalLookAtPosition({ portal: w, firstValid: (a, b) => b });
// Passing: walk through the door against its normal and out again.
const pass = P.createPortalPassing();
pass.setCovers([{ id: 7, planes: [door], matrix: () => I, centre: [1, 0, 0], reach: 10 }]);
const steps = [[1, 1, 3], [1, 1, 1], [1, 1, -1], [1, 1, 1]];
out.inside = steps.map(p => pass.step('u', p));
out.missesWall = (() => { const q = P.createPortalPassing(); q.setCovers([{ id: 7, planes: [door], matrix: () => I, centre: [1, 0, 0], reach: 10 }]);
  return [[5, 1, 3], [5, 1, -1]].map(p => q.step('u', p)); })();
// States 5, 6 and 7: the weights and the choice.
out.advanceWeights = {
  five: [P.advanceWeight(5, { counts: [0, 0, 0, 0, 0, 0, 0, 0] }), P.advanceWeight(5, { counts: [0, 0, 0, 0, 0, 2, 0, 0] })],
  six: [P.advanceWeight(6, { counts: [0, 0, 0, 0, 0, 0, 0, 0] }), P.advanceWeight(6, { counts: [0, 0, 0, 0, 0, 0, 4, 0] })],
  // value 3: 1 - 1/10; the count of 6 > 0 divides by the count of 7.
  seven: [P.advanceWeight(7, { counts: [], coverValue: 3 }),
          P.advanceWeight(7, { counts: [0, 0, 0, 0, 0, 0, 1, 2], coverValue: 3 }),
          P.advanceWeight(7, { counts: [0, 0, 0, 0, 0, 0, 1, 0], coverValue: 3 })],
};
const pick = (eligible, roll, extra = {}) => P.chooseAdvance({ eligible: new Set(eligible), counts: [0, 0, 0, 0, 0, 0, 0, 0],
  coverValue: 3, roll: () => roll, ...extra });
out.advanceChoice = {
  lowRollSeven: pick([5, 6, 7], 0.5),          // 7 is tried first: 0.9 beats 0.5
  highRollSix: pick([5, 6], 0.95),             // none beats it: the first eligible is 6
  roll35: pick([5], 0.35),                      // 0.3 loses to 0.35, state 5 stands as the only one
  sixOverFive: pick([5, 6], 0.35),             // 0.4 beats 0.35
  none: pick([], 0.1),
};
out.advanceRadius = [P.advanceRadius(1, 1), P.advanceArrive(P.advanceRadius(1, 1)), P.advanceArrive(P.advanceRadius(0.99, 0.5))];
out.counts = P.decisionCounts([5, 5, 2, 7, 0]);
process.stdout.write(JSON.stringify(out) + '\n');
