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
    const wire = wireSettings(state, { hideModel });
    const k = explodeFactor();
    // Whether anything on the tab touches the materials at all.
    const active = hideModel || !state.textures || state.doubleside || state.wireframe
      || clampOpacity(state.opacity) < 1;

    for (const mesh of visualMeshes()) {
      const materials = [mesh.material].flat();
      const settings = materials.map(m => {
        // An untouched material is as the page left it: snapshot it fresh.
        if (!snapshots.has(m) || (active && !touched.has(m))) snapshots.set(m, snapshotMaterial(m));
        return surfaceSettings(snapshots.get(m), state, { hideModel });
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
        edges.renderOrder = 5;    // after the blended surface it sits on
        for (const em of [edges.material].flat()) {
          em.depthTest = wire.depthTest;
          em.opacity = wire.opacity;
          em.side = THREE.DoubleSide;
        }
      }

      if (mesh.userData.home) {
        const h = mesh.userData.home;
        mesh.position.set(h.x * k, h.y * k, h.z * k);
      }
    }
    // Groups and empties carry the parts' offsets too.
    page.current.traverse(obj => {
      if (obj.isMesh || !obj.userData.home) return;
      const h = obj.userData.home;
      obj.position.set(h.x * k, h.y * k, h.z * k);
    });
    if (state.explode) {
      let furthest = 0;
      page.current.traverse(obj => {
        if (obj.userData.home) furthest = Math.max(furthest, obj.userData.home.length() * (k - 1));
      });
      document.getElementById('explode-output').value = `${furthest.toFixed(2)} m`;
    }
    syncControls();
    page.applyCollisionState();
    page.invalidate();
  }

  // Half-way is the old fixed 2.2x spread.
  const explodeFactor = () => (state.explode ? 1 + state.explodeAmount * 2.4 : 1);

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

  Object.assign(display, {
    applyState,
    getState,
    rememberMap,
    set,
  });
  return display;
}
