# Verification ledger

Every claim our extraction code makes about a Refractor file format, and what
the binary says about it. One row per assumption. A row leaves `open` only when
someone has read the engine code and recorded where.

Status values:

| Status | Meaning |
|---|---|
| `confirmed` | the engine does this; evidence address recorded |
| `refuted` | the engine does something else; our code is wrong |
| `open` | stated as fact in our code, never checked against the binary |
| `moot` | checked, and it turns out not to matter for extraction |

`Evidence` is an address in [symbols.json](symbols.json) or a function in the
binary — never "it looked right in the viewer". Rendering correctly is not
evidence: most of these assumptions are true of vanilla data by coincidence and
only break on mods.

---

## StandardMesh (.sm)

| # | Assumption in our code | Where | Status | Evidence |
|---|---|---|---|---|
| SM-1 | Vertex layout is determined by `vertex_stride`; `flags` is decorative | [stdmesh.py](../../tools/bf1942-models/bf42/stdmesh.py) `vertex_layout` | **refuted** (reader fixed 2026-09-15) | `flags` is the engine's vertex format. `readMaterials` `0x005b42d0` (lnxded `loadLod` `0x083a6f00`) creates the buffer as `createVertexBlock(1\|0xc, flags, vertexCount)` — vtbl `0x00917a00` +0x1c = `0x0063ed70` — with no stride argument; the block computes it with `rend::getStride(flags)` (`0x00640f20`, lnxded `0x084451d0`) and the DX8 block turns the same bits into a `D3DFVF` (`0x00672a40`) that reaches `CreateVertexBuffer` (`0x00675520`). The file's stride is used once, as `stride * count` bytes to read from the stream. [subsystems/standardmesh-vertex-format.md](subsystems/standardmesh-vertex-format.md) |
| SM-2 | Stride 40 always means the extra 8 bytes are a lightmap UV pair | [stdmesh.py](../../tools/bf1942-models/bf42/stdmesh.py) `uvs2` | **refuted** | Bit 13 (`0x2000`) is "texture-coordinate set 1 with 2 floats" in `getStride` and `D3DFVF_TEX2 \| TEXCOORDSIZE2(1)` in the FVF builder; the stride follows from it, not the other way round. That vanilla binds the object lightmap to set 1 is still an inference from data (the `D3DTSS_TEXCOORDINDEX` writes in `0x005bf690` were not read) |
| SM-3 | `primitive` 4 is a triangle list, 5 is a strip | [stdmesh.py:95-105](../../tools/bf1942-models/bf42/stdmesh.py#L95) | open | — |
| SM-8 | Accepted file versions are 9 and 10 | [stdmesh.py:6](../../tools/bf1942-models/bf42/stdmesh.py#L6) | **refuted** | `0x005b61f0` accepts `7 < v < 0xb`, i.e. **8**, 9 and 10 |
| SM-4 | Descriptors for a LOD precede all their payloads | [stdmesh.py:285-288](../../tools/bf1942-models/bf42/stdmesh.py#L285) | open | 33,038 meshes parse with zero structural failures, which is strong but is data, not code |
| SM-5 | The three `unknown` u32s before `primitive` are reserved | [stdmesh.py](../../tools/bf1942-models/bf42/stdmesh.py) | open | all zero across 234,144 descriptors. Both loaders read them as **one 12-byte raw read** into a zero-initialised 12-byte local (lnxded `0x083a7025` `read(IStream*, void*, 0xc)`; client `FUN_0061acd0(0xc)` in `0x005b42d0`) and the server never looks at it again — a POD, not three fields; meaning still unknown |
| SM-6 | The 4th float per collision vertex is not a position component | [stdmesh.py:230](../../tools/bf1942-models/bf42/stdmesh.py#L230) | open | — |
| SM-7 | Collision face `material` is the armour-region id; 50-54 is the tank range | [damage.py](../../tools/bf1942-models/bf42/damage.py) | open | official BF1942 Damage System tutorial, not the binary |

### SM-1 / SM-2 — settled 2026-09-15

Full narrative, every address and the bit table:
[subsystems/standardmesh-vertex-format.md](subsystems/standardmesh-vertex-format.md).

**The claim** was that `stdmesh.py` could lay a vertex out from `vertex_stride`
and ignore `flags`. Across vanilla plus 14 mods (33,038 meshes, 234,144
descriptors) the two agreed except once — `bf1918/standardMesh/o_WoodenCart_M2.sm`,
flags `0x411` in a 64-byte stride — and there the reader took every other
vertex and invented a lightmap channel from the neighbour's position.

**What the engine does.** The loader reads a material's payload as one blob
and creates the GPU buffer from `(flags, vertexCount)` alone:

| step | client | lnxded |
|---|---|---|
| per-LOD material reader; descriptor dwords `d0 flags, d1 stride, d2 count, d3 indexCount`; `createVertexBlock(1\|0xc, d0, d2)`; `stream->read(p, d1*d2)` | `0x005b42d0` | `0x083a6f00` (skips `d1*d2`) |
| `RendPCDX8` resource vtable; `+0x1c` createVertexBlock, `+0x20` createIndexBlock | `0x00917a00` → `0x0063ed70` / `0x0063ede0` | — |
| `rend::getStride(format)`: bit-sum, `0x411→32`, `0x2411→40` | `0x00640f20` | `0x084451d0` |
| `MemVertexBlock::create(blockFormat, format, count)`: `+0x1c = getStride(format)`, `+0x18 = stride*count` | `0x006410d0` (vtbl `0x00917cc4`) | `0x08445530` (vtbl `0x0874c720`) |
| format → `D3DFVF` (`XYZ`, `XYZRHW`, `XYZB1..4`, `NORMAL`, `DIFFUSE`, `SPECULAR`, `TEXCOORDSIZEn(k)`, `TEX1..4`) | `0x00672a40` | — |
| DX8 block ctor stores FVF `+0x2c`, stride `+0x20`; `CreateVertexBuffer(…, FVF, …)` via device `+0x5c` | `0x006773d0`; `0x00675520` | — |

Because the buffer is an FVF buffer, Direct3D fixes the component order:
position (with blend weights), normal, diffuse, specular, texcoord sets 0..3.
`position[3] normal[3] uv[2] (uv2[2])` was right for both vanilla words by
coincidence of stride.

**The counterexample, decoded the engine's way** — `getStride(0x411) * 288`
bytes of a `64 * 288`-byte payload, at 32 bytes per vertex — gives 288 vertices
with unit normals whose bounding box equals the file's header bounds; the
trailing half is not geometry. The file's stride is an exporter bug the retail
client survives (it overruns the locked buffer by 9,216 bytes and draws the
cart correctly).

**Two earlier notes, resolved.** The client never tests the format word against
a literal because it is bit-tested in `getStride` / the FVF builder, not
compared. And `dice::ref2::geom::g_vertexFormat` `0x087473a4` /
`g_vertexStride` `0x087473a8` are dead: `0` in `.data`, never written, and the
stride is only the divisor of six `divl`s inside the
`StandardMeshTemplate::m_simplifyMeshes` branch of `loadLods` (`0x083a65b0`,
`0x083821b0`) — an unfinished mesh-simplify tool, not the loader.

**Reader.** `vertex_layout(flags)` / `engine_stride(flags)` in `stdmesh.py`;
accessors step by the engine stride; the stream still advances by
`stride * count`; `Material.stride_matches_flags` reports the disagreement.
Survey: `python3 features/bf1942-engine-reference/surveys/stride_vs_flags.py`.

---

## Dynamic-mesh lighting (settled 2026-09-13)

How the engine lights vehicles and non-lightmapped statics, settled for the
map viewer's analytic-rig replacement (`bindDynamicShading` in
`tools/bf1942-models/viewer/map.html`):

| # | Finding | Status | Evidence |
|---|---|---|---|
| DL-1 | Lit StandardMesh materials draw with stage0 **MODULATE2X**(TEXTURE, DIFFUSE); `lighting false` materials get `D3DRS_LIGHTING=0` + SELECTARG1(TEXTURE) | **verified** | `StandardMeshSubShader_applyRenderState` 0x005bf690, reached via vtable 0x009061a4 whose trailing .rdata is the `.rs` attribute string block (`envmap`, `materialSpecularPower`, `materialSpecular`, `materialDiffuse`, `blendDest`, `blendSrc`, ...). Field map: +0x2d lighting, +0x2e lightingSpecular→SPECULARENABLE, +0x2f twosided→CULLMODE, +0x34/+0x38 blend, +0x3c alphaTestRef, +0x44 material index → SetMaterial(base+i*0x44). |
| DL-2 | DIFFUSE is D3D8 fixed-function vertex lighting: SetLight slots 0–7 + LightEnable + `D3DRS_AMBIENT`, i.e. clamp01(ambient + globalAmbient + diffuse·max(0,N·L)) in 8-bit display space | **verified** | `RendPCDX8_flushDeferredState` 0x00604750 (SetLight/LightEnable/D3DRS_AMBIENT 0x8b cases); `LightDesc_toD3DLIGHT8` 0x0045f210 (per-light ambient slot populated, type 0 → DIRECTIONAL). |
| DL-3 | Material colour is effectively white in the combine | **working** | survey of vanilla `standardMesh.rfa`: `materialDiffuse` is `1 1 1` in 3202/3523 declarations; no `materialAmbient` attribute exists in any of 1297 `.rs` files. |
| DL-4 | `FUN_00664560`'s MODULATE **1x** is NOT the mesh path | **verified** | it is the simple texture path of the DX8 renderer (own texture cache at +0x90008); a prior session nearly calibrated mesh lighting off it. Do not repeat. |

Not modelled in the viewer (documented gaps): per-material specular
(`lightingSpecular`, ~1/3 of vanilla materials) and the `envmap` reflection
stage (338 materials).

---

## Soldier camera shake / view bob (settled 2026-09-15)

What `setCameraShake*` in `animations/AnimationStates*.con` actually does, settled
for the first-person soldier in `tools/bf1942-models/viewer/soldier.js`. The open
question was the **third argument** — `setCameraShakeUpDown 0 0.08 15` — whose unit
had never survived measurement.

| # | Finding | Status | Evidence |
|---|---|---|---|
| CS-1 | The third argument is an **angular rate in radians per second**. Each channel is `amplitude * sin(rate * t) * factor`, `t` an instance-local seconds accumulator advanced `t += dt`. Not Hz, not a duration, not a count | **verified** | `getCameraShakeTransform` 0x00613e90 (lnxded `dice::anim::AnimationStateMachineInstance::getCameraShakeTransform` 0x0832b6c0): six `sin()` call sites, each `fld [block+rate]; fmul [this+0x8]; call sin; fmul <amp*factor>`. `t += dt` at lnxded 0x0832b825–0x0832b845. |
| CS-2 | The first argument is a **slot index** (clamped 0..2): a state may chain three shakes, each with its own `timeToShake`/`fadeOut`, advanced when one expires. All of vanilla uses slot 0 | **verified** | setters lnxded 0x08329d30–0x08329ed0 (`cmp edx,2; ja <ret>`, `this + idx*68`); slot advance `f15 = slot+1` at lnxded 0x0832b8ad. |
| CS-3 | `fadeIn` and `fadeOut` are **rates per second**, not durations: `factor += fadeIn*dt` clamped to 1, `factor -= fadeOut*dt` floored at `minFactor`. `fadeIn <= 0` snaps the factor to 1 | **verified** | lnxded 0x0832bd78–0x0832bdc2 (fade in), 0x0832b877–0x0832b8b3 (fade out). So `setCameraShakeFadeIn 0 0.6` ramps over 1/0.6 = 1.67 s. |
| CS-4 | Channels map: `UpDown`→translate Y, `LeftRight`→translate X, `InOut`→translate Z, `Pitch`/`Yaw`/`Roll`→rotate X/Y/Z **in degrees** | **verified** | Mat4 stores at +0x34/+0x30/+0x38; `setRotateXDeg`/`YDeg`/`ZDeg` at lnxded 0x08251240 / 0x081a24b0 / 0x08062740. |
| CS-5 | Nothing scales the shake by ground speed. `dt` passes through untouched; the gait only selects which animation state is current | **verified** | `BFSoldier::updateCameraShake` 0x004facd0 — the only caller; passes its `dt` argument straight down. |
| CS-6 | **The walking view bob is multiplied by a shipped zero.** The lower-body state machine, which owns every `Lb_Walk/Run/Crouch/Lie` locomotion state, is scaled by `cameraShakeFactor`; that global is `0.0f` in initialized `.data` and no vanilla file sets it. Weapon-fire (`Ub_*`) and explosion/hit shakes are unaffected — they are passed a hardcoded `1.0f` | **verified** | `cameraShakeFactor` = `DAT_0099000c` 0x0099000c, inside `.data` (0x00952000–0x00a9298b, initialized), bytes `00 00 00 00`. Its only writers are the console accessor for the `PlayerControlObjectTemplate` property of that name (registrar 0x004f1310, string 0x008e9604); no static initialiser writes it. Searched every `.con`/`.inc`/`.tweak` in `Objects.rfa`, `animations.rfa`, `Game.rfa`, `menu.rfa` and both `Settings/` trees: no assignment anywhere. |

The consequence of CS-6 is worth stating plainly, because it is the opposite of
what the authored data looks like: **retail BF1942 has no first-person walking
view bob.** The `Lb_*` shakes are real, carefully tuned, and inert. Anyone
calibrating a soldier camera against the `.con` files alone will add a bob the
game does not have.

Instance layout, for a future reader: a `BFSoldier` holds three
`AnimationStateMachineInstance`s in an array based at +0x294 (lnxded), 68 bytes
each — 0 lower body, 1 upper body, 2 camera-shake triggers. Slot 2 is proven by
`triggerCameraShake`, which is the entry point for `BigExplosion`, `HitShake` and
`DieShake` in `animations/AnimationStatesCameraShakes.con`.

---

## Hand-weapon deviation & first-person view (settled 2026-09-15; mount closed the same day, VIEW-3..8)

The mesh-viewer's firing-feel and 1P-placement approximations, checked against
`HandFireArms::updateDeviation` (client `0x00551f50`, decompiled in full; lnxded
`0x08293e80`) and the `BFSoldier` view chain. Full write-up with the formula and
every address: [subsystems/handweapon-view-and-deviation.md](subsystems/handweapon-view-and-deviation.md).

| # | Assumption in the viewer | Status | Evidence |
|---|---|---|---|
| DEV-1 | Channels combine additively | **confirmed** | `0x00551f50` epilogue: total = minDev + fire + speed + turn + misc (+ AI one-shot) |
| DEV-2 | `dev = min·devMod[stance] + …` | **refuted** | minDev is added unscaled; devMod scales the dynamic channels only — caps ·M, raises ·M² (double multiply read in both binaries), decays ÷M |
| DEV-3 | Aiming/zoom halves deviation (×0.5) | **refuted** | no zoom/aim term anywhere between accumulators and total, either binary; zoom affects FOV + mouse scale only |
| DEV-4 | Fire bloom adds per shot and decays linearly | **confirmed** | `FireArms::Fire` lnxded 0x0828a2aa: fire += fireDev.b, clamp fireDev.a; decay fireDev.c/M per tick (hand), fireDev.c (vehicle base 0x00539620) |
| DEV-5 | Decay clock is 60 Hz | **refuted — it is 30 Hz, fixed (closed 2026-09-15)** | no dt in updateDeviation; one linear step per `BFSoldier::handlePlayerInput` call (lnxded 0x08274da2), and the client makes that call once per simulation tick of `1/g_simulationFps` = 1/30 s: `g_simulationFps` client `0x00957640` = 30.0f (50 READ xrefs, no writer, no console word; lnxded `0x08716b5c` also 30.0) → `Setup::initInputDevices` 0x00444e70 stores `Setup+0x184 = 1/fps` → `InputManager::update` 0x0049ce70 accumulates whole ticks (`floor((now−last)/tickDt)`, backlog >10 dropped) → `Setup::mainLoop` 0x0044abc0 `game->update(nTicks, 1/30)` → `GameClient::update` 0x0048fca0 runs `simulateFrame(1/30)` nTicks times → `simulatePlayerUpdate` 0x004b6a30 pops ONE `ActionBuffer` entry and calls `handlePlayerInput(player, input, 1/30)` at 0x004b6b56 / `BFPlayer::handleInput` at 0x004b6b90. Every link is the twin of a named lnxded function (0x080bc090 / 0x080bc540 / 0x08132940 / 0x0815c2a0 / 0x0815bd00). The viewer's `TICK_HZ` is now 30 |
| DEV-6 | speed/turn terms scale with analog input | **confirmed for turn only; channels 4/5 = MouseLookX/Y verified independently** | turn: ·\|MouseLookX/Y\|; speed: binary gates \|throttle\|>0.01, \|yaw\|>0.01 with constant increments. Channel order read out of code, not string order: lnxded `operator<<(ostream&, PlayerInputMap)` 0x081d89f0 is an enum-indexed jump table (0x086c88c4): 0 Yaw, 1 Pitch, 2 Roll, 3 Throttle, **4 MouseLookX, 5 MouseLookY**, 6 CameraX, 7 CameraY, 8 Fire, 9 Action, 10 Use, 11 MouseLook, 12 Walk, 13 Run, 14–22 MenuSelect1–9, 23 AltFire, 24 Reload, 25 Drop, 26 ToggleCameraMode, 27 ToggleCamera, 28 Lie, 29 Crouch, 44 SayAll, 45 SayTeam, 46 NextItem, 47 PrevItem, 48 Communication, 50 Map, 51 ZoomMap, 55 None — matching the client-verified Fire=8 / AltFire=23 anchors. And `BFSoldier::handlePlayerInput` copies in[4] (valid bit 4) into the local that advances the unclamped angle at +0x288 and in[5] (bit 5) into the one clamped by the pitch limits at +0x284 (0x08273e3c–0x08273e8b, 0x08274305, 0x08274526), i.e. X = yaw, Y = pitch |
| DEV-7 | miscDev applies to airborne/swim/vehicle | **settled: jump only** | bool arg = input[9] (c_PIAction) ≠ 0 && soldier+0x3c8==0, lnxded 0x08274d7d; Fire=8 anchor verified client-side (`FUN_0053af70`) |
| VIEW-1 | soldierCameraPosition displaces the camera | **refuted** | it displaces the 1P arms+weapon rig: setZoom (lnxded 0x082881a0) → soldier targetOffset +0x248 → eased +0x254 → `BFSoldier::updateAnimations` → `Skeleton::transform` (0x083420f0). Camera eye unchanged |
| VIEW-2 | hip↔zoom snaps | **refuted** | `BFSoldier::handleVisualUpdate` 0x08270fd0: cur += (target−cur)·0.25 per visual update (const 0x086c08ac), no dt; FOV factor 0.7/0.3 blend, snap at Δ≤0.001, applied via applyFovModifier 0x0826d490 |
| ZOOM-1 | Right-mouse zoom is a hold state | **refuted** | press-toggle: altFireOnce edge filter client 0x00500901 (AltFire bit 23 masked unless fresh press); camera mode 0↔2 switch 0x004fc8b6 |
| ZOOM-2 | Firing breaks zoom | **confirmed conditionally** | only when `UnZoomBetweenFireTime` > 0 (tmpl +0x3d0 client / +0x268 lnxded): pending flag +0x20c, un/re-zoom in `FireArms::handleUpdate` 0x08288890. Reload and weapon switch always unzoom; movement never does (no path found) |
| VIEW-3 | The 1P base vector `BFSoldierTemplate+0x15c` ships as (0,0,0) | **refuted** | it is `center1pHands`: lnxded `ConsoleClass178::executeObjectMethod` 0x082bbaf0 writes +0x15c/0x160/0x164 via `getActiveTemplate(CID_BFSoldierTemplate)`; client execute 0x004ca700 writes template +0x20c/0x210/0x214, the fields `BFSoldier::updateAnimations` 0x004fb150 adds. Vanilla −0.12/−1.56/0.1 |
| VIEW-4 | The rig needs a calibrated x/y/z/yaw on top of `center1pHands` (VIEWMODEL_CAL) | **refuted** | the chain is `rotate90aroundX · T(center1pHands + eased) · S · M` → `Skeleton::transform` (client 0x004fb150 decompiled; lnxded 0x0826ecf8–0x0826f0e8) with no rotation term; `rotate90aroundX` = rows (1,0,0,0)(0,0,1,0)(0,−1,0,0)(0,0,0,1) from cos/sin(−π/2) in both initializers (lnxded 0x0827ecb0, client 0x00850d00); `S` = the camera-shake matrix (client 0x004facd0 → +0x54c), `M` = the camera's `getRelativeTransformation` (Camera vtable 0x087209a0 slot +0x74) |
| VIEW-5 | The x component of `soldierCameraPosition` / `center1pHands` might be mirrored | **settled: +x = the viewer's right** | view frame is D3D left-handed: `convertWorldPosToScreenPos` 0x00440790 divides by view z and maps +x to screen-right; `rotate90aroundX` only swaps y/z |
| VIEW-6 | The 1P rig is posed on `Lb_Stand` frame 0 + the 1P idle | **refuted** | the lower-body machine applies nothing in first person: `AnimationStateMachineInstance::updateAnimations` returns when clipIndex ≥ clip count (lnxded 0x0832af36) and `updateState`'s 0x3a rule (0x0832b4a5) finds no 1P slot on any `Lb_*` state; `setFirstPerson` restores the template skeleton's rest locals (0x0826d3d9). Exporter now bakes the rest lower body |
| VIEW-7 | The 1P parts are drawn under the world camera's projection | **refuted (renderer half open)** | `setFirstPerson`/`applyFovModifier` → `setFirstPersonFov` (lnxded 0x0826b330, client 0x004f7120) → `IID_IViewModifier` 0xf0e2bbfa slot +0xc = `BStandardMesh::setFieldOfView` (mesh +0xf0) with `set1pFov × SoldierZoomFov`; `StandardMeshRenderer::drawFov` is a separate pass. The projection that pass builds, and its near plane, are client-only and unread |
| VIEW-8 | The soldier's view FOV is `set1pFov 0.47` (53.86°) | **refuted** | `renderer.fieldOfView 1` (VideoDefault.con) → `RenderView::setFieldOfView` 0x08444260, a whole vertical angle in radians (`Frustum::setupFrustum` 0x08440c70 halves it, divides by aspect 0.75 for the sides) = 57.30°; soldier `vehicleFov` (+0x248, 0x0831c060) unset, `Camera::setVehicleFOV` 0x081aadd0 keeps the default |
| VIEW-9 | `zoomFov` is an absolute FOV in the render view's unit (radians, whole vertical angle) | **verified (was inferred)** | client `FireArms::setZoom` 0x005391b0 (twin of lnxded 0x082881a0, read side by side): saves `g_renderView(0x009ab868)->getFieldOfView()` (IRenderView slot +0x18) to weapon+0x1f4, copies `zoomFov` to +0x1f8, publishes it as component 0x5000 (`setComponent`, slot +0x28; lnxded slot +0x2c at 0x0828826c–0x08288283), and on the apply/restore path at 0x005393d9–0x005393f6 writes the +0x1f8 value straight into slot +0x14 = `RenderView::setFieldOfView(float)` (lnxded RenderView vtable 0x0874c600: vptr+0x14 set, +0x18 get). Same slot `Camera::setVehicleFOV` 0x081aadd0 uses for `vehicleFov`. No conversion anywhere: the Thompson's 0.5 is 28.6° vertical, a sniper's 0.1 is 5.7° |
| VIEW-10 | Zoom scales the mouse deltas by `SoldierZoomFov` | **corrected: by `zoomFov`** | the site 0x0050095f multiplies the two look locals by `[[weapon+0x4c]+0x3dc]`; off that pointer +0x3dc is `zoomFov` (the field `setZoom` 0x005391b0 tests first and publishes), `SoldierZoomFov` is +0x3e0. `FireArmsTemplate::makeScript` 0x0053a110 and the doc's §1 table see the same fields 4 bytes lower (useScope +0x3d4, zoomFov +0x3d8, SoldierZoomFov +0x3dc) because its `this` is an interface subobject at object+4. With `renderer.fieldOfView 1` the default FOV is 1.0 rad, so multiplying by `zoomFov` is multiplying by the zoomed/default FOV ratio |
| VIEW-11 | The hip↔zoom ease (`handleVisualUpdate`) runs on the same clock as deviation | **refuted — per rendered frame** | `BFSoldier::handleVisualUpdate(float,float)` is IObject vtable slot vptr+0x4c (BFSoldier vtable 0x0872f040 +0x54) and its only callers are the two `call *0x4c` in `ObjectDrawer::objectsVisualUpdate` 0x08198130 (0x08198255, 0x08198372), reached from `ObjectDrawer::drawVisible(float)` 0x08197fa0 — the draw pass. Deviation steps at 30 Hz (DEV-5); the ease steps once per frame. The viewer already keeps the two apart |
| FA-1 | `FireArmsTemplate+0x2ec` (lnxded) is a per-projectile random spread applied in `Fire` when > 0 | **refuted — it is `fireingForce`** | written by `ConsoleClass334::executeObjectMethod` 0x082d5350 via `getActiveTemplate(CID_FireArmsTemplate 0x086c2b8c)`; the static object at 0x087a34c0 (initializer 0x0829d010 @ 0x082acbb1) carries the name string 0x086d5328 = `fireingForce` (sic) and arg type `float`. In `FireArms::Fire` 0x0828a090 it is tested non-zero at 0x0828a293 and at 0x0828a48f multiplies the barrel's negated forward vector into a `Vec3` handed with `getAbsolutePosition()` to `getRootParent(this)->slot+0x68(force, pos)` — a recoil impulse on the root object, not a spread. The `deviation` / `deviationCorrectionTime` strings (0x086f5487 / 0x086f546f) are registered by the AI-layer initializer 0x084a2050 and are not FireArms words |
| GL-1 | The client applies the local player's input once per rendered frame | **refuted — once per 1/30 s tick** | `Setup::updateInputs` 0x00449470 pops exactly `nTicks` `gameInput` samples per frame (`InputManager::getPendingTicks` 0x0049d1c0 = produced − consumed) and enqueues one `PlayerInput` per local player per tick through `Game::addPlayerInput` 0x0040ecb0 (defined in Ghidra this session; a pure `list::push_back` on the Game+0x2c map); `GameClient::processLocalPlayersInputs` 0x00488840 moves one per tick into the `ActionBuffer`; `simulatePlayerUpdate` 0x004b6a30 consumes one per tick. The device is polled once per frame with the whole elapsed time and the extra ticks re-read it with 0 (`InputManager::update` 0x0049ce70) |

---

## Menu node graphs — `MemeFile 2.0` (format settled 2026-09-15; MEME-10, -11, -13, MMAP-1, -2 and FONT-1 open)

`menu/InGame` and the other extensionless entries in `menu.rfa` are the
serialized `dice::meme::*` object graphs behind the HUD, spawn screen,
scoreboard and front end. Reader in
[meme.py](../../tools/bf1942-models/bf42/meme.py); the spawn-screen extract in
[extract_spawn_layout.py](../../tools/bf1942-models/extract_spawn_layout.py).
The file was measured first (nested sizes land on EOF to the byte), and the
frame layout then read out of the engine's own reader and writer.

| # | Assumption | Status | Evidence |
|---|---|---|---|
| MEME-1 | Header is u8-length strings until an empty one; `MemeFile 2.0` first, then a symbol table referenced by 1-based u16 index | **confirmed** | `FUN_007f7dc0` (read), `FUN_007f7bb0` / `FUN_007f7b10` (write, first-use numbering); `FUN_007f7ef0` reads a class name as `Ushort` |
| MEME-2 | Object pointer frame = `u32 size, u16 name, u16 class, fields`; size counts from the size field; NULL = `8,0,0`; name with empty class = registered-object reference | **confirmed** | `FUN_007ed4f0` (tell, Ulong, "Object name", "Class name", vtable+0x34 read, seek start+size); `FUN_007ecea0` back-patches the size |
| MEME-3 | Every `*Node` reads its "Next node" sibling *first*, inside its own frame, so a list is its first element and siblings nest | **confirmed** | `FUN_007ec100` = Node::read, called first by every node read; TransformNode `FUN_007e9510` reads X, Y, Width, Height then "Transformed node" |
| MEME-4 | A `CullNode` / `EffectNode` applies to the siblings after it in the same list | **confirmed by data** | every gated branch in InGame is `SplitNode > [CullNode, leaf]`; the tab strip, selected-row fill and SUICIDE/CLOSE swap all decode correctly under it |
| MEME-5 | Virtual resolution is 800x600, stretched to the screen | **confirmed** | root `TransformNode 0,0,800,600`; kit rows at `Y=127+83i` land on a 100 px pitch in a 1280x720 capture (720/600) |
| MEME-6 | `PictureNode` with an empty picture is a solid quad in the current colour | **confirmed by data** | the olive kit-row strip is `ColorEffect(0.52,0.49,0.30)` over an empty picture; the selected row `(0.84,1,0.5,a=0.4)` |
| MEME-7 | `BfButtonNode` draws its plate at texture size; Width/Height is the pointer region | **confirmed by measurement** | `FUN_007d9b50` reads two pictures then Width/Height; the `knapp*` art occupies (3,1)-(110,26) of a 128x128 sheet against W/H 109x25 |
| MEME-8 | The spawn map's rectangle is in the data | **refuted** | the `ShowMap` cull holds an empty `ClipNode`; the map picture is hot-swapped at runtime. The viewer's rect is measured from a capture and marked so |
| MEME-9 | The strings the InGame text nodes show come from `lexiconAll.dat` | **confirmed** | `u32 count, u32 columns, then key + 8 UTF-16LE NUL-terminated translations per record`; `RESPAWN_AT` = `ANTI-TANK` |
| MEME-10 | The spawn screen dims the map pane (the capture shows a black sea and a faint grid; the art is full colour) | **open** | Not in the data: `ShowMap` is `SplitNode > [CullNode(ShowMap), empty ClipNode]`, with no `EffectNode` near it. The multiplier and the pane rect must be set where the map picture is swapped in, `minimap_resolveMapPath` 0x0045d7c0. The viewer draws the art undimmed at a measured rect |
| MEME-11 | Classes with unread trailing fields (`ActionListAction`, `CallFunctionAction`, `CullEventActionNode` and the other event nodes) can be skipped to their frame end without losing layout | **open** | Safe by construction, since the size field bounds every frame. But those fields, which say what each button actually does, were never read |
| MEME-12 | The HUD minimap has no rect of its own in `menu/InGame` | **confirmed by data** | Same empty `ClipNode` as MEME-8. Its neighbours are declared: `ShowTicket` (620,4) 256x32, `Coordinates/ShowMapCoordinates` (627,185) 50x20 in `Style/InGameLatin11`, `ControlPoint/ShowControlPoints` (620,207) 256x16 |
| MEME-13 | The minimap's size and its small/large toggle are runtime values | **open** | Follows from MEME-12. Neither the size nor the toggle has been found in code; start from 0x0045d7c0 |
| MMAP-1 | Minimap zoom (`c_PIZoomMap`, N) cycles fixed steps | **open** | `minimap_screenTransform` 0x00469360 scales by `pow(..)` of `1 - member +0x40`. The write site, step count and step values were not found; likely in the undefined `.text` range 0x0046a5c0-0x0046e230 |
| MMAP-2 | Minimap rotation member `+0x64` is the player's yaw, zeroed by `game.setStaticMinimap 1` (the shipped default) | **open** | Inferred from the option's name and default ([minimap-and-fullmap.md](../bf1942-3d-models/minimap-and-fullmap.md) §3); no write site read. The viewer draws north-up, which is the default either way |
| FONT-1 | `Font/BF1942.font` (the HUD font) is a `key = value` header followed by `char x0 y x1` rows at a fixed `Height` | **open** | Read from the file; no reader uses it yet. The installed copy is the 2012 double-size variant (256 px atlas, `Height = 20`); `Font-Original.zip` holds the 128 px, `Height = 11` original. Unlike the `.dif` fonts, the two copies' metrics differ |

Primitive encodings via the `ClassIStream` vtable `0x00947288`: `+0x24` ushort,
`+0x34` float, `+0x38` bool (1 byte), `+0x3c` int, `+0x40` string (u32 length),
`+0x44` wstring (u32 length, UTF-16LE), `+0x4c` picture / `+0x50` font / `+0x54`
sound (u8 length), `+0x60..+0x88` object frames, `+0x98` tell, `+0xa0` class
name. Per-class field lists for 77 classes are in `meme.py`'s `SCHEMAS`, each
read out of the class's `vtable+0x30` method; the classes whose trailing fields
are unknown (`ActionListAction`, the event nodes) are skipped to the frame end,
which the size makes safe.

Bitmap fonts (`Font/<face>.dif` + 8-bit TGA, [font.py](../../tools/bf1942-models/bf42/font.py)):
row = `code left width right ascent x0 y0 x1 y1`; pen advance is
`left+width+right`, glyph top is `baseline - ascent`. The installed `Font.rfa`
is byte-identical in its metrics to `Font-Original.zip`.

---

## Projectiles and impact effects (settled 2026-09-15)

What a round does on arrival, settled for the mesh viewer's Thompson and
Bazooka: the effect frame, the bullet-hole decal, the damage falloff, and the
emitter/particle vocabulary. Full write-up with every address in
[subsystems/projectiles-and-impacts.md](subsystems/projectiles-and-impacts.md);
viewer code in `viewer/effects-core.js`, `viewer/effects.js`, `bf42/effects.py`.

| # | Finding | Status | Evidence |
|---|---|---|---|
| IMP-1 | An impact effect is stood up with **Up = the surface normal**; Right = Up x DOF, DOF = Right x Up, Right = Up x DOF, with DOF the fresh object's world +Z. The bullet hole therefore lies flat in the wall | **verified** | `Game::playCollisionEffect` client 0x0040e590 / lnxded 0x0805de20 writes the normal into transform row 1 then calls `makeOrthonormalBasis` client 0x0040e360 / lnxded 0x08061bd0 (both decompiled, identical) |
| IMP-2 | The effect for a hit is `MaterialManager.setEffectTemplate(attacker = ProjectileTemplate.material, defender = struck material)`; the projectile's `material` replaces the collision material before the lookup | **verified** | `Projectile::handleCollision` lnxded 0x0831ee80 (+0x88 override), `GameServer::handleCollisionForProjectile` 0x08153ba0 -> `MaterialManager::getEffectTemplate(att, def, \|v.n\|)` 0x081750d0. Per-cell `map<float,…>` keyed by the clamped cosine (`MMCell::getEffectTemplate` 0x081746a0) — one entry per cell in vanilla, so inert |
| IMP-3 | The bullet hole is a mesh *particle* — `Fx_Richo*Decal`, geometry `Decal_*_m1` (0.2 m quad in the XZ plane), lifted `relativePositionInUp 0.001`, `timeToLive` uniform 1..15 s, `alphaOverTime 0/1\|70/1\|100/0` — not a `DecalManager` decal | **verified** | data (`Objects/Effects/e_Decal_*/effects.con`, `Common/effects.con` composites `RichoStoneDecal` etc.); mesh particle scale/alpha path `Particle::handleUpdate` lnxded 0x0820ad20; `DecalManager` 0x081e05f0 has no impact caller |
| IMP-4 | Mesh-particle alpha goes to `IStandardMesh::setAlpha` as a byte, so with the decal's `.rs` `alphaTestRef 0.5` the hole vanishes at 50% opacity rather than fading to nothing | **verified** (server) | `Particle::handleUpdate` 0x0820ad20: `255 * alphaOverTime(phase)` -> QI IID_IStandardMesh -> vtable+0x34. Client `Particle::handleUpdate` not isolated |
| IMP-5 | `sizeModifier` is the mesh-particle scale switch: (0,0,0) = draw authored size; else scale = `size x sizeOverTime x sizeModifier` | **verified** | same function; default (0,0,0) in `ParticleTemplate` ctor lnxded 0x0820b000 and client `makeScript` 0x005384d0 (+0x7c..+0x84 written only when non-zero) |
| IMP-6 | Damage falloff: full to `distToStartLoseDamage`, linear to `minDamage x full` at `distToMinDamage`, flat after; skipped when `minDamage >= 1` or start `<= 0`. Base = `materialDamage` of the projectile's material | **verified** | `Projectile::getDamage` client 0x00542e80 / lnxded 0x0831f3c0, both decompiled. Client offsets +0x278/+0x27c/+0x280 from the console accessors 0x004da7f0/0x004da9a0/0x004dab50 |
| IMP-7 | `gravityModifier` defaults to 1.0 and scales -14.73 m/s^2; the projectile's own update integrates nothing (physics body does), it only runs the `explodeNearEnemyDistance` fuse | **verified** | `ProjectileTemplate` ctor lnxded 0x0831f8d0 (+0x164 = 1.0), client `makeScript` 0x00541a60 (+0x214 written when != 1.0); `Projectile::handleUpdate` 0x0831e940 |
| CRD-1 | `CRD_UNIFORM/a/b` samples `a + r(b-a)`, r in (0,1] — the two numbers are the ends in the order written (`15/1` = 1..15); `CRD_EXPONENTIAL/a` = `-a ln r`; `CRD_NORMAL/a/b` = `a + b N(0,1)`; the 4th field mirrors the sign with p = 1/2 | **verified** | `Random::getContinuousRandom` lnxded 0x081e28b0; emitter inline copy `Emitter::calcInvItensity` 0x081e2f10 (mirror at 0x081e3037) |
| EMT-1 | Emitter spawns are spaced `\|1/intensity\|` apart, intensity resampled per spawn and scaled by `speed / IntensityAtSpeed` when set; zero intensity = one per 100 s; `looping` restarts on expiry | **verified** | `Emitter::calcInvItensity` 0x081e2f10, `Emitter::handleUpdate` 0x081e3200 (+0x110 age, +0x114 next) |
| EMT-2 | The first spawn is at t = 0 | **inferred (data)** | decal emitters are `intensity 2` over `timeToLive 0.1` and every hit in the reference recording leaves a hole; ctor sets next = 0 (0x081e2bb0). Which branch at 0x081e3571 spawns for a template-bearing emitter is unresolved |
| EMT-3 | `startRotation` rolls the emitter frame about its DOF per spawn; units degrees | **verified axis / inferred units** | `dice::ref2::roll` 0x08061df0 = `rotateAboutLine(m, m+0x20 (row 2), angle)` at spawn site 0x081e522e; data writes 180/360 |
| EMT-4 | Spawn offset/velocity are `relativePositionIn*` / `positionalSpeedIn*` along the (rolled) frame; `addEmitterSpeed` adds the emitter's velocity x `emitterSpeedScale` | **verified** | spawn block 0x081e40a3-0x081e4e9d (`SpriteParticleNew::addParticle` call 0x081e4d8f), template offsets from `EmitterTemplate::makeScript` 0x081e61c0 / client 0x005097a0 |
| EMT-5 | The drag law is `v *= e^(-drag dt)` | **open** | the physics body's integrator was not read; `drag 20` on the bazooka smoke is what makes the puffs stop |

## Other formats

Add a section per format as it comes under investigation. Keep the same shape:
assumption, where it lives in our code, status, evidence.

| # | Assumption | Where | Status | Evidence |
|---|---|---|---|---|
| BAF-1 | `.baf` stores transposed quaternions | [baf.py](../../tools/bf1942-models/bf42/baf.py) | open | measured against real clips |
| TM-1 | A non-zero leading word that is not the collision magic is the visible vertex count | [treemesh.py:149-163](../../tools/bf1942-models/bf42/treemesh.py#L149) | open | — |
| RFA-1 | Archive names resolve case-insensitively, mod archives before parents' | [rfa.py](../../tools/bf1942-models/bf42/rfa.py) | open | — |

---

## Parse failures worth explaining

Ten meshes across the installed mods fail to parse outright. They are not
blocking anything, but each one is a fact about the format we do not have.

| Mod | Failures |
|---|---|
| bf1918 | 3 |
| GCMOD | 2 |
| WarFront | 2 |
| DC_Final | 1 |
| DesertCombat | 1 |
| FinnWars | 1 |
