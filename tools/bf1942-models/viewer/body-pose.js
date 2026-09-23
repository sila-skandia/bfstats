// The two pieces of scene glue the body modules (`body-world.js`,
// `vehicle-bodies.js`) are handed by whoever owns a scene: a node's world
// pose in their `position` + row `axes` shape, and the heightfield as the
// three functions they ask of the ground. The page's hull bodies
// (`hull-bodies.js`) and the room server's level (`server/level-bodies.mjs`)
// both build bodies over a scene, and both used these same two functions.

/** A node's world pose as the body modules' `position` + row `axes`. */
export function bodyPoseOf(node) {
  node.updateWorldMatrix(true, false);
  const e = node.matrixWorld.elements;
  return {
    position: [e[12], e[13], e[14]],
    axes: [[e[0], e[1], e[2]], [e[4], e[5], e[6]], [e[8], e[9], e[10]]],
  };
}

/** The heightfield as the three functions the body modules ask of the ground. */
export function bodyTerrain(heightfield, waterLevel) {
  const normal = [0, 1, 0];
  return {
    height: (x, z) => {
      const h = heightfield.height(x, z);
      return Number.isFinite(h) ? h : -Infinity;
    },
    normal: (x, z, out) => {
      heightfield.normal(x, z, normal);
      out[0] = normal[0]; out[1] = normal[1]; out[2] = normal[2];
      return out;
    },
    material: (x, z) => heightfield.material(x, z),
    waterLevel: Number.isFinite(waterLevel) ? waterLevel : null,
  };
}
