// The model inspector's Display tab: textures on or off (flat grey), the
// texture opacity slider, the wireframe drawn over the surface, back faces,
// double-sided and the exploded view with its spread, applied to the loaded
// model. The numbers live in `model-display-state.js`; this file puts them on
// the three.js materials and keeps the helper meshes they need (the depth
// copy that keeps a faded hull to its nearest face, and the edges overlay).
// Lifted out of index.html (features/vehicle-instance-refactor, Part 2c);
// the tab is features/mesh-viewer-advanced-tab.

import * as THREE from 'three';
import { DISPLAY_DEFAULTS, clampOpacity, opacityLabel, snapshotMaterial,
         surfaceSettings, wireSettings } from './model-display-state.js';

// The edges' colour: --mm-ink-soft, light enough to read over olive drab,
// desert tan and the flat grey alike.
const WIRE_COLOUR = 0xd8d8d0;
// How faint the rest of the model goes while the part inspector shows a part.
const GHOST_OPACITY = 0.14;

/**
 * Built once by the page, where this code used to sit. `page` hands in
 * what it reads of the rest of the page, as getters (a binding the page
 * reassigns is read live):
 * `applyCollisionState`, `current`, `hideModel`, `invalidate`,
 * `isCollisionMesh`, `syncRange`.
 */
export function createModelDisplay(page) {
  const display = {};
  const state = { ...DISPLAY_DEFAULTS };

  // Material.clone() deep-copies userData through JSON, so a Texture parked there
  // comes back as a plain object and the renderer chokes on its missing matrix.
  // Keep the bookkeeping outside the material.
  const snapshots = new WeakMap();
  // The materials the tab has changed from their snapshot.
  const touched = new WeakSet();

  const helperRaycast = () => {};

  /** The visual meshes of the model: not collision hulls, not our own helpers. */
  function visualMeshes() {
    const meshes = [];
    page.current?.traverse(obj => {
      if (!obj.isMesh || obj.userData.displayHelper) return;
      if (page.isCollisionMesh(obj)) return;
      meshes.push(obj);
    });
    return meshes;
  }

  function helperFor(mesh, kind, makeMaterial) {
    const key = kind === 'prepass' ? 'displayPrepass' : 'displayWire';
    let helper = mesh.userData[key];
    if (helper) return helper;
    const materials = [mesh.material].flat().map(makeMaterial);
    helper = new THREE.Mesh(mesh.geometry, Array.isArray(mesh.material) ? materials : materials[0]);
    helper.name = `${mesh.name || 'mesh'}__${kind}`;
    helper.userData.displayHelper = kind;
    helper.raycast = helperRaycast;
    helper.matrixAutoUpdate = false;   // identity under its mesh, always
    helper.frustumCulled = mesh.frustumCulled;
    mesh.userData[key] = helper;
    mesh.add(helper);
    return helper;
  }

  function applyState() {
    if (!page.current) return;
    const hideModel = Boolean(page.hideModel);
    // The part inspector's ghost: every mesh it is not showing fades to
    // GHOST_OPACITY, through the same rules as the slider (depth copy,
    // cut-outs scaled), without its edges.
    const ghostState = { ...state, opacity: Math.min(clampOpacity(state.opacity), GHOST_OPACITY), wireframe: false };
    // Whether anything on the tab touches the materials at all.
    const active = hideModel || !state.textures || state.doubleside || state.wireframe
      || clampOpacity(state.opacity) < 1 || Boolean(ghostKeep);

    for (const mesh of visualMeshes()) {
      const meshState = ghostKeep && !ghostKeep.has(mesh) ? ghostState : state;
      const wire = wireSettings(meshState, { hideModel });
      const materials = [mesh.material].flat();
      const settings = materials.map(m => {
        // An untouched material is as the page left it: snapshot it fresh.
        if (!snapshots.has(m) || (active && !touched.has(m))) snapshots.set(m, snapshotMaterial(m));
        return surfaceSettings(snapshots.get(m), meshState, { hideModel });
      });
      materials.forEach((m, i) => {
        // The model as extracted is never touched: a muzzle flash or a
        // scrolling track that animates its own material keeps doing so. Once
        // the tab has changed a material, putting the defaults back restores
        // its snapshot and lets it go again.
        if (!active && !touched.has(m)) return;
        if (active) touched.add(m); else touched.delete(m);
        const s = settings[i];
        m.visible = s.visible;
        m.map = s.map;
        m.color.setHex(s.color);
        m.side = s.side;
        m.transparent = s.transparent;
        m.opacity = s.opacity;
        m.depthWrite = s.depthWrite;
        m.alphaTest = s.alphaTest;
        m.polygonOffset = s.polygonOffset;
        m.polygonOffsetFactor = s.polygonOffset ? 1 : 0;
        m.polygonOffsetUnits = s.polygonOffset ? 1 : 0;
        if (!mesh.isSkinnedMesh) m.wireframe = false;
        m.needsUpdate = true;
      });

      // The depth copy: one per mesh, its materials matching the mesh's
      // groups, drawn in the opaque pass before any blended surface.
      const wantsPrepass = settings.some(s => s.prepass) && !mesh.isSkinnedMesh;
      if (wantsPrepass || mesh.userData.displayPrepass) {
        const prepass = helperFor(mesh, 'prepass', () => new THREE.MeshBasicMaterial({ colorWrite: false }));
        prepass.visible = wantsPrepass;
        prepass.layers.mask = mesh.layers.mask;   // the part inspector's focus pass moves meshes
        [prepass.material].flat().forEach((pm, i) => {
          const p = settings[i]?.prepass;
          pm.visible = Boolean(p);
          pm.map = p?.map ?? null;
          pm.alphaTest = p?.alphaTest ?? 0;
          pm.side = p?.side ?? THREE.FrontSide;
          pm.polygonOffset = settings[i]?.polygonOffset ?? false;
          pm.polygonOffsetFactor = pm.polygonOffset ? 1 : 0;
          pm.polygonOffsetUnits = pm.polygonOffset ? 1 : 0;
          pm.needsUpdate = true;
        });
      }

      // The edges, over whatever the surface is doing. A skinned mesh cannot
      // share its geometry with a plain child, so it falls back to drawing
      // its own triangles as lines.
      if (mesh.isSkinnedMesh) {
        for (const m of materials) m.wireframe = wire.visible;
      } else if (wire.visible || mesh.userData.displayWire) {
        const edges = helperFor(mesh, 'wire', () => new THREE.MeshBasicMaterial({
          color: WIRE_COLOUR, wireframe: true, transparent: true, depthWrite: false,
        }));
        edges.visible = wire.visible;
        edges.layers.mask = mesh.layers.mask;
        edges.renderOrder = 5;    // after the blended surface it sits on
        for (const em of [edges.material].flat()) {
          em.depthTest = wire.depthTest;
          em.opacity = wire.opacity;
          em.side = THREE.DoubleSide;
        }
      }
    }
    applyPositions();
    syncControls();
    page.applyCollisionState();
    page.invalidate();
  }

  // Half-way is the old fixed 2.2x spread.
  const explodeFactor = () => (state.explode ? 1 + state.explodeAmount * 2.4 : 1);

  /**
   * Every part where the explode spread and the part inspector put it: its
   * authored position (`userData.home`) scaled by the spread, plus its
   * pop-out (`userData.popOffset`, in its parent's frame, times
   * `userData.popT`). With both at rest that is the authored position,
   * exactly. Collision hulls move with the node they hang off, as before.
   */
  function applyPositions() {
    if (!page.current) return;
    const k = explodeFactor();
    let furthest = 0;
    page.current.traverse(obj => {
      const h = obj.userData.home;
      if (!h || obj.userData.displayHelper) return;
      if (obj.isMesh && page.isCollisionMesh(obj)) return;
      const pop = obj.userData.popOffset;
      const t = pop ? (obj.userData.popT ?? 0) : 0;
      if (t) {
        obj.position.set(h.x * k + pop.x * t, h.y * k + pop.y * t, h.z * k + pop.z * t);
      } else {
        obj.position.set(h.x * k, h.y * k, h.z * k);
      }
      if (state.explode) furthest = Math.max(furthest, h.length() * (k - 1));
    });
    if (state.explode) document.getElementById('explode-output').value = `${furthest.toFixed(2)} m`;
    page.invalidate();
  }

  // --- The part inspector's ghost ------------------------------------------
  //
  // Materials are shared between parts (a ship's hull material is on every
  // turret), so the meshes kept solid get their own copies while the ghost
  // is up, and the originals fade. Each copy starts from its original's
  // snapshot, so whatever the tab had done to the original is not copied.

  let ghostKeep = null;

  function ownMaterials(mesh) {
    if (mesh.userData.ghostOriginal) return;
    const original = mesh.material;
    const copies = [original].flat().map(m => {
      const snap = touched.has(m) ? snapshots.get(m) : snapshotMaterial(m);
      const copy = m.clone();
      copy.map = snap.map;
      copy.color.setHex(snap.color);
      copy.transparent = snap.transparent;
      copy.opacity = snap.opacity;
      copy.depthWrite = snap.depthWrite;
      copy.alphaTest = snap.alphaTest;
      copy.side = snap.side;
      copy.visible = true;
      copy.onBeforeCompile = m.onBeforeCompile;
      copy.customProgramCacheKey = m.customProgramCacheKey;
      snapshots.set(copy, snap);
      return copy;
    });
    mesh.userData.ghostOriginal = original;
    mesh.material = Array.isArray(original) ? copies : copies[0];
  }

  function dropOwnMaterials(mesh) {
    const original = mesh.userData.ghostOriginal;
    if (!original) return;
    const copies = [mesh.material].flat();
    mesh.material = original;
    delete mesh.userData.ghostOriginal;
    copies.forEach(copy => { touched.delete(copy); copy.dispose(); });
  }

  /**
   * Ghost everything but `keep` (a Set of meshes), or clear the ghost with
   * null. Called by the part inspector on select and deselect.
   */
  function setGhost(keep) {
    const next = keep && keep.size ? keep : null;
    for (const mesh of visualMeshes()) {
      if (next?.has(mesh)) ownMaterials(mesh); else dropOwnMaterials(mesh);
    }
    ghostKeep = next;
    applyState();
  }

  // --- The tab's controls -------------------------------------------------

  const texturesSeg = document.getElementById('textures-seg');
  const opacityRange = document.getElementById('texture-opacity');
  const opacityOutput = document.getElementById('texture-opacity-output');
  const explodeAmount = document.getElementById('explode-amount');

  /** Put every control in step with `state` (after Reset, or a hook). */
  function syncControls() {
    for (const button of texturesSeg.querySelectorAll('[data-value]')) {
      button.setAttribute('aria-pressed', String((button.dataset.value === 'on') === state.textures));
    }
    opacityRange.value = String(state.opacity);
    opacityOutput.value = opacityLabel(state.opacity);
    page.syncRange(opacityRange);
    for (const id of ['wireframe', 'seeThrough', 'doubleside', 'explode']) {
      document.getElementById(id === 'seeThrough' ? 'see-through' : id).checked = state[id];
    }
    document.getElementById('explode-row').hidden = !state.explode;
    explodeAmount.value = String(state.explodeAmount);
    page.syncRange(explodeAmount);
    const panel = document.getElementById('wb-display');
    panel.dataset.textures = String(state.textures);
    panel.dataset.faded = String(state.opacity < 0.995);
    document.getElementById('display-reset').disabled = isDefault();
  }

  function isDefault() {
    return Object.entries(DISPLAY_DEFAULTS).every(([key, value]) => state[key] === value);
  }

  texturesSeg.addEventListener('click', event => {
    const button = event.target.closest('[data-value]');
    if (!button) return;
    set({ textures: button.dataset.value === 'on' });
  });
  opacityRange.addEventListener('input', () => set({ opacity: clampOpacity(opacityRange.value) }));
  for (const [id, key] of [['wireframe', 'wireframe'], ['see-through', 'seeThrough'],
                           ['doubleside', 'doubleside'], ['explode', 'explode']]) {
    document.getElementById(id).addEventListener('change', e => set({ [key]: e.target.checked }));
  }
  explodeAmount.addEventListener('input', () => set({ explodeAmount: Number(explodeAmount.value) }));
  document.getElementById('display-reset').addEventListener('click', () => set({ ...DISPLAY_DEFAULTS }));

  /** Change any of the Display state and redraw. The `?shots` hooks call this too. */
  function set(patch) {
    for (const [key, value] of Object.entries(patch)) {
      if (!(key in DISPLAY_DEFAULTS)) continue;
      state[key] = key === 'opacity' ? clampOpacity(value)
        : key === 'explodeAmount' ? Number(value) : Boolean(value);
    }
    applyState();
  }

  /** Note a material's own state, so the tab can always put it back. */
  function rememberMap(material) {
    snapshots.set(material, snapshotMaterial(material));
  }

  /** What the tab has done to the model, for the headless checks. */
  function getState() {
    const meshes = visualMeshes();
    const materials = meshes.flatMap(mesh => [mesh.material].flat());
    return {
      ...state,
      meshes: meshes.length,
      faded: materials.filter(m => m.transparent && m.opacity < 1).length,
      hidden: materials.filter(m => !m.visible).length,
      untextured: materials.filter(m => !m.map).length,
      prepasses: meshes.filter(mesh => mesh.userData.displayPrepass?.visible).length,
      wires: meshes.filter(mesh => mesh.userData.displayWire?.visible).length,
      alphaTested: materials.filter(m => m.alphaTest > 0).length,
    };
  }

  syncControls();

  /** A new model: the old one's ghost set is gone with it. */
  function forgetGhost() { ghostKeep = null; }

  Object.assign(display, {
    applyPositions,
    forgetGhost,
    applyState,
    getState,
    setGhost,
    rememberMap,
    set,
  });
  // A getter, not a copied value: Object.assign would read it once.
  Object.defineProperty(display, 'ghosted', { get: () => Boolean(ghostKeep) });
  return display;
}
