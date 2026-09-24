# Viewer profile controls

Import a real BF1942 player profile into the mesh viewer so the viewer inherits
that player's key bindings (and joystick axes) instead of the hard-coded ones.
The driving requirements, from the owner:

- fly with a joystick, the way the profile's Air tab binds pitch/roll/yaw/throttle
- respect the profile's minimap bindings (show map, zoom map) — the owner's
  profile has them on **F** and **Left Alt**, not the viewer's current M and N
- remove every hard-coded binding in the viewer and replace it with a default
  drawn from the game's own shipped control maps, overridable by an imported
  profile

Status: **implemented** (keyboard triggers, joystick via the Gamepad API,
profile import). Open items are at the end of §4. Grounded in the owner's real
profile at `~/.wine/drive_c/EA Games/Battlefield 1942/Mods/bf1942/Settings/
Profiles/skandia/` and the shipped defaults in
`Mods/bf1942/Settings/Default/Controls/`.

---

## 1. Where the profile lives, and what is in it

A profile is one folder per player under
`Mods/bf1942/Settings/Profiles/<name>/`. For bindings we need:

| file | what it holds |
|---|---|
| `Controls/Common.con` | `defaultGameControlMap` (`c_GI*`: console, menus, scoreboard) + `defaultPlayerInputControlMap` common player triggers (`c_PIUse`, `c_PIMap`, `c_PIZoomMap`, `c_PIShowScoreBoard`, camera modes, radio 1-8) |
| `Controls/Infantry.con` | the on-foot map: WASD axes, fire/altfire on mouse, reload, crouch, prone, kit slots 1-6 |
| `Controls/Air.con` | the aircraft map: throttle/yaw/pitch/roll axes, fire/altfire, mouse-look |
| `Controls/Land.con` | the land & sea map (its `ControlMap.create` name is `LandSeaPlayerInputControlMap`) |
| `GeneralOptions.con` | `game.setCommonMouseSensitivity`, `setInfMouseSensitivity`, `setStaticMinimap`, `setMinimapTransparency` |
| `Profile.con` | player name, crosshair colour, chat sizes (cosmetic, later) |

Land and Sea are one file: the game's LAND & SEA tab writes `Land.con` only, and
the `ControlMap.create` line inside says `LandSeaPlayerInputControlMap`.

### 1.1 The binding format

Four console verbs, all line-structured, easy to parse:

```
ControlMap.create defaultPlayerInputControlMap
ControlMap.addKeyToTriggerMapping    c_PIMap      IDFKeyboard IDKey_F c_CMNonRepetive
ControlMap.addButtonToTriggerMapping c_PIMap      IDFGameController_0 IDButton_12 c_CMNonRepetive 1
ControlMap.addKeysToAxisMapping      c_PIThrottle IDFKeyboard IDKey_W IDKey_S
ControlMap.addAxisToAxisMapping      c_PIPitch    IDFGameController_0 IDAxis_1 1
ControlMap.addAxisToAxisMapping      c_PIMouseLookX IDFMouse IDAxis_0 0
ControlMap.addAxisToTriggerMapping   c_PINextItem c_PIPrevItem IDFMouse IDAxis_2
```

- **Devices**: `IDFKeyboard` (`IDKey_*` = a DirectInput scancode name — the same
  identity as the browser's `event.code`, physical key, layout-independent),
  `IDFMouse` (`IDButton_0/1`, `IDAxis_0/1` look, `IDAxis_2` wheel),
  `IDFGameController_0` (the joystick: `IDButton_0..31`, `IDAxis_0..3`).
- **Flags**: `c_CMNonRepetive` (fire once per press) vs `c_CMPushAndHold`
  (level while held) vs nothing (axis). A trailing `1` appears on joystick
  button bindings (meaning unknown, ignored) and on the second key of some
  axis bindings.
- **Multi-binding**: one trigger carries any number of bindings. The owner's
  `c_PIUse` is *both* `IDKey_E` and joystick button 11; a trigger keeps every
  binding it was given.
- **Display numbering**: the game's menu shows joystick buttons 1-based
  (`IDButton_11` renders as `JOYSTICK 12`). A UI that lists imported bindings
  must add 1 to match what the owner sees in the real options screen.
- **`run User.con`**: `Common.con` ends with `run User.con`; the profile folder
  in the owner's install has no `User.con`, so the parser must treat a missing
  include as normal, not an error.
- **Axes from the owner's Air.con**: pitch `IDAxis_1 1`, roll `IDAxis_0 0`,
  yaw `IDAxis_2 0 1`, throttle `IDAxis_3 1 1` — a four-axis joystick in
  DirectInput X/Y/Z/Rz order. The trailing flags are invert/deadzone-ish; the
  exact semantics were not chased, and phase 3 should verify against the live
  game (does yaw invert? does throttle span -1..1?) rather than guess.

### 1.2 What the owner's profile actually says (deltas from the viewer's defaults)

| trigger | viewer today | owner's profile |
|---|---|---|
| `c_PIMap` (show map) | `M` | `F` (+ joystick button 12) |
| `c_PIZoomMap` | `N` | `Left Alt` |
| `c_PILie` (prone) | `Z` | `Z` (same) |
| `c_PICrouch` | left Ctrl | left Ctrl (same) |
| everything else | hardcoded | matches the shipped defaults, plus joystick bindings on Use(11), chute(10), map(12), scoreboard(15), camera modes(13, 3, 14) |

The point of the system is that this table stops being a decision the viewer
makes and becomes data the player brings.

---

## 2. What is hardcoded in the viewer today

The viewer's keyboard handling is spread over a handful of literal `e.code`
checks. Each is the site a binding map replaces:

| trigger | literal today | site |
|---|---|---|
| `c_PIMap` | `KeyM` | `page-input.js:117` |
| `c_PIZoomMap` | `KeyN` | `page-input.js:138` |
| `c_PIShowScoreBoard` | `Tab` (push-and-hold) | `page-input.js:130` and `keyup` at `:227` |
| `c_PIUse` (enter/exit seat) | `KeyE` | `page-input.js:198` |
| `c_PIToggleCameraMode` | `KeyC` | `page-input.js:217` |
| `c_PILie` | `KeyZ` | `page-input.js:219` |
| `c_PIReload` | `KeyR` | `page-input.js:172` |
| `c_PIMenuSelect1..9` | `Digit1..9` | `page-input.js:95-170` (deploy screen, seat switching, kit slots) |
| `c_PIRadio1..8` | `F1..F8` | `comms.js` (`FKEYS`) |
| `c_PICameraMode1..4` | F9-F12 | camera mode cycle |
| `c_GIToggleConsole` | Backquote / CapsLock | `console.js` `GameConsole.isToggleKey` |
| movement axes (foot) | `KeyW/A/S/D`, Shift, Ctrl, Space | `map.html` `FOOT_KEYS`, sampled in `local-player.js:585` |
| movement axes (air) | WASD + arrows | `map.html` `AIR_KEYS` / `vehicle-hits.js:239` |
| free-fly camera | WASDQE + Shift | `map.html` `FLY_KEYS`, `free-camera.js` (`KeyE`/`KeyQ` vertical — viewer's own, not a game trigger) |
| `c_PIFire` / `c_PIAltFire` | mouse buttons 0/1, Space | `page-input.js` `buttonChange`, seat triggers |

The simulation side is already channel-shaped — `aircraft.js:605` reads
`this.input('c_PIThrottle')`, bundles consume `c_PIPitch`/`c_PIYaw`/`c_PIRoll`,
`world.setInput` accepts the 30 Hz input frame. What is missing is the layer the
real engine has between raw devices and those channels: a control map. The
refactor is "insert the engine's own missing layer", not "rework the sim".

---

## 3. Design

### 3.1 `controls.js` — one binding table, queried everywhere

A new viewer module that owns the profile's control map:

- **State**: per control-map context (`common`, `infantry`, `air`, `land`), a
  list of bindings `{ trigger, device, id, flags, args }`, plus the option
  variables (`setInfMouseSensitivity` etc.). Context selection follows the
  player's mode: on foot → Infantry, pilot → Air, seated in ground/sea → Land.
  Common is always merged underneath, exactly as the game overlays the common
  map on the context map.
- **Defaults**: the shipped `Settings/Default/Controls/*.con` from the game
  data, converted once by an extraction script (`tools/bf1942-models/
  extract_profile_controls.py`) into `controls-defaults.json` and published
  with the rest of the static assets. The checked-in defaults are then *the
  game's own data*, and the hard-coded literals above get deleted, which is
  the owner's stated requirement — no binding the viewer ships is invented.
- **Query API**: the rest of the page stops naming keys and names triggers:
  - `controls.holds('c_PIUse')` / `controls.pressed('c_PIZoomMap')` for
    trigger sites;
  - `controls.axis('c_PIThrottle')` → `[-1, 1]` for the movement/flight
    sampling in `local-player.js` and the seat/aircraft branches;
  - a reverse map (`'KeyM'` → nothing, `'KeyF'` → `c_PIMap`) for the
    `keydown` router in `page-input.js`, so `e.code` literals disappear;
  - `controls.kblockKeys()` derives the Keyboard-Lock key list from the
    bindings instead of the `KBLOCK_KEYS` array literal.
- **Persistence + import**: the parsed profile serialises to localStorage
  (`viewer.controls.profile`). Import UI: a Controls section (sidebar or ESC
  menu) with a file input accepting the four `.con` files (drag-drop works),
  a live table of what imported, and a Reset-to-defaults button. Everything
  is client-side — the viewer is static, and the profile is 273 lines of
  text; no backend involvement.

### 3.2 Input router

`page-input.js` keeps its job of gate-keeping (console first refusal, Escape
menu, deploy screen, `uiFocused`) but its per-trigger branches change from
`if (e.code === 'KeyM')` to `const t = controls.triggerOf(e.code); switch (t)`.
Mouse buttons map through `IDFMouse IDButton_*` bindings from the profile
instead of the implicit left/right. Push-and-hold semantics come from the
`c_CMPushAndHold` flag rather than hard-coded per-site logic (Tab's scoreboard
already behaves this way; the flag makes it data).

### 3.3 Joystick — the Gamepad API

The browser natively speaks the hardware the profile binds: `IDFGameController_0`
is `navigator.getGamepads()[0]`.

- A per-frame poll in the frame loop (after keyboard sampling, before
  `world.setInput`) reads buttons into the same held/pressed state machine the
  keyboard feeds, and axes into `controls.axis()` with the profile's invert
  flag applied and a deadzone (~0.15, tune against the live game).
- For flight this lands directly on the channels the flight model already
  consumes: pitch/roll/yaw/throttle axes, fire/altfire on buttons 0/2,
  chute/enter-exit/map/scoreboard on buttons 10-15. No sim changes.
- **Axis-order caveat**: DirectInput axis slots 0-3 on a 2002 joystick are
  X/Y/Z/Rz; a modern pad under the standard mapping puts the right stick on
  axes 2-3. The owner's stick is presumably a real joystick (axes 0-3 in
  DirectInput order), which matches — but the honest answer to "will my
  joystick land right" is a live calibration pass. Add a small calibration
  view to the import UI (move each axis, viewer records which `gamepad.axes`
  index maps to which `IDAxis` slot, stored in localStorage). Defer unless
  phase 3 testing shows a mismatch.
- Browsers only expose a gamepad after a button press or `gamepadconnected`;
  the poller must tolerate the pad being absent every frame (that is the
  normal state until the player touches it).

### 3.4 Minimap and the browser-hostile keys

- `c_PIMap` = F: free. The viewer's on-foot M behaviour (map opens in its
  deploy state) keeps its logic, loses its literal.
- `c_PIZoomMap` = Left Alt: workable but needs care. preventDefault on both
  keydown and keyup (Firefox activates the menu bar on a bare Alt keyup);
  Alt-drags and Alt+Tab are the OS's and must be left alone. Test on
  Firefox/Chromium both. If Alt proves too hostile in practice, the profile
  import UI should say so plainly rather than silently dropping it.
- Sensitivity/look: map `game.set*MouseSensitivity` onto the viewer's
  `LOOK_SENS`-family constants; `setAirMouseInvert` flips the pitch sign.
  Do the mapping at import time and verify the feel against the real game.

---

## 4. Tasklist

1. **Parser + defaults** — done. `tools/bf1942-models/extract_profile_controls.py`
   embeds the shipped `Settings/Default/Controls/{Common,Infantry,Air,Land}.con`
   verbatim into `viewer/controls-defaults.js`; `viewer/controls.js` parses
   them with the same parser an import goes through. One grammar in the tree.
2. **`viewer/controls.js`** — done. The binding table: default load, `.con`
   import (classified by content, not filename), context overlay
   (game + common + infantry/air/land — the same `profileFor` rule
   mouse-input.js applies to sensitivity), trigger/axis/held query API,
   localStorage persistence.
3. **Rewire the keyboard** — done. page-input.js routes `keydown`/`keyup`
   through `controls.codeTriggers`; the literal branches became named trigger
   bodies shared with the joystick dispatcher. FOOT/AIR_KEYS and the
   preventDefault list are derived from the map; KBLOCK_KEYS is a live getter.
   Radio numbers go through `controls.radioNumberOf` (comms.js); the console
   toggle through `GameConsole.toggleCodes` (console.js). One shipped-map
   line is deliberately dropped: the engine's `c_GIToggleConsole
   IDKey_Capital` — in the retail game Caps Lock is the spawn screen, and it
   is the viewer's spawn toggle, so Grave (and whatever a profile adds)
   opens the console and Caps Lock always reaches the spawn screen.
4. **Joystick** — done. `controls.pollGamepad()` runs once a frame in
   `frame()`: axes into `controls.axis` (deadzone 0.15, invert flag applied),
   button edges dispatched onto the same trigger bodies the keyboard runs
   (`pageInput.padTriggerDown/Up`), button levels into `controls.held`. The
   owner's Air map lands directly: roll axis 0, pitch axis 1 (inverted),
   yaw axis 2, throttle axis 3; fire/altfire on buttons 0/2; Use/chute/map/
   scoreboard/camera-mode on buttons 10-15.
5. **Import UI** — done. A Controls block in the sidebar: import the four
   `.con` files (content-classified), a bindings table in the game's own
   wording (joystick buttons 1-based, as the options screen shows them), and
   a reset button.
6. **GeneralOptions** — partial: the `game.set*` variables are parsed and
   carried (`controls.describe().vars`), and mouse-look sensitivity was
   already engine-lawful via console words (mouse-input.js), but the import
   does not yet *apply* the profile's sensitivity values to those console
   words, nor minimap transparency to bfmap. Next increment.
7. **Verification** — done. `tests/test_controls.py` drives
   `tests/controls_harness.mjs` under node (25 tests: key-name mapping, the
   four verbs, classification, defaults parity with the old literals, the
   owner's profile end to end, stick axes and button edges), and the page was
   driven live in a real browser: the sidebar block paints
   ("shipped defaults" → "imported profile"), the imported table matches the
   game's own options screen word for word (Map: F · Joystick 13, ZoomMap:
   L Alt, Use: E · Joystick 12, Scoreboard: Tab · Joystick 16, chute:
   9 · Joystick 11), M toggles the map under defaults and goes inert under
   the profile while F takes over, CapsLock opens the console under the
   shipped maps, Tab holds the scoreboard up, and the import persists across
   a reload until Defaults is pressed. The full viewer suite (2,896 tests)
   and `verify.sh --skip-e2e` stay green. Behavioural verification of the
   stick itself (fly the plane on it) is the owner's live pass, and the
   items below are what to check first.

### What to check live, in order

- **The owner's throttle axis reads inverted.** His Air.con binds the
  throttle with the invert flag (`IDAxis_3 1 1`), and the viewer honours the
  flag — so a pushed lever is negative throttle. If the live game feels the
  other way round, the flag's meaning on *axis-to-axis* lines (as opposed to
  the mouse look axes, where the engine research fixed it) needs a binary
  read, not a guess.
- **The second trailing number on some axis lines** (`IDAxis_2 0 1`) is
  parsed as nothing. Guessed semantics (deadzone) would have zeroed the yaw
  axis outright; "relative axis" is the likely truth (a throttle lever and a
  non-self-centering rudder are exactly the axes a player marks relative)
  and needs the same binary read.
- **Left Alt zoom in Firefox** — preventDefault covers keydown; Alt-only
  keyup activates the menu bar there. If it bites, the import UI should say
  so rather than silently dropping the binding.
- **Space no longer fires in ground vehicles** — the LandSea map binds fire
  to the mouse only, and the viewer now honours that. LMB still fires.

## 5. Non-goals

- The game's Customize screen (rebinding *inside* the viewer). Import plus a
  reset covers the owner's need; in-browser rebinding is a later, separate
  feature against the same `controls.js` table.
- Multiple joystick devices (`IDFGameController_1..`), force feedback.
- `c_GIScript1..4` (F1-F4 script slots) and the vote/tooltip triggers the
  viewer has no UI for — imported but unbound-to-nothing.