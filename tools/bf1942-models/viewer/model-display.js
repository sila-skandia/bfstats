// The model browser's display toggles: wireframe, untextured, double-sided
// and the exploded view with its spread, applied to the loaded model, and the
// materials' own textures kept aside for the untextured toggle to restore.
// Lifted out of index.html (features/vehicle-instance-refactor, Part 2c).

import * as THREE from 'three';

/**
 * Built once by the page, where this code used to sit. `page` hands in
 * what it reads of the rest of the page, as getters (a binding the page
 * reassigns is read live):
 * `applyCollisionState`, `current`, `invalidate`, `isCollisionMesh`,
 * `syncRange`.
 */
export function createModelDisplay(page) {
  const display = {};

  const state = {
    wireframe: false,
    untextured: false,
    explode: false,
    explodeAmount: 0.5,
    doubleside: false,
  };

  // Material.clone() deep-copies userData through JSON, so a Texture parked there
  // comes back as a plain object and the renderer chokes on its missing matrix.
  // Keep the bookkeeping outside the material.
  const originalMap = new WeakMap();

  function applyState() {
    if (!page.current) return;
    page.current.traverse(obj => {
      if (!obj.isMesh) return;
      if (page.isCollisionMesh(obj)) return;
      for (const m of [obj.material].flat()) {
        m.wireframe = state.wireframe;
        if (state.untextured) {
          if (!originalMap.has(m)) originalMap.set(m, m.map);
          m.map = null;
          m.color.setHex(0x9a9a90);
        } else if (originalMap.has(m)) {
          m.map = originalMap.get(m);
          m.color.setHex(0xffffff);
        }
        if (state.doubleside) m.side = THREE.DoubleSide;
        m.needsUpdate = true;
      }
      if (obj.userData.home) {
        const h = obj.userData.home;
        const k = explodeFactor();
        obj.position.set(h.x * k, h.y * k, h.z * k);
      }
    });
    if (state.explode) {
      let furthest = 0;
      page.current.traverse(obj => {
        if (obj.userData.home) furthest = Math.max(furthest, obj.userData.home.length() * (explodeFactor() - 1));
      });
      document.getElementById('explode-output').value = `${furthest.toFixed(2)} m`;
    }
    page.applyCollisionState();
    page.invalidate();
  }

  // Half-way is the old fixed 2.2x spread.
  const explodeFactor = () => (state.explode ? 1 + state.explodeAmount * 2.4 : 1);

  for (const id of ['wireframe', 'untextured', 'explode', 'doubleside']) {
    document.getElementById(id).addEventListener('change', e => {
      state[id] = e.target.checked;
      if (id === 'explode') document.getElementById('explode-row').hidden = !e.target.checked;
      applyState();
    });
  }
  const explodeAmount = document.getElementById('explode-amount');
  page.syncRange(explodeAmount);
  explodeAmount.addEventListener('input', () => {
    state.explodeAmount = Number(explodeAmount.value);
    applyState();
  });

  /** Note a material's own texture, so the untextured toggle can put it back. */
  function rememberMap(material) {
    originalMap.set(material, material.map);
  }

  Object.assign(display, {
    applyState,
    rememberMap,
  });
  return display;
}
