// The deploy screen: the game's spawn screen over the M map (the kit column,
// the dimmed map with its spawn rings, the footer buttons), its chosen side,
// flag, group and kit, the BfMap zoom it eases through, and the painting of
// the game's own `spawn-layout.json` with its bitmap fonts. Lifted out of
// map.html (features/vehicle-instance-refactor Part 2); the flow that opens
// and commits it is `spawning.js`.

import { kitIconCandidates } from './kit-icon.js';

/**
 * Built once by the page, where this code used to sit. `page` hands in
 * what it reads of the rest of the page, as getters (a binding the page
 * reassigns is read live):
 * `KIT_ROW_KEYS`, `bfmap`, `bust`, `cameraHeading`, `drawFullMap`,
 * `feedTicketVars`, `fullmapBox`, `fullmapCanvas`, `hudPack`, `hudPaths`,
 * `kitLoadout`, `kitRowLabelFor`, `loadouts`, `scoreboard`, `sprite`,
 * `teamNation`, `updateKitAriaLabels`, `worldReady`.
 */
export function createDeployScreen(page) {
  const deployScreen = {};

  // --- the deploy screen ------------------------------------------------------
  //
  // The game never drops a joining player straight into the world: the round
  // opens on its spawn screen, and this is that screen — the kit column on the
  // left, the dimmed map with its spawn rings on the right, footer buttons
  // underneath (SUICIDE/SCORE BOARD/RESUME when alive, CLOSE/SCORE BOARD/DONE
  // when dead). Same canvas, same projection as the M map;
  // `.deploy` on #fullmap is the whole of the state, and `toggleFullMap(false)`
  // strips it on any close. The column is the game's, row for row, and so is
  // what a row means: `deployKit` is read at spawn by `weaponTemplateFor`,
  // which resolves the row through the level's `game.setKit` binding to the
  // kit's primary weapon (`kitLoadout`, above).
  const deployChrome = document.getElementById('deploy-chrome');
  const fullmapFrame = page.fullmapBox.querySelector('.fm-map-frame');
  const deployTabs = [...page.fullmapBox.querySelectorAll('.fm-tab')];
  const deployKitHits = [...page.fullmapBox.querySelectorAll('.fm-kit')];
  const deploySuicideBtn = document.getElementById('deploy-suicide');
  const deployScoreBtn = document.getElementById('deploy-score');
  const deployResumeBtn = document.getElementById('deploy-resume');
  // Whether a live soldier waits behind the screen (M or Shift+R over a life
  // in progress). Cancelling a redeploy keeps him where he stood; cancelling a
  // join has nobody to keep and falls back to fly. It is also the game's
  // `Kit/IsAlive`: SUICIDE / RESUME with a life behind the screen, CLOSE / DONE
  // without one.
  deployScreen.deployRejoin = false;
  // The selection as it stood when the screen opened, so a cancelled redeploy
  // does not leave the panel's select pointing somewhere nobody went.
  deployScreen.deployKept = '';
  // Nothing chosen. `spawnFlagSelect` has no empty value and several things
  // read it, so "no spawn" is a flag beside it rather than a cleared select:
  // a click on the map away from every ring sets it, choosing anything clears
  // it, and while it is set the commit is free roam instead of a spawn.
  deployScreen.deployUnchosen = false;
  // The tab: 1 Axis, 2 Allied — the game's `Kit/ShowKit`. Follows the chosen
  // flag and filters the rings.
  deployScreen.deployTeamId = 2;
  // The deck spot chosen on a ship flag, as the spawn group its ring stands
  // for. Null for an island flag — their single ring carries no group.
  deployScreen.deployGroup = null;
  deployScreen.deployKit = 'assault';
  // The `Kit/MouseOver/*` flag the pointer currently holds true, and the footer
  // button under it, for the mouse-over plate.
  deployScreen.deployHoverVar = null;
  deployScreen.deployHoverBtn = null;

  // --- the open/close animation ------------------------------------------------
  //
  // The spawn map is the HUD minimap in the engine: one BfMap object, and
  // showing the deploy screen eases its zoom fraction z toward 1 as
  //   z += (target - z) * (1 - exp(-9*dt))
  // (BfMap__animate 0x00468fb0; ledger MMAP-1 — pure exponential, ~0.11 s time
  // constant, which is why the whole move reads in about 0.3 s). While z runs,
  // the map quad interpolates from the closed minimap's (620,30) 175x175 to the
  // spawn map's measured (280,33) 512x512 (MEME-13), and the displayed rotation
  // is (1 - z) x the heading (MMAP-2): the art enters turned with the camera
  // and settles north-up, while the quad's own edge stays axis-aligned — the
  // capture's grid is visibly tilted inside a vertical-edged pane. On the way
  // down everything runs in reverse, back onto the minimap corner. The engine
  // fades the open-map quad by the same easing (MEME-10's +0x4c), which here is
  // the pane's opacity: it comes up from nothing because the viewer's pane is
  // not the always-visible minimap widget the game starts from.
  const BFMAP_EASE_RATE = 9;
  const BFMAP_CLOSED_RECT = [620, 30, 175, 175];
  // The chrome is plain CullNode visibility (MEME-4) — the capture pops it in
  // fully formed about 0.13 s after the pane starts moving, which is z crossing
  // 0.7 (1 - exp(-9*0.134) ~= 0.7). `.deploy-ready` is that threshold.
  const BFMAP_CHROME_Z = 0.7;

  // True while the score board stands in for the spawn interface (opened by its
  // SCORE BOARD button). Declared here, ahead of the board's own block, because
  // the deploy close paths below read it and can run before that block has.
  deployScreen.scoreFromSpawn = false;
  deployScreen.deployZ = 0;        // the eased zoom fraction: 0 minimap, 1 spawn map
  deployScreen.deployZTarget = 0;  // where BfMap__animate is easing it

  function deployTransitionActive() {
    return deployScreen.deployZ !== deployScreen.deployZTarget;
  }

  /** One tick of the ease, then the pane rewritten from it. Runs from the
   *  frame loop; a no-op once the fraction has landed on its target. */
  function deployAnimate(dt) {
    if (deployScreen.deployZ === deployScreen.deployZTarget) return;
    deployScreen.deployZ += (deployScreen.deployZTarget - deployScreen.deployZ) * (1 - Math.exp(-BFMAP_EASE_RATE * dt));
    if (Math.abs(deployScreen.deployZTarget - deployScreen.deployZ) < 0.001) deployScreen.deployZ = deployScreen.deployZTarget;
    applyDeployFrame();
    if (deployScreen.deployZ === 0 && deployScreen.deployZTarget === 0) finishDeployClose();
  }

  /** Landed back on the minimap corner: gone for real, exactly what the
   *  instant close used to do — chrome stripped so a level switch or a plain
   *  Escape can never leave the screen armed behind a hidden overlay. */
  function finishDeployClose() {
    if (deployScreen.scoreFromSpawn) page.scoreboard.setScoreboard(false);
    page.fullmapBox.hidden = true;
    page.fullmapBox.classList.remove('deploy', 'deploy-ready');
    fullmapFrame.removeAttribute('style');
    page.fullmapCanvas.style.transform = '';
  }

  /** The pane this tick: the interpolated rect, the game's (1 - z) x heading
   *  content rotation — negated so the closed map reads with the camera's
   *  forward up — over-scaled by the square's cover factor so the turned art
   *  never shows a corner gap, and the fade. Flips the chrome on past the
   *  threshold. */
  function applyDeployFrame() {
    const s = deployScale();
    const rect = spawnLayout.data?.map?.rect || [280, 33, 512, 512];
    const [x, y, w, h] = BFMAP_CLOSED_RECT.map((c, i) => c + (rect[i] - c) * deployScreen.deployZ);
    fullmapFrame.style.left = `${s.ox + x * s.sx}px`;
    fullmapFrame.style.top = `${s.oy + y * s.sy}px`;
    fullmapFrame.style.width = `${w * s.sx}px`;
    fullmapFrame.style.height = `${h * s.sy}px`;
    fullmapFrame.style.opacity = deployScreen.deployZ.toFixed(3);
    // `bfmap.rotation` is that law with the static byte honoured: north-up all
    // the way under the shipped `game.setStaticMinimap 1`, turned in with the
    // camera under 0 (the profile the reference capture was recorded with).
    const theta = page.bfmap.rotation(deployScreen.deployZ, page.cameraHeading());
    const cover = Math.abs(Math.cos(theta)) + Math.abs(Math.sin(theta));
    page.fullmapCanvas.style.transform = `rotate(${theta}rad) scale(${cover.toFixed(4)})`;
    // The threshold only arms on the way up: a close strips the chrome in the
    // same breath that flips the target, exactly like the game's culls flip.
    page.fullmapBox.classList.toggle('deploy-ready',
      deployScreen.deployZTarget === 1 && deployScreen.deployZ >= BFMAP_CHROME_Z);
  }

  // The five rows in the game's order; the index is its `Kit/SelectedKit`.
  const KITS = ['scout', 'assault', 'antitank', 'medic', 'engineer'];

  /** Which photograph a kit row shows: the level's own kit for this row and
   *  team, through `_shared/loadouts.json`'s `kitIcon.icon` (`setKitIcon`'s raw
   *  path -- `kit-icon.js` handles the casing, the extension and the
   *  directory-qualified name a nation collision earns it) resolved against
   *  whichever sprites the pack actually loaded, mod's own first. Falls back
   *  to the vanilla-table guess below whenever the loadout, the icon field or
   *  the sprite itself is not there -- a mod whose pack has not caught up, or
   *  a level `_shared/loadouts.json` does not know. The theatre variants in
   *  that fallback exist only where the game drew them: Japanese assault and
   *  engineer, Soviet and Canadian assault; everything else is the plain
   *  allies/axis picture. */
  function kitPhoto(role, nation, team) {
    const { kit } = page.kitLoadout(team, role);
    const icon = kit && page.loadouts?.kits?.[kit]?.kitIcon?.icon;
    if (icon) {
      for (const candidate of kitIconCandidates(icon)) {
        if (page.hudPack.sprites.has(candidate)) return candidate;
      }
    }
    const variants = {
      jp: { assault: 'jap', engineer: 'jap' },
      rus: { assault: 'russian' },
      can: { assault: 'canadian' },
    };
    const side = variants[nation]?.[role] || (team === 1 ? 'axis' : 'allies');
    return `icon_${role}_${side}_selected`;
  }

  function deployActive() {
    return !page.fullmapBox.hidden && page.fullmapBox.classList.contains('deploy');
  }

  // --- the layout and its fonts -----------------------------------------------
  //
  // `spawn-layout.json`: the spawn interface out of `menu/InGame`, flattened
  // to draw lists in 800x600 virtual units, each leaf with the CullNode
  // conditions the game evaluates before drawing it, and the bitmap fonts its
  // text nodes name. The atlases are white with the glyph as alpha; a tinted
  // copy is made per colour the layout asks for.
  const spawnLayout = { data: null, fonts: new Map(), pending: false };

  async function loadSpawnLayout() {
    let data;
    try {
      data = await fetch(`${page.hudPaths.url('spawn-layout.json')}${page.bust()}`).then(r => r.json());
    } catch (error) {
      console.warn('spawn layout unavailable', error);
      return;
    }
    spawnLayout.data = data;
    await Promise.all(Object.entries(data.fontFiles || {}).map(async ([id, entry]) => {
      const meta = await fetch(`${page.hudPaths.url(entry.glyphs)}${page.bust()}`).then(r => r.json());
      const img = new Image();
      await new Promise(resolve => {
        img.onload = resolve;
        img.onerror = resolve;
        img.src = `${page.hudPaths.url(entry.file)}${page.bust()}`;
      });
      spawnLayout.fonts.set(id, { meta, img, tinted: new Map() });
    }));
    if (deployActive()) layoutDeploy();
  }
  loadSpawnLayout();

  /** The glyph atlas in one colour, made once per (font, colour). */
  function tintedAtlas(font, rgb) {
    const key = rgb.join(',');
    let c = font.tinted.get(key);
    if (c) return c;
    c = document.createElement('canvas');
    c.width = font.img.width;
    c.height = font.img.height;
    const ctx = c.getContext('2d');
    ctx.drawImage(font.img, 0, 0);
    ctx.globalCompositeOperation = 'source-in';
    ctx.fillStyle = `rgb(${rgb.map(v => Math.round(v * 255)).join(',')})`;
    ctx.fillRect(0, 0, c.width, c.height);
    font.tinted.set(key, c);
    return c;
  }

  function measureText(font, text) {
    let w = 0;
    for (const ch of text) {
      const g = font.meta.glyphs[ch.charCodeAt(0)];
      if (g) w += g[0] + g[1] + g[2];
    }
    return w;
  }

  /** Text in a bitmap font at virtual (x, y), the line's top at y: each glyph
   *  drawn at `left` past the pen and `ascent` above the baseline, the pen
   *  advancing by left + width + right, as `bf42/font.py` reads the `.dif`. */
  function drawBitmapText(ctx, fontId, text, x, y, rgb, fonts = spawnLayout.fonts) {
    const font = fonts.get(fontId);
    if (!font) return;
    const atlas = tintedAtlas(font, rgb);
    const base = font.meta.baseline;
    let pen = x;
    for (const ch of text) {
      const g = font.meta.glyphs[ch.charCodeAt(0)];
      if (!g) continue;
      const [left, width, right, ascent, x0, y0, x1, y1] = g;
      // The space glyph's rectangle is an opaque corner texel; it only
      // advances the pen.
      if (ch !== ' ' && width > 0 && y1 > y0) {
        ctx.drawImage(atlas, x0, y0, x1 - x0, y1 - y0,
                      pen + left, y + base - ascent, x1 - x0, y1 - y0);
      }
      pen += left + width + right;
    }
  }

  // --- the game's variables and conditions -------------------------------------

  /** The variable table the layout's conditions read: the file's defaults
   *  under this page's state. */
  function deployVars() {
    const vars = { ...(spawnLayout.data?.variables || {}) };
    vars['Kit/ShowKit'] = deployScreen.deployTeamId;
    vars['Kit/SelectedKit'] = Math.max(0, KITS.indexOf(deployScreen.deployKit));
    vars['Kit/IsAlive'] = deployScreen.deployRejoin;
    vars['ChangeTeam/ShowChangeTeam'] = true;
    page.feedTicketVars(vars);
    for (const k of Object.keys(vars)) if (k.startsWith('Kit/MouseOver/')) vars[k] = false;
    if (deployScreen.deployHoverVar) vars[deployScreen.deployHoverVar] = true;
    return vars;
  }

  function condOk(c, vars) {
    if (c.op === 'and') return c.terms.every(t => condOk(t, vars));
    if (c.op === 'or') return c.terms.some(t => condOk(t, vars));
    const v = vars[c.var];
    const want = (c.value && typeof c.value === 'object') ? vars[c.value.var] : c.value;
    switch (c.op) {
      case 'eq': return v === want || Number(v) === Number(want);
      case 'ne': return !(v === want || Number(v) === Number(want));
      case 'lt': return Number(v) < Number(want);
      case 'le': return Number(v) <= Number(want);
      // `gt`/`ge` come out of the extractor's own operand flip (`FLIP_CMP` in
      // extract_hud_layout.py) whenever the MemeFile puts the literal on the
      // left, e.g. `0 < Outside/OutsideTime`. Missing here they fell through to
      // the permissive default and drew a leaf that should have been culled --
      // the same bug fixed in hud.js's copy of this function. No group in
      // `spawn-layout.json` uses either today; they are implemented so this
      // evaluator and hud.js's stay the same function.
      case 'gt': return Number(v) > Number(want);
      case 'ge': return Number(v) >= Number(want);
      default: return true;
    }
  }

  const elementVisible = (el, vars) => (el.when || []).every(c => condOk(c, vars));

  /** The sprite a picture leaf shows: the variable pictures are the team's
   *  flag and the kit photographs, resolved for this level's nations. */
  function deployTexture(el, vars) {
    if (!el.var) return el.texture;
    const nation = page.teamNation(deployScreen.deployTeamId);
    if (el.var === 'ChangeTeam/AxisTeamFlag' || el.var === 'ChangeTeam/AlliedTeamFlag') {
      return `icon_flag_${nation}`;
    }
    const kit = /^Kit\/Icons\/KitIcon(\d)$/.exec(el.var);
    if (kit) return kitPhoto(KITS[Number(kit[1]) - 1], nation, deployScreen.deployTeamId);
    // Anything else bound to a live variable resolves the way `hud.js` does it:
    // strip the path and the extension, lower-case. This is only reached for
    // leaves nothing above claims — today the two ticket flags. Note that
    // `deployVars()` seeds the table from the layout's own sample values, so
    // this must stay BELOW the cases that derive art from the level rather than
    // from a variable, or a sample literal would win over a real lookup.
    const live = vars && vars[el.var];
    if (typeof live === 'string' && live) {
      const base = live.slice(live.lastIndexOf('/') + 1);
      const dot = base.lastIndexOf('.');
      return (dot > 0 ? base.slice(0, dot) : base).toLowerCase();
    }
    return el.texture;
  }

  /** The string a text leaf shows. The counts are the game's live player
   *  tallies, which are all zero for a man alone on the server; the commit
   *  button reads LOADING while the scene still streams. */
  function deployText(el, vars) {
    if (el.key === 'RESPAWN_SUICIDE' && !page.worldReady) return 'LOADING';
    if (el.var && /^Kit\/NrOf/.test(el.var)) return '0';
    // The five kit-row labels: the level's kit for the row, its own
    // `setKitName` resolved through the mod chain's lexicon — not the leaf's
    // own text, which is the menu's string for the class, and a mod re-points
    // the row's kit (and its name) without touching the menu.
    const role = page.KIT_ROW_KEYS[el.key];
    if (role) return page.kitRowLabelFor(role, el.text);
    // A bound string the page actually feeds wins over the layout's own sample
    // ("300"/"500" on the ticket counters). Only values this page wrote count:
    // `deployVars()` seeds the table from those same samples, so an untouched
    // key would otherwise look fed.
    if (el.var && TICKET_TEXT_VARS.has(el.var) && vars && vars[el.var] != null) {
      return String(vars[el.var]);
    }
    return el.text || '';
  }

  const TICKET_TEXT_VARS = new Set(['AxisTicket', 'AlliedTicket']);

  // --- laying out and painting -------------------------------------------------

  /** Virtual-to-stage mapping. The game stretches 800x600 to the screen; a
   *  portrait phone gets a uniform, letterboxed scale instead so nothing turns
   *  to a sliver. */
  function deployScale() {
    const W = page.fullmapBox.clientWidth || 800;
    const H = page.fullmapBox.clientHeight || 600;
    const [vw, vh] = spawnLayout.data?.virtual || [800, 600];
    if (W / H < 1) {
      const s = Math.min(W / vw, H / vh);
      return { sx: s, sy: s, ox: (W - vw * s) / 2, oy: (H - vh * s) / 2, W, H };
    }
    return { sx: W / vw, sy: H / vh, ox: 0, oy: 0, W, H };
  }

  function placeHit(btn, rect, s) {
    const [x, y, w, h] = rect;
    btn.style.left = `${s.ox + x * s.sx}px`;
    btn.style.top = `${s.oy + y * s.sy}px`;
    btn.style.width = `${w * s.sx}px`;
    btn.style.height = `${h * s.sy}px`;
  }

  /** Where everything sits for the stage's current size: the map in its
   *  rectangle, the pointer regions over the game's own, then a paint. */
  function layoutDeploy() {
    const data = spawnLayout.data;
    if (!data || !deployActive()) return;
    const s = deployScale();
    // While the open/close transition owns the pane (applyDeployFrame), its
    // rect is the eased interpolation, not the layout's final one.
    if (!deployTransitionActive()) placeHit(fullmapFrame, data.map.rect, s);
    const group = data.groups.spawn;
    const rows = group.elements.filter(el => el.kind === 'hit' && el.hover);
    for (const el of group.elements) {
      if (el.kind === 'hit' && el.label === 'RESPAWN_AXIS') placeHit(deployTabs[0], el.rect, s);
      if (el.kind === 'hit' && el.label === 'RESPAWN_ALLIED') placeHit(deployTabs[1], el.rect, s);
    }
    rows.forEach((el, i) => { if (deployKitHits[i]) placeHit(deployKitHits[i], el.rect, s); });
    const buttons = { RESPAWN_SUICIDE: deploySuicideBtn, RESPAWN_CLOSE: deploySuicideBtn,
                      RESPAWN_RESUME: deployResumeBtn, RESPAWN_DONE: deployResumeBtn,
                      RESPAWN_SCOREBOARD: deployScoreBtn };
    for (const el of group.elements) {
      if (el.kind === 'button' && buttons[el.id]) placeHit(buttons[el.id], el.rect, s);
    }
    page.updateKitAriaLabels();
    paintDeployChrome();
    page.drawFullMap(true);
  }

  /** One frame of the chrome: the layout's leaves in file order, each drawn
   *  only when its conditions hold under `deployVars()`. */
  function paintDeployChrome() {
    const data = spawnLayout.data;
    if (!data || !deployActive()) return;
    const s = deployScale();
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const cw = Math.round(s.W * dpr);
    const ch = Math.round(s.H * dpr);
    if (deployChrome.width !== cw || deployChrome.height !== ch) {
      deployChrome.width = cw;
      deployChrome.height = ch;
    }
    const ctx = deployChrome.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, cw, ch);
    ctx.setTransform(s.sx * dpr, 0, 0, s.sy * dpr, s.ox * dpr, s.oy * dpr);
    const vars = deployVars();
    const buttonHover = { RESPAWN_SUICIDE: 'suicide', RESPAWN_CLOSE: 'suicide',
                          RESPAWN_SCOREBOARD: 'score', RESPAWN_RESUME: 'resume', RESPAWN_DONE: 'resume' };
    // The ticket counter is its own top-level entry of menu/InGame, gated by
    // `ShowTicket` rather than by `Kit/ShowKit`, so it is a sibling of the spawn
    // group in the file and is drawn alongside it here — in the file's own
    // order, which puts it over the spawn plates the way the game draws it.
    const chrome = [...data.groups.spawn.elements,
                    ...(data.groups.tickets?.elements || [])];
    for (const el of chrome) {
      if (!elementVisible(el, vars)) continue;
      const [x, y, w, h] = el.rect;
      const color = el.color || [1, 1, 1, 1];
      ctx.globalAlpha = color[3];
      switch (el.kind) {
        case 'fill':
          ctx.fillStyle = `rgb(${color.slice(0, 3).map(v => Math.round(v * 255)).join(',')})`;
          ctx.fillRect(x, y, w, h);
          break;
        case 'picture': {
          const img = page.sprite(deployTexture(el, vars));
          if (!img) break;
          // Point art at its own size — the 16 px class glyphs — stays crisp;
          // the plates and photographs get the card's bilinear filtering.
          ctx.imageSmoothingEnabled = !(img.width <= 16 && img.height <= 16);
          ctx.drawImage(img, x, y, w, h);
          break;
        }
        case 'button': {
          // A button plate is drawn at its texture's own size (the 109x25
          // art sits inside a 128x128 sheet); the node's Width/Height is the
          // pointer region, not a scale.
          const img = page.sprite(deployScreen.deployHoverBtn === buttonHover[el.id] ? el.hover : el.texture);
          if (!img) break;
          ctx.imageSmoothingEnabled = true;
          ctx.drawImage(img, x, y, img.width, img.height);
          break;
        }
        case 'text': {
          const font = spawnLayout.fonts.get(el.font);
          if (!font) break;
          const text = deployText(el, vars);
          const width = measureText(font, text);
          const tx = el.align === 'center' ? x + (w - width) / 2
            : el.align === 'right' ? x + w - width : x;
          ctx.imageSmoothingEnabled = false;
          drawBitmapText(ctx, el.font, text, Math.round(tx), y, color.slice(0, 3));
          break;
        }
        default:
          break;
      }
    }
    ctx.globalAlpha = 1;
  }

  /** A repaint on the next frame, coalescing a burst of sprite loads or
   *  pointer moves into one. */
  function paintDeploySoon() {
    if (spawnLayout.pending || !deployActive()) return;
    spawnLayout.pending = true;
    requestAnimationFrame(() => {
      spawnLayout.pending = false;
      paintDeployChrome();
    });
  }

  new ResizeObserver(() => { if (deployActive()) layoutDeploy(); }).observe(page.fullmapBox);

  Object.assign(deployScreen, {
    KITS,
    applyDeployFrame,
    deployActive,
    deployAnimate,
    deployKitHits,
    deployResumeBtn,
    deployScoreBtn,
    deploySuicideBtn,
    deployTabs,
    deployVars,
    drawBitmapText,
    finishDeployClose,
    fullmapFrame,
    layoutDeploy,
    measureText,
    paintDeployChrome,
    paintDeploySoon,
    placeHit,
    spawnLayout,
  });
  return deployScreen;
}
