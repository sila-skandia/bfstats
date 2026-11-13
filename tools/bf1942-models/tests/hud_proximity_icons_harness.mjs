// Drives `viewer/mine-icon.js` and `viewer/supply.js` `seatedIcons` outside a browser.
import * as mine from './mine-icon.js';
import { SupplyDepot, SupplyField } from './supply.js';

const out = { radii: [mine.MINE_ICON_RADIUS_ENGINEER, mine.MINE_ICON_RADIUS_SEATED],
              type: mine.MINE_PROJECTILE_TYPE, kit: mine.ENGINEER_KIT };

// --- the mine icon ---------------------------------------------------------
const at = (x, team = 2, type = 1) => [{ x, y: 0, z: 0, team, type }];
const foot = kit => ({ alive: true, seated: false, kit, team: 2, x: 0, y: 0, z: 0 });
const seat = { alive: true, seated: true, kit: 0, team: 2, x: 0, y: 0, z: 0 };
out.engineer15 = mine.showMineIcon(foot(4), at(15));
out.engineer15_1 = mine.showMineIcon(foot(4), at(15.1));
out.medicOnFoot = mine.showMineIcon(foot(3), at(2));
out.seated30 = mine.showMineIcon(seat, at(30));
out.seated30_1 = mine.showMineIcon(seat, at(30.1));
out.enemyMine = mine.showMineIcon(seat, at(5, 1));
out.otherRound = mine.showMineIcon(seat, at(5, 2, -1));
out.dead = mine.showMineIcon({ ...seat, alive: false }, at(5));
// The table: a row's own type; a table baked before the word knows the two mines by name.
out.typeFromRow = mine.projectileTypeOf('LandmineProjectile', { landmineprojectile: { projectileType: 1 } });
out.typeOther = mine.projectileTypeOf('ExpPackProjectile', { landmineprojectile: { projectileType: 1 }, exppackprojectile: {} });
out.typeLegacy = mine.projectileTypeOf('LandmineProjectile', { landmineprojectile: { material: 1 } });
out.typeLegacyOther = mine.projectileTypeOf('GrenadeAlliesProjectile', { grenadealliesprojectile: {} });
out.typeNamedButTableKnows = mine.projectileTypeOf('APLandmineProjectile', { landmineprojectile: { projectileType: 1 }, aplandmineprojectile: {} });
// Over a GunFire's rounds.
const shot = (x, firer, template = 'LandmineProjectile') => ({
  group: { stats: { projectile: { template } } }, stamp: { firer }, mesh: { position: { x, y: 0, z: 0 } } });
const teams = { a: 2, b: 1 };
const teamOf = id => teams[id] ?? null;
const table = { landmineprojectile: { projectileType: 1 } };
out.liveFriendly = mine.friendlyMineNear(seat, [shot(40, 'a'), shot(20, 'a')], table, teamOf);
out.liveEnemy = mine.friendlyMineNear(seat, [shot(20, 'b')], table, teamOf);
out.livePack = mine.friendlyMineNear(seat, [shot(2, 'a', 'ExpPackProjectile')], table, teamOf);
out.liveFar = mine.friendlyMineNear(foot(4), [shot(20, 'a')], table, teamOf);
// The round keeps the side it was fired for.
{ const s = shot(5, 'a'); mine.friendlyMineNear(seat, [s], table, teamOf); teams.a = 1;
  out.keepsTeam = mine.friendlyMineNear(seat, [s], table, teamOf); teams.a = 2; }

// --- the depot icons in a seat --------------------------------------------
const hull = {};
const pad = new SupplyDepot({ x: 0, y: 0, z: 0 }, {
  radius: 10, team: 0, workOnSoldiers: false, workOnVehicles: true,
  ammoTypes: [[0, -1, 15, 0]], vehicleTypes: [['Sherman', -1, 8, 0]] }, 'RepairPoint');
const medic = new SupplyDepot({ x: 0, y: 0, z: 0 }, {
  radius: 10, team: 2, workOnSoldiers: true, workOnVehicles: false,
  health: [-1, 5, 0], ammoTypes: [[1, -1, 15, 0]] }, 'Locker', { root: hull });
const field = new SupplyField([pad, medic]);
const probe = o => ({ ...field.seatedIcons({ team: 2, root: null, x: 3, y: 0, z: 0, rootX: 3, rootY: 0, rootZ: 0,
  template: 'Sherman', ammoTags: [0], ...o }) });
out.driver = probe({});
out.wholeTankStillShows = probe({}).repair;
out.otherTemplate = probe({ template: 'Sherman_Gunner_PCO' });
out.outOfRange = probe({ x: 10.5, rootX: 10.5 });
out.atRadius = probe({ x: 10, rootX: 10 });
out.otherAmmoTag = probe({ ammoTags: [9] });
out.unknownTag = probe({ ammoTags: [null] });
out.noGuns = probe({ ammoTags: [] });
out.ridingTheDepot = probe({ root: hull, template: 'M3A1', ammoTags: [] });
out.ridingEnemySide = probe({ root: hull, team: 1, template: 'M3A1', ammoTags: [] });
out.caseBlind = probe({ template: 'sherman' }).repair;
console.log(JSON.stringify(out));
