// The dogfight arenas (features/dogfight-school, "The school's own page")
// from a small model catalogue, read by the viewer's own `dogfight-arena.js`.
// Prints one JSON blob for `test_dogfight_arena.py`.
//
// The catalogue: a Spitfire and a Bf 109 over Battle of Britain and El
// Alamein (the same pair: one arena), a Ju 88 on Battle of Britain, a Yak 9
// and an Il-2 over Kursk with the Bf 109, a B-17 both sides fly, a tank, and
// a Corsair over Midway with no Axis fighter there (no arena).

import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TOOLS = path.resolve(HERE, '..');
const { installModuleHooks, viewerDir } = await import(pathToFileURL(path.join(TOOLS, 'sim', 'env.mjs')).href);
const viewer = viewerDir(path.join(TOOLS, 'viewer'));
installModuleHooks(viewer);
const A = await import(pathToFileURL(path.join(viewer, 'dogfight-arena.js')).href);

const air = (name, sides, levels) => ({ name, category: 'air', sides, levels });
const rows = [
  air('Spitfire', ['Allied'], ['Battle_of_Britain', 'El_Alamein']),
  air('BF109', ['Axis'], ['Battle_of_Britain', 'El_Alamein', 'Kursk']),
  air('Ju88A', ['Axis'], ['Battle_of_Britain']),
  air('Yak9', ['Allied'], ['Kursk']),
  air('Ilyushin', ['Allied'], ['Kursk']),
  air('B17', ['Allied', 'Axis'], ['Battle_of_Britain', 'Midway']),
  air('Corsair', ['Allied'], ['Midway']),
  { name: 'T34', category: 'land', sides: ['Allied'], levels: ['Kursk'] },
];
const levels = ['Battle_of_Britain', 'El_Alamein', 'Kursk', 'Midway'];
const arenas = A.arenasFrom(rows, levels);
const bob = arenas.find(a => a.map === 'Battle_of_Britain');
const kursk = arenas.find(a => a.map === 'Kursk');
const bf = bob.planes.find(p => p.template === 'BF109');
const url = new URL(A.arenaUrl('/', { map: 'Kursk', side: 'Axis', lesson: 'boom-and-zoom', move: 'dip-1', base: 'http://localhost/dogfight.html' }));
console.log(JSON.stringify({
  arenas: arenas.map(a => ({ map: a.map, allied: a.allied, axis: a.axis, planes: a.planes.map(p => p.template) })),
  planeIn: { chosen: A.planeIn(bob, 'BF109')?.template, missing: A.planeIn(bob, 'Zero')?.template },
  ace: { againstAxis: A.aceAgainst(bob, bf)?.template, againstAllied: A.aceAgainst(kursk, kursk.planes.find(p => p.template === 'Yak9'))?.template },
  url: Object.fromEntries(url.searchParams),
  path: url.pathname,
}));
