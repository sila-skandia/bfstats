#!/usr/bin/env node
// Derive every vanilla vehicle's composite-ghost spec from the template graph.
//
//   node sidecar/ghost/derive-children.mjs [objectsDir] [out.json]
//     objectsDir  the extracted vanilla Objects tree
//                 (default /home/dylan/bf1942-extracted/objects/Objects)
//     out.json    default sidecar/ghost/derived-specs.json
//
// A vehicle's ghost body is the hull's SimpleObjectNetworkable body followed
// by the body of every child networkable in its object tree. Which children,
// in what order, and the template widths inside their bodies are not on the
// wire; they are this file's output. children.mjs keeps the hand-proven specs
// as the override and falls back to the derived ones.
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
// wings" of the earlier fits: a mirror pair of flaps is one R.
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
//   hpBits    rangedBits(0, round(maxHitPoints)) (hulls.json carries the same).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { rangedBits } from '../bitstream.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_OBJECTS = '/home/dylan/bf1942-extracted/objects/Objects';

// Object class -> networkable letter (class-map.md; vehicle-children.md §1).
// LodObject and the particle classes have no initNetworkableComp.
const LETTER = {
  engine: 'E',
  spring: 'S',
  rotationalbundle: 'R', camera: 'R', floatingbundle: 'R', landinggear: 'R', wing: 'R',
  firearms: 'F',
  simpleobject: 'O', bundle: 'O', entrypoint: 'O', seatobject: 'O', animatedbundle: 'O',
  supplydepot: 'O', spawnpoint: 'O', objectspawner: 'O', firearmsbundle: 'O',
  sonarobject: 'O', emitter: 'O', effectbundle: 'O',
};

// ---- the .con reader ------------------------------------------------------

function* conFiles(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* conFiles(p);
    else if (e.name.toLowerCase().endsWith('.con')) yield p;
  }
}

// Parse every .con into { templates: Map(lcName -> tmpl), infos: Set(lc) }.
// A template: { name, cls, file, info, props: {lcCmd: [args]}, children:
// [{ name, pos, rot }] }. A later create of the same name replaces the
// earlier (the template manager keeps the newest); `dups` lists them.
export function readTemplateGraph(objectsDir = DEFAULT_OBJECTS) {
  const templates = new Map();
  const infos = new Set();
  infos.unique = new Set();
  let lastInfo = null;
  const dups = [];
  for (const file of conFiles(objectsDir)) {
    const text = fs.readFileSync(file, 'latin1').replace(/\r/g, '');
    let cur = null;
    let inRem = false;
    for (let line of text.split('\n')) {
      line = line.trim();
      if (!line) continue;
      const lc = line.toLowerCase();
      if (lc.startsWith('beginrem')) { inRem = true; continue; }
      if (lc.startsWith('endrem')) { inRem = false; continue; }
      if (inRem || lc.startsWith('rem')) continue;
      const parts = line.split(/\s+/);
      const cmd = parts[0].toLowerCase();
      const args = parts.slice(1);
      if (cmd === 'networkableinfo.createnewinfo' && args[0]) { infos.add(args[0].toLowerCase()); lastInfo = args[0].toLowerCase(); continue; }
      if (cmd === 'networkableinfo.setisunique' && lastInfo && Number(args[0])) { infos.unique.add(lastInfo); continue; }
      if (!cmd.startsWith('objecttemplate.')) continue;
      const op = cmd.slice('objecttemplate.'.length);
      if (op === 'create') {
        const [cls, name] = args;
        if (!name) { cur = null; continue; }
        const key = name.toLowerCase();
        if (templates.has(key)) dups.push([name, templates.get(key).file, file]);
        cur = { name, cls: cls.toLowerCase(), file, info: null, props: {}, children: [] };
        templates.set(key, cur);
        continue;
      }
      if (op === 'active') { cur = templates.get((args[0] || '').toLowerCase()) ?? null; continue; }
      if (!cur) continue;
      if (op === 'addtemplate') { cur.children.push({ name: args[0], pos: null, rot: null }); continue; }
      // setPosition / setRotation after an addTemplate place that child.
      if ((op === 'setposition' || op === 'setrotation') && cur.children.length) {
        const v = (args[0] || '').split('/').map(Number);
        cur.children[cur.children.length - 1][op === 'setposition' ? 'pos' : 'rot'] = v;
        continue;
      }
      if (op === 'setnetworkableinfo' || op === 'networkableinfo') { cur.info = args[0] ?? ''; continue; }
      (cur.props[op] ??= []).push(args);
    }
  }
  return { templates, infos, dups };
}

const num = (t, op, dflt = null) => {
  const v = t?.props[op]?.at(-1)?.[0];
  return v == null ? dflt : Number(v);
};

// ---- the walk -----------------------------------------------------------

// Does object template `t` carry a networkable on the wire?
function networkable(t, infos) {
  const letter = LETTER[t.cls];
  if (!letter) return null;
  if (!t.info || !infos.has(t.info.toLowerCase())) return null;
  return letter;
}

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
    // A yaw part placed turned about the vertical starts from that turn.
    const rest = role === 'yaw' && rs[i].rot ? Math.round(rs[i].rot[0]) : 0;
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
    const armor = num(t, 'hasarmor', 0);
    const maxHp = num(t, 'maxhitpoints', null) ?? num(t, 'hitpoints', 0);
    return { hpBits: armor ? rangedBits(0, Math.round(maxHp)) : 0, mobile: !!num(t, 'hasmobilephysics', 0) };
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
  const maxHp = num(w.root, 'maxhitpoints', null) ?? num(w.root, 'hitpoints', 100);
  spec.hpBits = rangedBits(0, Math.round(maxHp));
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

// ---- main ---------------------------------------------------------------

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const objectsDir = process.argv[2] ?? DEFAULT_OBJECTS;
  const outPath = process.argv[3] ?? path.join(here, 'derived-specs.json');
  const hulls = JSON.parse(fs.readFileSync(path.join(here, '..', 'hulls.json'), 'utf8'));
  const graph = readTemplateGraph(objectsDir);
  const out = {};
  const notFound = [];
  for (const name of Object.keys(hulls).sort()) {
    const spec = deriveSpec(graph, name);
    if (!spec) { notFound.push(name); continue; }
    out[name] = spec;
  }
  const doc = {
    source: 'sidecar/ghost/derive-children.mjs over the vanilla Objects tree; see features/udp-sidecar/decodes/vehicle-children.md',
    specs: out,
  };
  fs.writeFileSync(outPath, JSON.stringify(doc, null, 1) + '\n');
  console.log(`${Object.keys(out).length} specs -> ${outPath}`);
  if (notFound.length) console.log(`not in the vanilla tree: ${notFound.join(', ')}`);
  if (graph.dups.length) console.log(`${graph.dups.length} duplicate template names (newest kept)`);
}
