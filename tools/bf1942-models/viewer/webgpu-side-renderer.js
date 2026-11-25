// A side view's renderer on three's WebGPU build (features/remaster-browser,
// features/dogfight-school "When WebGL will not start"). The WebGPU build has
// no WebGLRenderer, so the side views (a tank's sight, the controls preview,
// the proving ground's card, the schools' theatres) take theirs from
// `bfRemasterHooks.sideRenderer`, which this module fills in.
//
// Two pages install it: map.html under the remaster (remaster-renderer.js),
// and dogfight.html when the browser's WebGL is dead but WebGPU is not, which
// is Safari on some Macs: every WebGL context there is lost the moment it is
// made, on every site, while WebGPU draws. Like remaster-renderer.js this
// resolves 'three/webgpu', so it loads only under the WebGPU import map.

import * as THREE from 'three/webgpu';

/**
 * The few WebGLRenderer members the game's modules reach for that the
 * WebGPU renderer does not have, as harmless stand-ins: the warm-up asks
 * `properties.get(material)` for linked programs (none: WebGPU builds its
 * pipelines in `compileAsync`), the texture lists ask `capabilities` for the
 * anisotropy cap, and TEXTURE QUALITY's GL sampler pokes are skipped
 * (texture-quality.js checks `isRemaster`).
 */
export function installWebglShims(renderer) {
  const none = Object.freeze({});
  if (!renderer.properties) renderer.properties = { get: () => none };
  if (!renderer.capabilities) {
    renderer.capabilities = {
      getMaxAnisotropy: () => renderer.getMaxAnisotropy(),
      isWebGL2: false,
      maxTextures: 16,
    };
  }
  if (!renderer.extensions) renderer.extensions = { get: () => null, has: () => false };
}

/** A WebGPU renderer for a side view's canvas, initialised in the background,
 *  with the shims above. */
export function sideRenderer(options = {}) {
  const side = new THREE.WebGPURenderer({
    canvas: options.canvas, antialias: options.antialias ?? true, alpha: options.alpha ?? false,
    powerPreference: options.powerPreference ?? 'high-performance',
  });
  side.isRemaster = true;
  installWebglShims(side);
  // The side views draw from the moment they make their renderer, as a
  // WebGLRenderer allows (the tank school's stage renders once in the middle
  // of loading a matchup); three's WebGPU one throws on a render or a clear
  // before its device is up. Those frames are skipped, and `whenReady` lets a
  // view that draws only on demand draw again once it is up.
  for (const name of ['render', 'clear', 'clearColor', 'clearDepth', 'clearStencil', 'resetState']) {
    const own = side[name].bind(side);
    side[name] = (...args) => (side.initialized ? own(...args) : undefined);
  }
  side.whenReady = side.init().catch(err => console.warn('[webgpu] side renderer', err));
  return side;
}

/** Hand the side views their WebGPU renderer through the page's hooks. */
export function installSideRenderer(hooks = globalThis.bfRemasterHooks ?? (globalThis.bfRemasterHooks = {})) {
  hooks.sideRenderer = sideRenderer;
  return hooks;
}
