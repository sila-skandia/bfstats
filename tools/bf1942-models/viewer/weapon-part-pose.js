// The weapon's own parts in a first-person rig: the shell a bolt throws, the
// clip and rounds a reload pushes in, a grenade's pin and ring. The exporter
// bakes them into each arms clip as tracks on the nodes it marks `boundBone`
// (extract_viewmodel.py), so a three.js crossfade between two arms clips
// blends them too. Retail does not blend them (ledger ANIM-22):
//
// * They belong to the weapon's own state machine, not the soldier's. The
//   soldier's upper state names it through `setOtherState c_AsmWeaponState`
//   (`WeaponBoltOperateBerthier`); the arms' `setMorphFactor` (the aim
//   state's 0.7, a 1.4 s settle) never reaches the weapon's bones.
// * A weapon state's one-shot ends in `StopDummyState`, which declares
//   `resetSkeleton` (animations/AnimationStates.con): the console command
//   sets the active state's +0x4 byte (ConsoleClass52, lnxded 0x08339880),
//   `updateState` returns it, and `AnimatedBundle::handleVisualUpdate`
//   (0x08265730) then copies every bone of the weapon's skeleton back from
//   its template's rest, every frame the state holds. The parts snap home.
//
// So a part takes the clip that owns the arms at full weight while that
// clip's own track for it runs, and its rest once a one-shot's track has run
// out. BF1918's Berthier bolt ends with the spent case 0.43 m right of the
// gun; under the old crossfade it drifted back into the action across the
// screen for 1.4 s after every shot.
import { PropertyBinding } from 'three';

const KEYS = ['position', 'quaternion', 'scale'];

/**
 * The bound weapon parts under `root`, each with its rest (the node's own
 * transform, as loaded, before any clip has run) and, per clip name, the
 * interpolants of the tracks that clip carries for it.
 * @param {import('three').Object3D} root
 * @param {import('three').AnimationClip[]} clips
 */
export function collectWeaponParts(root, clips) {
  const parts = [];
  root.traverse(obj => {
    if (!obj.userData?.boundBone) return;
    parts.push({
      node: obj,
      rest: {
        position: obj.position.toArray(),
        quaternion: obj.quaternion.toArray(),
        scale: obj.scale.toArray(),
      },
      tracks: new Map(),
    });
  });
  if (!parts.length) return parts;
  const byName = new Map();
  for (const part of parts) {
    byName.set(part.node.name, part);
    byName.set(part.node.uuid, part);
  }
  for (const clip of clips ?? []) {
    for (const track of clip.tracks) {
      const { nodeName, propertyName } = PropertyBinding.parseTrackName(track.name);
      const part = byName.get(nodeName);
      if (!part || !KEYS.includes(propertyName)) continue;
      let entry = part.tracks.get(clip.name);
      if (!entry) part.tracks.set(clip.name, entry = {});
      entry[propertyName] = {
        interpolant: track.createInterpolant(),
        end: track.times[track.times.length - 1],
      };
    }
  }
  return parts;
}

/**
 * Pose every part from the one clip that owns the arms, after the mixer has
 * written its blend: `clipName` at `time`, or rest where that clip has no
 * track for the part, where nothing owns the arms (`clipName` null), or where
 * the clip is a one-shot (`once`) whose track for the part has ended.
 * @param {ReturnType<typeof collectWeaponParts>} parts
 * @param {string | null} clipName
 * @param {number} time
 * @param {boolean} once
 */
export function poseWeaponParts(parts, clipName, time, once) {
  for (const part of parts) {
    const entry = clipName ? part.tracks.get(clipName) : null;
    for (const key of KEYS) {
      const track = entry?.[key];
      const value = !track || (once && time >= track.end)
        ? part.rest[key]
        : track.interpolant.evaluate(time);
      part.node[key].fromArray(value);
    }
  }
}
