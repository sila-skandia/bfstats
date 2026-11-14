// A replay on a phone (features/replay-performance, "Phones"): who is on the
// lean profile, what it draws with, the frame gate, and the level's
// shown-only matrix walk against three's own. `test_replay_phone.py` reads
// what this prints.

import { installModuleHooks, viewerDir } from '../sim/env.mjs';

installModuleHooks(viewerDir());
const THREE = await import('three');
const {
  PHONE_AUDIO_LATENCY, PHONE_FPS, PHONE_RATIO_CAP, PHONE_VIDEO, audioLatencyHint, frameGate, isPhone, phoneFps, phoneReplay, phoneVideo,
} = await import('../viewer/replay-phone.js');
const { walkShownOnly, walkVisibleOnly } = await import('../viewer/shown-walk.js');
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
out.latency = {
  phone: audioLatencyHint(q('replay=x.ndjson'), true),
  desktop: audioLatencyHint(q('replay=x.ndjson'), false),
  asked: audioLatencyHint(q('latency=interactive'), true),
  seconds: audioLatencyHint(q('latency=0.2'), false),
  junk: audioLatencyHint(q('latency=loud'), false),
  constant: PHONE_AUDIO_LATENCY,
};

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

// The visible-only walk (a replay's moving trees: its hulls and soldiers)
// against three's: the same run, but every node moves every frame, as a
// hull's root and a soldier's bones do, so `walkShown` would walk the hidden
// ones too. Shown nodes must be three's to the bit, including one shown
// again after its parent moved while it was hidden.
{
  const nodesC = [], nodesD = [];
  seed = 11; const c = build(5, nodesC);
  seed = 11; const d = build(5, nodesD);
  c.visible = true; d.visible = true;
  const sceneC = new THREE.Scene(); sceneC.add(c);
  const sceneD = new THREE.Scene(); sceneD.add(d);
  walkVisibleOnly(d);
  let visibleVisits = 0;
  const countVisible = o => { visibleVisits++; for (const k of o.children) if (k.visible) countVisible(k); };
  countVisible(d);
  let vWorst = 0, vCompared = 0, reshown = 0;
  seed = 5;
  for (let frame = 0; frame < 60; frame++) {
    const wasHidden = nodesD.map(n => !shownChain(n));
    for (let i = 1; i < nodesC.length; i++) {
      const x = rand() * 5;
      nodesC[i].position.y = x; nodesD[i].position.y = x;
    }
    for (let k = 0; k < 15; k++) {
      const i = 1 + Math.floor(rand() * (nodesC.length - 1));
      const v = rand() > 0.3;
      nodesC[i].visible = v; nodesD[i].visible = v;
    }
    c.position.z = frame; d.position.z = frame;
    sceneC.updateMatrixWorld();
    sceneD.updateMatrixWorld();
    for (let i = 0; i < nodesC.length; i++) {
      if (!shownChain(nodesC[i])) continue;
      vCompared++;
      if (wasHidden[i]) reshown++;
      const ea = nodesC[i].matrixWorld.elements, eb = nodesD[i].matrixWorld.elements;
      for (let j = 0; j < 16; j++) vWorst = Math.max(vWorst, Math.abs(ea[j] - eb[j]));
    }
  }
  out.visibleWalk = {
    nodes: nodesC.length, compared: vCompared, reshown, worst: vWorst,
    visitsThree: nodesC.length, visitsVisible: visibleVisits, idempotent: walkVisibleOnly(d) === d,
  };
}

// The draw's cull (draw-cull.js): a camera at the origin looking down -z,
// far 100 m. A hull's group stands at the origin and its `cullAt` root
// moves; what lies wholly outside the view is hidden for the draw and put
// back after it.
{
  const { hideOutsideView, setDrawCull, MIN_RADIUS } = await import('../viewer/draw-cull.js');
  const camera = new THREE.PerspectiveCamera(60, 0.5, 0.5, 100);
  const root = new THREE.Group();
  root.matrixAutoUpdate = false;
  const box = size => new THREE.Mesh(new THREE.BoxGeometry(size, size, size));
  const hull = (x, y, z, size = 4) => {
    const group = new THREE.Group();
    const inner = new THREE.Group();
    inner.position.set(x, y, z);
    inner.add(box(size));
    group.add(inner);
    group.userData.cullAt = inner;
    root.add(group);
    return group;
  };
  const scene = new THREE.Scene();
  scene.add(root, camera);
  const ahead = hull(0, 0, -50);
  const behind = hull(0, 0, 50);
  const pastFar = hull(0, 0, -200);
  const edgeOfFar = hull(0, 0, -100 - MIN_RADIUS + 1);
  const ship = hull(0, 0, -260, 400);   // 260 m out, but 400 m long
  const hiddenAlready = hull(0, 0, 60); hiddenAlready.visible = false;
  const prop = box(0.5); prop.position.set(300, 0, 0); root.add(prop);
  scene.updateMatrixWorld(true);
  const restore = hideOutsideView(camera, [root]);
  const during = [ahead, behind, pastFar, edgeOfFar, ship, hiddenAlready, prop].map(o => o.visible);
  restore?.();
  const after = [ahead, behind, pastFar, edgeOfFar, ship, hiddenAlready, prop].map(o => o.visible);
  // The hull drives in: its group never moved, its root did.
  pastFar.userData.cullAt.position.z = -60;
  const restore2 = hideOutsideView(camera, [root]);
  const droveIn = pastFar.visible;
  restore2?.();
  setDrawCull(false);
  const off = hideOutsideView(camera, [root]);
  setDrawCull(true);
  out.drawCull = { during, after, droveIn, off: off === null };
}

// Quality on the fly (replay-quality.js): a page drawing at `fpsAt(step)`,
// frames fed for `seconds`, with `busy(t)` the frames that are not read.
const { LADDER, PHONE_SLOW, createQualityGovernor, qualityMode } = await import('../viewer/replay-quality.js');
const { capVideo } = await import('../viewer/video-apply.js');
function simulate({ fpsAt, seconds = 60, target = 60, slow, mode = 'auto', busy = () => false }) {
  const applied = [];
  const g = createQualityGovernor({ apply: l => applied.push(l.id), targetFps: target, slow, mode });
  let t = 0;
  while (t < seconds * 1000) {
    t += 1000 / fpsAt(g.state.step);
    g.frame(t, busy(t));
  }
  return { applied, final: g.state.level.id, stopped: g.state.stopped, mode: g.state.mode };
}
out.governor = {
  ladder: LADDER.map(l => l.id),
  // A GPU-bound page: every rung buys frames.
  gpuBound: simulate({ fpsAt: step => [20, 28, 38, 50][step] }),
  // Each rung helps and Low is enough.
  enoughAtLow: simulate({ fpsAt: step => [30, 40, 55, 70][step] }),
  // The unwatchable page: a frame or two a second, each rung a little more.
  crawling: simulate({ fpsAt: step => [1.2, 1.6, 2.2, 3][step], seconds: 120 }),
  // A CPU-bound page: no rung buys a frame.
  cpuBound: simulate({ fpsAt: () => 15 }),
  // Fast enough already.
  fast: simulate({ fpsAt: () => 58 }),
  // A phone drawing for 30 (map.html passes PHONE_SLOW): 28 a second is fine.
  phoneFine: simulate({ fpsAt: () => 28, target: 30, slow: PHONE_SLOW }),
  phoneSlow: simulate({ fpsAt: step => [12, 16, 22, 28][step], target: 30, slow: PHONE_SLOW }),
  // A 120 Hz phone missing the gate: every fifth refresh, 24 fps, until a
  // rung lets it keep up. SLOW alone read 24 of 30 as fine.
  phoneMissing: simulate({ fpsAt: step => [24, 30, 30, 30][step], target: 30, slow: PHONE_SLOW }),
  phoneMissingOldRule: simulate({ fpsAt: step => [24, 30, 30, 30][step], target: 30 }),
  // Slow only while busy (a drag, a load): nothing read, nothing dropped.
  busyOnly: simulate({ fpsAt: () => 10, busy: () => true }),
  // Pinned: Auto never moves it.
  pinned: simulate({ fpsAt: () => 10, mode: 'reduced' }),
  modes: [qualityMode('AUTO'), qualityMode('low'), qualityMode('ultra'), qualityMode(null)],
  // A recording: slow frames while paused are not read, and Auto picks up
  // after it as it was.
  filming: (() => {
    const applied = [];
    const g = createQualityGovernor({ apply: l => applied.push(l.id), targetFps: 60 });
    let t = 0;
    g.pause(true, t);
    for (; t < 30000; t += 100) g.frame(t);
    const duringPause = [...applied];
    g.pause(false, t);
    for (const end = t + 30000; t < end; t += 1000 / [20, 28, 38, 50][g.state.step]) g.frame(t);
    return { duringPause, after: applied, paused: g.paused };
  })(),
};
const choice = normalizeVideo({ graphicsQuality: 2, effectsQuality: 3, environmentMapping: true, viewDistance: 80, textureQuality: 4 });
out.cap = {
  none: capVideo(choice, null),
  low: capVideo(choice, LADDER[2].cap),
  // A cap never raises what the player chose lower.
  neverRaises: capVideo(normalizeVideo({ graphicsQuality: 1, viewDistance: 60, environmentMapping: false }), LADDER[1].cap),
};

process.stdout.write(JSON.stringify(out));
