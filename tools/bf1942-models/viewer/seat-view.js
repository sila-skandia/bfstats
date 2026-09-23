// Which views C reaches from a seat, and where an aircraft's nose cam sits.
//
// Imports nothing, so `tests/seat_view_harness.mjs` runs it under node. The
// three.js half -- placing the eye per mode -- is `VehicleCamera` in
// `flight.js`; the page's glue (which seat, which server switches) is in
// `map.html`.
//
// THE CYCLE. `Camera::setViewMode` (lnxded `0x081ac7c0`) is a switch over the
// mode id in which every arm is gated on one byte of the camera's template,
// seeded on by `CameraTemplate::CameraTemplate()` for inside (3), chase (0xc),
// front-chase (0xd) and fly-by (0xe), and written by the `CVM*` console words
// (`soldier-camera.js` has the full read, with addresses). The exporter carries
// the declared words on the seat's Camera node as `extras.cameraView.cvm`
// (`bf42/assemble.py`), keyed upper-case, and `seats.js` hangs them on the
// seat as `cameraViewModes`. A seat that declares nothing gets the whole
// cycle; vanilla declares nothing on any vehicle seat but the `CVMExternTrace
// 1` of the ten artillery pieces. So EVERY seat of every vehicle cycles --
// the driver, the Willy's passenger, the Sherman's hull gunner, the AA gun --
// which is what retail does and what the owner asked for.
//
// THE NOSE CAM. Retail's aircraft carry a second inside view between the
// cockpit and the chase: no cockpit, no airframe, the reticle over open air,
// the engine heard from ahead of the propeller. `game.serverAllowNoseCam` is
// its server switch (`server-settings.js`) and the data places it:
// `ObjectTemplate.OutsideHudOffset` is declared on **thirteen vanilla Camera
// templates and eight more in the expansions -- every aircraft and nothing
// else** (surveyed straight out of `Objects.rfa`, `NOSE_CAM_OFFSETS` below).
// `camera-modes.md` §4 read it as a HUD anchor because it sits 0.3 m *past*
// the propeller hub, which is exactly where a camera has to stand to look
// forward without the prop disc across the frame. The B17's, the smallest
// (2.5 m), is the one whose pilot already sits at the nose. So a seat whose
// Camera declares the offset has a nose view at the Camera plus the offset in
// the Camera's own frame, and a seat whose Camera does not has none -- a
// tank or a gun position never had one in retail either.
//
// The offsets are Refractor's (x, y, z) with +Z forward; the exporter mirrors
// Z to reach glTF's -Z forward (`bf42/gltf.py`), and so does `noseCamOffset`.
// A level extracted after this file was written carries the same number on
// the Camera node as `extras.cameraView.outsideHudOffset`, already mirrored,
// and that wins over the table so a mod this table never saw still works.

/** The vocabulary `VehicleCamera` places, in the order C walks it. */
export const VIEW_COCKPIT = 'cockpit';
export const VIEW_NOSE = 'nose';
export const VIEW_CHASE = 'chase';
export const VIEW_FRONT = 'front';
export const VIEW_FLYBY = 'flyby';
export const SEAT_VIEW_ORDER = Object.freeze([
  VIEW_COCKPIT, VIEW_NOSE, VIEW_CHASE, VIEW_FRONT, VIEW_FLYBY,
]);

/**
 * The engine's own mode ids (`Camera::setViewMode`'s switch labels). The nose
 * cam is mode 3 with the cockpit LOD off and the eye displaced: retail has
 * no separate id for it.
 */
export const SEAT_VIEW_MODE_ID = Object.freeze({
  [VIEW_COCKPIT]: 3,
  [VIEW_NOSE]: 3,
  [VIEW_CHASE]: 12,
  [VIEW_FRONT]: 13,
  [VIEW_FLYBY]: 14,
});

/** The `CVM*` word each external mode is gated on. Inside is never refused. */
const CVM_WORD = Object.freeze({
  [VIEW_CHASE]: 'CVMCHASE',
  [VIEW_FRONT]: 'CVMFRONTCHASE',
  [VIEW_FLYBY]: 'CVMFLYBY',
});

/**
 * `ObjectTemplate.OutsideHudOffset`, per Camera template, straight out of
 * `Objects.rfa` for vanilla, Road to Rome (XPack1) and Secret Weapons
 * (XPack2), Refractor axes (+Z forward). Keys are matched case-insensitively
 * because a node name is the template's own spelling and mods vary it.
 */
export const NOSE_CAM_OFFSETS = Object.freeze({
  // bf1942
  'Aichival-TCamera': [0.004, 0, 3.5],
  AichiValCamera: [0.004, 0, 3.5],
  B17_Camera: [0, 0, 2.5],
  BF109Camera: [0, 0.1, 3.5],
  CorsairCamera: [0, -0.4, 4.45],
  IlyushinCamera_For_PCO0: [0, -0.1, 5],
  MustangCamera: [0, -0.7, 5],
  'SBD-TCamera_For_PCO0': [0, -0.1, 4],
  SBDCamera_For_PCO0: [0, -0.1, 4],
  SpitfireCamera: [0, 0, 4.5],
  StukaCamera: [0, -0.7, 3.7],
  Yak9Camera: [0.4, -0.4, 3.7],
  ZeroCamera: [0, -0.8, 5.2],
  // XPack1
  BF110Camera: [0, -0.7, 3.7],
  MosquitoCamera: [0, -0.8, 3.3],
  // XPack2
  AW52Camera: [0, 0, 4.5],
  C47Camera: [0, -0.8, 3.3],
  GoblinCamera: [0, 0, 4.5],
  HO229Camera: [0, 0, 4.5],
  JetpackCamera: [0, 0, 4.5],
  NatterCamera: [0, 0, 4.5],
  WasserfallRocketCamera: [0, 0, 4.5],
});

const NOSE_CAM_BY_LOWER = new Map(
  Object.entries(NOSE_CAM_OFFSETS).map(([k, v]) => [k.toLowerCase(), v]));

/**
 * The nose cam's offset from the seat Camera, glTF axes (-Z forward), or
 * null when the seat has no nose cam.
 *
 * @param {string | null | undefined} cameraName the Camera node's name --
 *   the template's, possibly with the exporter's `_1` disambiguating suffix
 * @param {{outsideHudOffset?: number[]} | null | undefined} cameraView the
 *   node's `extras.cameraView`, whose `outsideHudOffset` (already mirrored)
 *   wins when a newer extraction wrote it
 * @returns {[number, number, number] | null}
 */
export function noseCamOffset(cameraName, cameraView = null) {
  const declared = cameraView?.outsideHudOffset;
  if (Array.isArray(declared) && declared.length === 3
      && declared.every(Number.isFinite)) {
    return [declared[0], declared[1], declared[2]];
  }
  if (!cameraName) return null;
  let key = String(cameraName).toLowerCase();
  let hit = NOSE_CAM_BY_LOWER.get(key);
  if (!hit) {
    // `CorsairCamera_1`: the scene-wide suffix a second instance gets.
    key = key.replace(/_\d+$/, '');
    hit = NOSE_CAM_BY_LOWER.get(key);
  }
  if (!hit) return null;
  return [hit[0], hit[1], -hit[2]];
}

/**
 * The modes C walks from one seat, in order.
 *
 * @param {object} [options]
 * @param {Record<string, boolean> | null} [options.cvm] the seat's declared
 *   `CVM*` words (any case); omission means on
 * @param {boolean} [options.nose] whether the seat has a nose cam at all
 *   (`noseCamOffset(...) !== null`)
 * @param {{externalViews?: boolean, allowNoseCam?: boolean}} [options.settings]
 *   the server switches; absent means the shipped defaults, both on
 * @returns {string[]} never empty: the cockpit is always reachable, which is
 *   the engine's own fallback (`setViewMode` case 3 is the mode a seat
 *   opens in, whatever the template says)
 */
export function seatViewModes({ cvm = null, nose = false, settings = null } = {}) {
  const words = {};
  if (cvm && typeof cvm === 'object') {
    for (const [k, v] of Object.entries(cvm)) words[k.toUpperCase()] = !!v;
  }
  const externalViews = settings?.externalViews !== false;
  const allowNoseCam = settings?.allowNoseCam !== false;
  const out = [VIEW_COCKPIT];
  if (nose && allowNoseCam) out.push(VIEW_NOSE);
  if (externalViews) {
    for (const mode of [VIEW_CHASE, VIEW_FRONT, VIEW_FLYBY]) {
      const word = CVM_WORD[mode];
      if (words[word] === false) continue;
      out.push(mode);
    }
  }
  return out;
}
