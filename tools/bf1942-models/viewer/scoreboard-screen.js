// The scoreboard screen (Tab, and the deploy screen's SCORE button): the
// game's own `scoreboard-layout.json` painted over the stage with the level's
// players, held open or toggled. Lifted out of map.html (features/vehicle-
// instance-refactor Part 2); `scoreboard.js` stays the layout arithmetic.

import { boardRows, boardVars, paintLeaves, listFloor, listGeometry } from './scoreboard.js';

/**
 * Built once by the page, where this code used to sit. `page` hands in
 * what it reads of the rest of the page, as getters (a binding the page
 * reassigns is read live):
 * `bust`, `currentDir`, `deployKit`, `deployRejoin`, `deployTeamId`,
 * `deployVars`, `drawBitmapText`, `extras`, `fullmapBox`, `hudPack`,
 * `hudPaths`, `loadouts`, `measureText`, `optOnFoot`, `placeHit`, `referee`,
 * `room`, `scoreFromSpawn`, `soldier`, `soldierDead`, `spawnLayout`,
 * `sprite`, `ticketFlagTexture`, `world`.
 */
export function createScoreboardScreen(page) {
  const scoreboard = {};

  // --- the score board ------------------------------------------------------------
  //
  // `scoreboard/scoreboard-layout.json` is the `Scoreboard/SpawnScoreBoard` group
  // of `menu/InGame` (extract_scoreboard_layout.py): the two team panels, their
  // heading strips and totals, the button frame, the server plate. `scoreboard.js`
  // is what the engine adds at runtime — the variable table and the list rows —
  // and the leaf painter; this is the page's end: the pack, the canvas, who is
  // on the board, and the two ways in (SCORE BOARD on the spawn screen, Tab held).
  const scoreBox = document.getElementById('scoreboard');
  const scoreCanvas = document.getElementById('scoreboard-canvas');
  const scoreDoneBtn = document.getElementById('scoreboard-done');
  const scoreLayout = { data: null, fonts: new Map(), textures: new Map() };
  scoreboard.scoreHoverDone = false;
  scoreboard.scorePaintKey = '';

  function scoreboardOpen() { return !scoreBox.hidden; }

  async function loadScoreLayout() {
    const url = rel => `${page.hudPaths.url(`scoreboard/${rel}`)}${page.bust()}`;
    let data;
    try {
      data = await fetch(url('scoreboard-layout.json')).then(r => r.json());
    } catch (error) {
      console.warn('score board layout unavailable', error);
      return;
    }
    const image = src => new Promise(resolve => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = src;
    });
    await Promise.all([
      ...Object.entries(data.fontFiles || {}).map(async ([id, entry]) => {
        const [meta, img] = await Promise.all([
          fetch(url(entry.glyphs)).then(r => r.json()), image(url(entry.file))]);
        if (img) scoreLayout.fonts.set(id, { meta, img, tinted: new Map() });
      }),
      ...Object.entries(data.textures || {}).map(async ([name, entry]) => {
        const img = await image(url(entry.file));
        if (img) scoreLayout.textures.set(name, img);
      }),
    ]);
    scoreLayout.data = data;
    if (scoreboardOpen()) paintScoreboard(true);
  }
  loadScoreLayout();

  /** Everyone the page really knows about: the local player, the bots this
   *  page spawned (`spawnBotsForLevel`), and in a room the roster the server
   *  sent. Nobody else is ever listed.
   *
   *  Each row's `kit` is what the first column's glyph is drawn from
   *  (`scoreboard.js` `rowIcon`): the local player's is the spawn screen's
   *  chosen row (`deployKit`, already a class key), a bot's is its kit
   *  template's `class` in `_shared/loadouts.json` (`botKitFor` picked the
   *  template). The room protocol carries no kit, so a remote player draws no
   *  glyph rather than a guessed one. `dead` is the skull: the local soldier's
   *  latch (`soldierDead`, or no body at all), a bot's destroyed Armor — the
   *  same reads the death cam and `botRespawnTick` make. */
  function scoreboardPlayers() {
    const inRoom = page.room.roomJoined && page.room.roomClient;
    const players = [{
      slot: inRoom ? page.room.roomClient.slot : null,
      name: page.room.roomName,
      team: inRoom ? (page.room.roomClient.hello?.team === 1 ? 1 : 2) : page.deployTeamId,
      local: true,
      kit: page.deployKit,
      dead: !page.soldier || !!page.soldierDead,
    }];
    for (const bot of page.referee.bots) {
      players.push({
        slot: null,
        name: bot.name,
        team: bot.team,
        bot: true,
        kit: page.loadouts?.kits?.[bot.kit]?.class ?? null,
        dead: !!page.world?.armorOf(bot.playerId)?.destroyed,
      });
    }
    if (inRoom) {
      for (const slot of page.room.roomClient.remoteSlots()) {
        players.push({ slot, name: page.room.roomClient.nameOf(slot), team: page.room.roomClient.teamOf(slot) });
      }
    }
    return players;
  }

  function scoreboardScale() {
    const W = scoreBox.clientWidth || 800;
    const H = scoreBox.clientHeight || 600;
    const [vw, vh] = scoreLayout.data?.virtual || [800, 600];
    if (W / H < 1) {
      const s = Math.min(W / vw, H / vh);
      return { sx: s, sy: s, ox: (W - vw * s) / 2, oy: (H - vh * s) / 2, W, H };
    }
    return { sx: W / vw, sy: H / vh, ox: 0, oy: 0, W, H };
  }

  const scoreRes = {
    // The board's own plates first; a bound picture (the two ticket flags) is
    // one of the HUD pack's sprites.
    texture: name => scoreLayout.textures.get(name) || page.sprite(name),
    measure: (fontId, text) => {
      const font = scoreLayout.fonts.get(fontId);
      return font ? page.measureText(font, text) : 0;
    },
    drawText: (ctx, fontId, text, x, y, rgb) =>
      page.drawBitmapText(ctx, fontId, text, x, y, rgb, scoreLayout.fonts),
    lineHeight: fontId => scoreLayout.data?.fontFiles?.[fontId]?.lineHeight || 8,
    hover: el => scoreboard.scoreHoverDone && el.texture === 'knappext_n',
    floor: el => listFloor(scoreLayout.data.elements, el),
  };

  /** One paint of the board. Cheap to ask for: nothing is drawn unless what it
   *  shows — the roster, the tallies, the size, the hover — has changed. */
  function paintScoreboard(force = false) {
    const data = scoreLayout.data;
    if (!data || !scoreboardOpen()) return;
    const inRoom = !!(page.room.roomJoined && page.room.roomClient);
    const rows = boardRows(scoreboardPlayers(), inRoom ? page.room.roomClient.feed : []);
    const s = scoreboardScale();
    const key = JSON.stringify([rows, s.W, s.H, page.scoreFromSpawn, scoreboard.scoreHoverDone, inRoom,
                                page.currentDir, page.hudPack.sprites.size]);
    if (!force && key === scoreboard.scorePaintKey) return;
    scoreboard.scorePaintKey = key;

    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const cw = Math.round(s.W * dpr);
    const ch = Math.round(s.H * dpr);
    if (scoreCanvas.width !== cw || scoreCanvas.height !== ch) {
      scoreCanvas.width = cw;
      scoreCanvas.height = ch;
    }
    const ctx = scoreCanvas.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, cw, ch);
    ctx.setTransform(s.sx * dpr, 0, 0, s.sy * dpr, s.ox * dpr, s.oy * dpr);

    const box = data.elements.find(el => el.kind === 'listbox');
    const visibleRows = box
      ? listGeometry(box, data.listColumns, scoreRes.lineHeight(box.font),
                     scoreRes.floor(box)).visibleRows : Infinity;
    const vars = boardVars(data.variables, {
      fromSpawn: page.scoreFromSpawn,
      inRoom,
      alive: page.deployRejoin || (page.optOnFoot.checked && !!page.soldier),
      serverName: inRoom ? String(page.room.roomClient.hello?.room ?? '') : '',
      serverIp: inRoom ? location.host : '',
      mapName: page.extras.level || page.currentDir || '',
      axisFlag: page.ticketFlagTexture(1),
      alliedFlag: page.ticketFlagTexture(2),
      rows,
      visibleRows,
    });
    paintLeaves(ctx, data, data.elements, vars, scoreRes, {
      'Scoreboard/AxisScoreboardList': rows[1],
      'Scoreboard/AlliedScoreboardList': rows[2],
    });
    // `ShowTicket` is its own top-level entry of menu/InGame and stays up over
    // the board. Live, the HUD canvas already has it; over the spawn screen the
    // deploy chrome drew it, and that chrome is hidden while the board stands in.
    if (page.scoreFromSpawn && page.spawnLayout.data?.groups?.tickets) {
      const spawnRes = { ...scoreRes,
        texture: name => page.sprite(name),
        measure: (fontId, text) => {
          const font = page.spawnLayout.fonts.get(fontId);
          return font ? page.measureText(font, text) : 0;
        },
        drawText: (c, fontId, text, x, y, rgb) => page.drawBitmapText(c, fontId, text, x, y, rgb),
      };
      paintLeaves(ctx, data, page.spawnLayout.data.groups.tickets.elements, page.deployVars(), spawnRes);
    }
    const done = data.elements.find(el => el.kind === 'button' && el.texture === 'knappext_n');
    if (done) page.placeHit(scoreDoneBtn, done.rect, s);
  }

  /** Open or close the board. `fromSpawn` is `Scoreboard/FromSpawnScoreboard`:
   *  true when the spawn screen's SCORE BOARD button opened it (the red button
   *  reads DONE and gives the spawn interface back), false when Tab holds it up
   *  over the live game (the button reads LOCK, which this page does not act
   *  on — there is nothing to lock a pointer for). */
  function setScoreboard(on, fromSpawn = false) {
    if (on === scoreboardOpen()) return;
    page.scoreFromSpawn = on && fromSpawn;
    scoreboard.scoreHoverDone = false;
    scoreBox.hidden = !on;
    scoreBox.classList.toggle('from-spawn', page.scoreFromSpawn);
    scoreDoneBtn.hidden = !page.scoreFromSpawn;
    page.fullmapBox.classList.toggle('board-open', page.scoreFromSpawn);
    if (on) paintScoreboard(true);
  }

  scoreDoneBtn.addEventListener('click', e => {
    e.stopPropagation();
    scoreDoneBtn.blur();
    setScoreboard(false);
  });
  for (const [type, over] of [['pointerenter', true], ['pointerleave', false]]) {
    scoreDoneBtn.addEventListener(type, () => { scoreboard.scoreHoverDone = over; paintScoreboard(); });
  }
  // A held key whose release the page never sees must not leave the board up.
  addEventListener('blur', () => { if (scoreboardOpen() && !page.scoreFromSpawn) setScoreboard(false); });
  new ResizeObserver(() => paintScoreboard(true)).observe(scoreBox);

  Object.assign(scoreboard, {
    paintScoreboard,
    scoreLayout,
    scoreboardOpen,
    scoreboardPlayers,
    setScoreboard,
  });
  return scoreboard;
}
