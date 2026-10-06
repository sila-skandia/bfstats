# Capture the Flag

Status: built 2026-10-06 (Desert Combat parity round, package `round-rules`).
The law is the Linux server's, read in full (ledger CTF-1..CTF-10). The page
plays it on any level whose CTF layer it opens (`?mode=Ctf`), vanilla and
every mod alike: 13 vanilla levels, 25 Desert Combat 0.7 levels (24 with two
bases), 37 in DC Final, 19 Road to Rome and 20 Secret Weapons levels carry a
CTF layer with flag bases.

## What retail does

The engine's side is ledger section "Capture the Flag" (CTF-1..CTF-10). In
short:

- Each side's `FlagBase` raises its flag at the base plus `setFlagLocation`
  and gives it the base's team (CTF-1).
- While a base's own flag is home, a carrier of its team on foot inside its
  radius captures (CTF-2), and then the nearest enemy soldier inside the
  radius steals the home flag (CTF-3). A carrier whose own flag is away
  cannot capture.
- A flag on the ground returns by itself after `TimeToReSpawn` (30 s), is
  returned by the nearest living soldier of its own team inside its radius,
  or is picked up by the nearest living enemy (CTF-4). A dead carrier's flag
  falls at the terrain under him plus 1.5 m, its up axis the terrain's normal
  (CTF-5).
- A capture pays the table's `capture` and one flag capture to the side, a
  steal an Attack, a return a Defence. With `game.serverScoreLimit` set, the
  first side to that many flag captures wins, victory type 1 (CTF-6). With no
  limit, CTF ends only on the time limit, by team score (ROUND-3). The shipped
  `ServerSettings.con` sets both to 0, so the page's default CTF round never
  ends: `?scoreLimit=` and `?gameTime=` set them.
- The client writes a game-information line in the actor's side colour and
  word and plays `CTF.ssc` patch 0..5 in the local side's language. A drop is
  a line only when the carrier is dead, and plays nothing (CTF-7).
- The HUD shows `icon_ctf` and the flag the LOCAL player carries (CTF-9). The
  map draws every flag of a side in that side's soldier minimap icon, wherever
  it is (CTF-10).
- There are no CTF bots in retail: the server loads the AI for Co-op only
  (CTF-8).

## What was built

| Piece | File | Ledger |
|---|---|---|
| The law, pure | `viewer/ctf.js`: `createCtf`, `tick`, `applyEvent`, `follow`, `ctfLine`, `ctfPatch` | CTF-1..CTF-7 |
| The layer's bases | `viewer/game-modes.js`: `flagBases` is a mode key | |
| The page | `viewer/ctf-page.js`, wired in `map.html` (`simulate`, `paintHud`, the map-surface and net-room bags) | CTF-7, CTF-9, CTF-10 |
| The map marks | `viewer/map-surfaces.js` `paintMap`, through `ctfMapMarks` | CTF-10 |
| The score and cap limit | `viewer/round-state.js` `flagScore`, `checkScoreLimit` | CTF-6, ROUND-4 |
| A room | `server/authority.mjs` runs the law and sends `ctf` rows; `server/room.mjs` puts the law's `snapshot` in HELLO; `viewer/netcode-client.js` carries a row's `kind`, `player` and `position` through; `viewer/net-room.js` hands them to the page, which applies the HELLO once and queues rows that arrive while its level loads | |
| The data | `bf42/ctf.py` (`scene.json.modes.Ctf.flagBases`, already in every tree); `extract_radio.py` adds the STOLE/RETURNED/DROPPED verbs to the chat strings; `extract_hud_pack.py` adds each side's `flag_<nation>` | |

The page draws each base with `FlagPole` and each flag with the vanilla
`Animated<Nation>Flag` bundle for its cloth geometry, from the mod's models
tree and then vanilla's. The level's own template name is tried first.

Choices the game was not read for:

- A carried flag hangs 2.9 m over its carrier. The server files the picked-up
  flag as an item of the carrier's soldier (`Item::handlePickup` to
  `BFSoldier::addItem`, which adds it to his weapon list); where the client
  draws that item was not read.
- The cloth is the skin's bind pose turned the way the level bakes' `Bone01`
  turns it, so it does not wave. The `FlagBlow` clip lives on the level bakes'
  control-point rigs, not on the models tree's flag.
- A dropped flag tilts to the heightfield's normal (CTF-5) but keeps its
  pole's heading. Retail keeps the dead carrier's right axis, which the law
  does not carry.
- The carrier's own map mark is the flag icon drawn over his ring, where
  retail replaces his soldier icon with it.

Bots keep their Conquest plan on a CTF layer, because retail has no CTF bot
to copy (CTF-8). The law treats them as players, so a bot that walks
through a base steals or captures like anyone.

## How it was checked

- `tests/test_ctf.py` (`ctf_harness.mjs`): the law case by case, and a whole
  round to a cap limit of three. The round ends on the third capture, nothing
  scores after it, the restart keeps the rounds won, and a replica fed only
  the events agrees every frame.
- `tests/test_ctf_page.py` (`ctf_page_harness.mjs`): `ctf-page.js` under node
  on Desert Shield's bases. It checks the models it asks for, a steal, a
  steal, a death drop, a return and a capture with their lines in the mod's
  words, the carrier icon, the map marks, the end of the round stopping the
  law, a room's rows, and a Conquest level tearing it all down.
- `tests/test_authority_ctf.py`: the room authority sends one `ctf` row per
  event, and a client on the rows alone holds the server's flags every tick.
  So does a client that joins mid-round from the law's snapshot.
- `tests/test_netcode_client.py`: a `ctf` row comes out of the room client
  with its kind, actor and position (review 2026-10-07: the client used to
  strip them, so no room client applied a single row).
- `tests/test_room.py`: a CTF room's HELLO carries where each flag is.
- `tests/test_game_modes_js.py`: only the Ctf layer brings `flagBases`.
- In the page, on DC Desert Shield `?mode=Ctf&scoreLimit=1&botCount=2`, run
  with `~/.cache/dc-sweep/round-rules/ctf_page.cjs`. The scratch flag models,
  medals and patched `scene.json` were served by `page.route`. The page:
  - drew both flags on their poles;
  - let an Iraqi bot placed on the US base steal the US flag (line and
    `AxisStoleFlag` voice);
  - dropped the flag when the bot was killed, and returned it when the player
    walked over it;
  - let the player steal the Iraqi flag, with the HUD icon up, and capture it
    at home;
  - ended the round on the cap (Coalition, MINOR VICTORY), restarted 5 s
    later with the flags home and the rounds won kept, and opened the spawn
    screen.

## Assets the trees need

These are not in the live trees yet. The page runs without them, but draws no
flag meshes, and the HUD and map fall back as described.

1. The flag models, in each models tree (vanilla and every mod tree that
   plays CTF):
   `extract_models.py --mod <M> FlagPole AnimatedGeFlag AnimatedUsFlag AnimatedUkFlag AnimatedJapFlag AnimatedSoFlag AnimatedCanFlag`
   - Road to Rome's tree (and Secret Weapons', which inherits its levels)
     also needs `AnimatedItFlag AnimatedFrFlag`, from XPack1's
     `objects/Items/MoreFlags`.
   - Mind the subset run rewriting `models.json`.
   - Their textures are already in the shared store.
2. The CTF verbs in the chat strings:
   `extract_radio.py --mod <M> --layout-only --out <tree>/_shared/hud`.
   English is the fallback, and it is what every installed mod says anyway.
3. Each side's `flag_<nation>` map icon: `extract_hud_pack.py --mod <M>`, then
   the mod packs' `pack.json`.

## Open

- **Rooms play only a level's default layer.** `server/level-load.mjs` reads
  `scene.json` whole, so no room plays CTF until a room can be opened on a
  mode. The law, the rows and the client side are built and tested under
  node, not in a live room.
- **A room never ends its round for good or restarts it.** The authority's
  round goes to EndGame on the cap limit (or tickets in Conquest) and stays
  there: nothing scores and the CTF law stops. `restartRound` is the page's
  alone.
- **Ties at the base.** The engine picks the nearest thief before it asks
  whether he lives, so a dead body nearest the pole blocks a live thief that
  frame (CTF-3). Not modelled.
- **Unbuilt map details.** Bit 0 of a flag's `+4` hides it on the map, and
  the `TOOLTIP_CLOSE_TO_FLAG` hint exists (CTF-10). Neither is built.
- **The carried flag's attach point and the cloth's wave.** See above.
