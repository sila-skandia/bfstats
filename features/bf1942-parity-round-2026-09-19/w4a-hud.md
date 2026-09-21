# W4-A — HUD wiring: seat dots and kit labels

Two features, both wiring (no extraction of new geometry). The shared asset
trees already carry the data; this stream feeds it.

## 1. Seat-occupancy dots: live per-vehicle occupancy

### What is now true

The six seat-occupancy dots on the vehicle HUD show **who is in which seat**,
not just "you versus not you". The states are the engine's own five (VHUD-2,
`BfOccupiedVehicleData`, vtable `0x0093f300` read as raw bytes):

| state | icon | meaning |
|---|---|---|
| 0 | (none) | draws nothing — the seat has no `setVehicleIconPos` in its extract |
| 1 | `Icon_vehicledot_local.tga` | the seat the local player sits in |
| 2 | `Icon_vehicledot_empty.tga` | a declared seat nobody sits in |
| 3 | `Icon_vehicledot_friend.tga` | a seat a player of the local team sits in |
| 4 | `Icon_vehicledot_enemy.tga` | a seat a player of the other team sits in |

Before this stream the viewer could only reach states 0, 1 and 2: the local
seat was 1 and every other declared seat was 2, because a single-player page
has no other occupants. States 3 and 4 need a second occupant, which only a
room provides. This stream feeds the room's other players into the dots.

### How it is wired

- **`viewer/seat-dots.js`** (new, pure, no `three` import) owns the state
  resolution: `resolveSeatDots({ iconPos, localSeat, occupants, localTeam })`
  returns the six `{ state, x, y }` entries. Precedence per slot: no position
  beats everything (state 0); the local player's own seat beats any occupant
  row naming the same seat; of several occupant rows on one seat the first
  wins. Driven under node by `tests/seat_dots_harness.mjs`.
- **`viewer/seats.js`** `VehicleOccupancy.seatDots(occupants, localTeam)` now
  takes the room's other occupants as `{ seat, team }` rows (in the
  occupancy's own position numbering) and always returns the layout's six
  slots, delegating to `seat-dots.js`.
- **`viewer/map.html`** `feedSeatDots()` gathers the room's other players
  seated in the local player's vehicle — the snapshot's `seatIndex` is the
  position index, the roster's team decides friend from enemy — and re-asks
  every frame. A room player can climb into or out of the vehicle at any
  moment; the feed's state-signature memo makes the steady state a single
  string compare. The room table id of the occupied vehicle is cached on entry
  and computed lazily (entry can happen before the first snapshot lands, and
  `netVehicleIdFor` needs a pose to match against).

### Proof

Headless, over a scripted room socket with the real wire encoding
(`/tmp/w4a-hud/seatdots.mjs`): a Sherman driver reads `[1,2,0,0,0,0]` alone,
`[1,3,0,0,0,0]` with a same-team player in the hull gunner's seat,
`[1,4,0,0,0,0]` with the other team there, and back to `[1,2,0,0,0,0]` when
they leave. The local dot measures 394 texels on the HUD canvas at the fed
position.

### The one open claim

The **per-seat resolution rule** — local seat → 1, same-team occupant → 3,
enemy-team occupant → 4, nobody → 2 — is **inferred, not read**. The five
icon names (`local`/`empty`/`friend`/`enemy`) are the evidence and are the
only sensible mapping, but the client's per-seat state selector (the part of
VHUD-2 that actually needs the occupying player's team and identity) was not
read; the corpus defers it to `seats-and-entry-points.md`. The class is
`dice::meme::BfOccupiedVehicleData` (ctor `0x007dd8b0`, typeinfo at
`0x007dd630`); the 5-state table itself is confirmed. If a later stream reads
the selector and it differs, the fix is local to `seat-dots.js`.

## 2. Deploy-screen kit labels from `setKitName`

### What is now true

The five kit rows on the deploy screen are labelled from the **level's kit
for that row**, its own `ObjectTemplate.setKitName` lexicon key resolved
through the mod chain's lexicon — not from the page's own class words or the
menu's class strings. A mod re-points a row's kit (and its name) without
touching the menu, so the row says what THIS mod calls the kit.

### How it is wired

- **`bf42/con.py`** parses `setKitName <slot> "<KEY>"` (same shape as
  `setKitIcon`: an authored index and a quoted token) into `kit_name`, kept
  raw — the token is a lexicon key, not a display string. `setKitActiveName`
  is not read (the deploy screen labels the row, not the highlight).
- **`extract_loadouts.py`** resolves the key through the mod chain's merged
  lexicon (`load_chain_lexicon` over `MenuSources.lexicon_paths` — the same
  call the SkirmishMenu titles make) and emits `kitName` as
  `{ index, key, text }`. `text` is null when the key is absent from the
  lexicon; the page falls back to its own layout's string.
- **`viewer/kit-icon.js`** `kitRowLabel(kitName, layoutText, classLabel)` is
  the pure fallback chain (node-tested). **`viewer/map.html`** `deployText`
  and the kit buttons' aria-labels share `kitRowLabelFor`, so the canvas and
  the accessibility tree say the same; the labels follow the deploy team
  (the level binds a different kit per side).

### Proof

Fresh scratch extractions (`/tmp/w4a-hud/out/`): vanilla's 35 bound kits
resolve to SCOUT/ASSAULT/ANTI-TANK/MEDIC/ENGINEER; EoD's 209 resolve through
EoD's own lexicon, which re-points `RESPAWN_SCOUT` at **Sniper** and titles
the rest Anti-Tank/Medic/Engineer/Rifleman/Machine Gunner/Advisor/Pilot.
Headless (`/tmp/w4a-hud/kitlabels.mjs`): vanilla Wake reads
SCOUT/ASSAULT/ANTI-TANK/MEDIC/ENGINEER off the US kits; EoD
`abandoned_field` reads Rifleman/Machine Gunner/Sniper/Anti-Tank/Engineer off
the SpecialForces kits — and the drawn antitank-row label diffs 1404 px
between the two pages (same plate, different text).

## Tests

`python3 -m unittest discover -s tests` from `tools/bf1942-models`: green.
New: `tests/test_seat_dots.py` (14), three `test_seats.py` occupant cases,
two `test_con.py` `setKitName` cases, three `test_extract_loadouts.py`
`kitName` cases, seven `test_kit_icon_js.py` `kitRowLabel` cases.
`test_world.py` and `test_mouse_input.py` copy `seat-dots.js` alongside
`seats.js` (its new import).
