// The part inspector (features/mesh-viewer-advanced-tab, "Part inspector"):
// hover a part of the model to see its template, click to select it and pop
// it out of a ghosted model, read where it comes from on the Model tab's
// card, walk the part tree, search by template, mesh, texture or material,
// and watch the whole model come apart in the builder view.
//
// The map of the model (which template every mesh belongs to, what it is
// made of, the search) is `model-parts-index.js`; the ghost and the part
// positions are `model-display.js` (`setGhost`, `applyPositions`), so the
// pop-out shares the explode spread's code and the opacity slider's depth
// and cut-out handling.

import * as THREE from 'three';
import { BUILDER, buildPartIndex, builderDuration, builderProgress, chainOf, describePart,
         hasGeometry, partsWithArmour, popVector, searchParts, subtreeOf, textureLabel } from './model-parts-index.js';

const TINT = 0xb4c060;          // --mm-kd-elite: the hover tint and the selection box
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
  let builder = null;           // { start, maxDepth, parts: [{ part, depth }] }

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
      const helper = boxHelperAt(i);
      helper.box.makeEmpty();
      for (const p of subtreeOf(part)) {
        for (const mesh of meshesOf(p)) if (shown(mesh)) helper.box.expandByObject(mesh, false);
      }
      helper.visible = !helper.box.isEmpty() && !builder;
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
    if (corner) { tag.style.transform = 'translate(12px, 34px)'; return; }
    const left = Math.min(Math.max(8, x - rect.left + 14), rect.width - tag.offsetWidth - 8);
    const top = Math.min(Math.max(8, y - rect.top + 16), rect.height - tag.offsetHeight - 8);
    tag.style.transform = `translate(${left}px, ${top}px)`;
  }

  // --- Pointer --------------------------------------------------------------

  // A tag pinned by a tap or click stops pointing at its part once the camera
  // moves.
  page.controls.addEventListener('change', () => { if (!pending) tag.hidden = true; });

  const canvas = page.renderer.domElement;
  let pending = null;
  let downAt = null;

  function hoverFrame() {
    const at = pending;
    pending = null;
    if (!at || builder) return;
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
    if (moved > 5 || page.armour.ownsClicks || builder) return;
    const part = pickAt(event.clientX, event.clientY);
    if (!part) { deselect(); return; }
    select([part], { source: 'model' });
    showTag(part, event.clientX, event.clientY, { corner: touch });
  });
  addEventListener('keydown', event => {
    if (event.key !== 'Escape' || !(selected.length || builder)) return;
    if (!document.getElementById('browser')?.hidden) return;
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName) && event.target !== search) return;
    if (builder) stopBuilder(); else deselect();
  });

  // --- Select and pop out ---------------------------------------------------

  const tmp = new THREE.Vector3();
  const tmp2 = new THREE.Vector3();
  const partBox = new THREE.Box3();

  /** Whether popping `part` would lift the whole model (a root or a hull with everything on it). */
  function isWholeModel(part) {
    const total = index.parts.reduce((n, p) => n + p.meshes.length, 0);
    const mine = subtreeOf(part).reduce((n, p) => n + p.meshes.length, 0);
    return total > 0 && mine >= total * 0.9;
  }

  /** The pop-out offset of `part` in its parent's frame, from where it sits now at rest. */
  function popOffsetOf(part, share) {
    const node = part.node;
    const framing = page.framing;
    if (!framing || !node.parent) return null;
    partBox.makeEmpty();
    for (const mesh of meshesOf(part)) partBox.expandByObject(mesh, false);
    if (partBox.isEmpty()) for (const p of subtreeOf(part)) for (const m of meshesOf(p)) partBox.expandByObject(m, false);
    if (partBox.isEmpty()) return null;
    // Measured where the part is now; take its current pop back out.
    const centre = partBox.getCenter(tmp);
    const v = popVector(framing.centre.toArray(), centre.toArray(), framing.radius, share);
    node.parent.updateWorldMatrix(true, false);
    const start = node.parent.worldToLocal(tmp2.copy(centre));
    const end = node.parent.worldToLocal(centre.clone().add(new THREE.Vector3(...v)));
    return end.sub(start);
  }

  function moveTo(part, to, seconds) {
    const from = part.node.userData.popT ?? 0;
    if (from === to && !moving.has(part)) return;
    moving.set(part, { from, to, start: performance.now(), seconds });
    page.startAnimating();
  }

  function settle(part) {
    delete part.node.userData.popOffset;
    delete part.node.userData.popT;
  }

  /**
   * Show `parts`: pop each out of the model (unless it is the whole model)
   * and ghost everything else. `source` says where the pick came from: a pick
   * on the model opens the Model tab and its card; the tree, search and the
   * armour chips keep the tab they are on.
   */
  function select(parts, { source = 'model', label = '' } = {}) {
    if (builder) stopBuilder(true);
    const next = [...new Set(parts.filter(Boolean))];
    for (const part of selected) if (!next.includes(part)) moveTo(part, 0, BACK_SECONDS);
    selected = next;
    selectionLabel = label;
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
    const keep = new Set();
    for (const part of selected) for (const p of subtreeOf(part)) for (const mesh of p.meshes) keep.add(mesh);
    page.display.setGhost(selected.length && keep.size ? keep : null);
    page.main.dataset.partSelected = String(selected.length > 0);
    renderCard();
    markTree();
    if (source === 'model' && selected.length) page.workbench.select('model', { remember: false });
    if (selected.length) revealRow(selected[0]);
    if (source === 'model' && selected.length) showCard();
    updateBox();
    page.invalidate();
  }

  function deselect() {
    if (!selected.length) { tag.hidden = true; return; }
    for (const part of selected) moveTo(part, 0, BACK_SECONDS);
    selected = [];
    selectionLabel = '';
    page.main.dataset.partSelected = 'false';
    tag.hidden = true;
    renderCard();
    markTree();
    updateBox();
    // The ghost lifts once the parts are home (`advance`).
    if (!moving.size) page.display.setGhost(null);
  }

  // --- The builder view -------------------------------------------------------

  /** Parts with geometry, each with how many geometry-carrying parts sit above it. */
  function builderParts() {
    const out = [];
    let maxDepth = 0;
    for (const part of index.parts) {
      if (!part.shown || !part.meshes.length) continue;
      let depth = 0;
      for (let at = part.parent; at; at = at.parent) if (at.meshes.length) depth += 1;
      maxDepth = Math.max(maxDepth, depth);
      out.push({ part, depth });
    }
    return { parts: out, maxDepth };
  }

  function startBuilder() {
    if (builder) { stopBuilder(); return; }
    deselect();
    for (const part of [...moving.keys()]) { settle(part); moving.delete(part); }
    page.display.setGhost(null);
    const { parts, maxDepth } = builderParts();
    if (!parts.length || maxDepth === 0) return;
    // Measured with everything home, from the root outward.
    page.display.applyPositions();
    for (const { part, depth } of parts) {
      if (depth === 0) continue;
      const offset = popOffsetOf(part, 0.12 + 0.04 * Math.min(depth, 4));
      if (offset) { part.node.userData.popOffset = offset; part.node.userData.popT = 0; }
    }
    builder = { start: performance.now(), maxDepth, parts };
    page.main.dataset.builder = 'true';
    for (const b of builderButtons) b.setAttribute('aria-pressed', 'true');
    setHover(null);
    tag.hidden = true;
    updateBox();
    page.startAnimating();
  }

  function stopBuilder(now = false) {
    if (!builder) return;
    if (now) {
      for (const { part } of builder.parts) settle(part);
      builder = null;
      page.display.applyPositions();
    } else {
      // Skip to the reassembly.
      const t = (performance.now() - builder.start) / 1000;
      const full = builderDuration(builder.maxDepth);
      const back = full - ((builder.maxDepth - 1) * BUILDER.stagger + BUILDER.back);
      if (t < back) builder.start -= (back - t) * 1000;
      page.startAnimating();
      return;
    }
    page.main.dataset.builder = 'false';
    for (const b of builderButtons) b.setAttribute('aria-pressed', 'false');
    updateBox();
  }

  for (const b of builderButtons) b.addEventListener('click', startBuilder);

  /** One animation frame: the pops in flight and the builder. True while anything moves. */
  function advance() {
    if (!moving.size && !builder) return false;
    const now = performance.now();
    for (const [part, m] of moving) {
      const k = Math.min(1, (now - m.start) / 1000 / m.seconds);
      const eased = m.to > m.from ? easeOut(k) : easeInOut(k);
      part.node.userData.popT = m.from + (m.to - m.from) * eased;
      if (k >= 1) {
        moving.delete(part);
        if (m.to === 0) settle(part);
      }
    }
    if (builder) {
      const t = (now - builder.start) / 1000;
      for (const { part, depth } of builder.parts) {
        if (part.node.userData.popOffset) part.node.userData.popT = builderProgress(depth, builder.maxDepth, t);
      }
      if (t >= builderDuration(builder.maxDepth)) stopBuilder(true);
    }
    page.display.applyPositions();
    if (!moving.size && !selected.length && page.display.ghosted) page.display.setGhost(null);
    if (boxHelper.visible) updateBox();
    return moving.size > 0 || Boolean(builder);
  }

  // --- The card ---------------------------------------------------------------

  const CLOSE = '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3 3l6 6M9 3 3 9"/></svg>';
  const FRAME = '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M1 4V1h3M8 1h3v3M11 8v3H8M4 11H1V8"/><circle cx="6" cy="6" r="1.4"/></svg>';
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
        + `<span class="pc-actions"><button type="button" class="pc-frame" data-frame title="Point the camera at it">${FRAME}<span>Frame</span></button><button type="button" class="pc-close" data-close aria-label="Put the parts back">${CLOSE}</button></span></div>`
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
      + `<span class="pc-actions"><button type="button" class="pc-frame" data-frame title="Point the camera at it">${FRAME}<span>Frame</span></button><button type="button" class="pc-close" data-close aria-label="Put the part back">${CLOSE}</button></span></div>`
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
    if (event.target.closest('[data-close]')) { deselect(); return; }
    if (event.target.closest('[data-frame]')) { frameSelection(); return; }
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
    for (const row of tree.querySelectorAll('.pt-row.is-selected')) row.classList.remove('is-selected');
    for (const part of selected) rowOf(part)?.classList.add('is-selected');
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
    builder = null;
    moving.clear();
    selected = [];
    selectionLabel = '';
    hovered = null;
    page.display.forgetGhost();
    report = nextReport;
    index = buildPartIndex(root);
    page.main.dataset.partSelected = 'false';
    page.main.dataset.builder = 'false';
    for (const b of builderButtons) {
      b.setAttribute('aria-pressed', 'false');
      b.disabled = builderParts().maxDepth === 0;
    }
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
      builder: Boolean(builder),
      ghosted: page.display.ghosted,
      tagShown: !tag.hidden,
      cardShown: !card.hidden,
    };
  }

  Object.assign(inspector, {
    adoptModel,
    advance,
    deselect,
    getState,
    onCollisionMaterial,
    frameSelection,
    pickAt,
    search: q => { search.value = q; runSearch(); return lastGroups; },
    select,
    selectNamed: name => {
      const part = index.parts.find(p => p.name === name && hasGeometry(p)) || index.parts.find(p => p.name === name);
      if (part) select([part], { source: 'model' });
      return Boolean(part);
    },
    setHover,
    startBuilder,
    stopBuilder,
  });
  // A getter, not a copied value: Object.assign would read it once.
  Object.defineProperty(inspector, 'index', { get: () => index });
  return inspector;
}
