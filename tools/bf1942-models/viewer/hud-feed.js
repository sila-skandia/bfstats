// What the HUD reads each frame: the engine's own MemeFile variables
// (`Vehicle/*`, `Ammo/*`, `Overheat/*`, the seat dots, the soldier's health,
// stance, ammo and weapon bar, the crosshair, the view blurb), written into
// `gameHud.vars` from the local player's seat and soldier, plus the HUD
// painter itself and its sprite pack. `hud.js` stays the renderer. Lifted
// out of map.html (features/vehicle-instance-refactor Part 2).

import { Hud } from './hud.js';

/**
 * Built once by the page, where this code used to sit. `page` hands in
 * what it reads of the rest of the page, as getters (a binding the page
 * reassigns is read live):
 * `aircraft`, `bust`, `car`, `deployActive`, `drawFullMap`, `hud`,
 * `HUD_DRIVE`, `HUD_FLY`, `HUD_FOOT`, `HUD_PILOT`, `hudPaths`,
 * `isTouchDevice`, `mannedActive`, `navMode`, `occupancy`, `optOnFoot`,
 * `optPilot`, `paintDeploySoon`, `soldier`, `updateSeatPoseVisibility`.
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


  /** Announce the view C just selected, then fall back to the control list. */
  const VIEW_BLURB = {
    cockpit: 'cockpit · first person, from the seat\'s own eye point',
    nose: 'nose cam · past the propeller, no cockpit, reticle over open air',
    chase: 'chase · behind and above, horizon held level',
    front: 'front · ahead of the nose, looking back',
    flyby: 'fly-by · planted in the world, re-plants as you pull away',
    // The soldier's own names (`soldier-camera.js`).
    inside: 'first person · through the soldier\'s own eyes',
  };
  // The HUD line: the mode's own hint, the touch hint on a touch device, and
  // a flash that hands the line back to them (`flashHud`).
  function getTouchHudText() {
    if (page.optPilot.checked && page.occupancy) {
      if (page.mannedActive()) return 'Pad aims · FIRE shoots · ENTER exits';
      if (page.car) return 'Pad drives · FIRE main gun · ENTER exits';
      if (page.aircraft) return 'Pad pitch/roll · THR power · FIRE guns · ENTER exits';
    }
    if (page.optOnFoot.checked && page.soldier) {
      return 'Pad moves · drag scene to look · FIRE shoots · JUMP jumps · ENTER vehicles';
    }
    return page.navMode === 'fly'
      ? 'Hold to fly · Drag to steer · 2-finger pan'
      : 'Drag to pan · Pinch to zoom';
  }
  function updateHud() {
    if (page.isTouchDevice) {
      page.hud.textContent = getTouchHudText();
      return;
    }
    if (page.optPilot.checked) {
      page.hud.textContent = page.car ? page.HUD_DRIVE : page.HUD_PILOT;
    } else if (page.optOnFoot.checked) {
      page.hud.textContent = page.HUD_FOOT;
    } else if (page.isTouchDevice) {
      page.hud.textContent = getTouchHudText();
    } else {
      page.hud.textContent = page.HUD_FLY;
    }
  }
  /** The line for a mode whose desktop hint is `text` (the touch hint on a
   *  touch device). */
  function showHint(text) {
    page.hud.textContent = page.isTouchDevice ? getTouchHudText() : text;
  }

  let hudViewTimer = 0;
  /** Put `text` on the HUD line for a beat, then give it back to `updateHud`. */
  function flashHud(text) {
    page.hud.textContent = text;
    clearTimeout(hudViewTimer);
    hudViewTimer = setTimeout(updateHud, 2200);
  }
  function showView(mode) {
    flashHud(`view: ${VIEW_BLURB[mode]}`);
    // Seat poses only draw in external views — hide in the cockpit (CVMInside),
    // since the player is looking out from the pilot's eyes, not at the seat.
    page.updateSeatPoseVisibility();
  }

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
  const hudPack = { sprites: new Map(), icons: {}, nations: {}, scoreSettings: null };

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
      return;
    }
    hudPack.nations = manifest.flagMeshNation || {};
    hudPack.icons = icons || {};
    for (const [name, entry] of Object.entries(manifest.sprites || {})) {
      const img = new Image();
      img.onload = () => {
        hudPack.sprites.set(name, name === 'minimap_icon_ring_32x32'
          ? tintPlayerRing(img) : img);
        if (page.deployActive()) {
          page.paintDeploySoon();
          // The spawn rings draw with these sprites (with a stroked-circle
          // fallback); once the real ring lands, put it on the map at once.
          page.drawFullMap(true);
        }
      };
      img.onerror = () => {};
      img.src = `${page.hudPaths.url(entry.file)}${page.bust()}`;
    }
  }
  loadHudPack();

  const sprite = name => hudPack.sprites.get(name) || null;

  // The in-game HUD painter (hud.js), sharing this same sprite pack rather than
  // fetching its own copy. `gameHud`, not `hud`: that name is already the
  // `#hud` hint-line DOM element throughout this file. Published unconditionally
  // on `window.__hud` — not only under `?shots` — because that is the whole of
  // the round-2 contract other tracks (seats.js, supply.js, armor.js) write
  // their own variables through: `window.__hud.vars['Vehicle/VehicleIcon'] =
  // ...`, once those tracks land.
  const hudCanvas = document.getElementById('hud-canvas');
  const gameHud = new Hud({ canvas: hudCanvas, sprite,
                            base: rel => page.hudPaths.url(rel), bust: page.bust });
  gameHud.load();
  window.__hud = gameHud;

  Object.assign(hudFeed, {
    getTouchHudText,
    showHint,
    updateHud,
    flashHud,
    gameHud,
    hudPack,
    showView,
    sprite,
  });
  return hudFeed;
}
