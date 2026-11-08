// Likes and reactions on a shared recording's comments (features/replay-feed,
// "Likes and reactions"): a Like button with its count under each comment,
// the other reactions it has as chips beside it, and a picker for the rest.
// The REPLAY feed's recording page (play/recordings-feed.js) and the replay's
// own comments panel (replay-social.js) both draw them with `reactionBar`.
//
// A reaction is a name the API keeps (`like`, `love` ...), drawn here as its
// own small vector glyph in the replay chrome's palette: the codebase carries
// no emoji characters. A click shows at once and is put right by what the API
// answers; a refusal puts it back and says why.

/** The reactions, in the order a comment lists them, as the API has them. */
export const REACTIONS = [
  { kind: 'like', label: 'Like' },
  { kind: 'love', label: 'Love' },
  { kind: 'haha', label: 'Haha' },
  { kind: 'wow', label: 'Wow' },
  { kind: 'fire', label: 'Fire' },
  { kind: 'rip', label: 'RIP' },
];
const ORDER = new Map(REACTIONS.map((r, i) => [r.kind, i]));
const LABEL = new Map(REACTIONS.map(r => [r.kind, r.label]));

// 16 x 16, each in its own colours; the like is drawn in the text's colour,
// and filled when it is the viewer's.
const FACE = '<circle cx="8" cy="8" r="6.6" fill="#f2c25a"/><circle cx="8" cy="8" r="6.6" fill="none" stroke="#b8862a" stroke-width=".8"/>';
const INK = '#3a2810';
const GLYPH = {
  like: '<path class="cr-thumb" d="M2.2 7.1h2.4v6.4H2.2zM6 13.5V7.3l2.5-4.7c1 0 1.8.9 1.6 1.9l-.4 2h3.2c1 0 1.6.9 1.4 1.8l-1.1 4.2c-.2.6-.7 1-1.3 1z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/>',
  love: '<path d="M8 13.8S1.9 10 1.9 5.9A3.2 3.2 0 0 1 8 4.5a3.2 3.2 0 0 1 6.1 1.4C14.1 10 8 13.8 8 13.8z" fill="#e0605a"/><path d="M4.4 5.2a1.6 1.6 0 0 1 1.7-1.2" fill="none" stroke="#ffb3a8" stroke-width="1" stroke-linecap="round"/>',
  haha: `${FACE}<path d="M4.5 6.9q1.1-1.6 2.2 0M9.3 6.9q1.1-1.6 2.2 0" fill="none" stroke="${INK}" stroke-width="1.1" stroke-linecap="round"/><path d="M4.4 9.1h7.2a3.6 3.6 0 0 1-7.2 0z" fill="${INK}"/><path d="M5.9 11.4a2.6 1.2 0 0 1 4.2 0 3.6 3.6 0 0 1-4.2 0z" fill="#e0605a"/>`,
  wow: `${FACE}<path d="M4.4 4.6l1.9-.5M11.6 4.6l-1.9-.5" fill="none" stroke="${INK}" stroke-width=".9" stroke-linecap="round"/><circle cx="5.8" cy="6.6" r="1" fill="${INK}"/><circle cx="10.2" cy="6.6" r="1" fill="${INK}"/><ellipse cx="8" cy="10.6" rx="1.5" ry="1.9" fill="${INK}"/>`,
  fire: '<path d="M8 1.4c.5 2.6 4.3 4 4.3 8.1a4.3 4.3 0 0 1-8.6 0c0-1.8.9-3 1.9-3.8-.1 1.4.5 2.4 1.4 2.8C6.6 6.1 7.3 3.6 8 1.4z" fill="#f08a3c"/><path d="M8 7.9c.4 1.3 2 1.9 2 3.6a2 2 0 0 1-4 0c0-1 .6-1.8 1.1-2.2 0 .6.3 1 .7 1.1-.1-.9 0-1.7.2-2.5z" fill="#ffd36a"/>',
  rip: '<path d="M8 1.8c-3.3 0-5.6 2.3-5.6 5.3 0 1.8.9 3.1 2.2 3.8v2.6h6.8v-2.6c1.3-.7 2.2-2 2.2-3.8 0-3-2.3-5.3-5.6-5.3z" fill="#d9d4c0"/><circle cx="5.9" cy="7.5" r="1.45" fill="#1c1c18"/><circle cx="10.1" cy="7.5" r="1.45" fill="#1c1c18"/><path d="M8 9.3l-.85 1.5h1.7z" fill="#1c1c18"/><path d="M6.5 11.7v1.7M8 11.7v1.7M9.5 11.7v1.7" stroke="#1c1c18" stroke-width=".75"/>',
  add: '<circle cx="7" cy="8.6" r="5.4" fill="none" stroke="currentColor" stroke-width="1.3"/><circle cx="5.2" cy="7.6" r=".8" fill="currentColor"/><circle cx="8.8" cy="7.6" r=".8" fill="currentColor"/><path d="M4.9 10.2a2.6 2.6 0 0 0 4.2 0" fill="none" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/><path d="M13.2 1.2v4.2M11.1 3.3h4.2" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>',
};

/** A reaction's glyph as SVG markup. */
export function reactionGlyph(kind) {
  return `<svg class="cr-glyph" viewBox="0 0 16 16" aria-hidden="true">${GLYPH[kind] ?? ''}</svg>`;
}

/** A reaction's name as people read it. */
export const reactionLabel = kind => LABEL.get(kind) ?? kind;

/**
 * The viewer's click on `kind`, as the comment's reactions would be after it:
 * given if they had not, taken back if they had. `{ reactions, give }`, a new
 * list in `REACTIONS` order; the old one is not changed.
 */
export function toggleReaction(reactions, kind) {
  const list = (reactions ?? []).map(r => ({ ...r }));
  const at = list.findIndex(r => r.kind === kind);
  if (at >= 0 && list[at].mine) {
    list[at].count -= 1;
    list[at].mine = false;
    if (list[at].count <= 0) list.splice(at, 1);
    return { reactions: list, give: false };
  }
  if (at >= 0) {
    list[at].count += 1;
    list[at].mine = true;
  } else {
    list.push({ kind, count: 1, mine: true });
  }
  list.sort((a, b) => (ORDER.get(a.kind) ?? 99) - (ORDER.get(b.kind) ?? 99));
  return { reactions: list, give: true };
}

/** Who a reaction is from, as a title says it: "You and 2 others". */
export function reactionWho({ kind, count = 0, mine = false } = {}) {
  const label = reactionLabel(kind);
  if (!count) return label;
  if (mine) {
    const others = count - 1;
    return others ? `${label}: you and ${others} other${others === 1 ? '' : 's'}` : `${label}: you`;
  }
  return `${label}: ${count} ${count === 1 ? 'person' : 'people'}`;
}

const STYLE = `
.cr-bar { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; margin-top: 6px; }
.cr-btn { appearance: none; display: inline-flex; align-items: center; gap: 4px; height: 22px; margin: 0; padding: 0 7px;
  border: 1px solid rgba(200, 194, 152, .2); border-radius: 11px; background: rgba(255, 255, 255, .035);
  color: rgba(232, 226, 200, .66); font: 700 11px/1 ui-monospace, 'SF Mono', Menlo, monospace; font-variant-numeric: tabular-nums;
  cursor: pointer; transition: border-color .15s ease, background-color .15s ease, color .15s ease; }
.cr-btn:hover:not(:disabled) { border-color: rgba(200, 194, 152, .5); color: #ece6c8; }
.cr-btn:focus-visible { outline: 2px solid rgba(232, 195, 90, .8); outline-offset: 1px; }
.cr-btn:disabled { cursor: default; }
.cr-btn.mine { border-color: rgba(232, 195, 90, .72); background: rgba(232, 195, 90, .14); color: #f2d98e; }
.cr-btn.mine .cr-thumb { fill: currentColor; }
.cr-glyph { flex: none; width: 14px; height: 14px; }
.cr-btn.pop .cr-glyph { animation: cr-pop .38s cubic-bezier(.3, 1.6, .5, 1); }
.cr-like:not(.has) { padding: 0 6px; }
.cr-add { width: 26px; justify-content: center; padding: 0; border-style: dashed; background: none; }
.cr-add[aria-expanded="true"] { border-style: solid; border-color: rgba(232, 195, 90, .6); color: #f2d98e; }
.cr-picker { display: inline-flex; align-items: center; gap: 1px; padding: 1px 3px; border: 1px solid rgba(200, 194, 152, .32);
  border-radius: 13px; background: rgba(18, 18, 15, .92); box-shadow: 0 4px 14px rgba(0, 0, 0, .45);
  animation: cr-open .16s ease-out both; transform-origin: left center; }
.cr-pick { appearance: none; display: grid; place-items: center; width: 26px; height: 22px; margin: 0; padding: 0; border: 0;
  border-radius: 11px; background: none; cursor: pointer; transition: transform .14s ease, background-color .14s ease; }
.cr-pick .cr-glyph { width: 17px; height: 17px; }
.cr-pick:hover, .cr-pick:focus-visible { transform: translateY(-2px) scale(1.18); background: rgba(255, 255, 255, .07); outline: 0; }
.cr-pick.mine { background: rgba(232, 195, 90, .18); }
@keyframes cr-pop { 0% { transform: scale(1); } 45% { transform: scale(1.45) rotate(-8deg); } 100% { transform: scale(1); } }
@keyframes cr-open { from { opacity: 0; transform: scaleX(.6); } }
@media (prefers-reduced-motion: reduce) {
  .cr-btn.pop .cr-glyph, .cr-picker { animation: none; }
  .cr-pick:hover, .cr-pick:focus-visible { transform: none; }
}
`;

function injectStyle() {
  if (typeof document === 'undefined' || document.getElementById('cr-style')) return;
  const style = document.createElement('style');
  style.id = 'cr-style';
  style.textContent = STYLE;
  document.head.append(style);
}

/**
 * The bar under one comment. `comment.reactions` is read and kept up to date
 * in place, so a list drawn again later draws what the viewer did.
 *
 * - `react(kind, give)`: asks the API, answering the comment's reactions;
 *   absent, the bar only shows the counts (a page that cannot write).
 * - `canReact()`: whether the viewer may react now (signed in).
 * - `signIn()`: what a click does when they may not.
 * - `failed(message)`: a refusal, to say on the page.
 */
export function reactionBar(comment, { react, canReact = () => true, signIn, failed } = {}) {
  injectStyle();
  const bar = document.createElement('div');
  bar.className = 'cr-bar';
  bar.setAttribute('role', 'group');
  bar.setAttribute('aria-label', 'Reactions');
  let open = false;
  let asked = 0;
  let popped = null;

  function button(cls, html, label, onClick) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = cls;
    b.innerHTML = html;
    b.title = label;
    b.setAttribute('aria-label', label);
    if (onClick) {
      b.addEventListener('click', e => { e.stopPropagation(); onClick(); });
    } else {
      b.disabled = true;
    }
    return b;
  }

  async function click(kind) {
    if (!canReact()) {
      signIn?.();
      return;
    }
    const before = comment.reactions ?? [];
    const { reactions, give } = toggleReaction(before, kind);
    comment.reactions = reactions;
    popped = give ? kind : null;
    setOpen(false);
    draw();
    const mine = ++asked;
    try {
      const answer = await react(kind, give);
      // Only the latest click's answer: an earlier one may come back after it.
      if (mine === asked && Array.isArray(answer)) {
        comment.reactions = answer;
        popped = null;
        draw();
      }
    } catch (error) {
      if (mine !== asked) return;
      comment.reactions = before;
      popped = null;
      draw();
      failed?.(error?.message || 'That reaction did not go through.');
    }
  }

  function draw() {
    const reactions = comment.reactions ?? [];
    const of = kind => reactions.find(r => r.kind === kind);
    const act = kind => (react ? () => click(kind) : null);
    bar.replaceChildren();

    // The like is always there, as a comment's thumbs-up is.
    const like = of('like') ?? { kind: 'like', count: 0, mine: false };
    const likeBtn = button(`cr-btn cr-like${like.mine ? ' mine' : ''}${like.count ? ' has' : ''}`, reactionGlyph('like'),
      like.count ? reactionWho(like) : 'Like', act('like'));
    likeBtn.setAttribute('aria-pressed', String(Boolean(like.mine)));
    if (like.count) likeBtn.append(String(like.count));
    if (popped === 'like') likeBtn.classList.add('pop');
    bar.append(likeBtn);

    for (const r of reactions) {
      if (r.kind === 'like' || !r.count) continue;
      const chip = button(`cr-btn${r.mine ? ' mine' : ''}`, reactionGlyph(r.kind), reactionWho(r), act(r.kind));
      chip.setAttribute('aria-pressed', String(Boolean(r.mine)));
      chip.append(String(r.count));
      if (popped === r.kind) chip.classList.add('pop');
      bar.append(chip);
    }

    if (!react) return;
    const add = button('cr-btn cr-add', reactionGlyph('add'), 'Add a reaction', () => {
      if (!canReact()) {
        signIn?.();
        return;
      }
      setOpen(!open);
      draw();
      if (open) bar.querySelector('.cr-pick')?.focus();
    });
    add.setAttribute('aria-expanded', String(open));
    bar.append(add);
    if (!open) return;
    const picker = document.createElement('span');
    picker.className = 'cr-picker';
    for (const { kind, label } of REACTIONS) {
      if (kind === 'like') continue;
      const pick = button(`cr-pick${of(kind)?.mine ? ' mine' : ''}`, reactionGlyph(kind), label, () => click(kind));
      pick.setAttribute('aria-pressed', String(Boolean(of(kind)?.mine)));
      picker.append(pick);
    }
    picker.addEventListener('keydown', e => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      setOpen(false);
      draw();
      bar.querySelector('.cr-add')?.focus();
    });
    bar.append(picker);
  }

  // While the picker is open, a press anywhere else shuts it.
  function outside(e) {
    if (bar.contains(e.target)) return;
    setOpen(false);
    draw();
  }
  function setOpen(on) {
    open = on;
    if (on) document.addEventListener('pointerdown', outside, true);
    else document.removeEventListener('pointerdown', outside, true);
  }

  draw();
  return bar;
}
