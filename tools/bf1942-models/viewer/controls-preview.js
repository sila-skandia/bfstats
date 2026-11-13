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
import { GLTFLoader } from './glb-loader.js';
import { createPoseMotion } from './pose-motion.js';
import { createModelRig, keyOf } from './model-rig.js';
import { disposeModel } from './dispose-model.js';
import { createPoseComposer } from './pose-compose.js';
import { modelFileStem } from './model-file.js';
import { fireCycle } from './fire-timer.js';
import { bonePattern, wornGrafts } from './kit-graft.js';
import { cameraModeFrom, kitFactions, pickPosedPair, tabVehicles } from './controls-kits.js';

// Remaster mode (features/remaster-browser) runs on three's WebGPU build,
// which has no WebGLRenderer: a side view then takes a WebGPU renderer from
// the remaster's hooks. Without the remaster this is the WebGLRenderer it was.
const remasterSideRenderer = options => globalThis.bfRemasterHooks?.sideRenderer?.(options)
  ?? new THREE.WebGLRenderer(options);


/** The pair the soldier preview wears when no kit can be dressed (a tree
 *  with no `kits.json`), the first of these the manifest carries: a US
 *  rifleman, else whoever is first. */
const SOLDIER_PICKS = [['USSoldier', 'M1Garand'], ['BritishSoldier', 'No4']];
/** The kit the soldier wears first: the US rifleman's, else the first kit
 *  a posed pair can be found for. */
const KIT_PICKS = [['American', 'Assault'], ['US', 'Assault'], ['British', 'Assault']];

const MODELS = { air: 'Spitfire', landSea: 'Sherman' };

/** Flight inputs the preview drives on a vehicle's rig. */
const RIG_INPUTS = ['c_PIThrottle', 'c_PIYaw', 'c_PIPitch', 'c_PIRoll'];


export function createControlsPreview({ root = '' } = {}) {
  const canvas = document.createElement('canvas');
  canvas.className = 'controls-preview';
  let renderer;
  try {
    renderer = remasterSideRenderer({ canvas, antialias: true, alpha: false });
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
                    jump: 0, yaw: 0, fireT: 0,
                    // The camera keys (F9 to F12, C): the game's own four
                    // views, on the figure.
                    camera: 'chaseRear', toggleWas: false, orbit: 0, zoom: false };
  // The kit on him (`kits.json`, extract_kits.py): its worn parts grafted on
  // his bones the way the kit inspector and the seated occupant wear them
  // (`kit-graft.js`), and its primary in his hands.
  const kits = { rows: null, pairs: new Map(), kit: null, soldier: null, weapon: null, version: 0, loading: null, worn: 0 };
  async function loadKitData() {
    if (kits.loading) return kits.loading;
    kits.loading = (async () => {
      const [data, matrix] = await Promise.all([
        fetch(`${root}models/kits.json`).then(r => (r.ok ? r.json() : null)).catch(() => null),
        fetch(`${posesBase}/poses-matrix.json`).then(r => (r.ok ? r.json() : null)).catch(() => null),
      ]);
      kits.rows = data?.kits ?? [];
      for (const pair of matrix?.pairs ?? []) {
        if (!pair.error) kits.pairs.set(`${pair.soldier}|${pair.weapon}`.toLowerCase(), pair);
      }
      kits.version++;
    })();
    return kits.loading;
  }
  const pairOf = (s, w) => kits.pairs.get(`${s}|${w}`.toLowerCase()) ?? null;
  const posed = (s, w) => Boolean(pairOf(s, w));
  function defaultKit() {
    for (const [nation, cls] of KIT_PICKS) {
      const kit = kits.rows.find(k => k.nation === nation && k.class === cls && pickPosedPair(k, posed));
      if (kit) return kit;
    }
    return kits.rows.find(k => pickPosedPair(k, posed)) ?? null;
  }
  async function dressWorn(kit, figure) {
    kits.worn = 0;
    for (const graft of wornGrafts(kit)) {
      const pattern = bonePattern(graft.bone);
      let bone = null;
      figure.traverse(o => { if (!bone && pattern.test(o.name)) bone = o; });
      if (!bone) continue;
      let part;
      try { part = (await loader.loadAsync(`${root}models/${graft.glb}`)).scene; } catch { continue; }
      if (current !== figure) { disposeModel(part); return; }
      part.quaternion.set(...graft.quaternion);
      part.position.set(...graft.position);
      bone.add(part);
      kits.worn++;
    }
  }
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
    await loadKitData();
    if (seq !== loadSeq) return;
    if (!kits.kit) kits.kit = defaultKit();
    const pick = kits.kit ? pickPosedPair(kits.kit, posed) : null;
    const pairs = [...kits.pairs.values()];
    const pair = pick ? pairOf(pick.soldier, pick.weapon)
      : SOLDIER_PICKS.map(([s, w]) => pairOf(s, w)).find(Boolean) || pairs[0];
    if (!pair) return;
    const [figure, clips] = await Promise.all([
      poses.pose(pair.soldier, pair.weapon),
      poseMotion.loadGaitClips(pair.gaitAssets),
    ]);
    if (!figure) return;
    if (seq !== loadSeq) { disposeModel(figure.scene); return; }
    stage(figure.scene);
    kits.worn = 0;
    current.traverse(o => { if (o.isSkinnedMesh) o.frustumCulled = false; });
    poseMotion.bindFigure(figure, clips);
    soldier.gltf = figure;
    // The weapon in his hands: the pose glb bakes its HandFireArms node with
    // the template's `fireArms` and its Muzzle, so FIRE flashes and tracers
    // leave the barrel, wherever the stance and the gait put it.
    guns.list = collectGuns(figure.scene, () => true);
    kits.soldier = pair.soldier;
    kits.weapon = pair.weapon;
    frameCamera(new THREE.Vector3(0, 0.9, 0), 4.2, 0.35, 0.18);
    if (pick && kits.kit) await dressWorn(kits.kit, figure.scene);
  }

  /** Dress the soldier in `template`'s kit (a `kits.json` row), now if he
   *  is on stage, else when he next is. */
  function setKit(template) {
    const kit = (kits.rows ?? []).find(k => k.template === template);
    if (!kit || kit === kits.kit) return false;
    kits.kit = kit;
    kits.version++;
    if (mode === 'soldier') {
      const seq = ++loadSeq;
      soldier.gltf = null;
      loadSoldier(seq).catch(error => console.warn('controls preview:', error.message));
    }
    return true;
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
    fireGuns(probe, dt);
    advanceTracers(dt);
    const view = cameraModeFrom(probe, soldier.camera, soldier.toggleWas);
    soldier.toggleWas = view.toggleWas;
    if (view.mode !== soldier.camera) { soldier.camera = view.mode; soldier.orbit = 0; }
    // The alternate fire on a rifle is the zoom: the camera comes in over
    // his shoulder while it is held (a weapon with a second gun on that
    // input fires it instead).
    soldier.zoom = probe.held('c_PIAltFire') && !guns.list.some(g => g.input === 'c_PIAltFire');
    soldierCamera(dt, lift);
  }

  /** The soldier view the camera keys picked: INSIDE close over his
   *  shoulder, CHASE REAR the three-quarter view from behind (the default),
   *  CHASE FRONT from ahead of him, FLY BY a slow circle. */
  function soldierCamera(dt, lift = 0) {
    const target = new THREE.Vector3(0, 0.9 + lift * 0.5, 0);
    const yaw = soldier.yaw;
    const behind = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
    const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
    let at;
    switch (soldier.zoom ? 'inside' : soldier.camera) {
      case 'inside':
        at = target.clone().addScaledVector(behind, 1.1).addScaledVector(right, 0.45).add(new THREE.Vector3(0, 0.75, 0));
        target.y += 0.55;
        break;
      case 'chaseFront':
        at = target.clone().addScaledVector(behind, -4.2).addScaledVector(right, -0.7).add(new THREE.Vector3(0, 1.4, 0));
        break;
      case 'flyBy':
        soldier.orbit += dt * 0.5;
        at = new THREE.Vector3(Math.sin(soldier.orbit) * 4.6, 1.9, Math.cos(soldier.orbit) * 4.6);
        break;
      default:
        at = new THREE.Vector3(target.x + 4.2 * 0.18, target.y + 4.2 * 0.35, target.z + 4.2);
    }
    // Glide, so a view change is a cut the eye can follow and the chase
    // views swing round with him rather than snapping.
    const ease = Math.min(1, dt * 6);
    camera.position.lerp(at, ease);
    camera.lookAt(target);
  }

  // --- vehicles --------------------------------------------------------------

  const rig = createModelRig({ rememberMap: () => {} });
  const vehicle = { controls: [], blur: [], throttle: 0.3, attitude: new THREE.Euler(),
                    body: null, tracers: [], heading: 0, name: null };
  // The guns on stage, the soldier's or the vehicle's: every FireArms node
  // the glb bakes with its muzzles (`collectGuns`), fired on the input its
  // own template names.
  const guns = { list: [] };
  // The machines the tabs can show (`models.json`): AIR its aircraft, LAND &
  // SEA its land vehicles, guns and ships. The choice is kept per tab.
  const catalogue = { rows: null, loading: null, version: 0, chosen: { ...MODELS } };
  async function loadCatalogue() {
    if (catalogue.loading) return catalogue.loading;
    catalogue.loading = fetch(`${root}models/models.json`).then(r => (r.ok ? r.json() : []))
      .catch(() => []).then(rows => { catalogue.rows = rows; catalogue.version++; });
    return catalogue.loading;
  }
  /** The machines a tab offers, `{ name, label, category }`: AIR every
   *  aircraft, LAND & SEA the tanks only (`tabVehicles`): a towed gun, a
   *  radar tower or a ship driven about the stage looked silly. */
  function vehicles(tab = mode) {
    return tabVehicles(catalogue.rows, tab);
  }
  /** Put `name` on the tab's stage (now, when that tab is up). */
  function setVehicle(name, tab = mode) {
    if (!MODELS[tab] || !name || catalogue.chosen[tab] === name) return false;
    catalogue.chosen[tab] = name;
    catalogue.version++;
    if (tab === mode) {
      const seq = ++loadSeq;
      vehicle.body = null;
      loadVehicle(name, seq).catch(error => console.warn('controls preview:', error.message));
    }
    return true;
  }

  /**
   * Every gun under `root` that `accept(fireArms)` takes: its input, rate,
   * what it fires, its muzzles (the template's own Muzzle nodes, else the
   * gun's node) and its muzzle-flash bundles.
   */
  function collectGuns(root, accept) {
    const found = [];
    root.traverse(o => {
      const arms = o.userData?.fireArms;
      if (!arms || !accept(arms)) return;
      const muzzles = [];
      const flashes = [];
      o.traverse(c => {
        if (c.userData?.templateKind === 'Muzzle') muzzles.push(c);
        if (c.userData?.templateKind === 'EffectBundle') flashes.push(c);
      });
      const kind = arms.projectile?.kind ?? 'bullet';
      found.push({ input: arms.input || 'c_PIFire', rate: arms.roundOfFire || 1,
                   kind, bullet: kind === 'bullet', velocity: arms.velocity ?? 0,
                   muzzles: muzzles.length ? muzzles : [o], flashes,
                   wait: 0, lit: 0, was: false });
    });
    return found;
  }

  async function loadVehicle(name, seq) {
    const gltf = await loader.loadAsync(`${root}models/${modelFileStem(name)}.glb`);
    if (seq !== loadSeq) { disposeModel(gltf.scene); return; }
    // The glb carries its collision meshes beside the visible ones.
    gltf.scene.traverse(o => {
      if (o.userData?.collision || o.userData?.collisionHull) o.visible = false;
    });
    const body = new THREE.Group();
    body.add(gltf.scene);
    stage(body);
    vehicle.body = gltf.scene;
    vehicle.name = name;
    rig.collectRig(gltf.scene);
    rig.collectScrolling(gltf.scene);
    vehicle.controls = [...new Set(rig.rigged.map(p => p.control))];
    vehicle.blur = [];
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
    });
    // The driver's guns, each on the input its own template names
    // (`fireArms.input`); a gunner's seat is another player's.
    guns.list = collectGuns(gltf.scene, arms => arms.control === name);

    vehicle.throttle = mode === 'air' ? 0.3 : 0;
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

  /** Each gun at its own rate of fire (`roundOfFire`, rounds a second, on
   *  the engine's whole 1/30 s ticks, `fire-timer.js`, so never faster than
   *  30 a second) while its input is held: the template's own muzzle-flash bundle for a
   *  frame or two per round, and a tracer down the barrel for a bullet. A
   *  cannon fires on the press and then waits out its reload. */
  function fireGuns(probe, dt) {
    let lightAt = null;
    for (const gun of guns.list) {
      const held = probe.held(gun.input);
      gun.wait -= dt;
      gun.lit -= dt;
      const pressed = held && !gun.was;
      gun.was = held;
      if (held && gun.wait <= 0 && (gun.bullet || pressed || gun.rate >= 1)) {
        gun.wait = fireCycle(gun.rate);
        gun.lit = gun.bullet ? 0.05 : 0.18;
        for (const m of gun.muzzles) spawnTracer(m, gun);
      }
      const on = gun.lit > 0;
      for (const f of gun.flashes) f.visible = on;
      if (on) lightAt = gun.muzzles[0].getWorldPosition(new THREE.Vector3());
    }
    flash.intensity = lightAt ? 6 : 0;
    if (lightAt) flash.position.copy(lightAt);
  }

  // What leaves the muzzle, drawn: a bullet's tracer, a shell (slower and
  // heavier, so a tank's round and a bazooka's read as rounds), and a bomb,
  // which has no muzzle speed and simply falls off its rack.
  const tracerGeo = new THREE.CylinderGeometry(0.03, 0.03, 1.6, 4).rotateX(Math.PI / 2);
  const shellGeo = new THREE.CylinderGeometry(0.07, 0.07, 0.9, 6).rotateX(Math.PI / 2);
  const bombGeo = new THREE.CylinderGeometry(0.12, 0.12, 0.8, 6).rotateX(Math.PI / 2);
  const tracerMat = new THREE.MeshBasicMaterial({ color: 0xffd080 });
  const shellMat = new THREE.MeshBasicMaterial({ color: 0xffa040 });
  const bombMat = new THREE.MeshBasicMaterial({ color: 0x4a4a40 });
  function spawnTracer(muzzle, gun = { kind: 'bullet', velocity: 0 }) {
    const bomb = !(gun.velocity > 0) && gun.kind !== 'bullet';
    const mesh = new THREE.Mesh(bomb ? bombGeo : gun.bullet ? tracerGeo : shellGeo,
                                bomb ? bombMat : gun.bullet ? tracerMat : shellMat);
    muzzle.getWorldPosition(mesh.position);
    const dir = new THREE.Vector3(0, 0, -1)
      .applyQuaternion(muzzle.getWorldQuaternion(new THREE.Quaternion()));
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), dir);
    scene.add(mesh);
    // Scaled for a stage a few metres deep: a bullet crosses it in a third of
    // a second, a shell in about one, a bomb drops out of the frame.
    const speed = bomb ? 0 : gun.bullet ? 90 : 40;
    vehicle.tracers.push({ mesh, vel: dir.multiplyScalar(speed), g: bomb ? 9.8 : gun.bullet ? 0 : 2,
                           life: bomb ? 2.5 : gun.bullet ? 0.35 : 1.0 });
  }
  function advanceTracers(dt) {
    vehicle.tracers = vehicle.tracers.filter(t => {
      t.life -= dt;
      t.vel.y -= t.g * dt;
      t.mesh.position.addScaledVector(t.vel, dt);
      if (t.vel.lengthSq() > 1e-6) t.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), t.vel.clone().normalize());
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
    guns.list = [];
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
    guns.list = [];
    const job = mode === 'soldier' ? loadSoldier(seq) : loadVehicle(catalogue.chosen[mode], seq);
    job.catch(error => console.warn('controls preview:', error.message));
    loadCatalogue();
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
    setKit,
    loadKitData,
    setVehicle,
    vehicles,
    loadCatalogue,
    /** Bumped when the catalogue arrives or a tab's machine changes. */
    get vehiclesVersion() { return catalogue.version; },
    /** The machine a tab shows (its name), `vehicle` for the one on stage. */
    chosenVehicle: (tab = mode) => catalogue.chosen[tab] ?? null,
    /** The factions and their kits, once `kits.json` has loaded (empty before). */
    factions: () => kitFactions(kits.rows ?? []),
    /** Bumped when the kits arrive or the kit changes: the host's cue to redraw its selects. */
    get kitsVersion() { return kits.version; },
    get kit() { return kits.kit; },
    /** For headless checks: what is on stage. */
    get scene() { return scene; },
    get state() {
      return {
        mode,
        loaded: Boolean(mode === 'soldier' ? soldier.gltf : vehicle.body),
        stance: poseMotion.stance,
        motion: poseMotion.motion,
        kit: kits.kit?.template ?? null,
        camera: soldier.camera,
        zoom: soldier.zoom,
        soldier: kits.soldier,
        weapon: kits.weapon,
        worn: kits.worn,
        throttle: vehicle.throttle,
        rigged: rig.rigged.length,
        inputs: Object.fromEntries(rig.inputValues),
        firing: flash.intensity > 0 || vehicle.tracers.length > 0,
        guns: guns.list.map(g => `${g.input}:${g.kind}`),
        tracers: vehicle.tracers.length,
        vehicle: mode === 'soldier' ? null : vehicle.name,
      };
    },
  };
}
