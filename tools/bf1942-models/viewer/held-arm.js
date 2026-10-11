// The turning part that carries a held craft: FH's "flying spawn" is a static
// whose `RotationalBundle` (`setContinousRotationSpeed 7/0/0`) swings an
// ObjectSpawner round on a 140 m arm, `holdObject 1` (ledger FHR-10,
// features/fh-mod-extraction/MECHANICS.md section 1).
//
// The bake carries that rotation as a looping `ambient` clip, and a page used
// to play it on the level's mixer: at the frame's own rate, from a random
// start. So the arm stood at a different angle on every page, and a room's
// server, which has no mixer, never turned it at all. A held craft is where
// its arm is, so the arm is part of the simulation: its angle is a function
// of the world's tick time (`World.tickTime`) and of nothing else, read off
// the same keys the clip holds, on the page and on the room server alike.
// Windmills and radar dishes carry nothing and stay on the mixer.

import * as THREE from 'three';

/** Turning node -> its rotation keys, `{ times, values }` (xyzw per key). */
const arms = new WeakMap();
const _from = [0, 0, 0, 1];

/** Give `node` the rotation keys that turn it. */
export function bindArm(node, track) {
  if (node && track?.times?.length && track.values?.length >= track.times.length * 4) arms.set(node, track);
}

/** The turning part that carries `host`: itself or the nearest node above it
 *  with keys bound, or null. */
export function armAbove(host) {
  for (let node = host; node; node = node.parent) if (arms.has(node)) return node;
  return null;
}

/**
 * The keys' rotation `seconds` into the loop, into `out` (a Quaternion):
 * the clip's own interpolation (LINEAR over quaternions is a slerp between
 * neighbouring keys), wrapped at the last key's time.
 */
export function armQuaternionAt(track, seconds, out) {
  const { times, values } = track;
  const last = times.length - 1;
  const duration = times[last];
  if (!(duration > 0) || !Number.isFinite(seconds)) return out.fromArray(values, 0);
  const t = ((seconds % duration) + duration) % duration;
  let i = 0;
  while (i < last - 1 && times[i + 1] <= t) i++;
  const span = times[i + 1] - times[i];
  const alpha = span > 0 ? (t - times[i]) / span : 0;
  THREE.Quaternion.slerpFlat(_from, 0, values, i * 4, values, (i + 1) * 4, alpha);
  return out.fromArray(_from, 0);
}

/**
 * Every arm that carries one of `records` (`{ host }`, a held craft's hold)
 * turned to where it stands `seconds` into the world's time. A host no arm
 * carries (a ship) is left alone.
 */
export function poseHeldArms(records, seconds) {
  for (const rec of records) {
    const node = armAbove(rec?.host);
    if (!node) continue;
    armQuaternionAt(arms.get(node), seconds, node.quaternion);
    node.updateMatrix();
    node.updateWorldMatrix(true, true);
  }
}

/**
 * The page's half: the arms that carry `hosts` (the held crafts' hosts) taken
 * off the level's mixer and bound here instead. Each one's rotation track is
 * dropped from its clip's running action, which keeps its place in the loop
 * for whatever else it turns; `clips` itself is left whole, since it is also
 * the list of what moves (`level-statics.js` `freezeStatics`). Returns the
 * arms bound.
 */
export function takeArmsOffMixer(mixer, clips, root, hosts) {
  const wanted = new Set();
  for (const host of hosts) for (let node = host; node && node !== root; node = node.parent) wanted.add(node);
  const bound = [];
  if (!wanted.size) return bound;
  for (const clip of clips ?? []) {
    const taken = new Set();
    for (const track of clip.tracks) {
      const parsed = THREE.PropertyBinding.parseTrackName(track.name);
      if (parsed.propertyName !== 'quaternion') continue;
      const node = THREE.PropertyBinding.findNode(root, parsed.nodeName);
      if (!node || !wanted.has(node) || arms.has(node)) continue;
      bindArm(node, { times: track.times, values: track.values });
      taken.add(track);
      bound.push(node);
    }
    if (!taken.size || !mixer) continue;
    const action = mixer.existingAction(clip);
    const time = action?.time ?? 0;
    action?.stop();
    mixer.uncacheClip(clip);
    const rest = clip.tracks.filter(track => !taken.has(track));
    if (!rest.length) continue;
    const kept = mixer.clipAction(new THREE.AnimationClip(clip.name, clip.duration, rest));
    kept.time = time;
    kept.play();
  }
  return bound;
}
