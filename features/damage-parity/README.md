# Damage parity

Asked 2026-09-24. On Berlin, bots held back in their uncap shot down the alley
and hit their own squads first. The owner also died faster than in the real
game, killed quickly by the Colt, and did not think every hit was a head shot.
The question: does a round cost what the game says, when checked against the
binary and the `.con` files?

The evidence is ledger DMG-3 and DMG-4 in
`features/bf1942-engine-reference/ledger.md` ("Hit points and damage"). They
were read in `bf1942_lnxded.static` (sha256 `49667237…c447cf2`) and in the
installed game's `Objects.rfa` and `Game.rfa`. They build on IMP-6 (the
falloff), DIE-10 (the capsules) and FF-1 to FF-8
([features/bot-friendly-fire](../bot-friendly-fire/README.md)).

## What the game does

- **A direct hit costs `angle term x damageMod x Projectile::getDamage`**
  (`handleCollisionForProjectile` 0x08153ba0). Damage under 0.01 is dropped.
  - `getDamage` is the round's material damage. It falls off with the
    distance from where the round was fired: full to
    `distToStartLoseDamage`, then linear down to `minDamage` of full at
    `distToMinDamage`, then flat.
  - `damageMod` is the material manager's cell for the round's attacker group
    against the struck material's defence group.
  - The angle term is `angleMod + (1 - angleMod) sin(abs(cos) pi/2)`, with the
    struck object's own `angleMod`.
- **A soldier is priced by the capsule the round meets.** He has 30 HP and
  `angleMod 1`, so the angle term is always 1. The head capsule is material
  40, the chest 41, and the forearms, calves and feet 42. Each is its own
  defence group. Kit-part damping only reaches the collision handlers, never
  a round.
- **Only soldiers and aircraft author an `angleMod`, and it is always 1.** The
  template default is 0 (DMG-4). A tank, boat or gun therefore takes
  `sin(abs(cos) pi/2)`: 0.71 of full at 60 deg off square.

Every vanilla hand weapon, read in the order `materialManagerSettings.con`
runs its 50 scripts, matches the viewer's extracted `damage.json` and the
falloff each weapon glb carries. Head / chest / limbs, per hit, on 30 HP:

| weapon | 10 m | 30 m | 60 m |
|---|---|---|---|
| Colt, WalterP38 | 17.5 / 10 / 5 | 13.125 / 7.5 / 3.75 | 8.75 / 5 / 2.5 |
| Thompson, MP40, MP18 | 15 / 9 / 5 | 15 / 9 / 5 | 11.25 / 6.75 / 3.75 |
| StG44 | 15 / 9 / 5 | same | same |
| BAR, Johnson, Type99 | 22.5 / 14.4 / 9 | same | same |
| DP | 16.74 / 9.92 / 6.2 | same | same |
| Garand, Type5 | 37.5 / 15 / 7.5 | same | same |
| K98, No4 and their snipers | 50 / 20 / 10 | same | same |
| knives | 32 / 16 / 8 | - | - |

Only the pistols and the three SMGs lose damage with range: half between 20 and
40 m for the pistols, and half between 40 and 80 m for the SMGs. A Colt kills
at close range with two head hits, three chest hits or six limb hits. That is
the game's price, not a viewer bug.

To rerun the survey, use `python3 features/damage-parity/survey_weapons.py`.
The two `ext` and `glb` columns check the extraction.

## What was wrong in the viewer

1. **A bot's hand-weapon round never fell off.** A bot's weapon data is the
   glb's `extras.weapon`, which names its round only by template. The round's
   falloff lives in the glb's `fireArms.projectile`, which only the human's
   hand weapon read. The referee also never passed the distance. So a bot's
   pistol did up to twice the game's damage beyond 20 m, and its SMG beyond
   40 m. This is the Colt the owner felt.
2. **A body with no capsules was priced as a head.** This is the stand-in
   sphere: a soldier the page does not draw, and every soldier in the
   headless runner. Every hit on it cost the head price: 17.5 for a Colt and
   50 for a K98, where the torso is 10 and 20.
3. **The runner's own copy of the law ignored the capsule and the
   distance.** This was `sim/level.mjs` on real and synthetic levels.
4. **The angle term was a bare `abs(cos)` for every object.** It was 0.5 at
   60 deg off square where the game's sine is 0.71. Aircraft were docked too,
   where the game docks nothing. So was a round meeting the stand-in sphere
   off centre, whose normal is the sphere's, where a soldier's term is 1.

Item 1 hit only bots' rounds. Item 2 also priced every other round that met
an undrawn body as a head: the human's, and every hull gun's. Rounds that met
a drawn body were already priced by its capsule and fell off correctly.

## What the viewer does now

| Piece | Where |
|---|---|
| A bot's weapon data carries its round's spec as `round` (material, falloff) | `viewer/map.html` `botWeaponData`, `sim/level.mjs` `weaponFire` |
| `botRoundDamage(stats, material, distance)`: the capsule's price at the distance the round flew | `viewer/vehicle-hits.js` |
| The referee hands it the met capsule's material and the distance | `viewer/bot-referee.js` `resolveShot`, `fireTick` |
| The stand-in body is priced as the torso (`BOT_BODY_MATERIAL` 41) | `viewer/bot-referee.js`, `roundBodyCast` |
| The runner prices with the same law, and on the synthetic level per material with the falloff | `sim/level.mjs`, `sim/match.mjs` |
| The angle term uses the struck object's own `angleMod` (`guns.angleModOf`, the glb's physics extras) | `viewer/round-impact.js`, `vehicle-hits.js` `angleModOf` |
| The human's hitscan fallback (used only with no `bodyCast`) prices the same way and meets friends (FF-1) | `viewer/hand-fire.js` |

## Verified

- `tests/test_damage_parity.py` covers:
  - the prices per capsule and range for the Colt, Thompson and K98;
  - the stand-in priced as the torso;
  - the referee handing over the material and distance, for the stand-in and
    for a head capsule;
  - the synthetic level's law;
  - `angleModOf`;
  - the angle term for a tank, an aircraft, a soldier and a placed object,
    and with no hook installed.
- Live, headless El Alamein (Playwright on Vulkan, `?doctrine=sai`, every bot
  frozen but the shooter). An enemy anti-tank bot stood 30 m from the human
  (in first person, eight capsules) and drew its WalterP38. The old code is
  the same page with the viewer's modules served from the main checkout.

  | | hits (capsule, HP) |
  |---|---|
  | before | head 17.5, right calf 5 |
  | after | chest 7.5, chest 7.5 |

  The game's prices at 30 m are 13.125 / 7.5 / 3.75. Each run fired 24
  rounds.
- Whole matches in the runner. Each "before" run uses the main checkout's
  runner and viewer.
  - The synthetic level is all infantry (K98, Thompson and Colt kits): 8 a
    side, 300 s, no vehicles, seeds 1 to 3. Every body there is the stand-in,
    so every hit used to cost a head's price:

    | seed | kills, before → after | rounds landed per kill, before → after |
    |---|---|---|
    | 1 | 91 → 72 | 2.20 → 6.15 |
    | 2 | 78 → 61 | 2.12 → 5.72 |
    | 3 | 92 → 54 | 2.21 → 6.59 |

    Per kit, the Thompson went from 2.4-4.1 rounds a kill to 6.5-11.6, and
    the K98 from 1.5-1.6 to 2.4-3.8. The Thompson's fights run past 40 m,
    where it now falls off.
  - El Alamein: 8 a side, 600 s, seeds 1 to 3, under both the SAI and the
    garrison. All 12 matches completed with no bot errors. Vehicles do most
    of the killing on this map. Over the six matches each way, deaths went
    113 → 118, captures 64 → 72, and hand-weapon rounds landed 19 → 42. One
    different hit diverges a whole match, so these numbers do not measure the
    price of a hit.
- `./scripts/verify.sh --skip-e2e`: 3255 model tests OK, none skipped, and
  394 API tests passed. The friendly-fire and hit-indication harnesses now
  load the viewer through the runner's hooks, as this one does. Their
  in-place imports needed a `node_modules/three` that a fresh worktree does
  not have. All three pass without it.

## What this does not change

- **A bot's fire budget per plan.** The engine gives a single-shot weapon 2 to
  5 pulses per fire plan. The viewer keeps 1 to 10 (AI-131, not ported,
  `bot-fire.js firePlanFor`). A pistol bot therefore fires longer strings on
  average (5.5 pulses against 3.5) before it re-plans than a retail bot
  does. This, the deviation cone and the
  bots' weapon choice decide how fast a bot kills, beyond the price of a hit.
  They belong to [features/bot-weapons](../bot-weapons/README.md).
- **Where the Berlin bots stand.** Under the page's default doctrine, the
  garrison, every bot not on a post is an attacker. Under `?doctrine=sai`, a
  bot that no target collects holds the area it stands in, which can be its
  base (the SAI's `retainBot`,
  [features/bot-garrison](../bot-garrison/README.md)). Why bots stop in the
  uncap to shoot was not investigated here. Wherever a bot stands, the retail
  AI never holds fire for a teammate (FF-7), so a round that meets a friend
  first hurts him as it would a foe. This change only moves the price: a
  pistol or SMG round now falls off at range, and no round costs a head's
  price unless it meets the head.

## Decisions to know about

- **The stand-in's torso price is an INVENTION.** The engine has no stand-in:
  every soldier has capsules. The torso is the single price closest to where
  a centre-mass round lands. The head price it replaces overstated every hit.
  Runner numbers taken before this change are not comparable.
- **A weapon whose glb carries no round spec loses only its falloff.** The
  projectile table still names the round's material, so the price per
  capsule is right.
