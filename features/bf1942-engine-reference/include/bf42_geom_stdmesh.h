/* bf42_geom_stdmesh.h - Refractor v1 StandardMesh (.sm) on-disk format.
 *
 * These are NOT engine headers. They are our reconstruction, written in C so the
 * layout is unambiguous and so the next agent can diff it against decompiled
 * Ghidra output without re-deriving anything.
 *
 * Every field carries its provenance:
 *
 *   [verified]  read out of BF1942.exe, evidence recorded in ../ledger.md
 *   [observed]  measured across real archives; true of the data, not proven of the code
 *   [inferred]  from BfMeshView's modStdMesh.bas, the only public description
 *   [open]      nobody knows yet - do not build on it
 *
 * Reference implementation being cross-checked:
 *   tools/bf1942-models/bf42/stdmesh.py
 * Engine-side counterpart in the Linux dedicated server's symbols:
 *   dice::ref2::geom::*  (bf1942_lnxded.static, not stripped - see ../README.md)
 *
 * Binary: BF1942.exe sha256 60c9452d...cd3699. See ../symbols.json.
 */

#ifndef BF42_GEOM_STDMESH_H
#define BF42_GEOM_STDMESH_H

#include <stdint.h>

/* --------------------------------------------------------------------------
 * Coordinate system
 *
 * Refractor is left-handed: +X right, +Y up, +Z forward.  glTF is right-handed,
 * so the exporter negates Z.  That single mirror is what forces the winding
 * flip, the yaw/pitch sign flips, and the animated-texture U negation; they are
 * one conversion, not four independent fudges.       [verified - map-parity work]
 * -------------------------------------------------------------------------- */

/* Primitive types, in the material descriptor.                    [observed] */
#define BF42_PRIM_TRIANGLE_LIST   4   /* vehicles, statics */
#define BF42_PRIM_TRIANGLE_STRIP  5   /* soldiers */

/* --------------------------------------------------------------------------
 * Vertex format  -  the `flags` word                                 [verified]
 *
 * Each material descriptor carries a `flags` word and a `vertex_stride`.  The
 * engine treats `flags` as the vertex format (dice::ref2::rend) and derives the
 * stride from it; the file's `vertex_stride` is used exactly once, as
 * `vertex_stride * vertex_count` bytes to pull from the stream.  Read out of:
 *
 *   StandardMeshTemplate_readMaterials  0x005b42d0  (lnxded loadLod 0x083a6f00)
 *     -> RendPCDX8 vtbl 0x00917a00 +0x1c = createVertexBlock(1|0xc, flags, count)
 *   rend::getStride(format)             0x00640f20  (lnxded 0x084451d0)
 *   MemVertexBlock::create              0x006410d0  (lnxded 0x08445530): +0x1c = getStride
 *   format -> D3DFVF                    0x00672a40
 *   IDirect3DDevice8::CreateVertexBuffer(..., FVF, ...)  from 0x00675520 (device vtbl +0x5c)
 *
 * The buffer is an FVF buffer, so Direct3D fixes the memory order: position
 * (with blend weights), normal, diffuse, specular, texcoord sets 0..3.  These
 * are Refractor's own bits, not D3DFVF values (D3DFVF_XYZ|NORMAL|TEX1 = 0x112).
 *
 * Survey: 234,144 descriptors across vanilla + 14 mods carry only 0x0411 (32 B)
 * and 0x2411 (40 B).  One mesh, bf1918 standardMesh/o_WoodenCart_M2.sm, says
 * stride 64 against 0x0411; the engine allocates 32 * count and reads 64 * count
 * into it, and the first 32 * count bytes are the cart (bounds match the header).
 * See ../subsystems/standardmesh-vertex-format.md and ledger SM-1 / SM-2.
 * -------------------------------------------------------------------------- */
#define BF42_VF_POSITION      0x00000001u  /* 3 floats        -> D3DFVF_XYZ                 */
#define BF42_VF_POSITION_RHW  0x00000004u  /* 4 floats        -> D3DFVF_XYZRHW   [engine bit, unseen in .sm] */
#define BF42_VF_BLEND1        0x00200000u  /* 1 float         -> D3DFVF_XYZB1    [unseen]   */
#define BF42_VF_BLEND2        0x00400000u  /* 2 floats        -> D3DFVF_XYZB2    [unseen]   */
#define BF42_VF_BLEND3        0x00800000u  /* 3 floats        -> D3DFVF_XYZB3    [unseen]   */
#define BF42_VF_BLEND4        0x01000000u  /* 4 floats        -> D3DFVF_XYZB4    [unseen]   */
#define BF42_VF_BIT29         0x20000000u  /* 16 B in getStride, 4 B and FVF|=4 in the FVF
                                              builder; inconsistent, unseen      [open]     */
#define BF42_VF_NORMAL        0x00000010u  /* 3 floats        -> D3DFVF_NORMAL              */
#define BF42_VF_DIFFUSE       0x00000040u  /* 1 packed colour -> D3DFVF_DIFFUSE  [unseen]   */
#define BF42_VF_SPECULAR      0x00000100u  /* 1 packed colour -> D3DFVF_SPECULAR [unseen]   */
/* Texture-coordinate set n (0..3): one of four size bits, tested 1,2,3,4 floats,
 * first match wins.  1..3 floats are (0x200|0x400|0x800) << 3n; 4 floats is
 * 0x2000000 << n.  The number of sets present becomes D3DFVF_TEX1..TEX4.       */
#define BF42_VF_TEX0_1F       0x00000200u
#define BF42_VF_TEX0_2F       0x00000400u  /* every .sm has this                            */
#define BF42_VF_TEX0_3F       0x00000800u
#define BF42_VF_TEX0_4F       0x02000000u
#define BF42_VF_TEX1_1F       0x00001000u
#define BF42_VF_TEX1_2F       0x00002000u  /* lightmapped statics                           */
#define BF42_VF_TEX1_3F       0x00004000u
#define BF42_VF_TEX1_4F       0x04000000u
#define BF42_VF_TEX2_1F       0x00008000u
#define BF42_VF_TEX2_2F       0x00010000u
#define BF42_VF_TEX2_3F       0x00020000u
#define BF42_VF_TEX2_4F       0x08000000u
#define BF42_VF_TEX3_1F       0x00040000u
#define BF42_VF_TEX3_2F       0x00080000u
#define BF42_VF_TEX3_3F       0x00100000u
#define BF42_VF_TEX3_4F       0x10000000u

#define BF42_VF_STANDARD      0x0411u  /* position + normal + tex0(2f)             = 32 B  [verified] */
#define BF42_VF_LIGHTMAPPED   0x2411u  /* position + normal + tex0(2f) + tex1(2f)  = 40 B  [verified] */

/* --------------------------------------------------------------------------
 * File layout
 * -------------------------------------------------------------------------- */

typedef struct {
    float x, y, z;
} bf42_vec3;

typedef struct {
    /* The engine accepts 8, 9 and 10: StandardMeshTemplate_readHeader at
     * 0x005b61f0 gates on (7 < version < 0xb).  Our reader documents "9 or 10",
     * which is narrower than the engine.  The extra header byte (`qflag`) is
     * read only when version > 9.                                   [verified] */
    uint32_t   version;
    uint32_t   reserved0;      /* 0 in every observed file             [observed] */
    bf42_vec3  bounds_min;
    bf42_vec3  bounds_max;
    /* uint8_t qflag;             present only when version > 9        [inferred] */
} bf42_sm_header;

/* Collision geometry.  One layer per detail level: BF1942 tests a projectile
 * against a coarse mesh first, then a detailed one.  The exporter keeps only
 * the final non-empty layer - the coarse one is an engine optimisation and adds
 * no inspectable information.                                        [inferred] */
typedef struct {
    uint32_t block_size;       /* total bytes, including the trailing accel data */
    uint32_t reserved[2];      /* [open] */
    uint32_t vertex_count;
    /* struct { float x, y, z; float w; } vertices[vertex_count];
     *   `w` is unexamined.  Not a position component.                 [open]   */
    /* uint32_t face_count;                                                     */
    /* struct {
     *     int16_t vertex[3];
     *     uint8_t defensive_material;   armour-region id; 50-54 is the tank
     *                                   range, increasing protection [inferred]
     *     uint8_t flags;                                             [open]
     * } faces[face_count];                                                     */
    /* uint8_t acceleration_data[...];  up to block_size. Skipped.     [inferred] */
} bf42_sm_collision_layer;

/* Material descriptor.  All descriptors for a LOD come first, then all of their
 * vertex/index payloads in the same order - descriptors are not interleaved
 * with their data.                                                   [verified
 *                                                        by successful parsing
 *                                                    of 33,038 real meshes]   */
typedef struct {
    /* uint32_t name_len; char name[name_len]; */
    uint8_t  reserved[12];     /* 0 across all 234,144 observed; ONE 12-byte raw
                                  read in both loaders. lnxded drops it into a
                                  stack local. The client sometimes keeps it in
                                  the persistent material record (offset +0x3C
                                  of the 0x98-byte record, path gated by
                                  DAT_009ab660), but that record's only found
                                  reader (StandardMesh_drawLod 0x005aeec0)
                                  never touches +0x3C..+0x47 - dead either way.
                                  ledger SM-5, narrowed 2026-09-25     [verified] */
    uint32_t primitive;        /* BF42_PRIM_*                          [observed] */
    uint32_t flags;            /* the vertex format; layout comes from here [verified] */
    uint32_t vertex_stride;    /* bytes the loader reads per vertex; NOT the layout.
                                  Equals getStride(flags) in all but one mesh   [verified] */
    uint32_t vertex_count;
    uint32_t index_count;
    uint32_t unknown7;         /* takes 0, 1, 2, 4. Meaning unknown.       [open] */
} bf42_sm_material;

/* The two formats that occur in shipped data, laid out in D3DFVF order as the
 * engine's getStride / FVF builder define them.                     [verified] */
typedef struct {
    float position[3];
    float normal[3];
    float uv0[2];
} bf42_sm_vertex_standard;     /* 32 bytes, flags 0x0411 */

typedef struct {
    float position[3];
    float normal[3];
    float uv0[2];
    float uv1[2];              /* texcoord set 1; vanilla's object-lightmap channel */
} bf42_sm_vertex_lightmapped;  /* 40 bytes, flags 0x2411 */

/* Indices are int16.  A strip is converted to a list by walking triples and
 * flipping the winding on odd steps; degenerate triples (any two indices equal)
 * are the strip's stitching and must be dropped.                     [inferred] */

/* --------------------------------------------------------------------------
 * Engine entry points
 *
 * Filled in as they are confirmed.  Anything here must also exist in
 * ../symbols.json - that file is the index, this one is the shape.
 * -------------------------------------------------------------------------- */

/* 0x00908a90  "dice.ref2.geom.GeometryTemplate.StandardMesh"
 *   Sole xref at 0x005d06a2 (registration).                        [verified] */

/* 0x005d0140  StandardMeshTemplate destructor (shape only - installs four
 *   vtables, tears down members, object is >= 0x67 dwords).       [inferred] */

/* The load chain, off the template vtable at 0x00905a90:          [verified]
 *
 *   +0x8c  0x005b6080  loadFile        appends ".sm", opens stream, calls +0x88
 *   +0x88  0x005b5f50  readStream      orchestrates; loads the object lightmap
 *   +0x90  0x005b61f0  readHeader      version gate (7 < v < 0xb)
 *   +0x98  0x005b54e0  readLods        loops LODs, calls +0x9c each
 *   +0x9c  0x005b42d0  readMaterials   per-LOD material + payload reader
 *
 * readMaterials reads a material's vertices as ONE flat blob of
 * stride * count bytes and its indices as count * 2.  The vertex block comes
 * from RendPCDX8_singleton (DAT_009a99d4) -> vtbl 0x00917a00 +0x1c
 * (0x0063ed70) as createVertexBlock(blockFormat, flags, vertexCount): the
 * stride is not passed, the block derives it with rend::getStride(flags)
 * (0x00640f20) and the DX8 block builds its D3DFVF from the same word
 * (0x00672a40).  +0x20 (0x0063ede0) makes the index block.
 *
 * Twin in the server: BStandardMeshTemplate<...>::loadLod 0x083a6f00, which
 * keeps {format, stride, count, indexCount} in a 16-byte BlockInfo and skips
 * stride * count / indexCount * 2 bytes.  g_vertexFormat 0x087473a4 and
 * g_vertexStride 0x087473a8 are dead globals of an unfinished
 * m_simplifyMeshes path in loadLods 0x083a65b0.
 * See ../subsystems/standardmesh-vertex-format.md; ledger SM-1 / SM-2.       */

#endif /* BF42_GEOM_STDMESH_H */
