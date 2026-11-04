#!/usr/bin/env node
// Builds play/boot-loader.bundle.js: the boot loader (play/boot-loader/entry.js)
// with play/loaders/kit.js and every scene, as one classic script that
// mesh/stamp-viewer.mjs inlines into map.html and play/index.html. See
// entry.js for why, and features/replay-shorts/README.md, "The boot loader".
//
//   node scripts/build-boot-loader.mjs          # rebuild
//   node scripts/build-boot-loader.mjs --check  # exit 1 if the bundle is stale
//
// Run it after changing a scene, the kit or the entry. The bundle's first line
// is a hash of its sources, and tests/test_loaders.py fails while that hash is
// not the sources' own. esbuild comes from ui/node_modules (bootstrap installs it).
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const viewer = join(root, 'tools/bf1942-models/viewer');
const play = join(viewer, 'play');
const out = join(play, 'boot-loader.bundle.js');

/** Every source the bundle is made of, in a fixed order. */
export function sources() {
  const dirs = [join(play, 'boot-loader'), join(play, 'loaders')];
  return dirs.flatMap(dir => readdirSync(dir).filter(n => n.endsWith('.js')).sort().map(n => join(dir, n)));
}

export function sourceHash() {
  const hash = createHash('sha256');
  for (const file of sources()) hash.update(file.slice(root.length)).update('\0').update(readFileSync(file)).update('\0');
  return hash.digest('hex').slice(0, 16);
}

const header = hash => `// Built by scripts/build-boot-loader.mjs from play/boot-loader and play/loaders; do not edit. sources ${hash}\n`;

if (import.meta.url === `file://${process.argv[1]}`) {
  const hash = sourceHash();
  if (process.argv.includes('--check')) {
    const first = readFileSync(out, 'utf8').split('\n', 1)[0] + '\n';
    if (first !== header(hash)) { console.error('boot-loader.bundle.js is stale: run node scripts/build-boot-loader.mjs'); process.exit(1); }
    process.exit(0);
  }
  const require = createRequire(join(root, 'ui/package.json'));
  const esbuild = require('esbuild');
  const shim = join(play, 'boot-loader/viewer-root.js');
  const result = await esbuild.build({
    entryPoints: [join(play, 'boot-loader/entry.js')],
    bundle: true,
    format: 'iife',
    minify: true,
    target: 'es2020',
    write: false,
    legalComments: 'none',
    plugins: [{
      name: 'viewer-root',
      setup(build) {
        build.onResolve({ filter: /(^|\/)viewer-root\.js$/ }, args => (
          args.importer.endsWith('boot-loader/entry.js') ? undefined : { path: shim }));
      },
    }],
  });
  const code = result.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
  writeFileSync(out, header(hash) + code);
  console.log(`wrote ${out.slice(root.length + 1)}: ${(Buffer.byteLength(code) / 1024).toFixed(1)} KB, sources ${hash}`);
}
