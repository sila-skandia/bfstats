# OPTIONS > VIDEO

Status: **built** (2026-10-10, anti-aliasing; 2026-11-01, the game's rows).
Eight rows and the VIDEO PERFORMANCE presets: GRAPHICS QUALITY, EFFECTS
QUALITY, ENVIRONMENT MAPPING, LIGHTMAPS, TEXTURE QUALITY and VIEW DISTANCE
from the game, ANTI-ALIASING and RENDER SCALE of this site's own. SHADOWS and
ALTERNATIVE SPAWN INTERFACE are not drawn.

The front end's OPTIONS tab and the in-game Escape menu's have a second
button on the options row, VIDEO, beside CONTROLS. It opens the game's VIDEO
PERFORMANCE and VIDEO OPTIONS plates. A change is kept in the browser at once
and the map page applies it live, in a level and in a replay (a replay is the
map page); anti-aliasing and lightmaps wait for the next level.

## What the game's screen is

`menu/VideoMenu` and `menu/VideoNavigation` in `menu.rfa`, read by
`extract_controls_menu_layout.py` into `controls-layout.json` as the `video`
and `videoNav` pages. Three plates:

| plate | what is on it | variable |
|---|---|---|
| VIDEO PERFORMANCE (65,125) | four radio lines: CUSTOM, LOW, MEDIUM, HIGH | `Options/Video/Performance` 0..3, calls `ChangeVideoPerformance` |
| DISPLAY MODE (65,230) | a list box of resolutions with scroll arrows | `Options/Video/DisplayModeList` |
| VIDEO OPTIONS (300,125) | eight rows on the lines y = 165, 195, 230, 260, 290, 315, 345, 375; label at x=312, control at x=473 | below |

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

A slider is a 76x11 grey track around a 74x9 black inside and a 55x19 value
box (VIEW DISTANCE's is a 32x19 edit box); the knob is the engine's and is
not in the file (the page draws the controls screen's 7-unit white knob). A
tick box is a 19-unit grey frame, a 17-unit black inside and a 9-unit olive
mark. DEFAULT and SAVE sit at (345,85) and (453,85); nothing applies until
SAVE, which writes the profile's `Video.con` and shows OPTIONS HAVE BEEN SAVED.

## What each row does in the game

Read from the client binary, ledger rows VID-1..VID-9
(`features/bf1942-engine-reference/ledger.md`, "Video options"). In short:

| row | what the client changes | ledger |
|---|---|---|
| GRAPHICS QUALITY | `renderer.globalLodPercent` 1 / 0.8 / 0.6 (the statics' LOD swaps and small-mesh cull, LOD-7), TreeRenderer's `billboardDistanceScale` 2 / 1.5 / 1 (where a tree becomes its card), `lodObjectDistanceLodFactor` 1 / 0.5 / 0.3 | VID-1 |
| EFFECTS QUALITY | every emitter's intensity times 1 / 0.5 / 0.3 (so that fraction of the particles), and a PatchTerrain switch on at MEDIUM and HIGH | VID-2 |
| ENVIRONMENT MAPPING | the StandardMesh reflection stage, all of it, on or off | VID-3 |
| LIGHTMAPS | object lightmaps, or the lit path for the meshes that have them; the terrain is untouched | VID-4 |
| SHADOWS | the dynamic shadow pass of the `hasDynamicShadow` objects | VID-7 |
| TEXTURE QUALITY | the texture manager drops the top 3 / 2 / 1 / 0 / 0 mip levels; 100 % adds a -1.5 mip LOD bias | VID-5 |
| VIEW DISTANCE | the level's view distance times the percentage, and the fog reset to the view distance's law (FOG-4), which drops a level's declared fog words below 100 % | VID-6 |
| VIDEO PERFORMANCE | LOW / MEDIUM / HIGH run `Settings/Default/Video{Low,Medium,High}.con`; CUSTOM the profile's `VideoCustom.con` | VID-8 |

**The game has no anti-aliasing setting** (VID-9). `Video.con` holds the
display mode and those eight values and nothing else; `VideoDefault.con` adds
full screen, field of view and LOD radius. Multisampling in 2002 was forced
from the driver's control panel.

## What this site draws

- The VIDEO PERFORMANCE plate with its four lines (`performancePanel`); the
  line lit is the preset the current values match, else CUSTOM. LOW, MEDIUM
  and HIGH write their file's values (`video-settings.js` PRESETS, which
  `tests/test_video_settings.py` checks against the installed files; the
  shadows line is left out). CUSTOM brings back the last mix that matched no
  preset, as the game's runs `VideoCustom.con`.
- The VIDEO OPTIONS plate and heading, and eight rows, each the file's own
  row taken whole from its label to the next (`videoRow`) and set on the
  plate's lines in order (`placeVideoRows`, `VIDEO_ROWS`): the i-th row drawn
  sits on the file's i-th line, so the column keeps the game's rhythm and
  has no gaps. TEXTURE QUALITY therefore sits on SHADOWS' line.
  - GRAPHICS QUALITY, EFFECTS QUALITY, TEXTURE QUALITY: the file's sliders
    and value texts (LOW / MEDIUM / HIGH, 20..100 and its %).
  - ENVIRONMENT MAPPING, LIGHTMAPS: the file's tick boxes.
  - VIEW DISTANCE: the file's slider and edit box, in steps of 5 %.
  - ANTI-ALIASING: a tick box in ENVIRONMENT MAPPING's shape.
  - RENDER SCALE: TEXTURE QUALITY's slider and percent box, 50 / 75 / 100 /
    125 / 150 % of the screen's own pixel ratio.
- A click on a slider's track picks the step under it; a click on its value
  box steps on to the next (and round). A click on a tick row's label or box
  toggles it.
- DEFAULT and SAVE from `menu/VideoNavigation`. DEFAULT forgets every choice.
- The section that is up is drawn on the button's clicked plate (`knapp_mc`).

Not drawn: DISPLAY MODE (a browser window has no display modes; RENDER SCALE
is this page's nearest), SHADOWS (the viewer draws no dynamic shadows) and
ALTERNATIVE SPAWN INTERFACE (not a video setting here).

### What each row does on the map page

`viewer/video-apply.js` puts the settings into the page when it starts and on
every change (`video-settings.js` `onVideoChange`):

| row | on the page | live |
|---|---|---|
| GRAPHICS QUALITY | `mesh-cull.js` `setLodPercent` (the lifted LOD chains' `selectLod` and the small-mesh cull), `tree-foliage.js` `setBillboardDistanceScale` at the setting's scale over HIGH's (1 / 0.75 / 0.5) | yes |
| EFFECTS QUALITY | `effects-core.js` `setEmitterIntensityScale`, multiplied into `EmitterClock.interval`'s sampled intensity | yes |
| ENVIRONMENT MAPPING | `envmap.js` `ENVMAP_SWITCH`, the `bfEnvOn` uniform every envmap program shares | yes |
| LIGHTMAPS | `level-load.js` skips `bindLightmaps`; those meshes take the dynamic shading like any other | next level |
| TEXTURE QUALITY | `texture-quality.js`: `TEXTURE_MIN_LOD` = the mips the game drops, on every mipmapped `map`; at 100 % the GPU's maximum anisotropy (WebGL has no LOD bias). At 80 % it touches nothing | yes |
| VIEW DISTANCE | `level-sky.js` `drawDistance` (the far plane and the statics' cull) times the percentage, and below 100 % the fog from `viewDistanceFog` | yes |
| ANTI-ALIASING | `render-antialias.js`, a context attribute | next level |
| RENDER SCALE | `renderer.setPixelRatio(base x scale)`, base being `?dpr` or the screen's ratio capped at 2 | yes |

Departures from the game:

- A change is kept at once (`localStorage` keys `bf42-mesh-video`, JSON, and
  `bf42-mesh-antialias`: `1`, `0`, or absent); every read and write is in a
  try/catch. SAVE has nothing left to do and is drawn without an action, as
  on CONTROLS.
- With nothing stored every row is the game's HIGH, which is also what the
  viewer drew before the rows existed: LOD percent 1, emitters at full
  intensity, reflections and lightmaps on, textures at 80 % (full mips, no
  bias), the level's whole view distance, render scale 100 %.
- The tree swap: the viewer's distance (`billboardDistance`, unscaled) is
  taken as HIGH's. Retail multiplies it by 2 at HIGH and by the tree's own
  `+0x94` (unread, VID-1), so whether retail's HIGH swap is twice the
  template's is open; MEDIUM and LOW keep the game's ratios to HIGH.
- TEXTURE QUALITY keeps every texture in memory (the game's drop was a
  memory saving); the page reproduces the look. 100 % is anisotropy, not a
  LOD bias.
- In a level, a row that waits for the next one (LIGHTMAPS, ANTI-ALIASING)
  says NEXT LEVEL beside it, and the plate says TAKES EFFECT ON THE NEXT
  LEVEL under the column, until the level matches.
- With no anti-aliasing choice the box shows this GPU's default: on, except
  Intel under Mesa, where it is off (`features/intel-gpu-msaa-hang`). Order of
  precedence in `chooseAntialias`: `?aa=0|1`, the stored choice, the GPU
  default. `?dpr` still sets the render scale's base.

### The console words (2026-11-01)

`Video.con`'s words are registered on the page console
(`viewer/console-commands.js`) with the client's own type, argument counts
and access bits (all `method`, one argument, access 2, from the registry
walk in `features/bf1942-in-the-browser/console-commands.json`, CON-20), and
each goes through `changeVideo`, the options screen's own path, so it is
kept and applied as a change on the screen is:

| word | row |
|---|---|
| `game.setGraphicsQuality n` | GRAPHICS QUALITY |
| `game.setEffectsQuality n` | EFFECTS QUALITY |
| `game.setEnvironmentMapping b` | ENVIRONMENT MAPPING |
| `game.setLightmaps b` | LIGHTMAPS (next level) |
| `game.setDetailTexture n` | TEXTURE QUALITY, 1..5 |
| `game.setMenuViewdistance n` | VIEW DISTANCE, capped at 100 as the client caps it |
| `game.setPerformance n` | accepted, kept nowhere: the client stores the radio line and runs no preset (VID-10); the page works the line out from the values |
| `game.setShadows b` | *Method is not active!*: no shadows (VID-7) |

The client's setters store and apply nothing; the menu's apply hands the
record on (VID-10). The page applies a typed word at once, and clamps it to
the row's range, where the client would keep an out-of-range value.

The three numbers GRAPHICS and EFFECTS QUALITY write are console properties
of their own in the client and are registered too: `renderer.globalLodPercent`
(`mesh-cull.js`), `treeRenderer.billboardDistanceScale` in the client's units
(2 at HIGH; the page's swap is HIGH's) and `game.intensityScale` (every
emitter, VID-2). The next apply of the options writes them again, as in the
client.

`game.viewDistance v` (access 4: refused at the prompt until `show.dev 1`,
CON-22) is the client's view distance setter itself (VID-10): it draws to `v`
metres, unscaled, with the fog by the view distance's law (FOG-4) and the
statics culled there (`level-load.js` `setConsoleViewDistance`,
`level-sky.js` `viewOverride`). A move of VIEW DISTANCE or the next level
sets the level's own distance times the percentage again, as the client's
row path and level load do. With no argument it reads the distance the level
draws to.

## Mod packs

A mod's menu pack carries its own `controls-layout.json`. One extracted before
`menu/VideoMenu` was read has no `video` page, and under it the VIDEO button is
not drawn. The five packs that carry the file (xpack1, xpack2, desertcombat,
dc_final, fhsw) were re-extracted; fhsw also draws the plates on its own art.

## Checked

- `tests/test_controls_menu.py` (`LayoutTests.test_the_video_screen_is_the_games`,
  `VideoTests`: the rows in order on the file's lines, the slider and tick
  shapes, the pick along a track, the VIDEO PERFORMANCE lines, an older pack)
  and `tests/test_video_settings.py` (the presets against the installed
  `Video{Low,Medium,High}.con`, the engine numbers, the default being HIGH,
  storage that throws or holds junk, the fog law, a LOD swap moving at LOW, an
  emitter's spawns at 20 / 10 / 6 for HIGH / MEDIUM / LOW, the texture states,
  the pixel ratio, the envmap switch). `tests/test_render_antialias.py` as
  before.
- Headless Chromium (Vulkan), `map.html?mod=bf1942&map=wake&shots=1` with the
  loop stopped, each row changed through `video-settings.js` and the frame
  diffed against the one before (control diff 0):
  - VIEW DISTANCE 50 %: far plane 525 -> 262.5, fog 75..450 -> 12.5..200,
    9 to 55 % of the pixels changed by view; back to 100 %, diff 0.
  - GRAPHICS QUALITY LOW: the 118 LOD chains' summed level 208 -> 219, 11
    more meshes culled, the geometry trees near the camera 6 -> 2.
  - EFFECTS QUALITY: six fire and smoke bundles played three times each
    spawned 1326 / 832 / 690 particles at HIGH / MEDIUM / LOW.
  - ENVIRONMENT MAPPING off: 5807 pixels changed on two parked Corsairs.
  - TEXTURE QUALITY 20 %: 23 to 25 % of the pixels changed; 100 %: a few
    thousand (the anisotropy on grazing ground); back to 80 %, diff 0.
  - RENDER SCALE 50 % / 150 %: the canvas 640x400 / 1920x1200 at 1280x800.
  - LIGHTMAPS off (a reload): 0 meshes bound to a lightmap (126 on), the
    buildings drawn by the lit path, 31 % of the frame changed.
- The same on the Midway replay (`replays/replay_20260927-203459.ndjson`):
  view distance, graphics quality (LOD sum 196 -> 218), texture quality
  (28 % of the pixels), effects (1335 / 831 / 689) and render scale all
  move; lightmaps off on reload, 0 meshes bound (126 on).
- `play/index.html?tab=options`, clicked like a player: the graphics track's
  left end stores LOW and lights CUSTOM; the view distance track's middle
  stores 75; the LOW line writes VideoLow.con's values; CUSTOM brings the
  mix back; HIGH, a value box click (render scale 100 -> 125), the two tick
  boxes, and DEFAULT clearing both keys.
- In a level's Escape menu: VIEW DISTANCE 60 % moves the far plane to 315
  and the fog to 25..250 at once; LIGHTMAPS and ANTI-ALIASING changed read
  NEXT LEVEL; DEFAULT puts everything back.
- On this PC (Iris Xe, Mesa) the anti-aliasing box is unticked by default.

## Open

- SHADOWS: the client's dynamic shadow pass (VID-7) is unread past its gate;
  the viewer would need projected shadows for `hasDynamicShadow` objects
  before the row can be drawn.
- The tree swap at HIGH (VID-1's `+0x94`), and LOD-3's
  `lodObjectDistanceLodFactor`, which the viewer's bake-time LodObject choice
  does not take.
- EFFECTS QUALITY's PatchTerrain switch (VID-2) is unread.
- Foliage edges stay hard with MSAA on: leaves are alpha-tested
  (`alphaTest 0.4`) and nothing uses alpha-to-coverage. That, and a
  post-process pass that would also smooth edges on Intel under Mesa, are the
  next steps for the look.
- The ledger rows are not yet in the Ghidra project copy
  (`annotate.py ~/ghidra-annotated bf1942-mp-enabler`).
