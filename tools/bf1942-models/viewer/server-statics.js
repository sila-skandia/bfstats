// The statics a BF42++ server makes, moves and deletes, and its switch that
// keeps a level's StaticObjects.con out (features/udp-sidecar/wire.md
// section 30). BF42++ is the community client most servers expect; these
// change the world the player collides with and the server simulates, so the
// page plays them as a bf42++ client does.
//
// THE CLIENT'S RULES (bf42plus src/bf/gameevent.cpp:158-236, object.cpp:102):
//
//   CreateStaticObject  the template by id (an unknown one is ignored), made
//                       as an ordinary object; with a transform, at the
//                       position and turned by the yaw/pitch/roll; without,
//                       where the template puts it. Filed under the server's
//                       u16 id: an id in use destroys the object it held.
//   UpdateStaticObject  move sets the position, rotate the rotation (the
//                       position kept), scale does nothing, delete destroys
//                       it. An unknown id is ignored.
//   SpecialGame 2       before the connection's SetLevel: the level loads
//                       without its StaticObjects.con (Game::load skips the
//                       `run <level>/StaticObjects.con` at BF1942.exe
//                       0x00411170..0x004112bd). The mode scripts' statics
//                       (AdditionalStaticObjects and the like) still load.
//
// THE PAGE'S HALF. The sidecar client keeps what the server has made for the
// level being played (`net-sidecar.js` `st.statics`, by id, with a version),
// and `sync` brings the page's copies to it once a frame: a replay of a long
// feed or a capped event list never loses one.
//
// Where a static's mesh comes from. Static templates are not exported as
// model glbs; a level bake places each one under the scene root, named by
// its template. So a server-made static is a clone of a placement of the same
// template in the level (a pruned StaticObjects.con one included, which is
// what a server that replaces the file sends back), and otherwise the model
// tree's glb of that name (a vehicle or any exported template). Neither:
// logged once and skipped, as the client skips a template it does not know.
//
// Which scene nodes are StaticObjects.con's. The bake writes the level's
// environment roots (the Tx and Fill tiles, the sky, the water), then one root
// per StaticObjects.con placement it could build, in file order, and their
// count is `scene.json` `objects.placed`; the mode scripts' statics, the
// spawners group, the flag cloths and the control points follow
// (`extract_map.py` build_scene). `markStaticObjectsCon` stamps those roots
// at load, before anything moves or prunes the tree; it refuses a scene whose
// layout does not read that way (nothing is stamped, nothing is pruned). A
// marker written by the bake itself would be sturdier and needs a re-bake of
// every tree's scene layer; this needs none.
//
// Collision. A clone's hulls join the level's collision index under an owner
// of their own (`WorldCollider.addOwner`, as `effect-objects.js` stands up a
// spawn effect's object); a move reports the new pose (`setMovedOwner`); a
// delete switches the owner off. A pruned StaticObjects.con static's owner is
// switched off, and on again if the switch goes back on.

import * as THREE from 'three';
import { refractorPoint, refractorYpr } from './seat-ik.js';
import { modelFileStem } from './model-file.js';
import { loadFirst, modelUrls } from './pose-bases.js';
import { wearPagePaint } from './level-skin.js';

// --- the StaticObjects.con roots -------------------------------------------------

const ENV_NAME = /^(Tx|Fill)\d+x\d+$/;
function isEnvironmentRoot(node) {
  const kind = node?.userData?.kind;
  return kind === 'terrain' || kind === 'water' || node?.name === 'sky' || node?.name === 'water'
    || ENV_NAME.test(node?.name || '');
}

/** The level scene's StaticObjects.con roots in bake order, or null when the
 *  scene does not have the layout the bake writes. `placed` is `scene.json`
 *  `objects.placed`. */
export function staticObjectsConRoots(root, placed) {
  if (!root || !Number.isInteger(placed) || placed < 0) return null;
  const kids = root.children || [];
  let at = 0;
  while (at < kids.length && isEnvironmentRoot(kids[at])) at++;
  const out = kids.slice(at, at + placed);
  if (out.length !== placed) return null;
  for (const node of out) {
    if (isEnvironmentRoot(node) || node.userData?.modes || node.userData?.spawner
        || node.name === 'spawners' || node.name === 'controlPoints') return null;
  }
  return out;
}

/** Stamp the StaticObjects.con roots (`userData.staticObjectsCon`) at load.
 *  Returns how many, or -1 when the layout did not read. */
export function markStaticObjectsCon(root, extras) {
  if (!root) return -1;
  const nodes = staticObjectsConRoots(root, extras?.objects?.placed);
  root.userData.staticObjectsConMarked = nodes ? nodes.length : -1;
  if (!nodes) return -1;
  for (const node of nodes) node.userData.staticObjectsCon = true;
  return nodes.length;
}

// The switch as the server set it for the level being played. The level load
// reads it (a level that loads after the row came prunes at once); the sync
// sets it.
let conOff = false;
export function setStaticObjectsConOff(on) { conOff = !!on; }
export function staticObjectsConOff() { return conOff; }

/** Take the stamped StaticObjects.con roots out of the level, and their
 *  collision owners off. Returns how many went. */
export function pruneStaticObjectsCon(root, collider = null) {
  if (!root || root.userData.staticObjectsConPruned) return 0;
  const gone = [];
  for (const node of [...(root.children || [])]) {
    if (!node.userData?.staticObjectsCon) continue;
    const owner = collider?.statics?.ownerOf?.(node) ?? -1;
    if (owner >= 0) collider.statics.disableOwner?.(owner);
    gone.push({ node, owner });
    root.remove(node);
  }
  root.userData.staticObjectsConPruned = gone;
  return gone.length;
}

/** Put them back (the server's next load of the same level did not say off). */
export function restoreStaticObjectsCon(root, collider = null) {
  const gone = root?.userData?.staticObjectsConPruned;
  if (!gone) return 0;
  for (const { node, owner } of gone) {
    root.add(node);
    if (owner >= 0) collider?.statics?.enableOwner?.(owner);
  }
  root.userData.staticObjectsConPruned = null;
  return gone.length;
}

/** The pruned StaticObjects.con roots, for donors. */
function prunedRoots(root) {
  return (root?.userData?.staticObjectsConPruned || []).map(g => g.node);
}

// --- reconciling the page's copies with the server's set ----------------------------

/**
 * What to do to bring `have` (id -> {tmpl, rev}) to `want` (id -> {tmpl, rev,
 * pos, rot}): `create` the ids new or remade under another template, `pose`
 * the ones whose revision moved, `remove` the ids gone (and the remade ones,
 * first). Pure.
 */
export function reconcileStatics(want, have) {
  const create = [], pose = [], remove = [];
  for (const [id, h] of have) {
    const w = want.get(id);
    if (!w || String(w.tmpl || '').toLowerCase() !== String(h.tmpl || '').toLowerCase() || w.made !== h.made) remove.push(id);
  }
  for (const [id, w] of want) {
    const h = have.get(id);
    if (!h || remove.includes(id)) create.push(w);
    else if (h.rev !== w.rev) pose.push(w);
  }
  return { create, pose, remove };
}

/** A server pose as three.js values: Refractor's frame mirrors Z. */
export function poseOf(entry) {
  const p = Array.isArray(entry?.pos) ? refractorPoint(entry.pos) : null;
  const q = Array.isArray(entry?.rot) ? refractorYpr(entry.rot) : null;
  return { position: p, quaternion: q };
}

/** The level's own placement of `tmpl`: a root named for it (three adds
 *  `_<n>` to a repeated name), live or pruned. */
export function findDonor(root, tmpl) {
  if (!root || !tmpl) return null;
  const want = String(tmpl).toLowerCase();
  const re = new RegExp(`^${want.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(_\\d+)?$`);
  const pool = [...(root.children || []), ...prunedRoots(root)];
  const own = pool.filter(n => n.userData?.serverStatic == null);
  return own.find(n => String(n.name || '').toLowerCase() === want)
    ?? own.find(n => re.test(String(n.name || '').toLowerCase()))
    ?? null;
}

// --- the page's copies -------------------------------------------------------------

/**
 * Built by `net-room.js` for a sidecar page. `page` hands in, as getters:
 * `bindDynamicShading`, `bust`, `collider`, `currentRoot`, `extras`, `loader`,
 * `logToConsole`, `MODELS_BASE`.
 */
export function createServerStatics(page) {
  const have = new Map();   // id -> { id, tmpl, rev, made, object, owner, bakedInverse, radius }
  let seenVersion = -1;
  let seenRoot = null;
  let made = 0;             // a fresh stamp per create, so a remake under one id is seen
  const glbs = new Map();   // template (lower case) -> Promise<scene | null>
  const missing = new Set();
  const report = { created: 0, moved: 0, removed: 0, pruned: 0, restored: 0, unknown: 0 };

  const log = (text) => page.logToConsole?.(text);

  function modelScene(tmpl) {
    const key = tmpl.toLowerCase();
    if (!glbs.has(key)) {
      const urls = modelUrls(page.MODELS_BASE, `${modelFileStem(tmpl)}.glb`, page.bust?.() ?? '');
      glbs.set(key, loadFirst(page.loader, urls).then(g => g?.scene ?? null, () => null));
    }
    return glbs.get(key);
  }

  function place(rec, entry) {
    const object = rec.object;
    if (!object) return;
    const { position, quaternion } = poseOf(entry);
    if (position) object.position.set(position[0], position[1], position[2]);
    if (quaternion) object.quaternion.set(quaternion[0], quaternion[1], quaternion[2], quaternion[3]);
    object.matrixAutoUpdate = true;
    object.updateMatrixWorld(true);
    if (rec.owner >= 0 && rec.bakedInverse) {
      const fwd = new THREE.Matrix4().multiplyMatrices(object.matrixWorld, rec.bakedInverse);
      const inv = fwd.clone().invert();
      const e = object.matrixWorld.elements;
      page.collider?.setMovedOwner?.(rec.owner, fwd.elements, inv.elements, e[12], e[13], e[14], rec.radius);
    }
  }

  async function create(entry, root) {
    const rec = { id: entry.id, tmpl: entry.tmpl || '', rev: entry.rev, made: entry.made,
                  object: null, owner: -1, bakedInverse: null, radius: 0 };
    have.set(entry.id, rec);
    if (!rec.tmpl) { unknown(`template id ${entry.tid}`); return; }
    const donor = findDonor(root, rec.tmpl);
    let source = donor;
    if (!source) source = await modelScene(rec.tmpl);
    // Gone, remade or the level replaced while the glb loaded.
    if (have.get(entry.id) !== rec || page.currentRoot !== root) return;
    if (!source) { unknown(rec.tmpl); return; }
    const object = source.clone(true);
    object.name = rec.tmpl;
    object.userData = { ...object.userData, serverStatic: entry.id };
    delete object.userData.staticObjectsCon;
    object.scale.set(1, 1, 1); // a placement's own stretch is not the template's
    object.position.set(0, 0, 0);
    object.quaternion.identity();
    object.visible = true;
    // Its collision hulls ride along hidden, as every placed object's do
    // (`level-statics.js` isCollision).
    object.traverse(node => {
      if (node !== object && (node.userData?.collision || /collision/i.test(node.name || ''))) node.visible = false;
    });
    if (!donor) { page.bindDynamicShading?.(object); void wearPagePaint(object); }
    rec.object = object;
    root.add(object);
    object.updateMatrixWorld(true);
    // Its hulls into the index where it stands now; a later move reports the
    // pose against this one.
    place(rec, entry);
    rec.owner = page.collider?.addOwner?.(object) ?? -1;
    if (rec.owner >= 0) {
      rec.bakedInverse = object.matrixWorld.clone().invert();
      const box = new THREE.Box3().setFromObject(object);
      const c = new THREE.Vector3();
      box.getCenter(c);
      rec.radius = box.isEmpty() ? 0 : box.getSize(new THREE.Vector3()).length() / 2 + c.distanceTo(object.position);
    }
    report.created++;
  }

  function unknown(what) {
    report.unknown++;
    if (missing.has(what)) return;
    missing.add(what);
    log(`bf42++ static: no model for ${what}; not drawn`);
  }

  function remove(id) {
    const rec = have.get(id);
    have.delete(id);
    if (!rec?.object) return;
    if (rec.owner >= 0) {
      page.collider?.clearMovedOwner?.(rec.owner, { enable: false });
      page.collider?.statics?.disableOwner?.(rec.owner);
    }
    rec.object.removeFromParent();
    report.removed++;
  }

  function dropAll() {
    for (const id of [...have.keys()]) remove(id);
  }

  /** Once a frame: the server's set (`roomClient.serverStatics()`) onto the
   *  level. Waits for the level's collision index. */
  function sync(state) {
    const root = page.currentRoot;
    if (!state || !root || !page.collider?.statics) return;
    if (root !== seenRoot) {
      // A new level: the old copies went with the old root.
      have.clear();
      seenRoot = root;
      seenVersion = -1;
    }
    // The switch first, so a remade static can use a pruned twin.
    if (state.off !== conOff) setStaticObjectsConOff(state.off);
    if (root.userData.staticObjectsConMarked >= 0) {
      if (conOff && !root.userData.staticObjectsConPruned) {
        const n = pruneStaticObjectsCon(root, page.collider);
        report.pruned += n;
        log(`bf42++: this server loads the level without its StaticObjects.con (${n} statics out)`);
      } else if (!conOff && root.userData.staticObjectsConPruned) {
        report.restored += restoreStaticObjectsCon(root, page.collider);
      }
    } else if (conOff && root.userData.staticObjectsConMarked === -1 && !root.userData.staticObjectsConWarned) {
      root.userData.staticObjectsConWarned = true;
      log('bf42++: the server keeps StaticObjects.con out, but this level\'s scene does not say which statics are its');
    }
    if (state.version === seenVersion) return;
    seenVersion = state.version;
    // Every create is a fresh object: stamp it, so the same id made twice
    // between two frames is still remade.
    const want = new Map();
    for (const [id, o] of state.objects) {
      if (o.made == null) o.made = ++made;
      want.set(id, o);
    }
    const ops = reconcileStatics(want, have);
    for (const id of ops.remove) remove(id);
    for (const entry of ops.pose) {
      const rec = have.get(entry.id);
      if (!rec) continue;
      rec.rev = entry.rev;
      place(rec, entry);
      report.moved++;
    }
    for (const entry of ops.create) {
      // The pose is read again when the mesh is in: a move that came while
      // it loaded is not lost.
      create(entry, root).then(() => {
        const rec = have.get(entry.id);
        const now = state.objects.get(entry.id);
        if (rec?.object && now && now.rev !== rec.rev) { rec.rev = now.rev; place(rec, now); }
      }).catch(err => console.warn('bf42++ static:', err));
    }
  }

  return { sync, dropAll, report, have };
}
