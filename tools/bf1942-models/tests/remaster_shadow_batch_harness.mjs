// tests/test_remaster_shadow_batch.py: `viewer/remaster-shadow-batch.js` under node,
// against three's own BatchedMesh (three.core has no GPU in it).
import * as THREE from '../viewer/vendor/three-webgpu/three.core.js';
import { batchable, createShadowBatch, SHADOW_BATCH_NAME } from '../viewer/remaster-shadow-batch.js';

const out = {};
const box = new THREE.BoxGeometry(1, 1, 1);
const ball = new THREE.SphereGeometry(0.5, 6, 4);
const solid = new THREE.MeshBasicMaterial();
const mesh = (geometry = box, material = solid) => new THREE.Mesh(geometry, material);

// What can be an instance.
{
  const cut = new THREE.MeshBasicMaterial({ alphaTest: 0.4 });
  const blend = new THREE.MeshBasicMaterial({ transparent: true });
  const moved = new THREE.MeshBasicMaterial(); moved.positionNode = {};
  const skinned = mesh(); skinned.isSkinnedMesh = true;
  const morphed = mesh(box.clone()); morphed.geometry.morphAttributes.position = [box.attributes.position];
  out.batchable = {
    solid: batchable(mesh()), cut: batchable(mesh(box, cut)), blend: batchable(mesh(box, blend)),
    movesItsVertices: batchable(mesh(box, moved)), skinned: batchable(skinned), morphed: batchable(morphed),
    twoMaterials: batchable(mesh(box, [solid, solid])), oneCutOfTwo: batchable(mesh(box, [solid, cut])),
    group: batchable(new THREE.Group()), nothing: batchable(null),
  };
}

const matrixAt = (batch, id) => Array.from(batch._matricesTexture.image.data.slice(id * 16, id * 16 + 16));
const near = (a, b) => a.every((v, i) => Math.abs(v - b[i]) < 1e-5);

// A tank of parts under a turning turret; a soldier's skinned body beside it.
{
  const scene = new THREE.Scene();
  const root = new THREE.Group(); scene.add(root);
  const tank = new THREE.Group(); tank.position.set(100, 5, -40); scene.add(tank);
  const turret = new THREE.Group(); turret.position.set(0, 2, 0); tank.add(turret);
  const hull = mesh(); tank.add(hull);
  const wheel = mesh(ball); wheel.position.set(1, -0.5, 2); tank.add(wheel);
  const gun = mesh(); gun.position.set(0, 0, 3); turret.add(gun);
  const body = mesh(); body.isSkinnedMesh = true; scene.add(body);
  scene.updateMatrixWorld(true);
  const records = [hull, wheel, gun, body].map(obj => ({ obj, on: true }));
  for (const r of records) r.obj.castShadow = true;
  const batch = createShadowBatch(THREE, root, { layer: 1 });
  const taken = batch.addAll(records);
  const m = batch.mesh;
  out.taken = {
    taken, count: batch.count, ids: records.map(r => r.batchId),
    meshesStopCasting: [hull.castShadow, wheel.castShadow, gun.castShadow], skinnedStillCasts: body.castShadow,
    name: m.name === SHADOW_BATCH_NAME, layer: m.layers.mask, casts: m.castShadow, culledByThree: m.frustumCulled,
    perInstanceCull: m.perObjectFrustumCulled, inRoot: m.parent === root, skippedByTheCasterFlagging: m.userData.rmShadow === true,
    againIsNothing: batch.addAll(records),
  };
  const shown = batch.sync(scene);
  out.synced = {
    shown,
    hull: near(matrixAt(m, records[0].batchId), hull.matrixWorld.elements),
    wheel: near(matrixAt(m, records[1].batchId), wheel.matrixWorld.elements),
    gun: near(matrixAt(m, records[2].batchId), gun.matrixWorld.elements),
  };
  // The turret turns and the tank drives: the instances follow the parts.
  turret.rotation.y = 1.1; tank.position.x += 7;
  scene.updateMatrixWorld(true);
  const v0 = m._matricesTexture.version;
  batch.sync(scene);
  const v1 = m._matricesTexture.version;
  out.follows = {
    gun: near(matrixAt(m, records[2].batchId), gun.matrixWorld.elements),
    gunAt: [gun.matrixWorld.elements[12], gun.matrixWorld.elements[14]].map(v => +v.toFixed(2)),
    uploaded: v1 > v0,
  };
  // Nothing moved: nothing goes to the GPU.
  batch.sync(scene);
  out.still = { uploaded: m._matricesTexture.version > v1 };
  // Hidden, out of reach, handed to a proxy, out of the scene: each instance leaves; shown again, it returns.
  const vis = () => records.slice(0, 3).map(r => m.getVisibleAt(r.batchId));
  const step = {};
  turret.visible = false; step.turretHidden = (batch.sync(scene), vis()); turret.visible = true;
  records[1].on = false; step.wheelOutOfReach = (batch.sync(scene), vis()); records[1].on = true;
  records[0].proxied = true; step.hullProxied = (batch.sync(scene), vis()); records[0].proxied = false;
  scene.remove(tank); step.tankGone = (batch.sync(scene), vis()); scene.add(tank);
  step.back = (batch.sync(scene), vis());
  out.shown = step;
  // A part that left for good gives its instance up; the next part takes the id.
  const leaving = records[1].batchId;
  batch.remove(records[1]);
  const spare = { obj: mesh(ball), on: true }; tank.add(spare.obj); scene.updateMatrixWorld(true);
  batch.addAll([spare]);
  out.removed = { count: batch.count, idCleared: records[1].batchId === null, reused: spare.batchId === leaving, sameBatch: batch.mesh === m };
  // A new level.
  batch.reset();
  out.reset = { mesh: batch.mesh === null, count: batch.count, ids: [records[0].batchId, records[2].batchId], gone: m.parent === null };
}

// Out of room: a new batch, never the old one resized.
{
  const scene = new THREE.Scene();
  const root = new THREE.Group(); scene.add(root);
  const batch = createShadowBatch(THREE, root, { layer: 1, instances: 2, vertices: 24, indices: 36 });
  const part = (geometry, x) => { const o = mesh(geometry); o.position.x = x; scene.add(o); return { obj: o, on: true }; };
  const first = [part(box, 1), part(box, 2)];
  scene.updateMatrixWorld(true);
  batch.addAll(first);
  const a = batch.mesh; const textureA = a._matricesTexture; const capA = { ...batch.capacity };
  batch.sync(scene);
  // Two more parts and a second shape: over every limit at once.
  const more = [part(box, 3), part(ball, 4), part(ball, 5)];
  scene.updateMatrixWorld(true);
  batch.addAll(more);
  const b = batch.mesh; const capB = { ...batch.capacity };
  batch.sync(scene);
  const all = [...first, ...more];
  out.grown = {
    newBatch: a !== b, oldGone: a.parent === null, newTextures: b._matricesTexture !== textureA,
    oneInRoot: root.children.length, builds: [capA.builds, capB.builds],
    room: [capB.instances >= all.length, capB.vertices >= capB.usedVertices, capB.indices >= capB.usedIndices],
    count: batch.count, ids: all.map(r => r.batchId).sort(),
    everyPartWhereItIs: all.every(r => near(matrixAt(b, r.batchId), r.obj.matrixWorld.elements)),
    everyPartShown: all.every(r => b.getVisibleAt(r.batchId)),
    geometries: b._geometryInfo.length,
  };
  // Inside the room there is, the same batch takes a part.
  const one = [part(box, 6)];
  scene.updateMatrixWorld(true);
  batch.addAll(one);
  out.grown.sameBatchWithRoom = batch.mesh === b;
}

console.log(JSON.stringify(out));
