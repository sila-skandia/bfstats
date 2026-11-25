// The pages without a remaster of their own (dogfight.html, tanks.html,
// index.html, kits.html) where WebGL is dead and WebGPU is not: three's WebGPU
// build, and its side renderer (webgpu-side-renderer.js) for their views
// (features/dogfight-school, "When WebGL will not start"). Loaded as
// a classic script ahead of the page's import map, and copied into the page
// at image build time (`data-inline`, mesh/stamp-viewer.mjs), because the
// build has to be picked before any module resolves 'three': the first
// import map to define a specifier wins, so this one goes ahead of the WebGL
// map. map.html's first script makes the same test inside its remaster
// choice. The page's script then takes its renderer from
// `webgpu-side-renderer.js` when `globalThis.bfWebglDead` is set.
(() => {
  if (!navigator.gpu) return;
  // WebGL that will not start (Safari on some Macs: every context is lost
  // the moment it is made, on every site) leaves the remaster's WebGPU as
  // the only build that draws. The test is synchronous: such a context is
  // already lost when getContext returns it.
  let dead = true;
  try {
    const gl = document.createElement('canvas').getContext('webgl2') || document.createElement('canvas').getContext('webgl');
    dead = !gl || gl.isContextLost();
    if (!dead) gl.getExtension('WEBGL_lose_context')?.loseContext();
  } catch { dead = true; }
  if (!dead) return;
  globalThis.bfWebglDead = true;
  const map = document.createElement('script');
  map.type = 'importmap';
  map.textContent = JSON.stringify({ imports: {
    three: './vendor/three-webgpu/three.webgpu.js',
    'three/webgpu': './vendor/three-webgpu/three.webgpu.js',
    'three/tsl': './vendor/three-webgpu/three.tsl.js',
    'three/addons/': './vendor/three-webgpu/addons/',
  } });
  document.currentScript.after(map);
})();
