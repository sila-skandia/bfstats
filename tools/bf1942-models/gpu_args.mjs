// The Chromium flags that put a headless harness's WebGL on the real GPU.
//
// ANGLE's Vulkan backend is the Linux PC's GPU. macOS has no Vulkan, and
// there those flags got SwiftShader, a CPU renderer: one behaviour audit of
// a community map took 10 min 43 s at twelve cores (2026-11-09). Metal is
// the Mac's GPU backend.
export const GPU_ARGS = process.platform === 'darwin'
  ? ['--use-angle=metal', '--ignore-gpu-blocklist']
  : ['--use-angle=vulkan', '--enable-features=Vulkan', '--ignore-gpu-blocklist'];
