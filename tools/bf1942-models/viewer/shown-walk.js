// A subtree whose matrix walk visits only what is shown
// (features/replay-performance, "Phones").
//
// three r169's `updateMatrixWorld` recomposes every node under the scene on
// every frame, drawn or not. A level's scene holds some 10,000 nodes, nine
// in ten of them hidden in a replay: the placed vehicles (the `spawners`
// group, 4,000 nodes, which the replay draws its own hulls instead of), the
// collision meshes, the LOD rungs not chosen. The replay's own root and the
// effects' already walk only their visible children (replay.js, effects.js);
// this does the same at every depth of a tree whose nodes almost never move.
//
// It is three's walk, node for node, except that a hidden child is skipped
// while nothing above it has moved (`force`). A node hidden and then shown is
// brought up to date by the first walk that finds it shown, before the frame
// draws it, as three's own would; `getWorldPosition` and its kind update a
// hidden node's chain themselves when read. The tree is walked whole once
// first, so every hidden node starts with its true matrices.

import { Object3D } from 'three';

const BASE_WALK = Object3D.prototype.updateMatrixWorld;

function walk(node, force) {
  if (node.matrixAutoUpdate) node.updateMatrix();
  if (node.matrixWorldNeedsUpdate || force) {
    if (node.matrixWorldAutoUpdate === true) {
      if (node.parent === null) node.matrixWorld.copy(node.matrix);
      else node.matrixWorld.multiplyMatrices(node.parent.matrixWorld, node.matrix);
    }
    node.matrixWorldNeedsUpdate = false;
    force = true;
  }
  const children = node.children;
  for (let i = 0, l = children.length; i < l; i++) {
    const child = children[i];
    if (!force && !child.visible) continue;
    // A node with a walk of its own (a camera, the replay's root) keeps it.
    if (child.updateMatrixWorld === BASE_WALK) walk(child, force);
    else child.updateMatrixWorld(force);
  }
}

/** Make `root`'s per-frame walk skip its hidden subtrees. Idempotent. */
export function walkShownOnly(root) {
  if (!root || root.userData?.shownWalk) return root;
  root.updateMatrixWorld(true);
  root.userData.shownWalk = true;
  root.updateMatrixWorld = function (force) { walk(this, force); };
  return root;
}

export { walk as walkShown };
