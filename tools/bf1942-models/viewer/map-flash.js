// The minimap's flash list: a player who spoke on the radio blinks yellow.
//
// Retail, read on the Mac client's named code (the Windows client carries the
// same console words) and on the shipped data:
//   - `menu::Radio::outputRadioMessage` (Mac 0x0043b884; `outputLocalMessage` 0x0043c3d4)
//     and `outputLocalMessage` call `MenuMapNode::addPlayerToFlashList(
//     speakerId, BfMenu+0x5d4)` (Mac 0x00555184) for every speaker that is
//     not the local player.
//   - `BfMenu+0x5d4` is `Game.setRadioFlashTime` (Mac 0x008c4e98). The
//     constructor does not write it; `Bf1942/Game/Init/Menu.con` in the
//     shipped `Game.rfa` does: `Game.setRadioFlashTime 7`.
//   - `MenuMapNode::update` (Mac 0x0055475c) runs ONE blink clock for the
//     whole list (`+0x100`): the marks are lit while the clock is at or under
//     `+0xf4`, and when it passes `+0xf8` every entry loses 1
//     (`decreaseFlashTimeFlash`, Mac 0x005551cc; an entry at or under 0 is
//     erased) and the clock restarts. `Game.setPlayerBlink 1.0 2.0` in the
//     same Menu.con writes `+0xf4` and `+0xf8` (Mac 0x004210a4).
//   - `MenuMapNode::onPaint` draws a listed player's mark (on foot, their
//     vehicle, or the self mark) in yellow (1, 1, 0, 1) while lit.
// So the "flash time" is a count of blinks, not seconds: 7 blinks, each 1 s
// lit in a 2 s cycle, about 14 s. The clock is shared and free-running, so a
// call that lands mid-cycle gets a short first blink, as in retail.

/** `Game.setRadioFlashTime 7` (Game.rfa, `Bf1942/Game/Init/Menu.con`). */
export const RADIO_FLASH_COUNT = 7;
/** `Game.setPlayerBlink 1.0 2.0`: lit while the clock <= 1.0, cycle 2.0 s. */
export const PLAYER_BLINK_ON = 1.0;
export const PLAYER_BLINK_PERIOD = 2.0;
/** The lit mark's colour, `MenuMapNode::onPaint`'s (1, 1, 0, 1). */
export const FLASH_TINT = [255, 255, 0];

export function createMapFlash() {
  const list = new Map();   // player key -> blinks left
  let clock = 0;
  let lit = true;
  let count = RADIO_FLASH_COUNT;
  let blinkOn = PLAYER_BLINK_ON;
  let blinkPeriod = PLAYER_BLINK_PERIOD;
  let last = null;
  return {
    /** `addPlayerToFlashList(key, count)`. Retail appends a second entry for
     *  a player already listed and reads the first; one entry holding the
     *  larger count draws the same. A count of 0 or less never blinks. */
    add(key, blinks = count) {
      if (key == null || !(blinks > 0)) return;
      list.set(key, Math.max(list.get(key) ?? 0, blinks));
    },
    /** `MenuMapNode::update(dt)`. */
    update(dt) {
      if (!(dt > 0)) return;
      clock += dt;
      if (clock <= blinkOn) { lit = true; return; }
      lit = false;
      if (clock > blinkPeriod) {
        for (const [key, left] of list) {
          if (left - 1 > 0) list.set(key, left - 1); else list.delete(key);
        }
        clock = 0;
      }
    },
    /** `update` off a wall clock in seconds, for readers with no frame step
     *  of their own (the map surfaces' repaint key). A gap over a quarter
     *  second (a hidden tab, a paused game) advances a quarter second. */
    updateAt(now) {
      if (last != null && list.size) this.update(Math.min(0.25, now - last));
      last = now;
    },
    /** Whether `key`'s mark is drawn yellow now (`shouldFlash` and `+0x128`). */
    lit(key) { return lit && key != null && list.has(key); },
    listed(key) { return list.has(key); },
    blinksLeft(key) { return list.get(key) ?? 0; },
    get size() { return list.size; },
    /** `Game.setRadioFlashTime N`, `Game.setPlayerBlink on period`. */
    setCount(n) { if (Number.isFinite(n)) count = n; return count; },
    get count() { return count; },
    setBlink(on, period) {
      if (Number.isFinite(on)) blinkOn = on;
      if (Number.isFinite(period)) blinkPeriod = period;
    },
    clear() { list.clear(); },
    /** A token that changes when what is drawn changes. */
    key() { return list.size ? `f${lit ? 1 : 0}:${[...list.keys()].join(',')}` : ''; },
  };
}

/** The page's one list: `comms.js` adds a speaker, `map-friendlies.js` reads. */
export const mapFlash = createMapFlash();
