# OPTIONS > VIDEO

Status: **built** (2026-10-10). One setting: anti-aliasing.

The front end's OPTIONS tab and the in-game Escape menu's now have a second
button on the options row, VIDEO, beside CONTROLS. It opens the game's VIDEO
OPTIONS plate with one tick box, ANTI-ALIASING. The choice is kept in the
browser and read by the map page when it builds its renderer.

## What the game's screen is

`menu/VideoMenu` and `menu/VideoNavigation` in `menu.rfa`, read by
`extract_controls_menu_layout.py` into `controls-layout.json` as the `video`
and `videoNav` pages. Three plates:

| plate | what is on it | variable |
|---|---|---|
| VIDEO PERFORMANCE (65,125) | four radio lines: CUSTOM, LOW, MEDIUM, HIGH | `Options/Video/Performance` 0..3, calls `ChangeVideoPerformance` |
| DISPLAY MODE (65,230) | a list box of resolutions with scroll arrows | `Options/Video/DisplayModeList` |
| VIDEO OPTIONS (300,125) | eight rows, 30 units apart, label at x=312, control at x=473 | below |

| row | control | `Video.con` line |
|---|---|---|
| GRAPHICS QUALITY | slider, LOW / MEDIUM / HIGH in a value box | `game.setGraphicsQuality 1..3` |
| EFFECTS QUALITY | slider, LOW / MEDIUM / HIGH | `game.setEffectsQuality 1..3` |
| ENVIRONMENT MAPPING | tick box | `game.setEnvironmentMapping` |
| LIGHTMAPS | tick box | `game.setLightmaps` |
| SHADOWS | tick box | `game.setShadows` |
| TEXTURE QUALITY | slider, 20 to 100 % in five steps | `game.setDetailTexture 1..5` |
| VIEW DISTANCE | slider and an edit box, 50 to 100 % | `game.setMenuViewdistance` |
| ALTERNATIVE SPAWN INTERFACE | tick box, ticked when the variable is false | `game.setRenderWhenSpawnMenu` |

A tick box is a 19-unit grey frame, a 17-unit black inside and a 9-unit olive
mark. DEFAULT and SAVE sit at (345,85) and (453,85); nothing applies until
SAVE, which writes the profile's `Video.con` and shows OPTIONS HAVE BEEN SAVED.

**The game has no anti-aliasing setting.** `Video.con` holds the display mode
and those eight values and nothing else; `VideoDefault.con` adds full screen,
field of view and LOD radius. Multisampling in 2002 was forced from the
driver's control panel.

## What this site draws

- The VIDEO OPTIONS plate and heading, from the file.
- One row, ANTI-ALIASING, on the first line (y=165): the file's ENVIRONMENT
  MAPPING tick box moved there (`viewer/video-options.js`, `tickRow`).
- DEFAULT and SAVE from `menu/VideoNavigation`.
- The section that is up is drawn on the button's clicked plate (`knapp_mc`).

The other seven rows and the two left-hand plates are not drawn: the viewer
has nothing behind them, and a control that does nothing is worse than none
(the rule `play/nav-strip.js` follows for tabs).

Departures from the game:

- A tick is kept at once (`localStorage` key `bf42-mesh-antialias`: `1`, `0`,
  or absent). SAVE has nothing left to do and is drawn without an action, as
  on CONTROLS. DEFAULT forgets the choice.
- With no choice the box shows this GPU's default: on, except Intel under
  Mesa, where it is off (`features/intel-gpu-msaa-hang`). The row carries no
  warning there: turning it on is the player's call (owner, 2026-10-10).
- MSAA is a WebGL context attribute, fixed when the renderer is built. In a
  level the Escape menu's row says TAKES EFFECT ON THE NEXT LEVEL until the
  box matches what the level was built with.

Order of precedence in `chooseAntialias` (`viewer/render-antialias.js`):
`?aa=0|1`, then the stored choice, then the GPU default.

Only `map.html` reads it. The model, pose and kit pages and the controls
preview ask for anti-aliasing outright and draw no effect sprites.

## Mod packs

A mod's menu pack carries its own `controls-layout.json`. One extracted before
this has no `video` page, and under it the VIDEO button is not drawn. The five
packs that carry the file (xpack1, xpack2, desertcombat, dc_final, fhsw) were
re-extracted; fhsw also draws the three plates on its own art.

## Checked

- `tests/test_controls_menu.py` (`LayoutTests.test_the_video_screen_is_the_games`,
  `VideoTests`) and `tests/test_render_antialias.py` (the stored choice).
- Headless Chromium on `play/index.html?tab=options`: VIDEO opens the panel,
  a click on the box stores `0`/`1`, DEFAULT clears it, CONTROLS comes back
  with its preview.
- `map.html?map=Wake` with the key absent, `0` and `1`: the stage canvas's
  context attributes read `antialias` true, false, true. Unticking in the
  Escape menu of the level built with it gives the next-level note.
- On this PC (Iris Xe, Mesa) the box is unticked by default.

## Open

- Foliage edges stay hard with MSAA on: leaves are alpha-tested
  (`alphaTest 0.4`) and nothing uses alpha-to-coverage. That, and a
  post-process pass that would also smooth edges on Intel under Mesa, are the
  next steps for the look.
- A render-scale row (`?dpr`) is the natural second setting; DISPLAY MODE is
  where the game puts its equivalent.
