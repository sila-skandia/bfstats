// The kit inspector's worn parts: helmets, packs and pouches grafted onto the
// figure's own bones, and the "Worn" panel whose rows switch each slot off and
// on. Lifted out of kits.html (features/vehicle-instance-refactor, Part 2d).

import { bonePattern, wornGrafts } from './kit-graft.js';

/**
 * Built once by the page, where this code used to sit. `page` hands in
 * what it reads of the rest of the page, as getters (a binding the page
 * reassigns is read live):
 * `applyWireframe`, `bust`, `current`, `invalidate`, `loader`, `MODEL_BASES`.
 */
export function createKitWorn(page) {
  const kitWorn = {};

  const wornEl = document.getElementById('worn');
  const hidden = new Set();      // worn slots the viewer has switched off

  // --- Grafting ---------------------------------------------------------------
  //
  // A KitPart is a static mesh bolted to a bone of the *wearer's* skeleton, and
  // every pose glb already carries all three of those bones as nodes — `A` (a
  // child of Bip01 Head), `backpack` and `HipPack`. So a helmet is added to the
  // bone's node and nothing else: no channels, no rebinding, no per-stance
  // variant. The bone is what moves, exactly as the weapon weld relies on.
  //
  // Parenting rather than baking is also what keeps the stance blend free: when
  // the mixer moves Bip01 Head, the helmet on `A` goes with it.
  const partCache = new Map();
  let grafted = [];

  async function loadPart(glb) {
    if (!partCache.has(glb)) {
      let scene = null;
      for (const base of page.MODEL_BASES) {
        try { scene = (await page.loader.loadAsync(`${base}/${glb}${page.bust()}`)).scene; break; }
        catch { /* a mod that ships only its own worn meshes falls back to vanilla */ }
      }
      if (!scene) return null;
      partCache.set(glb, scene);
    }
    return partCache.get(glb);
  }

  // The graft's local rotation per slot, and the composition of a KitPart's own
  // `setPosition` / `setRotation` on top of it, live in `kit-graft.js` -- the
  // seated occupant in `map.html` wears the same kits and must graft them the
  // same way, and these constants were settled by eye rather than derived, so
  // there must be exactly one copy of them. See that module for why each slot
  // gets the flip it gets.

  function boneNamed(root, want) {
    // "HipPack" survives sanitization intact, but match loosely anyway — the
    // manifest spells bones the way the .con files do and those are inconsistent
    // in case (`hippack` / `HipPack`).
    const pattern = bonePattern(want);
    let found = null;
    root.traverse(obj => { if (!found && pattern.test(obj.name)) found = obj; });
    return found;
  }

  async function applyWorn(kit) {
    for (const node of grafted) node.removeFromParent();
    grafted = [];
    if (!page.current || !kit) return;
    for (const graft of wornGrafts(kit, hidden)) {
      const bone = boneNamed(page.current, graft.bone);
      if (!bone) continue;                       // no such bone: silently bare, and the row says so
      const source = await loadPart(graft.glb);
      if (!source) continue;
      const node = source.clone(true);
      node.quaternion.set(...graft.quaternion);
      node.position.set(...graft.position);
      bone.add(node);
      grafted.push(node);
    }
    page.applyWireframe();
    page.invalidate();
  }

  /** The figure the grafts hung on has been taken off stage with them. */
  function forgetGrafts() {
    grafted = [];
  }

  // --- Panel ------------------------------------------------------------------

  const SLOT_ORDER = ['head', 'back', 'hip'];
  const SLOT_LABELS = { head: 'Head', back: 'Back', hip: 'Hip' };

  function renderWorn(kit) {
    const rows = SLOT_ORDER.map(slot => {
      const part = (kit.worn || []).find(entry => entry.slot === slot);
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'worn-row';
      const label = document.createElement('span');
      label.className = 'slot-label';
      label.textContent = SLOT_LABELS[slot];
      const name = document.createElement('span');
      name.className = 'part-name';
      const tris = document.createElement('span');
      tris.className = 'tris';

      if (!part) {
        row.classList.add('is-empty');
        row.disabled = true;
        name.textContent = 'none';
      } else if (!part.glb) {
        // Declared by the kit but the mesh did not come out. Say which, rather
        // than drawing a bare head and letting it read as a weld bug.
        row.classList.add('is-empty');
        row.disabled = true;
        name.textContent = part.template;
        tris.textContent = 'not extracted';
      } else {
        name.textContent = part.template;
        tris.textContent = `${part.triangles} tris`;
        row.classList.toggle('is-off', hidden.has(slot));
        row.title = hidden.has(slot) ? `show ${part.template}` : `hide ${part.template}`;
        row.addEventListener('click', () => {
          hidden.has(slot) ? hidden.delete(slot) : hidden.add(slot);
          renderWorn(kit);
          applyWorn(kit);
        });
      }
      row.append(label, name, tris);
      return row;
    });
    wornEl.replaceChildren(...rows);
  }

  Object.assign(kitWorn, {
    applyWorn,
    forgetGrafts,
    renderWorn,
  });
  return kitWorn;
}
