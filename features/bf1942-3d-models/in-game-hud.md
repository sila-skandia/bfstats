# The in-game HUD: health bar, stance figure, magazine picture

What shipped from round 2's soldier-HUD research (`verify-r1.md`, `verify-r2.md`
in the round's scratch reports — see `features/bf1942-engine-reference/` once
P5 lands the corpus rows) against the plan in the round's `BRIEFING2.md`. This
is track P1: closes the user's complaint that "the ammo indicator is a visual
inside the game, our current implementation is a text value" and "the player's
HP is also a visual indicator" — bottom left, a segmented health bar with the
kit's own glyph baked into it beside a stance figure; bottom right, the
magazine picture with the loaded round count and the spare-magazine count.

## What's new

`viewer/hud.js`: one generic painter, class `Hud`, that reads
`maps/_shared/hud/hud-layout.json` — `menu/InGame` flattened into 11 groups of
picture/fill-picture/text/occupied-seat/crosshair leaves, each with the file's
own rect in an 800x600 virtual screen, sprite names, and `CullNode` `when`
conditions — and draws whichever leaves have every variable they need, this
frame. It never hardcodes a rect, a sprite name, or a font: every number comes
from the layout, scaled into the real viewport the same way the deploy
screen's own painter already does (`_scaleFor`: a uniform letterboxed scale on
a portrait viewport, stretch otherwise).

`map.html` feeds it through one object, `gameHud.vars`, published as
`window.__hud.vars` unconditionally (not only under `?shots`) so every other
track and every headless check can drive it — the round's contract, keyed by
the engine's own MemeFile variable names exactly as the layout binds them:

    window.__hud.vars['Soldier/SoldierHitPoints'] = 21;
    window.__hud.vars['Ammo/PrimaryAmmo'] = 14;

A leaf whose variables are not all present is culled, never drawn from a
guess or the file's own sample literal — so a track that has not landed yet
(P2's seats, P3's supply and health) simply leaves its groups invisible
instead of the page crashing or inventing a placeholder. The painter repaints
only when a tracked variable, or the stage size, actually changed since the
last call (`_isDirty`/`_snapshot` — features/mesh-viewer-performance rule 7),
and allocates nothing per frame: the full set of variables every leaf can
reference is gathered once in `load()`.

Deleted: the `#ammo` DOM text line, `updateAmmoHud()`, and the car dashboard
text that rode the same element (see "The car dashboard" below). The DOM
`#crosshair` is untouched this round, per the brief.

## The variable contract this round feeds (soldier side)

`updateSoldierHud()` (map.html, called once per rendered frame from `frame()`,
right before `gameHud.paint()`) feeds:

| variable | value |
|---|---|
| `Soldier/ShowSoldierIcon` | `true` while on foot and not in a vehicle |
| `Vehicle/ShowVehicleIcon` | `true` while piloting the existing aircraft/car modes (see caveat below) |
| `Weapon/ShowWeaponIcon` | `true` while on foot with a hand weapon equipped |
| `Soldier/SoldierIcon` | `Soldier/Icon_<nation>_soldier_<standing\|crouching\|lying>.tga`, from `soldier.stance` and the spawn team's nation |
| `Soldier/SoldierHealthBarIcon` / `SoldierHealthBarFullIcon` | the current kit's `healthBarIcon`/`healthBarFullIcon` from `_shared/loadouts.json`, memoised per level/team/kit |
| `Soldier/SoldierHitPoints` / `SoldierMaxHitPoints` | seeded `30`/`30` (vanilla's real constant) with `??=`, so a real tracked value never gets stomped once P3 starts writing one — **not this track's data**, see below |
| `Ammo/AmmoType`, `PrimaryAmmo`, `MaxPrimaryAmmo`, `PrimaryMag`, `Ammo/SoldierAmmo/SoldierAmmoBar`/`Fill`/`Size`/`HasMag`/`Icon` | the equipped weapon's `hw.data` (`weaponStats` on the fp rig, `weapon` on the bare glb) and its live `rounds`/`mags` |

Everything else in `hud-layout.json` — `vehicleIcon`, `vehicleHealth`,
`vehicleSeats`, `primaryAmmo`, `secondaryAmmo`, `supplyIcon`, `hitIndicator` —
needs no code here at all: the painter is generic, so once P2/P3 write into
the same `window.__hud.vars`, those groups start drawing with zero changes to
`hud.js`.

## Which number is the magazine, which is the spares

The retail screenshot's two numbers are **not** the same count.
`Ammo/PrimaryAmmo` is the rounds currently chambered in the loaded magazine —
top-right, large, right-aligned (`hw.rounds`, decremented per shot, reset to
`magazine.size` on reload). `Ammo/PrimaryMag` is a separate int, the *spare*
magazine count — bottom-right, small, black, centred (`hw.mags`, decremented
per reload) — hidden only at the `-1` sentinel, which this branch never sends
since it only runs while a real magazine is equipped. verify-r1.md's R1-19/
R1-20/R1-23 pin the geometry and the `-1` gate; this file supplies which two
live fields answer them.

The weapon's own bar art overrides the layout's default (a Thompson pulls
`Ingame/Magbar_SMG_empty_32x64.tga` off its own `weaponStats.hud.ammoBar`, not
the vanilla rifle bar hud-layout.json ships as its sample) — confirmed
end-to-end in this round's headless run (see Verifying). A weapon whose
extraction predates that field (most of the corpus, at the time of writing —
`bf42/con.py`'s `hud` block is new this round) simply falls back to the
layout's own literal rifle-bar picture, which is the documented engine
behaviour for an unwritten cosmetic (HUD-1), not a gap.

## Fixed in `hud.js`: the tolerant-fallback bug

`hud-layout.json` carries a literal sprite key for every texture-bearing leaf
(`el.texture` / `el.picture` / `el.fillPicture` — verified for all 11 groups,
zero exceptions) precisely so a leaf whose live override is unfed still draws
the engine's own default art. The painter's `resolveTexture` was already
written to do exactly that — but `contentVarsOf` also listed `variable-picture`'s
`var` and `fill-picture`'s `pictureVar`/`fillPictureVar` as *required*, so
`_visible()` culled the whole leaf the instant a live texture var was unfed,
before `resolveTexture`'s fallback branch could ever run. That silently
defeated the fallback for every group, not just this round's — a kit or
weapon that does not override its own art would have shown nothing instead of
the game's own default picture. Fixed by only requiring fields with no literal
counterpart (`text`'s `var`, `fill-picture`'s `valueVar` — a number has no
meaningful placeholder; `occupied-seat`'s `dataRef`); every texture var is now
resolved tolerantly at paint time like `max`/`size`/rotation already were.
Confirmed safe by checking every leaf in the current `hud-layout.json` has a
literal fallback wherever it has a live texture var (no leaf can now resolve
to a silently-blank texture that previously culled instead).

## The car dashboard

`drive()` used to write "`<control>` · `NN km/h` · `gear N`" into the same
`#ammo` element the on-foot ammo line used. Dropped rather than folded into
`#hud`: that line is a timed announcement (`showView`, the spawn/flag text)
that overwrites itself on a 2.2s timer, and a per-tick dashboard string
competing with that timer would either starve the announcements or itself
flicker unreadably. `car.control`/`.gear` stay live on `window.__car` for a
headless check; the real replacement is the vehicle HUD panel due once a
seats track feeds `Vehicle/*` for the car the same way it will for every other
seat.

## Approximations, each with its open question

- **Nation key for the stance icon (R1-12, open).** The engine's own lookup
  was never traced. Approximated with the same per-side nation the deploy
  screen's kit art already resolves (`teamNation`), translated only where the
  icon set's own filenames diverge from `hud.json`'s `flagMeshNation` table —
  Japan is `icon_jap_soldier_*` in the sprite pack but `jp` in that table, an
  asset-naming difference this file already had to bridge for other reasons,
  not a new engine fact.
- **`Soldier/SoldierHitPoints`/`MaxHitPoints` (30/30 seed).** This is P3's
  variable pair (BRIEFING2's supply-and-health section); nothing in this
  worktree tracks damage. Seeded once with vanilla's real constant
  (`CommonSoldierData.inc`) via `??=` purely so the fill layer has something
  to paint before that track lands, and to never fight a real value once it
  exists. Not a claim about what the engine would show for a damaged soldier.
- **`Ammo/SoldierAmmo/SoldierAmmoHasMag` (fed unconditionally true).** No
  `.con` word or client write-site for this flag turned up in R1's survey.
  Fed true whenever a magazine weapon is equipped so the spare-count readout
  ever shows at all — an assumption, not a confirmed default.
- ~~**`Ammo/AmmoType` for `ATIcon` weapons (fed as `6`, R1-18 open).**~~
  **Closed and corrected 2026-09-19 — it is `2`.** This bullet used to say the
  layout's icon-only branch covered both 6 and 7, that either painted
  identically, and that 6 was picked arbitrarily. HUD-10 read the client's own
  `operator>>` (`0x004c4cd0`) in full and re-walked the layout, and the
  premise was wrong: 6 is `ATIconAndHeatBar` (vanilla's MedPack alone) and it
  lands in the `{6,7}` panel, which has **no rounds text at all**, while
  `ATIcon` = 2 lands in the `{2,3,4,5}` panel, which prints one. So every AT
  weapon in the game — Bazooka, Panzerschreck, ExpPack, Detonator, Landmine —
  was drawing a rocket icon with no count beside it. See
  [2026-09-19 (stream C)](#2026-09-19-stream-c-the-dial-the-dots-and-the-ammo-enum)
  below.
- **Per-weapon `SoldierAmmoPosX`/`PosY` overrides are not applied.**
  `hud-layout.json`'s rect is baked once from `menu/InGame`'s own defaults
  (`(696,517)`), not a live-bound position — only one surveyed weapon
  (`JohnsonLMG`, `5/-11` against vanilla's `6/-17`) is known to diverge, and
  its bar would draw one pixel off vanilla's own rect if reached. Not fixed
  this round: the layout format has no live-position mechanism to feed.
- **`inVehicle`/`Vehicle/ShowVehicleIcon` (STALE, corrected in round 3's
  parity audit).** This bullet used to read "reflect only the pre-existing
  aircraft/car modes (`optPilot.checked && (aircraft || car)`)" and ask for a
  seats track to fold its own state in. Seats landed (round 2, P2) and did
  exactly that: `updateSoldierHud` now reads `optPilot.checked && !!occupancy`
  — any seat at all, gun/seat root or nested, not only a drivable one. Left
  the stale wording in place through round 2's own docs pass; corrected here
  rather than deleted so the history is visible. See the round 3 section
  below for what is still actually open on the vehicle-seat side.
- **FillOrder on a horizontal bar (R1-31, settled as "no effect", but which
  edge is fixed was never decompiled).** Moot for every leaf this round
  actually feeds — none is horizontal — so `hud.js`'s own horizontal branch is
  an unexercised placeholder (see its code comment), not a reproduction.
- **Which edge a vertical bar's `size`-tall window sits flush against when
  `size < h` (found during round-2 review, R1-30 territory).** The health bar
  is the only FillOrder-true leaf any current feed reaches, and it has
  `size == h` (64 == 64), so it cannot tell "flush with the picture's real
  bottom edge" apart from "flush with a point `size` down from the top" — the
  review pass caught `_drawFillPicture`'s true-branch doing the latter (only
  correct by coincidence at `size == h`) while its own comment and the
  false-branch both assumed the former, and fixed it to the bottom-flush
  reading consistently. Recover's bar and the soldier ammo panel's own
  heat/reload fills all ship `size < h` with `fillOrder: true` and are P2/P3's
  to feed, so this is the first round anyone will actually see the corrected
  edge — still an approximation, not a data-confirmed one, until a verifier
  reads it.

## Verifying it

Served from this worktree on port 5421 (`python3 -m http.server 5421
--directory tools/bf1942-models/viewer`), loaded headless
(`map.html?mod=bf1942&map=wake&shots&weapon=Thompson`), spawned on foot at
Wake's `Landing_Beach` (Allied): `window.__hud.vars` came back with every
expected key, including the Thompson's own SMG-specific bar art and size
(`Ingame/Magbar_SMG_empty_32x64.tga`, size 46 — not the layout's rifle-bar
default), `Ammo/PrimaryAmmo: 30` / `Ammo/PrimaryMag: 4` matching
`window.__handWeapon().rounds`/`.mags` exactly. Canvas crops of both HUD
corners and the composited full frame confirm the art: a segmented
orange-striped health bar with the assault kit's rifle glyph baked into its
own foot, the standing-soldier figure beside it, and the SMG magazine picture
with "30" top-right and "4" in the small box bottom-right — see this round's
final report for the file paths. `?weapon=` was required because this
worktree's `viewer/models/` carries only two viewmodel rigs (`USSoldier__
Thompson.fp.glb`, freshly re-extracted so it carries the new `weaponStats.hud`
block; `GermanSoldier__MP40.fp.glb`, stale) and no bare per-weapon glbs at
all — a fresh worktree has neither `viewer/maps` nor `viewer/models`, and only
those two viewmodels were populated for this round's testing, so the
kit-driven weapon a normal spawn would pick 404s.

## Round 3: parity audit against the retail screenshot

| element | retail | ours (before) | ours (after) | verdict | action |
|---|---|---|---|---|---|
| Soldier health bar (fill dir/extremes) | segmented, bottom-anchored, fills up | correct (1/30 sliver pixel-confirmed) | unchanged | MATCH | none |
| Health-bar kit glyph | scope/cross/wrench/etc per kit | correct, confirmed on live respawn | unchanged | MATCH | none |
| Stance figure (stand/crouch/prone) | 3 distinct sprites | correct, all 3 resolve | unchanged | MATCH | none |
| Hand-weapon magazine bar (art + fillOrder) | per-weapon art, depletes top-down | correct (BAR1918 curved mag, fillOrder:false) | unchanged | MATCH | none |
| Ammo digit formats (2/3-digit, -1 sentinel) | no clipping, box hides only the digit | correct | unchanged | MATCH | none |
| Reload state | 0 rounds, empty bar, no overlay | correct, matches R1-24 | unchanged | MATCH | none |
| Vehicle icon (Defgun/Sherman) | small photoreal render | painted correctly, hidden by a scale bug in the *checker* | unchanged (the checker was fixed) | MATCH (test bug, not product) | fixed frame()'s hudW/hudH |
| Vehicle health bar | distinct olive art | correct | unchanged | MATCH | none |
| Seated ammo panel number (Defgun, 1-weapon) | shows the loaded count | icon+bar only, no digit | "499" renders | BUG -> FIXED | fed `Ammo/PrimaryAmmoText` |
| Seated ammo panel numbers (Sherman Browning seat, manned) | shows the loaded count | icon+bar only, no digit | "500" renders | BUG -> FIXED | fed `Ammo/{Primary,Secondary}AmmoText` |
| Seated ammo panel numbers (Sherman root, 2-weapon drivetrain) | shows live count/heat/reload | icons only, both bars absent (not just un-numbered) | unchanged | GAP, pre-existing | left open — needs `drive()` to fire through a gated `FireState`, outside this track's files |
| Turret-turn dial (vehicleIcon group) | rotating top-down turret indicator | never drawn | unchanged | GAP, open | left open — R2-18's trigger condition and angle convention are both unsettled |
| Headless HUD/3D-scene scale under `__renderOnce` | n/a (never seen live) | HUD painted ~76px short of the 3D frame | matches exactly | BUG -> FIXED | `frame()` now reads the renderer's own backing store |

Crops: `scratchpad/t3/before_after_defgun_ammo_sidebyside.png` (the ammo-number
fix, before/after in one image), `01-onfoot-standing_bl_zoom.png`/`_br_zoom.png`
(baseline vs retail's own `retail_a1_bl_zoom.png`/`_br_zoom.png`),
`06-health-near-empty_bl_zoom.png` (low-HP extreme), `12-kit-respawned-
{scout,medic}_bl_zoom.png` (kit-glyph swap), `08-ammo-{100-12,7--1}_br_zoom.png`
(digit-format extremes), `10-reloading_br_zoom.png` (reload state),
`61-hudonly-defgun.png` (isolated HUD canvas proving the vehicle icon painted
even before the scale fix).

Track T3. The user's reference (BRIEFING.md's own record of it: a 2000x1125
retail capture, Japanese soldier on a carrier deck) was never saved to a file
in this repo — it was shown directly in an earlier session. In its place this
pass used two things as ground truth: the numbers verify-r1.md/verify-r2.md
already pulled out of the game's own `menu/InGame` (the authority for every
rect), and a set of genuine BF1942 retail screenshots found in another
session's scratch directory (`.../9049dd0c.../scratchpad/retail_*.png` —
different soldier/location, same universal HUD chrome) for a visual sanity
check the corpus numbers alone can't give: real segment colours, a real
mid-reload magazine bar, a real 3-digit-adjacent ammo count. Own captures came
from this worktree's `map.html` on Wake (which now carries a live Defgun and
Sherman), headless via Playwright/SwiftShader, `window.__setAmmo`/`__damage`/
`__deploy.setKit`/`__switchSeat` driving the extremes directly rather than
waiting on real play to reach them.

**Fixed, both in `feedVehicleHud()` (map.html):**

- **The seated ammo panel never showed a number.** `hud-layout.json`'s vehicle-
  skin ammo panel prints `Ammo/{Primary,Secondary}AmmoText` — a name the real
  client registers from a *different* function (R2-12) than the
  `PrimaryAmmo`/`MaxPrimaryAmmo`/`PrimaryMag` trio the soldier-skin panel's own
  text binds directly (R1-20). `feedVehicleHud` fed the second trio and never
  the first, so a seated Defgun or Sherman drew its icon and its reload/heat
  bar correctly but never a digit. Confirmed two ways: the lead's own
  pre-fix capture (`scratchpad/lead/int-4-defgun-fired.jpg`) shows an empty
  box next to the shell icon; this track's own post-fix capture
  (`scratchpad/t3/20-defgun-seated.jpg`, vars dump alongside it) shows "499".
  Fixed by mirroring the same live `primary.ammo`/`secondary.ammo` value onto
  the new name too — neither verify-r2.md nor the layout's own notes settle
  whether the real engine ever lets `*AmmoText` diverge from the live count,
  so this is a mirror, not a confirmed reproduction, but an unfed variable was
  a confirmed-wrong "no number ever," strictly worse.
- **The HUD scaled to the wrong stage size under every headless capture.**
  `frame()`'s HUD-paint call read `stageWidth || renderer.domElement.width /
  pixelRatio`, on the belief that `stageWidth`/`stageHeight` are 0 under
  `?shots`/`__renderOnce`. Measured live (a real Playwright page, viewport
  1280x800): they are not — `resize()` runs once, synchronously, at load,
  and stamps them with `stage.clientWidth/Height` at that moment (1280x724;
  the shared nav bar's own row costs 76px) and nothing ever resets them once
  `__renderOnce` starts forcing the *renderer* to a different size for the
  screenshot itself. The `||` therefore always kept the stale, pre-
  `__renderOnce` figure, so the HUD painted 76 CSS px shorter than the 3D
  frame it was merged with — invisible in a live browser (`resize()` keeps
  the two in lockstep there) but a real, silent misalignment in every
  headless capture this whole project's recipe (BRIEFING2.md's own
  `__renderOnce(1600,1000)`, or any other explicit size) produces. This is
  what made this track's own first Defgun capture look like the vehicle icon
  was missing entirely — it was not: `window.__hud.sprite('icon_defgun')`
  was loaded and the isolated `hud-canvas` read alpha 255 over its own rect
  the whole time, 76px higher than a naive 1:1 merge went looking for it
  (`scratchpad/t3/auditE-results.json`). Fixed by always deriving `hudW`/
  `hudH` from the renderer's own current backing store — provably identical
  to `stageWidth`/`Height` in ordinary play (the one call site that sets
  both, `resize()`, always sets them together from the same read) and, unlike
  the old fallback, also correct under `__renderOnce`, which only ever
  touches the renderer's own size.

**Left open, not fixed — the engine's own behaviour is unsettled or the fix
lives outside this track's files:**

- **`Vehicle/ShowTurretIcon`/`IconLookRotation` are still never fed.** The
  turret-turn dial (back-plate, pipe, rotating body — `vehicleIcon` group)
  never draws for any seat, Defgun or Sherman included, because nothing sets
  the bool that gates the whole group. Left alone: R2's own Open section
  marks *both* the trigger condition ("when does the real engine set this")
  and the angle's own unit/sign/pivot as unsettled (R2-18) — feeding a guessed
  `true` would draw a turret dial pointing somewhere this round has no
  engine-confirmed basis for, which is a worse kind of wrong than a
  consistently-absent group.
- **A drivetrain root's own guns still show no live ammo/heat/reload —
  confirmed for the Sherman specifically, not just aircraft/car.** The
  existing `feedVehicleHud` comment already explained why: `drive()`/
  `pilot()` fire `vehicleGuns` unconditionally, never through a gated
  `FireState`, so building one just for the HUD would silently decrement
  with nothing stepping it back. What this pass adds: `setPilot` now builds
  a tank's drivetrain into the *same* `car` variable a wheeled vehicle uses
  (`kind === 'ground' || kind === 'tank'` both do `car = vehicle` —
  `map.html` ~3647), so `mannedActive()`'s existing `aircraft || car` check
  already, correctly, treats the Sherman's own driver/gunner seat as a
  drivetrain root, not a manned gun — confirmed live: switching to it
  (`window.__switchSeat(0)`) feeds `Ammo/PrimaryAmmoIcon`/`PrimaryAmmoBar`/
  `SecondaryAmmoIcon`/`SecondaryAmmoBar` correctly (cannon+ReloadBar,
  coax+HeatBar, matching R2-30 exactly) but never `Ammo/PrimaryAmmoText`/
  `Overheat/OverHeat`/`Ammo/ReloadTime` (`scratchpad/t3/auditF-results.json`,
  `pos_0`) — the SAME gap the car-dashboard note already flagged, now
  reproduced on a real gun-carrying vehicle rather than a Willys with nothing
  to show. On screen this is not merely an un-numbered bar: `hud.js`'s
  `fill-picture` leaf lists its own `valueVar` as required
  (`contentVarsOf`/`_requiredVars`), so with `Ammo/ReloadTime`/
  `Overheat/OverHeat` both absent the whole leaf is culled — the reload and
  heat bars (both layers, empty and full) never draw at all, leaving only
  the two weapon icons. Re-verified this pass against the same
  `auditF-results.json` `pos_0` object (confirmed by this round's own review,
  not a new capture): every key the reload/heat leaves require is missing,
  not merely their live value. Retail clearly does show this (a Sherman
  driver watches their own shell count), so this is a real parity gap, not a
  documentation nit.

  **What 2026-09-19 added (ledger VHUD-10).** The registrar tables are now
  read: the `Ammo` weapon-icon group holds thirteen variables, and among them
  are **`UnlimitedPrimaryAmmo` (+0x6d) and `UnlimitedSecondaryAmmo` (+0x6e)** —
  they do exist, as bools on that group, closing this file's separate "no match
  under any spelling" item — plus `SecondaryAmmoIcon` at +0x44, which the first
  reading missed. The `Overheat` group holds only `OverHeat` (float +0x8),
  `ShowRecover` (**int** +0xc) and `Recover` (float +0x10); **`SniperSight`
  belongs to the `CrossHair` group**, not this one. The shared feeder computes
  `1 − (heat/heatMax or reload/reloadMax)` with a 0.1 dead band and heat
  winning — an *inverted* feed, which matters for anything that eventually
  drives those bars. What is still not found is the client instruction that
  writes `Ammo/PrimaryAmmoText` for a drivetrain root, so the gap above stays
  open; and
  closing it means changing how `drive()` fires (a gated `FireState` per
  `vehicleGuns` entry instead of the unconditional `setFiring` it uses today),
  which is outside `feedVehicleHud`/`hud.js`'s files. Flagged here for
  whoever owns `drive()` next; the nested Browning seat (a true manned seat)
  already gets this correctly through the fix above.

**Verified correct, no change** (each checked live, not just read off the
layout): the health bar's fill direction and magnitude at both extremes —
sampling the rendered pixels (not just eyeballing) confirmed a 1 HP / 30 max
sliver actually draws, matching the bottom-anchored fill-up formula rather
than snapping to empty; five kits' distinct health-bar glyphs swap correctly
on a real respawn (scout's scope, medic's cross — `12-kit-respawned-
{scout,medic}.jpg`); crouch/prone both resolve their own distinct sprite;
a magazine weapon's own bar art overrides the layout default and its
`fillOrder:false` depletes from the top down, matching the file's own data;
2-digit, 3-digit and the `-1` spare-mag sentinel all format correctly (no
clipping, box hides only the number, never its frame); a reload shows 0
rounds and an empty bar with no separate overlay, matching R1-24; the
vehicle health bar's own distinct olive-toned art (vs. the soldier's orange)
renders correctly; and, once the stage-size bug above was fixed, so does the
vehicle icon itself — `Vehicle/Icon_defgun.tga`/`Vehicle/Icon_sherman.tga`
are small photorealistic-style renders of the vehicle, not abstract symbols,
which is exactly why a misaligned first look mistook one for real scene
geometry.

## 2026-09-17: the vehicle panel's reload bar, and the `size < h` question

Reported from play, alongside the drivetrain (see `ground-vehicles.md`): the
Sherman's HUD "doesn't look right", and "firing is unlimited projectiles —
in game they fire, then it reloads for a few seconds, then fire again."

### `size < h` is settled by the sprite pack, not left open

The round-2 notes above list "which edge a vertical bar's `size`-tall window
sits flush against when `size < h`" as an approximation, on the grounds that
the health bar (the only leaf any feed reached) has `size == h == 64`, where
every candidate formula coincides. The vehicle panel's heat and reload bars
are the first leaves to actually reach it, and measuring the opaque rows of
every bar sprite the layout names answers it outright:

| sprite | opaque rows of 64 | leaf's `size` | leaf's `fillOrder` |
|---|---|---|---|
| `reloadtimebar_empty/full_32x64` | 0..41 (top) | 42 | true |
| `heatbar_empty/full_32x64` | 0..41 (top) | 42 | true |
| `rocketpackbar_full_32x64`, `staminabar_full_64x32` | 0..41 (top) | 42 | true |
| `magbar_rifle_empty/full_32x64` | 44..63 (bottom) | 20 | **false** |
| `ammobar`, `healthbar`, `vehicle_healthbar`, `medicbar` | 0..63 | 64 | true (decides nothing) |

No exceptions across the file, and `magbar_rifle` is the layout's only
`fillOrder: false` leaf. So FillOrder picks both the window's flush edge and
the direction the fill grows inside it: **true anchors the window to the
rect's top** and grows the fill up from the window's own bottom; false anchors
it to the bottom and grows the fill down from the window's top. At `size == h`
the true branch is `y + h - scaled`, term for term what `hud.js` already had,
so the health bar and every other confirmed leaf is unchanged.

What it fixes: a 42-tall bar in a 64-tall rect was clipping its fill into rows
22..64, which on top-anchored art is 20 rows of real bar and 22 rows of
transparent padding. The vehicle panel's reload bar could not draw a fraction
below 0.52 at all, and drew the rest at half height — which is why, with the
variable fed, it still looked like a bar that never moved.
`tests/test_hud.py` + `hud_harness.mjs` cover the geometry headlessly (a
recording 2D-context stub; `hud.js` imports nothing, so no assets are needed).

### `Ammo/ReloadTime` is a readiness bar, not a magazine-reload bar

`reloadFraction` read `state.reloadRemaining / reloadTime` alone. On a tank
cannon that is a bar which never moves: a Sherman's `reloadTime` is 0.35 s and
only runs once its whole 30-round magazine is out. What the player waits
through between shells is the `roundOfFire` cooldown — 1/0.35 s = 2.86 s —
which lives on the `GunFire` group, not on `FireState`. `readyFraction` now
takes whichever of the reload, overheat and fire-rate timers is still
running, which is the same set GUN-5 has `isReadyToUseFire` gating on.

Two details worth keeping:

- **Which group's clock.** A drivetrain root's FireArms end up in *both*
  `mannedGuns` and `vehicleGuns`, because `collectMannedGuns()` collects
  whatever `occupancy.activeFireArmsNodes()` names and for the root seat that
  is the same pair of nodes `collectGuns()` already put in `vehicleGuns`.
  Only one copy is ever fired, so reading the idle one's `cooldown` is reading
  a clock nothing winds — the bar came back "ready" a frame after the shell
  left. `fireGroupFor` asks `mannedActive()` first, the same test `frame()`
  uses.
- **Direction is a choice, not a reproduction.** It fills as the weapon
  becomes ready, empty right after the shot. Nothing in verify-r2.md or
  `hud-layout.json` settles which way this bar runs (VHUD-10 is open on the
  whole live-value question for a driver's own weapons). Chosen this way round
  because the alternative draws a *full* bar at the exact moment the gun
  cannot fire, which reads as "loaded" at a glance.

### `numOfMag` counts the loaded magazine

`FireState` read it as the spares *beside* the loaded one, so a Sherman
(`magSize 30`, `numOfMag 1`) carried 30 shells plus a free reload and put
`Ammo/PrimaryMag: 1` on the panel. `map.html`'s hand weapon has always read it
the other way (`hw.mags = magazines - 1`, which is what puts a Thompson's
confirmed 30/4 on the HUD rather than 30/5); the seat path now agrees, so the
variable means the same thing in a seat as it does on foot.

### The firing bug behind "unlimited projectiles"

Not a HUD bug at all: `GunFire.setFiring` zeroed the rate-of-fire cooldown on
every rising trigger edge, on the reading that "the first round leaves
immediately" — true, but only once the gun already owes you one. Because the
timer only ran while the trigger was held, releasing and re-pressing handed
back a fresh round every time, and tapping fired a Sherman's whole 30-round
magazine in a single second (28 shells in 60 frames, reproduced headless).
The timer now runs with the trigger released too, floored at zero. GUN-5 lists
the `roundOfFire` cooldown as one of `isReadyToUseFire`'s own gates beside the
reload and overheat timers, not as something a trigger edge clears. Covered by
`test_seats.py`'s `triggerCadence` block, which drives the real `GunFire`
rather than a re-implementation of its cadence.

### Still missing from the vehicle HUD

> Both bullets below were closed on 2026-09-19 — see
> [2026-09-19 (stream C)](#2026-09-19-stream-c-the-dial-the-dots-and-the-ammo-enum).
> Kept as written because each one's own reasoning is part of the correction.

- ~~**The turret-turn dial**~~ — **drawn as of 2026-09-17**, once a tank's
  driver could actually traverse (`seats-and-manned-guns.md`). Fed as
  `Vehicle/ShowTurretIcon` plus `IconLookRotation` in radians, gated on the
  active seat having a traverse at all, so a seat with only elevation or none
  leaves all three leaves culled as before. VHUD-9 is still open on what the
  engine sets `ShowTurretIcon` from and on the angle's unit, sign and pivot;
  the sign here was settled by looking at it. The dial's fixed barrel points
  up, i.e. screen-up is where the gun looks, so with the turret 90 degrees
  right the hull belongs at 9 o'clock — which on a canvas whose positive
  rotation is clockwise is the traverse itself, not its negative.
  `angleMultiplier` is carried by the extractor and still unread, so it is not
  applied. **(The picture that argument reaches is right; the arithmetic is
  not — `RotateEffect` is counter-clockwise, and it was `headingRadians()`'s
  own sign flip that was cancelling the error. VHUD-9, below.)**
- ~~**The seat-occupancy dots** (`vehicleSeats`) are unfed.~~ The five states
  are known (VHUD-2) and this page knows which seat is occupied, but the dots'
  *positions* are live-bound per vehicle (`VehiclePosX1..6`/`PosY1..6`,
  VHUD-7's `(192+X[i], 452+Y[i])`) and nothing in the extracted data carries
  them. Feeding states against the layout's own sample rects would draw six
  dots in a diagonal staircase over every vehicle icon, which is inventing
  placement — the one thing this painter's own rule says not to do. **(The
  reasoning stands; the premise does not. `setVehicleIconPos` is a `Vec2` on
  every PlayerControlObject template and `con.py` simply had no hit for the
  word — VHUD-11, below.)**

## 2026-09-19 (stream D): two more groups, and the painter learned to wrap

Two top-level entries of `menu/InGame` that `extract_hud_layout.py` had never
decoded now come through as groups, which is all this file's generic painter
needs to draw them — neither needed a line of `hud.js` beyond the wrap below.
`RAW_TOPS` is now thirteen entries.

### `tickets`

`(620,4) 256x32`, gated on `ShowTicket`. Nine leaves: the bar plate, and per
side a flag, a black drop shadow, the team-coloured count and a low-ticket
blink quad. Fed from `scene.json.tickets` by `feedTicketVars` in `map.html`;
the whole story is in [`tickets-hud.md`](tickets-hud.md). Worth noting here
only because it is the first group this painter drew that the spawn screen
draws too — the counter is a sibling of `Kit/ShowKit` in the file, not a child
of it, so the same nine leaves serve both surfaces.

### `outside` — the combat-area warning

`(305,171) 256x64`. The first group in this file whose gate is a **comparison
rather than a bool**: `0 < Outside/OutsideTime`, a `LessData` cull with no
symbol of its own, which `leading_culls` reports as the anonymous `("?", "")`.
So `RAW_TOPS` picks it out by rect. There is no `Show*` flag; feeding a zero
countdown is how the layout is told to draw nothing.

Three leaves:

| leaf | rect | detail |
|---|---|---|
| plate | (305,171) 256x64 | `textmessbg_3line_256x64` |
| countdown | (536,189) 20x20 | `Outside/OutsideTime`, right-aligned, `Trebuchet MS11 - Latin` |
| warning | (310,174) 230x40 | `Outside/OutsideText`, `Trebuchet MS8`, colour `Outside/Color/{Red,Green,Blue}` = `(0.8516, 0.3516, 0.3516)` |

The warning's own Wstring default is
`"Warning! You are leaving the combat area! Desserters will be shot!"` —
misspelling included, and **not** the lexicon's `DESSERTION_MESSAGE`
("Warning! You are leaving combat area. Deserters will be shot."), which is a
different wording this node never reads. Both strings exist; only one is on
screen.

What feeds it, and what the game does after the countdown reaches zero, is in
`viewer/combat-area.js` and its own header — a ten-second allowance
(`Game::setTimeAllowedOutSideWorld`, default at 0x08131dbb) and then 5 HP a
second (`GameServer::setDamageForBeingOutSideWorld`, default at 0x08131db1),
applied as `dt * damage` every frame. `hud.js` needs none of that; it gets an
integer and a string.

The three plates (`textmessBG_1line_256x32`, `_2line_256x32`,
`_3line_256x64`) were added to `extract_hud_pack.py`'s `SPRITES`. The 1- and
2-line ones back the spawn-point and status messages that share the widget
family and are not fed yet; they came across together because the set is one
thing.

### The painter wraps now

The warning is the first leaf whose string does not fit its own rect: 65
characters of Trebuchet MS8 in a 230 px box. Drawn on one line it ran a third
of the way off its own plate — and the plate settles the question, because the
data names it `textmessBG_**3line**_256x64`: three lines of art for one
string.

`_drawText` now wraps when the string measures wider than the rect **and** the
rect has room for another line (`h >= lineHeight * 2`). Both conditions
matter: every leaf this file fed before — ammo counts, kit names, ticket
counts — is short and single-line-height, so none of them can start wrapping.
A single word wider than the box is left to overflow rather than split,
because hyphenating a bitmap font means inventing glyph metrics and the one
string this exists for has no such word.

`wrapText` is exported for the harness: everything else in the text path goes
through a tinted glyph atlas, which needs a real canvas, and the wrap is the
part with a decision in it. `tests/test_hud.py` covers the warning's own two
lines, the no-op cases, and the long-word case, against a fixed-width
stand-in font.

### Verified

Stalingrad, on foot, teleported outside the combat area, read off
`window.__hud.canvas`: the plate, the warning wrapped into two lines inside
it, the countdown right-aligned in its corner, and the ticket bar above
showing Soviet 100 against German 100
(`scratchpad/d-wiring/combat-hud.png`). `window.__hud.layout.groups` reports
thirteen groups. Back in the area, `Outside/OutsideTime` goes to 0 and the
group culls whole.

### 2026-09-20 review: the group was never culling

The verification above read `Outside/OutsideTime` going to 0 and stopped
there. It does go to 0 — and the group still drew, on every level, including
the twelve vanilla ones that declare no combat area at all. Captured on Wake
(no area, countdown permanently 0) at `scratchpad/rd-wiring/out/`
`wake-soldier-head.png`: the plate and all 65 characters of the warning sit
across the middle of the soldier HUD and the vehicle HUD.

The cause is in this file's own condition evaluator, not in the group. This
is the first group whose gate is a comparison, and the extractor renders
`0 < Outside/OutsideTime` as `{var, op: "gt", value: 0}` — its `FLIP_CMP`
table turns a `LessData` with the literal on the left into `gt`. `condOk`
answered `eq`/`ne`/`lt`/`le` and ended in `default: return true`, which does
not cull. So did `ge`, which the weapon-select bar has used for its fifth and
sixth slots since that group landed: a four-item kit drew six slots.

Both operators are implemented now, in `hud.js` and in `map.html`'s copy, and
`tests/test_hud_layout.py` reads the operator names back out of both sources
and fails if the extractor can emit one they do not name. The permissive
default cannot be relied on to cull, so nothing should ever reach it again.

### 2026-09-20 review: the wrap change, proved against the old painter

The wrap is safe, and this is the measurement rather than the argument. The
same page was served twice — `viewer/` at HEAD on 5324, and an identical tree
with only `hud.js` replaced by its `e1186ff` copy on 5325 — and the deploy
screen, the soldier HUD and the vehicle HUD were rendered and their canvases
differenced pixel for pixel on Wake:

| surface | differing pixels | where |
|---|---|---|
| `#deploy-chrome` | **0** of 1280x724 | — |
| `#hud-canvas`, on foot | 2,865 of 1280x800 (0.28%) | x 496..1069, y 232..256 |
| `#hud-canvas`, in a seat | 2,865, identical bbox | same |

That bounding box is the warning text leaf's own rect and nothing else: the
plate under it is pixel-identical in both builds, and so is every other leaf
on all three surfaces. No leaf that existed before this round moved.

## 2026-09-19 (stream C): the dial, the dots, and the ammo enum

Three things this file recorded as open or approximate were closed against the
binary in the parity round, and one of them was wrong in a way that had been
invisible because a second error was cancelling it.

### VHUD-9: the dial's trigger is the word, not the rig

```
ShowTurretIcon = (activeSeatCamera.getViewMode() == 3) && pcoTemplate.getHasTurretIcon()
```

Client `0x006ae597`–`0x006ae5d1`. Both halves were missing here: the dial was
gated on "the active seat has a traverse", in any view. What that turns off:

- **A casemate hull.** The Wespe, the Priest and the StuG class aim inside a
  mantlet and never declare `setHasTurretIcon` — no vanilla casemate does.
  They got a dial; they no longer do.
- **Every chase view.** `viewMode == 3` is the inside view; the enum's own
  numbering was not derived, only that 3 is the one that shows the dial. The
  page passes `mannedActive() ? true : !!view?.firstPerson` — a manned gun has
  no view cycle at all, which is the one view retail gives it.
- **A nested seat.** The engine queries the **controlled** PCO's template, and
  the word lives on vehicle roots only, so a Sherman's hull gunner gets none.
  `activeHud()`'s root fallback is deliberately not used for this.

`setHasTurretIcon` is new in `bf42/con.py` — 10 sites on 7 distinct vanilla
templates (Sherman, Tiger, PanzerIV, T34, T34-85, M10, Chi-ha), 4,158
declarations across 18 installs, always on the root PCO. A scene baked before
this shows no dial at all until it is re-extracted, which is the right
failure: the alternative is keeping the wrong dial on every casemate hull.

### VHUD-9: the dial turned the wrong way, and looked right anyway

`RotateEffect` computes `x' = x·cos + y·sin`, `y' = −x·sin + y·cos` about the
pivot (client `0x007edbf0`), so on the HUD's y-down frame `(0,−1)` at +90°
becomes `(−1,0)`: **the sprite's top goes left, counter-clockwise on screen.**
HTML canvas `rotate(+θ)` is clockwise. `hud.js` had the wrong one — and the
picture was still right, because `map.html` fed it through
`TurretRig.headingRadians()`, which carries `seats.js`'s own
`RIG_SIGN.yaw = −1`. Two errors cancelling.

They are now separated, in one commit because half of it mirrors the dial:
`hud.js` rotates by `−angle`, where the convention mismatch actually is, and
`map.html` feeds `turretYawRadians()` — the engine's own value, positive to
the controlled PCO's right. The previous bullet's "settled by looking at it"
argument reached the right picture by the wrong arithmetic and is corrected
above rather than deleted.

The unit is **radians**, confirmed twice (the engine's value is an `FPATAN`
result), so the old OPEN comment is gone. `angleMultiplier` is still not
applied, and now for a reason: it scales a draw-context scalar rather than the
bound variable, and all seven vanilla `RotateEffect`s author it as `0`.

**Proved identical, not argued identical.** The dial was captured off the real
painted `hud-canvas` at turret yaw +90° and −90° before and after the pair,
from two servers differing only in those files, and the crops differenced.

### VHUD-11: the dots' positions were carried all along

`ObjectTemplate.setVehicleIconPos <x>/<y>` is a `Vec2` on the
**PlayerControlObject** template — the root and every seat carry their own —
giving that seat's dot position inside the 128×128 vehicle-icon texture. That
is exactly the space VHUD-7's `(192 + X, 452 + Y)` anchor works in: Sherman's
root `54/103` lands at (246, 555), inside an icon panel that starts at
(200, 462). `con.py` had **zero hits** for the word; that, not the engine, is
why this file said the positions were "live-bound per vehicle".

Surveyed across 18 installs: **18,352 declarations**, of which all but three
are a single `x/y` token (two space-separated, one empty — an empty one is
dropped rather than read as 0/0, or every dot stacks in one corner). Vanilla
range X 12…99, Y 43…120.

States are VHUD-2's own five-entry table (`BfOccupiedVehicleData`'s vtable
`0x0093f300`, read as raw bytes): 0 blank, 1 `vehicledot_local`, 2
`vehicledot_empty`, 3 `vehicledot_friend`, 4 `vehicledot_enemy`. **Which live
state a given seat resolves to was never read**, and this page does not
pretend otherwise: the seat you are in is 1, every other declared seat is 2,
and nothing invents a 3 or a 4 — there are no other occupants on this page to
be one. A seat whose extract has no position pair keeps the layout's own
literal rect.

### HUD-10: `ATIcon` is 2, so a bazooka shows its rocket count

The `.con` word and the `.meme` value are **the same enumeration** — the
client's `operator>>` (`0x004c4cd0`) was decompiled in full and every stored
value read — so there is no converter to write and the weapon's own declared
type goes straight through:

| `setHudAmmoType` | fed | draws |
|---|---|---|
| `ATNone` | 0 | nothing (the two knives) |
| `ATAmmoBar` | 1 | magazine panel, fill bar, rounds, mag box |
| `ATIcon` | **2** | panel, icon, **rounds** — Bazooka, Panzerschreck, ExpPack, Detonator, Landmine |
| `ATIconAndStrengthBar` | 3 | panel, icon, rounds, bar — grenades |
| `ATIconAndReloadBar` | 4 | panel, icon, reload bar, no rounds — RepairPack |
| `ATIconNoText` | 5 | panel, icon |
| `ATIconAndHeatBar` | 6 | panel, icon, heat bar — MedPack |

The old reasoning — "6 and 7 paint identically, so the choice is arbitrary" —
had the wrong premise. 6 lands in the `{6,7}` panel, which has **no rounds
text**; 2 lands in `{2,3,4,5}`, whose rounds text is gated `ne 4 && ne 5 &&
ne 6`. Which types print a count is therefore read off the layout rather than
chosen: `test_hud_layout.py` asserts the real archive's own `when` list, and
`hud_harness.mjs` runs `hud.js`'s own evaluator over it, and exactly 2 and 3
survive.

Both tables live in `hud.js` beside the rest of the layout's vocabulary so the
node harness can drive them. Nothing was added to the extractor:
`setHudAmmoType` has been parsed since before this round (`con.py:1875`–`1883`
→ `hud_ammo_type`, emitted as `hudAmmo`), and the claim that it was a missing
word is false.

### Still open here

- Which live state a seat's dot resolves to (VHUD-2's second half). This page
  can only ever answer "you" versus "not you".
- The engine's `viewMode` enum numbering. Only "3 is the inside view" is
  established; the page maps it onto its own first-person state.
- VHUD-10's live writer: the heat/reload feeder writes **`1 − f`** and its
  destination group is still `[this+0x14]`, unidentified. Nothing here feeds
  it yet.

### Verified on the page

Served from this worktree on **5333** over a scratch re-extract of Kasserine
Pass made with this branch's own `con.py` (the shared `viewer/maps` tree is
read-only this round, and the dial's new gate needs `setHasTurretIcon` in the
scene), with **5334** serving the identical tree at `f9f144d` — the commit
before the sign pair — so the two differ only by the files under test.

| check | before | after |
|---|---|---|
| dial crop at exactly +90° and −90° | | **byte-identical PNGs** |
| what a +90° turret feeds | −1.5708 into `rotate(+θ)` | +1.5708 into `rotate(−θ)` |
| Sherman driver, chase view | 4711 opaque texels | **0** |
| Sherman hull gunner | 4711 | **0** |
| Wespe gunner seat (two aim axes, no `setHasTurretIcon`) | 4711 | **0** |
| Hanomag: six dots | absent | **39/75, 40/65, 30/59, 41/55, 20/49, 31/45**, local dot following the seat |

And the ammo enum, measured as ink in `menu/InGame`'s own rounds-text rect
(700,527,30,20) with `Ammo/PrimaryAmmo` fed 8:

| `Ammo/AmmoType` | 2 | 3 | 4 | 5 | 6 | 7 | 2, nothing fed |
|---|---|---|---|---|---|---|---|
| ink texels | **103** | **103** | 0 | 0 | 0 | 0 | 0 |

So the old `6` really did draw no count, `2` draws one, and every other type
matches HUD-10's table. Spawned with the anti-tank kit, the Panzerschreck
reaches the panel as `AmmoType 2`, `PrimaryAmmo 1` — its single loaded rocket.

Two harness notes, because both cost a wrong measurement first:
`Hud._scaleFor` is a **pure stretch** (`sx = W/800`, `sy = H/600`, no
letterbox), so a crop assuming a uniform `min()` scale is 80 px out by
x ≈ 700; and the page's rAF loop is **live in a visible headless tab**, so a
forced `hud.vars` write and the read-back of its paint have to happen inside
one `page.evaluate` or the live feed repaints over it first.

### 2026-09-20 review: the dial's pair, the dots' placeholder, and the enum

Re-run independently against a scratch re-extract of **Battle of the Bulge**
and **Kasserine Pass** built from this branch's own `con.py`, served beside an
otherwise identical tree with only the two VHUD-9 sign lines reverted
(`hud.js` back to `ctx.rotate(angle)`, `map.html` back to
`headingRadians()`), so the pair is the only variable.

**The dial's sign pair is consistent, at four angles.** Each build was asked
to paint the value *its own* pipeline feeds for a turret at exactly +90°,
−90°, +45° and 180° — the convention read back from its live feed, not
assumed (−1 on the reverted build, +1 on this one) — and all four crops are
**byte-identical PNGs** (FNV hashes 1620480286, 1175657374, 3734543796,
1996277156). +45 and 180 were added because a symmetric sprite could hide a
pure mirror at ±90; they do not.

**The trigger is the word and the view.** Sherman driver in cockpit: dial,
4711 opaque texels. Same driver in chase: **0**. Sherman hull gunner
(`shermanBrowning_PCO1`, which declares no `setHasTurretIcon`): **0**. Wespe
gunner, which aims on two axes: **0**. A Stuka's rear gunner
(`StukaRearGunControl`), also two axes: **0**.

**`_drawPicture` negating is right for the other rotated leaves too.** The
only other `rotation` in `hud-layout.json` is the `hitIndicator` group's seven
wedges, whose angles are static literals (3.9, −3.14, 2.5, 1.57, 0.8, −0.8)
authored in the engine's own `RotateEffect` sense — so the negation is the
correct treatment for them as well. Nothing feeds `HitFromDir/HitFromDir`
today, so the group never draws; whoever wires it inherits the right
convention.

**Seat dots: one defect, fixed.** Positions land where VHUD-11 says. Hanomag
from the root seat: states `[1,2,2,2,2,2]`, positions 39/75, 40/65, 30/59,
41/55, 20/49, 31/45, all inside the 128×128 icon at (200,462) once anchored at
(192+x, 452+y); from the third seat the states become `[2,2,1,2,2,2]`. Sherman
gets two, 54/103 and 32/61. Of VHUD-2's five states a single-player page can
reach three — 0 (nothing drawn), 1 (you) and 2 (empty); 3 and 4 need an
occupant that does not exist, and the live per-seat selector is still unread.

The defect was the **fallback**: a scene baked before `con.py` learned
`setVehicleIconPos` fed the state array but no positions, and `hud.js` fell
back to each leaf's own rect — which is that variable pair's *authored
placeholder*, a 5px diagonal staircase from (247,457). Measured on Kasserine's
Hanomag: 0 texels of dot in that corner with the pairs fed, **66 with them
deleted**. Since the whole shipped tree is in that state until the next
re-extract, this would have painted a wrong six-seat layout on every vehicle.
Now state 0 from `seatDots()` and an early return in `_drawOccupiedSeat`: 0
either way, per dot, with the live dots byte-identical.

**The ammo enum, every branch, on the page.** Walked all four kits'
inventories with the weapon load awaited (`updateSoldierHud` returns early
while `handWeapon` is null, so an un-awaited swap reads the previous weapon's
panel):

| weapon | `Ammo/AmmoType` | rounds fed | icon | bar |
|---|---|---|---|---|
| `KnifeAllies` | unset (`ATNone`) | — | — | — |
| `Colt` / `No4` / `Thompson` / `Bar1918` | 1 | 8 / 5 / 30 / 20 | — | magbar |
| **`Bazooka`** | **2** | **1** | `Icon_bazooka_64x32` | none |
| `ExpPack` / `Landmine` / `Detonator` | 2 | 4 / 4 / −1 | own icon | none |
| `GrenadeAllies` | 3 | 3 | `Icon_grenadeallies_64x32` | strength |
| `RepairPack` | 4 | not fed | `Icon_repairkit_64x32` | none |
| `MedPack` | 6 | not fed | `Icon_medkit_64x32` | none |

`ATIconNoText` (5) is not reachable in vanilla — one declaration across all 18
installs.
