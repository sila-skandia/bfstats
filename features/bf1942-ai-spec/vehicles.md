# Vehicles: strength tables, Change, seats

`bot-strength.js`, `bot-vehicle.js`, `bot.js _urgencyChange /
_urgencyChangeTeleport / _planChange`, and the page's seat handling
(`bot-units.js candidates / bot-referee.js enterVehicle / leaveVehicle /
botVehicleTick`).

## The class tables

Six battle-strength classes: Infantry, LightArmour, HeavyArmour, NavalArmour,
Submarine, Air (AI-50).

- **A unit's table** (`unitTable`): the per-class maximum over its weapons'
  `setStrength` tables (a healing weapon has none). A soldier's is the
  soldier template's `setBattleStrength`: Infantry 4, LightArmour 2,
  HeavyArmour 1, Air 1.
- **The enemy tables**: per side, updated every strategic pass
  ([strategic.md](strategic.md#the-enemy-strength-tables)).
- **Fire strength** (`fireStrength`, `calculateFireStrength`, AI-51, AI-59):

  ```
  own[c]   = table[c] + share x table_s[c] for every other OCCUPIED seat s of the hull
             share 0.4 for a seat or an aircraft, 0.9 for a ground hull's root
  m        = max_c own[c]²
  mt       = max own[c]² over the classes the enemy fields (types[c] > 0)
  strength = mt - enemyStrengths[my class]       (0.5 m when the enemy fields nothing known)
  ```

  Weighing another seat of the hull it sits in, the bot counts its own seat
  as empty (it would leave it). A **fixed weapon** (a gun root, or a seat of
  a hull nobody drives) needs somewhere to point: with enemies spotted, one
  inside its traverse (else 0); with none spotted, any enemy inside the guns'
  range gives the normal score; else a flat **5.0** when it can face the
  strategic direction (the nearest enemy flag's bearing, INVENTION of the
  direction), else 0 (`_fixedAimable`).
- **Engine heat** (`engineHeatInfluence`): 1 up to heat 0.95, then `1 - (heat -
  0.95) x 20`. The viewer passes no heat (1).

*Example.* A Sherman (guns Infantry 10 / 12, LightArmour 7 / 5, HeavyArmour 2,
Air 1 -> table Infantry 12, LightArmour 7, HeavyArmour 2, Air 1) against 8
enemy soldiers at steady state (strengths Infantry 32, LightArmour 16,
HeavyArmour 8, Air 8; types Infantry 8): `mt = 12² = 144`, minus the enemy's
strength against HeavyArmour 8 = **136**. A soldier: `4² - 32 = -16`. With the
enemy unknown the Sherman is `0.5 x 144 = 72`.

## A unit's urgency

`unitUrgency` (`calculateVehicleUrgency`, AI-43), for any unit a bot could
be in, the foot included:

```
move     = heat x maxSpeed x 4        (x 2.5 instead of 4 for a seat another bot drives)
u        = SCurve(health) x (fire x (w1 + 0.15) + move x w2) + value
[w1, w2] = orderSplit(attack, defence): 0.5 / 0.5 with no order strengths (the viewer never sets them)
u       x= age / 15 within 15 s of leaving that unit, and within 15 s of its spawn
```

`value` is the seat's strategic strength for side 0 (x0.5 for a plane's
secondary seats, x0.77 for a ship's: PAGE), 1 for the foot. `maxSpeed` is the
AI plug-in's (Sherman 16, Willy 25, Kubelwagen 20, soldier 5); a seat that
does not drive gets the hull's only while someone drives it.

*Example.* The foot: `1 x (-16 x 0.65 + 5 x 4 x 0.5) + 1 = 0.6`. The Sherman:
`1 x (136 x 0.65 + 16 x 4 x 0.5) + 3 = 123.4`; at 25 % health (`SCurve(0.25)
= 0.087`) `13.5`.

## Change, on foot

`_urgencyChange` with `changeUrgency` (`BBChange::calculateUrgency`, AI-44).

- **Candidates**: every seat the page lists (`botVehicleCandidates`: every
  door of every live hull with AI data, a driver's, gunner's or passenger's
  seat or a fixed gun, rebuilt every 0.5 s), not held by anyone, upright,
  within **50 m** (`getHardware`), its door on a walkable cell.
- **Score**: `u x (f + 0.5)`, `f = min(0.5, (50² - d²) / 50²)`.
- **Urgency**: with `staying = foot u x 1.25`, the best candidate above it
  gives

  ```
  Declein(0.5 x best / staying) x mod x 4 x ramp x area
  ramp = min(1, (now - last change) / 10),  area 0.75 outside the ordered area
  ```

  (`0.5 x best` when `staying <= 0`). A new best is a changed target.
- **Plan** (`_planChange`): stand; `InfanteryMoveTo` the door (arrive at the
  door's radius, at least 2 m; the engine walks to 6.25 m of the hull from
  12.5 m); `EnterVehicle` after the move, which asks the page for the seat.
  Kept while the same seat stays free.

*Example.* The Sherman 20 m away: `f = 0.5`, score 123.4; `x = 0.5 x 123.4 /
0.75 = 82`, `Declein = 1`, urgency `1.9 x 4 = 7.6`: above a MoveTo order
(3.0) and a saturated Fire (7.5). At 45 m (`f = 0.19`) still 7.6: the
distance only matters when the ratio is small.

## Change, seated

- **Bail allowed** (`isBailAllowed`, AI-46, AI-63): a soldier could stand
  where the hull is (a walkable cell of the infantry map); in the air, also
  within 6 m of the ground (INVENTION: no parachute for a bot). The whole
  seated evaluation, other hulls included, needs it.
- **Staying**: the seat's own `u` (its fire strength with the other seats'
  shares, the hull's speed if it drives or is driven) `x 1.25`; 0 when the
  hull is upside down.
- **Alternatives**: the foot (a bail, `x 2` on the urgency) and every free
  seat of another hull within 50 m, scored as on foot.
- **Urgency**: as on foot, `x 2` for a bail.
- **Plan**: `ExitVehicle` (the page unseats the bot 3.5 m to the hull's side);
  the walk to another hull starts on foot.

## The seat swap

`_urgencyChangeTeleport` with `teleportChangeUrgency` (`BBChangeTeleport`,
AI-52), the other seats of the bot's own hull:

| where the bot sits | root | own seat | other seats |
|---|---|---|---|
| the root (drives) | 1.0 | 1.0 | 0.5 |
| a seat under a driver | 0.5 | 1.0 | 0.5 |
| a ship's seat | 1.0 | 0.5 | 0.65 |
| a land vehicle's seat | 1.0 | 0.5 | 0.7 |
| an aircraft's seat | 1.5 | 0.5 | 0.5 |

Each alternative's `u x factor x (1 - radio) x orderFactor` (radio 0,
`orderFactor` 1 with an order, else the bot's skill) against the own seat's
`u x factor`; the best above it gives `Declein(0.5 x best / own) x 4`. None
better: 6.0 while an entry is pending, 2.0 with no attack order (`w1 <
0.05`, which the viewer's 0.5 / 0.5 split never gives) and no plan, else 0;
`_urgencyChangeTeleport` drops a result with no best seat, so neither 6.0
nor 2.0 reaches the contest. It replaces the seated Change result when larger. **Plan**:
`SwitchSeat`, the seat-select key; the page reseats the bot.

*Example.* A passenger of a free jeep (root `u` 10, own 2): own `2 x 0.5 = 1`,
root `10 x 1.0 = 10`, `x = 5`, urgency `Declein(5) x 4 = 4.0`: it takes the
wheel. A gunner under a driver with own 8 and root 10: `8 x 1.0` beats `10 x
0.5`: it stays.

## Seated behaviours

A mounted bot registers the `Tank` rows (no Special). A seat that does not
drive returns 0 from MoveTo (`BBMoveToFixed`). Fire uses the unit's AI
weapons through the turret ([behaviours.md](behaviours.md#fire-mounted)).
Senses use the vehicle fields of view from the eye 2 m above the hull.

## The page's side

- **Seating** (`botEnterVehicle`): a driver's seat of a `ground`, `tank`,
  `air` or `ship` root gets the page's own drivetrain (`VehicleOccupancy.
  ensureDrive`), adopted into the body world and driven by the bot's word
  through the world's occupied-vehicle tick; any other seat is a bare seat
  whose guns the world fires from the bot's trigger. The bot gets the
  vehicle map (land), the water map (ships; `LandingCraft` for landing
  craft), a 3 m radius (10 m for aircraft and ships, INVENTION), the seat's
  AI weapons.
- **Unseating** (`botLeaveVehicle`): a driven hull parks where it stands; the
  soldier is placed 3.5 m to its side.
- Both tell the strategic AI the bot's unit changed (`botChangedUnit`): it
  loses its order and is ordered afresh as a tank, a car, a plane (the air
  order) or a soldier, on that unit's own map ([strategic.md](strategic.md)).
  Both clear the airborne flag.
- **Destroyed hull**: the crew is unseated and killed.
- **Damage**: a round that finds a seated bot bills the hull.

## Known issues

- Fixed (ledger AI-74): `dismount()` now keys `_leftVehicle` by the hull.
  Was: `bot.js dismount()` stored `_leftVehicle.id = m.id`, the seat candidate's
  id (`<vehicle>:<seat>`); `_urgencyChange` compares it with `c.vehicleId`,
  so the 15 s left-unit ramp never applies. With the 10 s change ramp only
  scaling a saturated urgency (`1.9 x 4 x ramp` passes Idle's 0.1 at ramp
  0.013), a bot can leave a seat and take it back 0.37 s later, repeatedly
  (headless runner, El Alamein seed 3: 62 mounts in 10 minutes by one bot;
  `tools/bf1942-models/sim/README.md`).
- Boats: a big ship's water map is nearly shut (Truk: 0.3 % free, every big
  ship spawn blocked), and a carrier's or destroyer's landing craft are
  listed as seats of the parent hull, so no landing craft drives alone
  (AI-66).
