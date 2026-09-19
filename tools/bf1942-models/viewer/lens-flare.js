/* The sun's lens flare and corona.
 *
 * Every vanilla `Init/SkyAndSun.con` opens with a `LensFlare` template —
 * `ObjectTemplate.create LensFlare TSun`, five flares and two coronas —
 * declared through about sixteen `setFlare*` / `setCorona*` verbs. Nothing
 * parsed them until this round. `bf42/level.py` now does, and
 * `extract_map.py` writes the result as `scene.json.lensFlare`, resolving the
 * template through `Sky.setSun <object>` and writing each sprite's texture
 * where the archives have it.
 *
 * THE ART IS MISSING FROM VANILLA. This is the first thing to know about this
 * feature, and it was verified rather than assumed: every one of the 1,775
 * `.rfa` archives in this installation was searched by texture stem, and
 * `ring3`, `ring4`, `ring5`, `sunflare7` and `sunflare9` — the only five
 * textures the 21 vanilla flare declarations name — exist in exactly two
 * places, neither of them vanilla:
 *
 *   Mods/bfheroes/Archives/Texture.rfa          Texture/ring3.tga, ring4.tga,
 *                                               ring5.tga, sunflare7.tga,
 *                                               sunflare9.tga
 *   Mods/bf1918/Archives/bf1942/levels/         .../Texture/ring3.dds,
 *     montblainville.rfa                        ring4.dds, ring5.dds,
 *                                               sunflare7.dds, sunflare9.dds
 *
 * Substring searches for `sunflare` and `/ring` over `Mods/bf1942`,
 * `Mods/XPack1` and `Mods/XPack2` return nothing at all; the only
 * flare-related entry in vanilla is the vertex shader
 * `Archives/shaders.rfa :: shaders/FlareShader.vso`. So a vanilla level's
 * declaration names five textures the engine's own TextureManager cannot
 * resolve either, and this module draws nothing there — which is why the
 * retail game shows no ring ghosts on Wake. A mod level that ships its own
 * flare art draws through the same path with no special casing.
 *
 * THE PLACEMENT IS INFERRED, NOT DECOMPILED. Marked so in so many words. What
 * supports it:
 *   - `setFlareScale` on vanilla's five sun flares is -1.5, 1, 1.5, -2, -2.
 *     Read as the classic ghost multiplier along the sun-to-screen-centre
 *     axis, `screen = centre + (sun - centre) * scale`, that is a textbook
 *     lens-flare layout: one ghost on the sun, one just past it, three
 *     mirrored across the centre.
 *   - The level authors' own REM labels say the same thing:
 *     `*** Falre no:2 > LittleDot***` (scale 1, size 0.5, the small bright
 *     dot on the sun), `*** Falre no:4 :Twins***` and `no:5 :Twins` (both
 *     scale -2, the mirrored pair), `*** Corona no:1 - Red aura***`.
 *   - A corona is by definition drawn at the light itself, so `setCoronaScale`
 *     is NOT a position for coronas; vanilla's are 1 and 5 against sizes 2 and
 *     5, which a position reading would put off screen. Treated as unread and
 *     unused rather than invented into a second meaning.
 * What was not read: the renderer's own flare pass. `FUN_00570ea0` is the only
 * referrer of the `Shaders/FlareShader` string and is a constructor for a
 * different, shader-based sun object; the `setFlare*` registrars were not
 * traced to a draw. Anyone re-deriving this should start there.
 *
 * Free of `three` and of the DOM on purpose: it is the placement arithmetic
 * plus a sprite list, so `tests/lens_flare_harness.mjs` runs it under node.
 */

/** Blend words from the con, as the engine's D3DBLEND enum names them. Only
 *  `BMOne` on the destination matters here: every vanilla flare and corona
 *  uses `BMSourceAlpha`/`BMOne`, which is additive. */
export function isAdditive(element) {
  return String(element && element.destBlend || '').toLowerCase() === 'bmone';
}

/**
 * Where each sprite goes, in canvas pixels, for one frame.
 *
 * @param {object} data    `scene.json.lensFlare`
 * @param {object} view    { sunX, sunY, width, height, visible, occlusion,
 *                           sunDistance, textureSize }
 *                         sunX/sunY are the sun's projected position in canvas
 *                         pixels; `visible` is false when the sun is behind
 *                         the camera; `occlusion` is 0..1, how much of the sun
 *                         is unblocked (the caller's own test); `textureSize`
 *                         answers a loaded sprite's natural pixel size and 0
 *                         for one that has not decoded yet.
 * @returns {Array} sprites in draw order, coronas first (they sit at the sun
 *                  and everything else ghosts over them), each
 *                  `{file, x, y, size, color, rot, additive}` with `size` in
 *                  pixels and `color` a 0..1 RGBA. Empty when nothing can be
 *                  drawn: no data, the sun off screen or behind, or no sprite
 *                  whose texture actually resolved.
 */
export function flareSprites(data, view) {
  if (!data || !view || !view.visible) return [];
  const { width, height } = view;
  if (!(width > 0) || !(height > 0)) return [];
  const cx = width / 2;
  const cy = height / 2;
  const occlusion = Number.isFinite(view.occlusion) ? clamp01(view.occlusion) : 1;
  if (occlusion <= 0) return [];

  // The engine's own global fades, applied to every sprite on their side.
  // `setflarefadeall 0.1` / `setcoronafadeall 0.3` in vanilla — how they are
  // combined with the per-sprite alpha was not read, so they multiply, which
  // is the reading that cannot brighten anything.
  const flareFade = finiteOr(data.flareFadeAll, 1);
  const coronaFade = finiteOr(data.coronaFadeAll, 1);

  // `setFlareSize` multiplies the sprite's OWN texture size. Vanilla's values
  // only make sense that way: `ring3.tga` is 16x16 and its flare is size 0.5,
  // which the level author labelled `*** Falre no:2 > LittleDot***` — 8 px, a
  // little dot. `ring5.tga` is 32x32 at size 3 (96 px), `sunflare7.tga` is
  // 128x128 at size 2 (256 px) and `sunflare9.tga` 128x128 at size 5, the
  // `- Red aura***` wash. Read instead as a fraction of the viewport, that
  // last one would be five screens across. (Sizes measured from the only
  // copies of these files anywhere in the install, bfheroes' uncompressed
  // TGAs: 1068, 4140 and 65580 bytes are 16x16, 32x32 and 128x128 RGBA plus a
  // 44-byte header.) INFERRED.
  //
  // Then scaled out of the engine's own 800x600 virtual screen into the real
  // viewport, the same way every other 800x600-authored surface in this
  // viewer is (`hud.js`, the deploy screen). Without it a flare authored for
  // 600 lines would sit at a quarter size on a 2160-line display. Also
  // INFERRED: nothing was read about how the engine sized these at other
  // resolutions.
  const unit = height / 600;
  const texture = typeof view.textureSize === 'function' ? view.textureSize : () => 0;

  const out = [];
  for (const corona of data.coronas || []) {
    const sprite = place(corona, cx, cy, view.sunX, view.sunY, 1, unit, texture,
                         coronaFade * occlusion);
    if (sprite) out.push(sprite);
  }
  for (const flare of data.flares || []) {
    const scale = finiteOr(flare.scale, 1);
    const sprite = place(flare, cx, cy, view.sunX, view.sunY, scale, unit, texture,
                         flareFade * occlusion * distFade(flare, view));
    if (sprite) out.push(sprite);
  }
  return out;
}

function place(element, cx, cy, sunX, sunY, scale, unit, texture, alpha) {
  // A sprite whose texture the extractor could not find draws nothing. The
  // engine's TextureManager fails the same way on the same five names.
  if (!element || !element.file) return null;
  const natural = texture(element.file);
  if (!(natural > 0)) return null;   // the image has not decoded yet
  const size = finiteOr(element.size, 0) * natural * unit;
  if (!(size > 0) || !(alpha > 0)) return null;
  const color = Array.isArray(element.color) ? element.color : [1, 1, 1, 1];
  const a = clamp01((color[3] === undefined ? 1 : color[3]) * alpha);
  if (a <= 0) return null;
  return {
    file: element.file,
    x: cx + (sunX - cx) * scale,
    y: cy + (sunY - cy) * scale,
    size,
    color: [color[0] ?? 1, color[1] ?? 1, color[2] ?? 1, a],
    // `setFlareRot` is 0 on every vanilla sprite but one (flare 4, rot 1), so
    // its unit is unconstrained by the data. Passed through as turns, the
    // reading under which the one non-zero value is a full revolution and
    // therefore indistinguishable from 0 — i.e. the reading that changes
    // nothing anyone has seen. UNVERIFIED.
    rot: finiteOr(element.rot, 0) * Math.PI * 2,
    additive: isAdditive(element),
  };
}

/** `setFlareDistFadeScale` scales how fast a flare fades with distance from
 *  the screen centre — 1 and 0.5 in vanilla. With the sun's own distance in
 *  `view.sunDistance` (0 at centre, 1 at the edge) this dims the ghosts as
 *  the sun moves off axis, which is what a flare does. INFERRED. */
function distFade(element, view) {
  const scale = element.distFadeScale;
  if (!Number.isFinite(scale) || !Number.isFinite(view.sunDistance)) return 1;
  return clamp01(1 - clamp01(view.sunDistance) * scale);
}

function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
function finiteOr(v, fallback) { return Number.isFinite(v) ? v : fallback; }

/** Every distinct texture file the data references, for preloading. */
export function flareTextureFiles(data) {
  if (!data) return [];
  const files = new Set();
  for (const e of [...(data.flares || []), ...(data.coronas || [])]) {
    if (e && e.file) files.add(e.file);
  }
  return [...files];
}

/** True when this level's declaration has at least one drawable sprite. A
 *  level whose every texture is missing (all 21 vanilla ones) answers false,
 *  and the caller can skip the whole pass. */
export function hasDrawableFlare(data) {
  return flareTextureFiles(data).length > 0;
}
