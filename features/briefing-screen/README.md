# The mission briefing screen (post-load, READY-gated)

The loading flow was one screen short of parity. In the game the fullscreen
splash (load picture, `menu_loading` plate, bar, music) is only the *first*
phase; when the level finishes loading a second screen appears over the live
3D scene: the mission briefing dialog — map name, the two team flags with
"VS", the game-type line, a settings block, the OBJECTIVES and COMMENTS
boxes, and a READY button. The loading music plays until the player clicks
READY. We had merged the briefing text into the splash itself; this feature
splits the two.

## The game's own data, and where each piece comes from

Measured against `image_bfe903.png` (Wake, stock game, 2558x1440) and the
menu archive:

* **The dialog plate** is `menu/Texture/Briefing/mp_briefing_512x512.dds`
  (`menu.rfa`): a smoky translucent plate, content in the top 512x334, with
  two rule lines under the title area and three inset dark bands (alpha 204,
  rgb ~42). Extracted to `maps/_shared/load/mp_briefing.png` by
  `extract_loading_assets.py`'s `extract_chrome`, next to `menu_loading.png`.
  Drawn 1:1 into the 800x600 stage at (144, 81): the screenshot's rules land
  on the texture's own rows at 1:1 (24-31 and 48-55 -> screen 105-112 and
  129-136), so the texture maps to the dialog with no scaling.
* **Title band** (texture rows 0-24): the map's display name. This is
  `maps.json`'s `loading.title` — `extract_loading_assets.py` already derives
  the canonical names ("WAKE ISLAND", "OPERATION BATTLEAXE", ...) the game
  shows, which match the chain lexicon's own records (`Wake` -> `WAKE
  ISLAND`). No scene.json change needed.
* **Flags row** (texture 31-48): the two sides' team-header flags,
  `icon_flag_<nation>.png` from the hud pack, nations from the page's
  `teamNation` (the same answer the deploy screen's team tabs use), "VS"
  between.
* **Game-type line** (texture 55-76): `CONQUEST - ASSAULT MAP` —
  `gameplayMode` upper-cased, dash, `briefing.mapType` (already resolved from
  `Menu/Init.con`'s `setMultiplayerBriefingMapType`).
* **Settings block** (dark band 1, texture 76-119): FRIENDLY FIRE /
  ALLOW NOSE CAM / TICKET RATIO. Server-side values, and the viewer *is* the
  server: the stock `Mods/bf1942/Settings/ServerSettings.con` defaults
  (`serverSoldierFriendlyFire 100`, `serverAllowNoseCam 1`,
  `serverTicketRatio 1000`) are what a local game shows — 100% / ON / 100%.
  Constants of the screen, carried in `progress.js` beside the markup.
* **OBJECTIVES / COMMENTS** (dark bands 2 and 3): khaki header bars
  (rgb ~132,125,76, sampled off the capture) drawn by code over the plate's
  dark bands, the objectives text from the report's `briefing.objectives`.
  COMMENTS is empty in multiplayer — the box is part of the screen.
* **READY** (row below the plate, screen y ~421-458): a full-width band with
  the plate's smoke, and the button itself is the game's own `knapp3_n` /
  `knapp3_mo` plates (128x128, already in the hud pack for the spawn screen
  footer), ~108x22 centred, white letter-spaced label.

## Flow change

`progress.js`'s `end()` no longer fades the overlay away on the authentic
placement: it flips the overlay to a `briefing` state — splash art and bar
hidden, overlay background transparent so the live scene shows through — and
waits. READY clicks fade the music and conceal. The `load.briefing(...)` data
painted on the splash before now fills the dialog instead; the splash is
clean again, as in the game.

`level-load.js` defers joining (`openDeploy()` / free-roam capture) until
READY through a `begin(..., onReady)` callback — the deploy screen opens
under the dialog only after the click, which is also when pointer lock is a
user gesture. The screen always shows; a level whose con ships no briefing
trio shows it with empty boxes, the way the game does.

Non-goals: the single-player briefing screens (`setAlliedObjectives` and the
rest of `Menu/Init.con`) stay unread; the debriefing screens (`mp_debriefing`)
are not part of this; ESC does not dismiss the briefing (it does not in the
game either).

## Tasklist

- [x] Extract `mp_briefing.png` (chrome extractor) and publish to the volume.
- [x] `progress.js`: briefing-screen markup/CSS in the scaled stage; `end()`
      switches to the briefing state on the authentic placement (corner
      unchanged); music fades on READY, not at end().
- [x] `level-load.js`: compose the screen payload (title, mode, flags,
      settings) at worldReady; defer join to `onReady`.
- [x] `map.html`: hand `teamNation` + `hudPaths` to the level-load bag.
- [x] Update `tests/load_briefing_harness.mjs` / `test_load_briefing_js.py`.
- [x] Verify: node --check, harness tests, live browser pass; publish the new
      pack asset.

## Verification notes

The live pass loads `map.html?dev=1&map=wake`, polls out the loading bar,
screenshots the dialog (name, flags, mode, settings, objectives from the
level's own `Menu/Init.con`), clicks READY and confirms the deploy screen
opens and the music stops. Layout numbers above are stage coordinates (800x600
virtual, scaled to the pane).
