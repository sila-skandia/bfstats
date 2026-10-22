# The score board's row colour, and the row's line box

Two defects off two captures the owner sent. One capture was the stock game with
its scoreboard up, the other our own viewer, and the difference was plain: every
row of ours came out white, and a row's name sat lower in its row than the kit
glyph beside it.

The HUD stretches by `stageW/800` across and `stageH/600` down, so on the
2556x1441 capture of the real game one virtual unit is 2.4 px and on our own
1280x633 one it is 1.05. Every number below is in that virtual space, the
layout's own.

**2026-10-22: the rows' geometry is now the engine's own** (ledger MEME-21 and
MEME-25, last section below). The line box and glyph square described under
"The row's line box" were fitted to the capture; the list draw and the
board's row fill now place both, and the fit's own numbers turned out to sit
one unit right of retail's glyph and a row short of its row count. Column 7's
`<id>` and the three medal cells came later the same day (the last section).

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

Superseded by "The rows from the engine" below: the first row's top at the
box's top + 24 came from a constructor value the draw never sees, and the
centring was a fit.

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
- The same pass against `https://mesh.bfstats.io` after the rollout (served
  `scoreboard.js` hash-equal to `HEAD`) measures the same `#d35353` and
  `#53a9d2`, so the live board carries the pair and not just the local one.
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

## The rows from the engine (2026-10-22)

`viewer/scoreboard.js` placed the rows with `LIST_TOP_INSET = 24`: the first
row's top at the box's top + 2 x 12.0, citing the list node constructor's
12.0 at +0x18 (0x007d1222). The node's reader overwrites that field with the
file's own `Row height` (0x007cffc2..0x007cffcd, field name 0x0093cd80), so
the draw (`FUN_007d1390`) works from 18. What the board does instead, all of
it read from the client (MEME-21 for any list box, MEME-25 for the board's
row fill `FUN_006e0380`):

| | Engine | Before this |
|---|---|---|
| first row | text baseline at the box's top + 2 x 18 = 101 | row top 89, line box centred in it |
| rows drawn | while the baseline is within the box's bottom less a row: 21 in a 420-high list | 20, cut at the olive strip (`listFloor`) |
| text | its line on the baseline (the face's `baseline`, 7 for standard6), pen at box left + 10 + column | the same 94, by a centring fit |
| text cut | glyphs until the advance passes the span to the next column less 20, the crossing glyph drawn (name: 105) | next column less 2, no crossing glyph (123) |
| kit glyph | a 16 x 16 texture cell at x 0, y 11: box left + 10, 11 above the baseline (15, 90) | an 18 square at the icon column, the glyph centred in it (16, 90) |
| local player's row | a band from box left + 10 to the box's right less 10, 11 above the baseline, 16 high, black at 0.5 | nothing |

The text lands where it did: a centred 8-high line in an 18-high row that
starts at 89 is the same 94 as a 7-baseline line on 101. What moved is the
kit glyph (one unit left), the 21st row, the name's cut, and the band.

The band is `0x007d0c60(row, r, g, b, a, 10, -11, 16, -20)` in the row fill,
black at half alpha on the local player's row and a blue at half on a
buddy's. The viewer has no buddy list, so only the local band is drawn. The
board's selected player gets the select colour over it. The viewer has no
board selection either.

### Checked against retail

On `leaderboard.webp` (the owner's capture of Bocage, in the main checkout;
the game spans 1920 x 1080 below a 60 px title bar, so 2.4 px a unit across
and 1.8 down, calibrated on the olive strips at 72 and 465):

| | retail capture | engine | the viewer now |
|---|---|---|---|
| first kit square | 15.0..31.25 x 90.0..106.1 | 15..31 x 90..106 | 15..31 x 90..106 |
| row pitch | 18.3 (second square at 108.3) | 18 | 18 |
| local row's band (Allied, row 9) | 414..785 x 252.2..268.3 | 414..785 x 252..268 | 414..785, 11 above its baseline, 16 high |
| band colour | (31, 33, 37) over the panel's (61, 64, 72) | black at 0.5 | black at 0.5 |

The viewer's numbers are from a headless pass: Bocage, 24 bots, the local
player on the Allies, the board opened with `__scoreboard.open()`. The board
canvas was read back at 1920 x 1004. The local row was row 0 there, and its
band measured 414..785 x 90..106. Both lists' first glyphs measured 15..31 x
90..106. The text ink measured 93.8..102.8, where the capture has 93.3. No
side had more than 13 players, so the 21st row is covered by the suite, not
by a frame.

### What this touched

- `viewer/scoreboard.js`: `LIST_TOP_INSET` and `listFloor` are gone;
  `LIST_FIRST_BASELINE`, `KIT_CELL`, `ROW_BAND`, `ROW_BAND_COLORS`, `rowBand`,
  `clipText` (which replaces `fitText`); `listGeometry(box, columns,
  fontBaseline)` returns baselines, the kit cell and the band; the painter
  lays down band, glyph, text in that order.
- `viewer/scoreboard-screen.js`: `res.baseline` (the face's own) in place of
  `res.lineHeight` and `res.floor`.
- `tests/scoreboard_harness.mjs`, `tests/test_scoreboard.py`: the geometry
  tests restated against the engine, plus the band, the cut and the 21 rows.
- Ledger: MEME-21 gains the reader and the band's draw, and MEME-25 is the
  board's row fill. `symbols.json` names `BfScoreboard__fillRows`,
  `meme_ListBoxData__setRowBand`, `meme_ListBoxData__updateTextureCell` and
  `BfScoreboard__classIconName`.

### Still open

- ~~Column 7 (the `#` heading) is `<%d>` of the player's id for a human outside
  modes 0, 1 and 4, and empty for a bot. The viewer prints the room slot as a
  bare number in it for every row that has one.~~ Built, see "Column 7 and
  the medal cells" below.
- ~~Columns 11..13 carry three 8 x 8 medal cells at x 340, 350 and 360, 6
  above the baseline (gold, silver, bronze or empty). The rule that picks
  them was not read, and the viewer draws none.~~ Read and built, see below.
- The selected player's band (the select colour, 0.8 alpha) waits on a board
  that can select a row.
- How many rows the list data holds (+0x28) and the sort order are still not
  read.

## Column 7 and the medal cells (2026-10-22)

Both read out of the row fill `FUN_006e0380`. The engine side is in ledger
MEME-25.

### What the engine does

- **Column 7** is `<%d>` of the player's id (vt+0x44) for a human in a game
  joined or hosted (`StartingGame` 2 or 3), and empty for a bot (vt+0x58) or
  in a single-player game (`StartingGame` 0, 1 or 4, `0x0045d050`). The id is
  the `playerId` the server's `CreatePlayer` event carries.
- **Columns 11..13** are three 8 x 8 texture cells at x 340, 350 and 360,
  6 above the baseline. They are placed the way the kit glyph is. Cell k is
  gold while the player has at least k golds, else silver while his golds
  and silvers reach k, else bronze while all three reach k, else
  `empty_8x8`, which is fully transparent. The result is his best three
  medals, best first. The textures are `Debriefing/medals/allied_*_8x8` on
  both lists.
- The counters are `giveMedal`'s, and they survive a restart, because
  `BFPlayer::resetStats` does not clear them. On a joined client they are
  the server's own, ghosted in the player's stat block.

### What the page shows

| Where | Column 7 | Medal cells |
|---|---|---|
| Sidecar (a retail server) | `<pid>` for a human, the server's own player id (`net-sidecar.js` `playerIdOf`); nothing for a row the server marks `ai` (`isAi`), which now also gets the bot glyphs | the server's counters, `statsOf(slot).medals` (the k:"ps" row's `md`) |
| The page's own room | `<slot>` for a room player: the number the room server knows him by, which its rows name him with. This is the room's id, not a retail one | none: the room server gives no medals, so the page has no counters to show, and it draws no cells instead of guessing at empties |
| Offline (the page is the host, `StartingGame` 3, as the debriefing has it) | nothing. Bots get no id, and the page gives the local player none: a host's own id was not read and is not invented | the round's own counters: `round-state.js` `giveMedals` runs `giveMedal` on the end game's first tick (`round-end.js` `open`), and `medalCounts` keeps them across a restart |

`boardRows(players, feed, tally, { startingGame })` now gives each row an
`idText` (`idText`) and its `medals`. `listGeometry` gives `medals(i)`, the
three cells (`MEDAL_CELLS`). `paintLeaves` draws them from the layout's
`rowMedals` after the kit glyph. A row with no counters, or a pack without
`rowMedals`, draws no cells.

### The pack

`extract_scoreboard_layout.py` records `rowMedals` and packs the four 8x8s
from `menu/Texture/Debriefing/medals/*.dds`. The vanilla board pack
(`viewer/maps/_shared/hud/scoreboard/`) was re-extracted, and it is the only
board pack there is. The re-extract added the four textures and `rowMedals`
and changed nothing else in the layout. **Not yet published**: the four
textures and the new `scoreboard-layout.json` go up together with the code.

### How it was checked

- `tests/test_scoreboard.py` (`scoreboard_harness.mjs`) covers `idText` for a
  human, a host, a bot, a row without an id and each single-player game, and
  `medalKinds` over none, one gold, mixed, many and a short array. It checks
  the cells at box left + 10 + 340/350/360, 6 above the baseline, and that
  the painter draws `allied_gold_8x8` twice and `allied_bronze_8x8` for
  `[2, 0, 1]`, prints `<0>` at column 7 for a human and nothing for a bot,
  and draws nothing without `rowMedals`.
- `tests/test_scoreboard_layout.py` checks that `rowMedals` names the four
  `Debriefing/medals` stems of the shipped `menu.rfa`.
- `tests/test_round_state.py` checks that two rounds of `giveMedals` give
  two golds and two silvers with a restart between them.
- `tests/test_sidecar_client.py` checks that `playerIdOf` and `isAi` read
  the roster's pid and `ai`.
- Headless page (Bocage, 24 bots, the local player on the Allies, the board
  opened with `__scoreboard.open()`): before any medals, every row's cells
  are `empty_8x8` and nothing shows. Column 7 is empty on every row, as it
  should be offline. After `__scoreboard.giveMedals()` twice, the local
  row shows two gold medals, the first Allied bot two silver and one Axis
  bot two bronze, each pair at the right of its row under the side's flag.

### Still open

- The client's ghost reader that stores the medal counters at +0x11c was not
  located. That they are the server's +0xe8 is inferred from the uniform
  0x34 shift of every stat field the board reads (MEME-25).
- `getPlayersSortedByScore`'s tie order is still unread (ROUND-9). A round
  where nobody scores hands its medals out in the page's own order.
- A host's own player id, which an offline column 7 would print for the
  local player.

