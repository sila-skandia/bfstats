// The model browser's `?shots` headless hooks: `window.__scene`,
// `__camera`, `__controls` and `__modelInspector`, which `shoot.mjs` and the
// headless checks drive. Lifted out of index.html
// (features/vehicle-instance-refactor, Part 2c).

import * as THREE from 'three';
import { SHORT_LABEL } from './model-crew.js';
import { GEAR_INPUT } from './model-rig.js';

/**
 * Built once by the page, where this code used to sit. `page` hands in
 * what it reads of the rest of the page, as getters (a binding the page
 * reassigns is read live):
 * `camera`, `clipActions`, `computeHitDamage`, `controls`, `crew`, `current`,
 * `currentEntry`, `currentVariant`, `damageTables`, `engineRunning`,
 * `fireGroups`, `getCollision`, `guns`, `helpers`, `invalidate`, `manifest`,
 * `pickCenterHit`, `PORTRAIT_DISTANCE`, `PORTRAIT_OFFSET`, `portraitExtent`,
 * `scene`, `seatViews`, `setCameraView`, `setCollision`,
 * `setCollisionMaterial`, `setCrewInput`, `setHitAngle`, `setWeapon`,
 * `showVariant`, `startFiring`, `stationRole`, `stopFiring`.
 */
export function installTestHooks(page) {
  const testHooks = {};

  window.__scene = page.scene;
  window.__camera = page.camera;
  window.__controls = page.controls;
  window.__modelInspector = {
    manifest: page.manifest,
    showVariant: page.showVariant,
    getCurrent: () => page.currentVariant ? {
      model: page.currentEntry.name,
      modelIndex: page.currentEntry.index,
      variantIndex: page.currentVariant.index,
      configuration: page.currentVariant.configuration,
      level: page.currentVariant.level,
      lod: page.currentVariant.lod,
    } : null,
    setView: page.setCameraView,
    // Baked spin clips and recovered seat cameras, for headless checks.
    getAnimation: () => ({
      running: page.engineRunning,
      clips: page.clipActions.map(action => ({
        name: action.getClip().name,
        duration: action.getClip().duration,
        time: action.time,
        isRunning: action.isRunning(),
      })),
      nodes: !page.current ? [] : [...new Set(page.clipActions.flatMap(action =>
        action.getClip().tracks.map(track => track.name.split('.')[0])))]
        .map(name => {
          const node = page.current.getObjectByName(name);
          return node ? { name, quaternion: node.quaternion.toArray() } : { name };
        }),
      views: page.seatViews.map(node => ({
        name: node.name, control: node.userData.cameraView.control,
      })),
    }),
    // Gun state and a trigger, for headless checks: each group is one FireArms
    // template with its muzzles, baked flash emitters and firing stats.
    getFire: () => ({
      groups: page.fireGroups.map(group => ({
        name: group.node.name,
        control: group.stats.control,
        stats: group.stats,
        firing: group.firing,
        shots: group.shots,
        muzzles: group.muzzles.map(node => {
          node.updateWorldMatrix(true, false);
          return {
            name: node.name,
            world: node.getWorldPosition(new THREE.Vector3()).toArray(),
          };
        }),
        flashes: group.emitters.map(emitter => ({
          name: emitter.node.name,
          kind: emitter.spec.kind,
          visible: emitter.node.visible,
        })),
      })),
      tracers: page.guns.tracers.map(tracer => ({
        position: tracer.mesh.position.toArray(),
        bright: tracer.bright,
      })),
    }),
    setFiring: (index, firing) => {
      const group = page.fireGroups[index];
      if (!group) return;
      if (firing) page.startFiring(group); else page.stopFiring(group);
    },
    // Every player input, per crew station, for shoot.mjs --rig and headless checks.
    getInputs: () => page.crew.stations.flatMap(seat => [...seat.inputs.values()].map(input => ({
      key: input.key,
      station: seat.name,
      input: input.input,
      label: `${seat.name} ${SHORT_LABEL[input.input] || input.input}`,
      gear: input.input === GEAR_INPUT,
      rate: input.rate,
      driven: input.driven,
    }))),
    setInput: (key, value) => page.setCrewInput(key, Number(value)),
    getCrew: () => page.crew.stations.map(seat => ({
      name: seat.name,
      control: seat.control,
      role: page.stationRole(seat),
      inputs: [...seat.inputs.keys()],
      guns: seat.guns.map(group => group.node.name),
      views: seat.views.map(view => view.node.name),
    })),
    // Thumbnails are shot through here rather than through setView, because the
    // scale lineup relies on every one of them being framed to the *same* multiple
    // of the model's bounding sphere. Anything that reframes per-model — fitting
    // the box, or trimming empty margin — breaks the common scale.
    setPortrait: enabled => {
      page.helpers.visible = !enabled;
      // A class rather than `hidden`, because show() re-evaluates the banner on
      // every load and would paint it straight back into the next thumbnail.
      document.body.classList.toggle('is-portrait', Boolean(enabled));
      const portrait = enabled && page.current ? page.portraitExtent(page.current) : null;
      if (portrait) {
        const distance = portrait.extent * page.PORTRAIT_DISTANCE;
        page.camera.position.set(
          portrait.centre.x + distance * page.PORTRAIT_OFFSET.x,
          portrait.centre.y + portrait.extent * page.PORTRAIT_OFFSET.y,
          portrait.centre.z + distance * page.PORTRAIT_OFFSET.z,
        );
        page.controls.target.copy(portrait.centre);
        page.controls.update();
      }
      page.invalidate();
    },
    setCollision: page.setCollision,
    setImpactAngle: page.setHitAngle,
    setCollisionMaterial: page.setCollisionMaterial,
    setWeapon: page.setWeapon,
    pickCenterHit: page.pickCenterHit,
    getWeapons: () => (page.damageTables?.weapons || []).map(weapon => weapon.name),
    getDamageTables: () => page.damageTables,
    getDamage: page.computeHitDamage,
    getCollision: page.getCollision,
  };

  return testHooks;
}
