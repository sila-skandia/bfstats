#!/usr/bin/env node
// Build hulls.json: what a hull's ghost body depends on that is a template
// value and not on the wire, read from the extracted models' root extras.
//
//   node sidecar/build-hulls.mjs [viewer/models] [sidecar/hulls.json]
//
// SimpleObjectNetworkable::setNetUpdate (0x08236d00) reads two things whose
// size the template decides:
//   * the hit points (mask 0x10) as readUnsigned(0, round(armor max)): the
//     Armor's getMaxHitPoints (vtable +0x14), which spawns at the template's
//     maxHitPoints (armor.js, HP-17). A Hatsuzuki (300) sends 9 bits, a
//     Daihatsu (150) 8, a Defgun (50) 6;
//   * the controller vectors (0x4/0x20/0x8/0x40/0x100/0x200) and the flag
//     (0x80) only when the physics node's vtable +0xe0 says it moves. A fixed
//     gun (hasMobilePhysics 0: Defgun, AA_Allies) skips them even with the
//     mask bit set: its mask-0x493 body carries no flag bit, and reading one
//     halved its hit points (50 -> 25 against the client's own 50).

import fs from 'node:fs';
import path from 'node:path';
import { JOINT_PARTS } from './ghost/children.mjs';

const dir = process.argv[2] ?? path.join('viewer', 'models');
const outPath = process.argv[3] ?? path.join('sidecar', 'hulls.json');

function readGlb(file) {
  const b = fs.readFileSync(file);
  if (b.readUInt32LE(0) !== 0x46546c67) return null;
  return JSON.parse(b.subarray(20, 20 + b.readUInt32LE(12)).toString('utf8'));
}
function rootExtras(j) {
  const root = j.scenes?.[0]?.nodes?.[0];
  return root != null ? j.nodes[root]?.extras ?? null : null;
}
// Where each named part's pivot sits at rest in the root's frame, BF1942's
// axes (the glb's z negated): the sum of its chain's translations, which is
// exact while the chain has no rest rotation, as the turret parts do not. A
// gun fires from its pitch part's pivot: the client's own rounds leave a
// Sherman at (0, 1.15, 0.77) in the hull's frame, ShermanGunBase's place.
function partPivots(j, names) {
  const parent = {};
  j.nodes.forEach((n, i) => (n.children || []).forEach((c) => { parent[c] = i; }));
  const out = {};
  j.nodes.forEach((n, i) => {
    if (!names.has(n.name) || out[n.name]) return;
    const p = [0, 0, 0];
    for (let k = i; k != null && k !== j.scenes[0].nodes[0]; k = parent[k]) {
      const t = j.nodes[k].translation || [0, 0, 0];
      p[0] += t[0]; p[1] += t[1]; p[2] += t[2];
    }
    out[n.name] = [+p[0].toFixed(3), +p[1].toFixed(3), +(-p[2]).toFixed(3)];
  });
  return out;
}

const hulls = {};
for (const f of fs.readdirSync(dir)) {
  if (!f.endsWith('.glb') || f.split('.').length > 2) continue;
  let j, ex;
  try { j = readGlb(path.join(dir, f)); ex = j && rootExtras(j); } catch { continue; }
  if (!ex?.armor?.hasArmor) continue;
  const name = f.slice(0, -4);
  const maxHp = Math.ceil(ex.armor.maxHitpoints ?? ex.armor.hitpoints ?? 10);
  const mobile = ex.physics?.hasMobilePhysics !== false;
  const names = new Set(Object.values(JOINT_PARTS[name] ?? {}).flat().map((p) => p[0]));
  const parts = names.size ? partPivots(j, names) : null;
  hulls[name] = { maxHp, ...(mobile ? {} : { mobile: false }), ...(parts ? { parts } : {}) };
}
fs.writeFileSync(outPath, JSON.stringify(hulls, null, 1) + '\n');
console.log(`${Object.keys(hulls).length} hulls -> ${outPath}`);
