---
name: bf1942-knowledge
description: >
  Map of what this repo knows about how retail Battlefield 1942 (the Refractor
  engine) behaves, where each answer lives, and which copy to trust when docs
  disagree. Use it before answering, researching or building anything that
  depends on the real game's behaviour, such as soldiers, weapons, damage,
  vehicles, aircraft, ships, seats, collision, bots, game modes, tickets,
  spawns, HUD, menus, sound, netcode, replays or file formats. Use it before
  opening Ghidra, because most questions are already settled. Use it when
  recording an engine finding or adding a BF1942 feature folder.
---

# BF1942 knowledge map

The repo's knowledge of the retail game lives in one research corpus, one folder
of early studies and about 100 feature folders. This page says where each
topic's answer is and which copy wins when two disagree.

## Which copy wins

| Source | What it holds | Trust it for |
|---|---|---|
| `features/bf1942-engine-reference/ledger.md` | One row per claim about the engine, with a status and the binary address that proves it | What the engine does. The row's status is the verdict |
| `features/bf1942-engine-reference/subsystems/*.md` | One narrative per subsystem, written from ledger rows | How the rows fit together |
| `features/bf1942-3d-models/*.md` | The first studies of each topic, most written 10 to 17 September | Game data and leads. A later ledger row overrules them |
| `features/<feature>/` | What the viewer or pipeline built, how it was checked, what is open | What we built. Its engine claims count only where it cites a ledger row |
| `tools/bf1942-models/` | The code. The module docstrings in `bf42/*.py` are the format specs | What is built today |

For engine behaviour, a ledger row beats a subsystem note, which beats a feature
doc, which beats a code comment. The exception is a later dated reading that
names a row and disagrees with it without editing the ledger. Section 15 of
`round-replay-capture` does this to P-2. Treat such a question as open.

For whether something is built, git and the code beat every doc. Status text is
written once and rarely revisited. That covers the "Start here" rows of the
engine-reference README, the "Where" cell of a ledger row and the `Status:` line
of a feature README. Check `git log -- <path>` or grep the code before you
repeat one.

Feature docs grow by appending, so a later section can overturn an earlier one
in the same file. Read the summary at the top and the newest dated section
before the middle.

Dated folders (`*-2026-09-NN`) and `bf1942-3d-models/parity-audit/` are
snapshots of their day.

The ledger keeps refuted rows and strikes them through. A refuted row answers
the question with "no".

Some verified findings never made it into the ledger and live only in a build
record's "Ledger rows to integrate" section. When the ledger has nothing on a
symbol, grep `features/` for it before deciding nobody has read it.

## Looking something up

1. Find the topic in the table below. It names the ledger prefixes and the
   subsystem note.
2. Grep the ledger. Never read it whole. It is 660 KB, about 165k tokens.

   ```bash
   L=features/bf1942-engine-reference/ledger.md
   grep -n '^## ' $L                      # the sections, dated
   grep -n '^| PARA-' $L                  # every row of one prefix
   grep -n -i 'lastCollisionHeight' $L    # a field, a word, an address
   ```

   `xref.py sym` looks up a function or class by name or address and prints its
   confidence and ledger row. It reads `symbols.json` and needs no Ghidra.

   ```bash
   features/bf1942-engine-reference/xref.py sym setIsParachuting
   features/bf1942-engine-reference/xref.py sym 0x0827d3b0
   ```

3. Read the subsystem note. Then read the build record for what the viewer does
   and what is open.
4. For a topic the table does not name, `features/README.md` has one line per
   feature folder.
5. Search with `git grep` or the Grep tool. A plain `grep -r` also walks the
   worktrees under `.claude/worktrees/`, about 27 of them, and returns each hit
   once per worktree. The shell is zsh, so quote globs.
6. When nothing settles the question, read the binary.
   `.agents/skills/bf1942-map-player-investigation/SKILL.md` has the rules for
   doing that without inventing mechanics. The `bf1942-ghidra` skill and the
   engine-reference README's "How to use it" and "Traps that cost real time"
   have the method.

## Topic map

In this table `subsystems/` means `features/bf1942-engine-reference/subsystems/`,
`3d/` means `features/bf1942-3d-models/`, and a bare name is a folder in
`features/`. Ledger prefixes are in backticks.

| Topic | Engine side | Built, and what is open |
|---|---|---|
| Archives and file formats (.rfa, .sm, .ske, .skn, .baf, .dds, .con, MemeFile) | `SM` `BAF` `RFA` `TM` `MEME`; subsystems/standardmesh-vertex-format.md; `include/bf42_geom_stdmesh.h`; the docstrings in `tools/bf1942-models/bf42/*.py` | bf1942-3d-models (README, extraction-rollout.md); skill `bf1942-mod-extraction` sections 1 to 7 |
| Level bakes and publishing; terrain patches and Tx tiles | `TERR` | level-bake-layers says which change needs which re-bake; terrain-tile-grid, mesh-asset-size, mesh-lod-chains, mesh-mod-assets, pose-asset-dedup, mesh-site; skill `bfstats-mesh-assets` |
| Rendering: lighting, lightmaps, env maps, fog, water, foliage; which LodObject alternative draws, and the cockpit swap | `DL` `LM` `EM` `FOG` `LOD`; 3d/rendering-technology.md, 3d/envmap-materials.md | mesh-viewer-fidelity-defects, tree-foliage-billboards, mesh-viewer-neutral-depth, bf1942-cockpit-graft-hosts |
| Soldier movement, stance, swimming, ladders | subsystems/physics.md; `PHY` `LOOP` `BODY` `LADDER` | viewer-swimming, ladder-climbing, viewer-soldier-stance-and-blast, playable-map-death-and-prone, 3d/first-person-soldier.md |
| Soldier animation, deaths, IK | `ANIM` `BODY` `DIE` `IK`; subsystems/skeleton-ik.md; `bf42/baf.py`, `bf42/animstates.py` | soldier-locomotion-animation, bot-body-animation, soldier-death-animations, 3d/parity-audit/animation.md (a snapshot) |
| Cameras: first and third person, shake, zoom, mouse | subsystems/handweapon-view-and-deviation.md; `VIEW` `CS` `CAM` `ZOOM` `MLK` | viewer-soldier-camera, viewer-foot-first-person, viewer-third-person-soldier, bf1942-camera-pivot, vehicle-camera-toggle-sweep, pilot-mouse-look, bf1942-mouse-input |
| Hand weapons: deviation, grip, grenades, kits, a kit's `Random*` rolls | subsystems/handweapon-view-and-deviation.md; `DEV` `GL` `FA` `KITDROP` `KIT` | grenade-viewmodel-and-throw, kit-drops, fhsw-random-kit-items, 3d/kits.md, 3d/kit-loadouts.md, 3d/weapon-grip.md |
| Projectiles, impacts, explosions; a rocket's own motor and drag | subsystems/projectiles-and-impacts.md, subsystems/physics.md section 5; `IMP` `SPR` `EMT` `CRD` `PROX` `KNOCK`, PHY-18..PHY-22 | rocket-flight, flak-proximity-fuse, muzzle-effects-parity, bf1942-blast-and-bounce, 3d/impact-effects.md, 3d/projectile-collision.md, 3d/firing-effects.md |
| Damage, hit points, armour, fall damage, friendly fire | subsystems/hitpoints-and-damage.md; `HP` `DMG` `ARM` `FF` | damage-parity, viewer-collision-damage, bot-friendly-fire, vehicle-rounds-hit-soldiers; 3d/fall-damage-research-groundwork-2026-09-17.md predates PARA-10 |
| Parachute and free fall | `PARA` | viewer-parachute, where section 0 overrules sections 4 and 5 |
| Tanks and ground vehicles: drivetrain, steering | subsystems/tank-driving.md; `TANK`; an Engine's axis never poses it, PHY-15 | 3d/ground-vehicles.md, viewer-ground-hull-collision, articulated-hull-collision, engine-axis-poses-nothing |
| Aircraft | `MLK`; the flight law is AI-60; helicopters and lift jets (engines off the nose) are PHY-12..PHY-14 and subsystems/physics.md §5 | flyable-vehicles (helicopters.md for the helicopters), pilot-mouse-look, bf1942-cockpit-graft-hosts, bf109-cockpit-and-vehicle-gun-audio |
| Ships, boats, floating, carriers | `PHY-3`; the SHIP and SPAWN rows in section 10 of bf1942-ships-research-2026-09-22 | bf1942-ships-research-2026-09-22, viewer-ships, carrier-destroyer-parity, maps-viewer-drivable-decks-and-reload-sound |
| Bombs and torpedoes | subsystems/bombs-and-torpedoes.md; `BOMB` | plane-bombs-and-torpedoes: README.md is the design, BUILD.md what was built |
| Seats, entry, manned guns | subsystems/seats-and-entry-points.md, subsystems/manned-guns.md; `SEAT` `CVM` `GUN` | bf1942-seat-defects-2026-09-20, vehicle-entry-team-rule, teamonvehicle-is-a-bool, 3d/seats-and-manned-guns.md, 3d/vehicle-occupant-pose-plan.md |
| Artillery spotting: binocular markers, `artPos` seats, the scout-camera view (mode 17) | `SPOT` | artillery-spotting |
| Collision: rigid bodies, statics, barbed wire | subsystems/collision-response.md, whose "Still open" table is the research queue; `COL` `OBS` | vehicle-collision-physics, sphere-sweep-plate-edges, barbed-wire-parity, viewer-ground-hull-collision |
| Bots and AI | `AI`, 133 rows. The model is bf1942-ai-research-2026-09-21: README, bot-movement-and-pathfinding.md, bot-behaviours.md | bf1942-ai-spec (KNOBS.md lists every knob and its source), the `bot-*` folders, instant-battle-bot-settings, twelve-bot-performance-sweep |
| Game modes, tickets, control points, combat area | subsystems/combat-area.md; `TKT` `CA` `SIDE` | bf1942-map-player-capture has the capture rules, read from the server; map-dossier, mode-script-statics, viewer-score-and-bleed, 3d/game-modes.md, 3d/tickets-hud.md |
| Spawns and the deploy screen; vehicle pads (`ObjectSpawner`) and the objects that carry spawns | `SPAWNGRP` `SPAWN` | authentic-spawn-map, deploy-screen-spawn-points, vehicle-spawner-pads, dc-mortar-and-kit-pads, viewer-demolitions-and-spawn-safety, 3d/spawn-points.md |
| Supply depots, healing, repair | subsystems/supply-depots.md; `SUP` | viewer-healing-packs, 3d/supply-and-health.md |
| HUD, scoreboard, minimap, crosshair | subsystems/ingame-hud.md; `HUD` `VHUD` `XHIT` `HFD` `MMAP` | crosshair-hit-marks, hit-direction-wash, minimap-friendly-arrows, hud-text-baseline-and-minimap-size, scoreboard-row-colour-and-alignment, round-end-winner-screen, 3d/in-game-hud.md, 3d/map-hud.md, 3d/minimap-and-fullmap.md |
| Menus, console, fonts, strings, radio and chat | subsystems/console.md; `MEME` `CON` `FONT`; the radio's messages, voice patches, languages and the side's announcer are `RADIO` | bf1942-in-the-browser (README, console.md), multiplay-front-end, briefing-screen, radio-and-chat-log, viewer-profile-controls; skill `bf1942-mod-extraction` section 10 for where the art lives |
| Sound | `SND` `SSC`; what triggers each slot and part is SND-12..SND-23 | vehicle-sound-coverage (D11 for part sounds), hand-weapon-sound-edges, world-vehicle-audio, ambient-sound-parity, sound-listener-parity, bf109-cockpit-and-vehicle-gun-audio, 3d/map-sounds.md, 3d/building-ambience.md; read skill `bf1942-mod-extraction` section 11 before touching any gun or engine sound |
| Netcode | subsystems/netcode.md; `W` `D` `J` `P` `R`. What one client is sent, and how far, is section 19 of round-replay-capture | netcode-play-multiplayer, the browser game's own design |
| Recording and replay | | round-replay-capture holds the recorder and its format; round-replay-merge, round-replay-fidelity, the other `round-replay-*` and `replay-*` folders; gameplay-recordings for publishing a recording |
| Checking against the real game | | parity-lab and skill `bf1942-server-lab`; bf1942-parity-round-2026-09-19 is the live open list; bf1942-corpus-sweep-2026-09-18 |
| Game data on the stats site | | map-dossier, service-record, bf1942-map-thumbnails, wrapped-music |
| Performance | | mesh-viewer-performance, bot-fight-performance, replay-performance, twelve-bot-performance-sweep; `tools/bf1942-models/tests/perf/README.md` |

`features/bf1942-in-the-browser/how-it-works.md` explains the whole pipeline in
one page: how the game's files become web files, and how a round is recorded.

## Recording what you learn

Engine behaviour goes in the ledger. Add a row to its section with the next free
ID of the prefix, a status and the address that proves it. Record symbols with
`xref.py add`, then update the subsystem note. Change a status in place. When a
claim is overturned, strike it through and say what overturned it. Never delete
a row.

What you built goes in the feature folder's README: what it does, how you
checked it and what is open. Cite ledger IDs instead of restating engine facts,
because every restated copy is one more place to go stale.

When you land work, update every status line that names it. That means the
engine-reference README row, the "Where" cell of the ledger row and the feature
README's status line.

A new feature folder needs a line in `features/README.md`.
`tools/bf1942-models/tests/test_features_catalogue.py` fails until it has one.
Add a row to the topic map here if the folder opens a new topic.

## Other BF1942 skills

| Need | Where |
|---|---|
| Read the binary with Ghidra, lnxded or the x87 emulator | skill `bf1942-ghidra`; the engine-reference README's "How to use it" |
| Investigate a gameplay mechanic without inventing it | `.agents/skills/bf1942-map-player-investigation/SKILL.md` |
| Archives, formats, mod inheritance, UI art, `.ssc` sound, map dossiers | skill `bf1942-mod-extraction`, file `.agents/skills/bf1942-mod-extraction/SKILL.md` |
| The game archives in a cloud session | skill `bf1942-game-archives` |
| Record a real round with bots to compare against | skill `bf1942-server-lab` |
| Publish models and levels | skill `bfstats-mesh-assets`, `scripts/publish-mesh-delta.py` |
| Map thumbnails and minimaps | skill `bf1942-map-images` |
