// Writes core/src/test/resources/parity/derive-children.json.gz: what
// ghost/derive-children.mjs deriveLevel makes of a level's template graph
// (every hull spec, seat, joint, hull and soldier), for the graphs under
// resources/parity/graphs. A graph is bf42/template_table.py's replay of the
// level load (sidecar_tid_table.py --graph), taken once from this PC's
// install and then committed (--refresh-graphs takes them again).
//   node parity/derive-children.mjs [--refresh-graphs]
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { RES, SIDECAR, MODELS, gunzip, writeGz } from './lib.mjs';

const GRAPHS = [['bf1942', 'wake', 'coop'], ['bf1942', 'el_alamein', 'coop'], ['desertcombat', 'el_alamein', 'conquest']];
const { deriveLevel, graphFromJson, walk, armorMax } = await import(path.join(SIDECAR, 'ghost/derive-children.mjs'));

const out = {};
for (const [mod, level, mode] of GRAPHS) {
  const file = path.join(RES, 'graphs', mod, `${level}-${mode}.graph.json.gz`);
  if (!fs.existsSync(file) || process.argv.includes('--refresh-graphs')) {
    try {
      const j = JSON.parse(execFileSync(process.env.SIDECAR_PYTHON || 'python3', [path.join(MODELS, 'sidecar_tid_table.py'), '--mod', mod, '--level', level, '--mode', `${mode}.con`, '--graph'],
        { encoding: 'utf8', maxBuffer: 256 << 20, stdio: ['ignore', 'pipe', 'ignore'] }));
      writeGz(file, JSON.stringify(j.graph));
    } catch (e) {
      if (!fs.existsSync(file)) throw new Error(`no install to take the ${mod} ${level} ${mode} graph from, and no committed copy`);
    }
  }
  const graph = JSON.parse(gunzip(file));
  const g = graphFromJson(graph);
  // The walk of every PlayerControlObject as well: its grouped nodes and seats.
  const walks = {};
  for (const t of g.templates.values()) {
    if (t.cls !== 'playercontrolobject') continue;
    const w = walk(g, t.name);
    walks[t.name] = { nodes: w.nodes.map((n) => [n.letter, n.name, n.members ?? null, n.groupedWith ?? null]), seats: w.seats.map((s) => [s.name, s.nodes.map((n) => n.name)]), missing: w.missing, armor: armorMax(w.root) };
  }
  out[`${mod}/${level}-${mode}`] = { derived: JSON.stringify(deriveLevel(graph)), walks: JSON.stringify(walks) };
}
writeGz(path.join(RES, 'derive-children.json.gz'), JSON.stringify(out));
console.log(Object.keys(out).join(', '));
