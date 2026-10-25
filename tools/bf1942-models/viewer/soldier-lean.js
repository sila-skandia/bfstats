// A soldier's drawn lean onto the ground he lies on (ledger PHY-38).
import * as THREE from 'three';

const _leanQuat = new THREE.Quaternion();
const _leanUp = new THREE.Vector3();
const _vertical = new THREE.Vector3(0, 1, 0);

/**
 * A soldier lying on a slope is drawn leaned onto it, as the engine draws
 * his skeleton through his own transform (PHY-38): the yaw-only placement
 * turned by the rotation taking vertical to his up row, and moved so his
 * feet sit at his feet vertex, `origin - up`, the point the terrain holds
 * (the drawn root is `origin - (0, 1, 0)`). Upright, nothing.
 */
export function leanOnto(object, up) {
  if (!up || !(up.y < 1)) return;
  _leanUp.set(up.x, up.y, up.z);
  _leanQuat.setFromUnitVectors(_vertical, _leanUp);
  object.quaternion.premultiply(_leanQuat);
  object.position.x -= up.x;
  object.position.y += 1 - up.y;
  object.position.z -= up.z;
}
