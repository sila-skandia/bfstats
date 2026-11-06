// After a recording is shared, tell the uploader when the BF42++ that wrote it
// is older than the newest release, with a link to that release and what it
// fixes (features/recorder-update-notice). A recording keeps whatever its
// recorder left out: FHSW rounds from before 2026-10-18 carry no animation
// state table, so every soldier stands and a crawling one slides along the
// ground. Nothing on the site can repair that, so the uploader is told how to
// record the next round properly.
//
// The recorder stamps its compiler build time into the header
// (`"build":"Oct 18 2026 13:34:34"`, bf42plus 3979cd2). Every build before that
// commit writes no stamp at all, so a header without one is outdated. The
// server recorder writes `plus: "server-replay-recorder/N"` and is not BF42++,
// so it is never told to update.
//
// When a new BF42++ release is cut, move LATEST here and CLIENT_TAG in
// ui/src/views/v4/BattleViewV4.vue together.

export const LATEST = Object.freeze({
  tag: 'v2.0-round-replay',
  name: '2.0-round-replay',
  // The released dsound.dll's own stamp. A build from that day or later is current.
  built: 'Oct 18 2026 13:34:34',
  release: 'https://github.com/sila-skandia/bf42plus/releases/tag/v2.0-round-replay',
  dll: 'https://github.com/sila-skandia/bf42plus/releases/download/v2.0-round-replay/dsound.dll',
  fixes: Object.freeze([
    'Crouching, lying down, firing and reloading are recorded on Forgotten Hope and other big mods. Before, soldiers stood upright and slid along the ground.',
    'Recording starts the moment you type plus.recordReplays 1.',
    'A recording started mid-round names the level, the server, the players and the vehicles.',
    'Every recording says which build made it, so bfstats.io can tell you when a newer one is out.',
  ]),
});

export const BATTLEVIEW = 'https://bfstats.io/battleview';
export const DISCORD = 'https://discord.gg/6saqqTTYEM';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** The day of a compiler `__DATE__ __TIME__` stamp ("Oct 18 2026 13:34:34",
 *  "Nov  5 2026 09:00:00") as a UTC midnight in ms, or null. Only the day is
 *  compared: the stamp is the build machine's local time, with no zone. */
export function buildDay(stamp) {
  const m = /^([A-Z][a-z]{2})\s+(\d{1,2})\s+(\d{4})\b/.exec(String(stamp ?? '').trim());
  if (!m) return null;
  const month = MONTHS.indexOf(m[1]);
  if (month < 0) return null;
  return Date.UTC(Number(m[3]), month, Number(m[2]));
}

/**
 * What a recording's header says about the BF42++ that wrote it:
 * `{ outdated, build }`. `build` is the stamp, or null when there is none.
 * Null for a header that is not BF42++'s (the server recorder) or not a header.
 */
export function recorderStatus(header, latest = LATEST) {
  if (!header || header.k !== 'h') return null;
  const plus = String(header.plus ?? '');
  if (/^server-replay-recorder/i.test(plus.trim())) return null;
  const build = typeof header.build === 'string' && header.build.trim() ? header.build.trim() : null;
  const day = buildDay(build);
  // A stamp that does not parse is newer than this reader, not older.
  const outdated = build === null ? true : day === null ? false : day < buildDay(latest.built);
  return { outdated, build };
}

/** The first line of a recording File or Blob, parsed, or null. */
export async function readHeader(file) {
  try {
    const head = await file.slice(0, 4096).text();
    return JSON.parse(head.split('\n', 1)[0]);
  } catch {
    return null;
  }
}

const HIDE_KEY = 'bf42plus-update-hidden';
// "Not now" hides it for a day, so a backlog of old recordings shared in one
// sitting asks once.
const HIDE_MS = 24 * 60 * 60 * 1000;

function hidden(now = Date.now()) {
  try {
    const raw = JSON.parse(localStorage.getItem(HIDE_KEY) ?? 'null');
    return raw?.tag === LATEST.tag && now - Number(raw.at) < HIDE_MS;
  } catch {
    return false;
  }
}

function hide() {
  try { localStorage.setItem(HIDE_KEY, JSON.stringify({ tag: LATEST.tag, at: Date.now() })); } catch {}
}

const STYLE = `
.rup { box-sizing: border-box; position: fixed; right: 16px; bottom: 16px; z-index: 2147482000; width: min(380px, calc(100vw - 32px));
  max-height: calc(100vh - 32px); overflow: auto; padding: 16px 16px 14px; border-radius: 10px; background: #171814;
  border: 1px solid #3c3b2f; border-top: 3px solid #e8c35a; box-shadow: 0 14px 40px rgba(0, 0, 0, .5);
  font: 13.5px/1.45 'Trebuchet MS', 'Segoe UI', sans-serif; color: #ece6cf;
  animation: rup-in .28s cubic-bezier(.2, .8, .3, 1) both; }
@keyframes rup-in { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: none; } }
@media (prefers-reduced-motion: reduce) { .rup { animation: none; } }
.rup h2 { margin: 0 28px 6px 0; font-size: 12px; letter-spacing: .16em; text-transform: uppercase; color: #e8c35a; }
.rup p { margin: 0 0 8px; color: #cfc9b0; }
.rup ul { margin: 0 0 10px; padding-left: 18px; color: #b9b39a; font-size: 12.5px; }
.rup li { margin: 0 0 4px; }
.rup li::marker { color: #e8c35a; }
.rup code { font: 12px ui-monospace, Menlo, Consolas, monospace; color: #f4f0dc; }
.rup-x { position: absolute; top: 8px; right: 8px; width: 28px; height: 28px; border: 0; border-radius: 6px; background: none;
  color: #b9b39a; font: 18px/28px sans-serif; cursor: pointer; }
.rup-x:hover { color: #f4f0dc; background: #24251f; }
.rup-row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.rup-row a, .rup-row button { height: 32px; padding: 0 12px; border-radius: 6px; border: 1px solid #4a4838; background: #24251f;
  color: #ece6cf; font: 700 11.5px/30px 'Trebuchet MS', 'Segoe UI', sans-serif; letter-spacing: .1em; text-transform: uppercase;
  text-decoration: none; cursor: pointer; }
.rup-row .go { background: #e8c35a; border-color: #e8c35a; color: #191a12; }
.rup-foot { margin: 10px 0 0; font-size: 12px; color: #9d987f; }
.rup-foot a { color: #e8c35a; }
.rup a:focus-visible, .rup button:focus-visible { outline: 1px solid #e8c35a; outline-offset: 1px; }
`;

const el = (tag, cls, text) => {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
};

const link = (cls, text, href) => {
  const a = el('a', cls, text);
  a.href = href;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  return a;
};

/**
 * Shown after a share: when any of `files` (recordings just uploaded) was
 * written by an outdated BF42++, a small card in the corner says so. It does
 * not cover the page or take the focus, and closes with its X, Esc or Not now.
 * Resolves to whether it was shown.
 */
export async function remindToUpdate(files) {
  if (typeof document === 'undefined' || hidden()) return false;
  const statuses = [];
  for (const file of [files].flat().filter(Boolean)) {
    const status = recorderStatus(await readHeader(file));
    if (status) statuses.push(status);
  }
  const old = statuses.filter(s => s.outdated);
  if (!old.length || document.querySelector('.rup')) return false;

  if (!document.getElementById('rup-style')) {
    const style = el('style');
    style.id = 'rup-style';
    style.textContent = STYLE;
    document.head.append(style);
  }
  const card = el('section', 'rup');
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-labelledby', 'rup-title');
  const heading = el('h2', '', 'Update BF42++');
  heading.id = 'rup-title';
  const stamp = old.find(s => s.build)?.build;
  const lede = el('p', '', `${old.length > 1 ? 'These recordings were' : 'This recording was'} made with ${
    stamp ? `an older BF42++ (built ${stamp.replace(/\s+/g, ' ')})` : 'an older BF42++'}. It is shared, but ${LATEST.name} records more of the round:`);
  const list = el('ul');
  for (const fix of LATEST.fixes) list.append(el('li', '', fix));
  const how = el('p');
  how.append('Replace ', el('code', '', 'dsound.dll'), ' in your Battlefield 1942 folder with the new one.');

  const row = el('div', 'rup-row');
  const get = link('go', 'Get the update', LATEST.release);
  const later = el('button', '', 'Not now');
  later.type = 'button';
  row.append(get, later);
  const foot = el('p', 'rup-foot');
  foot.append('How to record and watch: ', link('', 'BattleView', BATTLEVIEW), '. Questions? ', link('', 'Join our Discord', DISCORD), '.');
  const x = el('button', 'rup-x', '×');
  x.type = 'button';
  x.setAttribute('aria-label', 'Close');

  card.append(x, heading, lede, list, how, row, foot);
  document.body.append(card);

  const shut = () => {
    card.remove();
    window.removeEventListener('keydown', onKey, true);
  };
  const onKey = e => {
    if (e.key === 'Escape' && card.contains(document.activeElement)) {
      e.stopPropagation();
      shut();
    }
  };
  window.addEventListener('keydown', onKey, true);
  x.addEventListener('click', shut);
  later.addEventListener('click', () => { hide(); shut(); });
  return true;
}
