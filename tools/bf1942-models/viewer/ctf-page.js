// Capture the Flag on the page: the law (`ctf.js`, ledger CTF-1..CTF-8) run
// over the page's own players, the two bases and their flags drawn in the
// world, the game-information lines and the `CTF.ssc` announcer.
//
// Only a CTF layer has it: `?mode=Ctf` selects the layer (`game-modes.js`
// carries its `flagBases`), and `round-state.js` plays the CTF score table and
// its cap limit (`?scoreLimit=`, `game.serverScoreLimit`). Anywhere else this
// module does nothing.
//
// In a room the server owns the law (`server/authority.mjs`); the page plays
// the authority's `ctf` rows on its own copy (`onRow`), so every client sees
// the same flags.
//
// A dropped flag lies on the terrain's slope, its up axis the heightfield's
// normal under it (CTF-5: `Flag::handleDrop` rebuilds the frame from
// `terrainBase`'s normal and the dead carrier's right axis).
//
// What is the page's choice, because the game was not read for it: where a
// carried flag hangs (drawn over the carrier's head; the engine files the flag
// as an item of the carrier's soldier, `BFSoldier::addItem`, and where the
// client draws that item is unread), the cloth's wave (the models tree's flag
// is the mesh alone, already posed at `FlagBlow` frame 0 by the exporter --
// `bf42/flagcloth.py` -- without the clip the level bakes give a control
// point's cloth), and a dropped flag's heading, which keeps its pole's where
// the engine keeps the dead carrier's (the law does not carry his heading).

import * as THREE from 'three';
import { createCtf, ctfLine, ctfPatch } from './ctf.js';
import { GAME_PLAY_MODE, gamePlayModeOf } from './round-state.js';

/** The models tree's template for each flag cloth geometry (the vanilla
 *  `AnimatedBundle`s of `Objects/Items/Flag/Objects.con`): a level that
 *  declares its own `BlueFlag`/`RedFlag` dresses it in one of these. */
export const FLAG_BUNDLES = Object.freeze({
  flagge_m1: 'AnimatedGeFlag', flagus_m1: 'AnimatedUsFlag', flaguk_m1: 'AnimatedUkFlag',
  flagjp_m1: 'AnimatedJapFlag', flagso_m1: 'AnimatedSoFlag', flagcan_m1: 'AnimatedCanFlag',
  flagit_m1: 'AnimatedItFlag', flagfr_m1: 'AnimatedFrFlag',
});

/** The pole every shipped `FlagBase` stands on (`flagbase_m1`), as the
 *  vanilla `FlagPole` template carries it. */
export const FLAG_POLE = 'FlagPole';

/** Metres over a carrier's feet the page puts his flag's attach point (a
 *  viewer choice): the cloth, which hangs about 1 m under it, then clears
 *  his head. */
export const CARRIED_HEIGHT = 2.9;

/** The models to try for a base's pole and its flag's cloth, in order: the
 *  level's own template name first, then the shared one by geometry. */
export function modelCandidates(base) {
  const pole = [base?.template, FLAG_POLE].filter(Boolean);
  const geometry = String(base?.flag?.geometry ?? '').toLowerCase();
  const cloth = [base?.flag?.template, FLAG_BUNDLES[geometry]].filter(Boolean);
  return { pole: [...new Set(pole)], cloth: [...new Set(cloth)] };
}

/** Whether a level, as the page selected it, plays CTF: the layer's game
 *  play mode is CTF's and it places at least one flag base. */
export function playsCtf(extras) {
  return gamePlayModeOf(extras?.gameplayMode) === GAME_PLAY_MODE.ctf
    && Array.isArray(extras?.flagBases) && extras.flagBases.length > 0;
}

/**
 * Built once by the page. `page` hands in, as getters or functions:
 * `roomCtf()` (a room's HELLO `ctf` snapshot), `extras`, `world`, `round`,
 * `groundHeight(x, z)`, `collider` (its
 * `heightfield` tilts a dropped flag), `loader`, `scene`,
 * `MODELS_BASE`, `bust`, `MAPS_BASE`, `bindDynamicShading(root)`,
 * `bots` (the referee's), `LOCAL_PLAYER`, `localName`, `localTeam()`,
 * `roomJoined`, `comms`, `teamVoice(team)`, `audioListener`, `audioLoader`,
 * `audioBufferCache`, `ensureAudioContext`, `masterVolume`, `AUDIO_OFF`.
 */
export function createCtfPage(page) {
  const ctfPage = { ctf: null, log: [], voices: [], models: {} };
  let group = null;
  let soundsManifest = null;
  let soundsLoad = null;
  /** The level the state belongs to: a new one starts it again. */
  let builtFor = null;
  /** In a room: the HELLO snapshot already applied, and the server's rows
   *  that arrived before the level's world was ready to take them. */
  let restoredFrom = null;
  let pendingRows = [];

  // --- the level -------------------------------------------------------------

  /** Build (or drop) the CTF state for the level as the page now holds it.
   *  Called when the level's world is ready; harmless to call again. */
  ctfPage.setup = () => {
    const extras = page.extras;
    if (builtFor === extras) return ctfPage.ctf;
    teardown();
    builtFor = extras;
    if (!playsCtf(extras)) return null;
    // The round is rebuilt per level and restarted in place; the law pays
    // whichever is live when a flag scores.
    const round = { flagScore: event => page.round?.flagScore?.(event) };
    ctfPage.ctf = createCtf({
      bases: extras.flagBases,
      round,
      groundHeight: (x, z) => page.groundHeight?.(x, z),
    });
    group = new THREE.Group();
    group.name = 'ctf';
    page.scene?.add(group);
    for (const base of ctfPage.ctf.bases) placeBase(base);
    loadSounds();
    return ctfPage.ctf;
  };

  function teardown() {
    if (group) {
      group.removeFromParent();
      group = null;
    }
    ctfPage.ctf = null;
    ctfPage.log = [];
    ctfPage.voices = [];
    ctfPage.models = {};
    // The new copy starts from the HELLO again; rows kept while the level
    // loaded stay for it (a room changes level by reloading the page).
    restoredFrom = null;
  }

  /** A room's flags when this client joined (HELLO's `ctf`, the server's
   *  `ctf.js` `snapshot`), once per join, then the rows that came after it. */
  function catchUp() {
    const ctf = ctfPage.ctf;
    if (!ctf) return;
    const rows = page.roomCtf?.() ?? null;
    if (rows && rows !== restoredFrom) {
      restoredFrom = rows;
      ctf.restore(rows);
    }
    if (!pendingRows.length) return;
    const queued = pendingRows;
    pendingRows = [];
    for (const row of queued) ctfPage.onRow(row);
  }

  /** The `restartMap` half of CTF: every flag back on its pole. */
  ctfPage.reset = () => {
    ctfPage.ctf?.reset();
    present();
  };

  // --- the meshes --------------------------------------------------------------

  const modelCache = new Map();
  function loadModel(name) {
    let pending = modelCache.get(name);
    if (pending) return pending;
    const trees = [page.MODELS_BASE || 'models'];
    if (!trees.includes('models')) trees.push('models');
    pending = (async () => {
      for (const tree of trees) {
        const url = `${tree}/${String(name).replace(/[\\/]/g, '_')}.glb`;
        try {
          const gltf = await page.loader.loadAsync(`${url}${page.bust?.() ?? ''}`);
          return { url, scene: gltf.scene };
        } catch (_) { /* the next tree */ }
      }
      return null;
    })();
    modelCache.set(name, pending);
    return pending;
  }

  async function firstModel(names) {
    for (const name of names) {
      const hit = await loadModel(name);
      if (hit) return { name, ...hit };
    }
    return null;
  }

  function placeBase(base) {
    const pole = new THREE.Group();
    pole.name = `ctf-base-${base.index}`;
    pole.position.fromArray(base.position);
    // `Object.rotation` is Refractor degrees, yaw first; the exporter's frame
    // turns a node by Ry(-yaw) (`spawn-flags.js` `spawnYaw`).
    pole.rotation.y = -(base.rotation?.[0] ?? 0) * Math.PI / 180;
    group.add(pole);
    const cloth = new THREE.Group();
    cloth.name = `ctf-flag-${base.index}`;
    cloth.rotation.y = pole.rotation.y;
    cloth.userData.yaw = pole.rotation.y;
    group.add(cloth);
    const flag = ctfPage.ctf.flags.find(f => f.index === base.index);
    if (flag) flag.node = cloth;
    const wanted = modelCandidates(base);
    const owner = builtFor;
    firstModel(wanted.pole).then(hit => attach(owner, pole, hit, `pole${base.index}`));
    firstModel(wanted.cloth).then(hit => attach(owner, cloth, hit, `cloth${base.index}`));
    present();
  }

  function attach(owner, node, hit, key) {
    if (owner !== builtFor) return;
    ctfPage.models[key] = hit ? hit.url : null;
    if (!hit) return;
    const copy = hit.scene.clone(true);
    copy.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    page.bindDynamicShading?.(copy);
    node.add(copy);
  }

  /** Every flag where the law has it: on its pole, on the ground, or over
   *  its carrier. */
  function present() {
    const ctf = ctfPage.ctf;
    if (!ctf) return;
    for (const flag of ctf.flags) {
      if (!flag.node) continue;
      const [x, y, z] = flag.position;
      const carried = flag.carrier != null;
      flag.node.position.set(x, y + (carried ? CARRIED_HEIGHT : 0), z);
      orient(flag, !flag.home && !carried);
    }
  }

  const normalScratch = [0, 1, 0];
  const right = new THREE.Vector3();
  const up = new THREE.Vector3();
  const back = new THREE.Vector3();
  const basis = new THREE.Matrix4();

  /** On its pole or carried a flag stands upright on its pole's heading; on
   *  the ground its up axis is the terrain's normal under it, the heading's
   *  right axis laid into that plane, as `Flag::handleDrop` builds the frame
   *  (CTF-5). Worked out once per place the flag comes to rest. */
  function orient(flag, onGround) {
    const node = flag.node;
    const yaw = node.userData.yaw ?? 0;
    if (!onGround) {
      if (node.userData.restAt != null) {
        node.rotation.set(0, yaw, 0);
        node.userData.restAt = null;
      }
      return;
    }
    if (node.userData.restAt === flag.position) return;
    node.userData.restAt = flag.position;
    const field = page.collider?.heightfield;
    const n = field?.normal ? field.normal(flag.position[0], flag.position[2], normalScratch) : null;
    if (!n || !n.every(Number.isFinite)) { node.rotation.set(0, yaw, 0); return; }
    up.set(n[0], n[1], n[2]).normalize();
    right.set(Math.cos(yaw), 0, -Math.sin(yaw));
    right.addScaledVector(up, -right.dot(up));
    if (right.lengthSq() < 1e-8) right.set(0, 0, 1).addScaledVector(up, -up.z);
    right.normalize();
    back.crossVectors(right, up);
    basis.makeBasis(right, up, back);
    node.quaternion.setFromRotationMatrix(basis);
  }

  // --- the law, on the page's own round ----------------------------------------

  /** The page's players as the law reads them (CTF-2..CTF-4): every player
   *  of a side, whether he lives, whether he is on foot, where he stands. */
  function players() {
    const w = page.world;
    if (!w?.players) return [];
    const bots = new Map((page.bots ?? []).map(b => [b.playerId, b]));
    const out = [];
    for (const [id, p] of w.players) {
      if (p?.team !== 1 && p?.team !== 2) continue;
      const bot = bots.get(id);
      let position = null;
      if (bot) position = bot.getPosition?.() ?? null;
      else if (p.occupancy?.root && p.vehicle?.state?.position) {
        const s = p.vehicle.state.position;
        position = [s.x, s.y, s.z];
      } else if (p.soldier) position = [p.soldier.x, p.soldier.y, p.soldier.z];
      if (!position) continue;
      out.push({
        id, team: p.team,
        alive: !(w.armorOf?.(id)?.destroyed ?? false),
        onFoot: bot ? !bot.vehicle : !p.occupancy?.root,
        position: [...position],
        name: bot ? (bot.name ?? String(id)) : (id === page.LOCAL_PLAYER ? page.localName?.() ?? 'Player' : String(id)),
      });
    }
    return out;
  }

  /** One world step of the law (`dt` the ticks' seconds). Not in a room
   *  (the server runs it there) and not after the round's end, when the
   *  status is EndGame and the world stands still. */
  ctfPage.tick = dt => {
    const ctf = ctfPage.ctf;
    if (!ctf) return [];
    if (page.roomJoined) {
      // The server's law moves the flags; between its rows a carried one
      // follows its carrier as this client draws him.
      catchUp();
      if (page.roomPositionOf) ctf.follow(page.roomPositionOf);
      present();
      return [];
    }
    if (!(dt > 0) || page.round?.status === 'endGame') { present(); return []; }
    const events = ctf.tick(dt, players());
    for (const event of events) announce(event);
    present();
    return events;
  };

  /** A room's `ctf` row: the authority's event, applied to this copy. */
  ctfPage.onRow = row => {
    const ctf = ctfPage.ctf;
    if (row?.type !== 'ctf') return;
    if (!ctf) {
      // The level is still loading: keep the row for `catchUp`.
      if (page.roomJoined && pendingRows.length < 256) pendingRows.push(row);
      return;
    }
    if (page.roomJoined) catchUp();
    if (!ctf.applyEvent(row)) return;
    announce(row);
    present();
  };

  /** A room's carriers between rows: `positionOf(id)` answers `[x, y, z]`. */
  ctfPage.follow = positionOf => {
    ctfPage.ctf?.follow(positionOf);
    present();
  };

  // --- the lines and the announcer ---------------------------------------------

  function announce(event) {
    const entry = { kind: event.kind, flag: event.flag, team: event.team, player: event.player };
    ctfPage.log.push(entry);
    if (ctfPage.log.length > 64) ctfPage.log.shift();
    // The flag going home by itself pays nothing and says nothing (CTF-4).
    if (event.kind === 'home') return;
    const strings = page.comms?.lexicon?.()?.strings ?? null;
    const text = ctfLine(event.kind, event.name || String(event.player ?? ''), event.team, strings);
    if (text) page.comms?.info?.(text, event.team);
    entry.line = text;
    const patch = ctfPatch(event.kind, event.team);
    if (patch != null) playPatch(patch).then(played => { entry.voice = played; });
  }

  function sharedDir() {
    return page.MAPS_BASE === 'maps' ? 'maps/_shared' : `${page.MAPS_BASE}/_shared`;
  }

  function loadSounds() {
    if (soundsLoad) return soundsLoad;
    soundsLoad = fetch(`${sharedDir()}/voices/ctf-sounds.json${page.bust?.() ?? ''}`)
      .then(r => (r.ok ? r.json() : null))
      .catch(() => null)
      .then(json => { soundsManifest = json; return json; });
    return soundsLoad;
  }

  /**
   * `CTF.ssc` patch `index`, flat, in the LOCAL side's language (the client
   * loads the script under its own `@Language`, `BfMenu+0x6f8`): one of the
   * patch's stems the nation ships, at random when the patch says
   * `randomPlay`. Resolves to `{ dir, stem }`, or null when nothing played.
   */
  async function playPatch(index) {
    const manifest = soundsManifest ?? await loadSounds();
    const patch = manifest?.patches?.find(p => p.index === index) ?? manifest?.patches?.[index];
    if (!patch?.stems?.length || page.AUDIO_OFF || !(page.masterVolume?.() > 0)) return null;
    const nation = page.teamVoice?.(page.localTeam?.()) ?? 'us';
    const have = manifest.nations?.[nation]?.stems;
    const stems = Array.isArray(have) ? patch.stems.filter(s => have.includes(s)) : patch.stems;
    if (!stems.length) return null;
    const pick = patch.random ? [stems[Math.floor(Math.random() * stems.length)]] : stems;
    page.ensureAudioContext?.();
    const listener = page.audioListener;
    if (!listener || listener.context.state === 'suspended' || !page.audioLoader) return null;
    let played = null;
    for (const stem of pick) {
      for (const dir of [`${sharedDir()}/voices/${nation}`, `maps/_shared/voices/${nation}`]) {
        const url = `${dir}/${stem}.mp3`;
        const key = `ctf:${url}`;
        let pending = page.audioBufferCache?.get(key);
        if (!pending) {
          pending = page.audioLoader.loadAsync(`${url}${page.bust?.() ?? ''}`).catch(() => null);
          page.audioBufferCache?.set(key, pending);
        }
        const buffer = await pending;
        if (!buffer) continue;
        const ctx = listener.context;
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        const gain = ctx.createGain();
        gain.gain.value = page.masterVolume();
        source.connect(gain);
        gain.connect(listener.getInput());
        source.onended = () => { try { source.disconnect(); gain.disconnect(); } catch (_) {} };
        try { source.start(); } catch (_) { /* a closed context */ }
        played = { dir, stem };
        ctfPage.voices.push({ index, ...played });
        break;
      }
    }
    return played;
  }

  // --- the HUD and the map ------------------------------------------------------

  /** The local player in the law's ids: his room slot in a room. */
  const localId = () => (page.roomJoined ? page.roomSlot : page.LOCAL_PLAYER);

  /** A side's soldier art (`soldier-icons.json`, HUD-11), else the art its
   *  nation would carry: `teamFlag` `Icon_flag_ger.tga`, `minimap`
   *  `flag_ger.tga`. */
  function teamIcon(team, key, prefix) {
    const art = page.teamArt?.(team);
    if (art?.[key]) return art[key];
    const nation = page.teamNation?.(team);
    return nation ? `${prefix}_${nation}.tga` : null;
  }

  /**
   * The HUD's carrier icon (CTF-9), fed every HUD frame after the soldier
   * HUD has cleared the pair: the local player carrying a flag raises
   * `AlliedFlagIcon` on team 1 (the Allied flag in his hands) and
   * `AxisFlagIcon` on any other side; `AxisCtfFlag` and `AlliedCtfFlag` are
   * each side's soldier `teamFlagIcon`.
   */
  ctfPage.feedHud = vars => {
    const ctf = ctfPage.ctf;
    if (!ctf || !vars) return;
    const id = localId();
    const carrying = id != null && !!ctf.carriedBy(id);
    vars.AxisFlagIcon = false;
    vars.AlliedFlagIcon = false;
    if (carrying) {
      if (page.localTeam?.() === 1) vars.AlliedFlagIcon = true;
      else vars.AxisFlagIcon = true;
    }
    const axis = teamIcon(1, 'teamFlag', 'Icon_flag');
    const allied = teamIcon(2, 'teamFlag', 'Icon_flag');
    if (axis) vars.AxisCtfFlag = axis;
    if (allied) vars.AlliedCtfFlag = allied;
  };

  /** The map's flag pass (CTF-10): each flag of a side where it is, in that
   *  side's soldier minimap icon, `{ x, z, icon, alpha }`. */
  ctfPage.mapMarks = () => {
    const ctf = ctfPage.ctf;
    if (!ctf) return [];
    const out = [];
    for (const flag of ctf.flags) {
      if (flag.team !== 1 && flag.team !== 2) continue;
      const icon = teamIcon(flag.team, 'minimap', 'flag');
      if (!icon) continue;
      const key = icon.replace(/\\/g, '/').split('/').pop().replace(/\.[^.]+$/, '').toLowerCase();
      out.push({ x: flag.position[0], z: flag.position[2], icon: key, alpha: 0.6 });
    }
    return out;
  };

  /** What the map's marks depend on, for its repaint key: where each flag
   *  is, to the metre. */
  ctfPage.marksKey = () => {
    const ctf = ctfPage.ctf;
    if (!ctf) return '';
    return ctf.flags.map(f => `|${f.index}:${Math.round(f.position[0])},${Math.round(f.position[2])}`).join('');
  };

  /** What the law and the drawing hold, for the test hooks. */
  ctfPage.state = () => {
    const ctf = ctfPage.ctf;
    return {
      active: !!ctf,
      bases: ctf ? ctf.bases.map(b => ({ index: b.index, name: b.name, team: b.team, position: b.position })) : [],
      flags: ctf ? ctf.flags.map(f => ({
        index: f.index, team: f.team, home: f.home, carrier: f.carrier, carrierTeam: f.carrierTeam,
        position: f.position.slice(), respawnIn: f.respawnIn,
        drawn: f.node ? [f.node.position.x, f.node.position.y, f.node.position.z] : null,
        up: f.node ? new THREE.Vector3(0, 1, 0).applyQuaternion(f.node.quaternion).toArray() : null,
      })) : [],
      log: ctfPage.log.slice(),
      voices: ctfPage.voices.slice(),
      models: { ...ctfPage.models },
    };
  };

  return ctfPage;
}
