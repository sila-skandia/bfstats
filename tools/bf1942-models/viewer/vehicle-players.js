// Who shares the vehicle: the HUD's crew list (ledger VHUD-16..VHUD-18).
//
// Retail draws it in the vehicle panel, over the vehicle icon: the backdrop
// `ToolTip/vehicle_position_256x128.tga` at (196,496) and up to six rows of
// `(seat) name` in `Style/InGameVehiclePlayerStyle` (`standard6`, colour
// 0.8438 0.8711 0.7773), 15 px apart from (201,502). `hud-layout.json`'s
// `vehicleSeats` group already carries every leaf; this module decides what
// the engine's variables hold.
//
// The engine (BF1942.exe, the vehicle HUD object at `[0x00a5f1a8]+0xc`,
// registered by `0x006d6500`):
//
//   - `0x006d7560` rebuilds the list. It empties all seven
//     `Vehicle/VehiclePlayers/VehiclePlayersText1..7`, then walks the root
//     PCO's seat map (`getPcos()`, the map the number keys index, SEAT-7) and
//     for each seat that holds a player writes `"(%d) %s"` -- the seat's
//     1-based place in that map and the player's name -- into the row of
//     that place. An empty seat leaves its row blank; nothing is packed up.
//     Your own seat is listed like any other. When more than one seat is
//     held it sets `Vehicle/ShowVehiclePlayers` (+0xad); it never clears it.
//   - It runs when the local player takes a seat (`0x006d7780`, from the
//     enter handler `0x004b7f9e`), when anyone else enters or leaves a seat
//     of the hull he sits in (`0x004b7f9e`, `0x004b88e0` -> `0x006d7950`),
//     and on each of `c_PIMenuSelect1..6` while he is seated (`0x00448520`
//     -> `0x006d7a00`), whether or not the seat he asked for is free.
//   - Getting out clears the flag (`0x006d6de0`, which also drops
//     `ShowVehicleIcon`).
//   - `menu/InGame` takes it down: the list sits under
//     `CullNode(ShowVehiclePlayers) -> CullNode(ShowVehicleIcon)` with a
//     `BfVariableTimeoutActionNode2` behind it, which adds the menu step to
//     its own `VehiclePlayersTimeOut` each painted frame while shown and, at
//     3.0, sets `ShowVehiclePlayers` false and the counter back to 0
//     (`0x007dd2c0`). No fade: the culls' in and out times are 0. The menu
//     step is `1/30` a painted frame whatever the frame rate (HFD-6), so the
//     list is up for 90 painted frames -- 1.5 s at 60 fps, under a second at
//     110 -- and a second trigger while it is up does not extend it.
//
// FREE-STANDING: this file imports nothing, so a harness can load it alone
// (`tests/test_vehicle_players.py`).

/** `Setup+0x184`: the menu's step per painted frame, `1 / g_simulationFps`. */
export const MENU_STEP = Math.fround(1 / 30);
/** The list's `BfVariableTimeoutActionNode2` limit in `menu/InGame`. */
export const VEHICLE_PLAYERS_TIMEOUT = Math.fround(3.0);
/** `VehiclePlayersText1..7`: the engine's rows. `menu/InGame` draws six. */
export const VEHICLE_PLAYERS_SLOTS = 7;

export const SHOW_VAR = 'Vehicle/ShowVehiclePlayers';
export const TEXT_VARS = Array.from({ length: VEHICLE_PLAYERS_SLOTS },
  (_, i) => `Vehicle/VehiclePlayers/VehiclePlayersText${i + 1}`);
/** Every variable the list writes, for the feeds that clear on leaving. */
export const VEHICLE_PLAYERS_VARS = [SHOW_VAR, ...TEXT_VARS];

/**
 * `0x006d7560`'s rows for a crew: `crew[i]` is the player in the hull's
 * seat `i` (0-based, the seat map's order) as `{ name }`, or null for an
 * empty seat. Returns the seven texts and how many seats are held.
 */
export function vehiclePlayersRows(crew, display = name => name) {
  const texts = new Array(VEHICLE_PLAYERS_SLOTS).fill('');
  let held = 0;
  for (let i = 0; i < crew.length; i++) {
    const member = crew[i];
    if (!member) continue;
    held += 1;
    if (i < VEHICLE_PLAYERS_SLOTS) texts[i] = `(${i + 1}) ${display(String(member.name ?? ''))}`;
  }
  return { texts, held };
}

/** A crew's identity: who sits where, for noticing an enter or a leave. */
function crewKey(crew) {
  let key = '';
  for (let i = 0; i < crew.length; i++) {
    const m = crew[i];
    key += m ? `${i}:${m.id ?? m.name ?? ''}|` : '';
  }
  return key;
}

/**
 * The list's state on one page: the engine's flag, its seven texts and the
 * layout's timeout counter, fed from whoever can say who sits where.
 *
 *   observe(hull, crew)  every frame while seated: `hull` names the vehicle,
 *                        `crew` as `vehiclePlayersRows` takes it, with an
 *                        `id` per member. A new hull is the local player
 *                        taking a seat; a new crew is someone entering,
 *                        leaving or changing seats. Either rebuilds.
 *   press(position)      a number key, 0-based, while seated.
 *   leave()              out of the vehicle.
 *   frame(vars)          once per painted frame: `write` then `step`.
 *   write(vars)          into the HUD's variable table.
 *   step()               the layout's timeout, one menu step.
 */
export class VehiclePlayersList {
  constructor({ display } = {}) {
    this.display = display ?? (name => name);
    this.shown = false;
    this.clock = 0;
    this.texts = new Array(VEHICLE_PLAYERS_SLOTS).fill('');
    this.hull = null;
    this.key = null;
    this.crew = [];
  }

  /** `0x006d7560`. */
  rebuild(crew = this.crew) {
    const { texts, held } = vehiclePlayersRows(crew, this.display);
    this.texts = texts;
    if (held > 1) this.shown = true;
  }

  observe(hull, crew) {
    const key = crewKey(crew);
    this.crew = crew;
    if (hull !== this.hull || key !== this.key) {
      this.hull = hull;
      this.key = key;
      this.rebuild(crew);
    }
  }

  /** `0x006d7a00`: `c_PIMenuSelect1..6`, seated. */
  press(position) {
    if (this.hull == null || !(position >= 0 && position < 6)) return;
    this.rebuild();
  }

  /** `0x006d6de0`: out of the seat. The counter keeps what it had. */
  leave() {
    this.shown = false;
    this.hull = null;
    this.key = null;
    this.crew = [];
  }

  /** The layout's timeout, counted only while the list is drawn. */
  step() {
    if (!this.shown || this.hull == null) return;
    this.clock = Math.fround(this.clock + MENU_STEP);
    if (this.clock >= VEHICLE_PLAYERS_TIMEOUT) {
      this.shown = false;
      this.clock = 0;
    }
  }

  write(vars) {
    if (!vars) return;
    vars[SHOW_VAR] = this.shown;
    for (let i = 0; i < VEHICLE_PLAYERS_SLOTS; i++) vars[TEXT_VARS[i]] = this.texts[i];
  }

  /** One painted frame: what this frame draws, then the menu's update. The
   *  timeout fires in the update of a frame that still draws the list (as
   *  the hit wash's does, HFD-5), so the frame it fires on shows it and the
   *  next does not. */
  frame(vars) {
    this.write(vars);
    this.step();
  }
}

// --- the name as the HUD's bitmap font can draw it --------------------------
//
// Names arrive as the server holds them; a client that sent cp1251 bytes
// reads as cp1252 (CLAUDE.md, "Server and player name rendering"). This is
// `ui/src/utils/playerName.ts`'s `decodePlayerName`, restated here because the
// viewer ships without the UI. The HUD's bitmap faces carry Latin glyphs
// only (`standard6`: 32..511), as retail's do, so a decoded name the face
// cannot draw keeps its raw form, which is also what retail shows.

const CP1252_HIGH = {
  '€': 0x80, '‚': 0x82, 'ƒ': 0x83, '„': 0x84, '…': 0x85,
  '†': 0x86, '‡': 0x87, 'ˆ': 0x88, '‰': 0x89, 'Š': 0x8a,
  '‹': 0x8b, 'Œ': 0x8c, 'Ž': 0x8e, '‘': 0x91, '’': 0x92,
  '“': 0x93, '”': 0x94, '•': 0x95, '–': 0x96, '—': 0x97,
  '˜': 0x98, '™': 0x99, 'š': 0x9a, '›': 0x9b, 'œ': 0x9c,
  'ž': 0x9e, 'Ÿ': 0x9f,
};

let cp1251 = null;
try { cp1251 = typeof TextDecoder !== 'undefined' ? new TextDecoder('windows-1251') : null; } catch (_) { cp1251 = null; }

/** `decodePlayerName`: a cp1251 name read as cp1252, decoded back. */
export function decodePlayerName(raw) {
  if (!raw || !cp1251) return raw ?? '';
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    const code = c.charCodeAt(0);
    bytes[i] = CP1252_HIGH[c] ?? (code <= 0xff ? code : 0x3f);
  }
  let latin = 0;
  let nonLatin = 0;
  for (const b of bytes) {
    if ((b >= 65 && b <= 90) || (b >= 97 && b <= 122)) latin++;
    else if (b >= 192 && b <= 255) nonLatin++;
  }
  const total = latin + nonLatin;
  if (total === 0) return raw;
  return nonLatin / total >= 0.8 ? cp1251.decode(bytes) : raw;
}

/** The name to draw in a face with glyph table `glyphs` (code -> glyph). */
export function hudPlayerName(raw, glyphs = null) {
  const decoded = decodePlayerName(raw);
  if (decoded === raw || !glyphs) return decoded;
  for (const ch of decoded) if (!glyphs[ch.charCodeAt(0)]) return raw;
  return decoded;
}
