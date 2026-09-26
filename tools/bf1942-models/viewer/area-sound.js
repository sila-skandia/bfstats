// A level's placed ambience -- shorelines, rivers, lakes, birds, a radar's
// hum -- measured from the listener the way the game measures it
// (features/ambient-sound-parity). Pure: `page-audio.js` owns the voices and
// asks this module how loud each emitter is and where it stands.
//
// Two kinds of emitter ship in `scene.json`'s `sounds.areas`:
//
// * An AreaObject (`ObjectTemplate.create AreaObject`, a `Sounds/*.con` in the
//   level archive with `addLinePoint`s). The server binary's
//   `AreaObject::handleFrameUpdate` (lnxded 0x08269f30) is the whole rule:
//   needs three or more points; treats them as a CLOSED outline (segment i runs
//   to point (i+1) % n); measures the camera (ObjectManager::getCamera, vtable
//   +0x70) against it in the XZ plane only; and, when the nearest point on the
//   outline is within `triggerRadius` (template +0x15c), stands the voice
//   there at the object's own height and plays it. Beyond the radius it stops
//   the voice outright. The instance's rotation is never applied to the
//   points. (The bounding-box early-out before the loop is the outline's box
//   pushed out by 2 * triggerRadius -- `addLinePoint` 0x0826a780,
//   `setTriggerRadius` 0x0826a850 -- so it never cuts inside the radius.)
//
// * A point emitter: a level `SimpleObject` sound, or a building's own sound
//   script. It stands at its object and plays for as long as the level runs.
//
// Either way the voice is then an ordinary spatialised DirectSound voice
// (ledger SND-6): it falls off as `minDistance / d` past its layer's
// `minDistance`, with no maximum, and the script's `Volume <- Distance` ramp
// multiplies on top, evaluated at the true voice-to-listener distance.
//
// The viewer used to play every emitter at `volume * ramp` with no fall-off at
// all. Wake's coastline says `minDistance 1` and ramps 40 m -> 80 m, so its
// waves sounded at 0.6 anywhere within 40 m of the shore and faded out by 80 m:
// the whole of a narrow atoll, at full surf. Retail has them at 0.6 / d.

import { distanceRolloff } from './engine-audio.js';
import { modulate } from './ssc-curves.js';

/** DirectSound's per-voice default, `SetMinDistance(1.0)` at voice init
 *  (BF1942.exe 0x007fefee), which a layer naming no `minDistance` keeps. */
export const DEFAULT_MIN_DISTANCE = 1;

/** Whether an entry is an AreaObject outline rather than a point emitter. The
 *  extractor marks it; an older `scene.json` is told apart by its point count
 *  (point emitters always ship one point). */
export function isAreaOutline(area) {
  if (area.kind) return area.kind === 'area';
  return (area.points?.length ?? 0) > 1;
}

/**
 * The `Volume <- Distance` factor. `distanceVolume` is the script's own ramp
 * (`p1 p2 p3 p4`); an older `scene.json` carries only `nearDistance` /
 * `farDistance`, which every vanilla, XPack1 and XPack2 ambience script
 * authors as a 1 -> 0 fade (`p3 = 1, p4 = -1`).
 */
export function distanceVolume(area, distance) {
  if (Array.isArray(area.distanceVolume)) {
    return modulate([{ source: 'distance', envelope: 'ramp', params: area.distanceVolume }],
      { distance }, 1);
  }
  if (area.distanceVolume === null) return 1;
  const near = area.nearDistance || 40;
  const far = area.farDistance || 80;
  if (distance <= near) return 1;
  if (distance >= far) return 0;
  return 1 - (distance - near) / Math.max(far - near, 1e-3);
}

/**
 * Nearest point of a closed outline to (x, z), in the XZ plane, the way
 * `AreaObject::handleFrameUpdate` walks it. Returns null for fewer than three
 * points: the engine does nothing at all for those.
 */
export function nearestOnOutline(points, x, z) {
  const n = points.length;
  if (n < 3) return null;
  let best = Infinity, bx = 0, bz = 0;
  for (let i = 0; i < n; i++) {
    const a = points[i];
    const b = points[(i + 1) % n];
    const ex = b[0] - a[0], ez = b[2] - a[2];
    const len = Math.hypot(ex, ez);
    let qx = a[0], qz = a[2];
    if (len > 0) {
      const t = ((x - a[0]) * ex + (z - a[2]) * ez) / len;
      if (t >= len) { qx = b[0]; qz = b[2]; }
      else if (t > 0) { qx = a[0] + ex * (t / len); qz = a[2] + ez * (t / len); }
    }
    const d2 = (x - qx) ** 2 + (z - qz) ** 2;
    if (d2 < best) { best = d2; bx = qx; bz = qz; }
  }
  return { x: bx, z: bz, distance2d: Math.sqrt(best) };
}

/**
 * Where one emitter's voice stands for a listener at `ear`, and how loud it
 * is before the master: `{ x, y, z, distance, gain }`, or null when the
 * engine would have the voice stopped.
 */
export function emitterAt(area, ear) {
  const pts = area.points;
  if (!pts?.length) return null;
  let x, y, z;
  if (isAreaOutline(area)) {
    const hit = nearestOnOutline(pts, ear.x, ear.z);
    if (!hit) return null;
    // An older scene.json has no radius; its ramp's far end is the only cut
    // it knows about, which `distanceVolume` already applies.
    const radius = area.triggerRadius ?? Infinity;
    if (!(hit.distance2d < radius)) return null;
    x = hit.x; y = pts[0][1]; z = hit.z;
  } else {
    [x, y, z] = pts[0];
  }
  const distance = Math.hypot(ear.x - x, ear.y - y, ear.z - z);
  const volume = Math.min(1, Math.max(0, (area.volume ?? 1) * distanceVolume(area, distance)));
  const gain = volume * distanceRolloff(distance, area.minDistance ?? DEFAULT_MIN_DISTANCE);
  return { x, y, z, distance, gain };
}

/**
 * One voice per sample: of every emitter in a same-file group, the one the
 * listener hears loudest. Several copies of one loop audible at once through
 * separate panners read as a hall echo, not louder surf (the one-voice-per-
 * sample rule, features/bf1942-3d-models/map-sounds.md), so the group plays
 * only its loudest member.
 */
export function loudestEmitter(areas, ear) {
  let best = null;
  for (const area of areas) {
    const at = emitterAt(area, ear);
    if (at && at.gain > 0 && (!best || at.gain > best.gain)) best = { ...at, area };
  }
  return best;
}

/** Only looping scripts are beds. A one-shot on a static (`e_Barbwire`'s
 *  scrape, played when something touches the wire) is an event, and looping
 *  it for ever beside every fence is not what the script says. */
export function isBed(area) {
  return area.loop !== false;
}
