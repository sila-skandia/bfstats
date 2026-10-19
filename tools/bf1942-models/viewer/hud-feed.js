// What the HUD reads each frame: the engine's own MemeFile variables
// (`Vehicle/*`, `Ammo/*`, `Overheat/*`, the seat dots, the soldier's health,
// stance, ammo and weapon bar, the crosshair), written into
// `gameHud.vars` from the local player's seat and soldier, plus the HUD
// painter itself and its sprite pack. `hud.js` stays the renderer. Lifted
// out of map.html (features/vehicle-instance-refactor Part 2).

import { Hud, RESPAWN_GROUPS } from './hud.js';
import { setLevelHudOverlay } from './vehicle-occupancy.js';

/** HUD sprites loading at once; the rest wait their turn. */
const HUD_SPRITE_LOADS = 8;

/**
 * Built once by the page, where this code used to sit. `page` hands in
 * what it reads of the rest of the page, as getters (a binding the page
 * reassigns is read live):
 * `bust`, `currentDir`, `deployActive`, `drawFullMap`, `hudPaths`, `paintDeploySoon`.
 */
export function createHudFeed(page) {
  const hudFeed = {};


  // --- the in-game HUD: soldier-side variables --------------------------------
  //
  // hud.js owns the one painter for every group hud-layout.json declares; this
  // page's job is only to keep `gameHud.vars` current with the engine's own
  // named variables (features/bf1942-3d-models/in-game-hud.md). This section
  // feeds the SOLDIER side — health bar, stance figure, hand-weapon ammo panel —
  // plus the one shared boolean (`Vehicle/ShowVehicleIcon`) that switches the
  // ammo panel between its soldier and vehicle skins; a future seats.js owns
  // the vehicle-side groups themselves (vehicleIcon/vehicleHealth/vehicleSeats/
  // primaryAmmo/secondaryAmmo) and, once it lands, the finer-grained seated
  // state that boolean really needs — see the note on `inVehicle` below.


  // --- the sprite pack --------------------------------------------------------
  //
  // Every marker on every map surface is the game's own sprite out of
  // `menu.rfa`: `extract_hud_pack.py` decodes them into `maps/_shared/hud/`
  // for vanilla and into `maps/mods/<mod>/_shared/hud/` for whatever a mod
  // repaints, and `hudPaths` above picks between the two per file. So an Eve
  // of Destruction level flies the NVA and Viet Cong flags its own archives
  // hold, over the vanilla bezel and rings it never touched. `hud.json` names
  // the sprites and carries the flag-mesh-to-nation table (EoD's own, which
  // is why `flagso_m1` resolves differently there); `minimap-icons.json` is
  // `ObjectTemplate.setMinimapIcon` per vehicle template, read from the mod's
  // own `Objects.rfa` chain. They are point art and are drawn unsmoothed at
  // whole multiples where the surface allows.
  // `levelIcons` (`minimap-level-icons.json`) is the icons a level's own
  // `.con` files give templates, by level; `soldiers` (`soldier-icons.json`)
  // each soldier template's team art, which the HUD takes for the side the
  // level dresses in it (`nation.js`); `scopes` (`scopes.json`) each hand
  // weapon's optic. All three are optional: a pack built before them leaves
  // them null and every reader falls back to what it did without.
  const hudPack = {
    sprites: new Map(), icons: {}, nations: {}, scoreSettings: null,
    levelIcons: null, soldiers: null, scopes: null, levelHud: null,
    // Every sprite name the manifest lists (null until it is read) and the
    // ones whose image failed: together they tell a sprite that is still on
    // its way from one that is never coming (`kit-icon.js` `spriteState`).
    known: null, failed: new Set(),
  };
  // Sprites a screen is waiting on, moved to the head of the load queue
  // (`hudPack.want`). A mod's pack runs to thousands of files loaded a few
  // at a time, and the spawn screen's own art sat wherever the manifest
  // happened to list it.
  const wanted = new Set();
  let spriteQueue = null;
  function promoteWanted() {
    if (!spriteQueue || !wanted.size) return;
    const first = [], rest = [];
    for (const item of spriteQueue) (wanted.has(item[0]) ? first : rest).push(item);
    if (first.length) spriteQueue.splice(0, spriteQueue.length, ...first, ...rest);
  }
  hudPack.want = names => {
    let fresh = false;
    for (const name of names) {
      if (name && !wanted.has(name)) { wanted.add(name); fresh = true; }
    }
    if (fresh) promoteWanted();
  };
  // `vehicle-level-hud.json`: the vehicle HUD words (icon, dot position, ammo
  // pictures and bars) a level's own `Objects.con` changes on a template the mod chain also
  // declares (`extract_hud_pack.py` `extract_level_vehicle_hud`), applied
  // where a seat's HUD block is read (`vehicle-occupancy.js`).
  setLevelHudOverlay(control => {
    const level = hudPack.levelHud?.[page.currentDir];
    return level ? level[String(control).toLowerCase()] ?? null : null;
  });

  /** The player marker ships as a black cut-out — a solid arrowhead inside a
   *  translucent disc, colour left to the engine. Painted once the way the HUD
   *  shows it, grey disc and green arrow, and kept as a canvas. */
  function tintPlayerRing(img) {
    const c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const data = ctx.getImageData(0, 0, c.width, c.height);
    const px = data.data;
    for (let i = 0; i < px.length; i += 4) {
      const a = px[i + 3];
      if (!a) continue;
      if (a >= 200) {
        px[i] = 118; px[i + 1] = 214; px[i + 2] = 92;
      } else {
        px[i] = 214; px[i + 1] = 214; px[i + 2] = 208;
        px[i + 3] = Math.min(215, Math.round(a * 1.45));
      }
    }
    ctx.putImageData(data, 0, 0);
    return c;
  }

  async function loadHudPack() {
    // The score table (`extract_score_settings.py`), on its own request: a
    // tree that predates the file leaves the page on the `ScoreManager`
    // constructor's own numbers (`round-state.js`), which is what the engine
    // does for a mod that ships no settings file. Not awaited by the sprites
    // below and not lost with them.
    fetch(`${page.hudPaths.url('score-settings.json')}${page.bust()}`)
      .then(r => (r.ok ? r.json() : null))
      .then(settings => { hudPack.scoreSettings = settings || null; })
      .catch(() => {});
    for (const [key, file] of [['levelIcons', 'minimap-level-icons.json'],
                               ['soldiers', 'soldier-icons.json'], ['scopes', 'scopes.json'],
                               ['levelHud', 'vehicle-level-hud.json']]) {
      fetch(`${page.hudPaths.url(file)}${page.bust()}`)
        .then(r => (r.ok ? r.json() : null))
        .then(data => { hudPack[key] = data && typeof data === 'object' ? data : null; })
        .catch(() => {});
    }
    let manifest, icons;
    try {
      [manifest, icons] = await Promise.all([
        fetch(`${page.hudPaths.url('hud.json')}${page.bust()}`).then(r => r.json()),
        fetch(`${page.hudPaths.url('minimap-icons.json')}${page.bust()}`).then(r => r.json()),
      ]);
    } catch (error) {
      // The surfaces still draw — fallback dots, no chrome — so this is a
      // warning, not a failure.
      console.warn('hud sprite pack unavailable', error);
      hudPack.known = new Set();
      return;
    }
    hudPack.known = new Set(Object.keys(manifest.sprites || {}));
    hudPack.nations = manifest.flagMeshNation || {};
    hudPack.icons = icons || {};
    // A few at a time, not all at once: FHSW's pack is 3,555 sprites, and
    // starting every one together left the browser out of sockets
    // (ERR_INSUFFICIENT_RESOURCES) for the level's own textures, which then
    // drew white.
    const queue = spriteQueue = Object.entries(manifest.sprites || {});
    promoteWanted();
    const next = () => {
      const item = queue.shift();
      if (item) loadSprite(...item);
    };
    for (let i = 0; i < HUD_SPRITE_LOADS; i++) next();
    function loadSprite(name, entry) {
      const img = new Image();
      img.onload = () => {
        next();
        hudPack.sprites.set(name, name === 'minimap_icon_ring_32x32'
          ? tintPlayerRing(img) : img);
        // A picture the HUD was waiting on (`pending`, below): it paints on
        // a changed variable, and none changes when a sprite lands.
        if (wanted.has(name)) hudFeed.gameHud?.requestRepaint();
        // A cached sprite can finish while the page module is still
        // evaluating (its top-level awaits suspend it), before the module
        // has reached `deployScreen`'s initialiser: reading the getter then
        // throws a TDZ reference error and kills the boot. Skip the
        // deploy-screen repaint in that window; the sprite is stored either
        // way, and the next sprite's onload (or the deploy screen's own
        // first paint) draws with the full pack.
        try {
          if (page.deployActive()) {
            page.paintDeploySoon();
            // The spawn rings draw with these sprites (with a stroked-circle
            // fallback); once the real ring lands, put it on the map at once.
            page.drawFullMap(true);
          }
        } catch (_) {}
      };
      img.onerror = () => {
        next();
        // The row waiting on this one stops showing it as loading.
        hudPack.failed.add(name);
        if (wanted.has(name)) hudFeed.gameHud?.requestRepaint();
        try { if (page.deployActive()) page.paintDeploySoon(); } catch (_) {}
      };
      img.src = `${page.hudPaths.url(entry.file)}${page.bust()}`;
    }
  }
  loadHudPack();

  const sprite = name => hudPack.sprites.get(name) || null;

  // The in-game HUD painter (hud.js), sharing this same sprite pack rather than
  // fetching its own copy. Published unconditionally
  // on `window.__hud` — not only under `?shots` — because that is the whole of
  // the round-2 contract other tracks (seats.js, supply.js, armor.js) write
  // their own variables through: `window.__hud.vars['Vehicle/VehicleIcon'] =
  // ...`, once those tracks land.
  const hudCanvas = document.getElementById('hud-canvas');
  // A sprite the manifest lists that is neither loaded nor failed is on its
  // way: asked for by the HUD, it goes to the head of the queue.
  const pending = name => {
    if (!hudPack.known?.has(name) || hudPack.sprites.has(name) || hudPack.failed.has(name)) return false;
    hudPack.want([name]);
    return true;
  };
  const gameHud = new Hud({ canvas: hudCanvas, sprite, pending,
                            base: rel => page.hudPaths.url(rel), bust: page.bust,
                            groups: key => !RESPAWN_GROUPS.includes(key) });
  gameHud.load();
  window.__hud = gameHud;
  // The respawn wait's plates, same layout, on the canvas above the spawn
  // screen (`deploy-screen.js` `paintSpawnTimer` feeds and paints it).
  const respawnHud = new Hud({ canvas: document.getElementById('spawn-timer'), sprite, pending,
                               base: rel => page.hudPaths.url(rel), bust: page.bust,
                               groups: key => RESPAWN_GROUPS.includes(key) });
  respawnHud.load();

  Object.assign(hudFeed, {
    gameHud,
    respawnHud,
    hudPack,
    sprite,
  });
  return hudFeed;
}
