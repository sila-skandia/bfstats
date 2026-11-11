// The part inspector (features/mesh-viewer-advanced-tab, "Part inspector"):
// hover a part of the model to see its template, click to select it and pop
// it out of a ghosted model, read where it comes from on the Model tab's
// card, walk the part tree, search by template, mesh, texture or material,
// and take the model apart, piece by piece, down its hierarchy.
//
// The map of the model (which template every mesh belongs to, what it is
// made of, the search) is `model-parts-index.js`; the ghost and the part
// positions are `model-display.js` (`setGhost`, `applyPositions`), so the
// pop-out shares the explode spread's code and the opacity slider's depth
// and cut-out handling.

import * as THREE from 'three';
import { BUILDER, buildPartIndex, chainOf, describePart,
         hasGeometry, partsWithArmour, popVector, searchParts, subtreeOf, textureLabel } from './model-parts-index.js';

const TINT = 0xb4c060;          // --mm-kd-elite: the hover tint and the selection box
const RIM = 0x9aa666;           // --mm-accent-soft: the outline round a shown part

// The layer the shown part draws on: `renderFocus` draws it last, over the
// ghost and the regions, with the depth cleared, so a popped part can never
// sit behind the ghost's depth copy or a hull.
export const FOCUS_LAYER = 2;
const POP_SECONDS = 0.45;
const BACK_SECONDS = 0.35;

const esc = value => String(value ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const easeOut = t => 1 - (1 - t) ** 3;
const easeInOut = t => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2);

/**
 * Built once by the page. `page` hands in, as getters: `armour`, `camera`,
 * `display`, `framing`, `invalidate`, `main`, `renderer`, `scene`,
 * `startAnimating`, `workbench`.
 */
export function createPartInspector(page) {
  const inspector = {};
  let index = { parts: [], partOfMesh: new Map(), byNode: new Map() };
  let report = null;
  let hovered = null;
  let selected = [];            // the parts shown, popped out
  let selectionLabel = '';
  const moving = new Map();     // part -> { from, to, start, seconds }

  const tag = document.getElementById('part-tag');
  const card = document.getElementById('part-card');
  const tree = document.getElementById('tree');
  const search = document.getElementById('part-search');
  const results = document.getElementById('part-results');
  const legendParts = document.getElementById('legend-parts');
  const builderButtons = [...document.querySelectorAll('[data-builder]')];

  // --- Picking ------------------------------------------------------------
  //
  // Every pick first tests the ray against each candidate mesh's own
  // bounding box in its local frame (no world boxes to keep fresh while
  // turrets turn and parts pop), then runs the triangle test only on the
  // boxes it went through, nearest first, and stops as soon as the next box
  // starts behind the best hit. Hover is throttled to one pick a frame.

  const raycaster = new THREE.Raycaster();
  raycaster.layers.enableAll();
  const ndc = new THREE.Vector2();
  const inverse = new THREE.Matrix4();
  const localRay = new THREE.Ray();
  const hitPoint = new THREE.Vector3();

  function shown(mesh) {
    for (let at = mesh; at; at = at.parent) if (at.visible === false) return false;
    const materials = [mesh.material].flat();
    return materials.some(m => m && m.visible !== false);
  }

  function pickAt(clientX, clientY) {
    const rect = page.renderer.domElement.getBoundingClientRect();
    ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(ndc, page.camera);
    const regionsOn = Boolean(page.armour.collision);
    const candidates = [];
    for (const [mesh] of index.partOfMesh) {
      const collision = mesh.layers.mask !== 1 || Boolean(mesh.geometry?.userData?.collision);
      if (collision && !regionsOn) continue;
      if (!shown(mesh)) continue;
      const geometry = mesh.geometry;
      if (!geometry) continue;
      if (!geometry.boundingBox) geometry.computeBoundingBox();
      inverse.copy(mesh.matrixWorld).invert();
      localRay.copy(raycaster.ray).applyMatrix4(inverse);
      if (!localRay.intersectBox(geometry.boundingBox, hitPoint)) continue;
      hitPoint.applyMatrix4(mesh.matrixWorld);
      candidates.push({ mesh, distance: hitPoint.distanceTo(raycaster.ray.origin) });
    }
    candidates.sort((a, b) => a.distance - b.distance);
    let best = null;
    for (const { mesh, distance } of candidates) {
      if (best && distance > best.distance) break;
      const hit = raycaster.intersectObject(mesh, false)[0];
      if (hit && (!best || hit.distance < best.distance)) best = hit;
    }
    return best ? index.partOfMesh.get(best.object) || null : null;
  }

  // --- Hover tint and the selection box -------------------------------------

  const tintMaterial = new THREE.MeshBasicMaterial({
    color: TINT, transparent: true, opacity: 0.32, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
  });
  // One box per part shown (a search can show a dozen turrets: one box
  // round all of them would frame the whole ship). `box` is their union,
  // which Frame points the camera at.
  const box = new THREE.Box3();
  const boxLine = new THREE.LineBasicMaterial({ color: TINT, depthTest: false, transparent: true, opacity: 0.75 });
  const boxes = [];
  const MAX_BOXES = 48;
  function boxHelperAt(i) {
    while (boxes.length <= i) {
      const helper = new THREE.Box3Helper(new THREE.Box3(), TINT);
      helper.material.dispose();
      helper.material = boxLine;
      helper.renderOrder = 9;
      helper.layers.set(FOCUS_LAYER);
      helper.raycast = () => {};
      helper.visible = false;
      page.scene.add(helper);
      boxes.push(helper);
    }
    return boxes[i];
  }
  const boxHelper = {
    get visible() { return boxes.some(b => b.visible); },
    set visible(on) { if (!on) for (const b of boxes) b.visible = false; },
  };

  const meshesOf = part => (part.meshes.length ? part.meshes : part.collisionMeshes);

  function tintOf(mesh) {
    let tint = mesh.userData.partTint;
    if (!tint) {
      tint = new THREE.Mesh(mesh.geometry, tintMaterial);
      tint.userData.displayHelper = 'tint';
      tint.raycast = () => {};
      tint.matrixAutoUpdate = false;
      tint.renderOrder = 7;
      tint.layers.mask = mesh.layers.mask;
      mesh.userData.partTint = tint;
      mesh.add(tint);
    }
    return tint;
  }

  function setHover(part) {
    if (part === hovered) return;
    if (hovered) for (const mesh of meshesOf(hovered)) if (mesh.userData.partTint) mesh.userData.partTint.visible = false;
    hovered = part;
    if (hovered) for (const mesh of meshesOf(hovered)) tintOf(mesh).visible = true;
    page.main.dataset.partHover = hovered ? 'true' : 'false';
    for (const row of tree.querySelectorAll('.pt-row.is-hover')) row.classList.remove('is-hover');
    if (hovered) rowOf(hovered)?.classList.add('is-hover');
    updateBox();
    page.invalidate();
  }

  /** The box around what is selected (or hovered, when nothing is). */
  function updateBox() {
    const focus = (selected.length ? selected : hovered ? [hovered] : []).slice(0, MAX_BOXES);
    box.makeEmpty();
    focus.forEach((part, i) => {
      part.node.updateWorldMatrix(true, true);
      const helper = boxHelperAt(i);
      helper.box.makeEmpty();
      for (const p of subtreeOf(part)) {
        for (const mesh of meshesOf(p)) if (shown(mesh)) helper.box.expandByObject(mesh, false);
      }
      helper.visible = !helper.box.isEmpty();
      box.union(helper.box);
    });
    for (let i = focus.length; i < boxes.length; i += 1) boxes[i].visible = false;
    page.invalidate();
  }

  function showTag(part, x, y, { corner = false } = {}) {
    if (!part) { tag.hidden = true; return; }
    const rect = page.main.getBoundingClientRect();
    tag.dataset.corner = String(corner);
    tag.innerHTML = `<b>${esc(part.label)}${part.copy > 1 ? ` <i>#${part.copy}</i>` : ''}</b><span>${esc(part.kind)}${part.geometry ? ` · ${esc(part.geometry)}` : ''}</span>`;
    tag.hidden = false;
    // A finger covers the spot it tapped, and a phone's stage is short: the
    // tag goes under the breadcrumb instead of over the part.
    if (corner) { tag.style.transform = `translate(12px, ${crumbs.hidden ? 34 : 34 + crumbs.offsetHeight + 6}px)`; return; }
    const left = Math.min(Math.max(8, x - rect.left + 14), rect.width - tag.offsetWidth - 8);
    const top = Math.min(Math.max(8, y - rect.top + 16), rect.height - tag.offsetHeight - 8);
    tag.style.transform = `translate(${left}px, ${top}px)`;
  }

  // --- Pointer --------------------------------------------------------------

  // A tag pinned by a tap or click stops pointing at its part once the camera
  // moves.
  let cameraByUs = false;
  page.controls.addEventListener('change', () => {
    // A tag pinned to the corner (a tap) names the pick wherever the camera goes.
    if (!pending && !(cameraByUs && tag.dataset.corner === 'true')) tag.hidden = true;
  });

  const canvas = page.renderer.domElement;
  let pending = null;
  let downAt = null;

  function hoverFrame() {
    const at = pending;
    pending = null;
    if (!at) return;
    const part = pickAt(at.x, at.y);
    setHover(part);
    if (part) showTag(part, at.x, at.y);
    else if (!selected.length || at.fromHover) tag.hidden = true;
  }

  canvas.addEventListener('pointermove', event => {
    if (event.pointerType === 'touch' || event.buttons || page.armour.ownsClicks) return;
    const scheduled = Boolean(pending);
    pending = { x: event.clientX, y: event.clientY, fromHover: true };
    if (!scheduled) requestAnimationFrame(hoverFrame);
  });
  canvas.addEventListener('pointerleave', () => {
    pending = null;
    setHover(null);
    if (!selected.length) tag.hidden = true;
  });
  canvas.addEventListener('pointerdown', event => {
    downAt = { x: event.clientX, y: event.clientY, button: event.button, touch: event.pointerType === 'touch' };
  });
  canvas.addEventListener('pointerup', event => {
    if (!downAt || downAt.button !== 0) { downAt = null; return; }
    const moved = Math.hypot(event.clientX - downAt.x, event.clientY - downAt.y);
    const touch = downAt.touch || event.pointerType === 'touch';
    downAt = null;
    if (moved > 5 || page.armour.ownsClicks) return;
    const part = pickAt(event.clientX, event.clientY);
    if (!part) { deselect(); return; }
    // Picking the part already picked is not a new history step.
    if (!(selected.length === 1 && selected[0] === part)) select([part], { source: 'model' });
    showTag(part, event.clientX, event.clientY, { corner: touch });
  });
  // A double-click on a part takes it apart.
  canvas.addEventListener('dblclick', event => {
    if (page.armour.ownsClicks) return;
    const part = pickAt(event.clientX, event.clientY);
    if (part) takeApartAction(part);
  });
  addEventListener('keydown', event => {
    if (!document.getElementById('browser')?.hidden) return;
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName);
    if (event.key === 'Escape' && (selected.length || context || apart)) {
      if (typing && event.target !== search) return;
      upOneLevel();
    } else if (event.altKey && !typing && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
      if (!history.length) return;
      event.preventDefault();
      if (event.key === 'ArrowLeft') back(); else forward();
    }
  });

  // --- The shown part's own pass ---------------------------------------------
  //
  // What is selected draws in a pass of its own after everything else, depth
  // cleared, so it is the brightest thing on screen whatever the ghost or the
  // regions are doing: its meshes (on their own material copies, so the ghost
  // never touches them), an olive rim (a back-face shell pushed out along the
  // normals), and the selection boxes. A part with no render mesh (a ladder
  // that is all collision) shows its hull through a lit stand-in, since the
  // hull itself is hidden while the regions are off.

  for (const light of (() => { const l = []; page.scene.traverse(o => { if (o.isLight) l.push(o); }); return l; })()) {
    light.layers.enable(FOCUS_LAYER);
  }
  const rimMaterial = new THREE.MeshBasicMaterial({ color: RIM, side: THREE.BackSide });
  let focused = [];          // meshes moved onto the focus layer
  let proxies = [];          // stand-ins for collision-only parts

  function rimFor(mesh, width) {
    if (!mesh.geometry?.attributes?.normal) return null;
    let rim = mesh.userData.partRim;
    if (!rim) {
      // Its own material per mesh: the width is in the mesh's own units.
      const material = rimMaterial.clone();
      material.onBeforeCompile = shader => {
        shader.uniforms.rimWidth = { value: material.userData.width };
        shader.vertexShader = shader.vertexShader
          .replace('#include <common>', '#include <common>\nuniform float rimWidth;')
          .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed += normalize( normal ) * rimWidth;');
      };
      rim = new THREE.Mesh(mesh.geometry, material);
      rim.userData.displayHelper = 'rim';
      rim.raycast = () => {};
      rim.matrixAutoUpdate = false;
      rim.renderOrder = -1;
      mesh.userData.partRim = rim;
      mesh.add(rim);
    }
    rim.material.userData.width = width;
    rim.material.needsUpdate = true;
    rim.visible = true;
    return rim;
  }

  function setFocus(meshes, collisionOnly) {
    for (const mesh of focused) {
      mesh.traverse(o => { if (o === mesh || o.userData.displayHelper) o.layers.mask = 1; });
      if (mesh.userData.partRim) mesh.userData.partRim.visible = false;
    }
    for (const proxy of proxies) { proxy.parent?.remove(proxy); proxy.material.dispose(); }
    focused = [];
    proxies = [];
    const radius = page.framing?.radius || 10;
    const worldWidth = Math.min(Math.max(radius * 0.0025, 0.012), 0.12);
    for (const mesh of meshes) {
      mesh.updateWorldMatrix(true, false);
      const scale = mesh.matrixWorld.getMaxScaleOnAxis() || 1;
      rimFor(mesh, worldWidth / scale);
      mesh.traverse(o => { if (o === mesh || o.userData.displayHelper) o.layers.set(FOCUS_LAYER); });
      focused.push(mesh);
    }
    for (const part of collisionOnly) {
      part.node.updateWorldMatrix(true, true);
      const toPart = new THREE.Matrix4().copy(part.node.matrixWorld).invert();
      for (const hull of part.collisionMeshes) {
        const id = hull.geometry?.userData?.defenseMaterial;
        const colour = new THREE.Color(page.armour.materialInfo(id).colour);
        const proxy = new THREE.Mesh(hull.geometry, new THREE.MeshStandardMaterial({
          color: colour.lerp(new THREE.Color(0xc8c8c8), 0.35), roughness: 0.8, side: THREE.DoubleSide,
        }));
        proxy.matrixAutoUpdate = false;
        proxy.matrix.multiplyMatrices(toPart, hull.matrixWorld);
        proxy.userData.displayHelper = 'proxy';
        proxy.raycast = () => {};
        proxy.layers.set(FOCUS_LAYER);
        part.node.add(proxy);
        proxies.push(proxy);
      }
    }
    page.invalidate();
  }

  /** The last pass: the shown part and its boxes, over everything. */
  function renderFocus(renderer, scene, camera) {
    if (!focused.length && !proxies.length && !boxHelper.visible) return;
    const { autoClear } = renderer;
    const background = scene.background;
    const mask = camera.layers.mask;
    renderer.autoClear = false;
    scene.background = null;
    renderer.clearDepth();
    camera.layers.set(FOCUS_LAYER);
    renderer.render(scene, camera);
    camera.layers.mask = mask;
    scene.background = background;
    renderer.autoClear = autoClear;
  }

  // --- The view: what is shown, what is taken apart, what is picked ---------
  //
  // One state, set in one place (`go`), so every way back to the whole model
  // (the card's close button, Whole model, the root crumb, Esc from the top,
  // history) is the same call with the same result:
  //
  //   context   null for the whole model, or the part whose pieces alone are
  //             shown (everything outside it is hidden, not ghosted)
  //   apart     whether the context is taken apart (always, inside a part)
  //   selected  the picked parts: popped out of a ghosted model while it is
  //             assembled; outlined and boxed in place while it is apart
  //
  // Every step is kept in a history (the card's arrows, Alt+Left and Right).

  const tmp = new THREE.Vector3();
  const tmp2 = new THREE.Vector3();
  const partBox = new THREE.Box3();
  let context = null;
  let apart = false;
  let hiddenMasks = new Map();   // object -> its layer mask before the context hid it
  let history = [];
  let at = -1;
  let cameraHome = null;         // where the camera was before a context framed it

  /** Whether popping `part` would lift the whole model (a root or a hull with everything on it). */
  function isWholeModel(part) {
    const total = index.parts.reduce((n, p) => n + p.meshes.length, 0);
    const mine = subtreeOf(part).reduce((n, p) => n + p.meshes.length, 0);
    return total > 0 && mine >= total * 0.9;
  }

  /** The box of `parts`' shown meshes, with their subtrees, as they sit now. */
  function boxOf(parts, into = new THREE.Box3()) {
    into.makeEmpty();
    for (const part of parts) {
      part.node.updateWorldMatrix(true, true);
      for (const p of subtreeOf(part)) for (const mesh of meshesOf(p)) {
        if (mesh.layers.mask !== 0 && shown(mesh)) into.expandByObject(mesh, false);
      }
    }
    return into;
  }

  /** `part`'s pop-out in its parent's frame, away from `centre` by `share` of `size`. */
  function popOffsetOf(part, share, centre = page.framing?.centre, size = page.framing?.radius) {
    const node = part.node;
    if (!centre || !node.parent) return null;
    partBox.makeEmpty();
    for (const mesh of meshesOf(part)) partBox.expandByObject(mesh, false);
    if (partBox.isEmpty()) boxOf([part], partBox);
    if (partBox.isEmpty()) return null;
    const middle = partBox.getCenter(tmp);
    const v = popVector(centre.toArray(), middle.toArray(), size, share);
    node.parent.updateWorldMatrix(true, false);
    const start = node.parent.worldToLocal(tmp2.copy(middle));
    const end = node.parent.worldToLocal(middle.clone().add(new THREE.Vector3(...v)));
    return end.sub(start);
  }

  function moveTo(part, to, seconds, delay = 0) {
    const from = part.node.userData.popT ?? 0;
    if (from === to && !moving.has(part)) return;
    moving.set(part, { from, to, start: performance.now() + delay * 1000, seconds });
    page.startAnimating();
  }

  function settle(part) {
    delete part.node.userData.popOffset;
    delete part.node.userData.popT;
  }

  /** Every part home at once, nothing in flight. */
  function settleAll() {
    moving.clear();
    for (const part of index.parts) if (part.node.userData.popOffset) settle(part);
    page.display.applyPositions();
  }

  // --- Hiding what is outside the context ------------------------------------

  function unhide() {
    for (const [obj, mask] of hiddenMasks) obj.layers.mask = mask;
    hiddenMasks = new Map();
  }

  function hideOutside(part) {
    const keep = new Set(subtreeOf(part));
    for (const [mesh, owner] of index.partOfMesh) {
      if (keep.has(owner)) continue;
      mesh.traverse(o => {
        if (o !== mesh && !o.userData.displayHelper) return;
        if (!hiddenMasks.has(o)) hiddenMasks.set(o, o.layers.mask);
        o.layers.mask = 0;
      });
    }
  }

  /**
   * The pieces a context comes apart into: every shown part with a mesh in
   * it, and how many mesh-carrying parts sit between it and the context. The
   * ones at 0 stay put (a ship's hull, a turret's own housing); the rest fly
   * out, nearer pieces first.
   */
  function piecesOf(ctx) {
    const pieces = [];
    const top = ctx ? subtreeOf(ctx) : index.parts;
    for (const part of top) {
      if (!part.shown || !part.meshes.length) continue;
      let depth = 0;
      for (let p = part.parent; p && p !== ctx?.parent; p = p.parent) if (p.meshes.length) depth += 1;
      // A context with no mesh of its own (a gunner's seat group) spreads its
      // top pieces apart too.
      if (ctx && !ctx.meshes.length) depth += 1;
      pieces.push({ part, depth });
    }
    // Several pieces side by side at the top (a plane: fuselage, wings,
    // tailplanes, gear legs, all siblings): the biggest stays as the anchor
    // and the rest spread from it, with what hangs off them a step further.
    const tops = pieces.filter(p => p.depth === 0);
    if (tops.length > 1) {
      const anchor = tops.reduce((a, b) => (b.part.triangles > a.part.triangles ? b : a));
      const shifted = new Set();
      for (const top of tops) if (top !== anchor) for (const q of subtreeOf(top.part)) shifted.add(q);
      for (const piece of pieces) if (shifted.has(piece.part)) piece.depth += 1;
    }
    return pieces;
  }

  function takeApart(ctx) {
    page.display.applyPositions();
    const pieces = piecesOf(ctx);
    const whole = boxOf(ctx ? [ctx] : index.parts.filter(p => !p.parent));
    if (whole.isEmpty()) return;
    const centre = whole.getCenter(new THREE.Vector3());
    // A whole ship spreads by a share of its size; a turret taken apart on
    // its own spreads further for its size, so a barrel clears its housing.
    const size = whole.getSize(new THREE.Vector3()).length() * (ctx ? 1 : 0.6);
    for (const { part, depth } of pieces) {
      if (depth === 0) continue;
      const share = ctx ? 0.3 + 0.1 * Math.min(depth, 3) : 0.14 + 0.06 * Math.min(depth, 4);
      const offset = popOffsetOf(part, share, centre, size);
      if (!offset) continue;
      part.node.userData.popOffset = offset;
      part.node.userData.popT = 0;
      moveTo(part, 1, BUILDER.fly, (depth - 1) * BUILDER.stagger);
    }
  }

  function frameBox(target, spread = 1) {
    if (target.isEmpty()) return;
    const centre = target.getCenter(new THREE.Vector3());
    const size = target.getSize(new THREE.Vector3()).length() * spread;
    const camera = page.camera;
    const dir = camera.position.clone().sub(page.controls.target).normalize();
    page.controls.target.copy(centre);
    camera.position.copy(centre).addScaledVector(dir, Math.max(size * 1.15, 1.5));
    cameraByUs = true;
    page.controls.update();
    cameraByUs = false;
    page.invalidate();
  }

  /**
   * Go to a state: `{ context, apart, selected, label }`. Pushes a history
   * step unless `push` is false. The only place the view changes.
   */
  function go(next, { push = true, source = 'model' } = {}) {
    const nextContext = next.context || null;
    const nextApart = Boolean(next.apart || nextContext);
    const nextSelected = [...new Set((next.selected || []).filter(Boolean))];
    const viewChanged = nextContext !== context || nextApart !== apart;

    if (viewChanged) {
      // Back to a clean model first: nothing popped, nothing ghosted, nothing hidden.
      selected = [];
      setFocus([], []);
      page.display.setGhost(null);
      settleAll();
      unhide();
      if (nextContext) hideOutside(nextContext);
      if (nextContext && !context && !cameraHome) {
        cameraHome = { position: page.camera.position.clone(), target: page.controls.target.clone() };
      }
      context = nextContext;
      apart = nextApart;
      if (apart) takeApart(context);
      if (context) {
        // Framed with room for the pieces once they are out.
        frameBox(boxOf([context]), 1.5);
      } else if (cameraHome) {
        page.camera.position.copy(cameraHome.position);
        page.controls.target.copy(cameraHome.target);
        page.controls.update();
        cameraHome = null;
      }
    }

    // The selection.
    for (const part of selected) {
      if (!nextSelected.includes(part) && !apart) moveTo(part, 0, BACK_SECONDS);
    }
    selected = nextSelected;
    selectionLabel = next.label || '';
    if (!apart) {
      for (const part of selected) {
        if (isWholeModel(part)) continue;
        if (!part.node.userData.popOffset) {
          const offset = popOffsetOf(part, selected.length > 1 ? 0.16 : 0.22);
          if (!offset) continue;
          part.node.userData.popOffset = offset;
          part.node.userData.popT = 0;
        }
        moveTo(part, 1, POP_SECONDS);
      }
    }
    // What stays solid: each part with what hangs off it, except a part that
    // is the whole model (a ship's hull carries every turret): then only its
    // own meshes, so the hull plates stand out from the ghosted turrets.
    const keep = new Set();
    for (const part of selected) {
      const owned = isWholeModel(part) ? [part] : subtreeOf(part);
      for (const p of owned) for (const mesh of p.meshes) keep.add(mesh);
    }
    page.display.setGhost(!apart && selected.length && keep.size ? keep : null);
    // A small part picked on the assembled model is hard to see from where
    // the whole ship is framed: once it is out, the camera comes in on it
    // (and goes back when the pick is dropped).
    frameAfterPop = false;
    if (!apart && selected.length && source === 'model' && looksSmall(selected)) {
      if (!cameraHome) cameraHome = { position: page.camera.position.clone(), target: page.controls.target.clone() };
      frameAfterPop = true;
    }
    if (!selected.length && !context && cameraHome && !viewChanged) {
      page.camera.position.copy(cameraHome.position);
      page.controls.target.copy(cameraHome.target);
      page.controls.update();
      cameraHome = null;
    }
    setFocus([...keep], selected.filter(part => !part.meshes.length && part.collisionMeshes.length));
    if (!selected.length && !moving.size) page.display.setGhost(null);

    if (push) {
      history = history.slice(0, at + 1);
      history.push(snapshotState());
      if (history.length > 80) history.shift();
      at = history.length - 1;
    }

    page.main.dataset.partSelected = String(selected.length > 0);
    page.main.dataset.builder = String(apart);
    page.main.dataset.context = context ? 'part' : 'whole';
    if (selected.length || apart) page.onInspect?.();
    if (!selected.length) tag.hidden = true;
    renderCard();
    renderCrumbs();
    markTree();
    syncApartButtons();
    if (source === 'model' && selected.length) page.workbench.select('model', { remember: false });
    if (selected.length) revealRow(selected[0]);
    else if (context) revealRow(context);
    if (source === 'model' && selected.length) showCard();
    updateBox();
    page.invalidate();
  }

  const snapshotState = () => ({
    context: context?.id ?? null, apart, selected: selected.map(p => p.id), label: selectionLabel,
  });
  const stateOf = entry => ({
    context: entry.context === null ? null : index.parts[entry.context],
    apart: entry.apart,
    selected: entry.selected.map(id => index.parts[id]),
    label: entry.label,
  });

  let frameAfterPop = false;

  /** Whether `parts` cover less than a sixth of the stage's height as framed now. */
  function looksSmall(parts) {
    const b = boxOf(parts);
    if (b.isEmpty()) return false;
    const size = b.getSize(new THREE.Vector3()).length();
    const distance = page.camera.position.distanceTo(b.getCenter(new THREE.Vector3()));
    const view = 2 * distance * Math.tan((page.camera.fov * Math.PI) / 360);
    return size / view < 1 / 6;
  }

  /** The lowest part that holds both the context and `part`: where the view must go to show it. */
  function holderOf(part, ctx) {
    if (!ctx || subtreeOf(ctx).includes(part)) return ctx;
    const mine = new Set(chainOf(part));
    for (let p = ctx.parent; p; p = p.parent) {
      if (mine.has(p) && p.meshes.length) return p;
      if (mine.has(p)) {
        // A holder with no mesh of its own is still a fine place to stand,
        // unless it is the model's root.
        return p.parent ? p : null;
      }
    }
    return null;
  }

  /** Pick `parts`: in the current view, or the nearest one up that shows them all. */
  function select(parts, { source = 'model', label = '' } = {}) {
    const list = [...new Set(parts.filter(Boolean))];
    let ctx = context;
    for (const part of list) ctx = holderOf(part, ctx);
    go({ context: ctx, apart: apart || Boolean(ctx), selected: list, label }, { source });
  }

  /** A click on nothing: drop the pick, stay where you are. */
  function deselect() {
    if (!selected.length) { tag.hidden = true; return; }
    go({ context, apart, selected: [] });
  }

  /** The whole model, assembled, nothing picked, nothing hidden. The card's close button. */
  function wholeModel() {
    if (!context && !apart && !selected.length) { tag.hidden = true; return; }
    go({ context: null, apart: false, selected: [] });
  }

  /** Take apart: the picked part if there is one, else the current view. */
  function takeApartAction(part = selected.length === 1 ? selected[0] : null) {
    if (part && part !== context && subtreeOf(part).some(p => p !== part && p.meshes.length && p.shown)) {
      go({ context: part, apart: true, selected: [] });
    } else if (apart) {
      wholeModel();
    } else {
      go({ context: null, apart: true, selected: [] });
    }
  }

  /** Esc: drop the pick; with none, go up one level; at the top, put it back together. */
  function upOneLevel() {
    if (selected.length) { go({ context, apart, selected: [] }); return; }
    if (context) {
      const crumbs = crumbChain(context);
      const parent = crumbs.length > 1 ? crumbs[crumbs.length - 2] : null;
      go({ context: parent, apart: true, selected: [context] });
      return;
    }
    if (apart) wholeModel();
  }

  function back() {
    if (at <= 0) return;
    at -= 1;
    go(stateOf(history[at]), { push: false, source: 'history' });
  }
  function forward() {
    if (at >= history.length - 1) return;
    at += 1;
    go(stateOf(history[at]), { push: false, source: 'history' });
  }

  /** The selected part's next or previous sibling that draws something. */
  function sibling(step) {
    const part = selected[0];
    if (!part?.parent) return;
    const kin = part.parent.children.filter(p => p.shown && subtreeOf(p).some(hasGeometry));
    const i = kin.indexOf(part);
    if (kin.length < 2 || i < 0) return;
    select([kin[(i + step + kin.length) % kin.length]], { source: 'card' });
  }

  /** The crumbs from the root to `part`: the parts with a mesh, the way a modder thinks of it. */
  function crumbChain(part) {
    return chainOf(part).filter(p => p.meshes.length || p === part);
  }

  // --- The stage's breadcrumb and the take-apart buttons -----------------------

  const crumbs = document.getElementById('part-crumbs');
  const HOME = '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M1.5 6 6 2l4.5 4M3 5v5h6V5"/></svg>';

  function renderCrumbs() {
    const show = Boolean(context || apart || selected.length);
    crumbs.hidden = !show;
    if (!show) { crumbs.innerHTML = ''; return; }
    const trail = context ? crumbChain(context) : [];
    const items = [`<button type="button" class="pcr-home" data-crumb="whole" title="Back to the whole model, put together">${HOME}<span>Whole model</span></button>`];
    if (apart && !context) items.push('<span class="pcr-here">taken apart</span>');
    trail.forEach((part, i) => {
      const last = i === trail.length - 1;
      items.push(last
        ? `<span class="pcr-here" title="Taken apart here">${esc(part.label)}</span>`
        : `<button type="button" class="pcr-step" data-crumb="${part.id}" title="Take ${esc(part.label)} apart">${esc(part.label)}</button>`);
    });
    if (selected.length === 1 && selected[0] !== context) {
      items.push(`<span class="pcr-pick">${esc(selected[0].label)}</span>`);
    } else if (selected.length > 1) {
      items.push(`<span class="pcr-pick">${selected.length} parts</span>`);
    }
    crumbs.innerHTML = items.join(CHEVRON);
  }

  crumbs.addEventListener('click', event => {
    const step = event.target.closest('[data-crumb]');
    if (!step) return;
    if (step.dataset.crumb === 'whole') { wholeModel(); return; }
    const part = index.parts[Number(step.dataset.crumb)];
    if (part) go({ context: part, apart: true, selected: [] });
  });

  function syncApartButtons() {
    const target = selected.length === 1 && selected[0] !== context
      && subtreeOf(selected[0]).some(p => p !== selected[0] && p.meshes.length && p.shown) ? selected[0] : null;
    const label = target ? 'Take apart' : apart ? 'Put back together' : 'Take apart';
    const title = target
      ? `Show only ${target.label}, its pieces spread out (double-click a part does the same)`
      : apart ? 'Put the whole model back together (Esc steps back one level)'
        : 'Spread the model\'s pieces out and keep them there; click a piece, then Take apart again to go inside it';
    for (const b of apartButtons) {
      b.querySelector('span').textContent = label;
      b.title = title;
      b.setAttribute('aria-pressed', String(apart && !target));
    }
  }

  const apartButtons = builderButtons;
  for (const b of apartButtons) b.addEventListener('click', () => takeApartAction());

  /** One animation frame: the pieces in flight. True while anything moves. */
  function advance() {
    if (!moving.size) return false;
    const now = performance.now();
    for (const [part, m] of moving) {
      const k = Math.min(1, Math.max(0, (now - m.start) / 1000 / m.seconds));
      const eased = m.to > m.from ? easeOut(k) : easeInOut(k);
      part.node.userData.popT = m.from + (m.to - m.from) * eased;
      if (k >= 1) {
        moving.delete(part);
        if (m.to === 0) settle(part);
      }
    }
    page.display.applyPositions();
    if (!moving.size && !selected.length && page.display.ghosted) page.display.setGhost(null);
    if (!moving.size && frameAfterPop && selected.length) {
      frameAfterPop = false;
      frameBox(boxOf(selected), 2.2);
    }
    if (boxHelper.visible) updateBox();
    return moving.size > 0;
  }

  // --- The card ---------------------------------------------------------------

  const CLOSE = '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3 3l6 6M9 3 3 9"/></svg>';
  const FRAME = '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M1 4V1h3M8 1h3v3M11 8v3H8M4 11H1V8"/><circle cx="6" cy="6" r="1.4"/></svg>';
  const ARROW_L = '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M7.5 2.5 4 6l3.5 3.5"/></svg>';
  const ARROW_R = '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M4.5 2.5 8 6l-3.5 3.5"/></svg>';
  const UP = '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 7.5 6 4l3.5 3.5"/></svg>';
  const DOWN = '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 4.5 6 8l3.5-3.5"/></svg>';
  const APART = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5 5 2 2M11 5l3-3M5 11l-3 3M11 11l3 3"/><rect x="5.5" y="5.5" width="5" height="5" rx=".5"/></svg>';
  const siblingsOf = part => (part?.parent ? part.parent.children.filter(p => p.shown && subtreeOf(p).some(hasGeometry)).length : 0);
  const canTakeApart = part => Boolean(part) && part !== context
    && subtreeOf(part).some(p => p !== part && p.meshes.length && p.shown);
  const CHEVRON = '<svg viewBox="0 0 10 10" aria-hidden="true"><path d="M3.5 1.5 7 5l-3.5 3.5"/></svg>';

  function thumb(map) {
    const image = map?.image;
    if (!image || !(image.width > 0)) return '<i class="pc-thumb is-empty"></i>';
    try {
      const canvasEl = document.createElement('canvas');
      canvasEl.width = 28; canvasEl.height = 28;
      canvasEl.getContext('2d').drawImage(image, 0, 0, 28, 28);
      return `<img class="pc-thumb" alt="" src="${canvasEl.toDataURL('image/png')}">`;
    } catch {
      return '<i class="pc-thumb is-empty"></i>';
    }
  }

  function armourChip(id) {
    const info = page.armour.materialInfo(id);
    let damage = '';
    if (info.weapon) {
      damage = info.damage == null || info.immune
        ? `<small>immune to ${esc(info.weapon)}</small>`
        : `<small>${esc(Math.round(info.damage * 10) / 10)} HP from ${esc(info.weapon)}</small>`;
    }
    return `<li><button type="button" class="pc-armour" data-armour="${id}" style="--chip:${info.colour}" title="${esc(info.label)}">`
      + `<i></i><b>${id}</b><span>${esc(info.kind)}</span>${damage}</button></li>`;
  }

  function partButton(part, extra = '') {
    const copy = part.copy > 1 ? ` <i>#${part.copy}</i>` : '';
    return `<button type="button" class="pc-link" data-part="${part.id}">${esc(part.label)}${copy}${extra}</button>`;
  }

  function renderCard() {
    if (!selected.length) { card.hidden = true; card.innerHTML = ''; return; }
    card.hidden = false;
    if (selected.length > 1) {
      card.innerHTML = `<div class="pc-head"><span class="wb-label">${esc(selectionLabel || 'Selected parts')}</span>`
        + `<span class="pc-actions"><button type="button" class="pc-frame" data-frame title="Point the camera at it">${FRAME}<span>Frame</span></button><button type="button" class="pc-close" data-close title="Whole model" aria-label="Back to the whole model">${CLOSE}</button></span></div>`
        + `<nav class="pc-nav" aria-label="Parts visited">`
        + `<button type="button" class="pc-arrow" data-nav="back" title="Back (Alt+Left)" aria-label="Back"${at > 0 ? '' : ' disabled'}>${ARROW_L}</button>`
        + `<button type="button" class="pc-arrow" data-nav="forward" title="Forward (Alt+Right)" aria-label="Forward"${at < history.length - 1 ? '' : ' disabled'}>${ARROW_R}</button>`
        + (siblingsOf(selected[0]) > 1 ? `<span class="pc-sib"><button type="button" class="pc-arrow" data-nav="prev" title="Previous part beside it" aria-label="Previous sibling">${UP}</button>`
          + `<button type="button" class="pc-arrow" data-nav="next" title="Next part beside it" aria-label="Next sibling">${DOWN}</button></span>` : '')
        + (canTakeApart(selected[0]) ? `<button type="button" class="pc-frame pc-apart" data-apart title="Show only this part, its pieces spread out">${APART}<span>Take apart</span></button>` : '')
        + `</nav>`
        + `<div class="pc-name">${selected.length} parts</div>`
        + `<ul class="pc-list">${selected.map(p => `<li>${partButton(p, `<small>${esc(p.kind)}</small>`)}</li>`).join('')}</ul>`;
      return;
    }
    const part = selected[0];
    const { moves, notes } = describePart(part, report);
    const chain = chainOf(part).map((p, i, all) => (i === all.length - 1
      ? `<b>${esc(p.label)}</b>` : partButton(p))).join(CHEVRON);
    const facts = [
      ['Mesh file', part.geometry || (part.meshes.length ? 'none named' : 'no mesh')],
      ['Triangles', part.triangles ? part.triangles.toLocaleString() : '0'],
      ['Collision', part.collisionMeshes.length
        ? `${part.collisionTriangles.toLocaleString()} triangles` : 'none'],
    ];
    const mats = part.renderMaterials.map(m => {
      const map = part.meshes.flatMap(mesh => [mesh.material].flat())
        .find(material => (material.name || '') === m.name)?.map;
      return `<li title="${esc(m.name)}">${thumb(map)}<span><b>${m.number === null ? esc(m.name) : `Material${m.number}`}</b>`
        + `<small>${esc(m.texture ? textureLabel(m.texture) : 'no texture')}</small></span></li>`;
    }).join('');
    card.innerHTML = `<div class="pc-head"><span class="wb-label">Part</span>`
      + `<span class="pc-actions"><button type="button" class="pc-frame" data-frame title="Point the camera at it">${FRAME}<span>Frame</span></button><button type="button" class="pc-close" data-close title="Whole model" aria-label="Back to the whole model">${CLOSE}</button></span></div>`
      + `<nav class="pc-nav" aria-label="Parts visited">`
        + `<button type="button" class="pc-arrow" data-nav="back" title="Back (Alt+Left)" aria-label="Back"${at > 0 ? '' : ' disabled'}>${ARROW_L}</button>`
        + `<button type="button" class="pc-arrow" data-nav="forward" title="Forward (Alt+Right)" aria-label="Forward"${at < history.length - 1 ? '' : ' disabled'}>${ARROW_R}</button>`
        + (siblingsOf(selected[0]) > 1 ? `<span class="pc-sib"><button type="button" class="pc-arrow" data-nav="prev" title="Previous part beside it" aria-label="Previous sibling">${UP}</button>`
          + `<button type="button" class="pc-arrow" data-nav="next" title="Next part beside it" aria-label="Next sibling">${DOWN}</button></span>` : '')
        + (canTakeApart(selected[0]) ? `<button type="button" class="pc-frame pc-apart" data-apart title="Show only this part, its pieces spread out">${APART}<span>Take apart</span></button>` : '')
        + `</nav>`
      + `<div class="pc-name">${esc(part.label)}${part.copy > 1 ? ` <i>copy ${part.copy}</i>` : ''}</div>`
      + `<div class="pc-kind">${esc(part.kind)}</div>`
      + `<nav class="pc-chain" aria-label="Parents">${chain}</nav>`
      + `<dl class="pc-facts">${facts.map(([k, v]) => `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>`
      + (mats ? `<div class="detail-label">Render materials</div><ul class="pc-mats">${mats}</ul>` : '')
      + (part.armour.length ? `<div class="detail-label">Armour on its hull</div><ul class="pc-armours">${part.armour.map(armourChip).join('')}</ul>` : '')
      + (moves.length ? `<div class="detail-label">What moves it</div><ul class="pc-lines">${moves.map(l => `<li>${esc(l)}</li>`).join('')}</ul>` : '')
      + (notes.length ? `<ul class="pc-lines pc-notes">${notes.map(l => `<li>${esc(l)}</li>`).join('')}</ul>` : '')
      + (part.children.length ? `<div class="detail-label">Children</div><ul class="pc-list">${part.children.map(c => `<li>${partButton(c, `<small>${esc(c.kind)}</small>`)}</li>`).join('')}</ul>` : '');
  }

  function onPanelClick(event) {
    // Closing the card is the same as Whole model, always.
    if (event.target.closest('[data-close]')) { wholeModel(); return; }
    if (event.target.closest('[data-frame]')) { frameSelection(); return; }
    if (event.target.closest('[data-apart]')) { takeApartAction(); return; }
    const nav = event.target.closest('[data-nav]');
    if (nav) {
      ({ back, forward, prev: () => sibling(-1), next: () => sibling(1) })[nav.dataset.nav]();
      return;
    }
    const link = event.target.closest('[data-part]');
    if (link) {
      const part = index.parts[Number(link.dataset.part)];
      if (part) select([part], { source: link.closest('#tree') ? 'tree' : 'card' });
      return;
    }
    const armourChipButton = event.target.closest('[data-armour]');
    if (armourChipButton) {
      const id = Number(armourChipButton.dataset.armour);
      select(partsWithArmour(index, id), { source: 'card', label: `Armour material ${id}` });
    }
  }
  card.addEventListener('click', onPanelClick);
  legendParts.addEventListener('click', onPanelClick);

  // --- The tree ---------------------------------------------------------------

  const rowOf = part => (part ? tree.querySelector(`.pt-row[data-part="${part.id}"]`) : null);

  function renderTree() {
    const rows = [];
    const visible = part => part.shown;
    const roots = index.parts.filter(p => !p.parent && visible(p));
    const walk = (part, depth) => {
      const kids = part.children.filter(visible);
      const open = depth < 3;
      rows.push(`<li role="treeitem" aria-expanded="${kids.length ? String(open) : 'false'}"${kids.length ? '' : ' data-leaf'}>`
        + `<div class="pt-row" data-part="${part.id}" style="--depth:${depth}">`
        + (kids.length ? `<button type="button" class="pt-caret" data-toggle aria-label="Expand or collapse">${CHEVRON}</button>` : '<i class="pt-caret"></i>')
        + `<button type="button" class="pt-name" data-part="${part.id}">${esc(part.label)}${part.copy > 1 ? ` <i>#${part.copy}</i>` : ''}</button>`
        + `<small>${esc(part.kind)}${part.triangles ? ` · ${part.triangles.toLocaleString()} tris` : ''}${part.armour.length ? ` · armour ${part.armour.join(', ')}` : ''}</small>`
        + '</div>');
      if (kids.length) {
        rows.push('<ul role="group">');
        kids.forEach(kid => walk(kid, depth + 1));
        rows.push('</ul>');
      }
      rows.push('</li>');
    };
    roots.forEach(root => walk(root, 0));
    tree.innerHTML = rows.length ? `<ul role="tree" aria-label="Part tree">${rows.join('')}</ul>`
      : '<p class="note">This model has no template nodes.</p>';
  }

  function markTree() {
    for (const row of tree.querySelectorAll('.pt-row.is-selected, .pt-row.is-context, .pt-row.is-outside')) {
      row.classList.remove('is-selected', 'is-context', 'is-outside');
    }
    for (const part of selected) rowOf(part)?.classList.add('is-selected');
    if (context) {
      const inside = new Set(subtreeOf(context));
      for (const row of tree.querySelectorAll('.pt-row')) {
        if (!inside.has(index.parts[Number(row.dataset.part)])) row.classList.add('is-outside');
      }
      rowOf(context)?.classList.add('is-context');
    }
  }

  function revealRow(part) {
    const row = rowOf(part);
    if (!row) return;
    for (let li = row.parentElement.parentElement?.closest('li'); li; li = li.parentElement?.closest('li')) {
      li.setAttribute('aria-expanded', 'true');
    }
    // The tree scrolls on its own, so the column stays on the card.
    if (tree.closest('[hidden]')) return;
    const top = row.offsetTop - tree.offsetTop;
    if (top < tree.scrollTop || top > tree.scrollTop + tree.clientHeight - row.offsetHeight) {
      tree.scrollTop = Math.max(0, top - tree.clientHeight / 3);
    }
  }

  /** Bring the card's top into the column's view, under the sticky tabs. */
  function showCard() {
    const aside = card.closest('aside');
    if (!aside || card.hidden) return;
    const tabs = document.getElementById('wb-tabs');
    const cardTop = card.getBoundingClientRect().top - aside.getBoundingClientRect().top + aside.scrollTop;
    aside.scrollTop = Math.max(0, cardTop - (tabs?.offsetHeight || 0) - 18);
  }

  /** Point the camera at what is selected, close enough to read it. */
  function frameSelection() {
    if (!selected.length) return;
    updateBox();
    if (box.isEmpty()) return;
    const centre = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3()).length();
    const camera = page.camera;
    const dir = camera.position.clone().sub(page.controls.target).normalize();
    page.controls.target.copy(centre);
    camera.position.copy(centre).addScaledVector(dir, Math.max(size * 1.6, 1.5));
    page.controls.update();
    page.invalidate();
  }

  tree.addEventListener('click', event => {
    const toggle = event.target.closest('[data-toggle]');
    if (toggle) {
      const li = toggle.closest('li');
      li.setAttribute('aria-expanded', String(li.getAttribute('aria-expanded') !== 'true'));
      return;
    }
    onPanelClick(event);
  });
  tree.addEventListener('mouseover', event => {
    const row = event.target.closest('.pt-row');
    setHover(row ? index.parts[Number(row.dataset.part)] : null);
  });
  tree.addEventListener('mouseleave', () => setHover(null));

  // --- Search -------------------------------------------------------------------

  let lastGroups = [];
  const groupLabel = group => (group.kind === 'armour' ? group.title : `${group.label} ${group.title}`);
  function runSearch() {
    const q = search.value.trim();
    lastGroups = q ? searchParts(index, q) : [];
    results.hidden = !q;
    if (!q) { results.innerHTML = ''; return; }
    if (!lastGroups.length) {
      results.innerHTML = `<p class="note">Nothing on this model matches "${esc(q)}".</p>`;
      return;
    }
    const LIMIT = 24;
    results.innerHTML = lastGroups.map((group, g) => {
      const parts = group.parts.slice(0, LIMIT);
      const more = group.parts.length - parts.length;
      return `<section class="ps-group" data-kind="${group.kind}">`
        + `<button type="button" class="ps-head" data-group="${g}" title="Show these parts">`
        + `<span class="ps-kind">${esc(group.label)}</span><b>${esc(group.title)}</b>`
        + `<span class="ps-count">${group.parts.length} part${group.parts.length === 1 ? '' : 's'}</span></button>`
        + `<ul class="pc-list">${parts.map(p => `<li>${partButton(p, `<small>${esc(p.kind)}</small>`)}</li>`).join('')}</ul>`
        + (more > 0 ? `<p class="note">and ${more} more</p>` : '')
        + '</section>';
    }).join('');
  }
  let searchFrame = 0;
  search.addEventListener('input', () => {
    cancelAnimationFrame(searchFrame);
    searchFrame = requestAnimationFrame(runSearch);
  });
  search.addEventListener('keydown', event => {
    if (event.key === 'Enter' && lastGroups[0]) {
      event.preventDefault();
      select(lastGroups[0].parts, { source: 'search', label: groupLabel(lastGroups[0]) });
    }
  });
  results.addEventListener('click', event => {
    const head = event.target.closest('[data-group]');
    if (head) {
      const group = lastGroups[Number(head.dataset.group)];
      if (group) select(group.parts, { source: 'search', label: groupLabel(group) });
      return;
    }
    onPanelClick(event);
  });

  // --- The armour chips ---------------------------------------------------------

  /** A material chip in Hit regions: list its parts there and pop them out. */
  function onCollisionMaterial(id) {
    if (id === null || id === undefined) {
      legendParts.hidden = true;
      legendParts.innerHTML = '';
      if (selectionLabel.startsWith('Armour material')) deselect();
      return;
    }
    const parts = partsWithArmour(index, id);
    legendParts.hidden = false;
    legendParts.innerHTML = `<div class="detail-label">Parts with armour ${id} <span class="sep">·</span> ${parts.length}</div>`
      + (parts.length ? `<ul class="pc-list">${parts.map(p => `<li>${partButton(p, `<small>${esc(p.kind)}</small>`)}</li>`).join('')}</ul>`
        : '<p class="note">No part of this model carries it.</p>');
    select(parts, { source: 'chip', label: `Armour material ${id}` });
  }

  // --- A new model ----------------------------------------------------------------

  function adoptModel(root, nextReport) {
    focused = [];
    proxies = [];
    moving.clear();
    hiddenMasks = new Map();
    context = null;
    apart = false;
    history = [];
    at = -1;
    cameraHome = null;
    selected = [];
    selectionLabel = '';
    hovered = null;
    page.display.forgetGhost();
    report = nextReport;
    index = buildPartIndex(root);
    page.main.dataset.partSelected = 'false';
    page.main.dataset.builder = 'false';
    page.main.dataset.context = 'whole';
    for (const b of apartButtons) b.disabled = !piecesOf(null).some(p => p.depth > 0);
    syncApartButtons();
    renderCrumbs();
    tag.hidden = true;
    boxHelper.visible = false;
    renderCard();
    renderTree();
    legendParts.hidden = true;
    legendParts.innerHTML = '';
    if (search.value.trim()) runSearch(); else { results.hidden = true; results.innerHTML = ''; }
  }

  /** What the inspector holds, for the headless checks. */
  function getState() {
    const at = part => part && { id: part.id, name: part.name, label: part.label, kind: part.kind };
    return {
      parts: index.parts.length,
      withGeometry: index.parts.filter(hasGeometry).length,
      meshes: index.partOfMesh.size,
      hovered: at(hovered),
      selected: selected.map(at),
      moving: moving.size,
      builder: apart,
      apart,
      context: context ? { id: context.id, name: context.name, label: context.label } : null,
      hidden: hiddenMasks.size,
      history: history.length,
      historyAt: at,
      ghosted: page.display.ghosted,
      tagShown: !tag.hidden,
      cardShown: !card.hidden,
    };
  }

  Object.assign(inspector, {
    adoptModel,
    advance,
    back,
    deselect,
    forward,
    takeApart: takeApartAction,
    upOneLevel,
    wholeModel,
    getState,
    onCollisionMaterial,
    frameSelection,
    pickAt,
    renderFocus,
    search: q => { search.value = q; runSearch(); return lastGroups; },
    select,
    selectNamed: name => {
      const part = index.parts.find(p => p.name === name && hasGeometry(p)) || index.parts.find(p => p.name === name);
      if (part) select([part], { source: 'model' });
      return Boolean(part);
    },
    setHover,
    // The old builder-view names, for the page's own checks.
    startBuilder: () => takeApartAction(null),
    stopBuilder: () => wholeModel(),
  });
  // A getter, not a copied value: Object.assign would read it once.
  Object.defineProperty(inspector, 'index', { get: () => index });
  return inspector;
}
