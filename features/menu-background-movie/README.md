# Menu background movie

Status: built 2026-09-30. Assets extracted for vanilla, XPack1 and XPack2;
publishing them is the landing step (below).

## What was wrong

Reported as "the background movie does not load on Custom Game". It loaded on
no tab. `play.bfstats.io/play/` had no `<video>` and made no movie request on
any screen, the main menu included. Every tab painted the still
`menu/Texture/Menu/Background.tga` and nothing else.

Retail's `menu/Background` is the page every front-end screen is drawn over. It
holds the still and a `BfBinkNode` on the same 800x450 rect. The node is gated
on `PlayBink` and switched off while a game is running
(`Join/Disconnect/ShowDisconnect`). `extract_main_menu_layout.py` keeps the
still's rect and drops the node, because the layout reader has no schema for
it (MEME-11 lists `BfBinkNode` as unread). Nothing else in the viewer played
the movie.

The node names no file. The engine plays `Movies/background.bik` from the
mod's directory: 320x180, 25 fps, no audio, 75.7 s. Vanilla, XPack1 and XPack2
each ship their own.

## What was built

- `tools/bf1942-models/extract_menu_movie.py` finds `Movies/background.bik`
  along each mod's `game.addModPath` chain, nearest first, the same way
  `extract_menu_music.py` finds the menu music. It writes a silent VP9 WebM at
  the movie's own size to `<maps>/_shared/movies/background.webm`. That is
  about 0.5 MB per mod. It uses VP9 rather than H.264 because headless Chromium
  decodes no proprietary codecs.
- `viewer/play/menu-movie.js` holds one muted, looping `<video>` for the whole
  page. `menu-pack.js` returns the playing frame instead of the `background`
  plate and repaints on every new frame. Every tab that draws
  `menu/Background` therefore shows the movie: Instant Battle, MULTIPLAY,
  OPTIONS, CUSTOM GAME and REPLAY. The movie keeps its place when you switch
  tabs, as it does in retail. The still shows until the first frame decodes,
  and it also shows when the file is missing or the browser cannot play it.
- `skirmish.js` has a `movie` option, and only `play/index.html` sets it.
  `map.html`'s Esc menu never starts the movie, matching the engine's
  in-game gate. The movie follows the active mod the way the menu music does.
  A mod with no extracted movie keeps its own still. Vanilla's movie is never
  borrowed, because it would play over that mod's art.

## How it was checked

`movie-check.cjs` is a Playwright script (headless Chromium, 1024x768). It
takes two samples 2 s apart on each tab. `plate` is a pixel sum over a strip of
the plate's rect, so it shows whether the picture moves.

| Where | videos | readyState | currentTime | frames in 2 s | plate changes |
|---|---|---|---|---|---|
| Live site, main menu | 0 | - | - | - | no |
| Live site, Custom Game | 0 | - | - | - | no |
| Worktree, main menu | 1 | 4 | 3.96 -> 5.97 | 51 | yes |
| Worktree, Custom Game | 1 | 4 | 7.48 -> 9.49 | 50 | yes |
| Worktree, Custom Game after picking XPack1 | 1 | 4 | 2.48 -> 4.49 (xpack1's file) | 50 | yes |
| Worktree, back to main menu | 1 | 4 | 5.49 -> 7.50 | 50 | yes |

`tests/test_extract_menu_movie.py` pins two things: the lookup along the mod
chain, and the path the front end reads.

## Landing

The WebMs are volume assets, not git. Publish
`maps/_shared/movies/background.webm` and
`maps/mods/{xpack1,xpack2}/_shared/movies/background.webm` with
`scripts/publish-mesh-delta.py`. Until they are live, the front end draws the
still as before.

## Open

- The other mods (DC, DC Final, FHSW, EoD, bf1918 and the rest) ship their own
  `background.bik` but are outside extraction scope. They keep their stills.
  Running `extract_menu_movie.py --mod <id>` adds one.
- Safari older than 17.4 on iOS plays no WebM, so it keeps the still.
