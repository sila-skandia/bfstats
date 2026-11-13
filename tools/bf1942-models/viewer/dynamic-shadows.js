// Dynamic shadows: the law. Retail's `fx::ShadowManager`, read from
// BF1942.exe 1.61 (`drawVisible` 0x005b93d0, `generate` 0x005b8fb0, `apply`
// 0x005b8700, `init`'s texture create 0x005b9dce, `setLightDirection`
// 0x005b8a00), with the Mac client's symbols for the names.
//
// Each frame, with SHADOWS on (`game +0x4d0`, VID-7, frame 0x00466b28):
//
//   1. every object within 50 m of the camera whose flags pass
//      `ObjectFlagPredicator(0x2000082)` (the `hasDynamicShadow 1` templates)
//      wants one of the pool's shadows. The pool is `numberOfActiveShadows`,
//      10 from the RenderSetup constructor (0x00465c52). An object that held
//      one last frame keeps it; a new one takes the slot idle longest; with
//      none idle the rest go without.
//   2. an object more than 10 m above (or below) the terrain under it casts
//      nothing. Under that its shadow is `255 - 25.5 h` strong, truncated to
//      a byte.
//   3. the shadow is the object's flagged parts drawn black into a 128 x 128
//      texture by an orthographic camera `2 r` up the light from the object,
//      `2 r` wide and high, near `r`, far `3 r`, `r` being 1.02 times the
//      root's radius and at most 100. The texture is drawn again only when
//      the object has moved more than 3 cm (0.0009 m2) since, or is skinned.
//   4. the light is the level's sun with its height forced: while the Y of
//      the direction is under 0.8 it is set to 0.82 and the vector made unit
//      again. A shadow is never cast lower than 53 degrees.
//   5. the texture is projected onto the TERRAIN alone (`ITerrain` +0x74
//      gathers the patches, +0x78 draws them again), clamped, alpha tested
//      above 0, blended SRCALPHA / INVSRCALPHA, the depth test LESSEQUAL. Its
//      colour is the texture's (black) times `shadow.shadowColor`'s RGB and
//      its alpha the texture's times
//          object alpha x shadowColor.a x height byte / 255
//                       x clamp((50 + r - d) / 5, 0, 1)
//      with `d` the camera's distance to where the shadow was drawn: it fades
//      out over the last 5 m of the range.
//
// `shadow.shadowColor` is read off a stream as four floats separated by one
// character each (0x0043b9a0), every extraction into the SAME local: a level
// that writes one number (`0.55`, 136 of vanilla's lines) gets that number in
// all four, so its shadows are 55 % strong, and `0.36/0.36/0.38` leaves the
// alpha at the last number read, 0.38. With no line the colour is the
// constructor's 1/1/1/1: solid black.
//
// No three.js here: `shadow-pass.js` draws what this file decides.

/** The gather's radius round the camera, metres (0x005b9452 `push 0x42480000`). */
export const SHADOW_RANGE = 50;
/** A shadow texture's side, pixels (0x005b9dce, 0x005b9dd3 `push 0x80`). */
export const SHADOW_TEXTURE = 128;
/** `renderer.numberOfActiveShadows`: RenderSetup +0xf0 (0x00465c52 `mov [esi+0xf0], 0xa`). */
export const SHADOW_POOL = 10;
/** The height over the terrain past which nothing is cast (0x008dbe18). */
export const SHADOW_MAX_HEIGHT = 10;
/** The root's radius times this is the shadow's (0x00905d34, 1.02 as a float). */
export const SHADOW_RADIUS_SCALE = Math.fround(1.02);
/** The shadow radius's cap (0x008c3e80; 0x005b95ac writes 0x42c80000). */
export const SHADOW_RADIUS_MAX = 100;
/** The squared distance an object moves before its texture is drawn again (0x00905d30). */
export const SHADOW_REDRAW_DIST2 = Math.fround(0.0009);
/** The band at the edge of the range a shadow fades out over (0x008eaf50 is its inverse, 0.2). */
export const SHADOW_FADE_BAND = 5;
/** The light's Y is forced while under this (0x008d6290) ... */
export const LIGHT_MIN_Y = Math.fround(0.8);
/** ... to this (0x005b8a32 `mov [esi+0x28], 0x3f51eb85`), then made unit again. */
export const LIGHT_SET_Y = Math.fround(0.82);
/** `ShadowManager`'s constructor: shadowColor 1/1/1/1. */
export const DEFAULT_SHADOW_COLOR = Object.freeze([1, 1, 1, 1]);

/**
 * `setLightDirection` (0x005b8a00): `to` is the unit vector towards the
 * sun; out comes the direction the shadow cameras stand along. While its Y
 * is under 0.8 the Y is set to 0.82 and the vector normalised (the loop at
 * 0x005b8a30), so the answer always has Y of at least 0.8.
 */
export function shadowLight(to, out = [0, 0, 0]) {
  let x = Number(to?.[0]) || 0;
  let y = Number(to?.[1]) || 0;
  let z = Number(to?.[2]) || 0;
  // 0x005b8a1d: the first test skips the loop when Y > 0.8.
  let guard = 0;
  if (!(y > LIGHT_MIN_Y)) {
    do {
      y = LIGHT_SET_Y;
      const len = Math.hypot(x, y, z);
      x /= len; y /= len; z /= len;
    } while (y < LIGHT_MIN_Y && ++guard < 64);
  }
  out[0] = x; out[1] = y; out[2] = z;
  return out;
}

/** The shadow's radius from the root object's (0x005b9596..0x005b95ac). */
export function shadowRadius(objectRadius) {
  const r = SHADOW_RADIUS_SCALE * objectRadius;
  return r > SHADOW_RADIUS_MAX ? SHADOW_RADIUS_MAX : r;
}

/**
 * The strength byte for an object `height` metres from the terrain under it
 * (0x005b9552..0x005b9659): null past 10 m (no shadow), else
 * `trunc(255 - height * 0.1 * 255)`.
 */
export function heightByte(height) {
  const h = Math.abs(height);
  if (!(h <= SHADOW_MAX_HEIGHT)) return null;
  return Math.trunc(255 - h * 0.1 * 255) & 0xff;
}

/** The fade at the edge of the range (0x005b8901..0x005b896e):
 *  `clamp((50 + r - d) * 0.2, 0, 1)`. */
export function rangeFade(radius, distance) {
  const f = (SHADOW_RANGE + radius - distance) * 0.2;
  return f > 1 ? 1 : f < 0 ? 0 : f;
}

/**
 * The alpha the projected texture is multiplied by, 0..1: the texture
 * factor's alpha byte of `apply` (0x005b88eb..0x005b89a2) over 255.
 * `objectAlpha` is the object's own fade byte over 255 (its +0x109).
 */
export function shadowAlpha({ colorAlpha = 1, objectAlpha = 1, byte, radius, distance }) {
  if (byte === null || byte === undefined) return 0;
  const a = objectAlpha * colorAlpha * byte * rangeFade(radius, distance);
  return Math.max(0, Math.min(255, Math.trunc(a))) / 255;
}

const FLOAT = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/;

/**
 * `shadow.shadowColor`'s argument as the console reads it (0x0043b9a0): four
 * `stream >> float >> char`, each float into one local that a failed read
 * leaves as it was, so the components the line does not write repeat the
 * last one it does. A number is the scene's older single-float form; an
 * array is taken as written. Null (no line, or nothing to read) is the
 * constructor's 1/1/1/1.
 */
export function parseShadowColor(value) {
  if (value === null || value === undefined) return [...DEFAULT_SHADOW_COLOR];
  if (Array.isArray(value)) {
    const v = value.map(Number).filter(Number.isFinite);
    if (!v.length) return [...DEFAULT_SHADOW_COLOR];
    while (v.length < 4) v.push(v[v.length - 1]);
    return v.slice(0, 4);
  }
  if (typeof value === 'number') return Number.isFinite(value) ? [value, value, value, value] : [...DEFAULT_SHADOW_COLOR];
  let rest = String(value).trim();
  const out = [];
  let last = null;
  for (let i = 0; i < 4; i++) {
    const m = rest ? FLOAT.exec(rest) : null;
    if (m) {
      last = Number(m[0]);
      // The float, then one separator character whatever it is.
      rest = rest.slice(m[0].length + 1);
    } else {
      rest = '';
    }
    if (last === null) return [...DEFAULT_SHADOW_COLOR];
    out.push(last);
  }
  return out;
}

/**
 * The shadow camera for an object at `pos` with shadow radius `r` under
 * light `light` (`drawVisible` 0x005b95b3..0x005b95ef and `setupShadow`):
 * `{ position, size, near, far }`, the camera `2 r` up the light, looking
 * back down it.
 */
export function shadowCamera(pos, light, r) {
  return {
    position: [pos[0] + light[0] * 2 * r, pos[1] + light[1] * 2 * r, pos[2] + light[2] * 2 * r],
    size: 2 * r,
    near: r,
    far: 3 * r,
  };
}

/**
 * The pool (`drawVisible`'s slot search, 0x005b94a0..0x005b9516): `claim`
 * is called once a frame with the keys of the objects in range. A key that
 * holds a slot keeps it; the others take, in the order given, the idle slot
 * drawn longest ago, and go without once none is idle. Returns a Map of
 * key -> slot index. A slot keeps its key while idle, so an object back in
 * range before its slot is taken finds its texture again.
 */
export class ShadowPool {
  constructor(size = SHADOW_POOL) {
    this.frame = 0;
    this.slots = Array.from({ length: size }, (_, index) => ({ index, key: null, frame: 0, active: false, fresh: false }));
  }

  claim(keys) {
    this.frame++;
    const out = new Map();
    for (const s of this.slots) { s.active = false; s.fresh = false; }
    const waiting = [];
    for (const key of keys) {
      const held = this.slots.find(s => s.key === key);
      if (held) {
        held.active = true;
        held.frame = this.frame;
        out.set(key, held.index);
      } else {
        waiting.push(key);
      }
    }
    let full = false;
    for (const key of waiting) {
      if (full) break;
      // 0x005b94ca..0x005b94fb: of the slots not yet taken this frame, the
      // one whose last frame is furthest back.
      let best = null;
      for (const s of this.slots) {
        if (s.active) continue;
        if (!best || this.frame - s.frame > this.frame - best.frame) best = s;
      }
      if (!best) { full = true; break; }
      best.key = key;
      best.active = true;
      best.fresh = true;
      best.frame = this.frame;
      out.set(key, best.index);
    }
    return out;
  }

  /** Forget `key`'s slot (the object is gone). */
  release(key) {
    for (const s of this.slots) if (s.key === key) { s.key = null; s.active = false; }
  }
}

/** A template name as the flag table keys it: lower case, a duplicate
 *  node's `_2` kept only when the table has that very name. */
export function castsShadow(templates, name) {
  if (!templates || !name) return false;
  const key = String(name).toLowerCase();
  if (templates.has(key)) return true;
  const base = key.replace(/_\d+$/, '');
  return base !== key && templates.has(base);
}

/** `dynamic-shadows.json` (extract_dynamic_shadows.py) as the Set the pass
 *  asks; null for a tree without the file, where nothing is flagged, the
 *  engine's default for the word. */
export function shadowTemplates(json) {
  return Array.isArray(json?.templates) ? new Set(json.templates.map(n => String(n).toLowerCase())) : null;
}

/** The scene's top-level groups that hold no caster: the effect pools, the
 *  sky, the terrain's wrapped edge and the pass's own receivers. */
export const CASTER_SKIP_GROUPS = new Set(['effects', 'sky', 'terrainEdge', 'dynamic-shadows']);
/** How deep under the scene the walk looks for a caster. */
export const CASTER_WALK_DEPTH = 6;

/**
 * Walk `scene` for the objects that want a shadow and call `add(root, kind)`
 * for each: `'vehicle'` for a `PlayerControlObject` whose template carries
 * the flag, `'soldier'` for the group that holds a soldier rig
 * (`userData.soldier` and `userData.rig` on the rig node).
 *
 * The walk stops at any templated node (a static is one step; a vehicle's
 * own child seats are never roots), any mesh, LOD, light or camera, and
 * `CASTER_WALK_DEPTH` levels down. It does NOT stop at a node that only
 * carries `userData.kind`: a level stands its pad vehicles under its
 * `spawners` node, a room its remote hulls under `remote-room`, a replay its
 * hulls under `replay`. `skip` is one more top-level node to leave out.
 */
export function gatherCasters(scene, templates, add, skip = null) {
  const walk = (node, depth) => {
    for (const c of node.children) {
      const ud = c.userData;
      if (ud?.soldier && ud?.rig && c.parent) { add(c.parent, 'soldier'); continue; }
      if (ud?.templateKind) {
        if (ud.templateKind === 'PlayerControlObject' && castsShadow(templates, ud.name ?? c.name)) add(c, 'vehicle');
        continue;
      }
      if (c.isMesh || c.isLOD || c.isLight || c.isCamera) continue;
      if (depth < CASTER_WALK_DEPTH && c.children.length) walk(c, depth + 1);
    }
  };
  for (const child of scene.children) {
    if (child === skip || CASTER_SKIP_GROUPS.has(child.name)) continue;
    walk(child, 1);
  }
}
