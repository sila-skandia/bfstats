# Model viewer: the Hit regions, Display and Model tabs

A user of the model viewer (`mesh.bfstats.io`, `tools/bf1942-models/viewer/index.html`)
asked whether they could turn the texture off. The option existed, but the owner
had hidden it: the Display and Model panels carried `data-dev`, so they only
showed with `?dev=1`. The owner's brief (2026-11-11):

1. Bring the advanced options back for everyone. They are for modders.
2. Give them the look and interaction style of the dogfight school and the
   page's own crew stations bar, reusing their tokens and components.
3. One tabbed panel for playing with the model: textures off (said plainly),
   wireframe, double-sided, explode, the model details and part tree, and the
   hit regions **overlaid** on the textured mesh, not only as a replacement view,
   with the weapon colouring and shot placement still working.
4. It has to work at phone width.

Then, from the user's actual request: they wanted the mesh **partly transparent**,
not gone. So a texture opacity slider (opaque down to nothing), paired with the
wireframe so the edges stay visible while the surface fades, without breaking
alpha-tested or blended materials, and with depth kept so a faded hull is not a
mess of back faces. A back-faces toggle where that helps.

Status: **built**, checked headless in Chromium at desktop (1280x820) and phone
(390x844) width on the Sherman, Tiger, Spitfire and BF109 (see "Checked").

## What it looks like

The column keeps the model card, Browse armoury and Variant on top. Under them,
one panel with a tab strip that sticks to the top of the column while it scrolls:

| Tab | What is in it |
|---|---|
| **Hit regions** (default) | Show hit regions: `Off` / `Over model` / `Regions only`; Region opacity slider (when on); Enemy weapon; the legend with the material chips; the shot readout |
| **Display** | Textures: `On` / `Off, flat grey`; Texture opacity slider (100% to 0%); Edges and faces: Wireframe, Back faces and hidden edges, Force double-sided; Parts: Explode parts with its spread; Stage: Auto-rotate, Axes and ground grid, Reflected sky; Reset display |
| **Model** | Details (build, skin, parts, triangles, collision, hit points, weapons, textures, size), Missing textures, Part tree |

Hit regions is the default because it is what a casual visitor saw before (the
Armour panel was the only one not behind `?dev=1`), so their first view is the
same: a weapon picker and a legend, everything else one tab away. The tab is
remembered in the browser (`localStorage`, `mesh.inspector.tab`), and
`?tab=display` links straight to one.

The components are the ones already on the site, not new ones:

- the strip is the dogfight school's fight tabs (`map.css` `.dfs-demos`):
  ink-soft text, the selected tab ink with a 2px olive underline, a thin-line
  SVG icon in front (`.dfs-ico` weights);
- the multi-way choices are its segmented chips (`.dfs-speeds` / `.dfs-chip`):
  a rule-strong box of mono caps, the pressed chip ink on bg;
- the on/off options keep this page's own olive `.toggle`, the sliders its
  `input.range`, Reset the crew bar's `.crew-btn` look;
- the group labels are the page's mono eyebrows.

Everything reads `--mm-*` tokens; the only colour literals are in the 3D
materials (the edges' light grey, the region ramp the legend already used).

At phone width the column sits under the stage as before; the strip sticks to the
top of the column, chips are 34px tall and toggles get a taller row, and Hide /
Controls (the FAB) collapse and restore it as before.

## How the texture opacity works

`model-display-state.js` holds the rules as plain numbers (no three.js, so a node
harness pins them); `model-display.js` applies them.

- A faded surface is drawn blended with depth write off. A **depth-only copy**
  of each mesh (`colorWrite: false`, in the opaque pass, so before any blended
  surface) writes the nearest face's depth first, so a 40% hull is one clean
  skin rather than every back face and interior part stacked.
- **Back faces and hidden edges** drops that copy and draws both sides, for
  when the inside is the point.
- An **alpha-tested cut-out** (foliage, netting, a skin with holes) has its
  threshold scaled with the opacity: three discards `texel.a * opacity <
  alphaTest`, so an unscaled threshold would cut the whole surface away when
  faded. Its depth copy keeps the map and the full threshold, so the holes are
  holes in depth too.
- A material **blended already** (glass, an additive muzzle flash) keeps its
  own depth write and blending; only its opacity scales, and it gets no depth
  copy (that would hide what is behind the glass).
- **Textures off** swaps the map for the flat grey it always was; the opacity
  works the same on it.
- At 0% the surface is not drawn at all; with the wireframe on that is the old
  wireframe view.

Every material's own state is snapshotted when the model loads, so Reset (and
turning anything back off) restores what the glb had, including its own colour
and alpha settings, not a guess.

## The wireframe

The wireframe is no longer the material's own `wireframe` flag (which replaced
the surface). It is a child mesh sharing the geometry, drawn as light grey lines
over whatever the surface is doing, so the edges stay visible as the paint fades:

- depth-tested against the surface's nearest face, so only the edges you could
  see are drawn; **Back faces and hidden edges** turns that off and draws every edge;
- the surface is pushed back a hair (`polygonOffset`) while it is on, so the
  edges do not z-fight with the faces they sit on;
- 40% strength over a solid or half-faded surface, 75% once the surface is
  under 30% and the edges are the picture.

A skinned mesh cannot share its geometry with a plain child, so it falls back
to its material's own wireframe flag (no vehicle in the vanilla set is skinned).

## The hit-region overlay

Before, the "show armour regions" checkbox drew the collision hulls translucent
but depth-tested against the model, and the hulls sit inside or flush with the
paint, so almost nothing showed (a screenshot of the Sherman with it on looked
like the Sherman with it off).

Now the hulls and the shot markers live on their own three.js layer
(`REGION_LAYER` in `model-armour.js`). `index.html` `renderFrame` draws the
scene, then, when regions are on, clears the depth buffer and draws that layer
again over it (`armour.renderRegions`). So:

- **Over model**: the textured (or faded, or flat) model is drawn as normal and
  the regions are drawn over it at 50%, depth-tested only against each other. A
  depth-only copy of each hull keeps it to its nearest face. Unranked and immune
  faces (the legend's grey) draw at 35% of that, so over the paint they do not
  muddy the regions that matter. The region colours are lit with a stronger
  emissive than before so a red engine deck reads over olive paint.
- **Regions only**: the model's materials are hidden and the hulls drawn at 85%,
  the old replacement view, now actually visible.
- **Region opacity** sets the hulls' strength in either mode.

The weapon colouring, material isolation and click-to-place shot are unchanged:
the armour raycaster is set to the region layer, so it still hits the hulls (and
the angle handle), and the markers are blended so they sort over the hulls in
the region pass. Over model and the texture opacity work together: fade the
paint to 40% with the wireframe on and the regions underneath read through.

The old hooks still work: `setCollision(true)` is Over model, `false` is Off.

## Part inspector

The owner's brief (2026-11-12), from a modder: click a part (say material 23 on
a ship) and see where it comes from on the model, "like the Lego Movie master
builders seeing every piece in 3D before the whole".

Nothing new is extracted: the glbs already carry it. A template node has the
exporter's extras in `userData` (`templateKind`, `geometry` = the .sm file,
`control`, `rig`, `seat`, `physics`, `fireArms`); its collision mesh is a child
node with `collision` and `sourceTemplate`, each collision primitive's geometry
has `defenseMaterial`; render materials are named `<mesh>_Material<N>` and map
a texture named after its .dds. The report adds `animatedParts` (the radar's
"continuous yaw 30 deg/s").

### Using it

- **Hover** the model: the part under the cursor (its template node, not a
  triangle) is tinted, boxed, and named in a tag with its kind and mesh file.
- **Click** it: it pops out of the model, away from the model's centre through
  the part's own centre with a little lift, 22% of the model's size; its
  children come with it; the rest of the model fades to a ghost. The Model tab
  opens on its card. **Esc**, the card's close button, or a click on empty space
  puts it back. **Frame** points the camera at it.
- **The card**: the template and its chain back to the root (each a link), the
  mesh file, triangles and collision triangles, the render materials
  (`Material7` and its texture, with a 28 px thumbnail drawn from the texture
  already in memory), the armour materials on its hull with the current
  weapon's head-on damage, what moves it ("Yaws with the mouse, left and right:
  -120 to 120 deg at 45 deg/s", "Continuous yaw 30 deg/s"), its seat or gun,
  and its children.
- **The part tree** (Model tab) is the scene's template nodes, expandable;
  hovering a row tints the part on the model, clicking pops it out. A pick on
  the model marks the row and scrolls the tree (which scrolls on its own, so
  the column stays on the card). A template placed twice shows its own name
  and `#2` (three makes node names unique with `_1`).
- **Search** above the tree: a number matches armour material IDs and render
  material numbers exactly (57 is not Material7); any text matches template
  names, mesh files and texture names. Results are grouped with a kind badge
  (Armour material, Render material, Template, Mesh file, Texture); a group's
  header pops all its parts out, a row one part. Enter takes the first group.
  Collision-only parts (a ladder with no render mesh) are searched too.
- **Material chips** (Hit regions): a chip still isolates its regions, and now
  also lists the parts that carry it under the legend and pops them out.
  Clicking it again puts them back.
- **Take apart** (the stage's pill, the Model tab, the card, or a
  double-click on a part) is a toggle that stays on. With nothing picked it
  spreads the whole model: the biggest top piece (a ship's hull, a plane's
  fuselage) stays as the anchor, the rest fly out staggered, nearer pieces
  first, and stay out. With a part picked it takes **that part** apart: only
  it and what hangs off it are shown (the rest is hidden, not ghosted), the
  camera frames it, its pieces spread. Pick a piece and Take apart again to go
  one level further down (Fletcher: the hull, then a turret, whose barrel
  comes off its housing). The same pill then reads **Put back together**.
- **Where you are**: a breadcrumb on the stage, `Whole model > FletcherComplex
  > Fletcher_cannon`, with the pick after it in italics. A crumb goes back up
  to that level, still taken apart; **Whole model** is the assembled model
  with nothing hidden. Esc steps up one level (the pick first). Picking a part
  in the tree or the search outside what is shown moves up to the lowest
  level that holds it; the tree marks the level "taken apart" and dims what is
  outside it.
- **Back and forward**: every pick and every level is a step; the card's
  arrows (and Alt+Left / Alt+Right) walk them, and the up and down arrows step
  through the part's siblings. Clicking another part on the ghosted model, in
  the tree, or in the card's chain or children switches straight to it.
- **One way home**: the card's close button, the Whole model crumb and Esc
  from the top all end in the same state, set in one place (`go`): nothing
  picked, popped, ghosted or hidden, every material the model's own.
- **Shots and parts**: while the regions are on, a click places a shot, as
  before. A "A click on the model: Places a shot / Picks a part" chip under
  Region opacity hands the click to the inspector instead. With the regions
  off there is no shot to place, so a click always picks.
- **Picked parts are the brightest thing on screen**: the picked meshes
  move onto a layer of their own (`FOCUS_LAYER`) drawn last with the depth
  cleared, so neither the ghost's depth copy nor a hull can hide them, with
  their own material copies (never ghosted), lit, and an olive rim (a
  back-face shell pushed out along the normals). A collision-only part shows a
  lit stand-in of its hull. A small part picked on a far-framed model brings
  the camera in once it is out, and the camera goes back when the pick is
  dropped.
- **Phone**: a tap selects (there is no hover); the tag sits under the
  breadcrumb rather than under the finger; rows, arrows and crumbs are taller;
  Take apart sits bottom right. The crew stations bar starts collapsed under
  720 px (a tap on its head opens it, and the choice is remembered) and
  collapses again on a pick or Take apart, and while the inspector is in use
  the stage takes 56% of the screen's height: 52% measured at 390x844, 50% at
  375x667, 40-42% before any pick.

### How it works

`model-parts-index.js` (no three.js; `tests/test_model_parts.py` runs it under
node) builds the index once per model: every template node that is not a viewer
effect (muzzle flashes, tracers, projectiles), parents first, and a map from
every visual and collision mesh to its part, its nearest ancestor with a
`templateKind`. A collision node has none, so its mesh lands on the template it
hangs off. It also holds the search, the plain-words rig description and the
pop-out and builder timing.

`model-parts.js` is the page side:

- **Picking** tests the ray against each candidate mesh's own bounding box in
  its local frame (so nothing goes stale while turrets turn and parts pop),
  then runs the triangle test only on the boxes it went through, nearest
  first, stopping as soon as the next box starts behind the best hit. Hover is
  one pick per animation frame. On the Yamato (232 meshes) a pick takes about
  0.1 ms in headless Chromium. Collision meshes are picked only while the
  regions are drawn; a hidden LOD or effect is never picked.
- **The pop-out** writes `userData.popOffset` (in the parent's frame) and
  `popT` on the template node; `model-display.js` `applyPositions` (the code
  the explode spread already used) puts every node at `home * spread +
  popOffset * popT`. At rest that is `home * spread`, so a part goes back to
  its authored position exactly, not to a sum of animation steps.
- **The ghost** is the texture-opacity machinery (`model-display.js`
  `setGhost`): every mesh not shown fades to 14% through the same rules as the
  slider, so it keeps its depth copy (one skin, not a stack of back faces) and
  its cut-outs. Materials are shared between parts (a ship's hull material is
  on every turret), so the meshes kept solid get their own copies of their
  materials while the ghost is up, each copied from the original's snapshot,
  and are given back when it lifts.
- The hover tint is a child mesh sharing the geometry (a blended olive pass
  with a negative polygon offset), on the mesh's own layer so a collision
  hull's tint draws in the region pass; the selection boxes are one
  `Box3Helper` per part, so a search for a turret armour shows each turret.

### Checked

`node tools/bf1942-models/tests/model_parts_page.mjs --url http://localhost:5391 --out <dir>`
(with `serve_viewer.py` on 5391) on the Fletcher, the Yamato and the Sherman:

- a turret hovers with its name; a click pops it out with the rest ghosted and
  opens its card; Esc puts it back with every template node within 1e-6 of
  where it was and the turrets exactly on `userData.home` (the radar's baked
  clip writes float32 copies of the same numbers, hence the tolerance);
- a tree row hovers and selects; the radar's card says it spins;
- a search for 57 lists armour material 57 first and pops the four turrets;
  "Fletch_canon_m1", "Fle_base", "Radar" and "7" each find their kinds;
- chip 57 lists and pops its parts; again puts them back;
- every exit from a pick (the card's close button, Esc, a click on empty
  space, the Whole model crumb, the back arrow) leaves every mesh exactly as it
  was before the pick (shown, layer, the same material objects with the same
  visibility, opacity, blending, depth write and side) and every node where it
  was, on the Fletcher and the Spitfire, desktop and phone;
- the round trip: pick, switch on the ghosted model, back, close;
- Take apart holds after 2.6 s; a part taken apart hides the rest; two levels
  down on the Fletcher (hull, then turret); a crumb goes back up still apart;
  Whole model puts it all back exactly;
- the cannon, the radar, the hull and a collision-only part each picked are on
  the focus pass, solid and outlined;
- 200 picks on the Yamato average 0.1 ms;
- on the Sherman with the regions on, a click still places a shot and picks no
  part; with "Picks a part" the same click selects a part;
- at 390x844 and 375x667 on the Fletcher, the Spitfire and the Yamato: a tap
  picks, the stage keeps 50% or more, the crew bar is collapsed, Whole model is
  on the stage and the card's arrows are reachable below, no sideways scroll.

Why the model "went blank" (owner, 2026-11-12): not reproduced headless in
Chromium or WebKit, where every exit restored the model. What would freeze it
that way is a throw inside an animation frame: the loop then never cleared
`animating`, so `invalidate()` refused every later frame and the canvas kept
the ghosted frame until a reload. A frame that throws now ends the loop
cleanly (`frameWork` in index.html), and every exit goes through `go`.

Frames: `desktop-fletcher-hover`, `-selected-<part>`, `-framed-<part>`,
`desktop-<ship|plane>-1-pick`, `-2-switch`, `-3-back`, `-4-whole-model`,
`-apart-1-whole`, `-apart-2-<part>`, `-apart-3-<part>`, `-apart-4-crumb-up`,
`-apart-5-whole-model`, the same with `phone-<model>-390x844-`, and
`phone-<model>-<size>-tap` and `-card`.

## Files

| File | What |
|---|---|
| `viewer/index.html` | the tab panel markup (replaces the Display, Armour and Model panels); `renderFrame` |
| `viewer/index.css` | `.wb-*`: the strip, groups, segmented chips, Reset; phone sizes |
| `viewer/model-display-state.js` | the rules: surface, edges, region modes, tabs |
| `viewer/model-display.js` | the Display tab on the materials; depth copies and edges overlay |
| `viewer/model-armour.js` | region modes and opacity, the region layer and its pass |
| `viewer/model-workbench.js` | the tab strip (ARIA tablist, arrow keys, remembered tab) |
| `viewer/model-parts-index.js` | the part inspector's index: mesh to template, materials, search, rig words, pop and builder timing |
| `viewer/model-parts.js` | the part inspector on the page: picking, hover, pop-out and ghost, card, tree, search, chips, builder view |
| `tests/test_model_parts.py` + `model_parts_harness.mjs` | the index, search and timing under node; the click hand-off |
| `tests/model_parts_page.mjs` | the inspector in the real page, every state, frames (run by hand, needs models) |
| `viewer/model-test-hooks.js` | `setRegionMode`, `setDisplay`, `getDisplay`, `selectTab`, `getTab` |
| `tests/test_model_workbench.py` + `model_workbench_harness.mjs` | the rules under node, and the markup |
| `tests/model_workbench_page.mjs` | the real page headless, every state, screenshots (run by hand, needs models) |

## Checked

`python3 tools/bf1942-models/serve_viewer.py 5391` (it fetches the models the
local tree lacks from mesh.bfstats.io), then
`node tools/bf1942-models/tests/model_workbench_page.mjs --url http://localhost:5391 --out <dir>`.
It asserts each control and writes a screenshot of each state:

- the tabs show without `?dev=1`, Hit regions is the default;
- Textures off clears every map; the wireframe adds an edges overlay;
- the slider at 40% blends the surface and keeps a depth copy; Back faces drops
  it; Reset restores everything;
- Over model shows the hulls with the model still drawn, a shot places on them,
  a weapon recolours them (Sherman with the Bazooka: the engine deck red);
  Regions only hides the model; Off brings it back;
- Over model on the Tiger, Spitfire and BF109;
- the Model tab lists the stats and part tree;
- at 390px: the strip sticks to the top of the scrolled column, no sideways
  scroll, Hide shows the Controls button and it brings the tabs back.

## Open

- Back and forward are the card's arrows and Alt+Left/Right, not the
  browser's own back button: the page's hash already names the model, and a
  history entry per pick would make the browser's back leave the model.
- A plane's hierarchy is shallow: the gear leg holding its wheel is as deep as
  Take apart goes on the Spitfire.

- At 40% a dark hull over the near-black stage is dim by nature; the edges are
  kept at 40% strength so they do not wash the paint out. If modders want the
  paint brighter under the edges, a lighter stage behind a faded model is the
  next lever, not a brighter surface.
