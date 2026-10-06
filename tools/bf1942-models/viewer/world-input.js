// The world's input word and its tick law: a player's input shaped into the
// engine's PlayerInput, buffered engine-FIFO, and consumed exactly one per
// 30 Hz tick (LOOP-1; `world.js`'s header has the whole law). Split out of
// `world.js`.

import { AXIS_RANGE } from './mouse-input.js';

/*
 * No spring shapes a channel any more. The page's own (full deflection in
 * ~0.4 s, back to centre a little faster) went from the aircraft on
 * 2026-10-06 and from a ship's `c_PIPitch` (ramps, dive planes) on
 * 2026-10-07, because the same key law reaches both:
 *
 * A key pair resolves through
 * `ControlMap::buttonsToAxis` (lnxded 0x083f2080, client twin 0x0061b850):
 * held, the value climbs by `dt / riseTime`, released it falls by
 * `dt / fallTime`, both seeded 0.001 s by the `ControlMap` ctor (0x083f0540,
 * `0x3a83126f` at `+0x28`/`+0x2c`; the client keeps them at `+0x40`/`+0x44`).
 * `ControlMap.setButtonRiseTime`/`setButtonFallTime` exist as console words
 * (client registrars 0x0058a840 / 0x0058a9d0) and no shipped `.con` calls
 * them, so one 33 ms pump carries a key from 0 to 1 and back: the channel is a
 * step. The part's own servo is the only shaping, as it always was for the
 * ground vehicles. `game.setAirKeyboardSensitivity 0.5` does not touch it
 * either: it is stored at `ControlSettings+0x18` (setter 0x00803640, reached
 * from the console body 0x006bc4e0 via 0x006c57c0), bound to the options
 * slider (0x006ec49d) and written back by the profile save (0x006ecbe2), and
 * nothing reads it for play -- the settings object has a getter for every
 * other field of the four profiles and none for this one.
 */

/** A player's idle input: no queue entry yet, or a silent tick. */
const IDLE_INPUT = Object.freeze({
  forward: 0, strafe: 0, forwardKeys: 0, rudder: 0,
  walk: false, crouch: false, prone: false,
  jump: false, fire: false, altFire: false, roll: 0, pitch: 0, pad: false,
  deploy: false, dead: false,
});

/**
 * The engine's "no packet this tick" word: every channel zeroed. `simulate-
 * PlayerUpdate` 0x0815bd00 consumes one buffered input per tick and delivers
 * a fresh empty PlayerInput for a tick with no packet -- it never replays the
 * last one. `lookX/lookY` are zeroed with it (`c_PIMouseLookX/Y` are channels
 * like any other), so a tick the page had nothing to say about turns nobody.
 */
const ENGINE_IDLE = Object.freeze({
  input: IDLE_INPUT,
  lookX: 0,
  lookY: 0,
  idle: true,
});

/** A full player input is the engine's own word, named by its actions. */
function shapeInput(input) {
  const i = input || IDLE_INPUT;
  const clamp11 = v => Math.max(-1, Math.min(1, v));
  const clampWire = v => Math.max(-AXIS_RANGE, Math.min(AXIS_RANGE, Number.isFinite(v) ? v : 0));
  return {
    forward: clamp11(i.forward ?? 0),
    strafe: clamp11(i.strafe ?? 0),
    // The control map's own c_PIThrottle and c_PIYaw (keys, a joystick's
    // lever and rudder, a profile's mouse): the aircraft's throttle latch and
    // rudder take the control map alone — the pad's Y is the stick's pitch
    // and its X is roll, so folding the pad in would be double-paying it. The
    // rudder is clipped at the wire's +-16 like the stick, for a profile that
    // binds the mouse to it; both cross the wire analogue (netcode.js). Ground
    // vehicles and the on-foot body use `forward`/`strafe`, pad included,
    // exactly as the page always split them.
    forwardKeys: clamp11(i.forwardKeys ?? 0),
    rudder: clampWire(i.rudder ?? 0),
    walk: !!i.walk,
    crouch: !!i.crouch,
    prone: !!i.prone,
    jump: !!i.jump,
    // `c_PIMenuSelect9` on a falling soldier: the ripcord. The engine gives
    // item slot 9 a second job through TemplateMessage 18
    // (`BFSoldier::handleMessage` lnxded 0x0827728b) and `parachute.js`
    // carries the rest; `dead` is what stops a corpse pulling it.
    deploy: !!i.deploy,
    dead: !!i.dead,
    // The vehicle triggers: the same c_PIFire/c_PIAltFire the engine's
    // PlayerInput carries. The page folds Space and its seatFire/seatAltFire
    // latches into these before setInput.
    fire: !!i.fire,
    altFire: !!i.altFire,
    // The aircraft stick axes (c_PIRoll/c_PIPitch): the control map's value,
    // keys or a joystick in -1..1, the mouse's rate beyond it (mouse-input.js,
    // up to the wire's own +-16, `PlayerAction::set` 0x081128a0), and a touch
    // pad's deflection on mobile. `pad` is the page's mobile override, which
    // the mouse-look router leaves alone (`routeFlightInput`). The consumer
    // clips: a rack at its `maxRotation`, a fixed-wing surface at +-1
    // (`world-vehicle-tick.js`).
    roll: clampWire(i.roll ?? 0),
    pitch: clampWire(i.pitch ?? 0),
    pad: !!i.pad,
  };
}

/**
 * Buffer one tick's input, engine-FIFO semantics (see `world.js`'s header).
 *
 * The local device stage (the page) calls without a `seq`: the freshest
 * un-consumed input REPLACES the previous one, so a display-rate feed
 * stays at 0-1 entries and every tick consumes this frame's newest state
 * -- the page never binds the cap. `look` is the pumped axis pair from
 * mouse-input.js (`MouseInput.pump`'s output, the engine's quantised,
 * +-16-clamped c_PIMouseLookX/Y); the page has already applied the weapon
 * zoom factor, exactly where `stepSoldierLook` used to.
 *
 * A sequenced packet (a P2 remote player's wire word) APPENDS instead,
 * dedupes on `seq > lastSeen` (`processRcvdPlayerActions` 0x08148470) and
 * trims to FOUR dropping the oldest (`clearPlayerActions` 0x0815bb90).
 * Whatever arrives, exactly one entry is consumed per tick, and a tick
 * with nothing buffered delivers the engine's zeroed idle word.
 */
export function bufferInput(player, input, look = null, seq = null) {
  const entry = {
    input: shapeInput(input),
    lookX: Number.isFinite(look?.x) ? look.x : 0,
    lookY: Number.isFinite(look?.y) ? look.y : 0,
  };
  if (Number.isInteger(seq)) {
    if (seq <= player.lastSeen) return;
    player.lastSeen = seq;
    player.buffer.push({ ...entry, seq });
    if (player.buffer.length > 4) player.buffer.shift();
  } else {
    player.pending = entry;
  }
}

/** Exactly one input per tick (LOOP-1 / `simulatePlayerUpdate` 0x0815bd00):
 *  the buffer's oldest sequenced entry, or the local stage's pending entry
 *  when that is the only thing waiting, or the engine's zeroed idle word
 *  when both are empty -- a sequenced packet is never replayed.
 *
 *  The local stage's entry is the exception, and only within its own
 *  frame: it is the device state the page sampled for ALL of this step's
 *  ticks, so the catch-up ticks of a frame longer than 33 ms run against
 *  it too. Handing them the idle word instead ended every slow frame with
 *  the trigger released -- `group.firing` false at draw time, a vehicle
 *  MG's fire loop gated shut every frame, one round in n fired -- and
 *  dropped the throttle, the steer and the look axis on the same ticks;
 *  on foot it turned a held jump into a press per frame. `step()` clears
 *  the hold before its first tick, so nothing outlives the frame it was
 *  fed for.
 */
export function consume(player) {
  let entry = player.buffer.length ? player.buffer.shift() : null;
  if (!entry) {
    if (player.pending) {
      player.held = player.pending;
      player.pending = null;
    }
    entry = player.held;
  }
  player.last = entry ?? ENGINE_IDLE;
  return player.last;
}
