// `viewer/ctf-page.js` under node: the CTF law over a stand-in page's
// players, its lines, its HUD carrier icon and its map marks, on Desert
// Shield's two bases. The viewer modules load unmodified through
// `sim/env.mjs` (`three` mapped onto the vendored build). Run by
// `tests/test_ctf_page.py`; prints one JSON object.

import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const { viewerDir, installModuleHooks } = await import(path.join(HERE, '..', 'sim', 'env.mjs'));
const viewer = viewerDir(path.join(HERE, '..', 'viewer'));
installModuleHooks(viewer);
const THREE = await import(path.join(viewer, 'vendor', 'three.module.js'));
const { createCtfPage, modelCandidates, playsCtf, CARRIED_HEIGHT } =
  await import(path.join(viewer, 'ctf-page.js'));
const { createRoundState } = await import(path.join(viewer, 'round-state.js'));

globalThis.fetch = () => Promise.reject(new Error('no network in the harness'));

// Desert Shield's Ctf layer as scene.json carries it (`bf42/ctf.py`).
const flagBases = [
  { name: 'UKbase', template: 'UKbase', position: [804.59, 79.96, -375.59], rotation: [0, 0, 0],
    team: 2, radius: 5, flagLocation: [0, 7.6, 0], geometry: 'flagbase_m1',
    flag: { template: 'BrittishFlag', team: 2, radius: 5, timeToRespawn: 30, geometry: 'flaguk_m1' } },
  { name: 'GEbase', template: 'GEbase', position: [938.27, 103.66, -1716.22], rotation: [0, 0, 0],
    team: 1, radius: 5, flagLocation: [0, 7.6, 0], geometry: 'flagbase_m1',
    flag: { template: 'GermanFlag', team: 1, radius: 5, timeToRespawn: 30, geometry: 'flagge_m1' } },
];
const extras = { gameplayMode: 'Ctf', flagBases };
const at = (b, dx = 0, dy = 0, dz = 0) => [b.position[0] + dx, b.position[1] + dy, b.position[2] + dz];

const results = {
  plays: { ctf: playsCtf(extras), conquest: playsCtf({ gameplayMode: 'Conquest', flagBases }),
           bare: playsCtf({ gameplayMode: 'Ctf', flagBases: [] }) },
  candidates: {
    uk: modelCandidates(flagBases[0]),
    blueJp: modelCandidates({ template: 'BlueBase', flag: { template: 'BlueFlag', geometry: 'flagJp_m1' } }),
  },
};

// The page: one human (id 0, the Coalition, team 2) and one bot (Hans, the
// Opposition, team 1), each a world record with a soldier and an Armor.
const soldier = position => ({ x: position[0], y: position[1], z: position[2] });
const players = new Map();
const armors = new Map();
const addPlayer = (id, team, position) => {
  players.set(id, { id, team, soldier: soldier(position), occupancy: null });
  armors.set(id, { destroyed: false });
};
addPlayer(0, 2, at(flagBases[0], 30));
addPlayer(5, 1, at(flagBases[1], 30));
const hans = { playerId: 5, team: 1, name: 'Hans', vehicle: null,
               getPosition: () => { const s = players.get(5).soldier; return [s.x, s.y, s.z]; } };
const move = (id, position) => Object.assign(players.get(id).soldier, soldier(position));
const world = { players, armorOf: id => armors.get(id) ?? null };

const lines = [];
const loads = [];
let round = createRoundState({ mode: 'Ctf', scoreLimit: 2 });
const scene = new THREE.Scene();
const page = {
  extras, world, scene,
  get round() { return round; },
  groundHeight: () => 100,
  // The models tree has FlagPole and the AnimatedBundles, not the level's own names.
  loader: { loadAsync: async url => { loads.push(url); if (!/FlagPole|Animated/.test(url)) throw new Error('404'); return { scene: new THREE.Group() }; } },
  MODELS_BASE: 'models/mods/desertcombat', MAPS_BASE: 'maps/mods/desertcombat', bust: () => '',
  bots: [hans], LOCAL_PLAYER: 0, localName: () => 'Smith', localTeam: () => 2,
  roomJoined: false, roomSlot: null,
  comms: { info: (text, team) => lines.push({ text, team }),
           lexicon: () => ({ strings: { TEAM_CHAT_AXIS: 'Opposition', TEAM_CHAT_ALLIES: 'Coalition' } }) },
  teamArt: team => (team === 1
    ? { teamFlag: 'Icon_flag_ger.tga', minimap: 'flag_ger.tga' }
    : { teamFlag: 'Icon_flag_brit.tga', minimap: 'flag_brit.tga' }),
  teamNation: team => (team === 1 ? 'ger' : 'brit'),
  AUDIO_OFF: true,
};
const ctfPage = createCtfPage(page);
ctfPage.setup();
await new Promise(resolve => setTimeout(resolve, 20));   // the model loads settle
const ctfGroup = scene.getObjectByName('ctf');
results.setup = {
  active: ctfPage.state().active,
  again: ctfPage.setup() === ctfPage.ctf,
  nodes: ctfGroup ? ctfGroup.children.map(c => c.name) : null,
  models: ctfPage.state().models,
  loads: loads.slice(),
  drawnHome: ctfPage.state().flags.map(f => f.drawn.map(v => Math.round(v * 100) / 100)),
};

const hud = () => { const vars = {}; ctfPage.feedHud(vars); return vars; };
const step = () => ctfPage.tick(1 / 30).map(e => e.kind);
const timeline = [];
// Hans walks into the Coalition base and takes its flag.
move(5, at(flagBases[0], 1));
timeline.push(...step());
const hansCarrying = { hud: hud(), drawn: ctfPage.state().flags[0].drawn, carrier: ctfPage.state().flags[0].carrier };
// Smith takes the Opposition's flag at its base: his HUD shows it.
move(0, at(flagBases[1], 0, 0, 1));
timeline.push(...step());
const smithCarrying = hud();
// Smith runs home, but his own flag is away: no capture. Hans is shot in the
// open, his flag falls; Smith walks over it, which returns it, and the next
// frame at his base he captures.
move(0, at(flagBases[0], 0, 0, 2));
move(5, at(flagBases[0], 200));
timeline.push(...step());
armors.get(5).destroyed = true;
timeline.push(...step());
const dropped = ctfPage.state().flags[0].position.map(v => Math.round(v * 100) / 100);
move(0, [dropped[0] + 1, dropped[1] - 1.5, dropped[2]]);
timeline.push(...step());
move(0, at(flagBases[0], 0, 0, 1));
timeline.push(...step());
results.play = {
  timeline, hansCarrying, smithCarrying, dropped, lines: lines.slice(),
  captures: { 1: round.teams[1].captures, 2: round.teams[2].captures },
  smithScore: round.tally(0).score, afterCapture: hud(),
  marks: ctfPage.mapMarks(), key: ctfPage.marksKey(),
};

// The end of the round stops the law: Hans, alive again, cannot take a flag.
armors.get(5).destroyed = false;
round.endRound(2, null, 'score');
move(5, at(flagBases[0], 1));
results.ended = { events: step(), home: ctfPage.state().flags[0].home };

// A room: the law is the server's, the page plays its rows.
page.roomJoined = true;
page.roomSlot = 3;
round = createRoundState({ mode: 'Ctf' });
ctfPage.reset();
const roomTick = step();
ctfPage.onRow({ type: 'ctf', kind: 'stole', flag: 1, player: 3, team: 2, name: 'Smith', position: at(flagBases[1]) });
const roomCarrying = hud();
ctfPage.follow(id => (id === 3 ? [1, 2, 3] : null));
results.room = { tick: roomTick, carrying: roomCarrying, follow: ctfPage.state().flags[1].position,
                 drawnY: ctfPage.state().flags[1].drawn[1], lines: lines.slice(results.play.lines.length),
                 ignored: ctfPage.onRow({ type: 'captured', flag: 0 }) ?? null };

// A Conquest level tears CTF down.
page.extras = { gameplayMode: 'Conquest' };
ctfPage.setup();
results.teardown = { active: ctfPage.state().active, group: !!scene.getObjectByName('ctf'),
                     hud: hud(), marks: ctfPage.mapMarks().length };
results.carriedHeight = CARRIED_HEIGHT;

console.log(JSON.stringify(results));
