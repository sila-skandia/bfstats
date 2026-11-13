// A soldier's face: the blink, the look around, the wince, the dead stare,
// and the mouth on a shout.
//
// THE HEAD. A soldier's head is an `AnimatedBundle` with a skeleton of its own
// (`animations/UsFace.ske`: `Bip01 Spine3` -> `Neck` -> `Head` -> `face` and 24
// bones under it), whose first three bones the soldier binds to their body's
// (`ObjectTemplate.bindToSkeletonPart Bip01_Spine3 3`). The soldier's
// `addTemplate` gives it `setLodValue 0.01` and the plain head beside it
// `setLodValue -0.01`: `BFSoldier::updateVisibleSets` (lnxded `0x082707c0`)
// draws a child with a value `v >= 0` while the soldier's level of detail is
// at or under `v`, and one with `v < 0` while it is over `-v`.
// `BFSoldier::getLevelOfDetail` (`0x0826e080`) is
//
//   clamp(|camera - soldier| x renderView.getFieldOfView() / 500, 0, 1)
//
// the 500 from `BFSoldierTemplate`'s constructor (`+0x19c = 0x43fa0000`,
// `0x0827a2a2`; no vanilla script sets it) and the field of view the render
// view's own number (vtable `0x0874c600` slot `+0x18` = `getFieldOfView`
// `0x08444460`), 1 at `VideoDefault.con`'s `renderer.fieldOfView 1`. So the
// animated head is drawn inside 5 m at the default lens, 10 m at a 0.5 zoom,
// and the rigid head past it. The rig bakes the rigid look (the face skin
// riding `Bip01 Head`); `poses/faces/<Soldier>.face.glb` is the animated
// head, swapped in under the same rule, and nothing is fetched or ticked for
// a soldier outside it.
//
// THE MACHINE. A third state machine plays on the head
// (`BFSoldier::playFaceAnimation`, lnxded `0x0826e160` by index, `0x0826e1c0`
// by name: it walks the soldier's bundles and sets the state on each).
// `AnimationStatesFace.con` declares its states; three things set them:
//
//  - `setDefaultAnimationStates` (`0x0826ce20`) enters `FaceLook` (the string
//    at `0x086d1dc0`), a loop of `USFaceIdle60.baf` with nine `addIdle`
//    entries: `FaceLook2` three times, `FaceBlink` and `FaceLook3` twice,
//    `FaceTalk` and `FaceAngry1` once. A state's idle timer is armed to
//    `(rand & 3) + 4` s on entry and draws `rand() % n` of the list when it
//    runs out (ANIM-6); each idle is a one-shot that returns to `FaceLook`.
//  - The body. Each frame `BFSoldier::handleFrameUpdate` (`0x08271140`)
//    takes `getOtherState(0)` of the legs' current state and then of the
//    torso's (`0x082712d3`, the later one kept), the state's `setOtherState
//    c_AsmFaceState`, and plays it (`0x08271526`) unless a spoken line is
//    queued (`0x082713ca`). `setCurrentState` (`0x0832b150`) does nothing
//    for the state already current, so a one-shot the body still names is
//    entered again the frame after it returns. The deaths name `FaceDead1` /
//    `FaceDead2` (which return nowhere: the face stays), the hits `FaceHit`,
//    a blast's flight `FaceScream`, the fire `FaceAim2` or `FaceFire1` by
//    weapon, a jump `FaceFire1`, the draw `FaceLook2`.
//  - A shout. `Radio`'s shout handler (client `0x006d2790`), for a speaker on
//    foot, calls `getLipSync(language, message)` (`0x006d24d0`) and
//    `BFSoldier::speakLine(sign, symbols)` (client `0x004feb20`, lnxded
//    `0x0826e220`), which appends the string's characters to a list on the
//    soldier (`+0x554`). `handleFrameUpdate` counts a timer (`+0x550`) down
//    while the list holds any; at or under zero it pops one character, looks
//    it up in the machine's 256-entry table (`getSpeakConnectionState`
//    `0x083274c0`, filled by `addSpeakConnectionSymbol`) and, where a state
//    answers, plays it and sets the timer to 0.1 s (`0x3dcccccd`,
//    `0x08271763`); a character no state answers to takes no time. When the
//    list empties the timer is set to 0.5 s (`0x3f000000`, `0x0827177b`) and,
//    when that runs out, `FaceLook` is played (`0x082717e3`). The eleven
//    viseme states are poses: each a two-frame clip at rate 0.03, reached by
//    `setMorphFactor 10` (a tenth of a second).
//
// THE LIP-SYNC TABLES are the exe's: five functions of one switch each, by
// message 29..54 (`LIP_SYNC` below, read from the jump tables). There is no
// per-sound lip file and the sound's loudness is not read. `getLipSync` picks
// the table by comparing its string with "UsEnglish", "English", "Russian",
// "German" and "Japanese", else the first; the handler hands it
// `Game::getTeamSkin(speaker's team)` (`game` vtable `+0x60`, lnxded
// `0x0805e610`), the side's SOLDIER TEMPLATE name ("GermanSoldier"), which
// is none of the five. So in the shipped game every soldier mouths the
// American table whatever they speak; `lipSync` keeps the compare as it is.
//
// The machine and the overlay are free of `three` and of the DOM (the clips
// and bones are handed in), so `tests/soldier_face_harness.mjs` runs the real
// thing under node. `createSoldierFaces` is the page's half: the files, the
// swap and the gate.

/** `BFSoldierTemplate +0x19c`, the constructor's 500.0 (lnxded `0x0827a2a2`). */
export const SOLDIER_LOD_DISTANCE = 500;
/** `setLodValue` on every vanilla soldier's animated head. */
export const FACE_LOD_VALUE = 0.01;
/** The state `setDefaultAnimationStates` enters (lnxded `0x086d1dc0`). */
export const FACE_BASE_STATE = 'FaceLook';
/** One lip-sync symbol's time (`0x3dcccccd`, lnxded `0x08271763`). */
export const VISEME_SECONDS = 0.1;
/** The hold after the last symbol, before `FaceLook` (`0x3f000000`, `0x0827177b`). */
export const SPEAK_REST_SECONDS = 0.5;
/** A state's idle timer on entry: `(rand & 3) + IDLE_BASE_SECONDS` (ANIM-6). */
export const IDLE_BASE_SECONDS = 4;
/** `AnimationState`'s constructor morph (lnxded `0x08328bf8`). */
const DEFAULT_MORPH = 5;
/** A morph above this cuts (`.rodata` 1000.0, ANIM-4). */
const MORPH_CUT = 1000;

/**
 * The exe's lip-sync strings, by table and message id (client `0x006edfc0`
 * UsEnglish, `0x006ee0f0` English, `0x006ee230` Russian, `0x006ee380` German,
 * `0x006ee4d0` Japanese; jump tables `0x006ee084`, `0x006ee1c4`, `0x006ee318`,
 * `0x006ee468`, `0x006ee5a4`, each indexed `id - 29` over 26 entries). Ids
 * 33..35 and 50 have no case and give the empty string.
 */
export const LIP_SYNC = Object.freeze({
  UsEnglish: Object.freeze({
    29: 'i_eoimie', 30: 'iei', 31: 'eoie', 32: 'eie', 36: 'eie', 37: 'IEO', 38: 'O;ieo',
    39: 'IE-OEIOOOOO;-', 40: 'MIMI', 41: 'IOMOE', 42: 'IEIO', 43: 'IOE', 44: 'OE-I-OMIE',
    45: 'oeomIE', 46: 'OEI', 47: 'ieoi', 48: 'EOME', 49: 'EMO-EMO;EMO', 51: 'ieoi',
    52: 'IOMOE', 53: 'IEIO', 54: 'MIMI',
  }),
  English: Object.freeze({
    29: 'ieoimie', 30: 'ie_ie_', 31: 'oie', 32: 'o', 36: 'ie', 37: 'IEO', 38: 'O;ieo',
    39: 'IEOEIOOOOO;-', 40: 'MIMI', 41: 'IMOE', 42: 'IEO', 43: 'oe', 44: 'oeiOMIE',
    45: 'oemie', 46: 'OEI', 47: 'ie_eoei', 48: 'EOME', 49: 'eo', 51: 'im_eoieoe',
    52: 'IEOEO;-IMOE', 53: 'IEO', 54: 'MIMI',
  }),
  Russian: Object.freeze({
    29: 'ieo_oime', 30: 'ieo;io', 31: 'ei', 32: 'ie', 36: 'oeI', 37: 'iEO', 38: 'EMIEO',
    39: 'IEOEIO', 40: 'MIMI', 41: 'OEIEI', 42: 'EIMEIOEO', 43: 'IEOE', 44: 'oeieMIo',
    45: 'imeieoe', 46: 'ioE', 47: 'ieo;miE', 48: 'EIMO', 49: 'eiO', 51: 'ieoi',
    52: 'IOMOE', 53: 'IEIO', 54: 'MIMI',
  }),
  German: Object.freeze({
    29: 'ieoi;mio-e', 30: 'iEI', 31: 'Oie', 32: 'ei', 36: 'EI__ieiooe;_', 37: 'IO--IO',
    38: 'OMEIE', 39: 'IEO;-OEIO', 40: 'Eim_;i_om_iioie_', 41: 'IEMIO', 42: 'IOEI',
    43: 'IEOE', 44: 'oeioMIE', 45: 'Omi_eimin', 46: 'IEOEE-', 47: 'IE-EOEIEII-',
    48: 'EOME', 49: 'ei_EO', 51: 'EOIOE', 52: 'IOE', 53: 'IOEI', 54: 'MIMI',
  }),
  Japanese: Object.freeze({
    29: 'ie;OOemi', 30: 'oeOOIEIEM-', 31: 'oe', 32: 'ei', 36: 'EI', 37: 'IMO', 38: 'EI',
    39: 'IEO;OI', 40: 'EMI', 41: 'IEO', 42: 'ieO', 43: 'imO', 44: 'IMOEI', 45: 'IEO;OEI',
    46: 'IEO', 47: 'IE-I', 48: 'IEOE', 49: 'EOI', 51: 'IE-I', 52: 'IEO-', 53: 'ieO-',
    54: 'EMI-',
  }),
});

/**
 * `getLipSync(name, id)` (client `0x006d24d0`): the table whose name `name`
 * IS, exactly as the exe compares (`std::string == const char*`), else
 * UsEnglish's; '' for a message with no case. The game hands it the
 * speaker's side's soldier template name, so pass that.
 */
export function lipSync(name, id) {
  const table = Object.hasOwn(LIP_SYNC, name) ? LIP_SYNC[name] : LIP_SYNC.UsEnglish;
  return table[id] ?? '';
}

/** `BFSoldier::getLevelOfDetail`: `distance` in metres, `fov` the render
 *  view's field of view (radians of the vertical lens; 1 unzoomed). */
export function soldierLod(distance, fov = 1, lodDistance = SOLDIER_LOD_DISTANCE) {
  const lod = (distance * fov) / lodDistance;
  return lod > 1 ? 1 : lod < 0 ? 0 : lod;
}

/** Whether the animated head is the one drawn (`updateVisibleSets`): the
 *  level of detail at or under the head's `setLodValue`. */
export function faceDrawn(distance, fov = 1, lodValue = FACE_LOD_VALUE) {
  return !(lodValue < soldierLod(distance, fov));
}

/** The render view's field of view for a three camera: vertical `fovDeg`
 *  narrowed by `zoom`, in radians. */
export function viewFieldOfView(fovDeg, zoom = 1) {
  return 2 * Math.atan(Math.tan((fovDeg * Math.PI) / 360) / (zoom || 1));
}

/**
 * The face state the body's two states name, the torso's over the legs'
 * (`handleFrameUpdate`), or null. `bodyStates` is `faces.json`'s table,
 * keyed by the engine's own lower-cased state name. The renderers name a
 * per-weapon state without its weapon (`Ub_Fire`), so the weapon in hand is
 * put back: `Ub_FireMedPack` is `FaceHeal`, `Ub_FireK98` names none, and the
 * bare name answers only for a state that is not a weapon's copy.
 */
export function bodyFaceState(bodyStates, lower, upper, weapon = '') {
  if (!bodyStates) return null;
  let found = null;
  for (const name of [lower, upper]) {
    if (typeof name !== 'string' || !name) continue;
    const bare = name.toLowerCase();
    const held = weapon ? bare + String(weapon).toLowerCase() : null;
    const face = (held && bodyStates[held]) || (isWeaponState(bare) ? null : bodyStates[bare]);
    if (face) found = face;
  }
  return found;
}

/** The states a live family plays whole-body, for the two renderers that
 *  hold a family and a torso one-shot rather than a state machine
 *  (`netcode-render.js`, `foot-body.js`). */
const FAMILY_STATES = Object.freeze({
  flyForward: ['Lb_ExplosionForward', 'Ub_ExplosionForward'],
  flyBackward: ['Lb_ExplosionBackward', 'Ub_ExplosionBackward'],
  'live.standJump': ['Lb_StandJump', 'Ub_StandJump'],
  'live.runJump': ['Lb_RunJump', 'Ub_RunJump'],
});

/** `[lower, upper]` for `bodyFaceState` from a family (`want`), the
 *  torso's running one-shot (`stab`: `{ action, left }`, its clip named by
 *  the state it is) and, where the renderer has one, the family's own
 *  `{ lower, upper }` clip pair (a death's, a live jump's). */
export function familyFaceStates(want, stab, clips = null) {
  const whole = clips ? [clips.lower, clips.upper]
    : FAMILY_STATES[want]
      // A death family is its states' name: `dieChestStand`, `Lb_DieChestStand`.
      ?? (/^die[A-Z]/.test(want ?? '') ? [`Lb_D${want.slice(1)}`, `Ub_D${want.slice(1)}`] : null);
  const torso = stab && stab.left > 0 ? stab.action?.getClip?.()?.name ?? null : null;
  return [whole?.[0] ?? null, torso ?? whole?.[1] ?? null];
}

/** The body states the scripts copy per weapon (`copyState`): the fire, the
 *  jump and the draw. Their bare name is a clipless hub the soldier is never
 *  in while they hold something. */
const WEAPON_STATE = /^ub_(lie)?(alt)?fire(end)?$|^ub_(stand|run)jump$|^ub_(stand|crouch|lie)raiseweapon$/;
function isWeaponState(bare) { return WEAPON_STATE.test(bare); }

/**
 * The face's state machine, by the engine's rules above. `states` is
 * `faces.json`'s (`{ speed, loop, morph, then, idles }` by name), `symbols`
 * its lip-sync table (`{ ';': 'Face_blink', ... }`). `random` returns [0, 1).
 */
export class FaceMachine {
  constructor({ states, symbols, base = FACE_BASE_STATE, random = Math.random } = {}) {
    this.states = states ?? {};
    this.symbols = symbols ?? {};
    this.base = base;
    this.random = random;
    /** The spoken line's symbols still to play (`BFSoldier +0x554`). */
    this.queue = [];
    /** `BFSoldier +0x550`. */
    this.timer = 0;
    this.current = null;
    this.enter(base);
  }

  get name() { return this.current?.name ?? null; }
  get speaking() { return this.queue.length > 0; }

  /** `setCurrentState`: nothing for the state already current. */
  enter(name) {
    const info = this.states[name];
    if (!info || this.current?.name === name) return false;
    const speed = Number.isFinite(info.speed) ? Math.abs(info.speed) : 1;
    const morph = Number.isFinite(info.morph) ? info.morph : DEFAULT_MORPH;
    this.current = {
      name, info, morph,
      time: 0,
      seconds: speed > 0 ? 1 / speed : Infinity,
      w: morph > MORPH_CUT ? 1 : 0,
      fresh: true,
      // `setCurrentState` parks the idle timer; the first update arms it.
      idle: 1000,
    };
    return true;
  }

  /** `speakLine`: the line's characters go on the end of the list. */
  speak(symbols) {
    for (const c of String(symbols ?? '')) this.queue.push(c);
  }

  /** `setDefaultAnimationStates`, and the line dropped. */
  reset() {
    this.queue.length = 0;
    this.timer = 0;
    this.current = null;
    this.enter(this.base);
  }

  /**
   * One frame. `bodyFace` is the face state the body's states name
   * (`bodyFaceState`), or null. Returns the current state's record:
   * `{ name, time, seconds, w }`.
   */
  update(dt, bodyFace = null) {
    const step = Math.max(0, dt);
    if (this.queue.length) {
      this.timer -= step;
      if (this.timer <= 0) {
        const state = this.symbols[this.queue.shift()];
        if (state && this.states[state]) {
          this.enter(state);
          this.timer = VISEME_SECONDS;
        }
        if (!this.queue.length) this.timer = SPEAK_REST_SECONDS;
      }
    } else if (this.timer > 0) {
      this.timer -= step;
      if (this.timer <= 0) {
        this.timer = 0;
        this.enter(this.base);
      }
    }
    if (bodyFace && !this.queue.length) this.enter(bodyFace);

    let s = this.current;
    if (!s) return null;
    if (s.fresh) {
      s.fresh = false;
      s.idle = Math.floor(this.random() * 4) + IDLE_BASE_SECONDS;
    } else {
      s.time += step;
      s.w = Math.min(1, s.w + step * s.morph);
      s.idle -= step;
    }
    // `AnimationState::update`: a state with a return state leaves it once
    // its phase passes 1, looping or not.
    if (s.info.then && s.time > s.seconds) {
      if (this.enter(s.info.then)) s = this.current;
    } else if (s.info.idles?.length && s.idle <= 0) {
      const pick = s.info.idles[Math.floor(this.random() * s.info.idles.length)];
      if (this.enter(pick)) s = this.current;
      else s.idle = Math.floor(this.random() * 4) + IDLE_BASE_SECONDS;
    }
    if (s.time > s.seconds) {
      if (s.info.loop) s.time %= s.seconds;
      else s.time = s.seconds;
    }
    return s;
  }
}

/**
 * One head's machine on its bones.
 *
 * `clips` are the face skeleton's clips (three `AnimationClip`s, or `{ name,
 * duration, tracks }` under node), one per state, named by it. `findBone`
 * answers a track's node name with the bone (`{ quaternion, position }`).
 * `update(dt, bodyFace)` once a frame writes the head: each bone slerped
 * from where it stands toward the state's clip by the state's weight, as
 * every machine does (ANIM-4). No mixer touches these bones.
 * It costs about 25 slerps and 25 lerps a frame.
 */
export class FaceOverlay {
  constructor({ clips, findBone, states, symbols, base, random } = {}) {
    this.findBone = findBone;
    this.clips = new Map();
    for (const clip of clips ?? []) if (clip?.name && !this.clips.has(clip.name)) this.clips.set(clip.name, clip);
    this.bound = new Map();
    this.machine = new FaceMachine({ states, symbols, base, random });
  }

  get playing() { return this.machine.name; }

  speak(symbols) { this.machine.speak(symbols); }

  reset() { this.machine.reset(); }

  bind(name) {
    let tracks = this.bound.get(name);
    if (tracks) return tracks;
    tracks = [];
    for (const track of this.clips.get(name)?.tracks ?? []) {
      const dot = track.name.lastIndexOf('.');
      const bone = this.findBone(track.name.slice(0, dot));
      const property = track.name.slice(dot + 1);
      if (!bone || (property !== 'quaternion' && property !== 'position')) continue;
      tracks.push({ bone, property, interpolant: track.createInterpolant() });
    }
    this.bound.set(name, tracks);
    return tracks;
  }

  /** One frame. Returns the playing state's name. */
  update(dt, bodyFace = null) {
    const s = this.machine.update(dt, bodyFace);
    if (!s) return null;
    const clip = this.clips.get(s.name);
    if (!clip) return s.name;
    const phase = Number.isFinite(s.seconds) && s.seconds > 0 ? Math.min(1, s.time / s.seconds) : 0;
    const t = phase * clip.duration;
    const w = s.w;
    for (const { bone, property, interpolant } of this.bind(s.name)) {
      const v = interpolant.evaluate(t);
      if (property === 'quaternion') slerpTo(bone.quaternion, v[0], v[1], v[2], v[3], w);
      else {
        const p = bone.position;
        p.x += (v[0] - p.x) * w; p.y += (v[1] - p.y) * w; p.z += (v[2] - p.z) * w;
      }
    }
    return s.name;
  }
}

/** `q = slerp(q, to, t)`, the short way round. */
function slerpTo(q, tx, ty, tz, tw, t) {
  if (t <= 0) return;
  const fx = q.x, fy = q.y, fz = q.z, fw = q.w;
  let cos = fx * tx + fy * ty + fz * tz + fw * tw;
  if (cos < 0) { tx = -tx; ty = -ty; tz = -tz; tw = -tw; cos = -cos; }
  let a, b;
  if (t >= 1) { a = 0; b = 1; }
  else if (cos > 0.9995) { a = 1 - t; b = t; }
  else {
    const theta = Math.acos(Math.min(1, cos));
    const sin = Math.sin(theta);
    a = Math.sin((1 - t) * theta) / sin;
    b = Math.sin(t * theta) / sin;
  }
  let x = fx * a + tx * b, y = fy * a + ty * b, z = fz * a + tz * b, w = fw * a + tw * b;
  const len = Math.hypot(x, y, z, w) || 1;
  x /= len; y /= len; z /= len; w /= len;
  if (typeof q.set === 'function') q.set(x, y, z, w);
  else { q.x = x; q.y = y; q.z = z; q.w = w; }
}

// --- the page's half ---------------------------------------------------------

/**
 * Which of a soldier's `count` heads `who` wears, 1-based.
 *
 * Retail: the head's `addTemplate` carries `setRandomGeometries 3`, and
 * `BundleTemplate::addBundleChilds` (lnxded `0x081a8300`) makes
 * `<name><counter>` off the process's one round-robin counter (`0x08720754`,
 * bumped by every rolled child of every bundle: LOAD-6, KIT-2). So the head
 * is whatever the counter stood at when THAT client made the soldier: it
 * differs between two clients watching the same soldier and is in no
 * recording. The page keeps the engine's even spread over the heads and
 * takes the pick from the soldier's own id instead, so the same soldier
 * wears the same head on every screen, across a weapon change (which
 * rebuilds the body) and on every pass of a replay.
 */
export function headVariant(who, count) {
  if (!(count > 1) || who == null || who === '') return 1;
  let h = 0x811c9dc5;                       // FNV-1a
  for (const c of String(who)) { h ^= c.codePointAt(0); h = Math.imul(h, 0x01000193); }
  return ((h >>> 0) % count) + 1;
}

/** A bone's name as every spelling of it compares: `Bip01 Head`, `Bip01_Head`. */
const boneId = name => String(name ?? '').replace(/[\s_]/g, '').toLowerCase();

let shared = null;
/** Make `faces` (a `createSoldierFaces` result) the page's, for `attachSoldierFace`. */
export function shareSoldierFaces(faces) { shared = faces ?? null; }
/** The page's faces, or null (a page that draws no level shares none). */
export function soldierFaces() { return shared; }
/** A face for the body `scene` of soldier template `soldier`, or null where
 *  the page shares no faces. See `createSoldierFaces().attach`. */
export function attachSoldierFace(scene, soldier, who = null) {
  return shared ? shared.attach(scene, soldier, who) : null;
}

/**
 * The page's faces: the files, the head swap and the distance gate.
 *
 * `ctx`: `loader()` the page's GLTFLoader; `modelsBase()` the models tree
 * (`models/mods/xpack1`); `bust()` the cache-bust query; `clone(scene)`
 * (`SkeletonUtils.clone`); `makeSkeleton(bones, inverses)` (a
 * `THREE.Skeleton`); `camera()` the camera drawn through (`{ fov, zoom,
 * matrixWorld }`); `fetchJson(url)` (resolving null on a miss); `shade(scene)`
 * and `paint(scene)` the page's shading and level paint for a head that is
 * not the rig's; `enabled()` optional.
 *
 * Per soldier per frame, far: one distance and a compare. Inside the gate:
 * the overlay's 25 bones, on the same triangles the rigid head drew.
 */
export function createSoldierFaces(ctx) {
  const manifests = new Map();   // models base -> Promise<{ base, doc } | null>
  const assets = new Map();      // `<base>/poses/<rel>` -> Promise<gltf | null>
  const stats = { attached: 0, loads: 0 };
  /** The faces handed out, held weakly: a body dropped with its scene takes
   *  its face with it. For `live()`, a headless check's way in. */
  let handles = [];

  // The active tree's own faces and no other's: a mod's soldier of a vanilla
  // name may wear another head, and a vanilla face on it would be the wrong
  // one. A tree without `poses/faces/` draws its rigid heads, as before.
  const bases = () => [ctx.modelsBase?.() || 'models'];

  function manifest() {
    const key = bases().join('|');
    if (!manifests.has(key)) {
      manifests.set(key, (async () => {
        for (const base of bases()) {
          const doc = await ctx.fetchJson(`${base}/poses/faces/faces.json${ctx.bust?.() ?? ''}`).catch(() => null);
          if (doc?.states && doc?.soldiers) return { base, doc: indexed(doc) };
        }
        return null;
      })());
    }
    return manifests.get(key);
  }

  /** The soldiers by lower-cased name: the level's `setTeamSkin` spelling
   *  is not always the template's own. */
  function indexed(doc) {
    const soldiers = {};
    for (const [name, row] of Object.entries(doc.soldiers)) soldiers[name.toLowerCase()] = row;
    return { ...doc, soldiers };
  }

  function asset(base, rel) {
    // One load a file for the page, whatever the cache-bust query says.
    const key = `${base}/poses/${rel}`;
    if (!assets.has(key)) {
      stats.loads += 1;
      assets.set(key, ctx.loader().loadAsync(`${key}${ctx.bust?.() ?? ''}`).catch(() => null));
    }
    return assets.get(key);
  }

  /** The animated head built onto `scene`'s own bones, or null. */
  async function build(scene, soldier, who) {
    const found = await manifest();
    const row = found?.doc.soldiers[String(soldier ?? '').toLowerCase()];
    if (!row) return null;
    // The head `who` wears (`headVariant`); a number the tree has no head
    // for wears the first.
    const variant = headVariant(who, row.heads?.length ?? 1);
    const rolled = row.heads?.[variant - 1] ?? null;
    const own = !!rolled && rolled !== row.head;
    const [head, clips] = await Promise.all([asset(found.base, rolled ?? row.head), asset(found.base, row.clips)]);
    if (!head?.scene || !clips?.animations?.length) return null;

    const bodyBones = new Map();
    let rigid = null;
    scene.traverse(node => {
      if (node.isBone && !bodyBones.has(boneId(node.name))) bodyBones.set(boneId(node.name), node);
      if (!rigid && node.name === row.part) rigid = node;
    });
    const bodyHead = bodyBones.get('bip01head');
    if (!bodyHead || !rigid) return null;

    const copy = ctx.clone(head.scene);
    // Another head than the rig's keeps its own skin, shaded and painted
    // as the page does a body's.
    if (own) { ctx.shade?.(copy); await ctx.paint?.(copy); }
    const faceBones = new Map();
    const meshes = [];
    let copyHead = null;
    copy.traverse(node => {
      if (node.isSkinnedMesh) meshes.push(node);
      if (!node.isBone) return;
      if (boneId(node.name) === 'bip01head') copyHead = node;
      else if (!bodyBones.has(boneId(node.name))) faceBones.set(node.name, node);
    });
    if (!copyHead || !meshes.length) return null;
    // The face's own bones go under the body's head; its three leading
    // bones ARE the body's (`bindToSkeletonPart Bip01_Spine3 3`).
    for (const child of [...copyHead.children]) if (child.isBone) bodyHead.add(child);

    // The rigid head's materials, mesh for mesh: they carry whatever the
    // page did to the body's (the level's paint, its shading).
    const rigidMeshes = [];
    rigid.traverse(node => { if (node.isMesh) rigidMeshes.push(node); });
    const holder = rigid.parent ?? scene;
    const drawn = [];
    meshes.forEach((mesh, i) => {
      const bones = mesh.skeleton.bones.map(b => bodyBones.get(boneId(b.name)) ?? b);
      mesh.bind(ctx.makeSkeleton(bones, mesh.skeleton.boneInverses), mesh.bindMatrix);
      const twin = rigidMeshes[i] ?? rigidMeshes[0];
      if (twin) {
        if (!own && rigidMeshes.length === meshes.length) mesh.material = twin.material;
        mesh.castShadow = twin.castShadow;
        mesh.receiveShadow = twin.receiveShadow;
        mesh.frustumCulled = twin.frustumCulled;
        mesh.renderOrder = twin.renderOrder;
        mesh.layers.mask = twin.layers.mask;
      }
      mesh.userData.soldierFace = true;
      mesh.visible = false;
      holder.add(mesh);
      drawn.push(mesh);
    });

    const overlay = new FaceOverlay({
      clips: clips.animations,
      findBone: name => faceBones.get(name) ?? null,
      states: found.doc.states,
      symbols: found.doc.symbols,
      base: found.doc.base,
      random: ctx.random,
    });
    return { overlay, rigid, drawn, variant: own ? variant : 1, bodyStates: found.doc.bodyStates,
             lodValue: Number.isFinite(row.lodValue) ? row.lodValue : FACE_LOD_VALUE };
  }

  function show(face, on) {
    if (face.on === on) return;
    face.on = on;
    for (const mesh of face.built.drawn) mesh.visible = on;
    face.built.rigid.visible = !on;
    if (on) face.built.overlay.reset();
  }

  /** Whether `node` and everything over it is drawn. */
  function shown(node) {
    for (let n = node; n; n = n.parent) if (n.visible === false) return false;
    return true;
  }

  /**
   * A face for one body. `update(dt, lower, upper, weapon)` once a frame,
   * after the body is posed: the gate, the swap and the machine (`lower` /
   * `upper` the body's current state names). `speak(symbols)` on a shout.
   * `playing` is the face state while the animated head is drawn.
   */
  function attach(scene, soldier, who = null) {
    stats.attached += 1;
    if (handles.length >= 256) handles = handles.filter(ref => ref.deref());
    const face = {
      scene, soldier, who, on: false, built: null, loading: false, none: false,
      get playing() { return this.on ? this.built.overlay.playing : null; },
      get speaking() { return this.on && this.built.overlay.machine.speaking; },
      speak(symbols) {
        if (!this.on || !symbols) return false;
        this.built.overlay.speak(symbols);
        return true;
      },
      update(dt, lower = null, upper = null, weapon = '') {
        if (this.none) return null;
        const camera = ctx.camera?.();
        if (!camera || ctx.enabled?.() === false) { if (this.on) show(this, false); return null; }
        // The soldier's origin stands a metre over their feet (PHY-10).
        const m = scene.matrixWorld.elements, c = camera.matrixWorld.elements;
        const d = Math.hypot(m[12] - c[12], m[13] + 1 - c[13], m[14] - c[14]);
        const lodValue = this.built?.lodValue ?? FACE_LOD_VALUE;
        if (!faceDrawn(d, viewFieldOfView(camera.fov, camera.zoom), lodValue) || !shown(scene)) {
          if (this.on) show(this, false);
          return null;
        }
        if (!this.built) {
          if (!this.loading) {
            this.loading = true;
            build(scene, soldier, who).then(built => {
              this.loading = false;
              if (built) this.built = built; else this.none = true;
            }, () => { this.loading = false; this.none = true; });
          }
          return null;
        }
        if (!this.on) show(this, true);
        return this.built.overlay.update(dt, bodyFaceState(this.built.bodyStates, lower, upper, weapon));
      },
      dispose() {
        if (this.on) show(this, false);
        for (const mesh of this.built?.drawn ?? []) mesh.parent?.remove(mesh);
        this.none = true;
      },
    };
    handles.push(new WeakRef(face));
    return face;
  }

  /** The faces still held by a body. */
  function live() {
    const out = [];
    handles = handles.filter(ref => { const f = ref.deref(); if (f && !f.none) out.push(f); return !!f; });
    return out;
  }

  /** What is drawn, for a headless check. */
  function debug() {
    const faces = live();
    return { ...stats, held: faces.length,
             shown: faces.filter(f => f.on).map(f => ({ soldier: f.soldier, who: f.who, head: f.built.variant,
                                                        playing: f.playing, speaking: f.speaking })) };
  }

  return { attach, manifest, stats, live, debug };
}
