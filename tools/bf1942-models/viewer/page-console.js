// The game's console (tilde) with the page's own commands registered on it,
// and the Esc menu drawn from the game's own menu layout. Lifted out of
// map.html (features/vehicle-instance-refactor Part 2); `console.js` stays
// the console and its painter.

import { GameConsole, paintConsole, loadConsoleFont } from './console.js';
import { createSkirmishScreen } from './play/skirmish.js';

/**
 * Built once by the page, where this code used to sit. `page` hands in
 * what it reads of the rest of the page, as getters (a binding the page
 * reassigns is read live):
 * `bfmap`, `capture`, `extras`, `hudPaths`, `keys`, `launchTeam`,
 * `MENU_URL`, `mouseInput`, `params`, `radioToolTip`, `release`, `releaseButtons`,
 * `scoreboardOpen`, `scoreFromSpawn`, `setRadioToolTip`, `setScoreboard`,
 * `setSideCollapsed`.
 */
export function createPageConsole(page) {
  const pageConsole = {};

  /* ------------------------------------------------------------------ console
   *
   * The game's own console, on the tilde key. The model, the parser and the
   * drawing rule all live in `./console.js`, reconstructed from
   * `dice::ref2::io::OldConsole` in both binaries; this is only the page's end
   * of it -- the canvas, the key hook, and the one command the viewer needs.
   *
   * `c_GIToggleConsole` is bound to `IDKey_Grave` and `IDKey_Capital` in the
   * shipped `Settings/Default/Controls/Common.con` (lines 26-27) and in the
   * client's own compiled fallback map (0x00927088 / 0x00927020). This page
   * already spends Caps Lock on the spawn menu, so only Grave toggles here.
   */
  const gameConsole = new GameConsole();
  const consoleCanvas = document.getElementById('console-canvas');
  pageConsole.consoleFont = null;
  pageConsole.consolePainted = -1;
  pageConsole.consoleSize = '';

  /** True while the console owns the keyboard and the mouse. Every input path
   *  in this file asks this before acting, which is the whole of "it swallows
   *  game input": the engine does the same thing by gating `Setup`'s input
   *  dispatch on the console's own visible flag (`this+0xe3`, read at
   *  0x004429e0, 0x004447fa, 0x00446719 and half a dozen more). */
  function consoleCaptures() { return gameConsole.open; }

  /** The debug gate. The panel and its fab are absent for a regular player;
   *  `show.dev 1` brings both back, `show.dev 0` puts them away. Nothing is
   *  removed from the DOM, so `__setOnFoot`, `__deploy`, the `?shots` flow and
   *  every `optOnFoot.checked` in this file are unaffected either way. */
  pageConsole.devMode = false;
  function setDevMode(on) {
    pageConsole.devMode = Boolean(on);
    document.body.classList.toggle('dev-on', pageConsole.devMode);
    if (pageConsole.devMode) page.setSideCollapsed(false);
    return pageConsole.devMode;
  }
  setDevMode(page.params.get('dev') === '1');

  /** `show.dev` is the viewer's own word, not one of the engine's (there is no
   *  `show` object in 1.61). It is shaped like a real one: read/write, one
   *  integer argument, and it answers through the same dispatcher, so
   *  `show.dev`, `show.dev 1`, `show.dev = 1` and `show.dev 0` all behave the
   *  way a registered property does. Later streams add real commands with the
   *  same call -- `gameConsole.register({ object, method, ... })`. */
  gameConsole.register({
    object: 'show', method: 'dev',
    minArgs: 0, maxArgs: 1, argTypes: ['int'], returns: 'int',
    run: args => {
      if (!args.length) return pageConsole.devMode ? 1 : 0;
      return setDevMode(args[0] !== '0' && args[0].toLowerCase() !== 'false') ? 1 : 0;
    },
  });

  /** `game.disconnect` is the engine's own word (it sits in the `game` object's
   *  method table beside `toggleGamePause` and `ticketRatio`), and it does what
   *  it does there: leaves the battle for the menu. */
  gameConsole.register({
    object: 'game', method: 'disconnect',
    minArgs: 0, maxArgs: 0, argTypes: [],
    run: () => { location.assign(page.MENU_URL); },
  });

  /**
   * The four mouse-sensitivity words, which are the engine's own: they are what
   * `Settings/Default/Controls/*.con` calls to set the shipped defaults, and
   * they are in the retail client's `game` object's method table
   * (`setInfMouseSensitivity`'s registrar `FUN_006bba90`, name string
   * `0x00920abc`; body at vtable `+0x48` = `0x006bbbe0` -> `0x006c57f0` ->
   * `ControlSettings::setSensitivity` `0x006eb1a0`, a bare `[this+0xc] = v`).
   *
   * One float argument, 0..1 like the menu slider, and read-back with no
   * argument. What the number buys is `5 x s + 0.1` as the mouse axis scale
   * (`applyMouseSensitivity` `0x006c55f0`), so 0.25 is 1.35 and 0.75 is 3.85.
   *
   * `game.setCommonMouseSensitivity` is registered for completeness and is
   * genuinely inert here: the Common profile belongs to
   * `defaultGameControlMap`, which binds `c_GIMouseLookX/Y` — the menu and map
   * cursor, not a player axis — and this page has no surface that reads it.
   */
  const MOUSE_SENSITIVITY_WORDS = {
    setCommonMouseSensitivity: 'common',
    setInfMouseSensitivity: 'infantry',
    setLandSeaMouseSensitivity: 'landSea',
    setAirMouseSensitivity: 'air',
  };
  for (const [method, profile] of Object.entries(MOUSE_SENSITIVITY_WORDS)) {
    gameConsole.register({
      object: 'game', method,
      minArgs: 0, maxArgs: 1, argTypes: ['float'], returns: 'float',
      run: args => (args.length
        ? page.mouseInput.setSensitivity(profile, args[0])
        : page.mouseInput.sensitivityFor(profile)),
    });
  }

  /** `game.setStaticMinimap` is the engine's own word — every stock
   *  `GeneralOptions.con` calls it with 1, which is why the widget is north-up
   *  by default — and it sets `BfMap`'s static byte (+0x58, ledger MMAP-2). 0
   *  lets the closed minimap turn with the player; read back with no argument.
   *  `bfmap` is declared further down this module, so it is only touched when
   *  the word runs, never at registration. */
  gameConsole.register({
    object: 'game', method: 'setStaticMinimap',
    minArgs: 0, maxArgs: 1, argTypes: ['int'], returns: 'int',
    run: args => {
      if (args.length) page.bfmap.setStatic(args[0] !== '0' && args[0].toLowerCase() !== 'false');
      return page.bfmap.isStatic ? 1 : 0;
    },
  });

  /** `game.setRadioToolTip` is the engine's own word (every stock
   *  `GeneralOptions.con` calls it): 1 draws the heading under each radio
   *  button, 0 the icons alone. Read back with no argument. */
  gameConsole.register({
    object: 'game', method: 'setRadioToolTip',
    minArgs: 0, maxArgs: 1, argTypes: ['int'], returns: 'int',
    run: args => {
      if (args.length) page.setRadioToolTip(args[0] !== '0' && args[0].toLowerCase() !== 'false');
      return page.radioToolTip() ? 1 : 0;
    },
  });

  function setConsoleOpen(on) {
    if (!gameConsole.setOpen(on)) return;
    consoleCanvas.hidden = !gameConsole.open;
    if (gameConsole.open) {
      if (page.scoreboardOpen() && !page.scoreFromSpawn) page.setScoreboard(false);
      // Whatever was held when the console came up must not still be held
      // under it: the engine stops feeding `PlayerInput` entirely while the
      // flag is set, so a key down at that moment never repeats.
      page.keys.clear();
      page.releaseButtons();
      if (!pageConsole.consoleFont) {
        // `Font/BF1942.font` out of this mod's own Font.rfa chain where it has
        // one (five of the installed mods do) and vanilla's otherwise.
        loadConsoleFont(page.hudPaths.consoleFont()).then(f => {
          pageConsole.consoleFont = f;
          pageConsole.consolePainted = -1;
        });
      }
    }
    pageConsole.consolePainted = -1;
  }

  function paintGameConsole(stageW, stageH) {
    if (!gameConsole.open || !stageW || !stageH) return;
    const size = `${stageW}x${stageH}`;
    if (gameConsole.version === pageConsole.consolePainted && size === pageConsole.consoleSize) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const cw = Math.round(stageW * dpr);
    const ch = Math.round(stageH * dpr);
    if (consoleCanvas.width !== cw || consoleCanvas.height !== ch) {
      consoleCanvas.width = cw;
      consoleCanvas.height = ch;
    }
    const ctx = consoleCanvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;   // the atlas is point art, like the HUD
    // The capture's pitch is 22 px on a 1124 px screen where the installed
    // font's own Height is 20; the drawer's rule is `lineHeight + 1` per line
    // (0x00465063), so the text object reports one more than the header does.
    const pitch = (pageConsole.consoleFont ? pageConsole.consoleFont.height : 20) + 2;
    paintConsole(ctx, gameConsole, { width: stageW, height: stageH,
                                     font: pageConsole.consoleFont, pitch });
    pageConsole.consolePainted = gameConsole.version;
    pageConsole.consoleSize = size;
  }

  /** `OldConsole::output` from the page's side: whatever the viewer wants in
   *  the scrollback, the way the client writes its own loader chatter into
   *  `io::mainConsole` (the string at 0x008d6168, logged all through boot).
   *  It is also what gives the band its height — `getLines(20)` returns what
   *  the scrollback has, so an unwritten console opens as a thin strip. */
  function logToConsole(text) {
    gameConsole.output(text);
    pageConsole.consolePainted = -1;
  }

  /** Everything the console knows, for headless checks and for later streams:
   *  the same object `register` hangs commands on. */
  window.__console = gameConsole;
  window.__showDev = setDevMode;
  window.__consoleLog = logToConsole;

  // --- the Escape menu -------------------------------------------------------
  //
  // The game's own way out of a level: Escape puts the front end back up over
  // the battle, and from there you either go back to it, leave it, or start a
  // different one. This is that screen — `play/skirmish.js`, the same
  // controller `play/index.html` is, mounted on a canvas over the stage with
  // its fourth page up: `menu/ExitMenu`'s button, which reads END CURRENT GAME
  // because an Instant Battle is a singleplayer game
  // (`Join/Disconnect/ShowDisconnect` = 2, the engine's own numbering).
  //
  // The level keeps running behind it, untouched, and entirely hidden: the
  // menu is opaque, exactly as the engine's is. The front end paints its black
  // field and its camouflaged plate over the game, and stops the Bink movie
  // while there is a game to go back to — so the battle does not show through,
  // and nothing here dims or blurs the frame to suggest that it does.
  //
  // Three ways out of it, and all three are the game's: Escape again is back to
  // the game, START is a different level (the page navigates, which is this
  // site's "disconnect and load the new map"), and END CURRENT GAME is
  // `game.disconnect` — the same MENU_URL the console word already goes to.
  //
  // There is one Instant Battle screen, and this is it: the same controller,
  // the same bot settings in the left column. The mod list is not here and is
  // not there either — it is the front end's own CUSTOM GAME tab, and there is
  // no front end behind a running level to tab to, nor anything for it to do
  // here: the mod is the one this level is running in.
  const menuCanvas = document.getElementById('menu-canvas');
  pageConsole.escMenu = null;
  pageConsole.escMenuUp = false;

  /** The screen, built and loading on first need. Warmed once the level is,
   *  so the first Escape is a paint and not a fetch. */
  function escMenuScreen() {
    if (pageConsole.escMenu) return pageConsole.escMenu;
    pageConsole.escMenu = createSkirmishScreen({
      canvas: menuCanvas,
      // `map.html` sits at the viewer root, where `play/index.html` is one
      // directory down; every pack and level URL in the controller is built
      // off this.
      root: '',
      params: page.params,
      // No menu loop over a battle: the engine stops the front end's own Bink
      // movie the moment there is a game behind the menu.
      music: false,
      inGame: true,
      onDisconnect: () => location.assign(page.MENU_URL),
      onStatus: text => { if (text) console.warn(text); },
    });
    pageConsole.escMenu.load()
      // The level and the side it opens on are the ones being played, the way
      // the game's own list sits on what it last started. `launchTeam` is the
      // `?team=` this page came in on; with no parameter the screen keeps its
      // own default, which is the one the way-in screen shows.
      .then(() => {
        pageConsole.escMenu.selectMap(page.extras?.level || page.params.get('map') || '');
        if (page.launchTeam) pageConsole.escMenu.setTeam(page.launchTeam);
      })
      .catch(error => {
        console.error('Escape menu unavailable', error);
        // A screen that cannot draw must not swallow Escape: the key goes back
        // to being the one that frees the pointer.
        setEscMenu(false);
        pageConsole.escMenu = null;
      });
    return pageConsole.escMenu;
  }

  /** Up or down. Down is "back to the game", which leaves the gate showing —
   *  the pointer lock is the player's to take again with a click, because a
   *  browser will not hand it back on the same Escape that took it away. */
  function setEscMenu(on) {
    if (on === pageConsole.escMenuUp) return;
    pageConsole.escMenuUp = on;
    menuCanvas.hidden = !on;
    if (on) {
      // A menu you cannot click is no menu: the pointer comes back with it.
      // (The browser has usually taken the lock off already — this is what
      // drops what was held and stops the world reading the mouse.)
      page.release();
      // Whatever was held when the menu came up must not still be held under
      // it — the same rule the console follows.
      page.keys.clear();
      escMenuScreen().paint();
      menuCanvas.focus();
      return;
    }
    // Down is back to the game, with the mouse: that is what the menu does in
    // the game, and there is no "click to resume" plate to ask for it any
    // more. Escape is a user gesture, so the lock is usually granted outright;
    // Chrome refuses one within about a second of the Escape that dropped it,
    // and `capture` is written to survive that (the view still drags, and the
    // next click takes the lock).
    page.capture();
  }

  /** Whether the menu owns the keyboard and the pointer. */
  function escMenuCaptures() { return pageConsole.escMenuUp; }

  // The handle, beside `__console`'s: a headless check drives the screen and
  // reads its state back rather than screen-scraping a canvas, the same shape
  // `play/index.html`'s `__menu` offers.
  window.__escMenu = {
    get up() { return pageConsole.escMenuUp; },
    get ready() { return (pageConsole.escMenu?.state?.levels ?? 0) > 0; },
    get state() { return pageConsole.escMenu?.state ?? null; },
    get levels() { return pageConsole.escMenu?.levels ?? []; },
    get mod() { return pageConsole.escMenu?.mod ?? null; },
    open: () => setEscMenu(true),
    close: () => setEscMenu(false),
    select: index => pageConsole.escMenu?.select(index),
    setTeam: team => pageConsole.escMenu?.setTeam(team),
    launchUrl: () => pageConsole.escMenu?.launchUrl() ?? null,
    start: () => pageConsole.escMenu?.start(),
    paint: () => pageConsole.escMenu?.paint(),
  };

  Object.assign(pageConsole, {
    consoleCaptures,
    escMenuCaptures,
    escMenuScreen,
    gameConsole,
    logToConsole,
    paintGameConsole,
    setConsoleOpen,
    setEscMenu,
  });
  return pageConsole;
}
