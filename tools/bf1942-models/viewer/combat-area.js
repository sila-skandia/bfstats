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
 *   The four floats are ORIGIN then SIZE, not two corners, and the ENGINE
 *   ITSELF says so: the moment `gameStatusPlaying` reads them back through
 *   `getActiveCombatArea` (0x08061870) it ADDS the third to the first and
 *   the fourth to the second to get the far corner —
 *
 *       0x0815237a  fld  [x0] ; 0x08152383 fadd [sizeX] ; 0x08152389 fstp -> maxX
 *       0x0815238f  fld  [z0] ; 0x08152395 fadd [sizeZ] ; 0x0815239b fstp -> maxZ
 *
 *   — and then compares the player against x0/z0 and those two sums. A corner
 *   pair would never be summed. The level numbers agree: Berlin's
 *   `1536 1536 512 512` on a 2048 m world is x 1536..2048 and the impossible
 *   x 1536..512 read as corners; Liberation_of_Caen's `360 460 1229 1229` and
 *   Stalingrad's `320 52 416 416` read the same way.
 *
 *   When a level declares NO area, the same block falls through to
 *   0x08152575, which zeroes the two origins and calls the terrain's own
 *   `getSizeX`/`getSizeZ` (PatchTerrain vtable +0x0c/+0x10) for the far
 *   corner — the "combat area" is then the whole terrain.
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
 *     The per-frame check, inlined. 0x081523b2-0x0815240c compares the
 *     position against the area; 0x0815241f adds dt to a per-player
 *     accumulator at player+0x178; 0x0815242e-0x08152437 compares that total
 *     against the byte at Game+0x6c; the in-bounds branch zeroes the
 *     accumulator (0x08152553, `mov DWORD PTR [esi+0x178], 0`). Past the
 *     allowance, 0x0815247b-0x08152480 computes `dt * [GameServer+0x2e8]` and
 *     passes it to `GameServer::giveDamage` (vtable +0x15c, 0x0814b2e0). So
 *     the damage is a RATE, integrated every frame, not a lump at the buzzer:
 *     5 HP per second against a soldier's 30 HP is six more seconds to die,
 *     sixteen in all.
 *
 *     The four comparisons are `fucomp`/`fucom` + `test ah,0x45`, and the
 *     polarity reads out cleanly once the fxch shuffles are tracked (the
 *     branch is taken on ah&0x45 == 0, i.e. only when ST0 > STi):
 *
 *       0x081523c1  minX > pos.x   -> outside   (je 0x0815256e)
 *       0x081523d7  minZ > pos.z   -> outside   (je 0x08152565)
 *       0x081523ec  pos.x > maxX   -> outside   (je 0x0815255e)
 *       0x08152403  pos.z > maxZ   -> outside   (jne 0x08152525 = inside)
 *
 *     so inside is `minX <= x <= maxX && minZ <= z <= maxZ`: INCLUSIVE on all
 *     four edges. Only the position's x (offset +0) and z (offset +8) are
 *     ever loaded — ALTITUDE IS NOT BOUNDED, a plane at 400 m over the middle
 *     of the area is inside it.
 *
 *     The threshold is a STRICT `>`: `jne 0x0815251a` at 0x08152437 takes the
 *     no-damage path whenever the total is less than OR EQUAL to the
 *     allowance. And after a damage frame the accumulator is written back to
 *     the allowance itself, not left to grow (0x081524a8 `mov al,[ecx+0x6c]`
 *     / 0x081524ac `fild` / 0x081524b2 `fstp [esi+0x178]`), so it sits at 10
 *     and every later frame re-crosses by its own dt.
 *
 *     There is a SECOND way to be outside, and it is not geometric — CA-5,
 *     and it is modelled now. The in-bounds branch at 0x08152525 asks the
 *     terrain for the material under the player —
 *     `dice::ref2::geom::terrainBase` (0x087435f0), vtable +0x4c =
 *     `PatchTerrain::getMaterial(float, float)` (0x083d6800) — and compares it
 *     with `GameServer+0x474`:
 *
 *       0x08152535  call [edx+0x4c]        ; getMaterial(this, pos.x, pos.z)
 *       0x0815253b  xor  edx,edx
 *       0x08152540  mov  dl,[ecx+0x474]    ; materialToGiveDamage
 *       0x08152546  cmp  eax,edx
 *       0x08152548  je   0x08152414        ; MATCH -> the accumulate path
 *       0x0815254e  eax = 0
 *       0x08152553  [esi+0x178] = 0        ; mismatch -> zero the accumulator
 *
 *     `materialToGiveDamage` is `setMaterialToGiveDamage(unsigned char)`
 *     0x0813dff0 / `getMaterialToGiveDamage` 0x0813e020, and its DEFAULT IS 7,
 *     written by both GameServer constructors (0x0812f287, 0x0812f7c7). Those
 *     three instructions are the only writers of the byte in the whole binary,
 *     and although `materialToGiveDamage` IS a registered console word
 *     (.rodata 0x66a389 — the earlier reading listed only three words and
 *     missed it), **no `.con` in any of the 18 installed mods sets it**. So 7
 *     stands.
 *
 *     WHAT 7 IS. `materialManagerdefine.con` heads it "Reserved (Outside
 *     map)", and that is exactly what the extracted material maps show it to
 *     be: on every one of the 11 vanilla levels that paint it, 7 is the
 *     SURROUND of a single playable pocket, with no patches inside the pocket
 *     at all. Rendered coarsely, aberdeen, battle_of_britain, berlin,
 *     stalingrad, omaha_beach, liberation_of_caen and market_garden are all
 *     the same picture: a clean ring of 7 around clean non-7 ground.
 *
 *     What makes it worth modelling is that it is NOT the rectangle. The
 *     pocket is usually far smaller than the declared box — Berlin's playable
 *     ground is about 200 x 270 m of a 512 m square (84% of the box is 7, and
 *     99% of the whole 2048 m terrain), Market Garden declares the whole map,
 *     and aberdeen, kharkov and kursk paint 7 while declaring no rectangle at
 *     all. So the painted half is the tighter and more accurate boundary, and
 *     a viewer that models the box alone lets a player walk hundreds of metres
 *     past the edge of the level.
 *
 *     That the pocket is the playable area is what the level's own data says:
 *     across all 23 extracted vanilla levels, **0 of 749 soldier spawns, 0 of
 *     115 control points and 0 of 724 object spawns stand on material 7** (the
 *     only two "on 7" object spawns are battle_of_britain rows whose position
 *     is literally 0,0,0). Straight lines between neighbouring control points
 *     are 0% material 7 on 19 of the 23; the four exceptions are single pairs
 *     whose straight line leaves the pocket and comes back (berlin 30 m,
 *     stalingrad 59 m, caen 9 m, aberdeen 174 m), which is not a route a
 *     player walks in the real game either. At 5 HP/s after a 10 s grace, only
 *     aberdeen's is long enough to cost a man on foot anything.
 *
 *     The material is read at the SAME position the rectangle is tested at
 *     (section 4 below), so a plane over painted ground burns exactly as one
 *     outside the box does.
 *
 *     WHO TAKES THE DAMAGE. The position tested is `BFPlayer::getVehicle()`'s
 *     (vtable +0x3c = 0x080560c0, returning BFPlayer+0x4c), read at
 *     0x081523a1, so a seated player is tested at the VEHICLE's position. And
 *     the damage goes to the same object: at 0x0815243f the code branches on
 *     `BFPlayer+0x6c` (the entry-point index, -1 when on foot — the
 *     constructor sets it at 0x08050b1e and `GameServer::exitVehicle` puts it
 *     back at 0x0814e5c2). In a vehicle (+0x6c != -1) `giveDamage` is handed
 *     `getVehicle()` — THE VEHICLE BURNS, not the man in it. On foot it is
 *     handed BFPlayer+0x68, the default vehicle `setDefaultVehicle` stores
 *     (0x08055879), i.e. the soldier.
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
 * THE CLIENT'S COUNTDOWN (CA-8, RADIO-11). `BfMap::update` (0x0046dc62) reads
 * the LOCAL player's accumulator, `fld [player+0x1c0]; call 0x00804af0`
 * (`_ftol`, truncation), and writes `Outside/OutsideTime` in one branch:
 *
 *   whole = trunc(secondsOutside)
 *   whole > 0  -> OutsideTime = allowance - whole     (0x0046dcb3..0x0046dd0d)
 *   else       -> OutsideTime = 0, voice latch re-armed (0x0046dd21..2b)
 *
 * and the accumulator it reads is the same one the CLIENT'S OWN copy of
 * `gameStatusPlaying` keeps — `fadd [edi+0x1c0]` 0x004b191e, zeroed on the
 * in-bounds branch 0x004b1907, and on a damage frame set back to the allowance
 * (`movzx eax,[esi+0x74]; fild; fstp [edi+0x1c0]` 0x004b1a06..0x004b1a16), the
 * client's twin of the server's CA-3 clamp. So in retail the plate:
 *
 *   - is NOT up in the first second outside (whole is 0),
 *   - shows 9 at the first whole second, counting down to 1 at 9..10 s,
 *   - and goes DOWN the moment damage starts (the accumulator then sits at the
 *     allowance, 10 - 10 = 0, and the layout's gate is `0 < OutsideTime`).
 *
 * That last point is the binary's, and it is not what the owner remembers
 * ("the warning is there the whole time you are out"); it is kept as read.
 *
 * ONE ACCUMULATOR PER PLAYER (player+0x178), and the HUD reads the
 * ACCUMULATOR, not the last tick's record: the world steps at 30 Hz and the
 * page paints faster, so a painted frame that ticked nothing carries no record
 * and used to read as "inside" for that frame, blinking the plate at the beat
 * of sim against render. `readout(key)` is what the HUD reads.
 *
 * NO DECLARED AREA is the whole terrain (0x08152575, above): `extras.worldSize`
 * is the terrain's `getSizeX`/`getSizeZ`, so a level with no rectangle bounds
 * you at the heightmap's own edge, x 0..size and z -size..0 in the viewer's
 * z-negated frame. This is a test on the NUMBERS, not on whether any ground is
 * drawn out there: terrain or water that repeats beyond the edge changes
 * nothing about it.
 *
 * This module is deliberately free of `three` and of the DOM: it is the rect
 * test and the two timers, so `tests/combat_area_harness.mjs` runs the real
 * thing under node with no WebGL.
 */

/** The engine's own defaults, both from `GameServer::init`. */
export const DEFAULT_TIME_ALLOWED = 10;      // seconds, Game+0x6c, 0x08131dbb
export const DEFAULT_DAMAGE_PER_SECOND = 5;  // GameServer+0x2e8, 0x08131db1

/**
 * `GameServer::materialToGiveDamage` — the terrain material that counts as
 * outside however far inside the rectangle you are (CA-5).
 *
 * The byte at `GameServer+0x474`. Both constructors write 7
 * (`mov BYTE PTR [edi+0x474],0x7` at 0x0812f287 and 0x0812f7c7) and the only
 * other writer in the binary is `setMaterialToGiveDamage` (0x0813dff9), which
 * no shipped `.con` calls in any of the 18 installed mods — so 7 is the value
 * every level runs with. `materialManagerdefine.con` calls it
 * "Reserved (Outside map)".
 */
export const DEFAULT_MATERIAL_TO_GIVE_DAMAGE = 7;

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

/** The terrain's own extent, the area a level with NO declared rectangle has
 *  (0x08152575: origins zeroed, far corner from the terrain's `getSizeX` /
 *  `getSizeZ`). `extras.worldSize` is that size; the viewer's z runs negative
 *  (`Heightfield` reads `-z / spacing`), so the terrain is x 0..size and
 *  z -size..0. Null when the level states no size, which leaves the level as
 *  inert as before. */
export function terrainRect(extras) {
  const size = Number(extras && extras.worldSize);
  if (!(size > 0) || !Number.isFinite(size)) return null;
  return { minX: 0, maxX: size, minZ: -size, maxZ: 0 };
}

/** Is this world position inside the area? x/z only — the engine loads the
 *  position's +0 and +8 and never its +4, so altitude is unbounded. Inclusive
 *  on all four edges, which is what the x87 polarity at 0x081523c1 /
 *  0x081523d7 / 0x081523ec / 0x08152403 reads as (module note above).
 *
 *  **The rectangle alone.** The material half is a separate test that only
 *  ever runs when this one says inside, so it is a separate function. */
export function isInside(rect, x, z) {
  if (!rect) return true;
  return x >= rect.minX && x <= rect.maxX && z >= rect.minZ && z <= rect.maxZ;
}

/** Does the terrain material under the player count as outside (CA-5)?
 *
 *  A plain `==` against the byte, which is what `cmp eax,edx` at 0x08152546
 *  is: `getMaterial` returns a nibble (`PatchTerrain::getMaterial` masks to
 *  0..15 at 0x083d68e1 / 0x083d68e9) and `materialToGiveDamage` is an
 *  `unsigned char`, so there is no range to get wrong.
 *
 *  A `material` that is null or not an integer is a level with no material
 *  channel — the test cannot run and the answer is "not outside", which is
 *  exactly the behaviour every level had before this was wired. */
export function isDamagingMaterial(material, materialToGiveDamage) {
  if (!Number.isInteger(material)) return false;
  if (!Number.isInteger(materialToGiveDamage)) return false;
  return material === materialToGiveDamage;
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
   * @param {number}      [options.materialToGiveDamage] the CA-5 terrain id;
   *        pass `null` to run the rectangle alone
   */
  constructor(extras, options = {}) {
    this.rect = combatAreaRect(extras);
    // What bounds a level that declares nothing (`terrainRect`).
    this.terrain = terrainRect(extras);
    this.timeAllowed = Number.isFinite(options.timeAllowed)
      ? options.timeAllowed : DEFAULT_TIME_ALLOWED;
    this.damagePerSecond = Number.isFinite(options.damagePerSecond)
      ? options.damagePerSecond : DEFAULT_DAMAGE_PER_SECOND;
    this.materialToGiveDamage =
      options.materialToGiveDamage === null ? null
        : (Number.isInteger(options.materialToGiveDamage)
            ? options.materialToGiveDamage
            : DEFAULT_MATERIAL_TO_GIVE_DAMAGE);
    // One slot per player: the engine's player+0x178 accumulator and the last
    // record `step` made for him.
    this.slots = new Map();
    this.reset();
  }

  /** What bounds the players: the declared rectangle, else the terrain. */
  get bounds() { return this.rect ?? this.terrain; }

  /**
   * True when anything here can fire on this level.
   *
   * A level with no declared rectangle is bounded by its terrain (`terrain`),
   * so it is active whenever it states a world size; and it can paint material
   * 7 besides (aberdeen 33% of its samples, kharkov 37%, kursk 35%). With
   * neither a size nor a material channel nothing here can fire.
   */
  get active() { return this.bounds !== null || this.materialToGiveDamage !== null; }

  /** True when this level declared a rectangle of its own. */
  get hasRect() { return this.rect !== null; }

  /** Everyone back inside, accumulators zeroed. */
  reset() {
    this.slots.clear();
  }

  /** One player's slot, made on first use. */
  #slot(key) {
    let slot = this.slots.get(key);
    if (!slot) {
      slot = { outsideFor: 0, inside: true, frame: null };
      this.slots.set(key, slot);
    }
    return slot;
  }

  /** A player the area is no longer stepping (dead, unseated into nothing, a
   *  free camera): his accumulator and his record go, so the HUD reads inside. */
  release(key = 0) {
    this.slots.delete(key);
  }

  /** The engine's player+0x178 for one player: seconds outside, clamped to the
   *  allowance once damage has started, 0 inside. */
  outsideForOf(key = 0) {
    return this.slots.get(key)?.outsideFor ?? 0;
  }

  /** The default player's accumulator (the one a single-player check steps). */
  get outsideFor() { return this.outsideForOf(0); }

  /** True while the default player is inside. */
  get inside() { return this.slots.get(0)?.inside ?? true; }

  /**
   * The record the HUD reads for one player: the LAST one `step` made for him,
   * which stays true on every painted frame the world did not tick. A player
   * the area has not stepped (or has `release`d) reads as inside.
   */
  readout(key = 0) {
    return this.slots.get(key)?.frame ?? IN_AREA;
  }

  /**
   * One frame for one player (`key`; the single-player callers leave it at 0).
   * Returns a plain record — no side effects beyond the player's own slot.
   *
   * `material` is the terrain material id under the same position — the
   * viewer's `Heightfield.material(x, z)`. Omit it, or pass a non-integer, and
   * only the rectangle is tested, which is what every level did before CA-5
   * was wired and what a level with no `terrain/materials.png` still does.
   *
   *   inside        was the position inside this frame, by BOTH tests
   *   inRect        was it inside the area (the declared rectangle, else the
   *                 terrain; false only for the geometric half, so a readout
   *                 can say which of the two caught you)
   *   material      the id that was tested, or null
   *   onDamagingMaterial  did the material half fire
   *   outsideFor    seconds accumulated outside (0 when inside)
   *   remaining     seconds left before the damage starts, floor 0
   *   countdown     what the HUD's `Outside/OutsideTime` shows, as the client
   *                 writes it (CA-8): `allowance - trunc(outsideFor)` from the
   *                 first whole second out, else 0. 0 culls the group, so the
   *                 plate is down in the first second and again from the
   *                 moment damage starts.
   *   damage        HP to take this frame: `dt * damagePerSecond` once the
   *                 allowance is spent, else 0
   *   entered/left  the transitions, for a one-shot sound or log
   */
  step(dt, x, z, material = null, key = 0) {
    const slot = this.#slot(key);
    const step = Number.isFinite(dt) && dt > 0 ? dt : 0;
    const inRect = isInside(this.bounds, x, z);
    // The material is only ever read on the in-bounds branch (0x08152525 is
    // reached by `jne` from the last rectangle test), so a position already
    // outside the box never asks the terrain anything.
    const id = Number.isInteger(material) ? material : null;
    const onDamagingMaterial =
      inRect && isDamagingMaterial(id, this.materialToGiveDamage);
    const inside = inRect && !onDamagingMaterial;
    const wasInside = slot.inside;
    slot.inside = inside;
    if (!this.active || inside) {
      slot.outsideFor = 0;
      slot.frame = {
        inside: true,
        inRect: true,
        material: id,
        onDamagingMaterial: false,
        outsideFor: 0,
        remaining: this.timeAllowed,
        countdown: 0,
        damage: 0,
        entered: this.active && inside && !wasInside,
        left: false,
        distance: 0,
      };
      return slot.frame;
    }
    // `fadd [esi+0x178]` at 0x0815241f: dt first, the test after, so the very
    // frame that crosses the allowance is already a damage frame. The test is
    // a strict `>` (0x08152437's `jne` takes the no-damage path on <= as well
    // as <).
    slot.outsideFor += step;
    const remaining = Math.max(0, this.timeAllowed - slot.outsideFor);
    const damage = slot.outsideFor > this.timeAllowed
      ? step * this.damagePerSecond : 0;
    // On a damage frame the engine writes the allowance itself back into the
    // accumulator rather than letting it grow (0x081524a8 / 0x081524ac /
    // 0x081524b2; the client's twin 0x004b1a06), so a player who has been out
    // for a minute reads 10, not 60. It changes no damage — the next frame's
    // own dt re-crosses — and it is what the client's countdown reads: 10 - 10
    // is 0, which is why the plate is down while he bleeds.
    if (damage > 0) slot.outsideFor = this.timeAllowed;
    const whole = Math.trunc(slot.outsideFor);
    slot.frame = {
      inside: false,
      inRect,
      material: id,
      onDamagingMaterial,
      outsideFor: slot.outsideFor,
      remaining,
      // 0x0046dc62..0x0046dd0d: `_ftol` of the accumulator, then the allowance
      // minus it, only when it is positive.
      countdown: whole > 0 ? Math.max(0, this.timeAllowed - whole) : 0,
      damage,
      entered: false,
      left: wasInside,
      // Metres to the nearest edge of the area. Zero when the material half is
      // what caught you: there is no edge to be a distance from, and saying 0
      // is honest where saying "you are 400 m in" would not be.
      distance: onDamagingMaterial ? 0 : distanceOutside(this.bounds, x, z),
    };
    return slot.frame;
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

/** The record of a player the area is not stepping: inside, nothing shown. */
const IN_AREA = Object.freeze({
  inside: true, inRect: true, material: null, onDamagingMaterial: false,
  outsideFor: 0, remaining: DEFAULT_TIME_ALLOWED, countdown: 0, damage: 0,
  entered: false, left: false, distance: 0,
});

/** The TextNode's own Wstring default in `menu/InGame` entry #42 — the exact
 *  string, misspelling included. Not the lexicon's `DESSERTION_MESSAGE`,
 *  which is a different wording this node never reads. */
export const OUTSIDE_TEXT =
  'Warning! You are leaving the combat area! Desserters will be shot!';

/** `Outside/Color/{Red,Green,Blue}` as `menu/InGame` ships them. */
export const OUTSIDE_COLOR = [0.8515629768371582, 0.3515625, 0.3515625];
