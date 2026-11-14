// The page's own copies of a real server's hulls, by name (`net-room.js`
// `hullIndex`, `relayNodeFor`). A server names no scene node and no pad, so
// each of its hulls is married to a copy of the same template nearest where
// the server has it, and the copies it can be married to are every node the
// level loaded under a name.
//
// A scene node has its `scene.glb` index (`levelNode`, stamped by
// `level-load.js` from GLTFLoader's associations). Two kinds of copy come
// from the models tree instead and have none, so they are named here:
//
// - a pooled hull (`level-statics.js` `loadRoundSpawnPool`, its `extra`): a
//   template the level never places, parked for a server that fields one;
// - a pad's other-side vehicle (`level-statics.js` `loadPadVariants`): the
//   bake stands one template on a pad and the page adds the other side's.
//
// Without a name a copy is never in the index, so a server's hull of that
// template has nothing to bind and the page cannot seat the player the
// server has put in it: he stays on foot, his weapon in hand, while his keys
// drive the server's hull (Mimoyecques' R75 motorbikes, 2026-11-14).

/**
 * Name the unnamed copies under `root` and return the index, `Map<name,
 * node>`, the first node of a name winning. A pooled copy is `pool:<k>` (its
 * mould, never stood, is left out), a pad's other-side vehicle
 * `variant:<k>`, both counted in traversal order. A node keeps a name once
 * given (`levelNode`), so a rebuilt index names it the same.
 */
export function indexRelayCopies(root) {
  const byLevel = new Map();
  let pooled = 0;
  let variants = 0;
  root?.traverse(node => {
    const data = node.userData ?? {};
    if (node.levelNode == null && data.roundSpawned && !data.roundMould) {
      node.levelNode = `pool:${pooled++}`;
    }
    if (node.levelNode == null && data.padVariant && Number.isInteger(data.objectSpawn)) {
      node.levelNode = `variant:${variants++}`;
    }
    if (node.levelNode != null && !byLevel.has(node.levelNode)) byLevel.set(node.levelNode, node);
  });
  return byLevel;
}

/** The index for a page that is not on a real server: the scene's own names
 *  alone (a room names a pad's vehicle by its pad, `net-room.js`
 *  `pageHullOf`). */
export function indexSceneCopies(root) {
  const byLevel = new Map();
  root?.traverse(node => {
    if (node.levelNode != null && !byLevel.has(node.levelNode)) byLevel.set(node.levelNode, node);
  });
  return byLevel;
}
