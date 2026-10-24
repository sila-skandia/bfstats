// Drives `viewer/nametags.js` under node and prints one JSON blob.
// `tests/test_nametags.py` copies the module in beside it.

import {
  NAMETAG_NEAR, NAMETAG_SCOPE, TEAM_RGB, nameTagDistances, aimState, ageAim, markAimed,
  latchAim, nameTagAlpha, nameTagRgb, nameTagText, pulseRgb,
} from './nametags.js';

const r = {};
const dist = nameTagDistances();
r.distances = { near: NAMETAG_NEAR, scope: NAMETAG_SCOPE, def: dist,
  capped: nameTagDistances(50, 300), above: nameTagDistances(500, 900) };
r.rgb = TEAM_RGB;

// A teammate at 30 m, nobody aiming.
r.alpha = {
  friendNear: nameTagAlpha({ d: 30, friend: true, fade: 0 }, dist),
  friendAtNear: nameTagAlpha({ d: 75, friend: true, fade: 0 }, dist),
  friendFar: nameTagAlpha({ d: 100, friend: true, fade: 0 }, dist),
  enemyNear: nameTagAlpha({ d: 10, friend: false, fade: 0 }, dist),
  enemyAimed: nameTagAlpha({ d: 100, friend: false, fade: 1 }, dist),
  friendAimedFar: nameTagAlpha({ d: 100, friend: true, fade: 1 }, dist),
  friendAimedNear: nameTagAlpha({ d: 30, friend: true, fade: 1 }, dist),
  beyondScope: nameTagAlpha({ d: 301, friend: false, fade: 1 }, dist),
  carrier: nameTagAlpha({ d: 2000, friend: false, fade: 0, carrier: true }, dist),
};

// The aim: held at 150 m, frames of 1/60 s, in the engine's order.
{
  const s = aimState();
  let frames = 0;
  while (s.fade === 0 && frames < 600) {
    ageAim(s, 1 / 60);
    markAimed(s, 1 / 60);
    latchAim(s, 150, NAMETAG_SCOPE);
    frames++;
  }
  const lit = frames / 60;
  // Look away: the fade runs out in half a second.
  let away = 0;
  while (s.fade > 0 && away < 600) { ageAim(s, 1 / 60); latchAim(s, 150, NAMETAG_SCOPE); away++; }
  r.aim = { lit, out: away / 60 };
}

r.text = {
  plain: nameTagText({ name: 'Arthur Fowler', friend: true }),
  medic: nameTagText({ name: 'A', friend: true, hp: { hp: 42.9, max: 100 } }, { onFoot: true, kit: 3 }),
  medicEnemy: nameTagText({ name: 'A', friend: false, hp: { hp: 42, max: 100 } }, { onFoot: true, kit: 3 }),
  medicSeated: nameTagText({ name: 'A', friend: true, seated: true, hp: { hp: 42, max: 100 } }, { onFoot: true, kit: 3 }),
  engineer: nameTagText({ name: 'A', friend: true, seated: true, hp: { hp: 30, max: 100, critical: 40 } }, { onFoot: true, kit: 4 }),
  medicInSeat: nameTagText({ name: 'A', friend: true, hp: { hp: 42, max: 100 } }, { onFoot: false, kit: 3 }),
};

r.colour = {
  axis: nameTagRgb({ team: 1 }),
  allies: nameTagRgb({ team: 2 }),
  buddy: nameTagRgb({ team: 2, buddy: true }),
  // sin(2 pi * 0.75) = -1: s = 0, all the light colour.
  carrierTrough: nameTagRgb({ team: 2, carrier: true }, 10.75),
  carrierPeak: nameTagRgb({ team: 2, carrier: true }, 10.25),
  pulseHalf: pulseRgb([0, 0, 0], [255, 255, 255], 0),
};

console.log(JSON.stringify(r));
