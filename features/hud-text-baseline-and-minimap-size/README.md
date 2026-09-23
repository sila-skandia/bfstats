# The HUD's bitmap-font baseline, and the minimap's width

Two defects, reported together off one in-game screenshot: the map viewer's
minimap was about half again as wide as it should be, and the ticket counts
sat outside their boxes on the ticket bar. They turned out to be independent.

Both are now measured against retail rather than reasoned about, off two
captures: a full-screen 2559x1441 one and a 1920x1050 crop.

## 1. The minimap was 1.45x too wide

`syncMinimapToTickets` sized the widget from the ticket plate's **leaf rect**,
`(620, 4) 256x32`. But `icon_ticketbar` is a 256x32 texture whose ink stops at
column 176 — the last 80 columns are transparent padding. The bar a player
sees is 176 units wide, not 256, so every frame the map came out
`256/176 = 1.45x` too wide.

The comment above the code already carried the right number (it said the
frame was "173.2 of 175.4 virtual units"); only the code disagreed with it.

Measured off the captures, in the HUD's own 800x600 virtual space:

| | virtual |
|---|---|
| ticket plate, painted | x 620..796, y 4..28 |
| minimap frame | x 620..795.4, y 30..204.9 |

So the frame is flush with the painted bar on both sides, with two units of
sky between them, and it is a **square in virtual units** (175.4 x 174.9) —
not on screen, because the HUD stretches by `stageW/800` across and
`stageH/600` down and those differ on any window that is not 4:3.

The binary says the same thing, which is the better citation: `BfMap__animate`
writes the widget's own `TransformNode` position and size every frame as
`(400 + 220(1 − z) − 120z, 30)` and a square of `175 + 337z`, z being the
open/close zoom (`minimap-and-fullmap.md`, ledger MEME-12/13). Closed, z = 0:
**(620, 30), 175 square** — the measurement above to within the filtering. The
old code's 256 was never a size the engine writes.

`MINIMAP_RECT` now holds that rect and `syncMinimapToTickets` puts it through
those two scales, corner included. The box therefore tracks the bar at any
stage size instead of sitting at a fixed `top: 44px; right: 16px`.

**Portrait is the exception.** A phone holds the stage taller than it is
wide, which retail never did: `sy` there is two and a half times `sx`, and
the rect put honestly through them gives an 82x215 splinter down the side of
the screen. Below 720 px of stage the widget keeps its own 175.4:174.9 shape,
capped at 118 px, and the stylesheet's `@media` rule keeps the corner.

## 2. Every bitmap-font glyph was drawn too high

`BitmapFont.baseline` in `bf42/font.py` was derived, not read: the `.dif`
carries a line height and per-glyph ascents but no baseline, and the property
returned *the largest ascent among `0`-`Z`* — the cap height.

It is `line_height - 1`. Four leaves, two captures, four faces:

| leaf | rect y | face (line height) | glyph ascent | ink top |
|---|---|---|---|---|
| `menu/InGame` Axis ticket | 4 | Trebuchet MS14 (19) | 14 | 8 |
| `menu/InGame` primary ammo | 527 | Trebuchet MS11 (15) | 11 | 530 |
| `menu/InGame` magazine count | 576 | standard6 (8) | 7 | 576 |
| `menu/InternetMenu` "INTERNET GAME" | 133 | Trebuchet MS8 (11) | 8 | 135 |

Every one is `rect y + (line_height - 1) - ascent`.

The cap-height reading agrees for the 8 px faces, where the cap height *is*
`line_height - 1` — which is why the magazine count and most menu chrome
looked right and this went unnoticed. It is wrong by 3 on Trebuchet MS11, 4
on MS14 and 5 on MS18. On the ticket bar that put the counts four rows high,
out through the top of their own plate, which is what the report was about.

Verified after the fix, on Bocage at a 961x774 stage: blue count ink at
virtual x 651.8..681.8 y 7.75..21.71 against a predicted 652..682 / 8..22,
red at 760..790 / 8..22. Retail's own red count measures x ..789.4, y 8.3..22.5.

### What this touched

`baseline` is a pure function of `lineHeight`, so the already-extracted font
tables were rewritten in place rather than re-extracted:

```
trebuchet_ms11_latin  11 -> 14
trebuchet_ms14        14 -> 18
trebuchet_ms14_latin  14 -> 18
trebuchet_ms8          8 -> 10
trebuchet_ms18         18 -> 23
trebuchet_ms18_latin   18 -> 23
standard6 / standard6_latin   unchanged (7)
```

in all three trees (`hud/fonts`, `hud/menu/fonts`, `hud/scoreboard/fonts`).
Three painters read it and all three are fixed by the data alone:
`hud.js` `drawBitmapText`, `map.html`'s copy for the deploy screen, and
`play/menu-screen.js`.

`viewer/maps` is gitignored, so those tables live only in the local shared
asset tree. **The copies serving mesh.bfstats.io still carry the old
baselines and need republishing** for the fix to reach the live viewer.

## Verified

- `python3 -m unittest` over `tools/bf1942-models/tests` — 2706 tests, OK.
- In the viewer at 961x774: ticket counts inside their boxes on both the
  live HUD and the deploy screen; minimap 211x226 at x 744, flush under the
  bar's right edge.
- At 375x812: minimap 82x82, back to the corner the stylesheet gives it.
- Scoreboard and the instant-battle menu re-checked for the MS8/MS18 shift —
  headings still sit inside their own bands.
