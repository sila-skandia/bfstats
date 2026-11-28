// A worn rocket pack's idle hum level (`page-audio.js` `packHum`), apart from
// `rocket-pack.js` so the soldier harnesses, which copy that module with its
// own imports, need no sound code.
import { modulate } from './ssc-curves.js';

/** A worn pack's idle hum level (`page-audio.js` `packHum`): its patch-1
 *  layer's `Volume <- Time` and `Volume <- Distance` ramps at `age` seconds
 *  since the last burst and `distance` metres from the listener, times the
 *  layer's volume, held to 1. The rocket pack's: silent until 0.4 s after a
 *  burst, 0.5 x 2.0 = 1 from 1.2 s, gone at 5 m. */
export function packHumLevel(layer, age, distance) {
  if (!layer) return 0;
  const mods = (layer.modulators ?? []).filter(m => m.dest === 'volume');
  const level = modulate(mods, { time: age, distance }, layer.volume ?? 1);
  return level > 1 ? 1 : level > 0 ? level : 0;
}
