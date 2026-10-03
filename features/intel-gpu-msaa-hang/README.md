# Intel GPUs hang drawing effects into MSAA

Reported 2026-10-03: replaying a round could freeze and crash the browser;
Firefox crashed often, Chrome less. The cause is a GPU lockup on Intel under
Mesa while the map page draws its effect sprites into a 4x MSAA canvas.
`?aa=0` stopped it in the owner's testing, so MSAA is now off by default there.

## What the evidence shows

Two Firefox crashes on this PC (18:10 and 18:31, Firefox 155.0.1, Mesa 26.2.2,
Iris Xe ADL GT2, kernel 6.18 LTS with GuC submission), plus the kernel log and
the GPU's saved error state.

- **The page hangs the GPU, in either browser.** The kernel names the first
  hang of each episode in `CanvasRenderer`, the thread that runs a page's
  WebGL in Firefox's parent process. Chromium hung it the same way at 18:41
  with the same code, `ecode 12:1:84dffffb` (IPEHR `0x7b000005`, a
  `3DPRIMITIVE`, XOR INSTDONE `0xffdffffe`).
- **It is a lockup, not a slow frame.** Each time, GuC could not reset the
  render engine (`Engine reset failed on 0:0 (rcs0)`), so the kernel reset the
  whole chip. That resets every context, Firefox's compositor (`Renderer`)
  included, which is why Firefox's crash report blames its own compositor
  (`DeviceResetReason::RESET` is `GL_GUILTY_CONTEXT_RESET` on WebRender's
  context). The failed engine reset is a known i915/GuC behaviour on these
  chips; hangs from other workloads show the same lines.
- **What it was drawing.** The batch in `/sys/class/drm/card1/error` holds 265
  draws (`scripts/i915-hang-draws.py` lists them). The GPU stopped at draw 235,
  in a run of 41 identical quads, about 130 in the batch: 4 vertices (position
  and UV), 6 indices, alpha (`SRC_ALPHA`/`INV_SRC_ALPHA`) or additive
  (`SRC_ALPHA`/`ONE`) blending, depth test on and depth write off, 4x MSAA,
  and a pixel shader of about 40 instructions. That is `effects.js`'s sprites:
  one pooled mesh per particle, `CustomBlending` from the template's D3D blend
  ordinals, `depthWrite = false`. The surface states were not captured, so the
  texture is not known.
- **Why Firefox dies and Chromium does not.** On Linux, Firefox runs its
  compositor in the browser process (`gpuProcess: unused`). After the chip
  reset its new compositor context hung three more times, then WebRender's
  `update_vbo_data_unsynchronized` (`gfx/wr/webrender/src/device/gl.rs:3626`)
  asserted on the `NULL` that `glMapBufferRange` returns on a lost context.
  That assert is Firefox's bug. Chromium loses its GPU process and restarts it.

## What changed

- `viewer/render-antialias.js` decides MSAA before `map.html` builds its
  renderer: off when the user agent is Linux or ChromeOS (not Android) and a
  throwaway context reports an Intel GPU; on everywhere else. Firefox reports
  the GPU in `RENDERER`, sanitised to a family ("Intel(R) HD Graphics, or
  similar"), and Chromium through `WEBGL_debug_renderer_info`. The page logs
  `map: MSAA off on <gpu>` when it applies.
- `?aa=1` forces MSAA on and `?aa=0` forces it off, so the hang can still be
  reproduced and the bench can still measure both. `perfbench.cjs --aa 1` passes
  it; without `--aa` the bench now runs this PC without MSAA.
- Only `map.html` changed. The model pages (`index.html`, `kits.html`,
  `poses.html`) draw single models with no effects and keep MSAA.

Checked by `tools/bf1942-models/tests/test_render_antialias.py` (the decision
for each browser and platform, the overrides, the probe's reading of each
browser's answer, and that it never throws), and in a page on this PC.

## Open

- Nothing replaces MSAA, so edges alias on Intel under Linux. An FXAA or SMAA
  pass would cost a full-screen draw and a second target for the near pass.
- Whether Intel's Windows driver hangs the same way is untested; MSAA stays on
  there.
- The fix rests on one session of testing with `?aa=0` and no hang. If one
  comes back with MSAA off, read it before guessing:
  `sudo dmesg -T | grep -iE 'i915|GPU HANG'` for the thread, then
  `sudo cat /sys/class/drm/card1/error > ~/gpu-hang.txt` and
  `python3 scripts/i915-hang-draws.py ~/gpu-hang.txt` for the draw. The file
  keeps the first hang since boot.
- The next suspect would be the number of separate particle draws. Batching
  them into one instanced draw is the change that would test it.
