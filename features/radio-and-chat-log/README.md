# Radio commands and the message log

The F1..F8 radio and the top-left message log (kills, game information, chat
and radio), rebuilt from the retail client. Merged to main as `d5135a34`.

Binary: `BF1942.exe` sha256 `60c9452d...cd3699` (client addresses), and the
symbolled Linux server (`lnxded` addresses). Data: vanilla `menu.rfa`,
`Game.rfa`, `Objects.rfa`, `sound.rfa`, `lexiconAll.dat`, and the default
profile's `GeneralOptions.con`.

## What was built

| Piece | File |
|---|---|
| Extractor: `menu/RadioMenu` to `radio-layout.json`, the 55 radio icons, `menu/InGame`'s chat box to `chat-layout.json`, every radio and shouted voice line per nation | `tools/bf1942-models/extract_radio.py` (also a step of `extract_hud_mods.py`, `--layout-only`) |
| Menu behaviour: message table, key handler, remaps, chat text, spam limit | `viewer/radio.js` |
| Message log: sections, timers, geometry, colours, line text | `viewer/chat-log.js` |
| Page: overlay canvas, F1..F8, voices, hooks for kills, deaths and captures | `viewer/comms.js`, wired in `map.html`, `page-input.js`, `capture.js`, `net-room.js` |
| Room relay: team radio to the team, shouts within 70 m | `server/rooms.mjs` `#onRadio`, `netcode-client.js` `radio()` |
| Tests | `tests/test_radio_chat.py` (+ `radio_chat_harness.mjs`), `tests/test_extract_radio.py` |

Assets: `maps/_shared/hud/{radio-layout.json,chat-layout.json,radio/}`,
`maps/_shared/voices/<nation>/*.mp3` (54 stems per nation) with
`voices/radio-sounds.json` and `voices/radiomess.mp3`; the same voice trees for
`mods/{xpack1,xpack2,eod}` (Road to Rome adds `it` and `fre`, EoD `fre` and its
own variants); mod packs carry their own `chat-layout.json` (their lexicon's
point names) and EoD its own `radio-layout.json` and four icons (HELICOPTER,
MINES, ...).

## The radio, as the engine does it

- **Key handler `0x006D42A0`** (verified line for line). Category 0 is the
  idle strip; F1..F7 open a page; F8 turns the strip off (category 8) and back
  on. On a page, a key sends (or not) and the menu returns to the strip or to
  off, wherever it came from. F8 on a page cancels. A page left open closes
  after `Radio/RadioTimeOut` (60, from the file).
- **Message ids** (`ai::RadioMessage`, 60 values): `radio.js RADIO_MESSAGES`.
  Pages: F1 1..2, F2 8..14, F3 15..21, F4 control points 22..27 (+ 50
  CLOSEST, resolved by the sender to the nearest point in 3D, owner ignored)
  or the CTF flag orders 55..58, F5 29..32, F6 36..42, F7 43..49.
- **Team radio vs shouts.** Ids < 29, 50 and 55..58 are team radio
  (`0x006D41C0`); the rest are shouted (`0x006D3320`) after the vehicle remap
  `0x006D3200` (Stick together to Get in and Medic to Need repairs in any
  vehicle; Take cover to Check your six in an aircraft; Bail out to Abandon
  ship on a ship).
- **Chat text** (`0x006D3400`, constants checked in raw bytes):
  team radio `"[" grid "] " name ": " body "!"`; a point order's body is
  `" [" point "] " Attack|Defend`, which is the retail double space in
  `[C5] skandia:  [Bridge] Attack!`. `[C5]` is the 8x8 grid square
  (`0x006ACDB0`) of the point, or of the speaker for any other order.
  Attack or Defend is the RECEIVER's call: the point's owner against the
  speaker's team. Shouts print `name ": " text`, and only to the speaker's
  team.
- **Voices.** Team radio: `menu/MenuRadioSound.ssc` patch, flat 2D, in the
  listener's side's language. Shouts: `SoldierVoice.ssc` patch on the
  speaker's soldier in 3D (`minDistance 3`, Distance -> Volume ramp 10..55 m),
  in the speaker's language, heard by anyone within 70 m. `radiomess.wav` is
  the text-chat beep, never a radio sound.
- **Spam limit** (client, `0x006D2430`): more than six sends inside four
  seconds are refused, and a refused attempt still counts.
- **Server** (`GameServer::radioMessage` 0x0813A120): drops a dead speaker's
  message; team radio to his team; shouts to anyone within 70 m. The room
  server does the same.
- **Retail quirk kept:** "You take the point" (45) prints "Go for the enemy
  flag" and plays GoForTheFlag.wav.

## The message log, as the engine does it

- **Three sections** of one 15-row list box at (0, 85) in the 800x600 screen,
  row height 14, font `standard6.dif`: kills (3 rows) at the top, a blank
  row, game information (2), a blank row, chat and radio (6). Sizes and the 5 s
  timeout are the default profile's `chat.set*`.
- **Expiry** (`0x006A8160`): one timer per section, not per line; past the
  timeout (strictly) the oldest line goes and the timer restarts. Only a new
  line of any kind resets the CHAT timer (hard-coded at `0x006A8BF9`). No fade.
- **Colours** (`Game/Init/Menu.con`): Axis 1/0.35/0.35, Allies 0.4/0.6/1, no
  team 0.7 grey. A player on the reader's buddy list is green (0/1/0); there
  is no special case for the reader himself. The retail capture's green lines
  were a buddy list entry, confirmed by the owner.
- **Row drawing** (`0x007D1390`): the team's ticket flag 16x16 at x 10, text
  at x 40, black 1-px outline in eight directions, a white divider at x 5 the
  height of the section's lines.
- **Lines:** kill `killer [word] victim` in the killer's colour, the word being
  the killer's vehicle's lexicon name (`[Tiger]`) or "killed"; team kill
  `killer killed a teammate` then `victim is no more`, both grey; a death with
  no killer `name is no more`; capture `[point] Allies captured the control
  point ` (the trailing space is the engine's) in the capturing team's
  colour; all points held, grey. The victim also gets the line in the centre
  of the screen (`KillMessage`, 10 s).

## Deliberate choices and open items

| Item | Status |
|---|---|
| `Radio/RadioGameMode` for conquest is 1 or 3 by `BfMenu+0x6DC`, a field nobody has named | 3 used: the retail conquest capture shows the page items at half alpha |
| On-foot kills print `[killed]` in every retail capture, though the server stamps the hand weapon's template and the lexicon has names for some | `[killed]` on foot, the vehicle's name seated; why the client's lookup misses is open |
| `BfOutlineStyle` alignment | centred, inferred from the file pairing it with `BfLeftOutlineStyle` |
| Bots reacting to radio (`AIRadio` strengths: decay 1/a, gain b; shouts x 70/d) | not wired; the bot behaviours still take "no radio" |
| Bots never send radio | verified: `AIRadio::sendMessage` has one caller, the server's relay |
| Hand signs on a shout (Freeze, Medic, Shout, Down, Roger, Negative) | not played |
| Minimap flash for a radio speaker, medic/repair map marker | not built |
| Player text chat (say all / say team input) | not built; `chat-log.js playerChatLine` has the format |
| The headings under the radio buttons (`Radio/ShowRadioToolTip`) | off by default, as in the owner's profile (`game.setRadioToolTip 0`; the shipped default profile has 1). `game.setRadioToolTip 1` in the console turns them on |
| The browser pane never delivers F-keys | test through `window.__comms.press('F4')` under `?shots` |
