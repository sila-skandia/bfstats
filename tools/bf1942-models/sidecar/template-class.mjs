// An object's class, from the template class the level load gave its template.
//
// The wire names neither: a createObject carries the template's id, its place
// in the level's template table. The retail client has the table because it
// loads the templates itself, and so does the sidecar: template-table.mjs
// replays the level load (bf42/template_table.py) and keeps each id's
// template class, the `ObjectTemplate.create <Class>` word as the class
// manager resolves it (TEMPLATE_CLASSES, ledger LOAD-19). The object class
// follows from the template class and the networkable class from the object
// class's initNetworkableComp, the vtable slot +0xcc of each class
// (features/udp-sidecar/decodes/class-map.md section 2; read for every
// registered class with lnxded/vt.py, 2026-10-17):
//
//   SimpleObject::initNetworkableComp 0x081daaf0   SimpleObjectNetworkable
//   RotationalBundle 0x081d85e0                    RotationalBundleNetworkable
//   Engine 0x0823ebe0, Spring 0x0824f660, FireArms 0x0828dca0, Item 0x08295c40,
//   Kit 0x08296910, ControlPoint 0x08284500, Projectile 0x0831f800,
//   Objective 0x08311440, BFSoldier 0x0827a1c0, FreeCamera 0x081afc60
//   PlayerControlObject 0x08316ea0: SimpleObjectNetworkable while the object's
//     +0x50 is 0, which every hull ever captured is (class-map.md section 2;
//     PlayerControlObjectNetworkable's setNetUpdate is an empty `ret`)
//   none: LodObject, SpriteParticle, Particle (an empty `ret`, 0x081935d0)
//
// Only when the table could not be computed does a name stand in for it, and
// then loudly (names.mjs): the level's control points (game-tables.mjs), the
// vanilla hulls of the fallback specs (children.mjs, ghost/derived-specs.json)
// and the template families `...Soldier`, `...Projectile`, `...Camera`, the
// kit roles. classes.json (a Wake capture's net ids) is a test fixture only.

import { fallbackHull } from './ghost/children.mjs';

const NETWORKABLE = {
  SimpleObject: 'SimpleObjectNetworkable', Bundle: 'SimpleObjectNetworkable', EntryPoint: 'SimpleObjectNetworkable',
  SeatObject: 'SimpleObjectNetworkable', AnimatedBundle: 'SimpleObjectNetworkable', SupplyDepot: 'SimpleObjectNetworkable',
  SpawnPoint: 'SimpleObjectNetworkable', ObjectSpawner: 'SimpleObjectNetworkable', FireArmsBundle: 'SimpleObjectNetworkable',
  SonarObject: 'SimpleObjectNetworkable', Emitter: 'SimpleObjectNetworkable', EffectBundle: 'SimpleObjectNetworkable',
  LensFlare: 'SimpleObjectNetworkable', Light: 'SimpleObjectNetworkable', FlagBase: 'SimpleObjectNetworkable',
  KitPart: 'SimpleObjectNetworkable', ActiveKitPart: 'SimpleObjectNetworkable', Obstacle: 'SimpleObjectNetworkable',
  AreaObject: 'SimpleObjectNetworkable', PlayerControlObject: 'SimpleObjectNetworkable',
  RotationalBundle: 'RotationalBundleNetworkable', Camera: 'RotationalBundleNetworkable',
  FloatingBundle: 'RotationalBundleNetworkable', LandingGear: 'RotationalBundleNetworkable', Wing: 'RotationalBundleNetworkable',
  Engine: 'EngineNetworkable', Spring: 'SpringNetworkable',
  FireArms: 'FireArmsNetworkable', HandFireArms: 'FireArmsNetworkable',
  Item: 'ItemNetworkable', Flag: 'ItemNetworkable', Kit: 'KitNetworkable',
  ControlPoint: 'ControlPointNetworkable', Projectile: 'ProjectileNetworkable',
  DestroyTargetObjectiveTemplate: 'ObjectiveNetworkable', ANDCompositeObjectiveTemplate: 'ObjectiveNetworkable',
  TimerObjectiveTemplate: 'ObjectiveNetworkable',
  BFSoldier: 'BFSoldierNetworkable', FreeCamera: 'FreeCameraNetworkable',
  LodObject: null, SpriteParticle: null, Particle: null,
};
const BY_LOWER = new Map(Object.keys(NETWORKABLE).map((k) => [k.toLowerCase(), k]));

/** {objectClass, networkableClass} for a template class (TEMPLATE_CLASSES' spelling, any case), or null. */
export function classFromTemplateClass(cls) {
  if (!cls) return null;
  const objectClass = BY_LOWER.get(String(cls).toLowerCase());
  if (!objectClass) return null;
  return { objectClass, networkableClass: NETWORKABLE[objectClass] };
}

const fam = (cls) => classFromTemplateClass(cls);
const KIT_RE = /(^|_)(AT|Assault|Engineer|Medic|Scout)(_[A-Za-z]+)?$/i;

/** The control point templates of a level: the computed names' (game-tables.mjs) or a recorded table's. */
export function controlPointTemplates(_level, cpNames = {}) {
  return new Set(Object.keys(cpNames ?? {}).map((k) => k.toLowerCase()));
}

/**
 * {objectClass, networkableClass} for a template: its computed template class
 * (`cls`, the level table's) when there is one, else the fallback guesses
 * from its name (`cpTemplates` the level's control points). null when
 * neither knows.
 */
export function classForTemplate(tmpl, cpTemplates = null, cls = null) {
  if (cls) return fam(cls);
  if (!tmpl) return null;
  const key = String(tmpl).toLowerCase();
  if (cpTemplates?.has(key)) return fam('ControlPoint');
  if (fallbackHull(tmpl)) return fam('PlayerControlObject');
  if (/soldier$/i.test(tmpl)) return fam('BFSoldier');
  if (/projectile$/i.test(tmpl)) return fam('Projectile');
  if (/camera$/i.test(tmpl)) return fam('FreeCamera');
  if (KIT_RE.test(tmpl)) return fam('Kit');
  return null;
}
