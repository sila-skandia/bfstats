// Drives a gun's muzzle through `gunfire.js` and `effects.js` under node and
// prints one JSON blob: which particles one shot spawns, how big the flash is,
// where the casing goes, and whether the flash rides with the gun.
//
// The shapes are the Browning's (Objects/Stationary_Weapons/Browning): the
// FireArms carries `addTemplate e_MuzzHeavy` at 0/0.1/0.8 and `addTemplate
// e_shell1250mm` at 0/0.12/0.16, and the bake hangs a node named for each
// bundle there with the emitters baked under it. The library holds the same
// bundles with their authored specs (features/muzzle-effects-parity).

import * as THREE from 'three';
import { GunFire } from './gunfire.js';
import { EffectLibrary, EffectPlayer } from './effects.js';

function lcg(seed = 1) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

const n = v => ['n', v, 0, 0];
const quad = () => new THREE.Mesh(new THREE.PlaneGeometry(1, 1),
                                  new THREE.MeshBasicMaterial());
// `MuzzHeavy_m1`: 0.63 m across, 1.76 m down the barrel.
const flashMesh = () => new THREE.Mesh(new THREE.BoxGeometry(0.63, 0.63, 1.76),
                                       new THREE.MeshBasicMaterial());
const casingMesh = () => new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.018, 0.085),
                                        new THREE.MeshBasicMaterial());

const SPECS = {
  em_MuzzHeavy: {
    template: 'em_MuzzHeavy', timeToLive: n(0.1), intensity: n(10),
    startRotation: ['u', 0, 180, 1], addChild: true, view: 'third', lodDistance: 500,
    particle: { kind: 'mesh', template: 'fx_MuzzHeavy', geometry: 'MuzzHeavy_m1',
                timeToLive: n(0.07), gravityModifier: n(0),
                sizeOverTime: [[0, 0.12009], [100, 9.40001]] },
  },
  em_1P_MuzzHeavy: {
    template: 'em_1P_MuzzHeavy', timeToLive: n(0.1), intensity: n(10), view: 'first',
    particle: { kind: 'sprite', template: 'FX_1P_MuzzHeavy', texture: 'e_MuzzAssult_o',
                blend: 'add', srcBlendMode: 5, destBlendMode: 2,
                timeToLive: ['n', 0.05, 0.05, 0], size: n(0.4) },
  },
  em_MuzzHeavy_glow: {
    template: 'em_MuzzHeavy_glow', timeToLive: n(0.1), view: 'third',
    addEmitterSpeed: true, emitterSpeedScale: 1, relativePosition: { dof: n(0.2) },
    particle: { kind: 'sprite', template: 'fx_MuzzHeavy_glow', texture: 'e_fire4',
                blend: 'add', srcBlendMode: 5, destBlendMode: 2,
                timeToLive: ['n', 0.07, 0.07, 0], size: n(0.43), gravityModifier: n(0) },
  },
  Em_shell1250mm: {
    template: 'Em_shell1250mm', timeToLive: n(0.1), intensity: n(10), view: 'third',
    addEmitterSpeed: true, emitterSpeedScale: 1, lodDistance: 45,
    startRotation: n(150),
    positionalSpeed: { dof: ['u', 0, 0.5, 1], up: ['u', 0, 0.4, 1], right: ['u', 0.9, 1.1, 0] },
    particle: { kind: 'mesh', template: 'Fx_shell1250mm', geometry: 'shell1250mmHI_m1',
                timeToLive: n(1), size: n(1.7), gravityModifier: n(0.5) },
  },
};
const BUNDLES = {
  e_MuzzHeavy: ['em_MuzzHeavy', 'em_1P_MuzzHeavy', 'em_MuzzHeavy_glow'],
  e_shell1250mm: ['Em_shell1250mm'],
};
const drawn = name => (SPECS[name].particle.kind === 'mesh'
  ? (name === 'Em_shell1250mm' ? casingMesh() : flashMesh()) : quad());

function library() {
  const root = new THREE.Group();
  for (const [bundle, emitters] of Object.entries(BUNDLES)) {
    const b = new THREE.Group();
    b.name = bundle;
    b.userData.effectBundle = { name: bundle };
    for (const name of emitters) {
      const node = drawn(name);
      node.name = name;
      node.userData.effectEmitter = structuredClone(SPECS[name]);
      b.add(node);
    }
    root.add(b);
  }
  return new EffectLibrary(root);
}

/** The Browning as the bake leaves it: bundle nodes carrying baked emitters. */
function browning() {
  const gun = new THREE.Group();
  gun.name = 'Browning';
  gun.userData.fireArms = { roundOfFire: 10, velocity: 1000, muzzles: 1 };
  const muzzle = new THREE.Object3D();
  muzzle.userData.muzzle = { index: 0 };
  muzzle.position.set(0, 0, -1);
  gun.add(muzzle);
  const place = { e_MuzzHeavy: [0, 0.1, -0.8], e_shell1250mm: [0, 0.12, -0.16] };
  for (const [bundle, emitters] of Object.entries(BUNDLES)) {
    const node = new THREE.Group();
    // GLTFLoader's own spelling: a repeat gets a suffix, the authored name
    // stays in userData.
    node.name = `${bundle}_3`;
    node.userData.name = bundle;
    node.userData.effect = { kind: 'bundle' };
    node.position.set(...place[bundle]);
    for (const name of emitters) {
      const baked = drawn(name);
      baked.name = name;
      const p = SPECS[name].particle;
      baked.userData.effect = {
        kind: p.kind, timeToLive: 0.07,
        ...(p.sizeOverTime ? { sizeOverTime: p.sizeOverTime } : {}),
        ...(p.size ? { size: p.size[1] } : {}),
        ...(SPECS[name].view ? { view: SPECS[name].view } : {}),
      };
      node.add(baked);
    }
    gun.add(node);
  }
  return gun;
}

const out = {};

function rig({ withLibrary = true, inScene = true } = {}) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(0, 1, 5);
  scene.add(camera);
  const guns = new GunFire({ scene, camera, viewportHeight: () => 900 });
  guns.rand = lcg(11);
  const player = new EffectPlayer({ scene, camera, library: withLibrary ? library() : null });
  player.rand = lcg(12);
  guns.effects = player;
  const gun = browning();
  let near = null;
  if (inScene === true) scene.add(gun);
  else if (inScene === 'near') {
    // A viewmodel's own scene, drawn by a pass that sees only layer 1.
    near = new THREE.Scene();
    gun.traverse(node => node.layers.set(1));
    near.add(gun);
  }
  gun.updateMatrixWorld(true);
  const [group] = guns.collect(gun, { replace: true });
  return { scene, near, camera, guns, player, gun, group };
}

function bakedLit(group) {
  return group.emitters.filter(e => e.node.visible).map(e => e.node.name).sort();
}

// --- third person: the library plays, the baked emitters stay dark --------
{
  const { guns, player, gun, group } = rig();
  out.bundles = group.bundles.map(b => b.name).sort();
  guns.flash(group);
  player.advance(0);
  out.third = {
    runs: player.runs.length,
    particles: player.particles.map(p => p.emitter.template.spec.template).sort(),
    bakedLit: bakedLit(group),
  };
  // Half the flash's 0.07 s life: IMP-5 says authored size, not the ramp.
  player.advance(0.035);
  const flash = player.particles.find(p => p.emitter.template.spec.template === 'em_MuzzHeavy');
  const glow = player.particles.find(p => p.emitter.template.spec.template === 'em_MuzzHeavy_glow');
  out.third.flashScale = flash ? flash.mesh.scale.toArray() : null;
  out.third.glowScale = glow ? glow.mesh.scale.toArray() : null;
  // The flash rides the gun (`addChild 1`): move the gun a metre sideways.
  const before = flash ? [...flash.position] : null;
  gun.position.x += 1;
  gun.updateMatrixWorld(true);
  player.advance(0.01);
  out.third.flashMoved = flash && before ? flash.position[0] - before[0] : null;
  // The casing (no `addChild`) is left in the world and falls.
  const casing = player.particles.find(p => p.emitter.template.spec.template === 'Em_shell1250mm');
  const c0 = casing ? [...casing.position] : null;
  const v0 = casing ? casing.velocity[1] : null;
  for (let i = 0; i < 20; i++) player.advance(1 / 60);
  out.third.casing = casing ? {
    dx: casing.position[0] - c0[0] - 1,   // less the gun's own metre, which it did not ride
    dy: casing.position[1] - c0[1],
    dvy: casing.velocity[1] - v0,
    scale: casing.mesh.scale.toArray(),
    speed: Math.hypot(...casing.velocity),
  } : null;
  for (let i = 0; i < 60; i++) player.advance(1 / 60);
  out.third.afterASecond = player.particles.length;
  // A burst: 10 rounds a second for a second, no leak.
  for (let i = 0; i < 10; i++) { guns.flash(group); for (let k = 0; k < 6; k++) player.advance(1 / 60); }
  out.third.burstLive = player.particles.length;
  for (let i = 0; i < 120; i++) player.advance(1 / 60);
  out.third.burstAfter = player.particles.length;
  out.third.pooled = [...player.meshPool.values()].reduce((a, p) => a + p.length, 0)
    + [...player.spritePool.values()].reduce((a, p) => a + p.length, 0);
  // Steady state: a second burst reuses the runs and records the first one
  // left in the pools, and grows neither.
  const pools = () => [player.runPool.length, player.recordPool.length, out.third.pooled];
  const first = pools();
  for (let i = 0; i < 10; i++) { guns.flash(group); for (let k = 0; k < 6; k++) player.advance(1 / 60); }
  for (let i = 0; i < 120; i++) player.advance(1 / 60);
  out.third.poolsAfterFirst = first;
  out.third.poolsAfterSecond = [player.runPool.length, player.recordPool.length,
    [...player.meshPool.values()].reduce((a, p) => a + p.length, 0)
    + [...player.spritePool.values()].reduce((a, p) => a + p.length, 0)];
}

// --- first person: the seat's own sprite only -----------------------------
{
  const { guns, player, group } = rig();
  guns.firstPerson = true;
  guns.flash(group);
  player.advance(0);
  out.first = { particles: player.particles.map(p => p.emitter.template.spec.template).sort() };
}

// --- no library: the baked fallback, with IMP-5's size rule ----------------
{
  const { guns, group } = rig({ withLibrary: false });
  guns.flash(group);
  guns.advance(0.035);
  const flash = group.emitters.find(e => e.node.name === 'em_MuzzHeavy');
  const glow = group.emitters.find(e => e.node.name === 'em_MuzzHeavy_glow');
  out.fallback = {
    bakedLit: bakedLit(group),
    flashScale: flash.node.scale.x,
    glowScale: glow.node.scale.x,
  };
}

// --- a viewmodel's scene: its own particles, in its own world -------------
//
// The first-person weapon hangs in a scene of its own (`arms-rig.js`). Its
// bundles are played like any other gun's. A mesh particle is drawn in that
// scene, on the rig's layer (the game hands it the weapon's own field of
// view, EMT-12): the casing leaves the eject port and falls. A sprite is
// drawn with the world.
{
  const { scene, near, guns, player, gun, group } = rig({ inScene: 'near' });
  guns.flash(group);
  player.advance(0);
  const top = node => { let n = node; while (n.parent) n = n.parent; return n; };
  const casing = player.particles.find(p => p.emitter.template.spec.template === 'Em_shell1250mm');
  const port = new THREE.Vector3();
  gun.children.find(c => c.userData.name === 'e_shell1250mm').getWorldPosition(port);
  const c0 = [...casing.position];
  const born = player.particles.map(p => p.emitter.template.spec.template).sort();
  const meshes = player.particles.filter(p => p.kind === 'mesh');
  const sprites = player.particles.filter(p => p.kind === 'sprite');
  const inNear = meshes.length > 0 && meshes.every(p => top(p.mesh) === near);
  const inWorld = sprites.length > 0 && sprites.every(p => top(p.mesh) === scene);
  const masks = [...new Set(meshes.map(p => p.mesh.layers.mask))];
  const spriteMasks = [...new Set(sprites.map(p => p.mesh.layers.mask))];
  const lit = bakedLit(group);
  const path = [];
  for (let i = 0; i < 30; i++) {
    player.advance(1 / 60);
    path.push(Math.hypot(casing.position[0] - c0[0], casing.position[1] - c0[1],
                         casing.position[2] - c0[2]));
  }
  out.viewmodel = {
    particles: born,
    bakedLit: lit,
    meshesInNearScene: inNear,
    spritesInWorldScene: inWorld,
    layerMasks: masks,
    spriteMasks,
    bornAtPort: Math.hypot(c0[0] - port.x, c0[1] - port.y, c0[2] - port.z),
    travelled: path[path.length - 1],
    moving: path.every((d, i) => i === 0 || d > path[i - 1]),
    fallSpeed: casing.velocity[1],
  };
  // The world's own guns keep their own pools: a mesh parked on the near
  // pass's layer is never handed to a world particle.
  const world = browning();
  scene.add(world);
  world.updateMatrixWorld(true);
  const [other] = guns.collect(world, { replace: false });
  guns.flash(other);
  player.advance(0);
  const mine = player.particles.filter(p => top(p.mesh) === scene);
  out.viewmodel.worldParticles = mine.length;
  out.viewmodel.worldMasks = [...new Set(mine.map(p => p.mesh.layers.mask))];
  for (let i = 0; i < 120; i++) player.advance(1 / 60);
  out.viewmodel.afterTwoSeconds = player.particles.length;
  // The pass that draws the rig hangs it off the camera as the camera stands
  // at the draw, and the page moves the camera after `advance` (the weapon's
  // shake, on the drawn view alone). The near particles ride that move with
  // the rig; the world's do not.
  const drawn = rig({ inScene: 'near' });
  const far = browning();
  drawn.scene.add(far);
  far.updateMatrixWorld(true);
  const [farGroup] = drawn.guns.collect(far, { replace: false });
  drawn.guns.flash(drawn.group);
  drawn.guns.flash(farGroup);
  drawn.player.advance(0);
  const at = p => new THREE.Vector3().setFromMatrixPosition(p.mesh.matrixWorld);
  const nearCasing = drawn.player.particles.find(p => p.kind === 'mesh' && top(p.mesh) === drawn.near
    && p.emitter.template.spec.template === 'Em_shell1250mm');
  const farCasing = drawn.player.particles.find(p => p.kind === 'mesh' && top(p.mesh) === drawn.scene
    && p.emitter.template.spec.template === 'Em_shell1250mm');
  drawn.near.updateMatrixWorld(true); drawn.scene.updateMatrixWorld(true);
  const n0 = at(nearCasing), f0 = at(farCasing);
  drawn.camera.position.y += 0.25;   // the shake, after the simulation
  drawn.near.updateMatrixWorld(true); drawn.scene.updateMatrixWorld(true);
  out.viewmodel.shake = { near: at(nearCasing).y - n0.y, world: at(farCasing).y - f0.y,
                          placedInWorld: Math.abs(n0.y - nearCasing.position[1]) };
  drawn.player.advance(1 / 60);       // the next frame's simulation sees the camera where it is
  drawn.near.updateMatrixWorld(true);
  out.viewmodel.shake.settled = Math.abs(at(nearCasing).y - nearCasing.position[1]);
}

// --- a gun in no scene at all: the baked emitters, as before ---------------
{
  const { guns, player, group } = rig({ inScene: false });
  guns.flash(group);
  player.advance(0);
  out.detached = { particles: player.particles.length, bakedLit: bakedLit(group) };
}

// --- the bundle's own script: one trigger a round, on the bundle's clock ---
//
// The gun sends each child bundle message 0 once a round and the bundle
// triggers its script (ledger SND-34). The page's sound half is asked once a
// round a sounding bundle, where the bundle stands, with the bundle's own
// record as the owner of the clock, and whether or not the library holds the
// picture.
{
  const heard = rigged => {
    const calls = [];
    rigged.player.onSound = (name, position, options) => calls.push({
      name, position: [...position], options, record: position });
    rigged.player.hasSound = name => name === 'e_shell1250mm';
    return calls;
  };
  const third = rig();
  const calls = heard(third);
  third.gun.position.set(10, 2, -4);
  third.gun.updateMatrixWorld(true);
  for (let i = 0; i < 5; i++) { third.guns.flash(third.group); for (let k = 0; k < 6; k++) third.player.advance(1 / 60); }
  const bare = rig({ withLibrary: false });
  const bareCalls = heard(bare);
  bare.guns.flash(bare.group);
  const near = rig({ inScene: 'near' });
  const nearCalls = heard(near);
  near.guns.flash(near.group);
  out.sound = {
    names: [...new Set(calls.map(c => c.name))],
    calls: calls.length,
    at: calls[0]?.position ?? null,
    oneOwner: calls.every(c => c.options.owner && c.options.owner === calls[0].options.owner),
    ownerIsTheBundle: calls[0]?.options.owner === third.group.bundles.find(b => b.name === 'e_shell1250mm'),
    reused: calls.every(c => c.options === calls[0].options && c.record === calls[0].record),
    withoutLibrary: bareCalls.length,
    viewmodel: nearCalls.length,
  };
}

console.log(JSON.stringify(out));
