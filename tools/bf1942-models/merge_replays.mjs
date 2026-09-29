#!/usr/bin/env node
// Merge several bf42plus recordings of one round into one
// (features/round-replay-merge):
//
//   node tools/bf1942-models/merge_replays.mjs a.ndjson b.ndjson -o merged.ndjson
//   node tools/bf1942-models/merge_replays.mjs a.ndjson b.ndjson -o merged.ndjson --report report.json
//   node tools/bf1942-models/merge_replays.mjs a.ndjson b.ndjson -o merged.ndjson --set hysteresisMetres=80
//
// The first file's clock is the merged file's, and its recording player is
// the one the replay follows first. The report goes to stdout; `--report`
// also writes it as JSON. A merged file is shared like any other
// (features/gameplay-recordings).
//
// Files the guard finds are not one round (replay-merge-guard.js: their kills
// and scores do not line up, or their world clocks disagree) are not merged:
// what it measured is printed and the exit status is 1. `--force` merges them
// anyway.

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { installModuleHooks, viewerDir } from './sim/env.mjs';

const USAGE = `usage: merge_replays.mjs <recording> <recording> [...] -o <merged.ndjson>
  [--report <report.json>] [--set <option>=<value> ...] [--local <pid>,<pid>,...] [--force]

options (--set name=value; see MERGE_DEFAULTS in viewer/replay-merge.js):
  eventWindow chatWindow rareKey voteBin minMatches minDriftSpan maxDrift outlierFloor
  minScoreShare minScoreEvents worldClockSlack (the guard)
  prefer (riding,nearest) hysteresisMetres hysteresisSeconds evalStep minSwitchSpan
  childMatch (rank|position|disjoint) shotSource (shooter|state) stateShift
--force merges files the guard says are not one round`;

function parseArgs(argv) {
  const out = { files: [], output: null, report: null, options: {} };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => {
      if (i + 1 >= argv.length) throw new Error(`${arg} needs a value`);
      return argv[++i];
    };
    if (arg === '-o' || arg === '--out') out.output = next();
    else if (arg === '--report') out.report = next();
    else if (arg === '--force') out.options.force = true;
    else if (arg === '--local') out.options.local = next().split(',').map(v => (v === '' || v === '-' ? null : Number(v)));
    else if (arg === '--set') {
      const [name, ...rest] = next().split('=');
      const value = rest.join('=');
      out.options[name] = /^-?\d+(\.\d+)?(e-?\d+)?$/i.test(value) ? Number(value)
        : value.includes(',') ? value.split(',')
          : name === 'prefer' ? [value] : value;
    } else if (arg === '-h' || arg === '--help') {
      console.log(USAGE);
      process.exit(0);
    } else {
      out.files.push(arg);
    }
  }
  return out;
}

const args = (() => {
  try {
    return parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`${error.message}\n${USAGE}`);
    process.exit(2);
  }
})();
if (args.files.length < 2 || !args.output) {
  console.error(USAGE);
  process.exit(2);
}

const viewer = viewerDir();
installModuleHooks(viewer);
const { mergeRecordings, formatMergeReport, formatGuard } = await import(pathToFileURL(path.join(viewer, 'replay-merge.js')).href);

const inputs = args.files.map(file => ({ name: path.basename(file), text: fs.readFileSync(file, 'utf8') }));
let merged;
try {
  merged = mergeRecordings(inputs, args.options);
} catch (error) {
  console.error(`not merged: ${error.message}`);
  if (error.guard) {
    console.error(`\n${formatGuard(error.guard).join('\n')}\n\n--force merges them anyway.`);
    if (args.report) fs.writeFileSync(args.report, `${JSON.stringify({ refused: error.message, guard: error.guard }, null, 2)}\n`);
  }
  process.exit(1);
}
fs.writeFileSync(args.output, merged.text);
if (args.report) fs.writeFileSync(args.report, `${JSON.stringify(merged.report, null, 2)}\n`);
console.log(formatMergeReport(merged.report));
console.log(`\n${formatGuard(merged.report.guard).join('\n')}`);
console.log(`\nwrote ${args.output} (${(merged.text.length / 1e6).toFixed(1)} MB)`);
