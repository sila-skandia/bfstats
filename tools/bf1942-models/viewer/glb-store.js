// The content-addressed glb store (phase 5 of features/mesh-asset-size).
//
// `store_glbs.py` writes each distinct model, rig or pose glb once to
// `<root>/glbs/<sha256>.glb` and records `name -> sha` in the manifests the
// pages already load: `models.json` rows carry `sha` / `cockpitSha` and a
// `sha` per variant, `viewmodels/index.json` carries a `sha` table keyed by
// `<stem>.fp.glb`, and `poses/index.json` one keyed by the path under
// `poses/`. `resolveGlb` turns a tree URL (`models/mods/fhsw/Tiger.glb`)
// into its blob URL through those tables, fetched lazily once per tree; a
// name with no sha -- an untreated tree, a manifest that is missing, a file
// no manifest names (a kit glb, `viewmodels/skins/`) -- keeps its own URL,
// so everything that loads today keeps loading.
//
// The blob is byte-identical to the per-tree glb it replaces, so its texture
// URIs are still spelled relative to the ORIGINAL location. The caller must
// therefore resolve resources against the original URL's directory, which
// `resolveGlb` hands back as `resourcePath`; `glb-loader.js` applies it, and
// that is the one reason to load blobs through that wrapper rather than by
// rewriting URLs by hand.
//
// No imports: this module also runs in plain node (the test harness stubs
// `fetch`).

const tables = new Map();   // `${treeBase}|${kind}` -> Promise<Map|null>

/** Split a glb URL into the tree it belongs to, or null for a URL this store
 *  has no say over (a level scene, a texture, a manifest, a blob already).
 *  `prefix` is everything before the `models` segment ('', '../', an absolute
 *  origin), `treeBase` is `models` or `models/mods/<m>` with the prefix on,
 *  and `rel` is the path inside the tree. */
export function parseGlbUrl(url) {
  const at = String(url).indexOf('?');
  const path = at === -1 ? String(url) : String(url).slice(0, at);
  const query = at === -1 ? '' : String(url).slice(at);
  if (!path.endsWith('.glb')) return null;
  const parts = path.split('/');
  const seat = parts.indexOf('models');
  if (seat === -1 || seat === parts.length - 1) return null;
  const prefix = parts.slice(0, seat).map(p => `${p}/`).join('');
  let tree = ['models'];
  let rest = parts.slice(seat + 1);
  if (rest[0] === 'mods' && rest.length > 2) {
    tree = ['models', ...rest.slice(0, 2)];
    rest = rest.slice(2);
  }
  const rel = rest.join('/');
  if (!rel) return null;
  return { prefix, treeBase: prefix + tree.join('/'), rel, query };
}

/** Which manifest answers for `rel`, or null for a file none covers. */
function kindOf(rel) {
  if (rel.startsWith('poses/')) return 'poses';
  if (rel.startsWith('viewmodels/')) {
    return rel.endsWith('.fp.glb') && !rel.slice('viewmodels/'.length).includes('/')
      ? 'rigs' : null;
  }
  return rel.includes('/') ? null : 'models';
}

const asTable = entries => {
  const table = new Map();
  for (const [name, sha] of entries) {
    if (typeof name === 'string' && typeof sha === 'string' && sha) table.set(name, sha);
  }
  return table.size ? table : null;
};

/** `models.json` rows -> file name to sha (`sha`, `cockpitSha`, variants'). */
function modelTable(rows) {
  if (!Array.isArray(rows)) return null;
  const entries = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    entries.push([row.glb, row.sha], [row.cockpit, row.cockpitSha]);
    for (const variant of Array.isArray(row.variants) ? row.variants : []) {
      if (variant && typeof variant === 'object') entries.push([variant.glb, variant.sha]);
    }
  }
  return asTable(entries);
}

const shaTable = doc => (doc && typeof doc === 'object' && doc.sha && typeof doc.sha === 'object'
  ? asTable(Object.entries(doc.sha)) : null);

const SOURCES = {
  models: { file: 'models.json', build: modelTable },
  rigs: { file: 'viewmodels/index.json', build: shaTable },
  poses: { file: 'poses/index.json', build: shaTable },
};

/**
 * The sha table of one tree and kind, fetched once per page. A manifest that
 * answers 404, fails to parse or carries no shas is remembered as null (the
 * old path serves); a fetch that failed any other way is forgotten, so the
 * next load asks again rather than the page guessing for the session.
 */
function table(treeBase, kind, query) {
  const key = `${treeBase}|${kind}`;
  if (!tables.has(key)) {
    const source = SOURCES[kind];
    const load = Promise.resolve()
      .then(() => fetch(`${treeBase}/${source.file}${query}`))
      .then(async response => {
        if (!response.ok) {
          if (response.status !== 404) tables.delete(key);
          return null;
        }
        try {
          return source.build(await response.json());
        } catch {
          return null;
        }
      })
      .catch(() => { tables.delete(key); return null; });
    tables.set(key, load);
  }
  return tables.get(key);
}

/**
 * Where to actually load `url` from: `{ url, resourcePath }`. A name the
 * tree's manifest hashes resolves to its blob, with `resourcePath` set to the
 * original URL's directory (the blob's relative texture URIs are spelled from
 * there); anything else comes back as it was, `resourcePath` null.
 */
export async function resolveGlb(url) {
  const parsed = parseGlbUrl(url);
  if (!parsed) return { url, resourcePath: null };
  const kind = kindOf(parsed.rel);
  if (!kind) return { url, resourcePath: null };
  let sha = null;
  try {
    const shas = await table(parsed.treeBase, kind, parsed.query);
    const key = kind === 'rigs' ? parsed.rel.slice('viewmodels/'.length)
      : kind === 'poses' ? parsed.rel.slice('poses/'.length) : parsed.rel;
    sha = shas?.get(key) ?? null;
  } catch {
    sha = null;
  }
  if (!sha) return { url, resourcePath: null };
  const dir = String(url).slice(0, String(url).lastIndexOf('/') + 1);
  return { url: `${parsed.prefix}glbs/${sha}.glb${parsed.query}`, resourcePath: dir };
}

/** Drop every cached table (a test, or a page that switched trees). */
export function forgetGlbTables() {
  tables.clear();
}
