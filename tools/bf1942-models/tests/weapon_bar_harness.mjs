// Drives `viewer/weapon-bar.js` -- the client HUD's `Weapon` group -- under
// node and prints one JSON blob for `tests/test_weapon_bar.py`.
//
// Two halves. The state machine alone: the wheel, an item change, the Fire
// commit and the layout's timeout node, frame by frame on the menu clock.
// Then the group against a real `hud-layout.json` and `loadouts.json` (argv:
// pairs of `<name> <layout> <loadouts>`): each kit's `addWeaponIcon` list fed
// through `WeaponBar.feed` into a `Hud`'s vars, and the painter's own
// `_visible` asked which of the weaponBar group's leaves it would draw.
//
// `test_weapon_bar.py` copies `weapon-bar.js` and `hud.js` in beside this file,
// so the modules under test are the ones the page loads, byte for byte.

import { readFileSync } from 'node:fs';
import { WeaponBar, SCROLL_TIMEOUT, PICK_TIMEOUT, MENU_STEP, ICON_SLOTS } from './weapon-bar.js';
import { Hud, prepareElement } from './hud.js';

const out = {};
const ICON_VARS = Array.from({ length: ICON_SLOTS }, (_, i) => `Weapon/Icon/WeaponIcon${i + 1}`);
const SIX = ['k', 'p', 'r', 'g', 'b', 'm'];

function bar(icons = SIX, active = 3) {
  const b = new WeaponBar();
  b.show = true;
  b.setIcons(icons);
  b.reset(active);
  return b;
}
/** Painted frames until the bar goes down (the frame that fires counts). */
function framesUp(b, limit = 1000) {
  let n = 0;
  while (b.selecting && n < limit) { b.tick(); n++; }
  return n;
}

// --- the state machine ---------------------------------------------------------

{
  const b = bar();
  out.constants = { SCROLL_TIMEOUT, PICK_TIMEOUT, MENU_STEP, numberOfItems: b.numberOfItems };
  // A number key raises item 5: the bar comes up on 5, flagged, for 1.5.
  b.itemEnabled(5);
  out.pick = { selecting: b.selecting, picked: b.picked, weaponSelect: b.weaponSelect,
               activeWeapon: b.activeWeapon, timeOut: b.timeOut };
  // Fire while a number key's bar is up is the weapon's, not the bar's.
  out.pick.firePress = b.firePress();
  out.pick.frames = framesUp(b);
  out.pick.after = { selecting: b.selecting, weaponSelect: b.weaponSelect };
}
{
  // The wheel: up for 3.0, the highlight one step on, nothing raised.
  const b = bar();
  b.next();
  const opened = { selecting: b.selecting, picked: b.picked, weaponSelect: b.weaponSelect,
                   activeWeapon: b.activeWeapon, timeOut: b.timeOut };
  // Twenty frames in, another step restarts the timer.
  for (let i = 0; i < 20; i++) b.tick();
  b.next();
  const second = { weaponSelect: b.weaponSelect, currentTimeOut: b.currentTimeOut };
  const frames = framesUp(b);
  out.wheel = { opened, second, frames, after: { selecting: b.selecting, weaponSelect: b.weaponSelect } };
}
{
  // Wrapping, both ways, over a five-icon kit.
  const b = bar(['k', 'p', 'r', 'g', 'm'], 1);
  const seq = [];
  for (let i = 0; i < 6; i++) { b.next(); seq.push(b.weaponSelect); }
  b.close();
  b.reset(1);
  const back = [];
  for (let i = 0; i < 3; i++) { b.prev(); back.push(b.weaponSelect); }
  out.wrap = { next: seq, prev: back };
}
{
  // Fire commits: the highlighted slot's MenuSelect, and the item change that
  // follows takes the bar down.
  const b = bar();
  b.next(); b.next(); b.next();          // 3 -> 6
  const press = b.firePress();
  b.itemEnabled(press);                   // the soldier raised it
  out.commit = { press, selecting: b.selecting, activeWeapon: b.activeWeapon, weaponSelect: b.weaponSelect };
  // Fire on the item already in hand only takes the bar down.
  const c = bar();
  c.next(); c.prev();
  out.commitSame = { press: c.firePress(), selecting: c.selecting };
  // A slot past the dispatcher's six is swallowed and selects nothing.
  const d = bar(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'], 6);
  d.next(); d.next();                     // 6 -> 8
  out.commitPastSix = { weaponSelect: d.weaponSelect, press: d.firePress(), selecting: d.selecting };
  // No bar, no swallow.
  out.commitDown = { press: bar().firePress() };
}
{
  // An item change with the bar up takes it down (0x006d4b50's first branch).
  const b = bar();
  b.next();
  b.itemEnabled(2);
  out.pickWhileUp = { selecting: b.selecting, activeWeapon: b.activeWeapon, weaponSelect: b.weaponSelect };
  // `ShowWeaponIcon` false: the wheel does nothing.
  const h = bar();
  h.show = false;
  out.hidden = { took: h.next(), selecting: h.selecting, weaponSelect: h.weaponSelect };
}
{
  // `setIcons` keeps its list until the list itself changes, and the feed
  // writes every variable the layout reads.
  const b = new WeaponBar();
  const list = ['a', 'b', 'c'];
  b.setIcons(list);
  const icons = b.icons;
  b.setIcons(list);
  const vars = {};
  b.feed(vars, ICON_VARS);
  out.feed = { sameArray: icons === b.icons, numberOfItems: b.numberOfItems, vars };
}

// --- against the real layout ------------------------------------------------------

const KITS = {
  vanilla: ['GB_Engineer', 'GB_Medic', 'GB_Scout', 'GB_Assault'],
  dc_final: ['Us_Assault', 'US_Support', 'US_SpecOps', 'Iraq_Assault', 'Iraq_AT', 'US_AT3'],
};
out.layouts = {};
const argv = process.argv.slice(2);
for (let i = 0; i + 3 <= argv.length; i += 3) {
  const [name, layoutPath, loadoutsPath] = argv.slice(i, i + 3);
  const layout = JSON.parse(readFileSync(layoutPath, 'utf8'));
  const loadouts = JSON.parse(readFileSync(loadoutsPath, 'utf8'));
  const elements = layout.groups.weaponBar.elements.map(el => prepareElement(el));
  const icons = elements.filter(el => el.kind === 'variable-picture');
  const fills = elements.filter(el => el.kind === 'fill');
  const slotOf = el => {
    const m = /WeaponIcon(\d+)$/.exec(el.var || '');
    if (m) return Number(m[1]);
    const sel = (el.when || []).find(c => c.var === 'Weapon/WeaponSelect');
    return sel ? sel.value : null;
  };
  const kits = {};
  for (const kit of KITS[name] || []) {
    const row = loadouts.kits[kit];
    if (!row) continue;
    const perSlot = [];
    for (let n = 1; n <= 6; n++) {
      const hud = new Hud({ canvas: null, sprite: () => null });
      const b = new WeaponBar();
      b.show = true;
      b.setIcons(row.weaponIcons);
      b.reset(3);
      b.itemEnabled(n);                   // the number key: the bar up on n
      b.feed(hud.vars, ICON_VARS);
      perSlot.push({
        slot: n,
        icons: icons.filter(el => hud._visible(el)).map(slotOf),
        highlight: fills.filter(el => hud._visible(el)).map(slotOf),
      });
    }
    kits[kit] = { weaponIcons: row.weaponIcons, perSlot };
  }
  out.layouts[name] = { iconLeaves: icons.length, fillLeaves: fills.length, kits };
}

process.stdout.write(JSON.stringify(out));
