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

## Strip frame order

Fitted 2026-09-23 by IoU of each frame's alpha against the trunk and leaf
sprites projected from eight azimuths (37 vanilla trees, all eight
direction/phase hypotheses): every tree preferred the same rotation sense;
phases 180 and 225 tied overall (0.533 mean IoU), and 180 is the one with a
reason — frame 0 is the default D3D front view (camera on -z looking +z in
the mesh's left-handed frame), frames then walk the camera toward +x. Frame
`f` = camera at azimuth `180 + 45 f`. The strip is square per frame in world
units, spanning the mesh bounding box height, centred on the trunk origin.
Checked against the geometry at 45 m / card at 55 m from six bearings on
Bocage's `EU_Birtch2_M1`: same lean and sidedness, card ~20% fuller.

## Not done / open

- Twelve vanilla templates ship no strip (ferns, four jungle trees, four
  Pacific palms) and draw as geometry at every range, as before.
- The card is the pre-render's own shading (darker than the tinted, unlit
  near geometry); there is a visible step at 50 m. Retail's far trees are
  also dark, so it was left as authored.
- Whether engine sprites are screen-aligned or Y-axis-aligned was not
  settled from the binary; screen-aligned (Ahrkylien's importer) is used.
