// A plane's own model, by template, for the dogfight school (features/
// dogfight-school, features/dogfight-recordings): the Range's school draws a
// recorded fight's own types with it, and the school's own page
// (`dogfight.html`, which has no level to borrow a parked plane from) draws
// and flies every plane with it.
//
// The lookup is the replay's: the mod's tree, then vanilla's (a mod's tree
// holds only what it adds; `pose-bases.js` `modelUrls`, `loadFirst`). A model
// is drawn as the level would draw it: its effect templates, tracer and round
// bodies and collision shells hidden. Loaded once per mod and template, and
// only when first asked for.

let loader = null;
const models = new Map();

/** The model's scene for `template` (a promise of a THREE group, or null
 *  when no tree has it). */
export function loadPlaneModel(template, mod = null) {
  const key = `${mod ?? ''}/${template}`.toLowerCase();
  if (!models.has(key)) {
    models.set(key, (async () => {
      const [{ GLTFLoader }, { loadMods }, { modelFileStem }, { modelUrls, loadFirst }] = await Promise.all([
        import('./glb-loader.js'), import('./mods.js'), import('./model-file.js'), import('./pose-bases.js')]);
      const mods = await loadMods();
      const own = mods.find(m => m.id === mod || m.id === String(mod ?? '').toLowerCase())?.paths?.models ?? 'models';
      loader ??= new GLTFLoader();
      try {
        const gltf = await loadFirst(loader, modelUrls(own, `${modelFileStem(template)}.glb`));
        gltf.scene.traverse(o => {
          const d = o.userData ?? {};
          if (d.effect || d.tracerMesh || d.projectileMesh || d.projectileTrail || d.isCollision) o.visible = false;
        });
        return gltf.scene;
      } catch {
        return null;
      }
    })());
  }
  return models.get(key);
}

/** The node an `Aircraft` is built on: the template's root in the scene. */
export function airframeRoot(scene) {
  return scene ? (scene.children.find(c => c.userData?.templateKind) ?? scene.children[0] ?? null) : null;
}

/** A copy of `node` to draw in the theatre: at the origin, unrotated, its
 *  collision shells hidden. */
export function planeVisual(node) {
  if (!node) return null;
  const copy = node.clone(true);
  copy.position.set(0, 0, 0);
  copy.quaternion.identity();
  copy.traverse(o => { o.matrixAutoUpdate = true; if (o.userData?.isCollision || /col\d|collision/i.test(o.name)) o.visible = false; });
  return copy;
}
