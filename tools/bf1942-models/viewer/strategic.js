// The strategic layer, the strategic AI that runs over it, and the strategic
// interface every bot order comes through.
//
// Each lives in its own module and this one re-exports them, so every
// importer keeps reading `./strategic.js`:
//
//   `strategic-layer.js`  the level's strategic areas bound to the control
//                         points (`StrategicLayer`, `areaGeometry`)
//   `strategic-ai.js`     `dice::bf::ai::SAI`: the strategy choice, the area
//                         temperatures and the bot distribution (`StrategicAI`)
//   `doctrine.js`         the interface: `StrategicCommand` (what the bot
//                         referee holds), the doctrine and order-kind
//                         registries, the engine's SAI as the 'sai' doctrine
//                         and the `WPCloseTo`-law orders
//   `doctrine-squad.js`   the first play, 'squad' (registers itself)
//   `doctrine-landing.js` the SAI's beach orders for a landing craft
//                         (`WPBeachLanding`, `WPMoveToBeachLanding`) and the
//                         bail at the beach; doctrine.js registers the kinds
//
// A doctrine or an order kind added later registers itself the same way and
// is imported here (features/bot-doctrines/README.md).

export { INFANTRY_TYPE, areaGeometry, StrategicLayer } from './strategic-layer.js';
export { compareCondition, SAI, StrategicAI } from './strategic-ai.js';
export {
  StrategicCommand, DOCTRINES, ORDER_KINDS, registerDoctrine, registerOrderKind, checkOrder,
  parseDoctrineSpec, closeToOrder, boardOrder, leaveOrder, CLOSE_TO,
} from './doctrine.js';
export { SQUAD } from './doctrine-squad.js';
export {
  LANDING, landingZonesOf, zoneDistanceSqr, beachTarget, beachLandingOrder, landingTick, craftArea, areaPath,
  approachPosition, beachPosition,
} from './doctrine-landing.js';
