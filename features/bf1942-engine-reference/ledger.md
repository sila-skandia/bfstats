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
| SM-1 | Vertex layout is determined by `vertex_stride`; `flags` is decorative | [stdmesh.py:73-93](../../tools/bf1942-models/bf42/stdmesh.py#L73) | **open — moved to the renderer** | loader reads the block opaquely, `0x005b42d0` |
| SM-2 | Stride 40 always means the extra 8 bytes are a lightmap UV pair | [stdmesh.py:87](../../tools/bf1942-models/bf42/stdmesh.py#L87) | **open — moved to the renderer** | as SM-1 |
| SM-3 | `primitive` 4 is a triangle list, 5 is a strip | [stdmesh.py:95-105](../../tools/bf1942-models/bf42/stdmesh.py#L95) | open | — |
| SM-8 | Accepted file versions are 9 and 10 | [stdmesh.py:6](../../tools/bf1942-models/bf42/stdmesh.py#L6) | **refuted** | `0x005b61f0` accepts `7 < v < 0xb`, i.e. **8**, 9 and 10 |
| SM-4 | Descriptors for a LOD precede all their payloads | [stdmesh.py:285-288](../../tools/bf1942-models/bf42/stdmesh.py#L285) | open | 33,038 meshes parse with zero structural failures, which is strong but is data, not code |
| SM-5 | The three `unknown` u32s before `primitive` are reserved | [stdmesh.py:271](../../tools/bf1942-models/bf42/stdmesh.py#L271) | open | all zero across 234,144 descriptors |
| SM-6 | The 4th float per collision vertex is not a position component | [stdmesh.py:230](../../tools/bf1942-models/bf42/stdmesh.py#L230) | open | — |
| SM-7 | Collision face `material` is the armour-region id; 50-54 is the tank range | [damage.py](../../tools/bf1942-models/bf42/damage.py) | open | official BF1942 Damage System tutorial, not the binary |

### SM-1 / SM-2 — the live investigation

**The claim.** `stdmesh.py` reads a vertex by measuring `vertex_stride` and
assuming a fixed component order. The `flags` word is parsed, stored on the
`Material` dataclass, and never read.

**Why it is suspect.** Across vanilla plus 14 installed mods — 33,038 meshes,
234,144 material descriptors — `flags` is an exact function of stride except
once:

| stride | flags | count |
|---|---|---|
| 32 (8f) | `0x00411` | 167,425 |
| 40 (10f) | `0x02411` | 66,718 |
| **64 (16f)** | **`0x00411`** | **1** |

`0x411` is bits 0, 4, 10; `0x2411` adds bit 13, which is precisely the
one-UV-set / two-UV-set difference. That is a component bitfield. Stride merely
correlates with it.

**The counterexample.** `bf1918/standardMesh/o_WoodenCart_M2.sm` declares the
8-float component set in a 16-float stride. `uvs2()` gates on `stride >= 40`, so
our reader manufactures a lightmap UV channel out of float[8..9] of a vertex
that, by its own declaration, has no second UV set. No exception is raised.

**Why it matters beyond one cart.** The extraction targets mods. Nothing
guarantees a mod's exporter kept vanilla's stride/flags correspondence, and the
failure mode is silent — wrong UVs, not a crash.

**Reproduce the survey:**

```bash
python3 features/bf1942-engine-reference/surveys/stride_vs_flags.py
```

**Evidence so far (client, `BF1942.exe`).**

*The client never mentions either format value as an immediate.* Scanning all
1,314,071 instructions for an operand of `0x2411` returns **zero** matches;
`0x411` returns 5, all of which are addresses in the `0x411xxx` range
(`MOV dword ptr [ESP + 0x44], 0x411b40`), not the constant.

```bash
curl -s 'http://127.0.0.1:8089/search_instructions?operand_pattern=0x2411&limit=25'
```

That rules out one shape of answer: there is no `switch`/compare on known format
values anywhere in the client. The flags word is never tested against a literal.
It is either consumed opaquely (stored, or used as a table index), or bit-tested
with masks that are not these composites — so the next probe is `TEST`/`AND`
against `0x2000` reaching a lightmap path, not another constant hunt.

It does **not** yet tell us whether layout comes from `flags` or `stride`.

*Ghidra's analysis of this binary is badly incomplete.* `find_code_gaps` reports
**4,574 undefined code regions** in `.text`. Of the 17 references to
`"StandardMesh/"`, only one sits inside a defined function. Expect to create
functions by hand; `read_memory` at a gap start shows the `0x90` padding and the
MSVC prologue (`SUB ESP,imm` then `PUSH EBX/EBP/ESI/EDI`) that marks the entry.

*Ten of those 17 references are a red herring.* They lie in a single 495 KB
undefined span, `0x00838b5e-0x008b191f`, which is the CRT static-initializer
block — each one is a global `std::string` being constructed:

```
68 90 19 8D 00    PUSH 0x008d1990        ; "StandardMesh/"
B9 C0 9B 9C 00    MOV  ECX, 0x009c9bc0   ; the global
FF 15 34 31 8C 00 CALL [0x008c3134]      ; std::string ctor
```

The constructed global `0x009c9bc0` has only three xrefs, all inside that block,
so consumers reach the path indirectly. Chasing the string literal does not lead
to the loader.

*The template class is located.* Two near-identical destructors, `0x005b7660`
and `0x005d0140`, share a member layout and install vtables at `0x00905a90` and
`0x00908830` whose contents are byte-identical (verified against a control
address — `read_memory` is not returning stale data). Two instantiations of one
template. Their implementations cluster at `0x005cdxxx` and `0x005b5exx`.

Slots examined so far are accessors and dispatch, not the reader:
`0x005cd0a0` assigns a `std::string` to `+0x2c`; `0x005cd130` calls vtable slots
`+0x80`/`+0x84`; `0x005cd260` (created by us, 315 bytes) walks collections at
`+0x164`/`+0x174` issuing QueryInterface-style calls tagged `0x53ce75fe` and
`0xd0867dfb`.

### The loader chain, recovered

The vtable's real slots run `+0x00`..`+0xb8`; past that `.rdata` continues into
this class's string constants, which is where the useful anchor was:

```
+0xbc  "Texture/ObjectLightmaps/"   @ 0x00905b4c
+0xd8  ".tga"                       @ 0x00905b68
+0xe0  ".sm"                        @ 0x00905b70
+0xe4  "ShadowStandardMesh/"        @ 0x00905b74
```

Creating a function at each of the 43 distinct slot targets recovered 32
previously-undefined functions with no failures — no global re-analysis needed,
because a vtable is an exact list of entry points.

| Slot | Address | Role |
|---|---|---|
| `+0x8c` | `0x005b6080` | appends `".sm"`, opens the stream, delegates to `+0x88` |
| `+0x88` | `0x005b5f50` | parse orchestrator; loads the object lightmap at the end |
| `+0x90` | `0x005b61f0` | header / version |
| `+0x98` | `0x005b54e0` | LOD loop |
| `+0x9c` | `0x005b42d0` | per-LOD material reader |

### Why SM-1 cannot be answered in the loader

`0x005b42d0` reads a material's vertex block as **one flat blob**:

```c
*(iVar11 + 0x2c) = piVar12[1] * *piVar12;    // vertex bytes = stride * count
uVar7 = FUN_0045baf0(iVar2 * iVar3);         // malloc
(**(code **)(*param_2 + 0xc))(uVar7, ...);   // single stream read
*(iVar11 + 0x38) = piVar12[2] << 1;          // index bytes = count * 2
```

then hands it to `RendPCDX8_singleton` (`DAT_009a99d4`) — `+0x1c` creates the
vertex buffer, `+0x20` the index buffer. **No component-wise parsing happens at
load time at all.** `stride * count` is only ever used as a byte length; nothing
in this path decides where a normal or a UV sits.

So the layout decision is made at draw time, in the renderer, when the vertex
declaration or shader is built — `StandardMeshRenderer` / `SubShaderBuilder`.
That is client-only code by definition, and it is where `flags` is consumed if
it is consumed anywhere.

**Next probe:** `str_StandardMeshRenderer_Standard` (`0x00908a60`) and
`str_SubShaderBuilder_StandardMesh` (`0x008d5c30`), and the `RendPCDX8` vtable
around `+0x1c`/`+0x20` to see what the buffer-creation arguments actually mean.

**To settle it.** Find the `.sm` loader and read how it lays out a vertex.
Current position: `dice.ref2.geom.GeometryTemplate.StandardMesh` is at
`0x00908a90` with a single xref at `0x005d06a2`, which Ghidra has not resolved
into a function. `0x005d0140` is the template destructor, not the loader.

Three routes, cheapest first:

1. Create a function at `0x005d06a2` and decompile the registration around it.
2. Cross-reference `dice::ref2::geom::*` in `bf1942_lnxded.static` (not
   stripped, 54,895 symbols) to name the shared parsing code in the client. The
   server loads meshes for collision and AI, so the reader is present there even
   though the renderer is not.
3. Find where `vertex_stride` or `flags` reaches a D3D8 vertex-buffer creation
   call. The function that maps a Refractor flags word onto a D3D vertex
   declaration *is* the answer to SM-1.

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

## Hand-weapon deviation & first-person view (settled 2026-09-15)

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
| DEV-5 | Decay clock is 60 Hz | **refuted** | no dt in updateDeviation; one linear step per `BFSoldier::handlePlayerInput` call (lnxded call site 0x08274da2). Exact client cadence open |
| DEV-6 | speed/turn terms scale with analog input | **confirmed for turn only** | turn: ·\|MouseLookX/Y\| (channels 4/5); speed: binary gates \|throttle\|>0.01, \|yaw\|>0.01 with constant increments |
| DEV-7 | miscDev applies to airborne/swim/vehicle | **settled: jump only** | bool arg = input[9] (c_PIAction) ≠ 0 && soldier+0x3c8==0, lnxded 0x08274d7d; Fire=8 anchor verified client-side (`FUN_0053af70`) |
| VIEW-1 | soldierCameraPosition displaces the camera | **refuted** | it displaces the 1P arms+weapon rig: setZoom (lnxded 0x082881a0) → soldier targetOffset +0x248 → eased +0x254 → `BFSoldier::updateAnimations` → `Skeleton::transform` (0x083420f0). Camera eye unchanged |
| VIEW-2 | hip↔zoom snaps | **refuted** | `BFSoldier::handleVisualUpdate` 0x08270fd0: cur += (target−cur)·0.25 per visual update (const 0x086c08ac), no dt; FOV factor 0.7/0.3 blend, snap at Δ≤0.001, applied via applyFovModifier 0x0826d490 |
| ZOOM-1 | Right-mouse zoom is a hold state | **refuted** | press-toggle: altFireOnce edge filter client 0x00500901 (AltFire bit 23 masked unless fresh press); camera mode 0↔2 switch 0x004fc8b6 |
| ZOOM-2 | Firing breaks zoom | **confirmed conditionally** | only when `UnZoomBetweenFireTime` > 0 (tmpl +0x3d0 client / +0x268 lnxded): pending flag +0x20c, un/re-zoom in `FireArms::handleUpdate` 0x08288890. Reload and weapon switch always unzoom; movement never does (no path found) |

---

## Menu node graphs — `MemeFile 2.0` (settled 2026-09-15)

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
