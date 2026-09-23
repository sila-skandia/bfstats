// Flying a Refractor vehicle that is already standing in an extracted map.
//
// The subsystems live in their own modules; this file is the surface every
// importer already names, re-exporting them unchanged:
//
//   vehicle-base.js       Vehicle, VehicleState, the rig and the cockpit swap
//   aircraft.js           the flight model: GRAVITY, calculateLift, CORSAIR, Aircraft
//   vehicle-camera.js     the per-seat view modes and FixedSubject
//   vehicle-discovery.js  findVehicles / findVehicle

export { nodeNameKey, isPropellerBlurPair, VehicleState, Vehicle } from './vehicle-base.js';
export { GRAVITY, calculateLift, CORSAIR, Aircraft } from './aircraft.js';
export { CAMERA_MODES, DEFAULT_CAMERA_MODES, FixedSubject, VehicleCamera } from './vehicle-camera.js';
export { findVehicles, findVehicle } from './vehicle-discovery.js';
