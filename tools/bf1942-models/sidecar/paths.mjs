// Where the sidecar keeps things and finds the game, per platform.
//
//                  Linux (and macOS)                    Windows
//   cache          ~/.cache/bfstats-sidecar             %LOCALAPPDATA%\bfstats-sidecar\cache
//   config         ~/.config/bfstats-sidecar            %APPDATA%\bfstats-sidecar
//   game install   ~/.wine/drive_c/EA Games/...         the first of the default install
//                                                       folders that exists (below)
//
// SIDECAR_CACHE, SIDECAR_CDKEY_FILE and BF1942_DIR override each one. The
// desktop app passes BF1942_DIR when it found the install (the registry's
// GAMEDIR, tools/sidecar-desktop/src/game-install.js); the sidecar itself
// reads no registry. Python (SIDECAR_PYTHON) is only ever needed to compute a
// level's tables from an install, never to join: `pythonAvailable` says
// whether one answers, once per process and within a few seconds, so an
// install without Python falls to the published tables at once
// (level-tables.mjs `installCanCompute`).

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const win = (platform) => platform === 'win32';

export function cacheDir({ env = process.env, platform = process.platform, home = os.homedir() } = {}) {
  if (env.SIDECAR_CACHE) return env.SIDECAR_CACHE;
  if (win(platform)) return path.win32.join(env.LOCALAPPDATA || path.win32.join(home, 'AppData', 'Local'), 'bfstats-sidecar', 'cache');
  return path.join(home, '.cache', 'bfstats-sidecar');
}

export function configDir({ env = process.env, platform = process.platform, home = os.homedir() } = {}) {
  if (win(platform)) return path.win32.join(env.APPDATA || path.win32.join(home, 'AppData', 'Roaming'), 'bfstats-sidecar');
  return path.join(home, '.config', 'bfstats-sidecar');
}

/** The install folders tried when BF1942_DIR is not set, in order. */
export function defaultGameDirs({ env = process.env, platform = process.platform, home = os.homedir() } = {}) {
  if (win(platform)) {
    const pf86 = env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
    const pf = env.ProgramFiles || 'C:\\Program Files';
    return [
      path.win32.join(pf86, 'EA Games', 'Battlefield 1942'),
      path.win32.join(pf86, 'Origin Games', 'Battlefield 1942'),
      path.win32.join(pf, 'EA Games', 'Battlefield 1942'),
      'C:\\EA Games\\Battlefield 1942',
    ];
  }
  return [path.join(env.WINEPREFIX || path.join(home, '.wine'), 'drive_c', 'EA Games', 'Battlefield 1942')];
}

/** BF1942_DIR, else the first default folder that exists, else the first default. */
export function gameDir({ env = process.env, platform = process.platform, home = os.homedir(), exists = fs.existsSync } = {}) {
  if (env.BF1942_DIR) return env.BF1942_DIR;
  const dirs = defaultGameDirs({ env, platform, home });
  return dirs.find((d) => { try { return exists(d); } catch { return false; } }) ?? dirs[0];
}

/** The interpreter the install helpers run under: SIDECAR_PYTHON, else `python` on Windows, `python3` elsewhere. */
export const pythonCommand = ({ env = process.env, platform = process.platform } = {}) =>
  env.SIDECAR_PYTHON || (win(platform) ? 'python' : 'python3');

const pythonMemo = new Map();
/**
 * Whether `python` runs Python 3, asked once per process (memoised per
 * command). Windows' "python" with no Python installed is the Microsoft Store
 * alias, which prints a hint and exits 9009; a missing command is ENOENT. Both
 * are a no here, and neither waits longer than `timeoutMs`.
 */
export function pythonAvailable(python = pythonCommand(), { timeoutMs = 5000, run = spawnSync } = {}) {
  if (pythonMemo.has(python)) return pythonMemo.get(python);
  let ok = false;
  let why = '';
  try {
    const r = run(python, ['-c', 'import sys; print(sys.version_info[0])'],
      { encoding: 'utf8', timeout: timeoutMs, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    ok = !r.error && r.status === 0 && String(r.stdout).trim() === '3';
    why = r.error ? (r.error.code || r.error.message) : `exit ${r.status}${r.signal ? ` (${r.signal})` : ''}`;
  } catch (e) { why = e.message; }
  const answer = { ok, python, why: ok ? '' : why };
  pythonMemo.set(python, answer);
  return answer;
}

/** Forget pythonAvailable's answers (tests). */
export function resetPythonProbe() { pythonMemo.clear(); }
