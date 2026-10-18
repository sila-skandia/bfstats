// The server's own rounds on the live page: the ordnance a BF1942 server
// flies and ghosts to its clients, and the flash of the vehicle weapon that
// launched it.
//
// A real server sends a client no shot. What it sends is objects: a pool of
// `count` projectiles made with one CreateMultipleObjects (the sidecar's
// `projPool` record, net-sidecar.js), and then a transform row per tick for
// each one that is in the air. Every round the server flies reaches a client
// this way -- a thrown grenade, a laid mine or pack, a tank shell, an
// aircraft's bombs and rockets -- and nothing else announces them. The live
// page had no `projPool` case at all until 2026-10-17, so none of it was ever
// drawn: the owner, flying beside a bomber on retail, saw nothing fall.
//
// This is the live twin of the replay's `replay-props.js`, and it reuses that
// module's reading of the same data:
//
//   * a pooled round waits at the world origin, disabled, and is **somewhere**
//     only once it has been launched (`AT_ORIGIN`), so a pose away from the
//     origin is the whole test for "draw it";
//   * it is drawn with the projectile mesh of the FireArms whose round it is
//     (`roundIn`), found on a model the page has already loaded (a hull's
//     launcher: a Stuka's bomb rack, an Elco80's mines) or on its hand
//     weapon's own glb (`weaponOfProjectile`: `GrenadeAlliesProjectile` is
//     drawn from `GrenadeAllies.glb`);
//   * a round that stops being sent while it was somewhere has gone off, and
//     plays its FireArms' end effect where it last was.
//
// THE MUZZLE FLASH. A seated player sends no soldier animation -- his soldier
// object rides the hull -- and the page's other 'shot' rows are read off that
// animation (net-sidecar.js, the `st` case), so no vehicle weapon of any
// remote has ever flashed on the live page. The word that one fired is the
// sidecar's `f` row: its magazine counter stepping down, with the gun's
// template name and the muzzle it fired from (`ghost-writer.mjs` `_muzzle`).
// That is enough to light the gun's own emitters where the gun is, which is
// what `shot` does here, the way `replay-hulls.js` lights a recorded hull's.

import * as THREE from 'three';
import { clone as skeletonClone } from './vendor/utils/SkeletonUtils.js';
import { loadFirst, modelUrls, weaponUrls } from './pose-bases.js';
import { modelFileStem } from './model-file.js';
import { wearPagePaint } from './level-skin.js';
import { hideDrawnWeapon } from './net-remote-rounds.js';
import { roundIn, trailOf, weaponOfProjectile } from './replay-props.js';
import { recordedLaunch } from './replay-hulls.js';
import { SEAT_GUN_OPTIONS } from './vehicle-instance.js';

/** Metres from the origin inside which a round's pose is its pool's
 *  placeholder rather than a place (replay-props.js). */
const AT_ORIGIN = 1;

/** Clones of one round's mesh kept for the next round of that template: a
 *  kit's pool is 3 to 9, and a pool's ids are reallocated with its kit. */
const SPARES_PER_TEMPLATE = 16;

/** A gun's name without the engine's `_2` mount suffix, lower case
 *  (`replay-hulls.js` `bareName`, which picks a recorded round's group). */
const bareName = (name) => String(name || '').replace(/_\d+$/, '').toLowerCase();

const away = (r) => Math.hypot(r.x, r.y, r.z) >= AT_ORIGIN;

/**
 * ctx: { scene, loader, modelsBase, bust: () => string, guns: () => Guns,
 *        effects?: () => EffectPlayer|null, shadeModel?,
 *        templateOf?: (netId) => string|null }.
 *
 * Returns { pool(row), shot(row), update(client, at), dispose(), debug() }.
 */
export function createServerRounds(ctx) {
  const sources = new Map();   // template (lower) -> Promise<{ scene, endEffect, trail }|null>
  const drawn = new Map();     // netId -> { tmpl, node, endEffect, trail, run, lastAt, shown }
  const spares = new Map();    // template (lower) -> [node]
  const hulls = new Map();     // hull template (lower) -> Promise<{ root, groups }|null>
  // Every template the server has pooled: the rounds it flies itself, which
  // the page must not launch a second copy of from a gun of its own
  // (`replay-props.js` `roundIsRecorded`, the same rule the replay keeps).
  const pooled = new Set();
  const seen = new Set();

  const fx = () => ctx.effects?.() ?? null;

  /** The mesh a round of `tmpl` is drawn with. The page's own scene first,
   *  which holds every model the level has loaded (a launcher's round is part
   *  of the hull that carries it and has no glb of its own), then the hand
   *  weapon the name points at. Cached, misses included: a round whose mesh
   *  is nowhere must not re-walk the scene every throw. */
  function sourceFor(tmpl) {
    const key = String(tmpl || '').toLowerCase();
    if (!key) return Promise.resolve(null);
    if (!sources.has(key)) sources.set(key, findRound(tmpl).catch(() => null));
    return sources.get(key);
  }

  async function findRound(tmpl) {
    const here = roundIn(ctx.scene, tmpl);
    if (here) return dress(here);
    const weapon = weaponOfProjectile(tmpl);
    if (!weapon) return null;
    const gltf = await loadFirst(ctx.loader, weaponUrls(ctx.modelsBase, weapon, ctx.bust()));
    // A glb whose FireArms does not name the round (an older tree's) still
    // carries the one projectile mesh a hand weapon has.
    let first = null;
    gltf.scene.traverse(obj => { if (!first && obj.userData?.projectileMesh) first = obj; });
    const round = roundIn(gltf.scene, tmpl) ?? (first ? { mesh: first, endEffect: null } : null);
    if (round) return dress(round);
    // No mesh of its own (a thrown knife): the trail bundle it flies with,
    // carried by an empty node.
    const trail = trailOf(gltf.scene, tmpl);
    return trail ? { scene: new THREE.Group(), endEffect: null, trail } : null;
  }

  /** A drawable copy of a round's mesh, in the level's paint (LOAD-3). */
  async function dress({ mesh, endEffect }) {
    const scene = mesh.clone(true);
    scene.position.set(0, 0, 0);
    scene.quaternion.identity();
    scene.traverse(obj => { obj.visible = true; });
    ctx.shadeModel?.(scene);
    await wearPagePaint(scene);
    return { scene, endEffect, trail: null };
  }

  function nodeFor(tmpl, source) {
    const key = String(tmpl || '').toLowerCase();
    const free = spares.get(key);
    const node = free?.length ? free.pop() : skeletonClone(source.scene);
    node.name = `server round ${tmpl}`;
    node.visible = false;
    if (!node.parent) ctx.scene.add(node);
    return node;
  }

  function recycle(entry) {
    const key = String(entry.tmpl || '').toLowerCase();
    entry.run?.stop?.();
    entry.run = null;
    if (!entry.node) return;
    entry.node.visible = false;
    const free = spares.get(key) ?? [];
    if (free.length < SPARES_PER_TEMPLATE) { free.push(entry.node); spares.set(key, free); }
    else entry.node.parent?.remove(entry.node);
    entry.node = null;
  }

  /** A round whose object the server has deleted: its pool went with the kit
   *  that carried it (a dead engineer's mines expire with his kit,
   *  unexploded), so it is taken off the field without a blast. */
  function gone(id) {
    const entry = drawn.get(id);
    if (!entry) return;
    recycle(entry);
    drawn.delete(id);
  }

  /** A round the server has stopped placing: it went off where it last was
   *  (its FireArms' end effect, the grenade's `e_ExplGranade`) unless it
   *  never came out of its pool. The live page cannot tell a round that went
   *  off from one that went out of scope the way the replay can (it has no
   *  future to look at), and a blast drawn for a round that flew out of range
   *  is cheaper than every grenade going off in silence. */
  function retire(id) {
    const entry = drawn.get(id);
    if (!entry) return;
    if (entry.shown && entry.endEffect && entry.lastAt) {
      fx()?.play?.(entry.endEffect, { position: entry.lastAt, normal: [0, 1, 0] });
    }
    recycle(entry);
    drawn.delete(id);
  }

  /** A `projPool` row: the templates the server flies itself. */
  function pool(row) {
    if (row?.tmpl) {
      pooled.add(String(row.tmpl).toLowerCase());
      void sourceFor(row.tmpl);   // loaded before the first round is thrown
    }
  }

  /** Draw every round the server is flying, at render time `at`
   *  (performance.now(), as the renderer reads the rest of the snapshot). */
  function update(client, at = null) {
    const rows = client?.serverRounds?.(at);
    if (!rows) return 0;
    seen.clear();
    let shown = 0;
    for (const r of rows) {
      seen.add(r.id);
      if (!away(r)) { retire(r.id); continue; }
      let entry = drawn.get(r.id);
      if (!entry) {
        entry = { tmpl: r.tmpl, node: null, endEffect: null, trail: null, run: null, lastAt: null, shown: false };
        drawn.set(r.id, entry);
        const want = entry;
        void sourceFor(r.tmpl).then(source => {
          // It may have gone off while its mesh was loading.
          if (!source || drawn.get(r.id) !== want || want.node) return;
          want.node = nodeFor(r.tmpl, source);
          want.endEffect = source.endEffect;
          want.trail = source.trail ?? null;
        });
      }
      entry.lastAt = [r.x, r.y, r.z];
      if (!entry.node) continue;
      entry.node.position.set(r.x, r.y, r.z);
      entry.node.quaternion.set(r.q[0], r.q[1], r.q[2], r.q[3]);
      entry.node.visible = true;
      entry.shown = true;
      shown += 1;
      const trail = entry.trail;
      if (trail && !entry.run && fx()?.has?.(trail)) {
        entry.run = fx().play(trail, { attach: { object: entry.node } }) ?? null;
      }
    }
    for (const id of [...drawn.keys()]) if (!seen.has(id)) retire(id);
    return shown;
  }

  // --- the flash of a vehicle's gun ----------------------------------------

  /** The gun groups of a hull template, on a copy of its model that draws
   *  nothing but its emitters, muzzles and rounds: the flash and the report
   *  of a weapon nobody can see fire, laid where the server says it fired
   *  from. One copy per template, shared by every hull of it. */
  function hullGuns(tmpl) {
    const key = String(tmpl || '').toLowerCase();
    if (!key) return Promise.resolve(null);
    if (!hulls.has(key)) {
      hulls.set(key, loadFirst(ctx.loader, modelUrls(ctx.modelsBase, `${modelFileStem(tmpl)}.glb`, ctx.bust()))
        .then(gltf => {
          const guns = ctx.guns();
          if (!guns) return null;
          const root = skeletonClone(gltf.scene);
          root.name = `server gun ${tmpl}`;
          hideDrawnWeapon(root);
          ctx.shadeModel?.(root);
          void wearPagePaint(root);
          ctx.scene.add(root);
          const groups = guns.collect(root, { ...SEAT_GUN_OPTIONS });
          for (const group of groups) {
            group.replay = true;      // drawn, never billed (map.html guns.onImpact)
            group.weapon = tmpl;
            group.view = 'third';
          }
          return { root, groups };
        })
        .catch(() => null));
    }
    return hulls.get(key);
  }

  const _q = new THREE.Quaternion();
  const _fwd = new THREE.Vector3();
  const _at = new THREE.Vector3();
  const _dir = new THREE.Vector3();

  /**
   * Lay the model copy `root` so that its FireArms node `node` stands at the
   * BF1942-frame point `pos` with its gun pointing along `dir` (z negated into
   * the page's frame, as `recordedLaunch` does). The gun's forward is glTF's
   * -Z; the hull is turned by the one rotation that takes that axis onto the
   * round's, and then slid so the gun lands on the muzzle.
   */
  function layGun(root, node, pos, dir) {
    _dir.set(dir[0], dir[1], -dir[2]);
    if (!(_dir.lengthSq() > 1e-6) || !pos.every(Number.isFinite)) return false;
    _dir.normalize();
    root.position.set(0, 0, 0);
    root.quaternion.identity();
    root.scale.set(1, 1, 1);
    root.updateMatrixWorld(true);
    node.getWorldQuaternion(_q);
    _fwd.set(0, 0, -1).applyQuaternion(_q);
    root.quaternion.setFromUnitVectors(_fwd, _dir);
    root.updateMatrixWorld(true);
    node.getWorldPosition(_at);
    root.position.set(pos[0] - _at.x, pos[1] - _at.y, -pos[2] - _at.z);
    root.updateMatrixWorld(true);
    return true;
  }

  /**
   * A vehicle's round, from the sidecar's `f` row as net-sidecar.js hands it
   * on: `{ vehicle, gun, pos, dir }`, where `pos` and `dir` are the muzzle and
   * its axis in BF1942's frame (`recordedLaunch` negates z, as it does for a
   * replayed hull). The hull's template is the caller's (`ctx.templateOf`),
   * because the row names the object, not the model.
   */
  function shot(row) {
    if (!row || row.vehicle == null || !Array.isArray(row.pos) || !Array.isArray(row.dir)) return false;
    const tmpl = ctx.templateOf?.(row.vehicle) ?? null;
    if (!tmpl) return false;
    void hullGuns(tmpl).then(held => {
      const guns = ctx.guns();
      if (!held || !guns) return;
      const want = row.gun ? bareName(row.gun) : null;
      const input = row.alt ? 'c_PIAltFire' : 'c_PIFire';
      // The row names its gun; without a name, every gun of that trigger
      // would be a guess, so nothing is drawn rather than the wrong barrel.
      const pick = want ? held.groups.filter(g => bareName(g.node?.name) === want) : [];
      for (const group of pick) {
        if ((group.stats?.input || 'c_PIFire') !== input) continue;
        // The copy is laid so that THIS gun sits where the server fired it
        // from, down the axis it fired along: the emitters are the model's
        // own children and are drawn where the model is, exactly as
        // `net-remote-rounds.js` lays a remote's hand weapon on his eye.
        if (!layGun(held.root, group.node, row.pos, row.dir)) continue;
        // The server flies this round itself and ghosts it to us (`pool`, and
        // `update` draws it): one of the page's own would be a second bomb
        // falling beside the server's. The muzzle is still lit -- `flash`
        // lights the emitters exactly as `fireShot` does, with no round and
        // nothing billed.
        const round = group.stats?.projectile?.template;
        if (round && pooled.has(String(round).toLowerCase())) { guns.flash(group); continue; }
        group.aimRay = recordedLaunch(group.node, { pos: row.pos, dir: row.dir });
        guns.fireShot(group);
      }
    });
    return true;
  }

  function dispose() {
    const guns = ctx.guns();
    for (const id of [...drawn.keys()]) {
      const entry = drawn.get(id);
      entry.run?.stop?.();
      entry.node?.parent?.remove(entry.node);
      drawn.delete(id);
    }
    for (const free of spares.values()) for (const node of free) node.parent?.remove(node);
    spares.clear();
    for (const held of hulls.values()) {
      void Promise.resolve(held).then(h => {
        if (!h) return;
        for (const group of h.groups) guns?.release?.(group);
        h.root.parent?.remove(h.root);
      });
    }
    hulls.clear();
    sources.clear();
    pooled.clear();
  }

  /**
   * One page row from the sidecar, so that the whole of this module hangs off
   * a single line in the room's event handler: a pool announced, a vehicle's
   * round fired, an object deleted. Anything else is not ours.
   */
  function onRow(row) {
    if (!row) return false;
    if (row.type === 'projPool') { pool(row); return true; }
    if (row.type === 'vehicleGone') { gone(row.vehicle); return true; }
    if (row.type === 'shot' && row.seat) return shot(row);
    return false;
  }

  /** Whether the server flies rounds of this projectile template itself.
   *  The page's own gun must not launch one beside it: the replay keeps the
   *  same rule for a recorded round (`replay-props.js` `roundIsRecorded`).
   *
   *  Its one caller is `net-room.js` `remoteRound`, and what it stops is a
   *  REMOTE's grenade being drawn twice -- the round the page throws for his
   *  `shot` row, and the server's own pooled object arriving a round trip
   *  later. That is the "they throw it instantly, then the real one" the
   *  owner reported watching a retail player from the browser (2026-10-17).
   *  Pooled, the page lights the muzzle and throws nothing, so only the
   *  server's grenade flies. On El Alamein the pooled set holds
   *  `GrenadeAlliesProjectile` and `GrenadeAxisProjectile` (live, 2026-10-18),
   *  which are the templates a thrown grenade uses. */
  const isPooled = (tmpl) => Boolean(tmpl) && pooled.has(String(tmpl).toLowerCase());

  return {
    onRow, pool, shot, gone, update, dispose, isPooled,
    debug: () => ({ drawn: drawn.size, templates: sources.size, pooled: pooled.size, hulls: hulls.size }),
  };
}
