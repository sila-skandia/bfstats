// The map surfaces: the minimap, the full (M) map and the deploy screen's
// map, painted from the level's own map art with the game's own sprites --
// the control points, the vehicles, the friendlies, the spawn rings, the
// player -- through the `BfMap` open/close animation, and the ticket and
// flag-icon variables the HUD reads beside them. Lifted out of map.html
// (features/vehicle-instance-refactor Part 2); `bfmap.js` stays the
// projection and the animation. Built inside this factory from their own
// modules: the canvases' backing-store sizing (`map-canvas-fit.js`), the
// tinted sprite painter (`map-sprites.js`) and the friendly units the
// surfaces mark (`map-friendlies.js`).

import * as THREE from 'three';
import { flagMapSpots } from './deploy-spots.js';
import { heldNation, teamNation as teamNationRule } from './nation.js';
import { BfMap, minimapWindow, rotateAbout, coverRect } from './bfmap.js';
import { createCanvasFit } from './map-canvas-fit.js';
import { createMapSprites } from './map-sprites.js';
import { createMapFriendlies } from './map-friendlies.js';
import { EMPTY_VEHICLE_TINT } from './map-vehicle-marks.js';

/**
 * Built once by the page, where this code used to sit. `page` hands in
 * what it reads of the rest of the page, as getters (a binding the page
 * reassigns is read live):
 * `activeDeployGroup`, `aircraft`, `applyDeployFrame`, `bust`, `camera`,
 * `captured`, `car`, `currentDir`, `deployActive`, `deployFlagIndices`,
 * `deployRejoin`, `deployTeamId`, `deployUnchosen`, `deployZ`,
 * `easeDeployClose`, `easeDeployOpen`, `extras`, `finishDeployClose`,
 * `flags`, `fullmapFrame`, `hudPack`, `LOCAL_PLAYER`, `MAPS_BASE`,
 * `mapVehicles`, `occupancy`, `release`, `scoreFromSpawn`, `setScoreboard`,
 * `spawnersRoot`, `spawnFlagSelect`, `sprite`, `stage`,
 * `vehicleSpawnActive`, `world`.
 */
export function createMapSurfaces(page) {
  const mapSurfaces = {};

  // ---------------------------------------------------------------------------
  // The map art. The HUD minimap and the fullscreen map are the same picture at
  // different sizes and zooms — that is what the engine does too: `menu/InGame`
  // hot-swaps one picture node built from a single `Textures/InGameMap.tga`
  // path, and there is no second map asset anywhere in the archives.
  //
  // The art frames the level's *active combat area*, not the world. `scene.json`
  // carries the projection as an affine so the viewer never re-derives it:
  //     u = m[0]*x + m[1]*z + m[2]
  //     v = m[3]*x + m[4]*z + m[5]
  // with (x, z) in glTF world metres and (u, v) in 0..1 from the top left.
  // ---------------------------------------------------------------------------
  const minimapBox = document.getElementById('minimap');
  const minimapCanvas = document.getElementById('minimap-canvas');
  const fullmapBox = document.getElementById('fullmap');
  const fullmapCanvas = document.getElementById('fullmap-canvas');
  const { cssWidthOf, fitCanvas } = createCanvasFit(minimapCanvas, fullmapCanvas);
  const fullmapName = document.getElementById('fullmap-name');
  const fullmapMeta = document.getElementById('fullmap-meta');

  // How much of the map the HUD window shows, and how it turns. The engine's
  // `BfMap` law (bfmap.js): three zoom levels stepped by `N`, the closed widget's
  // width covering 2.3^-(level+0.5) of the whole map — 0.659 / 0.287 / 0.125 —
  // centred on the player with no stop at the map's edge, and the displayed
  // rotation following the player's heading unless the map is static
  // (`game.setStaticMinimap 1`, the shipped default, north-up).
  const bfmap = new BfMap();
  // Sprite scale in CSS pixels, multiplied by the canvas's own backing ratio so
  // a flag is the same size on the 196 px HUD widget as on the fullscreen map
  // and stays put on a hidpi display.
  const MARKER_SCALE = 1.25;
  // Only for the moment before the sprite pack lands: a dot in the side's colour
  // so a level opened on a cold cache is not a bare grid.
  const TEAM_FILL = { 1: '#d2564b', 2: '#4f8fd0', 0: '#9a9a9a' };

  mapSurfaces.mapArt = null;          // HTMLImageElement once the PNG has decoded
  mapSurfaces.mapArtToken = 0;        // guards against a slow load landing after a switch

  /** The side's own colour on the map, measured off two retail captures.
   *
   *  The unit icons ship white on a black outline (`minimap_icon_soldier_16x16`
   *  is 14 white texels and 14 black ones) and the engine modulates them with
   *  the LOCAL player's side — not with friend-or-foe. Both readings paint an
   *  Allied player's teammates blue, which is why it took an Axis capture to
   *  tell them apart:
   *
   *  | capture | side | purest texel |
   *  |---|---|---|
   *  | 2026-09-22 21-01-16 (Bocage, HUD widget) | Allied | (75, 126, 252) |
   *  | 2026-09-23 10-11-40 (Bocage, spawn map) | Allied | (75, 126, 252) |
   *  | 2026-09-13 20-53-36 (desert, HUD widget) | Axis | (247, 52, 49) |
   *
   *  Two different maps and two different surfaces agree on the blue to the
   *  texel, so these are the modulate colours themselves and not a blend with
   *  the art beneath (bilinear filtering only ever pulls a texel TOWARD the
   *  background, never past the source). They are near — but not — (0.3, 0.5,
   *  1.0) and (0.97, 0.2, 0.19); the measured values are what is shipped
   *  because they are what was seen. */
  const MINIMAP_TEAM_TINT = { 1: [247, 52, 49], 2: [75, 126, 252] };

  const { drawSprite } = createMapSprites({
    get sprite() { return page.sprite; },
  });

  /** `heldNation`/`teamNation` proper live in `nation.js`, free of this file's
   *  `three` scene state so they can be tested under node
   *  (`tests/nation_harness.mjs`) and shared byte-for-byte with the rule
   *  `extract_menu_layout.py` runs when it writes `menu-levels.json`. These
   *  two feed them this page's own state: the mod's flag-mesh table and, for
   *  a side with no control point of its own, the vehicle-based guess. A
   *  point's sprite is the flag it flies now: its own mesh's nation for its
   *  founding owner, the taker's nation once it has changed hands. */
  function cpNation(cp) {
    return heldNation(cp, page.hudPack.nations, teamNation);
  }

  function teamNation(team) {
    return teamNationRule(page.extras.controlPoints || [], team, page.hudPack.nations,
                          nationFromVehicles(team));
  }


  function loadMapArt(dir) {
    mapSurfaces.mapArt = null;
    const token = ++mapSurfaces.mapArtToken;
    const rel = page.extras.minimap?.image;
    minimapBox.hidden = !page.extras.minimap;
    if (!rel) return;
    const img = new Image();
    img.onload = () => {
      if (token !== mapSurfaces.mapArtToken) return;
      mapSurfaces.mapArt = img;
      // The deploy screen may already be up over a half-decoded art: repaint
      // rather than wait for the 250 ms staleness gate.
      if (page.deployActive()) drawFullMap(true);
    };
    // A level with no art still gets markers on a blank grid, so a failed
    // decode is not worth surfacing.
    img.onerror = () => {};
    img.src = `${page.MAPS_BASE}/${dir}/${rel}${page.bust()}`;
  }

  function projectToArt(x, z) {
    const m = page.extras.minimap?.worldToImage;
    if (!m) return null;
    return { u: m[0] * x + m[1] * z + m[2], v: m[3] * x + m[4] * z + m[5] };
  }

  /** Grid reference under a world position, the way the art is lettered: A-H
   *  across, 1-8 down. The labels are painted into the image, so this only has
   *  to agree with them, not with any engine call. */
  function gridRef(x, z) {
    const p = projectToArt(x, z);
    if (!p || p.u < 0 || p.u > 1 || p.v < 0 || p.v > 1) return '—';
    const col = Math.min(7, Math.max(0, Math.floor(p.u * 8)));
    const row = Math.min(7, Math.max(0, Math.floor(p.v * 8)));
    return `${'ABCDEFGH'[col]}${row + 1}`;
  }

  /** Camera heading as a screen-space angle, 0 pointing up the image.
   *
   *  Taken from the camera's world direction rather than `look.yaw` so it stays
   *  correct in the pilot and vehicle camera modes, which drive the camera by
   *  quaternion and never touch `look`. The image's V axis grows with glTF +Z,
   *  so "up the image" is -Z. */
  const headingVec = new THREE.Vector3();
  function cameraHeading() {
    page.camera.getWorldDirection(headingVec);
    return Math.atan2(headingVec.x, -headingVec.z);
  }

  /** Open-map quad alpha from BfMap__update: (+0x4c)*0.8*(+0x54), with
   *  +0x54 = 1 - setMinimapTransparency/100 (default 20 → 0.80). Steady
   *  visible fade (+0x4c→1) gives 0.64. Ledger MEME-10 / gap-research-meme10. */
  const SPAWN_MAP_ALPHA = 0.8 * (1 - 20 / 100);

  /** The art, three ways. The spawn screen dims it to a silhouette on
   *  near-black; the HUD widget leaves the world showing through, the game's
   *  own `setMinimapTransparency` default; the plain M map draws it as is.
   *
   *  `size` is the backing width; the backing height comes off the canvas's
   *  own box (`fitCanvas` keeps the two). The HUD widget is not square — it is
   *  `MINIMAP_RECT` through the stage's own sx and sy, which differ on any
   *  window that is not 4:3 — so the window covers `span` of the art across
   *  the width and `span * height / width` down it: the art's own aspect is
   *  never stretched, and on a square surface this is exactly the old square
   *  mapping. */
  function drawArt(ctx, size, u0, v0, span, opts) {
    const h = ctx.canvas.height;
    ctx.clearRect(0, 0, size, h);
    ctx.fillStyle = opts.dim ? '#05070b'
      : opts.translucent ? 'rgba(13, 15, 16, .78)' : '#0d0f10';
    ctx.fillRect(0, 0, size, h);
    if (!mapSurfaces.mapArt) return;
    const vSpan = span * h / size;
    const v0c = v0 + (span - vSpan) / 2;   // the window stays centred on the player
    const sx = u0 * mapSurfaces.mapArt.width;
    const sy = v0c * mapSurfaces.mapArt.height;
    const sw = span * mapSurfaces.mapArt.width;
    const sh = vSpan * mapSurfaces.mapArt.height;
    ctx.globalAlpha = opts.dim ? SPAWN_MAP_ALPHA : opts.translucent ? 0.85 : 1;
    if (opts.rot || u0 < 0 || v0c < 0 || u0 + span > 1 || v0c + vSpan > 1) {
      // The HUD minimap: the window is centred on the player, so it can hang
      // over the art's edge, and the rotating mode turns it about the surface's
      // centre. The source is grown to cover the turned square's corners and cut
      // to the art; what lies past the art is the backdrop.
      const cover = coverRect(u0, v0c, span, size, opts.rot || 0);
      if (cover) {
        const mid = size / 2;
        ctx.save();
        ctx.translate(mid, mid);
        ctx.rotate(opts.rot || 0);
        ctx.translate(-mid, -mid);
        ctx.drawImage(mapSurfaces.mapArt,
          cover.src.u * mapSurfaces.mapArt.width, cover.src.v * mapSurfaces.mapArt.height,
          cover.src.w * mapSurfaces.mapArt.width, cover.src.h * mapSurfaces.mapArt.height,
          cover.dst.x, cover.dst.y, cover.dst.w, cover.dst.h);
        ctx.restore();
      }
    } else {
      ctx.drawImage(mapSurfaces.mapArt, sx, sy, sw, sh, 0, 0, size, h);
    }
    ctx.globalAlpha = 1;
  }

  /** A control point is its flag sprite: `conp_<nation>` for one that can
   *  change hands, the red-ringed `baseflag_conp_<nation>` for a main base,
   *  `conp_neutral` for one nobody holds. Kasserine's flagless capture zones
   *  get the same icon — the map marks the point, not the cloth. A flag mesh
   *  this pack has no art for (`cpNation` -> `'unknown'`, Pathet Lao's
   *  `flagpl_m1`) gets the same neutral plate rather than another nation's
   *  flag — the pack's own stand-in for a team it cannot draw. */
  function controlPointSprite(cp) {
    const raw = cp.team ? cpNation(cp) : null;
    const nation = raw && raw !== 'unknown' ? raw : null;
    return !nation ? 'conp_neutral'
      : cp.unableToChangeTeam ? `baseflag_conp_${nation}` : `conp_${nation}`;
  }
  function drawControlPoint(ctx, cp, px, py, sc) {
    const name = controlPointSprite(cp);
    if (drawSprite(ctx, name, px, py, sc)) return;
    ctx.fillStyle = TEAM_FILL[cp.team] || TEAM_FILL[0];
    ctx.beginPath();
    ctx.arc(px, py, 4 * sc, 0, Math.PI * 2);
    ctx.fill();
  }

  /** The vehicles, by template: every `spawners` child in the scene carries its
   *  template name, and `minimap-icons.json` says which silhouette that template
   *  declared. A template with no icon of its own is a vehicle dot, the way the
   *  HUD marks anything it has no picture for.
   *
   *  Which hulls are drawn is the client's rule (`mapVehicleMarks`,
   *  `map-vehicle-marks.js`): never a wreck, never one the other side is
   *  crewing. A hull a teammate is sitting in is drawn in the side's own
   *  colour, which is the whole of how retail marks a crewed vehicle — there
   *  is no second mark for the men inside it (`friendlyMapUnits` skips them
   *  for exactly this reason). An empty one is the client's grey.
   *
   *  The list is `mapVehicles`, not the live `spawners` group, which a driven
   *  hull has left. The local player's own hull is skipped: the ring is his
   *  mark, in a vehicle as on foot. */
  const vehiclePos = new THREE.Vector3();
  const vehicleQuat = new THREE.Quaternion();
  const vehicleFwd = new THREE.Vector3();
  function drawVehicles(ctx, toPx, sc, rot = 0) {
    const tint = MINIMAP_TEAM_TINT[localMapTeam()] || MINIMAP_TEAM_TINT[2];
    for (const { node: vehicle, kind } of mapVehicleMarks()) {
      vehicle.getWorldPosition(vehiclePos);
      const p = projectToArt(vehiclePos.x, vehiclePos.z);
      if (!p) continue;
      const q = toPx(p);
      // By template, not node name: GLTFLoader renames the second Kubelwagen
      // `Kubelwagen_1`, and a name lookup gave every one after the first the
      // plain vehicle dot.
      const template = (vehicle.userData?.control || vehicle.name).toLowerCase();
      const entry = page.hudPack.icons[template] ?? page.hudPack.icons[vehicle.name.toLowerCase()];
      const icon = entry?.icon && !entry.icon.startsWith('flag_') ? entry.icon : null;
      // The silhouettes point up the sprite and the game turns them with the
      // vehicle; same forward axis and the same screen angle as the player.
      vehicle.getWorldQuaternion(vehicleQuat);
      vehicleFwd.set(0, 0, -1).applyQuaternion(vehicleQuat);
      // `rot` is the map's own turn (the rotating minimap): a heading drawn on a
      // turned map turns with it.
      const angle = Math.atan2(vehicleFwd.x, -vehicleFwd.z) + rot;
      const colour = kind === 'friendly' ? tint : EMPTY_VEHICLE_TINT;
      if (!icon || !drawSprite(ctx, icon, q.x, q.y, sc,
                               { angle, alpha: 0.9, tint: colour })) {
        drawSprite(ctx, 'icon_vehicledot_empty', q.x, q.y, sc,
                   { tint: colour });
      }
    }
  }

  /** The vehicles a side fields, for the levels where its flags say nothing:
   *  Wake's Japanese hold no control point at the start and arrive by sea, so
   *  their nation is read off the carrier and the Zeros instead. Only the
   *  templates that belong to one nation alone are listed. */
  const NATION_VEHICLES = {
    jp: ['zero', 'aichival', 'chi-ha', 'ho-ha', 'type38', 'hatsuzuki', 'yamato', 'shokaku'],
    rus: ['t34', 'katyusha', 'ilyushin', 'yak9'],
    brit: ['spitfire', 'sexton', 'blackmedal', 'princeow'],
  };
  function nationFromVehicles(team) {
    if (!page.spawnersRoot) return null;
    const names = new Set(page.spawnersRoot.children.map(v => v.name.toLowerCase()));
    const has = nation => NATION_VEHICLES[nation].some(stem =>
      [...names].some(name => name === stem || name.startsWith(`${stem}_`)));
    if (team === 1) return has('jp') ? 'jp' : null;
    return has('rus') ? 'rus' : has('brit') ? 'brit' : null;
  }

  function drawPlayer(ctx, px, py, sc, rot = 0) {
    // On the rotating minimap `rot` is minus the heading, so the arrow reads
    // straight up and the world turns under it.
    if (drawSprite(ctx, 'minimap_icon_ring_32x32', px, py, sc * 0.8,
                   { angle: cameraHeading() + rot })) return;
    ctx.fillStyle = '#76d65c';
    ctx.beginPath();
    ctx.arc(px, py, 4 * sc, 0, Math.PI * 2);
    ctx.fill();
  }

  const {
    localMapTeam, friendlyMapUnits, friendlyVehicleNodes, mapVehicleMarks, friendlyMarkerKey,
  } = createMapFriendlies({
    get deployTeamId() { return page.deployTeamId; },
    get LOCAL_PLAYER() { return page.LOCAL_PLAYER; },
    get mapVehicles() { return page.mapVehicles; }, get world() { return page.world; },
    get occupancy() { return page.occupancy; },
    vehicleSpawnActive: node => page.vehicleSpawnActive(node),
  });

  /** `rot` is the map's own turn, as everywhere else here: an arrow drawn on a
   *  turned map turns with it. */
  function drawFriendlies(ctx, toPx, sc, rot = 0) {
    const tint = MINIMAP_TEAM_TINT[localMapTeam()] || MINIMAP_TEAM_TINT[2];
    for (const { x, z, yaw } of friendlyMapUnits()) {
      const p = projectToArt(x, z);
      if (!p) continue;
      const q = toPx(p);
      // `soldier.yaw` turns a forward of (sin yaw, 0, cos yaw) (soldier.js
      // `lookVector`); the surface's screen angle is the same `atan2(x, -z)`
      // the camera and the vehicles go through, so the three agree by
      // construction rather than by a remembered offset.
      const angle = Math.atan2(Math.sin(yaw), -Math.cos(yaw)) + rot;
      if (drawSprite(ctx, 'minimap_icon_soldier_16x16', q.x, q.y, sc,
                     { angle, tint })) continue;
      // The pack may not have delivered the sprite yet (or a mod repaints the
      // HUD without it): the side's own map colour stands in.
      ctx.fillStyle = `rgb(${tint.join(',')})`;
      ctx.beginPath();
      ctx.arc(q.x, q.y, 3 * sc, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  /** The spawn screen's targets: one `map_circle` per flag the chosen side can
   *  spawn at, never one per spawn entry. The chosen one is drawn larger and
   *  solid; the rest sit back. `flagMapSpots` is imported from
   *  `deploy-spots.js`, which pins its land-vs-ship contract under node. */

  function drawSpawnRings(ctx, toPx, sc) {
    // -1 while nothing is chosen: every ring sits back and none is filled,
    // which is what tells the player he is about to free-roam rather than
    // spawn (`deployUnchosen`).
    const chosen = page.deployUnchosen ? -1
      : Math.min(Number(page.spawnFlagSelect.value) || 0, page.flags.length - 1);
    for (const index of page.deployFlagIndices()) {
      const flag = page.flags[index];
      for (const spot of flagMapSpots(flag)) {
        if (!spot.position) continue;
        const p = projectToArt(spot.position[0], spot.position[2]);
        if (!p) continue;
        const q = toPx(p);
        const active = index === chosen
          && (spot.group == null || spot.group === page.activeDeployGroup(flag));
        if (!drawSprite(ctx, 'map_circle', q.x, q.y, sc * (active ? 1.4 : 1.05),
                        { alpha: active ? 1 : 0.7 })) {
          ctx.strokeStyle = active ? '#ffffff' : 'rgba(255,255,255,.6)';
          ctx.lineWidth = Math.max(1, sc);
          ctx.beginPath();
          ctx.arc(q.x, q.y, 8 * sc, 0, Math.PI * 2);
          ctx.stroke();
        }
        if (active) drawSprite(ctx, 'map_dot', q.x, q.y, sc * 0.7);
      }
    }
  }

  /** One map surface. `span` is the fraction of the art shown, `u0`/`v0` its
   *  top-left corner — the fullscreen map passes the whole image, the HUD a
   *  window centred on the camera. Vehicles under flags under spawn rings
   *  under the player, and nothing else: the game prints no names, no capture
   *  radii and no combat-area box on any of its map surfaces.
   *
   *  The HUD widget's box is wider than tall (the measured retail frame
   *  ratio), while the fullscreen map stays square. `size` below is the
   *  backing WIDTH; `paintMap` derives the backing height from the canvas's
   *  own box (`canvas.width / canvas.height`), so the close-cropped art and
   *  every marker land on the same rectangle the chrome frames. */
  function paintMap(canvas, u0, v0, span, opts) {
    const ctx = canvas.getContext('2d');
    const ratio = fitCanvas(canvas);
    const size = canvas.width;
    const h = canvas.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    drawArt(ctx, size, u0, v0, span, opts);
    if (!page.extras.minimap?.worldToImage) return ratio;

    // Every marker POSITION turns with the art about the surface's centre; the
    // flag plates themselves stay upright (a viewer choice — what the engine
    // does to a flag icon on a turned map was not read), and only the icons that
    // show a heading add the turn to their own angle.
    //
    // The HUD widget's box is not square (`MINIMAP_RECT` through the stage's
    // sx and sy) while the fullscreen map stays square. Markers scale with the backing
    // width on x and the backing height on y about the surface's own centre,
    // so neither the art's window nor a marker stretches; on the square
    // surfaces the two scales coincide and this is exactly the old mapping.
    const rot = opts.rot || 0;
    const midX = size / 2, midY = h / 2;
    const toPx = p => rotateAbout(((p.u - u0) / span) * size,
                                  ((p.v - v0) / span) * h, midX, rot, midY);
    const sc = MARKER_SCALE * ratio * (opts.scale || 1);
    ctx.imageSmoothingEnabled = false;

    drawVehicles(ctx, toPx, sc, rot);
    for (const cp of page.extras.controlPoints || []) {
      const p = projectToArt(cp.position[0], cp.position[2]);
      if (!p) continue;
      const q = toPx(p);
      drawControlPoint(ctx, cp, q.x, q.y, sc);
    }
    if (opts.spawnRings) drawSpawnRings(ctx, toPx, sc);

    // Friendly arrows under the local one: teammates are map furniture in every
    // mode (deploy map included), so they draw whenever the map does.
    drawFriendlies(ctx, toPx, sc, rot);

    if (opts.player !== false) {
      const here = projectToArt(page.camera.position.x, page.camera.position.z);
      if (here) {
        const q = toPx(here);
        drawPlayer(ctx, q.x, q.y, sc, rot);
      }
    }
    ctx.imageSmoothingEnabled = true;
    return ratio;
  }

  /** The HUD widget's chrome, all of it in the canvas: the `icon_mapbar_small`
   *  bezel as the nine-patch it is (a four-pixel frame round a transparent
   *  middle), the grid readout in the lower-left corner, and the flag-status
   *  strip along the bottom edge — one `cpbar` segment per control point in
   *  its holder's colour.
   *
   *  The strip is retail's own bottom edge: below the frame the capture has a
   *  second, shorter plate of its own (y ~207.4..216.9). This widget keeps the
   *  strip inside the frame rather than painting that second plate — one
   *  surface, one bezel — so it rides the frame's bottom edge. */
  /** The minimap frame in the HUD's own 800x600 virtual space, measured off
   *  the retail captures (`MINIMAP_RECT` below is the whole story):
   *
   *  | edge | virtual | how |
   *  |---|---|---|
   *  | left | 620 | flush with the ticket plate's left edge |
   *  | right | 795.4 | flush with the ticket plate's painted right edge |
   *  | top | 30.0 | 2 units of sky below the plate's bottom (28) |
   *  | bottom | 204.9 | last row of the frame's bezel |
   *
   *  So the frame is a 175.4 x 174.9 square of virtual units — square in the
   *  layout, not on screen, because the HUD stretches by stageW/800 across
   *  and stageH/600 down and those differ on any window that is not 4:3. */
  const MINIMAP_RECT = { x: 620, y: 30, w: 175.4, h: 174.9 };
  function drawMinimapChrome(ctx, size, ratio) {
    const h = ctx.canvas.height;
    const bezel = page.sprite('icon_mapbar_small');
    const edge = 4;
    const d = Math.round(edge * ratio * 1.5);
    if (bezel) {
      const w = bezel.width, bh = bezel.height;
      const cut = (sx, sy, sw, sh, dx, dy, dw, dh) =>
        ctx.drawImage(bezel, sx, sy, sw, sh, dx, dy, dw, dh);
      cut(0, 0, edge, edge, 0, 0, d, d);
      cut(w - edge, 0, edge, edge, size - d, 0, d, d);
      cut(0, bh - edge, edge, edge, 0, h - d, d, d);
      cut(w - edge, bh - edge, edge, edge, size - d, h - d, d, d);
      cut(edge, 0, w - 2 * edge, edge, d, 0, size - 2 * d, d);
      cut(edge, bh - edge, w - 2 * edge, edge, d, h - d, size - 2 * d, d);
      cut(0, edge, edge, bh - 2 * edge, 0, d, d, h - 2 * d);
      cut(w - edge, edge, edge, bh - 2 * edge, size - d, d, d, h - 2 * d);
    }

    const cps = page.extras.controlPoints || [];
    const segW = Math.round(12 * ratio), segH = Math.round(6 * ratio);
    const gap = Math.round(2 * ratio);
    let x = d + gap;
    const y = h - d - segH - gap;
    for (const cp of cps) {
      if (x + segW > size - d) break;
      const name = cp.team === 1 ? 'cpbar_red_cp_16x8'
        : cp.team === 2 ? 'cpbar_blue_cp_16x8' : 'cpbar_gray_cp_16x8';
      const seg = page.sprite(name);
      if (seg) ctx.drawImage(seg, x, y, segW, segH);
      else {
        ctx.fillStyle = TEAM_FILL[cp.team] || TEAM_FILL[0];
        ctx.fillRect(x, y, segW, segH);
      }
      x += segW + gap;
    }

    const text = gridRef(page.camera.position.x, page.camera.position.z);
    ctx.font = `bold ${Math.round(13 * ratio)}px 'Arial Narrow', 'Liberation Sans Narrow', Arial, sans-serif`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    const tx = d + Math.round(6 * ratio);
    const ty = y - Math.round(5 * ratio);
    ctx.fillStyle = 'rgba(0,0,0,.85)';
    ctx.fillText(text, tx + ratio, ty + ratio);
    ctx.fillStyle = '#f4f4f0';
    ctx.fillText(text, tx, ty);
  }

  // What each map surface last painted, so a frame in which nothing it shows
  // has moved paints nothing: the art plus every sprite, at DPR 2, was a 2D
  // canvas repaint and a texture upload to the compositor every frame whether
  // the soldier stood still or not (features/mesh-viewer-performance, rule
  // 7). The key is what the surface draws — the player's art position to the
  // backing pixel, the heading to a hundredth of a radian (under a pixel of
  // arrow at this size), the canvas size, the art and sprites having landed,
  // the flown vehicle's position for a camera planted away from it in fly-by
  // — and a 250 ms ceiling catches what has no key, a captured flag's colour.
  const mapSurfaceLast = new Map();   // canvas -> { key, at }
  // Off only through `__mapGate(false)` under ?shots: the bench that puts a
  // number on what the gate saves sets it against the every-frame repaint it
  // replaced, on the same page.
  mapSurfaces.mapGate = true;
  mapSurfaces.setMapGate = on => { mapSurfaces.mapGate = !!on; };
  function mapSurfaceStale(canvas, key, force) {
    const last = mapSurfaceLast.get(canvas);
    const now = performance.now();
    if (mapSurfaces.mapGate && !force && last && last.key === key && now - last.at < 250) return false;
    mapSurfaceLast.set(canvas, { key, at: now });
    return true;
  }
  function mapSurfaceKey(canvas, here, span) {
    const size = Math.round((cssWidthOf(canvas) || 0) * Math.min(window.devicePixelRatio || 1, 2));
    const px = size / span;   // backing pixels per unit of art
    const vehicle = (page.aircraft || page.car)?.state.position;
    return `${Math.round(here.u * px)},${Math.round(here.v * px)},`
      + `${Math.round(cameraHeading() * 100)},${size},${mapSurfaces.mapArt ? mapSurfaces.mapArtToken : -1},`
      + `${page.hudPack.sprites.size},${vehicle ? `${Math.round(vehicle.x)},${Math.round(vehicle.z)}` : ''}`;
  }

  /** The widget IS `MINIMAP_RECT` put through the HUD's own virtual-to-stage
   *  scale, so it lands on the pixels the layout would have painted it on: as
   *  wide as the ticket plate above it, right edge under the plate's right
   *  edge, and no taller than the layout says.
   *
   *  The plate is HUD-canvas paint, not DOM, so there is nothing to measure —
   *  `Hud._scaleFor` is sx = stageW/800, sy = stageH/600, and the rect goes
   *  through those. That is the whole sum. The earlier version took the
   *  plate's LEAF rect (620,4,256,32) for its width, but `icon_ticketbar` is
   *  a 256x32 texture whose ink stops at x=176: the last 80 columns are
   *  transparent padding, and the bar a player sees is 176 wide, not 256. The
   *  widget came out ~1.45x too wide for it.
   *
   *  Re-derived when the stage or the level changes (the `--mm-size` write
   *  resizes the box, which the ResizeObserver reports back into
   *  `fitCanvas`'s backing store).
   *
   *  Mobile is the one place the layout's own answer is not the answer. A
   *  phone holds the stage in PORTRAIT, which retail never did: sy there is
   *  two and a half times sx, so `MINIMAP_RECT` put through them honestly
   *  gives an 82x215 splinter down the side of the screen. So below 720 px of
   *  stage the widget keeps its own 175.4:174.9 shape, capped at 118 px so it
   *  cannot cover the bar, and the stylesheet's `@media` rule keeps the
   *  corner. */
  mapSurfaces.minimapSyncKey = '';
  function syncMinimapToTickets() {
    const canvas = minimapCanvas;
    const stageW = page.stage.clientWidth || 0;
    const stageH = page.stage.clientHeight || 0;
    if (!stageW || !stageH) return;
    const key = `${stageW}x${stageH}:${page.currentDir}:${!!page.extras.tickets}`;
    const small = stageW <= 720;
    if (key === mapSurfaces.minimapSyncKey && canvas.dataset.syncSmall === String(small)) return;
    // No renderer backing math here — those pixels are WebGL's, not the
    // stage's.
    const sx = stageW / 800;
    const sy = stageH / 600;
    const want = small
      ? Math.min(118, Math.round(MINIMAP_RECT.w * sx))
      : Math.max(120, Math.round(MINIMAP_RECT.w * sx));
    const cur = parseFloat(getComputedStyle(minimapBox).width) || 0;
    if (Math.abs(cur - want) >= 1) {
      minimapBox.style.setProperty('--mm-size', `${want}px`);
    }
    // Down the stage is sy, not sx: the frame is square in virtual units and
    // the HUD stretches the two axes independently, so deriving the height
    // from the width would keep it square on screen and retail does not.
    // Portrait is the exception above.
    const wantH = small
      ? Math.round(want * (MINIMAP_RECT.h / MINIMAP_RECT.w))
      : Math.round(MINIMAP_RECT.h * sy);
    if (canvas.style.height !== `${wantH}px`) canvas.style.height = `${wantH}px`;
    // The corner the layout puts it in, in the same units. Mobile keeps the
    // stylesheet's.
    const top = small ? '' : `${Math.round(MINIMAP_RECT.y * sy)}px`;
    const right = small ? '' : `${Math.round((800 - MINIMAP_RECT.x - MINIMAP_RECT.w) * sx)}px`;
    if (minimapBox.style.top !== top) minimapBox.style.top = top;
    if (minimapBox.style.right !== right) minimapBox.style.right = right;
    canvas.dataset.syncSmall = String(small);
    mapSurfaces.minimapSyncKey = key;
  }

  function drawMinimap() {
    if (minimapBox.hidden) return;
    syncMinimapToTickets();
    const here = projectToArt(page.camera.position.x, page.camera.position.z);
    if (!here) return;
    // The live span: `N` steps the level and `bfmap.update` eases toward it, so
    // the span is part of what the surface shows and part of its key.
    const span = bfmap.span();
    const key = `${mapSurfaceKey(minimapCanvas, here, span)},`
      + `${Math.round(span * 1e5)},${bfmap.isStatic ? 1 : 0},`
      + friendlyMarkerKey();
    if (!mapSurfaceStale(minimapCanvas, key)) return;
    // North-up with a rotating arrow by default. That is the game's own shipped
    // default — every stock profile sets `game.setStaticMinimap 1` — and it
    // keeps the baked-in grid letters upright. `game.setStaticMinimap 0` turns
    // the map under a fixed arrow instead: this widget is the closed map, z = 0,
    // so the turn is the whole heading (the heading is already in the key).
    const { u0, v0 } = minimapWindow(here, span);
    const rot = bfmap.rotation(0, cameraHeading());
    const ratio = paintMap(minimapCanvas, u0, v0, span, { translucent: true, rot });
    drawMinimapChrome(minimapCanvas.getContext('2d'), minimapCanvas.width, ratio);
  }

  /** `force` repaints regardless: the deploy screen's layout and the M key
   *  open the surface at a size or in a state the key has not seen. */
  function drawFullMap(force = false) {
    if (fullmapBox.hidden) return;
    const here = projectToArt(page.camera.position.x, page.camera.position.z) || { u: 0, v: 0 };
    const key = `${mapSurfaceKey(fullmapCanvas, here, 1)},${page.deployActive()},${page.deployRejoin},`
      + `${page.deployTeamId},${page.deployUnchosen ? '-' : page.spawnFlagSelect.value},${page.flags.length},`
      + friendlyMarkerKey();
    if (!mapSurfaceStale(fullmapCanvas, key, force)) return;
    // Bigger sprites than the HUD widget: this surface is several times the
    // size. In the deploy state the art dims to the spawn screen's silhouette
    // and the rings come out; a dead man has no marker, so the player shows
    // only when a life waits behind the screen.
    const deploy = page.deployActive();
    // Sprites grow with the surface, not with the window: the game's spawn map
    // shows a 16 px flag at about a fifth of a grid square, and so does this
    // one whatever the canvas's CSS size came out as.
    const css = cssWidthOf(fullmapCanvas) || 610;
    paintMap(fullmapCanvas, 0, 0, 1, {
      scale: Math.min(2, Math.max(0.8, css / 610)),
      dim: deploy,
      spawnRings: deploy,
      player: !deploy || page.deployRejoin,
    });
  }

  function toggleFullMap(on) {
    const want = on ?? fullmapBox.hidden;
    // Deploy state: the game's own open/close — BfMap__animate easing the map
    // between the minimap corner and the spawn-map rect (block below). The
    // .deploy class stays on through the whole close so the keys and buttons
    // keep working until the pane is actually gone.
    if (want && fullmapBox.classList.contains('deploy')) {
      page.easeDeployOpen(fullmapBox.hidden);
      fullmapBox.hidden = false;
      page.applyDeployFrame();
      // Holding the map is not flying. Releasing the pointer lock also stops the
      // movement keys running under the overlay.
      if (page.captured) page.release();
      drawFullMap(true);
      return;
    }
    if (!want && page.deployActive()) {
      page.easeDeployClose();
      if (page.deployZ === 0) page.finishDeployClose();  // a close requested before the first ease tick
      else page.applyDeployFrame();
      return;
    }
    fullmapBox.hidden = !want;
    // Closing strips the deploy chrome with it, so a level switch or a plain
    // Escape can never leave the screen armed behind a hidden overlay.
    if (!want) {
      if (page.scoreFromSpawn) page.setScoreboard(false);
      fullmapBox.classList.remove('deploy');
      page.fullmapFrame.removeAttribute('style');
    }
    // Holding the map is not flying. Releasing the pointer lock also stops the
    // movement keys running under the overlay.
    if (want && page.captured) page.release();
    if (want) drawFullMap(true);
  }
  fullmapBox.addEventListener('click', () => {
    // The plain map closes on any click; the deploy state does not — its
    // backdrop is not a button, and the exits are the footer, Escape and M.
    if (page.deployActive()) return;
    toggleFullMap(false);
  });

  Object.assign(mapSurfaces, {
    MINIMAP_TEAM_TINT,
    bfmap,
    cameraHeading,
    drawFullMap,
    drawMinimap,
    friendlyMapUnits,
    friendlyVehicleNodes,
    mapVehicleMarks,
    fullmapBox,
    fullmapCanvas,
    fullmapMeta,
    fullmapName,
    gridRef,
    loadMapArt,
    localMapTeam,
    projectToArt,
    teamNation,
    /** Every control point's sprite as the surfaces draw it, for the hooks. */
    controlPointSprites: () => (page.extras.controlPoints || [])
      .map(cp => ({ name: cp.name, team: cp.team, sprite: controlPointSprite(cp) })),
    toggleFullMap,
  });
  return mapSurfaces;
}
