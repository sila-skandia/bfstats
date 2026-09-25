# StandardMesh vertex format — how the engine lays out a vertex

Settled 2026-09-15. Ledger rows SM-1 and SM-2 (`ledger.md`); reader in
`tools/bf1942-models/bf42/stdmesh.py`; survey in `surveys/stride_vs_flags.py`.

## The question

Every material descriptor in a `.sm` carries two words that both look like
they describe the vertex: `flags` (`0x411` or `0x2411` in all vanilla data) and
`vertex_stride` (32 or 40). Our reader laid a vertex out from the stride and
never read `flags`. One mesh in 33,038 — `bf1918/standardMesh/o_WoodenCart_M2.sm`,
flags `0x411`, stride 64 — disagreed, and the reader silently produced a
lightmap UV channel for it. Which word does the engine believe?

## The answer

**`flags` is the vertex format. The engine derives the stride from it and
never reads the file's stride as anything but a byte count.**

The loader (`StandardMeshTemplate_readMaterials` client `0x005b42d0`, lnxded
`BStandardMeshTemplate<…>::loadLod` `0x083a6f00`) reads, per material:

```
string name
12 raw bytes                 one read(void*, 0xc) into a zeroed 12-byte POD; dropped by the server
int    primitive
u32    d0  vertexFormat      <- the word stdmesh.py calls `flags`
u32    d1  stride
u32    d2  vertexCount
u32    d3  indexCount
u32    trailer
```

and then creates the GPU buffer as

```c
vb = RendPCDX8->createVertexBlock(blockFormat /*1 or 0xc*/, d0, d2);   // vtbl 0x00917a00 +0x1c = 0x0063ed70
vb->lock(&p, 0, 0);
stream->read(p, d1 * d2);                                              // the file's stride, times count
```

`d1` is not an argument to the block. Inside the block the stride is computed
from the format word:

| | client | lnxded |
|---|---|---|
| `rend::getStride(format)` | `0x00640f20` | `0x084451d0` |
| `MemVertexBlock::create(blockFormat, vertexFormat, numVertices)` — `+0x1c = getStride(fmt)`, `+0x18 = stride*count`, then `malloc` | `0x006410d0` | `0x08445530` |
| `MemVertexBlock` vtable (`+0x18 getVertexFormat`, `+0x20 getVertexStride`, `+0x28 getNumVertices`, `+0x2c create`) | `0x00917cc4` | `0x0874c720` |
| Refractor format → `D3DFVF` | `0x00672a40` | — (no D3D in the server) |
| DX8 vertex block ctor: stores `toFVF(fmt)` stride/bytes/FVF at `+0x20/+0x18/+0x2c` | `0x006773d0` (`0x00677890` when blockFormat & 0x20) | — |
| `IDirect3DDevice8::CreateVertexBuffer(len, usage, FVF = toFVF(fmt), pool, &vb)` via device vtable `+0x5c` | `0x00675520` (dynamic blocks) | — |

The two loader twins agree with each other and with the block classes: on the
server the payload is simply skipped as `d1*d2` and `d3*2` bytes (`loadLod`
`0x083a7101–0x083a7138`); on the client it is read into a buffer whose size is
`getStride(d0) * d2`. Nothing anywhere compares `d1` with `getStride(d0)`. The
only thing the loader does with the pair is remember the previous material's
`(d1, d0)` in `0x009c9b18` / `0x009c9b14` and log
`"<mesh> format diff. <prev d1> != <d1> : <prev d0> != <d0>"` (`0x009059a8`)
when consecutive materials of one mesh differ.

## The format word

`getStride` and the FVF builder read the same bits. Sizes are bytes.

| bit | mask | getStride | D3DFVF | component |
|---|---|---|---|---|
| 0 | `0x00000001` | 12 | `D3DFVF_XYZ` `0x002` | position, 3 floats |
| 2 | `0x00000004` | 16 | `D3DFVF_XYZRHW` `0x004` | transformed position, 4 floats — engine bit, unseen in any `.sm` |
| 21..24 | `0x00200000`..`0x01000000` | 4 / 8 / 12 / 16 | `D3DFVF_XYZB1..B4` `0x006..0x00c` | blend weights, 1..4 floats — unseen in `.sm` |
| 29 | `0x20000000` | 16 (bug — see below) | FVF `\|= 4`, +4 | a packed 4-byte `D3DCOLOR` at vertex-declaration register 13 (narrowed 2026-09-25, SM-10); unseen in `.sm`, no authoring name recoverable |
| 4 | `0x00000010` | 12 | `D3DFVF_NORMAL` `0x010` | normal, 3 floats |
| 6 | `0x00000040` | 4 | `D3DFVF_DIFFUSE` `0x040` | packed colour — unseen in `.sm` |
| 8 | `0x00000100` | 4 | `D3DFVF_SPECULAR` `0x080` | packed colour — unseen in `.sm` |
| 9 / 10 / 11 / 25 | `0x200` / `0x400` / `0x800` / `0x2000000` | 4 / 8 / 12 / 16 | `TEXCOORDSIZE1..4(0)` | texcoord set 0 with 1 / 2 / 3 / 4 floats |
| 12 / 13 / 14 / 26 | `0x1000` / `0x2000` / `0x4000` / `0x4000000` | 4 / 8 / 12 / 16 | `TEXCOORDSIZE1..4(1)` | texcoord set 1 |
| 15 / 16 / 17 / 27 | `0x8000` / `0x10000` / `0x20000` / `0x8000000` | 4 / 8 / 12 / 16 | `TEXCOORDSIZE1..4(2)` | texcoord set 2 |
| 18 / 19 / 20 / 28 | `0x40000` / `0x80000` / `0x100000` / `0x10000000` | 4 / 8 / 12 / 16 | `TEXCOORDSIZE1..4(3)` | texcoord set 3 |

Within a texcoord set the four size bits are alternatives tested in the order
1, 2, 3, 4 floats; the first that is set wins. The number of sets present
becomes `D3DFVF_TEX1..TEX4`; a fifth is a `Debug` error (`"Feeeeel!"`).

So `0x411` = position + normal + one 2-float texcoord set = 32 bytes, and
`0x2411` = the same plus a second 2-float set = 40 bytes. These are the only
two words in 234,144 vanilla-plus-mod descriptors, which is why stride ever
looked like the answer.

## Component order

The buffer is created with `FVF = toFVF(format)`, and Direct3D 8 defines the
memory order of an FVF vertex: position (with blend weights), normal, diffuse,
specular, texcoord set 0, 1, 2, 3. `getStride` sums the components in exactly
that order. Our previous `position[3] normal[3] uv[2] (uv2[2])` layout was
right for both vanilla words — by coincidence of stride, not because stride
carries the information.

Blocks with `+0x20 & 0x10` are created with `FVF = 0` for the programmable
pipeline; how their `D3DVSD_*` declaration is built was not read (see open
items). It cannot differ in memory order from the FVF path, because the same
buffer is drawn fixed-function on devices without shaders.

## What the counterexample really is

`o_WoodenCart_M2.sm` declares `format 0x411, stride 64, 288 vertices, 510
indices (max 287)`. The engine allocates `getStride(0x411) * 288 = 9,216`
bytes and reads `64 * 288 = 18,432` bytes into it.

Reading the payload as 32-byte vertices:

| | normals unit-length | position bounding box |
|---|---|---|
| first 288 | 288 / 288 | **equals the header's `bounds_min/max` exactly** |
| last 288 | 36 / 288 | `(0,0,-0.97)..(0,0,0.97)` |

The first 9,216 bytes *are* the cart, and the indices address exactly those
288 vertices. The file's stride is wrong (its exporter doubled it), the
format word is right, and the retail client — apart from overrunning the locked
buffer by 9,216 bytes — draws the cart correctly. Our stride-driven reader
took every other vertex and invented a UV set from the neighbour's position.

## What changed in `stdmesh.py`

- `vertex_layout(flags)` decodes the table above into `(component, byte
  offset, byte size)` in Direct3D order; `engine_stride(flags)` is the sum and
  is checked against the two binaries' values in the unit tests.
- Accessors (`positions`, `normals`, `uv_set(n)`, with `uvs()` = set 0 and
  `uvs2()` = set 1) use the flags-derived offsets and step by the **engine**
  stride.
- The stream still advances by `stride * count` bytes — that is what the
  engine consumes — and `Material.stride_matches_flags` is `False` when the
  file's stride disagrees with `getStride(flags)`. Nothing raises; the survey
  reports the disagreements.
- If the payload is shorter than `engine_stride * count` it is zero-padded,
  which is the engine's uninitialised tail made deterministic.

`surveys/stride_vs_flags.py` now prints the engine stride next to the file's
and, for each disagreement, whether the flags-driven positions land inside the
header bounds.

## Server-side notes for the next reader

- `dice::ref2::geom::g_vertexFormat` `0x087473a4` and `g_vertexStride`
  `0x087473a8` are **dead**: both `0` in initialised `.data`, never written,
  and `g_vertexStride` is only ever the divisor of six `divl`s inside the
  `StandardMeshTemplate::m_simplifyMeshes` (`0x087473b0`) branch of
  `loadLods` (`0x083a65b0`; `0x083821b0` for the AnimatedMesh instantiation).
  That branch writes `/StandardMesh/SimplifiedMesh/SimplifiedMesh_Material0`
  and logs `createGeom: vertexCount: written: indexCount:`; with the divisor at
  zero it would fault, so it is an unfinished tool path, not the loader.
- `loadLod` keeps its per-material `(format, stride, vertexCount, indexCount)`
  in a 16-byte `BlockInfo` vector and never reads the payload.
- `MemVertexBlock` (lnxded) layout: `+0x4` refcount, `+0x8` data, `+0xc`
  numVertices, `+0x10` vertexFormat, `+0x14` blockFormat, `+0x18` bytes,
  `+0x1c` stride. The client twin is identical.

## The envmap stage (settled 2026-09-19; ledger EM-1…EM-3)

The lightmap combine (LM-1…LM-4) and the reflection are two branches of the
same function, `StandardMeshSubShader_applyRenderState` (`0x005bf690`, vtable
`0x009061a4` slot `+0x10`), so the envmap belongs beside it. 338 vanilla
materials declare `envmap`. Every Direct3D enum below was checked against a
header, not remembered.

**There is no reflectivity constant anywhere in the stage.** The mix is the
diffuse texture's own alpha:

```
out.rgb = lit.rgb * A  +  cube.rgb * (1 - A)         A = stage 0's TEXTURE alpha
```

Branch `0x005bfa80`–`0x005bfdc4`, re-derived straight from the shipped exe with
`objdump -d -M intel --start-address=0x005bfa70 --stop-address=0x005bfd20`:

| what | where |
|---|---|
| stage 1 = the level cubemap | `0x005bfab3` |
| `TEXTURETRANSFORMFLAGS = 3` (`D3DTTFF_COUNT3`) | `0x005bfad1` |
| `TEXCOORDINDEX = 0x30000` (`D3DTSS_TCI_CAMERASPACEREFLECTIONVECTOR`) | `0x005bfaf7` |
| `COLOROP = 0x10` (`D3DTOP_BLENDCURRENTALPHA`) | `0x005bfcc6` |
| `COLORARG1 = 1` (CURRENT) | `0x005bfce1` |
| `COLORARG2 = 2` (TEXTURE) | **`0x005bfcfd`** (`0x005bfcf2` is the shadow load, not the call setup) |
| `ALPHAOP = SELECTARG1(CURRENT, DIFFUSE)` | `0x005bfc61`/`83`/`95` |
| stage 2 disabled | `0x005bfd03` |

`SetTextureStageState` is the device vtable's `+0xfc` with arguments pushed
right to left; `ebp = 1` (`0x005bf6ca`, `0x005bf903`) is both the stage index
and, where it appears as a state, `D3DTSS_COLOROP`.

**The blend direction rests on documentation, not memory.**
`D3DTOP_BLENDCURRENTALPHA = 16` counts to `0x10` from `D3DTOP_DISABLE = 1` in
wine's `d3d8types.h:884-899`, and it sits under Microsoft's own comment
`Arg1*(Alpha) + Arg2*(1-Alpha)` in `um/d3dtypes.h:1676-1682`. ARG1 is CURRENT,
the lit surface — so **an opaque texel is matte and a transparent one is the
mirror**, which is why an aircraft's paint is dull and its canopy is not.

`A` is stage 0's TEXTURE alpha, set by `setAlphaOp(0, SELECTARG1, TEXTURE,
DIFFUSE)` at `0x005c0201`, three instructions after the same function loads the
cubemap into the draw context's `+0x18` (`0x005c01dd`, name string `0x009061c0`
= `"envmap"`). No vertex or TFACTOR alpha replaces it on this path. "Set once
for the whole StandardMesh path" overstates the mechanism — the sibling reset
re-asserts the same three values at `0x005bee8e`/`94`/`9a`, and two other
sub-shaders write the same stage-0 alpha shadow `0x009c92fc` (`0x0062e370`
`MODULATE`, `0x0064ce63` the same `SELECTARG1`) — but every writer on the
StandardMesh path agrees, so the conclusion stands.

**One alpha does both jobs.** Stage 1's `ALPHAOP = SELECTARG1(CURRENT)` passes
stage 0's alpha through, so the fragment alpha feeding the frame-buffer blend
or the alpha test is the same alpha that chose the mix. A renderer that
multiplies its own `opacity` into the texel alpha before mixing would
over-reflect a translucent material; no such material exists in the data today.

**An envmap material gives up its texture-fade stage** (EM-3): the non-envmap
branch at `0x005bfdcb` uses the same stage 1 for `MODULATE(CURRENT, TFACTOR)`.
The two are exclusive.

Measured on fresh extracts, since the strength lives in the art:
`zero_fus_m1_Material0` (paint) has alpha 242–255 → at most 5% mirror;
`zero_fus_m1_Material1` (canopy) 120–255 → 53%; `Corsair_hull_m1_Material0`
119–255. Three of Wake's fourteen envmap materials — `militable`, `stebarrel1`,
`planeeng` — ship flat 255 and correctly reflect nothing.

**Still inferred:** the texture matrix. No `SetTransform(D3DTS_TEXTURE1)` was
found anywhere on the path, so identity comes from `TEXTURETRANSFORMFLAGS` and
`TEXCOORDINDEX` being the only things either function touches — an inference,
not a reading.

## Open items

- **Bit 29 (`0x20000000`) — narrowed 2026-09-25 (SM-10).** A third function
  that tests this same bit set was found: the programmable-pipeline
  vertex-declaration builder (client `0x006746d0`, called from `0x00674ce0`,
  called from `0x00674f90` — the path the "vertex-shader declaration" open
  item below was looking for). It emits one `D3DVSD_TOKEN_STREAMDATA` /
  `D3DVSD_REG(register, type)` token per set bit; bit 29's token is
  `0x4004000d` = register 13, `D3DVSDT_D3DCOLOR` — a single packed 4-byte
  color, matching `toFVF`'s `+4` byte count, not `getStride`'s `+16`.
  `getStride` (`0x00640f20` client, `0x084451d0` lnxded) is therefore the
  outlier: it adds 16 bytes as if the bit were a `FLOAT4` like bit 2, but two
  of the three readers of this bit agree it is 4 bytes. `toFVF`'s `FVF |= 4`
  is a separate loose end — it reuses the `D3DFVF_XYZRHW` bit pattern, which
  has no fixed-function slot for "packed color at register 13", so it does
  not actually encode what `toFVF`'s own stride count says was added; this
  is harmless only because the bit is unseen in any of 234,144 vanilla-plus-mod
  `.sm` descriptors (SM-1). The field's code-level shape is now pinned down
  (4-byte packed `D3DCOLOR`, declaration register 13, programmable-pipeline
  only); its authoring intent is not — no shipped asset ever sets it, so
  there is nothing to recover it from. Still open: what register 13
  corresponds to, if anything, in the fixed-function `D3DFVF` register table.
- **The static DX8 vertex block's `CreateVertexBuffer` site** (class of ctor
  `0x006773d0`, vtable `0x0091b5d8`) was not isolated; `0x00676e60` calls its
  own slot `+0x5c` after `0x006728a0`. Only the dynamic block's site
  (`0x00675520`) is read. The FVF stored at `+0x2c` is the same word either way.
- **The programmable-pipeline declaration — found 2026-09-25 (SM-10).**
  `0x00675520` passes `FVF = 0` when `+0x20 & 0x10`; the `D3DVSD_*` stream
  declaration that replaces it is built by `0x006746d0`/`0x00674ce0`, called
  from `0x00674f90` (callers `0x00667666` and `0x00679e36`, both unnamed),
  which then calls `0x00697360` — plausibly `CreateVertexShader` — but that
  call and its two callers were not traced further.
- **Which texcoord set the lightmap stage samples** — settled 2026-09-16
  (ledger LM-1…LM-4), narrowed 2026-09-19, **confirmed 2026-09-25 (LM-3)**.
  The lightmap is stage 1 and nothing on its path writes stage 1's
  `D3DTSS_TEXCOORDINDEX`, so it samples set 1 (`uvs2()`) by Direct3D's
  default. The override and the restore are keyed off **the same `+0x30`
  envmap byte on the same object**: the envmap branch writes `0x30000` at
  `0x005bfaf7`, and the sibling reset `0x005bee20` restores
  `TEXTURETRANSFORMFLAGS = 0` at **`0x005beef3`** (guard read `0x005beedb`)
  and `TEXCOORDINDEX = 1` at `0x005bef17` (guard `0x005bef06`), all gated on
  that byte read at `0x005beed4`. (An earlier note named `0x005bef06` as the
  transform-flags write; that is the *guard* for the other restore, one
  operand out.) The stage-1 TEXCOORDINDEX shadow cache `0x009c93b0` has
  exactly three writers in the image: those two, and the generic
  state-block applier `FUN_00604750` at `0x00605829`, which applies whatever
  a block says rather than restoring. **The call-site pairing of vtable
  `+0x10` with `+0x14` is now found.** `StandardMesh_drawLod` (`0x005aeec0`,
  the same per-material draw loop the 12-byte-POD note below reads) loads
  the per-material `StandardMeshSubShader` (vtable `0x009061a4`, constructed
  at `0x005c051e`/`0x005c0c17`/`0x005c1039`) from the `0x98`-stride material
  record's `+0x1c` into `esi` (`0x005af068`); its inner per-pass loop is
  `call [esi+0xc]` (pass count) → `call [esi+0x10]` (`applyRenderState`,
  `0x005af3f6`) → `call [RendPCDX8+0x88]` (the draw call, `0x005af409`,
  using the same record's `+0x20`) → `call [esi+0x14]` (the reset,
  `0x005af414`) → `call [esi+0xc]` again for the loop test (`0x005af41c`),
  before the record pointer advances by `0x98` to the next material
  (`0x005af42a`). So `+0x10`/`+0x14` bracket every draw call of every
  material, unconditionally, once per pass. The earlier 116-candidate byte
  scan missed this site because the subshader pointer is dereferenced
  through its own register (`esi`, loaded from `[ebx+0x1c]`), not through
  the same register (`ebx`) the surrounding `+0x20`/`+0x24`/`+0x30` field
  reads use, so a same-register `[reg+0x10]` … `[reg+0x14]` pattern never
  matched it.
- The 12-byte POD before `primitive` — narrowed 2026-09-25 (SM-5). On lnxded
  it is still read into a stack local and dropped, as before. In the client's
  `readMaterials` (`0x005b42d0`) it is read at **two** call sites gated by
  `DAT_009ab660` (a per-LOD "build real GPU buffers or not" flag set in
  `readLods` `0x005b54e0`): when the flag is clear (`0x005b43a4`) it lands in a
  throwaway stack scratch, same as the server; when it is set (`0x005b45ae`)
  it is copied into the **persistent per-material record** (the LOD's
  `0x98`-stride materials array) at record offset `+0x3C..+0x47` — so the
  client does *not* always discard it. That record's only other reader we
  found, the draw loop `StandardMesh_drawLod` (`0x005aeec0`, same array),
  touches `+0x1c`, `+0x20` (`primitive`), `+0x24`/`+0x30` (vertex/index
  buffer interfaces) and `+0x48` (the trailing `unknown7`, used there as a
  flag byte), but never `+0x3C..+0x47`. So the bytes are dead in both
  binaries — kept in memory on one client path, but never read back by
  anything located. `primitive` is read as a signed `int` and is the Direct3D
  `D3DPRIMITIVETYPE` (SM-3, confirmed 2026-09-16).
