// The retail client's console words that mean something in the viewer, on
// the map page and in a replay, under the game's own names.
//
// Which words exist, with their type, argument counts, argument and return
// types and access bits, is the registry walk in
// `features/bf1942-in-the-browser/console-commands.md` (the client's 2218
// static ConsoleObjects, read out of BF1942.exe's initialiser table; ledger
// CON-20..CON-25). Each registration below repeats the client's own shape, so
// a word answers here with the same errors it does in the game. What a word
// is hooked to on the page is said beside it; a word whose page hook is not
// there (a replay word on the flythrough) answers "Method is not active!".
//
// The access bits are the client's. Access 4 (`renderer.wireframe`, the draw
// switches, `game.viewDistance`) is refused at a typed prompt in retail; here
// `show.dev 1` lifts that, standing in for the archive-script flag (CON-22).
//
// Free of `three` and of the DOM except through `env`, so
// `tests/console_commands_harness.mjs` drives it under node with stubs.

import { decodePlayerName } from './vehicle-players.js';

/** The client's `bool` reader, `istream >> bool` (ledger CON-17): the
 *  leading digits must read 0 or 1 (`1.2` is 1); anything else fails the read
 *  and the word keeps what it had, which here is no change (null). */
export function readBool(s) {
  const m = /^\s*(\d+)/.exec(String(s));
  if (!m) return null;
  const v = Number(m[1]);
  return v === 0 ? false : v === 1 ? true : null;
}
const b01 = v => (v ? 1 : 0);

/** The client's `int` reader, `istream >> int`: an optional sign and the
 *  leading digits (`75.5` is 75); anything else fails the read and the word
 *  changes nothing (null). */
export function readInt(s) {
  const m = /^\s*([-+]?\d+)/.exec(String(s));
  return m ? Number(m[1]) : null;
}
/** The `float` reader: a leading number, else null. */
export function readFloat(s) {
  const v = Number.parseFloat(String(s));
  return Number.isFinite(v) ? v : null;
}

/** A `Vec3` the way `.con` files spell one: `x/y/z`. */
export function parseVec3(s) {
  const parts = String(s).split('/').map(Number);
  return parts.length === 3 && parts.every(Number.isFinite) ? parts : null;
}
export const formatVec3 = v => v.map(n => +Number(n).toFixed(4)).join('/');

/**
 * `game.listPlayers` (body `0x004a8e40`): one line per player,
 * `Id:%d - ` (0x008dbab8) and the name, then ` is local.` (0x008dba98) for
 * this client's own and ` is remote ` (0x008c5314) plus `ip: %d.%d.%d.%d:%d`
 * for anyone else, then ` is an AI bot.` (0x008dba88) for a bot, then `\n`.
 * The viewer has no address for anyone, so a remote line stops at ` is remote `.
 */
export function playerLines(players) {
  return players.map(p => `Id:${p.id} - ${p.name}${p.local ? ' is local.' : ' is remote '}`
    + (p.ai ? ' is an AI bot.' : '')).join('\n');
}

/** Who is in a recorded round at `t`: each pid's session open then
 *  (`replay-recording.js` sessions; a pid is reused, so only the holder at
 *  `t` counts), the recording's own players as local. */
export function replayPlayers(rec, t, localPids = []) {
  const out = [];
  const local = new Set(localPids);
  const pids = new Set([...(rec.sessions?.keys() ?? []), ...(rec.players?.keys() ?? [])]);
  for (const pid of [...pids].sort((a, b) => a - b)) {
    const list = rec.sessions?.get(pid);
    let s = null;
    if (list?.length) {
      for (const session of list) if (session.joinT <= t) s = session;
    } else {
      s = rec.players?.get(pid) ?? null;
    }
    if (!s || (s.leftT !== undefined && s.leftT <= t)) continue;
    out.push({ id: pid, name: decodePlayerName(s.name ?? `player ${pid}`), local: local.has(pid), ai: Boolean(s.ai) });
  }
  return out;
}

/** `game.listMaps` (body `0x0040cee0`): `Map:%d '%s' Mod:%s GPM:%s`
 *  (0x008c5328) per row of the server's list, counted from 0, with
 *  ` NumVotes:%d` (0x008c52a0) when the row has votes. The viewer's list is
 *  the mod's exported levels; only the level being shown knows its mode. */
export function mapLines(rows, { current = '', gpm = '' } = {}) {
  return rows.map((row, i) => `Map:${i} '${row.name}' Mod:${row.mod ?? ''} GPM:${
    row.name === current ? gpm : ''}`).join('\n');
}

/** `chat.chatInfo` (`0x006a7b20`): the four lines it prints, verbatim
 *  (0x0091d6f8, 0x0091d6d8, 0x0091d6b4, 0x0091d694). */
export function chatInfoLines({ chat, info, kill }) {
  return [`number of lines used: ${chat + info + kill}`,
          `chat message history size: ${chat}`,
          `gameInfo message history size: ${info}`,
          `kill message history size: ${kill}`].join('\n');
}

/**
 * `chat.setChatHistory chat info kill` (`0x006a8ca0`, the three in that
 * order: `+0x7dc`, `+0x7e0`, `+0x7e4`) and the three single setters
 * (`0x006a81c0` chat, `0x006a82e0` gameInfo, `0x006a83f0` kill). The total
 * may not pass 12 and none may be under 1; a refused value prints the
 * client's own line and changes nothing. Returns the line to print, or ''.
 */
export function setChatSizes(log, { chat, info, kill }) {
  const SECTION = { chat: 0, info: 1, kill: 2 };
  const now = { chat: log.sizes[SECTION.chat], info: log.sizes[SECTION.info], kill: log.sizes[SECTION.kill] };
  const next = { chat: chat ?? now.chat, info: info ?? now.info, kill: kill ?? now.kill };
  for (const k of Object.keys(next)) next[k] = Math.trunc(Number(next[k]));
  if (next.chat + next.info + next.kill > 12) {
    return 'Error: Value to high! Total number of lines may not be higher than: 12';
  }
  if (!(next.chat >= 1 && next.info >= 1 && next.kill >= 1)) return 'Error: Value must be at least 1!';
  log.sizes[SECTION.chat] = next.chat;
  log.sizes[SECTION.info] = next.info;
  log.sizes[SECTION.kill] = next.kill;
  for (const [k, s] of Object.entries(SECTION)) {
    const rows = log.lines[s];
    while (rows.length > next[k]) rows.shift();
  }
  log.version++;
  return '';
}

/**
 * Register the viewer's console words on `con`. `env` hands in the page as
 * getters, every one optional:
 *
 *   replay()        the open ReplayPlayer (`window.replay`), or null
 *   document        the page document (FPS readout, HUD switch)
 *   stage()         the element the FPS readout sits in
 *   scene(), vmScene(), camera(), renderer()
 *   levelRoot()     the level's glb root (`userData.kind` terrain/sky/water)
 *   levelName(), modId(), gameplayMode(), mapRows()
 *   players()       the play page's roster: [{ id, name, local, bot }]
 *   bfmap()         the BfMap (fullscreen map)
 *   chatLog()       the message log's ChatLog
 *   effectsRoot()   the effect player's group
 *   optWire()       the side panel's wireframe box
 *   video()         OPTIONS > VIDEO: { settings(), change(partial) }
 *                   (video-settings.js `changeVideo`)
 *   level()         the level: `setConsoleViewDistance(v)`, `viewDistance()`
 *   sound()         OPTIONS > SOUND: { settings(), change(partial) }
 *                   (sound-options.js `changeSound`)
 *   hardware()      HARDWARE ACCELERATION: { get(), set(on) }
 *   doppler()       `Sound.dopplerFactor`: { get(), set(v) } (ds3d-pan.js)
 *   soundInfo()     the page audio's state as text lines
 *   nametags()      { own(), setOwn(near, scope), setMax(near, scope) }
 *   crosshair()     { factors: { radius, size }, color(), setColor(rgb) }
 *   shake()         `Soldier.cameraShakeFactor`: { get(), set(v) }
 *   setTrees(on)    every tree drawn or not (tree-foliage.js)
 *   tuning()        { lodPercent(), setLodPercent(v), billboardScale(),
 *                   setBillboardScale(v), intensity(), setIntensity(v) }
 *   now()           a clock in ms, for the FPS readout (performance.now)
 *   raf(fn)         requestAnimationFrame
 */
export function registerViewerCommands(con, env = {}) {
  const get = (name, ...a) => (typeof env[name] === 'function' ? env[name](...a) : env[name]) ?? null;
  const replay = () => get('replay');
  const doc = () => env.document ?? (typeof document !== 'undefined' ? document : null);
  const reg = spec => con.register(spec);
  // A read/write property, the client's type 1: no argument reads, one sets.
  const prop = (object, method, argType, access, read, write, active = null) => reg({
    object, method, type: 1, minArgs: 0, maxArgs: 1, argTypes: [argType], returns: argType,
    access, active,
    run: args => {
      if (!args.length) {
        const v = read();
        return typeof v === 'boolean' ? b01(v) : v;
      }
      const msg = write(args[0]);
      if (typeof msg === 'string' && msg) con.output(msg);
      return undefined;
    },
  });
  const boolProp = (object, method, access, read, write, active) =>
    prop(object, method, 'bool', access, () => Boolean(read()), s => {
      const v = readBool(s);
      return v === null ? '' : write(v);
    }, active);
  const floatProp = (object, method, access, read, write, active) =>
    prop(object, method, 'float', access, read, s => {
      const v = Number(s);
      if (Number.isFinite(v)) return write(v);
      return '';
    }, active);
  const method = (object, name, { minArgs = 0, maxArgs = minArgs, argTypes = [], returns = 'void', access = 2, active = null, run }) =>
    reg({ object, method: name, type: 0, minArgs, maxArgs, argTypes, returns, access, active, run });
  const has = name => () => get(name) !== null;

  const state = {
    showFPS: false, showStats: false, showSoundInfo: false, useHud: true, thumbnailMap: true,
    lensFlare: true, trees: true,
    fog: null, background: undefined,
    hidden: { terrain: false, sky: false, objects: false },
    vars: new Map(),
  };
  const shared = { state, setHud, refreshOverlay };

  // --- Console --------------------------------------------------------------

  // `console.showFPS` (t1 a1, `Setup+0x2e0`): `FPS: %.1f` (0x008d5bf8) at
  // (4, 4), drawn by `FUN_00462700` from `1 / Setup+0x180`, the frame's dt
  // after `console.engineSpeed` has scaled it (0x0044ac1e). The viewer shows
  // the browser's own frame rate.
  boolProp('Console', 'showFPS', 1, () => state.showFPS, on => { state.showFPS = on; refreshOverlay(); });
  // `console.showStats` (t1 a1, `Setup+0x2e2`, accessor 0x0043d7c0): the
  // client's statistics; the viewer's are three's draw calls and triangles.
  boolProp('Console', 'showStats', 1, () => state.showStats, on => { state.showStats = on; refreshOverlay(); });
  // `console.engineSpeed` (t1 a2, `Setup+0x178`): the frame's dt is
  // multiplied by it in the main loop (0x0044ac1e). A replay's speed.
  floatProp('Console', 'engineSpeed', 2, () => replay()?.speed ?? 1, v => {
    const r = replay();
    if (!(v > 0)) return '';
    if (r.ui?.setSpeed) r.ui.setSpeed(v); else r.speed = v;
    return '';
  }, () => replay() !== null);
  boolProp('Console', 'echo', 2, () => con.echo, on => { con.echo = on; });
  boolProp('Console', 'echoErrors', 2, () => con.echoErrors, on => { con.echoErrors = on; });
  prop('Console', 'maxHistorySize', 'int', 2, () => con.maxHistorySize, s => {
    const v = Math.trunc(Number(s));
    if (v > 0) con.maxHistorySize = v;
  });
  prop('Console', 'maxCommandHistorySize', 'int', 2, () => con.maxCommandHistorySize, s => {
    const v = Math.trunc(Number(s));
    if (v > 0) con.maxCommandHistorySize = v;
  });
  // The registry's own questions, answered from this console's registry.
  method('Console', 'getArgumentTypes', {
    minArgs: 2, argTypes: ['std::string', 'std::string'], returns: 'std::string',
    run: ([o, m]) => con.lookup(o, m)?.argTypes.join(' ') ?? '',
  });
  method('Console', 'getReturnType', {
    minArgs: 2, argTypes: ['std::string', 'std::string'], returns: 'std::string',
    run: ([o, m]) => con.lookup(o, m)?.returns ?? '',
  });
  method('Console', 'getActiveMethods', {
    minArgs: 1, argTypes: ['std::string'], returns: 'std::string',
    run: ([o]) => [...con.commands.values()]
      .filter(c => c.object.toLowerCase() === String(o).toLowerCase() && (!c.active || c.active()))
      .map(c => c.method).sort().join('\n'),
  });

  // --- Vars -----------------------------------------------------------------

  method('Vars', 'set', {
    minArgs: 2, argTypes: ['std::string', 'std::string'],
    run: ([k, v]) => { state.vars.set(String(k).toLowerCase(), v); },
  });
  method('Vars', 'get', {
    minArgs: 1, argTypes: ['std::string'], returns: 'std::string',
    run: ([k]) => state.vars.get(String(k).toLowerCase()) ?? '',
  });
  method('Vars', 'list', {
    returns: 'std::string',
    run: () => [...state.vars].map(([k, v]) => `${k} = ${v}`).join('\n'),
  });

  // --- Game -----------------------------------------------------------------

  // `game.useHud` (t1 a1, `Setup+0x12e`, accessor 0x00417d10).
  boolProp('Game', 'useHud', 1, () => state.useHud, on => setHud(on));
  // `game.EnableFreeCamera` (t1 a1, setter 0x005104d0) lets a player who is
  // not alive fly the free camera. In a replay, where everyone watching is a
  // spectator, it is the free camera itself: 1 takes it, 0 goes back to the
  // orbit around whoever is followed.
  boolProp('Game', 'EnableFreeCamera', 1, () => replay()?.camera?.mode === 'free', on => {
    const r = replay();
    const mode = on ? 'free' : 'orbit';
    if (r.ui?.setMode) r.ui.setMode(mode); else r.camera.setMode(mode);
  }, () => replay() !== null);
  method('Game', 'listPlayers', {
    access: 1, returns: 'std::string',
    run: () => {
      const r = replay();
      if (r) return playerLines(replayPlayers(r.rec, r.time, r.recordingPids ?? []));
      const roster = get('players') ?? [];
      return playerLines(roster.map((p, i) => ({
        id: p.serverId ?? p.slot ?? i, name: decodePlayerName(p.name ?? ''), local: Boolean(p.local), ai: Boolean(p.bot),
      })));
    },
  });
  method('Game', 'listMaps', {
    access: 1, returns: 'std::string',
    run: () => mapLines(get('mapRows') ?? [], { current: get('levelName') ?? '', gpm: get('gameplayMode') ?? '' }),
  });
  // `game.drawDebug` (t1 a2): the engine's debug lines. A replay draws its
  // shots as such lines (replay-shotlines.js).
  boolProp('Game', 'drawDebug', 2, () => Boolean(replay()?.shotLines?.on), on => replay().shotLines.setOn(on),
    () => Boolean(replay()?.shotLines));
  // `game.viewDistance` (t1 a4, handler 0x0041a4a0 -> 0x004427f0): the
  // distance the level draws to, unscaled, with the fog rewritten to the view
  // distance's law (FOG-4) and the statics culled at it, which is what VIEW
  // DISTANCE does with its percentage of the level's own (VID-6). The next
  // move of that row, or the next level, sets the level's own times the
  // percentage again (level-load.js `setConsoleViewDistance`). With no level,
  // the camera's far plane.
  floatProp('Game', 'viewDistance', 4, () => {
    try { const d = get('level')?.viewDistance?.(); if (d > 0) return d; } catch { /* no level yet */ }
    return get('camera')?.far ?? 0;
  }, v => {
    if (!(v > 0)) return '';
    const lvl = get('level');
    if (lvl?.setConsoleViewDistance) { lvl.setConsoleViewDistance(v); return ''; }
    const cam = get('camera');
    cam.far = v; cam.updateProjectionMatrix?.();
    return '';
  }, () => Boolean(get('level')?.setConsoleViewDistance) || get('camera') !== null);

  // --- OPTIONS > VIDEO: the eight rows' words (VID-1..VID-9) ----------------
  //
  // Each is a method of one argument that stores its field of the video
  // settings record and nothing else (0x006aefd0..0x006af0c0, no range test
  // but VIEW DISTANCE's cap at 100); the menu's apply hands the fields on. On
  // the page the word goes through `changeVideo`, the options screen's own
  // path, so it is applied live where the screen's change is (LIGHTMAPS at
  // the next level) and kept, and the record clamps it to the row's range.
  const video = () => get('video');
  const videoWord = (name, argType, field, read) => method('Game', name, {
    minArgs: 1, argTypes: [argType], active: has('video'),
    run: ([s]) => {
      const v = read(s);
      if (v !== null) video().change({ [field]: v });
    },
  });
  videoWord('setGraphicsQuality', 'int', 'graphicsQuality', readInt);
  videoWord('setEffectsQuality', 'int', 'effectsQuality', readInt);
  videoWord('setEnvironmentMapping', 'bool', 'environmentMapping', readBool);
  videoWord('setLightmaps', 'bool', 'lightmaps', readBool);
  // TEXTURE QUALITY, 1..5 (VID-5).
  videoWord('setDetailTexture', 'int', 'textureQuality', readInt);
  // VIEW DISTANCE's percentage; the client caps it at 100 (0x006af061).
  videoWord('setMenuViewdistance', 'int', 'viewDistance', s => {
    const v = readInt(s);
    return v === null ? null : Math.min(100, v);
  });
  // VIDEO PERFORMANCE's radio line (0x006bb430 -> 0x00803650 stores it, no
  // preset is run: choosing the line in the menu runs the file, VID-8). The
  // page's line is worked out from the values, so the word has nothing to
  // keep; it is accepted as the client accepts it.
  method('Game', 'setPerformance', { minArgs: 1, argTypes: ['int'], active: has('video'), run: () => {} });
  // SHADOWS: the viewer draws no dynamic shadows (VID-7).
  method('Game', 'setShadows', { minArgs: 1, argTypes: ['bool'], active: () => false, run: () => {} });
  // The three numbers GRAPHICS QUALITY and EFFECTS QUALITY write (VID-1,
  // VID-2), each its own console property in the client. The next apply of
  // the options writes them again, as the client's does.
  const tuning = () => get('tuning');
  floatProp('Renderer', 'globalLodPercent', 2, () => tuning().lodPercent(), v => { tuning().setLodPercent(v); },
    has('tuning'));
  // TreeRenderer's +0x80: 2 at HIGH; the viewer's swap is HIGH's (VID-1).
  floatProp('treeRenderer', 'billboardDistanceScale', 2, () => tuning().billboardScale(),
    v => { if (v > 0) tuning().setBillboardScale(v); }, has('tuning'));
  // `game.intensityScale`, game +0x4cc (0x00426f90): every emitter's
  // intensity (VID-2).
  floatProp('Game', 'intensityScale', 2, () => tuning().intensity(), v => { tuning().setIntensity(v); },
    has('tuning'));

  // --- OPTIONS > SOUND (SND-28, SND-40..SND-45) -----------------------------

  const sound = () => get('sound');
  const soundWord = (name, argType, field, read) => method('Game', name, {
    minArgs: 1, argTypes: [argType], active: has('sound'),
    run: ([s]) => {
      const v = read(s);
      if (v !== null) sound().change({ [field]: v });
    },
  });
  // MASTER VOLUME, 0..100 (`GeneralOptions.con` and `Sound.con` write it so):
  // the `Default` volume group, the page's master gain (SND-28).
  soundWord('setMasterVolume', 'int', 'masterVolume', readInt);
  // DISABLE ALL SOUNDS.
  soundWord('setDisableSound', 'bool', 'disableSound', readBool);
  // CHANNELS: the voice pool; the effect sounds get all but the six 2D
  // reserves (SND-44).
  soundWord('setChannels', 'int', 'channels', readInt);
  // SOUND DETAIL and QUALITY: kept, and the page plays HIGH's scripts and the
  // 44 kHz samples whatever they say (SND-43, SND-42).
  soundWord('setSoundDetail', 'int', 'soundDetail', readInt);
  soundWord('setQuality', 'int', 'quality', readInt);
  // HARDWARE ACCELERATION (SND-41): the HRTF path, live, and kept.
  method('Game', 'setHardware', {
    minArgs: 1, argTypes: ['bool'], active: has('hardware'),
    run: ([s]) => {
      const v = readBool(s);
      if (v !== null) get('hardware').set(v);
    },
  });
  // `Sound.dopplerFactor` (SND-45): the engine loops' doppler shift, the
  // voices that do not say `dopplerOff`.
  floatProp('Sound', 'dopplerFactor', 2, () => get('doppler').get(), v => { get('doppler').set(v); },
    has('doppler'));
  // `rolloffFactor` and `distanceFactor` go to DirectSound's listener as the
  // doppler factor does (0x00663d10 -> +0x3c, 0x00663ce0 -> +0x2c), and act on
  // its distance law. The page has none: a voice's fall-off is its script's
  // own Volume <- Distance ramp (map-sounds.md), with the panner's rolloff
  // off. So they are not active here.
  floatProp('Sound', 'rolloffFactor', 2, () => 1, () => '', () => false);
  floatProp('Sound', 'distanceFactor', 2, () => 1, () => '', () => false);
  // `Sound.showSoundInfo`: the page audio's own state under the readout (the
  // client's lines are its DirectSound pool's).
  boolProp('Sound', 'showSoundInfo', 2, () => state.showSoundInfo, on => { state.showSoundInfo = on; refreshOverlay(); },
    has('soundInfo'));
  // `Sound.drawSoundObjects`: needs a marker at every live voice, which the
  // page's voices do not report in one place.
  boolProp('Sound', 'drawSoundObjects', 2, () => false, () => '', () => false);

  // `admin.toggleGamePause` (t0 a1; aliases `pause` and `unpause`) stops and
  // starts the server's game for everyone on it. In a replay it is play and
  // pause.
  method('Admin', 'toggleGamePause', {
    access: 1, active: () => replay() !== null,
    run: () => {
      const r = replay();
      if (r.ui?.togglePlay) r.ui.togglePlay(); else r.playing = !r.playing;
    },
  });

  // --- Chat -----------------------------------------------------------------

  const log = () => get('chatLog');
  const sizes = () => { const l = log(); return { chat: l.sizes[0], info: l.sizes[1], kill: l.sizes[2] }; };
  const sizeProp = (name, key) => prop('Chat', name, 'int', 1, () => sizes()[key],
    s => setChatSizes(log(), { [key]: s }), has('chatLog'));
  sizeProp('chatMessageSize', 'chat');
  sizeProp('gameInfoMessageSize', 'info');
  sizeProp('killMessageSize', 'kill');
  method('Chat', 'setChatHistory', {
    minArgs: 3, argTypes: ['int', 'int', 'int'], access: 1, active: has('chatLog'),
    run: ([chat, info, kill]) => {
      const msg = setChatSizes(log(), { chat, info, kill });
      if (msg) con.output(msg);
    },
  });
  method('Chat', 'chatInfo', {
    access: 1, returns: 'std::string', active: has('chatLog'), run: () => chatInfoLines(sizes()),
  });
  // `chat.timeUntilMessageRemoved` (t1 a1, float): the section timer's
  // limit; ChatLog holds it in 1..10 as the profile load does.
  floatProp('Chat', 'timeUntilMessageRemoved', 1, () => log().limit, v => {
    log().limit = Math.min(10, Math.max(1, v));
  }, has('chatLog'));

  // --- Renderer (access 4 unless said) --------------------------------------

  boolProp('Renderer', 'wireframe', 4, () => Boolean(get('optWire')?.checked), on => {
    const el = get('optWire');
    el.checked = on;
    el.dispatchEvent?.(new Event('change'));
  }, has('optWire'));
  // Fog off is no fog at all (the side panel's box only swaps the level's fog
  // for the draw-distance haze), and back on is the fog it was.
  boolProp('Renderer', 'vertexFogEnable', 4, () => Boolean(get('scene')?.fog), on => {
    const scene = get('scene');
    const vm = get('vmScene');
    if (!on && scene.fog) { state.fog = scene.fog; scene.fog = null; if (vm) vm.fog = null; }
    if (on && !scene.fog && state.fog) { scene.fog = state.fog; if (vm) vm.fog = state.fog; }
  }, has('scene'));
  const fog = () => get('scene')?.fog ?? state.fog;
  floatProp('Renderer', 'fogStart', 4, () => fog()?.near ?? 0, v => { if (fog()) fog().near = v; }, () => Boolean(fog()));
  floatProp('Renderer', 'fogEnd', 4, () => fog()?.far ?? 0, v => { if (fog()) fog().far = v; }, () => Boolean(fog()));
  prop('Renderer', 'fogColorVec', 'Vec3', 4, () => {
    const c = fog()?.color;
    return c ? formatVec3([c.r, c.g, c.b]) : '';
  }, s => {
    const v = parseVec3(s);
    if (v && fog()?.color) fog().color.setRGB(v[0], v[1], v[2]);
  }, () => Boolean(fog()?.color));
  const kinds = { terrain: n => n.userData?.kind === 'terrain', sky: n => n.userData?.kind === 'sky' };
  function setKind(key, on) {
    const root = get('levelRoot');
    state.hidden[key] = !on;
    if (key === 'objects') {
      for (const child of root.children) {
        const k = child.userData?.kind;
        if (k === 'terrain' || k === 'sky' || k === 'water') continue;
        child.visible = on;
      }
    } else {
      root.traverse(n => { if (kinds[key](n)) n.visible = on; });
    }
    if (key === 'sky') {
      const scene = get('scene');
      if (scene) {
        if (!on) { state.background = scene.background; scene.background = scene.fog?.color ?? null; }
        else if (state.background !== undefined) { scene.background = state.background; state.background = undefined; }
      }
    }
  }
  boolProp('Renderer', 'drawTerrain', 4, () => !state.hidden.terrain, on => setKind('terrain', on), has('levelRoot'));
  boolProp('Renderer', 'drawSky', 4, () => !state.hidden.sky, on => setKind('sky', on), has('levelRoot'));
  boolProp('Renderer', 'drawObjects', 4, () => !state.hidden.objects, on => setKind('objects', on), has('levelRoot'));
  // `renderer.drawTrees` (t1 a4): every TreeMesh, trunk to card.
  boolProp('Renderer', 'drawTrees', 4, () => state.trees, on => {
    state.trees = on;
    env.setTrees(on);
  }, () => typeof env.setTrees === 'function');
  // `lensFlare.enable` (t1 a2): the byte `0x009a1db0`, which the manager's
  // static constructor (0x0056f4d0, from 0x00854e20) sets to 1 and the flare
  // pass (0x005707d0, the LensFlare renderable's draw) tests first. Here the
  // flare's own canvas (level-flare.js).
  boolProp('lensFlare', 'enable', 2, () => state.lensFlare, on => {
    state.lensFlare = on;
    const body = doc()?.body;
    if (!body) return;
    ensureStyle();
    body.classList.toggle('console-flare-off', !on);
  }, () => doc() !== null);
  floatProp('Renderer', 'nearPlane', 2, () => get('camera')?.near ?? 0, v => {
    const cam = get('camera');
    if (v > 0) { cam.near = v; cam.updateProjectionMatrix?.(); }
  }, has('camera'));

  // --- Hud ------------------------------------------------------------------

  // The BfMap's open state (`c_PIMap`, bfmap.js).
  boolProp('Hud', 'fullscreenMap', 2, () => Boolean(get('bfmap')?.open), on => get('bfmap').setOpen(on), has('bfmap'));
  method('Hud', 'toggleFullscreenMap', { active: has('bfmap'), run: () => { get('bfmap').toggleOpen(); } });
  // The thumbnail map is the corner minimap.
  boolProp('Hud', 'useThumbnailMap', 2, () => state.thumbnailMap, on => { state.thumbnailMap = on; setHud(state.useHud); });
  method('Hud', 'toggleUseThumbnailMap', { run: () => { state.thumbnailMap = !state.thumbnailMap; setHud(state.useHud); } });

  // --- Name tags and the crosshair -----------------------------------------

  // `game.setNameTagDistance near scope` (0x00426d40 -> `Setup::
  // setNameTagDistance` 0x00442470): the client's own pair, 75 and 300 until
  // set, each capped by the server's (HUD-16).
  const tags = () => get('nametags');
  method('Game', 'setNameTagDistance', {
    minArgs: 2, argTypes: ['float', 'float'], active: has('nametags'),
    run: ([near, scope]) => { tags().setOwn(readFloat(near), readFloat(scope)); },
  });
  // `game.setMaxNameTagDistance near scope` (0x0042be60): the game's
  // vt+0x194, the server's caps (`serverNameTagDistance` and its scope). A
  // replay's caps are its recording's own and win over it there.
  method('Game', 'setMaxNameTagDistance', {
    minArgs: 2, argTypes: ['float', 'float'], active: has('nametags'),
    run: ([near, scope]) => {
      const n = readFloat(near), sc = readFloat(scope);
      if (n !== null && sc !== null) tags().setMax(n, sc);
    },
  });
  // `game.getNameTagDistance` (0x00426e20) calls `0x00401fa0`, a bare `ret`:
  // in 1.61 it prints nothing and returns nothing.
  method('Game', 'getNameTagDistance', { active: has('nametags'), run: () => {} });
  // `game.crossHairRadius` and `crossHairSize` (t1 a2; `Game/Init/Menu.con`
  // writes both 5 through the set strip): HUD units per degree of the held
  // weapon's deviation, the gap and the arm (XHIT-15, vehicle-hud.js).
  const cross = () => get('crosshair');
  floatProp('Game', 'crossHairRadius', 2, () => cross().factors.radius, v => { cross().factors.radius = v; },
    has('crosshair'));
  floatProp('Game', 'crossHairSize', 2, () => cross().factors.size, v => { cross().factors.size = v; },
    has('crosshair'));
  // `game.setCrossHairColor r g b`, 0-255 as the profile writes it: the cross
  // and its hit marks (XHIT-7).
  method('Game', 'setCrossHairColor', {
    minArgs: 3, argTypes: ['float', 'float', 'float'], active: has('crosshair'),
    run: args => {
      const rgb = args.map(readFloat);
      if (rgb.every(v => v !== null)) cross().setColor(rgb);
    },
  });

  // --- Soldier --------------------------------------------------------------

  // `Soldier.cameraShakeFactor` (t1 a1, 0x004f1460): the lower body's shake,
  // the walking bob, 0 in the shipped game (CS-6), held to -1..1 by the
  // setter. Fire, hit and blast shakes are passed 1.0 and do not move with it.
  floatProp('Soldier', 'cameraShakeFactor', 1, () => get('shake').get(), v => { get('shake').set(v); },
    has('shake'));

  // --- Debug ----------------------------------------------------------------

  // `debug.enableParticles` (t1 a2): every effect the page's EffectPlayer draws.
  boolProp('Debug', 'enableParticles', 2, () => get('effectsRoot')?.visible !== false, on => {
    get('effectsRoot').visible = on;
  }, has('effectsRoot'));

  // --- the page's side of the HUD switch and the readouts -------------------

  const HUD_STYLE_ID = 'console-commands-style';
  function ensureStyle() {
    const d = doc();
    if (!d || d.getElementById?.(HUD_STYLE_ID)) return;
    const style = d.createElement('style');
    style.id = HUD_STYLE_ID;
    // Visibility, not `hidden`: the page writes `hidden` on these itself
    // (the briefing, the deploy screen) and must keep doing so.
    style.textContent = `
      body.console-hud-off #hud-canvas, body.console-hud-off #nametag-canvas,
      body.console-hud-off #crosshair, body.console-hud-off #comms-canvas,
      body.console-hud-off #scout-canvas, body.console-hud-off #minimap,
      body.console-minimap-off #minimap,
      body.console-flare-off #flare-canvas { visibility: hidden !important; }
      #console-readout { position: absolute; left: 4px; top: 4px; z-index: 40;
        pointer-events: none; white-space: pre; color: #fff;
        font: 12px/14px ui-monospace, monospace; text-shadow: 1px 1px 0 #000; }`;
    d.head?.appendChild(style);
  }
  function setHud(on) {
    state.useHud = on;
    const body = doc()?.body;
    if (!body) return;
    ensureStyle();
    body.classList.toggle('console-hud-off', !on);
    body.classList.toggle('console-minimap-off', !state.thumbnailMap);
  }

  let readout = null;
  let frames = [];
  let looping = false;
  function refreshOverlay() {
    const d = doc();
    if (!d) return;
    const want = state.showFPS || state.showStats || state.showSoundInfo;
    if (want && !readout) {
      ensureStyle();
      readout = d.createElement('div');
      readout.id = 'console-readout';
      (get('stage') ?? d.body).appendChild(readout);
    }
    if (readout) readout.hidden = !want;
    if (want && !looping) { looping = true; frames = []; schedule(); }
  }
  function schedule() {
    const raf = env.raf ?? (typeof requestAnimationFrame !== 'undefined' ? requestAnimationFrame : null);
    if (raf) raf(tick);
  }
  function tick() {
    if (!(state.showFPS || state.showStats || state.showSoundInfo)) { looping = false; return; }
    const now = env.now ? env.now() : performance.now();
    frames.push(now);
    while (frames.length > 1 && now - frames[0] > 1000) frames.shift();
    readout.textContent = readoutText(now);
    schedule();
  }
  // The page's phase costs (map.html `frameCost`), smoothed over about ten
  // frames so the digits hold still long enough to read.
  const cost = { sim: 0, present: 0, draw: 0, hud: 0, total: 0 };
  function smoothedCost() {
    const last = get('frameCost');
    if (!last) return null;
    for (const k of Object.keys(cost)) cost[k] += ((last[k] ?? 0) - cost[k]) * 0.1;
    return cost;
  }
  // The display's frame intervals over the last second: the p95 and the
  // worst are what "laggy" is, where the mean fps hides them.
  function frameLine() {
    if (frames.length < 3) return null;
    const dts = [];
    for (let i = 1; i < frames.length; i++) dts.push(frames[i] - frames[i - 1]);
    dts.sort((a, b) => a - b);
    const q = p => dts[Math.min(dts.length - 1, Math.floor(dts.length * p))].toFixed(1);
    return `frame ms  p50 ${q(0.5)}  p95 ${q(0.95)}  max ${dts[dts.length - 1].toFixed(1)}`;
  }
  function readoutText(now) {
    const lines = [];
    if (state.showFPS) {
      const span = frames.length > 1 ? (now - frames[0]) / 1000 : 0;
      lines.push(`FPS: ${(span > 0 ? (frames.length - 1) / span : 0).toFixed(1)}`);
    }
    if (state.showStats) {
      const info = get('renderer')?.info;
      if (info) {
        lines.push(`calls ${info.render.calls}  triangles ${info.render.triangles}`);
        lines.push(`geometries ${info.memory.geometries}  textures ${info.memory.textures}`);
      }
      const frame = frameLine();
      if (frame) lines.push(frame);
      const c = smoothedCost();
      if (c) {
        lines.push(`page ms  ${c.total.toFixed(1)}  = sim ${c.sim.toFixed(1)}  present ${c.present.toFixed(1)}`
          + `  draw ${c.draw.toFixed(1)}  hud ${c.hud.toFixed(1)}`);
      }
    }
    if (state.showSoundInfo) {
      try { lines.push(...(get('soundInfo') ?? [])); } catch { /* a nicety */ }
    }
    return lines.join('\n');
  }
  shared.readoutText = readoutText;
  shared.tick = tick;
  return shared;
}
