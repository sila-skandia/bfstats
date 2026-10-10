// The REPLAY tab's feed (features/replay-feed): the rounds players have
// shared, newest or most watched first, each one's page with its comments,
// and sharing one. It is the page's DOM, laid over the menu's own frame by
// `replay-screen.js`, which paints the game's background and tab strip round
// it: the game has no such screen, and what people write here is free text
// that the menu's bitmap faces could not draw. The look is the replay
// chrome's (replay-ui.js, replay-open.js): dark plates, a khaki heading
// strip, olive-edged buttons.
//
// A card's cover plays the recording; its title opens its page. A time in a
// comment (`0:21 get rekt`) is a link into the replay at that moment, as a
// time in a YouTube comment is. Watching is `map.html`, where the same
// comments run alongside the round (replay-social.js).
//
// Several players' recordings of one round are found by the API and grouped
// (features/replay-feed, "Rounds"): the feed pages a round as one card, a deck
// whose cover plays them merged, played as one round from every recording
// player's view, with the round's recordings listed under it, each to watch
// alone. Each recording keeps its own page, uploader, title, cover and
// comments.
//
// Whoever shared a recording, and an admin, can rename or delete it: from its
// card's menu, or on its page. What the API says a viewer may do is for whoever
// the cards and the page were read as, so they are read again once the page's
// own sign-in lands, or after a sign-in or out.

import {
  ago, clock, commentRuns, count, createRecordingsApi, feedCount, playerHref, readableQuery, resolveApi, shortHref, size,
  watchHref, watchRoundHref,
} from '../recordings-api.js';
import { describeRecording, isRecording, levelTrees, sortRecordingFiles } from '../recording-inspect.js';
import { recordedAt, titled } from '../replay-open.js';
import { loadMods, servable, VANILLA } from '../mods.js';
import { artCandidates, firstLoadable } from '../level-art.js';
import { loadHudPaths } from '../hud-pack.js';

const PAGE_SIZE = 24;
const COMMENT_PAGE = 20;

const ICONS = {
  play: '<path d="M5 3.2v9.6L13 8z" fill="currentColor"/>',
  upload: '<path d="M8 10.6V2.8M4.7 6 8 2.7 11.3 6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M2.6 9.8v3.6h10.8V9.8" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>',
  file: '<path d="M4 1.8h5.2L12.4 5v9.2H4z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M9 2v3.3h3.2" fill="none" stroke="currentColor" stroke-width="1.5"/>',
  back: '<path d="M9.8 3.2 5 8l4.8 4.8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>',
  close: '<path d="M3.5 3.5l9 9M12.5 3.5l-9 9" fill="none" stroke="currentColor" stroke-width="1.6"/>',
  link: '<path d="M6.6 9.4 9.4 6.6M7.2 4.6l1.2-1.2a2.6 2.6 0 0 1 3.7 3.7l-1.2 1.2M8.8 11.4l-1.2 1.2a2.6 2.6 0 0 1-3.7-3.7l1.2-1.2" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>',
  pencil: '<path d="M10.6 2.6l2.8 2.8-7.6 7.6H3v-2.8z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>',
  trash: '<path d="M3 4.5h10M6.3 4.5V3h3.4v1.5M4.4 4.5l.7 8.7h5.8l.7-8.7" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>',
  eye: '<path d="M1.5 8S4 3.8 8 3.8 14.5 8 14.5 8 12 12.2 8 12.2 1.5 8 1.5 8z" fill="none" stroke="currentColor" stroke-width="1.4"/><circle cx="8" cy="8" r="2" fill="currentColor"/>',
  chat: '<path d="M2.5 3.2h11v7.2H7.2L4.3 13v-2.6H2.5z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>',
  user: '<circle cx="8" cy="5.4" r="2.6" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M3 13.6c.6-2.6 2.6-3.8 5-3.8s4.4 1.2 5 3.8" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>',
  external: '<path d="M9.2 2.8h4v4M13.2 2.8 7.6 8.4M11.4 9.4v3.8H2.8V4.6h3.8" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>',
  server: '<rect x="2.5" y="2.6" width="11" height="4.4" rx="1" fill="none" stroke="currentColor" stroke-width="1.4"/><rect x="2.5" y="9" width="11" height="4.4" rx="1" fill="none" stroke="currentColor" stroke-width="1.4"/><circle cx="5.1" cy="4.8" r=".95" fill="currentColor"/><circle cx="5.1" cy="11.2" r=".95" fill="currentColor"/>',
  chevron: '<path d="M3.5 6 8 10.5 12.5 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
  round: '<rect x="1.8" y="5.2" width="9" height="7" rx="1.2" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M4.6 3.2h8.4a1 1 0 0 1 1 1v6.3" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><path d="M5.2 7.3v2.9l2.6-1.45z" fill="currentColor"/>',
  unlink: '<path d="M6.6 9.4 9.4 6.6M7.2 4.6l1.2-1.2a2.6 2.6 0 0 1 3.7 3.7l-1.2 1.2M8.8 11.4l-1.2 1.2a2.6 2.6 0 0 1-3.7-3.7l1.2-1.2M2.5 2.5l11 11" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>',
  more: '<circle cx="8" cy="3.2" r="1.45" fill="currentColor"/><circle cx="8" cy="8" r="1.45" fill="currentColor"/><circle cx="8" cy="12.8" r="1.45" fill="currentColor"/>',
};
const icon = name => `<svg viewBox="0 0 16 16" aria-hidden="true">${ICONS[name] ?? ''}</svg>`;

const STYLE = `
.rf-root { position: fixed; z-index: 20; display: flex; min-width: 0; min-height: 0;
  --rf-plate: rgba(26, 26, 22, .93); --rf-plate-deep: rgba(14, 14, 12, .72); --rf-card: rgba(38, 38, 33, .92);
  --rf-edge: rgba(200, 194, 152, .30); --rf-edge-strong: #b9b38a; --rf-khaki: #a39c6c; --rf-khaki-ink: #15150e;
  --rf-ink: #eeecd9; --rf-muted: #a9a690; --rf-faint: #7d7a66; --rf-gold: #e8c35a; --rf-alert: #f2c25a;
  font: 13px/1.4 'Trebuchet MS', 'Geist Variable', 'Segoe UI', system-ui, sans-serif; color: var(--rf-ink); }
.rf-root[hidden], .rf-root [hidden] { display: none !important; }
.rf-root *, .rf-root *::before, .rf-root *::after { box-sizing: border-box; }
.rf-root { scrollbar-width: thin; scrollbar-color: rgba(200, 194, 152, .38) transparent; }
.rf-root ::-webkit-scrollbar { width: 8px; height: 8px; }
.rf-root ::-webkit-scrollbar-thumb { background: rgba(200, 194, 152, .38); border-radius: 4px; }
.rf-root ::-webkit-scrollbar-track { background: transparent; }
.rf-root svg { width: 15px; height: 15px; flex: none; }
.rf-panel { position: relative; display: flex; flex-direction: column; flex: 1 1 auto; min-width: 0; min-height: 0;
  background: var(--rf-plate); border: 1px solid var(--rf-edge); border-radius: 8px; overflow: hidden;
  box-shadow: 0 18px 48px rgba(0, 0, 0, .55); }
.rf-head { display: flex; align-items: center; gap: 10px; min-height: 32px; padding: 0 6px 0 14px; flex: none;
  background: var(--rf-khaki); color: var(--rf-khaki-ink); font: 800 12px/1 'Trebuchet MS', 'Segoe UI', sans-serif;
  letter-spacing: .16em; text-transform: uppercase; }
.rf-head h1 { margin: 0; font: inherit; }
.rf-head .rf-count { font-weight: 700; letter-spacing: .08em; opacity: .7; }
.rf-spacer { flex: 1 1 auto; }
.rf-account { display: flex; align-items: center; gap: 6px; min-width: 0; font: 700 11px/1 'Trebuchet MS', 'Segoe UI', sans-serif;
  letter-spacing: .06em; text-transform: none; }
.rf-account .rf-who { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 16ch; }
.rf-head .rf-btn { color: var(--rf-khaki-ink); border-color: rgba(21, 21, 14, .35); background: rgba(255, 255, 255, .12); height: 24px; }
.rf-head .rf-btn:hover { background: rgba(255, 255, 255, .26); border-color: rgba(21, 21, 14, .6); }
.rf-bar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 10px; padding: 10px 14px; flex: none;
  border-bottom: 1px solid var(--rf-edge); background: var(--rf-plate-deep); }
.rf-seg { display: inline-flex; border: 1px solid var(--rf-edge); border-radius: 6px; overflow: hidden; }
.rf-seg button { appearance: none; height: 28px; padding: 0 12px; margin: 0; border: 0; background: transparent; color: var(--rf-muted);
  font: 700 11px/1 'Trebuchet MS', 'Segoe UI', sans-serif; letter-spacing: .1em; text-transform: uppercase; cursor: pointer; }
.rf-seg button + button { border-left: 1px solid var(--rf-edge); }
.rf-seg button:hover { color: var(--rf-ink); background: rgba(255, 255, 255, .06); }
.rf-seg button[aria-pressed="true"] { background: var(--rf-khaki); color: var(--rf-khaki-ink); }
.rf-btn { appearance: none; display: inline-flex; align-items: center; justify-content: center; gap: 7px; height: 30px; padding: 0 12px;
  margin: 0; border: 1px solid rgba(200, 194, 152, .45); border-radius: 5px; background: rgba(0, 0, 0, .25); color: var(--rf-ink);
  font: 700 11px/1 'Trebuchet MS', 'Segoe UI', sans-serif; letter-spacing: .08em; text-transform: uppercase; cursor: pointer;
  white-space: nowrap; text-decoration: none; }
.rf-btn:hover { background: rgba(255, 255, 255, .08); border-color: var(--rf-edge-strong); }
.rf-btn.primary { background: var(--rf-khaki); border-color: var(--rf-khaki); color: var(--rf-khaki-ink); }
.rf-btn.primary:hover { background: #b9b38a; border-color: #b9b38a; }
.rf-btn.quiet { border-color: transparent; background: transparent; color: var(--rf-muted); }
.rf-btn.quiet:hover { color: var(--rf-ink); border-color: var(--rf-edge); }
.rf-btn.danger:hover { border-color: #d9824a; color: #f0b58a; }
.rf-btn.destroy { background: #c46f3e; border-color: #c46f3e; color: #1c1008; }
.rf-btn.destroy:hover { background: #d9824a; border-color: #d9824a; }
.rf-btn:disabled { opacity: .45; cursor: default; }
.rf-btn:focus-visible, .rf-seg button:focus-visible, .rf-card a:focus-visible, .rf-time:focus-visible, .rf-player:focus-visible,
.rf-input:focus-visible, .rf-select:focus-visible { outline: 1px solid var(--rf-gold); outline-offset: 1px; }
.rf-storage { color: var(--rf-faint); font-size: 11px; white-space: nowrap; }
/* The filters: quiet until touched, lit while they narrow the feed. What a
   filter says is drawn; the native select lies over it unseen, so the pill is
   as wide as its words in every browser and a phone opens its own picker. */
.rf-filters { display: inline-flex; flex-wrap: wrap; align-items: center; gap: 4px 6px; min-width: 0; max-width: 100%; }
.rf-filter { display: inline-flex; align-items: stretch; min-width: 0; max-width: 100%; height: 28px;
  border: 1px solid transparent; border-radius: 6px; color: var(--rf-muted);
  transition: border-color .15s ease, background-color .15s ease, color .15s ease; }
.rf-filter:hover, .rf-filter:focus-within { border-color: var(--rf-edge); color: var(--rf-ink); }
.rf-filter:has(select:focus-visible) { outline: 1px solid var(--rf-gold); outline-offset: 1px; }
.rf-filter-face { position: relative; display: inline-flex; align-items: center; gap: 6px; min-width: 0; padding: 0 8px;
  font: 12px/1 'Trebuchet MS', 'Segoe UI', sans-serif; }
.rf-root .rf-filter-face svg { width: 13px; height: 13px; opacity: .8; }
.rf-root .rf-filter-face svg:last-of-type { width: 10px; height: 10px; }
.rf-filter-text { min-width: 0; max-width: 280px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rf-filter select { position: absolute; inset: 0; width: 100%; height: 100%; margin: 0; padding: 0; border: 0; opacity: 0;
  appearance: none; -webkit-appearance: none; font: 13px 'Trebuchet MS', 'Segoe UI', sans-serif; cursor: pointer; }
.rf-filter select option { background: #1c1c18; color: var(--rf-ink); }
/* Below 16px a phone zooms the page to the select it focuses. */
@media (pointer: coarse) { .rf-filter select { font-size: 16px; } }
.rf-filter.on { border-color: rgba(163, 156, 108, .55); background: rgba(163, 156, 108, .14); color: var(--rf-ink); }
.rf-root .rf-filter.on .rf-filter-face svg:first-of-type { color: var(--rf-khaki); opacity: 1; }
.rf-filter-clear { appearance: none; display: grid; place-items: center; align-self: stretch; width: 24px; margin: 0; padding: 0;
  border: 0; border-left: 1px solid rgba(163, 156, 108, .3); border-radius: 0 5px 5px 0; background: transparent;
  color: var(--rf-muted); cursor: pointer; }
.rf-filter-clear:hover { color: var(--rf-ink); background: rgba(255, 255, 255, .08); }
.rf-filter-clear:focus-visible { outline: 1px solid var(--rf-gold); outline-offset: -1px; }
.rf-root .rf-filter-clear svg { width: 10px; height: 10px; }
/* A server or uploader named in a card or on a page narrows the feed to it. */
.rf-pick { color: inherit; text-decoration: none; }
.rf-pick:hover { color: var(--rf-ink); text-decoration: underline; text-decoration-color: var(--rf-khaki); text-underline-offset: 3px; }
.rf-pick:focus-visible { outline: 1px solid var(--rf-gold); outline-offset: 1px; }
.rf-body { position: relative; flex: 1 1 auto; min-height: 0; overflow: auto; overscroll-behavior: contain; padding: 14px; }
.rf-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(236px, 1fr)); gap: 16px 14px; }
.rf-card { display: flex; flex-direction: column; min-width: 0; }
.rf-cover { position: relative; display: block; aspect-ratio: 16 / 9; border-radius: 6px; overflow: hidden;
  background: #0d0d0b center / cover no-repeat; border: 1px solid var(--rf-edge); isolation: isolate; }
.rf-cover::after { content: ''; position: absolute; inset: 0; z-index: 0;
  background: linear-gradient(to top, rgba(0, 0, 0, .7), rgba(0, 0, 0, 0) 55%); pointer-events: none; }
.rf-cover img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
.rf-cover-title { position: absolute; left: 10px; right: 10px; bottom: 9px; z-index: 1; font: 800 15px/1.05 'Trebuchet MS', 'Segoe UI', sans-serif;
  letter-spacing: .08em; text-transform: uppercase; color: #f4f1dc; text-shadow: 0 2px 6px rgba(0, 0, 0, .8); }
.rf-cover.shot .rf-cover-title { display: none; }
.rf-mod, .rf-len { position: absolute; z-index: 1; padding: 3px 6px; border-radius: 4px; font: 700 10px/1 'Trebuchet MS', 'Segoe UI', sans-serif;
  letter-spacing: .08em; background: rgba(0, 0, 0, .72); color: #f4f1dc; }
.rf-mod { top: 7px; left: 7px; text-transform: uppercase; color: var(--rf-khaki); }
.rf-len { right: 7px; bottom: 7px; font-family: ui-monospace, monospace; letter-spacing: 0; font-size: 11px; }
.rf-cover:not(.shot) .rf-len { bottom: auto; top: 7px; }
.rf-play { position: absolute; left: 50%; top: 50%; z-index: 1; display: grid; place-items: center; width: 46px; height: 46px;
  margin: -23px 0 0 -23px; border-radius: 50%; background: rgba(163, 156, 108, .92); color: var(--rf-khaki-ink);
  opacity: 0; transform: scale(.85); transition: opacity .15s ease, transform .15s ease; }
.rf-play svg { width: 20px; height: 20px; margin-left: 3px; }
.rf-cover:hover .rf-play, .rf-cover:focus-visible .rf-play { opacity: 1; transform: none; }
.rf-cover:hover { border-color: var(--rf-edge-strong); }
.rf-info { padding: 8px 2px 0; min-width: 0; }
.rf-name { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; color: var(--rf-ink);
  font: 700 14px/1.3 'Trebuchet MS', 'Segoe UI', sans-serif; text-decoration: none; overflow-wrap: anywhere; }
.rf-name:hover { color: #fff; text-decoration: underline; text-decoration-color: var(--rf-khaki); text-underline-offset: 3px; }
.rf-line { margin-top: 3px; color: var(--rf-muted); font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rf-line b { color: var(--rf-ink); font-weight: 700; }
.rf-player { display: inline-flex; margin-left: 4px; vertical-align: -1px; color: var(--rf-faint); }
.rf-player:hover { color: var(--rf-khaki); }
.rf-root .rf-player svg { width: 11px; height: 11px; }
.rf-dot::before { content: '\\00b7'; margin: 0 5px; color: var(--rf-faint); }
/* A round several players recorded is one card: its cover the top of a deck,
   the other recordings the plates behind it peeking over its top edge (one
   for two, two for more), which lift a little under the pointer. The cover
   plays them merged. */
.rf-deck { position: relative; display: block; isolation: isolate; }
.rf-deck::before, .rf-deck::after { content: ''; position: absolute; inset: 0 8px; z-index: -1; border-radius: 6px 6px 4px 4px;
  pointer-events: none; border: 1px solid rgba(200, 194, 152, .6); background: linear-gradient(180deg, #57574a, #2a2a23 40%);
  box-shadow: 0 -2px 10px rgba(0, 0, 0, .35); transform: translateY(-7px);
  transition: transform .22s cubic-bezier(.2, .8, .2, 1), border-color .2s ease; }
.rf-deck::after { z-index: -2; display: none; inset: 0 16px; border-color: rgba(200, 194, 152, .36);
  background: linear-gradient(180deg, #414136, #1d1d18 40%); transform: translateY(-13px); }
.rf-deck.more::after { display: block; }
.rf-deck:hover::before, .rf-deck:focus-within::before { transform: translateY(-9px); border-color: rgba(185, 179, 138, .85); }
.rf-deck:hover::after, .rf-deck:focus-within::after { transform: translateY(-16px); }
/* Room above the first row for a deck's plates. */
.rf-grid { padding-top: 4px; }
.rf-stack { position: absolute; left: 7px; bottom: 7px; z-index: 1; display: inline-flex; align-items: center; gap: 5px; padding: 3px 7px 3px 6px;
  border-radius: 4px; background: rgba(0, 0, 0, .74); color: var(--rf-gold); font: 700 10px/1 'Trebuchet MS', 'Segoe UI', sans-serif;
  letter-spacing: .1em; text-transform: uppercase; box-shadow: 0 0 0 1px rgba(232, 195, 90, .38); }
.rf-cover:not(.shot) .rf-stack { bottom: auto; top: 30px; left: 7px; }
.rf-root .rf-stack svg { width: 12px; height: 12px; }
.rf-stack b { font: 700 11px/1 ui-monospace, monospace; letter-spacing: 0; }
/* The round's recordings on its card: each by whom, its length, and a way to
   watch it alone. */
.rf-takes { list-style: none; margin: 7px 0 0; padding: 0; border-top: 1px solid rgba(200, 194, 152, .13); }
.rf-take { display: flex; align-items: center; gap: 6px; min-height: 28px; padding: 2px 0; border-bottom: 1px solid rgba(200, 194, 152, .07);
  color: var(--rf-muted); font-size: 12px; }
.rf-take-name { flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--rf-ink);
  font-weight: 700; text-decoration: none; }
.rf-take-name:hover { text-decoration: underline; text-decoration-color: var(--rf-khaki); text-underline-offset: 3px; }
.rf-take-meta { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rf-take-len { flex: none; color: var(--rf-faint); font: 11px/1 ui-monospace, monospace; }
.rf-take-watch { flex: none; display: inline-flex; align-items: center; gap: 4px; height: 22px; padding: 0 7px 0 5px; border: 1px solid rgba(200, 194, 152, .3);
  border-radius: 4px; color: var(--rf-ink); font: 700 10px/1 'Trebuchet MS', 'Segoe UI', sans-serif; letter-spacing: .08em;
  text-transform: uppercase; text-decoration: none; white-space: nowrap; }
.rf-root .rf-take-watch svg { width: 11px; height: 11px; }
.rf-take-watch:hover { border-color: var(--rf-edge-strong); background: rgba(255, 255, 255, .06); }
.rf-take-watch:focus-visible, .rf-take-name:focus-visible { outline: 1px solid var(--rf-gold); outline-offset: 1px; }
.rf-take-more { min-height: 24px; padding-top: 4px; color: var(--rf-faint); font-size: 11.5px; }
.rf-take-more a { color: inherit; }
/* A card whose recording this viewer may change (the uploader's own, any
   for an admin): a menu beside its title, Rename and Delete. A round's lists
   each of its recordings the viewer may change, by whose it is. */
.rf-info { position: relative; }
.rf-card.managed .rf-name { padding-right: 32px; }
.rf-manage { position: absolute; top: 4px; right: 0; }
.rf-manage-btn { appearance: none; display: grid; place-items: center; width: 28px; height: 28px; margin: 0; padding: 0;
  border: 1px solid transparent; border-radius: 5px; background: transparent; color: var(--rf-muted); cursor: pointer;
  transition: color .15s ease, border-color .15s ease, background-color .15s ease; }
.rf-manage-btn:hover, .rf-manage.open .rf-manage-btn { color: var(--rf-ink); border-color: var(--rf-edge); background: rgba(255, 255, 255, .07); }
.rf-manage-btn:focus-visible { outline: 1px solid var(--rf-gold); outline-offset: 1px; }
.rf-manage-menu { position: absolute; z-index: 4; top: calc(100% + 4px); right: 0; display: none; flex-direction: column; gap: 1px;
  width: max-content; min-width: 180px; max-width: min(280px, calc(100vw - 40px)); padding: 4px; background: rgba(28, 28, 24, .98);
  border: 1px solid var(--rf-edge); border-radius: 6px; box-shadow: 0 10px 28px rgba(0, 0, 0, .55); }
.rf-manage.open .rf-manage-menu { display: flex; }
.rf-card.menu-open { position: relative; z-index: 3; }
.rf-manage-head { padding: 6px 9px 3px; color: var(--rf-muted); font: 11.5px/1.3 'Trebuchet MS', 'Segoe UI', sans-serif;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rf-manage-head:not(:first-child) { margin-top: 3px; border-top: 1px solid rgba(200, 194, 152, .14); padding-top: 8px; }
.rf-mi { appearance: none; display: flex; align-items: center; gap: 9px; width: 100%; height: 32px; padding: 0 9px; margin: 0;
  border: 0; border-radius: 4px; background: none; color: var(--rf-ink); font: 700 11px/1 'Trebuchet MS', 'Segoe UI', sans-serif;
  letter-spacing: .08em; text-transform: uppercase; text-align: left; white-space: nowrap; cursor: pointer; }
.rf-mi:hover { background: rgba(255, 255, 255, .08); }
.rf-mi:focus-visible { outline: 1px solid var(--rf-gold); outline-offset: -1px; }
.rf-mi.danger { color: #f0b58a; }
.rf-mi.danger:hover { background: rgba(217, 130, 74, .14); }
@media (pointer: coarse) {
  .rf-mi { height: 40px; }
  .rf-manage { top: 0; }
  .rf-manage-btn { width: 36px; height: 36px; }
  .rf-card.managed .rf-name { padding-right: 40px; }
}
/* For an admin: a round held together only by an admin's link its
   recordings do not bear out. */
.rf-root .rf-weak { display: inline-flex; align-items: center; gap: 4px; padding: 2px 6px; border-radius: 3px; vertical-align: 1px;
  border: 1px solid rgba(242, 194, 90, .5); color: var(--rf-alert); background: rgba(242, 194, 90, .08);
  font: 700 9.5px/1.2 'Trebuchet MS', 'Segoe UI', sans-serif; letter-spacing: .1em; text-transform: uppercase; white-space: nowrap; }
.rf-root .rf-weak::before { content: ''; width: 6px; height: 6px; border-radius: 50%; background: currentColor; box-shadow: 0 0 6px currentColor;
  animation: rf-pulse 2.4s ease-in-out infinite; }
@keyframes rf-pulse { 50% { opacity: .35; } }
.rf-evidence { flex: 1 1 100%; display: grid; gap: 8px; padding: 10px 12px; border-radius: 6px; border: 1px solid rgba(242, 194, 90, .45);
  background: rgba(242, 194, 90, .07); }
.rf-evidence p { margin: 0; color: var(--rf-ink); }
.rf-evidence small { color: var(--rf-muted); font-size: 11.5px; }
.rf-evidence .rf-dialog-actions { justify-content: flex-start; }
.rf-more { display: flex; justify-content: center; padding: 18px 0 4px; }
.rf-note { padding: 34px 12px; text-align: center; color: var(--rf-muted); }
.rf-note p { margin: 0 auto 14px; max-width: 46ch; text-wrap: balance; }
.rf-note .rf-strong { color: var(--rf-ink); font: 700 15px/1.3 'Trebuchet MS', 'Segoe UI', sans-serif; }
.rf-error { color: var(--rf-alert); }
.rf-skeleton .rf-cover { background: linear-gradient(90deg, rgba(255,255,255,.03), rgba(255,255,255,.08), rgba(255,255,255,.03)) 0 0 / 200% 100%;
  animation: rf-shimmer 1.2s linear infinite; }
.rf-skeleton .rf-name, .rf-skeleton .rf-line { height: 12px; margin-top: 8px; border-radius: 3px; background: rgba(255, 255, 255, .06); }
.rf-skeleton .rf-line { width: 60%; }
@keyframes rf-shimmer { to { background-position: -200% 0; } }

/* One recording's page. */
.rf-detail { max-width: 1060px; margin: 0 auto; }
.rf-back { margin: -4px 0 12px -6px; }
.rf-hero { display: grid; grid-template-columns: minmax(0, 1.35fr) minmax(0, 1fr); gap: 18px; align-items: start; }
.rf-hero .rf-cover { border-radius: 8px; }
.rf-hero .rf-cover-title { font-size: 22px; left: 14px; bottom: 12px; }
.rf-hero .rf-play { width: 64px; height: 64px; margin: -32px 0 0 -32px; opacity: .92; transform: none; }
.rf-hero .rf-play svg { width: 26px; height: 26px; }
.rf-title { display: flex; align-items: flex-start; gap: 8px; margin: 0; font: 800 20px/1.25 'Trebuchet MS', 'Segoe UI', sans-serif;
  overflow-wrap: anywhere; }
.rf-title span { flex: 1 1 auto; min-width: 0; }
.rf-by { margin-top: 6px; color: var(--rf-muted); }
.rf-facts { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 5px 14px; margin: 14px 0 0; font-size: 12.5px; }
.rf-facts dt { color: var(--rf-faint); font: 700 10.5px/1.6 'Trebuchet MS', 'Segoe UI', sans-serif; letter-spacing: .12em; text-transform: uppercase; }
.rf-facts dd { margin: 0; min-width: 0; overflow-wrap: anywhere; }
.rf-players { color: var(--rf-muted); }
.rf-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 16px; }
.rf-rename { display: flex; gap: 6px; flex: 1 1 auto; }
.rf-input, .rf-select, .rf-text { width: 100%; min-width: 0; margin: 0; padding: 7px 10px; border: 1px solid rgba(200, 194, 152, .42);
  border-radius: 5px; background: rgba(0, 0, 0, .3); color: var(--rf-ink); font: 13px/1.35 'Trebuchet MS', 'Segoe UI', sans-serif; }
.rf-input:hover, .rf-select:hover, .rf-text:hover { border-color: var(--rf-edge-strong); }
.rf-select { width: auto; max-width: 100%; padding-right: 26px; appearance: none; -webkit-appearance: none; cursor: pointer;
  background: rgba(0, 0, 0, .3) no-repeat right 9px center / 10px 10px
    url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 10 10'%3E%3Cpath d='M1.5 3.5 5 7l3.5-3.5' fill='none' stroke='%23b9b38a' stroke-width='1.6' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E"); }
.rf-select option { background: #1c1c18; color: var(--rf-ink); }
.rf-text { min-height: 64px; resize: vertical; }
.rf-round { margin-top: 22px; border: 1px solid rgba(232, 195, 90, .28); border-radius: 8px; padding: 12px 14px;
  background: linear-gradient(180deg, rgba(232, 195, 90, .06), rgba(232, 195, 90, 0) 70%); }
.rf-round-head { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 12px; margin-bottom: 8px; }
.rf-round-head h2 { margin: 0; font: 800 13px/1 'Trebuchet MS', 'Segoe UI', sans-serif; letter-spacing: .14em; text-transform: uppercase;
  color: var(--rf-gold); }
.rf-round-head span { color: var(--rf-muted); font-size: 12px; }
.rf-round-list { list-style: none; margin: 0; padding: 0; }
.rf-round-item { display: grid; grid-template-columns: 52px minmax(0, 1fr); gap: 2px 10px; padding: 7px 0; align-items: baseline;
  border-top: 1px solid rgba(200, 194, 152, .12); }
.rf-round-item:first-child { border-top: 0; }
.rf-round-at { color: var(--rf-faint); font: 700 11.5px/1.4 ui-monospace, monospace; text-align: right; }
.rf-round-item.self .rf-round-at { color: var(--rf-gold); }
.rf-round-item .rf-name { -webkit-line-clamp: 1; font-size: 13px; }
.rf-round-item.self .rf-name { color: var(--rf-gold); text-decoration: none; cursor: default; }
.rf-round-item .rf-line { white-space: normal; }
.rf-round-admin { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-top: 10px; padding-top: 10px;
  border-top: 1px dashed rgba(200, 194, 152, .22); }
.rf-round-admin form { display: flex; flex: 1 1 280px; gap: 6px; min-width: 0; }
.rf-round-admin > div { flex: 1 1 100%; }
.rf-round-admin > div:empty { display: none; }
.rf-round-head .rf-weak { align-self: center; }
.rf-round-admin .rf-hint { color: var(--rf-faint); font-size: 11.5px; flex: 1 1 100%; }
.rf-several { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
.rf-several li { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 2px 10px; align-items: center; padding: 8px 10px;
  border: 1px solid rgba(200, 194, 152, .18); border-radius: 6px; }
.rf-several .rf-status, .rf-several .rf-field { grid-column: 1 / -1; }
.rf-several .rf-field { margin-top: 4px; }
.rf-several .rf-status:empty { display: none; }
.rf-len-inline { color: var(--rf-muted); font: 12px/1 ui-monospace, monospace; }
.rf-comments { margin-top: 26px; border-top: 1px solid var(--rf-edge); padding-top: 14px; }
.rf-comments-head { display: flex; flex-wrap: wrap; align-items: center; gap: 10px 14px; margin-bottom: 12px; }
.rf-comments-head h2 { margin: 0; font: 800 13px/1 'Trebuchet MS', 'Segoe UI', sans-serif; letter-spacing: .14em; text-transform: uppercase; }
.rf-compose { display: grid; gap: 8px; margin-bottom: 16px; }
.rf-compose-row { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.rf-compose-row .rf-hint { flex: 1 1 200px; color: var(--rf-faint); font-size: 11.5px; }
.rf-signin { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; padding: 12px; margin-bottom: 16px;
  border: 1px dashed var(--rf-edge); border-radius: 6px; color: var(--rf-muted); }
.rf-list { list-style: none; margin: 0; padding: 0; }
.rf-comment { display: grid; grid-template-columns: 30px minmax(0, 1fr) auto; gap: 2px 10px; padding: 10px 0;
  border-bottom: 1px solid rgba(200, 194, 152, .12); }
.rf-avatar { grid-row: span 2; display: grid; place-items: center; width: 30px; height: 30px; border-radius: 50%;
  background: rgba(163, 156, 108, .22); color: var(--rf-khaki); font: 800 12px/1 'Trebuchet MS', 'Segoe UI', sans-serif; text-transform: uppercase; }
.rf-comment-who { color: var(--rf-muted); font-size: 12px; }
.rf-comment-who b { color: var(--rf-ink); margin-right: 6px; }
.rf-comment-text { grid-column: 2; margin: 2px 0 0; white-space: pre-wrap; overflow-wrap: anywhere; -webkit-user-select: text; user-select: text; }
.rf-comment .rf-btn { grid-row: 1; grid-column: 3; height: 24px; padding: 0 6px; }
.rf-time { color: #9fc3ff; font-weight: 700; text-decoration: none; font-variant-numeric: tabular-nums; }
.rf-time:hover { text-decoration: underline; }
.rf-status { min-height: 16px; color: var(--rf-muted); font-size: 12px; }
.rf-status.error { color: var(--rf-alert); }

/* Sharing a recording. */
.rf-shade { position: absolute; inset: 0; z-index: 5; display: grid; place-items: center; padding: 14px; background: rgba(6, 6, 5, .62);
  -webkit-backdrop-filter: blur(3px); backdrop-filter: blur(3px); }
.rf-shade[hidden] { display: none; }
.rf-dialog { width: min(520px, 100%); max-height: 100%; overflow: auto; background: rgba(28, 28, 24, .98); border: 1px solid var(--rf-edge);
  border-radius: 8px; box-shadow: 0 18px 48px rgba(0, 0, 0, .6); }
.rf-dialog .rf-head { position: sticky; top: 0; z-index: 1; }
.rf-dialog-body { display: grid; gap: 12px; padding: 16px; }
.rf-dialog-form { display: grid; gap: 12px; }
.rf-drop { display: grid; justify-items: center; gap: 8px; padding: 20px 16px; border: 1.5px dashed rgba(200, 194, 152, .4); border-radius: 6px;
  text-align: center; color: var(--rf-muted); transition: border-color .15s ease, background-color .15s ease; }
.rf-drop svg { width: 28px; height: 28px; color: #b9b38a; }
.rf-drop.over { border-color: var(--rf-gold); background: rgba(232, 195, 90, .07); }
.rf-drop b { color: var(--rf-ink); font-size: 14px; }
.rf-drop.compact { grid-template-columns: minmax(0, 1fr) auto; justify-items: start; align-items: center; padding: 8px 8px 8px 12px; text-align: left; }
.rf-drop.compact svg, .rf-drop.compact .rf-drop-hint { display: none; }
.rf-drop.compact b { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 100%; font-size: 12.5px; }
.rf-chosen { display: grid; grid-template-columns: 132px minmax(0, 1fr); gap: 12px; align-items: center; }
.rf-chosen .rf-cover-title { font-size: 11px; }
.rf-field { display: grid; gap: 5px; }
.rf-field > span { color: var(--rf-faint); font: 700 10.5px/1 'Trebuchet MS', 'Segoe UI', sans-serif; letter-spacing: .12em; text-transform: uppercase; }
.rf-check { display: flex; align-items: center; gap: 8px; color: var(--rf-muted); cursor: pointer; }
.rf-check input { margin: 0; accent-color: var(--rf-khaki); }
.rf-progress { height: 4px; border-radius: 2px; background: rgba(255, 255, 255, .1); overflow: hidden; }
.rf-progress i { display: block; height: 100%; width: 0; background: var(--rf-khaki); transition: width .2s ease; }
.rf-dialog-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px; }
/* Renaming or deleting a recording: which one it is, under the question. */
.rf-which { margin: 0; color: var(--rf-muted); font-size: 12px; overflow-wrap: anywhere; }
.rf-ask { margin: 0; font: 700 15px/1.35 'Trebuchet MS', 'Segoe UI', sans-serif; overflow-wrap: anywhere; }
.rf-dialog-actions .rf-status { flex: 1 1 auto; align-self: center; min-height: 0; }

@container rf (max-width: 620px) {
  .rf-hero { grid-template-columns: minmax(0, 1fr); }
  .rf-grid { grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); }
}
.rf-panel { container: rf / inline-size; }
@media (max-width: 560px) {
  .rf-head { flex-wrap: wrap; padding: 6px 6px 6px 12px; row-gap: 6px; }
  .rf-bar { padding: 8px 10px; }
  /* Both filters on one row: a server's long name gives way first. */
  .rf-filters { flex: 1 1 100%; flex-wrap: nowrap; }
  .rf-filter { flex-shrink: 0; }
  .rf-filter-server.on { flex-shrink: 1; }
  .rf-filter-uploader .rf-filter-text { max-width: 110px; }
  .rf-body { padding: 10px; }
  .rf-grid { grid-template-columns: minmax(0, 1fr); }
  .rf-chosen { grid-template-columns: 96px minmax(0, 1fr); }
}
@media (prefers-reduced-motion: reduce) {
  .rf-play, .rf-drop, .rf-progress i, .rf-filter, .rf-deck::before, .rf-deck::after, .rf-manage-btn { transition: none; }
  .rf-skeleton .rf-cover, .rf-root .rf-weak::before { animation: none; }
}
`;

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(className, label, onClick, iconName = null) {
  const b = el('button', `rf-btn ${className}`.trim());
  b.type = 'button';
  b.innerHTML = `${iconName ? icon(iconName) : ''}<span></span>`;
  b.querySelector('span').textContent = label;
  b.addEventListener('click', e => { e.preventDefault(); onClick(e); });
  return b;
}

// The replay page's addresses (recordings-api.js, which the replay's own
// switch between a round's recordings shares).
export { watchHref, watchRoundHref };

/** A recording's round, when it has other recordings in the feed: `round` of
 *  two or more, else null. */
export const roundOf = recording => (Array.isArray(recording?.round) && recording.round.length > 1 ? recording.round : null);

/** A feed card that is a round of several recordings (the API grouped them):
 *  `{ members, whole }`, the round's recordings in round order and what the
 *  card shows of it (`roundCard`); null for a recording on its own. */
export const roundCardOf = recording => (recording?.roundCard && roundOf(recording)
  ? { members: roundOf(recording), whole: recording.roundCard } : null);

/** The recordings on a card this viewer may rename or delete, as the API says
 *  of each (`canManage`: its uploader, or an admin): a round's, in round order,
 *  else the card's own. */
export function managedOf(recording) {
  const round = roundCardOf(recording);
  if (round) return round.members.filter(member => member.canManage);
  return recording?.canManage ? [recording] : [];
}

/** The title a share offers until another is written: the level and the
 *  server, as the API titles one that comes without (`Bocage on MoonGamers`).
 *  None while the level is not known: the API titles it by the one chosen. */
export function defaultTitle(level, server) {
  return level ? [level, server && `on ${server}`].filter(Boolean).join(' ') : '';
}

/** What the feed is narrowed to in an address (`?server=`, `?uploader=`):
 *  `{ server, uploader }`, '' for all. */
export function feedFilterOf(params) {
  return { server: (params.get('server') ?? '').trim(), uploader: (params.get('uploader') ?? '').trim() };
}

/** The feed's address, narrowed to `filter`. */
export function feedHref(filter = {}) {
  return `?${readableQuery([['tab', 'replay'], ['server', filter.server], ['uploader', filter.uploader]])}`;
}

const sameFilter = (a, b) => a.server === b.server && a.uploader === b.uploader;

// --- the levels' art -----------------------------------------------------------

/**
 * A mod's levels as the feed shows them: `level -> { title, art, arts }`, the
 * menu's own title (`BATTLE OF MIDWAY`) and the loading screen's picture.
 * `art` is the best guess (the level's own picture, vanilla's for a level the
 * mod inherits, then the theatre default); `arts` is the whole chain, for
 * `firstLoadable`: a tree can name a picture it does not hold (a re-bake
 * replaced the level's directory), and a card must never be a black square
 * for it (`level-art.js`).
 */
export function createLevelArt(root, modList) {
  const catalogs = new Map();
  const base = new URL(root, location.href);

  /** A mod's tree: where its maps are, its parsed `maps.json`, its titles. */
  function catalog(modId) {
    if (!catalogs.has(modId)) {
      catalogs.set(modId, (async () => {
        const mods = servable(await modList(), 'maps');
        const mod = mods.find(m => m.id === modId);
        const levels = new Map();
        const tree = { base: new URL(`${(mod ?? VANILLA).paths.maps}/`, base).href, rows: null, levels };
        if (!mod) return tree;
        const [maps, menu] = await Promise.all([
          fetch(new URL(`${mod.paths.maps}/maps.json`, base)).then(r => (r.ok ? r.json() : [])).catch(() => []),
          loadHudPaths(mod.id, { root })
            .then(hud => fetch(hud.menuUrl('menu-levels.json')).then(r => (r.ok ? r.json() : null)))
            .catch(() => null),
        ]);
        tree.rows = Array.isArray(maps) ? maps : [];
        for (const entry of tree.rows) {
          levels.set(String(entry.name).toLowerCase(), {
            title: entry.loading?.title ? titled(entry.loading.title) : '',
          });
        }
        for (const level of menu?.levels ?? []) {
          for (const key of [level.dir, level.level].filter(Boolean).map(k => String(k).toLowerCase())) {
            const known = levels.get(key);
            if (known && level.title) known.title = titled(level.title);
          }
        }
        return tree;
      })().catch(() => ({ base: new URL(`${VANILLA.paths.maps}/`, base).href, rows: null, levels: new Map() })));
    }
    return catalogs.get(modId);
  }

  return async function artFor(modId, level) {
    const key = String(level || '').toLowerCase();
    const id = modId || VANILLA.id;
    const own = await catalog(id);
    const vanilla = id === VANILLA.id ? own : await catalog(VANILLA.id);
    const trees = vanilla === own ? [own] : [own, vanilla];
    const arts = artCandidates(level, trees, (treeBase, rel) => new URL(rel, treeBase).href);
    return {
      title: own.levels.get(key)?.title || vanilla.levels.get(key)?.title || titled(level || 'Unknown level'),
      art: arts[0],
      arts,
    };
  };
}

/** Paint a level's picture on `node` once the first of its chain loads. */
function paintArt(node, arts) {
  firstLoadable(arts).then(url => {
    if (url) node.style.backgroundImage = `url("${url}")`;
  });
}

// --- the feed --------------------------------------------------------------------

/**
 * @param {object} options
 * @param {string} [options.root]  the viewer root from the mounting page
 * @param {() => void} [options.onWatchFile]  Open recording's file picker: watch
 *                                one from disk without sharing it
 * @param {() => string} [options.playerName]  the front end's player name, the
 *                                name to post as when the account has linked it
 */
export function createReplayFeed({ root = '../', onWatchFile = null, playerName = () => '' } = {}) {
  if (!document.getElementById('rf-style')) {
    const style = el('style');
    style.id = 'rf-style';
    style.textContent = STYLE;
    document.head.append(style);
  }
  // The mod registry, read once: loadMods asks the server afresh every call.
  let mods = null;
  const modList = () => (mods ??= loadMods());
  const artFor = createLevelArt(root, modList);

  const state = {
    api: null,          // recordings-api.js client, once the API is found
    sort: 'recent',
    filter: { server: '', uploader: '' },
    choices: null,      // `{ servers, uploaders }` the feed can be narrowed to
    items: [],
    total: 0,           // cards: a round of several recordings is one
    recordings: 0,      // the recordings on them
    page: 0,
    pages: 1,
    storage: null,
    loading: false,
    error: null,
    detail: null,       // the recording whose page is up
    comments: [],
    commentTotal: 0,
    commentPage: 0,
    commentPages: 1,
    commentSort: 'newest',
    viewer: null,       // `{ userId, names, isAdmin }` while signed in
    listAs: null,       // who the cards were read as (`readAs`), null for a mix
    detailAs: null,     // who the recording's page was read as
  };

  const rootEl = el('div', 'rf-root');
  rootEl.hidden = true;
  const panel = el('section', 'rf-panel');
  panel.setAttribute('aria-label', 'Shared recordings');
  const head = el('div', 'rf-head');
  const heading = el('h1', '', 'Recordings');
  const countEl = el('span', 'rf-count');
  const account = el('div', 'rf-account');
  head.append(heading, countEl, el('span', 'rf-spacer'), account);
  const bar = el('div', 'rf-bar');
  const sortSeg = el('div', 'rf-seg');
  sortSeg.setAttribute('role', 'group');
  sortSeg.setAttribute('aria-label', 'Order');
  const sorts = [['recent', 'Newest'], ['views', 'Most viewed']].map(([id, label]) => {
    const b = el('button', '', label);
    b.type = 'button';
    b.dataset.sort = id;
    b.addEventListener('click', () => setSort(id));
    sortSeg.append(b);
    return b;
  });
  const filtersEl = el('div', 'rf-filters');
  filtersEl.setAttribute('role', 'group');
  filtersEl.setAttribute('aria-label', 'Filters');
  filtersEl.hidden = true;
  const serverPick = filterPick('server', 'server', 'All servers', 'Server');
  const uploaderPick = filterPick('uploader', 'user', 'All uploaders', 'Shared by');
  filtersEl.append(serverPick.root, uploaderPick.root);
  const storageEl = el('span', 'rf-storage');
  const watchFile = button('quiet', 'Watch a file', () => onWatchFile?.(), 'file');
  watchFile.title = 'Watch a bf42plus recording from this computer without sharing it';
  watchFile.hidden = !onWatchFile;
  const shareBtn = button('primary', 'Share a recording', () => openShare(), 'upload');
  bar.append(sortSeg, filtersEl, storageEl, el('span', 'rf-spacer'), watchFile, shareBtn);
  const body = el('div', 'rf-body');
  const shade = el('div', 'rf-shade');
  shade.hidden = true;
  panel.append(head, bar, body, shade);
  rootEl.append(panel);
  document.body.append(rootEl);

  // --- the API and who is signed in --------------------------------------------

  let started = null;
  /** The API client. Who is signed in is asked alongside, not first: the
   *  list does not wait on it. */
  function start() {
    started ??= (async () => {
      state.api = createRecordingsApi(await resolveApi());
      state.api.onChange(() => renderAccount());
      renderAccount();
      state.api.ready().then(() => loadViewer()).catch(error => {
        console.warn('recordings-feed: who is signed in', error);
      });
    })().catch(error => {
      console.warn('recordings-feed: the API was not reached', error);
    });
    return started;
  }

  async function loadViewer() {
    try {
      state.viewer = state.api?.signedIn ? await state.api.viewer({ fresh: true }) : null;
    } catch (error) {
      console.warn('recordings-feed: who is signed in', error);
      state.viewer = null;
    }
    renderAccount();
    if (state.detail) renderComments();
    // An admin's cards mark a round held by a weak link.
    else if (state.viewer?.isAdmin && state.items.some(i => i.roundCard?.weak)) renderList();
    syncViewer();
  }

  /** Who the page reads the feed as. What the API says a viewer may do (a
   *  card's or a page's `canManage`, a comment's `canDelete`, `canEditRound`)
   *  is for that viewer. */
  const readAs = () => (state.api?.signedIn ? 'in' : 'out');

  /** The cards and the page, read again when they were read as someone else:
   *  the page asks for them alongside its sign-in, not after it, so a visitor
   *  signed in on bfstats.io gets them first as nobody. */
  function syncViewer() {
    const now = readAs();
    if (state.detail) {
      if (state.detail.slug && !state.detail.loading && !state.detail.error && state.detailAs !== now) rereadDetail();
    } else if (state.items.length && state.listAs !== now) {
      rereadList();
    }
  }

  async function rereadDetail() {
    const { slug } = state.detail;
    state.detailAs = readAs();
    try {
      const detail = await state.api.get(slug);
      if (state.detail?.slug !== slug) return;
      state.detail = detail;
    } catch (error) {
      console.warn('recordings-feed: the recording, read again', error);
      return;
    }
    renderDetail();
    loadComments(true);
  }

  /** The pages of cards shown so far, read again: quietly, the cards staying
   *  up until theirs come. */
  async function rereadList() {
    const pages = Math.max(1, state.page);
    listAbort?.abort();
    const abort = listAbort = new AbortController();
    state.listAs = readAs();
    try {
      const read = await Promise.all(Array.from({ length: pages }, (_, i) => state.api.list({
        sort: state.sort, ...state.filter, page: i + 1, pageSize: PAGE_SIZE, signal: abort.signal,
      })));
      if (abort !== listAbort) return;
      const items = [];
      for (const item of read.flatMap(page => page.items)) if (!items.some(o => o.slug === item.slug)) items.push(item);
      const last = read.at(-1);
      Object.assign(state, {
        items, total: last.totalCount, recordings: last.recordingCount ?? last.totalCount,
        page: last.page, pages: last.totalPages, storage: last.storage,
      });
    } catch (error) {
      if (error.name !== 'AbortError' && abort === listAbort) console.warn('recordings-feed: the list, read again', error);
      return;
    } finally {
      if (abort === listAbort) state.loading = false;
    }
    renderList();
  }

  /** Signed out, nothing on the page is the viewer's to change: what it holds
   *  says so at once, with nothing to read again. */
  function forgetViewer() {
    const drop = recording => { if (recording) recording.canManage = false; };
    for (const item of state.items) {
      drop(item);
      item.round?.forEach(drop);
    }
    if (state.detail) {
      Object.assign(state.detail, { canManage: false, canEditRound: false });
      state.detail.round?.forEach(drop);
    }
    for (const comment of state.comments) comment.canDelete = false;
    state.listAs = state.detailAs = 'out';
  }

  function renderAccount() {
    account.replaceChildren();
    const api = state.api;
    if (!api) return;
    if (!api.canWrite) {
      const note = el('span', 'rf-who', 'Live feed, read-only here');
      note.title = 'This page reads the live feed from bfstats.io. Run the API here (dotnet run) to share and comment.';
      account.append(note);
      shareBtn.hidden = true;
      return;
    }
    shareBtn.hidden = false;
    if (api.signedIn) {
      const who = el('span', 'rf-who', state.viewer?.names?.[0] ?? 'Signed in');
      account.append(who, button('', 'Sign out', async () => {
        await api.signOut();
        state.viewer = null;
        forgetViewer();
        renderAccount();
        if (state.detail) renderDetail();
        else renderList();
      }));
    } else {
      account.append(button('', api.mode === 'local' ? 'Sign in (dev)' : 'Sign in', () => signIn(), 'user'));
    }
  }

  async function signIn() {
    try {
      if (await state.api.signIn()) await loadViewer();
    } catch (error) {
      flash(error.message, true);
    }
  }

  // --- the list ------------------------------------------------------------------

  function setSort(id) {
    if (state.sort === id && state.items.length) return;
    state.sort = id;
    loadList(true);
  }

  /** Narrows the feed to `next` (`{ server, uploader }`, '' for all), at an
   *  address of its own, from the bar or from a name in a card or on a page. */
  function applyFilter(next) {
    const filter = { server: next.server ?? '', uploader: next.uploader ?? '' };
    const changed = !sameFilter(filter, state.filter);
    if (!changed && !state.detail) return;
    state.filter = filter;
    history.pushState({ tab: 'replay' }, '', feedHref(filter));
    state.detail = null;
    commentsEl = null;
    body.scrollTop = 0;
    if (changed || !state.choices) loadChoices();
    if (changed || !state.items.length) loadList(true);
    else renderList();
  }

  let listAbort = null;
  async function loadList(reset = false) {
    if (!state.api) {
      state.loading = true;
      renderList();
    }
    await start();
    if (!state.api) {
      state.error = 'The recordings feed is not reachable right now.';
      renderList();
      return;
    }
    if (reset) {
      listAbort?.abort();
      state.items = [];
      state.page = 0;
      state.pages = 1;
    }
    if (state.page >= state.pages && !reset) return;
    // A later load (another order or filter) takes over from this one.
    const abort = listAbort = new AbortController();
    state.loading = true;
    state.error = null;
    renderList();
    const asked = readAs();
    try {
      const page = await state.api.list({
        sort: state.sort, ...state.filter, page: state.page + 1, pageSize: PAGE_SIZE, signal: abort.signal,
      });
      if (abort !== listAbort) return;
      state.listAs = reset || !state.items.length || state.listAs === asked ? asked : null;
      state.items = reset ? page.items : [...state.items, ...page.items.filter(i => !state.items.some(o => o.slug === i.slug))];
      state.total = page.totalCount;
      state.recordings = page.recordingCount ?? page.totalCount;
      state.page = page.page;
      state.pages = page.totalPages;
      state.storage = page.storage;
    } catch (error) {
      if (error.name === 'AbortError' || abort !== listAbort) return;
      console.warn('recordings-feed: the list', error);
      state.error = error.status === 404 || error.status === 0 || !error.status
        ? 'The recordings feed is not reachable right now.' : error.message;
    } finally {
      if (abort === listAbort) state.loading = false;
    }
    renderList();
    syncViewer();
  }

  // --- the filters ---------------------------------------------------------------

  /** The servers and uploaders there are to pick, each counted within the
   *  other filter. Filtering is a nicety: without them the feed is as it was. */
  let choicesAbort = null;
  async function loadChoices() {
    await start();
    if (!state.api) return;
    choicesAbort?.abort();
    const abort = choicesAbort = new AbortController();
    try {
      const choices = await state.api.filters({ ...state.filter, signal: abort.signal });
      if (abort !== choicesAbort) return;
      state.choices = choices;
    } catch (error) {
      if (error.name === 'AbortError' || abort !== choicesAbort) return;
      console.warn('recordings-feed: the filters', error);
      state.choices = null;
    }
    renderFilters();
  }

  function renderFilters() {
    const { servers = [], uploaders = [] } = state.choices ?? {};
    serverPick.set(servers, state.filter.server);
    uploaderPick.set(uploaders, state.filter.uploader);
    filtersEl.hidden = !state.filter.server && !state.filter.uploader && !servers.length && !uploaders.length;
  }

  /** One of the bar's filters: it says All until a name is picked, its list
   *  gives each name with how many recordings it shows, and it has a way back
   *  to all. */
  function filterPick(key, iconName, all, label) {
    const root = el('div', `rf-filter rf-filter-${key}`);
    const face = el('div', 'rf-filter-face');
    face.innerHTML = `${icon(iconName)}<span class="rf-filter-text" aria-hidden="true"></span>${icon('chevron')}`;
    const text = face.querySelector('.rf-filter-text');
    const select = el('select');
    select.setAttribute('aria-label', label);
    select.addEventListener('change', () => applyFilter({ ...state.filter, [key]: select.value }));
    face.append(select);
    const clear = el('button', 'rf-filter-clear');
    clear.type = 'button';
    clear.innerHTML = icon('close');
    clear.title = all;
    clear.setAttribute('aria-label', all);
    clear.addEventListener('click', () => applyFilter({ ...state.filter, [key]: '' }));
    root.append(face, clear);
    let shown = '';
    return {
      root,
      set(choices, value) {
        const known = choices.some(c => c.name === value);
        const options = [['', all], ...(value && !known ? [[value, value]] : []),
          ...choices.map(c => [c.name, `${c.name} (${c.count})`])];
        root.classList.toggle('on', Boolean(value));
        clear.hidden = !value;
        text.textContent = value || all;
        select.title = value ? `${label}: ${value}` : all;
        // Rebuilt only when it changes: a list replaced under an open select shuts it.
        const next = JSON.stringify([options, value]);
        if (next === shown) return;
        shown = next;
        select.replaceChildren(...options.map(([name, said]) => {
          const option = el('option', '', said);
          option.value = name;
          return option;
        }));
        select.value = value;
      },
    };
  }

  /** A server or uploader named in a card or on a page: a link to the feed
   *  narrowed to it, followed in place. */
  function pickLink(text, filter, title, { strong = false } = {}) {
    const a = el('a', 'rf-pick');
    a.append(strong ? el('b', '', text) : text);
    a.href = feedHref(filter);
    a.title = title;
    a.addEventListener('click', e => {
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return;
      e.preventDefault();
      applyFilter(filter);
    });
    return a;
  }

  const onServer = (recording, filter = state.filter) => pickLink(recording.serverName,
    { ...filter, server: recording.serverName }, `Recordings on ${recording.serverName}`);
  const sharedBy = (recording, filter = state.filter, options = {}) => pickLink(recording.uploaderName,
    { ...filter, uploader: recording.uploaderName }, `Recordings shared by ${recording.uploaderName}`, options);

  function renderList() {
    if (state.detail) return;
    for (const b of sorts) b.setAttribute('aria-pressed', String(b.dataset.sort === state.sort));
    bar.hidden = false;
    renderFilters();
    countEl.textContent = feedCount(state.total, state.recordings);
    storageEl.textContent = state.storage ? `${size(state.storage.usedBytes)} of ${size(state.storage.quotaBytes)} used` : '';
    body.replaceChildren();
    if (state.error && !state.items.length) {
      const note = el('div', 'rf-note');
      note.append(el('p', 'rf-error', state.error), button('', 'Try again', () => loadList(true)));
      body.append(note);
      return;
    }
    if (!state.items.length && state.loading) {
      const grid = el('div', 'rf-grid');
      for (let i = 0; i < 8; i++) grid.append(skeleton());
      body.append(grid);
      return;
    }
    if (!state.items.length && (state.filter.server || state.filter.uploader)) {
      const note = el('div', 'rf-note');
      note.append(el('p', 'rf-strong', 'No recordings match.'),
        button('', 'Show all recordings', () => applyFilter({ server: '', uploader: '' })));
      body.append(note);
      return;
    }
    if (!state.items.length) {
      const note = el('div', 'rf-note');
      note.append(el('p', 'rf-strong', 'No recordings shared yet.'),
        el('p', '', 'Record a round with bf42plus and share it: everyone can watch it in 3D.'));
      if (state.api?.canWrite) note.append(button('primary', 'Share a recording', () => openShare(), 'upload'));
      body.append(note);
      return;
    }
    const grid = el('div', 'rf-grid');
    for (const recording of state.items) grid.append(card(recording));
    body.append(grid);
    if (state.page < state.pages || state.loading) {
      const more = el('div', 'rf-more');
      const moreBtn = button('', state.loading ? 'Loading' : 'Show more', () => loadList(false));
      moreBtn.disabled = state.loading;
      more.append(moreBtn);
      body.append(more);
    }
  }

  function skeleton() {
    const node = el('div', 'rf-card rf-skeleton');
    node.append(el('div', 'rf-cover'), el('div', 'rf-name'), el('div', 'rf-line'));
    return node;
  }

  /** A recording's cover: its own frame if it has one, else the level's
   *  loading screen with the level's name on it. A round's (`round`, from
   *  `roundCardOf`) plays its recordings merged, with the round's cover and
   *  span, and says how many recordings it is. */
  function cover(recording, { big = false, round = null } = {}) {
    const a = el('a', 'rf-cover');
    const fileUrl = p => state.api.fileUrl(p);
    a.href = round ? watchRoundHref(recording, round.members, { root, fileUrl }) : watchHref(recording, { root, fileUrl });
    a.setAttribute('aria-label', round ? `Watch ${recording.title}, its ${round.members.length} recordings merged` : `Watch ${recording.title}`);
    a.addEventListener('click', e => {
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return;
      e.preventDefault();
      if (round) watchMerged(recording, round.members);
      else watch(recording);
    });
    const shot = round ? round.whole.thumbnailUrl : recording.thumbnailUrl;
    const title = el('span', 'rf-cover-title');
    const mod = el('span', 'rf-mod', recording.mod);
    const len = el('span', 'rf-len', clock(round ? round.whole.durationSeconds : recording.durationSeconds));
    const play = el('span', 'rf-play');
    play.innerHTML = icon('play');
    if (shot) {
      a.classList.add('shot');
      const img = el('img');
      img.alt = '';
      img.loading = 'lazy';
      img.decoding = 'async';
      img.src = state.api.fileUrl(shot);
      a.append(img);
    }
    a.append(title, mod, len, play);
    if (round) {
      const stack = el('span', 'rf-stack');
      stack.innerHTML = `${icon('round')}<b></b> recordings`;
      stack.querySelector('b').textContent = String(round.members.length);
      stack.title = `One round, ${round.members.length} recordings of it: plays them merged`;
      a.append(stack);
    }
    artFor(recording.mod, recording.level).then(level => {
      title.textContent = level.title;
      if (!shot) paintArt(a, level.arts);
    });
    modList().then(list => {
      const known = list.find(m => m.id === recording.mod);
      if (known?.short) mod.textContent = known.short;
    }).catch(() => {});
    if (big) a.classList.add('big');
    return a;
  }

  /** A link in place: followed here unless opened in a new tab. */
  function inPlace(a, go) {
    a.addEventListener('click', e => {
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return;
      e.preventDefault();
      go();
    });
    return a;
  }

  const pageHref = slug => `?tab=replay&rec=${encodeURIComponent(slug)}`;

  /**
   * A card: a recording on its own, or a round of several (the API grouped
   * them, `roundCard`), carried by its lead. A round's card is a deck; its
   * cover plays the round merged, its title opens the lead's page, where the
   * round is listed, and its recordings are listed under it, each to watch
   * alone or to open.
   */
  function card(recording) {
    const round = roundCardOf(recording);
    const node = el('article', `rf-card${round ? ' rf-round-card' : ''}`);
    const info = el('div', 'rf-info');
    const name = inPlace(el('a', 'rf-name', recording.title), () => openDetail(recording.slug, { push: true, summary: recording }));
    name.href = pageHref(recording.slug);
    const where = el('div', 'rf-line');
    artFor(recording.mod, recording.level).then(level => {
      const said = [level.title, titled(recording.gameMode)].filter(Boolean);
      where.replaceChildren(said.join(' · '));
      if (recording.serverName) where.append(said.length ? ' · ' : '', onServer(recording));
      where.title = where.textContent;
    });
    const stats = el('div', 'rf-line');
    const views = round ? round.whole.viewCount : recording.viewCount;
    const comments = round ? round.whole.commentCount : recording.commentCount;
    if (round) {
      // Everyone who shared one, each narrowing the feed to theirs.
      round.whole.uploaders.forEach((uploader, i) => {
        if (i) stats.append(', ');
        stats.append(sharedBy({ uploaderName: uploader }, state.filter, { strong: true }));
      });
      stats.title = `Shared by ${round.whole.uploaders.join(', ')}`;
    } else if (recording.uploaderName) {
      stats.append(sharedBy(recording, state.filter, { strong: true }), playerLink(recording));
    }
    for (const part of [count(views, 'view'), comments ? count(comments, 'comment') : null,
      ago(round ? round.whole.createdAt : recording.createdAt)].filter(Boolean)) {
      stats.append(el('span', 'rf-dot'), document.createTextNode(part));
    }
    info.append(name, where, stats);
    const managed = managedOf(recording);
    if (managed.length) {
      node.classList.add('managed');
      info.append(manageMenu(recording, managed, node));
    }
    if (round) {
      if (round.whole.weak && state.viewer?.isAdmin) info.append(weakMark());
      info.append(takes(recording, round));
    }
    let top = cover(recording, { round });
    if (round) {
      const deck = el('div', `rf-deck${round.members.length > 2 ? ' more' : ''}`);
      deck.append(top);
      top = deck;
    }
    node.append(top, info);
    return node;
  }

  /** A card's menu of what this viewer may do to the recordings on it: Rename
   *  and Delete, under whose each is when the card is a round. */
  function manageMenu(recording, managed, cardNode) {
    const wrap = el('div', 'rf-manage');
    const btn = el('button', 'rf-manage-btn');
    btn.type = 'button';
    btn.innerHTML = icon('more');
    btn.title = 'Rename or delete';
    btn.setAttribute('aria-label', `Rename or delete ${recording.title}`);
    btn.setAttribute('aria-haspopup', 'menu');
    btn.setAttribute('aria-expanded', 'false');
    const menu = el('div', 'rf-manage-menu');
    menu.setAttribute('role', 'menu');
    const round = roundCardOf(recording);
    for (const member of managed) {
      if (round) menu.append(el('div', 'rf-manage-head', `${whose(member)} · ${clock(member.durationSeconds)}`));
      menu.append(menuItem('pencil', 'Rename', () => openRename(member)),
        menuItem('trash', 'Delete', () => openDelete(member), 'danger'));
    }
    btn.addEventListener('click', e => {
      e.preventDefault();
      const open = !wrap.classList.contains('open');
      closeMenus();
      if (!open) return;
      wrap.classList.add('open');
      cardNode.classList.add('menu-open');
      btn.setAttribute('aria-expanded', 'true');
      menu.querySelector('.rf-mi')?.focus();
    });
    menu.addEventListener('keydown', e => {
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      e.preventDefault();
      const items = [...menu.querySelectorAll('.rf-mi')];
      const at = items.indexOf(document.activeElement);
      items[(at + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
    });
    wrap.append(btn, menu);
    return wrap;
  }

  function menuItem(iconName, label, onClick, className = '') {
    const b = el('button', `rf-mi ${className}`.trim());
    b.type = 'button';
    b.setAttribute('role', 'menuitem');
    b.innerHTML = `${icon(iconName)}<span></span>`;
    b.querySelector('span').textContent = label;
    b.addEventListener('click', e => {
      e.preventDefault();
      closeMenus();
      onClick();
    });
    return b;
  }

  /** Shuts any card's menu; `focus` puts the keyboard back on its button. */
  function closeMenus({ focus = false } = {}) {
    for (const open of body.querySelectorAll('.rf-manage.open')) {
      open.classList.remove('open');
      open.closest('.rf-card')?.classList.remove('menu-open');
      const btn = open.querySelector('.rf-manage-btn');
      btn?.setAttribute('aria-expanded', 'false');
      if (focus) btn?.focus();
    }
  }

  // A press anywhere else shuts a card's menu.
  document.addEventListener('pointerdown', e => {
    if (!e.target.closest?.('.rf-manage.open')) closeMenus();
  }, true);

  /** Whose a recording is: who shared it, else who recorded it. */
  const whose = recording => `${recording.uploaderName || recording.recordedBy || 'This'}'s recording`;

  /** The most of a round's recordings its card lists; its page lists all. */
  const TAKES = 3;

  /** A round's recordings on its card: who shared each, who recorded it
   *  where that is someone else, its length, and Alone, which plays it on
   *  its own. The name opens its page. */
  function takes(recording, round) {
    const list = el('ol', 'rf-takes');
    list.setAttribute('aria-label', 'The recordings of this round');
    const fileUrl = p => state.api.fileUrl(p);
    for (const member of round.members.slice(0, TAKES)) {
      const item = el('li', 'rf-take');
      const own = { ...member, mod: recording.mod, level: recording.level };
      const name = inPlace(el('a', 'rf-take-name', member.uploaderName || member.recordedBy || member.title),
        () => openDetail(member.slug, { push: true }));
      name.href = pageHref(member.slug);
      name.title = `${member.title}: its page`;
      const by = member.recordedBy && member.recordedBy !== member.uploaderName ? `recorded by ${member.recordedBy}` : '';
      const meta = el('span', 'rf-take-meta', by);
      const watchAlone = inPlace(el('a', 'rf-take-watch'), () => watch(own));
      watchAlone.innerHTML = `${icon('play')}<span>Alone</span>`;
      watchAlone.href = watchHref(own, { root, fileUrl });
      watchAlone.title = `Watch ${member.uploaderName ? `${member.uploaderName}'s recording` : 'this recording'} on its own`;
      item.append(name, meta, el('span', 'rf-take-len', clock(member.durationSeconds)), watchAlone);
      list.append(item);
    }
    if (round.members.length > TAKES) {
      const more = el('li', 'rf-take-more');
      const all = inPlace(el('a', '', `and ${round.members.length - TAKES} more`), () => openDetail(recording.slug, { push: true, summary: recording }));
      all.href = pageHref(recording.slug);
      more.append(all);
      list.append(more);
    }
    return list;
  }

  /** For an admin: the round holds together only through an admin's link its
   *  recordings do not bear out (features/replay-feed, "Rounds"). */
  function weakMark() {
    const mark = el('span', 'rf-weak', 'Weak link');
    mark.title = 'One round only by an admin\'s link: its recordings do not bear it out';
    const line = el('div', 'rf-line');
    line.append(mark);
    return line;
  }

  /** The uploader's player page on bfstats.io, beside their name (which
   *  narrows the feed to them): when the site has a player by the name
   *  (`uploaderPlayer`), in a new tab; else nothing. */
  function playerLink(recording) {
    if (!recording.uploaderPlayer) return '';
    const a = el('a', 'rf-player');
    a.innerHTML = icon('external');
    a.href = playerHref(recording.uploaderPlayer);
    a.target = '_blank';
    a.rel = 'noopener';
    a.title = `${recording.uploaderName} on bfstats.io`;
    a.setAttribute('aria-label', `${recording.uploaderName}'s player page on bfstats.io`);
    return a;
  }

  // --- watching ------------------------------------------------------------------

  function watch(recording, at = null) {
    location.assign(watchHref(recording, { root, fileUrl: p => state.api.fileUrl(p), at }));
  }

  function watchMerged(recording, round) {
    location.assign(watchRoundHref(recording, round, { root, fileUrl: p => state.api.fileUrl(p) }));
  }

  // --- one recording's page ------------------------------------------------------

  async function openDetail(slug, { push = false, summary = null } = {}) {
    await start();
    if (push) history.pushState({ tab: 'replay', rec: slug }, '', `?tab=replay&rec=${encodeURIComponent(slug)}`);
    state.detail = summary ? { ...summary, players: null, loading: true } : { slug, loading: true, title: '' };
    state.comments = [];
    state.commentPage = 0;
    state.commentPages = 1;
    state.commentTotal = summary?.commentCount ?? 0;
    renderDetail();
    body.scrollTop = 0;
    const asked = readAs();
    try {
      const detail = await state.api.get(slug);
      // Another page, or the feed, since.
      if (state.detail?.slug !== slug) return;
      state.detail = detail;
      state.detailAs = asked;
    } catch (error) {
      if (state.detail?.slug !== slug) return;
      state.detail = { slug, error: error.status === 404 ? 'That recording is not shared any more.' : error.message };
      renderDetail();
      return;
    }
    renderDetail();
    loadComments(true);
    syncViewer();
  }

  function closeDetail({ push = false } = {}) {
    if (!state.detail) return;
    state.detail = null;
    commentsEl = null;
    if (push) history.pushState({ tab: 'replay' }, '', feedHref(state.filter));
    if (!state.choices) loadChoices();
    renderList();
    if (!state.items.length) loadList(true);
    else syncViewer();
  }

  function renderDetail() {
    const recording = state.detail;
    if (!recording) return;
    bar.hidden = true;
    body.replaceChildren();
    const page = el('article', 'rf-detail');
    const narrowed = state.filter.server || state.filter.uploader;
    page.append(button('quiet rf-back', narrowed ? 'Recordings' : 'All recordings', () => closeDetail({ push: true }), 'back'));
    if (recording.error) {
      const note = el('div', 'rf-note');
      note.append(el('p', 'rf-error', recording.error));
      page.append(note);
      body.append(page);
      return;
    }
    const hero = el('div', 'rf-hero');
    const facts = el('div', 'rf-facts-col');
    const title = el('h2', 'rf-title');
    title.append(el('span', '', recording.title || ' '));
    facts.append(title);
    // A name on a recording's page leads to all of that server's or that
    // player's recordings, whatever the feed was narrowed to before.
    const all = { server: '', uploader: '' };
    if (!recording.loading || recording.uploaderName) {
      const by = el('div', 'rf-by');
      if (recording.uploaderName) by.append('Shared by ', sharedBy(recording, all), playerLink(recording));
      for (const part of [ago(recording.createdAt), count(recording.viewCount, 'view')].filter(Boolean)) {
        by.append(by.childNodes.length ? ` · ${part}` : part);
      }
      facts.append(by);
    }
    if (!recording.loading) {
      const dl = el('dl', 'rf-facts');
      const fact = (label, value) => {
        if (!value) return;
        const dd = el('dd');
        dd.append(value);
        dl.append(el('dt', '', label), dd);
      };
      const levelDd = { value: titled(recording.level) };
      fact('Level', levelDd.value);
      const levelNode = dl.lastChild;
      artFor(recording.mod, recording.level).then(level => { if (levelNode) levelNode.textContent = level.title; });
      fact('Game type', titled(recording.gameMode));
      fact('Server', recording.serverName && onServer(recording, all));
      fact('Recorded', [recordedAt(recording.recordedLocal), recording.recordedBy && `by ${recording.recordedBy}`].filter(Boolean).join(' '));
      fact('Length', clock(recording.durationSeconds));
      if (recording.players?.length) {
        dl.append(el('dt', '', `Players (${recording.players.length})`));
        const dd = el('dd', 'rf-players', recording.players.join(', '));
        dl.append(dd);
      }
      facts.append(dl);
      const actions = el('div', 'rf-actions');
      const round = roundOf(recording);
      if (round) {
        actions.append(button('primary', 'Watch merged', () => watchMerged(recording, round), 'round'),
          button('', 'Watch this one', () => watch(recording), 'play'));
      } else {
        actions.append(button('primary', 'Watch', () => watch(recording), 'play'));
      }
      actions.append(button('', 'Copy link', e => copyLink(recording, e.currentTarget), 'link'));
      if (recording.canManage) {
        actions.append(button('', 'Rename', () => rename(recording, title), 'pencil'),
          button('danger', 'Delete', () => openDelete(recording), 'trash'));
      }
      facts.append(actions);
    }
    hero.append(cover(recording, { big: true }), facts);
    page.append(hero);
    if (!recording.loading && (roundOf(recording) || recording.canEditRound)) page.append(roundSection(recording));
    if (!recording.loading) page.append(commentsSection(recording));
    body.append(page);
  }

  /**
   * The round a recording is one of (features/replay-feed, "Rounds"): each
   * recording of it, when it began in the round, whose it is and who recorded
   * it, and for an admin the tools that put it in a round detection missed or
   * take it out of one it should not be in.
   */
  function roundSection(recording) {
    const section = el('section', 'rf-round');
    section.setAttribute('aria-label', 'This round');
    const round = roundOf(recording);
    const head = el('div', 'rf-round-head');
    head.append(el('h2', '', 'This round'), el('span', '', round
      ? `${round.length} recordings. Watch merged plays them as one.`
      : 'Only this recording so far.'));
    // For an admin: held together only by an admin's link its files do not bear out.
    if (round && recording.roundWeak && recording.canEditRound) head.append(weakMark().firstChild);
    section.append(head);
    if (round) {
      const list = el('ol', 'rf-round-list');
      for (const member of round) {
        const self = member.slug === recording.slug;
        const item = el('li', `rf-round-item${self ? ' self' : ''}`);
        const at = el('span', 'rf-round-at', member.roundOffsetSeconds === null || member.roundOffsetSeconds === undefined
          ? '' : `+${clock(Math.round(member.roundOffsetSeconds))}`);
        at.title = 'When it began in the round';
        const facts = el('div');
        let name;
        if (self) {
          name = el('span', 'rf-name', `${member.title} (this one)`);
        } else {
          name = el('a', 'rf-name', member.title);
          name.href = `?tab=replay&rec=${encodeURIComponent(member.slug)}`;
          name.addEventListener('click', e => {
            if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return;
            e.preventDefault();
            openDetail(member.slug, { push: true });
          });
        }
        const line = el('div', 'rf-line');
        line.append('Shared by ', sharedBy(member, { server: '', uploader: '' }), playerLink(member));
        const said = [
          member.recordedBy && member.recordedBy !== member.uploaderName ? `recorded by ${member.recordedBy}` : null,
          clock(member.durationSeconds),
          member.link === 'linked' ? 'put here by an admin' : null,
          // What the files say of an admin's link, for the admins.
          member.link === 'linked' && recording.canEditRound && member.matchedKeys !== null && member.matchedKeys !== undefined
            ? count(member.matchedKeys, 'shared event') : null,
        ].filter(Boolean);
        for (const part of said) line.append(el('span', 'rf-dot'), part);
        if (member.weakLink && recording.canEditRound) line.append(' ', weakMark().firstChild);
        facts.append(name, line);
        item.append(at, facts);
        list.append(item);
      }
      section.append(list);
    }
    if (recording.canEditRound) section.append(roundAdmin(recording, round));
    return section;
  }

  /** An admin's tools: put this recording in another's round, by that one's link
   *  or id; take it out of its own, for good (detection leaves it out). A link
   *  the two recordings' files do not bear out comes back with what they say
   *  (`evidence`), to link anyway or leave. */
  function roundAdmin(recording, round) {
    const tools = el('div', 'rf-round-admin');
    const form = el('form');
    const input = el('input', 'rf-input');
    input.placeholder = "Another recording's link or id";
    input.setAttribute('aria-label', 'The recording to put this one with');
    const link = button('', 'Put in its round', () => form.requestSubmit(), 'link');
    form.append(input, link);
    const asked = el('div');
    const put = async (other, confirm) => {
      link.disabled = true;
      try {
        state.detail = await state.api.linkRound(recording.slug, other, confirm);
        staleList();
        renderDetail();
        flash(confirm ? 'Put in the round, marked weak' : 'Put in the round');
      } catch (error) {
        link.disabled = false;
        if (error.status === 409 && error.body?.evidence) asked.replaceChildren(evidenceBox(error.body.evidence, other, put, asked));
        else flash(error.message, true);
      }
    };
    form.addEventListener('submit', e => {
      e.preventDefault();
      if (!input.value.trim()) { input.focus(); return; }
      asked.replaceChildren();
      put(input.value.trim(), false);
    });
    input.addEventListener('input', () => asked.replaceChildren());
    tools.append(form, asked);
    if (round) {
      const out = button('quiet danger', 'Take out of this round', async () => {
        out.disabled = true;
        try {
          state.detail = await state.api.separateRound(recording.slug);
          staleList();
          renderDetail();
          flash('Taken out of the round');
        } catch (error) {
          out.disabled = false;
          flash(error.message, true);
        }
      }, 'unlink');
      tools.append(out);
    }
    tools.append(el('span', 'rf-hint', 'Taken out, it is never put back with these by itself.'));
    return tools;
  }

  /** What two recordings' files say of their being one round, when it falls
   *  short of what detection needs: the admin's to overrule. */
  function evidenceBox(evidence, other, put, holder) {
    const box = el('div', 'rf-evidence');
    box.setAttribute('role', 'alert');
    // The numbers, where there are any to read: none in common says it all.
    const numbers = evidence.measured && evidence.sameLevel && evidence.matchedKeys > 0
      ? [count(evidence.matchedKeys, 'shared event'), `${evidence.matchedPlayerKeys} of them the players' own`,
        `${Math.round((evidence.playerShare ?? 0) * 100)}% of the players' events where both recorded`,
        `${clock(evidence.overlapSeconds)} recorded by both`].join(' · ')
      : '';
    const needs = `One round needs ${evidence.minMatches} shared events, ${evidence.minPlayerKeys} of them the players' own, `
      + `and ${Math.round(evidence.minPlayerShare * 100)}% of the players' events where both recorded.`;
    box.append(el('p', '', evidence.summary));
    if (numbers) box.append(el('small', '', numbers));
    box.append(el('small', '', needs));
    const actions = el('div', 'rf-dialog-actions');
    actions.append(
      button('danger', 'Link anyway', () => { holder.replaceChildren(); put(other, true); }, 'link'),
      button('quiet', 'Leave them apart', () => holder.replaceChildren()));
    box.append(actions);
    return box;
  }

  async function copyLink(recording, target) {
    const href = shortHref(recording.slug, { base: state.api.base })
      ?? watchHref(recording, { root, fileUrl: p => absolute(state.api.fileUrl(p)) });
    try {
      await navigator.clipboard.writeText(href);
      target.querySelector('span').textContent = 'Link copied';
    } catch {
      window.prompt('The link to this recording:', href);
    }
  }

  const absolute = path => new URL(path, location.origin).href;

  /** The page's title, as a box to write another in. */
  function rename(recording, title) {
    const form = el('form', 'rf-rename');
    const input = el('input', 'rf-input');
    input.value = recording.title;
    input.maxLength = 100;
    input.setAttribute('aria-label', 'Title');
    const save = button('primary', 'Save', () => form.requestSubmit());
    form.append(input, save, button('quiet', 'Cancel', () => renderDetail()));
    form.addEventListener('submit', async e => {
      e.preventDefault();
      if (input.value.trim() === recording.title) { renderDetail(); return; }
      save.disabled = true;
      try {
        renamed(await state.api.rename(recording.slug, input.value));
      } catch (error) {
        save.disabled = false;
        flash(error.message, true);
      }
    });
    input.addEventListener('keydown', e => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      renderDetail();
    });
    title.replaceChildren(form);
    input.focus();
    input.select();
  }

  // --- renaming and deleting from a card -------------------------------------------

  /** Whose a recording is and how long, under the question in its dialogs. */
  const which = recording => [recording.uploaderName && `Shared by ${recording.uploaderName}`,
    clock(recording.durationSeconds)].filter(Boolean).join(' · ');

  function openRename(recording) {
    const { box, inner } = dialogFrame('Rename recording');
    const form = el('form', 'rf-dialog-form');
    const field = el('label', 'rf-field');
    const input = el('input', 'rf-input');
    input.maxLength = 100;
    input.value = recording.title;
    field.append(el('span', '', 'Title'), input);
    const status = el('div', 'rf-status');
    status.setAttribute('aria-live', 'polite');
    const save = button('primary', 'Save', () => form.requestSubmit(), 'pencil');
    const actions = el('div', 'rf-dialog-actions');
    actions.append(status, button('quiet', 'Cancel', () => { if (!busy) closeDialog(); }), save);
    form.append(field, el('p', 'rf-which', which(recording)), actions);
    const changed = () => input.value.trim().length > 0 && input.value.trim() !== recording.title;
    input.addEventListener('input', () => { save.disabled = busy || !changed(); });
    save.disabled = true;
    form.addEventListener('submit', async e => {
      e.preventDefault();
      if (busy || !changed()) return;
      busy = true;
      save.disabled = true;
      status.classList.remove('error');
      status.textContent = 'Saving';
      try {
        const done = await state.api.rename(recording.slug, input.value);
        busy = false;
        closeDialog();
        renamed(done);
        flash('Renamed');
      } catch (error) {
        busy = false;
        save.disabled = !changed();
        status.classList.add('error');
        status.textContent = error.message;
      }
    });
    inner.append(form);
    showDialog(box);
    input.focus();
    input.select();
  }

  function openDelete(recording) {
    const { box, inner } = dialogFrame('Delete recording');
    const status = el('div', 'rf-status');
    status.setAttribute('aria-live', 'polite');
    const keep = button('quiet', 'Keep it', () => { if (!busy) closeDialog(); });
    const go = button('destroy', 'Delete', async () => {
      if (busy) return;
      busy = true;
      go.disabled = true;
      status.classList.remove('error');
      status.textContent = 'Deleting';
      try {
        await state.api.remove(recording.slug);
        busy = false;
        closeDialog();
        deleted(recording.slug);
      } catch (error) {
        busy = false;
        go.disabled = false;
        status.classList.add('error');
        status.textContent = error.message;
      }
    }, 'trash');
    const actions = el('div', 'rf-dialog-actions');
    actions.append(status, keep, go);
    inner.append(el('p', 'rf-ask', `Delete "${recording.title}"?`), el('p', 'rf-which', which(recording)),
      el('p', 'rf-which', 'Its comments go with it. There is no undo.'), actions);
    showDialog(box);
    keep.focus();
  }

  /** A recording renamed: its card (a round's is its lead's title), its place
   *  in a round's list, and its page when that is up. */
  function renamed(recording) {
    const retitle = r => { if (r?.slug === recording.slug) r.title = recording.title; };
    for (const item of state.items) {
      retitle(item);
      item.round?.forEach(retitle);
    }
    if (state.detail?.slug === recording.slug) state.detail = recording;
    else state.detail?.round?.forEach(retitle);
    if (state.detail) renderDetail();
    else renderList();
  }

  /** A recording deleted: its card goes at once, and the cards are read again,
   *  since a round it was one of may have parted; its page gives way to them. */
  function deleted(slug) {
    flash('Deleted');
    loadChoices();
    state.items = state.items.filter(item => item.slug !== slug);
    state.listAs = null;
    if (state.detail) closeDetail({ push: true });
    else if (!state.items.length) loadList(true);
    else {
      renderList();
      syncViewer();
    }
  }

  /** The cards as the page holds them no longer are: a share, a removal or an
   *  admin's link or take-out can join two cards into one round, or part one.
   *  The feed is asked again when it next shows. */
  function staleList() {
    listAbort?.abort();
    Object.assign(state, { items: [], total: 0, recordings: 0, page: 0, pages: 1 });
  }

  // --- comments ------------------------------------------------------------------

  let commentsEl = null;
  function commentsSection(recording) {
    const section = el('section', 'rf-comments');
    section.setAttribute('aria-label', 'Comments');
    commentsEl = section;
    renderComments();
    return section;
  }

  /** Counts the times the comments are read from the start: an earlier read
   *  that comes back after a later one has nothing to add. */
  let commentReads = 0;
  async function loadComments(reset = false) {
    const recording = state.detail;
    if (!recording?.slug || recording.error) return;
    if (reset) { state.comments = []; state.commentPage = 0; state.commentPages = 1; }
    const read = reset ? ++commentReads : commentReads;
    try {
      const page = await state.api.comments(recording.slug, {
        sort: state.commentSort, page: state.commentPage + 1, pageSize: COMMENT_PAGE,
      });
      if (state.detail?.slug !== recording.slug || read !== commentReads) return;
      state.comments = reset ? page.items : [...state.comments, ...page.items];
      state.commentTotal = page.totalCount;
      state.commentPage = page.page;
      state.commentPages = page.totalPages;
    } catch (error) {
      console.warn('recordings-feed: comments', error);
    }
    renderComments();
  }

  function renderComments() {
    const recording = state.detail;
    const section = commentsEl;
    if (!section || !recording || recording.loading) return;
    section.replaceChildren();
    const top = el('div', 'rf-comments-head');
    top.append(el('h2', '', state.commentTotal ? count(state.commentTotal, 'comment') : 'Comments'));
    const seg = el('div', 'rf-seg');
    for (const [id, label] of [['newest', 'Newest'], ['time', 'In round order']]) {
      const b = el('button', '', label);
      b.type = 'button';
      b.setAttribute('aria-pressed', String(state.commentSort === id));
      b.addEventListener('click', () => {
        if (state.commentSort === id) return;
        state.commentSort = id;
        loadComments(true);
      });
      seg.append(b);
    }
    top.append(seg);
    section.append(top, composer(recording));
    const list = el('ol', 'rf-list');
    for (const comment of state.comments) list.append(commentItem(recording, comment));
    section.append(list);
    if (!state.comments.length) section.append(el('div', 'rf-status', 'No comments yet.'));
    if (state.commentPage < state.commentPages) {
      const more = el('div', 'rf-more');
      more.append(button('', 'More comments', () => loadComments(false)));
      section.append(more);
    }
  }

  function commentItem(recording, comment) {
    const li = el('li', 'rf-comment');
    const avatar = el('span', 'rf-avatar', (comment.authorName || '?').trim().charAt(0));
    const who = el('div', 'rf-comment-who');
    who.append(el('b', '', comment.authorName), document.createTextNode(ago(comment.createdAt)));
    const text = el('p', 'rf-comment-text');
    for (const run of commentRuns(comment.content, recording.durationSeconds)) {
      if (run.at === undefined) {
        text.append(document.createTextNode(run.text));
        continue;
      }
      const link = el('a', 'rf-time', run.text);
      link.href = watchHref(recording, { root, fileUrl: p => state.api.fileUrl(p), at: run.at });
      link.title = `Watch from ${clock(run.at)}`;
      link.addEventListener('click', e => {
        if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return;
        e.preventDefault();
        watch(recording, run.at);
      });
      text.append(link);
    }
    li.append(avatar, who);
    if (comment.canDelete) {
      li.append(button('quiet', 'Remove', async e => {
        e.currentTarget.disabled = true;
        try {
          await state.api.removeComment(recording.slug, comment.id);
          state.comments = state.comments.filter(c => c.id !== comment.id);
          state.commentTotal = Math.max(0, state.commentTotal - 1);
          renderComments();
        } catch (error) {
          flash(error.message, true);
        }
      }, 'trash'));
    }
    li.append(text);
    return li;
  }

  /** Where a comment is written: the text, the name it goes up as, and POST;
   *  or what it takes to get there (sign in, link an in-game name). */
  function composer(recording) {
    const api = state.api;
    if (!api?.canWrite) return el('div');
    if (!api.signedIn) {
      const box = el('div', 'rf-signin');
      box.append(el('span', '', 'Sign in to comment.'),
        button('', api.mode === 'local' ? 'Sign in (dev)' : 'Sign in with Discord', () => signIn(), 'user'));
      return box;
    }
    const names = state.viewer?.names ?? [];
    if (!names.length) return linkNameForm();
    const form = el('form', 'rf-compose');
    const text = el('textarea', 'rf-text');
    text.maxLength = 1000;
    text.placeholder = 'Add a comment. A time like 0:21 links to that moment.';
    text.setAttribute('aria-label', 'Comment');
    const row = el('div', 'rf-compose-row');
    const as = postAs(names);
    const status = el('span', 'rf-hint', 'Posting as');
    const post = button('primary', 'Post', () => form.requestSubmit());
    row.append(status, as, post);
    form.append(text, row);
    text.addEventListener('keydown', e => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); form.requestSubmit(); }
    });
    form.addEventListener('submit', async e => {
      e.preventDefault();
      if (!text.value.trim()) return;
      post.disabled = true;
      try {
        const comment = await api.comment(recording.slug, text.value, as.value);
        rememberPostAs(as.value);
        text.value = '';
        state.commentTotal += 1;
        if (state.commentSort === 'newest') state.comments = [comment, ...state.comments];
        else await loadComments(true);
        renderComments();
      } catch (error) {
        flash(error.message, true);
      } finally {
        post.disabled = false;
      }
    });
    return form;
  }

  /** The account has no in-game name to comment as: link one, as the
   *  dashboard does, and carry on. */
  function linkNameForm() {
    const form = el('form', 'rf-signin');
    const input = el('input', 'rf-input');
    input.maxLength = 32;
    input.placeholder = 'Your in-game name';
    input.value = playerName() && playerName() !== 'Player' ? playerName() : '';
    input.style.maxWidth = '240px';
    const save = button('primary', 'Use this name', () => form.requestSubmit());
    form.append(el('span', '', 'Comments go up under your in-game name.'), input, save);
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const name = input.value.trim();
      if (!name) return;
      save.disabled = true;
      try {
        state.viewer = await state.api.linkName(name);
        rememberPostAs(name);
        renderAccount();
        renderComments();
      } catch (error) {
        save.disabled = false;
        flash(error.message, true);
      }
    });
    return form;
  }

  const POST_AS_KEY = 'bf42-mesh-post-as';
  function rememberPostAs(name) {
    try { localStorage.setItem(POST_AS_KEY, name); } catch {}
  }

  /** Whom a recording is shared as: the player who recorded it, as the file
   *  names him, first; any name the account has linked after. A file that
   *  names nobody, from an account with nothing linked, asks for the name to
   *  link. `{ field, linking, value() }`. */
  function shareAs(recorder, names) {
    const options = [recorder, ...names].filter(Boolean)
      .filter((name, i, all) => all.findIndex(n => n.toLowerCase() === name.toLowerCase()) === i);
    if (!options.length) {
      const input = el('input', 'rf-input');
      input.maxLength = 32;
      input.placeholder = 'Your in-game name';
      input.value = playerName() && playerName() !== 'Player' ? playerName() : '';
      return { field: input, linking: true, value: () => input.value.trim() };
    }
    const select = el('select', 'rf-select');
    for (const name of options) select.append(new Option(name, name));
    select.disabled = options.length === 1;
    return { field: select, linking: false, value: () => select.value };
  }

  function postAs(names) {
    const select = el('select', 'rf-select');
    select.setAttribute('aria-label', 'Post as');
    let preferred = '';
    try { preferred = localStorage.getItem(POST_AS_KEY) || ''; } catch {}
    for (const name of names) {
      const option = el('option', '', name);
      option.value = name;
      select.append(option);
    }
    const wanted = [preferred, playerName()].map(n => n.toLowerCase());
    const match = names.find(n => wanted.includes(n.toLowerCase()));
    if (match) select.value = match;
    select.disabled = names.length === 1;
    return select;
  }

  // --- the dialogs ---------------------------------------------------------------

  /** A dialog doing its work (a share going up, a rename or a delete on its
   *  way): it stays up until that is done. */
  let busy = false;

  function showDialog(dialog) {
    closeMenus();
    shade.hidden = false;
    shade.replaceChildren(dialog);
  }

  function closeDialog() {
    shade.hidden = true;
    shade.replaceChildren();
  }

  shade.addEventListener('pointerdown', e => { if (e.target === shade && !busy) closeDialog(); });

  /** A dialog's plate: its heading strip with a close button, and its body. */
  function dialogFrame(heading) {
    const box = el('div', 'rf-dialog');
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-label', heading);
    const top = el('div', 'rf-head');
    const close = button('', '', () => { if (!busy) closeDialog(); }, 'close');
    close.setAttribute('aria-label', 'Close');
    top.append(el('h1', '', heading), el('span', 'rf-spacer'), close);
    const inner = el('div', 'rf-dialog-body');
    box.append(top, inner);
    return { box, inner };
  }

  // --- sharing -------------------------------------------------------------------

  function openShare(files = null) {
    showDialog(shareDialog(files));
  }

  function shareDialog(initialFiles) {
    const api = state.api;
    const { box: dialog, inner } = dialogFrame('Share a recording');

    if (!api?.canWrite) {
      inner.append(el('p', 'rf-status', 'Sharing needs the site: this page reads the live feed read-only.'));
      return dialog;
    }
    if (!api.signedIn) {
      inner.append(el('p', '', 'Sign in with your Discord account to share a recording.'));
      const actions = el('div', 'rf-dialog-actions');
      actions.append(button('primary', api.mode === 'local' ? 'Sign in (dev)' : 'Sign in with Discord', async () => {
        await signIn();
        if (api.signedIn) openShare(initialFiles);
      }, 'user'));
      inner.append(actions);
      return dialog;
    }

    const input = el('input');
    input.type = 'file';
    input.accept = '.ndjson,.xml';
    input.multiple = true;
    input.hidden = true;
    const drop = el('div', 'rf-drop');
    drop.innerHTML = `${icon('upload')}<b>Choose a replay_*.ndjson</b><span class="rf-drop-hint">and its ev_*.xml server log, if you have it, or several recordings at once. Or drop them here.</span>`;
    const chooseBtn = button('', 'Choose a file', () => input.click());
    drop.append(chooseBtn);
    const chosen = el('div');
    const status = el('div', 'rf-status');
    status.setAttribute('aria-live', 'polite');
    inner.append(input, drop, chosen, status);
    if (state.storage) {
      inner.append(el('div', 'rf-storage',
        `${size(state.storage.usedBytes)} of ${size(state.storage.quotaBytes)} shared so far.`));
    }

    let picked = null;   // { recording, log, described }
    const say = (text, error = false) => {
      status.textContent = text;
      status.classList.toggle('error', error);
    };

    async function take(files) {
      if (busy || !files.length) return;
      picked = null;
      chosen.replaceChildren();
      say('Reading the recording');
      try {
        const recordings = [];
        for (const file of files) if (!/\.xml$/i.test(file.name) && await isRecording(file)) recordings.push(file);
        if (recordings.length > 1) {
          await takeSeveral(recordings);
          return;
        }
        const { recording, log } = await sortRecordingFiles(files);
        const described = await describeRecording(await recording.text(), { onStage: say });
        picked = { recording, log, described };
        say('');
        // The zone steps aside for the recording it took: its name, and a way to another.
        drop.classList.add('compact');
        drop.querySelector('b').textContent = log ? `${recording.name} and ${log.name}` : recording.name;
        chooseBtn.querySelector('span').textContent = 'Choose another';
        renderChosen();
      } catch (error) {
        say(error.message || String(error), true);
      }
    }

    async function renderChosen() {
      const { recording, log, described } = picked;
      const { meta } = described;
      chosen.replaceChildren();
      const row = el('div', 'rf-chosen');
      const preview = { mod: meta.mod, level: meta.level, durationSeconds: meta.durationSeconds, title: recording.name };
      const art = el('div', 'rf-cover');
      const artTitle = el('span', 'rf-cover-title');
      art.append(artTitle, el('span', 'rf-len', clock(meta.durationSeconds)));
      artFor(preview.mod, preview.level).then(level => {
        paintArt(art, level.arts);
        artTitle.textContent = meta.level ? level.title : '';
      });
      const facts = el('div');
      const levelLine = el('div', 'rf-name', meta.level ? titled(meta.level) : 'Level unknown');
      artFor(preview.mod, preview.level).then(level => { if (meta.level) levelLine.textContent = level.title; });
      facts.append(levelLine,
        el('div', 'rf-line', [titled(meta.gameMode), meta.serverName].filter(Boolean).join(' · ') || recording.name),
        el('div', 'rf-line', [recordedAt(meta.start), meta.recordedBy && `by ${meta.recordedBy}`].filter(Boolean).join(' ')));
      row.append(art, facts);
      chosen.append(row);

      const fields = el('div', 'rf-dialog-body');
      fields.style.padding = '12px 0 0';
      // A recording that says no level, and whose flags match none: ask.
      let levelSelect = null;
      if (!meta.level) {
        const field = el('label', 'rf-field');
        field.append(el('span', '', 'Level'));
        levelSelect = el('select', 'rf-select');
        const prompt = el('option', '', 'Choose the level it was recorded on');
        prompt.value = '';
        levelSelect.append(prompt);
        for (const { mod, levels } of await levelTrees(described.mod)) {
          const group = el('optgroup');
          group.label = mod.name;
          for (const entry of levels) {
            const option = el('option', '', titled(entry.loading?.title || entry.name));
            option.value = `${mod.id}/${entry.name}`;
            group.append(option);
          }
          levelSelect.append(group);
        }
        field.append(levelSelect);
        fields.append(field);
      }
      const titleField = el('label', 'rf-field');
      const titleInput = el('input', 'rf-input');
      titleInput.maxLength = 100;
      titleInput.placeholder = 'What happens in it';
      const levelTitle = meta.level ? (await artFor(meta.mod, meta.level)).title : '';
      titleInput.value = defaultTitle(levelTitle, meta.serverName);
      titleField.append(el('span', '', 'Title'), titleInput);
      fields.append(titleField);
      const names = state.viewer?.names ?? [];
      const asField = el('label', 'rf-field');
      const as = shareAs(meta.recordedBy, names);
      asField.append(el('span', '', as.linking ? 'Your in-game name' : 'Shared by'), as.field);
      fields.append(asField);
      let withLog = null;
      if (log) {
        withLog = el('input');
        withLog.type = 'checkbox';
        withLog.checked = true;
        const check = el('label', 'rf-check');
        check.append(withLog, document.createTextNode(`Include the server log (${log.name})`));
        fields.append(check);
      }
      const progress = el('div', 'rf-progress');
      const bar = el('i');
      progress.append(bar);
      progress.hidden = true;
      const actions = el('div', 'rf-dialog-actions');
      const go = button('primary', 'Share', () => share(), 'upload');
      actions.append(button('quiet', 'Cancel', () => { if (!busy) closeDialog(); }), go);
      fields.append(progress, actions);
      chosen.append(fields);
      titleInput.focus();

      async function share() {
        if (busy) return;
        let level = meta.level;
        let modId = meta.mod;
        if (levelSelect) {
          if (!levelSelect.value) { say('Choose the level it was recorded on.', true); levelSelect.focus(); return; }
          const at = levelSelect.value.indexOf('/');
          modId = levelSelect.value.slice(0, at);
          level = levelSelect.value.slice(at + 1).toLowerCase();
        }
        const author = as.value();
        if (as.linking && !author) { say('Your in-game name first.', true); as.field.focus(); return; }
        busy = true;
        go.disabled = true;
        drop.hidden = true;
        progress.hidden = false;
        say('Compressing');
        try {
          if (as.linking) {
            state.viewer = await api.linkName(author);
            renderAccount();
          }
          const shared = await api.upload({
            recording,
            serverLog: withLog?.checked ? log : null,
            // The recording's own player goes up as the API reads him from the file;
            // only another name is sent.
            meta: { ...meta, level, mod: modId, title: titleInput.value, authorName: author === meta.recordedBy ? '' : author },
            onStage: stage => say(stage),
            onProgress: p => {
              bar.style.width = `${Math.round(p * 100)}%`;
              say(p >= 1 ? 'Checking the recording' : `Uploading ${Math.round(p * 100)}%`);
            },
          });
          if ((state.viewer?.names ?? []).includes(author)) rememberPostAs(author);
          busy = false;
          closeDialog();
          // It may have joined a round already in the feed: the cards are asked again.
          staleList();
          loadChoices();
          openDetail(shared.slug, { push: true, summary: shared });
        } catch (error) {
          busy = false;
          go.disabled = false;
          drop.hidden = false;
          progress.hidden = true;
          if (error.status === 409 && error.body?.existingSlug) {
            say(error.message, true);
            const open = button('', 'Open it', () => { closeDialog(); openDetail(error.body.existingSlug, { push: true }); });
            status.append(document.createTextNode(' '), open);
            return;
          }
          say(error.message || String(error), true);
        }
      }
    }

    /**
     * Several recordings picked at once (the round a few players recorded, say):
     * each goes up as its own, shared by the player who recorded it, under the
     * title written for it (the level and the server until another is), and the
     * API groups those of one round. A server log is for one recording, so it
     * goes up only with a recording shared on its own.
     */
    async function takeSeveral(files) {
      const rows = [];
      for (const [i, file] of files.entries()) {
        say(`Reading ${i + 1} of ${files.length}`);
        try {
          rows.push({ file, described: await describeRecording(await file.text()) });
        } catch (error) {
          rows.push({ file, error: error.message || String(error) });
        }
      }
      say('');
      drop.classList.add('compact');
      drop.querySelector('b').textContent = `${files.length} recordings`;
      chooseBtn.querySelector('span').textContent = 'Choose others';
      const list = el('ol', 'rf-several');
      for (const row of rows) {
        const meta = row.described?.meta;
        const item = el('li');
        const facts = el('div');
        facts.append(el('div', 'rf-name', meta?.level ? titled(meta.level) : row.file.name),
          el('div', 'rf-line', meta
            ? [titled(meta.gameMode), meta.serverName, meta.recordedBy && `by ${meta.recordedBy}`].filter(Boolean).join(' · ')
            : row.file.name));
        row.status = el('div', 'rf-status');
        if (!row.error && !meta.level) row.error = 'Its level is not known: share it on its own to choose it.';
        item.append(facts, el('span', 'rf-len-inline', meta ? clock(meta.durationSeconds) : ''));
        if (row.error) {
          row.status.textContent = row.error;
          row.status.classList.add('error');
        } else {
          const field = el('label', 'rf-field');
          row.title = el('input', 'rf-input');
          row.title.maxLength = 100;
          row.title.placeholder = 'What happens in it';
          field.append(el('span', '', 'Title'), row.title);
          item.append(field);
          artFor(meta.mod, meta.level).then(level => {
            if (!row.title.value) row.title.value = defaultTitle(level.title, meta.serverName);
          });
        }
        item.append(row.status);
        list.append(item);
      }
      const ready = rows.filter(row => !row.error);
      const progress = el('div', 'rf-progress');
      const bar = el('i');
      progress.append(bar);
      progress.hidden = true;
      const actions = el('div', 'rf-dialog-actions');
      const go = button('primary', `Share ${count(ready.length, 'recording')}`, () => shareAll(), 'upload');
      go.disabled = !ready.length;
      actions.append(button('quiet', 'Cancel', () => { if (!busy) closeDialog(); }), go);
      chosen.append(list, el('p', 'rf-status', 'Each goes up as its own recording, shared by the player who recorded it.'),
        progress, actions);

      async function shareAll() {
        if (busy || !ready.length) return;
        busy = true;
        go.disabled = true;
        drop.hidden = true;
        progress.hidden = false;
        for (const row of ready) row.title.disabled = true;
        const shared = [];
        for (const [i, row] of ready.entries()) {
          row.status.classList.remove('error');
          try {
            const { meta } = row.described;
            const recording = await api.upload({
              recording: row.file,
              meta: { ...meta, title: row.title.value, authorName: '' },
              onStage: stage => { row.status.textContent = stage; },
              onProgress: p => {
                bar.style.width = `${Math.round(((i + p) / ready.length) * 100)}%`;
                row.status.textContent = p >= 1 ? 'Checking the recording' : `Uploading ${Math.round(p * 100)}%`;
              },
            });
            row.status.textContent = 'Shared';
            shared.push(recording);
          } catch (error) {
            row.status.textContent = error.status === 409 ? `${error.message} Left as it is.` : error.message || String(error);
            row.status.classList.add('error');
          }
        }
        busy = false;
        bar.style.width = '100%';
        if (!shared.length) {
          drop.hidden = false;
          say('Nothing was shared.', true);
          return;
        }
        // Recordings of one round are one card: the feed is asked again.
        loadList(true);
        loadChoices();
        if (shared.length < ready.length) {
          say(`Shared ${shared.length} of ${ready.length}.`, true);
          const open = button('', 'Open the last', () => { closeDialog(); openDetail(shared.at(-1).slug, { push: true }); });
          status.append(document.createTextNode(' '), open);
          return;
        }
        closeDialog();
        // The last one's page: the round the others are found in says so there.
        openDetail(shared.at(-1).slug, { push: true, summary: shared.at(-1) });
      }
    }

    input.addEventListener('change', () => {
      const files = [...input.files];
      input.value = '';
      take(files);
    });
    // The zone's own drop: prevented first, so Open recording's page-wide one
    // (replay-open.js) leaves it alone.
    const carries = e => [...(e.dataTransfer?.types ?? [])].includes('Files');
    dialog.addEventListener('dragover', e => {
      if (!carries(e)) return;
      e.preventDefault();
      drop.classList.add('over');
    });
    dialog.addEventListener('dragleave', e => { if (e.target === drop) drop.classList.remove('over'); });
    dialog.addEventListener('drop', e => {
      if (!carries(e)) return;
      e.preventDefault();
      drop.classList.remove('over');
      take([...(e.dataTransfer?.files ?? [])]);
    });
    if (initialFiles?.length) take(initialFiles);
    return dialog;
  }

  // --- the page's own status line --------------------------------------------------

  let flashTimer = 0;
  function flash(text, error = false) {
    let note = panel.querySelector(':scope > .rf-flash');
    if (!note) {
      note = el('div', 'rf-status rf-flash');
      note.style.cssText = 'position:absolute;left:50%;bottom:12px;transform:translateX(-50%);z-index:6;padding:8px 14px;'
        + 'border-radius:6px;background:rgba(14,14,12,.95);border:1px solid var(--rf-edge);max-width:90%;text-align:center';
      panel.append(note);
    }
    note.textContent = text;
    note.classList.toggle('error', error);
    note.hidden = false;
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => { note.hidden = true; }, 5000);
  }

  // --- routing -------------------------------------------------------------------

  /** Shows what `?tab=replay[&rec=<slug>]` names, or the feed narrowed to
   *  `&server=` and `&uploader=`. A recording's page keeps the filter it was
   *  opened from, for its way back to the feed. */
  function route(params = new URLSearchParams(location.search)) {
    const slug = params.get('rec');
    if (slug) {
      if (state.detail?.slug !== slug) openDetail(slug);
      return;
    }
    const filter = feedFilterOf(params);
    const changed = !sameFilter(filter, state.filter);
    state.filter = filter;
    if (changed || !state.choices) loadChoices();
    if (changed) {
      state.items = [];
      body.scrollTop = 0;
    }
    if (state.detail) closeDetail();
    else if (changed || (!state.items.length && !state.loading)) loadList(true);
  }

  window.addEventListener('popstate', e => {
    if (rootEl.hidden) return;
    route(new URLSearchParams(location.search));
    if (e.state?.tab && e.state.tab !== 'replay') return;
  });

  window.addEventListener('keydown', e => {
    if (rootEl.hidden || e.key !== 'Escape') return;
    if (body.querySelector('.rf-manage.open')) { closeMenus({ focus: true }); e.preventDefault(); return; }
    if (!shade.hidden) { if (!busy) closeDialog(); e.preventDefault(); return; }
    if (state.detail && !/^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName ?? '')) {
      closeDetail({ push: true });
      e.preventDefault();
    }
  });

  return {
    element: rootEl,
    /** Puts the feed in `box` (CSS pixels, the viewport's). */
    place(box) {
      Object.assign(rootEl.style, {
        left: `${Math.round(box.left)}px`, top: `${Math.round(box.top)}px`,
        width: `${Math.round(box.width)}px`, height: `${Math.round(box.height)}px`,
      });
    },
    show(params) {
      rootEl.hidden = false;
      route(params);
    },
    hide() {
      rootEl.hidden = true;
      if (!busy) closeDialog();
    },
    openShare,
    route,
    get state() { return state; },
  };
}
