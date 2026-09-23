// The flight model's modules as one surface, kept only for `vehicle-hits.js`'s
// `findVehicle` / `findVehicles` import; every other importer names the owning
// module:
//
//   vehicle-base.js       Vehicle, VehicleState, the rig and the cockpit swap
//   aircraft.js           the flight model: GRAVITY, calculateLift, CORSAIR, Aircraft
//   vehicle-camera.js     the per-seat view modes and FixedSubject
//   vehicle-discovery.js  findVehicles / findVehicle
//
// Delete this file once `vehicle-hits.js` imports `vehicle-discovery.js`.

export { nodeNameKey, isPropellerBlurPair, VehicleState, Vehicle } from './vehicle-base.js';
export { GRAVITY, calculateLift, CORSAIR, Aircraft } from './aircraft.js';
export { CAMERA_MODES, DEFAULT_CAMERA_MODES, FixedSubject, VehicleCamera } from './vehicle-camera.js';
export { findVehicles, findVehicle } from './vehicle-discovery.js';
