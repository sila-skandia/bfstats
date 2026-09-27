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

import * as THREE from 'three';
import { clone as skeletonClone } from './vendor/utils/SkeletonUtils.js';
import { isReplicated, sampleAt } from './replay-recording.js';
import { poseAt } from './replay-kinematics.js';

/** Metres from the origin inside which a recorded pose is the "carried or
 *  pooled" placeholder rather than a place. */
const AT_ORIGIN = 1;

const atOrigin = p => Math.hypot(p[0], p[1], p[2]) < AT_ORIGIN;

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
  }

  /** Every kit and round life that is ever somewhere. `hulls` are the
   *  recording's hull models, where a round a hull lays is looked for. */
  async load(lives, hulls = []) {
    const ctx = this.player.ctx;
    const placed = lives.filter(l => (l.kit || l.projectile) && l.keys.some(k => !atOrigin(k.p)));
    await Promise.all(placed.map(async life => {
      const source = life.kit ? await this.kitSource(life.tmpl) : await this.roundSource(life.tmpl, hulls);
      if (!source) return;
      const node = skeletonClone(source.scene);
      node.visible = false;
      node.name = `replay ${life.tmpl} ${life.nid}`;
      this.player.root.add(node);
      this.props.push({ life, node, endEffect: source.endEffect, wasShown: false, lastAt: null });
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
    const gltf = await ctx.loader.loadAsync(`${ctx.modelsBase}/${weapon}.glb${ctx.bust()}`);
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
      // A round that was lying somewhere and has gone -- back to its pool or
      // out of the world -- has gone off, when playback walked across it.
      if (node.visible && prop.endEffect && prop.lastAt && fx?.play
          && this.player.playing && t - prop.lastT < 0.5 && t >= prop.lastT) {
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
