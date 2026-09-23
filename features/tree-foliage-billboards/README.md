# Tree foliage: camera-facing sprites and far billboards

Owner's report (2026-09-23): "the trees in some maps are not rendering nicely.
Bocage is a good example: on certain angles they are just sticks without
foliage, depending on the angle the bush renders. But in the real game they
are always visible."

## Root cause

Two things, both in how a Refractor `TreeMesh` is drawn, neither a material
flag. The bakes were right and needed no re-extract.

1. **Leaf sprites are camera-facing in the engine and flat in the bake.** A
   `.tm` leaf sprite is a point plus a per-corner `(ox, oy)` half-size; the
   engine expands it toward the camera each frame. `bf42/treemesh.py` bakes
   it as `position + (ox, oy, 0)`, a quad in the mesh's XY plane, because
   glTF has nothing else to hold it. Every card in a tree lies in the same
   plane, so from the -z side the canopy is full and from +x every card is
   edge-on: the trunk with slivers. Runtime materials were already right
   (`DoubleSide`, `alphaTest 0.4`, mips on), which is why it was
   angle-dependent and not simply missing.
2. **Past `billboardDistance` the engine draws a pre-rendered card, not the
   geometry.** Every vanilla tree's `Geometries.con` says
   `GeometryTemplate.billboard 1` / `.billboardDistance 50` (`PALMSHORT_M1`
   150). Beyond that the whole tree is one quad textured from
   `treeMesh/Billboards/<mesh>.dds`: eight views 45 degrees apart in a
   1024x128 strip (512x64 for bushes). Those soft dense canopies are what
   the retail screenshot shows at range. The viewer drew the geometry out to
   the fog, where the leaf texture's mip-averaged alpha falls under the 0.4
   cutoff and the trees thin to sticks.

## Fix (viewer side, plus one new shared asset)

- `viewer/tree-foliage.js`: recovers each sprite quad's centre and half-size
  from the baked corners (they share one centre; offsets are symmetric) into
  `treeCenter` / `treeOffset` attributes and re-expands the card in view
  space in the sprite material's vertex program. Loads `_shared/trees.json`,
  gives each placed tree an impostor quad (height on a side, standing on the
  trunk base, turned about Y toward the camera, strip frame picked from the
  viewing azimuth) and swaps geometry for card at the template's distance
  from `scene.onBeforeRender`. Only a tree's part meshes are toggled; the
  page's static cull keeps the node.
- `extract_tree_billboards.py --mod <mod> --out <maps>/_shared`: writes
  `trees.json` (distance, `.tm` bounding boxes, strip size per geometry
  template) and `trees/<mesh>.png`. Run for bf1942, XPack1, XPack2, EoD.
- `map.html`: one import and one `bindTreeFoliage` call after
  `collectTerrain`.

## Strip frame order and card size

Frame `f` = camera at azimuth `45 f` (phase 0). The first fit (IoU of each
frame's alpha against sprites projected from the `.tm`) tied phases 180 and
225 at 0.533 and shipped 180; scoring the card against the tree's own
rendered geometry in the viewer instead (eight bearings, 45 m, background
subtracted, both trees) is unambiguous:

| phase | birch IoU | asp IoU |
|---|---|---|
| 0 | 0.80 | 0.68 |
| 7 | 0.80 | 0.67 |
| 4 (was shipped) | 0.56 | 0.55 |
| mirrored, best | 0.71 | 0.61 |

The card is the bounding box height tall and the box's XZ diagonal wide, not
square: drawn square it came out 1.41x wider than the geometry at every
bearing while matching its height to 2%, and a frame's alpha spans ~96% of
its height but only 55..73% of its width. With the diagonal the width ratio
is 0.96 (birch) and centroids align to within a few pixels.

## Transition

The engine cuts at `billboardDistance`; drawn here that popped, because the
card is denser than the sprite canopy. The viewer fades instead: over
`FADE_SPAN` (40% of the distance, 40..60 m for a 50 m tree) the geometry
stays opaque while the card blends in over it, from clear to solid, and the
geometry is dropped underneath the solid card at the far edge. Each placed
tree has its own card material for the opacity; the card's alpha test scales
with opacity so its outline holds while it fades. An ordered-dither
cross-fade was tried first and rejected: the 4x4 stipple reads as a screen
door at mid-band without temporal AA.

Measuring any of this in the viewer: capture every frame of a comparison
synchronously (no `await` between renders, or the page's own loop renders in
between), render several settle frames after moving the camera (the static
cull catches up over frames), and exclude pixels that differ between two
idle renders before comparing.

## Not done / open

- Twelve vanilla templates ship no strip (ferns, four jungle trees, four
  Pacific palms) and draw as geometry at every range, as before.
- Whether engine sprites are screen-aligned or Y-axis-aligned was not
  settled from the binary; screen-aligned (Ahrkylien's importer) is used.
- The card is the pre-render's own shading and still a little denser than
  the sprite canopy, so a faint halo grows in across the band on a bright
  sky; the geometry-to-card IoU tops out around 0.8.
