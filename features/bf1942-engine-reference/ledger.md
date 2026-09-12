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
| SM-1 | Vertex layout is determined by `vertex_stride`; `flags` is decorative | [stdmesh.py:73-93](../../tools/bf1942-models/bf42/stdmesh.py#L73) | **open** | — |
| SM-2 | Stride 40 always means the extra 8 bytes are a lightmap UV pair | [stdmesh.py:87](../../tools/bf1942-models/bf42/stdmesh.py#L87) | **open** | — |
| SM-3 | `primitive` 4 is a triangle list, 5 is a strip | [stdmesh.py:95-105](../../tools/bf1942-models/bf42/stdmesh.py#L95) | open | — |
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
