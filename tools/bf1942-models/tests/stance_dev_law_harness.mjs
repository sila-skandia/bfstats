// The hand weapon's cone against the server's, by stance and movement
// (test_stance_dev_law.py). Two halves:
//
// 1. The lab fixture (fixtures/stance_dev_bar.json, lab/stance_dev_probe.mjs):
//    the words a sidecar soldier sent, one tick a serial, replayed through
//    the page's DeviationModel the way hand-fire.js feeds it, against the
//    total each of his BAR rounds was drawn in on the server. Once with the
//    misc gate on the jump tick (`jumps`, DEV-15) and once with the page's
//    old gate, every tick in the air (PHY-1's ~21 ticks after the jump).
// 2. A Soldier on flat ground jumps once: `takeJumpTicks` reports the one
//    tick, however long he is in the air, and the model fed from it the way
//    hand-fire.js feeds it raises the channel once.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { installModuleHooks, viewerDir } from '../sim/env.mjs';

const viewer = viewerDir();
installModuleHooks(viewer);
const imp = name => import(pathToFileURL(path.join(viewer, name)).href);
const [{ DeviationModel }, { Soldier }] = await Promise.all([imp('deviation.js'), imp('soldier.js')]);

const here = path.dirname(fileURLToPath(import.meta.url));
const fx = JSON.parse(fs.readFileSync(path.join(here, 'fixtures', 'stance_dev_bar.json'), 'utf8'));
const TICK = 1 / 30;
const ACTION = 2;
const axis = code => (code - 2048) / 2047;

function replay(gate) {
  const model = new DeviationModel({ deviation: fx.deviation });
  const rounds = new Map(fx.rounds);
  const out = [];
  let run = 0, air = 0;
  for (let serial = fx.first; serial <= fx.last; serial++) {
    while (run + 1 < fx.words.length && fx.words[run + 1][0] <= serial) run++;
    const [, b, thr, yaw, stance, phase] = fx.words[run];
    // One word with Action is one jump tick (the probe sends it for one word).
    const jumped = !!(b & ACTION) && stance === 'stand' && fx.words[run][0] === serial;
    if (jumped) air = 21;
    if (rounds.has(serial)) {
      out.push({ serial, phase, server: rounds.get(serial), page: model.stored() });
      model.onShot();
    }
    const state = { stance, throttle: axis(thr), strafe: axis(yaw) };
    if (gate === 'jump') state.jumps = jumped ? 1 : 0;
    else state.jumping = air > 0;
    model.update(TICK, state);
    air = Math.max(air - 1, 0);
  }
  return out;
}

const flatWorld = () => ({
  waterLevel: null,
  surfaceHeight: () => 0,
  heightfield: {
    normal: (x, z, o) => { o[0] = 0; o[1] = 1; o[2] = 0; return o; },
    material: () => 4,
    height: () => 0,
  },
});

function soldierJump() {
  const s = new Soldier({ collider: flatWorld() });
  s.spawn(0, 0, 0, 0);
  for (let i = 0; i < 30; i++) s.step(TICK, {});
  s.takeJumpTicks();
  const model = new DeviationModel({ deviation: fx.deviation });
  const ticks = [];
  for (let i = 0; i < 40; i++) {
    s.step(TICK, i < 3 ? { jump: true } : {});
    const jumps = s.takeJumpTicks();
    model.update(TICK, { stance: s.stance, throttle: 0, strafe: 0, jumps });
    ticks.push({ jumps, grounded: s.grounded, y: Math.round(s.y * 1000) / 1000, total: Math.round(model.stored() * 1e4) / 1e4 });
  }
  return ticks;
}

console.log(JSON.stringify({ jump: replay('jump'), air: replay('air'), soldier: soldierJump() }));
