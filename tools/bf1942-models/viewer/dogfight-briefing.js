// The dogfight school's briefing (features/dogfight-school, "The briefing"):
// what is about to happen, shown while the Range loads, in place of the
// battle's own loading screen. The game's screen has room for a map, a bar
// and a line; a pilot dropped into the school needs to know where they are
// going, who is there, what to do first and which keys do what.
//
// It goes up over everything as map.html starts on a way into the school
// (`schoolEntry`, play/boot-loader/school-entry.js), takes over from the boot
// loader's scene with the same dogfight scene, mirrors the load's bar
// (`overlay.watch`, progress.js), and once the range is ready waits for the
// pilot: the lesson, the course or the school starts when they close it
// (`up`, which the range's frame waits on before seating anyone).

import { createLoader } from './play/loaders/kit.js';
import dogfight from './play/loaders/dogfight.js';
import { lessonById } from './dogfight-lessons.js';
import { MOVE_INFO, stepsOf } from './dogfight-steps.js';
import { VIEWER_ROOT } from './viewer-root.js';

const LOGO = new URL('bfstats-logo.webp', VIEWER_ROOT).href;
/** The longest the briefing waits after take-off for the lesson to take the
 *  screen, before it goes regardless. */
const HANDOVER_MAX_MS = 8000;
const STYLE_ID = 'dfb-style';

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
/** A map's id as its name: coral_sea is Coral Sea. */
export const mapTitle = id => String(id ?? 'the range').replace(/[_-]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
/** A ring course's id as its name, before its module is loaded. */
const courseTitle = id => String(id ?? '').replace(/[_-]+/g, ' ').replace(/^\w/, c => c.toUpperCase());

/** The keys, flying first, then the school's own. */
const FLY_KEYS = [
  ['Mouse', 'Roll and pitch (or the arrow keys)'],
  ['W', 'Throttle up'],
  ['S', 'Throttle back: a brake after 3 s'],
  ['Space', 'Fire'],
  ['A D', 'Rudder'],
];
const SCHOOL_KEYS = {
  school: [['V', 'The school: open or close it'], ['Space', 'Pause the replay'], ['N', 'Notes: the move, the counter, the numbers']],
  lesson: [['P', 'Pause'], ['G', 'The guide and its lines'], ['I', 'The instructor flies; touch a control to take over'], ['Y', 'Again'], ['O', 'End the lesson'], ['V', 'The school']],
  course: [['Y', 'Again'], ['N', 'The next course'], ['G', 'The guide'], ['I', 'The instructor'], ['O', 'End the course']],
};

/**
 * What the briefing says for `entry`: `{ kicker, title, lede, next, aside }`.
 * `next` is the numbered list of what happens; `aside` the second column
 * (`{ head, items }`, each item `{ name, text }` or a step's `{ n, text }`).
 * Pure, for the tests.
 */
export function briefingFor(entry) {
  const where = mapTitle(entry.map);
  const range = `The Range loads over ${where}: an empty floor, your plane, and one enemy pilot, the ace. Nobody else.`;
  const lesson = entry.lesson ? lessonById(entry.lesson) : null;
  // `move` is the demo's id: the Dip, Flip or Ninja, or one of several
  // tries of a kind (Breaking the circle's `zoom`, `chop`...).
  const moveDemo = entry.kind === 'move' ? lesson?.demos.find(d => d.id === entry.move) : null;
  if (entry.kind === 'move' && lesson && MOVE_INFO[moveDemo?.kind]) {
    const info = MOVE_INFO[moveDemo.kind];
    const demo = moveDemo;
    const card = stepsOf(lesson.id, entry.move);
    const v = demo?.verdict;
    return {
      kicker: `Practise a move · ${lesson.title}`,
      title: `${info.name} (${demo.tab ?? info.nick})`,
      lede: info.what,
      next: [
        range,
        `You start in the air, set up as the ${info.name.toLowerCase()} starts in the lesson, against the ace it was measured against.`,
        'Follow the green rings: they are the move, flown for you a few seconds ahead. Press I and the instructor flies it; touch any control to take it back.',
        `When you have done it, the screen says so, scored as the nine test flights were${v ? ` (it worked in ${v.works} of ${v.of ?? 9})` : ''}.`,
      ],
      aside: { head: 'The steps', items: (card?.steps ?? []).map((s, i) => ({ n: i + 1, text: s.say })), why: card?.why ?? null },
      keys: SCHOOL_KEYS.lesson,
      go: `Practise the ${info.name.toLowerCase()}`,
    };
  }
  if ((entry.kind === 'lesson' || entry.kind === 'move') && lesson) {
    return {
      kicker: 'Fly a lesson',
      title: lesson.title,
      lede: lesson.tagline,
      next: [
        range,
        'You start in the air in your plane, set up as the lesson\'s fight starts, against its ace.',
        'The coach at the top says what the ace is doing and what beats it; the guide at the bottom left shows which way to move the stick.',
        'Shot down or crashed, you are back in the air at once. Y flies it again; V opens the school to watch it first.',
      ],
      aside: { head: 'The counter', items: (lesson.counterStory ?? []).slice(0, 2).map(text => ({ text })) },
      keys: SCHOOL_KEYS.lesson,
      go: 'Take off',
    };
  }
  if (entry.kind === 'course') {
    return {
      kicker: 'Ring course',
      title: courseTitle(entry.course),
      lede: 'Flying on its own, no enemy: a line of rings to fly through, one skill at a time.',
      next: [
        range.replace(', and one enemy pilot, the ace. Nobody else.', ', and the rings.'),
        'You start in the air, lined up on the first ring.',
        'Fly through every ring. The guide shows which way to move the stick; press I and the instructor flies it for you.',
        'Y flies the course again; N moves on to the next.',
      ],
      aside: null,
      keys: SCHOOL_KEYS.course,
      go: 'Take off',
    };
  }
  return {
    kicker: 'The dogfight school',
    title: 'Moves, and how to beat them',
    lede: 'Every lesson is a move the best pilots use, flown on BF1942\'s own flight law, and the ways out of it. Watch it first, then fly it against the ace.',
    next: [
      range,
      'The school opens first. Pick a lesson on the left and watch its fight replayed, the ace\'s move and then your ways out of it, each scored over nine test flights.',
      'Press Fly it yourself, or Practise on a move\'s tab, and you are in the air in your plane against the ace. The coach says what they are doing and what beats it.',
      'Rings are flying drills on their own. Fights are dogfights real players flew, found in the round recordings.',
    ],
    aside: {
      head: 'The three ways out',
      items: Object.values(MOVE_INFO).map(m => ({ name: `${m.name}`, nick: m.nick, text: m.what })),
    },
    keys: SCHOOL_KEYS.school,
    go: 'Into the school',
  };
}

const CSS = `
.dfb { position: fixed; inset: 0; z-index: 2100; overflow: auto; color: var(--mm-ink, #fff);
  background: radial-gradient(ellipse at 70% 0%, #1d1d16, var(--mm-bg, #131313) 55%), var(--mm-bg, #131313);
  font: 14px/1.5 var(--mm-font-display, system-ui, sans-serif); transition: opacity .35s ease; }
.dfb.is-out { opacity: 0; pointer-events: none; }
.dfb-inner { box-sizing: border-box; max-width: 1180px; min-height: 100%; margin: 0 auto; padding: 22px 28px 0;
  display: grid; grid-template-rows: auto 1fr auto; gap: 18px; }
.dfb-head { display: flex; align-items: center; gap: 12px; padding-bottom: 14px; border-bottom: 1px solid var(--mm-rule, #2d2d2d); }
.dfb-head img { width: 28px; height: 28px; }
.dfb-head a { color: var(--mm-ink-muted, #8a8a8a); text-decoration: none; font: 500 10.5px/1 var(--mm-font-mono, monospace); letter-spacing: .14em; text-transform: uppercase; }
.dfb-head b { font-weight: 600; letter-spacing: .02em; }
.dfb-head span { margin-left: auto; font: 500 10.5px/1 var(--mm-font-mono, monospace); letter-spacing: .14em; text-transform: uppercase; color: var(--mm-accent-soft, #9aa666); }
.dfb-body { display: grid; gap: 22px; align-content: start; }
.dfb-hero { display: grid; grid-template-columns: minmax(0, 1.05fr) minmax(0, 1fr); gap: 28px; align-items: center; }
.dfb-kicker { display: block; margin-bottom: 8px; font: 500 10.5px/1.4 var(--mm-font-mono, monospace); letter-spacing: .14em; text-transform: uppercase; color: var(--mm-accent-soft, #9aa666); }
.dfb-hero h1 { margin: 0 0 10px; padding: 0; font: 600 clamp(26px, 3.4vw, 40px)/1.08 var(--mm-font-display, sans-serif); letter-spacing: -.01em;
  text-transform: none; color: var(--mm-ink, #fff); text-shadow: none; }
.dfb-lede { margin: 0; max-width: 52ch; color: var(--mm-ink-soft, #c8c8c8); font-size: 15.5px; }
.dfb-scene { min-height: 190px; display: grid; place-items: center; border: 1px solid var(--mm-rule, #2d2d2d); border-radius: 4px;
  background: radial-gradient(ellipse at 50% 40%, #1a1a14, var(--mm-stage, #0c0c0c) 75%); overflow: hidden; padding: 12px 0 4px; }
.dfb-scene .sl-words, .dfb-scene .sl-sub { display: none; }
.dfb-grid { display: grid; grid-template-columns: 1.3fr 1fr 0.9fr; gap: 14px; }
.dfb-card { padding: 14px 16px 16px; border: 1px solid var(--mm-rule, #2d2d2d); border-radius: 4px; background: var(--mm-bg-soft, #1a1a1a); }
.dfb-card h2 { display: flex; align-items: center; gap: 8px; margin: 0 0 10px; font: 500 10.5px/1.4 var(--mm-font-mono, monospace); letter-spacing: .14em; text-transform: uppercase; color: var(--mm-ink-muted, #8a8a8a); }
.dfb-card h2::before { content: ''; width: 3px; height: 11px; border-radius: 1px; background: var(--mm-accent, #7d8849); }
.dfb-next { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; counter-reset: dfb; }
.dfb-next li { position: relative; padding-left: 30px; color: var(--mm-ink-soft, #c8c8c8); font-size: 13.5px; counter-increment: dfb; }
.dfb-next li::before { content: counter(dfb); position: absolute; left: 0; top: 0; width: 20px; height: 20px; display: grid; place-items: center;
  border: 1px solid var(--mm-rule-strong, #3d3d3d); border-radius: 50%; color: var(--mm-ink, #fff); font: 600 10.5px/1 var(--mm-font-mono, monospace); }
.dfb-aside { display: grid; gap: 10px; margin: 0; padding: 0; list-style: none; }
.dfb-aside li { font-size: 13px; color: var(--mm-ink-soft, #c8c8c8); }
.dfb-aside b { display: block; color: var(--mm-ink, #fff); font-weight: 600; font-size: 13.5px; }
.dfb-aside b em { margin-left: 6px; font-style: italic; font-weight: 400; color: var(--mm-ink-muted, #8a8a8a); }
.dfb-aside .is-step { display: grid; grid-template-columns: 20px 1fr; gap: 10px; align-items: start; }
.dfb-aside .is-step i { width: 20px; height: 20px; display: grid; place-items: center; border-radius: 50%; font: 600 10.5px/1 var(--mm-font-mono, monospace); font-style: normal;
  border: 1px solid var(--mm-success, #7da34c); color: var(--mm-success, #7da34c); }
.dfb-why { margin: 10px 0 0; padding-top: 10px; border-top: 1px solid var(--mm-rule, #2d2d2d); color: var(--mm-ink-muted, #8a8a8a); font-size: 12.5px; }
.dfb-keys { display: grid; grid-template-columns: max-content 1fr; gap: 6px 10px; margin: 0; font-size: 12.5px; }
.dfb-keys dt { text-align: right; }
.dfb-keys dd { margin: 0; color: var(--mm-ink-soft, #c8c8c8); }
.dfb-keys kbd { display: inline-block; min-width: 18px; padding: 1px 6px; border: 1px solid var(--mm-rule-strong, #3d3d3d); border-bottom-width: 2px; border-radius: 3px;
  font: 500 11px/1.5 var(--mm-font-mono, monospace); color: var(--mm-ink, #fff); text-align: center; background: var(--mm-bg, #131313); }
.dfb-keys .dfb-split { grid-column: 1 / -1; height: 1px; margin: 4px 0; background: var(--mm-rule, #2d2d2d); }
.dfb-foot { position: sticky; bottom: 0; display: flex; align-items: center; gap: 16px; padding: 14px 0 18px;
  background: linear-gradient(180deg, transparent, var(--mm-bg, #131313) 30%); }
.dfb-track { position: relative; flex: 1; height: 4px; border-radius: 2px; background: var(--mm-bg-mute, #222); overflow: hidden; }
.dfb-track i { position: absolute; inset: 0 auto 0 0; width: 0; background: var(--mm-accent, #7d8849); transition: width .3s ease; }
.dfb.is-ready .dfb-track i { background: var(--mm-success, #7da34c); }
.dfb-status { min-width: 190px; font: 500 11px/1.3 var(--mm-font-mono, monospace); letter-spacing: .08em; text-transform: uppercase; color: var(--mm-ink-muted, #8a8a8a); }
.dfb-go { display: inline-flex; align-items: center; gap: 10px; padding: 11px 16px; border: 0; border-radius: 2px; cursor: pointer;
  background: var(--mm-highlight, #847d4c); color: var(--mm-highlight-ink, #000); font: 600 14px/1 var(--mm-font-display, sans-serif); white-space: nowrap; }
.dfb-go kbd { padding: 2px 5px; border-radius: 2px; background: rgba(0, 0, 0, .18); font: 500 10.5px/1 var(--mm-font-mono, monospace); }
.dfb-go:disabled { cursor: default; background: var(--mm-bg-mute, #222); color: var(--mm-ink-faint, #555); }
.dfb-go:not(:disabled):hover { filter: brightness(1.12); }
.dfb.is-ready .dfb-go { animation: dfb-ready 1.8s ease-out 2; }
@keyframes dfb-ready { 0% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--mm-highlight, #847d4c) 70%, transparent); } 100% { box-shadow: 0 0 0 12px transparent; } }
@media (prefers-reduced-motion: reduce) { .dfb.is-ready .dfb-go { animation: none; } }
/* A touch screen has no Enter key to name. */
@media (pointer: coarse) { .dfb-go kbd { display: none; } }
@media (max-width: 980px) {
  .dfb-grid { grid-template-columns: 1fr 1fr; }
  .dfb-grid > :first-child { grid-column: 1 / -1; }
}
@media (max-width: 680px) {
  .dfb-inner { padding: 14px 16px 0; gap: 14px; }
  .dfb-hero { grid-template-columns: minmax(0, 1fr); gap: 14px; }
  .dfb-grid { grid-template-columns: minmax(0, 1fr); }
  .dfb-head span { display: none; }
  .dfb-foot { flex-wrap: wrap; gap: 10px; }
  .dfb-track { flex: 1 1 100%; order: -1; }
  .dfb-go { margin-left: auto; }
}
`;

/**
 * Put the briefing up for `entry`. `overlay` is the page's load overlay
 * (progress.js), whose bar and state it mirrors. Returns `{ up, close }`:
 * `up` is true until the pilot takes off (or the load fails), and the range
 * seats nobody until then. `handedOver()` says the lesson, course or school
 * has the screen: the briefing stays up after take-off until it does (or
 * `HANDOVER_MAX_MS`), so the firing line and the parked plane never show
 * between the two.
 */
export function createSchoolBriefing({ entry, overlay, handedOver = () => true }) {
  const say = briefingFor(entry);
  if (!document.getElementById(STYLE_ID)) {
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = CSS;
    document.head.append(style);
  }
  const root = document.createElement('div');
  root.className = 'dfb';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-label', `Dogfight school: ${say.title}`);
  const aside = say.aside
    ? `<section class="dfb-card"><h2>${esc(say.aside.head)}</h2><ul class="dfb-aside">${say.aside.items.map(it => (it.n
      ? `<li class="is-step"><i>${it.n}</i><span>${esc(it.text)}</span></li>`
      : `<li>${it.name ? `<b>${esc(it.name)}${it.nick ? `<em>${esc(it.nick)}</em>` : ''}</b>` : ''}${esc(it.text)}</li>`)).join('')}</ul>`
      + (say.aside.why ? `<p class="dfb-why">Where it goes wrong: ${esc(say.aside.why)}</p>` : '') + '</section>'
    : '';
  const keys = [...FLY_KEYS, null, ...say.keys].map(k => (k
    ? `<dt><kbd>${esc(k[0])}</kbd></dt><dd>${esc(k[1])}</dd>` : '<i class="dfb-split"></i>')).join('');
  root.innerHTML = `
    <div class="dfb-inner">
      <header class="dfb-head"><img src="${LOGO}" alt="" width="28" height="28"><a href="https://bfstats.io" target="_blank" rel="noopener">bfstats.io</a>
        <b>Dogfight school</b><span>The Range · ${esc(mapTitle(entry.map))}</span></header>
      <div class="dfb-body">
        <div class="dfb-hero">
          <div><small class="dfb-kicker">${esc(say.kicker)}</small><h1>${esc(say.title)}</h1><p class="dfb-lede">${esc(say.lede)}</p></div>
          <div class="dfb-scene"></div>
        </div>
        <div class="dfb-grid">
          <section class="dfb-card"><h2>What happens next</h2><ol class="dfb-next">${say.next.map(t => `<li>${esc(t)}</li>`).join('')}</ol></section>
          ${aside}
          <section class="dfb-card"><h2>The keys</h2><dl class="dfb-keys">${keys}</dl></section>
        </div>
      </div>
      <footer class="dfb-foot">
        <span class="dfb-status">Loading ${esc(mapTitle(entry.map))}</span>
        <span class="dfb-track"><i></i></span>
        <button type="button" class="dfb-go" disabled>Loading</button>
      </footer>
    </div>`;
  document.body.append(root);
  const status = root.querySelector('.dfb-status');
  const fill = root.querySelector('.dfb-track i');
  const go = root.querySelector('.dfb-go');

  // The boot loader's scene goes, and the same scene plays on here.
  let loader = null;
  try {
    loader = createLoader({ scenes: [dogfight], pick: 'dogfight', words: 'Loading' });
    root.querySelector('.dfb-scene').append(loader.element);
    loader.start('dogfight');
  } catch (error) {
    console.warn('briefing: scene', error);
  }
  try { globalThis.__bootLoader?.end(); } catch (_) { /* a nicety */ }

  // A course's name and line, once its module is in.
  if (entry.kind === 'course') {
    import('./dogfight-rings.js').then(({ COURSES }) => {
      const c = COURSES.find(x => x.id === entry.course);
      if (!c) return;
      root.querySelector('h1').textContent = c.title;
      root.querySelector('.dfb-lede').textContent = `${c.tagline} ${c.tip}`;
    }).catch(() => {});
  }

  const handle = { up: true, close };
  let seenBusy = false, ready = false, stopWatch = null;

  function onKey(e) {
    if (!handle.up) return;
    if (ready && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); e.stopPropagation(); close(); return; }
    // While it is up the keys are the briefing's: nothing reaches the range.
    if (e.key !== 'Escape') e.stopPropagation();
  }
  globalThis.addEventListener('keydown', onKey, true);
  go.addEventListener('click', () => { if (ready) close(); });

  function setReady() {
    if (ready) return;
    ready = true;
    root.classList.add('is-ready');
    fill.style.width = '100%';
    status.textContent = 'Ready';
    go.disabled = false;
    go.innerHTML = `${esc(say.go)} <kbd>Enter</kbd>`;
    go.focus({ preventScroll: true });
  }

  function close() {
    if (!handle.up) return;
    handle.up = false;
    stopWatch?.();
    globalThis.removeEventListener('keydown', onKey, true);
    // The battle's own briefing screen, if the range parked on it, goes too:
    // the school's has said what there is to say.
    try { if (overlay?.briefingCaptures?.()) overlay.acceptBriefing(); } catch (_) { /* the page's concern */ }
    go.disabled = true;
    go.textContent = say.go === 'Into the school' ? 'Opening the school' : 'Taking off';
    status.textContent = '';
    // Up until the lesson has the screen (its own cover is dark until the
    // plane is in the air), then fade.
    const since = Date.now();
    const out = () => {
      root.classList.add('is-out');
      setTimeout(() => { loader?.stop(); root.remove(); }, 380);
    };
    const wait = () => {
      let over = false;
      try { over = !!handedOver(); } catch (_) { over = true; }
      if (over || Date.now() - since > HANDOVER_MAX_MS) out();
      else setTimeout(wait, 60);
    };
    wait();
  }

  stopWatch = overlay?.watch?.(({ fraction, state, hidden }) => {
    if (state === 'busy') seenBusy = true;
    if (state === 'error') {
      // The load failed: get out of the way of the overlay's own words.
      status.textContent = 'The load failed';
      close();
      return;
    }
    if (!ready) {
      fill.style.width = `${Math.round(Math.min(1, fraction) * 100)}%`;
      if (seenBusy) status.textContent = `Loading ${mapTitle(entry.map)} · ${Math.min(99, Math.floor(fraction * 100))}%`;
    }
    if (seenBusy && (state === 'briefing' || state === 'done' || hidden)) setReady();
  }) ?? null;

  return handle;
}
