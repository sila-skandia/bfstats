# The score board's row colour, and the row's line box

Two defects off two captures the owner sent, both of them things the board had
drawn a viewer choice since it was written: every row came out white where
retail draws it in its side's colour, and a row's name sat lower in its row
than the kit glyph beside it.

The HUD stretches by `stageW/800` across and `stageH/600` down, so on a
2556x1441 capture one virtual unit is 2.4 px and on a 1280x633 one it is 1.05.
Every number below is in that virtual space, the layout's own.

## The colours

Retail draws a row's name and its numbers in the side's own colour, dimmer once
the player is down, and the local player's own row in green. Measured off the
owner's retail capture, as the ink core of the row's text (the brightest,
most saturated pixel of a glyph):

| which row | measured core | the game's own value |
|---|---|---|
| Axis, alive | `#d65454` | `1/0.35/0.35` |
| Allied, alive | `#54aed8` | `0.4/0.6/1` |
| Allied, dead | `#29627f` | 0.49 to 0.59 of the live row, per channel |
| the local player's own row | `#01f301` | `0/1/0` |

Those values are the game's, not a viewer invention: `Bf1942/Game/Init/Menu.con`
runs `Game.setAxisRadioColor 1/0.35/0.35` and `Game.setAlliedRadioColor
0.4/0.6/1`, and the buddy green is the literal the same script's chat settings
use for a buddy. `extract_radio.py` already read them into the chat layout;
`extract_scoreboard_layout.py` now reads them out of the chain's `Menu.con` as
well and writes them into `scoreboard-layout.json` as `colors`, with
`colorsSource` naming the file and the two commands.

`viewer/scoreboard.js` turns a row into its colour in `rowColor`: the local
player's row takes the buddy green, team 1 the axis colour, team 2 the allies
colour, and a row on neither side falls back to the leaf's own colour. A dead
row is drawn at `DEAD_ROW_DIM` (0.55), which covers the name and the numbers
together. `scoreboard-screen.js` passes the layout's table in as
`res.rowColor`. `ROW_COLORS` in the module holds the same values as house
defaults, so a `scoreboard-layout.json` extracted before this still gets the
right colours.

Our render measures `#fc5858` on the Axis panel, `#6597fc` on the Allied one
and `#00fc00` for the local row, which is the game's own two colours at 99% of
full value. Retail's cores are the same two hues through its own glyph
filtering, a few percent lower per channel.

## The row's line box

`listGeometry` placed a row's text at `row bottom - lineHeight`, which is ten
units into an 18-unit row, while the kit glyph was drawn from the row's own
top. Retail centres both in the row. For its first row the name's ink top
measures 93.3 virtual against the list's own top at 89, which a 5-unit offset
explains to within the capture's filtering, and the kit glyph's ink runs from
92.4, which is a 16-unit glyph one unit into an 18-unit square.

The fix has two halves. `cells()` places the line box at `row top + (pitch -
lineHeight) / 2`, so a standard6 row (line height 8) in an 18-unit row starts
five units down. The listbox painter draws the glyph at the texture's own size,
centred in the row's square, instead of stretching it to the row height.

Before the fix the name's ink started 12 px lower than it does now on the same
capture, and the glyph was drawn 18 units tall where retail's is 16.

## What this touched

- `viewer/scoreboard.js`: `ROW_COLORS`, `rowColor`, `DEAD_ROW_DIM` (which
  replaces `DEAD_ROW_COLOR`, a red multiplier that only suited an Axis row),
  the line box in `listGeometry`, and the glyph draw in `paintLeaves`. Rows now
  carry their `team`.
- `viewer/scoreboard-screen.js`: `res.rowColor`.
- `extract_scoreboard_layout.py`: `read_team_colors`, and `colors` with
  `colorsSource` in the layout JSON.
- `tests/scoreboard_harness.mjs` and `tests/test_scoreboard.py`: the row
  colour, the dim, the centred line box, and the glyph at its own size.

## Verified

- `python3 -W ignore::ResourceWarning -m unittest tests.test_scoreboard
  tests.test_round_state tests.test_extract_score_settings` from
  `tools/bf1942-models`: 75 tests, OK.
- Re-extracting the pack for vanilla leaves the live `scoreboard-layout.json`
  equal in every key but the two new ones, checked against the copy the
  volume serves.
- Live pass on Berlin with 20 bots at a 1280x633 stage: names red on the Axis
  panel and blue on the Allied one, the local player's row green, and the kit
  icons level with the names.

## Open

- Retail's rendered pixels are a few percent dimmer per channel than the flat
  colours, because its glyphs are filtered at 2.4x scale and ours rasterise at
  nearly full coverage. The palette is the game's own either way. Matching
  retail's screen value would fit our renderer to a capture.
- The green row is the local player's own. The game's data calls that colour
  the buddy colour and the chat log already draws buddies in it, so a buddy
  list would take the same green.
- Every shipped mod chain resolves `Menu.con` to the same values, so one shared
  pack table serves them all. A mod that overrode the two commands would need
  its own scoreboard pack.
