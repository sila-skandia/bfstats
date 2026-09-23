/* The F1..F8 radio: what each key does, which message goes out, what the
 * chat log prints for it and which voice line plays.
 *
 * Everything here is read out of the retail client (BF1942.exe, sha256
 * 60c9452d...cd3699) and the symbolled Linux server; the research is
 * `features/radio-and-chat-log/README.md`. The menu's art and layout are the
 * game's own `menu/RadioMenu`, extracted to `radio-layout.json`
 * (`extract_radio.py`); this module is the behaviour behind it.
 *
 * This module imports nothing and touches no DOM, so
 * `tests/radio_harness.mjs` runs the bytes the page loads.
 */

/**
 * Every message the menu can send, by the engine's u16 message id
 * (`RadioMessageEvent`, event 0x3A; the enum `ai::RadioMessage` has 60 values).
 *
 * `team` messages are radio: they reach the speaker's whole team, print a
 * chat line with the speaker's grid square and play a flat 2D line from
 * `menu/MenuRadioSound.ssc` (patch `patch`) in the LISTENER's language
 * (receive handler 0x006d3400). `local` messages are shouted: every player
 * within 70 m hears the speaker's own voice in 3D from
 * `SoldierVoice.ssc` (patch `patch`), enemies included, but only the
 * speaker's team gets the chat line (0x006d2790). `key` is the lexicon string
 * the chat line prints. `sign` is the hand-signal animation the speaker plays
 * on foot (`HandSign_*`, 0x004feb20).
 */
export const RADIO_MESSAGES = {
  1: { kind: 'team', key: 'RADIO_ROGER', patch: 0 },
  2: { kind: 'team', key: 'RADIO_NEGATIVE', patch: 1 },
  8: { kind: 'team', key: 'RADIO_PICKUP', patch: 6 },
  9: { kind: 'team', key: 'RADIO_REINFORCEMENT', patch: 7 },
  10: { kind: 'team', key: 'RADIO_ANTITANK_SUPPORT', patch: 8 },
  11: { kind: 'team', key: 'RADIO_NAVAL_SUPPORT', patch: 9 },
  12: { kind: 'team', key: 'RADIO_AIR_SUPPORT', patch: 10 },
  13: { kind: 'team', key: 'RADIO_ARTILLERY_READY', patch: 11 },
  14: { kind: 'team', key: 'RADIO_APC_SUPPORT', patch: 13 },
  15: { kind: 'team', key: 'RADIO_ARMOR_SPOTTED', patch: 14 },
  16: { kind: 'team', key: 'RADIO_INFANTRY_SPOTTED', patch: 15 },
  17: { kind: 'team', key: 'RADIO_UNIT_SPOTTED', patch: 16 },
  18: { kind: 'team', key: 'RADIO_SHIP_SPOTTED', patch: 17 },
  19: { kind: 'team', key: 'RADIO_SUBMARINE_SPOTTED', patch: 18 },
  20: { kind: 'team', key: 'RADIO_AIRPLANE_SPOTTED', patch: 19 },
  21: { kind: 'team', key: 'RADIO_SCOUT_SPOTTED', patch: 20 },
  // 22..28: control point 1..7. The body is " [<cp>] Attack" or "Defend",
  // decided by the RECEIVER from the point's owner against the speaker's team.
  ...Object.fromEntries([22, 23, 24, 25, 26, 27, 28].map(id => [id, { kind: 'team', cp: id - 22 }])),
  29: { kind: 'local', key: 'RADIO_LOCAL_DEFENDING', patch: 0 },
  30: { kind: 'local', key: 'RADIO_LOCAL_ATTACKING', patch: 1 },
  31: { kind: 'local', key: 'RADIO_LOCAL_ROGER', patch: 3, sign: 'Roger' },
  32: { kind: 'local', key: 'RADIO_LOCAL_NEGATIVE', patch: 2, sign: 'Negative' },
  36: { kind: 'local', key: 'RADIO_LOCAL_WAIT', patch: 4, sign: 'Freeze' },
  37: { kind: 'local', key: 'RADIO_LOCAL_FIRE', patch: 19 },
  38: { kind: 'local', key: 'RADIO_LOCAL_HOLD_FIRE', patch: 18, sign: 'Freeze' },
  39: { kind: 'local', key: 'RADIO_LOCAL_FIRE_IN_HOLE', patch: 9, sign: 'Shout' },
  40: { kind: 'local', key: 'RADIO_LOCAL_MEDIC', patch: 20, sign: 'Medic' },
  41: { kind: 'local', key: 'RADIO_LOCAL_TAKE_COVER', patch: 10 },
  42: { kind: 'local', key: 'RADIO_LOCAL_BAIL_OUT', patch: 12 },
  43: { kind: 'local', key: 'RADIO_LOCAL_COVER_ME', patch: 14 },
  44: { kind: 'local', key: 'RADIO_LOCAL_HOLD_POSITION', patch: 15, sign: 'Down' },
  // The retail quirk: "You take the point" prints the GO FOR ENEMY FLAG
  // string and plays GoForTheFlag.wav. RADIO_LOCAL_YOU_TAKE_POINT is in the
  // lexicon but the exe never reads it.
  45: { kind: 'local', key: 'RADIO_LOCAL_GO_FOR_ENEMY_FLAG', patch: 16 },
  46: { kind: 'local', key: 'RADIO_LOCAL_FALL_BACK', patch: 17 },
  47: { kind: 'local', key: 'RADIO_LOCAL_STICK_TOGETHER', patch: 7 },
  48: { kind: 'local', key: 'RADIO_LOCAL_FOLLOW_ME', patch: 6 },
  49: { kind: 'local', key: 'RADIO_LOCAL_GO', patch: 5 },
  // 50 is "closest control point": the sender resolves it to 22 + index
  // before it leaves (0x006d4070), so it is never delivered.
  51: { kind: 'local', key: 'RADIO_LOCAL_GET_IN', patch: 8 },
  52: { kind: 'local', key: 'RADIO_LOCAL_CHECK_YOUR_SIX', patch: 11 },
  53: { kind: 'local', key: 'RADIO_LOCAL_ABANDON_SHIP', patch: 13 },
  54: { kind: 'local', key: 'RADIO_LOCAL_NEED_REPAIRS', patch: 21 },
  55: { kind: 'team', key: 'RADIO_LOCAL_GO_FOR_ENEMY_FLAG', patch: 2 },
  56: { kind: 'team', key: 'RADIO_LOCAL_PROTECT_FLAG', patch: 3 },
  57: { kind: 'team', key: 'RADIO_LOCAL_GET_FLAG_BACK', patch: 5 },
  58: { kind: 'team', key: 'RADIO_LOCAL_PROTECT_FLAGCARRIER', patch: 4 },
  59: { kind: 'team', key: 'RADIO_ARTILLERY_SUPPORT', patch: 12 },
};

export const CLOSEST_CONTROL_POINT = 50;
/** MenuRadioSound patches for a control-point message, by the receiver's call. */
export const PATCH_ATTACK = 21;
export const PATCH_DEFEND = 22;
/** How far a shouted message carries, to a listener and to a bot: the 70.0
 *  at 0x008d8438 (client) and 0x428c0000 in `GameServer::radioMessage`. */
export const LOCAL_RANGE = 70;
/** The client's send limit (0x006d41c0 / 0x006d2430; 4.0 at 0x008d8f34). */
export const SPAM_WINDOW = 4.0;
export const SPAM_BURST = 6;

/** `Radio/RadioIconType` and the vehicle remap both key on this: 0 on foot,
 *  then the controlled template's category (`vfunc+0x78`, VCLand 0 / VCSea 1 /
 *  VCAir 2) as 1 land, 3 sea, 2 air (0x006ae525..577). */
export const ICON_ON_FOOT = 0;
export const ICON_LAND = 1;
export const ICON_AIR = 2;
export const ICON_SEA = 3;

/** `Radio/RadioGameMode` from the level's mode (switch at 0x006e3c31):
 *  CTF 2, everything else 1 or 3. 1 and 3 both show the control points; 3
 *  also dims the menu's items to half alpha (`Radio/RadioAlpha`, the file's
 *  own CullVariableActionNodes). Conquest is 3 when `BfMenu+0x6dc` is 0, 1 or
 *  4 -- a field nobody has named yet -- and the retail capture on a conquest
 *  server shows the dimmed items, so conquest takes 3 here. */
export function radioGameMode(mode) {
  const m = String(mode || '').toLowerCase();
  if (m.includes('ctf') || m.includes('capturetheflag')) return 2;
  if (m.includes('tdm') || m.includes('teamdeathmatch')) return 1;
  return 3;
}

/**
 * One F-key press against the menu: `FUN_006d42a0`, the key handler.
 *
 * `state` is `{ category, back }`: `category` is `Radio/RadioCategory`
 * (0 the idle strip, 1..7 an open page, 8 the strip switched off) and `back`
 * the page the menu returns to after a page closes (true: the strip, false:
 * off). `ctx` is `{ gameMode, controlPoints }`, the latter the count of
 * selectable points. Returns `{ category, back, message }`, `message` 0 when
 * nothing is sent.
 */
export function pressRadioKey(state, key, ctx = {}) {
  const cat = state.category | 0;
  let back = !!state.back;
  if (cat === 0) {
    return key === 8 ? { category: 8, back: false, message: 0 }
      : { category: key, back: true, message: 0 };
  }
  if (cat === 8) {
    return key === 8 ? { category: 0, back: true, message: 0 }
      : { category: key, back: false, message: 0 };
  }
  let message = 0;
  if (key !== 8) {
    switch (cat) {
      case 1: message = key <= 2 ? key : 0; break;
      case 2: message = key + 7; break;
      case 3: message = key + 14; break;
      case 4: {
        const mode = ctx.gameMode ?? 1;
        if (mode === 1 || mode === 3) {
          message = key === 4 ? CLOSEST_CONTROL_POINT : key < 5 ? key + 21 : key + 20;
          const count = ctx.controlPoints ?? 0;
          if (message !== CLOSEST_CONTROL_POINT && message >= 22 + count) message = 0;
        } else if (mode === 2) {
          message = key >= 4 && key <= 7 ? key + 51 : 0;
        }
        break;
      }
      case 5: message = key + 26; if (message < 29 || message > 32) message = 0; break;
      case 6: message = key + 35; break;
      case 7: message = key + 42; break;
      default: message = 0;
    }
  }
  return { category: back ? 0 : 8, back, message };
}

/** Whether a message goes out as team radio (0x006d41c0) or is shouted
 *  (0x006d3320) -- the split in the key handler. */
export function isTeamMessage(id) {
  return id < 29 || id === CLOSEST_CONTROL_POINT || (id > 54 && id < 59);
}

/**
 * The shouted remap (0x006d3200), by the vehicle the speaker actually sits
 * in, not by the icon the menu drew: Stick together becomes Get in, Medic
 * becomes Need repairs in any vehicle; Take cover becomes Check your six in
 * an aircraft and Bail out becomes Abandon ship on a ship.
 */
export function remapLocal(id, iconType) {
  if (iconType === ICON_ON_FOOT) return id;
  if (id === 47) return 51;
  if (id === 40) return 54;
  if (id === 41 && iconType === ICON_AIR) return 52;
  if (id === 42 && iconType === ICON_SEA) return 53;
  return id;
}

/** CLOSEST (0x006d4070): the nearest selectable point in 3D, owner ignored,
 *  as `22 + index`. `points` are `{x, y, z}`; null when there are none. */
export function closestControlPoint(points, at) {
  let best = -1;
  let bestD = Infinity;
  (points || []).forEach((p, i) => {
    const d = (p.x - at.x) ** 2 + ((p.y ?? 0) - (at.y ?? 0)) ** 2 + (p.z - at.z) ** 2;
    if (d < bestD) { bestD = d; best = i; }
  });
  return best < 0 ? null : 22 + best;
}

/**
 * The chat line a message prints, as the receiver builds it.
 *
 * Team radio: `"[" + grid + "] " + name + ": " + body + "!"`, the grid being
 * the 8x8 square of the control point for a point message, else of the
 * speaker (0x006acdb0). A point message's body is `" [" + point + "] "` then
 * Attack or Defend, which is where the retail double space comes from
 * (`[C5] skandia:  [Bridge] Attack!`). Shouted: `name + ": " + text`, no grid
 * and no added `!` (the lexicon strings already carry one).
 *
 * `opts`: `name`, `grid`, `strings` (the lexicon), and for a point message
 * `pointName` and `defend` (the point is the speaker's side's).
 */
export function radioChatText(id, opts) {
  const msg = RADIO_MESSAGES[id];
  if (!msg) return null;
  const s = key => opts.strings?.[key] ?? key;
  if (msg.kind === 'local') return `${opts.name}: ${s(msg.key)}`;
  const body = msg.cp != null
    ? ` [${opts.pointName ?? ''}] ${s(opts.defend ? 'RADIO_DEFEND' : 'RADIO_ATTACK')}`
    : s(msg.key);
  return `[${opts.grid ?? ''}] ${opts.name}: ${body}!`;
}

/** The voice patch a delivered message plays: MenuRadioSound for team radio
 *  (a point message by the receiver's call), SoldierVoice for a shout. */
export function radioPatch(id, defend = false) {
  const msg = RADIO_MESSAGES[id];
  if (!msg) return null;
  if (msg.cp != null) return { script: 'radio', patch: defend ? PATCH_DEFEND : PATCH_ATTACK };
  return { script: msg.kind === 'local' ? 'local' : 'radio', patch: msg.patch };
}

/**
 * The client's send limit: fields +0x2a8 (count), +0x2ac (clock), +0x2b0
 * (last). A send is refused once more than six have gone out and the last
 * attempt is under four seconds old -- and a refused attempt still counts as
 * the last one, so holding a key down stays refused. Every frame the clock
 * advances and, four seconds after the last attempt, one send is forgiven.
 */
export class RadioSpamLimit {
  constructor() { this.count = 0; this.clock = 0; this.last = 0; }
  tick(dt) {
    this.clock += dt;
    if (this.clock - this.last > SPAM_WINDOW) this.count -= 1;
    if (this.count <= 0) { this.count = 0; this.clock = 0; this.last = 0; }
  }
  trySend() {
    if (this.count > SPAM_BURST && this.clock - this.last < SPAM_WINDOW) {
      this.last = this.clock;
      return false;
    }
    this.last = this.clock;
    this.count += 1;
    return true;
  }
}

/** Every comparison `radio-layout.json` can put in a `when` list (the same
 *  vocabulary `hud.js` answers). */
export function condOk(c, vars) {
  if (c.op === 'and') return c.terms.every(t => condOk(t, vars));
  if (c.op === 'or') return c.terms.some(t => condOk(t, vars));
  const v = vars[c.var];
  const want = (c.value && typeof c.value === 'object') ? vars[c.value.var] : c.value;
  switch (c.op) {
    case 'eq': return v === want || Number(v) === Number(want);
    case 'ne': return !(v === want || Number(v) === Number(want));
    case 'lt': return Number(v) < Number(want);
    case 'le': return Number(v) <= Number(want);
    case 'gt': return Number(v) > Number(want);
    case 'ge': return Number(v) >= Number(want);
    default: return true;
  }
}

/** The leaves of the layout that draw under `vars`, each with its alpha:
 *  its own colour's times every bound multiplier it sits under. */
export function visibleLeaves(layout, vars) {
  const out = [];
  for (const el of layout?.elements || []) {
    if (!(el.when || []).every(c => condOk(c, vars))) continue;
    let alpha = el.color ? el.color[3] : 1;
    for (const name of el.alphaVars || []) alpha *= Number(vars[name] ?? 1);
    out.push({ el, alpha });
  }
  return out;
}

/** The text a text leaf draws: its live variable when it has one, else the
 *  lexicon string the extractor resolved. */
export function leafText(el, vars) {
  if (el.var && vars[el.var] != null) return String(vars[el.var]);
  return el.text ?? '';
}

/**
 * The menu's variable table: the file's own defaults, then what the engine
 * writes over them (the constructor at 0x006d25d0 and the menu's own two
 * CullVariableActionNodes).
 */
export function radioVars(layout, { category = 0, gameMode = 1, iconType = ICON_ON_FOOT,
  controlPointNames = [], showIcons = true, showToolTip = true } = {}) {
  const vars = { ...(layout?.defaults || {}) };
  vars['Radio/RadioCategory'] = category;
  vars['Radio/RadioGameMode'] = gameMode;
  vars['Radio/RadioIconType'] = iconType;
  vars['Radio/ShowRadioIcons'] = showIcons;
  vars['Radio/ShowRadioToolTip'] = showToolTip;
  vars['Radio/NumberOfControlPoints'] = controlPointNames.length;
  for (let i = 0; i < 6; i++) {
    vars[`Radio/ControlPoint/ControlPointCoordinate${i + 1}`] = controlPointNames[i] ?? '';
  }
  for (const act of layout?.variableActions || []) {
    if ((act.when || []).every(c => c && condOk(c, vars))) vars[act.set] = act.value;
  }
  return vars;
}
