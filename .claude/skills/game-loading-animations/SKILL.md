---
name: game-loading-animations
description: Make loading animations out of the game itself. Draw a soldier, vehicle, plane or ship from the viewer's BF1942 models into a sprite, then bring it to life with CSS and the Web Animations API, the way the Short loader's prone BAR gunner stacks a pyramid of spent brass. Use whenever the owner asks for a loader, spinner, waiting screen, "something to show while X loads", an idle or empty-state animation, or a new scenario for an existing one ("a Stuka dive-bombing", "a Sherman reloading", "a medic running across", "a destroyer firing a broadside"), or asks how the Short loader was made.
---

# Loading animations from the game

The first one is the Short loader (`tools/bf1942-models/viewer/play/short-loader.js`).
It shows while a `?short=` link loads on play.bfstats.io. The design and its
verification are in `features/replay-shorts/README.md`, "The loader". A prone
British rifleman, the game's own model in its own `lie` pose, fires short BAR
bursts. Each spent case arcs out and lands end-on in a pile that stacks into
a pyramid until the Short is ready.

The method is three layers. Keep them apart; each is cheap to change alone.

1. **A sprite drawn from the game.** `scripts/render-game-sprite.mjs` takes a
   model or pose glb from the viewer tree and draws it with its real textures
   to a transparent webp. It also prints where chosen world points (a muzzle,
   an ejection port, an exhaust) land in the sprite.
2. **A stage in CSS pixels.** The sprite and the effects sit absolutely
   positioned in a fixed-size box. The anchors the script printed become
   constants (`MUZZLE`, `PORT`). The box scales as a whole to fit the screen.
3. **The life.** CSS keyframes for the things that repeat (kick, flash,
   glow). The Web Animations API for the things that fly on a path (tracers,
   cases, smoke). A plain timer loop for the rhythm (bursts, magazine
   changes). And one thing that **accumulates**, so the wait has visible
   progress (the brass pyramid).

## Layer 1: the sprite

```bash
# What is in the model, and where (world metres; glTF is Y up):
node scripts/render-game-sprite.mjs --glb models/Tiger.glb --clip none --bounds
# Eight yaws on one contact sheet, to pick the angle:
node scripts/render-game-sprite.mjs --glb models/Tiger.glb --clip none \
  --centre 0,0.4,0 --scale 55 --size 420x240 --pitch 0.35 --sheet --out /tmp/tiger.webp
# The sprite, with the points the animation anchors to:
node scripts/render-game-sprite.mjs --glb models/Tiger.glb --clip none \
  --centre 0,0.4,0 --scale 55 --size 420x240 --yaw 0.79 --pitch 0.35 \
  --mark muzzle=0,1.4,-4.6 --mark exhaust=0.5,1.0,2.9 \
  --out play/loader-tiger.webp
```

Then look at the result on a dark background
(`im.alpha_composite` onto `(18,18,16)` with Pillow) before building on it.

How the script works, so you can change it:

- **Pose.** three.js's `GLTFLoader` parses the glb in Node. The textures are
  stripped from the JSON first, because Node has no DOM to decode images.
  The script remembers each material's image (webp textures sit under the
  `EXT_texture_webp` extension, not `texture.source`). An `AnimationMixer`
  poses it at `--clip`, `--time` seconds in. `SkinnedMesh.getVertexPosition`
  gives the skinned soldier's vertices. Rigid parts (a weapon on the hand
  bone, a turret) come out of `matrixWorld`.
- **Raster.** Plain JS, no browser: an orthographic camera (yaw about up,
  then pitch; positive pitch looks down), a z-buffer, nearest-texel texture
  lookup at the triangle's barycentric UV, one light plus ambient,
  supersampled 4× and box-filtered down, then gamma. Pillow decodes the
  webp textures in and writes the webp out. It runs in about a second, and
  it runs while another session's headless render job holds the browser.
- **Crop.** To the drawn pixels plus 4 px. The sprite is drawn at 2×, and
  the printed anchors are in 1× CSS pixels of the cropped sprite. Use
  `--no-crop` when several sprites must line up in one frame (layers).

Choosing what to draw:

- **Soldiers** are `models/poses/<Soldier>__<Weapon>.pose.glb`, with clips
  `stand`, `crouch` and `lie`. The weapon is already in the hand. The full
  set is `<Army>Soldier` × every hand weapon (BAR, MG42, K98Sniper,
  Panzershreck, Bazooka, MedPack, Binoculars, Detonator...).
- **Vehicles, planes, ships, statics** are `models/<Template>.glb` with
  `--clip none`. `--bounds` lists the parts: a tank's `...GunBarrel`, a
  plane's propeller, wheels, `..._projectile` meshes. Collision hulls and
  `Em_` emitters are always left out.
- **Layers for moving parts:** draw the hull with `--skip <Turret>` and the
  turret with `--only <Turret>`, both `--no-crop` with the same camera. CSS
  then turns the turret or spins the prop about a pivot the script printed
  with `--mark`. A soldier's gait (`gaits` in a pose's `.pose.json`, clips in
  `models/poses/gaits/*.gait.glb`) can be drawn frame by frame with `--time`
  into a sprite strip for a run cycle.
- **Mod models** are under `models/mods/<mod>/`. The same script draws them.

Pitfalls already paid for:

- `--yaw -1.2` is read as a missing value. Write `--yaw=-1.2`.
- The first textured render came out white: the texture index lives in the
  webp extension. The script handles it; a hand-rolled copy must too.
- `python3 -I` hides the user-installed Pillow. The script calls plain
  `python3`.
- A prone soldier seen square from the side looks like he is flying. A
  ground line, a soft shadow under him and a little pitch fix it.

## Layer 2: the stage

- One `<div>` of fixed CSS size (the Short loader's is 380 × 150). It holds
  the sprite `<img>` and the effect elements, all `position: absolute`, at
  coordinates computed from the anchors. Scale the whole stage with
  `transform: scale(var(--sl-scale))` inside a wrapper sized `calc(W *
  scale)`. Set the scale from the parent's width when the animation starts
  (from 0.55× on a phone's slide to 1.35× on a desktop).
- Load the sprite through `VIEWER_ROOT` (`viewer/viewer-root.js`):
  `new URL('play/x.webp', VIEWER_ROOT)`. Never use `import.meta.url` in a
  viewer module: modules are served from a versioned `/_v/<hash>/` path
  that images are not copied to. `test_stamp_viewer.py` fails the build on
  it.
- Put the pile, debris or crowd **in front of the subject and lower on the
  stage** (`PILE_GROUND = GROUND + 22`), so it reads as nearer the eye and
  never hides the business end. The first brass pyramid sat on the
  soldier's ground line and buried the rifle.
- Styles go in one `<style id>` injected once. Colours come from the play
  front end's palette (`#eeecd9` ink, `#a9a690` muted, khaki `#a39c6c`,
  gold `#e8c35a`, near-black backgrounds), not the stats site's `--mm-*`
  tokens; this is the play site.

## Layer 3: the life

- **Repeating beats in CSS.** A class added and removed restarts a keyframe
  (`restart(node, cls)`: remove the class, read the layout, add it back).
  The kick is 70 ms translate plus brightness. The muzzle flash is an
  inline SVG star at `steps(2)`. The glow is a radial gradient fading in
  110 ms.
- **Paths with the Web Animations API.** `el.animate([...keyframes],
  { duration })`, then remove the element in `.finished`. A case is three
  keyframes: out and up with its own easing, the apex, then down into its
  slot, spinning, and squashed with `scaleX` at the end so it turns end-on.
  Randomise a little (apex height, spin) so no two shots look alike.
- **Rhythm in a timer loop.** Bursts of 2–4 rounds 115 ms apart, then a
  pause of 0.4–0.8 s. Every 20th round (one BAR magazine) a reload dip. Use
  real numbers from the game where there is one: a magazine size, a rate of
  fire, a shell count. The `bf1942-knowledge` skill knows where they live.
- **One thing accumulates.** A wait with nothing growing feels like a hang.
  The pile's slot for case *i* is pure arithmetic (`pileSlot`, unit tested
  in `tests/test_short_loader.py`). A full pile settles away, top first,
  and starts again. Future ideas in the same spirit: craters filling a
  field, kill-feed lines stacking, flags captured one by one, a ticket
  counter running down.
- **Honest words.** One line, mono caps, with dots. After 7 s a second line
  admits the server is slow.
- **Reduced motion:** no loop. Show the subject, a small pile already there,
  and static dots.
- **A nicety never throws.** Wrap creation in `try`, have every `.finished`
  handle rejection, and stop timers on `stop()` and when
  `visibilitychange` hides the page.

### Wiring a loader into a wait

The Short loader shows two ways, and both are worth copying.

- **From the first frame of the page:** `bootShortLoader()` runs at module
  load in `play/front-end.js` when the address asks for the slow thing. It
  is a fixed full-screen shade with the loader in it. Whatever finishes the
  wait calls `endBootShortLoader()` in a `finally`, so success and failure
  both end it. So do leaving the tab and the tab failing to load: a loader
  with no way out is worse than a blank page.
- **Over content that has arrived but cannot play yet:** one loader
  instance, moved into the active slide over its poster, behind a scrim.
  Show it after a 250 ms grace, so a fast load never flashes it. Hide it on
  the video's `playing`, and on `pause`. Show it again on `waiting` after
  400 ms.
- And make the wait shorter where you can: the Short is now fetched
  alongside the strip's page instead of after it.

## Verifying

- **Unit test** the arithmetic (slots, rows, bounds) in
  `tools/bf1942-models/tests`, by importing the module in
  `node --input-type=module -e` (`test_short_loader.py` is the template).
  Assert that the sprite ships and stays small (under 40 KB).
- **In a page:** run the `model-viewer` preview (`preview_start`) and open
  a throwaway page under `viewer/play/` that imports the module. Delete the
  page afterwards. Port 5273 is the owner's: stop the server when done.
- **The browser pane is usually hidden,** and a hidden page runs no frames.
  The timers fire, but `.finished` never resolves, so the pile never
  appears. Do not take that for a bug. Inspect a moment by pausing every
  animation and seeking it (`document.getAnimations().forEach(a => {
  a.pause(); a.currentTime = d * 0.45 })`), then take a screenshot, which
  draws a frame. Fill a pile fast with a 20 ms interval calling
  `a.finish()` on every animation.
- **Test the slow path on purpose:** wrap `HTMLMediaElement.prototype.play`
  in a 3 s delay, move to a fresh slide, and take screenshots while it
  waits and after it plays.
- One headless Chromium at a time (memory: limit headless browsers). The
  sprite needs none, which is the point of drawing it in plain JS.

## Ideas the owner has asked for

The owner (2026-11-05) wants future loaders with "more vehicles and
scenarios that are very unique to the game". Candidates that use the same
three layers:

- A Stuka in a siren dive (pitch the sprite, rotate the stage). Bombs
  stack up below as craters.
- A Sherman and a Tiger trading shots. Hits stack as smoke columns, and a
  turret layer traverses.
- A medic dragging a wounded man across the frame (a gait sprite strip).
  The count of men patched up stacks.
- A landing craft beaching on Omaha: waves of soldiers run out and stack
  up behind the sea wall.
- An engineer repairing a jeep: a wrench flash, and health pips filling.
- A flag being captured: the cloth sprite's colour drifts from one team to
  the other while the bar fills.

Each one is a new `--glb`, its anchors, and a new accumulator. The loader's
skeleton (stage, scale, rhythm loop, boot and over-poster wiring,
verification) carries over unchanged. When a second one exists, lift the
shared skeleton out of `short-loader.js` rather than copying it.
