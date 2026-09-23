// The strategic layer and the strategic AI that runs over it.
//
// The two live in their own modules and this one re-exports them, so every
// importer keeps reading `./strategic.js`:
//
//   `strategic-layer.js`  the level's strategic areas bound to the control
//                         points (`StrategicLayer`, `areaGeometry`)
//   `strategic-ai.js`     `dice::bf::ai::SAI`: the strategy choice, the area
//                         temperatures and the bot distribution (`StrategicAI`)

export { INFANTRY_TYPE, areaGeometry, StrategicLayer } from './strategic-layer.js';
export { compareCondition, SAI, StrategicAI } from './strategic-ai.js';
