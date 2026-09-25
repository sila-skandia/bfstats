// The OPTIONS > CONTROLS screen's preview: the player's bindings driving
// something they move, so a profile can be tried before it is played.
//
// Nothing here is a model of its own. The soldier is a pose glb out of
// `models/poses` with its stance and gait clips blended by the same
// `pose-motion.js` the Poses page uses; the Spitfire and the Sherman are the
// extracted vehicles with every RotationalBundle, Wing flap and drivetrain
// posed by `model-rig.js` from the player inputs the glb itself declares
// (`extras.rig.axes.*.input`) — so ROLL LEFT swings the ailerons, RUDDER the
// rudder and tail wheel, SPEED UP the propeller, because that is what the
// game's own templates bind them to.
//
// The inputs are a `controls.probe(context, keys, mouse)`: the same axis and
// trigger answers the in-game control map gives, for the tab the screen is on.

import * as THREE from 'three';
import { GLTFLoader } from './vendor/loaders/GLTFLoader.js';
import { createPoseMotion } from './pose-motion.js';
import { createModelRig, keyOf } from './model-rig.js';
import { disposeModel } from './dispose-model.js';
import { createPoseComposer } from './pose-compose.js';

/** The pair the soldier preview wears, the first of these the manifest
 *  carries: a US rifleman, else whoever is first. */
const SOLDIER_PICKS = [['USSoldier', 'M1Garand'], ['BritishSoldier', 'No4']];

const MODELS = { air: 'Spitfire', landSea: 'Sherman' };

/** Flight inputs the preview drives on a vehicle's rig. */
const RIG_INPUTS = ['c_PIThrottle', 'c_PIYaw', 'c_PIPitch', 'c_PIRoll'];


export function createControlsPreview({ root = '' } = {}) {
  const canvas = document.createElement('canvas');
  canvas.className = 'controls-preview';
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
  } catch (error) {
    // No WebGL (blocked, or out of contexts): the screen keeps its rows,
    // lit as keys are pressed, and the frame stays black.
    console.warn('controls preview: no WebGL,', error.message);
    return { canvas, setMode() {}, resize() {}, frame() {},
             get state() { return { mode: null, loaded: false, webgl: false }; } };
  }
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000000);
  const camera = new THREE.PerspectiveCamera(35, 2, 0.05, 500);
  scene.add(new THREE.HemisphereLight(0xbfc6d0, 0x2a2b20, 1.6));
  const sun = new THREE.DirectionalLight(0xffffff, 2.0);
  sun.position.set(4, 7, 5);
  scene.add(sun);
  const grid = new THREE.GridHelper(40, 40, 0x3a3a30, 0x1c1c18);
  scene.add(grid);

  // Muzzle light: every tab's FIRE shows here.
  const flash = new THREE.PointLight(0xffc070, 0, 6, 2);
  scene.add(flash);

  const loader = new GLTFLoader();
  const bust = () => '';
  let mode = null;
  let loadSeq = 0;
  let current = null;       // the model on stage
  let lastNow = 0;

  // --- soldier ---------------------------------------------------------------

  const soldier = { gltf: null, prone: false, lieWas: false, jumpWas: false,
                    jump: 0, yaw: 0, fireT: 0 };
  let posesBase = `${root}models/poses`;
  /** The pose glb, or the split tree's recipe + rig + weapon where the tree
   *  has one (`pose-compose.js`). Uncached: `stage()` frees what it replaces,
   *  and the page-level rig cache is shared with the playable map. */
  const poses = createPoseComposer({
    loader: () => loader,
    modelsBase: () => posesBase.replace(/\/poses$/, ''),
    bust: () => bust(),
    cache: false,
  });
  const poseMotion = createPoseMotion({
    get bust() { return bust; }, get current() { return current; },
    get loader() { return loader; }, get POSES_BASE() { return posesBase; },
    startAnimating: () => {}, stanceMetricsHook: null,
  });

  async function loadSoldier(seq) {
    const manifest = await fetch(`${posesBase}/poses-matrix.json`).then(r => r.json());
    const pairs = manifest.pairs || [];
    const pair = SOLDIER_PICKS.map(([s, w]) => pairs.find(p => p.soldier === s && p.weapon === w))
      .find(Boolean) || pairs[0];
    if (!pair) return;
    const [figure, clips] = await Promise.all([
      poses.pose(pair.soldier, pair.weapon),
      poseMotion.loadGaitClips(pair.gaitAssets),
    ]);
    if (!figure) return;
    if (seq !== loadSeq) { disposeModel(figure.scene); return; }
    stage(figure.scene);
    current.traverse(o => { if (o.isSkinnedMesh) o.frustumCulled = false; });
    poseMotion.bindFigure(figure, clips);
    soldier.gltf = figure;
    frameCamera(new THREE.Vector3(0, 0.9, 0), 4.2, 0.35, 0.18);
  }

  function driveSoldier(probe, dt, now) {
    const throttle = probe.axis('c_PIThrottle');
    const strafe = probe.axis('c_PIYaw');
    const moving = Math.hypot(throttle, strafe) > 0.2;
    // PRONE is a press that toggles (`c_CMNonRepetive`); CROUCH is held.
    const lie = probe.held('c_PILie');
    if (lie && !soldier.lieWas) soldier.prone = !soldier.prone;
    soldier.lieWas = lie;
    const stance = soldier.prone ? 'lie' : probe.held('c_PICrouch') ? 'crouch' : 'stand';
    if (stance !== poseMotion.stance) poseMotion.setStance(stance);
    const motion = !moving ? 'idle' : probe.held('c_PIWalk') ? 'walk' : 'run';
    if (motion !== poseMotion.motion) poseMotion.setMotion(motion);
    // Face the way the keys push: W walks away from the camera.
    if (moving) {
      const want = Math.atan2(-strafe, -throttle);
      let d = want - soldier.yaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      soldier.yaw += d * Math.min(1, dt * 10);
    }
    const jump = probe.held('c_PIAction');
    if (jump && !soldier.jumpWas && soldier.jump <= 0 && stance === 'stand') soldier.jump = 0.55;
    soldier.jumpWas = jump;
    let lift = 0;
    if (soldier.jump > 0) {
      soldier.jump -= dt;
      const t = 1 - Math.max(0, soldier.jump) / 0.55;
      lift = 4 * 0.45 * t * (1 - t);
    }
    current.rotation.y = soldier.yaw;
    current.position.y = lift;
    // Scroll the floor under the figure, so running reads as running.
    if (moving) {
      const speed = motion === 'walk' ? 1.4 : stance === 'stand' ? 4 : 1.2;
      grid.position.x -= Math.sin(soldier.yaw) * speed * dt;
      grid.position.z -= Math.cos(soldier.yaw) * speed * dt;
      grid.position.x %= 1;
      grid.position.z %= 1;
    }
    poseMotion.advancePoseBlend(now);
    poseMotion.mixer?.update(dt);
    fire(probe.held('c_PIFire'), dt,
         new THREE.Vector3(Math.sin(soldier.yaw) * -0.7, 1.3 + lift, Math.cos(soldier.yaw) * -0.7));
  }

  // --- vehicles --------------------------------------------------------------

  const rig = createModelRig({ rememberMap: () => {} });
  const vehicle = { controls: [], blur: [], throttle: 0.3, attitude: new THREE.Euler(),
                    body: null, guns: [], tracers: [], heading: 0 };

  async function loadVehicle(name, seq) {
    const gltf = await loader.loadAsync(`${root}models/${name}.glb`);
    if (seq !== loadSeq) { disposeModel(gltf.scene); return; }
    // The glb carries its collision meshes beside the visible ones.
    gltf.scene.traverse(o => {
      if (o.userData?.collision || o.userData?.collisionHull) o.visible = false;
    });
    const body = new THREE.Group();
    body.add(gltf.scene);
    stage(body);
    vehicle.body = gltf.scene;
    rig.collectRig(gltf.scene);
    rig.collectScrolling(gltf.scene);
    vehicle.controls = [...new Set(rig.rigged.map(p => p.control))];
    vehicle.blur = [];
    vehicle.guns = [];
    gltf.scene.traverse(o => {
      const blur = o.userData?.propellerBlur;
      if (blur) {
        const s = o.children.find(c => c.name === blur.static);
        const b = o.children.find(c => c.name === blur.blurred);
        if (s && b) vehicle.blur.push({ s, b });
      }
      // The effect bundles (muzzle flashes, wheel dust, water spray) are
      // baked in at rest; they show only when their gun fires.
      if (o.userData?.templateKind === 'EffectBundle') o.visible = false;
      // So are a gun's round and tracer (`Projectile`): they are what it
      // fires, not part of it.
      if (o.userData?.templateKind === 'Projectile') o.visible = false;
      // First-person-only particles never show on the outside view, and a
      // particle outside a bundle (a shell's trail) belongs to the round.
      const particle = /Particle$/.test(o.userData?.templateKind ?? '');
      if (o.userData?.effect?.view === 'first') o.visible = false;
      if (particle && o.parent?.userData?.templateKind !== 'EffectBundle') o.visible = false;
      // The driver's guns, each on the input its own template names
      // (`fireArms.input`); a gunner's seat is another player's.
      const arms = o.userData?.fireArms;
      if (arms && arms.control === name) {
        const muzzles = [];
        const flashes = [];
        o.traverse(c => {
          if (c.userData?.templateKind === 'Muzzle') muzzles.push(c);
          if (c.userData?.templateKind === 'EffectBundle') flashes.push(c);
        });
        vehicle.guns.push({ input: arms.input, rate: Math.min(15, arms.roundOfFire || 1),
                            bullet: arms.projectile?.kind === 'bullet',
                            muzzles: muzzles.length ? muzzles : [o], flashes,
                            wait: 0, lit: 0, was: false });
      }
    });

    vehicle.throttle = name === 'Spitfire' ? 0.3 : 0;
    vehicle.attitude.set(0, 0, 0);
    vehicle.heading = 0;
    const box = new THREE.Box3().setFromObject(gltf.scene);
    const size = box.getSize(new THREE.Vector3()).length();
    const centre = box.getCenter(new THREE.Vector3());
    grid.position.set(0, box.min.y, 0);
    frameCamera(centre, size * 1.05, 0.6, 0.3);
  }

  function driveVehicle(probe, dt) {
    const input = Object.fromEntries(RIG_INPUTS.map(i => [i, probe.axis(i)]));
    const plane = mode === 'air';
    // A plane's throttle is a lever the keys move, not a spring: it stays
    // where it was left, and the propeller keeps turning at idle.
    if (plane) {
      vehicle.throttle = Math.max(0.15, Math.min(1, vehicle.throttle + input.c_PIThrottle * dt * 0.7));
    } else {
      vehicle.throttle = input.c_PIThrottle;
    }
    for (const control of vehicle.controls) {
      for (const name of RIG_INPUTS) {
        rig.setInput(keyOf(control, name), name === 'c_PIThrottle' ? vehicle.throttle : input[name]);
      }
    }
    rig.applyRig();
    rig.advanceRates(dt);
    rig.advanceScroll(dt);
    for (const { s, b } of vehicle.blur) {
      const fast = Math.abs(vehicle.throttle) > 0.5;
      s.visible = !fast;
      b.visible = fast;
    }
    const e = vehicle.attitude;
    const ease = Math.min(1, dt * 3);
    if (plane) {
      // The airframe answers the stick too, a little, and settles back.
      e.z += (-input.c_PIRoll * 0.45 - e.z) * ease;
      e.x += (-input.c_PIPitch * 0.25 - e.x) * ease;
      e.y += (-input.c_PIYaw * 0.15 - e.y) * ease;
      current.rotation.copy(e);
    } else {
      // A tank turns on the spot and rolls the floor under it.
      vehicle.heading -= input.c_PIYaw * dt * 0.9;
      current.rotation.y = vehicle.heading;
      const speed = vehicle.throttle * 4 * dt;
      grid.position.x += Math.sin(vehicle.heading) * speed;
      grid.position.z += Math.cos(vehicle.heading) * speed;
      grid.position.x %= 1;
      grid.position.z %= 1;
    }
    fireGuns(probe, dt);
    advanceTracers(dt);
  }

  // --- fire ------------------------------------------------------------------

  function fire(held, dt, at) {
    soldier.fireT += dt;
    if (!held) { flash.intensity = 0; return; }
    flash.position.copy(at);
    // A flicker at a machine gun's cadence, about 12 rounds a second.
    flash.intensity = (soldier.fireT * 12) % 1 < 0.5 ? 6 : 0;
  }

  /** Each gun at its own rate of fire (`roundOfFire`, rounds a second)
   *  while its input is held: the template's own muzzle-flash bundle for a
   *  frame or two per round, and a tracer down the barrel for a bullet. A
   *  cannon fires on the press and then waits out its reload. */
  function fireGuns(probe, dt) {
    let lightAt = null;
    for (const gun of vehicle.guns) {
      const held = probe.held(gun.input);
      gun.wait -= dt;
      gun.lit -= dt;
      const pressed = held && !gun.was;
      gun.was = held;
      if (held && gun.wait <= 0 && (gun.bullet || pressed || gun.rate >= 1)) {
        gun.wait = 1 / gun.rate;
        gun.lit = gun.bullet ? 0.05 : 0.18;
        if (gun.bullet) for (const m of gun.muzzles) spawnTracer(m);
      }
      const on = gun.lit > 0;
      for (const f of gun.flashes) f.visible = on;
      if (on) lightAt = gun.muzzles[0].getWorldPosition(new THREE.Vector3());
    }
    flash.intensity = lightAt ? 6 : 0;
    if (lightAt) flash.position.copy(lightAt);
  }

  const tracerGeo = new THREE.CylinderGeometry(0.03, 0.03, 1.6, 4).rotateX(Math.PI / 2);
  const tracerMat = new THREE.MeshBasicMaterial({ color: 0xffd080 });
  function spawnTracer(muzzle) {
    const mesh = new THREE.Mesh(tracerGeo, tracerMat);
    muzzle.getWorldPosition(mesh.position);
    const dir = new THREE.Vector3(0, 0, -1)
      .applyQuaternion(muzzle.getWorldQuaternion(new THREE.Quaternion()));
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), dir);
    scene.add(mesh);
    vehicle.tracers.push({ mesh, dir, life: 0.35 });
  }
  function advanceTracers(dt) {
    vehicle.tracers = vehicle.tracers.filter(t => {
      t.life -= dt;
      t.mesh.position.addScaledVector(t.dir, 90 * dt);
      if (t.life > 0) return true;
      scene.remove(t.mesh);
      return false;
    });
  }

  // --- stage -----------------------------------------------------------------

  function stage(object) {
    if (current) { scene.remove(current); disposeModel(current); }
    for (const t of vehicle.tracers) scene.remove(t.mesh);
    vehicle.tracers = [];
    current = object;
    scene.add(current);
  }

  /** A three-quarter view from behind and above the model: W, SPEED UP and
   *  FORWARD all move it away from the camera. */
  function frameCamera(target, distance, up, side) {
    camera.position.set(target.x + distance * side, target.y + distance * up, target.z + distance);
    camera.lookAt(target);
  }

  function setMode(tab) {
    const next = tab === 'air' || tab === 'landSea' ? tab : 'soldier';
    if (next === mode) return;
    mode = next;
    const seq = ++loadSeq;
    soldier.gltf = null;
    vehicle.body = null;
    grid.position.set(0, 0, 0);
    flash.intensity = 0;
    const job = mode === 'soldier' ? loadSoldier(seq) : loadVehicle(MODELS[mode], seq);
    job.catch(error => console.warn('controls preview:', error.message));
  }

  function resize(width, height) {
    if (!width || !height) return;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }

  function frame(probe, now) {
    const dt = lastNow ? Math.min((now - lastNow) / 1000, 0.1) : 0;
    lastNow = now;
    if (current) {
      if (mode === 'soldier' && soldier.gltf) driveSoldier(probe, dt, now);
      else if (mode !== 'soldier' && vehicle.body) driveVehicle(probe, dt);
    }
    renderer.render(scene, camera);
  }

  return {
    canvas,
    setMode,
    resize,
    frame,
    /** For headless checks: what is on stage. */
    get scene() { return scene; },
    get state() {
      return {
        mode,
        loaded: Boolean(mode === 'soldier' ? soldier.gltf : vehicle.body),
        stance: poseMotion.stance,
        motion: poseMotion.motion,
        throttle: vehicle.throttle,
        rigged: rig.rigged.length,
        inputs: Object.fromEntries(rig.inputValues),
        firing: flash.intensity > 0 || vehicle.tracers.length > 0,
        guns: vehicle.guns.map(g => g.input),
      };
    },
  };
}
