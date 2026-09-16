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
- **`Ammo/AmmoType` for `ATIcon` weapons (fed as `6`, R1-18 open).** The
  layout's icon-only branch covers both `6` and `7`; which the engine actually
  uses for an `ATIcon` weapon (Bazooka, ExpPack, Detonator) was never read. `6`
  is picked arbitrarily — both branches cull the same unfed heat/reload fill
  this file deliberately never feeds for these weapons, so either value paints
  identically: icon and panel only, no numbers, matching R1's Viewer Recipe.
- **Per-weapon `SoldierAmmoPosX`/`PosY` overrides are not applied.**
  `hud-layout.json`'s rect is baked once from `menu/InGame`'s own defaults
  (`(696,517)`), not a live-bound position — only one surveyed weapon
  (`JohnsonLMG`, `5/-11` against vanilla's `6/-17`) is known to diverge, and
  its bar would draw one pixel off vanilla's own rect if reached. Not fixed
  this round: the layout format has no live-position mechanism to feed.
- **`inVehicle`/`Vehicle/ShowVehicleIcon` reflect only the pre-existing
  aircraft/car modes** (`optPilot.checked && (aircraft || car)`), the only
  "seat" concept that exists before a seats track lands. A future manned-gun
  or tank seat that is neither will need its own state folded into this exact
  check, or this pair of variables handed over to that track outright —
  flagged again in this round's final report.
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
