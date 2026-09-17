# R5 — The scope overlay: who turns it on, and what draws it

You are a research agent on the map-viewer fidelity round. Read
`features/mesh-viewer-fidelity-defects/BRIEFING.md` first if you have not.
You read the engine and the shipped data; you do not change the viewer.

## The defect

Zoom the scout's rifle in retail and the frame blacks out except for a round
scope view in the middle, crossed by long thin sight lines
(`game-sniper-zoom.png`). Zoom in the viewer from the same spot and you get the
magnified world and nothing else (`mesh-sniper-zoom.png`). The magnification
itself looks right; the overlay is simply absent.

This is the cheapest of the four defects to fix and the one most likely to be
finished by naming four variables. **The art and the layout are already
extracted and shipped.** What is missing is the engine's writer side.

## What is already in the repo — confirmed by reading the data

`viewer/maps/_shared/hud/hud-layout.json`, group `crosshair`, virtual space
800x600. Every element and its gate, read out of the file:

| # | kind | rect | texture / var | shown when |
|---|---|---|---|---|
| 0 | variable-picture | 390,290,20,20 | `hk` / `CrossHair/CrossHairIcon` | `ShowCrossHair` and not `Submarine/ShowPeriscope` and `ScopeIndex == 0` and `CrossHairType == 1` |
| 1 | crosshair | 390,290,20,20 | — | same, `CrossHairType == 2` |
| 2 | fill | 400,300,1,1 | — | same, plus `ShowCenterPoint` |
| 3 | variable-picture | **-8,-2,825,625** | **`sniper`** / `CrossHair/ScopeIcon` | `ShowCrossHair` and not periscope and **`ScopeIndex != 0`** |
| 4 | fill | -8,300,392,1 | — | as 3, plus `CrossHair/SniperSight` |
| 5 | fill | 400,300,1,1 | — | as 4 |
| 6 | fill | 415,300,**445**,1 | — | as 4 |
| 7 | fill | 400,313,1,**290** | — | as 4 |
| 8 | fill | 400,300,1,1 | — | as 3, plus **not** `SniperSight` |
| 9 | variable-picture | 338,236,128,128 | `scout_ring_128x128` / `CrossHair/SightIcon` | as 3, plus **not** `SniperSight` |
| 10–13 | fill | 387,288,1,3 · 408,289,3,1 · 387,310,3,1 · 409,309,1,3 | — | `ShowCrossHair` and not periscope |

Read off that table:

- The blackout and the scope are **one full-screen picture** (`sniper.png`,
  already in the pack), not a set of black quads.
- The sight lines are **engine-drawn fills**, not part of the texture, and they
  deliberately run past the virtual bounds (element 6 reaches x = 860 of 800;
  element 7 reaches y = 603 of 600) — which is itself evidence about how the
  virtual space is mapped to the screen.
- `ScopeIndex != 0` **with** `SniperSight` is the rifle scope; `ScopeIndex != 0`
  **without** it is a different sight that draws the 128x128
  `scout_ring_128x128` ring — almost certainly the binoculars.
- Nothing in the viewer writes a single `CrossHair/*` variable, so `_visible`
  culls the whole group. `viewer/hud.js`'s own comment on `_drawCrosshair`
  says it: *"nothing writes `CrossHair/*` into `vars`, so `_visible` culls
  every leaf in this group before this ever runs"*. The same comment records
  that `map.html` keeps its own **DOM crosshair** from an earlier round and
  that `_drawCrosshair` is not a traced reproduction of `BfCrosshairNode::draw` —
  so say in your report what should happen to the DOM crosshair once the
  layout group is fed, and whether the procedural node needs tracing.

Also settled:

- **VHUD-5.** `CrossHair/CrossHairType` is `None=0, Icon=1, CrossHair=2,
  anything else=3` (`operator>>` `0x004c5110`), and the entire crosshair
  region — plain crosshair **and** the scope overlay — is gated on
  `NotData(Submarine/ShowPeriscope)` (`CullNode@83890`).
- **VIEW-10, corrected.** Zoom scales the mouse deltas by `zoomFov`, not
  `SoldierZoomFov`: the site `0x0050095f` multiplies the two look locals by
  `[[weapon+0x4c]+0x3dc]`, which off that pointer is `zoomFov` — the field
  `setZoom` (`0x005391b0`) tests first and hands to
  `RenderView::setFieldOfView`. `SoldierZoomFov` is +0x3e0. With
  `renderer.fieldOfView 1` the default FOV is 1.0 rad.
- **GUN-6.** All 22 `zoomFov` / `useScope` declarations in vanilla sit in
  exactly 17 `HandWeapons/` files; no vehicle or stationary weapon sets any of
  them. Several mods do.
- `hud-layout.json`'s own note: only vanilla's `Mods/bf1942/Archives/menu.rfa`
  is read, so a mod shipping its own `menu.rfa` is not represented.

## Questions, in priority order

1. **What writes `CrossHair/ScopeIndex`, and what do its values mean?** Find
   the registrar and the writer in the client. Is it an index into a table of
   scope textures, a boolean in disguise, or something else? Which value does a
   `No4Sniper` produce, which the `Binoculars`, which a mod's scope?
2. **Where does `CrossHair/ScopeIcon`'s path come from** — a `.con` word on the
   weapon, a fixed table in the client, or the layout's own literal? Same for
   `CrossHair/SightIcon`. If it is a weapon word, sweep all 14 mods for it and
   report who sets what.
3. **What is `CrossHair/SniperSight`**, and what turns it on? It is what
   separates the rifle scope from the binocular ring in the same group.
4. **The texture's geometry.** `sniper.png`'s native size, and how a
   non-square, larger-than-virtual rect (-8,-2,825,625) reaches the screen at
   4:3 and at 16:9. Does retail stretch it with the rest of the HUD, letterbox
   it, or size it against the screen? Check your answer against
   `game-sniper-zoom.png` (2542x1440): the scope circle there is round, which
   is a strong constraint. Coordinate with R4, which is reading the same
   mapping rule from the vehicle side — if you both derive it, say so; two
   independent derivations of that rule are worth more than one.
5. **What else changes when the scope comes up?** Whether the first-person
   weapon is hidden (retail's zoomed capture shows no weapon at all), whether
   `ShowCrossHair` / `CrossHairType` change, what happens to deviation, and
   whether firing while scoped leaves the scope state. `handleVisualUpdate`
   owns the hip↔zoom ease, once per rendered frame — give its shape and
   duration. R2 owns the animation side of firing; you own the scope state.
6. **The trigger.** Which input action raises zoom, whether it is hold or
   toggle, what gates it (`useScope`, ammo, stance), and what the FOV
   transition looks like over time — the numbers, in the `renderer.fieldOfView 1`
   unit the corpus uses.
7. **Binoculars and periscopes.** What the `Binoculars` item sets, so a fix
   does not work for the rifle and break the ring; and what the periscope gate
   is protecting (`Submarine/ShowPeriscope`), since a submarine's view shares
   the region.
8. **Mods.** Which installed mods ship their own scope art or their own
   `menu.rfa` crosshair group, and whether the variable contract is the same
   for them. The viewer loads mod content, so a vanilla-only answer is a
   partial answer.

## Deliverable

The report shape in the briefing, plus:

- A table of every `CrossHair/*` variable in the group above: who writes it in
  retail, when, and what the viewer must set it to for (a) the rifle scope,
  (b) the binoculars, (c) neither.
- The mapping rule for element 3's oversized rect, with the evidence.
- A one-paragraph statement of the minimum change: the viewer already has the
  art, the atlas entry, the layout and the painter, so name precisely the
  variables `map.html` must write and the moment in the frame it must write
  them.

## What would make this report wrong

- Answering "set `ScopeIndex = 1` and it draws" without finding what retail
  sets it to and when — the binocular path shares the gate and would break.
- Assuming the black area is a HUD colour fill. The layout says it is the
  picture; confirm the picture's alpha does the blackout.
- Skipping the aspect question. At 16:9 a wrong mapping gives an oval scope or
  a circle that does not cover the frame, which is exactly the class of bug
  this round is trying to end.
