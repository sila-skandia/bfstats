// The replay's follow camera: which object the followed player controls at a
// time, and the orbit that frames it. The orbit itself (yaw, pitch, zoom) is
// the player's, turned by the mouse in replay-ui.js.

import { sampleAt } from './replay-recording.js';
import { toViewPosition } from './replay-actors.js';

// Follow-camera distance from the followed object, and the lowest the orbit
// may go: close over a soldier, further back from a vehicle, and high above
// the spectator camera, which on the spawn screen is only a viewpoint.
const FOLLOW_SOLDIER = { distance: 9, minPitch: -0.15 };
const FOLLOW_VEHICLE = { distance: 20, minPitch: -0.15 };
const FOLLOW_SPECTATOR = { distance: 85, minPitch: 0.7 };

/** The followed player's controlled object: their soldier, their vehicle,
 *  or before spawning the spectator camera, which has a pose but no model. */
export function focusLife(player, t) {
  let nid = null;
  for (const c of player.rec.control) {
    if (c.t > t) break;
    if (c.pid === player.followPid) nid = c.nid;
  }
  if (nid === null) return null;
  return player.rec.lives.find(l => l.nid === nid && t >= l.created && t < l.destroyed) || null;
}

export function followCamera(player, dt, t) {
  const life = focusLife(player, t);
  const s = life && sampleAt(life, t);
  if (!s) return;
  const focus = toViewPosition(s.a.p, player.v1);
  if (s.b) focus.lerp(toViewPosition(s.b.p, player.v2), s.k);
  focus.y += life.soldier ? 1.4 : 2.5;
  const cam = player.ctx.camera;
  const rig = life.tmpl === 'MultiPlayerFreeCamera' ? FOLLOW_SPECTATOR
    : life.soldier ? FOLLOW_SOLDIER : FOLLOW_VEHICLE;
  const pitch = Math.max(player.orbit.pitch, rig.minPitch);
  const offset = player.v3.set(
    Math.sin(player.orbit.yaw) * Math.cos(pitch),
    Math.sin(pitch),
    Math.cos(player.orbit.yaw) * Math.cos(pitch),
  ).multiplyScalar(rig.distance * player.orbit.zoom);
  const desired = player.v2.copy(focus).add(offset);
  const jump = !player.followReady || desired.distanceTo(cam.position) > 150;
  cam.position.lerp(desired, jump ? 1 : 1 - Math.exp(-dt * 4));
  player.followReady = true;
  cam.lookAt(focus);
  // lookAt sets the rotation only. The page refreshed the camera's matrices
  // for its own free-look before this ran, so anything projected through
  // the camera before the render would otherwise use that stale view.
  cam.updateMatrixWorld();
}
