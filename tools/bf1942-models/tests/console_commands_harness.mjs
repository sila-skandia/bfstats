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
  // OPTIONS > VIDEO and SOUND as the record their screens change.
  const videoState = { graphicsQuality: 3, viewDistance: 100 };
  const videoChanges = [];
  const video = { settings: () => videoState, change: c => { videoChanges.push(c); Object.assign(videoState, c); } };
  const soundState = { masterVolume: 70, disableSound: false };
  const soundChanges = [];
  const sound = { settings: () => soundState, change: c => { soundChanges.push(c); Object.assign(soundState, c); } };
  let hw = false;
  let dopplerV = 1;
  const typedView = [];
  const levelStub = { viewDistance: () => typedView.at(-1) ?? 500, setConsoleViewDistance: v => typedView.push(v) };
  const tagsOwn = { near: 75, scope: 300 };
  const tagsMax = [];
  const nametags = { own: () => tagsOwn, setOwn: (n, sc) => { if (n !== null) tagsOwn.near = n; if (sc !== null) tagsOwn.scope = sc; },
                     setMax: (n, sc) => tagsMax.push([n, sc]) };
  const crossColor = [];
  const crosshair = { factors: { radius: 5, size: 5 }, color: () => crossColor.at(-1), setColor: rgb => crossColor.push(rgb) };
  let shakeV = 0;
  const treesSet = [];
  const tune = { lod: 1, bb: 2, fx: 1 };
  const chat = { sizes: { 0: 6, 1: 2, 2: 3 }, lines: { 0: ['a', 'b', 'c', 'd'], 1: [], 2: [] }, limit: 5, version: 0 };
  const bfmap = { open: false, setOpen(on) { this.open = on; }, toggleOpen() { this.open = !this.open; } };
  const effectsRoot = { visible: true };
  const { con } = makeConsole({
    replay: () => replay, scene: () => scene, camera: () => camera, levelRoot: () => root,
    optWire: () => optWire,
    video: () => video, sound: () => sound, level: () => levelStub,
    hardware: () => ({ get: () => hw, set: on => { hw = on; } }),
    doppler: () => ({ get: () => dopplerV, set: v => { dopplerV = v; } }),
    soundInfo: () => ['sound running 48000 Hz'],
    nametags: () => nametags, crosshair: () => crosshair,
    shake: () => ({ get: () => shakeV, set: v => { shakeV = Math.min(1, Math.max(-1, v)); } }),
    setTrees: on => treesSet.push(on),
    tuning: () => ({ lodPercent: () => tune.lod, setLodPercent: v => { tune.lod = v; },
      billboardScale: () => tune.bb, setBillboardScale: v => { tune.bb = v; },
      intensity: () => tune.fx, setIntensity: v => { tune.fx = v; } }),
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
  r.viewDistance = typedView.slice();
  r.viewDistanceRead = type(con, 'game.viewDistance');
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
  // Sound: OPTIONS > SOUND's record.
  type(con, 'game.setMasterVolume 40.7');
  type(con, 'game.setMasterVolume loud');
  type(con, 'game.setDisableSound 1');
  type(con, 'game.setChannels 64');
  type(con, 'game.setSoundDetail 1');
  type(con, 'game.setQuality 0');
  r.soundChanges = soundChanges.slice();
  type(con, 'game.setHardware 1');
  r.hardware = hw;
  r.dopplerRead = type(con, 'sound.dopplerFactor');
  type(con, 'Sound.setDopplerFactor 0.5');
  r.doppler = dopplerV;
  r.rolloff = type(con, 'Sound.setRolloffFactor 1');
  r.distance = type(con, 'sound.distanceFactor');
  r.soundObjects = type(con, 'sound.drawSoundObjects 1');
  type(con, 'sound.showSoundInfo 1');
  r.soundInfoOn = type(con, 'sound.showSoundInfo');
  // Video: the eight rows' words.
  type(con, 'game.setGraphicsQuality 1');
  type(con, 'game.setEffectsQuality 2');
  type(con, 'game.setEnvironmentMapping 0');
  type(con, 'game.setLightmaps 0');
  type(con, 'game.setDetailTexture 5');
  type(con, 'game.setMenuViewdistance 150');
  r.performance = type(con, 'game.setPerformance 1');
  r.shadows = type(con, 'game.setShadows 1');
  r.videoChanges = videoChanges.slice();
  type(con, 'renderer.globalLodPercent 0.8');
  type(con, 'treeRenderer.billboardDistanceScale 1.5');
  type(con, 'game.intensityScale 0.3');
  r.tuning = { ...tune };
  // The cheap ones.
  type(con, 'game.setNameTagDistance 50 200');
  type(con, 'game.setMaxNameTagDistance 40 250');
  r.nametagOwn = { ...tagsOwn };
  r.nametagMax = tagsMax.slice();
  r.getNameTag = type(con, 'game.getNameTagDistance');
  type(con, 'game.setCrossHairRadius 7');
  r.crossRadius = type(con, 'game.crossHairRadius');
  type(con, 'game.setCrossHairColor 255 0 0');
  r.crossColor = crossColor.slice();
  type(con, 'soldier.cameraShakeFactor 3');
  r.shake = type(con, 'soldier.cameraShakeFactor');
  type(con, 'renderer.drawTrees 0');
  r.trees = treesSet.slice();
  r.flareRead = type(con, 'lensflare.enable');
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

// -- a room's team-kill answer (FF-10) ---------------------------------------
{
  const sent = [];
  const room = makeConsole({ teamKillRoom: () => verb => sent.push(verb) });
  const solo = makeConsole({ teamKillRoom: () => null });
  results.teamKill = {
    out: [type(room.con, 'punish'), type(room.con, 'ftk'), type(room.con, 'game.TKPunish')],
    sent,
    solo: type(solo.con, 'punish'),
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
