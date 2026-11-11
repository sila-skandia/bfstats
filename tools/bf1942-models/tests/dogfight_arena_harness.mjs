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
const ranks = Object.fromEntries(['Spad7', 'FokkerRed', 'Sopwith', 'AlbatrossC3', 'Albatross', 'AircoDH4_Brit', 'Gotha', 'Spitfire', 'se5',
  'F16', 'Mig29', 'F-15C', 'Mirage', 'F-14B', 'AV-8H', 'A10_B', 'SU-25', 'AH64', 'Mi24D', 'UH-60Q', 'SA-342G', 'MH-6', 'Mi8', 'BF109', 'Mitsubishi']
  .map(n => [n, L.fighterRank(n)]));
// Desert Combat's index (features/dogfight-doctrine-1991): jets against
// jets, with gunships and attack planes on the same airfields. Desert
// Shield stands first; a battle with only helicopters is no arena.
const jets = A.arenasFromTeams({ version: 1, levels: {
  bocage: { 1: ['Mig29', 'SA-342G', 'SU-25'], 2: ['AH-6', 'AV-8B', 'F-15C'] },
  dc_desertshield: { 1: ['Mi24D', 'Mi8', 'Mig29', 'SU-25'], 2: ['A10_B', 'AH-6', 'AH64', 'F16'] },
  wake: { 1: ['Mi24D', 'Mig29', 'SU-25'], 2: ['A10_B', 'AH64', 'F16'] },
  dc_medina_ridge: { 1: ['Mi24D'], 2: ['UH-60L'] },
} }, ['Bocage', 'DC_DesertShield', 'Wake', 'DC_Medina_Ridge']);
const jetNames = Object.fromEntries(['F16', 'Mig29', 'F-15C', 'F-14B', 'SU-25', 'A10_B', 'AV-8H', 'Mirage', 'Spitfire', 'BF109'].map(n => [n, L.jetName(n)]));
console.log(JSON.stringify({
  jets: jets.map(a => ({ map: a.map, name: a.name, allied: a.allied, axis: a.axis, planes: a.planes.map(p => p.template) })), jetNames,
  rotary: Object.fromEntries(['AH64', 'Mi24D', 'UH-60Q', 'SA-342G', 'MH-500', 'OH-6', 'Mi8', 'F16', 'Mig29', 'Mirage', 'Mitsubishi', 'Mosquito'].map(n => [n, L.isRotary(n)])),
  teams: teams.map(a => ({ map: a.map, allied: a.allied, axis: a.axis, planes: a.planes.map(p => p.template) })), ranks,
  arenas: arenas.map(a => ({ map: a.map, allied: a.allied, axis: a.axis, planes: a.planes.map(p => p.template) })),
  planeIn: { chosen: A.planeIn(bob, 'BF109')?.template, missing: A.planeIn(bob, 'Zero')?.template },
  // A lesson draws you on a fighter: a bomber or two-seater picked is drawn
  // as its side's best fighter (the lessons fly a fighter's airframe).
  lessonPlane: Object.fromEntries([[bob, 'Ju88A'], [bob, 'BF109'], [bob, 'Spitfire'], [kursk, 'Ilyushin'], [kursk, 'Yak9']]
    .map(([a, t]) => [`${a.map}:${t}`, A.lessonPlane(a, A.planeIn(a, t))?.template])),
  ace: { againstAxis: A.aceAgainst(bob, bf)?.template, againstAllied: A.aceAgainst(kursk, kursk.planes.find(p => p.template === 'Yak9'))?.template },
  url: Object.fromEntries(url.searchParams),
  path: url.pathname,
}));
