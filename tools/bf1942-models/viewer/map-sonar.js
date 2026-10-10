// The sonar and radar scope on the map surfaces: which seat has one, what it
// can sense in the page's world, and the sweep and dots painted over the map.
// The rules are `sonar.js`'s (ledger SONAR-1..SONAR-7); this is the page's
// side of them. Built by `map-surfaces.js`, which hands in what these read:
// `world`, `LOCAL_PLAYER`, `mapVehicles`, `occupancy`, `vehicleSpawnActive`,
// `MAPS_BASE`, `bust`, `sprite` and `drawSprite`.

import * as THREE from 'three';
import { SONAR_TINT, SonarScope, seatSonar, sensedObjects } from './sonar.js';

/** `Minimap/map_dot.tga` is drawn 16 units square (0x41800000 at 0x0046da8f),
 *  the size of a soldier's arrow. */
const DOT_SIZE = 16;

export function createMapSonar(page) {
  const scope = new SonarScope();
  const pos = new THREE.Vector3();
  /** The seat the scope is running for, `hull|seat`, so a change of seat or
   *  hull starts a fresh sweep. */
  let runningFor = '';
  let lastAt = 0;
  /** This frame's scope: the carrier and where every candidate is now, by
   *  id, in the viewer's own x and z. Null when the seat has no scope. */
  let live = null;

  /** The tree's `_shared/vehicle-sonar.json`, fetched once per tree; null
   *  while it is on its way and where the tree has none. */
  const tables = new Map();
  function table() {
    const url = `${page.MAPS_BASE}/_shared/vehicle-sonar.json`;
    if (!tables.has(url)) {
      tables.set(url, null);
      fetch(`${url}${page.bust()}`)
        .then(r => (r.ok ? r.json() : null))
        .then(doc => { if (Array.isArray(doc?.vehicles)) tables.set(url, doc); })
        .catch(() => {});
    }
    return tables.get(url);
  }

  const templateOf = node => node?.userData?.control || node?.name || '';

  function hullOf(root) {
    for (let n = root; n; n = n.parent) if (page.mapVehicles.includes(n)) return n;
    return root;
  }

  /** The local seat's scope: `{ entry, hull }`, or null on foot, in a seat
   *  without `sonarPos`, or on a hull with no SonarObject. */
  function localScope() {
    const occupancy = page.occupancy;
    if (!occupancy?.root) return null;
    const hull = hullOf(occupancy.root);
    const seatNode = occupancy.seatInfo?.(occupancy.activeSeatId)?.node ?? occupancy.root;
    const doc = table();
    const entry = seatSonar(doc, templateOf(hull), templateOf(seatNode));
    return entry ? { entry, hull, speed: doc.rotationSpeed } : null;
  }

  /**
   * Every root object with an Armor but the carrier, in the engine's frame
   * (z north): the hulls on the map, whoever crews them and wrecks included,
   * and the men on foot of both sides. A seated man is a child of his hull
   * and is not a candidate. Destroyable statics carry an Armor too and are
   * not listed yet.
   */
  function candidates(own) {
    const out = [];
    for (const node of page.mapVehicles) {
      if (node === own) continue;
      if (!page.vehicleSpawnActive(node)) continue;
      if (!page.world?.damageableOf?.(node)) continue;
      node.getWorldPosition(pos);
      out.push({ id: `v${node.id}`, x: pos.x, y: pos.y, z: -pos.z });
    }
    for (const [id, player] of page.world?.players ?? []) {
      if (id === page.LOCAL_PLAYER) continue;
      if (player.armor?.destroyed || player.occupancy?.root) continue;
      const s = player.soldier;
      if (!s) continue;
      out.push({ id: `p${id}`, x: s.x, y: s.y ?? 0, z: -s.z });
    }
    return out;
  }

  /** Once per frame, before the surfaces are keyed: run the map updates the
   *  frame owes and remember where everything is for the paint. */
  function tick() {
    const now = performance.now();
    const dt = lastAt ? (now - lastAt) / 1000 : 0;
    lastAt = now;
    const local = localScope();
    if (!local) {
      if (runningFor) scope.reset();
      runningFor = '';
      live = null;
      return;
    }
    const seat = `${local.hull.id}|${local.entry.template}`;
    if (seat !== runningFor) scope.reset();
    runningFor = seat;
    scope.setSpeed(local.speed);
    local.hull.getWorldPosition(pos);
    const self = { x: pos.x, y: pos.y, z: -pos.z };
    const objects = candidates(local.hull);
    scope.update(dt, () => ({
      self,
      sensed: sensedObjects({
        self, radius: local.entry.radius, radarMode: local.entry.radarMode, objects,
      }),
    }));
    const at = new Map();
    for (const object of objects) at.set(object.id, object);
    // A dot follows its object and goes with it (0x0046da33).
    for (const id of scope.blips.keys()) if (!at.has(id)) scope.blips.delete(id);
    live = { self, at };
  }

  /** Changes whenever the paint would: the sweep turns every map update. */
  function key() {
    return live ? `s${Math.round(scope.sweep * 1000)},${scope.blips.size}` : '';
  }

  /**
   * The sweep, centred on the carrier and turned by how far it has swept,
   * then a dot on each lit object at its life for alpha. `projectToArt` and
   * `toPx` are the surface's own; `rot` is the map's turn.
   */
  function draw(ctx, projectToArt, toPx, sc, rot = 0) {
    if (!live) return;
    const here = projectToArt(live.self.x, -live.self.z);
    if (here) {
      const q = toPx(here);
      page.drawSprite(ctx, 'sonar', q.x, q.y, sc, { angle: scope.sweep + rot, tint: SONAR_TINT });
    }
    const dot = page.sprite('map_dot');
    if (!dot) return;
    const dotScale = (sc * DOT_SIZE) / dot.width;
    for (const [id, life] of scope.blips) {
      const object = live.at.get(id);
      const p = object && projectToArt(object.x, -object.z);
      if (!p) continue;
      const q = toPx(p);
      page.drawSprite(ctx, 'map_dot', q.x, q.y, dotScale, { alpha: life, tint: SONAR_TINT });
    }
  }

  return { tick, key, draw, scope, localScope };
}
