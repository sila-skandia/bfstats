// Drives `viewer/nation.js` outside a browser and prints one JSON blob.
//
// Same shape as the other harnesses here: `tests/test_nation_js.py` copies
// the viewer module in under its own name, so the file under test is the
// file the page loads, byte for byte. The module imports nothing and reads
// no global state -- every case below passes its own `nations` table and
// control points, matching what `extract_menu_layout.py`'s
// `team_nation_from_level` is fed in the Python-side test that runs
// alongside this one.

import { flagMeshNation, cpNation, teamNation } from './nation.js';

const results = {};

// The vanilla table `flag_mesh_nations` writes for a pack with no art of
// its own beyond `NATIONS` -- `so` aliased to `rus`, `fr`/`it`/`pl` absent.
const VANILLA = { us: 'us', ge: 'ger', uk: 'brit', jp: 'jp', so: 'rus', can: 'can' };
// Eve of Destruction's own table (`viewer/maps/mods/eod/_shared/hud/hud.json`
// on this machine): `so` stops being aliased because EoD ships its own art,
// `fr`/`it` are added, `pl` still is not -- no installed `menu.rfa` holds a
// `conp_pl`.
const EOD = { us: 'us', ge: 'ger', uk: 'brit', jp: 'jp', so: 'so', can: 'can', fr: 'fre', it: 'it' };

// --- flagMeshNation ----------------------------------------------------------

results.flagMeshNation = {
  us: flagMeshNation('flagus_m1', VANILLA),
  ge: flagMeshNation('flagge_m1', VANILLA),
  uk: flagMeshNation('flaguk_m1', VANILLA),
  jp: flagMeshNation('flagjp_m1', VANILLA),
  so_vanilla: flagMeshNation('flagso_m1', VANILLA),
  so_eod: flagMeshNation('flagso_m1', EOD),
  can: flagMeshNation('flagcan_m1', VANILLA),
  fr_vanilla: flagMeshNation('flagfr_m1', VANILLA),
  fr_eod: flagMeshNation('flagfr_m1', EOD),
  pl_eod: flagMeshNation('flagpl_m1', EOD),
  caseInsensitive: flagMeshNation('FLAGUS_M1', VANILLA),
  noMesh: flagMeshNation(null, VANILLA),
  emptyMesh: flagMeshNation('', VANILLA),
  notAFlag: flagMeshNation('somethingelse_m1', VANILLA),
};

// --- cpNation ----------------------------------------------------------------

results.cpNation = {
  // A resolved mesh.
  us: cpNation({ team: 2, flagMesh: 'flagus_m1' }, VANILLA),
  can: cpNation({ team: 2, flagMesh: 'flagcan_m1' }, VANILLA),
  // Pathet Lao: a mesh that IS there but this pack has no art for --
  // 'unknown', never a guessed nation.
  pathetLao: cpNation({ team: 1, flagMesh: 'flagpl_m1' }, EOD),
  // Kasserine's flagless capture zones: no mesh to read at all, so the
  // level's founding pair still answers -- team 1 German, team 2 American.
  flaglessAxis: cpNation({ team: 1, flagMesh: null }, VANILLA),
  flaglessAllied: cpNation({ team: 2, flagMesh: null }, VANILLA),
  flaglessNeutral: cpNation({ team: 0, flagMesh: null }, VANILLA),
};

// --- teamNation ----------------------------------------------------------------

// `xa_loi_pagoda`: one control point per side, each a main base. No
// contest, but it is the level the corrected rule was written against.
const xaLoiPagoda = [
  { team: 1, flagMesh: 'flagjp_m1', unableToChangeTeam: true },
  { team: 2, flagMesh: 'flagus_m1', unableToChangeTeam: true },
];
results.xaLoiPagoda = {
  axis: teamNation(xaLoiPagoda, 1, EOD, null),
  allied: teamNation(xaLoiPagoda, 2, EOD, null),
};

// `liberation_of_caen`: Axis has no marked main base (majority of 5 decides
// it), Allied's sole point is the uncapturable Canadian_Base.
const caen = [
  { team: 2, flagMesh: 'flagcan_m1', unableToChangeTeam: true },
  { team: 1, flagMesh: 'flagge_m1', unableToChangeTeam: false },
  { team: 1, flagMesh: 'flagge_m1', unableToChangeTeam: false },
  { team: 1, flagMesh: 'flagge_m1', unableToChangeTeam: false },
  { team: 1, flagMesh: 'flagge_m1', unableToChangeTeam: false },
  { team: 1, flagMesh: 'flagge_m1', unableToChangeTeam: false },
];
results.caen = {
  axis: teamNation(caen, 1, VANILLA, null),
  allied: teamNation(caen, 2, VANILLA, null),
};

// `no_where_to_run`: EoD gives its axis two uncapturable main bases of
// different nations (`Vietcong_Base` flagjp_m1, `Vietcong_Platoon`
// flagge_m1) plus three neutral, flagless points that must not vote. This
// module has no main-base priority (`teamNation` is a plain majority, same
// as it always drew the live scene) -- checked here so a future edit
// cannot silently start disagreeing with `team_nation_from_level`'s
// encounter-order tie-break without a test noticing.
const noWhereToRun = [
  { team: 1, flagMesh: 'flagjp_m1', unableToChangeTeam: true },
  { team: 2, flagMesh: 'flagus_m1', unableToChangeTeam: true },
  { team: 0, flagMesh: null, unableToChangeTeam: false },
  { team: 0, flagMesh: null, unableToChangeTeam: false },
  { team: 0, flagMesh: null, unableToChangeTeam: false },
  { team: 1, flagMesh: 'flagge_m1', unableToChangeTeam: true },
];
results.noWhereToRun = {
  axis: teamNation(noWhereToRun, 1, EOD, null),
  allied: teamNation(noWhereToRun, 2, EOD, null),
};

// The three Pathet Lao levels: every axis point flies `flagpl_m1`, which
// `EOD` has no entry for, so every vote is 'unknown' and 'unknown' wins the
// tally outright -- never the vehicle guess, never a ger/us default.
const hMong = [
  { team: 2, flagMesh: 'flagus_m1', unableToChangeTeam: true },
  { team: 1, flagMesh: 'flagpl_m1', unableToChangeTeam: false },
  { team: 1, flagMesh: 'flagpl_m1', unableToChangeTeam: false },
  { team: 1, flagMesh: 'flagpl_m1', unableToChangeTeam: false },
  { team: 1, flagMesh: 'flagpl_m1', unableToChangeTeam: false },
  { team: 1, flagMesh: 'flagpl_m1', unableToChangeTeam: false },
];
results.hMong = {
  // No vehicle-based guess offered either -- the level truly has none.
  axisNoVehicleGuess: teamNation(hMong, 1, EOD, null),
  // A vehicle guess must still lose to a real (if unresolved) vote: five
  // 'unknown' votes beat one vehicle-guessed nation the same way five real
  // votes would.
  axisWithVehicleGuess: teamNation(hMong, 1, EOD, 'jp'),
  allied: teamNation(hMong, 2, EOD, null),
};

// A team with no control points of its own at all (Wake's Japanese arrive
// by sea): the vehicle guess wins, and with none offered either, 'unknown'
// -- never a ger/us default.
results.noControlPoints = {
  withVehicleGuess: teamNation([], 1, VANILLA, 'jp'),
  withoutVehicleGuess: teamNation([], 1, VANILLA, null),
};

console.log(JSON.stringify(results, null, 1));
