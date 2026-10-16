// An object's class from its template's NAME, on any level.
//
// The wire names neither: a createObject carries the template's id, its place
// in the server's template table. That table is the level's own load order, so
// ids move between levels (a Sherman is 2916 on Wake and 2914 on El Alamein,
// an M3A1 2790 and 2788), and classes.json's by-id rows, read on Wake, named
// El Alamein's control points after Wake's and sent bodies to the wrong
// readers (live, 2026-10-16). The retail client has the table because it loads
// the templates itself; the sidecar takes the names per level from
// templates/<level>.json (names.mjs, built from a recording of that level)
// and the class from the name:
//
//   1. classes.json's by-template rows, the class map's own evidence;
//   2. hulls.json, every vanilla hull the extracted models declare: a
//      PlayerControlObject whose networkable is SimpleObjectNetworkable;
//   3. the level's control points (its templates/<level>.json cpNames and the
//      baked level's scene.json controlPoints, whose `name` is the template);
//   4. the template families: `...Soldier` a soldier, `..._AT` / `_Assault` /
//      `_Engineer` / `_Medic` / `_Scout` (with a theatre suffix such as
//      `_Desert`) a kit, `...Projectile` a projectile, `...Camera` the spawn
//      screen's camera.

import fs from 'node:fs';

const read = (rel) => { try { return JSON.parse(fs.readFileSync(new URL(rel, import.meta.url), 'utf8')); } catch { return null; } };
const CLASSES = read('./classes.json');
const HULLS = read('./hulls.json') ?? {};

const byName = new Map();
for (const [tmpl, info] of Object.entries(CLASSES?.byTemplate ?? {})) {
  byName.set(tmpl.toLowerCase(), { objectClass: info.objectClass ?? null, networkableClass: info.networkableClass ?? null });
}
const hullNames = new Set(Object.keys(HULLS).map((k) => k.toLowerCase()));

const PCO = { objectClass: 'PlayerControlObject', networkableClass: 'SimpleObjectNetworkable' };
const CP = { objectClass: 'ControlPoint', networkableClass: 'ControlPointNetworkable' };
const SOLDIER = { objectClass: 'BFSoldier', networkableClass: 'BFSoldierNetworkable' };
const KIT = { objectClass: 'Kit', networkableClass: 'KitNetworkable' };
const PROJECTILE = { objectClass: 'Projectile', networkableClass: 'ProjectileNetworkable' };
const CAMERA = { objectClass: 'FreeCamera', networkableClass: 'FreeCameraNetworkable' };
const KIT_RE = /(^|_)(AT|Assault|Engineer|Medic|Scout)(_[A-Za-z]+)?$/i;

/** The control point templates of a level: its saved map's and the baked scene's. */
export function controlPointTemplates(level, cpNames = {}) {
  const out = new Set(Object.keys(cpNames).map((k) => k.toLowerCase()));
  const base = String(level || '').replace(/\/+$/, '').split('/').pop().toLowerCase();
  const scene = base ? read(`../viewer/maps/${base}/scene.json`) : null;
  for (const cp of scene?.controlPoints ?? []) if (cp?.name) out.add(String(cp.name).toLowerCase());
  return out;
}

/** {objectClass, networkableClass} for a template name, or null. */
export function classForTemplate(tmpl, cpTemplates = null) {
  if (!tmpl) return null;
  const key = String(tmpl).toLowerCase();
  if (byName.has(key)) return byName.get(key);
  if (hullNames.has(key)) return PCO;
  if (cpTemplates?.has(key)) return CP;
  if (/soldier$/i.test(tmpl)) return SOLDIER;
  if (/projectile$/i.test(tmpl)) return PROJECTILE;
  if (/camera$/i.test(tmpl)) return CAMERA;
  if (KIT_RE.test(tmpl)) return KIT;
  return null;
}
