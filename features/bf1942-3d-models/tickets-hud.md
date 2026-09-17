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
