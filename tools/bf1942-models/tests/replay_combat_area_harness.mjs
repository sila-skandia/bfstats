// The combat area in a round replay, under node: the followed man's warning
// and countdown worked out from where the recording has him, and the deaths
// the area caused (viewer/replay-combat-area.js, ledger CA-2..CA-8).
//
// Same pattern as `replay_hud_harness.mjs`: the viewer's modules imported in
// place through `sim/env.mjs`'s hooks, one JSON report on stdout.

import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { installModuleHooks, viewerDir } from '../sim/env.mjs';

const viewer = viewerDir();
installModuleHooks(viewer);
const imp = name => import(pathToFileURL(path.join(viewer, name)).href);
const [recording, chapters, { CombatArea }, { ReplayCombatArea }, hud] = await Promise.all([
  imp('replay-recording.js'), imp('replay-chapters.js'), imp('combat-area.js'), imp('replay-combat-area.js'),
  imp('replay-hud.js'),
]);

const line = o => JSON.stringify(o);
const q = [0, 0, 0, 1];
// The area: x 100..300, BF1942 z 100..300 (the viewer's -300..-100), and
// a strip of terrain material 7 at x 150..160 inside it (CA-5).
const extras = { worldSize: 2048, combatArea: { min: [100, 0, -100], max: [300, 0, -300] } };
const material = (x, z) => (x >= 150 && x < 160 && z <= -100 && z >= -300 ? 7 : 0);

// pid 3 (nid 50): in the middle until 5 s, then east at 20 m/s, out past x 300
// at 10 s and on; dies at 24 s with no killer (score 4), 14 s out.
// pid 4 (nid 60): out at 10 s, back in at 15 s, out again at 17 s, back at
// 19.5; stands on the material strip from 22 s; killed by pid 3 at 27 s.
// pid 5 (nid 70): out from 2 s and dies at 6 s with no killer: 4 s out is no
// desertion.
const lines = [
  line({ k: 'h', v: 5, start: '', hz: 10 }),
  line({ k: 'roster', t: 0.5, p: [[3, 2, 0, 'runner', 1], [4, 1, 0, 'dodger', 1], [5, 1, 0, 'early', 1]] }),
];
for (const [pid, nid] of [[3, 50], [4, 60], [5, 70]]) {
  lines.push(line({ k: 'e', t: 1, e: 'createObject', tid: 1763, netId: nid, tmpl: 'USSoldier', pos: [200, 1, 200], rot: [0, 0, 0] }));
  lines.push(line({ k: 'e', t: 1, e: 'control', pid, netId: nid }));
  lines.push(line({ k: 'o', t: 1, id: nid, gid: nid, tmpl: 'USSoldier', tid: 1763, team: pid === 3 ? 2 : 1, maxhp: 30 }));
  lines.push(line({ k: 'a', t: 1, a: [[nid, 30, -1]] }));
}
const xOf3 = t => (t < 5 ? 200 : 200 + (t - 5) * 20);
const xOf4 = t => {
  if (t >= 22) return 155;
  if (t >= 10 && t < 15) return 320;
  if (t >= 17 && t < 19.5) return 320;
  return 250;
};
for (let i = 0; i <= 300; i++) {
  const t = +(1 + i * 0.1).toFixed(1);
  const o = [];
  if (t < 24) o.push([50, xOf3(t), 2, 200, ...q]);
  if (t < 27) o.push([60, xOf4(t), 2, 200, ...q]);
  if (t < 6) o.push([70, t >= 2 ? 50 : 200, 2, 200, ...q]);
  lines.push(line({ k: 's', t, o }));
}
lines.push(line({ k: 'a', t: 6, a: [[70, 0, -1]] }));
lines.push(line({ k: 'e', t: 6, e: 'score', kind: 4, pid: 5, victim: 5 }));
lines.push(line({ k: 'a', t: 24, a: [[50, 0, -1]] }));
lines.push(line({ k: 'e', t: 24, e: 'score', kind: 4, pid: 3, victim: 3 }));
lines.push(line({ k: 'a', t: 27, a: [[60, 0, -1]] }));
lines.push(line({ k: 'e', t: 27, e: 'score', kind: 3, pid: 3, victim: 4, weaponName: 'Bar1918' }));
lines.push(line({ k: 'e', t: 30, e: 'setLevel', level: 'bf1942/levels/test/', mode: 'conquest.con', nameTags: [50, 300] }));
lines.push(line({ k: 'end', t: 31 }));
const rec = recording.parseRecording(lines.join('\n'));
const kills = chapters.killsOf(rec, []);
const area = new CombatArea(extras);
const fresh = () => new ReplayCombatArea(rec, { area, material, kills });

const results = { nameTags: rec.nameTags ?? null };
const at = [3, 9.9, 10.5, 11.2, 15, 19.9, 20.2, 23.5];
{
  const ra = fresh();
  results.runner = Object.fromEntries(at.map(t => [t, ra.readout(3, t)]));
}
// The same instants each on a fresh reader (a seek), and a frame-by-frame
// run (the carry) agree.
{
  const seq = fresh();
  const mismatches = [];
  for (let i = 0; i <= 260; i++) {
    const t = +(1 + i * 0.1 + 0.017).toFixed(3);
    for (const pid of [3, 4]) {
      const a = seq.readout(pid, t);
      const b = fresh().readout(pid, t);
      if (a.countdown !== b.countdown || a.damaging !== b.damaging) mismatches.push({ pid, t, a, b });
    }
  }
  results.carryMismatches = mismatches.slice(0, 5);
  results.carryMismatchCount = mismatches.length;
}
{
  const ra = fresh();
  results.dodger = Object.fromEntries([12.5, 15.5, 18.5, 21, 23.5, 26.5].map(t => [t, ra.readout(4, t)]));
}
results.desertions = fresh().desertions(kills).map(d => ({ victim: d.kill.victim, t: d.kill.t, outsideFor: +d.outsideFor.toFixed(2) }));
// No level area: nothing is ever outside.
results.inactive = new ReplayCombatArea(rec, { area: null, kills }).readout(3, 23);

// The HUD's variables (replay-hud.js `feedOutside`, `clear`).
{
  const h = new hud.ReplayHud({ rec, ctx: {}, followPid: 3 });
  const vars = {};
  h.feedOutside(vars, { countdown: 7 });
  results.vars = { ...vars };
  h.written = 'foot';
  h.clear(vars);
  results.cleared = vars['Outside/OutsideTime'];
}

process.stdout.write(JSON.stringify(results));
