# Report: package `round-rules` (WP4 CTF, WP6 round end)

Both pieces work in the page for every mod. Proven on DC Desert Shield CTF and vanilla Wake Conquest. The page needs no re-bake for either. The trees still need some extractions and a `scene.json` patch before the flag meshes, medals and level lines appear live; until then the page falls back (no meshes, English titles, no level line). Commands are listed below.

## What was wrong
- **CTF:** `viewer/ctf.js` was imported only by its harness, so the page never drew a flag base or ran pick-up and capture.
  - `game-modes.js` dropped `flagBases`, so `?mode=Ctf` never handed the bases on.
  - The CTF-1..8 rows the code cited had never been written. The same was true of ROUND-1..9, cited by `round-state.js` and `extract_menu_music.py`.
- **Round end:** `round.over` was set and nothing read it. The board always fed `GameStatusEndGame=false` and 0 rounds won, nothing played `win.mp3`/`lose.mp3`, and nothing restarted the round.
- **Two bugs found while reading the binary:**
  - `round-state.js` ended ObjectiveMode on tickets. The server ends only Conquest and Co-op on tickets (ROUND-2).
  - A CTF attack or defence was counted twice on the side's score.

## What I changed
- **Ledger:** CTF-1..10 and ROUND-1..9, read from lnxded and BF1942.exe with addresses, plus `symbols.json` entries. RADIO-12 is now marked built. The client side and minimap research (CTF-7's `+0xa9`, CTF-9, CTF-10) came from a background research agent; I checked its addresses before writing the rows.
- **Findings that shaped the build:**
  - Retail CTF has no bots: the server loads the AI for Co-op only (CTF-8). So bots keep their Conquest plan on a CTF layer, and the flag law treats them as players.
  - The debriefing is the level's own: a title by result and victory type, the level's `game.set<Side>Debriefing*` line, medals for the top three by score, and the win or lose cue once.
- **CTF:** a new `viewer/ctf-page.js` wires `ctf.js` into the page. It is not in my file list; I added it so `ctf.js` stays pure and harness-tested.
  - Draws the poles and cloths from the models tree and runs the law over the page's players.
  - Writes the lines in the mod's words and team colour, and plays the `CTF.ssc` voices.
  - Feeds the HUD carrier icon and draws the map's flag marks through a small hunk in `map-surfaces.js`.
  - In a room, `server/authority.mjs` runs the law and sends `ctf` rows, and `net-room.js` hands them to the page's copy.
- **Round end:** a new `viewer/round-end.js` shows the debriefing over the score board, held up and without its buttons.
  - Shows the medals, plays the cue (`page-audio.js`) and counts down.
  - Then `restartRound` in `map.html` runs: bots back on their flags, the human to the spawn screen, points and flags home, `round.restart()` keeping the rounds won.
  - No bot thinks while the round is over.
  - New URL options: `?scoreLimit=`, `?gameTime=`, `?restartDelay=`.
- **Exporter:**
  - `bf42/level.py` + `scene_layers.py` write `scene.json` `briefing.debriefing`.
  - `extract_hud_pack.py` adds the medals, the debriefing plate and each side's `flag_<nation>` minimap icon.
  - `extract_radio.py` adds the STOLE/RETURNED/DROPPED verbs.
- **`map.html` hunks** are self-contained and stay clear of `buildHullDrive`. I also touched `test-hooks-world.js` (new hooks), `tests/page_source.py` and `tests/test_room.py`.

Commits (`git log --oneline 70d0b6ea..HEAD`): `33dcd1f0`, `112f3548`, `5c5492e8`, `283f867b`, `7a7f622a`, `ff33f68e`. The branch is clean.

## Tests
- **New:** `test_ctf_page`, `test_round_end`, `test_authority_ctf`.
- **Extended:** `test_ctf` (a whole round to a cap of three, with a replica fed only the events agreeing every frame), `test_round_state` (Wake run to zero with medals; ObjectiveMode), `test_scoreboard*`, `test_game_modes_js`, `test_level`.
- **Full suite:** 4627 tests, 1 failure, `test_nav_baked` Bocage route failures, 306 against a limit of 100. It is not mine: the same seeded match on the base commit's viewer gives the identical trace hash (`b1e2201fa596`), with the same 306 failures and 3 captures.
- **In the page** (port 5622, browser lock), script `~/.cache/dc-sweep/round-rules/ctf_page.cjs`, screenshots in `.../round-rules/shots/`:
  - **DC Desert Shield CTF:** a bot stole the US flag (line and voice), was killed, the flag dropped and the player returned it. The player then stole the Iraqi flag with the HUD icon up and captured it. The round ended as a Coalition MINOR VICTORY with DC's own line and the medals, and restarted 5 s later.
  - **Wake Conquest:** the Japanese ran out of tickets. TOTAL VICTORY with Wake's own line and the win cue, then the restart on 6/6 tickets with rounds won 0/1 and the spawn screen open.

## Commands for the lead
1. Run for each tree, then publish with `publish-mesh-delta.py maps --hash`:
   ```
   patch_scene.py --layer game --mod <M> --all
   ```
   This adds only `briefing.debriefing`; checked on copies of Wake, El Alamein and Desert Shield.
2. Run for each models tree (vanilla, DC, DC Final, XPack1, XPack2):
   ```
   extract_models.py --mod <M> FlagPole AnimatedGeFlag AnimatedUsFlag AnimatedUkFlag AnimatedJapFlag AnimatedSoFlag AnimatedCanFlag
   ```
   Add `AnimatedItFlag AnimatedFrFlag` for the XPack1 and XPack2 trees. Watch out for the subset run rewriting `models.json`. The textures are already in the shared store.
3. `extract_hud_pack.py --mod <M>`, then rebuild the mod packs' `pack.json`.
4. `extract_radio.py --mod <M> --layout-only --out <tree>/_shared/hud`.

## Still open
- Rooms load only a level's default layer, so no room plays CTF yet, though the server and client halves are built and tested.
- My own choices where the game was not read: a carried flag hangs 2.9 m over its carrier, the cloth does not wave (the models tree has no `FlagBlow` clip), and a dropped flag stands upright instead of on the terrain's normal.
- The debriefing's exact placement: `menu/LoadMenu`'s text nodes are not read by the flattener yet, so the plate is laid out by hand.
- Not built: ticket blink, the `+0x473` time-limit override, ObjectiveMode's real end, and hulls going back to their pads on restart.
- **For other packages:** `ghidra-cloud/ghidra_label.py` still labels `0x006E4290` as `Player__setAliveState`. It is the CTF flag event; `symbols.json` now notes the conflict.

The lead should update `features/desert-combat-parity/README.md`: item 18 / WP4 CTF and H10 / WP6 round end are built. They show live once the commands above have run.