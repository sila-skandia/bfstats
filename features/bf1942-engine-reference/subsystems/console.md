# The console

Read 2026-09-19 out of both binaries and re-derived by a second agent before it
reached this file. Where the two disagreed, the second reading is what is
written here, and the first is named so that nobody re-derives it from the
research report. Ledger rows CON-2…CON-13.

One class, two binaries. The Linux server names it `dice::ref2::io::OldConsole`
(ctor `0x083dbfc0`); the client is the same code, stripped — ctor `0x005a2230`,
vtable `0x009033a8`, object `0x918` bytes. The client builds **two** of them at
start-up from the CRT initialisers at `0x00856720` and `0x00856750`:
`0x009a9420` = `OldConsole(true)`, the one the game draws, and `0x009a9424` =
`OldConsole(false)`. A second, newer console family exists in the server
(`console::InteractiveConsole` `0x083474c0`, `console::Parser` `0x0834de50`);
1.61 does not use it, and every string the shipped console prints is referenced
from `OldConsole`.

## 1. The model

A scrollback deque, a **77-byte edit buffer inside the object** at `this+0x60`
— which is why the line length is fixed and why there is no cursor — a
command-history deque, a page-scroll offset, a prompt string at `this+0x168`
defaulting to `"> "`, a working-file string at `this+0x1cc`, and a line counter
at `this+0x1d0`.

The two caps are **not** the two numbers the constructor is most visible for
(CON-13). `setMaxHistorySize` writes `this+0x2c`, and `this+0x2c` is exactly
what `output` compares the **scrollback** deque against before popping
(`0x083dd018`); the ctor sets it to `0x400` = **1,024** (lnxded `0x083dc037`,
client `0x005a224c`). `setMaxCommandHistorySize` writes `this+0x5c` = **10**
(lnxded `0x083dc09c`, client `0x005a226e`). The `10000` at `+0x1bc`/`+0x2fc` is
a third member and **nothing reads it**.

`output` also wraps: `0x083dcf50` closes a line on NUL, on `\n` (`0x083dcf9c`)
**and** on `cmp ecx,[edi+0x160]` / `jle` at `0x083dcfce` — and the `jle` makes
the wrapped chunk **78** characters, not 77.

## 2. Dispatch

`handleCommand` (`0x083de990`) takes the first whitespace token, `strcasecmp`s
it against 22 script keywords (`rem`, `if`/`elseIf`/`else`/`endIf`,
`while`/`endWhile`, `var`/`const`, `echo`, `run`/`include`,
`alias`/`listalias`/`unalias`, `beginRem`/`endRem`,
`beginNoExecution`/`endNoExecution`, `return`/`quit`/`exit`), and otherwise
scans it for the **first `.`** (`0x083e422d`) to split object from method.
Arguments come from `getArgs` (`0x083de4d0`): tokens off an `istringstream`,
with `"` opening a run that may contain spaces. Lookup folds case, which is why
the game's own `AliasedCommands.con` can alias `game.listplayers` to a method
the binary spells `listPlayers`.

**There is no `=` between a method and its arguments.** `handleCommand`
contains no `cmp …,0x3d` at all; the whole binary compares a token against the
`"="` literal `0x086e6da4` in exactly **three** places, all `std::string::compare`
inside `handleCommand` — `0x083e14c3`, `0x083e1a43` and `0x083e78ce` — which are
`var`, `const` and assignment to an existing `v_` variable. Zero of the 86 loose
`.con`/`.inc`/`.tweak` files in the install use `object.method = value`.

A viewer may still accept the form as a documented divergence, but it has to
strip it from the **raw text before tokenising**, anchored (`/^\s*=(?=\s|$)/`)
so a quoted `"="` first argument survives and `=1` stays one argument. Stripping
it from the tokenised argument list swallows a quoted `=`.

Registered commands are `ConsoleObject` instances whose field layout is
documented by bf42plus's `src/bf/console.h`, which hooks them live: `type`
(1 read/write, 0 read-only, 2 write-only), `objectname`, `functionname`,
`access`, `minargcount`, `maxargcount`, `argdesc[]`, `retdesc`. A registrar such
as `FUN_004dfe20` fills exactly those. The object names are a list at
`0x008d19a0`–`0x008d1a08`: `Debug`, `ToolHandler`, `PlayerStats`, `Game`,
`Chat`, `Admin`, `Renderer`, `Shadow`, `Hud`, `Console`, `Sound`, `Menu`,
`Vars`. The guard messages are one block per binary (client
`0x00902cb8`–`0x00902d3c`): *Method is not active!*, *Property is only setable!*
(one t), *Property is only readable!*, *Unauthorised method!*, *Unknown object
or method!*, plus *Too few/many arguments, the min/max no of arguments is N!*
and *Properties only takes one argument!*.

**`game.showHud` does not exist in 1.61** (CON-12). `showHud` has zero hits in
the client's string table and `useHud` has one; the real command is
`game.useHud`, aliased `hud` in the game's own `AliasedCommands.con`.

## 3. The error pair, and the number in it

`executeLine` (`0x083e9ae0`) echoes `prompt + line` through `output`, switches
on the result, and on code 2 prints two lines assembled from four literals —
`"Error "` `0x086e38c8`, `" ("` `0x08706306`, `"): "` `0x086b9c63`, `": "`
`0x086f24a2`:

```
Error <workingFile> (<n>): <line>
Error <workingFile>: <message>
```

For a line typed at the console the working file is **empty**, which is the
whole explanation of a capture's `Error  (2):` with two spaces and `Error : `
with one.

**The number is a constant at the prompt (CON-8, corrected).** The increment at
`0x083e9f89` is past the switch **and** behind `cmp BYTE PTR [ebp-0x8b5],0` at
`0x083e9f7d`, and `ebp-0x8b5` is `executeLine`'s **fifth bool**, stored from
`ebp+0x24` at `0x083e9b0d`. `updateAsciiKey`'s Enter branch pushes `0,0,1,1,1`
(lnxded `0x083eabe5`, client `0x005a1381`) — false. `executeLines`
(`0x083ea83b`) passes false. Only `run` passes true (`0x083ecafd`), and `run`
saves, zeroes and restores the counter (`0x083ec6d3`/`0x083ec6f1`/`0x083ecbac`),
as does `include` (`0x083ed3f1`/`0x083ed415`/`0x083ed8d3`).

So a line typed at the prompt **never** bumps it: every error in a session
prints the same number, and the number is a `.con` file's line number only
inside a file. A first reading had it incrementing per typed line, and a
reconstruction built on that printed 0, 1, 2… No path was found that leaves the
top-level counter non-zero, so a capture's `(2)` stays **unexplained** rather
than explained away. The cheap settling test on a live client: type two bad
commands and see whether both print the same number.

## 4. Input

Every console key becomes one char in `updateAsciiKey` (`0x083ea900`): `0x0d`
execute, `0x08` drop the last character, `0x7f` clear the line, `0x09`
complete, `0x10`/`0x0e` history back/forward, `0x02`/`0x06` scroll a page.
`updateGameInput` (`0x083eac60`) feeds it exactly four of the engine's inputs —
`c_GIUp`(3), `c_GIDown`(4), `c_GIPageUp`(12), `c_GIPageDown`(13). **`c_GILeft`
and `c_GIRight` are bound in the default control map and never read: there is no
cursor.** The page size is 8 and the scroll offset is clamped into
`[0, floor(lines/8) − 1]`.

**Any other key resets both offsets.** The tail at `0x083ea973` is reached by
every branch (Enter via `0x083eac29`, Tab via `0x083eab77`) and does
`historyIndex *= (ch == 0x10 || ch == 0x0e)` and `scroll *= (ch == 0x02 || ch ==
0x06)` — the `imul`s at `0x083ea98b` and `0x083ea9a0`. Type anything and both
snap back to the live line.

`autoCompletion` (`0x083e83a0`) prefix-matches the object and method halves with
`strncasecmp` against `ConsoleObjects::getConsoleObjects()` and prints candidates
as `name (argtypes) -> ret`.

**The key is `c_GIToggleConsole`, ordinal 1** (CON-2), recovered by walking every
`addConstantHelper` site in `io::Module::init` (lnxded `0x083f7f40`). It is bound
to **`IDKey_Grave` and `IDKey_Capital`**, both `c_CMNonRepetive`, in shipped
`Settings/Default/Controls/Common.con` lines 26–27 *and* in the client's own
compiled fallback control map at `0x00927088` / `0x00927020`.

**1.61 has no spawn-screen key at all.** Grepping `spawn`/`deploy` over
`Settings/Default/Controls/*.con` returns only that Caps Lock console line, and
the engine's whole `c_GI*` set — 36 names in the client, 46 in the server — has
no deploy, spawn or kit input. The spawn screen is entered by game flow (join,
death), never by a keystroke. Anyone tempted to give Caps Lock a deploy screen
is inventing a control the game does not have; put redeploy on a key the game
leaves free.

## 5. What it looks like

`getLines(n)` (`0x083ec0e0`, client `0x005a1fa0`) returns up to `n−1`
scrollback lines, then — when the scroll offset is non-zero — **sixty `+`**
(`0x086e38e0`, client `0x00903448`), then `prompt + editLine`. It does **not**
pad.

**The marker is an extra row above the prompt, not a replacement for it**
(CON-10, corrected). In lnxded the marker block `0x083ec287` pushes the sixty
`+` and **both** its exits (`0x083ec2cd jg`, `0x083ec2df jmp`) land on
`0x083ec1ff`, which `strlen`s the edit buffer at `this+0x60`, appends it to the
prompt copy and pushes that — the same instruction the unscrolled path reaches
from `0x083ec1f6`. The client agrees: `0x005a2037 JZ 0x005a2060` skips only the
marker, and `0x005a2060` is on every path. A reconstruction that swapped the
prompt for the marker lost the line being typed *and* a row of band height.

**Drawing (client only).** `Setup+0x2d8` owns the console's UI: the text object
at `+0x08` (loaded with `font/BF1942.font` by `0x00460e40`), the visible byte at
`+0xe3`, the wash quad at `+0xe4`.

- **There is no animation** (CON-3). `0x00464af0` writes the byte and rebuilds
  the quad from scratch through `0x004649f0`; nothing on the path tweens
  anything, and it touches no other console state. The overlay pass tests the
  byte at `0x00467215` and calls the drawer at `0x00467221`.
- **The band is pixels, not a screen fraction** (CON-4). `0x00464ee0` calls
  `getLines(20)` (`PUSH 0x14` at `0x00464f96`, `CALL [EAX+0x1c]` on
  `[0x009a9420]`), counts the result as `(end − begin) / 0x1c` via the
  `0x92492493` / `SAR 4` magic at `0x00464fb0`–`0x00464fc3`, computes
  `(lineHeight + 1) · count + 4` at `0x00464fca`–`0x00464fce`, divides by the
  viewport's height (`FDIVR` `0x00465020`) and calls
  `quad.setSize({1.0f, frac})` at `0x00465033`. Each line goes at `x = 2.0f`,
  `y = (lineHeight + 1)·i + 2` (`0x0046505b`–`0x0046507d`).
- **The wash is `texture/white.tga` at alpha 0.8** under SRCALPHA/INVSRCALPHA
  (CON-5). `0x004649f0` loads the texture and builds the quad at mode 2 / alpha
  0.5f, then overrides: `FUN_006084c0(quad, 1)` sets blend mode 1 →
  `rend::setBlendFunc(5, 6)` (`0x0045ff10` → `SetRenderState(0x13,5)`/`(0x14,6)`
  on `ds:0x9c0184`+0xc8), and `FUN_006084e0(quad, 0x3f4ccccd)` sets alpha
  **0.8f** at `0x00464ad6`. **The alpha rides `D3DRS_TEXTUREFACTOR`, not a
  vertex colour** — the `(int)(alpha·255) << 24` at `0x006085b4` goes to
  `rend::setTextureFactor` `0x005b84e0` (`SetRenderState(0x3c, c)` at
  `0x005b84fb`/`0x005b8506`), and mode 1 then sets only the alpha stage,
  `setAlphaOp(stage 0, SELECTARG1, D3DTA_TFACTOR, DIFFUSE)` through
  `0x004604e0`, never touching the colour stage. The RGB is therefore the
  texture's, and `texture/white.tga` is an 8×8 24-bit TGA whose 192 pixel bytes
  are all `0xff`: white. A canvas reproduction reads back `[255, 255, 255, 204]`.
- **The font is the HUD's own** (CON-6). `0x00460e40` loads `font/BF1942.font`
  into `[this+8]` and the drawer reads the same `+8` (`0x00465056`). The design
  note that the console font is "quite unlike the HUD font" is right about the
  look and wrong about the file: it is the HUD font drawn 1:1.
- A second, **pre-device** console (`0x004650d0`) uses the same `getLines(20)`
  but GDI `TextOutA` in bold 12 px Courier New, white on black, `x = 8`,
  `y = 30`, pitch 14, from `0x00461260`. That is the loader console, not the
  in-game one.

**Worth stating plainly, because it is the thing every reconstruction gets
wrong:** the band is not a fraction of the screen. It is `lines × pitch + 4`
pixels, and the 39% in a 1124 px reference capture is simply what 20 lines came
to at that height. A console nobody has written to opens as a thin strip, in the
game as anywhere else.

## Open

- **The text colour.** `0x00460e40` sets none, and the drawer's per-line call
  carries none (`x`, `y`, `&string` only), so it is a member or inherited device
  state. The text object at `Setup+0x2d8+0x08` is not a bare `Font` — its vtable
  slot 0x10 is not `Font`'s — and its vtable was not walked. Black is from a
  capture, not from the code. One hypothesis, **unproven**, with an address: the
  wash leaves `D3DRS_TEXTUREFACTOR` at `0xCC000000` (RGB zero, alpha 204), so
  text quads that modulate by TFACTOR would come out black *and* ~20%
  transparent with no colour set anywhere. Sampling a glyph interior in a real
  capture settles it — flat `#000000` kills it, scene bleed-through confirms it.
- **The line pitch.** The text object's `vtable[0x14]` returns one more than the
  font header's `Height` *if* a capture's 22 px pitch is right. Inferred, not
  read; keep the pitch a parameter so the arithmetic stays the engine's.
- **`autoCompletion`'s rule**: longest common prefix, or first match.
- **The history walk wraps in the engine** (`0x083eab5a` negative → size−1,
  `0x083eaa99` size → 0, with no empty "fresh" slot) where a clamping
  reconstruction differs only at the two ends. Which end of the deque a new
  command is pushed onto was not read, so the wrap was not reproduced rather
  than guessed.
- **`handleCommand` codes 0 and 3** — `executeLine` branches `0x083ea4c3` and
  `0x083ea069`.
- **The leading `@`** in `@Adding <%s> (%d) to buddylist` (`0x008d62a7`):
  something strips it, and that path was not read.
