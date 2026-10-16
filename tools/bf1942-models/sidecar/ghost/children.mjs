import fs from 'node:fs';
// Per-template child networkable sequences for BF1942 composite (vehicle)
// ghosts, and the other template values a ghost body's layout depends on.
//
// A framed action-1 ghost record is a whole NetworkableDescriptor: the hull's
// SimpleObjectNetworkable body followed by the bodies of every child
// networkable in the template tree, concatenated and sharing one bit budget
// (NetworkManager::_analyseObject 0x0842d2f0 walks the object tree depth-first,
// pushes any object whose networkable component is set, and skips
// PlayerControlObject descendants). The sequence of child *types* is a property
// of the template and is NOT on the wire, so it comes from the template graph
// the level load builds: template-table.mjs replays the load from the install
// (bf42/template_table.py) and derive-children.mjs applies the engine's rule to
// it, per level, for whatever mod the server runs. The body decoder hands each
// SetLevel's result to useLevelTemplates below.
//
// Letters: E engine, S spring, R rotational bundle (RotationalBundle and its
// subclasses Camera/FloatingBundle/LandingGear/Wing), F firearms, O simple
// object (a SimpleObjectNetworkable child — Bundle/EntryPoint/etc. with a
// non-empty networkableInfo).
//
// A spec's fields (derive-children.mjs descriptorSpec / deriveSpec):
//   children  ordered child letters (the tail after the hull)
//   gearBits  width of the engine gear field, rangedBits(0, EngineTemplate::
//             getNumberOfGears): setNumberOfGears clamped to [1, 5]
//             (0x0823fd10), default 1 (the ctor 0x0823efc0), so 2 bits unless set
//   hpBits    width of the hull hit-point field, rangedBits(0, armour max)
//   mags      for each 'F' in order, [rangedBits(0, magSize + 1),
//             rangedBits(0, numOfMag + 1)] (FireArmsTemplate +0x228 / +0x234,
//             getNetUpdate 0x08228e50, makeScript 0x0828e3b0)
//   objects   for each 'O', its own { hpBits, mobile }
//   rof       for each 'F', the gun template's roundOfFire: the magazine counter
//             on the wire steps one round interval after the round leaves
//             (wire.md section 18)
//   guns, muzzles   each 'F''s template name and how many rounds one firing takes
//   seats     each nested PlayerControlObject (a gunner seat), by its netId's
//             offset from the hull's: a descriptor of its own, no hull body
//   joints    by seat, the turning parts its R children drive, for the replay's
//             joint rows: [part name, yaw|pitch, rest yaw]
//
// The six Wake specs once written here by hand (M3A1, Daihatsu, Sherman, Zero,
// Corsair, Chi-ha), the six hand gunner seats and the hand joint rows are what
// the derivation gives, field for field (tests/test_sidecar_template_objects.py),
// with one exception kept below: the Daihatsu hull's ramp leaves.
//
// Without a computed table (no install, no mod known, a level the install
// lacks) the vanilla specs and hulls derived once on this PC are the fallback,
// loudly: ghost/derived-specs.json and ../hulls.json, otherwise test fixtures.

const lower = (o) => new Map(Object.entries(o ?? {}).map(([k, v]) => [k.toLowerCase(), v]));

let LEVEL = null;        // { specs, hulls, soldiers } Maps, the current level's
let LEVEL_LABEL = null;
let FALLBACK = null;
const warned = new Set();
function warnOnce(key, msg) {
  if (warned.has(key)) return;
  warned.add(key);
  console.error(`[children] ${msg}`);
}

function fallback() {
  if (FALLBACK === null) {
    const read = (rel) => { try { return JSON.parse(fs.readFileSync(new URL(rel, import.meta.url), 'utf8')); } catch { return null; } };
    FALLBACK = { specs: lower(read('./derived-specs.json')?.specs), hulls: lower(read('../hulls.json')), soldiers: new Map() };
  }
  return FALLBACK;
}

function current() {
  if (LEVEL) return LEVEL;
  warnOnce(`fallback:${LEVEL_LABEL}`, `FALLBACK: no template table computed from the install${LEVEL_LABEL ? ` for ${LEVEL_LABEL}` : ''}; vehicle bodies use the vanilla specs derived once on this PC (ghost/derived-specs.json, hulls.json)`);
  return fallback();
}

/**
 * The level's layouts, as template-table.mjs levelTemplates returns them
 * ({ specs, hulls, soldiers }), or null when they could not be computed:
 * the vanilla fallback then serves, with a loud line. `label` names the
 * level for that line.
 */
export function useLevelTemplates(t, label = null) {
  LEVEL_LABEL = label;
  LEVEL = t ? { specs: lower(t.specs), hulls: lower(t.hulls), soldiers: lower(t.soldiers) } : null;
}

/** A name the vanilla fallback knows as a hull (template-class.mjs, when no table was computed). */
export function fallbackHull(template) {
  return !!template && fallback().specs.has(String(template).toLowerCase());
}

const key = (template) => (template ? String(template).toLowerCase() : null);

// A template's hull spec, or null (not a PlayerControlObject of this level).
export function specFor(template) {
  const k = key(template);
  return k ? current().specs.get(k) ?? null : null;
}

// A hull's template values its body depends on: { maxHp, mobile, parts }. The
// hit points are rangedBits(0, maxHp) wide (HP-17's maximum) and a fixed gun
// (mobile false: hasMobilePhysics clear, a StaticPhysicsNode, PHY-17) sends no
// controller vectors or flag. null when the template has no armour.
export function hullFor(template) {
  const k = key(template);
  return k ? current().hulls.get(k) ?? null : null;
}

// A soldier template's { maxHp, aimTwist, aimPitch } (soldier-ghost.mjs), or
// null; an aim limit the .con never sets is null.
export function soldierFor(template) {
  const k = key(template);
  return k ? current().soldiers.get(k) ?? null : null;
}

// A hull's nested PlayerControlObjects (gunner seats) take the netIds straight
// after the hull's own and have no createObject of their own; each is ghosted
// as a descriptor of its own. PlayerControlObjectNetworkable::setNetUpdate is
// an empty `ret`, so the descriptor has NO hull body: it is the seat's child
// tail alone. Keyed by the seat's offset from the root.
export function seatSpecFor(template, seat) {
  return specFor(template)?.seats?.[seat] ?? null;
}

// The turning parts a hull's or seat's R children drive, for the replay's
// joint rows (`jn` / `j`): [part name, role, rest yaw in degrees]. A yaw part
// turns by its bundle's angleX, a pitch part by angleY on top of the part
// before it. The derivation names the R's that carry a gun (a turret and its
// gun base, a seat's holder and console), which every recorded `jn` row of
// the corpus agrees with.
//
// Not derivable by that rule: the Daihatsu hull's two R children are its bow
// ramp's leaves, which carry no gun. The client's own rows lower
// DaihatsuLanding1 to 65 deg and DaihatsuLanding2 to -115 deg as the ramp
// drops (Wake, 2026-10-16), each turning about X by its angleY, the second
// riding the first. Which parts the replay should turn is the viewer's
// choice, not an engine fact, so it stays here, applied only where the
// level's Daihatsu has those two R's.
const HAND_JOINT_PARTS = {
  Daihatsu: { 0: [['DaihatsuLanding1', 'pitch'], ['DaihatsuLanding2', 'pitch']] },
};
export function jointPartsFor(template, seat = 0) {
  const spec = specFor(template);
  const hand = Object.entries(HAND_JOINT_PARTS).find(([t]) => t.toLowerCase() === key(template))?.[1]?.[seat];
  if (hand && spec) {
    const d = seat ? spec.seats?.[seat] : spec;
    const rs = (d?.nodes ?? []).filter((_, i) => d.children[i] === 'R').map((n) => n.toLowerCase());
    if (rs.length === hand.length && hand.every(([n], i) => rs[i] === n.toLowerCase())) return hand;
  }
  return spec?.joints?.[seat] ?? null;
}
export { HAND_JOINT_PARTS };

// A gun's template name (the client's `w`) and how many rounds one firing
// takes off its counter: a gun with two muzzles (ZeroGuns, CorsairGuns) fires
// both at once and steps its magazine by 2, which the client records as one
// round (27 rounds against a counter that fell by 56, Wake 2026-10-16).
export function gunFor(template, seat, index) {
  const spec = seat ? seatSpecFor(template, seat) : specFor(template);
  return { name: spec?.guns?.[index] ?? null, muzzles: spec?.muzzles?.[index] ?? 1 };
}

// How long before its magazine counter steps a round left gun `index` (the
// index-th 'F') of `template`'s hull (seat 0) or seat: one round interval,
// 0 where the gun's roundOfFire is not known.
export function fireLagFor(template, seat, index) {
  const spec = seat ? seatSpecFor(template, seat) : specFor(template);
  const rof = spec?.rof?.[index];
  return rof > 0 ? 1 / rof : 0;
}

// Look up a template's child spec. A template the level does not know returns
// null (pco.mjs then auto-detects among the anchor templates).
export function childrenFor(template) {
  return specFor(template);
}

// The templates pco.mjs tries, in order, for a body whose template is not
// known (no createObject seen): the six Wake hulls the specs were first proven
// on, M3A1 last so it is the tie-break when a body fits more than one.
const ANCHORS = ['Daihatsu', 'Sherman', 'Zero', 'Corsair', 'Chi-ha', 'M3A1'];
export const DEFAULT_TEMPLATE = 'M3A1';
export function templateNames() {
  return ANCHORS.filter((t) => anchorSpec(t));
}
// An anchor's spec: the level's, else the vanilla one (an unnamed body on a
// level without that hull is tried against the vanilla layout).
export function anchorSpec(template) {
  return specFor(template) ?? fallback().specs.get(key(template)) ?? null;
}
