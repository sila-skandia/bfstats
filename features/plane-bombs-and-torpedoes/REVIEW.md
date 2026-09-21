# Adversarial review of W6-A — aircraft bombs and torpedoes

**MERGE WITH FIXES.**

The collateral is correct. `FireArms::Fire` and `FireArms::fireFinished` were
re-derived from the bytes without reference to the build record, and every one of
the six claims the branch rests on holds exactly as written. No behavioural
regression was found in the viewer: the arithmetic, the guard, the release speed,
the water entry and the torpedo run all do on the page what the build record says
they do, and the suite is green at the number claimed.

What must change before merge is four statements of fact — three in a code
comment and a ledger row that the next agent will read and trust, one of which
would make a re-implementer build a torpedo that cannot hold a depth. None of
them changes behaviour. Two of the stream's own open items are also resolved by
this pass, both in its favour.

Branch `worktree-agent-a8644868af17c6682`, four commits. Reviewed against `main`.

- Suite measured: **2,390 tests, OK, 24.0 s** (`python3 -m unittest discover -s tests`
  from `tools/bf1942-models`). Matches the claim exactly.
- Nothing in the reviewed worktree was modified except this file. Nothing was
  written into `viewer/maps` or `viewer/models`; the two level extractions this
  review needed went to a scratch `--out` and a scratch viewer tree served on
  `:5297`.

---

## 1. Priority 1 — the collateral, re-derived

Disassembled with `objdump -d -M intel` against
`/home/dylan/Downloads/bf1942_lnxded-1.61-patched/bf1942/bf1942_lnxded.static`.
`xref.py check` reports the client hash MATCH and 1,275 corpus symbols.

### 1.1 The barrel count is the `addFireArmsPosition` vector size, 12-byte elements

**Confirmed.** `Fire` computes it at `0x0828a59d`–`0x0828a5c3`:

```
828a59d  mov edx,[eax+0x210]        ; begin
828a5a3  mov ecx,[edi+0x4]          ; end  (= tmpl+0x214)
828a5a6  sub ecx,edx                ; byte span
828a5a8  sar ecx,0x2                ; / 4
828a5ab..828a5c3                    ; x 0x55555555 magic-multiply = / 3
```

`sar 2` then the `lea`/`shl`/`add` chain that multiplies by `0x55555555` is the
compiler's divide-by-3, so the element stride is `4 x 3 = 12` and
`barrelCount = (tmpl[0x214] - tmpl[0x210]) / 12`. The identical sequence recurs
five more times — `0x0828a66c`, `0x0828a6aa` in `Fire`, and `0x082884c1`,
`0x082885c3`, `0x0828876d`, `0x0828879f` in `fireFinished` — which is itself
evidence the offsets are right, since all six agree.

### 1.2 `Fire` volleys when `asynchronyFire` is clear and round-robins when it is set

**Confirmed, exactly.** The dispatch on `edx = barrelCount` at `0x0828a5c6`:

| test | at | goes to | fires |
|---|---|---|---|
| `test edx,edx; je` | `0x0828a5c6` | `0x0828a750` | `push 0xffffffff` → `fireBarrel(-1)` |
| `cmp edx,1; je` | `0x0828a5ce` | `0x0828a738` | `push 0x0` → `fireBarrel(0)` |
| `cmp BYTE [tmpl+0x338],0; je` | `0x0828a5dd` | `0x0828a62a` | the salvo paths |
| (fall through) | `0x0828a5e6` | — | one round-robin barrel |

The round-robin path is byte-for-byte what the build record describes: it reads
`BYTE PTR [this+0x296]` at `0x0828a5e9`, zero-extends it, compares against
`barrelCount` at `0x0828a5f3` and resets it to 0 when it is not below
(`0x0828a5fc`), calls `fireBarrel` once with that index at `0x0828a614`, then
`inc BYTE PTR [this+0x296]` at `0x0828a61c`. **Counter at `+0x296`: confirmed.**

The salvo loop at `0x0828a69d`–`0x0828a6f2` runs `ebx` from 0 while
`ebx < barrelCount`, calling `fireBarrel(ebx++)` — all barrels. **Confirmed.**

One engine quirk worth recording, harmless in shipped data: `+0x296` is a *byte*
and is incremented without bound, so it wraps 255→0. For any `barrelCount` that
is not a power of two dividing 256 the round-robin would stutter once per 256
pulls. Every shipped `asynchronyFire` weapon has 2, 4, 6 or 10 barrels and only
2 and 4 occur on aircraft, so nothing in vanilla or the two expansions is
affected. The viewer's `nextBarrel % barrels` is the clean form and is correct.

### 1.3 `fireFinished` charges `barrelCount` for the salvo and 1 otherwise

**Confirmed, exactly.** The gate first:

```
8288496  mags()  ->  ecx = *mags
828849a  test ecx,ecx
828849c  jle 8288554        ; mags <= 0 : SKIP THE ENTIRE CHARGE BLOCK
```

`jle` is signed, so the `-1` unlimited sentinel of GUN-4 takes it. **An unlimited
weapon is charged nothing: confirmed.** Then:

```
82884a5  cmp BYTE [tmpl+0x338],0 ; jne 82884f4   -> charge 1  (asynchronyFire)
82884df  cmp eax,0x1             ; jbe 82884f4   -> charge 1  (barrelCount <= 1)
82884e7  cmp BYTE [tmpl+0x348],0 ; je  8288751   -> charge barrelCount
```

and the `barrelCount` charge at `0x08288751`: `*mags -= barrelCount`
(`0x0828878d` `sub edx,eax`, stored `0x08288792`) and
`[this+0x298] -= barrelCount` (`0x082887c3` `sub edx,eax`, stored `0x082887c5`),
against the single-round path's `dec ebx` / `dec ecx` at `0x08288504` and
`0x0828850d`. Both floors are there: `mags < 0 → 0` via `0x08288524` → `0x08288738`,
and `[this+0x298] < 0 → 0` via `0x08288532` → `0x08288729`.

So **a round is spent per projectile, not per trigger pull.** BOMB-1 holds.

### 1.4 The partial-salvo rule is above the loop

**Confirmed.** In the `asynchronyFire`-clear branch at `0x0828a62a`:

```
828a63b  cmp DWORD [mags],0xffffffff ; je 828a727 -> 828a69d  (unlimited: FULL salvo)
828a68a  cmp DWORD [mags],eax        ; jae 828a69d            (mags >= barrels: FULL)
828a694  cmp BYTE [tmpl+0x348],0     ; je 828a6f4             (else: PARTIAL)
```

and the partial loop at `0x0828a6f4`–`0x0828a725` re-reads `*mags()` as its bound
on every iteration (`0x0828a6fd`) and fires barrels `0 .. mags-1`. It is
physically before the full loop in the function and it is reached before any
barrel has fired. **BOMB-5 holds**, and `tmpl+0x348` does suppress it.

### 1.5 The unlimited case short-circuits

**Confirmed twice over:** `Fire` sends `mags == -1` to the *full* salvo
(`0x0828a63b` → `0x0828a727` → `0x0828a69d`), and `fireFinished`'s `jle` at
`0x0828849c` skips the charge. Fires everything, pays nothing. The viewer's
`salvo()` returns `{ barrels: range(n), rounds: 0 }` for that case, which is
right, and `map.html`'s `guns.roundsLeft` hook returns `Infinity` exactly when
`FireState.unlimited` is set, which `seats.js:953` sets for `magSize < 0`.

### 1.6 `fireAllAtOnce` is declared nowhere

**Confirmed independently.** My own survey over every `.con`/`.inc` in every
`.rfa` of all 14 installed mods:

```
fireAllAtOnce declarations across all installs: 0
```

Leaving `tmpl+0x348` unmodelled is therefore the right call, and the build
record is right that nothing shipped depends on which way it falls.

### 1.7 Verdict on the collateral

**The reading holds. The collateral is correct and intended.** Applying the
salvo rule and the per-projectile charge to every multi-barrel `FireArms` is
what the engine does, and confining it to bomb racks would have been the bug.

My own survey of multi-barrel (`>1 addFireArmsPosition`) `FireArms` templates:

| mod | templates | of which `asynchronyFire` (unchanged) |
|---|---|---|
| bf1942 | 34 | 7 |
| XPack1 | 4 | 2 |
| XPack2 | 13 | 8 |
| FHSW / bg42 / FH / WarFront / … | 2,264 / 406 / 242 / 124 / … | not counted |

So **27 vanilla templates change behaviour**, not only the racks. The seven that
do not are `B17BombRack`, `Elco80_Torpedos`, `Ju88ABombRack`,
`KatyushaFireArmsBundle`, `StukaWBomb`, `TorpedTubBundle`, `Type38_Torpedos`.

Real weapons, with rate and magazine life before → after:

| template | barrels | magSize | roundOfFire | proj/s | magazine life |
|---|---|---|---|---|---|
| `SBD-TGuns`, `SBDGuns`, `IlyushinGuns` | 2 | 600 | 12 | 12 → **24** | 50 s → **25 s** |
| `CorsairGuns`, `BF109Guns`, `MustangGuns`, `SpitfireGuns`, `Yak9Guns`, `ZeroGuns` | 2 | **900** | 12 | 12 → **24** | 75 s → **37.5 s** |
| `BF109Cannon` | 3 | 240 | 6 | 6 → **18** | 40 s → **13.3 s** |
| `YamatoMediumCannon` | 3 | **−1** | 0.2 | 0.2 → **0.6** | unlimited, charged nothing |
| `PrinceOW_CannonPipes4` | 4 | **−1** | 0.15 | 0.15 → **0.6** | unlimited, charged nothing |
| `WasserFallGuns` (XPack2) | 25 | **1** | 40 | 1 per pull (partial salvo) | one round |

Measured on the page, which is the part that matters: seated in a Midway SBD-T
with the primary held for 61 frames, `Ammo/PrimaryAmmo` fell **600 → 574, i.e.
26 rounds in 1.017 s = 24 rounds/s** off a `roundOfFire 12` two-barrel template.
The collateral is live and it is the right number.

Two things about it the build record does not say and the lead should know:

- **The ships are the biggest visible change, and they are not mentioned.**
  `YamatoMediumCannon` (3 barrels), `PrinceOW_CannonPipes2`/`4` (2 and 4),
  `HatsuzukiGun` (2) and `AA_POW_GunBarrel2` (2) all declare `magSize -1`, so
  each pull now fires the whole battery and costs nothing. A Prince of Wales
  quad turret going from one shell per pull to four is a larger change to how a
  map plays than any aircraft gun in the list.
- **`WasserFallGuns` is the one weapon where BOMB-5 actually bites** — see fix 4.

---

## 2. Priority 2 — the two things the spec got wrong

### 2.1 The `gravityScale` NaN: confirmed, and understated

`gunfire.js:989` now reads `gravityScale: authored > 0 ? (speed / authored) ** 2 : 1`.
With `velocity 0` on all thirteen vanilla racks, `authored` is 0, `speed` is 0,
and `(0/0) ** 2` is NaN. `gunfire.js:1726` consumes it as
`shot.velocity.y += GRAVITY * shot.gravity * shot.gravityScale * dt`.

The build record says this "would have deleted gravity from every bomb". It is
worse than that: NaN does not vanish from the accumulator, it poisons it.
`velocity.y` becomes NaN on the first frame and stays NaN, the integrated
position follows, and the bomb leaves the world immediately rather than flying
level. The fix is right; the description of the bug is milder than the bug.

Harness confirms `gravityScale: [1, 1]` at a zero release.

### 2.2 `Bomb.ssc`'s first sounding patch is the looping whistle: confirmed

Read out of `Objects.rfa :: Objects/Vehicles/Air/Common/Sounds/Bomb.ssc`:

| patch | samples | `loop` |
|---|---|---|
| 1 (line 2) | `shellair.wav`, `Shellwhine.wav`, `haxxar.wav` | **all three `loop`** |
| 2 (line 95) | `bmbreal1.wav`, `bmbreal3.wav` | none |
| 3 (line 142) | `bmbreal2.wav` | none |

So the first patch is the in-flight whistle, `_firing_patch` preferring a looping
patch would have hung it on a momentary release, and `release=True` taking the
first one-shot patch lands on `bmbreal1`/`bmbreal3`. **Confirmed**, and confirmed
end to end: a fresh `extract_map.py Kursk` writes a `scene.json` containing
`bmbreal1` and **zero** occurrences of `shellair`.

One honest caveat for the record: "the first one-shot patch" is a heuristic, not
a derived fact. Three patches exist and which one the engine plays on a release
was not read. It is the right heuristic — a release is one-shot — but the doc
should not be read as having settled it.

---

## 3. Priority 3 — the measurements, re-run

`tests/bomb_release_harness.mjs` driven through `test_bomb_release.run_harness()`.
**Every number in §2.1 of the build record reproduces to the digit it is quoted
at.** Spot list:

| claim | measured |
|---|---|
| Stuka groups / muzzles / bounding radius | 1 / 2 / **0.9433980917** |
| Placeholder groups | **0** |
| Release velocity, platform (0,−10,−80) | **(0, −10.245, −79.999)**, speed **80.652** |
| Drop points | **−3.3** and **+3.3** |
| `gravityScale` at a zero release | **1** |
| One pull | **2 bombs**, 30 → **28** |
| Whole magazine | **15 pulls, 30 bombs**, …, 2, **0** |
| Partial salvo at `roundsLeft 1` | **1 barrel, 1 round** |
| Unlimited over 2 barrels | **2 barrels, 0 rounds** |
| B17 stick | **8 bombs**, ammo **0**, reload **15** armed |
| B17 barrel order | **−1, +1, −1, +1, −1, +1, −1, +1** |
| B17 spacing | **0.25 s** apart, **15.0 m**, span **1.75 s** |
| Bomb from 500 m at 150 m/s | **8.217 s**, throw **1228.893 m** |
| the same with no mass/drag | **1231.924 m** → drag costs **3.031 m** |
| Impact record | `terrain`, blast **impact**, radius **20**, material2 **202**, yMod **2** |
| Bomb onto the sea | **2 impacts**, kind `water` |
| Torpedo, deepest / settles | **14.311 m** / **6.578 m** |
| Torpedo, 40 m release | settles **6.565 m** |
| Torpedo speed over 20 s | 70.044 → **110.x** |

The equilibrium arithmetic also checks out independently:
`2 x 5.9 x (14.73/9.82) = 17.6994`; `14.73/17.6994 = 0.8322`;
`0.8322 x 4.3 = 3.578`; floaters sit 3 m above the body, so the body centre runs
`3 + 3.578 = 6.578 m` down. Measured 6.578.

### On the page

Served from a scratch viewer whose `maps` points at my own extractions, so these
are fresh scenes. Playwright + SwiftShader, `__renderOnce`.

**Midway, SBD-T, torpedo.** Released level at 70 m/s from y = 40 (surface y = 20):
released one torpedo, HUD secondary **15 → 14**, one drawn body
(`SBD-TBombDummy_projectile`) in the world, **no impact record at the surface**,
dived to **y = 5.24 (14.76 m deep)**, recovered, and **settled dead flat at
y = 13.42 — which is 20 − 6.58 — and held it from t = 10.5 s to t = 17.5 s**,
seven seconds, before the viewer's 1,500 m cap retired it at **t = 17.70 s**
having run **1,475 m**. Speed 70 → 96 m/s. This is the build record's claim,
reproduced with different release parameters and landing on the same equilibrium
to two decimal places. **A torpedo that holds a depth: verified.**

**Kursk, Stuka, bombs.** Released level at 120 m/s from y = 400: **two bombs**
(`StukaBombRack_projectile` x2), HUD secondary **30 → 28**, both flew and both
burst on terrain (gone at t = 6.17 and 6.27 s) having travelled ~740 m.
**A bomb that falls: verified.**

I did not re-drive the El Alamein B17 on the page; the stick is pinned in the
harness (8 bombs, alternating barrels, 0.25 s apart) and the alt-fire-to-HUD
integration is proven by the two runs above.

One observation the build record does not have, from a deliberately harsh entry
(released from y = 120 at 100 m/s, hitting the water at ~50 m/s vertical): the
torpedo overshoots to **26.5 m deep** and then climbs at a near-constant
**0.97 m/s**, so at t = 14.5 s it is still 11 m below the 13.42 m equilibrium and
the range cap retires it before it ever settles. It never breaches — 13.42 m is
well clear of the surface — so this is bounded and plausible rather than broken,
and it is the same unmodelled floater couple the stream already flagged. Worth
one line in the doc so the next reader is not surprised by it.

---

## 4. Fixes required before merge

All four are statements of fact, not behaviour. The code is correct as it stands.

### FIX 1 — three wrong weapons in the `fireShot` comment

**File** `tools/bf1942-models/viewer/gunfire.js`, the doc comment on `fireShot`,
lines ~664–671 — and the same three claims in
`features/plane-bombs-and-torpedoes/BUILD.md` §1 under "BOMB-1 / BOMB-5".

**(a)** The comment says the binary overturns the old Katyusha argument and that
"the Katyusha's six rails are six rockets in ONE pull off a magazine of six".
`KatyushaFireArmsBundle` declares **`ObjectTemplate.setAsynchronyFire 1`**
(`Objects.rfa :: Objects/Vehicles/Land/Katyusha/Weapons.con`, first line of the
block), so by §1.2 above the engine fires **one rail per pull, round-robin,
charged 1** — six pulls at `roundOfFire 1` for six rockets. The old comment's
*conclusion for the Katyusha* was right; only the general rule it inferred from
it was wrong. This branch does not change the Katyusha at all.

**(b)** "`Elco80_Torpedos` (two tubes, `magSize 2`) is one salvo of two" —
`Elco80_Torpedos` also declares `setAsynchronyFire 1` (and `fireOnce 1`), so it
is one tube per pull.

**(c)** "A Corsair's two-barrel `CorsairGuns` really does put 24 rounds a second
into the air out of a 12 rps template, and its 600-round magazine really does
last 25 seconds and not 50." `CorsairGuns` declares **`magSize 900`**, not 600
(`Objects/Vehicles/Air/Corsair/Weapons.con`), so its magazine goes from 75 s to
**37.5 s**. The 600 / 25 s / 50 s figures belong to `SBDGuns`, `SBD-TGuns` and
`IlyushinGuns`, which are `magSize 600` at `roundOfFire 12`.

**Change:** replace the three examples with weapons whose flag is actually clear
and whose numbers are actually theirs. Suggested wording for the closing
sentences of that comment:

> `StukaWBomb` (four racks, `setAsynchronyFire 1`) and `KatyushaFireArmsBundle`
> (six rails, the same flag) still alternate one per pull, which is what the old
> comment described and what the flag is for. What changes is every multi-barrel
> weapon *without* it: an `SBD-TGuns` at `roundOfFire 12` over two barrels puts
> 24 rounds a second into the air and its 600-round magazine lasts 25 seconds
> and not 50, and a `YamatoMediumCannon`'s three pipes fire together off an
> unlimited magazine that is charged nothing.

### FIX 2 — the FLOAT-1 ledger row is missing the term that makes it work

**File** `features/plane-bombs-and-torpedoes/BUILD.md` §7, row `FLOAT-1` (and the
prose in §3 that it is drawn from).

As written the row says `PhysicsFloatingBundle::updatePhysics` "lerps between
`floatMinLift` and `floatMaxLift` over the clamped submersion ratio and divides
the product by −9.82". `Torpedo_Floater` declares `floatMinLift 5.9` **and**
`floatMaxLift 5.9`, so that lerp is a constant 5.9 at every depth. A reader
implementing the row as written gets a depth-independent 17.70 m/s² the moment
the floater is wet, never an equilibrium, and a torpedo that accelerates upward
until it breaches.

The binary multiplies by the ratio a **second** time, outside the lerp:

```
824d778  fstp [ebp-0x17c]        ; the clamped submersion ratio
824d77e..824d79c                 ; L = ratio*[node+0xa4] + (1-ratio)*[node+0xa8]   (the lerp)
824d7a4  fld  [ebp-0x17c]        ; the ratio again
824d7aa  fchs                    ; negated
824d7ac  fmul [ebp-0x180]        ; x L                     <-- the missing term
824d7bb  call [edx+0x14]         ; x K
824d7be  fmul [ebp-0x180]
824d7c4  fdiv ds:0x86d0d6c       ; / -9.82   (0xc11d1eb8, verified)
```

so the acceleration is `ratio x lerp(min, max; ratio) x K / 9.82`, the two
negations cancelling to an upward force. That outer `ratio` is what produces the
measured buoyancy table (3 m → 0, 4 → 4.116, 5 → 8.233, 6 → 12.349, 7 → 16.465,
≥8 → 17.700 — each one `17.70 x (depth-3)/4.3`) and hence the 6.58 m equilibrium.

**Change:** state the expression with the ratio factor and cite `0x0824d7a4`–
`0x0824d7ac`. The `-9.82` normalisation itself is correct and I confirm it: the
divisor at `0x086d0d6c` is `0xc11d1eb8` = **−9.82**, read at `0x0824d7c4`.

### FIX 3 — the heat comment names the wrong function

**File** `tools/bf1942-models/viewer/seats.js`, the doc comment on
`registerShot`, line ~1016: "Heat is per pull and not per projectile:
`heatAddWhenFire` is added once, which is what `fireFinished`'s own single call
to the heat accumulator does."

The heat add is in **`FireArms::Fire`**, at `0x0828a2f3`–`0x0828a302`
(`fld [tmpl+0x300]; fadd [this+0x238]; fstp [this+0x238]`), once per pull.
`fireFinished` does not add heat; it only *zeroes* `[this+0x238]` at
`0x08288622` when `tmpl+0x333` is set. The behaviour claim is right — once per
pull, not per projectile — so this is a one-line correction to the citation.

### FIX 4 — the justification for BOMB-5 does not occur in shipped data

**File** `features/plane-bombs-and-torpedoes/BUILD.md` §1, and the same sentence
in `bomb-release.js`'s `salvo()` doc comment: "An implementation that fires a
fixed pair and decrements afterwards hands out a free bomb at the bottom of every
magazine."

It would, but it never gets the chance: every non-`asynchronyFire` multi-barrel
template in vanilla and both expansions has a `magSize` that is either an exact
multiple of its barrel count (600/2, 900/2, 240/3, 1000/4, 30/2, …) or is `−1`.
The rule is nonetheless load-bearing, for one weapon: XPack2's **`WasserFallGuns`
declares 25 `addFireArmsPosition` barrels and `magSize 1`**. Without the partial
salvo, one pull launches twenty-five rockets and is charged twenty-five from a
one-round magazine. That is the example the doc should give, because it is the
one a reader can go and look at.

---

## 5. Claims I could not reproduce

Only the three in FIX 1: the Katyusha "one pull of six", the `Elco80_Torpedos`
"salvo of two", and `CorsairGuns`' "600-round magazine … 25 seconds". What I got
instead is in FIX 1 and in the table in §1.7.

Everything else in the build record reproduced — every harness number to the
quoted digit, the suite count, both page behaviours, both new engine reads, and
BOMB-3a.

---

## 6. Open items resolved by this pass, both in the stream's favour

### 6.1 A `Projectile`'s child `Engine` **is** stepped. The doubt's premise is wrong.

This was the item I was told to chase, and it settles the other way from the
worry. The stream noted that `Projectile::handleUpdate` (`0x0831e940`) walks no
children — which I confirm: its call list contains `resetProjectile`,
`detonate`, `BFSoldier::projectileHit`, `SimpleObject::handleCollision`,
`getRootParent` and vtable slots, and **no call to `SimpleObject::handleUpdate`
and no child-list walk.** It then reasoned that the torpedo's own engine may
therefore never run in the engine either, and that the whole self-propulsion
model would need justifying.

But Refractor does not update children by recursing from the parent. The update
dispatch is a **flat registry**:

- `ObjectManager::updateObjects(float, UpdateFreqencyType, unsigned)`
  (`0x0819be10`) iterates the `std::map` at `ObjectManager+0x3c`
  (`0x0819bee0`–`0x0819bf06`), skips entries whose `[obj+4] & 1` is set
  (`0x0819beef`), calls each object's update-frequency accessor at vtable `+0x64`
  (`0x0819bf16`) and compares it against the frequency argument, and then calls
  that object's **`handleUpdate` through vtable `+0x54`** at `0x0819bf2d`.
- Objects enter that registry generically, from their own flags:
  `BObject<IObject>::updateFlags(unsigned, unsigned)` dispatches on flag bits to
  a family of ObjectManager virtuals on the singleton at `ds:0x87202cc`, and the
  `+0xec` slot it calls at `0x0819333b` is
  `ObjectManager::addObjectToUpdate(IObject*)` (`0x0819bd20`, which inserts into
  the same `+0x3c` map, keyed on `obj[0x48]`). The `+0xf0` slot next to it is
  `removeObjectFromUpdate` (`0x0819bdb0`). `BObject<ICompositeObject>` and
  `BObject<IPlayerObject>` do the same at `0x0819350b` and `0x08164dfb`.

So a child object is stepped by the ObjectManager directly, on its own flags,
independently of whatever its parent's `handleUpdate` does or does not do. A
`Torpedo_Engine` hanging off `AircraftTorpedo` reaches `Engine::handleUpdate`
(`0x0823e120`) by exactly the mechanism that steps a vehicle's engine.
**The self-propulsion model needs no further justification.**

Residual: I showed the mechanism is generic and parent-independent, not that
`EngineTemplate` specifically sets the "needs update" bit. `Engine::init`
(`0x0823e110`) is empty, so that bit comes from the shared
`SimpleObjectTemplate` path, the same one a vehicle's engine takes. I would call
this settled for practical purposes and cheap to close completely if anyone wants
the flag word itself.

### 6.2 The bomb release audio **is** heard. Measured.

The stream marked this unmeasured because its own probe never awaited the async
audio setup. Awaiting it properly — poll `__getAudioState().weapons` until it
populates, after a real `page.mouse.click` and under Playwright's default
autoplay policy — on a fresh Kursk in the Stuka:

```
StukaGuns      SFMG1.mp3 loop=true, SBDMG1.mp3 loop=true,
               SBDMGdist1.mp3 loop=true, SFMGdist1.mp3 loop=true
StukaBombRack  bmbreal1.mp3 loop=false, bmbreal3.mp3 loop=false
MG42_Air       MG42_fire.mp3 loop=true x2
```

The rack has its own audio entry, with exactly the two one-shot release samples
and no looping whistle. Instrumenting `AudioContext.createBufferSource`, one
alt-fire pull creates **2 buffer sources** in the six frames it spans, where a
primary-gun pull creates 0 in the same window. The audio context reports
`state: "running"`.

So G-5 is audible on the page with no new code, exactly as the stream predicted,
and the `release=True` patch selection is right at the audio layer as well as in
the extracted data. **This open item can be closed.**

### 6.3 O-3 does not block, and is a non-issue in shipped data

`MustangBombDummy` declares `autoReload 1` with no `reloadtime`, and the stream
left it. It cannot bite: `FireState.reset` (`seats.js:963`) sets
`magsLeft = max(0, numOfMag - 1)`, `MustangBombDummy` declares `numOfMag 1`, so
`magsLeft` is **0**, and `registerShot` only arms `reloadRemaining` when
`magsLeft > 0` (`seats.js:1025`). The Mustang runs its fifteen bombs dry and
stays dry, which is correct behaviour and never reaches the `reloadTime || 0`
instant-reload path at all. Not a merge blocker, and arguably not a gap.

O-2 (`AmmoType` for rearm) and O-6 (a torpedo on terrain before water) are also
not blockers — the viewer has no rearm pads, and the terrain path degrades to the
ordinary `#impact` with no damage cell, which is inert rather than wrong.

---

## 7. Independently confirmed, for the record

- **FLOAT-2, `setDragModifier` is write-only: confirmed.** A scan of every float
  and integer access of `[reg+0x1c0]` in the whole binary finds, within
  `FloatingBundleTemplate`, exactly two **reads** — `0x08240d3a` and
  `0x08240d6c` — and both are inside
  `FloatingBundleTemplate::makeScript` (`0x08240a50`…). The writes are the
  constructor's default `0x43c80000` = **400.0** (`0x082408d2`/`0x08240942`),
  `setDragModifier` itself (`0x08241079`), and the console-class setter
  (`0x0824b7dc`). `setPhysicsNodeComponent` copies `+0x1b8`/`+0x1bc` and not
  `+0x1c0`. Nothing reads it. **Verified, and the answer is "neither".**
- **FLOAT-1's `-9.82`: confirmed.** `0x086d0d6c` holds `0xc11d1eb8` = −9.82,
  read at `0x0824d7c4`. `hullHeight` is read from the template at `+0x1b4`
  (`0x0824d704`). See FIX 2 for the one term the row omits.
- **BOMB-3a, the `& 0x10` throttle pin: confirmed.** `Engine::handleUpdate`
  `0x0823e120`, `call [eax+0xa0]` at `0x0823e165`, `and eax,0x10` at
  `0x0823e16e`, `mov DWORD PTR [edi+0x124],0x3f800000` (= 1.0f) at `0x0823e179`.
- **A rack with zero declared barrels is handled.** Six of the thirteen vanilla
  racks (the fighters) and both torpedo racks declare no `addFireArmsPosition` at
  all. The engine fires `fireBarrel(-1)` from the FireArms' own transform
  (`0x0828a750`), and `gunfire.js:545` sets `muzzles: muzzles.length ? muzzles : [obj]`
  — the FireArms node itself — which is the same thing. `salvo()`'s
  `Math.max(1, barrelCount | 0)` then returns barrel 0, charged 1. Correct, and
  measured: the SBD-T's zero-barrel torpedo rack released one torpedo for
  15 → 14.

---

## 8. What remains open after this pass

1. **The torpedo's terminal speed is still uncapped.** I did not read
   `PhysicsEngine::updatePhysics` (`0x0824cbb0`) for a water medium factor, so
   the 158 m/s terminal from `noPropellerEffectAtSpeed 120` is still unchecked
   against the engine. §6.1 removes the *other* half of the stream's doubt — the
   engine does run — so this is now the only thing standing between the model and
   a calibrated number. It is the highest-value read left in this subsystem.
2. **`maxRange` retires a torpedo before its fuse: confirmed as stated, and it
   is ours.** Measured: retired at t = 17.70 s after 1,475 m against a 20 s
   `timeToLive`. `AircraftTorpedo` declares no `maxRange`, so the 1,500 m cap is
   the viewer's own recycling guard and `WaterExplosionTorpedo` cannot play on a
   map today. Worth a follow-up; not a merge blocker.
3. **A steep entry never settles within the torpedo's life** (§3). Bounded and
   plausible; the doc should say so.
4. **The fore/aft floater couple** is still unmodelled, as the stream says.
5. **Which `.ssc` patch the engine plays on a release** is a heuristic, not a
   derived fact (§2.2).
6. **The re-extraction owed** in BUILD.md §6 is real: the shared
   `viewer/maps/midway/scene.glb` carries none of
   `detonateOnWaterCollision`, `Torpedo_Floater`, `asynchronyFire` or
   `projectilePosition`, where a fresh extraction of the same level carries all
   four. Until the lead re-extracts, the page shows a torpedo that bursts on the
   surface and a B17 that salvos pairs.
