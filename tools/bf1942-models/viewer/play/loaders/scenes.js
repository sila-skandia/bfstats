// Every loading scene, in the gallery's order (loaders.html). The Short
// loader's rotation (short-loader.js) plays one of these at random. A scene
// joins this list once it has been verified as the skill
// `game-loading-animations` describes.

import brass from './brass.js';
import duel from './duel.js';
import hulldown from './hulldown.js';
import rush from './rush.js';
import ambush from './ambush.js';
import dogfight from './dogfight.js';

export const SCENES = [brass, duel, hulldown, rush, ambush, dogfight];
