// The rocket pack's flame under node (viewer/rocket-flame.js): both of the
// pack's bundles burn together and are put out together.
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { installModuleHooks, viewerDir } from '../sim/env.mjs';

const viewer = viewerDir();
installModuleHooks(viewer);
const flame = await import(pathToFileURL(path.join(viewer, 'rocket-flame.js')).href);

const log = [];
const effects = {
  has: name => ['e_RocketPack', 'e_RocketPackDefault'].includes(name),
  play: (name, opts) => {
    log.push(['play', name, opts.attach.object.id]);
    return { stop: () => log.push(['stop', name]) };
  },
};
let now = 0;
const flames = new flame.RocketFlames(effects, () => now);
const node = { id: 'pack' };
flames.set('a', node, true);
flames.set('a', node, true);                  // already burning: nothing new
now = 0.05;
flames.set('a', node, false);                 // inside the hold: still burning
const held = log.length;
now = 0.5;
flames.set('a', node, false);                 // past it: both out
flames.set('b', node, true);
flames.clear('b');

// The pack's nozzles go toward his feet whichever pose file the figure came from.
const fake = (name, y, extra = {}) => {
  const e = new Array(16).fill(0); e[12] = 0; e[13] = y; e[14] = 0;
  return { name, userData: {}, children: [], matrixWorld: { elements: e }, ...extra,
    traverse(fn) { fn(this); this.children.forEach(c => c.traverse(fn)); } };
};
const figure = zUp => {
  const root = fake('root', 0);
  const pack = fake('', 1.4, {
    quaternion: { x: 0, y: 0, z: -1, w: 0, set(x, y, z, w) { Object.assign(this, { x, y, z, w }); } },
  });
  pack.userData = { kitPart: true, kitSlot: 'back' };
  pack.matrixWorld.elements[9] = zUp ? 0.9 : -0.9;      // the part's +Z, world y
  pack.children.push(fake('GermanElite_RocketPack', 1.4));
  root.children.push(fake('Bip01_Pelvis', 1.0), fake('Bip01_Head', 1.6), pack);
  return { root, pack };
};
const up = figure(true); const down = figure(false);
flame.orientRocketPack(up.root); flame.orientRocketPack(down.root);
const q = n => [n.quaternion.x, n.quaternion.y, n.quaternion.z, n.quaternion.w].map(v => Math.round(v * 1e6) / 1e6 + 0);
const orient = { turned: q(up.pack), kept: q(down.pack) };
flame.orientRocketPack(up.root);                       // once only
orient.again = q(up.pack);
process.stdout.write(JSON.stringify({ log, held, orient }));
