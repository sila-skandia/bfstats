// The grip inspector's stances and locomotion: the one-pose stance clips, the
// gait clip pairs (from the pose glb or its shared sidecars), their buttons
// and readout, and the weight blend between them. Lifted out of poses.html
// (features/vehicle-instance-refactor, Part 2d).

import * as THREE from 'three';

/**
 * Built once by the page, where this code used to sit. `page` hands in
 * what it reads of the rest of the page, as getters (a binding the page
 * reassigns is read live):
 * `bust`, `current`, `loader`, `POSES_BASE`, `startAnimating`,
 * `stanceMetricsHook`.
 */
export function createPoseMotion(page) {
  // Stances are constant animation clips in the glb — one pose each — and the
  // switch blends their weights. Assets extracted before stances exist carry
  // no clips; their buttons disable and the static standing pose renders
  // exactly as before.
  const STANCE_KEYS = ['stand', 'crouch', 'lie'];
  // Locomotion, in contrast, is real motion: each gait is a pair of looping
  // timelines baked straight out of the game's `.baf` clips — `<gait>.lower`
  // (root, pelvis, legs, Spine Root) and `<gait>.upper` (Bip01 Spine out to
  // the fingers). They are two clips rather than one because the engine runs
  // the lower and upper body as two independent state machines with
  // independent phases; the bone sets are disjoint, so playing both at full
  // weight composes exactly, and nothing has to be resampled onto a common
  // period the game does not have.
  const MOTION_KEYS = ['idle', 'walk', 'run'];
  // (stance, motion) -> gait clip pair in the glb. Kneeling and prone have one
  // forward clip each in vanilla — `Lb_CrouchForward` and `Lb_LieForward` —
  // so both speeds resolve to it, which is what the game does too.
  const GAIT_FOR = {
    stand: { walk: 'walk', run: 'run' },
    crouch: { walk: 'crouchwalk', run: 'crouchwalk' },
    lie: { walk: 'crawl', run: 'crawl' },
  };
  // The pose settles first, then the camera glides to the re-fitted framing:
  // moving both at once reads as the figure jumping.
  const STANCE_BLEND_MS = 450;
  let stance = 'stand';
  let motion = 'idle';
  let mixer = null;
  let stanceActions = {};
  let gaitActions = {};     // gait key -> { lower: action, upper: action }
  let poseBlend = null;     // { from: { name: weight }, start }
  let gaitInfo = {};        // from the glb's own extras: clip paths and rates

  // The gait clips are not in the pose file. Neither half varies per pose —
  // the lower body takes no weapon and every vanilla soldier declares the same
  // `UsSoldier.ske`, and the upper body depends only on the weapon's grip — so
  // the extractor writes them once, into `gaits/lower.gait.glb` and one
  // `gaits/<Grip>.gait.glb` per grip (23 for vanilla's 28 weapons, because
  // `copyState` has K98/K98Sniper/No4/No4Sniper share a clip set). Every pose
  // names its two in `extras.gaitAssets`.
  //
  // Those files carry the joint hierarchy and nothing else, so the clips'
  // track names are bone names, and three.js binds a clip to whatever root the
  // mixer was built on — the pose's own skeleton instance. That is the whole
  // retargeting mechanism, and it is safe here because all 55 bones a gait
  // touches exist in every pose file under exactly these names and none of
  // them is a duplicated node name (the one duplicate, the `Thompson` prop
  // bone against the weapon node, is not animated by any gait).
  const gaitBundles = new Map();   // relative path -> Promise<AnimationClip[]>

  function loadGaitBundle(relative) {
    let pending = gaitBundles.get(relative);
    if (!pending) {
      // A missing or unreadable bundle degrades to "no gait", never to a
      // broken page: the stance stills still render.
      pending = page.loader.loadAsync(`${page.POSES_BASE}/${relative}${page.bust()}`)
        .then(bundle => bundle.animations ?? [])
        .catch(() => []);
      gaitBundles.set(relative, pending);
    }
    return pending;
  }

  function loadGaitClips(assets) {
    if (!assets?.lower || !assets?.upper) return Promise.resolve([]);
    return Promise.all([loadGaitBundle(assets.lower), loadGaitBundle(assets.upper)])
      .then(([lower, upper]) => [...lower, ...upper]);
  }

  // The gait actually on screen, or null when this is a still stance — either
  // because the user chose idle, or because the asset predates gait clips.
  function activeGait() {
    if (motion === 'idle') return null;
    const key = GAIT_FOR[stance]?.[motion];
    return key && gaitActions[key] ? key : null;
  }

  // Every action's weight for the current (stance, motion), as one flat map.
  // A gait owns the whole body when it is up, so the stance still drops to 0;
  // during a blend the two sum to 1 on every bone, which is what keeps a
  // half-faded figure from collapsing.
  function targetWeights() {
    const target = {};
    for (const key of Object.keys(stanceActions)) target[`stance:${key}`] = 0;
    for (const key of Object.keys(gaitActions))
      for (const half of ['lower', 'upper']) target[`gait:${key}.${half}`] = 0;
    const gait = activeGait();
    if (gait) {
      for (const half of ['lower', 'upper']) target[`gait:${gait}.${half}`] = 1;
    } else if (stanceActions[stance]) {
      target[`stance:${stance}`] = 1;
    }
    return target;
  }

  function eachAction(visit) {
    for (const [key, action] of Object.entries(stanceActions))
      visit(`stance:${key}`, action);
    for (const [key, halves] of Object.entries(gaitActions))
      for (const [half, action] of Object.entries(halves))
        visit(`gait:${key}.${half}`, action);
  }

  function applyWeights(weights) {
    eachAction((name, action) => action.setEffectiveWeight(weights[name] ?? 0));
  }

  // Not AnimationAction.crossFadeTo: its fade scales the action's own weight,
  // and the resting clips sit at weight 0, so the incoming pose never showed.
  // Blending from the weights on screen also lets a switch made mid-blend turn
  // around instead of jumping.
  function startPoseBlend() {
    if (!mixer) return;
    const from = {};
    eachAction((name, action) => { from[name] = action.getEffectiveWeight(); });
    poseBlend = { from, start: performance.now() };
    page.startAnimating();
  }

  const stanceButtons = [...document.querySelectorAll('.stances button')];
  const motionButtons = [...document.querySelectorAll('.motions button')];

  function updateStanceButtons() {
    for (const button of stanceButtons) {
      const key = button.dataset.stance;
      button.disabled = page.current ? !stanceActions[key] : false;
      button.classList.toggle('active', key === stance);
    }
    for (const button of motionButtons) {
      const key = button.dataset.motion;
      button.disabled = page.current && key !== 'idle'
        ? !gaitActions[GAIT_FOR[stance]?.[key]]
        : false;
      button.classList.toggle('active', key === motion);
    }
    showGait();
  }

  function showGait() {
    const readout = document.getElementById('gait');
    if (!readout) return;
    const gait = activeGait();
    if (!gait) {
      readout.textContent = page.current && motion !== 'idle'
        ? 'no locomotion clip in this extract — showing the stance still'
        : '';
      return;
    }
    const info = gaitInfo[gait];
    if (!info) { readout.textContent = gait; return; }
    // Steps, not cycles: a lower-body locomotion clip is a two-step stride, so
    // the per-step figure is what compares against the engine's step period.
    const steps = (1 / info.lowerPeriod) * 2;
    readout.replaceChildren(
      Object.assign(document.createElement('b'),
        { textContent: `${info.lowerState} + ${info.upperState}` }),
      document.createTextNode(
        `\n${info.lowerFrames} frames over ${info.lowerPeriod.toFixed(3)} s `
        + `(speed ${info.lowerSpeed}) = ${steps.toFixed(2)} steps/s`
        + `\n${info.lowerClip}\n${info.upperClip}`));
  }

  function setStance(key) {
    if (!STANCE_KEYS.includes(key) || key === stance) return;
    if (page.current && !stanceActions[key]) return;   // asset lacks this stance
    stance = key;
    updateStanceButtons();
    page.stanceMetricsHook?.();
    startPoseBlend();
  }

  function setMotion(key) {
    if (!MOTION_KEYS.includes(key) || key === motion) return;
    if (page.current && key !== 'idle' && !gaitActions[GAIT_FOR[stance]?.[key]]) return;
    motion = key;
    updateStanceButtons();
    startPoseBlend();
  }

  // Returns true on the frame the blend lands, so the caller can re-fit once
  // the mixer has applied the final pose.
  function advancePoseBlend(now) {
    if (!poseBlend) return false;
    const t = Math.min((now - poseBlend.start) / STANCE_BLEND_MS, 1);
    const eased = t * t * (3 - 2 * t);
    const target = targetWeights();
    eachAction((name, action) => action.setEffectiveWeight(
      THREE.MathUtils.lerp(poseBlend.from[name] ?? 0, target[name] ?? 0, eased)));
    if (t < 1) return false;
    poseBlend = null;
    return true;
  }

  for (const button of stanceButtons)
    button.addEventListener('click', () => setStance(button.dataset.stance));
  for (const button of motionButtons)
    button.addEventListener('click', () => setMotion(button.dataset.motion));

  /** Build the mixer on the figure just put on stage (`page.current`): its
   *  stance clips, and each gait whose two halves are found among its own
   *  clips and `sharedClips`, at the current (stance, motion)'s weights. */
  function bindFigure(gltf, sharedClips) {
    mixer = null;
    stanceActions = {};
    gaitActions = {};
    poseBlend = null;
    gaitInfo = gltf.userData?.gaits ?? {};
    const clips = gltf.animations ?? [];
    for (const key of STANCE_KEYS) {
      const clip = THREE.AnimationClip.findByName(clips, key);
      if (!clip) continue;
      mixer ??= new THREE.AnimationMixer(page.current);
      const action = mixer.clipAction(clip);
      action.play();
      action.setEffectiveWeight(0);
      stanceActions[key] = action;
    }
    // `--gaits embed` still works: a pose carrying its own copy is searched
    // first, and only a pose that does not falls through to the sidecars. The
    // extractor never writes both, so in practice one of the two is empty.
    const gaitClips = [...clips, ...sharedClips];
    // A gait only counts when both halves are present: half a body walking
    // while the other half holds a still pose is worse than the still pose.
    for (const key of gltf.userData?.gaitClips ?? []) {
      const halves = {};
      for (const half of ['lower', 'upper']) {
        const clip = THREE.AnimationClip.findByName(gaitClips, `${key}.${half}`);
        if (!clip) continue;
        mixer ??= new THREE.AnimationMixer(page.current);
        // The mixer's root is this pose's scene, so a clip that came out of a
        // sidecar binds to these bones by name — nothing rewrites the tracks.
        const action = mixer.clipAction(clip);
        action.setLoop(THREE.LoopRepeat, Infinity);
        action.play();
        action.setEffectiveWeight(0);
        halves[half] = action;
      }
      if (halves.lower && halves.upper) gaitActions[key] = halves;
    }
    if (!stanceActions[stance]) stance = 'stand';
    if (motion !== 'idle' && !gaitActions[GAIT_FOR[stance]?.[motion]])
      motion = 'idle';
    applyWeights(targetWeights());
    mixer?.update(0);
    updateStanceButtons();
  }

  /** A stance or motion from the URL, before the first figure loads. */
  function presetStance(key) {
    stance = key;
    updateStanceButtons();
  }
  function presetMotion(key) {
    motion = key;
    updateStanceButtons();
  }

  /** Land any blend at once: every action at its target weight. */
  function settleWeights() {
    poseBlend = null;
    applyWeights(targetWeights());
  }

  return {
    STANCE_KEYS,
    MOTION_KEYS,
    get stance() { return stance; },
    get motion() { return motion; },
    get mixer() { return mixer; },
    get stanceActions() { return stanceActions; },
    get gaitActions() { return gaitActions; },
    get gaitInfo() { return gaitInfo; },
    // Whether a blend is under way, for the frame loop's keep-going test.
    get blending() { return poseBlend !== null; },
    activeGait,
    advancePoseBlend,
    bindFigure,
    eachAction,
    loadGaitClips,
    presetMotion,
    presetStance,
    setMotion,
    setStance,
    settleWeights,
  };
}
