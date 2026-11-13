// The in-game tooltips: retail's `menu::ToolTipManager`, the plate
// `menu/InGame` draws for it, and the T key.
//
// Read on our own BF1942.exe (the addresses below) with the Mac client's
// named code as the guide (gap audit 2026-11-12, entry 57):
//
//   - `enableToolTip(id, key, time, small, keyRows, prio, once)` 0x006cee60
//     shows a tip when the profile's tooltip option is on (`game.setToolTip`,
//     the shipped `GeneralOptions.con` writes 0) and nothing is up, or what
//     is up is another tip of the same or a lower priority. A `once` tip
//     shows one time. The heading is the lexicon's `<key>_HEADING`, the body
//     `<key>`, row n `<key>_<n+1>` beside the key bound to that row's
//     control, and the footer the TOGGLE TOOLTIP key and `TOOLTIP_CLOSE`.
//   - `addToolTip(...)` 0x006cf580 queues a tip instead; `BfMenu::updateHud`
//     shows the first queued one whenever none is up (the call at 0x006aec5b).
//   - The plate's own graph runs the clock: a `BfVariableTimeoutActionNode2`
//     counts `ToolTip/ToolTipTime` to `ToolTip/MaxToolTipTime` (the tip's
//     time) and clears `ToolTip/ShowToolTip`; a `BfAddSubNextEffectNode`
//     fades the two-line state panel's `ToolTip/Text/Alpha` to 0 over 4 s and
//     clears `ToolTip/Text/ShowToolTipText` (`tooltip-layout.json` `timers`).
//     That fade runs only while its `Reset`, `ToolTip/Text/FadeToolTipText`,
//     is set (`BfAddSubNextEffectNode::onUpdate`, Mac: a clear Reset re-arms
//     the node and runs nothing). The client sets it (manager `+0x2fd`) in two
//     places only, both turning tooltips OFF: `GeneralOptions::setToolTip(0)`
//     0x006d548a and the T key 0x00448c10. So the panel stands for as long
//     as tooltips are on, and fades when they are turned off. `+0x2fd` resets
//     no `once` flag: a once tip stays shown-once for the life of the client.
//   - `disableToolTip(id)` 0x006cecd0 takes a tip down when it is the one up.
//   - T (`c_PIToolTip`, `Setup` player input 0x0044895c..0x00448ba8): with a
//     tip up it closes it; with none up it flips the profile option, and the
//     state panel says which way ("TOOLTIPS ARE ON" / "<key> TO TURN TOOLTIPS
//     OFF").
//
// The tips and their numbers, each read at its call site:
//
//   on entering a vehicle  `Vehicle::enableVehicleTooltip`, the call at 0x006d6c06:
//       the template's `setToolTipType` class (`ToolTipManager::getToolTipString`
//       0x006ce8b0), 15.0 s, no key rows, priority 2, every time.
//   near a vehicle         id 0x17 `TOOLTIP_CLOSE_TO_VEHICLE` 10.0 s, one row
//                          (ENTER/EXIT), priority 1 (0x0046bbf2)
//   near a control point   id 0x19 `TOOLTIP_CLOSE_TO_CONTROLPOINT` 15.0 s (0x0046c534)
//   near a repair depot    id 0x1b `TOOLTIP_CLOSE_TO_REPAIR` 10.0 s (0x0046cc13)
//   near an ammo depot     id 0x1c `TOOLTIP_CLOSE_TO_RELOAD` 10.0 s (0x0046cc8a)
//   near a heal depot      id 0x1a `TOOLTIP_CLOSE_TO_HEAL` 10.0 s (0x0046cd02)
//       each of the five latched while it holds and taken down when it stops
//       (`BfMap` paint; Mac `MenuMapNode::onPaint` latches +0x1ac..+0x1b1).
//   on a spawn             queued, each once (0x006adfa0..0x006ae364):
//       id 1 `TOOLTIP_INTERFACE` 20.0 s, 3 rows (CROUCH, LIE DOWN, radio 8);
//       ids 2..6 `TOOLTIP_SOLDIER_<kit>` by the deploy kit, 25.0 s, rows on
//       the weapon keys 1..6; id 0x16 `TOOLTIP_COMMUNICATION` 35.0 s, 8 rows
//       on the radio keys.
//
//   as the spawn screen comes up (`BfMenu::updateHud` 0x006ad2c4..0x006ad358):
//       id 0 `TOOLTIP_ENTER_GAME` 10.0 s, once, shown at once when the mode
//       (`getGamePlayMode`, vt+0x84) is 2 or 4, Conquest or Co-op
//       (0x006ad2e5, 0x006ad2f8); then id 0x1e `TOOLTIP_RESPAWN` queued,
//       10.0 s, one row (control 0x3c, SHOW SPAWNINTERFACE), once. They are
//       drawn over the spawn screen, on the canvas the spawn timer uses.
//   near an enemy flag     id 0x18 `TOOLTIP_CLOSE_TO_FLAG` 10.0 s (0x0046bfb5):
//       Capture the Flag; the flag is not the player's side's and the player
//       is within the flag's own radius (Mac `MenuMapNode::onPaint`, the
//       class 0x9492 loop). Latched like the other near tips.
//   tickets low            id 0x1d `TOOLTIP_TICKETLOW` 15.0 s, once
//       (0x006e3af3..0x006e3b40): in the HUD's ticket call for the local
//       side, outside Objective mode, when the share `tickets / start` is
//       under 0.2 (the double at 0x008eaf70) and above 0 (at 0 the function
//       has returned at 0x006e3ad8).

/** Priorities (`ToolTipPrio`), as the call sites push them. */
export const PRIO_NEAR = 1;
export const PRIO_HELP = 2;

/** Tip ids the client uses (`enableToolTip`'s first argument). */
export const TIP_ENTER_GAME = 0;
export const TIP_INTERFACE = 1;
export const TIP_CLOSE_TO_FLAG = 0x18;
export const TIP_TICKETLOW = 0x1d;
export const TIP_RESPAWN = 0x1e;
/** The local side's ticket share under which `TOOLTIP_TICKETLOW` shows
 *  (the double at client 0x008eaf70). */
export const TICKET_LOW_SHARE = 0.2;
export const TIP_COMMUNICATION = 0x16;
export const TIP_CLOSE_TO_VEHICLE = 0x17;
export const TIP_CLOSE_TO_CONTROLPOINT = 0x19;
export const TIP_CLOSE_TO_HEAL = 0x1a;
export const TIP_CLOSE_TO_REPAIR = 0x1b;
export const TIP_CLOSE_TO_RELOAD = 0x1c;

/** Seconds the entry help stands (`pushl $0x41700000` at 0x006d6bea). */
export const VEHICLE_TIP_SECONDS = 15;
/** The state panel's fade, the graph's `End time` (`timers.textFade`). */
export const TEXT_FADE_SECONDS = 4;
/** `ToolTip/MaxToolTipTime`'s default in the graph, and the manager's own
 *  (45.0 at its constructor 0x006cf7e0; every tip writes its own). */
export const DEFAULT_TIP_SECONDS = 45;

/** The deploy kit's tip: id, lexicon key, seconds and key rows
 *  (0x006ae00e..0x006ae2b4; the kit index is the deploy screen's). */
export const KIT_TIPS = Object.freeze([
  { id: 2, key: 'TOOLTIP_SOLDIER_SCOUT', rows: 5 },
  { id: 3, key: 'TOOLTIP_SOLDIER_ASSAULT', rows: 4 },
  { id: 4, key: 'TOOLTIP_SOLDIER_AT', rows: 4 },
  { id: 5, key: 'TOOLTIP_SOLDIER_MEDIC', rows: 5 },
  { id: 6, key: 'TOOLTIP_SOLDIER_ENGINEER', rows: 6 },
]);
export const KIT_TIP_SECONDS = 25;

/** A vehicle class's tip id. The client maps the class through
 *  `ToolTipManager::getToolTipIndex` (heavy tank 7 .. SAS Willy 0x41); only
 *  its being distinct per class, and from the ids above, matters here. */
export function vehicleTipId(type) { return 0x100 + type; }

const MENU_SELECT = n => `c_PIMenuSelect${n}`;
const RADIO = n => `c_PIRadio${n}`;
/** The triggers behind the rows' control indices (`addToolTipKeyString`
 *  0x006cfa40): 0x12..0x17 are the weapon keys, 0x18 and 0x19 crouch and lie
 *  down, 0x45..0x4c the radio keys. The pairing is read off what each row's
 *  lexicon line says, not off the control table itself. */
const INTERFACE_ROWS = ['c_PICrouch', 'c_PILie', RADIO(8)];
const KIT_ROWS = [1, 2, 3, 4, 5, 6].map(MENU_SELECT);
const RADIO_ROWS = [1, 2, 3, 4, 5, 6, 7, 8].map(RADIO);

/** The manager. `strings`: the lexicon (`tooltip-layout.json` `strings`).
 *  `keyLabel(trigger)`: the bound key's name. */
export class ToolTipManager {
  constructor({ strings = {}, keyLabel = () => '', enabled = false } = {}) {
    this.strings = strings;
    this.keyLabel = keyLabel;
    this.enabled = !!enabled;     // the profile's tooltip option
    this.tips = new Map();        // id -> tip
    this.queue = [];              // `addToolTip`'s list, in order
    this.active = null;           // the tip up
    this.time = 0;
    this.maxTime = DEFAULT_TIP_SECONDS;
    // The two-line state panel: `fading` is `ToolTip/Text/FadeToolTipText`.
    this.text = { show: false, state: '', change: '', alpha: 1, fading: false };
  }

  _locale(key) { return this.strings[key] ?? key; }
  _toggleKey() { return this.keyLabel('c_PIToolTip'); }

  _tip(id, key, o) {
    let tip = this.tips.get(id);
    if (!tip) {
      tip = { id, key, time: o.time ?? DEFAULT_TIP_SECONDS, small: !!o.small,
              rows: o.rows ?? 0, prio: o.prio ?? PRIO_HELP, once: !!o.once,
              fresh: true, triggers: o.triggers ?? [] };
      this.tips.set(id, tip);
    }
    return tip;
  }

  /** `enableToolTipText` 0x006ce5a0: the two-line panel, lit. It stands
   *  until something sets the fade. */
  _stateText(stateKey, changeKey) {
    this.text.show = true;
    this.text.alpha = 1;
    this.text.fading = false;
    this.text.state = this._locale(stateKey);
    this.text.change = `${this._toggleKey()} ${this._locale(changeKey)}`.trim();
  }

  /** `enableToolTip`. True when the tip went up. */
  enable(id, key, o = {}) {
    const tip = this._tip(id, key, o);
    if (tip.once && !tip.fresh) return false;
    if (!this.enabled) return false;
    if (this.active) {
      if (this.active.id === id || !(this.active.prio <= tip.prio)) return false;
    }
    this.active = tip;
    tip.fresh = false;
    this.time = 0;
    this.maxTime = tip.time;
    this._stateText('TOOLTIP_ON', 'TOOLTIP_CLOSE');
    return true;
  }

  /** `addToolTip`: queued, shown when nothing else is up. */
  add(id, key, o = {}) {
    if (this.tips.has(id)) return;
    const tip = this._tip(id, key, o);
    if (!tip.once || tip.fresh) this.queue.push(tip);
  }

  /** `disableToolTip(id)`; with no id, the one up. */
  disable(id = this.active?.id) {
    if (!this.enabled || !this.active || this.active.id !== id) return false;
    this.active = null;
    this.time = 0;
    this._stateText('TOOLTIP_ON', 'TOOLTIP_TURN_OFF');
    return true;
  }

  /** T. Returns the profile option after the press. */
  toggleKey() {
    if (this.active) {
      this.disable();
    } else if (!this.enabled) {
      this.enabled = true;
      this._stateText('TOOLTIP_ON', 'TOOLTIP_TURN_OFF');
    } else {
      this.enabled = false;
      this._stateText('TOOLTIP_OFF', 'TOOLTIP_TURN_ON');
      this.text.fading = true;      // manager +0x2fd, 0x00448c10
    }
    return this.enabled;
  }

  /** `game.setToolTip`: the option, with no panel. Off takes a tip down. */
  setEnabled(on) {
    this.enabled = !!on;
    // `GeneralOptions::setToolTip(0)` 0x006d5474..0x006d548a: the tip down,
    // its clock at 0, and the panel (if it is up) set fading.
    if (!this.enabled) { this.active = null; this.time = 0; this.text.fading = true; }
    return this.enabled;
  }

  /** One frame of the plate's graph and of `updateHud`'s queue. */
  update(dt) {
    if (this.active) {
      this.time += dt;
      if (this.time > this.maxTime) { this.active = null; this.time = 0; }
    }
    if (this.text.show && this.text.fading) {
      this.text.alpha -= dt / TEXT_FADE_SECONDS;
      // The fade's end clears the panel and its Reset; the graph then puts
      // the alpha back to 1 for the next time (its `SetVariableAction`).
      if (this.text.alpha <= 0) { this.text.alpha = 1; this.text.show = false; this.text.fading = false; }
    }
    if (this.enabled && !this.active) {
      while (this.queue.length) {
        const tip = this.queue.shift();
        if (this.enable(tip.id, tip.key)) break;
      }
    }
  }

  /** The plate's variables, the names `menu/InGame` binds. `shown` false
   *  writes the plate down (the canvas that is not the one in use). */
  feed(vars, shown = true) {
    const tip = shown ? this.active : null;
    vars['ToolTip/ShowToolTip'] = !!tip;
    vars['ToolTip/SmallToolTip'] = !!tip?.small;
    vars['ToolTip/ToolTipIndex'] = tip ? tip.id : 0;
    vars['ToolTip/ToolTipHeading'] = tip ? this._locale(`${tip.key}_HEADING`) : '';
    vars['ToolTip/ToolTipKeyString'] = tip ? this._locale(tip.key).trim() : '';
    vars['ToolTip/ToolTipFooter'] = tip ? `${this._toggleKey()} ${this._locale('TOOLTIP_CLOSE')}`.trim() : '';
    for (let i = 0; i < 10; i++) {
      const on = tip && i < tip.rows;
      vars[`ToolTip/Key/ToolTipKey${i}`] = on ? this.keyLabel(tip.triggers[i]) ?? '' : '';
      vars[`ToolTip/Key/ToolTipKeyText${i}`] = on ? this._locale(`${tip.key}_${i + 1}`) : '';
    }
    vars['ToolTip/Text/ShowToolTipText'] = shown && this.text.show;
    vars['ToolTip/Text/ToolTipState'] = this.text.state;
    vars['ToolTip/Text/ToolTipStateChange'] = this.text.change;
    // Quantised: the HUD repaints when a tracked variable changes, and a
    // 4 s fade in 20 steps is five repaints a second, not sixty.
    vars['ToolTip/Text/Alpha'] = Math.round(this.text.alpha * 20) / 20;
  }
}

/**
 * The page's tooltips. `page`: `vars()` the HUD's variable table, `layout()`
 * the loaded `tooltip-layout.json` (null until it lands), `keyLabel(trigger)`,
 * `enabled()` and `setEnabled(on)` (the profile's `game.setToolTip`),
 * `occupancy` (the seat), `deployActive()`, `deployKit()` (the kit index),
 * `soldierAlive()`, `nearEntry()` (an entry point in reach), `spawnVars()`
 * (the spawn timer canvas's variable table), `gameplayMode()`,
 * `nearEnemyFlag()` (Capture the Flag) and `ticketShare()` (the local side's
 * tickets over its start).
 * Cost a frame: a dozen compares and, while a tip or the panel is up, some
 * thirty variable writes the HUD's dirty check then reads.
 */
export function createToolTips(page) {
  const manager = new ToolTipManager({ keyLabel: t => page.keyLabel?.(t) ?? '' });
  const latched = new Set();      // the "near" tips that hold now
  let layoutSeen = null;
  let seatRoot = null;
  let alive = false;
  let fed = false;
  let deployUp = false;

  function near(id, key, holds, o) {
    if (holds) {
      if (!latched.has(id)) { latched.add(id); manager.enable(id, key, { prio: PRIO_NEAR, ...o }); }
    } else if (latched.delete(id)) {
      manager.disable(id);
    }
  }

  /** `Vehicle::enterVehicle`'s help for the class the template declares:
   *  the seat's own `hud.toolTipType`, else the pack's table by template. */
  function vehicleTip(occ) {
    const layout = page.layout?.();
    const hud = occ.seatInfo?.(occ.rootId)?.hud;
    const template = String(occ.root?.userData?.control ?? occ.root?.name ?? '').toLowerCase();
    const type = Number.isInteger(hud?.toolTipType) ? hud.toolTipType
      : layout?.vehicles?.[template] ?? layout?.vehicles?.[template.replace(/_\d+$/, '')];
    const key = Number.isInteger(type) ? layout?.types?.[type] : null;
    if (!key) return;
    manager.enable(vehicleTipId(type), key, { time: VEHICLE_TIP_SECONDS, prio: PRIO_HELP });
  }

  /** The spawn's queue: the interface, the kit, the radio; each once. */
  function spawnTips() {
    manager.add(TIP_INTERFACE, 'TOOLTIP_INTERFACE',
      { time: 20, rows: 3, once: true, triggers: INTERFACE_ROWS });
    const kit = KIT_TIPS[page.deployKit?.() ?? -1];
    if (kit) manager.add(kit.id, kit.key, { time: KIT_TIP_SECONDS, rows: kit.rows, once: true, triggers: KIT_ROWS });
    manager.add(TIP_COMMUNICATION, 'TOOLTIP_COMMUNICATION',
      { time: 35, rows: 8, once: true, triggers: RADIO_ROWS });
  }

  /** The spawn screen coming up: the game's welcome (Conquest and Co-op),
   *  then the respawn interface's own help; each once. */
  function deployTips() {
    const mode = String(page.gameplayMode?.() ?? '').toLowerCase();
    if (mode.includes('conquest') || mode.includes('coop') || mode.includes('co-op')) {
      manager.enable(TIP_ENTER_GAME, 'TOOLTIP_ENTER_GAME', { time: 10, prio: PRIO_HELP, once: true });
    }
    manager.add(TIP_RESPAWN, 'TOOLTIP_RESPAWN',
      { time: 10, rows: 1, once: true, triggers: ['c_GIInGameMenu'] });
  }

  function frame(dt) {
    const layout = page.layout?.() ?? null;
    const vars = page.vars?.();
    if (!layout || !vars) return;
    // Over the spawn screen the plate is the spawn timer's canvas's.
    const over = page.spawnVars?.() ?? null;
    const deploy = !!page.deployActive?.();
    if (layout !== layoutSeen) { layoutSeen = layout; manager.strings = layout.strings ?? {}; }
    const want = !!page.enabled?.();
    if (want !== manager.enabled) manager.setEnabled(want);
    // Off with nothing fading: one compare a frame, and the variables are
    // written once so the plate's leaves cull.
    if (!manager.enabled && !manager.text.show && !manager.active) {
      if (!fed) { manager.feed(vars); if (over) manager.feed(over, false); fed = true; }
      seatRoot = page.occupancy?.root ?? null;
      alive = !!page.soldierAlive?.();
      deployUp = deploy;
      return;
    }
    fed = false;
    if (deploy && !deployUp && manager.enabled) deployTips();
    deployUp = deploy;
    const occ = page.occupancy ?? null;
    const root = occ?.root ?? null;
    if (root !== seatRoot) {
      seatRoot = root;
      if (root && manager.enabled) vehicleTip(occ);
    }
    const nowAlive = !!page.soldierAlive?.();
    if (nowAlive && !alive && manager.enabled) spawnTips();
    alive = nowAlive;
    if (manager.enabled) {
      near(TIP_CLOSE_TO_VEHICLE, 'TOOLTIP_CLOSE_TO_VEHICLE', !root && nowAlive && !!page.nearEntry?.(),
        { time: 10, rows: 1, triggers: ['c_PIUse'] });
      near(TIP_CLOSE_TO_CONTROLPOINT, 'TOOLTIP_CLOSE_TO_CONTROLPOINT', vars['ShowFlagIcon'] === true, { time: 15 });
      near(TIP_CLOSE_TO_REPAIR, 'TOOLTIP_CLOSE_TO_REPAIR', vars['ShowRepairIcon'] === true, { time: 10 });
      near(TIP_CLOSE_TO_RELOAD, 'TOOLTIP_CLOSE_TO_RELOAD', vars['ShowReloadIcon'] === true, { time: 10 });
      near(TIP_CLOSE_TO_HEAL, 'TOOLTIP_CLOSE_TO_HEAL', vars['ShowHealIcon'] === true, { time: 10 });
      near(TIP_CLOSE_TO_FLAG, 'TOOLTIP_CLOSE_TO_FLAG', nowAlive && !!page.nearEnemyFlag?.(), { time: 10 });
      // The local side's tickets under a fifth of what it started with.
      const share = page.ticketShare?.();
      if (share > 0 && share < TICKET_LOW_SHARE) {
        manager.enable(TIP_TICKETLOW, 'TOOLTIP_TICKETLOW', { time: 15, prio: PRIO_HELP, once: true });
      }
    } else {
      latched.clear();
    }
    manager.update(dt);
    // One plate: over the spawn screen it is drawn on that screen's canvas,
    // where the state panel is culled (`Kit/ShowKit`).
    const onSpawn = deploy && !!over;
    manager.feed(vars, !onSpawn);
    if (over) {
      manager.feed(over, onSpawn);
      over['ToolTip/Text/ShowToolTipText'] = false;
      if (over['Kit/ShowKit'] === undefined) over['Kit/ShowKit'] = 1;
    }
    if (vars['Kit/ShowKit'] === undefined) vars['Kit/ShowKit'] = 0;
    if (deploy) vars['ToolTip/Text/ShowToolTipText'] = false;
  }

  /** `c_PIToolTip`: the press, and the profile option it leaves. */
  function toggleKey() {
    if (!page.layout?.()) return manager.enabled;
    manager.strings = page.layout().strings ?? manager.strings;
    manager.enabled = !!page.enabled?.();
    const on = manager.toggleKey();
    page.setEnabled?.(on);
    fed = false;
    return on;
  }

  return { manager, frame, toggleKey };
}
