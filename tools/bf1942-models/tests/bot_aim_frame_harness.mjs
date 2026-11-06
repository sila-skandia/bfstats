// A soldier bot's aim frame past 90 degrees of view pitch (report #8 of
// features/browser-play-feedback-2026-11-06, ledger AI-108 / VIEW-14).
//
// `soldierFrame` took the camera's right as forward x world up, which turns
// over once the view pitch passes 90 degrees (the view's limit is 95 since
// VIEW-14). A bot turning toward something behind it was driven over the
// top, the flipped frame sent it back, and it sat in a two-tick cycle of
// +/-12 degrees of yaw that kept its heading out of the MoveTo cone: the
// "trembling soldiers" of the feedback video. The engine's soldier camera
// pitches about its own right row, which pitch never changes.
//
// Run by `tests/test_bot_aim_frame.py` on the module set `test_bot_ai.py`
// stages. Output is one JSON object on stdout.

import { World, WORLD_TICK_DT } from './world.mjs';
import { BotController } from './bot.js';
import * as aiming from './bot-aim.js';

const DEG = Math.PI / 180;
const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
const r4 = v => Math.round(v * 1e4) / 1e4;

const HOME = [100, 0, -100];
const ENEMY = [100, 0, -220];
const EXTRAS = {
  worldSize: 256,
  controlPoints: [
    { name: 'Home', spawnGroupId: 1, team: 2, position: HOME },
    { name: 'Enemy', spawnGroupId: 2, team: 1, position: ENEMY },
  ],
  soldierSpawns: [
    { name: 'H1', group: 1, team: 2, position: HOME, rotation: [0, 0, 0] },
    { name: 'E1', group: 2, team: 1, position: ENEMY, rotation: [0, 0, 0] },
  ],
  tickets: { 1: 100, 2: 100 },
};
const collider = { waterLevel: null, surfaceHeight() { return 0; }, heightfield: null };

/** The frame either side of 90 degrees: the right row stays level and the
 *  same, the up row stays perpendicular to forward and right. */
function frames() {
  const out = {};
  for (const pitchDeg of [0, 45, 85, 89.9, 90, 90.1, 95, -95]) {
    const { f, r, u } = aiming.soldierFrame(30 * DEG, pitchDeg * DEG);
    const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    out[pitchDeg] = { r: r.map(r4), fr: r4(dot(f, r)), fu: r4(dot(f, u)), ru: r4(dot(r, u)), uu: r4(dot(u, u)) };
  }
  return out;
}

/** A bot looking 85 degrees up turns toward a level point `deg` behind it. */
function turnFromSteep(deg, pitchDeg = 85, ticks = 120) {
  const world = new World({ collider, extras: EXTRAS });
  world.addBotPlayer('bot_0', { team: 2, flag: world.flags[0] });
  const bot = new BotController({ playerId: 'bot_0', world, botSkill: 0.75 });
  const s = world.player('bot_0').soldier;
  s.spawn(s.x, s.y, s.z, 0);
  bot.tick(WORLD_TICK_DT, 0);
  s.pitch = pitchDeg * DEG;
  const yaw0 = s.yaw, want = wrap(yaw0 + deg * DEG);
  const yaws = [s.yaw], pitches = [s.pitch];
  for (let i = 0; i < ticks; i++) {
    bot._resetInput();
    bot._aimLook(want, 0, aiming.AIM_COUNTS_MAX);
    bot._writeInput();
    world.step(WORLD_TICK_DT);
    yaws.push(s.yaw);
    pitches.push(s.pitch ?? 0);
  }
  // A reversal: two successive yaw steps of more than 2 degrees with
  // opposite signs (the tremble's signature, as the investigation counted).
  let reversals = 0, longest = 0, run = 0;
  for (let i = 2; i < yaws.length; i++) {
    const d1 = wrap(yaws[i - 1] - yaws[i - 2]), d2 = wrap(yaws[i] - yaws[i - 1]);
    const flip = d1 * d2 < 0 && Math.abs(d1) > 2 * DEG && Math.abs(d2) > 2 * DEG;
    reversals += flip;
    run = flip ? run + 1 : 0;
    longest = Math.max(longest, run);
  }
  const errs = yaws.map(y => Math.abs(wrap(want - y)) / DEG);
  const settled = errs.findIndex((e, i) => errs.slice(i).every(x => x < 1));
  return {
    reversals, longest, settled,
    finalYawErr: r4(errs.at(-1)),
    finalPitch: r4(pitches.at(-1) / DEG),
    maxPitch: r4(Math.max(...pitches) / DEG),
  };
}

console.log(JSON.stringify({
  frames: frames(),
  behind: turnFromSteep(170),
  behindLeft: turnFromSteep(-150),
  side: turnFromSteep(100),
  down: turnFromSteep(170, -85),
}));
