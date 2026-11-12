# hud-menus-console

## Summary
- CODE-WRONG 3 (F1 medium, F5 low, F6 low); LEDGER-WRONG 2 (F2 medium, F8 low); SETTLED 3 (F4 low, F7 medium, F3 low); INCONCLUSIVE 4 (F9-F12, low); DELIBERATE 3 (D1-D3); RE-WRONG 0; MATCH ~35 rows/functions (list below).
- Bucket: 37 files, ~420 citations. Depth went to the gameplay-visible laws: nametags, hit marks, hit-direction wash, vehicle reload/ammo bars, map vehicle marks, chat log, radio send limit and mode, console dispatch, campaign tables, scoreboard sort. Not reached one by one: the many lnxded line-level addresses in console.js's parser/alias/history code (only the dispatcher, messages and keywords were read), the front-end layout geometry in play/multiplay-layout.js / create-game.js / menu-screen.js (pixel layout from `.meme` data, low value), progress.js, briefing-screen.js / campaign-debriefing.js (one citation each) and the radio patch-number jump tables (RADIO-2, not re-walked).

## Findings (non-MATCH), most severe first

### F1 [CODE-WRONG] [medium] Vehicle reload bars: retail is reload-else-fire-interval with a 0.1 s dead band, no overheat term
- Code: tools/bf1942-models/viewer/vehicle-hud.js:400-401 `setHudVar('Ammo/ReloadTime', readyFraction(primary, nodes[0]))`; :462-474 `readyFraction` = `1 - max(reloadRemaining/reloadTime, cooldown*roundOfFire, overheatRemaining/timeDelayOnOverheat)`; comments at :393-397 and :452-461 call the direction "a choice, not a reproduction".
- Ledger: VHUD-10 (says the feeder is `heat > 0.1 ? heat/heatMax : reload/reloadMax` and that `[this+0x14]` is unverified) -- see F2.
- Third-party: decompiled_functions_MacClient/dice_bf_menu_Vehicle_update.c:164-166 `getTimeToFireFinished` / `getTimeToReloadFinished` -> `updateAmmoBar(pFVar2, reload, fire, piVar3[0xad] /*template+0x2b4 = getReloadTime*/, *(float*)(fa+0x23c), fa)`; dice_bf_menu_Vehicle_updateAmmoBar.c: `if (reload <= 0.1) { f = fire <= 0.1 ? 0 : fire / p5 } else f = reload / p4;` then `[+0x14]+8 = 1.0 - f` (sel 1) / `+0xc` (sel 2). winpc 006d6af0_FUN_006d6af0.c is the same body.
- Our binary: caller `0x006d7179..0x006d71ad`: pushes sel `ebp` (the 1..2 weapon counter), `[esi+0x264]`, `[ebx+0x3a8]`, then `0x00539a10()` (`flds 0x18c(%ecx)`, timeToFireFinished) and `0x00539980()` (`flds 0x184(%ecx)`, timeToReloadFinished). `template+0x3a8` is `reloadTime` (the `reloadTime` command at vtable `0x008e1578`, execute `0x004d1280`: `flds 0x3a8(%ecx)` / `movl %edx,0x3a8(%eax)`); `weapon+0x264 = 1.0 / template+0x3ac` (`0x0053cc1a flds 0x3ac(%edi); fdivrs 0x8c53c8; fstps 0x264(%esi)`), the shot interval 1/roundOfFire. Feeder `0x006d6af0`: thresholds `0x008c53cc` = 0.1f, result `1.0 (0x008c53c8) - f`. `[vehicleHud+0x14]` is `new(0x10)` -> ctor `0x006ee6b0`, vptr `0x009278b8`, whose slot 2 `0x006ee610` registers group `"Ammo"` (`0x00925f44`) with `"ReloadTime"` (`0x009278e8`) at `+0x8` and `"ReloadTimeSecondary"` (`0x009278d4`) at `+0xc` (`0x006ee625..0x006ee672`).
- Verdict reasoning: the direction the code chose (full = ready) is retail's. The law is not: retail shows the reload fraction while more than 0.1 s of reload remains, otherwise the fire-interval fraction while more than 0.1 s of it remains, otherwise full. It never takes a max, never reads overheat (the heat goes to `Overheat/OverHeat` through `0x006e9a50`), and snaps to full in the last 0.1 s.
- Fix: in vehicle-hud.js `readyFraction`: `const r = state.reloadRemaining, c = group ? group.cooldown : 0; const f = r > 0.1 ? r / state.stats.reloadTime : (c > 0.1 ? c * group.stats.roundOfFire : 0); return 1 - f;` (clamp only for safety). Drop the overheat term. Replace the "a choice" comments with the citation above.

### F2 [LEDGER-WRONG] [medium] VHUD-10: the feeder reads reload then fire-interval timers, not heat; `[this+0x14]` is the ReloadTime group
- Code: vehicle-hud.js:452-461 cites "VHUD-10 is still open".
- Ledger: VHUD-10 -- "`f = heat > 0.1 ? heat/heatMax : (reload > 0.1 ? reload/reloadMax : 0)` ... Which group object `[this+0x14]` is remains UNVERIFIED, and 'selector 2 writes the reload bar' is type-inconsistent with the Overheat group's int at +0xc -- do not record the destination names".
- Third-party / Our binary: as F1. `param_3` is timeToReloadFinished (`+0x184`), `param_4` timeToFireFinished (`+0x18c`), `param_5` reloadTime (`template+0x3a8`), `param_6` the shot interval (`weapon+0x264`); `[this+0x14]` is the `Ammo` ReloadTime group (`ReloadTime +0x8`, `ReloadTimeSecondary +0xc`), not the Overheat group, so there is no type inconsistency. The Mac dump names the class `dice::bf::menu::ReloadBar` and the method `Vehicle::updateAmmoBar`.
- Fix: rewrite the feeder clause: "`f = reloadLeft > 0.1 ? reloadLeft/reloadTime : (fireLeft > 0.1 ? fireLeft/(1/roundOfFire) : 0)`; `Ammo/ReloadTime` (sel 1, first weapon) / `Ammo/ReloadTimeSecondary` (sel 2) `= 1 - f`" with the addresses in F1; mark the destination confirmed.

### F7 [SETTLED] [medium] Map vehicle marks: outside a joined game a hull farther than the reader's view distance is not drawn
- Code: tools/bf1942-models/viewer/map-vehicle-marks.js:43-46 -- "Not built: in game modes `BfMenu+0x6DC` 0, 1, 3 and 4 the pass also drops any hull farther from the reader's control object than a float the client reads off the object his player holds at +0x94 (vtable +0x34 ...). What that object is was not identified, so no range is applied."
- Ledger: MMAP-3 (does not carry the range gate).
- Third-party: decompiled_functions_MacClient/dice_bf_MenuMapNode_onPaint.c:991-994 `dVar45 = 0.0; if (player && *(player+0x74)) dVar45 = (**(player+0x74)->vt+0x34)();` and :1026-1041 `if (player && (BfMenu::startingHost(..) || BfMenu::isSingleplayerGame(..))) { ... bVar1 = distance(controlObject pos, vehicle pos) <= dVar45; }`. decompiled_functions_MacClient/dice_bf_ai_AIPlayer_getViewDistance.c is the same call, `(**(*(this)+0x74)->vt+0x34)()`: the object is the player's camera and the float is its view distance.
- Our binary: `0x0046b476 movl 0x94(%eax),%ecx` (player+0x94, the camera HUD-18 also casts from) -> `0x0046b496 call *0x34(%edx)` -> `fstps 0x14(%esp)` (0 when there is no camera); `0x0046b50c call 0x0045cff0` (`BfMenu+0x6dc == 3`, host) / `0x0046b518 call 0x0045d050` (`in {0,1,4}`, single player); then control object (`vt+0x38`) position vs hull position (`vt+0x34`), `fsqrt`, `fcomps 0x14(%esp); testb $0x41; jp` -> drawn when `dist <= viewDistance`.
- Verdict reasoning: the unidentified object is the local player's camera and the float is the view distance it renders to (the same value a bot senses with). The gate runs in skirmish, campaign and on a host; a joined client draws every qualifying hull at any range.
- Fix: map-vehicle-marks.js `mapVehicleMark({ ..., distance, viewDistance, applyRange })`: return null when `applyRange && !(distance <= viewDistance)`; the page passes the level's view distance and `applyRange = !joinedRoom`. Keep MMAP-3 in step. (Which value the camera returns is the renderer's view distance; confirming its source on the client is the one open step.)

### F4 [SETTLED] [low] `Radio/RadioGameMode` for conquest/objective is 3 only in single player (or co-op); a joined or hosted game gets 1
- Code: tools/bf1942-models/viewer/radio.js:110-121 -- "Conquest is 3 when `BfMenu+0x6dc` is 0, 1 or 4 -- a field nobody has named yet -- and the retail capture on a conquest server shows the dimmed items, so conquest takes 3 here"; `radioGameMode` returns 3 for every mode but CTF (2) and TDM (1). Caller comms.js:143-144 passes only `gameplayMode`. features/radio-and-chat-log/README.md:279 lists it open.
- Ledger: RADIO-13 (`getGamePlayMode`: CTF 1, Conquest 2, TDM 3, Co-op 4, Objective 5); no row for the switch.
- Third-party: decompiled_functions_MacClient/dice_bf_BfMenu_isSingleplayerGame.c `startingSkirmish(this) || startingCampaign(this)`; dice_bf_BfMenu_startingSkirmish.c `field == 0`, startingCampaign.c `== 1 || == 4`, startingJoin.c `== 2`, startingHost.c `== 3` (Mac field `+0x4c8`).
- Our binary: `0x006e3c31 call [game vt+0x84]; dec eax; cmp eax,4; jmp [0x006e4084+eax*4]` -> table `0x006e3ede` (mode 1 CTF: `movl $0x2, 0x1c(%ecx)`), `0x006e3fac` (mode 3 TDM: `movl %ebx,0x1c(%edx)`, ebx = 1 from `0x006e3c0b`), `0x006e3c48` (modes 2, 4, 5): `cmp eax,4; je ->3`; `call 0x0045d050; test al; jne ->3`; else `movl %ebx` (= 1). `0x0045d050` is `BfMenu+0x6dc in {0,1,4}`, i.e. `isSingleplayerGame` (its siblings `0x0045cfc0` `==0` skirmish, `0x0045cfd0` `1||4` campaign, `0x0045cff0` `==3` host, `0x0045d000` `!=-1`).
- Verdict reasoning: `BfMenu+0x6dc` is the "starting" game kind (0 skirmish, 1/4 campaign, 2 join, 3 host, -1 none). Conquest and Objective dim the items (3) in skirmish/campaign and in Co-op always; on a joined or hosted multiplayer game they get 1 (no dim). The lab capture the comment leans on was a co-op server (mode 4), which is 3 either way.
- Fix: radio.js `radioGameMode(mode, { singlePlayer })`: CTF 2; TDM 1; co-op 3; conquest/objective `singlePlayer ? 3 : 1`. comms.js:144 passes whether the page is in a net room (multiplayer join/host) or a skirmish/campaign. Visible only as the radio page's half-alpha dimming in a multiplayer conquest room.

### F3 [SETTLED] [low] `SoldierAmmoHasMag` is the weapon template's `hasMag`, engine default true
- Code: tools/bf1942-models/viewer/soldier-hud.js:64-68 — `// OPEN: no .con word or client write-site for SoldierAmmoHasMag ... fed true unconditionally` / `vars['Ammo/SoldierAmmo/SoldierAmmoHasMag'] = true;`
- Ledger: HUD-9 (names the leaf, not its source); none for the default.
- Third-party: decompiled_functions_MacClient/dice_bf_menu_SoldierAmmo_setSoldierAmmoData.c — `this[0x54] = *(SoldierAmmo *)(param_1 + 0x34c);`; dice_ref2_world_FireArmsTemplate_setHasMag.c `this[0x34c] = param_2;`; dice_ref2_world_FireArmsTemplate.c:89 `this[0x34c] = (FireArmsTemplate)0x1;` (Mac ctor default). winpc 004d4d80_FUN_004d4d80.c registers the console word `"hasMag"`.
- Our binary: the `hasMag` command's execute `0x004d4ed0`..`0x004d4f1b` reads/writes `FireArmsTemplate+0x470` (`movb 0x470(%ecx),%cl` / `movb %bl,0x470(%eax)`); FireArmsTemplate ctor `0x0053c5fd: movb $0x1, 0x470(%esi)` (default true); SoldierAmmo data copy `0x006ea35f: movb 0x470(%edi),%al` -> `0x006ea366: movb %al,0x84(%esi)` (the leaf bound as `SoldierAmmoHasMag`).
- Verdict reasoning: the leaf is fed from `ObjectTemplate.hasMag` on the held weapon, default 1. The code's unconditional `true` equals the engine default; it is only wrong for a weapon whose `.con` writes `hasMag 0`.
- Fix: replace the OPEN comment with the source (`FireArmsTemplate.hasMag`, default true, client 0x0053c5fd / 0x006ea35f) and feed `data.hasMag ?? true` once the weapon exporter carries the word. No visible change for vanilla unless a template writes `hasMag 0`.

### F5 [CODE-WRONG] [low] Console: a write-only (type 3) property given two or more arguments answers "Properties only takes one argument!"
- Code: tools/bf1942-models/viewer/console.js:507-509 -- `if (args.length > 1 && cmd.type === 1) return { ..., message: MESSAGES.oneArg };` (type 3 falls through to the min/max counts).
- Ledger: CON-21 -- "type 1 given more than one is *Properties only takes one argument!* (`0x083e4547` -> `0x083e67cf`)"; it omits the type-3 branch.
- Third-party: not needed (lnxded is our own binary with symbols); the linux dump's `OldConsole::handleCommand` is the 1.61 twin.
- Our binary (lnxded.static, `OldConsole::handleCommand`): `0x083e4543 dec eax; 0x083e4547 je 0x083e67cf` (type 1) and `0x083e4559 cmp eax,3; 0x083e455c je 0x083e67cf` (type 3); `0x083e67cf cmpl $0x1,-0x328(%ebp); jle` back, else `push 0x86eb320` ("Properties only takes one argument!").
- Verdict reasoning: both property kinds that take a value refuse more than one argument with the same message, before the min/max count checks.
- Fix: console.js:507 `if (args.length > 1 && (cmd.type === 1 || cmd.type === 3))`; CON-21 should name both branches.

### F6 [CODE-WRONG] [low] console.js string addresses that point at nothing
- Code: tools/bf1942-models/viewer/console.js:109 `tooFew ... // 0x086eb5ee-ish`; :126 `'alias', 'listalias', 'unalias', // 0x086a2ff2-ish block`; :101 client block `0x00902cb8-0x00902d3c`.
- Ledger: CON-25 (`listalias` strings `0x086eaff2` / `0x086eaffa`, correct).
- Our binary: readmem server `0x086eb5ee` = "l" (mid-string); the push at `0x083e45ee` is `pushl $0x86eb240` ("Too few arguments, the min no of arguments is "); `0x086a2ff2` is .text code, the alias words are at `0x086eafff` ("listalias") and `0x086eb009` ("unalias"); client `0x00902cb8` reads "nt!" (inside a string).
- Fix: comments only: `0x086eb240` for tooFew, `0x086eafff`/`0x086eb009` for listalias/unalias, and re-read the client block start.

### F8 [LEDGER-WRONG] [low] HUD-20 calls `[0x00973ab8]+0x6e4` "the buddy list"; it is the BfMap, whose `+0x13c` holds the buddies
- Code: tools/bf1942-models/viewer/comms.js:522 already says `BfMap+0x13C, 0x00468680` (right); nametags.js does not depend on the name.
- Ledger: HUD-20 -- "Buddy: `[0x00973ab8]+0x6e4` (the buddy list) present, same team, and `0x00468680(list, playerId)` true".
- Our binary: `0x006d565d movl 0x6e4(%ecx),%ecx` (ecx = `[0x00973ab8]`) is passed to `0x00467930` (`movl %eax,0x54(%ecx)`, the minimap alpha MEME-10 names `BfMap+0x54`); `0x00468680` reads `0x13c(%ecx)` of the same object.
- Fix: HUD-20: "`[0x00973ab8]+0x6e4` (the BfMap) present ... `BfMap::isBuddy` `0x00468680` over its list at `+0x13c`".

### F9 [INCONCLUSIVE] [low] Nametag aim ray: does a static stop it?
- Code: tools/bf1942-models/viewer/nametag-layer.js:137-185 -- the world collider (terrain, statics, hulls) stops the ray.
- Ledger: HUD-18 -- object cast through `objectManager vt+0x48` with `ObjectFlagPredicator(0x200)`; only a terrain hit nearer than the object hit is named as cancelling.
- Third-party: decompiled_functions_MacClient/dice_bf_Nametags_getPlayerInScoop.c:115 `ObjectFlagPredicator(aOStack_108,0x200)`; the predicate is `(obj.flags & 0x200) == 0x200` (dice_ref2_world_ObjectFlagPredicator_predicate.c). The same 0x200 filter is used by RenderSetup_renderWorld and ShadowManager_drawVisible, which suggests "drawn object", statics included -- then a building hit first names no player and the code's rule is retail's.
- Our binary: `0x0044186b push 0x200` -> `0x00441950 call [objectManager vt+0x48]`; terrain test `0x004419d7 call 0x004405b0`.
- Settle by: listing which object classes set flag bit 0x200 (the ObjectTemplate/Object flag setters on the client).

### F10 [INCONCLUSIVE] [low] Shouted radio voice plays 1.6 m above the speaker's position
- Code: tools/bf1942-models/viewer/comms.js:506-507 `standDs3dPanner(..., position.x, position.y + 1.6, position.z)`; `position` is the soldier's (or the hull's) position (map.html:3120).
- Ledger: RADIO-3 (the voice is played on the speaker's soldier, sound slot 23); no height.
- Our binary: `0x004f5c20` plays through the soldier's sound component (`this+0x110 -> vt+0xc(0x17) -> vt+0xc(n)`), i.e. at the soldier object (origin 1 m over his feet, PHY-10), in a seat still the soldier, not the hull. The +1.6 is undocumented; with the DS3D pan only direction matters, so the audible effect is small.
- Settle by: reading where the soldier's sound component positions its 3D buffers (object origin or a bone); then use origin (+1.0 over the feet) and the seated soldier's own position.

### F11 [INCONCLUSIVE] [low] Console text colour
- Code: tools/bf1942-models/viewer/console-view.js:22-26 `TEXT_COLOR = '#000000'` ("Not read out of the binary").
- Our binary: the drawer `0x00464ee0..0x004650cf` sets no colour (its calls are the line fetch, the wash quad `0x00608530`/`0x00608ae0` and `drawText` `[font vt+0x10]` at `0x0046507d` with x = 2.0 `0x00465078`); the colour is the font object's own state at `Setup+0x2d8+8`.
- Settle by: the font object's ctor / the last `setColor` (font vt+0x28) on that object.

### F12 [INCONCLUSIVE] [low] `Options/General/SkirmishPercentageOfBots` / `...OfCpu` (menu-screen.js:31-33 "still open")
- Third-party: decompiled_functions_MacClient/dice_bf_Setup_startSinglePlayerGame.c:156-167 -- `getPercentageOfBots()` (skirmish `+0x34`, campaign `+0x3c`, divided by 100, dice_bf_menu_GeneralOptions_getPercentageOfBots.c) goes to the game server's `vt+0x104`; `getPercentageOfCpu()` to `IAIMain::instance vt+0x58`.
- Not read on our binary (AI bucket's ground). Settle by naming GameServer vt+0x104 and IAIMain vt+0x58 in lnxded.

### D1 [DELIBERATE] Instant Battle lists levels without single-player scripts
- play/skirmish.js:177-186 -- retail lists a level only when `+0x70` or `+0x71` (SinglePlayerAllied/Axis.con present) is set (`0x006dca77..0x006dca83`, read); the owner's 2026-10-16 decision lists the rest in Conquest with no bots or generated bots. Keep.

### D2 [DELIBERATE] Open map framed on the art's content (map-art-frame.js:15-21, owner 2026-11-11, labelled INVENTION). Keep.

### D3 [DELIBERATE] Instant Battle AI SKILL slider works (AI-21: inert in retail); menu-screen.js / bot-settings.js label it as the viewer's improvement. Keep.

## MATCH list
- HFD-1 (setter `0x006acb60`: `+0x360 = alpha`, `+0x358 = dir`), HFD-2 (0.75 double at `0x008dbfa0`; 1/255 at `0x008d5bc8`), HFD-3 (`0x004b0967..0x004b09ee`: strict `>` against 0.9238/0.3826/-0.3826/-0.9238 at `0x008dbf78/70/68/60`, right test `r >= 0` via `testb $5; jp`; `inc bl` then setter at `0x004b0a13`), HFD-6 (`0x00957640` = 30.0; `0x00601e50` zeroes `dt > 1`) -> hud.js calculateHitOctant / hitFromDirAlpha, soldier-hud.js MENU_STEP / HIT_FROM_DIR_TIMEOUT
- XHIT-3 (`0x00406890`: `t -= dt`, floored at 0) -> soldier-hud.js hitIndicationTime
- HUD fill bar, vertical (`0x007dd0c7..0x007dd0f5`: fillOrder `+0x29` true -> `y' = y + size - scaled`, false -> `y' = y + h - size`; height = value/max x size via `0x007dc420`) -> hud.js `_drawPicture` fill branch (was "measured from sprites"; now read on the binary)
- Chat log (`0x006a8160`: per-section `timer += dt`, strict `> limit` drops the oldest and zeroes that timer; `0x006a8bf9` zeroes the chat section's timer `+0x818` on every add; `0x006a84f0` clamps `timeUntilMessageRemoved` to [1.0, 10.0] (`0x008c53c8`, `0x008dbe18`); ctor default 5.0 at `0x006a7a0c`) -> chat-log.js ChatLog
- Radio spam limit (`0x006d41c0`: refused when `count > 6` and `clock - last < 4.0` (`0x008d8f34`), a refused try still stamps `last`; `0x006d2430`: decrement when `clock - last > 4`, reset at `count <= 0`) -> radio.js RadioSpamLimit (the code also zeroes `last` on reset where retail does not; unobservable, since `count` is 0 then)
- Radio shout range 70.0 at `0x008d8438` -> radio.js LOCAL_RANGE
- HUD-16 (75 / 300 at 0x00456cc5 / 0x00456ccf: `movl $0x42960000` / `$0x43960000`) -> nametags.js NAMETAG_NEAR/SCOPE
- HUD-18 (fade -= 2D, timer -= 0.1D at 0x00441bd2 / 0x00441bf8 with 0x008c53cc = 0.1; cap 1.0 0x008c53c8; t = 0.1 d/scope 0x008d1a78 = 0.1 double) -> nametags.js ageAim/markAimed/latchAim
- HUD-19 (255 at 0x008d1a70) -> nametags.js nameTagAlpha
- HUD-20 (table 0x00957614 = 0, 0xff2828, 0x1030ff; 2pi 0x008d1a68 = 6.283 double; 127 at 0x008d1a54; call lifetime 25.0 at 0x008d6478 double) -> nametags.js TEAM_RGB, pulseRgb, CALL_LIFETIME
- HUD-22 (1.5 at 0x008d1a88) -> nametags.js NAMETAG_UP
- Scoreboard sort `0x0057b450` (score `+0xf4` desc, kills `+0xd8` desc, deaths `+0xd4` asc, then the connect-time double `+0x1b0`) -> scoreboard.js scoreOrder
- Campaign tables: totalDefeat `0x008db9c0` = -2 x4, -3 x4, -4 x8; totalVictory `0x008dba00` = 5,7,9,11,13,15,17,17,17,19,20,21,22,23,24,25 -> play/campaign.js FLOOR / CAP
- Single-player script gate `0x006dca77..0x006dca83` (`+0x70` / `+0x71`) -> play/skirmish.js comment (behaviour is D1)
- `BfMenu+0x6dc` predicates `0x0045cfc0` / `0x0045cfd0` / `0x0045cff0` / `0x0045d000` / `0x0045d050` -> scoreboard.js SINGLE_PLAYER_GAMES [0,1,4], idText
- Console dispatcher order isActive -> access -> type -> counts, messages at lnxded `0x086eb01d/33/4d/68/7d`, `0x086eb240/2e0/320`; keywords `rem 0x086e3ab3`, `if 0x086e3ac7`, `return 0x086e3adc`, `var 0x086e3b05`, `while 0x086e3b0f`, `echo 0x086bdabc`, `run 0x086eb011`, `include 0x086eb015`; strcasecmp at `0x083e41b1`/`0x083e41ef` -> console.js (except F5, F6)
- console-commands.js strings: `0x008dbab8` "Id:%d - ", `0x008dba98`, `0x008c5314`, `0x008dba88`, `0x008c5328`, `0x008c52a0`, chatInfo `0x0091d6f8/d8/b4/94`, `0x008d5bf8` "FPS: %.1f", `0x009250cc` "<%d>"; view-distance cap 100 at `0x006af061`; `game.getNameTagDistance` -> `0x00401fa0` bare `ret`; `Soldier.cameraShakeFactor` setter `0x004f1460` clamps at 1.0
- Minimap transparency `0x006d5650`: `BfMap+0x54 = 1 - T x 0.01` (`0x008c409c`), setter `0x00467930` -> page-console.js setMinimapTransparency (MEME-10)
- `setInfMouseSensitivity` name `0x00920abc` -> page-console.js
- Map vehicle marks: empty tint `0x3f130004` = 0.574219; Armor `queryComponent(0xc4a4)` at `0x0046b4db`, `hp > 0` at `0x0046b4f5` -> map-vehicle-marks.js (range gate is F7)
- Console wash: `0x00465078 push 0x40000000` (x = 2.0) -> console-view.js TEXT_X

## Fixes applied

All paths under tools/bf1942-models unless stated.

- **F1** viewer/vehicle-hud.js: `feedVehicleHud`'s reload-bar comment (was "an approximation") and `readyFraction` rewritten to retail's feeder: `f = reloadLeft/reloadTime` while reloadLeft > 0.1, else `fireLeft x roundOfFire` while fireLeft > 0.1, else 0; returns `1 - f`; overheat term removed; cites VHUD-10, 0x006d6af0, 0x006d7179..0x006d71ad, 0x00539980/0x00539a10, 0x0053cc1a. New test tests/test_vehicle_reload_bar.py + tests/vehicle_reload_bar_harness.mjs (7 cases: full when ready, reload fraction, reload has priority over the larger fire fraction, fire fraction, both 0.1 s dead bands, no overheat term, empty slot null). **Not changed (outside my files):** viewer/replay-hud.js `readiness()` (lines ~286-302) copies the old law (max of reload, fire cycle and overheat); it should take the same rule. Left for its owner.
- **F2** ledger text below.
- **F7** viewer/map-vehicle-marks.js: `mapVehicleMark` takes `distance`, `viewDistance`, `applyRange` and returns null when `applyRange && !(distance <= viewDistance)`; the "Not built" paragraph replaced with the citation (0x0046b476..0x0046b5c6, 0x0045cff0, 0x0045d050, Mac `AIPlayer::getViewDistance`). viewer/map-friendlies.js: new `localControlPosition()` (seated: hull root; on foot: the local soldier); `mapVehicleMarks` applies the range when the page is not `roomJoined` and a view distance is known, to hulls and held objects alike (the server-entity path, a joined page, is ungated). Wiring: viewer/map-surfaces.js passes `viewDistance: () => page.viewDistance?.()` into `createMapFriendlies`; viewer/map.html adds `viewDistance` to the `from(() => level, ...)` list of the map-surfaces bag (`level.viewDistance` = `sky.drawDistance()`, level-load.js:986). Tests: tests/vehicle_kill_credit_harness.mjs + tests/test_vehicle_kill_credit.py `test_a_hull_past_the_view_distance_is_hidden_outside_a_joined_game` (in range drawn, 0.5 m past hidden, joined drawn at 5 km).
- **F4** viewer/radio.js `radioGameMode(mode, { multiplayer })`: CTF 2, TDM 1, Co-op 3, Conquest/Objective 3 in single player and 1 when multiplayer; comment cites 0x006e3c31/0x006e3c48/0x0045d050 and RADIO-13. viewer/comms.js passes `multiplayer: !!page.roomJoined` and lists `roomJoined` in its page contract; viewer/map.html adds `roomJoined` to the comms bag's `room` part. features/radio-and-chat-log/README.md: the open row on `BfMenu+0x6DC` marked settled. Tests: tests/radio_chat_harness.mjs `modeJoined`, tests/test_radio_chat.py asserts `[1, 2, 1, 3, 1]` for Conquest/CTF/TDM/Co-op/Objective joined (the single-player expectation `[3, 2, 1, 3, 3]` was right and is unchanged).
- **F5** viewer/console.js: `if (args.length > 1 && (cmd.type === 1 || cmd.type === 3))` with the lnxded addresses. Tests: tests/console_harness.mjs `oneArgWriteOnly`, tests/test_console.py asserts it.
- **F6** viewer/console.js: tooFew `0x086eb240`; `listalias 0x086eafff, unalias 0x086eb009`; client block `0x00902cbc`-`0x00902d24` (re-read: "Property is only setable!" at 0x00902cbc, "Unknown object or method!" at 0x00902d24).
- **F8** ledger text below.
- **F9 SETTLED, code right.** Flag 0x200 is `hasCollisionPhysics` (COL-16, collision-response.md §5: "template bit 1, which the object's constructor turns into flag 0x200 and nothing else does"); the cast keeps the nearest colliding object, so a static wall stops the aim and names no player. Comment added in viewer/nametag-layer.js `aimed()`. No behaviour change.
- **F10 SETTLED.** The 1.6 was no engine number. A 3D voice stands at its owner's origin (SND-30); the shout's owner is the speaker's soldier (RADIO-3, `playVoice` 0x004f5c20), origin 1 m over the feet (PHY-10). viewer/comms.js `playBuffer` now stands the panner at `position.y + SOLDIER_ORIGIN_UP` (1.0, imported from nametags.js), with the citation; a seated speaker's `position` is still the hull origin (noted as an approximation). tests/test_chat_input.py: `nametags.js` added to its copied MODULES (comms.js now imports it).
- **F11 SETTLED, code right.** The console font is the renderer's shared `font/BF1942.font` (Mac `RenderSetup::loadFonts`, `RenderSetup+8`); its constructor stores colour `0xff000000` at `+0x14` (client `0x0065d594 movl $0xff000000,0x14(%esi)`; Mac `NewRendFont::NewRendFont`), the drawer sets none, and the name tags restore the old colour (HUD-22). viewer/console-view.js `TEXT_COLOR` comment rewritten; value unchanged (black).
- **F12 still INCONCLUSIVE; nothing implemented.** Read on our binary: the registrar at `0x006d4e0b..0x006d4e58` binds `SkirmishPercentageOfBots` to GeneralOptions `+0x44` and `SkirmishPercentageOfCpu` to `+0x48`. The Mac `Setup::startSinglePlayerGame` hands `getPercentageOfBots()/100` to `game->queryInterface(0x1d4c1)` vt+0x104 and `getPercentageOfCpu()` to `IAIMain::instance` vt+0x58; the Mac and lnxded vtables do not line up (lnxded `GameServer` +0x104 is `Game::getMinNrOfPlayersUsed`, `AIMain` +0x58 `isDrawEnabled`), so the receivers are not named. Settle by finding the client's readers of GeneralOptions +0x44/+0x48 in its `startSinglePlayerGame`.
- **D1-D3** comments: viewer/play/skirmish.js (the listing rule now says "DELIBERATE: ... (owner, 2026-10-16)"), viewer/map-art-frame.js ("INVENTION (DELIBERATE, keep)", owner 2026-11-11), viewer/play/bot-settings.js (new DELIBERATE paragraph: retail's slider is inert per AI-21, this one works on purpose).

Tests run (from tools/bf1942-models): `python3 -m unittest` over test_vehicle_reload_bar, test_vehicle_kill_credit, test_held_map_marks, test_console, test_chat_input, test_radio_chat, test_radio_voice_trees, test_support_calls, test_heartbeat, test_nametags, test_map_art_frame, test_menu_layout, test_campaign, test_seats, test_hud, test_hud_layout, test_replay_hud, test_deviation, test_vehicle_players, test_test_hook_vehicles, test_deploy_spots, test_level, test_meme, test_soldier_voice_rolls, test_replay_combat_area, test_preview_mute, test_mouse_look_key, test_opera_gestures, test_extract_menu_movie, test_bot_names, page_source: **838 tests OK (9 skipped)**. One failure on the way (test_chat_input: comms.js's new import of nametags.js missing from the harness's copied module list), fixed in the test. `node --check` on every edited viewer module: clean.

## Ledger edits

**VHUD-10** (replace the feeder sentence and the "Which group object `[this+0x14]` is remains UNVERIFIED ..." clause, and the trailing "and `[this+0x14]` in `FUN_006d6af0` (unrelated storage, still unverified)"):
> Feeder `FUN_006d6af0` (Mac `dice::bf::menu::Vehicle::updateAmmoBar`) is called from `0x006d71ad` with the weapon's `timeToReloadFinished` (`FireArms+0x184`, getter `0x00539980`), its `timeToFireFinished` (`+0x18c`, `0x00539a10`), the template's `reloadTime` (`FireArmsTemplate+0x3a8`; the `reloadTime` command's execute `0x004d1280`) and the weapon's shot interval (`FireArms+0x264 = 1.0 / template+0x3ac`, i.e. `1/roundOfFire`, `0x0053cc1a`). It computes `f = reloadLeft > 0.1 ? reloadLeft / reloadTime : (fireLeft > 0.1 ? fireLeft / interval : 0)` (0.1f at `0x008c53cc`) and stores `1 - f` into `[this+0x14]+0x8` for the first weapon (selector 1) or `+0xc` for the second (selector 2); it also hands the weapon to `0x006e9a50` (the Overheat group's heat). `[this+0x14]` is `new(0x10)` -> ctor `0x006ee6b0`, vptr `0x009278b8`, whose registrar (slot 2, `0x006ee610`) binds group `"Ammo"` with **`ReloadTime` `+0x8`** and **`ReloadTimeSecondary` `+0xc`** (`0x006ee625..0x006ee672`, strings `0x009278e8` / `0x009278d4`). **confirmed** 2026-11-12 (disassembly; Mac `Vehicle_updateAmmoBar` / `Vehicle_update` agree). Built: `viewer/vehicle-hud.js` `readyFraction`, `tests/test_vehicle_reload_bar.py`.

**MMAP-3** (append):
> **Range gate (2026-11-12, confirmed):** before the per-hull tests the pass reads `R = (player+0x94)->vt+0x34()`, the local player's camera's view distance (`0x0046b476..0x0046b499`; 0 when there is no camera; the Mac client's `AIPlayer::getViewDistance` makes the same call). When `BfMenu+0x6dc` is 3 (host, `0x0045cff0`) or 0/1/4 (single player, `0x0045d050`) a hull is drawn only while `|controlObject.pos - hull.pos| <= R` (`0x0046b525..0x0046b5c6`, `fsqrt`, `fcomps; test ah,0x41; jp`); a joined client (2) skips the test. Mac `MenuMapNode::onPaint` lines 991-1041. Built: `viewer/map-vehicle-marks.js`, `viewer/map-friendlies.js`.

**New row (RADIO-15), or append to RADIO-1:**
> | RADIO-15 | **`Radio/RadioGameMode` is set by the game-play mode and by whether the game is single player.** `0x006e3c31` switches on `Game::getGamePlayMode` (RADIO-13): CTF (1) -> 2 (`0x006e3ede`); TDM (3) -> 1 (`0x006e3fac`, `ebx = 1` from `0x006e3c0b`); Conquest (2), Co-op (4), Objective (5) -> `0x006e3c48`: 3 when the mode is 4 or `BfMenu::isSingleplayerGame` (`0x0045d050`: `BfMenu+0x6dc` in {0 skirmish, 1 / 4 campaign}), else 1. So a joined (2) or hosted (3) Conquest or Objective game shows the radio items undimmed. `BfMenu+0x6dc` is the starting game: its predicates `0x0045cfc0` (==0), `0x0045cfd0` (1 or 4), `0x0045cff0` (==3), `0x0045d000` (!= -1) are Mac `startingSkirmish` / `startingCampaign` / `startingHost` / (in a game); `startingJoin` is ==2 | `viewer/radio.js` `radioGameMode`, `comms.js` | **confirmed** (2026-11-12, disassembly; Mac `BfMenu_starting*` / `isSingleplayerGame` agree) | as stated |

**CON-21** (replace "type 1 given more than one is *Properties only takes one argument!* (`0x083e4547` -> `0x083e67cf`, `0x086eb320`)" with):
> type 1 or type 3 given more than one is *Properties only takes one argument!* (`0x083e4547` for type 1 and `0x083e455c` for type 3, both -> `0x083e67cf`, `0x086eb320`)

**HUD-20** (replace "Buddy: `[0x00973ab8]+0x6e4` (the buddy list) present, same team, and `0x00468680(list, playerId)` true" with):
> Buddy: `[0x00973ab8]+0x6e4` (the BfMap; `0x006d565d` hands the same pointer to the minimap-alpha setter `0x00467930`, `BfMap+0x54`) present, same team, and `BfMap::isBuddy` `0x00468680(playerId)` true (it walks the list at `BfMap+0x13c`)

**HUD-18** (append):
> The cast's `ObjectFlagPredicator(0x200)` (`0x0044186b`; predicate `(flags & 0x200) == 0x200`) keeps objects with `hasCollisionPhysics` (flag 0x200, COL-16), so the nearest colliding object, a static included, takes the hit; a building's root names no player.

**HUD-22 or CON-6** (append):
> The shared `font/BF1942.font` object (`RenderSetup+8`) is constructed with colour `0xff000000` (ARGB opaque black, `0x0065d594`, `+0x14`); the console drawer `0x00464ee0` sets none and draws in it, which is why console text is black.

**RADIO-3** (append):
> The voice is a mono 3D voice at its owner's origin (SND-30): the speaker's soldier's origin, a metre over his feet (PHY-10); in a seat, still the soldier's, not the hull's.

### F1 follow-up: replay-hud.js (assigned 2026-11-12)
- viewer/vehicle-hud.js: the feeder is now a shared, exported module-level `reloadBarValue(reloadLeft, reloadTime, fireLeft, interval)` (VHUD-10 citation); `readyFraction` calls it.
- viewer/replay-hud.js: imports `reloadBarValue`; `readiness()` now calls it instead of its own max-of-three law (the overheat term is gone). The recording carries no weapon timer, only round times: reload-left comes from `gunStateAt`'s FireState run over the recorded rounds, reload time and roundOfFire from the weapon's stats, and the shot timer left (retail's `timeToFireFinished`, `FireArms+0x18c`) is rebuilt as the whole-tick cycle (GUN-13) less the time since the last recorded round, divided by `1 / roundOfFire` as retail does. The comment says so.
- tests/test_replay_hud.py: the seat case's `ready` expectation 0.174 -> 0.172. The old value divided the cycle by itself (0.5 / 2.867 s); retail divides by the 1/0.35 = 2.857 s interval (`1 - 2.367 x 0.35`). Comment added at the assert.
- Tests: test_replay_hud, test_vehicle_reload_bar, test_seats, test_hud, test_deviation, test_vehicle_players: OK (2 skipped); test_replay_resilience (run from tests/, it imports page_source): OK.
