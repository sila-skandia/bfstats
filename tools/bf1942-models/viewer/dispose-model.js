// Free a loaded glb's GPU side: every geometry, every material and the
// textures they map. The kit and grip inspectors each had the same copy;
// lifted out of kits.html and poses.html (features/vehicle-instance-refactor,
// Part 2d).

export function disposeModel(root) {
  if (!root) return;
  const materials = new Set();
  const textures = new Set();
  root.traverse(obj => {
    obj.geometry?.dispose();
    for (const material of [obj.material].flat().filter(Boolean)) {
      materials.add(material);
      if (material.map) textures.add(material.map);
    }
  });
  textures.forEach(texture => texture.dispose());
  materials.forEach(material => material.dispose());
}
