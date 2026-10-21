#!/usr/bin/env node
// Serves the viewer's code from versioned URLs, at image build time.
//
//   node mesh/stamp-viewer.mjs <viewer-dir>
//
// Rewrites the viewer's pages in place (the copy the mesh image is built
// from, never the checkout). Every page is an import map over a few hundred
// native ES modules, and with no build step each module had to be revalidated
// on every page load (`Cache-Control: no-cache`), one round trip to the node
// per level of the import graph: measured 2026-10-21, ~2 s of the front end's
// load and ~12 s of map.html's were modules answering 304.
//
// So each page's import map gets two prefix entries,
//
//     "/": "/_v/<version>/",  "/_v/": "/_v/"
//
// and every module the page imports, however deep, resolves to
// `/_v/<version>/<its path>`, which nginx serves as the plain file with a
// year's immutable caching (mesh/nginx.conf). The second entry stops a
// module already under `/_v/` being prefixed twice (the longest prefix wins).
// `<version>` is a hash of every code file, so any deploy that changes one
// moves them all to new URLs, and the page itself, still `no-cache`, is what
// says which. Each page also gets a `<link rel="modulepreload">` for every
// module in its static import graph, so the graph is fetched in one round
// rather than one level at a time. Stylesheets and module `src`s are
// rewritten to the versioned path the same way; the import map does not reach
// them.
//
// Nothing changes for a local server: the source pages carry no version, and
// the modules that resolve asset URLs against themselves strip one
// (viewer/viewer-root.js). Pages: every `*.html` at the root and in `play/`.

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, posix, relative, sep } from 'node:path';

// The asset trees the Deployment mounts from the volume: never code, and
// never part of the version.
const MOUNTED = new Set(['models', 'maps', 'replays', 'glbs', 'textures']);
const CODE = /\.(?:m?js|css|html)$/;
const PAGE_DIRS = ['', 'play'];

/** Every code file under `dir`, as `/`-separated paths relative to it. */
function codeFiles(dir, sub = '') {
  const out = [];
  for (const name of readdirSync(join(dir, sub)).sort()) {
    const rel = sub ? `${sub}/${name}` : name;
    if (!sub && MOUNTED.has(name)) continue;
    const stat = statSync(join(dir, rel));
    if (stat.isDirectory()) out.push(...codeFiles(dir, rel));
    else if (CODE.test(name)) out.push(rel);
  }
  return out;
}

export function versionOf(dir) {
  const hash = createHash('sha256');
  for (const rel of codeFiles(dir)) {
    hash.update(rel).update('\0').update(readFileSync(join(dir, rel))).update('\0');
  }
  return hash.digest('hex').slice(0, 12);
}

// `import x from './y.js'`, `import './y.js'`, `export { x } from './y.js'`,
// `export * from './y.js'`. Dynamic `import()` is left out on purpose: it is
// how a module asks for something only when it is needed.
const STATIC_IMPORT = /(?:^|[;\s}])(?:import|export)\s*(?:[\w$*{}\s,]*?\s*from\s*)?['"]([^'"\n]+)['"]/g;

export function staticImports(source) {
  const out = [];
  for (const match of source.matchAll(STATIC_IMPORT)) out.push(match[1]);
  return out;
}

/** Resolve `specifier` from the module at `from` (a `/`-rooted path), the
 *  way the page's import map would: an exact bare key, else a relative or
 *  rooted path. Bare specifiers the map does not name resolve to null. */
function resolve(specifier, from, imports) {
  if (Object.hasOwn(imports, specifier)) return imports[specifier];
  if (specifier.startsWith('/')) return posix.normalize(specifier);
  if (specifier.startsWith('./') || specifier.startsWith('../')) {
    return posix.normalize(posix.join(posix.dirname(from), specifier));
  }
  return null;
}

/** The page's static module graph: every `/`-rooted path its module scripts
 *  reach through static imports, in the order first reached. */
export function moduleGraph(dir, entries, imports) {
  const seen = new Set();
  const queue = [...entries];
  while (queue.length) {
    const { path, source } = queue.shift();
    if (path && seen.has(path)) continue;
    let text = source;
    if (path) {
      const file = join(dir, ...path.slice(1).split('/'));
      if (!existsSync(file)) continue;
      seen.add(path);
      text = readFileSync(file, 'utf8');
    }
    for (const specifier of staticImports(text)) {
      const next = resolve(specifier, path ?? entries.pagePath, imports);
      if (next && !seen.has(next)) queue.push({ path: next });
    }
  }
  return [...seen];
}

const IMPORT_MAP = /<script type="importmap">([\s\S]*?)<\/script>/;
const MODULE_SRC = /<script type="module" src="([^"]+)"><\/script>/g;
const INLINE_MODULE = /<script type="module">([\s\S]*?)<\/script>/g;
const STYLESHEET = /<link rel="stylesheet" href="([^"]+)">/g;

export function stampPage(dir, rel, version) {
  const file = join(dir, ...rel.split('/'));
  let html = readFileSync(file, 'utf8');
  const pagePath = `/${rel}`;
  const v = `/_v/${version}`;
  const local = href => posix.normalize(posix.join(posix.dirname(pagePath), href));
  const isLocal = href => !/^[a-z]+:|^\/\//i.test(href);

  const mapMatch = html.match(IMPORT_MAP);
  if (!mapMatch) return null;
  const map = JSON.parse(mapMatch[1]);
  const imports = {};
  for (const [key, value] of Object.entries(map.imports || {})) {
    imports[key] = isLocal(value) ? local(value) : value;
  }

  const entries = [];
  entries.pagePath = pagePath;
  for (const [, src] of html.matchAll(MODULE_SRC)) entries.push({ path: local(src) });
  for (const [, source] of html.matchAll(INLINE_MODULE)) entries.push({ path: null, source });
  const graph = moduleGraph(dir, entries, imports);

  const stamped = {
    imports: {
      ...Object.fromEntries(Object.entries(imports).map(([key, value]) => (
        [key, value.startsWith('/') ? `${v}${value}` : value]))),
      '/': `${v}/`,
      '/_v/': '/_v/',
    },
  };
  if (map.scopes) stamped.scopes = map.scopes;
  const preloads = graph.map(path => `<link rel="modulepreload" href="${v}${path}">`).join('\n');
  html = html.replace(IMPORT_MAP,
    () => `<script type="importmap">\n${JSON.stringify(stamped)}\n</script>\n${preloads}`);
  html = html.replace(MODULE_SRC,
    (all, src) => (isLocal(src) ? `<script type="module" src="${v}${local(src)}"></script>` : all));
  html = html.replace(STYLESHEET,
    (all, href) => (isLocal(href) ? `<link rel="stylesheet" href="${v}${local(href)}">` : all));
  writeFileSync(file, html);
  return { page: rel, modules: graph.length };
}

export function stampViewer(dir) {
  const version = versionOf(dir);
  const pages = [];
  for (const sub of PAGE_DIRS) {
    const at = join(dir, sub);
    if (!existsSync(at)) continue;
    for (const name of readdirSync(at).sort()) {
      if (!name.endsWith('.html')) continue;
      const rel = relative(dir, join(at, name)).split(sep).join('/');
      const done = stampPage(dir, rel, version);
      if (done) pages.push(done);
    }
  }
  return { version, pages };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const dir = process.argv[2];
  if (!dir) {
    console.error('usage: stamp-viewer.mjs <viewer-dir>');
    process.exit(2);
  }
  const { version, pages } = stampViewer(dir);
  console.log(`viewer code version ${version}`);
  for (const { page, modules } of pages) console.log(`  ${page}: ${modules} modules preloaded`);
}
