#!/usr/bin/env node
'use strict';
// npm run build-sidecar: builds the native Kotlin sidecar the app runs on
// Linux (src/sidecar-engine.js) from tools/sidecar-android/core, where dev
// mode finds it and the Linux packages bundle it (package.json
// build.linux.extraResources). Needs a JDK 17 for Gradle; the result is a
// plain executable (no JVM). On a platform with no native build it says so
// and does nothing: the app runs the Node sidecar there.

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { nativeBinaryPath, nativeTarget } = require('../src/sidecar-engine');

const ROOT = path.resolve(__dirname, '..');
const ANDROID = path.resolve(ROOT, '..', 'sidecar-android');
const TASKS = { 'linux-x64': ':core:linkSidecarReleaseExecutableLinuxX64' };

const target = nativeTarget();
if (!target) {
  console.log(`[build-sidecar] no native sidecar for ${process.platform}-${process.arch}: the app runs the Node sidecar here`);
  process.exit(0);
}
const gradlew = path.join(ANDROID, process.platform === 'win32' ? 'gradlew.bat' : 'gradlew');
// -PcoreOnly=true: the Android app's project is left out, so no Android SDK is needed.
const args = ['-PcoreOnly=true', '--console=plain', TASKS[target]];
console.log(`[build-sidecar] ${path.relative(ROOT, gradlew)} ${args.join(' ')}`);
const r = spawnSync(gradlew, args, { cwd: ANDROID, stdio: 'inherit' });
if (r.error) { console.error(`[build-sidecar] could not run Gradle: ${r.error.message}`); process.exit(1); }
if (r.status !== 0) process.exit(r.status ?? 1);
const out = nativeBinaryPath({ packaged: false, appDir: ROOT, env: {} });
if (!fs.existsSync(out)) { console.error(`[build-sidecar] Gradle finished but there is no ${out}`); process.exit(1); }
console.log(`[build-sidecar] ${out} (${(fs.statSync(out).size / 1048576).toFixed(1)} MB)`);
