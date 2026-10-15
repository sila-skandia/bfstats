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
//             getNumberOfGears), which is a template value and NOT on the wire
//   hpBits    width of the hull hit-point field, rangedBits(0, round(maxHp))
//   mags      for each 'F' in order, the two magazine field widths [wA, wB]
//             that the FireArmsNetworkable reader uses (0 = field read but 0
//             bits wide). wA = rangedBits(0, magSize+1) from the gun template.
//
// The M3A1 is the anchor: S S E S S S S is forced by its two body lengths
// (59 = mask-0 hull 11 + one engine 42 + six springs 6; 108 = 11 + 49 + 48) and
// scores 100% on every record.

export const TEMPLATE_SPECS = {
  M3A1: {
    children: ['S', 'S', 'E', 'S', 'S', 'S', 'S'],
    gearBits: 3, hpBits: 7,
  },
  Daihatsu: {
    children: ['E', 'R', 'R'],
    gearBits: 4, hpBits: 7,
  },
  Sherman: {
    children: ['E', 'S', 'S', 'S', 'S', 'R', 'R', 'F', 'F'],
    gearBits: 3, hpBits: 7,
    mags: [[6, 1], [9, 3]], // ShermanGunBarrel (magSize 30), Coaxial_browning (400)
  },
  Zero: {
    children: ['E', 'R', 'R', 'R', 'R', 'R', 'R', 'F', 'F'],
    gearBits: 2, hpBits: 7,
    mags: [[10, 0], [5, 9]], // ZeroGuns (magSize 900), ZeroBombDummy (15)
  },
  Corsair: {
    children: ['O', 'E', 'R', 'R', 'R', 'R', 'R', 'F', 'F'],
    gearBits: 2, hpBits: 7,
    mags: [[10, 0], [5, 0]], // CorsairGuns (magSize 900), CorsairBombDummy (15)
  },
  'Chi-ha': {
    children: ['R', 'R', 'F', 'F', 'E', 'S', 'S', 'S', 'S'],
    gearBits: 3, hpBits: 7,
    mags: [[6, 1], [9, 3]], // Chi-ha_GunBarrel (30), Coaxial_MG42 (400)
  },
  // LOW CONFIDENCE, UNRESOLVED. Both fixed guns have exactly one record per
  // instance in the corpus (4 instances each, all identical lengths). The
  // sequences below are the .con-derived tree order; they do NOT decode those
  // bodies (265 / 297 bits, hull mask 0x493). 118 different sequences decode
  // AA_Allies' four records and several decode Defgun's, so nothing is forced
  // and these two cannot be pinned from this capture. See the findings doc.
  Defgun: {
    children: ['R', 'R', 'F', 'R', 'R', 'F'],
    gearBits: 4, hpBits: 6,
    mags: [[9, 9], [9, 9]], // DefgunGunBarrel magSize 499
    lowConfidence: true,
  },
  AA_Allies: {
    children: ['R', 'R', 'F', 'R'],
    gearBits: 4, hpBits: 7,
    mags: [[0, 0]], // AA_Allies_GunBarrel magSize -1
    lowConfidence: true,
  },
};

// The child sequence extracted from the template graph, keyed by template name.
export const CHILDREN_BY_TEMPLATE = Object.fromEntries(
  Object.entries(TEMPLATE_SPECS).map(([k, v]) => [k, v.children]),
);

// The M3A1's sequence is the default: it is the one composite template the
// decoder was built around, and the only one proven before this file existed.
export const DEFAULT_TEMPLATE = 'M3A1';

// Look up a template's child spec. An unknown template falls back to the M3A1
// spec (the historical default), so a caller that does not know the object
// still gets a plausible, non-empty decode rather than a hull-only miss.
export function childrenFor(template) {
  return TEMPLATE_SPECS[template] || TEMPLATE_SPECS[DEFAULT_TEMPLATE];
}

// All known specs, in a stable order (M3A1 last so it is the natural default
// tie-break when a body fits more than one sequence).
export function templateNames() {
  return Object.keys(TEMPLATE_SPECS);
}

export default CHILDREN_BY_TEMPLATE;
