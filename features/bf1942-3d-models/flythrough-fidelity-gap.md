# Flythrough fidelity gap: fog, draw distance, sky, water

Investigation and fix pass for the reported gaps between the map flythrough
(`tools/bf1942-models/viewer/map.html`) and the real game, driven by two
in-game/flythrough comparison pairs (Tobruk facing the bunker line; Wake from
the airfield defgun into the bay — both flythrough shots with the default
`fog` checkbox ON and `render entire map` OFF). Ground truth was read out of
the shipped level archives
(`~/.wine/drive_c/EA Games/Battlefield 1942/Mods/bf1942/Archives/`),
cross-checked across all 23 vanilla levels and the installed mods, and every
conclusion below was verified against live renders of the viewer (`?shots`
debug handles, pixel sampling). Production (`mesh.bfstats.io`) served a
`map.html` byte-identical to HEAD and the same scene.json, so none of this was
a stale deploy.

**The one-line summary:** the extractor keyed fog and draw distance off the
wrong console directives — inventing a 200→700 m fog on the 18 of 23 vanilla
maps that declare no explicit range, and giving every map a 700 m draw
distance the engine never uses — and it invented a cloud layer no vanilla map
renders. The viewer then inflated the far plane 1.6x past even that, which is
what made *correct* fog on Tobruk still look wrong. All of these are now
fixed; details and evidence per symptom below, implementation at the end.

## Ground truth: what the level data actually says

Tobruk `Init.con`:

```con
renderer.vertexFogEnable 1
renderer.fogColorVec 0.8/0.718/0.531
renderer.fogLinearStart 150
renderer.fogLinearEnd 300
renderer.setViewdistance 700     rem <- only vanilla level with this line
Game.setViewDistance 300         rem <- every vanilla level has this line
```

Survey of all 23 vanilla levels (reproducible with `bf42.rfa.RfaArchive` over
`bf1942/levels/*.rfa`, patch rfas excluded):

| fact | count |
|---|---|
| declare `Game.setViewDistance` (90–800 m) | **23 / 23** |
| declare `renderer.vertexFogEnable 1` | 23 / 23 |
| declare `renderer.fogColorVec` | 23 / 23 |
| declare `renderer.fogLinearStart/End` | **5 / 23** (Gazala 500/850, Kasserine 400/800, Kharkov 120/200, Stalingrad 50/90, Tobruk 150/300) |
| declare `renderer.setViewdistance` | **1 / 23** (Tobruk, 700) |
| `Sky.addCloud` with the cloud geometry REM'd out | 23 / 23 |

Selected `Game.setViewDistance` values: Berlin 100, Bulge 200, Caen 225,
Omaha/**Tobruk** 300, Stalingrad 90, Bocage 400, **Wake** 500, Kasserine 800.

The video-settings slider on this install
(`Settings/Profiles/skandia/Video.con`) is `game.setMenuViewdistance 100` —
100 % — so the in-game reference screenshots show the undiluted con values:
Tobruk's world ends at 300 m with fog fully saturated exactly there; Wake's
at 500 m.

Units: Refractor world units are metres and the pipeline keeps them 1:1; fog
is linear in both engines (DX8 vertex fog vs `THREE.Fog`, same curve, coarser
vs per-fragment evaluation). No unit or curve mismatch exists anywhere in
this story.

---

## Symptom 1 + 2 — "draw distance too long" and "fog too weak" (one mechanism, three data bugs)

**Observed.** Flythrough: bunker line readable, a crisp distant mountain
ridge, hard horizon. In-game: everything at the same distances washed into a
flat haze wall with no terrain silhouette. Confirmed on both maps with the
fog checkbox ON.

**Root cause A — the viewer's far plane overshoots the fog.** On Tobruk the
extracted fog (150→300) was *correct and applied* — `scene.fog` read
`{150, 300, #ccb787}` off the live scene. But `drawDistance` was 700 (see B),
and `applyFar()` set `camera.far = max(draw*1.6, 900)` = 1120 m
(old `map.html:1231-1238`). Terrain between fogEnd (300 m) and the far plane
(1120 m) still rasterises — at exactly 100 % fog colour — and its hill
silhouettes cut a hard edge against the sky mesh painting, which is lighter
than `fogColorVec` at the elevations the overshoot exposes. Pixel-sampled
proof from the live render looking south at the escarpment: the "ridge"
pixels are (204,183,135) — *precisely* the fog colour, i.e. fully fogged
terrain — against sky-painting pixels of (224,205,154) higher up. That
contrast **is** the user's "crisp distant mountain ridge". The engine never
shows it because its far plane sits at the view distance (300), where the
haze wall has just completed. Clamping the live camera to far=315 made the
ridge vanish into the exact in-game flat wall; the residual seam where
perfectly-fogged terrain meets the painting is 2–4/255 (the painting's
bottom band is DICE's own fogColorVec bake) — the same seam the engine has.

**Root cause B — the extractor reads the wrong view-distance directive.**
`bf42/level.py` parsed only `renderer.setViewdistance` — a raw renderer poke
that exactly one vanilla map carries (Tobruk, 700) and that the game
overrides there: `Game.setViewDistance 300` runs later in the same Init.con
and the engine applies the Game value (times the menu slider) as the actual
far plane — the in-game 300 m wall confirms it. `extract_map.py` then emitted
`info.view_distance or 700`, so Tobruk got 700 from the dead directive and
**every other map got the 700 fallback**, whether the engine shows 90 m
(Stalingrad) or 500 m (Wake).

**Root cause C — 18 of 23 maps got an invented fog range.** Only 5 vanilla
levels declare `fogLinearStart/End`; for the rest, `bf42/level.py` defaulted
to `fog_start 200 / fog_end 700` and `extract_map.py` wrote that into
scene.json as if it were level data. In the engine a level with no declared
range still fogs — to its view distance: all 23 levels enable vertex fog, the
in-game wall always sits at the far plane, and DICE paints `fogColorVec` into
the sky mesh's below-horizon band so wall and sky always meet. A fixed
200/700 default cannot be the engine rule (Berlin's far plane is 100 m — it
would get *zero* fog before a razor clip; the game shows murk). This is the
whole Wake gap: extract had fog 200→700 + far plane 1120, so the far arm of
the bay (400–700 m) rendered half-fogged and fully legible — palms,
causeway, buildings — where the engine (fog to VD 500) dissolves it.
Verified live before/after: with the derived 250→500 fog and a 525 m far
plane, the carrier ghosts out, the far spit dissolves, and sea and painted
sky merge without a horizon line, matching the in-game shot.

Note on the earlier draft of this document: it blamed the Tobruk screenshot
on the fog checkbox being off. That was wrong — the user's HUD shows it
ticked — and the corrected mechanism is root cause A above. The off-state
happens to produce a similar image (fog 385→700 in the old code), which is
what misled the first analysis.

**Residual engine differences, deliberately accepted:** the engine also culls
individual statics by per-template cull radius (`CullRadius.con` — Tobruk
multiplies its bunkers/wire/bushes by 5 to *keep* them visible out to the
short view distance) and `renderer.globalLodPercent`. The viewer's uniform
cull at `drawDistance` is a coarser stand-in; with fog saturating exactly at
that distance, pop-in is invisible. Not worth per-template fidelity.

## Symptom 3 — clouds on maps whose skies have none

**Observed.** Flythrough Tobruk renders an animated cloud layer over the
whole sky (HUD: `sky Sky_Tobruk_m1 + clouds`); the in-game sky is a clean
gradient. In-game Wake *does* show soft high cloud.

**Root cause.** The `Sky.addCloud` layer never renders in vanilla BF1942 on
any map, and the clouds that ARE visible in-game are painted into the sky
mesh textures:

- Every vanilla `SkyAndSun.con` calls `Sky.addCloud` but REMs out the cloud
  geometry (`REM GeometryTemplate.create StandardMesh Cloud` /
  `REM GeometryTemplate.file cloud`) — identical block on all 23 maps. The
  layer draws that template; never created, nothing drawn.
- No cloud mesh ships anywhere in vanilla (`standardMesh.rfa` has zero cloud
  entries). Even un-REM'd, the file would not resolve. (`texture/cloud1.dds`
  exists in `texture.rfa` — an unused leftover, and exactly the file the old
  pipeline guessed.)
- Mods prove the mechanism: 34 installed mod levels (bf1918, FHSW, GCMOD,
  bfheroes, …) carry an **active** cloud `GeometryTemplate.create` +
  `.file <mesh>`, and those mods ship real cloud meshes (`cloud.sm`,
  `cloud1_m1.sm`, …).
- The painted-cloud reading is confirmed by the decoded sky faces:
  `Sky_Wake_01..04` are full of soft diffuse cloud in the upper half —
  matching the in-game Wake sky — and `Sky_Tobruk_01..04` carry the sparse
  desert cumulus plus a painted sun glow. The 512px faces also settle the
  horizon question: the below-horizon half of every face is flat
  `fogColorVec`, blending up through a painted haze band (Wake's whitens to
  near-white exactly as the in-game shot shows). The engine does not fog the
  sky at runtime — no fog attribute exists anywhere in the `.rs` vocabulary
  (surveyed all of `standardMesh.rfa`: zero hits), and fogging a box whose
  vertices sit beyond fogEnd would flatten the whole sky to fog colour. The
  viewer's `fog: false` sky material is correct; the old comment justified it
  with the wrong attribute (`lighting false`), but the conclusion stands.

The old pipeline treated `Sky.addCloud` alone as "has clouds"
(`level.py` set `has_cloud=True`) and invented the texture
(`cloud_texture = "texture/cloud1"` default, never set by any con — the
texture belongs to the missing mesh's `.rs`), so all 23 vanilla extracts drew
a dense scrolling cloud layer the engine never shows, on top of the painted
clouds that are already in the sky box.

## New symptoms from the Wake pair

**Water saturation.** In-game: desaturated grey-green, murky, hazing to white
at distance. Old viewer: saturated turquoise that stayed saturated into the
distance. Two causes: the distance half was the fog bug (fixed above — the
water shader already syncs `scene.fog`); the saturation half was factual —
the layer combine `tex = l1 * l2 * 4.0` ran on sRGB-decoded (linear) samples.
The `water07/08` texels are near-neutral grey-teal (measured mean 140/150/153
and 141/149/155); squaring their slight tint in linear space is what
manufactured the turquoise. The engine's fixed-function MODULATE2X runs in
8-bit display space — the same display-vs-linear trap this repo already fixed
for the terrain-detail, lightmap, and dynamic-shading combines (see
rendering-technology.md). The combine now round-trips through sRGB like the
others. Fresnel was left exactly as `636b633` tuned it — no stacked
correction.

**Ground reads smeary at range.** The detail pass works (close-up grain is
present, `terrain/detail.png` loads, 16 repeats per patch), but every terrain
texture used three's default `anisotropy = 1`, so at the grazing angles a
flythrough lives at, trilinear mip selection blurred tile art and detail
grain into low-frequency smear a few metres out. Terrain tile maps and the
detail texture now use max anisotropy. Object/vehicle textures untouched.

**Lighting/contrast — deliberately not touched.** The dynamic-mesh and
lightmap combines are verified against the decompiled renderer
(engine-reference ledger); retuning them against a JPEG impression would
unwind verified work. Part of the perceived flatness was the missing
atmosphere (now fixed); the known remaining gap is terrain cast shadows —
`Textures/LightmapShadowBits.lsb` is still unparsed (see map-parity.md,
"Expensive but possible").

---

## What was changed (all landed)

**`tools/bf1942-models/bf42/level.py`**
- `LevelInfo.game_view_distance` added; `game` namespace now parses
  `Game.setViewDistance`.
- `fog_start` / `fog_end` are now `None` when undeclared (were invented
  200.0/700.0).
- `SkyInfo.cloud_mesh` added; `GeometryTemplate.create` names are tracked so
  an **active** cloud template's `GeometryTemplate.file` registers it.
  Comments are stripped upstream, so vanilla's REM'd block leaves it `None`.

**`tools/bf1942-models/extract_map.py`**
- `drawDistance` = `game_view_distance or view_distance or 700` — the engine's
  directive wins; Tobruk goes 700 → 300, every other vanilla map gets its
  real value.
- Undeclared fog derived from the view distance: `fogEnd = VD`,
  `fogStart = 0.5 * VD`. The 0.5 fraction is DICE's own habit in the five
  levels that declare one (0.50, 0.50, 0.56, 0.59, 0.60). Declared ranges are
  kept verbatim, including Gazala's fogEnd 850 > VD 500 (in-game the fog
  genuinely never saturates there before the clip).
- `write_cloud_assets` requires `has_cloud AND cloud_mesh`, and resolves the
  cloud texture from the cloud mesh's own `.rs` material (fallback:
  `texture/cloud1`). Vanilla maps therefore emit `"clouds": null` and the
  viewer's HUD `+ clouds` suffix disappears with it; mod levels with real
  cloud declarations keep the layer, data-driven.

**`tools/bf1942-models/viewer/map.html`**
- `applyFar()`: non-entire mode is now
  `camera.far = max(drawDistance, fogEnd) * 1.05` (was `max(draw*1.6, 900)`).
  The far plane hugs the engine's; the fogEnd term covers declared-fog-beyond-
  VD maps so the haze wall always completes before the clip.
- Water shader: the two-layer combine runs in display space
  (`min(1, srgb(l1)*srgb(l2)*2)`, base multiply in display space too),
  consistent with the repo's other engine-verified combines.
- Terrain tile maps and the detail texture get
  `renderer.capabilities.getMaxAnisotropy()`.

**`tools/bf1942-models/tests/test_level.py`** — updated/extended: REM'd cloud
geometry leaves `cloud_mesh` None; active mod-style cloud block registers it;
`Game.setViewDistance` parsed alongside the stray renderer directive;
undeclared fog stays None. Full suite: 265 tests, all passing.

**Re-extraction.** All 23 vanilla levels plus the two EoD levels re-extracted
with the fixed extractor (`extract_map.py <Level> --out ./viewer/maps`,
`--mod EoD` for the mod pair); zero failures. Full sweep of the 25
scene.jsons after the pass: `clouds` null everywhere, `drawDistance` equals
each level's `Game.setViewDistance`, the five declared fog ranges kept
verbatim, all others derived 0.5·VD→VD. Spot values: Tobruk 150→300 draw 300
(was 150→300 draw 700); Wake 250→500 draw 500 (was 200→700 draw 700); Berlin
50→100 draw 100 (was 200→700 draw 700); Gazala 500→850 draw 500 (declared
range kept although it never saturates before the clip — engine-true).

## Verification (live renders, defaults, fog checkbox ON)

- **Tobruk, spawn plateau, all four compass directions:** haze wall completes
  at 300 m and meets the painted sky; no terrain silhouette beyond it; no
  cloud layer (HUD reads `sky Sky_Tobruk_m1 / water shader`). Pixel check at
  the former ridge: terrain at the plane renders exactly fog colour
  (204,183,135) against a painting band within 2–4/255 of it — the same seam
  the engine shows.
- **Wake, defgun bay view:** carrier reduced to a ghost, far spit dissolves
  into white haze, sea merges with the painted horizon with no hard line;
  lagoon reads grey-green instead of turquoise; ground texture holds grain
  into the middle distance instead of smearing.
- **Berlin (worst old offender):** fog 50→100 with far plane 105 — facades
  dissolve within a city block, the map's authentic murk, where the old
  extract drew a clear 700 m panorama.
- **Gazala (declared-fog-beyond-VD edge):** live scene shows fog 500→850,
  far plane 892.5, object cull at 500, no cloud layer — the `applyFar` fogEnd
  term doing its job.
- Unit tests all green (265).

## Second pass (independent review)

A second reviewer re-rendered both reference viewpoints from scratch (own
server, own camera placement, Playwright against `?shots`) and re-checked
every claim above against live pixels and the scene.jsons rather than this
document's narrative.

**All six fixes hold.** Live probes: Tobruk `scene.fog` {150, 300, #ccb787}
with `camera.far` 315; Wake {250, 500, #b5bdc9} with far 525 — exactly
`max(VD, fogEnd) * 1.05`. Sweep of all 25 scene.jsons: the five declared fog
ranges verbatim, the other 20 derived 0.5·VD→VD, `drawDistance` = the level's
`Game.setViewDistance`, `clouds` null everywhere (both EoD levels included —
they inherit vanilla's REM'd block). Live scene graphs on both maps contain
no cloud mesh. Water at 500 m sampled (181,189,201) — the fog colour to the
digit, confirming the shader's fog sync. Detail grain visibly survives into
the middle distance at grazing angles (anisotropy working). One false alarm
worth recording: a "hard dark horizon line" in an early review render turned
out to be the roof slab of the bunker the camera had been placed inside,
edge-on — camera placement, not a rendering bug (bisected the scene graph to
prove it).

**What the re-render showed against the references.** Tobruk front line at
eye height: haze wall completes at 300 m, no terrain silhouette beyond it,
wire and bunkers dissolve progressively — matches. (The reference's "no
clouds" sky: the painted Sky_Tobruk faces genuinely carry sparse cumulus, so
whether a shot shows any is direction-dependent; not actionable.) Wake defgun
across the bay: far spit reduced to a faint sand ghost, sea and painted sky
meeting without a horizon line (sea at the merge (159,170,183) vs painting
(173,188,201) — a 14/255 seam), lagoon shallow-to-deep gradient present,
palms dark olive, baked slope contrast strong — matches.

**Water verdict (the user's "biggest remaining gap" instinct).** Mostly
resolved by the MODULATE2X fix, with one real artefact left, now also fixed.
Sampled foreground sea was already desaturated murk ((86,95,98) — grey-teal,
channel spread 12/255), not turquoise; fog behaviour exact. What still
separated it from the in-game shots was **structured cloud/island shapes
mirrored on the mid-distance water**: the fresnel term samples ENVMAP_G_.rcm
sharply, and those faces bake the island and its clouds. A/B isolation proved
attribution: env term deleted, the smudges vanish (but the sea goes dead-flat
felt and the horizon merge worsens — deleting the term is wrong); plain
Schlick restored, the water goes *brighter than the sky* ((182,196,212) vs
(173,188,201)) — `636b633`'s shaping is load-bearing. Fix landed: the env
lookup is now `textureLod(tEnv, R, 4.0)` — a fixed coarse mip keeps the soft
brightness wash toward the horizon (which the reference shows) and removes
all structure (which it doesn't). A driver-clamped texture bias could not do
this (MAX_TEXTURE_LOD_BIAS may legally clamp to 2). Calibrated, not
decompiled — same epistemic status as the fresnel shaping.

**Second small fix:** the water shader fogged with `smoothstep` while the
terrain (THREE.Fog) and the engine's DX8 vertex fog are both linear — up to
~9 % of the ramp divergent mid-range, visible where waterline meets shore at
the same distance. Now a linear ramp.

**Positions on what the first pass left alone — all agreed:**
- *Lighting/contrast*: the renders show strong baked slope/shadow contrast;
  the combines are decompiler-verified; retuning against JPEG impressions
  would unwind verified work. The `LightmapShadowBits.lsb` ceiling stands.
- *Water fresnel `636b633`*: measured above — plain Schlick is strictly
  worse. Keep.
- *Per-template `CullRadius.con`*: with fog saturating exactly at the cull
  distance, pop-in is invisible in every render taken; per-template fidelity
  would change nothing visible.

Full suite after the two shader edits: 265 tests, all passing
(`python3 -m unittest discover -s tests`; pytest is not installed on this
machine).

## Not determined / left alone

- **The engine's built-in default `fogLinearStart/End` constants.** No
  `fogLinearStart` string survives in the stripped `BF1942.exe` string table;
  the renderer-state constructor crawl was judged not worth it. The
  VD-derived rule is inferred from data + both in-game reference shots and is
  flagged as inferred, not decompiled.
- **Whether the menu view-distance slider also scales a declared fog range**
  (folklore says yes; this install runs at 100 % so it cannot matter here).
  Worth settling only if the viewer ever grows a view-distance control.
- **Per-template cull radii / globalLodPercent** — uniform cull at the (now
  correct) view distance is visually equivalent behind saturated fog.
- **Lighting combines and water fresnel** — decompiler-verified and
  previously calibrated respectively; not retuned against JPEG impressions.
- **`LightmapShadowBits.lsb`** (terrain cast shadows) — still the documented
  ceiling from map-parity.md, unchanged by this pass.
