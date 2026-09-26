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
// the grenade's `e_ExplGranade` -- through the page's EffectPlayer.

import * as THREE from 'three';
import { clone as skeletonClone } from './vendor/utils/SkeletonUtils.js';
import { isReplicated, sampleAt } from './replay-recording.js';
import { poseAt } from './replay-kinematics.js';

/** Metres from the origin inside which a recorded pose is the "carried or
 *  pooled" placeholder rather than a place. */
const AT_ORIGIN = 1;

const atOrigin = p => Math.hypot(p[0], p[1], p[2]) < AT_ORIGIN;

/** The weapon a projectile template belongs to: `GrenadeAlliesProjectile`
 *  is thrown by `GrenadeAllies`. */
export const weaponOfProjectile = tmpl => String(tmpl || '').replace(/Projectile$/i, '');

export class ReplayProps {
  constructor(player) {
    this.player = player;
    this.props = [];
    this.sources = new Map();   // key -> Promise<{ scene, endEffect }|null>
  }

  /** Every kit and round life that is ever somewhere. */
  async load(lives) {
    const ctx = this.player.ctx;
    const placed = lives.filter(l => (l.kit || l.projectile) && l.keys.some(k => !atOrigin(k.p)));
    await Promise.all(placed.map(async life => {
      const source = life.kit ? await this.kitSource(life.tmpl) : await this.roundSource(life.tmpl);
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

  roundSource(tmpl) {
    const weapon = weaponOfProjectile(tmpl);
    const key = `round|${weapon}`;
    if (!this.sources.has(key)) {
      const ctx = this.player.ctx;
      this.sources.set(key, ctx.loader.loadAsync(`${ctx.modelsBase}/${weapon}.glb${ctx.bust()}`)
        .then(gltf => {
          let mesh = null;
          let endEffect = null;
          gltf.scene.traverse(obj => {
            if (!mesh && obj.userData?.projectileMesh) mesh = obj;
            const projectile = obj.userData?.fireArms?.projectile;
            if (projectile && typeof projectile === 'object'
                && String(projectile.template || '').toLowerCase() === String(tmpl).toLowerCase()) {
              endEffect = projectile.endEffect ?? endEffect;
            }
          });
          if (!mesh) return null;
          const scene = mesh.clone(true);
          scene.position.set(0, 0, 0);
          scene.quaternion.identity();
          scene.visible = true;
          scene.traverse(obj => { obj.visible = true; });
          ctx.shadeModel?.(scene);
          return { scene, endEffect };
        })
        .catch(() => null));
    }
    return this.sources.get(key);
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
