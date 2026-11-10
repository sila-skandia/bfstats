// The vehicle rows of each mod's `Game/AIbehaviours.con`: what a seat's
// `aiTemplatePlugIn.equipmentType` means (features/bot-map-generation/
// seat-behaviour.md).
//
// A seat's AI template names a row of `aiSettings.setVehicle <n> <name>`,
// and `aiSettings.setVehicleBehaviour <name> <behaviour> <generator> ...`
// registers, per row, which behaviours the unit runs and which urgency
// generator each one has (ledger AI-124 for the Fire column). A behaviour the
// row does not list is not run at all: vanilla's `Fixed` row (every
// stationary MG, AA gun and hull-top MG) registers Idle, Fire, Scout, MoveTo
// (`BBMoveToFixed`) and Change, and no Avoid or TakeCover; `Passenger` and
// `Car` no TakeCover. A mod writes its own list and numbers it its own way:
// BF1918's 9 is `Gunner` (`BBFireInfantery`, every MG it places), where
// vanilla's 9 is `BoatFixed` (`BBFireLargeBore`); FH and FHSW add rows 18 to
// 21 past vanilla's 17. So a row is read by its name in the mod's own list,
// and the number only through that list.
//
// Transcribed from the shipped files (`Mods/<mod>/Archives/bf1942/game.rfa`,
// `bf1942/game/AIbehaviours.con`; `rem` lines skipped), each row
// `[name, { behaviour: generator }]` with the generator's `BB` prefix
// dropped. Desert Combat, DC Final, XPack1 and XPack2 ship none and run
// vanilla's. BF1918's `BBRoam` (its Special on the armed hulls) is listed
// but not modelled: the viewer's Special is the medic's.
//
//   bf1942 Game.rfa       50,640 bytes    fh      game.rfa  62,216 bytes
//   fhsw   game.rfa       61,281 bytes    bf1918  game.rfa  70,619 bytes
//   eod    game.rfa       61,152 bytes    gcmod   game.rfa  42,264 bytes

/* eslint-disable max-len */
export const AI_ROWS = {
  bf1942: [
    ['Tank', { Avoid: 'Avoid', MoveTo: 'MoveTo', Idle: 'Idle', Fire: 'FireInfantery', Scout: 'Scout', TakeCover: 'TakeCover', Change: 'Change' }],
    ['Plane', { MoveTo: 'MoveTo', Idle: 'Idle', Fire: 'Fire3d', Change: 'Change' }],
    ['Boat', { Avoid: 'Avoid', MoveTo: 'MoveTo', Idle: 'Idle', Fire: 'FireLargeBore', Scout: 'Scout', Change: 'ChangeTeleport' }],
    ['Infantery', { Avoid: 'Avoid', MoveTo: 'MoveTo', Idle: 'Idle', Fire: 'FireInfantery', Special: 'MedicAssist', Scout: 'Scout', TakeCover: 'TakeCoverInfantry', Change: 'Change' }],
    ['Fixed', { MoveTo: 'MoveToFixed', Idle: 'Idle', Fire: 'FireInfantery', Scout: 'Scout', Change: 'Change' }],
    ['Car', { Avoid: 'Avoid', MoveTo: 'MoveTo', Idle: 'Idle', Fire: 'FireUnarmed', Scout: 'Scout', Change: 'Change' }],
    ['UnarmedTank', { Avoid: 'Avoid', MoveTo: 'MoveTo', Idle: 'Idle', Fire: 'FireUnarmed', Scout: 'Scout', Change: 'Change' }],
    ['LandingCraft', { Avoid: 'Avoid', MoveTo: 'MoveTo', Idle: 'Idle', Fire: 'FireUnarmed', Change: 'ChangeLandingCraft' }],
    ['Passenger', { MoveTo: 'MoveToFixed', Idle: 'Idle', Fire: 'FireUnarmed', Scout: 'Scout', Change: 'Change' }],
    ['BoatFixed', { MoveTo: 'MoveToFixed', Idle: 'Idle', Fire: 'FireLargeBore', Scout: 'Scout', Change: 'ChangeTeleport' }],
    ['LandingCraftPassenger', { MoveTo: 'MoveToFixed', Idle: 'Idle', Fire: 'FireUnarmed', Scout: 'Scout', Change: 'ChangeLandingCraft' }],
    ['LandingCraftFixed', { MoveTo: 'MoveToFixed', Idle: 'Idle', Fire: 'FireInfantery', Scout: 'Scout', Change: 'ChangeLandingCraft' }],
    ['UnarmedBoat', { MoveTo: 'MoveToFixed', Idle: 'Idle', Fire: 'FireUnarmed', Scout: 'Scout', Change: 'ChangeTeleport' }],
    ['FixedLargeBore', { MoveTo: 'MoveToFixed', Idle: 'Idle', Fire: 'FireLargeBore', Scout: 'Scout', Change: 'Change' }],
    ['ArtilleryDriver', { Avoid: 'Avoid', MoveTo: 'MoveTo', Idle: 'Idle', Fire: 'FireDriver', Scout: 'Scout', TakeCover: 'TakeCover', Change: 'Change' }],
    ['UnarmedPlane', { MoveTo: 'MoveTo', Idle: 'Idle', Fire: 'FireUnarmed', Change: 'Change' }],
    ['AmphibiousCar', { Avoid: 'Avoid', MoveTo: 'MoveTo', Idle: 'Idle', Fire: 'FireUnarmed', Scout: 'Scout', Change: 'Change' }],
    ['FixedGuidedMissileLauncher', { MoveTo: 'MoveToFixed', Idle: 'Idle', Fire: 'FireGuided', Scout: 'Scout', Change: 'Change' }],
  ],
  fh: [
    ['Tank', { Avoid: 'Avoid', MoveTo: 'MoveTo', Idle: 'Idle', Fire: 'FireInfantery', Scout: 'Scout', Change: 'Change' }],
    ['Plane', { MoveTo: 'MoveTo', Idle: 'Idle', Fire: 'Fire3d', Change: 'Change' }],
    ['Boat', { Avoid: 'Avoid', MoveTo: 'MoveTo', Idle: 'Idle', Fire: 'FireLargeBore', Scout: 'Scout', Change: 'ChangeTeleport' }],
    ['Infantery', { Avoid: 'Avoid', MoveTo: 'MoveTo', Idle: 'Idle', Fire: 'FireInfantery', Special: 'MedicAssist', Scout: 'Scout', TakeCover: 'TakeCoverInfantry', Change: 'Change' }],
    ['Fixed', { MoveTo: 'MoveToFixed', Idle: 'Idle', Fire: 'FireInfantery', Scout: 'Scout', Change: 'Change' }],
    ['Car', { Avoid: 'Avoid', MoveTo: 'MoveTo', Idle: 'Idle', Fire: 'FireUnarmed', Scout: 'Scout', Change: 'Change' }],
    ['UnarmedTank', { Avoid: 'Avoid', MoveTo: 'MoveTo', Idle: 'Idle', Fire: 'FireUnarmed', Scout: 'Scout', Change: 'Change' }],
    ['LandingCraft', { Avoid: 'Avoid', MoveTo: 'MoveTo', Idle: 'Idle', Fire: 'FireUnarmed', Change: 'ChangeLandingCraft' }],
    ['Passenger', { MoveTo: 'MoveToFixed', Idle: 'Idle', Fire: 'FireUnarmed', Scout: 'Scout', Change: 'Change' }],
    ['BoatFixed', { MoveTo: 'MoveToFixed', Idle: 'Idle', Fire: 'FireLargeBore', Scout: 'Scout', Change: 'ChangeTeleport' }],
    ['LandingCraftPassenger', { MoveTo: 'MoveToFixed', Idle: 'Idle', Fire: 'FireUnarmed', Scout: 'Scout', Change: 'ChangeLandingCraft' }],
    ['LandingCraftFixed', { MoveTo: 'MoveToFixed', Idle: 'Idle', Fire: 'FireInfantery', Scout: 'Scout', Change: 'ChangeLandingCraft' }],
    ['UnarmedBoat', { MoveTo: 'MoveToFixed', Idle: 'Idle', Fire: 'FireUnarmed', Scout: 'Scout', Change: 'ChangeTeleport' }],
    ['FixedLargeBore', { MoveTo: 'MoveToFixed', Idle: 'Idle', Fire: 'FireLargeBore', Scout: 'Scout', Change: 'Change' }],
    ['ArtilleryDriver', { Avoid: 'Avoid', MoveTo: 'MoveTo', Idle: 'Idle', Fire: 'FireDriver', Scout: 'Scout', Change: 'Change' }],
    ['UnarmedPlane', { MoveTo: 'MoveTo', Idle: 'Idle', Fire: 'FireUnarmed', Change: 'Change' }],
    ['AmphibiousCar', { Avoid: 'Avoid', MoveTo: 'MoveTo', Idle: 'Idle', Fire: 'FireUnarmed', Scout: 'Scout', Change: 'Change' }],
    ['FixedGuidedMissileLauncher', { MoveTo: 'MoveToFixed', Idle: 'Idle', Fire: 'FireGuided', Scout: 'Scout', Change: 'Change' }],
    ['ArmedBoat', { Avoid: 'Avoid', MoveTo: 'MoveTo', Idle: 'Idle', Fire: 'FireInfantery', Scout: 'Scout', Change: 'ChangeTeleport' }],
    ['MobileArtillery', { Avoid: 'Avoid', MoveTo: 'MoveTo', Idle: 'Idle', Fire: 'FireLargeBore', Scout: 'Scout', Change: 'Change' }],
    ['BoatFixedNonArty', { MoveTo: 'MoveToFixed', Idle: 'Idle', Fire: 'FireInfantery', Scout: 'Scout', Change: 'ChangeTeleport' }],
    ['FixedNoChange', { MoveTo: 'MoveToFixed', Idle: 'Idle', Fire: 'FireInfantery', Scout: 'Scout', Change: 'Change' }],
  ],
  bf1918: [
    ['HeavyTank', { Avoid: 'Avoid', MoveTo: 'MoveTo', Idle: 'Idle', Fire: 'FireInfantery', Special: 'Roam', Change: 'Change' }],
    ['LightTank', { Avoid: 'Avoid', MoveTo: 'MoveTo', Idle: 'Idle', Fire: 'FireInfantery', Special: 'Roam', Change: 'Change' }],
    ['UnarmedTank', { Avoid: 'Avoid', MoveTo: 'MoveTo', Idle: 'Idle', Fire: 'FireUnarmed', Change: 'Change' }],
    ['Truck', { Avoid: 'Avoid', MoveTo: 'MoveTo', Idle: 'Idle', Fire: 'FireUnarmed', Change: 'Change' }],
    ['ArmedCar', { Avoid: 'Avoid', MoveTo: 'MoveTo', Idle: 'Idle', Fire: 'FireInfantery', Special: 'Roam', Change: 'Change' }],
    ['Car', { Avoid: 'Avoid', MoveTo: 'MoveTo', Idle: 'Idle', Fire: 'FireUnarmed', Special: 'Roam', Change: 'Change' }],
    ['Infantry', { Avoid: 'Avoid', MoveTo: 'MoveTo', Idle: 'Idle', Fire: 'FireInfantery', Special: 'MedicAssist', Scout: 'Scout', TakeCover: 'TakeCoverInfantry', Change: 'Change' }],
    ['Artillery', { Avoid: 'Avoid', MoveTo: 'MoveTo', Idle: 'Idle', Fire: 'FireDriver', Scout: 'Scout', Change: 'Change' }],
    ['ArtilleryGunner', { MoveTo: 'MoveToFixed', Idle: 'Idle', Fire: 'FireLargeBore', Scout: 'Scout', Change: 'ChangeTeleport' }],
    ['Gunner', { MoveTo: 'MoveToFixed', Idle: 'Idle', Fire: 'FireInfantery', Scout: 'Scout', Change: 'Change' }],
    ['Passenger', { MoveTo: 'MoveToFixed', Idle: 'Idle', Fire: 'FireUnarmed', Scout: 'Scout', Change: 'Change' }],
    ['Boat', { Avoid: 'Avoid', MoveTo: 'MoveTo', Idle: 'Idle', Fire: 'FireLargeBore', Special: 'Roam', Scout: 'Scout', Change: 'ChangeTeleport' }],
    ['UnarmedBoat', { Avoid: 'Avoid', MoveTo: 'MoveTo', Idle: 'Idle', Fire: 'FireUnarmed', Change: 'ChangeTeleport' }],
    ['BoatGunner', { MoveTo: 'MoveToFixed', Idle: 'Idle', Fire: 'FireLargeBore', Change: 'ChangeTeleport' }],
    ['LandingCraft', { Avoid: 'Avoid', MoveTo: 'MoveTo', Idle: 'Idle', Fire: 'FireUnarmed', Change: 'ChangeLandingCraft' }],
    ['LandingCraftGunner', { MoveTo: 'MoveToFixed', Idle: 'Idle', Fire: 'FireInfantery', Scout: 'Scout', Change: 'ChangeLandingCraft' }],
    ['LandingCraftPassenger', { MoveTo: 'MoveToFixed', Idle: 'Idle', Fire: 'FireUnarmed', Scout: 'Scout', Change: 'ChangeLandingCraft' }],
    ['Submarine', { Avoid: 'Avoid', MoveTo: 'MoveTo', Idle: 'Idle', Fire: 'FireInfantery', Special: 'Roam', Scout: 'Scout', Change: 'ChangeTeleport' }],
    ['FighterPlane', { Avoid: 'Avoid', MoveTo: 'MoveTo', Idle: 'Idle', Fire: 'Fire3d', Special: 'Roam', Change: 'Change' }],
    ['BomberPlane', { Avoid: 'Avoid', MoveTo: 'MoveTo', Idle: 'Idle', Fire: 'Fire3d', Change: 'Change' }],
    ['UnarmedPlane', { Avoid: 'Avoid', MoveTo: 'MoveTo', Idle: 'Idle', Fire: 'FireUnarmed', Special: 'Roam', Change: 'Change' }],
    ['PlaneGunner', { MoveTo: 'MoveToFixed', Idle: 'Idle', Fire: 'FireInfantery', Change: 'Change' }],
    ['Zeppelin', { Avoid: 'Avoid', MoveTo: 'MoveTo', Idle: 'Idle', Fire: 'FireUnarmed', Special: 'Roam', Change: 'Change' }],
    ['Train', { Avoid: 'Avoid', MoveTo: 'MoveTo', Idle: 'Idle', Fire: 'FireUnarmed', Special: 'Roam', Change: 'Change' }],
  ],
  eod: [
    ['Tank', { Avoid: 'Avoid', MoveTo: 'MoveTo', Idle: 'Idle', Fire: 'FireInfantery', Scout: 'Scout', TakeCover: 'TakeCover', Change: 'Change' }],
    ['Plane', { MoveTo: 'MoveTo', Idle: 'Idle', Fire: 'Fire3d', Change: 'Change' }],
    ['Boat', { Avoid: 'Avoid', MoveTo: 'MoveTo', Idle: 'Idle', Fire: 'FireLargeBore', Scout: 'Scout', Change: 'ChangeTeleport' }],
    ['Infantery', { Avoid: 'Avoid', MoveTo: 'MoveTo', Idle: 'Idle', Fire: 'FireInfantery', Special: 'MedicAssist', Scout: 'Scout', TakeCover: 'TakeCoverInfantry', Change: 'Change' }],
    ['Fixed', { MoveTo: 'MoveToFixed', Idle: 'Idle', Fire: 'FireInfantery', Scout: 'Scout', Change: 'Change' }],
    ['Car', { Avoid: 'Avoid', MoveTo: 'MoveTo', Idle: 'Idle', Fire: 'FireUnarmed', Scout: 'Scout', Change: 'Change' }],
    ['UnarmedTank', { Avoid: 'Avoid', MoveTo: 'MoveTo', Idle: 'Idle', Fire: 'FireUnarmed', Scout: 'Scout', Change: 'Change' }],
    ['LandingCraft', { Avoid: 'Avoid', MoveTo: 'MoveTo', Idle: 'Idle', Fire: 'FireUnarmed', Change: 'ChangeLandingCraft' }],
    ['Passenger', { MoveTo: 'MoveToFixed', Idle: 'Idle', Fire: 'FireUnarmed', Scout: 'Scout', Change: 'Change' }],
    ['BoatFixed', { MoveTo: 'MoveToFixed', Idle: 'Idle', Fire: 'FireLargeBore', Scout: 'Scout', Change: 'ChangeTeleport' }],
    ['LandingCraftPassenger', { MoveTo: 'MoveToFixed', Idle: 'Idle', Fire: 'FireUnarmed', Scout: 'Scout', Change: 'ChangeLandingCraft' }],
    ['LandingCraftFixed', { MoveTo: 'MoveToFixed', Idle: 'Idle', Fire: 'FireInfantery', Scout: 'Scout', Change: 'ChangeLandingCraft' }],
    ['UnarmedBoat', { MoveTo: 'MoveToFixed', Idle: 'Idle', Fire: 'FireUnarmed', Scout: 'Scout', Change: 'ChangeTeleport' }],
    ['FixedLargeBore', { MoveTo: 'MoveToFixed', Idle: 'Idle', Fire: 'FireLargeBore', Scout: 'Scout', Change: 'Change' }],
    ['ArtilleryDriver', { Avoid: 'Avoid', MoveTo: 'MoveTo', Idle: 'Idle', Fire: 'FireDriver', Scout: 'Scout', TakeCover: 'TakeCover', Change: 'Change' }],
    ['UnarmedPlane', { MoveTo: 'MoveTo', Idle: 'Idle', Fire: 'FireUnarmed', Change: 'Change' }],
    ['AmphibiousCar', { Avoid: 'Avoid', MoveTo: 'MoveTo', Idle: 'Idle', Fire: 'FireUnarmed', Scout: 'Scout', Change: 'Change' }],
    ['FixedGuidedMissileLauncher', { MoveTo: 'MoveToFixed', Idle: 'Idle', Fire: 'FireGuided', Scout: 'Scout', Change: 'Change' }],
    ['AmphibiousTank', { Avoid: 'Avoid', MoveTo: 'MoveTo', Idle: 'Idle', Fire: 'FireInfantery', Scout: 'Scout', TakeCover: 'TakeCover', Change: 'Change' }],
    ['AmphibiousAPC', { Avoid: 'Avoid', MoveTo: 'MoveTo', Idle: 'Idle', Fire: 'FireUnarmed', Scout: 'Scout', Change: 'Change' }],
    ['AmphibiousArty', { Avoid: 'Avoid', MoveTo: 'MoveTo', Idle: 'Idle', Fire: 'FireDriver', Scout: 'Scout', TakeCover: 'TakeCover', Change: 'Change' }],
  ],
};
/* eslint-enable max-len */
// FHSW's file differs from FH's by its comments alone, row for row and
// generator for generator; GCMOD's is vanilla's rows 0 to 14.
AI_ROWS.fhsw = AI_ROWS.fh;
AI_ROWS.gcmod = AI_ROWS.bf1942.slice(0, 15);

/** The mods that ship no `AIbehaviours.con` of their own, by the `mod` word
 *  of their `vehicle-ai.json` (lower case). */
const VANILLA_ROWS = new Set(['bf1942', 'xpack1', 'xpack2', 'desertcombat', 'dc_final']);

/** The row table a mod runs: its own, vanilla's for one that ships none, and
 *  vanilla's for a mod not transcribed here. */
export function rowsOf(mod) {
  const key = String(mod ?? 'bf1942').toLowerCase();
  if (VANILLA_ROWS.has(key)) return AI_ROWS.bf1942;
  return AI_ROWS[key] ?? AI_ROWS.bf1942;
}

/**
 * A seat's row: `{ name, behaviours }`, from its row name (`equipment`, which
 * `extract_vehicle_ai.py` stamps from the mod's own list) where the table
 * carries one, else from its number through the mod's list; null with
 * neither, or a name or number the mod's file does not list.
 */
export function rowFor({ mod = null, equipment = null, equipmentType = null } = {}) {
  const rows = rowsOf(mod);
  if (equipment) {
    const hit = rows.find(r => r[0].toLowerCase() === String(equipment).toLowerCase());
    if (hit) return { name: hit[0], behaviours: hit[1] };
  }
  if (Number.isInteger(equipmentType) && rows[equipmentType]) {
    const [name, behaviours] = rows[equipmentType];
    return { name, behaviours };
  }
  return null;
}

/** A row's Fire generator, or null with no row. */
export const rowFire = row => row?.behaviours?.Fire ?? null;
