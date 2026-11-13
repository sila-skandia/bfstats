// What a soldier sees down his anti-tank weapon, zoomed, for the tank
// school's ON FOOT panel (features/battle-schools, tank-matchup.md "On foot,
// through the sight"): the tank at its distance through the weapon's own
// zoomed field of view, the first-person rig hung where the engine hangs it,
// and the HUD's scope picture over it all where the weapon has one. The page
// lays the crosshair and where the round lands over the canvas.
//
// The two passes are the game's (`hand-weapon.js` frame(), `hand-fire.js`):
//
//   world   the camera looks down the tube, pitched up by the aim, at the
//           weapon's `zoomFov` (radians, vertical: 0.8 is 45.8 degrees);
//           the round leaves along it (`fireInCameraDof`), so the centre of
//           the frame is where the tube points.
//   arms    the rig (`<Soldier>__<Weapon>.fp.glb`) on cleared depth, at its
//           zoom pose (`center1pHands` + `soldierZoomPosition`, z negated
//           into three's frame, half a turn about y), through `set1pFov x
//           soldierZoomFov`, its standing `idle` clip.
//
// The frame is 4:3, the HUD's 800x600 space, which the scope picture fills
// edge to edge (SCOPE-4).

import * as THREE from 'three';

// Remaster mode (features/remaster-browser) runs on three's WebGPU build,
// which has no WebGLRenderer: a side view then takes a WebGPU renderer from
// the remaster's hooks. Without the remaster this is the WebGLRenderer it was.
const remasterSideRenderer = options => globalThis.bfRemasterHooks?.sideRenderer?.(options)
  ?? new THREE.WebGLRenderer(options);


const DEG = 180 / Math.PI;
/** The tube above the ground: the camera's height over the floor. */
export const EYE = 1.5;

/** The rig a soldier holds `weapon` with, from a tree's `viewmodels/index.json`
 *  (the `{ rigs, pairs }` object, or the bare list of an older tree): the
 *  soldier's own pair, its shared rig, else any rig of that weapon. */
export function rigStemFor(index, soldier, weapon) {
  if (!index || !weapon) return null;
  const rigs = Array.isArray(index) ? index : (index.rigs ?? []);
  const pairs = Array.isArray(index) ? {} : (index.pairs ?? {});
  const lower = s => String(s).toLowerCase();
  const pair = soldier ? `${soldier}__${weapon}` : null;
  if (pair) {
    const shared = Object.entries(pairs).find(([k]) => lower(k) === lower(pair))?.[1]?.rig;
    if (shared) return shared;
    const own = rigs.find(r => lower(r) === lower(pair));
    if (own) return own;
  }
  return rigs.find(r => lower(r).endsWith(`__${lower(weapon)}`)) ?? null;
}

/** Where the rig hangs in camera space at its zoom pose (`arms-rig.js` mountRig). */
export function zoomPose(view) {
  const hands = view?.center1pHands ?? [0, 0, 0];
  const at = view?.soldierZoomPosition ?? view?.soldierCameraPosition ?? [0, 0, 0];
  return { x: hands[0] + at[0], y: hands[1] + at[1], z: -hands[2] - at[2] };
}

export function createSightView(canvas) {
  const renderer = remasterSideRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(2, globalThis.devicePixelRatio || 1));
  renderer.autoClear = false;

  const world = new THREE.Scene();
  world.background = new THREE.Color(0xa9b6bb);
  world.fog = new THREE.Fog(0xa9b6bb, 250, 1400);
  world.add(new THREE.HemisphereLight(0xf2f0e6, 0x4a4636, 2.4));
  const sun = new THREE.DirectionalLight(0xffffff, 2.2);
  sun.position.set(30, 80, 40);
  world.add(sun);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(6000, 6000), new THREE.MeshLambertMaterial({ color: 0x7a735a }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -EYE;
  world.add(ground);
  const camera = new THREE.PerspectiveCamera(45, 4 / 3, 0.1, 6000);

  const near = new THREE.Scene();
  near.add(new THREE.HemisphereLight(0xf2f0e6, 0x3a3a32, 2.6));
  const nearSun = new THREE.DirectionalLight(0xffffff, 1.8);
  nearSun.position.set(2, 4, 3);
  near.add(nearSun);
  const nearCamera = new THREE.PerspectiveCamera(27, 4 / 3, 0.01, 20);

  let tank = null, tankKey = null, rig = null, rigKey = null;

  /** The target's model, its nose towards the soldier, its front `R` m off. */
  function setTank(key, source, lengthM) {
    if (key !== tankKey) {
      if (tank) world.remove(tank);
      tank = source ? source.clone(true) : null;
      tankKey = key;
      if (tank) {
        tank.traverse(o => { if (o.isMesh && o.geometry?.userData?.collision) o.visible = false; });
        tank.userData.lengthM = lengthM;
        world.add(tank);
      }
    }
  }

  /** The rig, posed once: its `idle` clip a moment in, at the zoom pose. */
  function setRig(key, gltf, view) {
    if (key === rigKey) return;
    if (rig) near.remove(rig);
    rig = null;
    rigKey = key;
    if (!gltf) return;
    const scene = gltf.scene;
    scene.traverse(o => {
      const d = o.userData ?? {};
      if (d.effect || d.tracerMesh || d.projectileMesh || d.projectileTrail) o.visible = false;
      if (o.isMesh) o.frustumCulled = false;
    });
    const clip = gltf.animations?.find(a => a.name === 'idle') ?? gltf.animations?.[0];
    if (clip) {
      const mixer = new THREE.AnimationMixer(scene);
      mixer.clipAction(clip).play();
      mixer.setTime(Math.min(0.1, clip.duration / 2));
    }
    scene.rotation.y = Math.PI;
    const p = zoomPose(view);
    rig = new THREE.Group();
    rig.position.set(p.x, p.y, p.z);
    rig.add(scene);
    near.add(rig);
  }

  /** Draw: `R` m to the tank's front, the tube `elevation` degrees up, the
   *  world through `worldFov` and the arms through `armsFov` (degrees). */
  function draw({ R, elevation, worldFov, armsFov, width, height }) {
    renderer.setSize(width, height, false);
    if (tank) {
      tank.position.set(0, -EYE, -(R + (tank.userData.lengthM ?? 6) / 2));
      tank.rotation.set(0, Math.PI, 0);
    }
    camera.fov = worldFov;
    camera.aspect = width / height;
    camera.rotation.set((elevation ?? 0) / DEG, 0, 0);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);
    renderer.clear();
    renderer.render(world, camera);
    if (rig) {
      nearCamera.fov = armsFov;
      nearCamera.aspect = width / height;
      nearCamera.updateProjectionMatrix();
      renderer.clearDepth();
      renderer.render(near, nearCamera);
    }
    // Where a point of the world lands on the frame, in CSS pixels.
    const toScreen = v => {
      const n = v.clone().project(camera);
      return { x: (n.x + 1) / 2 * width, y: (1 - n.y) / 2 * height, behind: n.z > 1 };
    };
    return { toScreen, pxPerRad: (height / 2) / Math.tan(worldFov / DEG / 2) };
  }

  return { setTank, setRig, draw, renderer };
}
