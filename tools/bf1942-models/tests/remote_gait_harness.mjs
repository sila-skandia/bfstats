// Drives `viewer/remote-gait.js` outside a browser and prints one JSON blob.
//
// The three defects this module exists for were all name-level, so a renderer
// test that only checked "something is playing" would have passed throughout:
// the gait halves were looked up as `run`/`walk` when they are bound as
// `runLower`/`runUpper`, the prone pose clip is baked as `lie` and was looked
// up as `prone`, and `crouchwalk`/`crawl` were in the bundles and referenced
// nowhere.

import {
  BANDS, FALLBACKS, FAMILY_CLIPS, TOP_SPEED, WALK_FACTOR,
  remoteClipFamily, remoteGait, resolveRemoteGait,
} from './remote-gait.js';

// What a published rig really binds: the pose pair's three clips plus the four
// lower/upper pairs in the gait bundles.
const FULL = new Set(['stand', 'crouch', 'prone', 'walk', 'run',
                      'crouchwalk', 'crawl']);
// A rig whose gait bundle never resolved: pose clips only.
const POSES = new Set(['stand', 'crouch', 'prone']);
// What the renderer effectively had before this module, once the two wrong
// names are taken out: only the standing pose was ever reachable.
const BROKEN = new Set(['stand', 'crouch']);

const full = f => FULL.has(f);
const poses = f => POSES.has(f);
const broken = f => BROKEN.has(f);

const out = {};

out.bands = BANDS;
out.topSpeed = TOP_SPEED;
out.walkFactor = WALK_FACTOR;

// Standing, across the engine's own ladder: 0, a 2 m/s walk, a 6 m/s run.
out.standing = {
  still: remoteGait(0, {}),
  creeping: remoteGait(0.5, {}),
  atWalkBand: remoteGait(1.0, {}),          // strictly greater, so still stand
  walking: remoteGait(2, {}),
  betweenBands: remoteGait(3.9, {}),
  atRunBand: remoteGait(4.0, {}),           // strictly greater, so still walk
  running: remoteGait(6, {}),
  negative: remoteGait(-6, {}),             // a speed is a magnitude
  nonsense: remoteGait(NaN, {}),
};

// Crouched: one movement family; run 2 m/s, walk 2/3 m/s.
out.crouched = {
  still: remoteGait(0, { crouch: true }),
  atBand: remoteGait(1 / 3, { crouch: true }),
  walking: remoteGait(2 / 3, { crouch: true }),   // c_PIWalk while crouched
  moving: remoteGait(2, { crouch: true }),
  // A crouched man cannot reach 6 m/s, but a snapshot lerp can say he did.
  fast: remoteGait(6, { crouch: true }),
};

// Prone: crawl 1 m/s, and 1/3 m/s with the walk key down.
out.prone = {
  still: remoteGait(0, { prone: true }),
  atBand: remoteGait(1 / 6, { prone: true }),
  walking: remoteGait(1 / 3, { prone: true }),
  crawling: remoteGait(1, { prone: true }),
  // `soldier.js`'s own order: prone wins when a snapshot carries both bits.
  bothBits: remoteGait(0, { crouch: true, prone: true }),
  bothBitsMoving: remoteGait(1, { crouch: true, prone: true }),
};

// What the renderer plays once the rig says what it bound.
out.resolvedFull = {};
out.resolvedPoses = {};
out.resolvedBroken = {};
for (const want of Object.keys(FALLBACKS)) {
  out.resolvedFull[want] = resolveRemoteGait(want, full);
  out.resolvedPoses[want] = resolveRemoteGait(want, poses);
  out.resolvedBroken[want] = resolveRemoteGait(want, broken);
}
out.resolvedNoBound = resolveRemoteGait('crawl', null);
out.resolvedUnknown = resolveRemoteGait('somersault', full);

// The clip names, which are the whole point: `lie`, not `prone`, and the four
// `.lower` / `.upper` pairs.
out.clips = FAMILY_CLIPS;

// End to end, the way the renderer calls it.
out.endToEnd = {
  proneStill: remoteClipFamily(0, { prone: true }, full),
  proneCrawling: remoteClipFamily(1, { prone: true }, full),
  crouchMoving: remoteClipFamily(2, { crouch: true }, full),
  running: remoteClipFamily(6, {}, full),
  // No gait bundle: a running man is drawn standing rather than not at all.
  runningPosesOnly: remoteClipFamily(6, {}, poses),
  crawlingPosesOnly: remoteClipFamily(1, { prone: true }, poses),
};

console.log(JSON.stringify(out));
