// A teammate's shouted call for a medic or an engineer, as the local medic or
// engineer sees it: his minimap marker turns into `Minimap/map_medic` or
// `Minimap/map_engineer` and his name tag pulses toward white (HUD-20), for
// 25 seconds. Pure, so `tests/support_calls_harness.mjs` runs it under node.
//
// The client's law (ledger HUD-26):
//
//   - the shout handler `FUN_006d2790` (both players alive), on message 40
//     `RADIO_LOCAL_MEDIC` and 54 `RADIO_LOCAL_NEED_REPAIRS`, raises the
//     caller's medic or engineer call only while the local player's control
//     object is a soldier (class `0x8dcd10`) and his deploy-screen kit
//     (`[[0x00a5f1a8]+0x30]+0x88`) is 3 or 4 (0x006d2baa..0x006d2be7,
//     0x006d2c4f..0x006d2c8c). No distance test comes before it;
//   - the setters (`0x00407440`, `0x004074c0`) keep a call only from a player
//     on the local player's side and stamp the clock (`+0x190`, `+0x1a0`);
//   - `BfMap::update` drops either 25 s after it was raised (0x0046adfd..
//     0x0046ae50, 25.0 at 0x008d6478), and draws a caller's soldier marker
//     as the call's sprite, white, 16 units, unturned, only while the local
//     player is on foot with that kit (0x0046af57..0x0046b0c8); medic first.

/** Shout message id -> the call it raises (`radio.js` RADIO_MESSAGES). */
export const CALL_MESSAGES = Object.freeze({ 40: 'medic', 54: 'engineer' });
/** The deploy screen's kit index each call needs (Scout 0 .. Engineer 4). */
export const CALL_KIT = Object.freeze({ medic: 3, engineer: 4 });
/** Seconds a call stays up (`0x008d6478`). */
export const CALL_SECONDS = 25;
/** The minimap sprite each call draws (BfMap ctor 0x0046e478, 0x0046e48d). */
export const CALL_SPRITE = Object.freeze({ medic: 'map_medic', engineer: 'map_engineer' });

export function createSupportCalls() {
  return { medic: new Map(), engineer: new Map() };
}

/**
 * A shout heard. `msg` the message id; `key` the caller's page key; `team`
 * his side; `localTeam`, `localOnFoot`, `localKit` (0..4 or null) the
 * listener's; `now` seconds. Returns the call raised, or null.
 */
export function hearCall(calls, { msg, key, team, localTeam, localOnFoot, localKit, now }) {
  const call = CALL_MESSAGES[msg];
  if (!call || key == null || !localOnFoot || localKit !== CALL_KIT[call]) return null;
  if (team !== localTeam) return null;
  calls[call].set(key, now);
  return call;
}

/** Drops the calls older than `CALL_SECONDS` (`BfMap::update`'s clear). */
export function expireCalls(calls, now) {
  for (const map of [calls.medic, calls.engineer]) {
    for (const [key, at] of map) if (!(now - at < CALL_SECONDS)) map.delete(key);
  }
}

/** The call a player carries for his name tag's pulse: 'medic', then
 *  'engineer', else null. */
export function callOf(calls, key, now) {
  for (const call of ['medic', 'engineer']) {
    const at = calls[call].get(key);
    if (at != null && now - at < CALL_SECONDS) return call;
  }
  return null;
}

/** The minimap sprite a caller's marker draws, or null: his call's, only
 *  while the local player is on foot with the kit it needs. */
export function callSprite(calls, key, now, { localOnFoot, localKit }) {
  if (!localOnFoot) return null;
  for (const call of ['medic', 'engineer']) {
    const at = calls[call].get(key);
    if (at != null && now - at < CALL_SECONDS && localKit === CALL_KIT[call]) return CALL_SPRITE[call];
  }
  return null;
}

/** The deploy screen's kit order, whose index the calls test (HUD-20). */
export const KIT_ORDER = Object.freeze(['scout', 'assault', 'antitank', 'medic', 'engineer']);
/** A kit name's index in `KIT_ORDER`, null for none. */
export function kitIndexOf(kit) {
  const i = KIT_ORDER.indexOf(kit);
  return i < 0 ? null : i;
}
