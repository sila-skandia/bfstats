// The game loaders on the stats site: one of the viewer's loading scenes, drawn
// from the game's own models, picked at random each time it starts.

import { createLoader } from './play/loaders/kit.js';
import { SCENES } from './play/loaders/scenes.js';

export function createGameLoader(words, pick) {
  return createLoader({ scenes: SCENES, words, pick: pick ?? null });
}
