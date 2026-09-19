# The BF1942 console, read out of the binaries

Stream B of the [2026-09-19 parity round](../bf1942-parity-round-2026-09-19/README.md).
Everything here carries the address it came from. Anything that could not be
read out of a binary is marked **UNVERIFIED** in so many words.

Re-derived line by line on 2026-09-19 by the stream's reviewer. Five claims
did not survive the second reading and are corrected in place, each marked
"(review)": the scrolled-up `+` marker is an extra row rather than a
replacement for the prompt (§6); `Error  (N)` is a `.con` file's line number
and a typed line never moves it (§4); the two deque caps are 1024 and 10,
not 10000 (§6); `output` closes a line at 78 characters as well as at a
newline (§6); and every key but the page keys zeroes the scroll offset
(§6). The wash's alpha turned out to go through `D3DRS_TEXTUREFACTOR`
rather than a vertex colour (§3), and the Caps Lock binding is a real
conflict with the page's spawn key (§1).

Two binaries, one class. The Linux dedicated server names it
`dice::ref2::io::OldConsole`; the retail client is the same code, stripped.
The `.con` dispatcher is common to both; the drawn console is client only.

| | client `BF1942.exe` (`60c9452d…cd3699`) | lnxded 1.61 (`bf1942_lnxded.static`) |
|---|---|---|
| constructor | `0x005a2230` | `0x083dbfc0` |
| vtable | `0x009033a8` | `vtable for dice::ref2::io::OldConsole` |
| the singletons | `0x009a9420` (`new OldConsole(true)`), `0x009a9424` (`false`), both built at `0x00856720` / `0x00856750`, object size `0x918` | `dice::ref2::io::mainConsole` `0x087b8adc` |
| `handleCommand` | — | `0x083de990` |
| `executeLine` | client vtable `+0x04` = `0x005a0df0` | `0x083e9ae0`, gcc vtable `+0x08` |
| `getLines` | client vtable `+0x1c` = `0x005a1fa0` | `0x083ec0e0` |
| `output` | gcc vtable `+0x10` | `0x083dcf50` |
| `updateAsciiKey` | client vtable `+0x10` = `0x005a1340` | `0x083ea900` |
| `update(char)` | client `0x005a2090` | `0x083eddd0` |
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

**That spending is the page's invention, and it collides with the game.**
Checked (2026-09-19, review) against every shipped control map: 1.61 has
**no key that opens the spawn screen**. `grep -i "spawn\|deploy"` over
`Settings/Default/Controls/*.con` returns nothing but the Caps Lock console
line, and the engine's whole `c_GI*` constant set — 36 names in the client's
string table, 46 in the server's — contains no deploy, spawn or kit input at
all. The deploy screen is entered by the game's own flow (on join, and on
death), not by a keystroke; `c_GIInGameMenu` on Enter is the Esc-style menu,
not the spawn screen.

So Caps Lock's only 1.61 meaning is *toggle console*, and `map.html` line
1634 gives it to `openDeploy()`. **As the branch stands nothing does two
things at once** — `GameConsole.isToggleKey` tests `Backquote` alone, and
driving the page confirms Caps Lock opens the deploy screen and never the
console. But the page is one key short of parity and the obvious key is
taken.

Recommendation, for whoever owns the deploy screen (not this stream):
leave Caps Lock on the console, as the game has it, and move redeploy to a
key the game does not spend. The page already offers `M` and `Shift+R` for
exactly that, and `#hud` already advertises both. That frees Caps Lock to
join Grave as the second console toggle, which is what a player who knows
BF1942 will press.

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

Corrected 2026-09-19 (review): the `(int)(alpha * 255.0f) << 24` built at
`0x006085b4`–`0x006085c5` (the 255.0f is at `0x008d1a70`) is **not** a vertex
colour. It is handed to `FUN_005b84e0`, which is
`SetRenderState(D3DRS_TEXTUREFACTOR = 0x3c, colour)` — `0x005b84fb` pushes
`0x3c`, `0x005b8506` calls device `+0xc8`. So for alpha 0.8 the device's
texture factor is `0xCC000000`.

Blend mode 1's own block then sets only the **alpha** pipeline:
`0x006085e8` calls `FUN_004604e0(stage = 0, op = 2, arg1 = 3, arg2 = 0)`, and
`FUN_004604e0` is `SetTextureStageState(stage, D3DTSS_ALPHAOP = 4, op)` /
`(…, D3DTSS_ALPHAARG1 = 5, arg1)` / `(…, D3DTSS_ALPHAARG2 = 6, arg2)` —
i.e. `ALPHAOP = D3DTOP_SELECTARG1`, `ALPHAARG1 = D3DTA_TFACTOR`. The alpha
is the 0.8 out of the texture factor; the colour stage is left alone, so RGB
stays the texture's.

(The neighbouring `FUN_00604500` at `0x006085a5` is the *filter* setter —
`D3DTSS_MAGFILTER = 0x10`, `MINFILTER = 0x11`, `MIPFILTER = 0x12` — called
with point filtering, which is why the bitmap font is crisp. `FUN_0045ffc0`
at `0x0060856f` is `SetRenderState(D3DRS_ZENABLE = 7, 0)`.)

The blend enums are the D3D8 header's, checked against
`/usr/include/wine/windows/d3d8types.h`: `D3DBLEND_SRCALPHA = 5`,
`D3DBLEND_INVSRCALPHA = 6`, `D3DRS_SRCBLEND = 19 = 0x13`,
`D3DRS_DESTBLEND = 20 = 0x14`.

And the texture really is white: `texture/white.tga` in
`Mods/bf1942/Archives/texture.rfa` is an 8×8 uncompressed 24-bit TGA whose
192 pixel bytes are all `0xff`.

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

**The number is a `.con` file's line number**, `this+0x1d0` — and a line
typed at the console never moves it. Re-derived 2026-09-19 (review):

* the increment at `0x083e9f89`–`0x083e9f90` sits **past** the dispatch
  switch **and behind** `cmp BYTE PTR [ebp-0x8b5],0` at `0x083e9f7d`.
  `ebp-0x8b5` is `executeLine`'s **fifth bool parameter**, stored from
  `ebp+0x24` at `0x083e9b0d`. The client is the same shape: `cmp byte ptr
  [ESP+0x768], BL` at `0x005a12a5`, then `INC dword ptr [ESI+0x328]`.
* the same bool also selects the access level — true means `AccessType` 7
  unconditionally (`0x083ea503`), false means 7 or 1 depending on
  `this+0x184 & 2` (`0x083e9f3d`).
* **`updateAsciiKey`'s Enter branch passes it false.** It pushes
  `0, 0, 1, 1, 1` before the vtable call (lnxded `0x083eabe5`–`0x083eabf5`;
  client `0x005a1381`–`0x005a1397`), i.e. `b1..b3 = true`, `b4 = b5 =
  false`. `executeLines` (`0x083ea83b`) passes false too.
* **`OldConsole::run` passes it true**, pushing `1, 0, 0, 0, 0` at
  `0x083ecafd`–`0x083ecb0a` — and `run` also saves the counter
  (`0x083ec6d3`), zeroes it (`0x083ec6f1`) and restores it (`0x083ecbac`)
  around the file, as does `include` (`0x083ed3f1` / `0x083ed415` /
  `0x083ed8d3`).

So inside a `.con` file the number is that file's line number, and at the
interactive prompt it is whatever ambient value the console happens to hold
— **the same number on every error of the session**, not a running count. A
client that has finished its boot `run()`s holds 0, which is what this page
prints and keeps printing.

The capture's `(2)` is therefore that client's ambient value, and this
reconstruction cannot derive it: it would take the one path that leaves the
counter non-zero at top level, and no such path was found. Inventing a 2
would be a lie about a counter that does not count. **UNVERIFIED:** where
the owner's 2 came from. A cheap test on a live client settles it — type two
bad commands in a row; if both print the same number, this reading is right.

The capture's first line comes from the client's own buddy list: the format
string is `@Adding <%s> (%d) to buddylist` at `0x008d62a7`, and the client
writes and runs `BuddyList.con` (`0x008d6238`). **UNVERIFIED:** what the
leading `@` means — it is not in the drawn text, so something strips it, but
that path was not read.

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
   `total - (n - 1) - scroll * 8`, clamped at 0 — **one fewer** when the
   offset is non-zero (`0x083ec170` `dec edi`);
2. then, **only** when the offset is non-zero, **sixty `+` characters**
   (`0x086e38e0`, client copy `0x00903448`), pushed at `0x083ec28f`;
3. then, **always**, `prompt + editLine`.

Step 3 is the correction (re-derived 2026-09-19, review): the marker is an
extra row *above* the prompt, not a replacement for it. The marker block
ends at `0x083ec2cd` / `0x083ec2df`, both of which land on `0x083ec1ff` —
the same instruction the no-marker path reaches from `0x083ec1f6` — and
`0x083ec1ff` onward `strlen`s the edit buffer at `this+0x60`, appends it to
the prompt copy and pushes that into the vector. The client agrees:
`0x005a2037` `JZ 0x005a2060` skips only the marker, and `0x005a2060` (which
appends `this+0x38` to the prompt) is on every path. So the view is `n`
lines whether or not you have paged up, the band does not change height,
and you can still see what you are typing.

It **does not pad**: when the scrollback is shorter than `n - 1` it returns
`total + 1` lines (`0x083ec147` jumps past the clamp), which is why a console
nobody has written to opens as a thin strip.

**Every key resets one of the two offsets.** The common tail at
`0x083ea973`, which every branch of `updateAsciiKey` falls into — Enter via
`0x083eac29`, Tab via `0x083eab77`, Backspace via `0x083eab93` — computes

```
[this+0x174] = (ch == 0x10 || ch == 0x0e) ? [this+0x174] : 0   ; history index
[this+0x170] = (ch == 0x02 || ch == 0x06) ? [this+0x170] : 0   ; scroll offset
```

as two `imul` by a 0/1 flag (`0x083ea98b`, `0x083ea9a0`). Typing anything at
all snaps the view back to the bottom; anything that is not Up/Down drops
you out of the history walk.

Other constructor defaults: max line length `this+0x160` = **77**
(client `[esi+0x138] = 0x4d` at `0x005a2275`, lnxded `0x083dc0a3`) — the
edit buffer is inside the object at `this+0x60` (client `this+0x38`), which
is why it is fixed.

**The two deque caps are 1024 and 10** (settled 2026-09-19, review; the
earlier reading of 10000 was wrong):

* `setMaxHistorySize(int)` (lnxded `0x083edf60`) writes `this+0x2c`, and
  `this+0x2c` is exactly what `OldConsole::output` compares the **scrollback**
  deque's size against before popping from the front (`0x083dd018`). The
  constructor sets it to `0x400` = **1024** — lnxded `0x083dc037`, client
  `0x005a224c` `[esi+0x18]`.
* `setMaxCommandHistorySize(int)` (`0x083edff0`) writes `this+0x5c`, the cap
  of the second deque (`this+0x3c`..`this+0x5c`) that Up/Down walks at
  `0x083eaa35`. The constructor sets it to **10** — lnxded `0x083dc09c`,
  client `0x005a226e` `[esi+0x34]`. The retail console remembers ten
  commands.
* The **10000** at lnxded `this+0x1bc` (`0x083dc14c`) / client `this+0x2fc`
  (`0x005a22ea`) is a third member. Neither history setter writes it and no
  reader in `handleCommand`, `output` or `getLines` touches it.
  **UNVERIFIED:** what it is.

**`output` wraps as well as splits.** `OldConsole::output` (`0x083dcf50`)
copies into a stack buffer one character at a time and closes the current
scrollback line on a NUL, on `\n` (`0x083dcf9c`) **and on the buffer
filling** — `cmp ecx,[edi+0x160]` / `jle` at `0x083dcfce`, where
`[edi+0x160]` is `maxLineSize`. The `jle` is why a chunk is 78 characters
and not 77. So `Error  (0): ` plus a 77-character command is two scrollback
lines in the real console, and the band is a row taller.

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

**`=` is not accepted between a method and its arguments.** Re-derived
2026-09-19 (review), and the evidence is stronger than the original pass
said: `handleCommand` contains **no `cmp …,0x3d` at all**, and the whole
binary compares a token against the `"="` literal (`0x086e6da4`) in exactly
**three** places, all inside `handleCommand` and all `std::string::compare` —
`0x083e14c3` and `0x083e1a43` (the `var` and `const` branches, message
`"var" syntax: (variableName [= initValue])!`) and `0x083e78ce` (assignment
to an existing `v_` variable, straight into `setVariable`). The original
report listed two of the three. `getArgs` tests only 0x20 and 0x22. In the
retail game `show.dev = 1` hands the method two arguments and fails the
count.

Surveyed to check: **zero** lines of the form `object.method = value` in the
86 loose `.con`/`.inc`/`.tweak` files in the install.

The viewer accepts it anyway, because that is the spelling the page's own
users were told to type. It is this reconstruction's one deliberate
divergence and it is fenced so it cannot reach anything else: the `=` is
stripped from the **raw** argument text by `/^\s*=(?=\s|$)/` in
`splitCommand`, before tokenising. Anchored at the start, so a quoted `"="`
cannot match (the first non-space character is then `"`); followed by
whitespace or end of line, so `=1` stays the single argument `=1`, exactly
as the engine would pass it; and only in the `object.method` branch, so no
keyword line is touched. `tests/test_console.py`
`test_the_equals_divergence_cannot_touch_any_other_line` is the guard.

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
(`tests/test_console.py`, 35 tests).

* Tilde (`Backquote`) toggles it; Escape closes it.
* While it is open it eats the keyboard (`keydown`/`keyup`), mouse-look
  (`pointermove`) and both triggers (`buttonChange`). The pointer lock is
  kept, so closing drops you straight back into play.
* `> ` prompt, `prompt + line` echo, the two-line error, the 77-character
  edit buffer, Backspace/Delete/Tab/Up/Down/PageUp/PageDown as above, the
  sixty-`+` scrolled-up row **above** a prompt line that is always drawn,
  the scroll/history resets on every other key, `output`'s 78-character
  wrap, the 1024-line scrollback and the 10-line command history, and all
  nine dispatcher messages verbatim.
* Tab is swallowed whether or not anything completed: an unprevented Tab
  moves focus to the shell nav links, one Enter away from leaving the map.
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
| `> game.showHud` / `Error  (2): …` / `Error : …` / `>` | reproduced byte for byte (the page's counter reads `(0)`, and keeps reading `(0)` — see section 4) |

The band's fraction is not a constant: it is `lines × pitch + 4` px. 39% is
what that comes to at 20 lines on a 1124 px screen.

Shots: `console-over-wake-2000x1124.png` and `console-wake.png` in the
stream's scratch directory.

### Driven again, adversarially (2026-09-19)

Served on `:5322`, Playwright, real key events, Wake. The band at the
capture's own 2000×1124 with the five capture lines measures 114 px —
`22 × 5 + 4`, the drawer's arithmetic — reading `[255,255,255,204]` inside
and `[0,0,0,0]` below. What was checked at runtime, beyond the table above:

| probe | result |
|---|---|
| open while `KeyW` is held | `__keys` goes `["KeyW"]` → `[]`; nothing fires; closing and releasing leaves `__keys` empty |
| type `w a s d e space 1..5 c m n` | all land in the edit line, `__keys` stays empty, `__getFire()` stays at zero |
| pointer-locked (`document.pointerLockElement` non-null) | `__look` moves 0.385 rad with the console shut, **0** with it open, 0.385 again on close — and the lock is never dropped |
| seated (pilot on, Willys) | W and Space go into the line, the vehicle does not move or fire |
| deploy screen up | it stays up; M, Enter and Digit1 all go into the line instead of opening the map, spawning or picking a flag |
| fullscreen map up | it stays up; Escape closes the console and leaves the map |
| Tab | `dispatchEvent` returns false (default prevented) with and without a completion match; focus stays on `BODY` |
| held Backspace / held letter | auto-repeat `keydown`s are consumed one per event |
| more than 77 characters | line stops at 77 |
| a real `paste` `ClipboardEvent` | ignored, no error — the engine has no paste either |
| two identical bad commands | `Error  (0):` both times |
| page up, then type | view is 20 lines with the marker above the prompt; the first character snaps `scroll` back to 0 |
| opened 1.2 s into a stalled level load | opens, accepts a line, prints the error, no page errors |
| `?cam=100,80,100,0.5,-0.2` | camera and look honoured with the panel hidden |
| `__renderOnce`, `__setOnFoot`, `__deploy.spawn`, `__vehicles`, `__teleport`, `__hud`, `__soldier`, `?shots` | all present and working with `#side` hidden |
| console **closed**, 60 `__renderOnce` calls | `console-canvas.getContext` called **0** times: the frame hook returns on one boolean before it allocates anything |

Shots: `rb-console-over-wake.png`, `rb-console-canvas.png`, `phone-plain.png`
and `phone-dev.png` in `scratchpad/rb-console/shots/`.

### On a phone

At 390×844 with touch: `#side` and the `Maps` fab are both `display: none`,
there is no console button anywhere in the DOM, and a phone has no tilde
key — so the console and the debug panel are simply unreachable, which is
the right answer for a player. `?dev=1` is the way in for tooling, and it
does reveal the panel at phone width. The flight controls that are *not*
part of `#side` — `#map-actions`' FAST / FLY / RESET — stay visible on a
phone; they are the touch flythrough's own controls, not the debug panel,
so this stream left them alone.

## 11. Left open

* The text colour, and the text object's `vtable[0x10]`/`[0x14]` (the draw and
  set-text calls) — the object at `Setup+0x2d8 + 0x08` is not a bare `Font`
  (its slot 0x10 is not `Font`'s), so its own vtable was not walked.
  `FUN_00460e40` sets no colour on it, and the drawer's per-line call
  (`0x0046507d`, `[EBP+0x10]` with `x = 2.0f`, `y`, `&string`) carries none
  either, so it is a member or an inherited device state. Still open after a
  second pass; black is the capture's, not the binary's.

  One **hypothesis with an address**, offered because it is cheap to test
  and would close the row: the wash quad is drawn immediately before the
  text and leaves `D3DRS_TEXTUREFACTOR` at `0xCC000000` (`0x005b84fb`, see
  section 3) — RGB zero, alpha 204. If the text quads modulate by TFACTOR
  rather than selecting the texture, the glyphs come out black *and*
  slightly transparent as a side effect of the wash, with no colour set
  anywhere. The test is a pixel sample of a glyph's interior in the owner's
  real capture: a flat `#000000` means the text has its own opaque black and
  the hypothesis is wrong; roughly 20 % of the scene behind bleeding through
  means it is right. The viewer draws flat black either way today.
* Whether `autoCompletion` completes to the longest common prefix or the
  first match, and the exact layout of the candidate list it prints.
* **History walk: wrap or clamp.** `updateAsciiKey` `0x083eaa77` onward
  decrements the index on Up and increments on Down, then **wraps** — a
  negative index becomes `size - 1` (`0x083eab5a`) and an index at `size`
  becomes 0 (`0x083eaa99`) — with no "fresh empty line" state at all. The
  viewer clamps and keeps an empty slot at the end. The first Up after
  typing is identical either way (both give the newest command), so only the
  two ends of the walk differ. Not changed, because which end of the deque
  the new command is pushed onto was not read, and that decides whether
  index 0 is the oldest or the newest.
* Where the owner's capture got its `(2)`: see section 4.
* What lnxded `this+0x1bc` / client `this+0x2fc` (**10000**) is. It is not
  either deque cap — those are `+0x2c`/`+0x18` (1024) and `+0x5c`/`+0x34`
  (10) — and nothing in `handleCommand`, `output` or `getLines` reads it.
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
