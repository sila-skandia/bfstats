# The score board's row colour, and the row's line box

Two defects off two captures the owner sent. One capture was the stock game with
its scoreboard up, the other our own viewer, and the difference was plain: every
row of ours came out white, and a row's name sat lower in its row than the kit
glyph beside it.

The HUD stretches by `stageW/800` across and `stageH/600` down, so on the
2556x1441 capture of the real game one virtual unit is 2.4 px and on our own
1280x633 one it is 1.05. Every number below is in that virtual space, the
layout's own.

## The colours

The stock board draws a row's name and its numbers in its side's colour, dimmer
once the player is down, and the local player's own row in green. Measured as
the ink core of a row's text (the brightest, most saturated pixel of a stroke)
on the owner's capture of the retail game:

| which row | measured core | as a fraction |
|---|---|---|
| Axis, alive | `#d55454` (214, 84, 84) | 0.84 / 0.33 / 0.33 |
| Allied, alive | `#54aed7` (84, 174, 215) | 0.33 / 0.67 / 0.83 |
| Allied, dead | (41, 98, 127) | 0.49 to 0.60 of a live row, per channel |
| the local player's own row | (1, 243, 1) | 0 / 0.95 / 0 |

Those measured cores are the values `viewer/scoreboard.js`'s `ROW_COLORS` and
the pack's `colors` carry, rounded, with `DEAD_ROW_DIM` (0.55) for a dead row.
They are what our own renderer needs to land on the same screen colour: it
draws a glyph at full coverage where the capture has the panel showing through,
so a row painted in the flat measured core measures that core back, and the Axis
panel then reads `#d65454` and the Allied one `#54aed6`.

Where the values are *not* from, and this cost a round trip:

- Not `Menu.con`. `Bf1942/Game/Init/Menu.con` sets `Game.setAxisRadioColor
  1/0.35/0.35` and `Game.setAlliedRadioColor 0.4/0.6/1`, which are the chat and
  radio text colours. The Axis pair is close enough to pass, but the board's
  Allies are a cyan the radio blue never is (`#54aed7` against `#6597fc` when
  both are drawn flat), so the radio pair is not the board's.
- Not a level con. Every `Init.con` of the 23 shipped levels carries only
  renderer colours (fog, ambient, water, shader), and none sets a team colour.
- Not a literal in the client. `BF1942.exe` holds no consecutive float32 or
  float64 triple within 0.02 of either colour, in either order, and no byte
  triple of the measured values. The engine paints these rows itself (the same
  reason `listColumns.source` cites `BF1942.exe 0x006dfa75`, not a menu), and
  the pair is computed rather than stored.

So the capture is the reading, and it is recorded as the source in the pack's
`colorsSource`. `extract_scoreboard_layout.py`'s `BOARD_ROW_COLORS` holds the
same values as house defaults, so a `scoreboard-layout.json` extracted before
this still paints the right colours.

## The row's line box

`listGeometry` placed a row's text at `row bottom - lineHeight`, ten units into
an 18-unit row, while the kit glyph was drawn from the row's own top and
stretched to the row's height. Retail centres both in the row: for its first row
the name's ink top measures 93.3 virtual against the list's own top at 89, which
a 5-unit offset explains, and the kit glyph's ink runs from 92.4, which is a
16-unit glyph one unit into an 18-unit square.

The fix has two halves. `cells()` places the line box at `row top + (pitch -
lineHeight) / 2`, so a standard6 row (line height 8) in an 18-unit row starts
five units down. The listbox painter draws the glyph at its own size, centred in
the row's square.

Before it, on our own capture, the name's ink started 12 px lower and the glyph
was drawn 18 units tall where retail's is 16.

## What this touched

- `viewer/scoreboard.js`: `ROW_COLORS`, `rowColor`, `DEAD_ROW_DIM` (which
  replaces `DEAD_ROW_COLOR`, a red multiplier that only suited an Axis row),
  the line box in `listGeometry`, and the glyph draw in `paintLeaves`. Rows now
  carry their `team`.
- `viewer/scoreboard-screen.js`: `res.rowColor`.
- `extract_scoreboard_layout.py`: `BOARD_ROW_COLORS` and `colors` with
  `colorsSource` in the layout JSON.
- `tests/scoreboard_harness.mjs` and `tests/test_scoreboard.py`: the row
  colour, the dim, the centred line box, and the glyph at its own size.

## Verified

- `python3 -W ignore::ResourceWarning -m unittest tests.test_scoreboard
  tests.test_round_state tests.test_extract_score_settings` from
  `tools/bf1942-models`: OK.
- Re-extracting the pack for vanilla leaves the served `scoreboard-layout.json`
  equal in every key but `colors` and `colorsSource`.
- A live pass on Berlin with 20 bots at a 1280x633 stage measures the Axis
  panel's names at `#d35353` and the Allied panel's at `#53a9d2`, against the
  capture's `#d55454` and `#54aed7`, with the kit icons level with the names.
  The local player's row measured `#008a00` in that pass because the row was
  dead at the time, which is the green at the dead dim, and the colour and the
  dim are covered by the suite rather than by that frame.
- The two claims a test can hold are in the suite: a dead row is the side's
  colour times the dim to six places, and the glyph draws at `16x16` one unit
  into the row.

## Open

- The engine's own source for the pair is unread. It is engine-side (the binary
  has no literal and no con carries it), so the honest follow-up is a Ghidra pass
  over the scoreboard's row painter near `0x006dfa75`, which would let these
  values be extracted rather than measured.
- The green row is the local player's own. `Menu.con` calls that colour the
  buddy colour and the chat log already draws buddies in it, so a buddy list
  would take the same green.
- A mod that overrode the board's colours would need its own scoreboard pack;
  the shared one carries the one measured pair.
