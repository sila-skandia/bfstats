#!/usr/bin/env node
// Derive a level's composite-ghost specs, hull widths and soldier widths from
// the template graph its load builds.
//
//   node sidecar/ghost/derive-children.mjs --mod bf1942 --level wake [--mode coop] [Template ...]
//
// prints the derived specs (all, or the named templates) of that level, as
// the sidecar computes them (template-table.mjs: the graph is
// bf42/template_table.py's replay of the level load, `object_graph`).
//
// A vehicle's ghost body is the hull's SimpleObjectNetworkable body followed
// by the body of every child networkable in its object tree. Which children,
// in what order, and the template widths inside their bodies are not on the
// wire; they are this file's output, per level (a level can declare its own
// vehicles, LOAD-2, and a mod's are its own). children.mjs serves them to the
// decoders.
//
// THE RULE (features/udp-sidecar/decodes/vehicle-children.md, section 1).
// NetworkManager::_analyseObject 0x0842d2f0 walks the object tree depth-first,
// pre-order, in addTemplate order, pushes each object whose networkable
// component is set and skips a PlayerControlObject child entirely (a seat is a
// descriptor of its own). An object gets a networkable when its class has an
// initNetworkableComp (the letter table below) and setNetworkableComp
// 0x081d70d0 finds its template's networkableInfo non-empty and registered
// (NetworkableInfo.createNewInfo) with the networkableInfoManager.
//
// Then NetworkManager::analyseObject 0x0842d620 folds that list into groups
// and sends one networkable per group (groupNodes below): two objects whose
// templates match under compareProperties 0x0842d3e0 (the same template, or
// two RotationalBundle-family templates with identical rotation limits,
// speeds, accelerations, inputs and automaticReset) are one networkable on
// the wire, unless the networkableInfo is setIsUnique. That is the "missing
// wings" of the earlier fits: a mirror pair of flaps is one R. The same loop
// leaves out an object below the root whose info is setForceNetworkableId
// and a parented Projectile (vehicle-children.md 6.1).
//
// THE WIDTHS, from the binary (decompiled 2026-10-16):
//   gearBits  EngineNetworkable reads readUnsigned(0, getNumberOfGears())
//             (0x08227da0); EngineTemplate's ctor 0x0823efc0 sets +0x360 = 1
//             and setNumberOfGears 0x0823fd10 clamps to [1, 5], so the width
//             is rangedBits(0, clamp(setNumberOfGears ?? 1, 1, 5)): 2 bits for
//             1 or 2 gears (the default), 3 for 3 to 5.
//   mags      FireArmsNetworkable writes value+1 under rangedBits(0, bound+1)
//             (getNetUpdate 0x08228e50) with bound A = template +0x228 and
//             B = +0x234; FireArmsTemplate::makeScript 0x0828e3b0 prints
//             +0x228 as `magSize` and +0x234 as `numOfMag`. So
//             wA = rangedBits(0, magSize + 1), wB = rangedBits(0, numOfMag + 1).
//   hpBits    rangedBits(0, the armour's maximum), which is HP-17's
//             max(min(maxHitPoints, 128), hitPoints), each word ceil'd and
//             10 when the .con never sets it (armorMax below).

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { rangedBits } from '../bitstream.mjs';

// Template class (bf42/template_table.py TEMPLATE_CLASSES, lower case) ->
// networkable letter: the initNetworkableComp at vtable slot +0xcc of each
// class's object (lnxded/vt.py, 2026-10-17; class-map.md section 2):
//   SimpleObject::initNetworkableComp 0x081daaf0 (O) for SimpleObject,
//     Bundle, EntryPoint, SeatObject, AnimatedBundle, SupplyDepot, SpawnPoint,
//     ObjectSpawner, FireArmsBundle, SonarObject, Emitter, EffectBundle,
//     LensFlare, Light, FlagBase, KitPart, ActiveKitPart, Obstacle, AreaObject;
//   RotationalBundle 0x081d85e0 (R) for RotationalBundle, Camera,
//     FloatingBundle, LandingGear, Wing; Engine 0x0823ebe0 (E); Spring
//     0x0824f660 (S); FireArms 0x0828dca0 (F) for FireArms and HandFireArms;
//     Item 0x08295c40 (I) for Item and Flag; Kit 0x08296910 (K); ControlPoint
//     0x08284500 (C); Projectile 0x0831f800 (P); Objective 0x08311440 (B) for
//     the three objectives; BFSoldier 0x0827a1c0 (D); FreeCamera 0x081afc60 (X).
//   None: LodObject and SpriteParticle (their slot +0xcc is another
//     function), Particle (BPlayerObject's, an empty `ret` at 0x081935d0).
// pco.mjs reads E, S, R, F and O; a tree that networks any other letter
// fails its decode rather than misreading it.
export const LETTER = {
  engine: 'E',
  spring: 'S',
  rotationalbundle: 'R', camera: 'R', floatingbundle: 'R', landinggear: 'R', wing: 'R',
  firearms: 'F', handfirearms: 'F',
  simpleobject: 'O', bundle: 'O', entrypoint: 'O', seatobject: 'O', animatedbundle: 'O',
  supplydepot: 'O', spawnpoint: 'O', objectspawner: 'O', firearmsbundle: 'O',
  sonarobject: 'O', emitter: 'O', effectbundle: 'O', lensflare: 'O', light: 'O',
  flagbase: 'O', kitpart: 'O', activekitpart: 'O', obstacle: 'O', areaobject: 'O',
  item: 'I', flag: 'I', kit: 'K', controlpoint: 'C', projectile: 'P', bfsoldier: 'D',
  freecamera: 'X', destroytargetobjectivetemplate: 'B', andcompositeobjectivetemplate: 'B',
  timerobjectivetemplate: 'B',
};

// ---- the graph ------------------------------------------------------------

// The graph bf42/template_table.py `object_graph` prints (sidecar_tid_table.py
// --graph), as the walk reads it: { templates: Map(lcName -> { name, cls (lower
// case), info, props: { op: [args, ...] }, children: [{ name, pos, rot }] }),
// infos: Set(lc) with .unique and .forced }. It is the engine's own: the lines
// the level load runs, a redeclared name's lines configuring nothing (LOAD-1).
export function graphFromJson(json) {
  const templates = new Map();
  for (const [name, cls, info, props, children] of json?.templates ?? []) {
    templates.set(name.toLowerCase(), {
      name, cls: String(cls).toLowerCase(), info: info ?? null, props: props ?? {},
      children: (children ?? []).map(([n, pos, rot]) => ({ name: n, pos: pos ?? null, rot: rot ?? null })),
    });
  }
  const infos = new Set((json?.infos ?? []).map((s) => s.toLowerCase()));
  infos.unique = new Set((json?.unique ?? []).map((s) => s.toLowerCase()));
  infos.forced = new Set((json?.forced ?? []).map((s) => s.toLowerCase()));
  return { templates, infos };
}

const num = (t, op, dflt = null) => {
  const v = t?.props[op]?.at(-1)?.[0];
  return v == null ? dflt : Number(v);
};

// ---- the walk -----------------------------------------------------------

// Does object template `t`, below a descriptor's root, carry a networkable
// on the wire? Its class must make one and its networkableInfo be a
// registered one; analyseObject then drops an info that is
// setForceNetworkableId (a hand weapon's) and a parented Projectile.
function networkable(t, infos) {
  const letter = LETTER[t.cls];
  if (!letter) return null;
  if (!t.info || !infos.has(t.info.toLowerCase())) return null;
  if (infos.forced?.has(t.info.toLowerCase()) || letter === 'P') return null;
  return letter;
}

// The armour's maximum hit points a template spawns with (HP-17): the
// console stores each word ceil'd, 10 when never set, and the maximum is
// max(min(maxHitPoints, 128), hitPoints).
export function armorMax(t) {
  const word = (op) => { const v = num(t, op, null); return Number.isFinite(v) ? Math.ceil(v) : 10; };
  return Math.max(Math.min(word('maxhitpoints'), 128), word('hitpoints'));
}
const hasArmor = (t) => !!num(t, 'hasarmor', 0);

// NetworkManager::analyseObject 0x0842d620 does not send the walk's list as
// it stands: it sorts the objects into groups and sends one networkable per
// group, the group's first member, in order of each group's first member.
// An object joins the first group whose first member it matches under
// NetworkManager::compareProperties 0x0842d3e0, unless its NetworkableInfo
// says setIsUnique 1 (getIsUnique, NetworkableInfo vt+0x30), which always
// starts a group of its own (vanilla: SpringInfo alone). Two objects match
// when they share a template, or when their templates are of one class
// (template vt+0xc, the class id) and are RotationalBundleTemplates
// (IID 0x947d: RotationalBundle, Engine, Wing, Camera, LandingGear,
// FloatingBundle) with the same automaticReset (+0x1a4), inputToYaw /
// Pitch / Roll, maxRotation (+0x15c), minRotation (+0x150), maxSpeed (+0x174)
// and acceleration (+0x180), compared as floats.
//
// That is what drops the "missing" wings: the Corsair's two inner flaps
// (LeftMiddle, RightMiddle) and its two elevators (TailLeft, TailRight) are
// mirror pairs that differ only in geometry and setPositionOffset, so each
// pair is one networkable, 5 R from 7 Wings; the Zero's elevators differ in
// maxSpeed (TailRight 0/0/0) and stay two, 6 R from 7.
const RB_CLASSES = new Set(['rotationalbundle', 'engine', 'wing', 'camera', 'landinggear', 'floatingbundle']);
const vec = (t, op, dflt) => {
  const a = t.props[op]?.at(-1)?.[0];
  if (a == null) return dflt;
  const v = a.split('/').map(Number);
  return [0, 1, 2].map((k) => (Number.isFinite(v[k]) ? v[k] : dflt[k]));
};
// The engine's PlayerInput names map to ids; absent is c_PINone (GUN-1).
const input = (t, op) => (t.props[op]?.at(-1)?.[0] ?? 'c_PINone').toLowerCase();
function rbProps(t) {
  return JSON.stringify([
    num(t, 'setautomaticreset', 0) ? 1 : 0,
    input(t, 'setinputtoyaw'), input(t, 'setinputtopitch'), input(t, 'setinputtoroll'),
    vec(t, 'setmaxrotation', [0, 0, 0]), vec(t, 'setminrotation', [0, 0, 0]),
    vec(t, 'setmaxspeed', [1, 1, 1]), vec(t, 'setacceleration', [0.1, 0.1, 0.1]),
  ]);
}
export function sameProperties(a, b) {
  if (a.tmpl === b.tmpl) return true;
  if (a.cls !== b.cls || !RB_CLASSES.has(a.cls)) return false;
  return rbProps(a.tmpl) === rbProps(b.tmpl);
}
function groupNodes(nodes, infos) {
  const groups = [];
  for (const n of nodes) {
    const unique = graphInfoUnique(infos, n.tmpl.info);
    const g = unique ? null : groups.find((gr) => sameProperties(gr[0], n));
    if (g) { g.push(n); n.groupedWith = g[0].name; } else groups.push([n]);
  }
  return groups.map((g) => ({ ...g[0], members: g.length > 1 ? g.map((n) => n.name) : undefined }));
}
function graphInfoUnique(infos, name) {
  return infos.unique?.has((name || '').toLowerCase()) ?? false;
}

// Walk `rootName`'s tree. Returns the descriptor of the root (its child
// networkables, the root itself excluded) and the seats (nested
// PlayerControlObjects, DFS pre-order, each a descriptor of its own).
export function walk(graph, rootName) {
  const { templates, infos } = graph;
  const root = templates.get(rootName.toLowerCase());
  if (!root) return null;
  const seats = [];
  const missing = new Set();
  function visit(t, out, depth, place, parentNode) {
    for (const c of t.children) {
      const ct = templates.get((c.name || '').toLowerCase());
      if (!ct) { missing.add(c.name); continue; }
      if (ct.cls === 'playercontrolobject') {
        const seat = { name: ct.name, nodes: [] };
        seats.push(seat);
        visit(ct, seat.nodes, depth + 1, c, null);
        continue;
      }
      if (depth > 40) continue;
      const letter = networkable(ct, infos);
      const node = letter ? { letter, name: ct.name, cls: ct.cls, tmpl: ct, rot: c.rot, parent: parentNode } : null;
      if (node) out.push(node);
      visit(ct, out, depth + 1, c, node ?? parentNode);
    }
  }
  const nodes = [];
  visit(root, nodes, 0, null, null);
  for (const seat of seats) seat.nodes = groupNodes(seat.nodes, infos);
  return { root, nodes: groupNodes(nodes, infos), seats, missing: [...missing] };
}

// ---- the spec -----------------------------------------------------------

function gunSpec(graph, name) {
  const t = graph.templates.get(name.toLowerCase());
  const magSize = num(t, 'magsize', -1);
  const numOfMag = num(t, 'numofmag', -1);
  const rof = num(t, 'roundoffire', null);
  const positions = (t.props.addfirearmsposition ?? []).length;
  const async = num(t, 'setasynchronyfire', 0);
  return {
    mag: [rangedBits(0, magSize + 1), rangedBits(0, numOfMag + 1)],
    rof, muzzles: positions >= 2 && !async ? positions : 1, magSize, numOfMag,
  };
}

// The turning parts the replay drives, for the R children that carry a gun:
// each R that is an ancestor of an F in the same descriptor, in R order, as
// [name, role] with role from the input it is bound to (yaw: setInputToYaw,
// otherwise pitch). Only emitted when those R's are the descriptor's first
// R's, the yaw before the pitch, since the replay pairs parts[i] with the
// i-th R and takes its aim from parts[0] (yaw) and parts[1] (pitch).
function jointParts(graph, nodes) {
  const rs = nodes.filter((n) => n.letter === 'R');
  const gunRs = new Set();
  for (const n of nodes) {
    if (n.letter !== 'F') continue;
    for (let p = n.parent; p; p = p.parent) if (p.letter === 'R') gunRs.add(p.name);
  }
  if (!gunRs.size) return null;
  const parts = [];
  for (let i = 0; i < rs.length && parts.length < gunRs.size; i++) {
    if (!gunRs.has(rs[i].name)) return null;
    const t = graph.templates.get(rs[i].name.toLowerCase());
    const role = t.props.setinputtoyaw ? 'yaw' : 'pitch';
    // A yaw part placed turned about the vertical starts from that turn,
    // in (-180, 180]: the M3A1's .50 holder, placed at -180, rests at 180.
    let rest = role === 'yaw' && rs[i].rot ? Math.round(rs[i].rot[0]) : 0;
    rest = ((rest % 360) + 360) % 360;
    if (rest > 180) rest -= 360;
    parts.push(rest ? [rs[i].name, role, rest] : [rs[i].name, role]);
  }
  if (parts.length < 2 || parts[0][1] !== 'yaw' || parts[1][1] !== 'pitch') return null;
  return parts;
}

function descriptorSpec(graph, nodes) {
  const children = nodes.map((n) => n.letter);
  const guns = nodes.filter((n) => n.letter === 'F').map((n) => n.name);
  const gs = guns.map((g) => gunSpec(graph, g));
  const engine = nodes.find((n) => n.letter === 'E');
  const spec = { children, nodes: nodes.map((n) => (n.members ? n.members.join('=') : n.name)) };
  if (engine) {
    const et = graph.templates.get(engine.name.toLowerCase());
    const gears = Math.min(5, Math.max(1, num(et, 'setnumberofgears', 1)));
    spec.gearBits = rangedBits(0, gears);
    spec.gears = gears;
  }
  // An 'O' child's own widths: its hit points are rangedBits(0, maxHp) of
  // its own armour and absent (0 bits) without one (the CorsairComplex
  // bundle: 27 full-state Corsair bodies read to the last bit only so);
  // its controller vectors follow its own hasMobilePhysics.
  const objs = nodes.filter((n) => n.letter === 'O').map((n) => {
    const t = n.tmpl;
    return { hpBits: hasArmor(t) ? rangedBits(0, armorMax(t)) : 0, mobile: !!num(t, 'hasmobilephysics', 0) };
  });
  if (objs.length) spec.objects = objs;
  if (guns.length) {
    spec.mags = gs.map((g) => g.mag);
    spec.rof = gs.map((g) => g.rof ?? 0);
    spec.guns = guns;
    if (gs.some((g) => g.muzzles > 1)) spec.muzzles = gs.map((g) => g.muzzles);
  }
  return spec;
}

export function deriveSpec(graph, name) {
  const w = walk(graph, name);
  if (!w) return null;
  const spec = descriptorSpec(graph, w.nodes);
  spec.gearBits ??= 2;
  spec.hpBits = rangedBits(0, armorMax(w.root));
  spec.template = w.root.name;
  const joints = {};
  const j0 = jointParts(graph, w.nodes);
  if (j0) joints[0] = j0;
  const seats = {};
  w.seats.forEach((s, i) => {
    const ss = descriptorSpec(graph, s.nodes);
    ss.seat = s.name;
    seats[i + 1] = ss;
    const js = jointParts(graph, s.nodes);
    if (js) joints[i + 1] = js;
  });
  if (Object.keys(seats).length) spec.seats = seats;
  if (Object.keys(joints).length) spec.joints = joints;
  if (w.missing.length) spec.missing = w.missing;
  return spec;
}

// ---- a level --------------------------------------------------------------

// Where each named part's pivot sits at rest in the root's frame: the sum of
// the setPosition offsets down its addTemplate chain (exact while the chain
// has no rest rotation, as the turret parts have none), the first placement
// of the name in depth-first order. A gun fires from its pitch part's pivot
// (ghost-writer.mjs _muzzle): the client's own rounds leave a Sherman at
// (0, 1.15, 0.77) in the hull's frame, ShermanGunBase's place.
export function partPivots(graph, root, names) {
  const want = new Set([...names].map((n) => n.toLowerCase()));
  const out = {};
  const seen = new Set();
  (function visit(t, at, depth) {
    if (depth > 40 || seen.has(t)) return;
    seen.add(t);
    for (const c of t.children) {
      const ct = graph.templates.get((c.name || '').toLowerCase());
      const p = c.pos ?? [0, 0, 0];
      const here = [at[0] + (p[0] || 0), at[1] + (p[1] || 0), at[2] + (p[2] || 0)];
      const name = ct?.name ?? c.name;
      if (want.has((c.name || '').toLowerCase()) && !(name in out)) out[name] = here.map((v) => +v.toFixed(3));
      if (ct) visit(ct, here, depth + 1);
    }
    seen.delete(t);
  })(root, [0, 0, 0], 0);
  return out;
}

// The aim limit a soldier body's aim field is scaled by: max(|a|, |b|) of
// the template's pair (setNetUpdate 0x08224e40; soldier-ghost.mjs), null
// when the .con never sets it.
function limit(t, op) {
  const args = t.props[op]?.at(-1);
  if (!args?.length) return null;
  const v = args.slice(0, 2).map(Number).filter(Number.isFinite).map(Math.abs);
  return v.length ? Math.max(...v) : null;
}

/**
 * Everything a level's ghost bodies take from its templates, from the graph
 * its load builds (`object_graph`):
 *   specs     { hull template: deriveSpec } for every PlayerControlObject;
 *   hulls     { template: { maxHp, mobile?: false, parts? } } for every
 *             armoured template read by SimpleObjectNetworkable (a hull, an
 *             'O' object): maxHp sizes its hit point field (HP-17), mobile
 *             is its hasMobilePhysics bit (clear: a StaticPhysicsNode, PHY-17,
 *             which sends no controller vectors), parts the pivots of its
 *             turning parts;
 *   soldiers  { template: { maxHp, aimTwist, aimPitch } } for every BFSoldier.
 */
export function deriveLevel(json) {
  const graph = graphFromJson(json);
  const specs = {}, hulls = {}, soldiers = {};
  for (const t of graph.templates.values()) {
    if (t.cls === 'bfsoldier') {
      soldiers[t.name] = { maxHp: armorMax(t), aimTwist: limit(t, 'setturnleftrightangle'), aimPitch: limit(t, 'setpointupdownangle') };
      continue;
    }
    const pco = t.cls === 'playercontrolobject';
    const spec = pco ? deriveSpec(graph, t.name) : null;
    if (spec) specs[t.name] = spec;
    if (!hasArmor(t) || !(pco || LETTER[t.cls] === 'O')) continue;
    const hull = { maxHp: armorMax(t) };
    if (!num(t, 'hasmobilephysics', 0)) hull.mobile = false;
    if (spec) {
      const names = new Set();
      const w = walk(graph, t.name);
      for (const n of [...w.nodes, ...w.seats.flatMap((seat) => seat.nodes)]) if (n.letter === 'R') names.add(n.name);
      const parts = names.size ? partPivots(graph, t, names) : null;
      if (parts && Object.keys(parts).length) hull.parts = parts;
    }
    hulls[t.name] = hull;
  }
  return { specs, hulls, soldiers };
}

// ---- main ---------------------------------------------------------------

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const argv = process.argv.slice(2);
  const opt = (k, d = null) => { const i = argv.indexOf(k); return i >= 0 ? argv.splice(i, 2)[1] : d; };
  const mod = opt('--mod', 'bf1942'), level = opt('--level'), mode = opt('--mode', 'conquest');
  if (!level) { console.error('usage: node derive-children.mjs --mod <mod> --level <level> [--mode <mode>] [Template ...]'); process.exit(2); }
  // Not awaited at the top level: template-table.mjs imports this module.
  import('../template-table.mjs').then(({ levelTemplates }) => {
    const t = levelTemplates({ mod, level, mode });
    if (!t) process.exit(1);
    const pick = (o) => (argv.length ? Object.fromEntries(argv.map((n) => [n, o[n] ?? null])) : o);
    console.log(JSON.stringify({ specs: pick(t.specs), hulls: pick(t.hulls), ...(argv.length ? {} : { soldiers: t.soldiers }) }, null, 1));
  });
}
