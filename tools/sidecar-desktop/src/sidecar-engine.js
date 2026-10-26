'use strict';
// Which sidecar a join runs (features/sidecar-desktop-app, "Engines"):
//
//   kotlin  the native Kotlin sidecar (tools/sidecar-android/core, built as a
//           Linux executable; no JVM, no Node). The default where there is a
//           binary for this platform: Linux x64 today.
//   node    tools/bf1942-models/sidecar/sidecar.mjs under Electron's own Node
//           (process.execPath with ELECTRON_RUN_AS_NODE=1). The parity
//           reference, Windows' engine, and every platform's fallback.
//
// Both take the same arguments and print the same console lines
// (sidecar-status.js reads them), so a join only differs in what is spawned.
// A `kotlin` join falls back to `node`, saying why, when there is no binary
// for this platform, the binary is missing, or it fails to start
// (sidecar-session.js). Kept pure: paths and the platform are parameters.

const fs = require('node:fs');
const path = require('node:path');

const ENGINES = ['kotlin', 'node'];
const DEFAULT_ENGINE = 'kotlin';

// Where the native binary is: the packaged app's resources (package.json
// build.linux.extraResources), or the gradle output in a checkout
// (npm run build-sidecar).
const PACKAGED_NATIVE = path.join('sidecar-native', 'bfstats-sidecar-core');
const GRADLE_OUTPUT = { 'linux-x64': ['linuxX64', 'sidecarReleaseExecutable', 'sidecar.kexe'] };

/** The platform key the native builds are made for, or null. */
function nativeTarget(platform = process.platform, arch = process.arch) {
  const key = `${platform}-${arch}`;
  return Object.hasOwn(GRADLE_OUTPUT, key) ? key : null;
}

/**
 * The native sidecar's path for this app, or null where none is built for the
 * platform. `appDir` is tools/sidecar-desktop (dev); `resourcesPath` the
 * packaged app's resources folder. SIDECAR_DESKTOP_NATIVE overrides both.
 */
function nativeBinaryPath({ packaged, resourcesPath, appDir, platform = process.platform, arch = process.arch, env = process.env }) {
  if (env.SIDECAR_DESKTOP_NATIVE) return env.SIDECAR_DESKTOP_NATIVE;
  const target = nativeTarget(platform, arch);
  if (!target) return null;
  if (packaged) return path.join(resourcesPath, PACKAGED_NATIVE);
  return path.join(appDir, '..', 'sidecar-android', 'core', 'build', 'bin', ...GRADLE_OUTPUT[target]);
}

/** A stored engine setting, or the default. */
function cleanEngine(v) { return ENGINES.includes(v) ? v : null; }

function isExecutable(p, { platform = process.platform } = {}) {
  try {
    const st = fs.statSync(p);
    if (!st.isFile()) return false;
    if (platform !== 'win32') fs.accessSync(p, fs.constants.X_OK);
    return true;
  } catch { return false; }
}

/**
 * What a join spawns: { engine, command, prefix, reason, fallback }.
 * `prefix` goes before the sidecar's own arguments (the script, for Node);
 * `fallback` is the Node engine to try when a Kotlin one fails to start, and
 * `reason` says why a `kotlin` setting runs Node (null when it does not).
 */
function resolveEngine({ setting = DEFAULT_ENGINE, nativePath, nodeScript, execPath = process.execPath, platform = process.platform, executable = isExecutable }) {
  const node = { engine: 'node', command: execPath, prefix: [nodeScript], reason: null, fallback: null };
  const want = cleanEngine(setting) ?? DEFAULT_ENGINE;
  if (want === 'node') return node;
  if (!nativePath) return { ...node, reason: `no native sidecar is built for ${platform}` };
  if (!executable(nativePath, { platform })) return { ...node, reason: `the native sidecar is not at ${nativePath}` };
  return { engine: 'kotlin', command: nativePath, prefix: [], reason: null, fallback: node };
}

/**
 * The sidecar's arguments, the same for both engines (sidecar.mjs's and
 * SidecarCli.kt's): HOST:PORT, then the app's flags, then `extraArgs`.
 */
function sidecarArgs({ host, port, name, team, wsPort, recording, review, nameFromPage = false, extraArgs = [] }) {
  return [`${host}:${port}`, '--name', name, '--team', String(team), '--ws', String(wsPort),
    '--out', recording, '--review', review, '--leave-on-stdin',
    ...(nameFromPage ? ['--name-from-page'] : []), ...extraArgs];
}

/**
 * The child's environment: the game folder the app found (`gameDir`) as
 * BF1942_DIR, so the challenge's objects.rfa CRC is the install's; Node runs
 * under Electron's binary with ELECTRON_RUN_AS_NODE. Without a game folder
 * the sidecar uses its bundled CRCs and the published level tables.
 */
function engineEnv(engine, { gameDir = null, env = process.env } = {}) {
  const out = { ...env };
  if (engine === 'node') out.ELECTRON_RUN_AS_NODE = '1';
  else delete out.ELECTRON_RUN_AS_NODE;
  if (gameDir) out.BF1942_DIR = gameDir;
  return out;
}

module.exports = {
  ENGINES, DEFAULT_ENGINE, PACKAGED_NATIVE, nativeTarget, nativeBinaryPath, cleanEngine, isExecutable,
  resolveEngine, sidecarArgs, engineEnv,
};
