# The BF1942 console, read out of the binaries

Stream B of the [2026-09-19 parity round](../bf1942-parity-round-2026-09-19/README.md).
Everything here carries the address it came from. Anything that could not be
read out of a binary is marked **UNVERIFIED** in so many words.

Two binaries, one class. The Linux dedicated server names it
`dice::ref2::io::OldConsole`; the retail client is the same code, stripped.
The `.con` dispatcher is common to both; the drawn console is client only.

| | client `BF1942.exe` (`60c9452d…cd3699`) | lnxded 1.61 (`bf1942_lnxded.static`) |
|---|---|---|
| constructor | `0x005a2230` | `0x083dbfc0` |
| vtable | `0x009033a8` | `vtable for dice::ref2::io::OldConsole` |
| the singletons | `0x009a9420` (`new OldConsole(true)`), `0x009a9424` (`false`), both built at `0x00856720` / `0x00856750`, object size `0x918` | `dice::ref2::io::mainConsole` `0x087b8adc` |
| `handleCommand` | — | `0x083de990` |
| `executeLine` | vtable slot 2 | `0x083e9ae0` |
| `getLines` | vtable slot 7 = `0x005a1fa0` | `0x083ec0e0` |
| `output` | vtable slot 4 | `0x083dcf50` |
| `updateAsciiKey` | vtable slot 5 | `0x083ea900` |
| `updateGameInput` | — | `0x083eac60` |
| `autoCompletion` | — | `0x083e83a0` |
| `getArgs` | — | `0x083de4d0` |

There is a second, older console class in the server (`console::InteractiveConsole`,
`0x083474c0`, and `console::Parser`, `0x0834de50`) with the same method names.
1.61 does not use it: the strings the capture shows are all referenced from
`OldConsole`, not from `Parser`.

---

## 1. Which key opens it, and where the binding is declared

`c_GIToggleConsole`. Its ordinal is **1** — recovered by walking every
`dice::ref2::io::addConstantHelper(string, unsigned)` call site in
`io::Module::init` (lnxded `0x083f7f40`; the client twin is `0x00583bf0`,
already in the corpus). `c_GIToggleConsole` is registered at `0x083f8db0`
with the immediate `1` pushed at `0x083f8dbd`.

It is bound twice, in two places that agree:

* The shipped file `Mods/bf1942/Settings/Default/Controls/Common.con`,
  lines 26 and 27:

  ```
  ControlMap.addKeyToTriggerMapping c_GIToggleConsole IDFKeyboard IDKey_Grave c_CMNonRepetive
  ControlMap.addKeyToTriggerMapping c_GIToggleConsole IDFKeyboard IDKey_Capital c_CMNonRepetive
  ```

  The same pair is in `Settings/Default/Controls/Common_Japanese.con` (lines
  25-26, where the Caps Lock line carries a trailing `1`) and in each
  `Settings/Profiles/*/Controls/Common.con`. The per-profile copies ship only
  the Grave line; Caps Lock is a default-map binding.

* A complete fallback control map compiled into the client, as one block of
  `.rdata` literals from `0x00926c28` to `0x00927410`. The two console lines
  are at `0x00927088` (Grave) and `0x00927020` (Capital, with the `1`).

So: **backquote/tilde, and Caps Lock**, both `c_CMNonRepetive` — a press
toggles, holding does nothing. The viewer binds only Grave, because this page
already spends Caps Lock on the spawn menu.

The same block declares the console's other keys: `c_GIUp`, `c_GIDown`,
`c_GILeft`, `c_GIRight`, `c_GIBack`, `c_GIDelete`, `c_GIEnter`, `c_GITab`,
`c_GIPageUp`, `c_GIPageDown` and the mouse wheel.

## 2. How far it drops, and whether it animates

**It does not animate.** The console's visible state is one byte,
`Setup+0x2d8 + 0xe3`. `FUN_00464af0(bool show)` is the setter:

```
464af3  eax = this->quad (+0xe4)
464af9  if (quad) FUN_0045f720(quad)      ; drop the old quad
464b02  al = show
464b06  if (show) FUN_004649f0(this)      ; build a fresh wash quad
464b11  this->visible (+0xe3) = show
```

`FUN_00466d80` (the overlay pass) tests that byte at `0x00467215` and calls
the drawer `FUN_00464ee0` at `0x00467221`. No tween, no timer, no partial
height anywhere on the path.

**The height is computed from the text, in pixels.** The drawer:

```
464f96  push 0x14                      ; 20
464f98  call [eax+0x1c]                ; mainConsole->getLines(20, &out)
464fb0..464fc3  nLines = (out.end - out.begin) / 0x1c
464fc7  eax = textObject->vtable[0x14](...)    ; a line's height
464fca  inc eax                                 ; lineHeight + 1
464fcb  imul eax, edi                           ; * nLines
464fce  add  eax, 4
465003  renderer->vtable[0x40](...)             ; screen metrics; height at [esp+0x24]
465010  [esp+0x28] = 1.0f                       ; quad width, normalised
465020  fdivr                                   ; frac = bandPx / screenHeight
465033  FUN_00608530(quad, {1.0f, frac})        ; setSize
46503e  FUN_00608ae0(quad)                      ; draw
```

so

```
bandPx = (lineHeight + 1) * lineCount + 4          lineCount = getLines(20).size()
quad    = full width (1.0), bandPx / screenHeight tall
```

The boot-time GDI console `FUN_004650d0` asks for the same 20 lines
(`0x0046516f`) and draws them white-on-black with a `courier new` GDI font at
height 12, weight 700 (`CreateFontA` in `FUN_00461260`, `0x004612ac`). That
one is the *pre-device* console — it paints on the window DC with `TextOutA`
and a `BLACK_BRUSH` `FillRect`. It is not the console in the capture.

**Why the capture is 39%.** 20 lines × a 22 px pitch + 4 = 444 px, and
444/1124 = 39.5%; the capture measures 442 px / 39.3%. The band is therefore
not a fraction of the screen at all — it is an absolute pixel height that
*happened* to be 39% at that resolution, and it shrinks when the scrollback is
short, because `getLines` does not pad (see §7).

## 3. The wash

`FUN_004649f0`, run by the show setter every time the console opens:

```
texture   "texture/white.tga"
quad      FUN_00608a70(texture, &pos, &size, 2, 0x3f000000)   ; mode 2, alpha 0.5f
then      FUN_006084c0(quad, 1)                               ; mode  -> 1
          FUN_006084e0(quad, 0x3f4ccccd)                      ; alpha -> 0.8f
```

Blend mode 1 resolves in `FUN_00608560` at `0x006085e8` to
`FUN_0045ff10(5, 6)`, which is `SetRenderState(D3DRS_SRCBLEND = 0x13, 5)` and
`SetRenderState(D3DRS_DESTBLEND = 0x14, 6)` on the device at `ds:0x9c0184`
(`SetRenderState` at device +0xc8 = 200) — **D3DBLEND_SRCALPHA /
D3DBLEND_INVSRCALPHA**, ordinary alpha blending.

The vertex colour is built at `0x006085b4` as `(int)(alpha * 255.0f) << 24`
(the 255.0f is at `0x008d1a70`), so RGB comes from the white texture and alpha
from the quad.

**The wash is `rgba(255, 255, 255, 0.8)`.** That is 204/255, and the viewer's
canvas reads back exactly `[255, 255, 255, 204]` inside the band.

## 4. The font

**`font/BF1942.font` — the HUD's bitmap font, not a separate face.**

`FUN_00460e40` creates the text object at `Setup+0x2d8 + 0x08`
(`(*DAT_009a4f50 + 0x28)()`) and loads `"font/BF1942.font"` into it through
that object's vtable slot `+0x0c`. The drawer reads the *same* `+0x08` for
every line (`0x00465056`). The three functions are called on one object:
`FUN_00460e40` on `[esi+0x2d8]` at `0x004544d1`, `FUN_004650d0` on `[esi+0x2d8]`
at `0x0044ae47`, and `FUN_00466d80` (which calls the drawer) on `[esi+0x2d8]`
at `0x0044ae63`.

The design doc calls the console face "a small black sans face quite unlike
the HUD font". That reading is right about the *look* and wrong about the
*file*: `BF1942.font` is a small sans, and the HUD draws it scaled up for kill
messages, which is why the two do not look alike. Drawn 1:1, as the console
draws it, it is exactly the face in the capture — see the verification shot in
§10.

Layout, per line, from the drawer's loop:

```
465060  h = textObject->vtable[0x14](line)     ; sets the text, returns its height
465063  inc eax
465064  imul eax, ebx                          ; * i
465067  add  eax, 2
465078  push 0x40000000                        ; x = 2.0f
46507d  call [ebp+0x10]                        ; draw(x, y)
```

so line *i* sits at `x = 2`, `y = (h + 1) * i + 2`.

`Font.rfa` as installed is the 2012 double-size replacement: 256×256 atlas,
header `Height` 20, `BetweenWidth` 0, `SpaceWidth` 5. The untouched 2004 file
in `Mods/bf1942/Archives/Font-Original.zip` is 128×128, Height 11,
BetweenWidth 1, SpaceWidth 1. The user's capture was taken on the installed
copy; `extract_console_font.py` defaults to it and takes `--original` for the
other.

**UNVERIFIED:** the text object's `vtable[0x14]` returns *one more* than the
font header's `Height` — 21 rather than 20 — if the capture's 22 px pitch is
right. That function was not disassembled, so the +1 is inferred from the
capture, not read. The viewer uses `Height + 2` for its pitch, which
reproduces the measured 22, and `console.js` takes the pitch as a parameter so
the arithmetic stays the engine's either way.

**UNVERIFIED:** the text colour. The capture is black; the colour is set on
the text object somewhere this pass did not reach.

## 5. The prompt, and how a line is echoed

The prompt is **`"> "`** — two characters, set in the constructor: the client
writes the literal at `0x008c3978` (ctor `0x005a2230`), lnxded the identical
two bytes at `0x086eb09f` (`0x083dc0be`). `setPrompt` (lnxded `0x083ec350`)
appends a space to whatever it is handed, so a prompt always ends in one.

The echo is literally `prompt + line`, pushed into the scrollback through
`output`:

```
83ea611  eax = this + 0x168                 ; the prompt member
83ea618  string copy of it
83ea62d  .append(line)
83ea63b  call [edx+0x10]                    ; output()
```

which is the capture's `> game.showHud`.

## 6. The error strings, and what the number counts

`executeLine` switches on `handleCommand`'s return (`0x083e9f5d`…`0x083e9f77`):
1 is quiet success, 2 prints. The printing path at `0x083ea1b7` builds two
messages out of four literals:

| literal | lnxded | client |
|---|---|---|
| `"Error "` (trailing space) | `0x086e38c8` | `0x008d1f6c` |
| `" ("` (leading space) | `0x08706306` | `0x008d7a24` |
| `"): "` | `0x086b9c63` | `0x008d1fe0` |
| `": "` | `0x086f24a2` | `0x008d1fe4` |

```
"Error " + workingFile + " (" + lineNumber + "): " + theLine
"Error " + workingFile + ": "  + message
```

`workingFile` is `this+0x1cc`, a `std::string`, **empty for a line typed at
the console**. That is the whole explanation of the capture's spacing:
`"Error "` ends in a space and `" ("` starts with one, so an empty working
file gives

```
Error  (2): game.showHud
Error : Unknown object or method!
```

— two spaces in the first, one in the second. Inside a `.con` file the same
two lines carry the file name between them.

There is also a one-line short form, `"Error: " + message` (lnxded
`0x086e38c0`, used at `0x083ea18d`), taken when the caller passes different
bools. The interactive console takes the two-line form.

**The number is a line counter**, `this+0x1d0`:

* incremented once per `executeLine`, at `0x083e9f89`–`0x083e9f90`, gated on
  one of the call's bool arguments;
* the increment sits **past** the switch, so the number printed is how many
  lines the console had already run, not counting this one;
* `OldConsole::run` saves it, **zeroes it** (`0x083ec6f1`) and restores it
  around a `.con` file, so inside a file it is the line number within that
  file.

So `(2)` in the capture means the client console had executed two lines at
top level before the player typed. The client does run top-level lines —
`console.workingPath ""` is a literal at `0x00914214`, and the client writes
and runs `BuddyList.con` (`0x008d6238`), which is where the capture's first
line comes from: the format string is `@Adding <%s> (%d) to buddylist` at
`0x008d62a7`. **UNVERIFIED:** what the leading `@` means — it is not in the
drawn text, so something strips it, but that path was not read.

The dispatcher's full message set, one block in each binary (client
`0x00902cb8`–`0x00902d3c`, lnxded `0x086eb01d`–`0x086eb07d`):

```
Method is not active!
Property is only setable!          <- one t, in both binaries
Property is only readable!
Unauthorised method!
Unknown object or method!
```

plus, from the argument checks, `Too few arguments, the min no of arguments is N!`
(`0x083e45ee`), `Too many arguments, the max no of arguments is N!`
(`0x083e65b3`), `Properties only takes one argument!` (`0x083e67e5`) and
`Wrong syntax!` (`0x083e34ad`).

## 7. History, completion, scrolling — and the `+++` line

`updateAsciiKey(char)` (lnxded `0x083ea900`) folds every console key into one
char:

| char | branch | what it does |
|---|---|---|
| `0x0d` Enter | `0x083eaba7` | appends `\n`, calls `executeLine(line, out, 1,1,1,0,0)` through vtable `+0x08`, then clears the buffer |
| `0x08` Backspace | `0x083eab93` | length -= 1. **There is no cursor** — it always removes the last character |
| `0x7f` Delete | `0x083eab80` | clears the whole line |
| `0x09` Tab | `0x083eab6e` | `autoCompletion()` |
| `0x10` / `0x0e` | `0x083eaa35` | history back / forward, over a `deque<string>` |
| `0x02` / `0x06` | `0x083ea9bf` | scroll a page up / down |

`updateGameInput` (lnxded `0x083eac60`) consumes exactly four game inputs and
turns each into one of those chars — it tests bits 3, 4, 12 and 13 of the
`GameInput` changed-mask at `+0xbc`/`+0xc0` and calls vtable `+0x14`:

| input | ordinal | char pushed | at |
|---|---|---|---|
| `c_GIUp` | 3 | `0x10` | `0x083ead8b` |
| `c_GIDown` | 4 | `0x0e` | `0x083ead78` |
| `c_GIPageUp` | 12 | `0x02` | `0x083ead68` |
| `c_GIPageDown` | 13 | `0x06` | `0x083ead54` |

`c_GILeft` (5) and `c_GIRight` (6) are bound in the control map and the
console never reads them. **Arrow left/right do nothing in the console.**

Scrolling is by whole pages. The page size is `this+0x16c`, **8**, from the
constructor (client `param_1[0x57] = 8`, lnxded `0x083dc0d6`). The offset is
clamped into `[0, floor(totalLines / 8) - 1]` (`0x083ea9f0` divides,
`0x083eaa13` clamps at zero with the `shr 31 / dec / and` idiom, `0x083eaa27`
at the top).

`getLines(n, out)` (lnxded `0x083ec0e0`):

1. up to `n - 1` scrollback lines, starting at
   `total - (n - 1) - scroll * 8`, clamped at 0;
2. then one more line: `prompt + editLine` when the offset is zero, or —
   when it is not — **sixty `+` characters** (`0x086e38e0`, client copy
   `0x00903448`), with one fewer scrollback line emitted to make room
   (`0x083ec170` `dec edi`).

It **does not pad**: when the scrollback is shorter than `n - 1` it returns
`total + 1` lines (`0x083ec147` jumps past the clamp), which is why a console
nobody has written to opens as a thin strip.

Other constructor defaults: max line length `this+0x160` = **77**
(client `param_1[0x4e] = 0x4d`, lnxded `0x083dc0a3`) — the edit buffer is
inside the object at `this+0x60`, which is why it is fixed; and **10000**
at `this+0x1bc` (client `param_1[0xbf]`, lnxded `0x083dc14c`) with a **10** at
client `param_1[0xd]`. `setMaxHistorySize` writes `+0x2c` and
`setMaxCommandHistorySize` writes `+0x5c` in the gcc layout; **UNVERIFIED**
which of 10000 and 10 is which in the client's MSVC layout, because the two
class layouts differ (MSVC's `std::string` is 0x1c bytes, gcc's is 4).

`autoCompletion` (lnxded `0x083e83a0`) walks
`ConsoleObjects::getConsoleObjects()` (`0x083e8684`), splits the edit line on
`.` (`0x083e87d8`) and prefix-matches the object half and the method half with
`strncasecmp` (`0x083e8862`, `0x083e89a2`), writing the result back with
`strncpy` (`0x083e8b07`). The candidate list it prints is assembled from
` (`, `, `, `)` and ` -> ` (`0x083e9303`, `0x083e933e`, `0x083e936e`,
`0x083e922e`) — argument types and a return type.
**UNVERIFIED:** whether it completes to the longest common prefix or to the
first match. The viewer does the former.

## 8. How a line is split — and `=`

`handleCommand` (lnxded `0x083de990`):

1. Take the first whitespace-delimited token.
2. Compare it, **case-insensitively** (`strcasecmp`, `0x083e41b1` and
   `0x083e41ef`), against the script keywords: `rem`, `beginRem`, `endRem`,
   `if`, `elseIf`, `else`, `endIf`, `while`, `endWhile`, `return`, `quit`,
   `exit`, `var`, `const`, `echo`, `run`, `include`, `alias`, `listalias`,
   `unalias`, `beginNoExecution`, `endNoExecution`.
3. Otherwise scan the token for the **first `.`** (`0x083e422d`
   `cmp BYTE PTR [edi+ebx*1],0x2e`) and `substr(0, i)` (`0x083e4244`): before
   it is the object, after it is the method. A token with no dot never
   reaches the object table.
4. Arguments come from `getArgs` (`0x083de4d0`): whitespace-delimited tokens
   off an `istringstream`, except one opening with `"` (0x22, tested at
   `0x083de8cf`), which runs to the closing quote and may contain spaces.
5. Look the pair up; check access, `isActive`, then min/max argument counts.

**`=` is not accepted between a method and its arguments.** The only `=` the
dispatcher understands is in `var v_x = 1` / `const c_x = 1` and in assignment
to an existing `v_` variable — the two compare sites are `0x083e14c3` (inside
the `var`/`const` branch, message `"var" syntax: (variableName [= initValue])!`)
and `0x083e78ce`, which leads straight to `setVariable`. `getArgs` has no `=`
case at all. In the retail game `show.dev = 1` would hand the method two
arguments.

Surveyed to check: **zero** lines of the form `object.method = value` in the
86 loose `.con`/`.inc`/`.tweak` files in the install.

The viewer accepts it anyway — `console.js` drops a single leading `=`
argument, and nothing else — because that is the spelling the page's own users
were told to type. It is this reconstruction's one deliberate divergence, and
it is commented as such at the call site.

## 9. Commands that really exist in 1.61

`game.showHud` **does not**. `showHud` appears nowhere in `BF1942.exe`'s
string table; `useHud` does, once. The real command is **`game.useHud`**, and
the game's own `Mods/bf1942/Settings/AliasedCommands.con` aliases `hud` to
`game.usehud` (lowercase, which works because the lookup is case-insensitive —
the binary spells the method `useHud`).

That file is the honest list, shipped with the game, every line of which the
engine parses at boot. The method half of each is also a standalone string in
`BF1942.exe` — checked with `strings -n 3 BF1942.exe | grep -cxF <name>`, one
hit each, in the spelling below (the aliases are lower-cased because the
lookup is case-insensitive; see §8):

| command | alias it ships with |
|---|---|
| `game.listPlayers` | `listplayers`, `players`, `lp` |
| `game.listMaps` | `listmaps`, `lm` |
| `game.useHud` | `hud` |
| `game.suicide` | `suicide` |
| `game.buddyList` | `buddylist` |
| `game.addPlayerToBuddyList` | `addbuddy`, `buddy`, `ab` |
| `game.removePlayerFromBuddyList` | `removebuddy`, `unbuddy`, `rb` |
| `game.changePlayerName` | `name` |
| `game.voteMap` | `votemap`, `vm` |
| `game.voteKickPlayer` | `kick` |
| `game.TKPunish` / `game.TKForgive` | `punish` / `forgive` |
| `game.sayAll` | `say`, `speak` |
| `game.EnableFreeCamera` | `freecam` |
| `console.showFPS` (and `showStats` beside it) | `fps` |
| `chat.ignoreList`, `chat.addToIgnoreList`, `chat.removeFromIgnoreList` | `ignorelist`, `ignore`, `unignore` |
| `chat.chatInfo`, `chat.setChatHistory`, `chat.killMessageSize`, `chat.gameInfoMessageSize`, `chat.chatMessageSize`, `chat.oldChatListStyle` | `textinfo`, `textsizes`, `killtext`, `flagtext`, `chattext`, `oldtext` |
| `admin.runNextLevel`, `admin.restartMap`, `admin.changeMap`, `admin.setNextLevel` | `nextmap`/`nm`, `restart`/`rm`, `load`/`map`/`loadmap`, `setnextmap` |
| `admin.kickPlayer`, `admin.banPlayer`, `admin.listBannedAddresses`, `admin.clearBanList` | `adminkick`/`akick`, `ban`, `banlist`, `clearbans` |
| `admin.enableRemoteConsole`, `admin.enableRemoteAdmin`, `admin.timeLimit`, `admin.scoreLimit`, `admin.setNrOfRounds` | `remoteconsole`, `remoteadmin`, `timelimit`, `scorelimit`, `roundlimit` |
| `admin.toggleGamePause` | `pause`, `unpause` |

(`buddyList` at `0x008c7154`, `showFPS` at `0x008d0edc`, `showStats` at
`0x008d0fc4`, `EnableFreeCamera` with the capital E — the alias file's
lower-case spellings are not what the binary carries, and only work because
the lookup folds case.)

The client's own string table also carries whole command lines it builds and
runs — `game.addLevel %s %s %s` (`0x008d28b0`), `game.setCurrentLevel `
(`0x008d2898`), `game.addPlayerToBuddyListByName "%s"` (`0x008d6248`),
`console.workingPath ""` (`0x00914214`), `admin.enableRemoteConsole `
(`0x008d2748`), and the whole `playerStats.set*` family from `0x008c424c`.

The console object names themselves are a list at `0x008d19a0`–`0x008d1a08`:
`Debug`, `ToolHandler`, `PlayerStats`, `Game`, `Chat`, `Admin`, `Renderer`,
`Shadow`, `Hud`, `Console`, `Sound`, `Menu`, `Vars`.

`show.dev` is **not** one of the engine's — there is no `show` object in 1.61.
It is the viewer's own word, registered through the same registry so that it
behaves like a real one.

The registry's shape comes from bf42plus's `src/bf/console.h`, which hooks
these objects in the live client and documents the `ConsoleObject` field
layout (`type` 1 read/write / 0 read-only / 2 write-only, `objectname`,
`functionname`, `access`, `minargcount`, `maxargcount`, `argdesc[]`,
`retdesc`). A registrar reads exactly that way — e.g. `FUN_004dfe20` fills
`+0x08` from a shared global, `+0x0c` with the literal `"vehicleIcon"`,
`+0x04` = 1, `+0x14` = 0, `+0x18` = 1, `+0x4c` = `"std::string"`.

---

## 10. What the viewer now does

`tools/bf1942-models/viewer/console.js` — free of `three`, so
`tests/console_harness.mjs` drives it under plain node
(`tests/test_console.py`, 26 tests).

* Tilde (`Backquote`) toggles it; Escape closes it.
* While it is open it eats the keyboard (`keydown`/`keyup`), mouse-look
  (`pointermove`) and both triggers (`buttonChange`). The pointer lock is
  kept, so closing drops you straight back into play.
* `> ` prompt, `prompt + line` echo, the two-line error, the 77-character
  edit buffer, Backspace/Delete/Tab/Up/Down/PageUp/PageDown as above, the
  sixty-`+` scrolled-up line, and all nine dispatcher messages verbatim.
* Drawn on its own canvas: the white wash at alpha 0.8, full width,
  `(pitch) * lines + 4` tall, text at x = 2 and `y = pitch * i + 2`, in
  `Font/BF1942.font` glyphs tinted black — the atlas is extracted by
  `extract_console_font.py` into `viewer/fonts/bf1942.{png,json}`.
* `show.dev 1`, `show.dev = 1` and `show.dev 0` reveal and hide `#side` and
  its `Maps` fab. Both are absent for a regular player. Nothing leaves the
  DOM — only `display` changes — so `__setOnFoot`, `__deploy`, `__renderOnce`,
  the `?shots` flow and every `optOnFoot.checked` read in `map.html` are
  untouched. `?dev=1` is the same gate for tooling.
* The level's own load facts go into the scrollback on `show()`, the way the
  client fills `io::mainConsole` while it loads. That is what gives the band
  its height.
* Later streams add commands with
  `window.__console.register({ object, method, minArgs, maxArgs, argTypes, returns, run })`.

### Verified against the capture

Served from this worktree on `:5312`, driven with Playwright and real key
events, over Wake, composited at the capture's own 2000×1124:

| the design doc says | measured |
|---|---|
| full width, top of the screen | quad width 1.0, band at y = 0 |
| a flat translucent white wash, the scene showing through desaturated | canvas reads `[255, 255, 255, 204]` inside the band, `[0,0,0,0]` below it |
| no border, no title | none drawn |
| text at the bottom left, growing upward | top-aligned draw of `[older…, prompt]`, so the newest line is last |
| a small black face | `[0, 0, 0, 255]` ink, 380 ink rows in a 444 px band |
| line pitch 22 px | 22 px |
| 39% of a 1124 px screen | 444 px = 39.5% at 20 lines; 356 px = 31.7% at the 16 the page had |
| `> game.showHud` / `Error  (2): …` / `Error : …` / `>` | reproduced byte for byte (the page's counter reads `(0)`, its own session count) |

The band's fraction is not a constant: it is `lines × pitch + 4` px. 39% is
what that comes to at 20 lines on a 1124 px screen.

Shots: `console-over-wake-2000x1124.png` and `console-wake.png` in the
stream's scratch directory.

## 11. Left open

* The text colour, and the text object's `vtable[0x10]`/`[0x14]` (the draw and
  set-text calls) — the object at `Setup+0x2d8 + 0x08` is not a bare `Font`
  (its slot 0x10 is not `Font`'s), so its own vtable was not walked.
* Whether `autoCompletion` completes to the longest common prefix or the
  first match, and the exact layout of the candidate list it prints.
* Which of the constructor's 10000 and 10 is the scrollback cap and which the
  command-history cap in the client's MSVC layout.
* `handleCommand` result codes 0 and 3 — `executeLine` has branches for both
  (`0x083ea4c3`, `0x083ea069`) that this reconstruction does not model.
* The flow-control keywords (`if`/`while`/`var`/`const`/`alias`/`run`) are
  listed so the parser does not mistake them for object names, but none is
  implemented.
* A live cross-check against a running `bf1942_lnxded` was attempted and
  abandoned: the binary needs a 32-bit `libncurses.so.5` (shimmed
  successfully from `libncursesw.so.6`) and then a full lowercase mod tree,
  which would mean copying ~1.5 GB out of the wine install. The disassembly
  reproduces the capture exactly, so the live run was not worth the disk.
