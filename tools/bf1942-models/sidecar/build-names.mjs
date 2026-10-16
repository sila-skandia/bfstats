#!/usr/bin/env node
// Build a reusable tid->template-name map for a level from a bf42plus recording.
//   node build-names.mjs <recording.ndjson> sidecar/templates/<level>.json
// The map is stable per level+mod, so one build serves later sidecar runs of
// that level (the sidecar auto-loads sidecar/templates/<level>.json by the
// setLevel name, or you pass --names explicitly).
import fs from 'node:fs';
import { tidNamesFromRecording } from './names.mjs';

const [rec, out] = process.argv.slice(2);
if (!rec || !out) { console.error('usage: node build-names.mjs <recording.ndjson> <out.json>'); process.exit(2); }
const { level, mod, tidNames, animStates, cpNames } = tidNamesFromRecording(fs.readFileSync(rec, 'utf8'));
// Merge into an existing map: tids seen in either recording, the state table
// from whichever has one (it is the engine's, the same across recordings).
let prev = {};
try { prev = JSON.parse(fs.readFileSync(out, 'utf8')); } catch {}
const merged = {
  level: level || prev.level || '', mod: mod || prev.mod || '',
  tidNames: { ...(prev.tidNames || {}), ...tidNames },
  animStates: animStates || prev.animStates || null,
  cpNames: { ...(prev.cpNames || {}), ...cpNames },
};
fs.writeFileSync(out, JSON.stringify(merged));
console.log(`[build-names] ${Object.keys(merged.tidNames).length} templates (${Object.keys(tidNames).length} from this recording) for level=${merged.level} mod=${merged.mod}, ${merged.animStates ? merged.animStates.length : 0} animation states -> ${out}`);
