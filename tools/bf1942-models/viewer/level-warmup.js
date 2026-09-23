// Rule 6's warm-up (features/mesh-viewer-performance) for the level: every
// program linked, every texture uploaded and every program's first use taken
// before the frame that draws it. Out of level-load.js.

/**
 * Built once by `createLevel` (level-load.js). `page` hands in what it reads,
 * as getters (a value the level reassigns is read live):
 * `camera`, `effects`, `guns`, `renderer`, `scene`.
 */
export function createLevelWarmup(page) {
  const warm = {};

  // Rule 6's warm-up (features/mesh-viewer-performance): nothing play can draw
  // is linked, uploaded or first used by the frame that draws it. Three links
  // a material's program on the first frame that draws it, uploads a texture on
  // the first frame that binds it and builds a skinned mesh's bone texture on
  // its first draw, and the link blocks that frame on the driver: on this Iris
  // Xe's system GL the perf harness watched one block for 8-9.5 s and take the
  // WebGL context with it.
  //
  // A subtree is compiled against the scene and camera of the pass that draws
  // it — the canvas (no render target), that scene's fog and lights: all a
  // program key reads that the material and the object do not — then every
  // texture its materials can bind goes to the GPU, and every program the
  // compile linked has its first use taken (`WebGLProgram.getUniforms`: the log
  // and uniform queries three otherwise runs inside the first draw, and the
  // point where a link still in flight would block). `compile` walks hidden
  // nodes too, so a pooled particle or a parked gun's flash is warmed like a
  // wall.

  /** Put `texture` on the GPU if its pixels have arrived; a no-op before. */
  function uploadTexture(texture) {
    if (!texture?.isTexture || texture.version === 0) return;
    page.renderer.initTexture(texture);
  }

  /** Every texture `root` can draw with: the material's slots, a shader's
   *  uniforms and the renderer's copy of them (where the ones `onBeforeCompile`
   *  adds live, once compiled), and each skinned mesh's bone texture, built
   *  here rather than on its first draw (`WebGLRenderer.setProgram`). */
  function uploadTextures(root) {
    root.traverse(obj => {
      if (obj.isSkinnedMesh && obj.skeleton) {
        if (!obj.skeleton.boneTexture) obj.skeleton.computeBoneTexture();
        uploadTexture(obj.skeleton.boneTexture);
      }
      for (const m of [obj.material].flat()) {
        if (!m) continue;
        for (const value of Object.values(m)) uploadTexture(value);
        for (const uniform of Object.values(m.uniforms ?? {})) uploadTexture(uniform?.value);
        const compiled = page.renderer.properties.get(m).uniforms;
        for (const uniform of Object.values(compiled ?? {})) uploadTexture(uniform?.value);
      }
    });
    // A scene's own two textures hang off no material: the skybox cube three
    // draws the background with, and an environment map.
    if (root.isScene) {
      uploadTexture(root.background);
      uploadTexture(root.environment);
    }
  }

  /** Compile `root` for the pass that draws it, upload its textures and take
   *  the first use of every program the compile linked. The programs are taken
   *  as the compile returns, before anything swaps a material out from under
   *  them: `GunFire.collect` clones a rig's flash materials right after the
   *  rig's compile starts, and the clones reuse these programs by key. */
  function warmSubtree(root, cam = page.camera, target = page.scene) {
    const compiled = page.renderer.compileAsync(root, cam, target);
    const programs = new Set();
    root.traverse(obj => {
      for (const m of [obj.material].flat()) {
        const linked = m && page.renderer.properties.get(m).programs;
        if (linked) for (const program of linked.values()) programs.add(program);
      }
    });
    return compiled.catch(() => {}).then(() => {
      uploadTextures(root);
      // A program released since (its last material disposed) has no GL
      // program left to ask.
      for (const program of programs) if (program.program) program.getUniforms();
    });
  }

  /** The level's warm-up, after applyFog() so the programs are the fogged ones
   *  the frame asks for, and again on every level switch. The effect pool and
   *  the gun stand-ins are built first; then the whole scene — terrain,
   *  statics, the level's LOD interiors and flags, parked vehicles and their
   *  hidden gun payloads, sky, water, the effect pool — is warmed for the main
   *  pass. */
  function warmLevel(library) {
    if (library) page.effects.warm();
    const stand = page.guns.warm();
    return Promise.all([warmSubtree(page.scene), warmSubtree(stand)]);
  }

  Object.assign(warm, {
    uploadTextures,
    warmLevel,
    warmSubtree,
  });
  return warm;
}
