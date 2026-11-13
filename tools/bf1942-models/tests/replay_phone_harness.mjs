// A replay on a phone (features/replay-performance, "Phones"): who is on the
// lean profile, what it draws with, the frame gate, and the level's
// shown-only matrix walk against three's own. `test_replay_phone.py` reads
// what this prints.

import { installModuleHooks, viewerDir } from '../sim/env.mjs';

installModuleHooks(viewerDir());
const THREE = await import('three');
const {
  PHONE_FPS, PHONE_RATIO_CAP, PHONE_VIDEO, frameGate, isPhone, phoneFps, phoneReplay, phoneVideo,
} = await import('../viewer/replay-phone.js');
const { walkShownOnly } = await import('../viewer/shown-walk.js');
const { pixelRatioFor } = await import('../viewer/video-apply.js');
const { displayOf, normalizeVideo } = await import('../viewer/video-settings.js');

const out = {};
const q = s => new URLSearchParams(s);
const phone = { coarse: true, screenW: 390, screenH: 844 };
const tablet = { coarse: true, screenW: 820, screenH: 1180 };
const laptop = { coarse: false, screenW: 1512, screenH: 982 };
const touchLaptop = { coarse: false, screenW: 390, screenH: 844 };

out.constants = { PHONE_FPS, PHONE_RATIO_CAP, PHONE_VIDEO };
out.isPhone = {
  phone: isPhone(phone),
  landscapePhone: isPhone({ coarse: true, screenW: 844, screenH: 390 }),
  tablet: isPhone(tablet),
  laptop: isPhone(laptop),
  fineSmall: isPhone(touchLaptop),
  noScreen: isPhone({ coarse: true, screenW: 0, screenH: 0 }),
};
out.phoneReplay = {
  phoneReplay: phoneReplay(q('replay=x.ndjson'), phone),
  phonePlay: phoneReplay(q('map=wake'), phone),
  phoneOptOut: phoneReplay(q('replay=x.ndjson&phone=0'), phone),
  laptopReplay: phoneReplay(q('replay=x.ndjson'), laptop),
  laptopOptIn: phoneReplay(q('replay=x.ndjson&phone=1'), laptop),
  tabletReplay: phoneReplay(q('replay=x.ndjson'), tablet),
};
const chosen = normalizeVideo({ graphicsQuality: 3, viewDistance: 90 });
out.video = {
  nothingStored: phoneVideo(false, normalizeVideo({})),
  stored: phoneVideo(true, chosen),
  chosen,
};
out.fps = { none: phoneFps(q('')), sixty: phoneFps(q('fps=60')), junk: phoneFps(q('fps=abc')) };

// The gate on a display's ticks: which of a second of them it draws.
const drawn = (fps, hz, seconds = 1) => {
  const gate = frameGate(fps);
  let n = 0;
  for (let i = 0; i < hz * seconds; i++) if (gate((i * 1000) / hz)) n++;
  return n;
};
out.gate = {
  off60: drawn(0, 60), off120: drawn(0, 120),
  at30on60: drawn(30, 60), at30on120: drawn(30, 120), at30on90: drawn(30, 90),
  at60on60: drawn(60, 60),
};

const screens = { phone: displayOf({ width: 390, height: 844 }, 3), retina: displayOf({ width: 1512, height: 982 }, 2) };
out.ratio = {
  phoneDefault: pixelRatioFor({ display: screens.phone, dpr: 3 }),
  phoneCapped: pixelRatioFor({ display: screens.phone, dpr: 3, cap: PHONE_RATIO_CAP }),
  phoneModeChosen: pixelRatioFor({ display: screens.phone, dpr: 3, cap: PHONE_RATIO_CAP, displayHeight: 2532 }),
  phoneOverride: pixelRatioFor({ display: screens.phone, dpr: 3, cap: PHONE_RATIO_CAP, override: 3 }),
  retinaDefault: pixelRatioFor({ display: screens.retina, dpr: 2 }),
  lowDpr: pixelRatioFor({ display: displayOf({ width: 390, height: 844 }, 1), dpr: 1, cap: PHONE_RATIO_CAP }),
};

// The shown-only walk against three's: a seeded tree of groups, some hidden,
// moved at random for a run of frames, nodes shown and hidden as they go.
// After each frame every shown node's world matrix must be three's to the
// bit; a hidden one may be stale until it is shown.
let seed = 7;
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
function build(depth, into) {
  const n = new THREE.Object3D();
  n.position.set(rand() * 10, rand() * 10, rand() * 10);
  n.rotation.set(rand(), rand(), rand());
  n.visible = rand() > 0.25;
  into.push(n);
  if (depth > 0) for (let i = 0; i < 3; i++) n.add(build(depth - 1, into));
  return n;
}
const nodesA = [], nodesB = [];
seed = 7; const a = build(5, nodesA);
seed = 7; const b = build(5, nodesB);
a.visible = true; b.visible = true;   // the level's root is shown; what is under it varies
const sceneA = new THREE.Scene(); sceneA.add(a);
const sceneB = new THREE.Scene(); sceneB.add(b);
walkShownOnly(b);
// What the walk skips: one frame's node visits, three's against this one's.
let visits = 0;
const countWalk = (o, force) => { visits++; for (const c of o.children) if (force || c.visible) countWalk(c, force); };
countWalk(b, false);
const shownChain = node => { for (let o = node; o; o = o.parent) if (!o.visible) return false; return true; };
let worst = 0, compared = 0, skippedNodes = 0;
seed = 99;
for (let frame = 0; frame < 60; frame++) {
  for (let k = 0; k < 20; k++) {
    const i = 1 + Math.floor(rand() * (nodesA.length - 1));
    const what = rand();
    if (what < 0.5) {
      const x = rand() * 5;
      nodesA[i].position.x = x; nodesB[i].position.x = x;
    } else if (what < 0.8) {
      const v = rand() > 0.3;
      nodesA[i].visible = v; nodesB[i].visible = v;
    } else {
      const r = rand();
      nodesA[i].rotation.y = r; nodesB[i].rotation.y = r;
    }
  }
  if (frame % 10 === 0) {
    // The root moves now and then: everything under it, shown or not, follows.
    a.position.z = frame; b.position.z = frame;
  }
  sceneA.updateMatrixWorld();
  sceneB.updateMatrixWorld();
  for (let i = 0; i < nodesA.length; i++) {
    if (!shownChain(nodesA[i])) { skippedNodes++; continue; }
    compared++;
    const ea = nodesA[i].matrixWorld.elements, eb = nodesB[i].matrixWorld.elements;
    for (let j = 0; j < 16; j++) worst = Math.max(worst, Math.abs(ea[j] - eb[j]));
  }
}
// A forced walk (an explicit `updateMatrixWorld(true)`) still reaches the hidden.
b.updateMatrixWorld(true);
sceneA.updateMatrixWorld(true);
let forcedWorst = 0;
for (let i = 0; i < nodesA.length; i++) {
  const ea = nodesA[i].matrixWorld.elements, eb = nodesB[i].matrixWorld.elements;
  for (let j = 0; j < 16; j++) forcedWorst = Math.max(forcedWorst, Math.abs(ea[j] - eb[j]));
}
out.walk = {
  nodes: nodesA.length, compared, skippedNodes, worst, forcedWorst,
  visitsThree: nodesA.length, visitsShown: visits, idempotent: walkShownOnly(b) === b,
};

process.stdout.write(JSON.stringify(out));
