'use strict';
// electron-builder's afterPack hook (package.json build.afterPack): checks and
// completes the sidecar bundled as resources/sidecar.
//
// 1. The sidecar's table version. template-table.mjs hashes the files that
//    compute a level's tables, two of which are Python files outside the
//    bundled folder; without them the packaged sidecar would hash their paths
//    instead, never match the published bake's version, and fetch the tables
//    whole on every join. The repo's version is written beside it as
//    table-version.txt, which the bundled copy reads, and checked.
// 2. Nothing in the bundle imports from outside it: every relative import of
//    every .mjs resolves to a file inside resources/sidecar.

const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const REPO_SIDECAR = path.resolve(__dirname, '..', '..', 'bf1942-models', 'sidecar');

function resourcesDir(context) {
  const fromPackager = context.packager?.getResourcesDir?.(context.appOutDir);
  return fromPackager || path.join(context.appOutDir, 'resources');
}

function listMjs(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...listMjs(p));
    else if (e.name.endsWith('.mjs')) out.push(p);
  }
  return out;
}

/** Relative imports (static and dynamic) of a module that leave `root` or point at nothing. */
function strayImports(root) {
  const bad = [];
  for (const file of listMjs(root)) {
    const src = fs.readFileSync(file, 'utf8');
    const re = /(?:\bfrom\s*|\bimport\s*\(\s*|^\s*import\s+)['"](\.{1,2}\/[^'"]+)['"]/gm;
    for (let m; (m = re.exec(src));) {
      const target = path.resolve(path.dirname(file), m[1]);
      const rel = path.relative(root, target);
      if (rel.startsWith('..') || path.isAbsolute(rel)) bad.push(`${path.relative(root, file)} imports ${m[1]} (outside the bundle)`);
      else if (!fs.existsSync(target)) bad.push(`${path.relative(root, file)} imports ${m[1]} (not in the bundle)`);
    }
  }
  return bad;
}

async function afterPack(context) {
  const bundled = path.join(resourcesDir(context), 'sidecar');
  if (!fs.existsSync(path.join(bundled, 'sidecar.mjs'))) throw new Error(`after-pack: no sidecar.mjs under ${bundled}`);

  const stray = strayImports(bundled);
  if (stray.length) throw new Error(`after-pack: the bundled sidecar reaches outside its folder:\n  ${stray.join('\n  ')}`);

  const repo = await import(pathToFileURL(path.join(REPO_SIDECAR, 'template-table.mjs')).href);
  const version = repo.tableVersion();
  fs.writeFileSync(path.join(bundled, 'table-version.txt'), `${version}\n`);
  const packed = await import(pathToFileURL(path.join(bundled, 'template-table.mjs')).href);
  if (packed.TEMPLATE_TABLE_VERSION !== version) {
    throw new Error(`after-pack: the bundled sidecar's table version is ${packed.TEMPLATE_TABLE_VERSION}, the repo's ${version}`);
  }
  console.log(`  • sidecar bundle  ${listMjs(bundled).length} modules, all inside it; table version ${version}`);
}

module.exports = afterPack;
module.exports.default = afterPack;
module.exports.strayImports = strayImports;
