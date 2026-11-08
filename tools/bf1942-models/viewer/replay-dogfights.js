// The dogfights found in the round being replayed (features/dogfight-
// recordings, "On the replay's timeline"): the rows of the dogfight index
// (`extract_dogfights.mjs`, `replays/dogfights/index.json`) whose recording
// this page plays, each placed on the page's clock, for the timeline to mark
// and to send to the dogfight school (`dogfight.html?fight=<id>`).
//
// A row names its recording by slug and starts at `t0` on that recording's
// own clock. A page playing one shared recording plays that clock; a page
// merging several (one `?replay=` each) plays the round's, and each member's
// fights are moved onto it with that member's fit (`sourceClock`). A clip
// (`?replay=dogfights/<id>.ndjson`) and the school's own map layer show none:
// the clip is one fight already.

import { VIEWER_ROOT } from './viewer-root.js';
import { sharedRecordingOf, sourceClock } from './recordings-api.js';
import { fightLine } from './dogfight-lines.js';

export const DOGFIGHT_INDEX = new URL('replays/dogfights/index.json', VIEWER_ROOT).href;
export const SCHOOL_PAGE = new URL('dogfight.html', VIEWER_ROOT).href;

/** A recording's slug: a feed link's (`…/stats/recordings/<slug>.ndjson`),
 *  else a file named by its slug (`<slug>.ndjson`, `<slug>.ndjson.gz`), as a
 *  download from the feed is. */
export function slugOf(replayUrl) {
  const shared = sharedRecordingOf(replayUrl);
  if (shared) return shared.slug;
  const m = /(?:^|\/)([a-z0-9]{10})\.ndjson(?:\.gz)?(?:$|[?#])/.exec(String(replayUrl ?? ''));
  return m ? m[1] : null;
}

/** Where the school opens on one fight: its own page, on that fight, in the
 *  fight's mod. */
export function schoolHref(row, root = SCHOOL_PAGE) {
  const url = new URL(root);
  url.searchParams.set('fight', row.id);
  if (row.mod) url.searchParams.set('mod', row.mod);
  return url.href;
}

/**
 * The index's dogfights on this page's clock, in time order: `[{ id, t0,
 * t1, row, title, sub, href }]`, `t0`/`t1` where the fight starts and ends
 * on the page. `replayUrls` are the page's `?replay=`s in order, `rec` the
 * recording it plays (its `merged` sources and its `duration`).
 * Bounces (one pilot attacking, the other never answering) are left out, as
 * the school's list leaves them out by default.
 */
export function placeFights(rows, replayUrls, rec) {
  if (!Array.isArray(rows) || !rec) return [];
  const slugs = replayUrls.map(slugOf);
  const merged = slugs.length > 1 && rec.merged?.length === slugs.length ? rec.merged : null;
  // One recording, or a merge that fell back to the first: the first's clock.
  const clocks = new Map();
  slugs.forEach((slug, i) => {
    if (!slug || clocks.has(slug)) return;
    if (merged) clocks.set(slug, sourceClock(merged[i]).toRound);
    else if (i === 0) clocks.set(slug, t => t);
  });
  const duration = Number.isFinite(rec.duration) ? rec.duration : Infinity;
  const out = [];
  for (const row of rows) {
    if (row?.kind !== 'dogfight' || !clocks.has(row.slug) || !Number.isFinite(row.t0)) continue;
    const toPage = clocks.get(row.slug);
    const t0 = toPage(row.t0);
    const t1 = toPage(row.t0 + (Number(row.duration) || 0));
    if (!(t1 > 0) || t0 >= duration) continue;
    const { title, sub } = fightLine(row);
    out.push({ id: row.id, t0: Math.max(0, t0), t1: Math.min(duration, t1), row, title, sub, href: schoolHref(row) });
  }
  return out.sort((a, b) => a.t0 - b.t0);
}

let indexOnce = null;
/** The dogfight index, fetched once a page; empty when it is not there. */
export function loadDogfightIndex(url = DOGFIGHT_INDEX) {
  indexOnce ??= fetch(url)
    .then(res => (res.ok ? res.json() : []))
    .then(rows => (Array.isArray(rows) ? rows : []))
    .catch(() => []);
  return indexOnce;
}

/** The fights to mark on this page's timeline: none in a clip, on the
 *  school's map layer or its embed, none for a recording the index does not
 *  hold. */
export async function recordingFights(rec, search = globalThis.location?.search ?? '') {
  const params = new URLSearchParams(search);
  if (params.has('school') || params.has('embed') || params.has('clip')) return [];
  const replayUrls = params.getAll('replay');
  if (!replayUrls.some(slugOf)) return [];
  return placeFights(await loadDogfightIndex(), replayUrls, rec);
}
