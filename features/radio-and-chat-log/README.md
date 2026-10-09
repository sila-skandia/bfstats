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
| Menu behaviour: message table, key handler, remaps, chat text, spam limit, which of a patch's lines a language has | `viewer/radio.js` |
| The side's announcer's own lines: heavy casualties, tickets low, leaving the combat area | `viewer/announcer.js`, driven from `map.html` `announceGameplay` through `comms.gameplayFrame` |
| Message log: sections, timers, geometry, colours, line text | `viewer/chat-log.js` |
| Page: overlay canvas, F1..F8, voices, hooks for kills, deaths and captures | `viewer/comms.js`, wired in `map.html`, `page-input.js`, `capture.js`, `net-room.js` |
| Room relay: team radio to the team, shouts within 70 m | `server/rooms.mjs` `#onRadio`, `netcode-client.js` `radio()` |
| Tests | `tests/test_radio_chat.py` (+ `radio_chat_harness.mjs`, which also drives `announcer.js`), `tests/test_extract_radio.py`, `tests/test_radio_voice_trees.py` (the extracted trees) |

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

## Mods, languages and the side's announcer (2026-09-30)

Reported: in Desert Combat on play.bfstats.io "a lot of the sounds in the
radio calls are missing". Engine rows RADIO-1..RADIO-14.

**What the engine does.** The key -> message and message -> voice patch
tables are constants in the exe (RADIO-1, RADIO-2); a mod cannot change them,
only what stands behind them: the lexicon's strings for the fixed keys and its
own scripts' patches at the fixed indices. Desert Combat and DC Final rewrote
23 strings and the matching patches together (RADIO-5: F6 item 4 prints "Take
Cover!" and plays `TakeCover1..3`, item 6 "Cover me while I reload!" and
`Reloading1..3`), and use vanilla's `RadioMenu` and icons. Team radio is in
the listener's side's language, a shout in the speaker's (RADIO-3, RADIO-4). A
load whose file the language does not ship is dropped before it is counted
(RADIO-6), so a side rolls over the lines it has and a patch with none is
silent. Neither receive handler runs while the local player is dead (RADIO-7).
Nothing sends radio by itself except the artillery call (RADIO-8, SPOT-5). The
side's announcer, `Bf1942/Game/GamePlay.ssc`, has three lines besides the
capture pair: heavy casualties, tickets low and leaving the combat area
(RADIO-9..RADIO-12).

**What was measured first.** Every F-page item was pressed once per side on
DC_Basrahs_Edge in Desert Combat and DC Final and on El Alamein in vanilla,
the spam limit respected, measuring what the page STARTED (a hook on
`AudioBufferSourceNode.start`, buffers traced back to their URLs), not what it
requested. Before any change, every item that sends a message played its
line, in the side's own language (`iraq` / `us` / `ger` / `brit`), with the
mod's text: 38 sending items per side, and the three F4 slots past the
level's three points sending nothing, as the engine. The menu path was already right; the earlier live probe had
pressed digit keys, which are not radio keys, and read request logs through a
URL cache. Desert Combat had no voice tree at all until `b2118040` (published
08:52 the same morning), and its radio was silent before that, which fits the
report. Every line of both trees is on the live volume (`?cb=` fetches).

**What changed.**

- `extract_radio.py` writes `GamePlay.ssc`'s patches into
  `radio-sounds.json` (`gameplay`) and its lines into every nation folder;
  the capture pair's files were already there, byte-identical.
- `radio.js` `nationStems`: a patch is rolled over the stems the nation ships
  (the manifest's `missing`). DC Final's Liberation of Caen British side, and
  every non-US, non-Iraqi side in the Desert Combat trees, no longer borrows
  the American folder for Desert Combat's own lines; Eve of Destruction's
  French side loses the seven lines its language lacks.
- `comms.js`: no radio line or voice while the local player is dead;
  `playGameplay(index, team)`; `gameplayFrame(state)` runs `announcer.js`.
- `announcer.js`: the three rules. `map.html` `announceGameplay` feeds it the
  counts in `extras.tickets`, the round's starting counts (a room's scaled as
  its server scales them), the weights the flags hold and the combat area's
  accumulator.
- `capture.js`: the capture pair plays the tree's own `GamePlay.ssc` patches 0
  and 1 when the manifest has them, through the same path as the radio (at the
  radio's level, 2.5 dB above the one-shot bus it used), else its own stems.

**Written** (both Desert Combat trees, for publishing):
`voices/radio-sounds.json` and, in each of `us iraq brit can ger jp rus`,
`WeAreTakingHeavyCasualities.mp3`, `WeAreRunningLowOnReinforce.mp3`,
`WarningDesertersShot.mp3`, `WarningDesertersShotALT.mp3`: 58 files. Vanilla
was built to scratch only: the same `gameplay` key and 24 new files, plus a
`languages.json` its tree predates.

**Checked.** The same press-every-item run after the change, plus the messages
no key sends on foot (the vehicle remaps 51..54, the CTF orders 55..58, the
artillery call 59) through `__comms.receive`, the five announcer lines through
`__comms.playGameplay`, the combat-area line by moving the boundary away
(`__combatArea({ rect })`: one line after a whole second outside, not one per
frame), and a teammate's radio while dead (no line, no voice). Desert Combat:
all 110 rows played, both sides; DC Final the same; vanilla the same except
the three new announcer lines, silent until its tree is extracted again (its
manifest has no `gameplay`; the capture pair keeps its own stems). The rule
tests: `tests/test_radio_chat.py` (the rules), `tests/test_extract_radio.py`
(the manifests, Desert Combat's paired strings and patches),
`tests/test_radio_voice_trees.py` (every line a nation speaks is on disk).
A headless check on a loaded machine must leave the spam limit more than four
seconds OF PAGE CLOCK: the limit's clock runs on the page's frames, and a
page crawling at a quarter speed refused every press after the seventh.

## Deliberate choices and open items

| Item | Status |
|---|---|
| `Radio/RadioGameMode` for conquest is 1 or 3 by `BfMenu+0x6DC`, a field nobody has named | 3 used: the retail conquest capture shows the page items at half alpha |
| The kill line's bracketed word | Settled 2026-09-24 (the owner, from retail play): an on-foot kill names the weapon, `[killed]` is a man run over or caught by splash. The client localises the stamped template's name (`FUN_004933d0` 0x00494342: `DEFAULT_KILL_TEXT` unless the template id resolves, then `Locale::getWide` 0x005815b0, which widens the key itself on a miss, 0x00581470), so `[StG 44]`, `[K 98]`, `[K98Sniper]`. Built: `chat-log.js` `killStamp` (seated: the vehicle; roadkill and splash: none; else the killing damage's `weapon`, else the killer's held one); the damage paths carry `{ weapon, splash }` (`hand-fire.js`, the referee's `fireTick`, the splash pass in `vehicle-hits.js`), the speakers carry `weapon`, `comms.noteAttack` keeps `how` for the local player's death. A roadkill path does not exist yet (PHY-6); `killStamp` takes `roadkill` for when it does |
| `BfOutlineStyle` alignment | centred, inferred from the file pairing it with `BfLeftOutlineStyle` |
| Bots reacting to radio (`AIRadio` strengths: decay 1/a, gain b; shouts x 70/d) | not wired; the bot behaviours still take "no radio" |
| Bots never send radio | verified: `AIRadio::sendMessage` has one caller, the server's relay |
| Hand signs on a shout (Freeze, Medic, Shout, Down, Roger, Negative) | not played |
| Minimap flash for a radio speaker, medic/repair map marker | not built |
| Player text chat (say all / say team input) | not built; `chat-log.js playerChatLine` has the format |
| The headings under the radio buttons (`Radio/ShowRadioToolTip`) | off by default, as in the owner's profile (`game.setRadioToolTip 0`; the shipped default profile has 1). `game.setRadioToolTip 1` in the console turns them on |
| The browser pane never delivers F-keys | test through `window.__comms.press('F4')` under `?shots` |
| A tank kill printed `Hans is no more` | fixed 2026-09-24: a hull's crew dies to the attacker of the lethal hit (`GameServer::_giveDamage`, ledger AI-76), `killer [Sherman] victim`, the human, a bot, or the human killed in his own hull alike; the lines are `chat-log.js deathLines` |
| A hull that burns out after a hit | `is no more`, as the engine: the critical burn damages with attacker -1 (`Armor::update` 0x0817322a) |
| The artillery call (radio 59 and "You called for artillery!") | the receive side plays; the trigger, a binocular marker, is not built (`features/artillery-spotting`, SPOT-5) |
| The heartbeat under 5 % tickets (`Heartbeats.ssc`, RADIO-14) | read, not built |
| The CTF announcer (`CTF.ssc`, RADIO-12) | read, not built: the viewer has no CTF round |
| Heavy casualties at the end of a round (a side with no living player found first and no spawn point, RADIO-9) | not modelled, as TKT-5 |
| `Outside/OutsideTime` | the client writes `allowance - trunc(seconds outside)` from the first whole second (RADIO-11); `combat-area.js` still draws `ceil(remaining)` at once. The world's report also carries no combat record on a frame it did not tick, so the HUD's `page.combatFrame` reads "inside" on those frames |
| A language with no line for a DC patch | silent, as the engine (RADIO-6); a nation the tree has no folder for still falls back to the US folder |

## Eve of Destruction spoke vanilla's lines (2026-10-09)

Reported: in EoD every voice and radio command was vanilla's Axis and Allied
set. The viewer's lookup was right (`languages.json` maps `VietCongSoldier`,
`NVASoldier`, `ARVNForces` and `CivilVC_Soldier` to `jp`, the slot EoD's
`setRadioLanguage "Japanese"` fills with its Vietnamese lines; `SpecialForces`
and `NavySeals` to `us`), but the EoD tree had been extracted before that file
existed, and its folders were byte copies of vanilla's.

The cause was `extract_map.resolve_sound`: it tried `Sound/22kHz/...` across
the whole mod chain before `Sound/44kHz/...`, and EoD ships every sample at
44 kHz only (its `Japanese/` has 169 files, `French/` 195, `USEnglish/` 94),
under the same `Sound/@RTD/<Language>/<stem>.wav` names vanilla ships at
22 kHz. Vanilla's 22 kHz line was found first. EoD is the only mod in the
extraction scope with that shape (the survey is in the session notes: DC
Final, XPack1, FH and Pirates ship all three rates; bf1918 and BG42 are
44 kHz-only but out of scope). Fixed by `ArchivePool.rank` and
`extract_map._nearest`: the nearest archive wins, and only within one archive
does the rate order decide. Pinned by `tests/test_sound.py`
`NearestModSoundTests`. All four voice extractors go through `resolve_sound`,
so one fix covers the radio, the shouts, the capture pair, the announcer, the
soldier's own voice and the CTF lines.

Re-extracted and published (`maps/mods/eod/_shared/voices`, 776 files): `jp`
now carries 70 of the 74 radio, shout and announcer stems from EoD's own
archive, `fre` 66; `us`, `brit` and `ger` get EoD's four own lines
(`APCSupport`, `AbandonShip`, `BailOut`, `CheckYourSix`, ...) and vanilla's
for the rest, which is what the engine's `game.addModPath` chain plays too.
Checked headless on A Shau with `?shots=1` (the briefing's READY and the
page's test hooks need it): the Viet Cong side's radio fetched
`maps/mods/eod/_shared/voices/jp/RogerThat.mp3` (EoD's 0.87 s line, not
vanilla's 0.64 s one), the Special Forces side `.../voices/us/RogerThat.mp3`;
the same files answer on mesh.bfstats.io.
