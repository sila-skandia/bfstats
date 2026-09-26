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

An undeclared slot keeps the template constructor's default: `StandardMeshTemplate`
ctor `0x005b5b40` fills the ten-slot table at `+0xd8` with 0, 150, 300, ... 1350, and
`setLodDistance` overwrites single slots. That is `DEFAULT_LOD_DISTANCES` in
`bf42/assemble.py`. (Until 2026-09-26 the exporter used a census-median curve,
0/15/35/60/100/200, and padded short tables by repeating the last band; neither is
what the engine does.)

### Which levels the client keeps (2026-09-26)

The client does not draw every level a `.sm` ships. `StandardMeshTemplate_readLods`
(`0x005b54e0`) reads each LOD through `readMaterials` (`0x005b42d0`), which leaves the
vertex count of the LOD's **last** material descriptor in `DAT_009ab664`. After the first
LOD whose last material has **fewer than 100 vertices**, it sets `DAT_009ab660`, and
`readMaterials` reads the rest through without building them. Template vt+0xac is a
constant `false` for StandardMesh (`0x004067d0`), so nothing exempts a mesh. The LOD
vector is then resized to the kept count (`0x005b55e2`, `ebx`). When that cut the chain
and kept more than LOD 0, the last kept level takes the chain's final distance
(`0x005b55b6`..`0x005b55c6`: `dist[kept-1] = dist[total-1]`). Template byte `+0x100`
(the object-lightmap flag, ledger LM-1) also stops the chain after LOD 0; where it is
set is still unread.

`retail_lod_chain` in `bf42/assemble.py` is that rule, and `_mesh_index` emits only the
kept rungs. Example: `stonebridge_sml_M1`'s LOD 0 ends on a 68-vertex material, so the
game draws LOD 0 at every distance. We had shipped all six levels, and its LOD 4 has one
deck end collapsed onto the abutment's foot, which read as a hole in the bridge from 100 m.

Selection, for reference (`StandardMesh_selectLod` `0x005adfd0`): the highest level `i`
with `dist[i]^2 * globalLodPercent * sizeFactor * fovModifier < d^2 - r^2`. Here `d` is the
camera distance and `r` the mesh radius (`+0x4c`). `globalLodPercent` is renderer `+0x130`,
1 in every vanilla `Init.con` that sets it, clamped to 0..1 by `0x00679aa0`. `fovModifier`
is `RenderView::getFieldOfViewModifier` (`+0x1c`), 1 at the start FOV and larger when
zoomed. `sizeFactor` only applies below `renderer.globalLodRadius` (1 m by default).
The viewer uses plain `THREE.LOD` distance, which ignores the `-r^2` term.

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
children snapshot, and the splice runs against a captured parent.

Two transforms, learned the hard way (2026-09-26):

* The LOD must NOT re-parent the part. The first splice moved the part
  inside the LOD and composed its local transform twice (a placement at
  (541.6, 43.2, -393.9) rendered at (-1.2, 82, -1.7), T applied twice).
  Resetting the part to identity inside the LOD fixed the render but
  destroyed the node's local transform - and that transform is load-bearing:
  `applyRig` poses turret, wheels and propeller through the captured base
  locals, so every driven vehicle lost its turret mount, buried its wheels
  and stranded its propeller. The final shape: the LOD is a SIBLING of the
  part carrying the part's transform, the rungs move under it, and the
  part's local transform is never touched. The part is the implicit level 0;
  a patched `lod.update` swaps it against the rungs by threshold.
* Every chain under the spawners root stays unlifted — not just the root
  chain. The game nests spawner vehicles one level deeper (spawners → M3A1 →
  lodM3A1 → M3A1Complex), so a parent check against the spawners root missed
  the chains and a lifted root hid its whole rig: the wheels, doors and MG
  mount are CHILDREN of the root part, so the moment its rung showed, the
  rig's parts vanished with it (wheels gone at 10-20 m, where their own rungs
  were not yet due). The skip now walks the ancestors; `Vehicle` reparents the
  root onto the level root when driven, so a LOD there would still strand
  rungs at the pad.
* Building-interior chains (`*Interior`, instance suffixes included) stay
  unlifted too: the engine ran one interior switch at 70 m and never applied
  the geometry's own setLodDistance table to an interior, and a decimated
  interior rung tears through the exterior walls when it swaps at 15 m.

The copy happens before `buildLodLevels` runs; the rungs keep their own locals,
which were authored relative to the part. (The identity-reset variant of this
splice was reverted the same day: it fixed the render but destroyed the part's
local transform, which the vehicle rigs pose through - see the sibling design
above.)

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

- The `-r^2` term and the zoom `fovModifier` in `selectLod` are not ported. A
  big mesh (the 32 m-radius bridge) swaps about 5 m later in the game.
- Where template byte `+0x100` is set is unread.
- The `LodSelector` vehicle-part mechanism is untouched; vehicle parts keep
  their existing swap behaviour.
