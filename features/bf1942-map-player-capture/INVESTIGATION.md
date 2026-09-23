# BF1942 Control-Point Capture Investigation

## Scope

- Executable context: BF1942 Linux dedicated-server reference corpus (`lnxded`).
- Behavior: Conquest control-point ownership and capture eligibility.
- Reproduction target: Bocage neutral flags in the map viewer's single-player path.

## Binary Evidence

The decompiled `GameServer::handleFrameUpdate` path is recorded in:

- `features/bf1942-engine-reference/lnxded/decompile.sh` output for
  `0x08283b00` (`/tmp/bf42-capture/08283b00.c` during investigation).
- `0x08283b00` counts active players inside the control point's runtime radius,
  separates players on the current owner side from an enemy side, and uses the
  control-point runtime owner field before selecting capture/loss transitions.
- The runtime owner is initialized from the `ControlPoint` template and is changed
  by the control-point `gotControl`/`setTeam` path. It is not initialized from a
  `SoldierSpawn` group's side.
- The neutral capture path requires the enemy count to reach the template's minimum
  player count field (`ControlPointTemplate` offset `+0x204` in the reference
  decompilation) before decrementing the get-control timer.
- The capture and loss timers are separate runtime fields. The constructor copies the
  template values at `+0x1f4` and `+0x1f8`; they are not a universal hard-coded timer.
- The radius is read from the runtime control-point object, not inferred from a
  nearby spawn pad.

The relevant transition functions are emitted alongside the frame-update decompile:

- `gotControl` / control transition: `0x08284030`.
- `setTeam` and related team propagation: `0x08284090`.
- control-point construction/runtime field initialization: `0x082838b0`.

These addresses are valid only for the verified `lnxded` reference corpus. Re-run
`./xref.py check` and the decompile script before applying them to another binary.

## Confirmed Viewer Bug

`viewer/soldier.js` selected a control point's initial team with this precedence:

```js
ownedSpawn.team ?? controlPoint.team
```

That conflated the side listed by a spawn group with the live owner of the control
point. A neutral Bocage point could therefore enter the viewer as Axis/Allied-owned,
so the local capture loop correctly refused to capture it from the viewer's point of
view.

The fix gives the authored control-point team precedence, including team `0`, and
uses the spawn-group side only when the control point has no team value at all.

## Open Findings

- The exact retail radio asset and event-selection path still needs a separate client
  binary/audio investigation. No synthetic speech or generated radio line is valid.
- The complete mapping of the template boolean fields around `+0x1fc..+0x200` needs
  the corresponding `ControlPointTemplate` parser evidence before those modifiers are
  exposed in the viewer.

## 2026-09-23: Flag-Status Indicator, Capture Voice, Minimap Cluster

Question and scope — Bocage, conquest, client viewer: (1) the little white-flag
disc beneath the minimap while standing in a neutral point's radius; (2) the
"captured" voice on a take and the take-back line; (3) the minimap's size and
position under the ticket bar.

Evidence — `menu/InGame` via `hud-layout.json` groups `supplyIcon`
(`ShowFlagIcon && !AxisFlagIcon && !AlliedFlagIcon`, 64x64 `icon_flag` leaf at
(720,230)) and `tickets` (256x32 `icon_ticketbar` plate at (270,4));
`Bf1942/Game/GamePlay.ssc` (bf1942/Game.rfa: `GainControlPoint` =
`WeNowHaveControlOver{,2,3}.wav`, `LoseControlPoint` =
`WeHaveLostControlOf{,2,3}.wav`, both `randomPlay 1`); retail captures
`capturing-neutral.webp` / `flag-after-capture.webp` (2559x1441) measured for
ticket bar (x 622.2..793.7, y 4.6..27.5), minimap frame (x 621.9..793.4,
y ~30..~204, cpbar strip y ~206..220), and flag disc (~60 virtual px at
x ~721..783, y ~231..292, i.e. the (720,230) 64x64 leaf). Client binary trace:
`strings 'ShowFlagIcon|ShowNonTakeable|AxisFlagIcon|AlliedFlag'` hits only the
`0x006e3174` registration table (SUP-17); no writer xref resolves without
Ghidra running, so the feed rule is layout-data, not binary-traced.

Confirmed — the neutral disc is the layout's own `ShowFlagIcon` leaf; the
take voice is `GamePlay.ssc GainControlPoint` (22 kHz `@Language`
`sound/22khz/<Lang>/`); the ticket bar and minimap are one 171.5-wide cluster
(map/ticket ratio 0.962).

Open/refuted — exact client event→`GamePlay.ssc` trigger wiring (which
game-event fires `GainControlPoint` vs `LoseControlPoint` for a neutral take
vs an enemy take-back) is open: both takes play the gain patch here. The
`tickets`/`supplyIcon` groups are NOT in `menu/InGame` tops 27+ (verified by
walking all 30 tops) — their rects come from the layout JSON, not a MemeFile
read this round. Minimap/cpbar/flag-chrome classes are engine-drawn, not
MemeFile nodes (no BfMap/Minimap/MapBar class in the file).

Implementation impact — `viewer/map.html` only: `feedFlagIconVars` (neutral
disc from `nearestEnemyFlag`), `playCaptureVoice*` (gain patch, 1/s throttle),
`#minimap` 188→196 px and top 16→44 px under the painted ticket bar (118/34 px
mobile). Voices extracted to `viewer/maps/_shared/voices/en/` (gitignored
bake output, like `sounds/`; publish via the mesh-assets skill, not git).
Tests: `test_hud_layout`, `test_hud`, `test_supply` pass; module `node --check`
clean.

Verification — `python3 -m unittest
tools.bf1942-models.tests.test_hud_layout tools.bf1942-models.tests.test_hud
tools.bf1942-models.tests.test_supply` → OK; `node --check` on the extracted
module → clean. Voice auditions (`WeNowHaveControlOver.mp3` etc.) confirmed
against the bypass request, not re-transcribed here.
- The dedicated-server and single-player-host paths should be compared before claiming
  that every client-visible transition has the same network event.

## Verification

- `./xref.py check`
- `./lnxded/decompile.sh /tmp/bf42-capture 'ControlPoint' 'GameServer::.*(simulate|update|trigger|player|capture)' 'ObjectSpawner::setTeam'`
- `python -m unittest tools.bf1942-models.tests.test_soldier`
