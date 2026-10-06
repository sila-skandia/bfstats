// A level glb's node indices on the loaded scene: the name a room's server and
// this page agree on for a placed hull or static (`server/glb-scene.mjs`
// stamps the same index on its own tree). Imports only three, so
// `tests/level_nodes_harness.mjs` runs it on a real level under node.

import * as THREE from 'three';

/**
 * Stamp every object a level glb's node became with that node's index in the
 * file (`levelNode`), the name a room's server gives a placed hull or static
 * (`server/glb-scene.mjs`). Walks the file's node tree beside the loaded one:
 * GLTFLoader adds the scene's nodes in order, and under each node its glTF
 * children last and in order, after any primitive meshes of its own
 * (`loadNode`, `loadScene`). A name that does not match where it should stops
 * the walk down that branch rather than stamp a wrong index. Returns the
 * count stamped.
 */
export function stampLevelNodes(gltf) {
  const json = gltf?.parser?.json;
  const sceneDef = json?.scenes?.[json.scene ?? 0];
  if (!json?.nodes || !sceneDef?.nodes) return 0;
  const sameName = (obj, def) => {
    const want = THREE.PropertyBinding.sanitizeNodeName(def.name ?? '');
    return !want || obj.name === want || obj.name.replace(/_\d+$/, '') === want;
  };
  let stamped = 0;
  const stamp = (obj, index) => {
    const def = json.nodes[index];
    if (!obj || !def || !sameName(obj, def)) return;
    obj.levelNode = index;
    stamped++;
    const kids = def.children ?? [];
    const tail = obj.children.slice(obj.children.length - kids.length);
    kids.forEach((child, i) => stamp(tail[i], child));
  };
  if (gltf.scene.children.length !== sceneDef.nodes.length) return 0;
  sceneDef.nodes.forEach((index, i) => stamp(gltf.scene.children[i], index));
  return stamped;
}

