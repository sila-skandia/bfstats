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
 * Vertex component flags  -  THE OPEN QUESTION
 *
 * Each material descriptor carries BOTH a `flags` word and a `vertex_stride`.
 * Our reader (stdmesh.py) ignores `flags` entirely and infers the component
 * layout from `stride` alone:
 *
 *     stride >= 24  ->  assume normals at float[3..5]
 *     stride >= 32  ->  assume uv0     at float[6..7]
 *     stride >= 40  ->  assume uv1     at float[8..9]   (lightmap channel)
 *
 * A survey of 234,144 material descriptors across vanilla + 14 mods found
 * `flags` to be an exact function of stride, with ONE exception:
 *
 *     stride  32 (8f)   flags 0x00411    x167,425
 *     stride  40 (10f)  flags 0x02411    x 66,718
 *     stride  64 (16f)  flags 0x00411    x      1  <-- bf1918
 *                                                      standardMesh/o_WoodenCart_M2.sm
 *
 * The outlier declares the 8-float component set but reserves 16 floats of
 * space.  Our stride-based reader therefore emits a lightmap UV channel built
 * from float[8..9] of a vertex whose own declaration says it has only one UV
 * set.  It fails silently - no exception, just a wrong channel handed to the
 * lightmap pass.
 *
 * 0x0411 = bits 0, 4, 10.   0x2411 adds bit 13, and bit 13 is exactly the
 * difference between one UV set and two.  So `flags` is a component bitfield
 * and `stride` is only a coincidental proxy for it in vanilla data.
 *
 * These are NOT Direct3D 8 FVF values (D3DFVF_XYZ|NORMAL|TEX1 would be 0x112);
 * this is Refractor's own encoding.  The lnxded symbols show the engine has a
 * `vertexFormat` concept (dice::bf::ai::AIMeshVertex::vertexFormat).
 *
 * WHAT IS STILL UNKNOWN: whether the engine reads `flags` or `stride` to lay
 * out a vertex, and what the other bits mean.  Until that is settled, treat the
 * names below as placeholders.                                       [open]
 * -------------------------------------------------------------------------- */
#define BF42_VF_POSITION   0x0001u  /* [open] bit 0  - present in every observed mesh */
#define BF42_VF_NORMAL     0x0010u  /* [open] bit 4  - present in every observed mesh */
#define BF42_VF_UV0        0x0400u  /* [open] bit 10 - present in every observed mesh */
#define BF42_VF_UV1        0x2000u  /* [open] bit 13 - lightmap channel; only in 0x2411 */

#define BF42_VF_STANDARD   0x0411u  /* position + normal + uv0            [observed] */
#define BF42_VF_LIGHTMAPPED 0x2411u /* position + normal + uv0 + uv1      [observed] */

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
    uint32_t reserved1;        /* 0 across all 234,144 observed        [observed] */
    uint32_t reserved2;        /* 0 across all 234,144 observed        [observed] */
    uint32_t reserved3;        /* 0 across all 234,144 observed        [observed] */
    uint32_t primitive;        /* BF42_PRIM_*                          [observed] */
    uint32_t flags;            /* vertex component bitfield - see above    [open] */
    uint32_t vertex_stride;    /* bytes per vertex; 32, 40, once 64    [observed] */
    uint32_t vertex_count;
    uint32_t index_count;
    uint32_t unknown7;         /* takes 0, 1, 2, 4. Meaning unknown.       [open] */
} bf42_sm_material;

/* The vertex layout our reader assumes for stride 32.  Whether the engine
 * derives this from `flags` or from `vertex_stride` is the open question. */
typedef struct {
    float position[3];
    float normal[3];
    float uv0[2];
} bf42_sm_vertex_standard;     /* 32 bytes, flags 0x0411 */

typedef struct {
    float position[3];
    float normal[3];
    float uv0[2];
    float uv1[2];              /* lightmap channel */
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
 *   Sole xref at 0x005d06a2, which Ghidra has not resolved into a function.
 *   Creating a function there is the next step toward the loader. [verified] */

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
 * stride * count bytes and its indices as count * 2, then hands both to
 * RendPCDX8_singleton (DAT_009a99d4): +0x1c makes the vertex buffer, +0x20 the
 * index buffer.  `stride` is used ONLY as a byte length.  Nothing on the load
 * path decides where a position, normal or UV sits inside a vertex.
 *
 * CONSEQUENCE: the vertex layout question above cannot be settled in the
 * loader.  It is decided at draw time when the vertex declaration or shader is
 * built - StandardMeshRenderer / SubShaderBuilder - which is client-only code.
 * See ../ledger.md rows SM-1 and SM-2.                                        */

#endif /* BF42_GEOM_STDMESH_H */
