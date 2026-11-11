// Every tree's dogfight arenas and the two planes each flies its lessons on
// by default (yours, its best Allied fighter, `planeIn`; the ace, the other
// side's best, `aceAgainst`; each on its own airframe, as
// `dogfight-school-page.js` `loadModels` builds them), read from the
// published catalogues on mesh.bfstats.io with the viewer's own
// `dogfight-arena.js`. Prints `{ <mod>: [{ map, you, ace }] }`, or with
// `--specs` every `<mod>:<template>` among them, for `airframe_fixture.py`.
//
//   node surveys/dogfight_arena_airframes.mjs bf1942 xpack1 xpack2 bf1918 \
//     desertcombat fh fhsw > arenas.json
//
// `tests/fixtures/arena-airframes.json.gz` is `airframe_fixture.py
// --qualified` over every `<mod>:<airframe>` here, with this map as its
// `arenas` (features/dogfight-doctrine, "The hunter on every arena").
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
const TOOLS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { installModuleHooks, viewerDir } = await import(pathToFileURL(path.join(TOOLS, 'sim', 'env.mjs')).href);
const viewer = viewerDir(path.join(TOOLS, 'viewer'));
installModuleHooks(viewer);
const A = await import(pathToFileURL(path.join(viewer, 'dogfight-arena.js')).href);
const SITE = 'https://mesh.bfstats.io';
const get = async u => { const r = await fetch(`${SITE}/${u}`); if (!r.ok) throw new Error(`${u} ${r.status}`); return r.json(); };
const out = {};
const specs = process.argv.includes('--specs');
for (const mod of process.argv.slice(2).filter(a => !a.startsWith('--'))) {
  const [models, maps] = mod === 'bf1942' ? ['models', 'maps'] : [`models/mods/${mod}`, `maps/mods/${mod}`];
  const [rows, levels, teams] = await Promise.all([get(`${models}/models.json`), get(`${maps}/maps.json`), get(`${maps}/dogfight-arenas.json`).catch(() => null)]);
  const names = levels.map(l => l.name);
  const byTeams = teams ? A.arenasFromTeams(teams, names) : [];
  const arenas = byTeams.length ? byTeams : A.arenasFrom(rows, names);
  out[mod] = arenas.map(a => {
    const you = A.planeIn(a, null), ace = A.aceAgainst(a, you);
    return { map: a.map, you: `${mod}:${you.template}`, ace: `${mod}:${ace.template}` };
  });
}
if (specs) console.log([...new Set(Object.values(out).flat().flatMap(r => [r.you, r.ace]))].join(' '));
else console.log(JSON.stringify(out, null, 0));
