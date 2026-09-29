// The nodes an animation clip drives on a drawn soldier: the bones a half-body's
// morph carries (`soldier-actions.js` `MorphBlend`), for the bots' bodies
// (`bot-visuals.js`) and the replay's plain soldier (`replay-gait.js`) alike.

import * as THREE from 'three';

/** The nodes `clips`' tracks drive, found on `scene`, each once. */
export function trackNodes(scene, ...clips) {
  const nodes = [];
  const seen = new Set();
  for (const clip of clips) {
    for (const track of clip?.tracks ?? []) {
      const { nodeName } = THREE.PropertyBinding.parseTrackName(track.name);
      if (seen.has(nodeName)) continue;
      seen.add(nodeName);
      const node = THREE.PropertyBinding.findNode(scene, nodeName);
      if (node) nodes.push(node);
    }
  }
  return nodes;
}
