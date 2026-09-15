// Playing the game's own EffectBundles in three.js.
//
// `extract_effects.py` bakes every impact, trail and explosion bundle into
// `_shared/effects.glb` as hidden template subtrees; `effects-core.js` holds
// the engine's arithmetic. This module is the glue: it stands a bundle up on
// a surface normal (or hangs it off a flying rocket), runs each emitter's
// clock, and turns the numbers into pooled sprites and mesh particles. The
// bullet hole you see after a Thompson round is `Fx_RichoStoneDecal`, a
// 0.2 m quad off `Decal_Stone_m1.sm`, placed 1 mm off the wall on the
// surface normal, alive 1-15 s and fading over its last 30% — every one of
// those numbers authored, none of them ours.

import * as THREE from 'three';
import {
  basisFromNormal, EmitterClock, spawnParticle, integrateParticle,
  evalParticle, GRAVITY,
} from './effects-core.js';

// Lids. The engine keeps 127 decals per emitter ring (`DecalEmitter::addDecal`,
// lnxded 0x081e02f0); the particle cap is ours.
export const MAX_PARTICLES = 1200;
export const MAX_DECALS = 128;
const DEG = Math.PI / 180;

const _pos = new THREE.Vector3();
const _vel = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _spin = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _x = new THREE.Vector3();
const _y = new THREE.Vector3();
const _z = new THREE.Vector3();
const _axis = new THREE.Vector3();
const _camPos = new THREE.Vector3();

/** Quaternion whose local X/Y/-Z are the frame's right/up/dof. */
function frameQuaternion(basis, out) {
  _x.set(basis.right[0], basis.right[1], basis.right[2]);
  _y.set(basis.up[0], basis.up[1], basis.up[2]);
  _z.set(-basis.dof[0], -basis.dof[1], -basis.dof[2]);
  _m.makeBasis(_x, _y, _z);
  return out.setFromRotationMatrix(_m);
}

/** The frame a quaternion describes, as plain arrays for effects-core. */
function quaternionFrame(q) {
  _m.makeRotationFromQuaternion(q);
  const e = _m.elements;
  return {
    right: [e[0], e[1], e[2]],
    up: [e[4], e[5], e[6]],
    dof: [-e[8], -e[9], -e[10]],
  };
}

/**
 * The baked bundle templates, indexed by name.
 *
 * Each bundle root's subtree is walked once: every node carrying
 * `effectEmitter` is recorded with its transform relative to the root, so a
 * play needs only the root frame. Sprite materials are shared across the
 * library by the exporter and cloned per particle here.
 */
export class EffectLibrary {
  constructor(root) {
    this.root = root;
    this.bundles = new Map();
    root.updateWorldMatrix(true, true);
    for (const bundle of root.children) {
      const info = bundle.userData?.effectBundle;
      if (!info) continue;
      const emitters = [];
      const inverse = bundle.matrixWorld.clone().invert();
      bundle.traverse(node => {
        const spec = node.userData?.effectEmitter;
        if (!spec) return;
        const local = inverse.clone().multiply(node.matrixWorld);
        const position = new THREE.Vector3();
        const quaternion = new THREE.Quaternion();
        const scale = new THREE.Vector3();
        local.decompose(position, quaternion, scale);
        emitters.push({ spec, position, quaternion, node });
      });
      this.bundles.set(info.name.toLowerCase(), { name: info.name, node: bundle, emitters });
    }
    root.visible = false;
  }

  static async load(url, loader) {
    const gltf = await loader.loadAsync(url);
    return new EffectLibrary(gltf.scene);
  }

  has(name) { return !!name && this.bundles.has(name.toLowerCase()); }
  get(name) { return name ? this.bundles.get(name.toLowerCase()) : undefined; }
  get names() { return [...this.bundles.values()].map(b => b.name); }
}

/**
 * Live bundles and their particles.
 *
 * `scene` is the world the particles live in. They are parented to one
 * group under it, `root`, and a pooled particle stays there hidden between
 * lives: `scene.add` and `scene.remove` per particle (an `indexOf`, a
 * `splice` and two events each, 20-30 times a frame under a Thompson) was
 * the churn, and the group's matrix walk skips what is hidden so the pool
 * costs nothing while parked (features/mesh-viewer-performance, rule 4).
 * `camera` is what sprites face and what the emitters' `lodDistance` is
 * measured from.
 */
export class EffectPlayer {
  constructor({ scene, camera, library = null, gravity = GRAVITY,
                onMaterial = null, onMesh = null, firstPerson = false } = {}) {
    this.scene = scene;
    this.camera = camera;
    this.root = new THREE.Group();
    this.root.name = 'effects';
    // The group never moves, so it never forces its children, and only the
    // live particles are composed each frame — a hidden pooled mesh is not
    // even visited. (three r169 walks and recomposes every child otherwise;
    // map.html's freezeStatics has the arithmetic.)
    this.root.matrixAutoUpdate = false;
    this.root.updateMatrixWorld = function (force) {
      for (const child of this.children) {
        if (child.visible) child.updateMatrixWorld(force);
      }
    };
    scene.add(this.root);
    this.library = library;
    this.gravity = gravity;
    this.onMaterial = onMaterial;
    // Called once per newly built mesh particle (decals, stone chips, debris)
    // before its materials are indexed, so the page can rebuild them under
    // its own lighting — the map page binds the engine's MODULATE2X combine
    // there, which is how a `lighting true` decal is lit in the game.
    this.onMesh = onMesh;
    this.firstPerson = firstPerson;
    this.runs = [];
    this.particles = [];
    this.decals = [];
    this.spritePool = new Map();   // material uuid -> Mesh[]
    this.meshPool = new Map();     // template node uuid -> Mesh[]
    this.plays = 0;
    this.spawned = 0;
    this.dropped = 0;
    this.rand = Math.random;
  }

  has(name) { return !!this.library?.has(name); }

  /**
   * Start a bundle.
   *
   * `position`/`normal` stand it up on a surface the way the engine's
   * `playCollisionEffect` does. `attach` instead hangs it off an object —
   * `{ object, velocity }` — and the run follows that object's transform each
   * frame, its emitters inheriting `velocity()` when they `addEmitterSpeed`.
   * Returns a handle with `stop()`; a stopped run spawns nothing more and
   * ends when its particles have.
   */
  play(name, { position = null, normal = null, attach = null, speed = 0 } = {}) {
    const bundle = this.library?.get(name);
    if (!bundle) return null;
    const run = {
      name: bundle.name,
      origin: new THREE.Vector3(),
      quaternion: new THREE.Quaternion(),
      attach,
      speed,
      emitters: [],
      alive: true,
      stopped: false,
      age: 0,
    };
    if (attach?.object) {
      attach.object.updateWorldMatrix(true, false);
      attach.object.getWorldPosition(run.origin);
      attach.object.getWorldQuaternion(run.quaternion);
    } else {
      if (!position) return null;
      run.origin.set(position[0], position[1], position[2]);
      const basis = basisFromNormal(normal || [0, 1, 0]) || basisFromNormal([0, 1, 0]);
      frameQuaternion(basis, run.quaternion);
    }
    const distance = this.camera ? this.camera.getWorldPosition(_camPos).distanceTo(run.origin) : 0;
    const view = this.firstPerson ? 'first' : 'third';
    for (const emitter of bundle.emitters) {
      const spec = emitter.spec;
      if (spec.view && spec.view !== view) continue;
      if (spec.lodDistance && distance > spec.lodDistance) continue;
      if (spec.startProbability != null && this.rand() > spec.startProbability) continue;
      run.emitters.push({
        template: emitter,
        spec,
        clock: new EmitterClock(spec, this.rand),
      });
    }
    if (!run.emitters.length) return null;
    this.runs.push(run);
    this.plays++;
    return {
      run,
      stop: () => { run.stopped = true; for (const e of run.emitters) e.clock.stopped = true; },
    };
  }

  /** Put every run and particle away. Call on a level change. */
  clear() {
    for (const p of this.particles) this.#recycle(p);
    this.particles.length = 0;
    this.decals.length = 0;
    this.runs.length = 0;
  }

  /**
   * Drop every pooled mesh, materials and all. For a level change: the map
   * page rebuilds a mesh particle's materials under each level's lighting
   * (`onMesh`), so a pool warmed for one level would light the next level's
   * decals with the wrong sun. Geometries and textures are the library's
   * and stay.
   */
  flush() {
    this.clear();
    for (const pool of [...this.spritePool.values(), ...this.meshPool.values()]) {
      for (const mesh of pool) {
        this.root.remove(mesh);
        for (const m of mesh.userData.materials ?? [mesh.material]) m.dispose();
      }
    }
    this.spritePool.clear();
    this.meshPool.clear();
  }

  /**
   * One pooled mesh for every emitter of every bundle in the library, built
   * and parked, so every material a burst can need exists before the first
   * shot. The page then compiles and uploads them while the level is still
   * loading (`renderer.compileAsync`, `renderer.initTexture`): a program
   * linked in the middle of a burst is a stall of unknown length — three's
   * first-use shader check blocks the frame on the link, and on an Iris Xe
   * under system GL the perf harness watched one block for 8 s and take the
   * WebGL context with it (features/mesh-viewer-performance, rule 6).
   * Returns the materials, for the page to upload their maps.
   */
  warm() {
    const materials = new Set();
    if (!this.library) return materials;
    for (const bundle of this.library.bundles.values()) {
      for (const template of bundle.emitters) {
        const spec = template.spec;
        const mesh = this.#acquire({ template, spec }, { kind: spec.kind, spec });
        if (!mesh) continue;
        mesh.visible = false;
        const pool = spec.kind === 'sprite' ? this.spritePool : this.meshPool;
        pool.get(mesh.userData.poolKey)?.push(mesh);
        for (const m of mesh.userData.materials ?? [mesh.material]) materials.add(m);
      }
    }
    return materials;
  }

  stats() {
    return {
      runs: this.runs.length,
      particles: this.particles.length,
      decals: this.decals.length,
      plays: this.plays,
      spawned: this.spawned,
      dropped: this.dropped,
      bundles: this.library?.bundles.size ?? 0,
    };
  }

  advance(dt) {
    let active = false;
    for (let i = this.runs.length - 1; i >= 0; i--) {
      const run = this.runs[i];
      run.age += dt;
      let velocity = null;
      if (run.attach?.object) {
        const obj = run.attach.object;
        obj.updateWorldMatrix(true, false);
        obj.getWorldPosition(run.origin);
        obj.getWorldQuaternion(run.quaternion);
        const v = run.attach.velocity?.();
        if (v) velocity = [v.x, v.y, v.z];
        run.speed = velocity ? Math.hypot(...velocity) : 0;
      }
      let running = false;
      for (const emitter of run.emitters) {
        const count = emitter.clock.step(dt, run.speed);
        if (!emitter.clock.done && !emitter.clock.stopped) running = true;
        for (let n = 0; n < count; n++) this.#spawn(run, emitter, velocity);
      }
      if (!running) {
        this.runs.splice(i, 1);
      } else {
        active = true;
      }
    }
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      const alive = integrateParticle(p, dt, this.gravity);
      if (!alive) {
        this.#recycle(p);
        this.particles.splice(i, 1);
        continue;
      }
      active = true;
      this.#draw(p);
    }
    return active;
  }

  #spawn(run, emitter, emitterVelocity) {
    if (this.particles.length >= MAX_PARTICLES) { this.dropped++; return; }
    // The emitter's own frame: the bundle's, then its authored placement.
    _q.copy(run.quaternion).multiply(emitter.template.quaternion);
    _pos.copy(emitter.template.position).applyQuaternion(run.quaternion).add(run.origin);
    const basis = quaternionFrame(_q);
    const p = spawnParticle(emitter.spec, basis, [_pos.x, _pos.y, _pos.z],
                            emitterVelocity, this.rand);
    p.mesh = this.#acquire(emitter, p);
    if (!p.mesh) { this.dropped++; return; }
    p.emitter = emitter;
    p.decal = p.kind === 'mesh' && !p.spec.debris && p.ttl >= 5 && !!p.spec.alphaOverTime;
    if (p.decal) {
      // The engine's decal ring: past the lid, the oldest hole goes first.
      while (this.decals.length >= MAX_DECALS) {
        const old = this.decals.shift();
        old.age = old.ttl;   // dies on its next integrate
      }
      this.decals.push(p);
    }
    if (p.kind === 'mesh') {
      frameQuaternion(p.frame, p.mesh.quaternion);
      // The rest orientation the tumble turns about, kept on the pooled mesh
      // rather than allocated per spawn.
      const base = p.mesh.userData.baseQuaternion ??= new THREE.Quaternion();
      p.baseQuaternion = base.copy(p.mesh.quaternion);
      p.tumble = 0;
    }
    this.particles.push(p);
    this.spawned++;
    this.#draw(p);
  }

  #acquire(emitter, p) {
    const template = emitter.template.node;
    if (p.kind === 'sprite') {
      const source = template.isMesh ? template : template.children.find(c => c.isMesh);
      if (!source) return null;
      const key = source.material.uuid;
      let pool = this.spritePool.get(key);
      if (!pool) { pool = []; this.spritePool.set(key, pool); }
      let mesh = pool.pop();
      if (!mesh) {
        const material = source.material.clone();
        material.transparent = true;
        material.depthWrite = false;
        material.side = THREE.DoubleSide;
        if (p.spec.blend === 'add' || material.userData?.additive) {
          material.blending = THREE.AdditiveBlending;
        }
        this.onMaterial?.(material);
        mesh = new THREE.Mesh(source.geometry, material);
        mesh.userData.poolKey = key;
        mesh.frustumCulled = false;
        this.root.add(mesh);
      }
      mesh.visible = true;
      return mesh;
    }
    const key = template.uuid;
    let pool = this.meshPool.get(key);
    if (!pool) { pool = []; this.meshPool.set(key, pool); }
    let mesh = pool.pop();
    if (!mesh) {
      mesh = template.clone();
      const fades = !!p.spec.alphaOverTime;
      // A particle owns its materials — opacity is per particle — but the
      // clone shares the template's. The page's lighting pass may replace
      // them wholesale (the map page rebuilds every lit material under its
      // own combine), so it runs first, and only a material it left shared
      // with the template is cloned; cloning ahead of it built a material
      // per part per pool miss that was thrown away unrendered.
      const shared = new Set();
      template.traverse(part => {
        if (part.isMesh) for (const m of [part.material].flat()) shared.add(m);
      });
      mesh.traverse(part => { if (part.isMesh) part.frustumCulled = false; });
      this.onMesh?.(mesh);
      mesh.userData.poolKey = key;
      mesh.userData.materials = [];
      mesh.traverse(part => {
        if (!part.isMesh) return;
        const own = [part.material].flat().map(m => (shared.has(m) ? m.clone() : m));
        part.material = own.length === 1 ? own[0] : own;
        for (const c of own) {
          if (fades) {
            // `IStandardMesh::setAlpha` on the engine's side; here the
            // material's opacity, under the decal's own alphaTest 0.5. Lifted
            // 1 mm by the data, which a 30 m depth buffer cannot resolve, so
            // the offset does the lift's job on the GPU.
            c.transparent = true;
            c.depthWrite = false;
            c.polygonOffset = true;
            c.polygonOffsetFactor = -2;
            c.polygonOffsetUnits = -2;
          }
          if (c.userData?.additive) {
            c.blending = THREE.AdditiveBlending;
            c.transparent = true;
            c.depthWrite = false;
          }
          this.onMaterial?.(c);
          mesh.userData.materials.push(c);
        }
      });
      this.root.add(mesh);
    }
    mesh.visible = true;
    return mesh;
  }

  #recycle(p) {
    const mesh = p.mesh;
    if (!mesh) return;
    mesh.visible = false;   // parked in `root`, out of the walk and the draw
    const pool = p.kind === 'sprite' ? this.spritePool : this.meshPool;
    pool.get(mesh.userData.poolKey)?.push(mesh);
    if (p.decal) {
      const at = this.decals.indexOf(p);
      if (at >= 0) this.decals.splice(at, 1);
    }
    p.mesh = null;
  }

  #draw(p) {
    const look = evalParticle(p);
    const mesh = p.mesh;
    mesh.position.set(p.position[0], p.position[1], p.position[2]);
    mesh.scale.set(Math.max(look.scale[0], 1e-4), Math.max(look.scale[1], 1e-4),
                   Math.max(look.scale[2], 1e-4));
    if (p.kind === 'sprite') {
      mesh.quaternion.copy(this.camera.quaternion);
      if (look.rotation) {
        _spin.setFromAxisAngle(_axis.set(0, 0, 1), look.rotation * DEG);
        mesh.quaternion.multiply(_spin);
      }
      const material = mesh.material;
      if (look.color) material.color.setRGB(look.color[0], look.color[1], look.color[2]);
      material.opacity = look.opacity;
    } else {
      const rot = p.emitter.spec.rotationalSpeed;
      if (rot && (rot.dof || rot.up || rot.right)) {
        // Tumbling debris: `rotationalSpeedIn*` are degrees per second about
        // the particle's own frame axes, sampled once at spawn.
        if (p.tumbleRates === undefined) {
          const { sampleCrd } = p; // placeholder never used
        }
        if (!p.tumbleRates) {
          p.tumbleRates = [
            rot.right ? sampleCrdLocal(rot.right, this.rand) : 0,
            rot.up ? sampleCrdLocal(rot.up, this.rand) : 0,
            rot.dof ? sampleCrdLocal(rot.dof, this.rand) : 0,
          ];
        }
        const [rx, ry, rz] = p.tumbleRates;
        mesh.quaternion.copy(p.baseQuaternion);
        if (rx) mesh.quaternion.multiply(_spin.setFromAxisAngle(_axis.set(1, 0, 0), rx * p.age * DEG));
        if (ry) mesh.quaternion.multiply(_spin.setFromAxisAngle(_axis.set(0, 1, 0), ry * p.age * DEG));
        if (rz) mesh.quaternion.multiply(_spin.setFromAxisAngle(_axis.set(0, 0, 1), rz * p.age * DEG));
      }
      for (const material of mesh.userData.materials) {
        if (material.transparent) material.opacity = look.opacity;
      }
    }
  }
}

// `effects-core`'s sampler, re-exported under a local name so the tumble
// rates above can draw from the same distributions.
import { sampleCrd as sampleCrdLocal } from './effects-core.js';
