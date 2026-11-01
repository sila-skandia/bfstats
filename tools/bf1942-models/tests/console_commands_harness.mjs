// Drives `viewer/console-commands.js` and `viewer/console-aliases.js` on a
// real `GameConsole` with stub page state, and prints one JSON blob for
// `tests/test_console.py`. No DOM and no three: every hook is a plain object.

import { GameConsole } from './console.js';
import { registerViewerCommands, setChatSizes, playerLines, replayPlayers, mapLines } from './console-commands.js';
import { ALIASED_COMMANDS, runConText } from './console-aliases.js';

const results = {};

function makeConsole(env) {
  const con = new GameConsole();
  const words = registerViewerCommands(con, env);
  runConText(con, ALIASED_COMMANDS);
  return { con, words };
}
/** Type a line and return what it printed after the echo. */
function type(con, line) {
  const before = con.scrollback.length;
  con.setLine(line);
  con.asciiKey(0x0d);
  return con.scrollback.slice(before + 1);
}

class FakeTarget {
  constructor(props) { Object.assign(this, props); this.events = []; }
  dispatchEvent(e) { this.events.push(e.type); return true; }
}
class Group {
  constructor(kind, children = []) { this.userData = kind ? { kind } : {}; this.children = children; this.visible = true; }
  traverse(fn) { fn(this); for (const c of this.children) c.traverse(fn); }
}

// -- a recorded round -------------------------------------------------------

const rec = {
  players: new Map(),
  sessions: new Map([
    [3, [{ pid: 3, name: 'skandia', ai: false, joinT: 0 }]],
    [5, [{ pid: 5, name: 'Bot A', ai: true, joinT: 0, leftT: 50 },
         { pid: 5, name: 'Bot B', ai: true, joinT: 60 }]],
    [9, [{ pid: 9, name: 'late', ai: false, joinT: 200 }]],
  ]),
};
for (const [pid, list] of rec.sessions) rec.players.set(pid, list[list.length - 1]);
const replay = {
  rec, time: 70, recordingPids: [3], speed: 1,
  playing: true,
  ui: { setSpeed(s) { replay.speed = s; replay.uiSpeed = s; }, setMode(m) { replay.camera.mode = m; },
        togglePlay() { replay.playing = !replay.playing; } },
  camera: { mode: 'orbit', setMode(m) { this.mode = m; } },
  shotLines: { on: false, setOn(on) { this.on = on; } },
};
results.replayPlayersAt70 = replayPlayers(rec, 70, [3]);
results.replayPlayersAt20 = replayPlayers(rec, 20, [3]);

// -- the replay page --------------------------------------------------------

{
  const fog = { near: 150, far: 300, color: { r: 0.8, g: 0.7, b: 0.5, setRGB(r, g, b) { Object.assign(this, { r, g, b }); } } };
  const scene = { fog, background: 'skybox' };
  const terrain = new Group('terrain');
  const sky = new Group('sky');
  const water = new Group('water');
  const house = new Group(null);
  const root = new Group(null, [terrain, sky, water, house]);
  const camera = { far: 900, near: 0.5, updates: 0, updateProjectionMatrix() { this.updates++; } };
  const optWire = new FakeTarget({ checked: false });
  const optSoundVol = new FakeTarget({ value: '0.7' });
  const optSound = new FakeTarget({ checked: true });
  const chat = { sizes: { 0: 6, 1: 2, 2: 3 }, lines: { 0: ['a', 'b', 'c', 'd'], 1: [], 2: [] }, limit: 5, version: 0 };
  const bfmap = { open: false, setOpen(on) { this.open = on; }, toggleOpen() { this.open = !this.open; } };
  const effectsRoot = { visible: true };
  const { con } = makeConsole({
    replay: () => replay, scene: () => scene, camera: () => camera, levelRoot: () => root,
    optWire: () => optWire, optSound: () => optSound, optSoundVol: () => optSoundVol,
    chatLog: () => chat, bfmap: () => bfmap, effectsRoot: () => effectsRoot,
    mapRows: () => [{ name: 'Wake', mod: 'bf1942' }, { name: 'Kursk', mod: 'bf1942' }],
    levelName: () => 'Kursk', gameplayMode: () => 'GPM_CQ',
  });
  const r = {};
  r.lp = type(con, 'lp');
  r.listplayers = type(con, 'game.listPlayers');
  r.lm = type(con, 'lm');
  r.fpsRead = type(con, 'fps');
  r.fpsSet = type(con, 'fps 1');
  r.fpsAfter = type(con, 'console.showfps');
  // CON-17: only 0 and 1 read; `true` and `5` fail and change nothing.
  type(con, 'fps true');
  type(con, 'fps 5');
  r.fpsKept = type(con, 'fps');
  // CON-15: `setX` / `getX` reach a property X of the right type.
  type(con, 'console.setShowFPS 0');
  r.viaSet = type(con, 'console.getShowFPS');
  type(con, 'fps 1');
  r.hudOff = type(con, 'hud 0');
  r.hudRead = type(con, 'game.usehud');
  r.freecam = type(con, 'freecam 1');
  r.freecamMode = replay.camera.mode;
  r.freecamRead = type(con, 'game.EnableFreeCamera');
  r.speed = type(con, 'console.engineSpeed 4');
  r.speedNow = replay.speed;
  r.speedViaUi = replay.uiSpeed;
  r.speedRead = type(con, 'console.engineSpeed');
  r.drawDebug = type(con, 'game.drawDebug 1');
  r.drawDebugOn = replay.shotLines.on;
  type(con, 'pause');
  r.paused = !replay.playing;
  type(con, 'unpause');
  r.resumed = replay.playing;
  // Access 4: refused at the prompt, as in retail, until show.dev lifts it.
  r.wireLocked = type(con, 'renderer.wireframe 1');
  con.archiveScript = true;
  r.wireOpen = type(con, 'renderer.wireframe 1');
  r.wireChecked = optWire.checked;
  r.wireEvents = optWire.events;
  r.fogOff = type(con, 'renderer.vertexFogEnable 0');
  r.fogGone = scene.fog === null;
  r.fogOn = type(con, 'renderer.vertexFogEnable 1');
  r.fogBack = scene.fog === fog;
  type(con, 'renderer.fogEnd 777');
  r.fogEnd = fog.far;
  r.fogColor = type(con, 'renderer.fogColorVec');
  type(con, 'renderer.fogColorVec 1/0/0.5');
  r.fogColorSet = [fog.color.r, fog.color.g, fog.color.b];
  type(con, 'renderer.drawTerrain 0');
  type(con, 'renderer.drawObjects 0');
  type(con, 'renderer.drawSky 0');
  r.drawn = { terrain: terrain.visible, sky: sky.visible, water: water.visible, house: house.visible,
              background: scene.background };
  type(con, 'renderer.drawSky 1');
  r.skyBack = { sky: sky.visible, background: scene.background };
  type(con, 'game.viewDistance 1200');
  r.viewDistance = [camera.far, camera.updates];
  r.oneArg = type(con, 'renderer.wireframe 1 2');
  // Chat sizes: the client's own refusals, and the four-line chatInfo.
  r.chatInfo = type(con, 'textinfo');
  r.tooHigh = type(con, 'textsizes 6 4 4');
  r.tooLow = type(con, 'chat.chatMessageSize 0');
  r.setHistory = type(con, 'textsizes 2 3 4');
  r.sizesAfter = { ...chat.sizes };
  r.chatTrimmed = chat.lines[0].length;
  r.killtext = type(con, 'killtext');
  type(con, 'chat.timeUntilMessageRemoved 30');
  r.timeout = chat.limit;
  // Hud and debug.
  type(con, 'hud.fullscreenMap 1');
  r.mapOpen = bfmap.open;
  type(con, 'hud.toggleFullscreenMap');
  r.mapToggled = bfmap.open;
  type(con, 'debug.enableParticles 0');
  r.particles = effectsRoot.visible;
  // Sound: the side panel's controls.
  type(con, 'game.setMasterVolume 40');
  r.volume = [optSoundVol.value, optSoundVol.events];
  type(con, 'game.setDisableSound 1');
  r.soundBox = optSound.checked;
  // Vars and the console's own words.
  type(con, 'vars.set cam 1');
  r.varsGet = type(con, 'vars.get CAM');
  r.varsList = type(con, 'vars.list');
  r.argTypes = type(con, 'console.getArgumentTypes chat setChatHistory');
  r.retType = type(con, 'console.getReturnType game listPlayers');
  r.activeHud = type(con, 'console.getActiveMethods hud');
  type(con, 'console.echo 0');
  const before = con.scrollback.length;
  con.setLine('lm'); con.asciiKey(0x0d);
  r.noEcho = con.scrollback.slice(before);
  type(con, 'console.echo 1');
  r.listalias = type(con, 'listalias').slice(0, 3);
  r.aliasCount = con.aliases.size;
  r.deadAlias = type(con, 'bantime');
  r.unknown = type(con, 'game.showHud');
  results.replayPage = r;
}

// -- the flythrough: no replay, so the replay words are not active ----------

{
  const { con } = makeConsole({
    players: () => [{ name: 'skandia', local: true }, { name: 'Bot', bot: true }],
  });
  results.flythrough = {
    lp: type(con, 'lp'),
    freecam: type(con, 'freecam 1'),
    speed: type(con, 'console.engineSpeed 2'),
    wire: type(con, 'renderer.wireframe 1'),
  };
}

// -- the helpers alone ------------------------------------------------------

results.helpers = {
  lines: playerLines([{ id: 1, name: 'a', local: true }, { id: 2, name: 'b', ai: true }]),
  maps: mapLines([{ name: 'Wake', mod: 'bf1942' }], { current: 'Wake', gpm: 'GPM_CQ' }),
};
{
  const log = { sizes: { 0: 6, 1: 2, 2: 3 }, lines: { 0: [], 1: [], 2: [] }, version: 0 };
  results.helpers.sizes = [setChatSizes(log, { chat: 10 }), setChatSizes(log, { kill: 4 }), { ...log.sizes }];
}

// Every word the module registers, for the catalogue cross-check.
{
  const con = new GameConsole();
  registerViewerCommands(con, {});
  results.registered = [...con.commands.values()].map(c => ({
    name: c.name, type: c.type, access: c.access, minArgs: c.minArgs, maxArgs: c.maxArgs,
  }));
}

console.log(JSON.stringify(results));
