# Forum signatures

The player and server signatures (the PNGs people put in forum sigs with
`[img]...[/img]`) are drawn from the mesh viewer's own models: a soldier,
tank or aircraft of the mod the player picks, posed mid-fight with the game's
animation clips, over that mod's loading-screen art. Before 2026-11-14 they were
four stock backdrops (player) and four abstract HUD styles (server).

## What a signature is

```
loading screen (graded dark, cool)  ->  mod-coloured slash  ->  hero art (right)
  ->  scanlines, hairline frame  ->  words (left)
```

- **Player** (`/stats/players/{name}/banner.png`): mod tag and scene caption,
  the name in gold, the server the stats are scoped to, then K/D, kills, score
  and hours.
- **Server** (`/stats/servers/{name}/banner.png`): name, LIVE / OFFLINE with the
  current map and mode, players (with a fill bar), live tickets and the join
  address. The backdrop is the loading screen of the map **the server is playing
  now**, and the mod defaults to the server's own (DC Final plays Desert Combat's
  art, FHSWEurope plays FHSW's).
- Query: `mod`, `scene`, `w` (320-1600, the height keeps 4:1), and for players
  `server` (a guid), for servers `tickets`. `GET /stats/signatures/catalogue`
  lists the mods and scenes; `/stats/signatures/art/{mod}/{scene}.webp` is one
  hero on its own (the builders' scene cards).
- Old links keep working: a player's `style=tank|plane|island|map` becomes the
  `armour|fighter|bomber|assault` scene; a server's `style=` is ignored and the
  server's own mod is used. Forum posts made before the change re-render in the
  new look under the same URL.

Adding or redrawing scenes: the `forum-signatures` skill (`.claude/skills/forum-signatures/SKILL.md`).

Code: `api/Signatures/` (catalogue, the shared `SignatureCanvas`), the two
layouts in `api/PlayerBanners/PlayerSignatureRenderer.cs` and
`api/ServerBanners/ServerSignatureRenderer.cs`. UI:
`ui/src/components/v4/MmSignatureArtPicker.vue` inside the two
`Mm*SignatureBuilder.vue`.

## The hero art

60 heroes across nine mods, 1.4 MB, shipped in the API image under
`api/Signatures/Art/<mod>/<scene>.webp` with `catalogue.json`. Nothing 3D runs
in production: the node is 4 cores shared with everything else, so the art is
rendered once, offline, and the API only composites.

```bash
python3 scripts/signatures/render_signature_art.py                 # all of it, ~4 min
python3 scripts/signatures/render_signature_art.py fh fh/armour    # a mod, a scene
python3 scripts/signatures/render_signature_art.py --sheet /tmp/s.png
```

- `scenes.json` is the catalogue: per mod its name, accent colour and scenes.
  A soldier scene names a **kit** (`Us_Assault`); the kit gives the soldier
  template, the primary weapon and the worn parts (helmet, packs), so a scene
  wears exactly what that kit wears in the game. The pose is a gait pair from
  the shared gait glbs: `run.lower+Ub_Fire` (run and gun), `lie.lower+Ub_LieFire`
  (prone fire), `crouch.lower+Ub_Fire` (launcher), `Lb_RunJump+Ub_RunJump` (the
  leap), at a time chosen from a contact sheet. A vehicle or plane scene names
  its glb, a camera, and the meshes the effects anchor to (`barrel`, `discs`
  for propellers and rotors, `bomb` for the projectile mesh to drop).
- `mesh_mirror.py` fetches what a scene needs from mesh.bfstats.io (read only)
  into `~/.cache/bfstats-signature-assets`, laid out like the viewer tree:
  glbs by their store sha, textures from the shared store (with the viewer's
  `?r=2` epoch, `viewer/texture-url.js`), recipes, gaits, kits.json and kit parts.
  This Mac's viewer tree holds only part of what is live.
- `scripts/render-game-sprite.mjs` draws each one. For stills it gained, with
  its defaults unchanged (the brass loader sprite still comes out byte for
  byte): `--rot` (bank a fighter, dive a Stuka), `--fit`, `--shading studio`
  (key, cool fill and rim light, normals faced to the camera), `--kit` (worn
  parts hung on bones A, backpack and HipPack exactly as `viewer/kit-graft.js`
  does), `--projectiles`, `--mark-extreme` (a muzzle as the furthest weapon
  vertex along a screen or world direction; a hub as a part's centre) and
  `--marks-json`.
- `fx.py` paints the effects from those anchors: muzzle flash, tracers,
  brass, a launcher's backblast and rocket, a tank's muzzle-brake blast and
  dust, propeller and rotor discs, speed lines, falling bombs (the plane's own
  projectile mesh, or another's when its own is a box: FHSW's B-25 drops the
  B-17's), blaster bolts for Galactic Conquest and a flamethrower for BF1918.
- Every hero faces left on the right of a 640x400 canvas; the words go left.

| Mod | Scenes |
|---|---|
| BF1942 | run and gun (BAR), prone DP, Panzerschreck, leap (Thompson), Tiger fires, Spitfire breaks, Stuka dives |
| Road to Rome | Breda, prone BAR, Italian AT, Sten leap, Grant fires (hull gun), Mosquito, Bf 110 drops |
| Secret Weapons | Commando Bren, Elite Gewehr 42, Commando bazooka, Elite leap, T95, Ho 229, AW-52 drops |
| Desert Combat | M16, prone PKM, RPG-7, spec ops leap, Abrams, F-16, Su-25 drops, Apache |
| Eve of Destruction | AK, prone M60, RPG-7, Patton, MiG-21, napalm run, Huey |
| Forgotten Hope | MP 40, prone Bren, Panzerschreck, Firefly, Fw 190, Il-2 drops |
| FHSW | Owen, prone Bren, bazooka, King Tiger, Zero, B-25 drops |
| Galactic Conquest | trooper, rebel prone, rebel launcher, AT-ST, X-wing, TIE bomber |
| BF1918 | over the top, MG 08/15, flamethrower, A7V, red Fokker, Gotha drops |

Adding a scene: a line in `scenes.json` with a `backdrop` level, render it,
look at the sheet, commit the webp and catalogue. `BannerRenderTests` fails if
a catalogue scene has no hero.

## Backdrops

The loading screens are the map-loading-art copies on the assets volume
(`features/map-loading-art`). Galactic Conquest and BF1918 had none; they were
built and published for this (163 files, 2026-11-14). Each scene names a level
of its own mod and theatre (the Firefly over Gold Beach, the X-wing over the
Death Star); a server uses its current map first.

## Checked

- `tests/api/BannerRenderTests.cs`: every scene's hero ships and is drawn on
  the right at 800x200; the server layout at 320 and 1600 wide; mod fallback
  by game id; the old style names. `SIGNATURE_PREVIEW_DIR=/tmp/x` keeps the
  PNGs (with `ASSETS_STORAGE_PATH` pointing at a copy of some loading screens
  they show the backdrop too).
- `ui/e2e/forum-signatures.spec.ts`: picking FHSW / King Tiger / Large puts
  `mod=fhsw&scene=armour` in the URL and the API answers 1280x320; a server
  opens on its own mod; old style links answer 200.

## Found on the way

- Cloudflare still holds year-long cached 404s for 11 BF1918 textures (the
  Fokkers, the Sopwiths, the A7V, the field guns) from before the 2026-11-13
  nginx fix. The volume has them and the viewer asks with `?r=2`, so pages are
  fine; anything that fetches `/textures/` without the epoch (as the mirror
  first did) still gets the 404.
- `test_menu_layout`'s Kasserine test needed every vanilla level archive; this
  Mac's install has no `Kasserine_Pass.rfa`, so it now skips a level the
  install lacks.
- `test_mod_pipeline`'s two FH-tree tests guarded only on `maps.json`; a
  machine with the published manifests but not the FH extraction (this Mac:
  40 of 799 glbs, levels without `scene.json`) failed them. They now skip
  unless the tree is whole.
