# Per-object LOD chains (Gap 11)

Status: built 2026-09-26. closes Gap 11 of
`features/bf1942-3d-models/parity-audit/level-content.md`.

96-98% of placed statics' unique `.sm` meshes ship a real 6-level internal LOD
chain; `assemble.py` hardcoded `--lod 0` and discarded the other five per
placement, and the viewer drew LOD 0 to the far plane behind a binary
`obj.visible` distance test. The chains are now emitted, shipped in the glb,
and lifted onto `THREE.LOD` in the viewer.

## What the data carries

The `.sm` file carries the chain but no distances: `mesh.lods` is 6 geometry
levels and nothing else. Two distance sources exist and they are different
mechanisms:

- `GeometryTemplate.setLodDistance <level> <metres>` in the object `.con` —
  1,133 vanilla geometries declare one. This is the per-geometry distance
  table for the mesh's own chain. Parsed into `GeometryTemplate.lod_distances`
  (`bf42/con.py`).
- `LodSelector.addLodDistance` — the vehicle cockpit/wreck/propeller-blur part
  swap mechanism (151 templates). Recorded separately on `LodSelector`;
  untouched here.

Geometries with no declared table get a fallback curve,
`FALLBACK_LOD_DISTANCES = [0, 15, 35, 60, 100, 200]` in `bf42/assemble.py`,
derived from the median curve of the 780 real 6-level chains in the census.
Declared tables shorter than 6 are padded by repeating the final value (a
chain that culls at 80 stays culled).

## Export

`_mesh_index` emits every distinct level below the selected one as a sibling
glTF mesh named `<mesh>_lod<N>`, deduped on the per-material signature
`(name, triangle count, vertex count)` — material names alone cannot
discriminate (DICE ships one material across all six levels of the crank,
53/48/43/31/20/2 triangles), and identical adjacent levels are dropped rather
than shipped twice. The rungs attach as child nodes of the placement node with
`extras.lod = {geometry, level, distance}`; level 0 stays the part's own mesh
under its plain name, untagged, so every existing reader of the mesh name is
unchanged. `scene.json` records the chain per placement under `meshLods`.

Rung meshes are shared per unique geometry (one buffer each); rung NODES are
fresh per placement because glTF forbids one node under many parents.

## Viewer

`level-statics.js` `liftLods` runs in `indexScene` after the lightmap pass and
before `flattenCull`/`freezeStatics`: the rungs must carry the bound
materials, and the freeze must see the final tree. The chain owner is the part
node the rungs hang beneath; the LOD is spliced where the node stands with the
part as level 0 at distance 0. Parts with no rung children are untouched, and
the old binary draw-distance cull remains as the fallback and still gates
whole objects. `statics.lodCount` carries the spliced count for the test
hooks.

The splice collects candidates before mutating: `traverse` walks a live
children snapshot, and `addLevel` re-parents the part node under the LOD, so
`obj.parent` is captured before the splice.

## Measured (bocage)

- 216 chains / 964 rungs / ~164k rung triangles across 284 placements.
- scene.glb 75.3 MB -> 86.4 MB (1.12x). Under the audit's ~3.6x ceiling
  because bocage's pool is prop-heavy; growth lands only on the unique-mesh
  pool, never per instance.
- Live pass (`?shots` on bocage): 578 `THREE.LOD` objects spliced, all
  distance-sorted; the French barn reads 2,629 triangles at 8 m and drops to
  its lowest rung at 500 m via `update(camera)`; scene-wide drawn triangles
  fall near -> far; console clean.

## Discipline

One level first (bocage), verified live, then the three vanilla trees
(bf1942, xpack1, xpack2). The mod-scope rule in CLAUDE.md applies: other
mods' trees are not re-baked.

## Open

- The fallback curve is ours, not the engine's — the engine's own per-geometry
  swap distances for undeclared geometries are not recoverable from the data
  (no reader in the binary was traced). Where a level declares
  `setLodDistance`, the authored numbers are used.
- The `LodSelector` vehicle-part mechanism is untouched; vehicle parts keep
  their existing swap behaviour.
