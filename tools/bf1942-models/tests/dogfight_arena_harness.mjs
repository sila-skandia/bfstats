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
// BF1918's teams from its levels' spawners (`dogfight-arenas.json`), where
// the catalogue's WWII sides pair nothing: a Camel against a red triplane,
// a SPAD against a triplane on two levels (one arena), a level whose team 2
// has only a two-seater (no arena), and a level the tree does not hold.
const L = await import(pathToFileURL(path.join(viewer, 'dogfight-lessons.js')).href);
const teams = A.arenasFromTeams({ version: 1, levels: {
  montfaucon: { 1: ['FokkerRed'], 2: ['Sopwith', 'Breguet14'] },
  battle_of_the_vosges: { 1: ['Fokker'], 2: ['Spad7'] },
  nebelberg: { 1: ['Fokker'], 2: ['Spad7'] },
  galicia: { 1: ['Albatross', 'AlbatrossC3'], 2: ['AircoDH4_Brit'] },
  elsewhere: { 1: ['Fokker'], 2: ['Spad7', 'neuport11'] },
} }, ['Montfaucon', 'battle_of_the_vosges', 'nebelberg', 'galicia']);
const ranks = Object.fromEntries(['Spad7', 'FokkerRed', 'Sopwith', 'AlbatrossC3', 'Albatross', 'AircoDH4_Brit', 'Gotha', 'Spitfire', 'se5']
  .map(n => [n, L.fighterRank(n)]));
console.log(JSON.stringify({
  teams: teams.map(a => ({ map: a.map, allied: a.allied, axis: a.axis, planes: a.planes.map(p => p.template) })), ranks,
  arenas: arenas.map(a => ({ map: a.map, allied: a.allied, axis: a.axis, planes: a.planes.map(p => p.template) })),
  planeIn: { chosen: A.planeIn(bob, 'BF109')?.template, missing: A.planeIn(bob, 'Zero')?.template },
  ace: { againstAxis: A.aceAgainst(bob, bf)?.template, againstAllied: A.aceAgainst(kursk, kursk.planes.find(p => p.template === 'Yak9'))?.template },
  url: Object.fromEntries(url.searchParams),
  path: url.pathname,
}));
