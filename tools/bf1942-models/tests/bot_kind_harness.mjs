// Pins which control a bot gives a hull: an aircraft's only when the hull's
// AI template is typed ITAir (`bot-rows.js` `botKind`), and a land unit on an
// aircraft's drive writes the car law's throttle and steer onto the channels
// the world's air branch reads (`bot-aim.js` `writeInput`).
//
// Galactic Conquest's Speederbike hovers on `c_ETPlane` engines, so its drive
// is the page's `Aircraft`, and its AI template is vanilla's `Willy`. Flown
// with the plane law its driver held a takeoff run that never ends, out of
// the level and into the ground at 107 m/s.
//
// The viewer modules load straight out of `viewer/` through the runner's
// module hooks (`sim/env.mjs`). Run by `tests/test_bot_kind.py`. One JSON
// object on stdout.

import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadViewerModules, viewerDir } from '../sim/env.mjs';

const viewer = viewerDir();
await loadViewerModules(viewer);
const imp = name => import(pathToFileURL(path.join(viewer, name)).href);
const { botKind } = await imp('bot-rows.js');
const { writeInput } = await imp('bot-aim.js');

const WILLY = { types: ['ITBiological', 'ITGround', 'ITMobile'] };
const SPITFIRE = { types: ['ITBiological', 'ITUnit', 'ITMobile', 'ITAir'] };

/** What `writeInput` hands the world for a driver holding `forward` / `strafe`. */
function written(vehicle, extra = {}) {
  let got = null;
  const bot = {
    moveForward: 0.8, moveStrafe: -0.5, lookX: 0, lookY: 0, isFiring: false,
    weapons: [], weaponIndex: 0, input: {}, playerId: 'b', vehicle,
    world: { setInput: (id, input) => { got = input; } },
    ...extra,
  };
  writeInput(bot);
  return got;
}

const out = {
  kinds: {
    speederbike: botKind('air', WILLY),
    spitfire: botKind('air', SPITFIRE),
    jeep: botKind('ground', WILLY),
    tank: botKind('tank', WILLY),
    ship: botKind('ship', { types: ['ITNaval'] }),
    gun: botKind('gun', { types: ['ITGround'] }),
    noTypes: botKind('air', {}),
    noRecord: botKind('air', null),
  },
  // The Speederbike's driver: a land unit on an aircraft's drive.
  hover: written({ kind: 'ground', airframe: true, drives: true }),
  // A jeep's driver: the land branch's own pair, nothing on the air channels.
  jeep: written({ kind: 'ground', airframe: false, drives: true }),
  // A pilot: the plane law's channels, the land pair zeroed.
  pilot: written({ kind: 'air', airframe: true, drives: true },
    { _airInput: { power: 1, rudder: 0.25, roll: -0.5, pitch: 0.75 } }),
};
console.log(JSON.stringify(out));
