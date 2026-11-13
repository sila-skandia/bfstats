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
 * The kind a bot handles a hull as: its drive kind, but an aircraft only
 * when its AI template says so (`aiTemplate.addType ITAir`). The engine never
 * reads a hull's physics to pick a bot's control: the strategic order goes to
 * `orderAirBot` on the information's air flag (`AIStrategicArea::orderBot`
 * 0x08640760, `+4 & 0x10`, AI-71), and the move is run by the plan
 * interpreter of the seat's equipment type (`AISettings::getPlanInterpreter`
 * 0x08483db0, the table `aiSettings.addInterpreterEntry <vehicle> <entry>`
 * fills: `CarMoveTo` for a Car, `PlaneMoveTo` for a plane, AI-180). Galactic
 * Conquest's Speederbike is a hover bike on five `c_ETPlane` engines whose
 * template is vanilla's `Willy` (a Car: ITGround, no ITAir). Handled by its
 * drive kind it was flown with the plane law, which holds a takeoff run
 * until the hull is airborne: the bike never is, so its driver held the
 * throttle open in a straight line, out of the level at 107 m/s and into the
 * ground. A table without types (an older tree) keeps the drive kind.
 */
export function botKind(kind, ai) {
  const types = ai?.types;
  return kind === 'air' && types?.length && !types.includes('ITAir') ? 'ground' : kind;
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

/**
 * The modifier sets a row's Avoid and Change columns name, per mod (the
 * tenth word of `aiSettings.setVehicleBehaviour <row> <behaviour> ...`, the
 * set made by `aiSettings.createBehaviourModifiers <set>` and filled by
 * `setBehaviourModifier`). `BotMain::calculateMods` 0x08525b80 multiplies the
 * ACTIVE behaviour's column (`+0x44[i]`) into every behaviour's mod while its
 * plan runs (ledger AI-35). Each set is a list in the order Avoid, MoveTo,
 * Idle, Fire, Special, Scout, TakeCover, Change. Transcribed from the shipped
 * files (`rem` lines skipped) on 2026-11-12. Vanilla names only `AvoidInhibit`
 * (Avoid column) and `ChangeInhibit` / `UnitWeights` (Change column); every
 * other column of every vanilla row is `UnitWeights`, all ones. The mods name
 * more sets in their other columns (FH's `TankWeights`, BF1918's per-class
 * weights, EoD's `InfantryWeights`, ...): NOT BUILT, those columns stay 1, as
 * do a mod's own `UnitWeights` (BF1918's and EoD's are not all ones) where it
 * is the basic weight rather than a column.
 */
/* eslint-disable max-len */
export const INHIBITOR_SETS = {
  bf1942: {
    sets: {
      AvoidInhibit: [1.0, 0.3, 1.0, 1.0, 0.5, 1.0, 1.0, 1.0],
      ChangeInhibit: [0.8, 0.0, 0.01, 0.75, 0.0, 0.5, 1.0, 1.0],
      UnitWeights: [1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0],
    },
    rows: {
      Tank: {Avoid: "AvoidInhibit", Change: "ChangeInhibit"},
      Plane: {Change: "ChangeInhibit"},
      Boat: {Avoid: "AvoidInhibit", Change: "ChangeInhibit"},
      Infantery: {Avoid: "AvoidInhibit", Change: "UnitWeights"},
      Fixed: {Change: "UnitWeights"},
      BoatFixed: {Change: "ChangeInhibit"},
      Car: {Avoid: "AvoidInhibit", Change: "UnitWeights"},
      UnarmedTank: {Avoid: "AvoidInhibit", Change: "ChangeInhibit"},
      LandingCraft: {Avoid: "AvoidInhibit", Change: "ChangeInhibit"},
      Passenger: {Change: "ChangeInhibit"},
      LandingCraftPassenger: {Change: "ChangeInhibit"},
      LandingCraftFixed: {Change: "UnitWeights"},
      UnarmedBoat: {Change: "ChangeInhibit"},
      FixedLargeBore: {Change: "UnitWeights"},
      ArtilleryDriver: {Avoid: "AvoidInhibit", Change: "ChangeInhibit"},
      UnarmedPlane: {Change: "ChangeInhibit"},
      AmphibiousCar: {Avoid: "AvoidInhibit", Change: "UnitWeights"},
      FixedGuidedMissileLauncher: {Change: "UnitWeights"},
    },
  },
  fh: {
    sets: {
      AvoidInhibit: [1.0, 0.3, 1.0, 1.0, 0.5, 1.0, 1.0, 1.0],
      ChangeInhibit: [0.8, 0.0, 0.01, 0.75, 0.0, 0.5, 1.0, 1.0],
      FixedNoChangeWeights: [0.0, 0.0, 0.01, 1.0, 0.0, 1.0, 0.0, 0.0],
      PlaneWeights: [0.0, 1.0, 0.1, 1.0, 0.0, 0.0, 0.0, 0.0],
      UnitWeights: [1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0],
    },
    rows: {
      Tank: {Avoid: "AvoidInhibit", Change: "ChangeInhibit"},
      Plane: {Change: "PlaneWeights"},
      Boat: {Avoid: "AvoidInhibit", Change: "ChangeInhibit"},
      Infantery: {Avoid: "AvoidInhibit", Change: "UnitWeights"},
      Fixed: {Change: "UnitWeights"},
      BoatFixed: {Change: "ChangeInhibit"},
      Car: {Avoid: "AvoidInhibit", Change: "UnitWeights"},
      UnarmedTank: {Avoid: "AvoidInhibit", Change: "ChangeInhibit"},
      LandingCraft: {Avoid: "AvoidInhibit", Change: "ChangeInhibit"},
      Passenger: {Change: "ChangeInhibit"},
      LandingCraftPassenger: {Change: "ChangeInhibit"},
      LandingCraftFixed: {Change: "UnitWeights"},
      UnarmedBoat: {Change: "ChangeInhibit"},
      FixedLargeBore: {Change: "UnitWeights"},
      ArtilleryDriver: {Avoid: "AvoidInhibit", Change: "ChangeInhibit"},
      UnarmedPlane: {Change: "PlaneWeights"},
      AmphibiousCar: {Avoid: "AvoidInhibit", Change: "UnitWeights"},
      FixedGuidedMissileLauncher: {Change: "UnitWeights"},
      ArmedBoat: {Avoid: "AvoidInhibit", Change: "ChangeInhibit"},
      MobileArtillery: {Avoid: "AvoidInhibit", Change: "ChangeInhibit"},
      BoatFixedNonArty: {Change: "ChangeInhibit"},
      FixedNoChange: {Change: "FixedNoChangeWeights"},
    },
  },
  fhsw: {
    sets: {
      AvoidInhibit: [1.0, 0.3, 1.0, 1.0, 0.5, 1.0, 1.0, 1.0],
      ChangeInhibit: [0.8, 0.0, 0.01, 0.75, 0.0, 0.5, 1.0, 1.0],
      FixedNoChangeWeights: [0.0, 0.0, 0.01, 1.0, 0.0, 1.0, 0.0, 0.0],
      PlaneWeights: [0.0, 1.0, 0.1, 1.0, 0.0, 0.0, 0.0, 0.0],
      UnitWeights: [1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0],
    },
    rows: {
      Tank: {Avoid: "AvoidInhibit", Change: "ChangeInhibit"},
      Plane: {Change: "PlaneWeights"},
      Boat: {Avoid: "AvoidInhibit", Change: "ChangeInhibit"},
      Infantery: {Avoid: "AvoidInhibit", Change: "UnitWeights"},
      Fixed: {Change: "UnitWeights"},
      BoatFixed: {Change: "ChangeInhibit"},
      Car: {Avoid: "AvoidInhibit", Change: "UnitWeights"},
      UnarmedTank: {Avoid: "AvoidInhibit", Change: "ChangeInhibit"},
      LandingCraft: {Avoid: "AvoidInhibit", Change: "ChangeInhibit"},
      Passenger: {Change: "ChangeInhibit"},
      LandingCraftPassenger: {Change: "ChangeInhibit"},
      LandingCraftFixed: {Change: "UnitWeights"},
      UnarmedBoat: {Change: "ChangeInhibit"},
      FixedLargeBore: {Change: "UnitWeights"},
      ArtilleryDriver: {Avoid: "AvoidInhibit", Change: "ChangeInhibit"},
      UnarmedPlane: {Change: "PlaneWeights"},
      AmphibiousCar: {Avoid: "AvoidInhibit", Change: "UnitWeights"},
      FixedGuidedMissileLauncher: {Change: "UnitWeights"},
      ArmedBoat: {Avoid: "AvoidInhibit", Change: "ChangeInhibit"},
      MobileArtillery: {Avoid: "AvoidInhibit", Change: "ChangeInhibit"},
      BoatFixedNonArty: {Change: "ChangeInhibit"},
      FixedNoChange: {Change: "FixedNoChangeWeights"},
    },
  },
  bf1918: {
    sets: {
      AvoidInhibit: [1.2, 1.2, 0.1, 3.0, 0.5, 0.5, 0.5, 1.0],
      ChangeInhibit: [0.1, 0.1, 0.01, 3.0, 0.1, 0.1, 0.1, 1.0],
      FixedWeights: [0.0, 0.0, 0.1, 9.5, 0.0, 1.5, 0.0, 0.0],
      LCChangeInhibit: [0.8, 3.0, 0.001, 1.0, 0.1, 1.0, 2.0, 5.0],
      PlaneAvoidInhibit: [7.5, 3.0, 0.01, 3.0, 1.0, 0.0, 0.0, 0.1],
      PlaneChangeInhibit: [1.0, 5.0, 0.1, 0.75, 0.1, 0.5, 3.0, 0.01],
    },
    rows: {
      HeavyTank: {Avoid: "AvoidInhibit", Change: "ChangeInhibit"},
      LightTank: {Avoid: "AvoidInhibit", Change: "ChangeInhibit"},
      UnarmedTank: {Avoid: "AvoidInhibit", Change: "ChangeInhibit"},
      Truck: {Avoid: "AvoidInhibit", Change: "ChangeInhibit"},
      ArmedCar: {Avoid: "AvoidInhibit", Change: "ChangeInhibit"},
      Car: {Avoid: "AvoidInhibit", Change: "ChangeInhibit"},
      Infantry: {Avoid: "AvoidInhibit", Change: "ChangeInhibit"},
      Artillery: {Avoid: "AvoidInhibit", Change: "ChangeInhibit"},
      ArtilleryGunner: {Change: "ChangeInhibit"},
      Gunner: {Change: "FixedWeights"},
      Passenger: {Change: "ChangeInhibit"},
      Boat: {Avoid: "AvoidInhibit", Change: "ChangeInhibit"},
      UnarmedBoat: {Avoid: "AvoidInhibit", Change: "ChangeInhibit"},
      BoatGunner: {Change: "ChangeInhibit"},
      LandingCraft: {Avoid: "AvoidInhibit", Change: "LCChangeInhibit"},
      LandingCraftGunner: {Change: "LCChangeInhibit"},
      LandingCraftPassenger: {Change: "LCChangeInhibit"},
      Submarine: {Avoid: "AvoidInhibit", Change: "ChangeInhibit"},
      FighterPlane: {Avoid: "PlaneAvoidInhibit", Change: "PlaneChangeInhibit"},
      BomberPlane: {Avoid: "PlaneAvoidInhibit", Change: "PlaneChangeInhibit"},
      UnarmedPlane: {Avoid: "PlaneAvoidInhibit", Change: "PlaneChangeInhibit"},
      PlaneGunner: {Change: "PlaneChangeInhibit"},
      Zeppelin: {Avoid: "AvoidInhibit", Change: "ChangeInhibit"},
      Train: {Avoid: "AvoidInhibit", Change: "ChangeInhibit"},
    },
  },
  eod: {
    sets: {
      AvoidInhibit: [1.0, 0.3, 0.01, 0.75, 1.0, 1.0, 1.0, 1.0],
      ChangeInhibit: [0.8, 0.0, 0.01, 0.75, 0.0, 0.5, 1.0, 1.0],
      InfantryWeights: [1.0, 3.0, 0.0001, 7.5, 2.0, 1.0, 1.0, 2.0],
      PlaneChangeInhibit: [0.8, 0.0, 0.01, 0.75, 0.0, 0.5, 1.0, 0.1],
      UnarmedWeights: [1.0, 1.0, 0.01, 0.0, 1.0, 1.0, 1.0, 1.0],
      UnitWeights: [1.0, 1.0, 0.01, 7.5, 1.0, 1.0, 1.0, 1.0],
    },
    rows: {
      Tank: {Avoid: "AvoidInhibit", Change: "ChangeInhibit"},
      Plane: {Change: "PlaneChangeInhibit"},
      Boat: {Avoid: "AvoidInhibit", Change: "ChangeInhibit"},
      Infantery: {Avoid: "AvoidInhibit", Change: "InfantryWeights"},
      Fixed: {Change: "UnitWeights"},
      BoatFixed: {Change: "ChangeInhibit"},
      Car: {Avoid: "AvoidInhibit", Change: "UnarmedWeights"},
      UnarmedTank: {Avoid: "AvoidInhibit", Change: "ChangeInhibit"},
      LandingCraft: {Avoid: "AvoidInhibit", Change: "ChangeInhibit"},
      Passenger: {Change: "ChangeInhibit"},
      LandingCraftPassenger: {Change: "ChangeInhibit"},
      LandingCraftFixed: {Change: "UnitWeights"},
      UnarmedBoat: {Change: "ChangeInhibit"},
      FixedLargeBore: {Change: "UnitWeights"},
      ArtilleryDriver: {Avoid: "AvoidInhibit", Change: "ChangeInhibit"},
      UnarmedPlane: {Change: "ChangeInhibit"},
      AmphibiousCar: {Avoid: "AvoidInhibit", Change: "UnitWeights"},
      FixedGuidedMissileLauncher: {Change: "UnitWeights"},
      AmphibiousTank: {Avoid: "AvoidInhibit", Change: "ChangeInhibit"},
      AmphibiousAPC: {Avoid: "AvoidInhibit", Change: "ChangeInhibit"},
      AmphibiousArty: {Avoid: "AvoidInhibit", Change: "ChangeInhibit"},
    },
  },
  gcmod: {
    sets: {
      AvoidInhibit: [1.0, 0.3, 1.0, 1.0, 0.5, 1.0, 1.0, 1.0],
      ChangeInhibit: [0.8, 0.0, 0.01, 0.75, 0.0, 0.5, 1.0, 1.0],
      UnitWeights: [1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0],
    },
    rows: {
      Tank: {Avoid: "AvoidInhibit", Change: "ChangeInhibit"},
      Plane: {Change: "ChangeInhibit"},
      Boat: {Avoid: "AvoidInhibit", Change: "ChangeInhibit"},
      Infantery: {Avoid: "AvoidInhibit", Change: "UnitWeights"},
      Fixed: {Change: "UnitWeights"},
      BoatFixed: {Change: "ChangeInhibit"},
      Car: {Avoid: "AvoidInhibit", Change: "UnitWeights"},
      UnarmedTank: {Avoid: "AvoidInhibit", Change: "ChangeInhibit"},
      LandingCraft: {Avoid: "AvoidInhibit", Change: "ChangeInhibit"},
      Passenger: {Change: "ChangeInhibit"},
      LandingCraftPassenger: {Change: "ChangeInhibit"},
      LandingCraftFixed: {Change: "UnitWeights"},
      UnarmedBoat: {Change: "ChangeInhibit"},
      FixedLargeBore: {Change: "UnitWeights"},
      ArtilleryDriver: {Avoid: "AvoidInhibit", Change: "ChangeInhibit"},
    },
  },
};
/* eslint-enable max-len */
INHIBITOR_SETS.dc_final = INHIBITOR_SETS.bf1942;

const BEHAVIOUR_ORDER = ['Avoid', 'MoveTo', 'Idle', 'Fire', 'Special', 'Scout', 'TakeCover', 'Change'];
let rowsMod = null;

/** The mod whose rows a bot on foot runs (bot-units.js sets it from
 *  `vehicle-ai.json`'s `mod`). */
export function setRowsMod(mod) { rowsMod = mod ?? null; }

/** The infantry row of a mod: `Infantery` in vanilla's spelling, `Infantry`
 *  in BF1918's. */
export function infantryRow(mod = rowsMod) {
  const hit = rowsOf(mod).find(r => /^Infant/i.test(r[0]));
  return hit ? { name: hit[0], behaviours: hit[1] } : null;
}

/**
 * The modifier column a row registers for `behaviour` (Avoid or Change), as
 * `{ Avoid: w, MoveTo: w, ... }`, or null where the row registers no such
 * column (or for a behaviour whose column is not transcribed). `row` is a
 * row name.
 */
export function inhibitorColumn(rowName, behaviour, mod = rowsMod) {
  const key = String(mod ?? 'bf1942').toLowerCase();
  const table = INHIBITOR_SETS[VANILLA_ROWS.has(key) ? 'bf1942' : key] ?? INHIBITOR_SETS.bf1942;
  const set = table.rows[rowName]?.[behaviour];
  const values = set ? table.sets[set] : null;
  if (!values) return null;
  return Object.fromEntries(BEHAVIOUR_ORDER.map((b, i) => [b, values[i]]));
}
