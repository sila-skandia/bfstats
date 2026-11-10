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

## Files

| File | What |
|---|---|
| `viewer/index.html` | the tab panel markup (replaces the Display, Armour and Model panels); `renderFrame` |
| `viewer/index.css` | `.wb-*`: the strip, groups, segmented chips, Reset; phone sizes |
| `viewer/model-display-state.js` | the rules: surface, edges, region modes, tabs |
| `viewer/model-display.js` | the Display tab on the materials; depth copies and edges overlay |
| `viewer/model-armour.js` | region modes and opacity, the region layer and its pass |
| `viewer/model-workbench.js` | the tab strip (ARIA tablist, arrow keys, remembered tab) |
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

- At 40% a dark hull over the near-black stage is dim by nature; the edges are
  kept at 40% strength so they do not wash the paint out. If modders want the
  paint brighter under the edges, a lighter stage behind a faded model is the
  next lever, not a brighter surface.
