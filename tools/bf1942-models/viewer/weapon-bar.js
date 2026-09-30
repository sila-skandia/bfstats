// The weapon-select bar, as the client's HUD `Weapon` group runs it.
//
// `menu/InGame`'s `weaponBar` group (hud.js) draws six numbered slots and a
// highlight, and gates the fifth and sixth on `Weapon/NumberOfItems`. Every
// variable it reads is a field of ONE small client object, the HUD
// singleton's `Weapon` group (`[0x00a5f1a8]+0x24`, built at 0x006a995c, vtable
// 0x0092393c). Its registrar 0x006d4720 names them all (ledger HUD-14):
//
//   +0x08 int   WeaponSelect           the highlighted slot, 1..NumberOfItems
//   +0x0c int   ActiveWeapon           the item index in hand
//   +0x10 bool  SelectingWeapon        the bar is up
//   +0x11 bool  (unregistered)         it was raised by an item change, not
//                                      the wheel; Fire does not commit then
//   +0x12 bool  ShowWeaponIcon
//   +0x14 int   NumberOfItems          how many icons the kit declares
//   +0x18 float CurrentWeaponTimeOut   the layout's timer
//   +0x1c float WeaponTimeOut          when it fires
//   +0x20 pic   Icon/WeaponIcon1..10   0x1c apart
//
// `Weapon/Color/*`, which the highlight's fill binds, is not among them: the
// engine never writes it, and the layout's own ColorData stands (HUD-1).
//
// What writes them (ledger HUD-15..HUD-17, every address BF1942.exe):
//
//   0x006d4c20  every painted frame, from the soldier's CURRENT kit
//               (0x006ad836: kit template +0x270, the `addWeaponIcon` list,
//               filled in declaration order by 0x004e97e0): each path into
//               `WeaponIcon<i>`, and `NumberOfItems` = the list's length.
//   0x006d4a60  c_PINextItem (0x00448d4e): opens the bar with a 3.0 timeout
//               if it was down, restarts the timer, WeaponSelect + 1, past
//               NumberOfItems back to 1. Nothing is selected.
//   0x006d4ae0  c_PIPrevItem (0x00448da3): the same, WeaponSelect - 1, below
//               1 round to NumberOfItems.
//   0x006d4b50  the soldier enabled item N (`enableItem`, 0x004f9b3e, which
//               returns early when N is already in hand): ActiveWeapon = N.
//               If the bar was down it goes up on N, timeout 1.5, flagged
//               +0x11; if it was up, it goes down.
//   0x00448e41  c_PIFire or c_PIAltFire while the bar is up and not +0x11:
//               both are swallowed; if WeaponSelect is not the item in hand
//               the dispatcher presses c_PIMenuSelect<WeaponSelect> (a jump
//               table for 1..6 only), otherwise 0x006d4be0 takes the bar down.
//   layout      `BfVariableTimeoutActionNode2` (menu/InGame, beside the bar):
//               CurrentWeaponTimeOut += the menu step each painted frame; at
//               WeaponTimeOut it zeroes it, SelectingWeapon := false and
//               WeaponSelect := ActiveWeapon (its update is 0x007dd2c0).
//
// The menu's clock is 1/30 per painted frame whatever the frame rate
// (HFD-6), so the wheel's bar stays up 90 painted frames and a number key's 45.
//
// Free of the DOM and of `three`, so `tests/weapon_bar_harness.mjs` drives the
// same bytes the page loads.

/** `WeaponTimeOut` a wheel step opens the bar with (0x006d4aa2). */
export const SCROLL_TIMEOUT = 3.0;
/** `WeaponTimeOut` an item change opens it with (0x006d4baa). */
export const PICK_TIMEOUT = 1.5;
/** One painted frame of menu time: `Setup+0x184`, 1 / g_simulationFps. */
export const MENU_STEP = Math.fround(1 / 30);
/** The dispatcher's MenuSelect jump table (0x00448e9c `cmp eax,5; ja`). */
export const COMMIT_SLOTS = 6;
/** The icon slots the group registers (0x006d4890 loop, `+0x20`..`+0x138`). */
export const ICON_SLOTS = 10;

export class WeaponBar {
  constructor() {
    // The ctor's values (0x006d49d0): slot 1 highlighted, item 2 active.
    this.weaponSelect = 1;
    this.activeWeapon = 2;
    this.selecting = false;
    this.picked = false;
    this.show = false;
    this.numberOfItems = 0;
    this.currentTimeOut = 0;
    // The layout's own resting value; every opening writes one of the two above.
    this.timeOut = 0.75;
    this.icons = [];
    this._iconSource = null;
  }

  /** A fresh soldier: the bar down, the highlight on the item he spawned
   *  holding. Not an engine call: whether the client's spawn and kit pickup
   *  (`enableItem(2)` then `enableItem(3)`, each a `itemEnabled` here) reach
   *  the HUD with the player already attached was not read (ledger HUD-17). */
  reset(active = null) {
    this.selecting = false;
    this.picked = false;
    this.currentTimeOut = 0;
    if (Number.isInteger(active) && active > 0) {
      this.activeWeapon = active;
      this.weaponSelect = active;
    }
  }

  /** 0x006d4c20: the kit's `addWeaponIcon` list, in declaration order. Called
   *  every painted frame; copies only when the list itself changed. */
  setIcons(list) {
    if (list === this._iconSource) return;
    this._iconSource = list;
    const icons = Array.isArray(list) ? list : [];
    this.icons.length = 0;
    for (let i = 0; i < icons.length && i < ICON_SLOTS; i++) this.icons.push(icons[i] || null);
    this.numberOfItems = icons.length;
  }

  /** The start of 0x006d4a60 / 0x006d4ae0: raise the bar for the wheel if it
   *  was down, and restart its timer either way. */
  _scrollOpen() {
    if (!this.selecting) {
      this.selecting = true;
      this.picked = false;
      this.currentTimeOut = 0;
      this.timeOut = SCROLL_TIMEOUT;
    }
    this.currentTimeOut = 0;
  }

  /** c_PINextItem, 0x006d4a60. Gated on `ShowWeaponIcon` (and, in the
   *  engine, on the player holding his soldier). */
  next() {
    if (!this.show) return false;
    this._scrollOpen();
    const next = this.weaponSelect + 1;
    this.weaponSelect = next < this.numberOfItems + 1 ? next : 1;
    return true;
  }

  /** c_PIPrevItem, 0x006d4ae0. */
  prev() {
    if (!this.show) return false;
    this._scrollOpen();
    const prev = this.weaponSelect - 1;
    this.weaponSelect = prev > 0 ? prev : this.numberOfItems;
    return true;
  }

  /** 0x006d4b50: the soldier has just raised item `n`. */
  itemEnabled(n) {
    this.activeWeapon = n;
    if (this.selecting) {
      this.selecting = false;
      this.picked = false;
      return;
    }
    this.weaponSelect = n;
    this.selecting = true;
    this.picked = true;
    this.currentTimeOut = 0;
    this.timeOut = PICK_TIMEOUT;
  }

  /** 0x006d4be0: the bar down, nothing selected. */
  close() {
    if (!this.selecting) return;
    this.selecting = false;
    this.picked = false;
  }

  /**
   * The dispatcher's Fire/AltFire branch (0x00448e41..0x00448fb3). Returns
   * -1 when the press is not the bar's (it fires the weapon as usual), 0 when
   * the bar swallowed it and nothing is to be selected, or the slot whose
   * c_PIMenuSelect the press becomes.
   */
  firePress() {
    if (!this.selecting || this.picked) return -1;
    const slot = this.weaponSelect;
    if (slot === this.activeWeapon) {
      this.close();
      return 0;
    }
    return slot >= 1 && slot <= COMMIT_SLOTS ? slot : 0;
  }

  /** The layout's `BfVariableTimeoutActionNode2`, once per painted frame.
   *  Opening the bar always restarts it, so counting only while it is up
   *  answers the same as the node's own unconditional count. */
  tick() {
    if (!this.selecting) return;
    this.currentTimeOut = Math.fround(this.currentTimeOut + MENU_STEP);
    if (this.timeOut <= this.currentTimeOut) {
      this.currentTimeOut = 0;
      this.selecting = false;
      this.picked = false;
      this.weaponSelect = this.activeWeapon;
    }
  }

  /** Write the group into `vars` under the layout's own names. `iconVars` is
   *  the prebuilt `Weapon/Icon/WeaponIcon<i>` list (nothing allocates here). */
  feed(vars, iconVars) {
    vars['Weapon/SelectingWeapon'] = this.selecting;
    vars['Weapon/WeaponSelect'] = this.weaponSelect;
    vars['Weapon/ActiveWeapon'] = this.activeWeapon;
    vars['Weapon/NumberOfItems'] = this.numberOfItems;
    vars['Weapon/CurrentWeaponTimeOut'] = this.currentTimeOut;
    vars['Weapon/WeaponTimeOut'] = this.timeOut;
    for (let i = 0; i < iconVars.length; i++) vars[iconVars[i]] = this.icons[i] ?? null;
  }

  /** A plain copy for the test hooks. */
  snapshot() {
    return {
      selecting: this.selecting, picked: this.picked, weaponSelect: this.weaponSelect,
      activeWeapon: this.activeWeapon, numberOfItems: this.numberOfItems,
      currentTimeOut: this.currentTimeOut, timeOut: this.timeOut, show: this.show,
      icons: this.icons.slice(),
    };
  }
}
