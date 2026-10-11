// `viewer/hand-alt-fire.js` under node: a knife's stab on the right button.
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { installModuleHooks, viewerDir } from '../sim/env.mjs';

const viewer = viewerDir();
installModuleHooks(viewer);
const alt = await import(pathToFileURL(path.join(viewer, 'hand-alt-fire.js')).href);

// `CommandoKnifeStab`'s own words, as the exporter files them.
const STAB = { roundOfFire: 1.6, throw: { fireDelay: 0.3 }, input: 'c_PIAltFire', magSize: -1 };
const results = {};

function rig(fireArms = STAB) {
  const group = { shots: 0, firing: false };
  const log = [];
  const fire = (g, on) => { g.firing = on; log.push(on); };
  return { group, log, fire, machine: alt.createAlt(group, fireArms, 'CommandoKnifeStab') };
}
const dt = 1 / 60;

results.spec = (() => {
  const { machine } = rig();
  return { delay: machine.delay, cycle: machine.cycle, name: machine.name };
})();
results.bayonet = (() => {
  const { machine } = rig({ roundOfFire: 1.3, throw: { fireDelay: 0.12 } });
  return { delay: machine.delay, cycle: +machine.cycle.toFixed(4) };
})();

// One press: nothing for fireDelay, then a pull held until the round exists.
{
  const { group, fire, machine, log } = rig();
  const began = [];
  let pulledAt = null;
  for (let i = 0; i < 90; i++) {
    const out = alt.stepAlt(machine, dt, { pressed: i === 0, ready: true, fire });
    if (out.began) began.push(i);
    if (pulledAt === null && group.firing) pulledAt = i * dt;
    if (group.firing && i * dt > 0.31) group.shots += 1;     // the gun made its round
  }
  results.onePress = { began, pulledAt: +pulledAt.toFixed(3), log, cool: +machine.cool.toFixed(3) };
}

// A second press inside the cycle is spent on nothing; one after it stabs.
{
  const { group, fire, machine } = rig();
  let stabs = 0;
  for (let i = 0; i < 240; i++) {
    const t = i * dt;
    const pressed = i === 0 || i === 20 || i === 60;       // 0 s, 0.33 s (in the swing), 1.0 s (cycle 0.625)
    const out = alt.stepAlt(machine, dt, { pressed, ready: true, fire });
    if (out.began) stabs += 1;
    if (group.firing) group.shots += 1;
  }
  results.cycle = { stabs };
}

// Not ready (mid-reload, mid-throw, no pointer): the press is spent, nothing begins.
{
  const { fire, machine } = rig();
  const out = alt.stepAlt(machine, dt, { pressed: true, ready: false, fire });
  results.notReady = { began: out.began, spent: out.spent, wind: machine.wind };
}

// A weapon put away mid-swing swings no more.
{
  const { group, fire, machine } = rig();
  alt.stepAlt(machine, dt, { pressed: true, ready: true, fire });
  alt.stopAlt(machine, fire);
  for (let i = 0; i < 60; i++) alt.stepAlt(machine, dt, { pressed: false, ready: true, fire });
  results.stopped = { firing: group.firing, wind: machine.wind, pulse: machine.pulse };
}

// A round that never comes is let go at the ceiling.
{
  const { group, fire, machine } = rig({ roundOfFire: 1, throw: { fireDelay: 0 } });
  alt.stepAlt(machine, dt, { pressed: true, ready: true, fire });
  const first = group.firing;
  for (let i = 0; i < 30; i++) alt.stepAlt(machine, dt, { pressed: false, ready: true, fire });
  results.ceiling = { first, after: group.firing };
}
process.stdout.write(JSON.stringify(results));
