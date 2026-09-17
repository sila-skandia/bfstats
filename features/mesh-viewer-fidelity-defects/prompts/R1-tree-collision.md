# R1 — Tree collision: what the engine gives a tree, and what we throw away

You are a research agent on the map-viewer fidelity round. Read
`features/mesh-viewer-fidelity-defects/BRIEFING.md` first if you have not.
You read the engine and the shipped data; you do not change the viewer.

## The defect

In the viewer a palm can be walked straight through, and a round fired into one
passes through it — no stop, no hit, no impact effect. In retail BF1942 a tree
trunk blocks a soldier and stops a bullet.

## What is already settled — do not re-derive it

- **TM-1 (confirmed, 2026-09-16).** The word a `.tm` file carries after its
  geometry is a **collider class id** passed to
  `SmartItf<IVectorCollider>::create`, not a magic-or-vertex-count switch.
  lnxded `TreeMeshTemplate::load` `0x083bd380`; the id is read at `0x083bd651`
  and consumed at `0x083bd85d`. Zero means no collider. `0xEB97C2FA` is
  `CID_SimpleCollisionMesh` (lnxded `0x086e9e08`). Across 401 installed tree
  meshes: **126 zero, 275 that id, 0 anything else.**
- **The block's byte layout is already known and already walked** — by
  `bf42/treemesh.py::_skip_collision`, which throws it away:
  `u32 class id`, `u32 version` (must be 5), `u32 vertexCount` then
  `vertexCount x 16` bytes (3 floats + 2 bytes + 2 pad), `u32 faceCount` then
  `faceCount x 8` bytes (3 x u16 index + u16 material), then a BSP:
  `u32 totalFaceListCount`, `u32 numBspNodes`, `u32 numFaces`,
  `numFaces x 32` bytes (3-float normal + 5 u32), then a node tree of
  {24-byte bbox, `u32 facenum`, `facenum x u32`, two optional children}.
- **SM-6 (confirmed).** On the StandardMesh side, the 4th float of a collision
  vertex is not a position component: its **low 16 bits are the material word**
  (`material | flags<<8`) of a face using that vertex, written by
  `SimpleCollisionMesh::giveVerticesMaterial` (lnxded `0x083c9d60`), and
  `SimpleCollisionMesh::load` (`0x083c9e00`) builds bounds from the first 12
  bytes only. 99.85% of 3.76M vertices match. The high 16 bits are unexplained.
- **SM-9 (settled).** A StandardMesh collision layer's own header is the same
  shape: class id `CID_SimpleCollisionMesh` in all 24,532 installed layers,
  then format number 5.
- **Where the viewer drops it:** `bf42/assemble.py:627`
  (`_collision_for_geometry`) returns an empty hull list for any geometry whose
  template kind is `treemesh`, with the comment "TreeMesh hulls live in the
  `.tm`'s own collision block, which `treemesh.py` recognises and skips; palms
  are fly-through until that is promoted to a parser". `_collision_layer_faces`
  skips `treemesh` the same way.
- **What the viewer does with hulls it does have:** the assembler emits them as
  glTF primitives tagged `extras.collision`, split one primitive per
  `defenseMaterial`; `map.html` hides anything carrying that tag; `collision.js`
  gathers them into one uniform XZ grid that answers both `cast` (the ray a
  round flies) and `sweepSphere` (the fat query a body needs). Header of
  `viewer/collision.js` explains the three collidable kinds.

So the parsing half is nearly free. **The research question is what the engine
does with the thing once it has it**, because that decides whether a hull in
the glb is enough, and what else has to change.

## Questions, in priority order

1. **Does a tree's collider take part in soldier movement, in projectile
   collision, or both?** Find where the collider created at lnxded `0x083bd85d`
   is stored and who queries it. Is a tree placement a physics object at all
   (does anything like `setHasCollisionPhysics` apply to a `TreeMesh`
   geometry's object template), or does the collider live in a separate
   static-geometry structure the engine tests against directly? Name the
   caller, not just the constructor.
2. **What material do tree collision faces carry, and what does the engine do
   with it?** SM-6 gives you the encoding on the StandardMesh side; confirm
   whether the `u16 material` per face in the `.tm` block means the same thing.
   Map a real tree's values against the material table (`materialFriction`,
   `materialDamage`, and whatever selects an impact effect). This decides which
   `defenseMaterial` primitive the exporter should put tree triangles in, and
   which impact effect a round on a palm should spawn.
3. **What happens visibly when a round hits a tree?** Which impact effect and
   sound the engine picks, whether the tree takes damage, and whether anything
   about it can be destroyed. The user's complaint is "doesn't register when
   shot at" — the viewer needs whatever retail shows.
4. **The 126 tree meshes with no collider — which are they?** Sweep all 14 mods
   and classify: are the zero-collider meshes bushes, grass and ferns (i.e.
   fly-through is correct retail behaviour and must be preserved), or are some
   of them real trunks? Give counts per mod and a named sample of each class.
   Getting this wrong in the other direction — giving every bush a hull — is a
   regression, not a fix.
5. **Placement and transform.** How is a tree instance placed in a level, and
   what transform does its collider inherit? Specifically: does any level scale
   tree instances non-uniformly, and does the engine transform the hull or the
   ray? (`extract_map.py` already places TreeMesh plants; the question is what
   the hull must inherit to sit right.)
6. **Distance or LOD gating.** Does the engine collide against far trees, or
   only near ones? `treeMesh.rfa` also ships billboards; confirm those carry no
   collider and are not involved.
7. **Validate the layout on real data.** Write a survey (see below) that
   *parses* rather than skips the block for every installed `.tm`, and checks:
   version is always 5; every face index is inside the vertex array; the hull's
   bounds sit inside the mesh's own header bounds; the BSP walk lands exactly
   on the end of the block. Report the counts, the per-mod totals, and every
   file that fails. This is what tells the implementer the parser is safe to
   ship — and if some mod's file does not fit the layout, that is a finding.
8. **Budget.** Report total collision triangles the 275 colliders add, and what
   a typical Pacific level's tree placements resolve to. Hulls are per geometry,
   not per placement (`El Alamein`'s 898 statics resolve to ~5k triangles,
   ~0.3 MB), so the number should be small; confirm it.

## Deliverable

The report shape in the briefing, plus:

- A survey script (question 7) written under the scratchpad with an `r1_`
  prefix, its full source included in your report.
- An explicit statement of **what the exporter must emit** so `collision.js`
  needs no change at all — or, if it does need one, exactly what and why.
- If a claim rests on the lnxded binary alone, say so. Nothing about *drawing*
  can come from lnxded; if your answer to question 3 needs the client, get it
  from the client through `xref.py`.

## What would make this report wrong

- Asserting trees collide because "obviously they do" without finding the query
  site.
- Giving every `.tm` a hull, including the 126 that ship none.
- Reading the material word by analogy with SM-6 without checking a real file.
- A layout claim from one vanilla palm rather than all 401 meshes across 14 mods.
