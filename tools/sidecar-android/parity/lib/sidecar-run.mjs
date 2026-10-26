// Shared by parity/sidecar.mjs and parity/sidecar-captures.mjs: run the real,
// unedited sidecar.mjs under lib/sidecar-preload.mjs over one scenario
// ({args, steps, seed}) and return its transcript lines, normalised.
// SidecarHarness.kt is the Kotlin twin.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { SIDECAR, parityEnv } from './tables.mjs';

const PRELOAD = path.join(path.dirname(fileURLToPath(import.meta.url)), 'sidecar-preload.mjs');
export const KEY = 'ABCDE-FGHJK-LMNPQ-RSTUV';

/** The transcript of one scenario, run against the scratch cache `cache`. */
export function runScenario(name, sc, cache, env = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-parity-'));
  try {
    const OUT = path.join(tmp, `${name}.ndjson`), REVIEW = path.join(tmp, `${name}.review.ndjson`);
    const scriptFile = path.join(tmp, `${name}.script.json`), resultFile = path.join(tmp, `${name}.result.ndjson`);
    const seed = sc.seed ?? 1942;
    fs.writeFileSync(scriptFile, JSON.stringify({ seed, steps: sc.steps, out: OUT, review: REVIEW }));
    const args = [...sc.args, '--out', OUT, '--review', REVIEW];
    try {
      execFileSync(process.execPath, ['--import', PRELOAD, path.join(SIDECAR, 'sidecar.mjs'), ...args], {
        env: { ...parityEnv(cache), SIDECAR_PARITY_SCRIPT: scriptFile, SIDECAR_PARITY_RESULT: resultFile, SIDECAR_CDKEY_FILE: path.join(tmp, `${name}.cdkeys.json`), SIDECAR_DEBUG: '', ...env },
        stdio: ['ignore', 'inherit', 'inherit'], maxBuffer: 1 << 30,
      });
    } catch (e) {
      const why = fs.existsSync(resultFile) ? fs.readFileSync(resultFile, 'utf8').slice(0, 2000) : e.message;
      throw new Error(`${name}: ${why}`);
    }
    const raw = fs.readFileSync(resultFile, 'utf8');
    if (raw.startsWith('driver failed')) throw new Error(`${name}: ${raw}`);
    return raw.trim().split('\n').map((l) => normalise(l, OUT, REVIEW));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/** Paths and the header's wall-clock start, which differ run to run.
 *  SidecarHarness.kt applies the same. */
function normalise(line, outPath, reviewPath) {
  return line.split(JSON.stringify(outPath).slice(1, -1)).join('OUT').split(JSON.stringify(reviewPath).slice(1, -1)).join('REVIEW')
    .replace(/\\"start\\":\\"[^"\\]*\\"/g, '\\"start\\":\\"START\\"');
}
