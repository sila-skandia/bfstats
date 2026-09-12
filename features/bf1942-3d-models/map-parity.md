# Map parity: closing the gap between the extracted scene and the game

The geography of an extracted level was already right; the look was not. The
complaint was specific — the textures, the sky and the water do not match the
game — and this pass establishes what the engine actually does for each,
reproduces it, and records what remains. Worked on two contrasting levels:
Tobruk (desert, a harbour bay) and Wake (coastal, an atoll in open sea).

The single most important change is not code: **vanilla `texture.rfa` is back
on this install** (98,885,015 bytes, 1,605 entries, alongside a restored
`standardMesh.rfa`). The README's account of a 6.2% vanilla texture resolution
rate, and the `TEXTURE_GAP_MODS` borrowing that papered over it, describe a
state that no longer exists. Borrowed art was itself a parity bug — a Forgotten
Hope palm under a vanilla basename is not a vanilla palm. With the real archive
present, Tobruk and Wake each extract with **one** unresolved texture reference
(`texture/sherW2_f`, a Sherman wreck map that is one of the four the README
already records as shipping in no archive at all). `TEXTURE_GAP_MODS` is still
in `extract_map.py` but only registers when `texture.rfa` is genuinely absent.

## The sky is a mesh, and the cubemap never was the sky

The trap: every level carries a `Textures/ENVMAP_G_.rcm` naming six
`env_<level>_NN.dds` faces, and it is the obvious thing to load as a sky
cubemap. It is the wrong primitive. `Init.con` binds it with

```con
ShaderManager.setTextureParam envmap bf1942\levels\tobruk\Textures\ENVMAP_G_.rcm
```

— it is the **reflection source** for shaders that take an `envmap` parameter
(water, vehicle glass), and its faces are 128px because a reflection can afford
to be. Drawn as the background it becomes a wall of blur pixels, which is
exactly what the viewer showed.

What the engine draws instead is declared in `Init/SkyAndSun.con`:

```con
GeometryTemplate.create StandardMesh SkyBox
GeometryTemplate.file Sky_Tobruk_m1
Sky.initSky
Sky.addCloud
Cloud.setTexScale 8
Cloud.setSpeed -0.03 0.015
Sky.setRotAngle 180
sky.changeOfsSkyHeight 150
```

`Sky_Tobruk_m1.sm` is a six-quad box, ±2000 on each axis, one material per
face, each bound by its `.rs` to a **512px** `texture/Sky_<level>_NN.dds` from
`texture.rfa` — 16x the pixel area per face of the env map. The faces are
paintings: DICE rendered the fog colour into the below-horizon half, so the
declared `renderer.fogColorVec` meets the skybox seamlessly at the horizon. On
top of it the engine scrolls a cloud layer (`texture/cloud1.dds`, alpha-blended,
`setSpeed` UV/sec, `setTexScale` repeats) and draws a `LensFlare` sun object.
So the answer to "is the source simply low-res" is no on both counts: the
128px file was never the sky, and the real sky is both higher-res and
composited from three parts.

The extractor now parses the sky block (the `GeometryTemplate.file` preceding
`Sky.initSky`; the REM'd-out cloud geometry in every vanilla file does not
shadow it because comments are stripped), bakes `Sky.setRotAngle` into the
vertices, and exports the box into the scene glb as an unlit `kind: "sky"`
node — winding, UV wrap (V stored in [-1,0], wraps to the same texels) and the
Z-mirror all ride the existing exporter. Faces stay at native 512px regardless
of `--max-texture`. The cloud texture and every `Cloud.*` / `Sky.*` parameter
land in `scene.json`.

The viewer reparents the sky out of the level root (distance culling must
never touch it), swaps its materials for fog-free `MeshBasicMaterial`
(`lighting false` in every `Sky_*.rs`), scales it to fit the far plane —
with depth writes off only its angular content matters, and that is
scale-free — and locks it to the camera each frame.
**`sky.changeOfsSkyHeight` lowers the box.** Applied upward, Tobruk's
sand-fade band fills the whole sky; Wake (offset 0) is indifferent, which is
what made the sign findable. Clouds are a camera-locked plane above the
camera with world-anchored UVs (the pattern stays put while you fly),
scrolling at the declared speed, with a radial fade standing in for the
engine's cloud-distance falloff.

Not reproduced: the `LensFlare`/corona sun object, and the exact cloud
height/extent semantics (`Cloud.setHeight 3500` against a 2098-tall box, and
`changeOfsCloudHeight 2500`, read here as height-minus-offset in sky units —
calibrated visually, not derived).

## Water is a console block, not a colour

The level root carries a 49-byte `WaterShader.rs`:

```rs
subshader "WaterElala" "PatchTerrain/Water" {}
```

Empty. The whole effect is the `water.*` block in `Init.con`, and the two
levels declare genuinely different water:

| | Tobruk | Wake |
|---|---|---|
| layers | `water07` + `water08`, tile 0.5, scroll 0.03 | same |
| normal map | `normalMap01`, tile 1 | `normalMap02`, tile 0.25 |
| colour | `color 0.63/0.59/0.33`, `deepcolor 0.5/0.45/0.3` | `shallowColor 0.95/1/0.85`, `deepColor 0.5` (scalar = grey) |
| alpha | shallow 0.5, full at 1.5 m | shallow 0.1, full at 3 m, colour ramp over 6 m |
| specular | `0.85/0.83/0.88`, streak 0.001 | `0.75/0.73/0.78`, streak 0.001 |

The old extraction drew a flat translucent quad in `water.color` over the
shipped-tile extent — on Wake the plane visibly ended mid-lagoon.

Now the extractor parses the entire block (including Wake's scalar `deepColor`,
expanded to grey), exports the two layer textures and the normal map as PNGs,
and derives a **depth map** from the heightmap: metres of water above each
sample, normalised to the recorded `maxDepth` (50.6 m on Wake), covering world
0..worldSize so a shader can sample it straight from world position. The water
quad spans the world grid, as the engine's does.

The viewer swaps the quad's material for a `ShaderMaterial` doing what
`PatchTerrain/Water` did: two modulate-2x scroll layers, depth-ramped colour
(`shallowColor` to `deepColor` over `waterColordepth`) and alpha
(`waterShallowAlpha` to opaque over `waterAlphaDepth` — the shoreline hugs the
island for free), Blinn specular off `water.lightDirection`, scene fog applied
manually, and — the piece that makes it read as water rather than milk — the
**ENVMAP_G_.rcm cubemap reflected off the surface with a fresnel term**, which
is precisely the role Refractor gives that file. The env faces are now
exported on every extraction as `extras.envmap`.

One measured trap: `normalmap01/02.dds` are not 0.5-centred normal maps (the
mean sits near (0.4, 0.9, 0.4)), so the standard `rgb*2-1` unpack tilts the
whole surface. The shader takes the difference of two offset samples instead —
zero-mean by construction, still animated.

Not reproduced: true refraction (the engine had none either — its depth ramps
are the same fake), the anisotropic specular streak (`specularStreakFactor`
maps to a plain Blinn exponent here), and scroll/tile units are calibrated
visually — the con values are per-tick and per-unit quantities for which no
public documentation exists.

## Terrain and object textures

Three separate fixes:

**`textureManager.alternativePath` was ignored.** Tobruk declares
`Texture/Africa`; `texture.rfa` carries 68 entries there — desert repaints of
`sherma_i`, `p4main_f`, `tiger_z`, the wrecks — plus `Texture/Pacific` (25) and
`Texture/Russia` (15). The engine probes the alternative directory by basename
before the path the shader wrote, which is how every spawned vehicle on a
desert map turns desert-yellow with not one `.rs` changed. `ArchivePool` now
probes it first (`set_alternative_paths`, fed from `Init.con`).

**Patches without a shipped Tx tile are not holes.** Wake ships 16 island
tiles on an 8x8-patch world; the other 48 patches are sea floor, painted by
the engine with the level's `Textures/terrainDefault.dds` (64px). The old
scene simply had no ground there — the lagoon showed a hard water edge and a
void horizon. The extractor now enumerates the uncovered world grid
(`default_patches`, honouring `texOffset`), and emits each as a normal terrain
patch with the default texture wrapping 4x per patch (~1 m/texel, the same
family as a 1024px tile's 0.25 m/texel; the engine's own repeat count is not
documented). Tobruk ships no `terrainDefault` — its out-of-tile ground stays
absent, which matches the engine falling back to nothing visible beyond the
out-of-bounds line. Wake's terrain went from 131,072 to 524,288 triangles and
the glb from 28.8 MB to 38.1 MB; nothing here is instanced yet.

**The object-lightmap pass had never executed.** `bindLightmaps` gated on
`obj.isMesh`, but a multi-material part arrives from GLTFLoader as a Group
whose direct Mesh children are its primitives — the same Group-vs-Mesh trap
the README documents for `setAnimatedTextureSpeed`. Measured before the fix:
Tobruk 44 lightmap extras, 0 on meshes, 0 lightmap HTTP requests (Bocage
38/0, Wake 40/0 — the pass was a no-op on every map). The binding now targets
the Group's direct primitive meshes (recognised by their empty `userData`;
child part nodes always carry extras), and the baked per-instance shadows
multiply in — building walls get their sun side and shade side back.

Also wired through: `renderer.diffuseColor` drives the sun light,
`renderer.ambientColor`/`globalAmbientColor` the hemisphere, and every
declared colour (fog included) is treated as an sRGB display value — the
engine predates colour management, and pushing its floats through a linear
pipeline unconverted washes them out. `renderer.setViewdistance` becomes the
draw distance (Tobruk declares 700; Wake declares none and keeps the default).

## Evidence

Reproducible poses (the viewer takes `?map=` and `?cam=x,y,z,yaw,pitch`; add
`&shots` to enable canvas capture):

- `map.html?map=Tobruk` — spawn overview.
- `map.html?map=Tobruk&cam=2033,300,-950,3.14159,-0.3` — the harbour bay.
- `map.html?map=Wake` — spawn view over the lagoon.
- `map.html?map=Wake&cam=1100,105,-1024,2.2,-0.2` — low over the shore.

Before: the sky was the 128px env cubemap magnified into visible blur blocks
(the bay pose renders individual texels several degrees wide); Wake's water
was a single flat grey-green slab ending mid-lagoon at the shipped-tile
boundary, with a void beyond; no baked object shadows anywhere. After: the
512px painted sky with its fog-colour horizon, drifting clouds, water that
darkens with real depth, hugs the shore, and reflects the sky at grazing
angles, sea floor to the world edge, desert-skinned vehicles, and lightmapped
buildings. Payload cost, measured: Tobruk 61 MB on disk (glb 58.1 to
59.3 MB — the six sky faces), Wake 40 MB (glb 28.8 to 38.1 MB — 48 fill
patches). The parallel perf measurement puts worst-case Tobruk at 9.7 ms GPU
against a 16.7 ms budget, so none of this approaches a frame limit.

## Re-extraction

```bash
cd tools/bf1942-models
python3 extract_map.py Tobruk --out ./viewer/maps
python3 extract_map.py Wake --out ./viewer/maps
```

No `--texture-fallback` flags: with vanilla `texture.rfa` on disk they are
unnecessary, and borrowing is again what it always was — a last resort for a
broken install. The viewer is the `model-viewer` launch config; both old and
new `scene.json` layouts load (an old extraction falls back to the env-cubemap
sky and flat water).

## The ceiling

What this approach cannot reach, what it can reach at a price, and what is
already free:

- **Already free (shader work, not technology work).** Everything landed here
  runs in three.js at a fraction of the frame budget. The remaining visible
  gaps of the same kind — the lens-flare sun, the specular streak shape,
  animated flags, exact cloud-band placement — are hours of shader and
  calibration work each, none gated on rendering technology.
- **Expensive but possible.** `Textures/LightmapShadowBits.lsb` is the baked
  terrain shadow layer (`Terrain.ShadowAmbient 60/60/60`), and its format is
  undocumented: Tobruk's is 605,532 bytes against the 131,072 a 1-bit
  heightmap-resolution field would need, so it is compressed or mipped and
  needs real reverse engineering. Until then our terrain has slope shading
  but no cast shadows from hills or buildings. Similarly `MaterialMap.raw` +
  `TerrainPalette.pal` (per-patch surface classification) are parsed by
  nothing here.
- **Fixed-function ghosts.** The engine's exact fog curve (`fogLinearStart
  150 / end 300` against `setViewdistance 700` — the slider-scaling rule is
  folklore, not documented), per-tick scroll units, and DX8 blend-state
  minutiae can be approximated arbitrarily closely but verified only against
  live captures of the real game.
- **The WASM question, plainly.** The deltas closed here were all asset-
  pipeline and shader-fidelity problems: the wrong cubemap drawn as sky, a
  console block never parsed, a texture directory never probed, a bind gated
  on the wrong node type. None would have been solved by a different renderer,
  and the GPU numbers show three.js is nowhere near a wall. A WASM port of a
  Refractor-like renderer would buy exact fixed-function replication and the
  original terrain LOD at the cost of reimplementing an engine; it buys
  nothing for sky, water or textures that a few hundred lines of GLSL did not
  already buy. If parity of *simulation* (animated soldiers, physics, effects)
  ever becomes the goal, that argument changes — but for looking like the
  game, this is a shader problem, and it is mostly solved.

Tooling note: `?shots` enables `preserveDrawingBuffer` for external capture;
without the flag the viewer is unchanged. The screenshot receiver used during
this pass lives in session scratch space and is not part of the repository.
