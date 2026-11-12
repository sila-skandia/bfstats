# sound
## Summary
- CODE-WRONG: 5 (F1 medium, F2 medium, F3 low, F4 low, F8 low) + F7 (SETTLED + CODE-WRONG, high)
- SETTLED: 3 (F5, F6, F7)
- DELIBERATE: 6 items (F9)
- INCONCLUSIVE: 3 items (F10)
- LEDGER-WRONG: 0 (ledger gaps to add: F1's loop gate on doppler -> SND-45; F5 closes SND-28's open item; F7 needs a new envelope row). RE-WRONG: 0.
- MATCH: ~40 citations (list below).
- Not reached: per-sample `Volume <- Distance`/minDistance values in .ssc data (out of scope, data); effect-audio.js voice-budget arithmetic beyond what SND-44 already verifies; loading-audio-ui.js and audio.js (UI/music only, no engine claims).

## Findings (non-MATCH), most severe first
### F1 [CODE-WRONG] [medium] Doppler applied to one-shot samples; retail gives doppler only to looping samples
- Code: tools/bf1942-models/viewer/engine-audio.js:913 — `if (voice.layer.doppler && !this.attached)`; layer.doppler = `not sample.doppler_off` (extract_map.py:1574, bf42/effects.py:623) for every sample.
- Binary: SoundPatch configureSample 0x00802120: `80218b movb 0x1e(%esi),%al; test; je 80219c; movb 0x48(%esi),%al; push eax ... 80219c push $0x0; call 0x803660` (0x803660: `movb %al,0x38(%ecx)`). desc+0x1e = `loop` (cmd 3, vtable 0x947a98+0x10 = 0x7ffc70 `movb $1,0x1e`), desc+0x48 = doppler (cmd 20 dopplerOff, slot +0x54 = 0x7ffd30 `movb $0,0x48`), ctor 0x8013e0 sets +0x48=1, +0x1e=0. Sample +0x38 gates velocity (SND-45, 0x008023dd).
- So retail: sample doppler = loop && !dopplerOff. A one-shot (start/stop, gunfire without dopplerOff, any trigger sample) never shifts.
- Fix: engine-audio.js:913 -> `if (voice.layer.loop && voice.layer.doppler && !this.attached)`; or bake `"doppler": sample.loop and not sample.doppler_off` in extract_map.py:1574 / bf42/effects.py:623. Ledger SND-45 should add: sample +0x38 = desc +0x48 only when `loop` (0x0080218b..0x0080219e), else 0.

### F2 [CODE-WRONG] [medium] `Engine::DiveAngle` is (2/pi)asin of the nose's descent, not the velocity's sine
- Code: tools/bf1942-models/viewer/vehicle-audio.js:1064-1067 — "Inferred" `if (speed > 1 && v) diveAngle = Math.max(0, -v.y / speed);`
- Ledger: SND-24 says control 1 = `(pi/2 - acos(clamp(-fwd.y,0,1))) * 2/pi`, "dive angle read, not built" (row agrees with binary; code does not follow it).
- Third-party: bf1942reverseengineering/decompiled_functions_bf42linuxServer/updateSound_082459A0.c — `fVar3 = *(this+0x9c)*0.0 + *(this+0x98)*_DAT_086648ec + *(this+0x94)*0.0; if (0.0 <= fVar3) ...`
- Our binary: lnxded.static Engine::updateSound 0x0823e930: dot of Engine+0x94..0x9c with (0,-1,0) (consts 0x086b05ec = -1.0); `fucomp` <0 -> 0; >1 -> 1; `call acosf`; `fldl 0x86cf660` (pi/2) `fsubp`; `fadd st,st`; `fdivs 0x86c4c0c` (pi); pushed as control 1 (`push $0x1; call *0x1c(%eax)` at 0x0823eaa3). Control 0 = |PhysicsEngine+0xa0| unclamped (0x0823e9ab fabs) — code matches that.
- Fix: diveAngle = (2/Math.PI) * Math.asin(clamp(-noseY, 0, 1)), noseY = world y of the engine node's forward axis (Engine+0x94 vector; the ledger calls it row 2), with no speed gate. At 30 deg nose-down retail gives 0.333, the code 0.5; and a stalled/sinking plane with nose level gives the code a dive whine retail never plays.

### F3 [CODE-WRONG] [low] A part's `Default` turn rate is the rotation's total angle per second, retail takes the largest single axis
- Code: tools/bf1942-models/viewer/vehicle-audio.js:243-244 — `rate = (2 * Math.acos(dot) * 180 / Math.PI) / dt` (quaternion angle), fed as `default` at :1012.
- Ledger: SND-20 "the largest over the three axes of |speed register| plus |continousRotationSpeed|" (agrees with binary); features/vehicle-sound-coverage/README.md:913 says the same.
- Third-party: not needed (code-vs-ledger drift).
- Our binary: lnxded RotationalBundle::updateSound 0x081d8630: `flds 0x110(%esi); flds 0x18c(%edx); fabs; fabs; faddp` per axis (+0x114/+0x190, +0x118/+0x194), keeps the larger with `fucom` (0x081d86a4, 0x081d86df); 0 if byte +0x141; `push $0x0; call *0x1c` sets slot 0 (0x081d8736).
- Verdict: a turret slewing yaw and pitch together reads up to sqrt(2) x the retail rate (a diagonal at 30+30 deg/s: 42 vs 30), raising pitch/volume of servo whines ramped on Default. The measured-vs-register gap at a stop is already recorded as "Not done" (README:1040) and is not repeated here.
- Fix: decompose the frame's local rotation delta into per-axis Euler deltas (yaw, pitch, roll in the bundle's own axes) and take `max(|d_axis|)/dt` (+ |continousRotationSpeed| per axis where the template sets one).

### F4 [CODE-WRONG] [low] TicketLow compares the share in double; the client compares the stored float
- Code: tools/bf1942-models/viewer/announcer.js:210-219 — `const share = Math.max(0, ...) / start; if (share > TICKET_LOW_HIGH) ... else if (share > TICKET_LOW_FLOOR ...)` (no `Math.fround`, while `heartbeatLevel` at :109 does fround).
- Ledger: RADIO-10/RADIO-14 (bands and constants agree).
- Our binary: 0x006e38a3 `fdivs 0x10(%esp); fsts 0xc(%esp); fcompl 0x8eaf70` (0.2 double); 0x006e38b8 `flds 0xc(%esp); fcompl 0x925a08` (0.05 double) — the 0.05 compare reloads the FLOAT share. 0.05f = 0.0500000007 > 0.05, so a share of exactly 1/20 is in (0.05, 0.2] in retail and plays TicketLow if unlatched; the code (double 0.05) plays nothing there. The 0.2 compare uses st0 un-reloaded, so it depends on the x87 precision mode D3D leaves (24-bit: 0.2f > 0.2, re-arms; 53-bit: equal, plays) — inconclusive at exactly 1/5.
- Fix: `const share = Math.fround(left / start)` for the 0.05 test at least (the heartbeat already does it). Practically invisible (the latch is normally set long before 5 %).
- All other announcer constants MATCH: 0.2/0.05 doubles, bands 0.04/0.03/0.02/0.01/0 -> 0.4/0.6/0.7/0.8/1.0 (0x006e394d..0x006e3a5a; dead 0.5 band at 0x006e3984 confirmed), Objective `1 - 0.1f x tickets` at <= 10.0f (0x006e3b4a..0x006e3b6f), heavy casualties `cmp 0x64; setge` and Objective `<= 0xa` (0x0046ca3e..0x0046ca86), modes 2/4/5 and local-team gate (0x006e37b0..0x006e37e2), latch +0x30/+0x2f.

### F5 [SETTLED] [low] SND-28's open register: while the game is paused (status 4) the HUD sets the `Default` group to 0
- Code: tools/bf1942-models/viewer/sound-options.js:85-88 (MASTER VOLUME = `Default` group x 0.01) — no paused state anywhere in the page's audio (rg `status === 4` / paused in round-state.js, page-audio.js: none).
- Ledger: SND-28 "Open: the value the HUD writes while the game state (`g_game` vt +0x74) is 4 (0x006ad3a7..0x006ad3b8, a register this reading did not trace)".
- Third-party: not needed.
- Our binary: HUD update 0x006ad0a0 `xorl %ebx,%ebx` at 0x006ad0b1, ebx never reassigned before 0x006ad3a7 `pushl %ebx` -> `call 0x7f9830` (VolumeGroup__set "Default" 0x008d1b70) => 0.0f. Status 4 is the pause: lnxded `Setup::toggleGamePause` 0x080c6b60 compares getGameStatus (vt+0x74) to 4 (0x080c6bed) and keeps a static `lastGameStatus` to restore. Otherwise the HUD writes `fildl [settings+0x14]; fmuls 0x8c409c (0.01)` (0x006ad3ce..0x006ad3eb).
- Verdict: a paused round is silent in retail (every game voice is in `Default`). Ledger row should close the open item: "status 4 (paused) -> Default = 0". Code change only if the page ever shows a server-paused round (none today).

### F6 [SETTLED] [low] engine-audio.js still calls the minDistance -> SetMinDistance link inferred; it is read
- Code: tools/bf1942-models/viewer/engine-audio.js:102-105 — "Which layer field the client hands `SetMinDistance` is inferred ... were not joined up."
- Ledger: SND-6 / SND-27 already say verified (description +0x2c -> sample +0x24 via 0x00803650).
- Our binary: 0x00802175 `movl 0x2c(%esi),%ecx; push; call 0x803650` and 0x00803650 `movl %eax,0x24(%ecx)`; update 0x0080243c `movl 0x24(%ebx),%eax ... call *0x30(%edx)` (the same wrapper slot voice init gives 1.0, 0x007fefe7..0x007fefee). Command 6 handler 0x007ffcb0 writes +0x2c (vtable 0x00947a98 slot +0x20).
- Fix: comment only — replace the "inferred" paragraph with the read chain. No behaviour change.

### F7 [SETTLED + CODE-WRONG] [high] Six-parameter `Ramp`s are curves: p5 picks the shape (0 linear, 1 quick, 2 slow), p6 is its exponent; the code plays them all linear
- Code: tools/bf1942-models/viewer/ssc-curves.js:9-21 — "Six-param ramps occur (573 in vanilla); the surplus pair's meaning is unresolved ... it is ignored here too"; `const [a = 0, b = 0, base = 0, delta = 0] = params; ... return base + delta * ((x - a) / span)`. Same hedge in tools/bf1942-models/bf42/level.py:414-417.
- Ledger: none (no SSC/SND row covers envelope evaluation).
- Third-party: bf1942reverseengineering/decompiled_functions_MacClient/dice_bf_Ramp_getModulation.c (`iVar2 = FUN_007a4420((double)pfVar1[4]); if (iVar2 == 1) calculateQuick ... else if (iVar2 < 1) ... calculateLinear ... else if (iVar2 < 3) calculateSlow`), dice_bf_Ramp_calculateQuick.c (`pow((x - p[1]) / (p[0] - p[1]), p[5])`, `p[3] * (1.0 - pow)`), dice_bf_Ramp_calculateSlow.c (`p[3] * pow((x - p[0]) / (p[1] - p[0]), p[5])`), dice_bf_Ramp_calculateParamModulation.c (`if (p[1] < p[0]) p[1] = p[0]`).
- Our binary (BF1942.exe): Ramp ctor 0x00803a10 (`push $0x6` params; `movl $0x0,0x10(%ecx)` p5 = 0; `movl $0x3f800000,0x14(%edx)` p6 = 1.0). getModulation 0x00803aa0: p2 := p1 when p2 < p1 (0x00803aaf..0x00803abd); x > p1 and x < p2 -> `flds 0x10(%esi); call 0x804af0` (ftol, truncate) then 0 -> linear (0x00803b6b), 1 -> 0x00803a70 (`(x-p2)/(p1-p2)`, `flds 0x14; call _CIpow` thunk 0x804c14, `fsubrl 1.0`, `fmuls 0xc`), 2 -> 0x00803b33 (`(x-p1)/(p2-p1)`, pow p6, `fmuls 0xc`), any other -> 0x00803b85 returns p3 + p3 (the local holding p3 added twice); x >= p2 -> p3 + p4; x <= p1 -> p3, except p1 == p2 and x >= p1 -> p3 + p4 (0x00803ae2..0x00803af9).
- Data: the local scene.json set (133 files under viewer/maps) holds 5,140 six-param Ramps against 150,628 four-param: shape 2 (slow) dominates (2/2.0 x1470, 2/0.16 x869, 2/0.3 x554, 2/1.7 x509 ...), shape 1 x~510, shape 3 x88, shape 0 x12. They sit mostly on engine `Pitch <- Default/Speed/DiveAngle` — the rev-to-pitch curves. Example bf1918 fao_landing `Pitch <- Default [0, 1.1, 0.45, 0.55, 2, 5]`: at revs 0.55 retail 0.467, code 0.725.
- Fix (ssc-curves.js rampAt):
  ```js
  const [a = 0, b0 = 0, base = 0, delta = 0, shape = 0, exp = 1] = params;
  const b = b0 < a ? a : b0;
  if (x > a) {
    if (!(x < b)) return base + delta;
    const s = Math.trunc(shape);
    if (s === 0) return base + delta * (x - a) / (b - a);
    if (s === 1) return base + delta * (1 - ((x - b) / (a - b)) ** exp);
    if (s === 2) return base + delta * ((x - a) / (b - a)) ** exp;
    return base + base;
  }
  return a === b && x >= a ? base + delta : base;
  ```
  (also fixes the step edge: `Ramp t t p3 p4` at exactly x = t is p3 + p4 in retail, p3 in the code). Add a ledger row (SSC- or SND-) recording the envelope law; drop the "unresolved" notes in ssc-curves.js and level.py.

### F8 [CODE-WRONG] [low] The soldier refill one-shot has no DirectSound fall-off
- Code: tools/bf1942-models/viewer/page-audio.js:386-390 — `panner.distanceModel = 'linear'; panner.refDistance = 10; panner.maxDistance = 15;` (the script's 10..15 m `Volume <- Distance` ramp only).
- Ledger: SND-6 (every 3D voice falls off as `(minDistance / d)`, default minDistance 1, voice init 0x007fefee) — the rest of the page applies it (`distanceRolloff`).
- Our binary: 0x007fefe7 `push $0x3f800000; call *0x30(%edx)` (min distance 1.0) and per-frame 0x0080243c..0x00802444 (layer minDistance) — no voice is exempt.
- Fix: gain = ramp(d) x distanceRolloff(d, script minDistance or 1); i.e. keep panner rolloff 0 and multiply the gain, as engine-audio.js does. Unless `SoldierRefillAmmo.ssc` says `minDistance >= 10` (not checked: the script is not extracted on disk), a refill heard 5 m away is ~-14 dB too loud.

### F9 [DELIBERATE] [low] Kept differences from retail (do not "fix" back)
- engine-audio.js:134-135 doppler shift clamped to 0.85..1.2 (DirectSound has no clamp; documented only in the code comment "chipmunks the whole mix") — undocumented in a feature doc.
- ssc-coherent.js: coherent twins (one sample, one offset, e.g. the coax Browning's 2D/3D hand-over at 1..2 m) are arbitrated to one voice; retail sums both. Documented: features/bf1942-3d-models/map-sounds.md:136-140, features/vehicle-sound-coverage/README.md:471.
- area-sound.js `loudestEmitter`: one voice per same-file group, loudest wins; retail runs every AreaObject's own sound. Documented: map-sounds.md (one-voice-per-sample rule).
- page-audio.js:858-866 soldier one-shots skipped beyond 40 m (perf; retail has no max distance, SND-6). Documented in code.
- sound-options.js:104 default MASTER VOLUME 70 (SoundHigh.con 75, Default profile 100). Documented in code.
- vehicle-audio.js part turn read off node motion, not the speed register (silent against a stop). Documented: vehicle-sound-coverage/README.md:1040.

### F10 [INCONCLUSIVE] [low] Not settled
- SND-14 "which instance a ninth play steals: inferred the oldest" (engine-audio.js:558, :699): the steal is a priority heap (0x00800aa0 -> 0x00801f30, compares floats at 0x00800abf); not traced to its key. Would need the heap's compare at 0x00801f30 and what 0x007444a0 stores.
- engine-audio.js:909-913 attached voices get no doppler ("Inferred"): the client sets velocity as usual (0x008023dd); at zero distance the shift is DirectSound's/Wine's business, which the binary cannot answer.
- F4's 0.2 edge depends on the x87 precision control D3D8 leaves set.

## MATCH list
- SND-30 / ds3d-pan.js: DS3DALG_NO_VIRTUALIZATION GUID at 0x00947d5c (bytes 3f3341c2 1b1c d211 94f5 00c04fc28aca); stereo clears 3D byte (0x007ffc60 = vtable 0x00947a98 slot +0x0c); desc ctor 0x008013e0 sets 3D byte +0x1c = 1.
- SND-41 / ds3d-pan.js: 0x007fe4d9..0x007fe4f5 `sete; lea 4+4*eax; or 0xa0` -> LOCHARDWARE (4) when the hardware byte is set, LOCSOFTWARE (8) otherwise; 0x007fe50e `or 0x20010` = CTRL3D | MUTE3DATMAXDISTANCE.
- SND-45 / ds3d-pan.js: 0x00537300 stores to 0x00958294 (1.0) only when changed, then listener wrapper slot +0x4.
- SND-6 / engine-audio.js distanceRolloff, area-sound.js: SetMinDistance(1.0) 0x007fefee, SetMaxDistance 0x4e6e6b28 (1e9) 0x007feffa; per-frame min distance 0x00802444; ROLLOFF_FACTOR 1.
- SND-4 / engine-audio.js attached: 0x0080237a `+0xc0` -> listener position.
- SND-14 / engine-audio.js: instance cap DAT_0095ac98 = 8.
- SND-27 / environment-sound.js scriptVolume, engine-audio.js clamp: clamp const 0x008d1a60 = 1.0; desc default volume 1.0 (ctor +0x24); dB factor 0x0094bac4 = 865.617.
- SND-28 / sound-options.js soundMaster, page-audio.js: HUD `fildl [settings+0x14]; fmuls 0x8c409c` (0.01) -> VolumeGroup__set Default; master 0x0095ac80/84 = 1.0.
- SND-18/SND-24 rpm half / engine-audio.js base.rpm: Engine::updateSound 0x0823e930 `flds 0xa0; fabs`, no clamp, slot 0; m_alwaysPlaySound 0x0872bd70 default 0 (code's "running byte" gate matches the default).
- SND-20 gate / vehicle-audio.js: LandingGear skipped (cmp 0x86c2be8), byte +0x141 zeroes the rate, slot 0 + attach test.
- SND-11 / environment-sound.js: bed attached to listener (ledger chain; not re-read).
- AreaObject / area-sound.js: lnxded 0x08269f30 needs > 2 points (`cmpl $0x2,%edi; jle` 0x08269fd3), radius strict `r^2 > d^2` (0x0826a2ee..0x0826a305, template +0x15c), XZ outline, closed.
- RADIO-9..11, RADIO-14 / announcer.js: all constants and gates listed under F4.
- SND-17 / vehicle-audio.js _watchReload, page-audio.js: trigger on reload start (ledger, code agree).
- SND-2, SND-3, SND-5, SND-7, SND-12, SND-13, SND-16, SND-19, SND-21, SND-22, SND-23, SND-33..38, SND-40, SND-42..44, SND-46: code follows the ledger row as cited (name/route checks, not re-disassembled).
- Linear envelope / ssc-curves.js linearAt: 0x008039f0 `control * p2 + p1` (fmuls 4; fadds 0).
- Ramp clamp p2 := p1 when p2 < p1 (0x00803aaf) — code's `span <= 0` path is equivalent except the x == p1 edge (in F7).
- effect-audio.js: SoundSetup ctor `movl $0x20,0x50(%ebx)` at 0x080d520a (voice limit 32), `$0x14` at +8 (soundStreamUpdateFrequency 20).

## Fixes applied
- F7: tools/bf1942-models/viewer/ssc-curves.js `rampAt` (header comment + body, ~lines 8-37): six params, p2 raised to p1, ftol(p5) 0 linear / 1 quick / 2 slow / other p3 + p3, p6 exponent (default 1), step up at x == p1 == p2. Shape "3 returns p3" in the coordinator's note: the binary returns p3 + p3 (0x00803b85 `flds 0xc(%esp)` = the local holding p3, then `fadds 0x8(%esp)` after `pop edi` = the same local); implemented per the binary. New tests: tools/bf1942-models/tests/test_ssc_curves.mjs + test_ssc_curves.py (each shape from the disassembled formula, ftol, steps, reversed pair, four real bf1918 engine curves). Docs fixed in place: bf42/level.py `SoundEffect` docstring and `_distance_volume` docstring (that function still keeps only params[:4] for the ambience distance ramp: follow-up, needs `params[:6]` plus a scene re-extract; not changed); features/flyable-vehicles/engine-sound.md (ramp section); features/bf1942-3d-models/parity-audit/audio.md open item 3 struck. Note: the step edge also moves Time gates `Ramp t t 0 1` one frame earlier at exactly t.
- F1: viewer/engine-audio.js doppler gate now `voice.layer.loop && voice.layer.doppler && !this.attached`; SPEED_OF_SOUND comment rewritten with 0x0080218b..0x0080219e and the clamp marked DELIBERATE. Test added to tests/test_engine_audio_default.mjs (loop shifted, dopplerOff loop not, one-shot not).
- F2: viewer/vehicle-audio.js `_engineControl`: diveAngle = (2/pi) asin(min(1, descent)) when descent > 0, descent = new exported `noseDescent(matrix, quaternion)` (world y of the engine node's local -Z, negated; falls back to the drive's orientation). Speed gate removed. Test in tests/test_vehicle_parts.mjs (30 deg nose-down -> 0.5 descent, dive 1/3, from matrix and quaternion).
- F3: viewer/vehicle-audio.js `turnRate` (now exported): largest component of the frame's local rotation vector `conj(prev)*now`, deg/s; marked DELIBERATE for reading motion rather than the register. Test in tests/test_vehicle_parts.mjs (yaw+pitch 30+30 -> 30; yaw alone 15).
- F4: viewer/announcer.js: the 0.05 compare uses `Math.fround(share)`; the 0.2 compare left in double (FPU-mode dependent, unsettled — fround there would change the existing tested 20/100 behaviour on an unproven premise). Pronoun "he" -> "they" in the frame() doc. Tests: tests/radio_chat_harness.mjs `lowAlreadyUnderFloor` moved from 5/100 to 4/100 (5/100 is now in the band, which is the fix), new `lowAtTheFloor` 5/100 -> [3]; tests/test_radio_chat.py asserts it.
- F5: no pause state exists in the page (searched viewer/ and viewer/play/); comment added to viewer/sound-options.js MASTER VOLUME row. No code change.
- F6: viewer/engine-audio.js minDistance comment replaced with the read chain.
- F8: viewer/page-audio.js: `SoldierRefillAmmo.ssc` read from vanilla Objects.rfa (`~/.wine/drive_c/EA Games/Battlefield 1942`): HIGH patch `minDistance 5`, `Volume <- Distance Ramp 10 15 1 -1`, randomStartPitch 0.05, priority -2. New exports `REFILL_MIN_DISTANCE`, `REFILL_DISTANCE_RAMP`, `refillVolumeAt(d)` = ramp x min(1, 5/d); `playRefillSound` sets the gain from the true distance and the panner's rolloff to 0 (it stands at the render point). Test in tests/test_ds3d_pan.mjs.
- F9: DELIBERATE comments: engine-audio.js doppler clamp; ssc-coherent.js header; area-sound.js `loudestEmitter`; page-audio.js 40 m foley skip; sound-options.js default 70; vehicle-audio.js `turnRate`.
- Tests run (all pass): `python3 -m unittest tests.test_ssc_curves tests.test_engine_audio tests.test_vehicle_audio tests.test_area_sound tests.test_ds3d_pan tests.test_radio_chat tests.test_heartbeat tests.test_effects tests.test_sound tests.test_map_sounds tests.test_sound_voice_rules` (238 OK, 2 skipped), `tests.test_console tests.test_chat_input tests.test_extract_radio` (82 OK); node suites test_vehicle_parts, test_engine_audio_default, test_effect_audio, test_reload_sound, test_gun_burst_edges, test_world_fire, test_flyby_cracks, test_gun_one_shots, test_environment_sound, test_sound_voice_rules, test_area_sound, test_ds3d_pan (14/14), test_ssc_curves: all pass.

## Ledger edits
New row (SSC section, after SSC-6):

| SSC-7 | A six-parameter `Ramp`'s surplus pair is unresolved; reading every Ramp as four-param linear reproduces the design | `viewer/ssc-curves.js` `rampAt`; `bf42/level.py` `SoundEffect` (params carried whole; `_distance_volume` still keeps four) | **refuted** (2026-11-12, BF1942.exe; Mac dump `dice_bf_Ramp_getModulation.c` the lead) | **p5 is the curve and p6 its exponent.** Ramp ctor `0x00803a10` (`push 6` params; p5 `+0x10` = 0, p6 `+0x14` = 1.0). `getModulation` `0x00803aa0`: p2 := p1 when p2 < p1 (`0x00803aaf`); x > p1 and x < p2 -> `ftol(p5)` (`0x00804af0`): 0 `p3 + p4 (x - p1)/(p2 - p1)` (`0x00803b6b`), 1 quick `p3 + p4 (1 - ((x - p2)/(p1 - p2))^p6)` (`0x00803a70`, `_CIpow` thunk `0x00804c14`, `fsubrl 1.0`), 2 slow `p3 + p4 ((x - p1)/(p2 - p1))^p6` (`0x00803b33`), any other `p3 + p3` (`0x00803b85`); x >= p2 -> `p3 + p4`; x <= p1 -> p3, except p1 == p2 and x >= p1 -> `p3 + p4` (`0x00803ae2..0x00803af9`). `Linear` is `x p2 + p1` (`0x008039f0`). Data: 5,140 six-param of 155,785 Ramps in the local bakes, mostly engine `Pitch` curves of shape 2 |

SND-45, append to the evidence: "A sample's doppler byte `+0x38` is the description's `+0x48` (set by the ctor `0x008013e0`, cleared by `dopplerOff` `0x007ffd30`) only when the description's `loop` byte `+0x1e` is set, else 0 (`SoundPatch__configureSample` `0x0080218b..0x0080219e` -> `0x00803660`): a one-shot never shifts. Built 2026-11-12 (`engine-audio.js`)."

SND-24, change status to: "**refuted for the rpm (built 2026-10-07) and for the dive angle (built 2026-11-12: `vehicle-audio.js` `noseDescent`, `(2/pi) asin`)**"; drop "The viewer's dive angle is still `max(0, -v.y/|v|)`".

SND-28, replace the **Open** sentence's first half with: "While the game status is 4 (the pause: lnxded `Setup::toggleGamePause` `0x080c6b60` tests vt+0x74 == 4 at `0x080c6bed` and keeps a static `lastGameStatus`) the HUD writes `Default` = 0.0: the pushed register is ebx, zeroed at `0x006ad0b1` and never reassigned before `0x006ad3a7`. A paused game is silent." (keep the remainder about the menu's own update).

RADIO-10, append: "The 0.05 compare reloads the stored float (`0x006E38B8`), so a share of exactly 1/20 (0.0500000007f) is in the band; the 0.2 compare (`0x006E38AB`) is on the quotient still in st0 and so depends on the FPU precision mode (unsettled). Built 2026-11-12 (`announcer.js`)."

SND-6 / SND-10 (optional evidence line): "`SoldierRefillAmmo.ssc` HIGH (vanilla Objects.rfa): `minDistance 5`, `Volume <- Distance Ramp 10 15 1 -1`; `page-audio.js` `refillVolumeAt` plays ramp x min(1, 5/d)."

## Scene patches
**Nothing to patch: no exported tree carries a non-linear distance Ramp.**

Step 1 (code, done):
- tools/bf1942-models/bf42/level.py `_distance_volume`: `eff.params[:6]` (was `[:4]`), docstring rewritten (SSC-7). Feeds `sounds.areas[].distanceVolume` for AreaObjects and point emitters.
- tools/bf1942-models/extract_map.py (flag flap entry, ~line 1320): `ramp[:6]` (was `[:4]`).
- tools/bf1942-models/extract_radio.py (heartbeat row, ~line 371): `params[:6]` (was `[:4]`).
- tools/bf1942-models/extract_weapon_sounds.py `_ramp_at`: now the full SSC-7 law (six params, shapes, p2 := p1, step up at p1), same as `ssc-curves.js` `rampAt`.
- The viewer side needed no change: `area-sound.js` `distanceVolume` (and the flag path through `emitterAt`) already evaluates through `ssc-curves.js` `modulate` -> the new `rampAt`.
- Tests: tests/test_sound.py `test_a_curved_distance_ramp_keeps_its_shape_pair` (six params survive discovery); tests/test_area_sound.mjs case 8b (a `10 30 1 -1 2 2` ramp is 0.75 at 20 m). Ran test_sound, test_area_sound, test_obstacle, test_level_declares_first, test_extract_radio, test_heartbeat, test_weapon_sounds, test_weapon_burst_edges, test_weapon_sounds_on_disk, test_sound_slots_and_picks, test_map_sounds, test_scene_layers: 220 OK, 2 skipped.

Step 2 (blast radius):
- Source scan of every `.ssc` in every installed mod's archives (all `.rfa` under each `Mods/<M>`, HIGH tier), looking at what `_distance_volume` reads (patch's first sample, first `Volume <- Distance` Ramp) with more than four params and `int(p5) != 0`: bf1942 1,084 scripts, XPack1 209, XPack2 508, bf1918 1,904, FHSW 7,957, FHSWEurope 4,683, GCMOD 1,800, DesertCombat 1,399, DC_Final 1,042, EoD 2,817, FH 17,664 -> **0 in every mod.** This is a superset of every exported level in every tree, so no exported level can be affected. Detector checked on vanilla: it finds 553 non-linear Ramps on other sources (default/extern pitch and volume, speed, acceleration, time), none on Distance. Script: scratchpad/ssc_scan.py.
- Confirmed end to end on the trees this machine holds: `patch_scene.py --layer sounds --mod bf1918 --all` against a scratch copy of the bf1918 tree (133 levels): `133 level(s), 0 scene.json written`; vanilla `wake` likewise 0 written. (The local vanilla, FHSW, EoD and DC trees hold only maps.json and `_shared`, not level folders.)
- Weapons path (`_ramp_at`, not a scene layer): over vanilla's 8,022 volume Ramps the old and new evaluation at x = 0 differ in one place, `M1Garand` patch 6 (the eject, `Volume <- Time Ramp 0 0 0 1`: now up at t = 0, as 0x00803ae2 says). Patch 6 is read by `_slot_edge`, which does not call the evaluator, and `fire_delay` gives 0 either way, so no `weapons.json` changes.

Steps 3-4: no tree affected, so no patch run on any live tree and nothing to publish. If wanted anyway, the no-op command per tree would be `python3 tools/bf1942-models/patch_scene.py --layer sounds --mod <M> --all` then `scripts/publish-mesh-delta.py maps --hash`.

Caution for the coordinator: while I worked, another session was running `mod_pipeline.py run --mod GCMOD --all-own-levels` (extract_map.py processes from this checkout, writing viewer/maps/mods/gcmod). I did not touch that tree. Its new bakes pick up the six-param `distanceVolume`, which is harmless (the scan says GCMOD has no curved distance ramps).
