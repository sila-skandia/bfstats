# The mission briefing screen (post-load, READY-gated)

The loading flow was one screen short of parity. In the game the fullscreen
splash (load picture, `menu_loading` plate, bar, music) is only the *first*
phase; when the level finishes loading a second screen appears over the live
3D scene: the mission briefing dialog — map name, the two team flags with
"VS", the game-type line, a settings block, the OBJECTIVES and COMMENTS
boxes, and a READY button. The loading music plays until the player clicks
READY. We had merged the briefing text into the splash itself; this feature
splits the two.

The screen is drawn with the game's own assets on a canvas
(`viewer/briefing-screen.js`) that `progress.js`'s overlay hosts, the way the
deploy screen draws the spawn layout. No DOM dialog, no CSS stand-in
typography — the plate, the faces and the button plates are the archive's.

## The game's own data, and where each piece comes from

Measured against `image_bfe903.png` (Wake, stock game, 2558x1440; the UI is
the 800x600 stage at x2.4/x3.2) and the menu archive:

* **The dialog plate** is `menu/Texture/Briefing/mp_briefing_512x512.dds`
  (`menu.rfa`): a smoky plate, content in the top 512x334, with two rule
  lines under the title area and three inset dark bands (alpha 204, rgb ~42).
  Extracted to `maps/_shared/load/mp_briefing.png` by
  `extract_loading_assets.py`'s `extract_chrome`, next to `menu_loading.png`.
  Drawn 1:1 at (144, 81) in the 800x600 virtual space: the capture's rules
  land on the texture's own rows at 1:1, so the texture maps to the dialog
  with no scaling.
* **Title** (texture rows 0-24): the map's display name — `maps.json`'s
  `loading.title`, the canonical strings `extract_loading_assets.py` derives
  ("WAKE ISLAND", ...) which match the chain lexicon's own records
  (`Wake` -> `WAKE ISLAND`). Rendered in **trebuchet_ms18** at 1x, centred at
  x 400, baseline 101 — capture ink 318..477 (w 159) against the face's 151,
  cap 17 against the face's 17.
* **Type** is the menu's bitmap faces out of `Font.rfa`, extracted to the hud
  pack's `fonts/` by `extract_spawn_layout.py`'s `extract_fonts` (the spawn
  layout never references the two this screen needs — **trebuchet_ms18** and
  **trebuchet_ms11** — so they are now extracted alongside the four it does;
  the pack ships all six). The shared renderer is `viewer/bitmap-text.js`,
  lifted out of `deploy-screen.js` (atlas tint cache, measure, draw, plus
  scale / tracking / outline options this screen needs).
* **Flags row** (texture 31-48): the two sides' flags are the ticket
  counter's waving sprites, `flag_ticket_<nation>.png` from the hud pack —
  not the spawn screen's pole flags (`icon_flag_*`, which are the CTF/
  capture icons). Nations from the page's `teamNation` (the same answer the
  deploy screen's team tabs use), "VS" between (trebuchet_ms8, dark).
* **Game-type line** (below the second rule, baseline 154.5):
  `CONQUEST - ASSAULT MAP` — `gameplayMode` upper-cased, dash,
  `briefing.mapType` (already resolved from `Menu/Init.con`'s
  `setMultiplayerBriefingMapType`). **trebuchet_ms11**, tracking 0.8 —
  capture ink w 209 against the face's 192, cap ~12 against 11.
* **Settings block** (dark band 1, texture 76-119): FRIENDLY FIRE /
  ALLOW NOSE CAM / TICKET RATIO in **trebuchet_ms8**. Server-side values, and
  the viewer *is* the server: the stock
  `Mods/bf1942/Settings/ServerSettings.con` defaults
  (`serverSoldierFriendlyFire 100`, `serverAllowNoseCam 1`,
  `serverTicketRatio 1000`) are what a local game shows — 100% / ON / 100%.
  Labels at x 154, values right-aligned at x 646, baselines 170 + i*13.5.
* **OBJECTIVES / COMMENTS** (dark bands 2 and 3): khaki header bars
  (rgb 132,125,76 — see the colour note below) with a dark edge, label in
  **trebuchet_ms8**, and the objectives text in **standard6** at 1x with a
  1px dark outline, wrapped at 491, baselines 245 + i*11.7 — capture line ink
  237.9..246.2 per line at pitch 11.7 (the face's own metrics confirm it:
  ascent 7, the blocky look of the capture's body text). COMMENTS is empty in
  multiplayer — the box is part of the screen.
* **READY** (band below the plate, virtual 420..455): the game's own
  `knapp3_n` / `knapp3_mo` plates (`menu/textures/`, already in the hud pack
  for the spawn screen footer), content box 107x25 at (3,1) drawn to
  108x25 at (339, 426), label "READY" in trebuchet_ms8, tracking 6.5,
  centred at x 393, baseline 444 — the capture's wide-tracked label.

Colour note: every colour on the screen came out of the game's data except
the khaki band. Menu cons, the level `Init.con` (which carries only the
briefing trio) and a float/byte scan of `BF1942.exe` for the
(0.518, 0.490, 0.298) triple all came back empty, so the bar is sampled off
the capture and marked as such in `briefing-screen.js`.

## Flow change

`progress.js`'s `end()` no longer fades the overlay away on the authentic
placement when a briefing screen was handed in: it flips the overlay to a
`briefing` state — splash art and bar hidden, overlay background transparent
so the live scene shows through — lays the canvas out
(`briefing.layout(pane w/h, dpr)` maps the virtual space onto the pane and
places the READY hit area, deploy-screen style), paints the last payload and
waits. The READY hit area is an invisible DOM button over the drawn plate
(the canvas itself is `pointer-events: none`, the overlay root too, so the
button carries `pointer-events: auto`); clicking it fades the music, fires
the page's `onReady` and conceals. Hovering it relays to the canvas, which
swaps to the `knapp3_mo` plate.

`level-load.js` composes the payload at worldReady (name, game type, map
type, objectives, both flag URLs — the report's briefing trio plus the page's
`teamNation`/`hudPaths`) and defers joining (`openDeploy()` / free-roam
capture) until READY through a `begin(..., onReady)` callback — the spawn
screen opens only after the click, which is also when pointer lock is a user
gesture. The screen always shows; a level whose con ships no briefing trio
shows it with empty boxes, the way the game does.

Non-goals: the single-player briefing screens (`setAlliedObjectives` and the
rest of `Menu/Init.con`) stay unread; the debriefing screens (`mp_debriefing`)
are not part of this; ESC does not dismiss the briefing (it does not in the
game either).

## Tasklist

- [x] Extract `mp_briefing.png` (chrome extractor) and publish to the volume.
- [x] Extract `trebuchet_ms18` / `trebuchet_ms11` (+ latin) into the hud
      pack's `fonts/`.
- [x] `viewer/bitmap-text.js`: shared glyph renderer (scale, tracking,
      outline) lifted from `deploy-screen.js`, which now imports it.
- [x] `viewer/briefing-screen.js`: the canvas screen (plate, faces, flags,
      knapp plates, settings constants), layout + paint + hover API.
- [x] `progress.js`: host the canvas, park on the briefing state at `end()`,
      READY hit area + hover relay, music fades on READY.
- [x] `level-load.js`: compose the payload at worldReady; defer join to
      `onReady`; flags are `flag_ticket_<nation>`.
- [x] `map.html`: create the briefing screen, hand it to the overlay, add
      `teamNation` + `hudPaths` to the level-load bag.
- [x] Update `tests/load_briefing_harness.mjs` / `test_load_briefing_js.py`
      (the harness stubs the module and pins the handshake; the pixels are
      the live pass).
- [x] Verify: node --check, harness tests, live browser pass (Wake: splash
      polls out, the dialog draws over the live scene with the game's faces,
      READY opens the spawn screen, no page errors), numeric A/B against the
      capture, publish the new pack files.

## Verification notes

The live pass loads `map.html?dev=1&map=wake`, polls out the loading bar,
screenshots the dialog, clicks READY and confirms the spawn screen opens and
the overlay hides. Numeric A/B against the capture, both sides reduced to
800x600 virtual units: title ink y 84.1 vs 83.8, mode baseline 154.5,
khaki bars 211..226 vs 210..229, body first line 236..? vs 237.9..246.2 at
pitch 11.7 — every measurable within a couple of px.
