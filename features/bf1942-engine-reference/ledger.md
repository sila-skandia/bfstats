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
| SM-2 | Stride 40 always means the extra 8 bytes are a lightmap UV pair | [stdmesh.py](../../tools/bf1942-models/bf42/stdmesh.py) `uvs2` | **refuted** | Bit 13 (`0x2000`) is "texture-coordinate set 1 with 2 floats" in `getStride` and `D3DFVF_TEX2 \| TEXCOORDSIZE2(1)` in the FVF builder; the stride follows from it, not the other way round. The lightmap side, read 2026-09-16 (LM-1…LM-4): the object lightmap is bound to texture stage 1, and nothing on the lightmap path writes stage 1's `D3DTSS_TEXCOORDINDEX`, so it samples set 1 by Direct3D's per-stage default — provided the envmap branch's override (`0x30000` at `0x005bfaf4`) is always undone by the sibling reset `0x005bee20`, which restores it to 1. That pairing was not read (LM-3) |
| SM-3 | `primitive` 4 is a triangle list, 5 is a strip | [stdmesh.py:95-105](../../tools/bf1942-models/bf42/stdmesh.py#L95) | **confirmed** (2026-09-16) | It is the Direct3D `D3DPRIMITIVETYPE`, and the renderer's draw wrappers treat it as exactly that: `0x00667e10` range-checks 1–6 and computes the primitive count per type through a jump table (0x00667efc: list ÷3, strip and fan −2, line list ÷2, line strip −1, points as-is) before `DrawPrimitive`; `RendPCDX8_drawPrimitives` `0x00667d40` maps it through an identity table (0x00959c6c, anything else → 4) into `DrawPrimitiveUP`. Only 4 (232,593) and 5 (1,551, soldier bodies and 1P arms) occur in 234,144 descriptors. That the file field reaches those wrappers unchanged is inferred: the draw loop calls them through one more vtable |
| SM-8 | Accepted file versions are 9 and 10 | [stdmesh.py:6](../../tools/bf1942-models/bf42/stdmesh.py#L6) | **refuted** | `0x005b61f0` accepts `7 < v < 0xb`, i.e. **8**, 9 and 10; lnxded `loadHeader` 0x083a6200 agrees (`sub eax,8; cmp eax,2; jbe`). The reader was never fixed: `stdmesh.py:314` accepts (9, 10, 11) — 11 wrongly, 8 not at all. No installed file is version 8 or 11 (30,870 are 10, 2,176 are 9) |
| SM-4 | Descriptors for a LOD precede all their payloads | [stdmesh.py:285-288](../../tools/bf1942-models/bf42/stdmesh.py#L285) | **confirmed** (2026-09-16) | Two separate loops per LOD in both loaders: lnxded `loadLod` 0x083a6f00 reads every material's descriptor (0x083a6f92–0x083a70af), then walks them again skipping each vertex and index payload (0x083a7101–0x083a7138); client `readMaterials` 0x005b42d0 creates the buffers in its first loop and fills them in its second. Reading interleaved fails on the one real two-material LOD (`DC_Final` `ah64_static.sm`) |
| SM-5 | The three `unknown` u32s before `primitive` are reserved | [stdmesh.py](../../tools/bf1942-models/bf42/stdmesh.py) | open | all zero across 234,144 descriptors. Both loaders read them as **one 12-byte raw read** into a zero-initialised 12-byte local (lnxded `0x083a7025` `read(IStream*, void*, 0xc)`; client `FUN_0061acd0(0xc)` in `0x005b42d0`) and the server never looks at it again — a POD, not three fields; meaning still unknown |
| SM-6 | The 4th float per collision vertex is not a position component | [stdmesh.py:230](../../tools/bf1942-models/bf42/stdmesh.py#L230) | **confirmed** (2026-09-16); high half open | `SimpleCollisionMesh::load` lnxded 0x083c9e00 builds bounds from each vertex's first 12 bytes only. The low 16 bits of the 4th are the material word (`material \| flags<<8`) of a face using that vertex — what `SimpleCollisionMesh::giveVerticesMaterial` 0x083c9d60 writes, though its only caller is the authoring path `endCreation` 0x083ca950, so exporters bake it in. 99.85% of 3.76 million vertices match (100% in a 2,600-vertex re-check). The high 16 bits are unexplained |
| SM-7 | Collision face `material` is the armour-region id; 50-54 is the tank range | [damage.py](../../tools/bf1942-models/bf42/damage.py) | **confirmed**; the range is only convention (2026-09-16) | The struck face's `material` and `flags` go straight to `materialManager` (lnxded 0x0871d43c) → `getEffectTemplate` (vtable +0x50 = 0x081750d0) in `GameServer::handleCollisionForProjectile` (call at 0x08154572). Nothing in the Armor and MaterialManager code (0x08172000–0x08178000) or anywhere else in the server tests a material id against 50–54 or any range — no compare against 0x28–0x40, no `lea`/`add`/`sub` range idiom, no jump table. `damage.py`'s generic treatment is right |
| SM-9 | A collision layer's `size` and its two leading `unknown` words | [stdmesh.py:327-332](../../tools/bf1942-models/bf42/stdmesh.py#L327) | **settled** (2026-09-16) | lnxded `loadCollision` 0x083a6290: a `size` of 0 is a deliberate empty slot with nothing more to read (`stdmesh.py` raises on it; no installed file has one). The next word is the collider's class id for `SmartItf<IVectorCollider>::create` — 0xEB97C2FA, `CID_SimpleCollisionMesh`, in all 24,532 layers — and the one after is `SimpleCollisionMesh::load`'s format number, which must be 5 |

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

## Object lightmaps (settled 2026-09-16; LM-3 inferred)

How a lightmapped StandardMesh is drawn, read out of
`StandardMeshSubShader_applyRenderState` 0x005bf690 for the map viewer's
lightmap binding (`bindLightmaps` in `tools/bf1942-models/viewer/map.html`).
Extends DL-1 and corrects its field names.

| # | Finding | Status | Evidence |
|---|---|---|---|
| LM-1 | The object lightmap belongs to the mesh template, not to a material: when the template's byte +0x100 is set, `Texture/ObjectLightmaps/<name at +0x48>` is loaded into +0x18c, once per mesh | **verified** | `StandardMeshTemplate_readStream` 0x005b5f50 (`mov al,[esi+0x100]`, `mov [esi+0x18c],edi`). No `.rs` shader in 14 mods declares a lightmap texture. Unread: where +0x100 is set, and how +0x18c reaches the draw context's +0xac that the combine binds |
| LM-2 | A material draws unlit and lightmapped when `ctx+0xac != NULL && !transparent && (ctx+0xb0 & 1)`, overriding its own `lighting true` | **verified** | 0x005bf951–0x005bf976; the unlit branch is taken for `lighting == false` OR lightmapped (0x005bf978). 81.8% of flags-`0x2411` materials declare `lighting true`; they are drawn unlit whenever their mesh's lightmap is loaded. What bit 0 of `ctx+0xb0` means is unread |
| LM-3 | Stage 1 samples texcoord set 1 (`uvs2()`) whatever was drawn before | **inferred** | Nothing on the lightmap path writes stage 1's `D3DTSS_TEXCOORDINDEX`, so it keeps Direct3D's per-stage default. The envmap branch sets it to `0x30000` (0x005bfaf4), and the sub-shader's next vtable slot, `0x005bee20` (+0x14), restores it to 1 when envmap is set — but no call site pairing +0x10 with +0x14 was read |
| LM-4 | The combine is purely multiplicative: stage 0 `SELECTARG1(TEXTURE)`, stage 1 `MODULATE2X(CURRENT, TEXTURE)` with the lightmap, then return — `clamp(2 · base · lightmap)` | **verified** | 0x005bfbd7 onward, taken only when also `!textureFade`. No stage 2, no `TFACTOR`, no additive term. `map.html` adds an ambient floor inside that multiply: it is not an engine render state, so it is either baked into the lightmap's black point or a viewer compensation — unsettled |

**Field names corrected** (read from the sub-shader's attribute parser
`0x005c0500`): +0x2c is `transparent` and +0x31 is `textureFade` — the earlier
reading had +0x31 as `transparent`. The full map: +0x2c `transparent`, +0x2d
`lighting`, +0x2e `lightingSpecular`, +0x2f `twosided`, +0x30 `envmap`, +0x31
`textureFade`, +0x32 `depthWrite`, +0x34/+0x38 `blendSrc`/`blendDest` (defaults
5/6), +0x3c `alphaTestRef`. `applyRenderState` also returns straight after
binding stage 0 when the context's +0x64 is set.

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
| CS-6 | **The walking view bob is multiplied by a shipped zero.** The lower-body state machine, which owns every `Lb_Walk/Run/Crouch/Lie` locomotion state, is scaled by `cameraShakeFactor`; that global is `0.0f` in initialized `.data` and no vanilla file sets it. Weapon-fire (`Ub_*`) and explosion/hit shakes are unaffected — they are passed a hardcoded `1.0f` | **verified** | `cameraShakeFactor` = `DAT_0099000c` 0x0099000c, inside `.data` (0x00952000–0x00a9298b) but past the section's raw bytes, which end at 0x00960000, so the loader zero-fills it: `0.0f` at start-up. Its only writers are the console accessor for the `PlayerControlObjectTemplate` property of that name (registrar 0x004f1310, string 0x008e9604); no static initialiser writes it. Searched every `.con`/`.inc`/`.tweak` in `Objects.rfa`, `animations.rfa`, `Game.rfa`, `menu.rfa` and both `Settings/` trees: no assignment anywhere. |

The consequence of CS-6 is worth stating plainly, because it is the opposite of
what the authored data looks like: **retail BF1942 has no first-person walking
view bob.** The `Lb_*` shakes are real, carefully tuned, and inert. Anyone
calibrating a soldier camera against the `.con` files alone will add a bob the
game does not have.

Instance layout, for a future reader: a `BFSoldier` holds four
`AnimationStateMachineInstance`s, 68 bytes each, from +0x294 (lnxded; +0x2c0 in
the client) — 0 lower body, 1 upper body, 2 camera-shake triggers, and a fourth
that `updateCameraShake` leaves out and nothing here has read. Both constructors
build all four (lnxded `0x0826b400`: a two-pass loop from +0x294, then +0x31c and
+0x360; client `0x004ff440` the same from +0x2c0), and both `updateCameraShake`s
touch only the first three (2026-09-16). Slot 2 is proven by
`triggerCameraShake`, which is the entry point for `BigExplosion`, `HitShake` and
`DieShake` in `animations/AnimationStatesCameraShakes.con`.

---

## Soldier and vehicle physics (2026-09-16)

What the viewer's soldier and vehicle code assumes about jumping, wheel grip and
submersion, checked against the engine. The narrative is in
[subsystems/physics.md](subsystems/physics.md).

| # | Assumption in the viewer or tools | Status | Evidence |
|---|---|---|---|
| PHY-1 | A soldier jumps only when standing (`viewer/physics.js:645`), at `JUMP_SPEED = 5.4` (`:374`) | **confirmed** for the gate (client); the speed is still unmeasured | The client sets the jump bit 0x80 of the soldier's animation-state flags in `BFSoldier::handlePlayerInput` (0x00500190) only when neither crouch nor prone (0x60) is set, a word at `[esp+0x2c]` is non-zero, the Action input is not 0.0, the soldier's +0x140 pointer is non-null, and `BFSoldier::getSoundTrigger` (0x004f5c60, twin of lnxded 0x08276f40) is not `c_SstJump` (4). That call returns the upper body's current sound trigger, or the lower body's when the upper has none, so a soldier already in a jump state cannot jump again. `c_SstJump` is a sound-trigger constant registered identically in both binaries (symbols 0x08298280), not a name for bit 0x80. The server's look-alike block is dead code behind an always-equal `0.0 == 0.0` test (lnxded 0x082741b3). Where the jump becomes upward velocity is still unfound, but three places are ruled out (2026-09-16): no `.con` word in any mod carries a jump strength; `AnimationState` has no velocity primitive; and neither `handlePlayerInput` nor the server's `handleFrameUpdate` writes the velocity of the soldier's physics node (`IObject+0x60`) on either binary. The per-list virtual call in `handlePlayerInput` (lnxded 0x082751bf) is `ActiveKitPart::update`, the kit accelerators mod jetpacks use, as is `hasRoomForJump`. A server that computes no jump fits the client-predicted movement in `round-replay-capture` §2.4 |
| PHY-2 | `c_PGFEngineGrip` wheels are driven and the others roll (`viewer/ground.js:42`, `:179`), under one `mu` and a slip-angle curve (`:115-131`) | **confirmed** for which wheels are driven; the friction model is not the engine's | `ResponsePhysics::addFriction` lnxded 0x0825b6e0 reads the live grip byte +0xb4. EngineGrip (0x4) spins the wheel from the engine's ratio × differential RPM (`SpinWheel` 0x0825b440). RollGrip (0x2) removes the contact velocity along the wheel's axis. With neither, friction takes a Coulomb direction, and the solver sets StaticFriction (0x80) itself once sliding slows below a threshold. DummyGrip (0x20) is read from the authored byte +0xb5 (`getPermanentGrip`, vtable +0x6c) and bypasses the solve. There is no slip-angle curve; force magnitudes were not read |
| PHY-3 | `submarineData`'s seven floats are undocumented and passed through (`bf42/con.py:666`) | **refuted** (2026-09-16) | `PlayerControlObjectTemplate::submarineData` lnxded 0x083199a0 stores them at template +0x218…+0x230. `PlayerControlObject::handleFrameUpdate` 0x08318d20 acts every 0.5 s of accumulated time, and only while +0x17c is −1.0: crush damage when the current depth is *greater* than the 6th (also `getSubmarineMaxDepth`); oxygen (+0x178) drains by the 1st × elapsed when deeper than the 5th, and otherwise refills by the 2nd × elapsed, capped at a fixed 1.0. The 4th and 5th are `getSubmarinePeriscopeDepth`'s pair. That the 3rd and 7th scale suffocation and crush damage, and that a 6th of 0 turns the system off, is from the research report and was not re-verified. Mods reuse the same seven values on land vehicles and soldier kits |
| PHY-4 | A vehicle drags as `−drag·v` (`viewer/flight.js:877`, `:1147`) or by the sphere law (`viewer/ground.js:519`) | **open** — the engine has two laws, and which one a vehicle gets is unknown (2026-09-16) | `PhysicsNode::updatePhysics` (client 0x00540920, lnxded 0x082543d0) uses the sphere law with a fixed `r = 0.1` when bit 0x4 of the composite object's byte +0x7 is set, and otherwise a box law that is quadratic in speed and adds rotational drag (physics.md §3). Nothing found writes that bit — no `.con` word, no `or` of it in either binary |

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
| DEV-8 | Anti-tank and thrown weapons keep a deviation floor and lid of their own (`minDeviation` / `maxDeviation`, which the viewer's `deviation.js` stands in for) | **refuted** (2026-09-16) | Bazookas, panzerschrecks and grenades are plain `HandFireArms` — no other weapon class exists in any mod. 111 of 286 such templates use the ordinary `setMinDev` / `setFireDev` / `setDevMod` / `setTurnDev` / `setSpeedDev` / `setMiscDev` words. 78 instead use `minDeviation`, `maxDeviation`, `minDevStanding/Crouching/Lying`, `subDev…` and `addDev…` — 16 words present in neither binary's strings, so the engine ignores them, and unless a template also uses the ordinary words it keeps the `FireArmsTemplate` constructor's zero deviation (lnxded 0x0828d7de–0x0828d7f6). `deviation` / `deviationCorrectionTime` are `weaponTemplate.*` words of the bot-AI `WeaponTemplate` (registered at 0x084a6f01 / 0x084a6e33 in the AI initializer 0x084a2050), set on every weapon family, and have nothing to do with the player's spread |
| VIEW-1 | soldierCameraPosition displaces the camera | **refuted** | it displaces the 1P arms+weapon rig: setZoom (lnxded 0x082881a0) → soldier targetOffset +0x248 → eased +0x254 → `BFSoldier::updateAnimations` → `Skeleton::transform` (0x083420f0). Camera eye unchanged |
| VIEW-2 | hip↔zoom snaps | **refuted** | `BFSoldier::handleVisualUpdate` 0x08270fd0: cur += (target−cur)·0.25 per visual update (const 0x086c08ac), no dt; FOV factor 0.7/0.3 blend, snap at Δ≤0.001, applied via applyFovModifier 0x0826d490 |
| ZOOM-1 | Right-mouse zoom is a hold state | **refuted** | press-toggle: altFireOnce edge filter client 0x00500901 (AltFire bit 23 masked unless fresh press); camera mode 0↔2 switch 0x004fc8b6. Caution (2026-09-16): that pair goes through slot +0x28, which on `FireArms` is `updateFlags` (VIEW-12), so it may be set/clear masks for flag bit 2 rather than a mode number — not re-checked |
| ZOOM-2 | Firing breaks zoom | **confirmed conditionally** | only when `UnZoomBetweenFireTime` > 0 (tmpl +0x3d0 client / +0x268 lnxded): pending flag +0x20c, un/re-zoom in `FireArms::handleUpdate` 0x08288890. Reload and weapon switch always unzoom; movement never does (no path found) |
| VIEW-3 | The 1P base vector `BFSoldierTemplate+0x15c` ships as (0,0,0) | **refuted** | it is `center1pHands`: lnxded `ConsoleClass178::executeObjectMethod` 0x082bbaf0 writes +0x15c/0x160/0x164 via `getActiveTemplate(CID_BFSoldierTemplate)`; client execute 0x004ca700 writes template +0x20c/0x210/0x214, the fields `BFSoldier::updateAnimations` 0x004fb150 adds. Vanilla −0.12/−1.56/0.1 |
| VIEW-4 | The rig needs a calibrated x/y/z/yaw on top of `center1pHands` (VIEWMODEL_CAL) | **refuted** | the chain is `rotate90aroundX · T(center1pHands + eased) · S · M` → `Skeleton::transform` (client 0x004fb150 decompiled; lnxded 0x0826ecf8–0x0826f0e8) with no rotation term; `rotate90aroundX` = rows (1,0,0,0)(0,0,1,0)(0,−1,0,0)(0,0,0,1) from cos/sin(−π/2) in both initializers (lnxded 0x0827ecb0, client 0x00850d00); `S` = the camera-shake matrix (client 0x004facd0 → +0x54c), `M` = the camera's `getRelativeTransformation` (Camera vtable 0x087209a0 slot +0x74) |
| VIEW-5 | The x component of `soldierCameraPosition` / `center1pHands` might be mirrored | **settled: +x = the viewer's right** | view frame is D3D left-handed: `convertWorldPosToScreenPos` 0x00440790 divides by view z and maps +x to screen-right; `rotate90aroundX` only swaps y/z |
| VIEW-6 | The 1P rig is posed on `Lb_Stand` frame 0 + the 1P idle | **refuted** | the lower-body machine applies nothing in first person: `AnimationStateMachineInstance::updateAnimations` returns when clipIndex ≥ clip count (lnxded 0x0832af36) and `updateState`'s 0x3a rule (0x0832b4a5) finds no 1P slot on any `Lb_*` state; `setFirstPerson` restores the template skeleton's rest locals (0x0826d3d9). Exporter now bakes the rest lower body |
| VIEW-7 | The 1P parts are drawn under the world camera's projection | **refuted in code; renderer half read (VIEW-9)** | `setFirstPerson`/`applyFovModifier` → `setFirstPersonFov` (lnxded 0x0826b330, client 0x004f7120) → `IID_IViewModifier` 0xf0e2bbfa slot +0xc = `BStandardMesh::setFieldOfView` (mesh +0xf0) with `set1pFov × SoldierZoomFov`; `StandardMeshRenderer::drawFov` is a separate pass. What that pass draws with is VIEW-9 |
| VIEW-8 | The soldier's view FOV is `set1pFov 0.47` (53.86°) | **refuted** | `renderer.fieldOfView 1` (VideoDefault.con) → `RenderView::setFieldOfView` 0x08444260, a whole vertical angle in radians (`Frustum::setupFrustum` 0x08440c70 halves it, divides by aspect 0.75 for the sides) = 57.30°; soldier `vehicleFov` (+0x248, 0x0831c060) unset, `Camera::setVehicleFOV` 0x081aadd0 keeps the default. Client: `RenderView_ctor` 0x005b8120 defaults to `g_degToRad × 60` = 60° before the .con runs; aspect is `height/width` of the display mode (`Renderer_initDevice` 0x00462f50), 0.5625 at 16:9 |
| VIEW-9 | The `drawFov` pass draws the 1P parts with a projection of their own, near plane unknown | **projection and pass verified; retail's large state matches it, small-state cause open** | `BStandardMesh::setFieldOfView` (client 0x005ad160, lnxded 0x083b5560) bakes `pRenderView->getProjectionMatrix()` for the mesh's angle into mesh+0xf4; `RenderView::updateProjectionMatrix` (client 0x005b7fb0, lnxded 0x08444870): m00 = cot(fov/2)·(h/w), m11 = cot(fov/2), m22 = (n+f)/f, m23 = 1, m32 = −n(n+f)/f — `fov` a whole vertical angle in radians, near/far the render view's (0.1/1000; no `setNearPlane` on the path, so the near plane does **not** move). `Renderer_drawView` 0x004662c0: drawOpaque, drawTransparent, then `RendPCDX8_clear(2, 0, 1.0, 0)` (depth to 1.0), ambient/light/specular block, mip bias −10000, `drawFov` (0x0062cb00, pass id 2, `SkinningShader2Bones` for skinned StandardMeshes). Per mesh: `SetTransform(D3DTS_PROJECTION, mesh+0xf4)` (0x005aefa4) or the matrix into the skinning constants (0x005b091c), world projection restored after. **Retail draws both of its states against this**: the small state (Thompson-at-the-hip OBS capture, 1280×720) puts the right hand at (816, 614) against this rig's 0.47 rad render at (1042, 939), off frame — the world's 57.3°, not `set1pFov` — while the large state (Engineer rifles, 2560×1440 screenshots) measures 1.7–2.1×, matching 0.47 rad's predicted 2.28× and reproducing its framing directly. So the projection and pass are right and retail does draw them; what flips the small state back to the world's projection instead is still unfound (doc §7) |
| VIEW-10 | Zoom scales the mouse deltas by `SoldierZoomFov` | **corrected: by `zoomFov`** | the site 0x0050095f multiplies the two look locals by `[[weapon+0x4c]+0x3dc]`; off that pointer +0x3dc is `zoomFov` (the field `setZoom` 0x005391b0 tests first and hands to `RenderView::setFieldOfView`), `SoldierZoomFov` is +0x3e0. `FireArmsTemplate::makeScript` 0x0053a110 and the doc's §1 table see the same fields 4 bytes lower (useScope +0x3d4, zoomFov +0x3d8, SoldierZoomFov +0x3dc) because its `this` is an interface subobject at object+4. With `renderer.fieldOfView 1` the default FOV is 1.0 rad, so multiplying by `zoomFov` is multiplying by the zoomed/default FOV ratio |
| VIEW-11 | The hip↔zoom ease (`handleVisualUpdate`) runs on the same clock as deviation | **refuted — per rendered frame** | `BFSoldier::handleVisualUpdate(float,float)` is IObject vtable slot vptr+0x4c (BFSoldier vtable 0x0872f040 +0x54) and its only callers are the two `call *0x4c` in `ObjectDrawer::objectsVisualUpdate` 0x08198130 (0x08198255, 0x08198372), reached from `ObjectDrawer::drawVisible(float)` 0x08197fa0 — the draw pass. Deviation steps at 30 Hz (DEV-5); the ease steps once per frame. The viewer already keeps the two apart |
| VIEW-12 | `zoomFov` is an absolute FOV in the render view's unit (radians, whole vertical angle) | **verified (was inferred)** | client `FireArms::setZoom` 0x005391b0 (twin of lnxded 0x082881a0, read side by side): saves `g_renderView(0x009ab868)->getFieldOfView()` (IRenderView slot +0x18) to weapon+0x1f4, copies `zoomFov` to +0x1f8, sets its own flag bits 0x1000 and 0x4000 through `updateFlags(0x5000, 0)` (slot +0x28; lnxded vptr +0x2c = `BCompositeObject<IPlayerObject>::updateFlags` 0x08164570, at 0x0828826c–0x08288283 — corrected 2026-09-16: an earlier reading counted the gcc vtable from its symbol, two slots early, and took the call for `setComponent`, which is never passed 0x5000; the `UnZoomBetweenFireTime` re-zoom, client 0x0053eaad / lnxded 0x08288d99, pushes the masks the other way round and clears the two bits), and on the apply/restore path at 0x005393d9–0x005393f6 writes the +0x1f8 value straight into slot +0x14 = `RenderView::setFieldOfView(float)` (lnxded RenderView vtable 0x0874c600: vptr+0x14 set, +0x18 get). Same slot `Camera::setVehicleFOV` 0x081aadd0 uses for `vehicleFov`. No conversion anywhere: the Thompson's 0.5 is 28.6° vertical, a sniper's 0.1 is 5.7° |
| FA-1 | `FireArmsTemplate+0x2ec` (lnxded) is a per-projectile random spread applied in `Fire` when > 0 | **refuted — it is `fireingForce`** | written by `ConsoleClass334::executeObjectMethod` 0x082d5350 via `getActiveTemplate(CID_FireArmsTemplate 0x086c2b8c)`; the static object at 0x087a34c0 (initializer 0x0829d010 @ 0x082acbb1) carries the name string 0x086d5328 = `fireingForce` (sic) and arg type `float`. In `FireArms::Fire` 0x0828a090 it is tested non-zero at 0x0828a293 and at 0x0828a48f multiplies the barrel's negated forward vector into a `Vec3` handed with `getAbsolutePosition()` to `getRootParent(this)->slot+0x68(force, pos)` — a recoil impulse on the root object, not a spread. The `deviation` / `deviationCorrectionTime` strings (0x086f5487 / 0x086f546f) are registered by the AI-layer initializer 0x084a2050 and are not FireArms words |
| GL-1 | The client applies the local player's input once per rendered frame | **refuted — once per 1/30 s tick** | `Setup::updateInputs` 0x00449470 pops exactly `nTicks` `gameInput` samples per frame (`InputManager::getPendingTicks` 0x0049d1c0 = produced − consumed) and enqueues one `PlayerInput` per local player per tick through `Game::addPlayerInput` 0x0040ecb0 (defined in Ghidra this session; a pure `list::push_back` on the Game+0x2c map); `GameClient::processLocalPlayersInputs` 0x00488840 moves one per tick into the `ActionBuffer`; `simulatePlayerUpdate` 0x004b6a30 consumes one per tick. The device is polled once per frame with the whole elapsed time and the extra ticks re-read it with 0 (`InputManager::update` 0x0049ce70) |
| GL-2 | The client's default frame cap (`Setup+0x17c`) | **verified** (2026-09-16) | `Setup::Setup` (client 0x004568b0) writes 100.0f at 0x004569cb, as the server's ctor does into its twin +0xc4 (lnxded 0x080b7cf1): 100 frames per second. Two writers override it: the client-hosted-server branch sets 60 (0x00455e0a, gated on `Setup+0x3ee`), and `Renderer_drawFrame` 0x00466d80 flips it between 100.0f (0x00466e31) and 60.0f (0x00466e43) whenever `RendPCDX8` vtable +0x174 changes (0x0063eec0: the device field +0xec against the sentinel 0x80000000), gated on `Renderer+0x38`, whose writer is unknown. The cap only paces rendering and `handleVisualUpdate`; the simulation stays at 30 Hz |
| ANIM-1 | The 1P pose is `1PStandAimThompson` frame 0 over the `.ske` rest | **confirmed to 4 px** | `updateState` (lnxded 0x0832b270, client 0x00613c60) advances a normalized phase by dt·speed; `applyOnSkeleton` (lnxded 0x0832ed60, client 0x0066b740) slerps frames `int(frac·N) % frames` and `+1`; measured on the data, all 13 frames of the aim clip project within 3.6 px (right hand), 2.8 px (left), 3.2 px (barrel) of each other at 1280×720. The ~5° far-end residual against the capture is **not** in the animation system (§7 of the subsystem doc re-files it under the renderer/camera) |
| ANIM-2 | A clip's duration is `frames / 25 fps / speed` | **refuted** | no frame rate exists: a full pass is `1/\|speed\|` s (`applyOnSkeleton` maps frac(phase)·N onto the frame list, N = frames looping / frames−1 one-shot). Fire 10.0 → 0.1 s = the 600 rpm cycle; aim 0.1 → 10 s; deploy 1.0 → 1 s; reload (tweaked 0.21) → 4.76 s vs `reloadtime` 4.8. Exporter's `BAF_FPS` removed; extras `duration` is now 1/speed |
| ANIM-3 | Clip rates are the `addAnimation` arguments | **refuted** | `run 3pAnimationsTweaking` / `1pAnimationsTweaking` from `AnimationStates.con` lines 45–46 replace them by state name after cloning: `Ub_RunForwardThompson` 0.7 → 1.40, `Ub_StandReloadThompson` 0.4 → 0.21. The files are the output of the dev hot-key tuner in `BFSoldier::handleFrameUpdate` 0x08271820 (`changeAnimationSpeed` 0x0832be00 → 0x083287a0, the only two callers in the binary; `writeAnimationSpeedChanges` 0x08328aa0). `bf42/animstates.py` now applies them |
| ANIM-4 | Crossfades are 0.15 s (fire 0.02 s) | **refuted** | on entry weight = 0 (1 if the target's `setMorphFactor` > 1000, `.rodata` 0x086b1ca8), then `w += dt × state+0x2c` (client `state+0x34`; lnxded 0x0832b50c, ctor default 5.0 at 0x08328bf8); `Skeleton::setRelativeBoneTransform` (lnxded 0x0832f6e0, client 0x0066b5c0) slerps from the bone's *current* local. The parked previous clip (+0x38) is cleared by updateState whenever the new state has a clip, so the two-clip blend at 0x0832af74 is dead. Aim 0.7 (1.4 s), fire 4.0, deploy/reload 10000 (cut). Viewer fades now `1/morphFactor` from the extras |
| ANIM-5 | An aim-pitch, IK or lean term shapes the 1P arms | **refuted** | client `FUN_004fb150` decompiled: the lower machine's `updateAnimations` is skipped in 1P (`if (!isFirstPerson \|\| i != 0)`), mask −1, and the aim `FUN_004f7ca0(pitch)` calls plus the `+0x3ec × 90°` lean are all under `if (local_16c == 0)` (third person). `Skeleton::transform` 0x083420f0 has only the post-absolute (`bone+0x88`, writer virtual `setPostAbsoluteBoneTransform` 0x082656d0, cleared by `setFirstPerson`) and IK (`bone+0xe0`, sole writer `applyIk` 0x08342610, sole caller `AnimatedBundle::updateIk` 0x08265880 gated on `IID_IPlayerControlObject` 0x086d3c50 + `CID_BFSoldierTemplate` 0x086c2b88 — a seated soldier) hooks. `checkTransitions`'s three by-ref floats (`state+0xc8..0xd0`, default 1.0) are locomotion multipliers read by `handlePlayerInput` 0x0827562a |
| ANIM-6 | Idle fidgets and one-shot returns | **verified** | `setCurrentState` 0x0832b150 parks the idle timer at 1000 s, `updateState` re-arms `(rand&3)+4.0` s (0x0832b2d9, `.rodata` 0x086c0304); `AnimationStateMachineInstance::checkTransitions()` 0x0832be50 (from `AnimatedBundle::handleVisualUpdate` 0x08265730) → `AnimationState::checkTransitions(float)` 0x0832a390 picks `rand() % n` of the `addIdle` vector (+0xd4) at ≤ 0. One-shots end through `AnimationState::update` (lnxded 0x08329f00, client 0x00613a80): phase > 1 (or < 0) → `returnToState`/`addTransitionWhenDone` (+0xc0; `_POSE_` → 0xffff → base state +0x1c). `setUserRandomStartTime` → start phase `(rand&0xff)/255` (0x0832b413) |

---

## Menu node graphs — `MemeFile 2.0` (format settled 2026-09-15; minimap, button actions and the HUD font settled 2026-09-16; MEME-10 open)

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
| MEME-2 | Object pointer frame = `u32 size, u16 name, u16 class, fields`; size counts from the size field; NULL = `8,0,0`; name with empty class = registered-object reference | **confirmed** | `FUN_007ed4f0` (tell, Ulong, "Object name", "Class name", vtable+0x34 read — a thunk, `0x007ed120`, also at +0x2c in every class, that calls the class's real `read` at +0x30, seek start+size); `FUN_007ecea0` back-patches the size |
| MEME-3 | Every `*Node` reads its "Next node" sibling *first*, inside its own frame, so a list is its first element and siblings nest | **confirmed** | `FUN_007ec100` = Node::read, called first by every node read; TransformNode `FUN_007e9510` reads X, Y, Width, Height then "Transformed node" |
| MEME-4 | A `CullNode` / `EffectNode` applies to the siblings after it in the same list | **confirmed by data** | every gated branch in InGame is `SplitNode > [CullNode, leaf]`; the tab strip, selected-row fill and SUICIDE/CLOSE swap all decode correctly under it |
| MEME-5 | Virtual resolution is 800x600, stretched to the screen | **confirmed** | root `TransformNode 0,0,800,600`; kit rows at `Y=127+83i` land on a 100 px pitch in a 1280x720 capture (720/600) |
| MEME-6 | `PictureNode` with an empty picture is a solid quad in the current colour | **confirmed by data** | the olive kit-row strip is `ColorEffect(0.52,0.49,0.30)` over an empty picture; the selected row `(0.84,1,0.5,a=0.4)` |
| MEME-7 | `BfButtonNode` draws its plate at texture size; Width/Height is the pointer region | **confirmed by measurement** | `FUN_007d9b50` reads two pictures then Width/Height; the `knapp*` art occupies (3,1)-(110,26) of a 128x128 sheet against W/H 109x25 |
| MEME-8 | The spawn map's rectangle is in the data | **refuted** | the `ShowMap` cull holds an empty `ClipNode`; the map picture is hot-swapped at runtime. The viewer's rect is measured from a capture and marked so |
| MEME-9 | The strings the InGame text nodes show come from `lexiconAll.dat` | **confirmed** | `u32 count, u32 columns, then key + 8 UTF-16LE NUL-terminated translations per record`; `RESPAWN_AT` = `ANTI-TANK` |
| MEME-10 | The spawn screen dims the map pane (the capture shows a black sea and a faint grid; the art is full colour) | **open** | Not in the data: `ShowMap` is `SplitNode > [CullNode(ShowMap), empty ClipNode]`, with no `EffectNode` near it. Nor in `minimap_resolveMapPath` 0x0045d7c0 (read 2026-09-16): that is BfMenu's screen-path switch, and its only map work is installing the level's picture into the placeholder (`getMap()` vtable +0x4c) — no colour, blend or rectangle code. The one alpha found is BfMap's own: +0x4c eases toward +0x50 (both 1.0 at construction) and is the colour alpha of the icon draw `FUN_00468870` in `BfMap__update` 0x0046a680. What writes +0x50, and whether the map quad itself uses it, is unread, so any link to `game.setMinimapTransparency` is unproven. The viewer's 0.3 spawn-screen dim is hand-tuned |
| MEME-11 | Classes with unread trailing fields (`ActionListAction`, `CallFunctionAction`, `CullEventActionNode` and the other event nodes) can be skipped to their frame end without losing layout | **confirmed**, and the fields are now read (2026-09-16) | Each class's `read` (its real vtable +0x30, reached from the class-name string through its registration and `ClassInfo` +0x08 `createInstance`) gives the field list. `ActionListAction` (0x007f0ab0) is a run of `Action` frames with no count, read until its frame ends (`ClassIStream` +0x58). `CullEventActionNode` (0x007e3a80) and `CullVariableAndEventActionNode` (0x007e3bf0) end with an `Event` object. `SetPathAction` (0x007e6e50) — path node, destination node, in/out time, in/out wait, paint-over flag — is the page transition every mod uses; none of the twelve `Navigate…Action` classes occurs in a shipped menu. `BfNavigationButtonNode` (0x007d9db0) and `IndexDataData` (0x007ef4b0) are the tab and row selectors, and `AnyKeyEvent`, `ExtendedButtonEvent` and the empty `RemoveEventAction` complete the set. A button calls the `Function` object it names — `Function` has no fields (its `read` is the stub 0x007f8570) — most often `Sound/PlayMenuHighLight` (475), `Sound/PlayMenuOk` (398) and `Kit/OnSpawnButtonMouseOver` (255) of 2,796 calls. **`meme.py` bug:** the "Event type" of `TypeEvent` / `ButtonEvent` is 1 byte on the wire, where "Button type" at the same +0x5c slot is 4. With that fixed and these fields added, 228 of 230 pages in 16 archives read to zero leftover bytes; `menu/InternetMenu` and `menu/LocalMenu` still desync near `BfTransformNodeSize`, cause open |
| MEME-12 | The HUD minimap has no rect of its own in `menu/InGame` | **confirmed by data** | Same empty `ClipNode` as MEME-8. Its neighbours are declared: `ShowTicket` (620,4) 256x32, `Coordinates/ShowMapCoordinates` (627,185) 50x20 in `Style/InGameLatin11`, `ControlPoint/ShowControlPoints` (620,207) 256x16 |
| MEME-13 | The minimap's size and its small/large toggle are runtime values | **confirmed** (2026-09-16) | `BfMap` is a `TransformNode` (its ctor 0x0046e230 calls 0x007e95b0 first), and `BfMap__animate` 0x00468fb0 rewrites the inherited position (+0xc) and size (+0x14) every frame from the zoom fraction z (+0x40): x = 400 + 220(1−z) − 120z, y = 30, width = height = 175 + 337z. A top-right square, 175 units closed and 512 open, in 800×600 space. The small/large toggle is the zoom (MMAP-1). Closed it sits at (620, 30): the same x as `ShowTicket`, ending two units above `ShowControlPoints` |
| MMAP-1 | Minimap zoom (`c_PIZoomMap`, N) cycles fixed steps | **refuted** (2026-09-16) | Two states, eased: `BfMap__animate` 0x00468fb0 moves z (+0x40) toward 1 or 0, chosen by byte +0x3c, as `z += (target − z)(1 − e^(−9·dt))` (write 0x00469004, −9.0 at 0x008d6294) — about a 0.11 s time constant. `minimap_screenTransform` 0x00469360 crops the texture by `pow(2.3, (1 − z)·[+0x44])`, where +0x44 eases toward +0x48 at rate 6; both start at 0 and nothing read sets +0x48. Unread: the writer of +0x3c (the N key) and of +0x48 |
| MMAP-2 | Minimap rotation member `+0x64` is the player's yaw, zeroed by `game.setStaticMinimap 1` (the shipped default) | **refuted** (2026-09-16) | +0x64 is the *displayed* rotation, recomputed every frame by `BfMap__animate` 0x00468fb0 (write 0x004691c8) with no easing. With byte +0x58 clear it becomes (1 − z) × the wrapped target angle at +0x68, taking the shorter of the two ±2π windings; with +0x58 set it only re-wraps itself. A fully open map (z = 1) is therefore always north-up. It also holds still for the frame when z < 0.8 and byte +0xa9 of the object `playerManager` (0x0097d76c) vtable +0x18 returns is clear. Unread: who writes +0x68 (the player's yaw is the obvious candidate) and +0x58, and any link to `game.setStaticMinimap` |
| FONT-1 | `Font/BF1942.font` (the HUD font) is a `key = value` header followed by `char x0 y x1` rows at a fixed `Height` | **confirmed** (2026-09-16) | `Font::loadFontFile` (client 0x0065d1a0, `Font` vtable 0x00919098 +0x20) reads eight header lines by position without checking their keys — `Texture`, `TextureWidth`, `TextureHeight`, `BetweenWidth`, `SpaceWidth`, `Height`, `AlphaTest`, `AlphaBlend` — discards one line, then reads `%c %f %f %f` rows into a 256-entry table indexed by the raw character byte. A glyph is `x1 − x0 + 1` pixels wide; its UVs start half a texel in (`x0/W + 0.5/W`, `y0/H + 0.5/H`) and span `(x1 − x0 + 1)/W` by `Height/H`. `Font::buildQuads` (0x0065ce10) advances `(width + BetweenWidth) × scale`, except that a space draws nothing and advances `SpaceWidth × scale`; there is no per-glyph baseline. Boot code (0x00460e40) loads it into two font objects and only logs a failure. Only vanilla ships the file: the 2012 copy is 256 px, `Height` 20, `BetweenWidth` 0, `SpaceWidth` 5; the original in `Font-Original.zip` is 128 px, 11, 1, 1. `bf42/font.py` has no reader for it yet |

Primitive encodings via the `ClassIStream` vtable `0x00947288`: `+0x1c` and
`+0x3c` int, `+0x24` ushort, `+0x34` float, `+0x38` bool (1 byte), `+0x40` string
(u32 length), `+0x44` wstring (u32 length, UTF-16LE), `+0x4c` picture / `+0x50`
font / `+0x54` sound (u8 length), `+0x58` a run of object frames to the end of
the enclosing frame (no count), `+0x5c` an enum whose width the call chooses — 1
byte for "Event type", 4 for "Button type" — `+0x60..+0x88` object frames
(`+0x64` the event family, `+0x78` with a default-value callback, same bytes),
`+0x98` tell, `+0xa0` class name. Per-class field lists for 78 classes are in
`meme.py`'s `SCHEMAS`, each read out of the class's `vtable+0x30` method (the
object reader reaches it through the `+0x34` thunk `0x007ed120`). `meme.py` still
skips the classes MEME-11 read to their frame ends — safe, since the size bounds
every frame — and still reads "Event type" as 4 bytes.

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
| CRD-1 | `CRD_UNIFORM/a/b` samples `a + r(b-a)`, r in (0,1] — the two numbers are the ends in the order written (`15/1` = 1..15); `CRD_EXPONENTIAL/a` = `-a ln r`; `CRD_NORMAL/a/b` = `a + b N(0,1)`; the 4th field mirrors the sign with p = 1/2 | **verified** | `Random::getContinuousRandom` lnxded 0x081e28b0; emitter inline copy `Emitter::calcInvItensity` 0x081e2f10 (mirror at 0x081e3037); the client's twins, `0x004f5930` (the mirror) and `0x004f58d0` (the per-distribution switch), are identical (2026-09-16) |
| EMT-1 | Emitter spawns are spaced `\|1/intensity\|` apart, intensity resampled per spawn and scaled by `speed / IntensityAtSpeed` when set; zero intensity = one per 100 s; `looping` restarts on expiry | **verified** | `Emitter::calcInvItensity` 0x081e2f10, `Emitter::handleUpdate` 0x081e3200 (+0x110 age, +0x114 next) |
| EMT-2 | The first spawn is at t = 0 | **verified** (2026-09-16) | The constructors (lnxded 0x081e2bb0, 0x081e2c40) zero age (+0x110) and next (+0x114), and `Emitter::handleUpdate` spawns when `age >= next` (0x081e37bb–0x081e37d0, `fxch` then `fucompp`), so the first tick is due. That test is reached only when the template's `showInFirstPerson` (+0x417) and the instance's +0x124 are both zero: the +0x104 gate always jumps to 0x081e58c6, which re-enters at 0x081e356d, and either flag set sends the update down a separate path to its return (0x081e3579–0x081e3680, not read) — the old "no spawn when set" reading, confirmed. Nothing found sets +0x124. The burst ends when `age >= timeToLive` (0x081e3305). On the tick a `delay` runs out, age grows by the delay's pre-tick value, not by the leftover (0x081e32ae–0x081e32ce). `viewer/effects-core.js` differs on both edges: it hands over the leftover, and keeps a burst alive at `age == ttl` |
| EMT-3 | `startRotation` rolls the emitter frame about its DOF per spawn; units degrees | **verified** (2026-09-16) | `dice::ref2::roll` 0x08061df0 = `rotateAboutLine(m, m+0x20 (row 2), angle)` at spawn site 0x081e522e, the angle drawn from the CRD at template +0x400 that `makeScript` names `ObjectTemplate.startRotation` (0x081e6a6c). It passes unchanged through `rotateAboutLine` 0x08061e10, `setRotateAboutLine` 0x080621b0 and `rotateZDeg` 0x080625f0 into `setRotateZDeg` 0x08062740, which multiplies by π/180 (0x086b1ca4) before `fsincos`: degrees. Sprite `initRotation` / `rotationSpeed` (client-only code) remain inferred degrees |
| EMT-4 | Spawn offset/velocity are `relativePositionIn*` / `positionalSpeedIn*` along the (rolled) frame; `addEmitterSpeed` adds the emitter's velocity x `emitterSpeedScale` | **verified** | spawn block 0x081e40a3-0x081e4e9d (`SpriteParticleNew::addParticle` call 0x081e4d8f), template offsets from `EmitterTemplate::makeScript` 0x081e61c0 / client 0x005097a0 |
| EMT-5 | The drag law is `v *= e^(-drag dt)` | **refuted** (2026-09-16) | A particle's body is a `PointPhysicsNode`: `Particle::handleUpdate` lnxded 0x0820ad20 calls its `setDrag` (vtable +0x94) and `setGravityModifier` (+0xb4) every tick. `PointPhysicsNode::updatePhysics` (client 0x00578ca0, lnxded 0x082562c0) adds drag to the acceleration once per tick — `accel −= (scale·v − wind)·π·r²·drag/mass` (0x00578990), `r` = `getBoundingRadius()`, `scale` = `1 + 24·min(underWater/r, 1)` — then integrates four semi-implicit sub-steps of dt/4 (0x00578aa0). Nothing multiplies velocity by an exponential. Same law as vehicles, [physics.md](subsystems/physics.md) §3. `viewer/effects-core.js` `integrateParticle` still uses the exponential, pending the mass and radius a spawned particle's body reports |
| SPR-1 | The server simulates sprite particles | **refuted** (2026-09-16) | lnxded `dice::ref2::geom::ParticleSystem::setTransformation`, `draw`, `isSupported`, `addParticle` and `update` (0x083a9300–0x083a9354) are empty, and `SpriteParticleNew::handleUpdate` 0x0820c650 / `addParticle` 0x0820c730 call them directly. The sprite-particle update exists only in the client |
| SPR-2 | How the client makes a sprite particle system | **verified** (2026-09-16) | `SpriteParticleNewTemplate`'s ctor (0x00568670) owns a `geom::ParticleSystemTemplate` (0x00618350) at +0x60. `createObject` (0x00568720, vtable 0x008fbf90 +0x2c) builds a `SpriteParticleNew` (0x005685c0), which asks that template to `createGeometry` (0x006189a0, vtable 0x0091516c +0x18 — the server's `createGeometry` sits at the same index) and keeps the resulting `geom::ParticleSystem` (0x0060afe0, vtable 0x00914c14) at +0xf0. `SpriteParticleNew::addParticle` (0x00567c00) forwards to it |
| SPR-3 | When a sprite particle's values are chosen | **verified** at spawn; per-frame **inferred** (2026-09-16) | `geom::ParticleSystem::addParticle` (0x0060a680) rolls ten CRDs once, at spawn — `initRotation`, `initAnimationFrame`, `animationSpeed`, `XYSizeRatio`, `rotationSpeed` and five fields no sprite property names — through the client CRD evaluator. The `…OverTime` curves are evaluated per frame in `draw` (0x0060a0e0): it splits each particle's phase into an index and a fraction, passes `colorRGBAOverTime` to 0x00609e10 and reads four floats back, and indexes `rotationSpeedOverTime`'s samples inline. That path was not traced to the finished quad |
| SPR-4 | Sprite `…OverTime` curves are rasterised to 101 samples at load, like mesh particles' | **verified** (2026-09-16) | The `ParticleSystemTemplate` ctor 0x00618350 gives each curve its own 101-sample array: `XYSizeRatioOverTime`, `rotationSpeedOverTime`, `animationSpeedOverTime` and `alphaTestRefOverTime` seeded 1.0, and four `colorRGBAOverTime` channels (from +0xb8c) seeded 255.0 |
| SPR-5 | How the blend mode is applied | **open** | `srcBlendMode` and `destBlendMode` are stored once, at template build, by `setSrcBlendMode` / `setDestBlendMode` (0x006182b0 / 0x006182e0, fields +0x5c4 / +0x5c8), and `draw` never sets a render state itself; where the modes become Direct3D blend states was not found. `makeScript` skips parsing `destBlendMode` when the *src* field holds 6. Data: `BMInvSourceAlpha` 3,554, `BMOne` 3,052, unset 509, `BMDestAlpha` 25 of 7,159 templates |
| SPR-6 | Our sprites need only `size`, colour, rotation and a blend mode | **refuted** (2026-09-16) | `SpriteParticleNewTemplate::makeScript` reads `numAnimationFrames`, `initAnimationFrame`, `animationSpeed` and `animationSpeedOverTime`, and `addParticle` rolls the middle two per particle: texture-atlas flipbooks. 791 of 7,159 sprite templates across 18 mods set more than one frame (705 at 16, 80 at 4), among them `fx_expl_core`, `fx_blood02` and the aircraft engine fires. `bf42/effects.py` and `viewer/effects.js` read none of these words |

## Other formats

Add a section per format as it comes under investigation. Keep the same shape:
assumption, where it lives in our code, status, evidence.

| # | Assumption | Where | Status | Evidence |
|---|---|---|---|---|
| BAF-1 | `.baf` stores transposed quaternions | [baf.py](../../tools/bf1942-models/bf42/baf.py) | **confirmed** (2026-09-16) | `BaseQuaternion<float>::toMat` (client 0x00461690, lnxded 0x08226180, both read) builds the ordinary unconjugated rotation from (x, y, z, w) — row 0 `1−s(y²+z²), s(xy−zw), s(xz+yw)` — with `s = 2/(x²+y²+z²+w²)`, so it needs no unit quaternion. `CompressedAnim::GetQuat` 0x0832fc90 feeds it channels 0–3 as stored, and `Skeleton::setRelativeBoneTransform` (client 0x0066b5c0) writes the result straight into the bone. `BaseMatrix4::mult` (client 0x0040d2e0) composes row-vector style (`v·M`, translation in the last row), and for this formula conjugating (x, y, z) gives exactly the transpose — so `baf.py`'s conjugate is the conversion to `ske.py`'s column-vector `_mul`, not a fix for bad data. Checked numerically on four clips at precision 15, 12, 11 and 11, to 7e-16. The same `s` makes the rotation immune to scale, which is why the engine survives `CompressedAnim::GetValue` dividing quaternions by `(1<<precision)−1` like every other channel: precision 10–14 clips decode 2–32× too long and still rotate correctly. **`baf.py` bug:** positions are divided by `2^precision` (`baf.py:194`) where the engine divides by `2^precision − 1`, a relative error of `1/(2^precision − 1)` — 0.003% at precision 15, about 0.1% at the lowest precision any mod uses |
| TM-1 | A non-zero leading word that is not the collision magic is the visible vertex count | [treemesh.py:149-163](../../tools/bf1942-models/bf42/treemesh.py#L149) | **refuted** | `TreeMeshTemplate::load` lnxded 0x083bd380 reads the word once (0x083bd651) and, when non-zero, passes it straight to `SmartItf<IVectorCollider>::create` as a class id (0x083bd85d); zero means no collider. The vertex array is read afterwards by `readBytes<VertexDifNormal2SetTex2D>`, which reads its own count, and nothing seeks back. The "collision magic" 0xEB97C2FA is `CID_SimpleCollisionMesh` (lnxded 0x086e9e08). Across 401 tree meshes: 126 zero, 275 that id, 0 anything else — the reader's rewind branch never runs |
| RFA-1 | Archive names resolve case-insensitively, mod archives before parents' | [rfa.py](../../tools/bf1942-models/bf42/rfa.py) | **confirmed** (mount loop inferred) | Case: the `.rfa` file table is a map ordered by `NoCaseStringCompare`, i.e. `strcasecmp` (lnxded 0x08425af0), and `ZipArchive::findEntry` uses `equalsIgnoreCase` (0x08429ca0). Precedence: `FileManager::open` 0x0841dda0 tries a name's archives from the front and stops at the first that opens it, and `FileManager::addArchive` 0x0841f110 appends, so the earliest-mounted archive wins. `game.addModPath` is `Setup::addModPath` 0x080c8960, which appends in order, and every shipped `init.con` lists the mod before its parents. Not read: the call in `Setup::initFileSystem` 0x080bd8b0 that turns the path list into `addArchive` calls, so mod-over-parent and patch-over-base mount order remain inferred. Case matters in practice: 24,726 names occur with different case in different archives |

---

## Sound scripts (.ssc) — comments (settled 2026-09-16)

| # | Assumption in our code | Where | Status | Evidence |
|---|---|---|---|---|
| SSC-1 | Comments are only `rem`, `//`, `***`, `;` lines; `/* */` is not a comment | [level.py](../../tools/bf1942-models/bf42/level.py) `_ssc_lines` | **refuted** (reader fixed 2026-09-16) | `SoundScript__skipFilter` 0x007f9a80 is the whole of it, and `/*` and `beginSkip` are **one** mechanism sharing the flag `g_sscSkipping` 0x00a8fb30. It runs *first* in the per-line pipeline `SoundScript__handleLine` 0x007fb0e0, ahead of `#templateLevel`, `#beginMap`, `#map`, `#include` and the 23-entry command table, so a skipped region swallows directives too. 849 of 52,310 shipped `.ssc` files across 17 mods use the markers |
| SSC-2 | A block comment is a character span, as in C | — | **refuted** | The filter tests whole lines (`operator==` for `beginSkip`/`endSkip`, `std::string::find` for the markers) and returns "consumed" for the entire line. So `/*load @ROOT/Sound/@RTD/bulletair3.wav` — XPack2 `Gewehr43_zf4/Sounds/High.ssc` — loses the `load` with the marker, and a self-contained `/* ... */` on one line never opens a skip at all, because the close test matches first |
| SSC-3 | An opener must be closed | — | **refuted** | There is no terminator requirement: the flag simply stays set. 373 of the 849 files never close one. Vanilla `Lynx/Sounds/High/LynxHorn.ssc` is a horn, then `/*`, then a whole copy-pasted Willy engine stack to EOF — read as live it made honking start a looping jeep engine (7 layers instead of 1) |
| SSC-4 | A `*/` with no opener is meaningful | — | **refuted** | The close test runs first and unconditionally, so it clears an already-clear flag and the line is dropped. Vanilla `KettenKrad/Sounds/High/KettenKradEngine.ssc` ships exactly this (an edit left it behind); the layers on both sides of it are live. 16 shipped files have a lone `*/` |
| SSC-5 | Skip state is per file | [level.py](../../tools/bf1942-models/bf42/level.py) `_ssc_lines` | **confirmed as global** | `g_sscSkipping` is cleared only by `SoundScript__resetParseState` 0x007fb040, called once at the end of `SoundScript__parse` 0x007fb1c0 — never per included file, since the same function also clears the accumulated patch list. The EOF test walks the include stream stack (0x00a8fc5c), so includes run through the same loop and the same flag: an unterminated `/*` inside an include keeps skipping in the includer |

### What it changed in our extracts

Measured over all 17 installed mods, comparing every `parse_ssc` consumer
before and after (49,980 hand-weapon / vehicle-engine / vehicle-gun decisions,
plus `discover_level_sounds` for the 23 published levels):

- **919 entries changed**, every one of them dead data that had been read as live.
- **Map ambience and area sounds: no change at all** (23 levels, 35 area sounds).
- **Vanilla hand weapons: no change** — every sample inside a `/* */` block in
  vanilla's hand-weapon data carries its own `Volume <- Time` ramp gating it to
  zero at the trigger, so `fire_sample`'s immediate-gain pick never chose one.
  Mods are not so lucky: XPack2's and WarFront's `Gewehr43` picked
  `sniperstereo.wav`, a sniper sample sitting inside a comment, where the live
  report is `k98lr.wav` / `gewehrshot.wav`.
- The three vanilla horns (Lynx, KettenKrad, BlackMedal) drop from 7 layers to
  1, and the Elco80 / Type38 PT boats lose a commented-out `Pitch <- Default`
  modulator on their bubble layer.

---

## Parse failures worth explaining (explained 2026-09-16)

Ten meshes across the installed mods fail to parse outright. None is a gap in
the reader. Eight are truncated files: every field up to the break decodes with
no slack, and the file ends inside the last thing it declares. The engine would
not reject them — `io::read` (lnxded 0x08417ae0) never checks how much it read —
so it loads whatever the stream leaves behind.

| File | Declares | Ends inside | Short by |
|---|---|---|---|
| GCMOD `Speeder_Fus_L1.sm` | 6 LODs | LOD 4's vertices | 8 bytes |
| WarFront `tri_mount_m1.sm` | 5 LODs | LOD 2's vertices | 3 bytes |
| WarFront `milif_short_pole_m1.sm` | 5 LODs | LOD 3's vertices | 240 bytes |
| bf1918 `MG08_Aim.sm` | 5 LODs | LOD 4's vertices | 331 bytes |
| GCMOD `reb_aa_top.sm` | 1 LOD | its indices | 2,094 bytes |
| DC_Final and DesertCombat `ah64_static.sm` (one file, two mods) | 1 LOD, 2 materials | the second material's vertices | 35,344 bytes |
| FinnWars `bengtskar.sm` | 1 collision layer | its BSP | 1,638 bytes |

The other two, bf1918 `standardMesh/e_Muzzle1_Sniper_m1.sm` and
`e_Muzzle3_Sniper_m1.sm`, are not StandardMesh data from byte 0: whitespace,
float-like bytes, and the file's own name at byte 59. What format they are is
open; the version check rejects them correctly.
