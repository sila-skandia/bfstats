import fs from 'node:fs';
// Per-template child networkable sequences for BF1942 composite (vehicle) ghosts.
//
// A framed action-1 ghost record is a whole NetworkableDescriptor: the hull's
// SimpleObjectNetworkable body followed by the bodies of every child
// networkable in the template tree, concatenated and sharing one bit budget
// (NetworkManager::_analyseObject 0x0842d2f0 walks the object tree depth-first,
// pushes any object whose networkable component is set, and skips
// PlayerControlObject descendants). The sequence of child *types* is a property
// of the template and is NOT on the wire, so it has to come from the template
// graph (`Objects/Vehicles/<type>/Objects.con`, `Physics.con`, `Weapons.con`,
// addTemplate order) and be confirmed against the corpus.
//
// Letters: E engine, S spring, R rotational bundle (RotationalBundle and its
// subclasses Camera/FloatingBundle/LandingGear/Wing), F firearms, O simple
// object (a SimpleObjectNetworkable child — Bundle/EntryPoint/etc. with a
// non-empty networkableInfo).
//
// This file's per-template data was derived and verified on 2026-10-15; see
// features/udp-sidecar/decodes/vehicle-children.md for the evidence, the
// strict score each template reaches, and what is still open.
//
// Fields per template:
//   children  ordered child letters (the tail after the hull)
//   gearBits  width of the engine gear field, rangedBits(0, EngineTemplate::
//             getNumberOfGears), which is a template value and NOT on the wire:
//             setNumberOfGears clamped to [1, 5] (0x0823fd10), default 1 (the
//             ctor 0x0823efc0 writes +0x360 = 1), so 2 bits unless it is set
//   hpBits    width of the hull hit-point field, rangedBits(0, round(maxHp))
//   mags      for each 'F' in order, the two magazine field widths [wA, wB]
//             that the FireArmsNetworkable reader uses: wA = rangedBits(0,
//             magSize + 1) and wB = rangedBits(0, numOfMag + 1) from the gun
//             template (FireArmsTemplate +0x228 / +0x234, getNetUpdate
//             0x08228e50, makeScript 0x0828e3b0).
//   objects   for each 'O', its own { hpBits, mobile }: rangedBits(0,
//             round(maxHp)) of its own armour, 0 bits with none, and its own
//             hasMobilePhysics (pco.mjs readSimpleObject)
//   rof       for each 'F', the gun template's roundOfFire (rounds a second),
//             where known. The magazine counter on the wire steps one round
//             interval (1 / roundOfFire) after the round leaves: a Chi-ha's
//             two shells reached the M3A1 2.90 s and 2.88 s before their
//             counter steps, against 1 / 0.35 = 2.86 s (wire.md section 18).
//
// The M3A1 is the anchor: S S E S S S S is forced by its two body lengths
// (59 = mask-0 hull 11 + one engine 42 + six springs 6; 108 = 11 + 49 + 48) and
// scores 100% on every record.

export const TEMPLATE_SPECS = {
  M3A1: {
    children: ['S', 'S', 'E', 'S', 'S', 'S', 'S'],
    gearBits: 3, hpBits: 7, // setNumberOfGears 4
  },
  Daihatsu: {
    children: ['E', 'R', 'R'],
    // No setNumberOfGears: the EngineTemplate default of 1 gear, 2 bits (the
    // earlier fitted 4 read none of the 78 bodies that set the gear bit).
    // maxHitPoints 150 is 8 bits; callers pass maxHp from hulls.json anyway.
    gearBits: 2, hpBits: 8,
  },
  Sherman: {
    children: ['E', 'S', 'S', 'S', 'S', 'R', 'R', 'F', 'F'],
    gearBits: 3, hpBits: 7,
    // [rangedBits(0, magSize + 1), rangedBits(0, numOfMag + 1)]: the second
    // bound is numOfMag (FireArmsTemplate +0x234, makeScript 0x0828e3b0).
    // The fitted [6, 1], [9, 3] summed to the same 12 bits on the 112
    // full-state bodies and read the coaxial as 291 / 5 rounds; these read
    // 31 / 2 and 401 / 2, the magazines full (magSize + 1, numOfMag + 1).
    mags: [[6, 2], [9, 2]], // ShermanGunBarrel (magSize 30), Coaxial_browning (400); numOfMag 1 each
    rof: [0.35, 12],        // ShermanGunBarrel, Coaxial_browning roundOfFire (the glb's FireArms)
    guns: ['ShermanGunBarrel', 'Coaxial_browning'],
  },
  Zero: {
    children: ['E', 'R', 'R', 'R', 'R', 'R', 'R', 'F', 'F'],
    gearBits: 2, hpBits: 7,
    mags: [[10, 2], [5, 2]], // ZeroGuns (magSize 900), ZeroBombDummy (15); numOfMag 1 each
    rof: [12, 0.2],
    guns: ['ZeroGuns', 'ZeroBombDummy'],
    muzzles: [2, 1],
  },
  Corsair: {
    children: ['O', 'E', 'R', 'R', 'R', 'R', 'R', 'F', 'F'],
    gearBits: 2, hpBits: 7,
    mags: [[10, 2], [5, 2]], // CorsairGuns (magSize 900), CorsairBombDummy (15); numOfMag 1 each
    // CorsairComplex, the 'O', is a Bundle with no armour: its hit points
    // take no bits (the 27 full-state bodies read to the last bit only so).
    objects: [{ hpBits: 0, mobile: true }],
    rof: [12, 0.2],
    guns: ['CorsairGuns', 'CorsairBombDummy'],
    muzzles: [2, 1],
  },
  'Chi-ha': {
    children: ['R', 'R', 'F', 'F', 'E', 'S', 'S', 'S', 'S'],
    gearBits: 3, hpBits: 7,
    mags: [[6, 2], [9, 2]], // Chi-ha_GunBarrel (30), Coaxial_MG42 (400); numOfMag 1 each
    rof: [0.35, 12],        // Chi-ha_GunBarrel, Coaxial_MG42 roundOfFire (the glb's FireArms)
    guns: ['Chi-ha_GunBarrel', 'Coaxial_MG42'],
  },
  // Defgun and AA_Allies were hand guesses (the .con tree order) that read
  // none of their bodies; the derived specs (derived-specs.json: Defgun
  // R R F, AA_Allies R R F R) read every one, so they are no longer here.
};

// Every other vanilla vehicle: derive-children.mjs's output, the same rule
// applied to the whole template graph (features/udp-sidecar/decodes/
// vehicle-children.md section 6). The hand specs above win where both exist;
// the derivation reproduces each of them (tests/test_sidecar_derived_children.py).
let DERIVED = null;
function derived() {
  if (DERIVED === null) {
    try { DERIVED = JSON.parse(fs.readFileSync(new URL('./derived-specs.json', import.meta.url), 'utf8')).specs ?? {}; } catch { DERIVED = {}; }
  }
  return DERIVED;
}
export function derivedSpecs() { return derived(); }

// A template's hull spec: the hand spec, else the derived one, else null.
export function specFor(template) {
  if (!template) return null;
  return TEMPLATE_SPECS[template] ?? derived()[template] ?? null;
}

// A hull's nested PlayerControlObjects (gunner seats) take the netIds straight
// after the hull's own and have no createObject of their own; each is ghosted
// as a descriptor of its own. PlayerControlObjectNetworkable::setNetUpdate is
// an empty `ret`, so the descriptor has NO hull body: it is the seat's child
// tail alone. Keyed by root template, then by the seat's offset from the root.
//
// M3A1 seat 1 (the .50 cal): R R F with the magazine fields 9 and 2 bits wide,
// forced by the corpus: all 112 records of a live seat (lengths 25..91) land on
// exactly the last bit, and no other widths do. The two R bundles are the gun's
// yaw and pitch; magA steps down once per round fired.
const HAND_SEAT_SPECS = {
  M3A1: { 1: { children: ['R', 'R', 'F'], mags: [[9, 2]], rof: [10], guns: ['Browning'] } }, // Browning roundOfFire 10
  // The other hulls' gunner seats are the same R R F (holder yaw, console
  // pitch, the gun), checked on every live record: Sherman +1 36 of 36 (the
  // 37th, 7 bits, is no seat body), Chi-ha +1 1 of 1, Daihatsu +1 17 of 17.
  // Each gun's FireArms gives the widths: magSize 500 -> 9 bits as the .50's.
  Sherman: { 1: { children: ['R', 'R', 'F'], mags: [[9, 2]], rof: [10], guns: ['Browning'] } },
  'Chi-ha': { 1: { children: ['R', 'R', 'F'], mags: [[9, 2]], rof: [15], guns: ['MG42'] } },
  Daihatsu: { 1: { children: ['R', 'R', 'F'], mags: [[9, 2]], rof: [15], guns: ['MG42'] } },
  // The dive bombers' rear gunners: MG42_Air / SBD-6_guns, magSize 600 ->
  // 10 bits, one magazine -> 2; 92 bits on every live record (42 and 8).
  AichiVal: { 1: { children: ['R', 'R', 'F'], mags: [[10, 2]], rof: [12], guns: ['MG42_Air'] } },
  SBD: { 1: { children: ['R', 'R', 'F'], mags: [[10, 2]], rof: [10], guns: ['SBD-6_guns'] } },
};

// The turning parts a template's R children drive, for the replay's joint
// rows (`jn` / `j`, the bf42plus parts the viewer puts on the glb's nodes).
// Keyed by template and seat (0 the hull), in R order: [part name, role,
// rest yaw in degrees (the part's own placement, 0 when absent)]. A
// yaw part turns by its bundle's angleX, a pitch part by angleY on top of the
// yaw part before it (it is that part's child: ShermanGunBase rides
// ShermanTower). Names from a bf42plus recording of Wake's `jn` rows.
const HAND_JOINT_PARTS = {
  // The .50's holder is placed facing back down the hull (a bf42plus
  // recording's first j row for it is a half turn, [0, 1, 0, 0], with the gun
  // at rest), so its yaw starts from 180.
  M3A1: { 1: [['M3A1Browning_Holder', 'yaw', 180], ['M3A1_Browning_console', 'pitch']] },
  Sherman: { 0: [['ShermanTower', 'yaw'], ['ShermanGunBase', 'pitch']], 1: [['shermanBrowning_Holder', 'yaw'], ['sherman_Browning_console', 'pitch']] },
  'Chi-ha': { 0: [['Chi-ha_Tower', 'yaw'], ['Chi-ha_GunBase', 'pitch']], 1: [['Chi-ha_BrowningHolder', 'yaw'], ['Chi-ha_BrowningConsole', 'pitch']] },
  // The hull's two R children are the bow ramp's two leaves, each turning
  // about X by its angleY: the client's own rows lower DaihatsuLanding1 to
  // 65 deg and DaihatsuLanding2 to -115 deg as the ramp drops (Wake,
  // 2026-10-16), the same angles these bundles carry.
  Daihatsu: { 0: [['DaihatsuLanding1', 'pitch'], ['DaihatsuLanding2', 'pitch']], 1: [['DaihatsuMG42Base', 'yaw'], ['DaihatsuMG42Rotation', 'pitch']] },
  AichiVal: { 1: [['AichiValRearBrowningBase', 'yaw'], ['AichiValBrowningRotation', 'pitch']] },
  SBD: { 1: [['SBDBrowningBase', 'yaw'], ['SBDBrowningRotation', 'pitch']] },
};

// The hand seats and joints over the derived ones, seat by seat: a template
// the hand tables do not name takes its derived seats (every nested gunner
// seat's R R F, with its own gun's widths) and its derived turning parts.
function mergeBySeat(hand, key) {
  const out = {};
  for (const [t, spec] of Object.entries(derived())) if (spec[key]) out[t] = { ...spec[key] };
  for (const [t, seats] of Object.entries(hand)) out[t] = { ...(out[t] ?? {}), ...seats };
  return out;
}
export const SEAT_SPECS = mergeBySeat(HAND_SEAT_SPECS, 'seats');
export const JOINT_PARTS = mergeBySeat(HAND_JOINT_PARTS, 'joints');
export { HAND_SEAT_SPECS, HAND_JOINT_PARTS };

export function seatSpecFor(template, seat) {
  return SEAT_SPECS[template]?.[seat] ?? null;
}

// How long before its magazine counter steps a round left gun `index` (the
// index-th 'F') of `template`'s hull (seat 0) or seat: one round interval,
// 0 where the gun's roundOfFire is not recorded here.
// A gun's template name (the client's `w`) and how many rounds one firing
// takes off its counter: a gun with two muzzles (ZeroGuns, CorsairGuns) fires
// both at once and steps its magazine by 2, which the client records as one
// round (27 rounds against a counter that fell by 56, Wake 2026-10-16).
export function gunFor(template, seat, index) {
  const spec = seat ? SEAT_SPECS[template]?.[seat] : specFor(template);
  return { name: spec?.guns?.[index] ?? null, muzzles: spec?.muzzles?.[index] ?? 1 };
}

export function fireLagFor(template, seat, index) {
  const spec = seat ? SEAT_SPECS[template]?.[seat] : specFor(template);
  const rof = spec?.rof?.[index];
  return rof > 0 ? 1 / rof : 0;
}

// The child sequence extracted from the template graph, keyed by template name.
export const CHILDREN_BY_TEMPLATE = Object.fromEntries(
  Object.entries(TEMPLATE_SPECS).map(([k, v]) => [k, v.children]),
);

// The M3A1's sequence is the default for callers that name no template and
// no children (pco.mjs's auto-detection tries it first).
export const DEFAULT_TEMPLATE = 'M3A1';

// Look up a template's child spec: the hand spec, else the derived one.
// A template neither knows returns null (pco.mjs then auto-detects among the
// hand specs). Until derived-specs.json existed every other template fell
// back to the M3A1's spec, which read no body of any other vehicle (30 of 30
// control states of a driven El Alamein Willy failed so).
export function childrenFor(template) {
  return specFor(template);
}

// All known specs, in a stable order (M3A1 last so it is the natural default
// tie-break when a body fits more than one sequence).
export function templateNames() {
  return Object.keys(TEMPLATE_SPECS);
}

export default CHILDREN_BY_TEMPLATE;

// A hull's template values its body depends on (hulls.json, from the
// extracted models: build-hulls.mjs): { maxHp, mobile }. The hit points are
// rangedBits(0, maxHp) wide and a fixed gun (mobile false) sends no
// controller vectors or flag. null when the template has no armour or no model.
let HULLS = null;
export function hullFor(template) {
  if (HULLS === null) {
    try { HULLS = JSON.parse(fs.readFileSync(new URL('../hulls.json', import.meta.url), 'utf8')); } catch { HULLS = {}; }
  }
  return template ? HULLS[template] ?? null : null;
}
