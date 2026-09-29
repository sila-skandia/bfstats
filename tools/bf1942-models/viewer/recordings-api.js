// The REPLAY feed's side of the bfstats API (features/replay-feed): shared
// recordings, their views and comments, sharing one, and who is signed in.
// The feed (play/recordings-feed.js) and the replay's comments
// (replay-social.js) both talk through this.
//
// Where the API is. On play.bfstats.io it is the same origin: HAProxy sends
// the play host's /stats to the API, so the sign-in cookie bfstats.io sets
// (`rt`, Domain=bfstats.io, Path=/stats) comes along and a visitor signed in
// there is signed in here. A page served from this PC uses the API running
// here (`dotnet run`, :9222) when one answers, else reads the live feed,
// read-only. `?api=<origin>` says which, for the tab.

export const LIVE_API = 'https://bfstats.io';
export const LOCAL_API = 'http://localhost:9222';
const API_KEY = 'bf42-mesh-api';
const AUTH_KEY = 'bf42-mesh-auth';
/** A token this close to expiring is refreshed before use. */
const EXPIRY_MARGIN_MS = 5 * 60 * 1000;

const LOCAL_HOSTS = /^(localhost|127\.0\.0\.1|\[::1\]|.+\.localhost)$/i;
export const isLocalHost = host => LOCAL_HOSTS.test(host);

/** A recording's link, as the feed hands it out and map.html reads it back:
 *  `…/stats/recordings/<slug>.ndjson`. */
const SLUG_IN_URL = /\/stats\/recordings\/([a-z0-9]{10})\.ndjson(?:$|[?#])/;

/** The shared recording a `?replay=` URL names: `{ slug, base }`, the API
 *  base being the URL's own origin ('' for a same-origin path), or null for a
 *  recording that is not the feed's (a file, a FileBrowser link). */
export function sharedRecordingOf(replayUrl, pageOrigin = globalThis.location?.origin ?? '') {
  const text = String(replayUrl ?? '');
  const match = SLUG_IN_URL.exec(text);
  if (!match) return null;
  let base = '';
  try {
    const url = new URL(text, pageOrigin || 'http://invalid');
    if (/^https?:$/.test(url.protocol) && url.origin !== pageOrigin && /^https?:\/\//i.test(text)) base = url.origin;
  } catch {
    return null;
  }
  return { slug: match[1], base };
}

/** What an API base is to this page: 'same' (this origin: sign-in rides the
 *  site's cookie), 'local' (an API on this PC: its dev sign-in), or 'remote'
 *  (another host's: read-only). */
export function apiMode(base, page = globalThis.location) {
  if (!base || base === page.origin) return 'same';
  try {
    return isLocalHost(new URL(base).hostname) ? 'local' : 'remote';
  } catch {
    return 'remote';
  }
}

async function answers(base) {
  try {
    const response = await fetch(`${base}/stats/recordings?pageSize=1`, { signal: AbortSignal.timeout(1500) });
    return response.ok;
  } catch {
    return false;
  }
}

/** The API this page talks to: `{ base, mode }` (see `apiMode`). */
export async function resolveApi(page = globalThis.location) {
  const asked = new URLSearchParams(page.search).get('api');
  const store = globalThis.sessionStorage;
  if (asked) {
    const base = asked === 'local' ? LOCAL_API : asked === 'live' ? LIVE_API : asked.replace(/\/+$/, '');
    try { store?.setItem(API_KEY, base); } catch {}
    return { base, mode: apiMode(base, page) };
  }
  try {
    const kept = store?.getItem(API_KEY);
    if (kept) return { base: kept, mode: apiMode(kept, page) };
  } catch {}
  if (!isLocalHost(page.hostname)) return { base: '', mode: 'same' };
  const base = await answers(LOCAL_API) ? LOCAL_API : LIVE_API;
  return { base, mode: apiMode(base, page) };
}

/** A fetch that failed, with what the API said. */
export class ApiError extends Error {
  constructor(status, message, body = null) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

async function failure(response) {
  let body = null;
  try { body = await response.json(); } catch {}
  const said = body?.message || body?.title;
  const message = said || (response.status === 429 ? 'Too many at once. Wait a minute and try again.'
    : response.status === 401 ? 'Sign in first.'
      : response.status >= 500 ? 'The server could not do that just now.' : `HTTP ${response.status}`);
  return new ApiError(response.status, message, body);
}

function readToken(key) {
  try {
    const kept = JSON.parse(globalThis.localStorage?.getItem(key) ?? 'null');
    return kept?.token && Date.parse(kept.expiresAt) - Date.now() > EXPIRY_MARGIN_MS ? kept : null;
  } catch {
    return null;
  }
}

function writeToken(key, value) {
  try {
    if (value) globalThis.localStorage?.setItem(key, JSON.stringify(value));
    else globalThis.localStorage?.removeItem(key);
  } catch {}
}

/** The role the API's token carries (`Admin`, `Support`, `User`). */
function rolesOf(token) {
  try {
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    const role = payload.role ?? payload['http://schemas.microsoft.com/ws/2008/06/identity/claims/role'];
    return Array.isArray(role) ? role : role ? [role] : [];
  } catch {
    return [];
  }
}

/** A player's page on bfstats.io, for `name` as the site has them (a
 *  recording's `uploaderPlayer`): raw, as every link to a player page takes it. */
export function playerHref(name) {
  return `${LIVE_API}/v4/players/${encodeURIComponent(name)}`;
}

/** Where a visitor signs in: bfstats.io's own Discord sign-in, which sends
 *  them back to `returnTo` (ui/src/views/DiscordStart.vue). */
export function signInHref(returnTo, page = globalThis.location) {
  const host = /(^|\.)bfstats\.io$/i.test(page.hostname) ? LIVE_API : page.origin;
  return `${host}/auth/discord/start?returnTo=${encodeURIComponent(returnTo)}`;
}

/** One client per API on a page (`createRecordingsApi`): the comments, the
 *  Share dialog and the creator view's gate all ask through it, since two
 *  clients refreshing one cookie at once would revoke the session. */
const clients = new Map();
export function sharedRecordingsApi(api) {
  const key = `${api.base}|${api.mode}`;
  if (!clients.has(key)) clients.set(key, createRecordingsApi(api));
  return clients.get(key);
}

/**
 * The API client for one base. Signed in means holding an access token for it:
 * on the same origin one is fetched with the site's refresh cookie when there
 * is none (once a page: two refreshes racing on one cookie would revoke the
 * whole session, bfstats.io's included), against a local API with its dev
 * sign-in.
 */
export function createRecordingsApi(api) {
  const { base, mode } = api;
  const key = `${AUTH_KEY}:${base || globalThis.location?.origin || ''}`;
  let session = readToken(key);
  let refreshed = null;
  let viewer = null;
  const listeners = new Set();
  const changed = () => { for (const fn of listeners) fn(); };

  async function refresh() {
    if (mode !== 'same') return null;
    try {
      const response = await fetch(`${base}/stats/auth/refresh`, { method: 'POST', credentials: 'include' });
      if (!response.ok) return null;
      const body = await response.json();
      session = { token: body.accessToken, expiresAt: body.expiresAt };
      writeToken(key, session);
      return session.token;
    } catch {
      return null;
    }
  }

  /** The access token, fetching one if this page has not tried yet. */
  async function token({ retry = false } = {}) {
    if (session && Date.parse(session.expiresAt) - Date.now() > EXPIRY_MARGIN_MS) return session.token;
    if (!refreshed || retry) refreshed = refresh();
    return refreshed;
  }

  async function request(path, { method = 'GET', json, body, auth = false, signal } = {}) {
    const send = async bearer => {
      const headers = {};
      if (bearer) headers.Authorization = `Bearer ${bearer}`;
      if (json !== undefined) headers['Content-Type'] = 'application/json';
      return fetch(`${base}${path}`, {
        method, headers, signal,
        body: json !== undefined ? JSON.stringify(json) : body,
        credentials: mode === 'same' ? 'same-origin' : 'omit',
      });
    };
    let bearer = auth || session ? await token() : null;
    if (auth && !bearer) throw new ApiError(401, 'Sign in first.');
    let response = await send(bearer);
    // A token the API no longer takes: one fresh try.
    if (response.status === 401 && bearer) {
      forget();
      bearer = await token({ retry: true });
      if (bearer) response = await send(bearer);
    }
    if (!response.ok) throw await failure(response);
    if (response.status === 204 || response.status === 202) return null;
    return response.json();
  }

  function forget() {
    session = null;
    viewer = null;
    writeToken(key, null);
    changed();
  }

  /** The upload, with its progress (fetch reports none): gzipped in the
   *  browser where it can be, which shrinks a recording about four times on
   *  the wire and on the server's disk. */
  async function upload({ recording, serverLog = null, thumbnail = null, meta, onProgress = () => {}, onStage = () => {} }) {
    const bearer = await token();
    if (!bearer) throw new ApiError(401, 'Sign in first.');
    onStage('Compressing');
    const form = new FormData();
    form.append('meta', new Blob([JSON.stringify(meta)], { type: 'application/json' }));
    form.append('recording', await gzipped(recording), `${recording.name}.gz`);
    if (serverLog) form.append('serverlog', await gzipped(serverLog), `${serverLog.name}.gz`);
    if (thumbnail) form.append('thumbnail', thumbnail, 'cover.jpg');
    onStage('Uploading');
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `${base}/stats/recordings`);
      xhr.setRequestHeader('Authorization', `Bearer ${bearer}`);
      xhr.withCredentials = mode === 'same';
      xhr.upload.onprogress = e => { if (e.lengthComputable) onProgress(e.loaded / e.total); };
      xhr.onload = () => {
        let body = null;
        try { body = JSON.parse(xhr.responseText); } catch {}
        if (xhr.status >= 200 && xhr.status < 300) resolve(body);
        else reject(new ApiError(xhr.status, body?.message
          || (xhr.status === 413 ? 'That file is too big to share.' : `The upload failed (HTTP ${xhr.status}).`), body));
      };
      xhr.onerror = () => reject(new ApiError(0, 'The upload broke off. Check the connection and try again.'));
      xhr.send(form);
    });
  }

  return {
    base,
    mode,
    /** Sharing and commenting are possible here: not a remote API read from this PC. */
    get canWrite() { return mode !== 'remote'; },
    get signedIn() { return Boolean(session); },
    get isAdmin() { return session ? rolesOf(session.token).includes('Admin') : false; },
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },

    /** Whether this visitor is signed in, asking the API once if the page holds
     *  no token. */
    async ready() {
      await token();
      changed();
      return Boolean(session);
    },
    async signIn() {
      if (mode === 'local') {
        const response = await fetch(`${base}/stats/auth/login`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ devBypass: true }),
        });
        if (!response.ok) throw await failure(response);
        const body = await response.json();
        session = { token: body.accessToken, expiresAt: body.expiresAt };
        writeToken(key, session);
        viewer = null;
        changed();
        return true;
      }
      if (mode === 'same') globalThis.location.assign(signInHref(globalThis.location.href));
      return false;
    },
    async signOut() {
      if (mode === 'same') {
        await fetch(`${base}/stats/auth/logout`, { method: 'POST', credentials: 'include' }).catch(() => {});
      }
      forget();
    },
    /** `{ userId, names, isAdmin }`: the player names this visitor posts as. */
    async viewer({ fresh = false } = {}) {
      if (!session && !(await token())) return null;
      if (!viewer || fresh) viewer = await request('/stats/recordings/me', { auth: true });
      return viewer;
    },
    /** Links an in-game name to the account, the way the dashboard does. */
    async linkName(playerName) {
      await request('/stats/auth/player-names', { method: 'POST', json: { playerName }, auth: true });
      return this.viewer({ fresh: true });
    },

    /** A page of the feed, narrowed to a `server` and an `uploader` when given. */
    list: ({ sort = 'recent', page = 1, pageSize = 24, server = '', uploader = '', signal } = {}) =>
      request(`/stats/recordings?${readableQuery([
        ['sort', sort], ['page', page], ['pageSize', pageSize], ['server', server], ['uploader', uploader]])}`, { signal }),
    /** `{ servers, uploaders }`, each `[{ name, count }]`: what the feed can be
     *  narrowed to, each counted within the other filter. */
    filters: ({ server = '', uploader = '', signal } = {}) => {
      const query = readableQuery([['server', server], ['uploader', uploader]]);
      return request(`/stats/recordings/filters${query ? `?${query}` : ''}`, { signal });
    },
    get: slug => request(`/stats/recordings/${encodeURIComponent(slug)}`),
    rename: (slug, title) => request(`/stats/recordings/${encodeURIComponent(slug)}`, { method: 'PATCH', json: { title }, auth: true }),
    remove: slug => request(`/stats/recordings/${encodeURIComponent(slug)}`, { method: 'DELETE', auth: true }),
    /** A JPEG as the recording's cover (the uploader's, or an admin's). */
    setThumbnail: (slug, jpeg) =>
      request(`/stats/recordings/${encodeURIComponent(slug)}/thumbnail`, { method: 'PUT', body: jpeg, auth: true }),
    view: slug => request(`/stats/recordings/${encodeURIComponent(slug)}/views`, { method: 'POST' }),
    /** An admin puts `slug` in the round of `other` (its id or any link to it).
     *  Two recordings whose files fall short of what detection needs are a 409
     *  whose `body.evidence` says what they share, until `confirm`. */
    linkRound: (slug, other, confirm = false) =>
      request(`/stats/recordings/${encodeURIComponent(slug)}/round`, { method: 'POST', json: { with: other, confirm }, auth: true }),
    /** An admin takes `slug` out of its round, for good. */
    separateRound: slug => request(`/stats/recordings/${encodeURIComponent(slug)}/round`, { method: 'DELETE', auth: true }),
    comments: (slug, { sort = 'newest', page = 1, pageSize = 20 } = {}) =>
      request(`/stats/recordings/${encodeURIComponent(slug)}/comments?sort=${sort}&page=${page}&pageSize=${pageSize}`),
    comment: (slug, content, authorName) =>
      request(`/stats/recordings/${encodeURIComponent(slug)}/comments`, { method: 'POST', json: { content, authorName }, auth: true }),
    removeComment: (slug, id) =>
      request(`/stats/recordings/${encodeURIComponent(slug)}/comments/${id}`, { method: 'DELETE', auth: true }),
    upload,
    /** A recording's file, absolute for this API. */
    fileUrl: path => (path && base && !/^https?:/i.test(path) ? `${base}${path}` : path),
  };
}

/** `file` gzipped, or `file` itself where the browser has no
 *  CompressionStream (the API compresses what arrives plain). */
async function gzipped(file) {
  if (typeof CompressionStream === 'undefined') return file;
  return new Response(file.stream().pipeThrough(new CompressionStream('gzip'))).blob();
}

/** A query string whose paths keep their slashes and colons
 *  (`replay=/stats/recordings/<slug>.ndjson`), from `[name, value]` pairs;
 *  empty values are left out. */
export function readableQuery(pairs) {
  return pairs.filter(([, v]) => v !== null && v !== undefined && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v)).replace(/%2F/g, '/').replace(/%3A/g, ':')}`)
    .join('&');
}

// --- how the feed says things ------------------------------------------------

/** `h:mm:ss` or `m:ss`, standing alone: the API's pattern (RecordingText.cs). */
export const TIME_IN_TEXT = /(?<![\d:])(?:(\d{1,2}):([0-5]\d):([0-5]\d)|(\d{1,3}):([0-5]\d))(?![\d:])/g;

/** A comment's text in runs: `{ text }` and `{ text, at }` for each time in it
 *  that falls inside the recording, a place to jump to. */
export function commentRuns(text, durationSeconds = Infinity) {
  const runs = [];
  let last = 0;
  for (const match of String(text).matchAll(TIME_IN_TEXT)) {
    const at = secondsOf(match);
    if (at > durationSeconds + 1) continue;
    if (match.index > last) runs.push({ text: text.slice(last, match.index) });
    runs.push({ text: match[0], at });
    last = match.index + match[0].length;
  }
  if (last < text.length) runs.push({ text: text.slice(last) });
  return runs;
}

const secondsOf = match => (match[1] !== undefined
  ? Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3])
  : Number(match[4]) * 60 + Number(match[5]));

// --- a round of several recordings ------------------------------------------------
//
// A round several players shared plays merged (replay-merge.js): one `?replay=`
// per recording, the first leading. Its comments stay on each recording, in that
// recording's own clock; the merged replay moves each onto the round's clock with
// the header's `merged[i]` (`offset`, `drift`), and a comment written there goes
// on the recording whose stretch holds the moment it names.

/** The recordings a replay page plays, in order: every `replay` in its address. */
export function replayUrlsOf(params) {
  return params.getAll('replay').filter(Boolean);
}

/** The replay page for a shared recording, at `at` seconds if given. `root`
 *  is the viewer's, from the page asking. */
export function watchHref(recording, { root, fileUrl = path => path, at = null }) {
  const q = readableQuery([
    ['mod', recording.mod],
    ['map', recording.level],
    ['replay', fileUrl(recording.recordingUrl)],
    ['serverlog', recording.serverLogUrl ? fileUrl(recording.serverLogUrl) : null],
    ['t', at === null ? null : Math.max(0, Math.floor(at))],
  ]);
  return new URL(`map.html?${q}`, new URL(root, globalThis.location.href)).href;
}

/**
 * A round's recordings played merged (features/replay-feed, "Rounds"): one
 * `replay` per recording, `recording` first (its clock and its player lead),
 * then the others in the order they began in the round, and the first's server
 * log. `round` is the API's list of them, `recording` among them.
 */
export function watchRoundHref(recording, round, { root, fileUrl = path => path, at = null }) {
  const lead = round.find(m => m.slug === recording.slug) ?? recording;
  const order = [lead, ...round.filter(m => m.slug !== lead.slug)];
  const q = readableQuery([
    ['mod', recording.mod],
    ['map', recording.level],
    ...order.map(m => ['replay', fileUrl(m.recordingUrl)]),
    ['serverlog', lead.serverLogUrl ? fileUrl(lead.serverLogUrl) : null],
    ['t', at === null ? null : Math.max(0, Math.floor(at))],
  ]);
  return new URL(`map.html?${q}`, new URL(root, globalThis.location.href)).href;
}

/**
 * Where the moment on screen falls in another way of watching a round
 * (replay-social.js's switch), seconds, or null where nothing measured it.
 * `round` is the API's list (each recording's `roundOffsetSeconds` on the
 * round's clock, its `durationSeconds`); `playing` is what plays: `slugs`, the
 * page's recordings in its order, and `sources`, the merged header's
 * `merged[i]` when it played them merged (else the first plays alone, on its
 * own clock); `t` its time. `to` is a recording's slug, watched alone, or
 * 'merged': every recording, on the round's clock.
 */
export function roundMoment(round, playing, to, t) {
  const bySlug = new Map(round.map(m => [m.slug, m]));
  const offset = slug => bySlug.get(slug)?.roundOffsetSeconds ?? null;
  const sources = playing.sources?.length === playing.slugs.length ? playing.sources : null;
  const own = (i, at) => sourceClock(sources[i]).fromRound(at);
  // The moment on the round's clock, through the first recording playing.
  const first = playing.slugs[0];
  const firstAt = sources ? own(0, t) : t;
  const onRound = offset(first) === null ? (sources ? t : null) : firstAt + offset(first);
  if (to === 'merged') return onRound === null ? null : Math.max(0, onRound);
  const target = bySlug.get(to);
  let at = null;
  const index = sources ? playing.slugs.indexOf(to) : -1;
  if (index >= 0) at = own(index, t);
  else if (to === first && !sources) at = t;
  else if (onRound !== null && offset(to) !== null) at = onRound - offset(to);
  if (at === null) return null;
  return Math.min(Math.max(0, at), Math.max(0, target?.durationSeconds ?? Infinity));
}

/** The header's count: `12`, or `2 rounds · 3 recordings` once rounds of
 *  several recordings make the cards fewer than the recordings. */
export function feedCount(cards, recordings = cards) {
  if (!cards) return '';
  return recordings > cards ? `${count(cards, 'round')} · ${count(recordings, 'recording')}` : String(cards);
}

/** One recording's clock against its merged round's (`merged[i]` of the merged
 *  header): the round's `t = offset + (1 + drift) t`. */
export function sourceClock(source) {
  const offset = Number(source?.offset) || 0;
  const rate = 1 + (Number(source?.drift) || 0);
  return { toRound: t => offset + rate * t, fromRound: t => (t - offset) / rate };
}

/** A comment on one recording of a merged round in runs, as `commentRuns`, each
 *  time a place on the round's clock and said in it. `duration` is the
 *  recording's own. */
export function roundRuns(text, source, duration = Infinity) {
  const { toRound } = sourceClock(source);
  // To the nearest second: a comment posted here at 8:40 reads 8:40 when it comes back.
  return commentRuns(text, duration).map(run => (run.at === undefined ? run : { text: clock(Math.round(toRound(run.at))), at: toRound(run.at) }));
}

/**
 * Where a comment written on a merged round goes: `{ index, text }`, the
 * recording (of `sources`, `[{ offset, drift, duration }]` in the round's order)
 * whose stretch holds the first time it names, the first's when it does or it
 * names none, and the text with each time said on that recording's clock.
 */
export function commentTarget(text, sources) {
  const words = String(text);
  const times = [...words.matchAll(TIME_IN_TEXT)].map(match => ({ at: secondsOf(match), from: match.index, to: match.index + match[0].length }));
  const holds = (i, at) => {
    const t = sourceClock(sources[i]).fromRound(at);
    return t >= 0 && t <= (sources[i].duration ?? Infinity) + 1;
  };
  let index = 0;
  if (times.length && sources.length > 1 && !holds(0, times[0].at)) index = Math.max(0, sources.findIndex((_, i) => holds(i, times[0].at)));
  const { fromRound } = sourceClock(sources[index]);
  let out = '';
  let last = 0;
  for (const time of times) {
    const t = fromRound(time.at);
    out += words.slice(last, time.from) + (t >= 0 ? clock(Math.round(t)) : words.slice(time.from, time.to));
    last = time.to;
  }
  return { index, text: out + words.slice(last) };
}

/** `14:43`, `1:02:03`. */
export function clock(seconds) {
  const s = Math.max(0, Math.floor(seconds || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rest = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${rest}` : `${m}:${rest}`;
}

/** `12 views`, `1.2K views`. */
export function count(n, one, many = `${one}s`) {
  const value = Number(n) || 0;
  const shown = value >= 1e6 ? `${(value / 1e6).toFixed(value >= 1e7 ? 0 : 1)}M`
    : value >= 1e3 ? `${(value / 1e3).toFixed(value >= 1e4 ? 0 : 1)}K` : String(value);
  return `${shown.replace(/\.0(?=[KM])/, '')} ${value === 1 ? one : many}`;
}

/** `3 days ago`, from an ISO instant. */
export function ago(instant, now = Date.now()) {
  const then = Date.parse(instant);
  if (!Number.isFinite(then)) return '';
  const seconds = Math.max(0, (now - then) / 1000);
  const steps = [[60, 'second'], [60, 'minute'], [24, 'hour'], [7, 'day'], [4.35, 'week'], [12, 'month'], [Infinity, 'year']];
  let value = seconds;
  for (const [size, unit] of steps) {
    if (value < size) {
      const n = Math.floor(value);
      return n <= 0 && unit === 'second' ? 'just now' : `${n} ${unit}${n === 1 ? '' : 's'} ago`;
    }
    value /= size;
  }
  return '';
}

/** `2.1 GB`, `640 MB`. */
export function size(bytes) {
  const gb = bytes / 1024 ** 3;
  return gb >= 1 ? `${gb.toFixed(gb >= 10 ? 0 : 1)} GB` : `${Math.max(0, Math.round(bytes / 1024 ** 2))} MB`;
}
