# sound-radio

## Summary

Rows (16): BUILT 13 (SND-8, SND-9, SND-10, SND-26, SND-31, SND-36, RADIO-1, RADIO-4, RADIO-7,
RADIO-8, RADIO-10, RADIO-15, SSC-5), PARTIAL 2 (SND-39, RADIO-12), DIFFERENT-by-choice 1 (SND-47).
The rows are well covered: almost every one names our file in its own "Where" cell. Most of the
gaps come from the sweep.

Sweep: MISSING 4, PARTIAL 3, DIFFERENT 1, UNREAD 2.

Top findings by impact:
1. **PARTIAL high/M**: bots hear only 3 of the 22 radio messages they subscribe to (GetIn, BailOut,
   AbandonShip). Retail also feeds Fire, Cover me and Hold fire into every fire behaviour, Medic and
   Need repairs into MedicAssist, Go, Hold position and Wait into MoveTo, Spotted and Check your six
   into Scout, and Take cover into TakeCover. `bot-behaviours.js` still says "no radio in the viewer".
2. **DIFFERENT/MISSING high/S**: "Watch your aim!" (`SoldierFFHitDamage.ssc`). Retail plays it from
   any soldier a teammate's round touches, damage or not, at most once every 3 s per soldier. We
   play it only when the local player takes friendly damage, and never from a bot the player shoots.
   This also settles FF-6's open question about which sample plays.
3. **PARTIAL medium-high/M**: soldier movement sounds. Only walk and run steps play. Crawl, crouch
   move, jump, landing (per material), ladder, swim and the stance changes all ship and stay
   silent, and a crouched or prone step plays the standing walk sample.
4. **MISSING medium/M**: the hand signs on a shout (`HandSign_*`). `radio.js` carries the `sign`
   data, but nothing reads it.
5. **MISSING medium/S**: the minimap flash for a radio speaker (`Game.setRadioFlashTime 7`).
6. **MISSING low-medium/S**: the chat beep (GamePlay.ssc patch 5) on a player chat line.

## Findings (MISSING / PARTIAL / DIFFERENT / UNREAD), highest impact first

### [PARTIAL] [impact: high] [effort: M] Bots act on only 3 of the 22 subscribed radio messages
- Retail: `AIRadio::getMessageStrength` (lnxded `0x084825c0`) has 38 call sites. Each one is
  shown below with the message id pushed just before the call:
  - `BBChange::getRadioStrength` reads 51 and 42. `BBChangeLandingCraft` and `BBChangeTeleport`
    read 53. **We build these three.**
  - `BBFire`, `BBFire3d`, `BBFireLargeBore`, `BBFireUnarmed` and `BBFireGuided::calculateUrgency`
    each read 37 (Fire), 43 (Cover me) and 38 (Hold fire). In `BBFire` (`0x085652b6`..`0x08565329`)
    this is urgency x `(1+s37)` x `(1+s43)` x a `fld1; fsubp` term on s38, which reads as
    `(1 - s38)`. So "Hold fire!" damps a teammate bot's firing and "Fire!" or "Cover me!" raises it.
  - `BBMedicAssist` reads 40 (Medic) and 54 (Need repairs), both as `(1+s)` (`0x08573d56`..`0x08573d93`).
  - `BBMoveTo` and `BBMoveToFixed` read 49 (Go) as `(1+s)`, and 44 (Hold position) and 36 (Wait)
    as `fld1; fsubp` terms, read as `(1-s)` (`0x08575036`..`0x08575093`).
  - `BBScout` reads 52 (Check your six) and 15..21 (the seven Spotted messages), each as `(1+s)`,
    then multiplies by 0.1 (`0x086b1ca0`) (`0x0857a81b`..`0x0857a98a`).
  - `BBTakeCover` reads 41 (Take cover) as `s + 1.0` (`0x0857d063`, `0x086ba8d4` = 1.0).
    `BBTakeCoverInfantry` also reads 41, and `BBTakeCover3d` reads 52.
- Ours: `viewer/bot-radio.js` stores every subscribed strength (the store, decay and range are
  right). Only `changeRadioStrength` and `teleportRadioStrength` (`bot-mount.js`) read it.
  `bot-behaviours.js:454` says "the radio message term `(1 + strength)` is 1 (no radio in the
  viewer)", and `bot-fire.js` names "the radio terms" without applying them.
  `features/radio-and-chat-log/README.md` still says "Bots reacting to radio: not wired", which is
  stale for Change.
- A player notices: pressing F-key commands like "Hold fire", "Go go go", "Hold position", "Medic!"
  or "Enemy armour spotted" has no effect on teammate bots in single player or Instant Battle. In
  retail these commands visibly push the bots.
- To build: read `bot.radio.strength(bot.id, id)` inside each behaviour's urgency in
  `bot-behaviours.js`, `bot-fire.js` and `bot-decision.js`. Confirm the sign of each `fsubp` term
  in Ghidra first (AT&T `fsubp` operand order is a known trap). Add the rows to the AI section of
  the ledger.

### [DIFFERENT] [impact: high] [effort: S] "Watch your aim!" plays only for the local player, and only when hurt
- Retail: `Projectile::handleCollision` calls `BFSoldier::projectileHit(round team)` (lnxded
  `0x0827ea20`, call at `0x0831effc`) for any soldier the round touches, unless the projectile
  template sets `noFFSound` (Mac `ProjectileTemplate::setNoFFSound`, byte 399). `projectileHit`
  tests that the round's team equals the soldier's player team (`+0x7c`) and that more than 3.0 s
  (double `0x086d2740`) have passed since the soldier's last stamp (`+0x56c`, per soldier). If so,
  it plays sound entry `0x13` of the soldier's sound object (`+0xf8`).
  - The index is a 0-based position in `SoldierSound.inc`'s `loadSoundScript` list. RADIO-3
    verifies `playVoice`'s `0x17` = the 24th load = `SoldierVoice.ssc`, which fixes the scale, so
    `0x13` is the 20th load, **`SoldierFFHitDamage.ssc`** (WatchYourAim1..9).
  - FF-6 read `0x13` against the `c_Sst*` constant table, where `c_SstHitDamage` is `0x13`
    (`0x08298ffa`). That table is the animation-trigger id, which is 1-based against the same list
    (c_SstStand=1 is list 0, c_SstClimbLadder=0x17 is list 22), and it belongs to a different
    object (`+0x520` on the Mac, the SoldierSound).
  - The sound is not gated on damage, so it plays with friendly fire off. It plays on every
    client, at the struck soldier, in that soldier's language.
- Ours: `page-audio.js` `playSoldierHurtSound(isFriendlyFire)` plays `c_SstFFHitDamage` only from
  `local-player.js` `applyDamageToPlayer`, when the local player takes damage from their own team,
  with a 0.9 s cooldown. A bot's `onHurt` (`map.html:2100`) always passes `false`. A teammate who
  takes no damage hears nothing, and a remote player struck by a teammate plays nothing.
- A player notices: shooting a teammate bot in retail gets an immediate "Watch your aim!" from that
  bot. Here the bot stays silent or just grunts.
- To build: on every round-body meeting where the round's team equals the body's team (the hit
  tests in `hand-fire.js`, `vehicle-hits.js` and the referee), play `c_SstFFHitDamage` positionally
  at the body, with a per-soldier 3 s stamp and the speaker's `teamVoice`. Carry `noFFSound` per
  projectile from the extractor if any template sets it. Correct FF-6 in the ledger.

### [PARTIAL] [impact: medium-high] [effort: M] Soldier movement sounds: only walk and run
- Retail: `SoldierSound.inc` loads 26 scripts, and the animation states fire their `c_Sst*`
  triggers (`BFSoldier::updateSound` -> `getSoundTrigger`). The High tier ships samples for:
  - `SoldierCrawlMove` (SOCRAWL, SoFa)
  - `SoldierToCrouch`, `SoldierFromCrouch`, `SoldierToCrawl`, `SoldierStandUp` (the stance changes)
  - `SoldierJump`, and `SoldierJumpLand` with per-material landings (SOLAGRASS, SOLAMETAL, SOLAWOOD...)
  - `SoldierClimbLadder` (SOWAMTL1..4)
  - `SoldierToSwim`, `SoldierSwim`, `SoldierSwimStand`
  - `SoldierHealedByMedic` (medkit.wav)

  The cadences are `setCrouchFrequency 0.50`, `setCrawlFrequency 0.6`, `setLadderFrequency 0.46`
  and `setSwimFrequency 1`.
- Ours: `extract_soldier_sounds.py` `MOVEMENT_SCRIPTS` extracts only Walk and Run.
  `page-audio.js` `handleSoldierFootstep` picks `c_SstRun` for `gait === 'run'` and `c_SstWalk`
  for everything else, so `soldier.js` crouch and prone steps play the standing walk sample. A
  jump, a landing, a ladder, swimming and the stance changes play nothing.
  `features/viewer-swimming/README.md` already lists the swim scripts as unplayed.
- A player notices: crawling sounds like walking, climbing a ladder is silent, jumping and landing
  are silent, and so are swimming and dropping prone.
- To build: add the scripts to `extract_soldier_sounds.py`. Route `drainFootstepEvents` by gait to
  CrouchMove or CrawlMove. Fire one-shots from the stance, jump, land, ladder and swim transitions
  in `soldier.js`, `ladder-climb.js` and `swim.js`, and for bots and remotes from `bot-visuals.js`
  and `remote-gait.js`.

### [MISSING] [impact: medium] [effort: M] Hand signs on a shout
- Retail: the shout receive on foot calls `BFSoldier::playVoice` and then the hand sign
  `0x004feb20` (RADIO-3). The hand sign plays animation state `HandSign_Freeze` + n (0..6:
  Freeze, Come, Medic, Shout, ...) from `AnimationStatesFace.con`
  (`3P_NoWeapon/Handsignals/3pHandSign_*.baf`, `c_AsmPlayOnce`).
- Ours: `radio.js` `RADIO_MESSAGES` carries `sign: 'Roger' | 'Freeze' | 'Shout' | 'Medic' |
  'Down' ...`, and no code reads `.sign`. `features/radio-and-chat-log/README.md` lists it as
  "not played".
- A player notices: in third person, a soldier who shouts "Medic!" or "Hold position!" does not
  gesture.
- To build: extract the seven `.baf` clips into the pose tree and play them as a one-shot upper
  body layer from `comms.js` `receive` on the speaker's body (`bot-visuals.js`, remote and replay
  bodies).

### [MISSING] [impact: medium] [effort: S] Minimap flash for a radio speaker
- Retail: `Radio::outputRadioMessage` (Mac) calls `MenuMapNode::addPlayerToFlashList(speaker,
  BfMenu+0x5d4)` for any speaker who is not the local player, before `playRadio`. Vanilla sets
  `Game.setRadioFlashTime 7`, so the speaker's minimap marker flashes for 7 s.
- Ours: not built (`features/radio-and-chat-log/README.md`: "Minimap flash for a radio speaker:
  not built"). `setRadioFlashTime` appears only in the console census.
- A player notices: when a teammate calls "Medic!" or "Need backup!", the map does not show who
  called.
- To build: in `comms.js` `receive`, mark the speaker in the minimap module for `radioFlashTime`
  (7 s, from the mod's init con). Read the client's flash rate in `MenuMapNode` first.

### [PARTIAL] [impact: low-medium] [effort: S] RADIO-12: the chat beep (GamePlay.ssc patch 5) is not played
- Retail: RADIO-12, `0x006a5550` (patch 5 `radiomess`) is called from `addPlayerChatMessage`
  (`0x006a8ebc`, `0x006a921f`) for every player chat line. The Mac name for it is
  `BfMenu::playSoundRadioCrackle` (patch 5 of `+0x4e0`, gated on `+0x13d`). A radio chat line
  plays nothing.
- Ours: patches 0 and 1 (`capture.js`) and the ticket line are played. `comms.chatLine` and
  `sayLine` add the line without a sound.
- A player notices: in a room, typed chat arrives without retail's beep.
- To build: `comms.chatLine` -> `comms.playGameplay(5)`, or the gameplay script's patch 5.

### [MISSING] [impact: low] [effort: S] Ignore-radio options and the player ignore list
- Retail: `BfMenu::setIgnoreRadioAudio`, `setIgnoreRadioText` and `setIgnoreRadioAudioAndText` are
  saved with the general options. `outputRadioMessage` skips `playRadio` when the audio flag is
  set, and returns early for a speaker on `BfMenu::isInIgnoreList` (RADIO-7 also names the ignore
  test `0x006a8db0`).
- Ours: none (only `surveys/census_console_registry.py` lists the words).
- A player notices: a player cannot silence radio spam or mute one player in a room.
- To build: console words and options rows that gate `comms.js` `receive`'s chat and voice.

### [DIFFERENT] [impact: low] [effort: S] One shared hurt-grunt cooldown for every bot
- Retail: the hurt grunt is per soldier (`SoldierSound.setHitDamageFrequency 1.0`,
  `setRandomHitDamageFrequency 0.2`, on each soldier's own SoldierSound).
- Ours: `page-audio.js` `playSoldierHurtSound` uses one `lastWorldHurtSoundTime` (0.9 s) for every
  world soldier, so two bots hit within 0.9 s produce one grunt. Replays skip it with
  `cooled=false`.
- A player notices: in a busy fight, fewer cries than retail.
- To build: keep the stamp per soldier, at 1.0 +/- 0.2 s.

### [PARTIAL] [impact: low] [effort: M] SND-39 / SND-44: no voice pool and no priority stealing
- Retail: a pool of `game.setChannels` voices. With no free voice, `0x007fbdd0` steals one of the
  same kind by integer priority (`vt+0x44`), then by a float (`vt+0x6c`) (SND-39, SND-44).
- Ours: the page plays every voice. Only `effect-audio.js` has a 26-voice budget.
- A player notices: rarely; a big fight is denser in sound than retail.
- To build: a shared allocator in `engine-audio.js` / `effect-audio.js` with the ledger's
  priority order.

### [DIFFERENT by choice] SND-47: a loop starts at a random offset
- Retail starts at 0. The page's random start is kept on purpose to stop phase-locking
  (`engine-audio.js` `#play`). This is recorded in the row, so there is nothing to fix.

### [UNREAD] [impact: low] What triggers `SoldierHealedByMedic.ssc`
- Retail: `c_SstHealedByMedic` is registered as `0x16` (`0x0829904d`), but no animation state in
  vanilla `animations.rfa` names it, so code triggers it.
- Ours: nothing plays medkit.wav on the healed soldier.
- To settle: xref the constant `0x16` / SoldierSound `vt+0xc(0x16)` callers in lnxded (the medic
  heal path, `Armor::heal` or `MedicKit`).

### [UNREAD] [impact: low] Music slot 7 (`Level::getBackgroundMusic`)
- Retail: `BfMenu::playMusic` has seven slots. Slots 1..6 are the mod's init-con filenames (menu,
  load, win, lose, debriefing, campaign lose), and slot 7 (`+0x508`) is set from
  `LevelManager::setBackgroundMusic`. Music plays at `musicVolume/100 x masterVolume/100`
  (`updateMusic`) and stops when music is off.
- Ours: menu, load, win and lose are built (`audio.js`, `page-audio.js` `playRoundMusic`,
  ROUND-8, LDPIC-3). Neither slot 6 (campaign lose) nor slot 7 is known to be built.
- To settle: read who calls `playMusic(6)` and `(7)` (Mac `BfMenu`, WinPC by recorpus) and
  whether any shipped level sets a background track.

## From the sweep: retail behaviour with no ledger row

- `BFSoldier::projectileHit` plays `SoldierFFHitDamage` on a team hit, with a 3 s per-soldier
  gate and the `noFFSound` opt-out. This needs a correction to FF-6, not a new row.
- The AI fire, move, scout, cover and medic behaviours read radio strengths (38 call sites, ids
  above). The ledger records only the Change and Teleport reads (in `bot-radio.js`).
- `Radio::outputRadioMessage`: the speaker's minimap flash (`radioFlashTime`, vanilla 7), the
  ignore list, and `IgnoreRadioAudio` gating the voice.
- The hand-sign states `HandSign_Freeze`..+6 (RADIO-3 cites the call, not what it plays).
- `SoldierSound.inc`'s per-gait cadences and the 26-script index, now settled by RADIO-3's slot 23.
- `BfMenu::updateMusic` / `playMusic`: seven music slots, volume = music x master, and slot 7 the
  level background.
- `AIMain::queueSoundEffect` / `playSoundEffects`: the AI queues material-pair effects
  (`materialManager vt+0x50` -> `game vt+0x64`) and plays them in a time budget. These are
  effects, not voices, and belong to the AI bucket.

## BUILT and NOT-GAME, one line each

- SND-8 BUILT -> `area-sound.js` `nearestOnOutline` / `emitterAt`.
- SND-9 BUILT -> `area-sound.js` `emitterAt` (trigger radius).
- SND-10 BUILT -> `area-sound.js` via `engine-audio.js` `distanceRolloff`.
- SND-26 BUILT -> `aircraft.js` `presentEngines`, `replay-recording.js` `enginesAt`.
- SND-31 BUILT -> `ds3d-pan.js` `ds3dGains` / `ds3dRenderPoint`.
- SND-36 BUILT -> `effect-audio.js` `approachesListener`, `extract_effects.py` `flight_sample`.
- SSC-5 BUILT (extractor) -> `bf42/level.py` `_ssc_lines` threads `skipping` through includes.
- RADIO-1 BUILT -> `radio.js` `pressRadioKey`, `isTeamMessage`; `comms.js` `keydown`.
- RADIO-4 BUILT -> `comms.js` `voiceOf` (listener for radio, speaker for shouts), `kit-loadout.js`
  `teamVoice`.
- RADIO-7 BUILT -> `comms.js` `receive` (listener alive) and `send` (speaker alive);
  `server/room-control.mjs` `onRadio`.
- RADIO-8 BUILT -> no automatic radio anywhere. The only non-key send is `comms.callArtillery`
  (59), and nothing auto-shouts on a grenade, a reload or a man down, as in retail.
- RADIO-10 BUILT -> `announcer.js` `TICKET_LOW` with the 0.2 / 0.05 band and latch.
- RADIO-15 BUILT -> `radio.js` `radioGameMode`, `comms.js` `gameMode`.
- Shout range 70 m, team-only line, voice for both sides BUILT -> `radio.js` `LOCAL_RANGE`,
  `server/room-rules.mjs` `RADIO_LOCAL_RANGE`.
- The bots' AIRadio store (decay, gain, 70/d shouts, mod subscriptions) BUILT -> `bot-radio.js`,
  `bot-referee.js` `radioMessage`.
- Radio menu timeout BUILT -> `comms.js` (`timeOutCommandInterface`, `setRadioTimeoutTime 25`).
- Team radio colours BUILT -> `chat-log.js`, `extract_radio.py`.
- Kill and death voice BUILT -> `page-audio.js` `playSoldierDeathSound` (`c_SstKilled`, Dying1..8).
- Hurt grunt BUILT -> `page-audio.js` `playSoldierHurtSound` (`c_SstHitDamage`), apart from the
  cooldown above.
- Refill sound BUILT -> `page-audio.js` `playRefillSound` (SUP-9, NET-19).
- Heartbeat BUILT -> `announcer.js` `heartbeatLevel`, `comms.js` (RADIO-14).
- Menu, load, win and lose music BUILT -> `audio.js`, `loading-audio-ui.js`, `page-audio.js`
  `playRoundMusic`.
- Sound options (hardware row, master volume and channels by console) BUILT -> `sound-options.js`
  (SND-41). The other rows are left out on purpose, documented in its header.
- `SoundSetup` / `VoiceManager` debug draws (`drawSoundInfo`, `drawVoiceStats`) NOT-GAME.
