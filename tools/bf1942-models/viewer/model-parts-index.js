// The part inspector's map of a loaded model (features/mesh-viewer-advanced-tab,
// "Part inspector"): every template node the exporter wrote, the meshes that
// belong to it, what it is made of and what moves it, and the search over all
// of that. Plain objects in, plain objects out: it walks anything shaped like
// a three.js scene graph (`name`, `userData`, `children`, `parent`, `isMesh`,
// `geometry`, `material`) and imports nothing, so a node harness holds it
// (`tests/test_model_parts.py`).
//
// What the glb carries (the exporter's extras, which GLTFLoader puts in
// `userData`): a template node has `templateKind`, `geometry` (the .sm file),
// `control`, and `rig`, `seat`, `physics`, `fireArms` where it has them. Its
// collision mesh is a child node with `collision` and `sourceTemplate`; each
// collision primitive's geometry has `defenseMaterial`. Render materials are
// named `<mesh>_Material<N>` and map a texture named after its .dds.

/** Template kinds the viewer adds for effects and shots: not parts a modder builds. */
export const NOT_PARTS = new Set(['SpriteParticle', 'EffectBundle', 'Projectile', 'Muzzle',
  'MeshParticle', 'PointParticle', 'Emitter']);

const isTemplate = obj => Boolean(obj?.userData?.templateKind) && !NOT_PARTS.has(obj.userData.templateKind);
const isCollisionMesh = obj => Boolean(obj?.isMesh && (obj.geometry?.userData?.collision
  || obj.userData?.collision || obj.parent?.userData?.collision));
const isHelper = obj => Boolean(obj?.userData?.displayHelper);

/** The template node a mesh belongs to: the nearest ancestor (or itself) that is a part. */
export function templateOf(obj) {
  let at = obj;
  while (at) {
    if (isTemplate(at)) return at;
    // An effect or projectile under a gun is the gun's, not a part of its own.
    at = at.parent;
  }
  return null;
}

/** Whether `obj` sits under a node the viewer added for effects (a muzzle flash, a tracer). */
function underEffect(obj) {
  for (let at = obj; at; at = at.parent) {
    if (at.userData?.templateKind && NOT_PARTS.has(at.userData.templateKind)) return true;
  }
  return false;
}

/** `Fletch_hull_M1_Material7` -> 7, or null. */
export function materialNumber(name) {
  const m = /_?Material(\d+)$/i.exec(String(name || ''));
  return m ? Number(m[1]) : null;
}

/** `texture/Fle_base2_Z.dds` -> `Fle_base2_Z`. */
export function textureLabel(name) {
  return String(name || '').replace(/^.*[\\/]/, '').replace(/\.(dds|tga|png|webp|jpg)$/i, '');
}

function triangleCount(geometry) {
  if (!geometry) return 0;
  const index = geometry.index;
  if (index && Number.isFinite(index.count)) return Math.floor(index.count / 3);
  const position = geometry.attributes?.position;
  return position && Number.isFinite(position.count) ? Math.floor(position.count / 3) : 0;
}

function visibleChain(obj, root) {
  for (let at = obj; at && at !== root?.parent; at = at.parent) {
    if (at.visible === false) return false;
  }
  return true;
}

/**
 * Walk `root` once and index its parts. Returns
 * `{ parts, partOfMesh, root }`: `parts` in tree order (parents before
 * children), each
 * `{ id, node, name, kind, depth, parent, children, meshes, collisionMeshes,
 *    geometry, triangles, collisionTriangles, renderMaterials, armour, rig,
 *    seat, fireArms, physics, control, shown }`,
 * and `partOfMesh` from every visual or collision mesh to its part.
 */
export function buildPartIndex(root) {
  const parts = [];
  const byNode = new Map();
  const partOfMesh = new Map();
  if (!root) return { parts, partOfMesh, byNode, root };

  // Parts first, in tree order, so parents come before their children.
  (function walk(obj, parentPart, depth) {
    let part = parentPart;
    let childDepth = depth;
    if (isTemplate(obj) && !underEffect(obj)) {
      const u = obj.userData;
      part = {
        id: parts.length,
        node: obj,
        name: obj.name || u.templateKind,
        kind: u.templateKind,
        depth,
        parent: parentPart,
        children: [],
        meshes: [],
        collisionMeshes: [],
        geometry: u.geometry || null,
        triangles: 0,
        collisionTriangles: 0,
        renderMaterials: [],
        armour: [],
        rig: u.rig || null,
        seat: u.seat || null,
        fireArms: u.fireArms || null,
        physics: u.physics || null,
        control: u.control || null,
        shown: visibleChain(obj, root),
      };
      parts.push(part);
      byNode.set(obj, part);
      parentPart?.children.push(part);
      childDepth = depth + 1;
    }
    for (const child of obj.children || []) walk(child, part, childDepth);
  })(root, null, 0);

  // Then every mesh to the part it belongs to.
  (function walk(obj) {
    if (obj.isMesh && !isHelper(obj) && !underEffect(obj)) {
      const owner = templateOf(obj);
      const part = owner && byNode.get(owner);
      if (part) {
        partOfMesh.set(obj, part);
        if (isCollisionMesh(obj)) {
          part.collisionMeshes.push(obj);
          part.collisionTriangles += triangleCount(obj.geometry);
          const id = obj.geometry?.userData?.defenseMaterial;
          if (Number.isFinite(id) && !part.armour.includes(id)) part.armour.push(id);
        } else {
          part.meshes.push(obj);
          part.triangles += triangleCount(obj.geometry);
          for (const material of [obj.material].flat().filter(Boolean)) {
            if (part.renderMaterials.some(entry => entry.name === material.name)) continue;
            part.renderMaterials.push({
              name: material.name || '',
              number: materialNumber(material.name),
              texture: material.map?.name || material.userData?.texture || '',
            });
          }
        }
      }
    }
    if (isHelper(obj)) return;
    for (const child of obj.children || []) walk(child);
  })(root);

  // three makes node names unique (`Fletcher_cannon`, `Fletcher_cannon_1`);
  // the template is the same one, placed again. Show its own name, and which
  // copy this is.
  const names = new Set(parts.map(part => part.name));
  for (const part of parts) {
    part.armour.sort((a, b) => a - b);
    const m = /^(.*)_(\d+)$/.exec(part.name);
    if (m && names.has(m[1])) {
      part.label = m[1];
      part.copy = Number(m[2]) + 1;
    } else {
      part.label = part.name;
      part.copy = 1;
    }
  }
  return { parts, partOfMesh, byNode, root };
}

/** Root to `part`, inclusive. */
export function chainOf(part) {
  const chain = [];
  for (let at = part; at; at = at.parent) chain.unshift(at);
  return chain;
}

/** `part` and every part under it. */
export function subtreeOf(part) {
  const out = [];
  (function walk(p) { out.push(p); p.children.forEach(walk); })(part);
  return out;
}

/** Whether a part draws anything, or carries a hull: what a search, a pick or the builder can show. */
export const hasGeometry = part => part.meshes.length > 0 || part.collisionMeshes.length > 0;

// --- What moves it ------------------------------------------------------------

const INPUTS = {
  c_PIMouseLookX: 'the mouse, left and right',
  c_PIMouseLookY: 'the mouse, up and down',
  c_PIYaw: 'steering (A and D)',
  c_PIThrottle: 'the throttle (W and S)',
  c_PIPitch: 'pitch (up and down arrows)',
  c_PIRoll: 'roll (left and right arrows)',
  c_PIFire: 'the trigger',
  c_PIAltFire: 'the second trigger',
  c_PIAltSprint: 'the gear key',
};

const VERB = { yaw: 'Yaws', pitch: 'Pitches', roll: 'Rolls' };

const num = value => {
  const n = Number(value);
  return Number.isInteger(n) ? String(n) : n.toFixed(1).replace(/\.0$/, '');
};

/** One line per rig axis: "Yaws with the mouse, left and right: -120 to 120 deg at 45 deg/s". */
export function describeRig(rig) {
  const lines = [];
  for (const [axis, spec] of Object.entries(rig?.axes || {})) {
    const input = INPUTS[spec.input] || (spec.input || '').replace(/^c_PI/, '') || 'its control';
    const verb = VERB[axis] || `Turns (${axis})`;
    if (spec.driver === 'rate') {
      lines.push(`${verb} continuously with ${input}, up to ${num(spec.maxSpeed)} deg/s`);
    } else if (spec.free) {
      lines.push(`${verb} freely with ${input}`);
    } else {
      lines.push(`${verb} with ${input}: ${num(spec.min)} to ${num(spec.max)} deg at ${num(spec.maxSpeed)} deg/s`
        + (rig.automaticReset ? ', springs back' : ''));
    }
  }
  return lines;
}

/**
 * Everything that moves or works this part, in plain words: its rig, a baked
 * clip from the report's `animatedParts` ("Fletcher_Radar continuous yaw 30
 * deg/s"), a seat, a gun and the physics kinds the engine reads.
 */
export function describePart(part, report = null) {
  const moves = describeRig(part.rig);
  const name = part.label || part.name;
  for (const line of report?.animatedParts || []) {
    if (String(line).startsWith(`${name} `)) {
      moves.push(String(line).slice(name.length + 1).replace(/^./, c => c.toUpperCase()));
    }
  }
  const notes = [];
  if (part.seat) {
    const radius = part.seat.entryRadius ? `, enter within ${num(part.seat.entryRadius)} m` : '';
    notes.push(`Seat for ${part.seat.control || part.control || 'its vehicle'}${radius}`);
  }
  if (part.fireArms) {
    const f = part.fireArms;
    const projectile = f.projectile?.template ? `${f.projectile.template} (${f.projectile.kind || 'round'})` : 'its round';
    const rate = Number(f.roundOfFire) ? `, ${num(f.roundOfFire)} rounds/s` : '';
    const speed = Number(f.velocity) ? `, ${num(f.velocity)} m/s` : '';
    notes.push(`Fires ${projectile}${rate}${speed}`);
  }
  if (part.physics && part.kind === 'Engine') notes.push(`Engine: ${part.physics.engineType || 'drives the vehicle'}`);
  if (part.physics && part.kind === 'Wing') notes.push('Wing: lift and steering surface');
  if (part.control && part.depth > 0) notes.push(`Controlled by ${part.control}`);
  return { moves, notes };
}

// --- Search ---------------------------------------------------------------------

export const MATCH_KINDS = Object.freeze([
  { kind: 'armour', label: 'Armour material' },
  { kind: 'render', label: 'Render material' },
  { kind: 'template', label: 'Template' },
  { kind: 'mesh', label: 'Mesh file' },
  { kind: 'texture', label: 'Texture' },
]);

/**
 * Search the parts. A number matches armour material IDs and render material
 * numbers exactly; any text matches template names, mesh files and texture
 * names as a substring (case-insensitive). Returns groups, one per thing
 * matched: `{ kind, label, key, title, parts }`, armour and render materials
 * first. Collision-only parts are searched too.
 */
export function searchParts(index, query) {
  const q = String(query || '').trim();
  if (!q) return [];
  const lower = q.toLowerCase();
  const n = /^\d+$/.test(q) ? Number(q) : null;
  const groups = new Map();
  const add = (kind, key, title, part) => {
    const id = `${kind}:${key}`;
    if (!groups.has(id)) {
      const label = MATCH_KINDS.find(k => k.kind === kind).label;
      groups.set(id, { kind, label, key, title, parts: [] });
    }
    const group = groups.get(id);
    if (!group.parts.includes(part)) group.parts.push(part);
  };
  for (const part of index.parts) {
    if (!hasGeometry(part) && !part.label.toLowerCase().includes(lower)) continue;
    if (n !== null) {
      if (part.armour.includes(n)) add('armour', n, `Armour material ${n}`, part);
      for (const m of part.renderMaterials) {
        if (m.number === n) add('render', m.name, m.name, part);
      }
    }
    if (part.label.toLowerCase().includes(lower)) add('template', part.label, part.label, part);
    if (part.geometry && part.geometry.toLowerCase().includes(lower)) add('mesh', part.geometry, part.geometry, part);
    for (const m of part.renderMaterials) {
      if (m.texture && textureLabel(m.texture).toLowerCase().includes(lower)) {
        add('texture', textureLabel(m.texture), textureLabel(m.texture), part);
      }
    }
  }
  const order = kind => MATCH_KINDS.findIndex(k => k.kind === kind);
  return [...groups.values()].sort((a, b) => order(a.kind) - order(b.kind)
    || String(a.title).localeCompare(String(b.title), undefined, { numeric: true }));
}

/** Every part carrying armour material `id` on its collision mesh. */
export function partsWithArmour(index, id) {
  const n = Number(id);
  return index.parts.filter(part => part.armour.includes(n));
}

// --- Pop-out and the builder view ------------------------------------------------

/**
 * Where a popped part goes, in world space: away from the model's centre
 * through the part's own centre, `share` of the model's size. A part at the
 * centre (a hull) rises instead.
 */
export function popVector(modelCentre, partCentre, modelSize, share = 0.22) {
  const d = [0, 1, 2].map(i => partCentre[i] - modelCentre[i]);
  const length = Math.hypot(...d);
  const dir = length < modelSize * 0.04 ? [0, 1, 0] : d.map(v => v / length);
  // A little lift, so a part beside the hull also clears its deck.
  const lifted = [dir[0], dir[1] + 0.35, dir[2]];
  const l2 = Math.hypot(...lifted);
  return lifted.map(v => (v / l2) * modelSize * share);
}

const easeOut = t => 1 - (1 - t) ** 3;
const easeInOut = t => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2);

/** The pop-out's progress, 0 home .. 1 out, `t` seconds after it started. */
export function popProgress(t, out = true, duration = 0.45) {
  const k = Math.min(1, Math.max(0, t / duration));
  return out ? easeOut(k) : 1 - easeInOut(k);
}

/**
 * The builder view's timing: parts fly out from the root outward, one depth
 * after another, hold, then come home deepest first.
 */
export const BUILDER = Object.freeze({ fly: 0.6, stagger: 0.22, hold: 1.4, back: 0.55 });

/** Seconds the whole builder view lasts for a tree `maxDepth` deep. */
export function builderDuration(maxDepth, timing = BUILDER) {
  const steps = Math.max(1, maxDepth);
  return (steps - 1) * timing.stagger + timing.fly + timing.hold
    + (steps - 1) * timing.stagger + timing.back;
}

/**
 * One part's builder progress (0 home .. 1 out) at `t` seconds: depth 1 leaves
 * first, the root (depth 0) never moves.
 */
export function builderProgress(depth, maxDepth, t, timing = BUILDER) {
  if (depth <= 0) return 0;
  const steps = Math.max(1, maxDepth);
  const leave = (depth - 1) * timing.stagger;
  const outEnd = (steps - 1) * timing.stagger + timing.fly;
  const backStart = outEnd + timing.hold + (steps - depth) * timing.stagger;
  if (t < leave) return 0;
  if (t < backStart) return easeOut(Math.min(1, (t - leave) / timing.fly));
  return 1 - easeInOut(Math.min(1, (t - backStart) / timing.back));
}
