/**
 * A vehicle gun's burst edges, from the trigger to the rack: what a press and
 * a stop play (ledger SND-12, SND-14).
 *
 * `gun-cycle.js` `releaseTick` is `FireArms::updateSound` (lnxded
 * `0x0828cc10`, client `0x00539fb0`): once the last round is more than
 * `RELEASE_AFTER` old and the trigger is not held, the burst releases, once,
 * with MG distance only when its 0.5..1.5 s gate has opened. The page hands
 * that to the rack (`map.html` `guns.onRelease`), which triggers the gun's
 * Release, Shell Bounce and MG-distance patches (`vehicle-audio.js`
 * `release`). Both halves were built in 75edb204 with no test between them,
 * and the edges never sounded on any tree: `ssc-specs.js` rebuilt each gun
 * spec without `press` and `release`, so the rack built no edge patches. This
 * runs the two halves together, the way the page wires them.
 *
 * Stub Web Audio, no browser. Run by `tests/test_gun_burst_edges.py`.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { advanceGroups, RELEASE_AFTER } from '../viewer/gun-cycle.js';
import { VehicleAudioRack } from '../viewer/vehicle-audio.js';
import { findWeaponSpecs, findWeaponSpecsByFireArms } from '../viewer/ssc-specs.js';

function stubCtx() {
  const param = (initial = 0) => ({
    value: initial,
    setTargetAtTime(v) { this.value = v; },
    setValueAtTime(v) { this.value = v; },
    linearRampToValueAtTime(v) { this.value = v; },
  });
  const node = (extra = {}) => ({ connect() { return this; }, disconnect() {}, ...extra });
  const ctx = {
    started: [],
    currentTime: 0,
    state: 'running',
    createGain() { return node({ gain: param(0) }); },
    createPanner() {
      return node({
        positionX: param(0), positionY: param(0), positionZ: param(0),
        refDistance: 1, rolloffFactor: 0,
      });
    },
    createBufferSource() {
      return node({
        buffer: null, loop: false, playbackRate: param(1),
        start() { ctx.started.push(this); },
        stop() { this.stopped = true; },
        onended: null,
      });
    },
  };
  return ctx;
}

/** A node the rack can find by name and place. */
function sceneNode(name, x = 0) {
  const node = {
    name,
    uuid: name,
    userData: { control: name },
    matrixWorld: { elements: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, 0, 0, 1] },
    children: [],
    updateWorldMatrix() {},
    getObjectByName(n) {
      if (node.name === n) return node;
      for (const child of node.children) {
        const found = child.getObjectByName(n);
        if (found) return found;
      }
      return null;
    },
    traverse(fn) {
      fn(node);
      for (const child of node.children) child.traverse(fn);
    },
  };
  return node;
}

const shot = file => ({
  file, loop: false, volume: 1, modulators: [], relativePosition: [0, 0, 0], doppler: false,
});

// DC's M2A3 Bushmaster in the shape `extract_map._trigger_slots` ships: the
// rounds' own one-shot, a spin-up the latched Fire Loop plays once a press,
// and the three slots a stop triggers.
const M2A3 = {
  template: 'M2A3', engine: null, layers: [],
  weapons: [{
    fireArms: 'M2A3_Bushmaster',
    script: 'Bushmaster.ssc',
    layers: [shot('autocannon_loop_st.mp3')],
    press: [shot('spinup.mp3')],
    release: {
      2: [shot('bushmaster_release.mp3')],
      3: [shot('tigerrev.mp3')],
      4: [shot('autocannon_dist.mp3')],
    },
  }],
};

async function rig() {
  const ctx = stubCtx();
  const listener = { context: ctx, getInput: () => ctx.createGain(), position: { x: 0, y: 0, z: 0 } };
  const rack = new VehicleAudioRack({
    listener: () => listener,
    getBuffer: async (_dir, file) => ({ file, duration: 1 }),
    report: () => ({ sounds: { vehicles: [M2A3] } }),
    dir: () => 'dc_basrahs_edge',
    master: () => 1,
  });
  const hull = sceneNode('M2A3', 5);
  const gunNode = sceneNode('M2A3_Bushmaster', 5);
  gunNode.userData.fireArms = true;
  hull.children.push(gunNode);
  const group = {
    node: gunNode, emitters: [], firing: false, cooldown: 0, recoil: null,
    stats: { roundOfFire: 5.7 },
  };
  const released = [];
  let draws = 0;
  const guns = {
    groups: [group],
    rand: () => [0.9, 0.1, 0.4][draws++ % 3],
    // `gunfire.js` `fireShot`'s sound half: the round reaches the rack, and
    // `Fire` opens the burst for `updateSound`.
    fireShot(g) {
      g.rounds = (g.rounds ?? 0) + 1;
      rack.trigger(g.node);
      g.sinceRound = 0;
      g.soundHeld = true;
      g.soundReleased = false;
    },
    // `map.html` `guns.onRelease`, the vehicle half.
    onRelease(g, info) {
      released.push({ at: clock, ...info });
      rack.release(g.node, info);
    },
  };
  rack.claim({ seatKey: 'gunner', node: hull, template: 'M2A3', drive: null, groups: [group] });
  for (let i = 0; i < 8; i++) await new Promise(r => setTimeout(r, 0));
  let clock = 0;
  const run = (seconds, dt = 1 / 30) => {
    for (let t = 0; t < seconds - 1e-9; t += dt) {
      clock += dt;
      advanceGroups(guns, dt);
      rack.update(dt, { x: 0, y: 0, z: 0 });
    }
  };
  const played = () => ctx.started.map(s => s.buffer.file);
  return { ctx, rack, group, guns, released, run, played };
}

{
  // A held burst: one spin-up, a report per round, and nothing released
  // while the trigger is held -- `handleMessage` marks it held every tick.
  const { group, run, played, released } = await rig();
  group.firing = true;
  run(1.0);
  const plays = played();
  assert.equal(plays.filter(f => f === 'spinup.mp3').length, 1, 'the spin-up plays once a press');
  assert.ok(plays.filter(f => f === 'autocannon_loop_st.mp3').length >= 4,
    'every round plays the report (5.7 rounds a second, held a second)');
  assert.equal(released.length, 0, 'a held trigger never releases between its rounds');

  // Let go: one release, RELEASE_AFTER behind the last round, playing
  // Release and Shell Bounce. MG distance's gate starts at 1 s, so the first
  // release a second in plays it too, and re-rolls it.
  group.firing = false;
  run(0.5);
  assert.equal(released.length, 1, 'one release per burst');
  const after = played();
  assert.equal(after.filter(f => f === 'bushmaster_release.mp3').length, 1, 'Release (slot 2) plays');
  assert.equal(after.filter(f => f === 'tigerrev.mp3').length, 1, 'and Shell Bounce (slot 3)');
  assert.equal(after.filter(f => f === 'autocannon_dist.mp3').length, released[0].distance ? 1 : 0,
    'MG distance (slot 4) plays exactly when its gate says');
  assert.ok(released[0].distance, 'the 1 s gate the FireArms starts with has opened');

  // A second burst straight after: the gate was re-rolled to rand() + 0.5 =
  // 1.4 s, so this release keeps slot 4 quiet.
  group.firing = true;
  run(0.4);
  group.firing = false;
  run(0.3);
  assert.equal(released.length, 2, 'the next burst releases again');
  assert.equal(released[1].distance, false, 'inside the re-rolled gate, no MG distance');
  const twice = played();
  assert.equal(twice.filter(f => f === 'spinup.mp3').length, 2, 'and the next press spins up again');
  assert.equal(twice.filter(f => f === 'autocannon_dist.mp3').length, 1, 'slot 4 still once');
  assert.equal(twice.filter(f => f === 'tigerrev.mp3').length, 2, 'slot 3 once per release');
}

{
  // A single shot -- one pull, let go -- releases once, RELEASE_AFTER after
  // it. (D9 expected a held M2A3 to release between its 5.7 rounds a second;
  // `releaseTick`'s later reading of `handleMessage` 0x08289907 marks the
  // trigger held on every tick it is down, so a held gun never does, and the
  // first block above holds that.)
  const { group, run, released } = await rig();
  group.firing = true;
  run(1 / 30);
  group.firing = false;
  run(RELEASE_AFTER - 1 / 60);
  assert.equal(released.length, 0, 'not before RELEASE_AFTER has passed');
  run(2 / 30);
  assert.equal(released.length, 1, 'a single shot releases once it has');
  run(1);
  assert.equal(released.length, 1, 'and only once until the next round');
}

{
  // A gun the rack holds no patch for releases into nothing, quietly; and a
  // gun whose table predates the edges (no `press`, no `release`) still
  // fires its rounds.
  const { rack } = await rig();
  assert.doesNotThrow(() => rack.release(sceneNode('Nobody'), { distance: true }));
  const old = { ...M2A3.weapons[0] };
  delete old.press;
  delete old.release;
  const { loadBurstEdges } = await import('../viewer/vehicle-audio.js');
  const edges = await loadBurstEdges(old, {
    listener: { context: stubCtx(), getInput: () => ({ connect() {} }) },
    getBuffer: async () => ({ duration: 1 }),
  });
  assert.equal(edges.press, null, 'no press patch for an old table');
  assert.equal(edges.release.size, 0, 'and no release patches');
}

{
  // The lookups hand the rack the whole gun. They used to rebuild each spec
  // without `press` and `release`, so `loadBurstEdges` found no edges on any
  // tree and no stop ever sounded -- vanilla's scenes have carried them since
  // the 10-03 sounds patch. Both roads: by the hull's template, and by the
  // FireArms name a bare furniture mount is found under.
  const extras = { sounds: { vehicles: [M2A3] } };
  for (const spec of [findWeaponSpecs(extras, 'M2A3')[0],
                      findWeaponSpecsByFireArms(extras, ['M2A3_Bushmaster'])[0]]) {
    assert.deepEqual(Object.keys(spec.release), ['2', '3', '4'], 'the release slots reach the rack');
    assert.equal(spec.press.length, 1, 'and the press');
  }
}

// --- and over the real shipped data ------------------------------------------
//
// Every extracted level's guns that carry edges: one press and one stop each,
// through the rack. Every edge sample the table names must start (slot 4 with
// its gate open). Skips without a tree; `BURST_EDGES_MAPS` points it at
// another one (a mod's, or a scratch tree a sounds-layer patch was written to).

{
  const mapsDir = process.env.BURST_EDGES_MAPS
    ? pathToFileURL(`${path.resolve(process.env.BURST_EDGES_MAPS)}/`)
    : new URL('../viewer/maps/', import.meta.url);
  let levels = [];
  try {
    levels = fs.readdirSync(mapsDir).filter(
      name => fs.existsSync(new URL(`${name}/scene.json`, mapsDir)));
  } catch (_) { levels = []; }
  const missing = [];
  let guns = 0;
  let edgeSamples = 0;
  for (const level of levels) {
    const scene = JSON.parse(fs.readFileSync(new URL(`${level}/scene.json`, mapsDir), 'utf8'));
    for (const vehicle of scene.sounds?.vehicles ?? []) {
      const armed = (vehicle.weapons ?? []).filter(w => w.press?.length || w.release);
      if (!armed.length) continue;
      const ctx = stubCtx();
      const listener = { context: ctx, getInput: () => ctx.createGain(), position: { x: 0, y: 0, z: 0 } };
      const rack = new VehicleAudioRack({
        listener: () => listener,
        getBuffer: async (_dir, file) => ({ file, duration: 1 }),
        report: () => ({ sounds: { vehicles: [vehicle] } }),
        dir: () => level,
        master: () => 1,
      });
      const hull = sceneNode(vehicle.template, 0);
      const nodes = armed.map(w => {
        const node = sceneNode(w.fireArms, 0);
        node.userData.fireArms = true;
        hull.children.push(node);
        return node;
      });
      rack.claim({ seatKey: 'sweep', node: hull, template: vehicle.template, drive: null,
                   groups: nodes.map(node => ({ node })) });
      for (let i = 0; i < 8; i++) await new Promise(r => setTimeout(r, 0));
      armed.forEach((weapon, i) => {
        const before = ctx.started.length;
        rack.trigger(nodes[i]);
        rack.release(nodes[i], { distance: true });
        const files = new Set(ctx.started.slice(before).map(s => s.buffer.file));
        const want = [...(weapon.press ?? []),
                      ...Object.values(weapon.release ?? {}).flat()].filter(l => !l.loop);
        // A `randomPlay` patch plays one load a trigger, and a `trigger
        // Volume` layer waits for its own gate, so neither is owed here.
        for (const layer of want) {
          if (layer.randomPlay || layer.trigger === 'volume' || layer.trigger === 'release') continue;
          edgeSamples += 1;
          if (!files.has(layer.file)) missing.push(`${level} ${vehicle.template} ${weapon.fireArms} ${layer.file}`);
        }
        guns += 1;
      });
      rack.dispose();
    }
  }
  assert.equal(missing.length, 0, `edge samples a press and a stop did not start:\n  ${missing.slice(0, 12).join('\n  ')}`);
  console.log(`  swept ${levels.length} level(s): ${guns} gun(s) with edges, ${edgeSamples} edge sample(s) started`);
}

console.log('gun-burst-edges: all assertions passed');
