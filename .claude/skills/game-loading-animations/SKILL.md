---
name: game-loading-animations
description: Make loading animations out of the game itself. Draw a soldier, vehicle, plane or ship from the viewer's BF1942 models into a sprite, then bring it to life with CSS and the Web Animations API, the way the Short loader's prone BAR gunner stacks a pyramid of spent brass. Use whenever the owner asks for a loader, spinner, waiting screen, "something to show while X loads", an idle or empty-state animation, or a new scenario for an existing one ("a Stuka dive-bombing", "a Sherman reloading", "a medic running across", "a destroyer firing a broadside"), or asks how the Short loader was made.
---

# Loading animations from the game

The Short loader (`tools/bf1942-models/viewer/play/short-loader.js`) shows
while a `?short=` link loads on play.bfstats.io. Each time it shows it plays
one scene at random from `viewer/play/loaders/`: a prone BAR gunner stacking
brass (`brass.js`), a cross-mod duel where every round goes over a kneeling
head (`duel.js`), a Tiger fighting hull down (`hulldown.js`), a commando
section's fire and movement (`rush.js`), and a Panzerschreck ambush from a
hedgerow (`ambush.js`). They play side by side on `play/loaders.html`. The
designs, the tactics behind them, their sources and the verification are in
`features/replay-shorts/README.md`, "The loader" and "The loaders".

The stats site (bfstats.io) shows the same scenes in place of its loading bar,
through `ui/src/components/common/BfGameLoader.vue` and a synced copy of the
modules and sprites. **After changing a scene or a sprite, run
`scripts/sync-ui-loaders.sh`**; `tests/test_loaders.py` fails until the copy
matches ("The loaders on the stats site" in the same README).

map.html and the play front page show a scene from their very first frame
through the boot loader (`play/boot-loader/entry.js`), a bundle inlined into
the page at image build. **After changing a scene, the kit or the entry, run
`node scripts/build-boot-loader.mjs`** ("The boot loader" in the same README).

**Start a new scene from `loaders/kit.js`, not from scratch.** It is the shared
skeleton: stage, scale, words, timers, reduced motion, boot shade, effects,
sprite strips and `kit.man`. Copy the shape of the nearest scene, add it to
`loaders/scenes.js`, and add its sprites' commands to
`scripts/render-loader-sprites.sh`.

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

Strips (all frames share one camera and one crop, so they line up):

```bash
# A soldier's stances with blended in-betweens: stand | 4 | crouch | 4 | lie.
node scripts/render-game-sprite.mjs --glb models/mods/fh/poses/GermanSoldier__Mp40.pose.glb \
  --clips stand,crouch,lie --tween 4 --yaw 1.5708 --scale 74 --size 340x180 --out play/loaders/x.webp
# One cycle of the run gait, eight frames.
node scripts/render-game-sprite.mjs --glb models/mods/xpack2/poses/BritishCommandoSoldier__No4.pose.glb \
  --gait run --frames 8 --yaw=-1.5708 --scale 50 --size 300x150 --out play/loaders/y.webp
# One static out of a level bake: the first sandbag_2m_m1 in the Bulge, at the origin.
node scripts/render-game-sprite.mjs --glb maps/battle_of_the_bulge/scene.glb --clip none \
  --only sandbag_2m_m1 --pick 0 --yaw 1.2 --scale 74 --size 260x120 --out play/loaders/z.webp
# The muzzle and head of each frame, read from the pixels.
python3 scripts/sprite-anchors.py tools/bf1942-models/viewer/play/loaders/x.webp left 11
```

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
  Every mod's poses have `stand`, `crouch` and `lie`, so `--tween` works for
  all of them. A mod tree's poses have no `.pose.json`; `--gait` then uses
  `gaits/lower.gait.glb` and `gaits/<weapon>.gait.glb` beside them.
- **Statics (walls, sandbags, ruins, hedges) exist only inside level bakes**
  (`maps/<level>/scene.glb`); there is no standalone glb. `--bounds` with
  `--only <name> --pick 0` lists one, `--pick k` draws it. `sandbag_2m_m1`,
  `stnwall_smlfrench_m1`, `rusruin01_m1` and `T_Stone1_m1` are in the Bulge.
- **Flags:** `models/AnimatedUkFlag.glb` and friends, drawn face-on (`--yaw 0`).

Pitfalls already paid for:

- `--yaw -1.2` is read as a missing value. Write `--yaw=-1.2`.
- The first textured render came out white: the texture index lives in the
  webp extension. The script handles it; a hand-rolled copy must too.
- `python3 -I` hides the user-installed Pillow. The script calls plain
  `python3`.
- A prone soldier seen square from the side looks like he is flying. A
  ground line, a soft shadow under him and a little pitch fix it.
- `--size` is the canvas in drawn pixels (2x), and `--scale` is drawn pixels
  a metre: a 160 x 150 canvas at scale 150 cut the soldiers in half. A
  standing man about 70 CSS px tall is scale 74 on a 340 x 180 canvas.
- Which way a sprite faces: for soldiers and tanks `--yaw=-1.5708` faces
  right and `--yaw 1.5708` faces left; `--yaw 0` shows a soldier's back,
  aiming into the picture. Draw a `--sheet` when unsure.
- A vehicle glb carries `_projectile`, `_tracer` and `_trail` meshes (thin
  lines over the turret); the script now leaves them out.
- Blending `crouch` into `lie` lifts the feet a little in the middle frames.
  It reads as a dive at 300 ms; it would not survive a slow move.

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

- **No hard cuts** (the owner, 2026-11-05: "the smooth loading animations you
  see from the big tech companies"). A change of stance steps through the
  blended frames (`strip.to(frame, ms)` or `kit.man(...).to(STAND)`) on an
  eased curve; never swap one pose for another. Moves, pans and recoil are
  eased Web Animations. A man never flips to face the other way: a
  double-take is a lean back on the heels and forward again. New sprites fade
  in and out (`opacity` and `translate` transitions), and the stage's edges
  fade so things enter and leave softly.
- **Do not caption the mod.** The owner: players recognise the models, which
  is the joy. No "Galactic Conquest" label over the duel.
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
  `node --input-type=module -e` (`test_loaders.py` and
  `test_short_loader.py` are the templates). Assert that the sprite ships,
  stays small (under 40 KB) and has its line in `render-loader-sprites.sh`.
- **Test the tactic, not just the layout.** Export the geometry the tactic
  depends on and assert it: hull down is the tank against the enemy's line of
  sight (`hulldown.js` `tigerAt`, `sightY`), the ambush is the gunner against
  the bank. These tests caught two real mistakes: a Tiger pitched up a plain
  slope shows its glacis or pokes its gun over the crest, and a 1.4 px change
  to a sprite's ground point lifted the hull over the line.
- **Step the clock.** `loaders.html?scene=<id>&step` freezes time; then
  `await loaders.<id>.advance(ms)` in the page moves it on, waking each wait
  in order and seeking every animation, and a screenshot shows that exact
  beat. Real-time screenshots in the app's browser pane are unreliable: it
  throttles a background tab's timers so hard that beats came out of order.
  A paused animation never finishes, so the step clock calls `finish()` on
  any it has seeked past its end; anything a scene waits on must use
  `kit.wait` or `kit.after`, never `setTimeout`, or it escapes the clock.
- **In a page:** run the `model-viewer` preview (`preview_start`) and open
  `play/loaders.html` (a new scene shows up there once it is in
  `scenes.js`). Port 5273 is the owner's: stop the server when done.
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

Each one is a new `--glb`, its anchors, and a new accumulator, on
`loaders/kit.js`. Done since: the duel, hull down, fire and movement, the
hedgerow ambush. Researched and not yet built (see the research note named
in the README): tank bounding overwatch (merge with hull down: the
overwatching tank is the hull-down one), a smoke screen laid upwind before an
advance (the screen takes 1-2 min to build; the beat is the waiting),
infantry walking beside a tank with the phone box on its rear deck, the
bocage leapfrog with an MG in the near hedge, and looking round the right
side of cover, never over the top (FM 21-75, 1944).
