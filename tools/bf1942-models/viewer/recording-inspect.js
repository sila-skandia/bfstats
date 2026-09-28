// What a recording says about itself, read in the browser before it is shared
// to the REPLAY feed (features/replay-feed): its level, game type, mod,
// server, length, players and recording player. The API reads the file too,
// and its own reading wins; this is what fills in what a file does not say.
// A recording begun mid-round names no level: it is recognised by its flags,
// as Open recording recognises one (replay-level.js), and failing that the
// share dialog asks.

import { parseRecording, nameAt } from './replay-recording.js';
import { recordingPlayer } from './replay-chapters.js';
import { recogniseLevel } from './replay-level.js';
import { loadMods, servable, VANILLA } from './mods.js';

const ROOT = new URL('./', import.meta.url);
const VANILLA_PACKS = ['bf1942', 'xpack1', 'xpack2'];

/** A file whose first line is a bf42plus header, `{"k":"h",...}`. */
export async function isRecording(file) {
  try {
    const head = await file.slice(0, 4096).text();
    return JSON.parse(head.split('\n', 1)[0])?.k === 'h';
  } catch {
    return false;
  }
}

/** The recording among what was picked or dropped, and its server log. */
export async function sortRecordingFiles(files) {
  const logs = files.filter(f => /\.xml$/i.test(f.name));
  for (const file of files) {
    if (!logs.includes(file) && await isRecording(file)) return { recording: file, log: logs[0] ?? null };
  }
  const named = files.find(f => /\.ndjson$/i.test(f.name));
  if (named) throw new Error(`${named.name} is not a bf42plus recording.`);
  if (logs.length) throw new Error(`${logs[0].name} is a server log. Choose it together with its recording, a replay_*.ndjson.`);
  throw new Error('That is not a bf42plus recording. Choose a replay_*.ndjson file.');
}

const manifests = new Map();

/** A mod's maps.json, or null when it could not be read. */
export function levelsOf(mod) {
  if (!manifests.has(mod.id)) {
    const read = fetch(new URL(`${mod.paths.maps}/maps.json`, ROOT), { cache: 'no-cache' })
      .then(response => (response.ok ? response.json() : null))
      .then(list => (Array.isArray(list) ? list : null))
      .catch(() => null);
    manifests.set(mod.id, read);
    read.then(list => { if (!list) manifests.delete(mod.id); });
  }
  return manifests.get(mod.id);
}

async function sceneOf(mod, entry) {
  const report = entry.report ?? String(entry.glb ?? '').replace(/\.glb$/i, '.json');
  if (!report) return null;
  const response = await fetch(new URL(`${mod.paths.maps}/${report}`, ROOT));
  return response.ok ? response.json() : null;
}

/** The mods with maps here, `first` first, as level lists: where a recording
 *  that names no level is looked for, and what the share dialog offers. */
export async function levelTrees(first, also = () => true) {
  const mods = servable(await loadMods(), 'maps');
  const trees = [];
  for (const mod of [first, ...mods.filter(also)]) {
    if (!mod || trees.some(tree => tree.mod.id === mod.id)) continue;
    const levels = await levelsOf(mod);
    if (levels?.length) trees.push({ mod, levels });
  }
  return trees;
}

/**
 * A recording's text, read: `{ rec, mod, level, meta }`. `mod` is the viewer's
 * mod it was made in (its server's, else `fallbackMod`); `level` the level
 * it names or was recognised as by its flags, '' when neither; `meta` the
 * details the share sends (recordings-api.js `upload`).
 */
export async function describeRecording(text, { fallbackMod = VANILLA.id, onStage = () => {} } = {}) {
  onStage('Reading the recording');
  const rec = parseRecording(text);
  const mods = servable(await loadMods(), 'maps');
  const named = String(rec.mod || '').toLowerCase();
  const mod = named ? mods.find(m => m.id === named) : mods.find(m => m.id === fallbackMod) ?? VANILLA;
  if (!mod) throw new Error(`It was recorded in ${rec.mod}, which has no maps in this viewer, so it could not be watched here.`);
  let level = String(rec.level || '').toLowerCase();
  if (!level) {
    onStage('Finding the level by its flags');
    const found = await recogniseLevel(rec, await levelTrees(mod, m => VANILLA_PACKS.includes(m.id)), sceneOf)
      .catch(error => { console.warn('recording-inspect: the level search failed', error); return null; });
    if (found) level = String(found.entry.name).toLowerCase();
  }
  const pid = recordingPlayer(rec);
  const players = [...new Set([...rec.players.values()].map(p => String(p.name ?? '').trim()).filter(Boolean))];
  return {
    rec,
    mod,
    level,
    meta: {
      level,
      mod: mod.id,
      gameMode: String(rec.modeFile || '').replace(/\.con$/i, '').toLowerCase(),
      serverName: rec.server || '',
      recordedBy: pid !== null ? nameAt(rec, pid, 0) : '',
      start: rec.start || '',
      durationSeconds: rec.duration || 0,
      players: players.slice(0, 128),
    },
  };
}
