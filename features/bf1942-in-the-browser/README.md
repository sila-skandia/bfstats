# BF1942 in the browser

A site for playing the extracted levels, separate from the mesh model browser.
Requested 2026-09-19. Tracked in
[`../bf1942-parity-round-2026-09-19/README.md`](../bf1942-parity-round-2026-09-19/README.md),
streams A and B.

## What was asked

1. **Separate the maps from the mesh site.** `mesh.bfstats.io` stays the model,
   pose and kit browser. The playable map page moves to a site of its own, which
   will later grow a multiplayer battle.
2. **The way in is the game's own menu.** For now that is Singleplayer >
   Instant Battle: pick a level, pick a team, start. Drawn from the game's
   assets, the way the spawn screen already is.
3. **Hide the debug options** on the map page (wireframe, spawn on foot, fly the
   plane and the rest). They are for debugging. Typing `show.dev = 1` into the
   console brings them back.
4. **The console**, on the tilde key, reconstructed from the binary. It does not
   exist in the viewer yet.

## The Instant Battle screen, from the user's capture

The agents cannot see the capture, so this is what it shows.

- A dark olive, faintly camouflaged background.
- Three panels, each a light grey bevelled plate with rounded corners:
  - **Top left, the preview.** A screenshot of the selected level inside the
    plate, with the two sides' flags in its top corners: the Allied nation's on
    the left (the US flag), the Axis nation's on the right (the Japanese rising
    sun), each about 90 px wide on a 600 px wide plate.
  - **Bottom left, `LEVELS`.** The heading in black, wide-spaced capitals on the
    plate. Below it a near-black list box holding the level titles in pale grey
    capitals in the same wide face, left-aligned with an indent: BATTLE OF
    BRITAIN, BATTLE OF MIDWAY, BATTLE OF THE BULGE, BERLIN, BOCAGE, EL ALAMEIN,
    GAZALA, GUADALCANAL, IWO JIMA, KHARKOV, KURSK, and on below the fold. Eleven
    rows show. A scroll bar on the right: up and down arrow buttons, and a white
    thumb about half the track tall.
  - **Right, `TEAM`.** Same heading style. A two-row list box: `AXIS` and
    `ALLIED`. The hovered or selected row is filled olive green across its full
    width.
- The game's arrow cursor.

The titles are alphabetical by display name, and "Battle of Midway" shows the
list uses lexicon titles, not directory names (`midway`).

## Where it lives in the game

Found by `strings` on `Mods/bf1942/Archives/menu.rfa`:

| What | Entry |
|---|---|
| The screen's layout | `menu/SkirmishMenu` and `menu/SkirmishNavigation` (binary `MemeFile 2.0`; reader `bf42/meme.py`) |
| How you get there | `menu/MainNavigationSingleplayer`, `menu/SingleplayerNavigation` |
| Plates | `menu/Texture/Menu/menu_singlepl_levellist_256x256.dds`, `menu_campaign_team_256x128.dds`, `singleplayer/menu_skirmish_tab_256x32.dds`; buttons and scroll controls under `Menu/buttons/` and `Menu/knapp*` (names are Swedish: *knapp* button, *pil* arrow, *upp/ner* up/down) |
| Strings | `lexiconAll.dat` (UTF-16LE; `extract_spawn_layout.py` already resolves keys) |
| Fonts | `Font.rfa`, the `.dif` + `.tga` pairs; `bf42/font.py` |
| Level previews | each level's own menu art; `extract_loading_assets.py` and the `bf1942-map-images` skill already cover thumbnails |
| Which flag a side flies | the level's `Init.con` team nations, already in `scene.json` |

`extract_spawn_layout.py`'s `Flattener` is the thing to extend, not rewrite. The
front-end list-box class (`BfNewListBoxNode`) is one of the classes ledger row
MEME-11 says `meme.py` still reads 57 bytes short, so expect to fix the reader
before the layout comes out clean.

In the real game Instant Battle loads a level's `SinglePlayer` layout with
bots. The viewer extracts Conquest only, so the first version launches Conquest.

## The console, from the user's capture

Taken at 2000x1124 with the console open over the spawn view on Wake.

- It covers the full width and the top 39% of the screen (442 of 1124 px) as a
  flat translucent white wash. The scene, and the HUD elements inside that band,
  show through it desaturated. There is no border and no title.
- Text sits at the bottom left of the band, growing upward, in a small black
  sans face quite unlike the HUD font (about 16 px cap-to-baseline line pitch 22
  px at this resolution).
- The lines, verbatim:

  ```
  Adding <skandia> (0) to buddylist
  > game.showHud
  Error  (2): game.showHud
  Error : Unknown object or method!
  >
  ```

  So a typed line is echoed with a `> ` prefix; an unknown command produces two
  lines, the first with a number in parentheses and two spaces after `Error`;
  the prompt is a bare `>`; and the game writes its own messages there too.

Everything else (the key, the drop animation, history, completion, how a line is
parsed, what the `(2)` counts) is for stream B to read out of the client.

## Deployment shape

`mesh.bfstats.io` is `deploy/app/mesh-deployment.yaml`: one nginx container,
`anskia/bfstats-mesh`, 16Mi requested and 64Mi limit, with `assets/mesh/models`
and `assets/mesh/maps` mounted from `bf42-stats-pvc-v2`. Routing is an HAProxy
host ACL in `deploy/app/ingress/deployment.yaml` plus a hostname in
`cloudflared-tunnel.yml`.

The new site is a second deployment of the same shape over the same two
subPaths, read-only, so no asset is copied and the memory budget moves by 64Mi.
Its image carries the menu page, `map.html` and the modules it imports, and not
the model, pose and kit browsers.

**Assumption to confirm:** the hostname. `play.bfstats.io` is used as a
placeholder in the files. DNS and the tunnel entry are the owner's to create,
and nothing here is applied by an agent.

## Open questions

- Whether the mesh site keeps a Maps tab that links out, or drops it.
- Whether the map page should start in the deploy screen on the chosen team
  (it does today for whichever team is first) or drop straight in.
