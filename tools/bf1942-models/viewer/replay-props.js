// What soldiers leave lying about, as the recording has it: a dead man's kit
// on the ground, and the grenades, mines and charges he throws and lays.
//
// A carried kit and an idle round are recorded at the origin: the kit rides
// in its owner and the rounds wait in their weapon's pool, disabled (0x05
// creates every kit's pool at the spawn, replay_20260927-001120: a kit's three
// grenades take the ids between the soldier's and the kit's). They get a pose
// of their own only when they are somewhere: a kit when its owner dies and it
// drops (the kit of 1091 moved to its pickup spot 0.08 s after his death and
// lay there 30 s), a round when it is thrown or laid and the client is in
// range. So a pose away from the origin is the whole test.
//
// Both are drawn with the page's own assets: a kit as its pickup mesh
// (`<Kit>__pickup.kit.glb`, the one `kit-drops-page.js` drops for a bot), a
// round as the projectile mesh its weapon's glb carries, and a round that
// goes out of the recording where it lay plays its template's end effect --
// the grenade's `e_ExplGranade` -- through the page's EffectPlayer. A round a
// hull lays has no glb of its own to carry it: the PT boats'
// `FloatingMineLauncher` is part of the Elco80 and the Type38, and its
// `FloatingMine` is drawn from whichever of the recording's hulls carries it.
//
// These rounds are the recording's alone. The server flies them and sends
// the client the object, so the page must not fly one of its own from the
// `f` record that threw it (`roundIsRecorded`): a landmine the page laid lay
// for its authored 360 s where no replayed hull could set it off, long after
// the recorded one had gone off under a jeep. And a round that goes because
// its kit went is not a blast: a dead engineer's dropped kit expires 30 s
// after him and the server deletes its pool with it, his laid mines
// included, unexploded (kit 14434 of replay_20260928-133433 at 187.46 s,
// four mines).

import * as THREE from 'three';
import { clone as skeletonClone } from './vendor/utils/SkeletonUtils.js';
import { controlledAt, isReplicated, lifeAt, positionAt, rootOf, sampleAt } from './replay-recording.js';
import { poseAt } from './replay-kinematics.js';
import { loadFirst, weaponUrls } from './pose-bases.js';

/** Metres from the origin inside which a recorded pose is the "carried or
 *  pooled" placeholder rather than a place. */
const AT_ORIGIN = 1;

const atOrigin = p => Math.hypot(p[0], p[1], p[2]) < AT_ORIGIN;

/** Seconds between a round's ghost ending and its object being destroyed
 *  inside which the destruction is what ended it: a pool deleted with its
 *  kit ends the ghost in the same packet (187.458 and 187.461 s). */
const REMOVED_WITH_KIT = 0.25;

/**
 * The projectile templates vanilla gives a `networkableInfo` (capture README
 * section 13): both grenades, the explosives pack, the landmine, the floating
 * mine and the binoculars' marker. The server flies these and sends every
 * client in range the object; every other round a client flies itself.
 */
export const NETWORKED_ROUNDS = Object.freeze([
  'GrenadeAlliesProjectile', 'GrenadeAxisProjectile', 'ExpPackProjectile',
  'LandmineProjectile', 'FloatingMine', 'BinocularsProjectile',
]);

/** Every round template the recording carries as objects of their own (its
 *  pools, and the lives marked as rounds), with vanilla's networked six, in
 *  lower case: a mod's own networked round is known by the pool a kit of it
 *  was spawned with. */
export function networkedRounds(rec) {
  const out = new Set(NETWORKED_ROUNDS.map(t => t.toLowerCase()));
  for (const life of rec?.lives ?? []) {
    if (life.projectile && life.tmpl) out.add(life.tmpl.toLowerCase());
  }
  return out;
}

/** Whether a gun group's round is one the recording carries (`rounds`, from
 *  `networkedRounds`): the replay draws that round from the recording and
 *  must not fire one of its own. */
export function roundIsRecorded(group, rounds) {
  const tmpl = group?.stats?.projectile?.template;
  return Boolean(tmpl) && Boolean(rounds?.has(String(tmpl).toLowerCase()));
}

/**
 * Whether a round that stopped being drawn at `t` went off: its ghost ended
 * (the server takes a spent round back into its pool and stops sending it)
 * while its object lived on, inside the recording's range. Not when its kit
 * was deleted and took it along, and not when the recording lost sight of it
 * at the edge of its view distance. `eyesAt(t)` lists where the recording
 * players were (a merged recording has one per file).
 */
export function wentOff(life, lastT, t, eyesAt = null, range = null) {
  let ended = null;
  for (const [from, to] of life.replicated) {
    if (from <= lastT && to > lastT && to <= t + 1e-6) ended = to;
  }
  // Still sent, and back at the origin in its pool: gone off.
  if (ended === null) return true;
  if (Number.isFinite(life.destroyed) && life.destroyed - ended < REMOVED_WITH_KIT) return false;
  if (!(range > 0) || typeof eyesAt !== 'function') return true;
  const at = positionAt(life, lastT);
  const eyes = eyesAt(ended) ?? [];
  if (!at || !eyes.length) return true;
  return eyes.some(eye => Math.hypot(at[0] - eye[0], at[1] - eye[1], at[2] - eye[2]) <= range);
}

/** Where each of `pids`, the recording players, was at `t`, in the
 *  recording's frame: what he controlled then (his soldier, the hull his
 *  seat is in, his camera). Those the recording has nothing of are left out. */
export function recorderPositions(rec, pids, t) {
  const out = [];
  for (const pid of pids ?? []) {
    if (pid === null || pid === undefined) continue;
    const nid = controlledAt(rec, pid, t);
    if (nid === null) continue;
    const life = rootOf(rec, nid, t, pid)?.life ?? lifeAt(rec, nid, t);
    const p = life ? positionAt(life, t) : null;
    if (p) out.push(p);
  }
  return out;
}

/** The hand weapon a projectile template belongs to, by the game's own
 *  naming: `GrenadeAlliesProjectile` is thrown by `GrenadeAllies`. Null where
 *  the name says nothing (`FloatingMine`): a round named after no weapon has
 *  no `<Weapon>.glb` to fetch. */
export const weaponOfProjectile = tmpl => {
  const name = String(tmpl || '');
  return /.Projectile$/i.test(name) ? name.replace(/Projectile$/i, '') : null;
};

/**
 * A round of `tmpl` as `scene` carries it: the projectile mesh under the
 * FireArms whose round it is (`extras.fireArms.projectile.template`,
 * assemble.py `_projectile_spec`), and the end effect that FireArms names.
 * A hull carries more than one -- an Elco80 has its torpedoes and its
 * floating mines -- so the FireArms decides, never the first mesh found.
 * `{ mesh, endEffect }`, or null.
 */
export function roundIn(scene, tmpl) {
  const want = String(tmpl || '').toLowerCase();
  let found = null;
  scene?.traverse(obj => {
    if (found) return;
    const projectile = obj.userData?.fireArms?.projectile;
    if (!projectile || typeof projectile !== 'object'
        || String(projectile.template || '').toLowerCase() !== want) return;
    let mesh = null;
    obj.traverse(child => { if (!mesh && child !== obj && child.userData?.projectileMesh) mesh = child; });
    if (mesh) found = { mesh, endEffect: projectile.endEffect ?? null };
  });
  return found;
}

export class ReplayProps {
  constructor(player) {
    this.player = player;
    this.props = [];
    this.sources = new Map();   // key -> Promise<{ scene, endEffect }|null>
    this.recorderAt = t => recorderPositions(player.rec, player.recordingPids ?? [player.recordingPid], t);
  }

  /** Every kit and round life that is ever somewhere. `hulls` are the
   *  recording's hull models, where a round a hull lays is looked for. */
  async load(lives, hulls = []) {
    const ctx = this.player.ctx;
    const placed = lives.filter(l => (l.kit || l.projectile) && l.keys.some(k => !atOrigin(k.p)));
    // Each one on its own: a model that cannot be laid is a warning and one
    // thing left off the ground, not a replay that stops loading.
    await Promise.all(placed.map(async life => {
      try {
        const source = life.kit ? await this.kitSource(life.tmpl) : await this.roundSource(life.tmpl, hulls);
        if (!source) return;
        const node = skeletonClone(source.scene);
        node.visible = false;
        node.name = `replay ${life.tmpl} ${life.nid}`;
        this.player.root.add(node);
        this.props.push({ life, node, endEffect: source.endEffect, wasShown: false, lastAt: null });
      } catch (error) {
        console.warn(`replay: the ${life.tmpl} ${life.nid} left off the ground`, error);
      }
    }));
    return this.props.length;
  }

  kitSource(kit) {
    const key = `kit|${kit}`;
    if (!this.sources.has(key)) {
      this.sources.set(key, Promise.resolve(this.player.ctx.kitPickupModel?.(kit))
        .then(scene => (scene ? { scene, endEffect: null } : null))
        .catch(() => null));
    }
    return this.sources.get(key);
  }

  /** The mesh a round of `tmpl` is drawn with: a launcher on one of `hulls`
   *  (no fetch), else its hand weapon's own glb. */
  roundSource(tmpl, hulls = []) {
    const key = `round|${String(tmpl).toLowerCase()}`;
    if (!this.sources.has(key)) {
      this.sources.set(key, this.findRound(tmpl, hulls).catch(() => null));
    }
    return this.sources.get(key);
  }

  async findRound(tmpl, hulls) {
    for (const hull of hulls) {
      const round = roundIn(hull, tmpl);
      if (round) return this.dress(round);
    }
    const weapon = weaponOfProjectile(tmpl);
    if (!weapon) return null;
    const ctx = this.player.ctx;
    const gltf = await loadFirst(ctx.loader, weaponUrls(ctx.modelsBase, weapon, ctx.bust()));
    // A hand weapon has the one round; a glb whose FireArms does not name it
    // (an older tree's) still draws the projectile mesh it carries.
    let first = null;
    gltf.scene.traverse(obj => { if (!first && obj.userData?.projectileMesh) first = obj; });
    const round = roundIn(gltf.scene, tmpl) ?? (first ? { mesh: first, endEffect: null } : null);
    return round ? this.dress(round) : null;
  }

  /** A drawable copy of a round's mesh, at the origin and shown. */
  dress({ mesh, endEffect }) {
    const scene = mesh.clone(true);
    scene.position.set(0, 0, 0);
    scene.quaternion.identity();
    scene.visible = true;
    scene.traverse(obj => { obj.visible = true; });
    this.player.ctx.shadeModel?.(scene);
    return { scene, endEffect };
  }

  update(t) {
    const fx = this.player.ctx.effects;
    for (const prop of this.props) {
      const { life, node } = prop;
      const alive = t >= life.created && t < life.destroyed && isReplicated(life, t);
      const s = alive ? sampleAt(life, t) : null;
      const somewhere = s && !atOrigin(s.a.p);
      if (somewhere) {
        const pose = poseAt(life, t);
        node.position.set(pose.p[0], pose.p[1], pose.p[2]);
        node.quaternion.set(pose.q[0], pose.q[1], pose.q[2], pose.q[3]);
        node.visible = true;
        prop.wasShown = true;
        prop.lastAt = [pose.p[0], pose.p[1], pose.p[2]];
        prop.lastT = t;
        continue;
      }
      // A round that was lying somewhere and has gone back to its pool has
      // gone off, when playback walked across it (`wentOff`: not one its
      // kit took with it, nor one the recording lost sight of).
      if (node.visible && prop.endEffect && prop.lastAt && fx?.play
          && this.player.playing && t - prop.lastT < 0.5 && t >= prop.lastT
          && wentOff(life, prop.lastT, t, this.recorderAt, this.player.ctx.viewDistance?.())) {
        fx.play(prop.endEffect, { position: prop.lastAt, normal: [0, 1, 0] });
      }
      node.visible = false;
    }
  }

  dispose() {
    for (const prop of this.props) prop.node.parent?.remove(prop.node);
    this.props.length = 0;
  }
}
