/* The combat area: what the game does when you walk out of it.
 *
 * `game.setActiveCombatArea x z sizeX sizeZ` appears in 11 of the 23 vanilla
 * levels (17 archives, but six of those are `_003` patches re-declaring the
 * same level's area with the same numbers). `bf42/level.py` has parsed it into
 * `scene.json.combatArea` all along and the 3D view never read it.
 *
 * WHAT THE GAME DOES. Read out of the unstripped Linux dedicated server
 * (`bf1942_lnxded (1).static`, 1.61) and out of `menu/InGame`, before drawing
 * anything. It is a warning with a countdown, then continuous damage — not a
 * wall, not an instant kill, and not a teleport.
 *
 *   dice::bf::Game::setActiveCombatArea(float, float, float, float)
 *     0x08061840. Stores the four floats at Game+0x70/+0x74/+0x78/+0x7c and
 *     sets Game+0x6d (`useActiveCombatArea`) true, so declaring the area is
 *     what turns it on — there is no separate enable in any vanilla con.
 *
 *   The four floats are ORIGIN then SIZE, not two corners. Berlin settles it
 *   on its own: `game.setActiveCombatArea 1536 1536 512 512` on a 2048 m
 *   world is x 1536..2048, z 1536..2048 as origin+size and the impossible
 *   x 1536..512 as a corner pair. Liberation_of_Caen's `360 460 1229 1229`
 *   and Stalingrad's `320 52 416 416` read the same way.
 *
 *   dice::bf::Game::setTimeAllowedOutSideWorld(unsigned char)
 *     0x08061800 -> Game+0x6c. DEFAULT 10 seconds, written by
 *     GameServer::init at 0x08131dbb (`mov BYTE PTR [ebx+0x6c], 0xa`). No con
 *     verb sets it: the string table registers `setActiveCombatArea`,
 *     `setUseActiveCombatArea` and `damageForBeingOutSideWorld`, and no
 *     `timeAllowed*` at all.
 *
 *   dice::bf::GameServer::setDamageForBeingOutSideWorld(float)
 *     0x0813dbc0 -> GameServer+0x2e8. DEFAULT 5.0, written by GameServer::init
 *     at 0x08131db1 (`mov DWORD PTR [ebx+0x2e8], 0x40a00000` = 5.0f). Surveyed
 *     every .con in all 72 vanilla archives: vanilla never overrides it. Only
 *     one installed mod does — bfheroes, 120 to 350 per level.
 *
 *   dice::bf::GameServer::gameStatusPlaying(float dt)
 *     The per-frame check, inlined. 0x081523ce-0x0815240c compares the player
 *     position against the area; 0x0815241f adds dt to a per-player
 *     accumulator at player+0x178; 0x0815241c-0x08152434 compares that total
 *     against the byte at Game+0x6c; the in-bounds branch zeroes the
 *     accumulator (0x08152553, `mov DWORD PTR [esi+0x178], 0`). Past the
 *     allowance, 0x0815247b-0x08152480 computes `dt * [GameServer+0x2e8]` and
 *     passes it to a virtual call on the player object. So the damage is a
 *     RATE, integrated every frame, not a lump at the buzzer: 5 HP per second
 *     against a soldier's 30 HP is six more seconds to die, sixteen in all.
 *
 *   menu/InGame top-level entry #42 is what the player sees:
 *     gate      `0 < Outside/OutsideTime` (a LessData cull)
 *     plate     `Ingame/text-mess/textmessBG_3line_256x64.tga` at (305,171)
 *     text      (310,174) 230x40, Trebuchet MS8, colour `Outside/Color/*`
 *               (defaults 0.8516 / 0.3516 / 0.3516 — a dull red)
 *               "Warning! You are leaving the combat area! Desserters will be
 *               shot!" — the node's own Wstring default, under the variable
 *               name `Outside/OutsideText`
 *     number    (536,189) 20x20, right-aligned, Trebuchet MS11 - Latin,
 *               bound to `Outside/OutsideTime`
 *   `extract_hud_layout.py` decodes that as the `outside` group, so `hud.js`
 *   draws it from the data with no code of its own. The lexicon also carries
 *   `DESSERTION_MESSAGE` = "Warning! You are leaving combat area. Deserters
 *   will be shot." — a near-identical string this node does not use.
 *
 * NOT READ, and marked as such rather than guessed:
 *   - whether the area test is inclusive at the edge (the x87 comparisons at
 *     0x081523d7/0x081523ec/0x08152403 are `fucomp`/`fucom` pairs whose branch
 *     polarity was not fully disentangled). Treated as inclusive here.
 *   - whether the height (y) is bounded at all. `setActiveCombatArea` stores
 *     four floats and the con verb passes four, so this is a 2D test in x/z;
 *     nothing was found that bounds altitude.
 *   - the team check at 0x08152540 (`[ecx+0x474]` against a vtable +0x4c
 *     result). Something team-dependent gates the reset branch. Not modelled.
 *   - whether a vehicle takes the damage or its occupant does.
 *
 * This module is deliberately free of `three` and of the DOM: it is the rect
 * test and the two timers, so `tests/combat_area_harness.mjs` runs the real
 * thing under node with no WebGL.
 */

/** The engine's own defaults, both from `GameServer::init`. */
export const DEFAULT_TIME_ALLOWED = 10;      // seconds, Game+0x6c, 0x08131dbb
export const DEFAULT_DAMAGE_PER_SECOND = 5;  // GameServer+0x2e8, 0x08131db1

/** `scene.json.combatArea` -> a rect in the viewer's own coordinates, or null.
 *
 *  The extractor has already turned the con's `(x, z, sizeX, sizeZ)` into a
 *  `min`/`max` pair through `_to_gltf_vec`, which negates z — so `min.z` is
 *  the LARGER number of the two once it arrives here. Normalise rather than
 *  assume an ordering: a mod that declares a negative size would otherwise
 *  produce an inside-out rect that nothing is ever outside of. */
export function combatAreaRect(extras) {
  const area = extras && extras.combatArea;
  if (!area || !Array.isArray(area.min) || !Array.isArray(area.max)) return null;
  const [ax, , az] = area.min;
  const [bx, , bz] = area.max;
  if (![ax, az, bx, bz].every(Number.isFinite)) return null;
  const rect = {
    minX: Math.min(ax, bx), maxX: Math.max(ax, bx),
    minZ: Math.min(az, bz), maxZ: Math.max(az, bz),
  };
  // A zero-area declaration is a level saying nothing, not a level where
  // every position is outside.
  if (rect.maxX <= rect.minX || rect.maxZ <= rect.minZ) return null;
  return rect;
}

/** Is this world position inside the area? x/z only: the con verb passes four
 *  numbers and the engine stores four, so altitude is unbounded. Inclusive at
 *  the edge (see the module note — the branch polarity was not read). */
export function isInside(rect, x, z) {
  if (!rect) return true;
  return x >= rect.minX && x <= rect.maxX && z >= rect.minZ && z <= rect.maxZ;
}

/** Metres to the nearest edge from outside; 0 when inside. Not an engine
 *  quantity — the viewer's own readout, so a debug panel can say how far out
 *  you are without re-deriving the rect. */
export function distanceOutside(rect, x, z) {
  if (!rect) return 0;
  const dx = Math.max(rect.minX - x, 0, x - rect.maxX);
  const dz = Math.max(rect.minZ - z, 0, z - rect.maxZ);
  return Math.hypot(dx, dz);
}

/**
 * The state machine `GameServer::gameStatusPlaying` runs per player.
 *
 * One instance per level. `step(dt, x, z)` integrates and returns what the
 * frame should show and apply; the caller paints the group and takes the
 * damage. Nothing here touches a clock of its own, so a headless run steps it
 * deterministically.
 */
export class CombatArea {
  /**
   * @param {object|null} extras          the level's `scene.json`
   * @param {object}      [options]
   * @param {number}      [options.timeAllowed]     seconds before damage starts
   * @param {number}      [options.damagePerSecond] HP per second after that
   */
  constructor(extras, options = {}) {
    this.rect = combatAreaRect(extras);
    this.timeAllowed = Number.isFinite(options.timeAllowed)
      ? options.timeAllowed : DEFAULT_TIME_ALLOWED;
    this.damagePerSecond = Number.isFinite(options.damagePerSecond)
      ? options.damagePerSecond : DEFAULT_DAMAGE_PER_SECOND;
    this.reset();
  }

  /** True when this level declared an area at all. */
  get active() { return this.rect !== null; }

  reset() {
    // The engine's player+0x178: seconds spent outside, zeroed on re-entry.
    this.outsideFor = 0;
    this.inside = true;
  }

  /**
   * One frame. Returns a plain record — no side effects, no allocation
   * beyond the record itself.
   *
   *   inside        was the position inside this frame
   *   outsideFor    seconds accumulated outside (0 when inside)
   *   remaining     seconds left before the damage starts, floor 0
   *   countdown     what the HUD's `Outside/OutsideTime` integer shows:
   *                 the remaining seconds rounded UP, so a player with 0.2 s
   *                 left still sees "1" and the group stays up until the
   *                 damage actually begins. 0 means the group is culled.
   *   damage        HP to take this frame: `dt * damagePerSecond` once the
   *                 allowance is spent, else 0
   *   entered/left  the transitions, for a one-shot sound or log
   */
  step(dt, x, z) {
    const step = Number.isFinite(dt) && dt > 0 ? dt : 0;
    const inside = isInside(this.rect, x, z);
    const wasInside = this.inside;
    this.inside = inside;
    if (!this.active || inside) {
      this.outsideFor = 0;
      return {
        inside: true,
        outsideFor: 0,
        remaining: this.timeAllowed,
        countdown: 0,
        damage: 0,
        entered: this.active && inside && !wasInside,
        left: false,
        distance: 0,
      };
    }
    // `fadd [esi+0x178]` at 0x0815241f: dt first, the test after, so the very
    // frame that crosses the allowance is already a damage frame.
    this.outsideFor += step;
    const remaining = Math.max(0, this.timeAllowed - this.outsideFor);
    return {
      inside: false,
      outsideFor: this.outsideFor,
      remaining,
      countdown: Math.ceil(remaining),
      damage: this.outsideFor > this.timeAllowed ? step * this.damagePerSecond : 0,
      entered: false,
      left: wasInside,
      distance: distanceOutside(this.rect, x, z),
    };
  }

  /**
   * The `menu/InGame` variables this frame's record implies, written onto a
   * HUD variable table. Keeps the names the layout binds, so `hud.js`'s
   * generic painter draws the `outside` group with no code of its own.
   *
   * `Outside/OutsideText` is fed with the node's own Wstring default rather
   * than left unfed: `hud.js` lists a text leaf's `var` as required, so an
   * unfed one culls the line and the plate would show an empty box.
   */
  feed(vars, frame) {
    vars['Outside/OutsideTime'] = frame.countdown;
    vars['Outside/OutsideText'] = OUTSIDE_TEXT;
    vars['Outside/Color/Red'] = OUTSIDE_COLOR[0];
    vars['Outside/Color/Green'] = OUTSIDE_COLOR[1];
    vars['Outside/Color/Blue'] = OUTSIDE_COLOR[2];
    return vars;
  }
}

/** The TextNode's own Wstring default in `menu/InGame` entry #42 — the exact
 *  string, misspelling included. Not the lexicon's `DESSERTION_MESSAGE`,
 *  which is a different wording this node never reads. */
export const OUTSIDE_TEXT =
  'Warning! You are leaving the combat area! Desserters will be shot!';

/** `Outside/Color/{Red,Green,Blue}` as `menu/InGame` ships them. */
export const OUTSIDE_COLOR = [0.8515629768371582, 0.3515625, 0.3515625];
