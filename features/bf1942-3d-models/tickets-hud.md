# Ticket Counters in scene.json (Spawn-Screen Parity)

**Status**: Implemented  
**Branch**: `parity/tickets`  
**Commit**: (pending)

## Summary

The mesh viewer's scene.json now carries ticket configuration for each level, parsed from the same `GameTypes/<mode>.con` files the tournament dossier script reads. The viewer can now display authentic ticket counters matching the in-game spawn screen.

## Schema

A new `tickets` field appears in `scene.json` when the level declares ticket data:

```json
{
  "tickets": {
    "mode": "Conquest",
    "team1": 100,
    "team2": 80,
    "lossPerMin": {
      "team1": 5,
      "team2": 30
    }
  }
}
```

### Field Specification

- **`mode`** (string): The gameplay mode the ticket config came from (e.g., "Conquest", "ObjectiveMode", "Ctf", "Tdm"). Falls back through `GAMEPLAY_MODES` if the level's primary mode has no ticket file.
- **`team1`** (integer, optional): Starting ticket count for team 1.
- **`team2`** (integer, optional): Starting ticket count for team 2.
- **`lossPerMin`** (object, optional): Per-minute ticket drain rates. Only present if at least one team declares a bleed rate.
  - **`team1`** (integer, optional): Team 1's ticket loss per minute.
  - **`team2`** (integer, optional): Team 2's ticket loss per minute.

**If a level declares no tickets, the `tickets` field is `null` or absent**, preserving compatibility with older scene.json consumers.

## Implementation

### Source Files

- **`tools/bf1942-models/bf42/level.py`**:
  - Added `TicketInfo` dataclass (team1/team2 tickets and loss rates).
  - Added `parse_tickets(text: str) -> TicketInfo`: parses `Game.setNumberOfTickets` and `Game.setTicketLostPerMin` from a `.con` file.
  - Added `load_tickets(files: LevelFiles, mode: str | None) -> TicketInfo | None`: reads the `GameTypes/<mode>.con` file and returns parsed ticket data, or None if absent.

- **`tools/bf1942-models/extract_map.py`**:
  - Added `load_tickets` import.
  - Integrated `load_tickets(files, info.gameplay.mode)` in `build_scene`.
  - Emits the `tickets` field in the `extras` dict returned by `build_scene`.

- **`tools/bf1942-models/tests/test_level.py`**:
  - Added `TicketParsingTests` with 8 test cases covering:
    - Basic ticket parsing (both teams, loss rates).
    - Float-to-int casting (dossier script compatibility).
    - Missing/partial data (one team, no bleed).
    - Case-insensitive command matching.
    - Comment handling (`rem` lines).
    - Malformed value soft-fail.

### Data Source

The extractor reads `GameTypes/<mode>.con` inside the level archive, where:

```con
Game.setNumberOfTickets <team> <count>
Game.setTicketLostPerMin <team> <rate>
```

These are the same commands `scripts/extract_map_dossiers.py` uses to populate tournament dossiers (`tickets` + `ticketLossPerMin` per team in the dossier JSON).

**Archive overlay is honored**: if `<level>_003.rfa` ships a `GameTypes/Conquest.con`, it overrides the base `<level>.rfa` file, and the extractor uses the patch values. Verified with Tobruk, where the base archive declares different tickets than the `_003` patch, and the scene.json correctly reflects the patch values.

## Verification

### Unit Tests

All tests pass:

```bash
$ python3 -m unittest tests.test_level.TicketParsingTests -v
test_case_insensitive_command_matching ... ok
test_comments_are_ignored ... ok
test_conquest_tickets_are_read_from_both_teams ... ok
test_decimal_tickets_are_cast_to_int ... ok
test_empty_file_yields_all_none ... ok
test_malformed_values_are_skipped_softly ... ok
test_missing_tickets_leave_fields_none ... ok
test_ticket_loss_per_minute_is_read ... ok

Ran 8 tests in 0.000s
OK
```

Full suite (1066 tests) remains green except for 4 pre-existing failures in `test_adversarial_loading_assets.py` unrelated to this change.

### Live Extraction

Extracted Tobruk and verified the scene.json carries the correct ticket data:

```json
"tickets": {
  "mode": "Conquest",
  "team1": 100,
  "team2": 80,
  "lossPerMin": {
    "team1": 5,
    "team2": 30
  }
}
```

**Source verification**: The values come from `Tobruk_003.rfa/GameTypes/Conquest.con`, lines:

```con
Game.setNumberOfTickets 2 80
Game.setNumberOfTickets 1 100
Game.setTicketLostPerMin 2 30
Game.setTicketLostPerMin 1 5
```

The base `Tobruk.rfa` archive declares different values (team1: 60, team2: 40, bleeds: 8, 50), but the patch correctly overrides them.

## Vanilla Census

**All 23 vanilla BF1942 levels declare ticket data in their Conquest mode.**

| Level                          | Mode     |  T1 |  T2 | Bleed1 | Bleed2 |
|--------------------------------|----------|----:|----:|-------:|-------:|
| Aberdeen                       | Conquest | 100 | 100 |     15 |     15 |
| Battle_of_Britain              | Conquest | 100 | 100 |      4 |   1000 |
| Battle_of_the_Bulge            | Conquest |  80 | 100 |     15 |     30 |
| Battleaxe                      | Conquest | 100 | 100 |      5 |      5 |
| Berlin                         | Conquest |  80 | 100 |     30 |      5 |
| Bocage                         | Conquest | 100 | 100 |      5 |      5 |
| Coral_sea                      | Conquest | 100 | 150 |     15 |      5 |
| El_Alamein                     | Conquest | 100 | 100 |      5 |      5 |
| Gazala                         | Conquest | 100 | 100 |      5 |      5 |
| GuadalCanal                    | Conquest | 100 | 100 |      5 |      5 |
| Invasion_of_the_Philippines    | Conquest | 110 |  90 |     10 |     35 |
| Iwo_Jima                       | Conquest | 100 | 100 |     30 |      5 |
| Kasserine_Pass                 | Conquest | 100 | 100 |     10 |     10 |
| Kharkov                        | Conquest | 100 | 100 |      5 |      5 |
| Kursk                          | Conquest | 100 | 100 |      5 |      5 |
| Liberation_of_Caen             | Conquest |  90 | 110 |      5 |      5 |
| Market_Garden                  | Conquest |  90 | 110 |      5 |      5 |
| Midway                         | Conquest | 100 | 100 |      5 |      5 |
| Omaha_Beach                    | Conquest |  80 | 120 |     30 |      5 |
| Stalingrad                     | Conquest | 100 | 100 |      5 |      5 |
| Tobruk                         | Conquest | 100 |  80 |      5 |     30 |
| Truk                           | Conquest | 100 | 100 |     10 |     10 |
| Wake                           | Conquest | 100 | 100 |      5 |     30 |

### Value Ranges

- **Team 1 starting tickets**: 80–110
- **Team 2 starting tickets**: 80–150
- **Team 1 bleed per minute**: 4–30
- **Team 2 bleed per minute**: 5–1000

**Note**: Battle_of_Britain's team 2 bleed rate of 1000/min is intentional — it's a time-limited assault scenario where the defending team's tickets drain rapidly.

## Design Notes

1. **Mode fallback**: `load_tickets` tries the level's primary gameplay mode first (from `info.gameplay.mode`), then falls back through the standard mode priority list (`Conquest`, `ObjectiveMode`, `Ctf`, `Tdm`, `CoOp`, `SinglePlayer`). This matches how `load_gameplay_objects` discovers control points.

2. **Honest source only**: If a level has no `GameTypes/*.con` file with ticket declarations, the `tickets` field is `null`. We do not invent or estimate values — ticket counts are server-configurable and not intrinsic to the level geometry.

3. **Compatibility**: Old scene.json consumers that don't expect the `tickets` field are unaffected — it's a new key at the top level, and JSON parsers ignore unknown fields.

4. **Viewer integration deferred**: This change delivers the data pipeline only. The actual HUD/counter rendering happens in `tools/bf1942-models/viewer/map.html`, which is **read-only for this agent**. The orchestrator will draw the ticket counters after merge.

## Future Work

- Other mods (Desert Combat, Forgotten Hope, etc.) may use different gameplay modes or alternate ticket mechanics — the parser is mode-agnostic and will handle them once their levels are extracted.
- Ticket counters are static in scene.json. Real-time simulation (bleed rate countdown) is a viewer concern, not an extractor concern.

## Related

- **Dossier script**: `scripts/extract_map_dossiers.py` (lines 658–661) parses the same commands for tournament intel.
- **Gameplay objects**: `bf42/level.py` ~line 758, `load_gameplay_objects` — ticket loading follows the same pattern.
- **Archive overlay**: `bf42/level.py` ~line 419, `LevelFiles` class — patch files override base files in the merged view.

---

# Drawn (2026-09-19, stream D)

The pipeline above landed and `map.html` answered it with one line:

```js
// No ticket counts to show: the level report carries none.
vars['ShowTicket'] = false;
```

Both painters now draw the counter, from the layout's own group.

## The group is one thing, drawn in two places

`ShowTicket` gates a **top-level entry of `menu/InGame`** — a sibling of the
spawn screen's `Kit/ShowKit`, not a child of it. That is why the game shows
the same counter over the live world and over the deploy screen, and it is
what let this be wired without a second implementation:

- `extract_spawn_layout.py` already decoded the group into
  `spawn-layout.json` (`authentic-spawn-map/README.md` section 8, item 3,
  "decoded but not drawn"). `paintDeployChrome` now draws
  `data.groups.tickets.elements` alongside the spawn group, in the file's own
  order.
- `extract_hud_layout.py` gained the same top as a `tickets` group, which is
  all `hud.js`'s generic painter needs to draw it in-game — **no change to
  `hud.js` itself**.

Decoding the same top twice turned out to be a free cross-check. The two
flatteners agree on all nine leaves and all nine rects, with one difference:
`extract_hud_layout.py` classifies the two flag nodes as `variable-picture`
(they carry a `var`) where `extract_spawn_layout.py` calls them `picture`.
The HUD one is the more precise reading and is the one `hud.js` resolves
tolerantly.

### The nine leaves

Rect `(620, 4) 256x32`, every leaf gated on `ShowTicket == true`:

| leaf | rect | detail |
|---|---|---|
| `icon_ticketbar` | (620,4) 256x32 | the bar plate |
| Allied flag | (625,9) 16x16 | `variable-picture`, var `AlliedTicketFlag`, literal `flag_ticket_ger` |
| Allied count, shadow | (639,5) 45x20 | black, `Trebuchet MS14 - Latin`, right-aligned |
| Allied count | (638,4) 45x20 | `(0.328, 0.559, 0.914)` — blue |
| Allied blink | (623,7) 63x17 | red at 0.5 alpha, needs `Ticket/AlliedTicketBlink` AND `Ticket/ShowAlliedTicketBlink` |
| Axis flag | (733,9) 16x16 | var `AxisTicketFlag` |
| Axis count, shadow | (747,5) 45x20 | black |
| Axis count | (746,4) 45x20 | `(0.836, 0.176, 0.176)` — red |
| Axis blink | (730,7) 63x18 | as above |

Each count is drawn twice, one pixel apart: a black drop shadow behind the
team-coloured glyphs. Both leaves bind the same variable, so one feed fills
both.

## The feed

`feedTicketVars(vars)` in `map.html`, called from `deployVars()` for the spawn
screen and from `updateSoldierHud()` for the HUD:

| variable | value |
|---|---|
| `ShowTicket` | true when the level declares both counts |
| `AxisTicket` / `AlliedTicket` | `tickets.team1` / `tickets.team2` as strings |
| `AxisTicketFlag` / `AlliedTicketFlag` | `flag_ticket_<nation>.tga` from `teamNation(team)` |
| `Ticket/ShowAxisTicketBlink` / `...Allied...` | false |

Three decisions in that table:

1. **Team 1 is Axis, team 2 Allied** — the reading `map.html` already uses
   everywhere else (`flag.team === 1 ? 'Axis' : flag.team === 2 ? 'Allied'`).
2. **Both counts or neither.** A single real number beside the layout's own
   sample literal ("300"/"500") reads as data rather than as a gap. All 23
   vanilla levels declare both, so this only ever fires on a malformed mod.
3. **The blink is fed false, not left unfed.** It is a live-round state on a
   timer nothing here runs; feeding false makes the two leaves cull
   deterministically instead of on whatever happened to be in the table.

The flags come from `teamNation`, so Wake shows a US flag against a Japanese
one and Stalingrad a Soviet against a German one — not the layout's German
sample on both sides.

`deployTexture` and `deployText` gained a live-variable path for this, placed
**below** the existing per-level cases on purpose: `deployVars()` seeds its
table from the layout's own sample values, so a generic "the variable wins"
rule placed first would have made `ChangeTeam/AxisTeamFlag`'s sample
(`Icon_flag_ger.tga`) beat the `icon_flag_<nation>` lookup and put a German
flag on every team header.

## Gated on being in the world

The in-game group's only condition is `ShowTicket`, so left alone it would
ride over the free-fly camera, where this viewer deliberately shows no HUD
chrome at all and the game would not be in a round. `updateSoldierHud` clears
it unless the player is on foot or in a seat — the same condition that raises
the rest of the HUD. The spawn screen draws it unconditionally, as the game
does.

## Verified

Wake, served from this worktree on 5314, re-extracted into a scratch
directory (the published tree predates the `tickets` field):

- `scene.json.tickets` = `{mode: Conquest, team1: 100, team2: 100, lossPerMin: {5, 30}}`
- Spawn screen (`tickets-spawn.png`, read off `#deploy-chrome` alone, so no 3D
  frame or page CSS in the way): the ticket bar top right, US flag + blue
  "100", Japanese flag + red "100", drop shadows visible.
- In-game HUD (`tickets-hud.png`, read off `window.__hud.canvas`): the same
  bar over the live world, beside the health bar and the magazine.
- `window.__hud.vars` after spawning: `ShowTicket: true`,
  `AxisTicket: "100"`, `AlliedTicket: "100"`,
  `AxisTicketFlag: "flag_ticket_jp.tga"`, `AlliedTicketFlag: "flag_ticket_us.tga"`,
  both blinks false.
- `hud.js` reports 13 groups, `tickets` among them; `sprite('icon_ticketbar')`,
  `sprite('flag_ticket_jp')` and `sprite('flag_ticket_us')` all resolve.
- Back to free fly: `ShowTicket` goes false.
- Stalingrad (`combat-hud.png`): Soviet and German flags, 100/100.

Tests: `tests/test_hud_layout.py` gained five cases over the `tickets` group —
its rect and gate, the nine leaves by kind, the bound flags and their German
literal fallback, the drop-shadow pair's one-pixel offset and shared variable,
and the blink quads' two-variable AND.

## What a live bleed would need

The counters are the round-start numbers and they do not move. Three things
are missing before they could:

1. **A death count.** Conquest loses a ticket per death (`setTicketLosePerDeath`,
   `GameServer` 0x0813d700). Nothing here tracks deaths; the viewer has one
   soldier and no opposing team.
2. **A flag-majority timer.** `Game.setTicketLostPerMin <team> <rate>` — parsed
   and carried in `scene.json.lossPerMin`, unread — only drains while the
   *other* side holds more than half the control points. The viewer has no
   capture mechanic, so every level would sit at its round-start flag split
   for ever and the drain would either never start or never stop.
3. **Somewhere to put the result.** The counter is one of several things that
   want a round state (the score board opens nothing, the capture rings are
   unfed, `Ticket/*TicketBlink` has nobody to set it). A ticket counter alone
   would be the only moving number in a round that otherwise does not exist.

Until then a counting-down number would be a fiction. A frozen one is at
least the number the round genuinely starts at, and the value the level's own
`GameTypes/<mode>.con` declares.

The blink is the other half of this: `Ticket/AxisTicketBlink` and
`Ticket/ShowAxisTicketBlink` are two separate variables ANDed together, which
suggests one is "this side is low" and the other the blink phase — but what
threshold sets the first was not read, so neither is fed.
