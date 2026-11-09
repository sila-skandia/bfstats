// The submarine's HUD: the depth and air gauges, the periscope, and the black
// fade into the boat's cockpit and the fullscreen map when she goes deep.
//
// Two halves, as in the game.
//
// The engine's half is `dice::bf::menu::Submarine::updateSubmarineData`
// (the Mac client's symbols, `0x0046207c`; ledger SUB-1..SUB-4), which
// `BfMenu::updateHud` calls every frame for a player whose control object
// answers its submarine check. It writes the `Submarine/*` variables
// `menu/InGame` reads (`registerMenuData` `0x004607cc` names them and their
// fields):
//
//   Depth         the root's `getUnderWater` less the template's
//                 `setSubmarineHudDepthModifier`, never below 0
//   MaxDepth      `submarineData`'s 6th (the crush depth) less the same
//                 modifier; the water column when the 6th is -1, and 9999
//                 when the 6th is deeper than the water there
//   WaterDepth    the sea's surface less the terrain under the boat (a float)
//   MaximumDepth  the same, truncated (an int): the gauges' full scale
//   WantedDepth   the dive setpoint, the float bundle's angle (`-node+0xa0`),
//                 held to at most 0.75 x MaximumDepth
//   Oxygen        the crew's air x 100, truncated
//   DirectionAngle the camera's bearing off the bow, radians, less
//                 `setSubmarineHudDirModifier`
//   ShowPeriscope  `getUnderWater` no deeper than `submarineData`'s 5th
//   ShowDepthHud   on once she is deeper than the 5th; off again only once she
//                 has come back up more than 0.5 m past the depth she went
//                 under at, which also closes the fullscreen map
//
// `Submarine/PeriscopeDepth` is not among them: nothing writes it, so it keeps
// the 10.0 `menu/InGame` ships (SUB-3).
//
// The menu's half is `menu/InGame` itself (SUB-2): while `ShowDepthHud` holds
// it waits 0.3 s, fades a black quad in over 0.5 s, calls
// `Submarine/ShowDepthHudDone` (`Setup::setFullscreenMap(1)`) and raises
// `ShowSubmarineCockpit` (the 800x600 `cockpit_512x512` picture), holds the
// black 1 s, and fades it out over 0.5 s. When `ShowDepthHud` drops, a
// `CullVariableActionNode` puts every one of those back.

/** `menu/InGame`'s literal for the unregistered `Submarine/PeriscopeDepth`. */
export const MENU_PERISCOPE_DEPTH = 10;
/** `updateSubmarineData`'s ceiling on the shown setpoint, of the water depth. */
export const WANTED_DEPTH_SHARE = 0.75;
/** How far back above the dive-in depth she must come before the deep HUD and
 *  the map go away. */
export const DEPTH_HUD_HYSTERESIS = 0.5;
/** The MaxDepth shown when the crush depth is deeper than the water. */
export const OUT_OF_REACH = 9999;

/** `menu/InGame`'s timings: the TimeoutActionNode before the fade, the two
 *  BfAddSubNextEffectNodes' `End time`, and the hold between them. */
export const FADE_DELAY = 0.3;
export const FADE_TIME = 0.5;
export const BLACK_HOLD = 1.0;
/** Frame steps that sum to a whole fade in floating point land a hair short. */
const FADE_EPSILON = 1e-9;

/**
 * The submarine block of a hull's template, or null when it has none: the
 * seven `submarineData` floats with a crush depth above 0 (`0x08318da0`, the
 * same rule `vehicle-damage.js` arms its clock on) and the two HUD modifiers.
 */
export function submarineSpec(physics) {
  const data = physics?.submarineData;
  if (!Array.isArray(data) || data.length < 7 || !(Number(data[5]) > 0)) return null;
  const [drain, refill, suffocation, periscopeMin, periscopeMax, crushDepth, crushRate] = data.map(Number);
  return {
    drain, refill, suffocation, periscopeMin, periscopeMax, crushDepth, crushRate,
    depthModifier: Number(physics.submarineHudDepthModifier) || 0,
    dirModifier: Number(physics.submarineHudDirModifier) || 0,
  };
}

/**
 * Whether the page feeds the submarine HUD for a hull. Retail asks the
 * player's control object (`IPlayerControlObject` vtable `+0x60`, read as
 * `getSubPos`, which the exporter does not carry); the page takes a
 * `VTSubmarine` with a submarine block, which is the two vanilla boats and
 * none of the Desert Combat land vehicles that author `submarineData` for
 * its crush.
 */
export function isSubmarine(physics) {
  return physics?.vehicleType === 'VTSubmarine' && !!submarineSpec(physics);
}

/**
 * `updateSubmarineData`'s numbers, for one frame.
 *
 * `depth` is the hull's `getUnderWater` (metres, the lowest col0 vertex under
 * the sea), `waterColumn` the sea's surface less the terrain at the boat,
 * `setpoint` the dive angle in metres, `oxygen` the crew's air 0..1 and
 * `bearing` the camera's angle off the bow in radians, positive to starboard.
 */
export function submarineReadout(spec, { depth = 0, waterColumn = 0, setpoint = 0, oxygen = 1, bearing = 0 } = {}) {
  const water = Number.isFinite(waterColumn) ? waterColumn : 0;
  const maximum = Math.trunc(water);
  let maxDepth = spec.crushDepth === -1 ? maximum : spec.crushDepth;
  if (maximum < maxDepth) maxDepth = OUT_OF_REACH;
  const wanted = Math.min(setpoint || 0, maximum * WANTED_DEPTH_SHARE);
  return {
    'Submarine/Depth': Math.max(0, depth - spec.depthModifier),
    'Submarine/MaxDepth': maxDepth - spec.depthModifier,
    'Submarine/WaterDepth': water,
    'Submarine/MaximumDepth': maximum,
    'Submarine/WantedDepth': wanted,
    'Submarine/Oxygen': Math.trunc(Math.max(0, Math.min(1, oxygen)) * 100),
    'Submarine/DirectionAngle': bearing - spec.dirModifier,
    'Submarine/PeriscopeDepth': MENU_PERISCOPE_DEPTH,
  };
}

/**
 * `ShowPeriscope` and `ShowDepthHud`, with the deep HUD's latch (`+0x2c`, the
 * depth it went under at in `+0x30`). `update` returns `{ periscope, deep,
 * closeMap }`; `closeMap` is true on the frame the latch lets go, where the
 * engine calls `setFullscreenMap(0)`.
 */
export class DepthLatch {
  constructor() {
    this.deep = false;
    this.wentUnderAt = 0;
  }

  update(spec, depth) {
    const limit = spec.periscopeMax;
    let closeMap = false;
    if (depth <= limit) {
      if (this.deep && this.wentUnderAt - depth > DEPTH_HUD_HYSTERESIS) {
        this.deep = false;
        closeMap = true;
      }
    } else {
      if (!this.deep) this.wentUnderAt = depth;
      this.deep = true;
    }
    return { periscope: !(limit < depth), deep: this.deep, closeMap };
  }

  /** `Submarine::hide`: out of the boat, every switch off. */
  reset() {
    this.deep = false;
    this.wentUnderAt = 0;
  }
}

/**
 * `menu/InGame`'s `Submarine/DepthHud/*` variables, stepped once a frame on
 * the deep HUD's switch. `step` returns `{ alpha, cockpit, openMap }`:
 * the black quad's alpha, whether the cockpit picture is up, and true on the
 * one frame the fade-in completes (`ShowDepthHudDone`).
 */
export class DepthHudFade {
  constructor() {
    this.reset();
  }

  reset() {
    this.alpha = 0;
    this.fading = false;      // FadeDepthHud
    this.fadingOut = false;   // FadeOutDepthHud
    this.done = false;        // Done
    this.cockpit = false;     // ShowSubmarineCockpit
    this.wait = 0;            // the TimeoutActionNode before the fade
    this.hold = 0;            // the TimeoutActionNode at full black
  }

  step(dt, deep) {
    let openMap = false;
    if (!deep) {
      this.reset();
      return { alpha: 0, cockpit: false, openMap };
    }
    const t = Math.max(0, dt || 0);
    if (!this.fading && !this.cockpit && !this.done) {
      this.wait += t;
      if (this.wait >= FADE_DELAY) this.fading = true;
    } else if (this.fading && !this.cockpit) {
      this.alpha = Math.min(1, this.alpha + t / FADE_TIME);
      if (this.alpha >= 1 - FADE_EPSILON) {
        this.alpha = 1;
        this.cockpit = true;
        openMap = true;
      }
    } else if (this.cockpit && !this.fadingOut && !this.done) {
      this.hold += t;
      if (this.hold >= BLACK_HOLD) this.fadingOut = true;
    } else if (this.fadingOut && !this.done) {
      this.alpha = Math.max(0, this.alpha - t / FADE_TIME);
      if (this.alpha <= FADE_EPSILON) {
        this.alpha = 0;
        this.done = true;
      }
    }
    return { alpha: this.alpha, cockpit: this.cockpit, openMap };
  }
}

/** Every variable this feed writes, so leaving the boat can clear them. */
export const SUBMARINE_VARS = [
  'Submarine/ShowSubmarine', 'Submarine/ShowPeriscope', 'Submarine/ShowDepthHud',
  'Submarine/Depth', 'Submarine/MaxDepth', 'Submarine/WaterDepth',
  'Submarine/MaximumDepth', 'Submarine/WantedDepth', 'Submarine/Oxygen',
  'Submarine/DirectionAngle', 'Submarine/PeriscopeDepth',
  'Submarine/DepthHud/DepthHudAlpha', 'Submarine/DepthHud/ShowSubmarineCockpit',
];

/**
 * The page's feed: `update(dt)` writes the `Submarine/*` variables into the
 * HUD each frame for a player driving a submarine, opens and closes the
 * fullscreen map where the engine does, and clears everything once they are
 * out of the boat.
 *
 * `page` supplies, through `read()`: `{ physics, depth, waterColumn,
 * setpoint, oxygen, bearing, firstPerson }` for the boat the player drives,
 * or null when they drive none; `vars` (the HUD's variables) and
 * `setFullscreenMap(on)`.
 */
export function createSubmarineHud({ read, vars, setFullscreenMap }) {
  const latch = new DepthLatch();
  const fade = new DepthHudFade();
  let active = false;
  let openedMap = false;
  let last = null;

  function clear() {
    const v = vars();
    for (const name of SUBMARINE_VARS) v[name] = undefined;
    v['Submarine/ShowSubmarine'] = false;
    v['Submarine/ShowPeriscope'] = false;
    v['Submarine/ShowDepthHud'] = false;
    latch.reset();
    fade.reset();
  }

  function update(dt) {
    const boat = read();
    const spec = boat && submarineSpec(boat.physics);
    if (!spec || !isSubmarine(boat.physics)) {
      if (active) {
        // `Submarine::hide` leaves the map as it was; the page closes the one
        // it opened, so leaving a boat on the sea bed does not strand the
        // player behind it.
        if (openedMap) setFullscreenMap(false);
        openedMap = false;
        active = false;
      }
      clear();
      last = null;
      return null;
    }
    active = true;
    const v = vars();
    const readout = submarineReadout(spec, boat);
    Object.assign(v, readout);
    const { periscope, deep, closeMap } = latch.update(spec, boat.depth);
    v['Submarine/ShowSubmarine'] = true;
    // The gauges' second gate is the spawn screen's tab (`Kit/ShowKit`, 0
    // while it is shut), which only the deploy screen's own variables carry
    // here; nobody drives a boat with the kit screen up.
    v['Kit/ShowKit'] = 0;
    // The periscope is a first-person picture: the crosshair group it rides
    // in has no reader for its third-person switch (XHIT-10), so the page
    // shows it from the boat's own camera only.
    v['Submarine/ShowPeriscope'] = periscope && !!boat.firstPerson;
    v['Submarine/ShowDepthHud'] = deep;
    const shown = fade.step(dt, deep);
    v['Submarine/DepthHud/DepthHudAlpha'] = shown.alpha;
    v['Submarine/DepthHud/ShowSubmarineCockpit'] = shown.cockpit;
    if (shown.openMap) {
      setFullscreenMap(true);
      openedMap = true;
    }
    if (closeMap) {
      setFullscreenMap(false);
      openedMap = false;
    }
    last = { readout, periscope, deep, ...shown, depth: boat.depth, oxygen: boat.oxygen };
    return last;
  }

  return { update, clear, read, get last() { return last; } };
}
