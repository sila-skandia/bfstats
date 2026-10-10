// The sonar and radar scope: the sweep a `sonarPos` seat's minimap turns, and
// the dots it leaves where it passes something. Vanilla's destroyers have it;
// Desert Combat hangs the same SonarObject on its jets and a radar-mode one on
// its anti-air hulls. Pure: the page hands in positions and gets back what to
// draw. Ledger SONAR-1..SONAR-7; `features/vehicle-radar`.
//
// All positions here are the ENGINE's: x east, y up, z north. The viewer's
// world is the same with z negated, and `map-surfaces.js` converts.

/**
 * `Game.setSonarRotationSpeed 0.025` (vanilla `Game.rfa`
 * `Bf1942/Game/Init/Menu.con`). The console method (BF1942.exe 0x006acd80)
 * writes it to `BfMap +0x110` and `speed / pi` to `+0x114`: radians the sweep
 * turns per map update, and the life a dot loses per map update, so a dot
 * lasts half a turn (SONAR-5). A mod sets its own: Desert Combat's menu
 * writes 0.1, four times as fast, and the tree's `vehicle-sonar.json` carries
 * it as `rotationSpeed` (`SonarScope.setSpeed`).
 */
export const SONAR_ROTATION_SPEED = 0.025;
export const SONAR_FADE_STEP = SONAR_ROTATION_SPEED / Math.PI;

/**
 * Map updates per second. `BfMap::update` steps the sweep once per call with
 * no frame time in it, so the retail sweep runs at the frame rate; the viewer
 * pins it to 60 so a 144 Hz display does not turn it 2.4 times faster. 60 is
 * the viewer's choice, not a read value: one turn in 4.19 s.
 */
export const SONAR_UPDATES_PER_SECOND = 60;

/** The modulate colour of the sweep and of every dot: 0.75 on each channel
 *  (0x3f400000 at 0x0046d578..0x0046d5b3), whoever the dot is. */
export const SONAR_TINT = [191, 191, 191];

const TWO_PI = Math.PI * 2;

/**
 * What a SonarObject senses: `SonarObject::getSensedObjects` (lnxded
 * 0x08321e20). `objects` are the candidates the engine's query returns: root
 * objects (flag 0x2000000) that carry an Armor, of either team and crewed or
 * not. The caller leaves the carrier itself out, as the client's draw pass
 * does (0x0046d6e7).
 *
 * `dy` is the carrier's height minus the object's. A sonar (`radarMode`
 * false) takes what is level with or below it, less than `radius` below; a
 * radar takes what is level with or above it, less than `radius` above. Both
 * want the horizontal distance within `radius`, inclusive.
 */
export function sensedObjects({ self, radius, radarMode = false, objects }) {
  const out = [];
  const r2 = radius * radius;
  for (const object of objects) {
    const dx = self.x - object.x;
    const dy = self.y - object.y;
    const dz = self.z - object.z;
    if (radarMode ? !(dy <= 0) : !(dy >= 0)) continue;
    if (!(dx * dx + dz * dz <= r2)) continue;
    if (radarMode ? !(dy * dy <= r2) : !(dy <= radius)) continue;
    out.push(object);
  }
  return out;
}

/**
 * The bearing the sweep must reach to light an object, as the client works it
 * out (`BfMap::update`, 0x0046d78b..0x0046d8a0): clockwise on a north-up map
 * from due west, 0 to 2 pi. West is 0, north pi/2, east pi, south 3 pi/2.
 *
 * Null when the object shares the carrier's x or its z exactly: the client
 * skips it (0x0046d8a2..0x0046d8c0), so something dead ahead on a cardinal
 * line is never lit. Ported, not tidied.
 */
export function sonarBearing(selfX, selfZ, x, z) {
  if (x === selfX || z === selfZ) return null;
  const dx = Math.abs(selfX - x);
  const dz = Math.abs(selfZ - z);
  const west = x < selfX;
  const north = z > selfZ;
  if (west && north) return Math.atan(dz / dx);
  if (!west && north) return Math.atan(dx / dz) + Math.PI / 2;
  if (!west && !north) return Math.atan(dz / dx) + Math.PI;
  return Math.atan(dx / dz) + Math.PI * 1.5;
}

/**
 * One scope: the sweep's angle and the dots still fading. `update(dt, ...)`
 * runs whole map updates out of an accumulator; `sweep` and `blips` are what
 * the map paints.
 */
export class SonarScope {
  constructor({ speed = SONAR_ROTATION_SPEED, rate = SONAR_UPDATES_PER_SECOND } = {}) {
    this.speed = speed;
    this.fade = speed / Math.PI;
    this.rate = rate;
    /** How far the sweep has turned, 0 to 2 pi. The client holds it negative
     *  (`+0x118 -= speed`) and compares its magnitude; this is the magnitude. */
    this.sweep = 0;
    /** id -> life, 1 when lit, gone at 0. */
    this.blips = new Map();
    this.owed = 0;
  }

  /** The mod's own `Game.setSonarRotationSpeed`; the fade follows it. */
  setSpeed(speed) {
    if (!(speed > 0) || speed === this.speed) return;
    this.speed = speed;
    this.fade = speed / Math.PI;
  }

  reset() {
    this.sweep = 0;
    this.blips.clear();
    this.owed = 0;
  }

  /**
   * One map update (0x0046d47e..0x0046dac0), in the client's order: turn the
   * sweep, light what it is passing, then age every dot, the fresh ones
   * included.
   *
   * `sensed` is `sensedObjects`' answer: `{ id, x, z }` each. An object is
   * lit while the sweep is strictly within one step of its bearing and it
   * has no dot already.
   */
  step(self, sensed) {
    // "|a| < 2 pi: keep turning, else back to 0", then drawn and tested.
    this.sweep = this.sweep < TWO_PI ? this.sweep + this.speed : 0;
    for (const object of sensed) {
      if (this.blips.has(object.id)) continue;
      const bearing = sonarBearing(self.x, self.z, object.x, object.z);
      if (bearing == null) continue;
      if (bearing + this.speed <= this.sweep || this.sweep <= bearing - this.speed) continue;
      this.blips.set(object.id, 1);
    }
    for (const [id, life] of this.blips) {
      const left = life - this.fade;
      if (left > 0) this.blips.set(id, left);
      else this.blips.delete(id);
    }
  }

  /**
   * Advance by `dt` seconds. `sense()` is asked once per map update that
   * runs and answers `{ self, sensed }`, or null when the carrier is gone.
   * Capped at a quarter second of updates, so a tab coming back from the
   * background does not spin through a minute of sweeps. Returns how many
   * updates ran.
   */
  update(dt, sense) {
    this.owed = Math.min(this.owed + dt * this.rate, this.rate / 4);
    let ran = 0;
    while (this.owed >= 1) {
      this.owed -= 1;
      const now = sense();
      if (now) this.step(now.self, now.sensed);
      ran += 1;
    }
    return ran;
  }
}

/**
 * The scope a seat sees, out of the tree's `_shared/vehicle-sonar.json`
 * (`extract_vehicle_sonar.py`): the entry of `hull` when `seat` is one of its
 * `sonarPos` seats, else null. Names match case-insensitively.
 */
export function seatSonar(table, hull, seat) {
  if (!table || !hull || !seat) return null;
  const hullName = hull.toLowerCase();
  const seatName = seat.toLowerCase();
  for (const entry of table.vehicles ?? []) {
    if (entry.template.toLowerCase() !== hullName) continue;
    if (entry.seats.some(name => name.toLowerCase() === seatName)) return entry;
  }
  return null;
}
