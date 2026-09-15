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
| 29 | `0x20000000` | 16 | FVF `\|= 4`, +4 | **inconsistent between the two functions**; unseen. Do not name it |
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

## Open items

- **Bit 29 (`0x20000000`).** `getStride` adds 16, the FVF builder adds 4 and
  ORs `4` into the FVF. Never seen in data; left unnamed. Resume at
  `0x00672a40` / `0x00640f20`.
- **The static DX8 vertex block's `CreateVertexBuffer` site** (class of ctor
  `0x006773d0`, vtable `0x0091b5d8`) was not isolated; `0x00676e60` calls its
  own slot `+0x5c` after `0x006728a0`. Only the dynamic block's site
  (`0x00675520`) is read. The FVF stored at `+0x2c` is the same word either way.
- **The programmable-pipeline declaration.** `0x00675520` passes `FVF = 0` when
  `+0x20 & 0x10`; the `D3DVSD_*` stream declaration that replaces it is built
  elsewhere — the two undefined callers of `0x00672a40` at `0x00667d6c` and
  `0x00675c0e` are the place to start.
- **Which texcoord set the lightmap stage samples** — mostly settled
  2026-09-16 (ledger LM-1…LM-4). The lightmap is stage 1 and nothing on its
  path writes stage 1's `D3DTSS_TEXCOORDINDEX`, so it samples set 1
  (`uvs2()`) by Direct3D's default. What is left: the envmap branch overrides
  that index, and its reset (`0x005bee20`, the next vtable slot) is not yet
  shown to run after every envmap draw.
- The 12-byte POD before `primitive` and the trailing u32 are read and, on the
  server, dropped (SM-5 stays open with that evidence). `primitive` is read as
  a signed `int` and is the Direct3D `D3DPRIMITIVETYPE` (SM-3, confirmed
  2026-09-16).
